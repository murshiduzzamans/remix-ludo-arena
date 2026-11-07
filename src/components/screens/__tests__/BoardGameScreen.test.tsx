import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialGameState, rollDice } from '../../../engine/gameEngine';
import type { GameState, PlayerColor } from '../../../engine/types';
import type { OnlineRoomConnection, RoomEvent } from '../../../network/onlineClient';
import { BoardGameScreen } from '../BoardGameScreen';

vi.mock('../../board/LudoBoard', () => ({
  LudoBoard: ({ gameState, onTokenClick }: {
    gameState: GameState;
    onTokenClick: (tokenIndex: number, color: PlayerColor) => void;
  }) => (
    <div>
      {gameState.legalMoves.map((move) => (
        <button
          key={`${move.tokenColor}-${move.tokenIndex}`}
          onClick={() => onTokenClick(move.tokenIndex, move.tokenColor ?? gameState.currentTurnColor)}
        >
          Move {move.tokenColor} {move.tokenIndex}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('../../game/CornerPlayerPod', () => ({
  CornerPlayerPod: ({ player, canRoll, onRoll, onDiceClickDuringMove }: {
    player: { color: PlayerColor };
    canRoll: boolean;
    onRoll: () => void;
    onDiceClickDuringMove: () => void;
  }) => (
    <button
      data-testid={`dice-${player.color}`}
      onClick={canRoll ? onRoll : onDiceClickDuringMove}
    >
      Dice {player.color}
    </button>
  ),
  shortPlayerName: (name: string) => name,
}));

vi.mock('../ResultsModal', () => ({ ResultsModal: () => null }));
vi.mock('../../../audio/soundEffects', () => ({
  sound: {
    getMuted: () => false,
    setMuted: vi.fn(),
    triggerHaptic: vi.fn(),
    playDiceRoll: vi.fn(),
    playMove: vi.fn(),
    playCapture: vi.fn(),
    playHomeFinish: vi.fn(),
    playTurnNotification: vi.fn(),
    playVictory: vi.fn(),
  },
}));

function createSinglePawnState(diceValue: number): GameState {
  const initial = createInitialGameState({
    id: 'one-pawn-game',
    seed: 'one-pawn-seed',
    mode: 'classic_4p',
    humanColor: 'red',
  });
  const players = initial.players.map((player) => {
    if (player.color !== 'red') return player;
    const tokens = player.tokens.map((token, index) => ({
      ...token,
      stepCount: index === 0 ? 10 : 56,
      isHome: index !== 0,
      isInYard: false,
    }));
    return { ...player, tokens, tokensFinished: 3, hasWon: false };
  });
  const result = rollDice({ ...initial, players }, diceValue);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function createOnlineSession(initialState: GameState) {
  let listener: ((event: RoomEvent) => void) | undefined;
  const session = {
    roomCode: 'LUDO-ABC234',
    participantId: 'host-id',
    token: 'token',
    localColor: 'red' as const,
    currentGameState: initialState,
    currentRoom: {
      code: 'LUDO-ABC234',
      hostId: 'host-id',
      mode: 'classic_4p' as const,
      rules: initialState.rules,
      participants: [{
        id: 'host-id',
        name: 'Host',
        color: 'red' as const,
        isHost: true,
        isReady: true,
        isBot: false,
        isConnected: true,
        pingMs: 0,
      }],
      maxPlayers: 4,
      isMatchInProgress: true,
      rematchRequests: [],
    },
    subscribe: vi.fn((next: (event: RoomEvent) => void) => {
      listener = next;
      return () => { listener = undefined; };
    }),
    rollDice: vi.fn(),
    selectMove: vi.fn(),
    requestRematch: vi.fn(),
    backToLobby: vi.fn(),
    close: vi.fn(),
    emitGame(state: GameState) {
      listener?.({ type: 'game', state, turnTimeRemainingSeconds: 30 });
    },
  };
  return session;
}

describe('BoardGameScreen single-move behavior', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('auto-selects the sole legal non-six move in an online room', () => {
    const session = createOnlineSession(createInitialGameState({
      id: 'waiting-game',
      seed: 'waiting-seed',
      mode: 'classic_4p',
      humanColor: 'red',
    }));
    render(
      <BoardGameScreen
        initialMode="classic_4p"
        onlineSession={session as unknown as OnlineRoomConnection}
        onExit={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('dice-red'));
    expect(session.rollDice).toHaveBeenCalledOnce();
    act(() => session.emitGame(createSinglePawnState(3)));

    act(() => vi.advanceTimersByTime(450));
    expect(session.selectMove).toHaveBeenCalledWith(0, 'red');
  });

  it('does not auto-select a pawn after a six, but moves it when the player taps it', () => {
    const session = createOnlineSession(createInitialGameState({
      id: 'waiting-game-six',
      seed: 'waiting-seed-six',
      mode: 'classic_4p',
      humanColor: 'red',
    }));
    render(
      <BoardGameScreen
        initialMode="classic_4p"
        onlineSession={session as unknown as OnlineRoomConnection}
        onExit={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('dice-red'));
    act(() => session.emitGame(createSinglePawnState(6)));
    act(() => vi.advanceTimersByTime(450));
    expect(session.selectMove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Move red 0' }));
    expect(session.selectMove).toHaveBeenCalledWith(0, 'red');
  });

  it('does not move the only pawn when the player taps the dice during the move phase', () => {
    const session = createOnlineSession(createSinglePawnState(3));
    render(
      <BoardGameScreen
        initialMode="classic_4p"
        onlineSession={session as unknown as OnlineRoomConnection}
        onExit={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('dice-red'));
    expect(session.selectMove).not.toHaveBeenCalled();
  });
});
