import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialGameState } from '../../../engine/gameEngine';
import { ResultsModal } from '../ResultsModal';

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));
vi.mock('../../../audio/soundEffects', () => ({
  sound: { playVictory: vi.fn(), playTurnNotification: vi.fn() },
}));

describe('ResultsModal online room actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lets an online player request a rematch and displays the request count', () => {
    const onRematch = vi.fn();
    render(
      <ResultsModal
        gameState={createInitialGameState({ id: 'game-1', seed: 'seed-1', mode: 'classic_4p' })}
        onRematch={onRematch}
        onExitLobby={vi.fn()}
        isOnline
        rematchRequestCount={1}
        connectedHumanCount={2}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /request rematch \(1\/2\)/i }));
    expect(onRematch).toHaveBeenCalledOnce();
  });

  it('shows waiting state and gives the host a room-lobby action', () => {
    const onExitLobby = vi.fn();
    render(
      <ResultsModal
        gameState={createInitialGameState({ id: 'game-2', seed: 'seed-2', mode: 'classic_4p' })}
        onRematch={vi.fn()}
        onExitLobby={onExitLobby}
        isOnline
        isRoomHost
        rematchRequested
        rematchRequestCount={2}
        connectedHumanCount={2}
        statusMessage="Reconnect before continuing."
      />
    );

    expect(screen.getByRole('button', { name: /waiting \(2\/2\)/i })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Reconnect before continuing.');
    fireEvent.click(screen.getByRole('button', { name: /back to room/i }));
    expect(onExitLobby).toHaveBeenCalledOnce();
  });
});
