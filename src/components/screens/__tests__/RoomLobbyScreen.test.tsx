import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createInitialGameState, DEFAULT_RULES } from '../../../engine/gameEngine';
import type { OnlineRoomConnection, RoomEvent } from '../../../network/onlineClient';
import { OnlineRoomConnection as OnlineRoomConnectionClass } from '../../../network/onlineClient';
import type { RoomSnapshot } from '../../../network/protocol';
import { RoomLobbyScreen } from '../RoomLobbyScreen';

function createRoom(teamSwapRequest: RoomSnapshot['teamSwapRequest'] = null): RoomSnapshot {
  return {
    code: 'LUDO-ABC234',
    hostId: 'host-id',
    mode: 'team_2v2',
    rules: DEFAULT_RULES,
    participants: [
      { id: 'host-id', name: 'Host', color: 'red', isHost: true, isReady: true, isBot: false, teamId: 'team_A', pingMs: 0, isConnected: true },
      { id: 'friend-id', name: 'Friend', color: 'green', isHost: false, isReady: true, isBot: false, teamId: 'team_B', pingMs: 0, isConnected: true },
    ],
    maxPlayers: 4,
    isMatchInProgress: false,
    rematchRequests: [],
    teamSwapRequest,
  };
}

function createConnection(room: RoomSnapshot, participantId: string, resumedGame?: ReturnType<typeof createInitialGameState>) {
  const connection = {
    roomCode: room.code,
    participantId,
    currentRoom: room,
    subscribe: vi.fn((listener: (event: RoomEvent) => void) => {
      listener({ type: 'room', room });
      listener({ type: 'connection', connected: true });
      if (resumedGame) listener({ type: 'game', state: resumedGame, turnTimeRemainingSeconds: 30 });
      return () => {};
    }),
    setReady: vi.fn(),
    startMatch: vi.fn(),
    requestTeamSwap: vi.fn(),
    respondToTeamSwap: vi.fn(),
    close: vi.fn(),
  };
  return connection as unknown as OnlineRoomConnection & typeof connection;
}

describe('RoomLobbyScreen team switching', () => {
  it('lets a player request a team switch with an opposing player in the lobby', () => {
    const connection = createConnection(createRoom(), 'host-id');
    render(<RoomLobbyScreen onStartOnlineMatch={vi.fn()} onBack={vi.fn()} rules={DEFAULT_RULES} existingConnection={connection} />);

    fireEvent.click(screen.getByRole('button', { name: 'Request to switch teams with Friend' }));

    expect(connection.requestTeamSwap).toHaveBeenCalledWith('friend-id');
    expect(screen.getByText('Team changes are available here before the match. Seat colors and turn order stay the same.')).toBeInTheDocument();
  });

  it('lets the invited player accept a team switch in the lobby', () => {
    const request = { id: 'request-id', requesterId: 'host-id', targetId: 'friend-id', expiresAt: Date.now() + 30_000 };
    const connection = createConnection(createRoom(request), 'friend-id');
    render(<RoomLobbyScreen onStartOnlineMatch={vi.fn()} onBack={vi.fn()} rules={DEFAULT_RULES} existingConnection={connection} />);

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    expect(connection.respondToTeamSwap).toHaveBeenCalledWith('request-id', true);
    expect(screen.getByRole('dialog', { name: 'Team switch request' })).toBeInTheDocument();
  });

  it('reconnects a saved active room and resumes its game after refresh', async () => {
    const room = { ...createRoom(), isMatchInProgress: true };
    const game = createInitialGameState({ id: 'resumed-game', seed: 'resumed-game', mode: 'team_2v2' });
    const connection = createConnection(room, 'host-id', game);
    const reconnect = vi.spyOn(OnlineRoomConnectionClass, 'reconnect').mockResolvedValue(connection);
    const onStartOnlineMatch = vi.fn();
    render(<RoomLobbyScreen initialRoomCode={room.code} onStartOnlineMatch={onStartOnlineMatch} onBack={vi.fn()} rules={DEFAULT_RULES} />);

    await waitFor(() => expect(reconnect).toHaveBeenCalledWith(room.code, expect.any(String)));
    await waitFor(() => expect(onStartOnlineMatch).toHaveBeenCalledWith(connection));
    expect(screen.queryByText('Reconnecting to your game…')).not.toBeInTheDocument();
    reconnect.mockRestore();
  });
});