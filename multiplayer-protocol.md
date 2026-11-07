# Authoritative Private Room Protocol — Ludo Arena

> **Private rooms are implemented in this repository** in `worker/index.ts` and `src/network/onlineClient.ts`. Deploy the Worker and set `VITE_MULTIPLAYER_API_URL` to enable friends on separate devices. Public matchmaking remains a local preview and has no global queue.

## 1. Overview & Handshake Protocol

Ludo Arena uses a Cloudflare Worker HTTP API for room creation/joining and an authenticated WebSocket connected to a SQLite-backed Durable Object for live room and game state.

### Connection Endpoint
```
POST https://<worker-domain>.workers.dev/api/rooms
POST https://<worker-domain>.workers.dev/api/rooms/<room_code>/join
wss://<worker-domain>.workers.dev/api/rooms/<room_code>/ws?token=<private_player_token>
```

### Handshake Sequence
1. **Create**: The client posts the mode, name, and rules to `/api/rooms`; the Worker returns a random room code and a private reconnect token.
2. **Join**: A friend posts their name to `/api/rooms/<code>/join`; the Worker allocates a seat and returns a private reconnect token. A share link contains only the room code.
3. **Connect**: Each browser opens the room WebSocket using its private token. The Durable Object sends room state and, if started, the current game state.
4. **Heartbeat**: Clients send `CLIENT_PING` every 15 seconds; the server returns `SERVER_PONG`.

---

## 2. Client-to-Server Message Schemas

WebSocket messages are JSON objects. Room creation and joining are HTTP POST requests rather than WebSocket messages.
```typescript
type ClientMessage =
  | { type: 'CLIENT_SET_READY'; payload: { isReady: boolean } }
  | { type: 'CLIENT_START_MATCH' }
  | { type: 'CLIENT_REQUEST_REMATCH' }
  | { type: 'CLIENT_BACK_TO_LOBBY' }
  | { type: 'CLIENT_ROLL_DICE' }
  | { type: 'CLIENT_SELECT_MOVE'; payload: { tokenIndex: number; tokenColor?: PlayerColor } }
  | { type: 'CLIENT_REQUEST_TEAM_SWAP'; payload: { targetParticipantId: string } }
  | { type: 'CLIENT_RESPOND_TEAM_SWAP'; payload: { requestId: string; accept: boolean } }
  | { type: 'CLIENT_LEAVE_ROOM' }
  | { type: 'CLIENT_PING'; payload: { clientTimestamp: number } };
```

### Core Client Messages:

#### HTTP `POST /api/rooms`
Creates a room. JSON body: `{ "mode": "classic_4p", "playerName": "Alex", "rules": { ... } }`.

#### HTTP `POST /api/rooms/<code>/join`
Joins a room. JSON body: `{ "playerName": "Jordan", "token": "<saved token, when reconnecting>" }`.

#### 1. `CLIENT_SET_READY`
Signals ready status inside a room lobby.
```json
{ "type": "CLIENT_SET_READY", "payload": { "isReady": true } }
```

#### 2. `CLIENT_START_MATCH`
Host-only. Starts when at least two people are seated and every joined participant is ready; empty seats become bots. It is rejected while a match is already in progress.
```json
{ "type": "CLIENT_START_MATCH" }
```

#### 3. `CLIENT_REQUEST_REMATCH`
Any seated human may request a rematch after the current match ends. The server starts a fresh game after every currently connected human has requested one; it keeps the same room seats and rules and resets all participants to not ready.
```json
{ "type": "CLIENT_REQUEST_REMATCH" }
```

#### 4. `CLIENT_BACK_TO_LOBBY`
Host-only and available after the match ends. Clears the game state and returns the room to its lobby while retaining the participants and resetting readiness.
```json
{ "type": "CLIENT_BACK_TO_LOBBY" }
```

#### 5. `CLIENT_ROLL_DICE`
Requests the authoritative server to roll the dice.
```json
{ "type": "CLIENT_ROLL_DICE" }
```

#### 6. `CLIENT_SELECT_MOVE`
Submits a chosen token index for legal movement.
```json
{
  "type": "CLIENT_SELECT_MOVE",
  "payload": { "tokenIndex": 1 }
}
```

#### 7. Team switch requests
In a 2v2 room lobby, a player may request a team swap with a connected human on the opposing team. The invited player must accept. Requests expire after 30 seconds; matches cannot start while a request is pending. Team membership changes but seat colors and turn order do not. Team switching is unavailable after the match starts.
```json
{ "type": "CLIENT_REQUEST_TEAM_SWAP", "payload": { "targetParticipantId": "usr-2" } }
{ "type": "CLIENT_RESPOND_TEAM_SWAP", "payload": { "requestId": "req-1", "accept": true } }
```

`CLIENT_LEAVE_ROOM` closes the room for everyone when sent by the host; another player leaving frees their seat. `CLIENT_PING` is the heartbeat message.

---

## 3. Server-to-Client Message Schemas

#### 1. `SERVER_ROOM_STATE`
Dispatched whenever room participants join, change ready state or team, request a rematch, or the room returns to its lobby. The payload includes `rematchRequests` and any pending `teamSwapRequest`.
```json
{
  "type": "SERVER_ROOM_STATE",
  "payload": {
    "code": "LUDO-7X",
    "hostId": "usr-1",
    "mode": "classic_4p",
    "participants": [
      {
        "id": "usr-1",
        "name": "Alex",
        "color": "red",
        "isHost": true,
        "isReady": true,
        "isBot": false,
        "pingMs": 24
      }
    ],
    "maxPlayers": 4,
    "isMatchInProgress": false,
    "rematchRequests": []
  }
}
```

#### 2. `SERVER_GAME_STATE_SYNC`
Dispatched whenever turn state mutates. Contains the full authoritative `GameState`; token moves also include authoritative move metadata so every client can animate the same path, including server-controlled bot moves.
```json
{
  "type": "SERVER_GAME_STATE_SYNC",
  "payload": {
    "state": { /* GameState object */ },
    "serverTimestamp": 1741234567890,
    "turnTimeRemainingSeconds": 28
  }
}
```

`SERVER_MATCHMAKING_STATUS` is reserved for a future public queue and is not currently emitted.

#### 3. `SERVER_ERROR`
Dispatched on invalid moves or protocol violations.
```json
{
  "type": "SERVER_ERROR",
  "payload": {
    "code": "INVALID_MOVE",
    "message": "Selected token cannot advance past center triumph with roll of 5."
  }
}
```

---

## 4. Reconnection & Disconnection Handling

- **Reconnect**: The private player token is saved in that browser's local storage. Reopening the invite link in that browser reconnects the same seat and receives the current room/game snapshot.
- **Vacant seats**: When the host starts with at least two ready people, any remaining seats are server-controlled bots.
- **Bot turns and no-move passes**: The Durable Object schedules these with persistent alarms so play can continue after it hibernates.
- **Leaving**: A player can leave and free their seat before start. The host can end the room; if the browser closes unexpectedly, the player remains reconnectable.
