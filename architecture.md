# System Architecture Blueprint — Ludo Arena

## 1. Architectural Philosophy

Ludo Arena enforces a strict separation between **Presentation (React 19 + Tailwind CSS)**, **Authoritative Game Logic (Pure TypeScript Engine)**, **Networking / Protocol Schema**, and **Client Persistence**.

```
┌────────────────────────────────────────────────────────────────────────┐
│                              Ludo Arena                                │
├────────────────────────────────────────────────────────────────────────┤
│  Presentation Layer (React 19 + Tailwind CSS)                         │
│  ┌───────────────┐ ┌────────────────┐ ┌───────────────┐ ┌────────────┐ │
│  │  Lobby & Nav  │ │ SVG Ludo Board │ │ Player Seats  │ │  Dice UI   │ │
│  └───────┬───────┘ └───────┬────────┘ └───────┬───────┘ └─────┬──────┘ │
│          │                 │                  │               │        │
│          ▼                 ▼                  ▼               ▼        │
│  State Controller / Hooks (`BoardGameScreen`, `usePWAInstall`)        │
├────────────────────────────────────────────────────────────────────────┤
│  Authoritative Game Engine (Pure TypeScript, Zero React Dependencies)  │
│  ┌───────────────────────┐ ┌──────────────────────┐                   │
│  │  LudoState & Reducer  │ │  Legal Move Checker  │                   │
│  ├───────────────────────┤ ├──────────────────────┤                   │
│  │  Path & Coordinates   │ │  Rules Configuration │                   │
│  ├───────────────────────┤ ├──────────────────────┤                   │
│  │  Bot AI Personalities │ │  Win / Team Checkers │                   │
│  └───────────────────────┘ └──────────────────────┘                   │
├────────────────────────────────────────────────────────────────────────┤
│  Networking & Protocol Boundary (`/src/network`)                       │
│  ┌─────────────────────────────────┐ ┌──────────────────────────────┐ │
│  │ WebSocket Authoritative Schema  │ │ Room & Matchmaking Contracts │ │
│  └─────────────────────────────────┘ └──────────────────────────────┘ │
├────────────────────────────────────────────────────────────────────────┤
│  Persistence & Audio Synthesis                                         │
│  ┌──────────────────────────────┐ ┌─────────────────────────────────┐ │
│  │ LocalStorage Stats & History │ │ Web Audio Procedural Synthesizer│ │
│  └──────────────────────────────┘ └─────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Decoupled Pure TypeScript Engine (`src/engine/`)

The core game logic has **zero dependencies on React, the browser DOM, or external state managers**.

### Engine Characteristics:
- **Deterministic State Reducer**: Given `(state, action)`, it computes `newState` via pure functions (`rollDice`, `applyMove`).
- **Headless Execution**: The exact same codebase runs in:
  1. Local browser client (Solo vs Bots and Pass & Play).
  2. Vitest unit tests (deterministic fixed dice roll simulations).
  3. Server-side Cloudflare Durable Object worker (authoritative multiplayer state).

### Coordinate Projection (`boardCoordinates.ts`):
- Grid dimensions: 15 columns × 15 rows.
- SVG Canvas: `600px × 600px` viewBox (`40px` per cell).
- Mathematical mapping:
  - Outer track: 52 cells mapped clockwise from `(col:0, row:6)` to `(col:0, row:7)`.
  - Home paths: 4 vectors of 5 squares pointing towards center `(300, 300)`.
  - Center Triumph: Triangles meeting at `(300, 300)` with token offsets for finished pieces.

---

## 3. Production Backend Architecture: Cloudflare Workers + Durable Objects

Authoritative multiplayer relies on Cloudflare Durable Objects to guarantee that **browsers never determine dice outcomes or validate legal moves**.

```
[Browser Client A] <─── WebSocket ───┐
                                     ├──> [Cloudflare Durable Object: MatchSession]
[Browser Client B] <─── WebSocket ───┘    │  - Authoritative Pure TS Engine
                                          │  - Cryptographic Random Dice Rolls
                                          │  - Turn Timeout Timers (30s auto-move)
                                          │  - Room Lifecycle & Reconnect Tokens
                                          └── [Cloudflare KV / D1 Database (Match Archives)]
```

### Why Cloudflare Durable Objects?
1. **Single Authoritative Actor per Match**: Each room (e.g. `LUDO-7X`) is bound to a single Durable Object instance globally.
2. **Zero In-Memory Race Conditions**: All WebSocket messages are processed sequentially in the actor loop.
3. **Low Latency Edge Execution**: Workers spin up near the room host, keeping WebSocket ping times under 50ms worldwide.
4. **Hibernation API**: Cloudflare Durable Objects can hibernate during turn deliberation, reducing hosting costs.

### Turn Timeout & Reconnection Strategy:
- Each turn is granted a 30-second server countdown.
- If a client disconnects, the server marks the slot as `disconnected` and begins a 60-second reconnection grace period.
- If the countdown reaches 0, the server invokes `chooseBotMove(legalMoves, 'balanced')` as an auto-play fallback, keeping the match alive.

---

## 4. Client Presentation Layer

- **Framework**: React 19 + TypeScript (strict mode enabled).
- **Styling**: Tailwind CSS with custom midnight obsidian theme (`#090D16`), champagne gold trims (`#D4AF37`), and WCAG AA compliant jewel player colors.
- **Micro-Interactions**: CSS transform-based pawn pulses (`animate-pawn-playable`), stacked pawn spread offsets, and 3D dice bounce transitions.
- **Audio**: Web Audio API oscillator synthesis (`soundEffects.ts`) eliminating external audio CDN requests and latency.
