import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMove, createInitialGameState, rollDice } from '../../../engine/gameEngine';
import type { GameState, PlayerColor } from '../../../engine/types';
import type { OnlineRoomConnection, RoomEvent } from '../../../network/onlineClient';
import type { OnlineTokenMove } from '../../../network/protocol';
import { BoardGameScreen } from '../BoardGameScreen';

vi.mock('../../board/LudoBoard', () => ({
  LudoBoard: ({ gameState, onTokenClick, animatingToken, animatingCaptures }: {
    gameState: GameState;
    onTokenClick: (tokenIndex: number, color: PlayerColor) => void;
    animatingToken?: { color: PlayerColor; tokenIndex: number; currentStep: number } | null;
    animatingCaptures?: Array<{ color: PlayerColor; tokenIndex: number; currentStep: number; isBeingCaptured: boolean }>;
  }) => (
    <div
      data-testid="board"
      data-step={animatingToken?.currentStep ?? gameState.players.find(p => p.color === 'red')?.tokens[0].stepCount}
      data-capture-step={animatingCaptures?.[0]?.currentStep ?? gameState.players.find(p => p.color === 'green')?.tokens[0].stepCount}
      data-capturing={animatingCaptures?.[0]?.isBeingCaptured ?? false}
    >
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

function createOnlineSession(initialState: GameState, localColor: PlayerColor = 'red') {
  let listener: ((event: RoomEvent) => void) | undefined;
  const session = {
    roomCode: 'LUDO-ABC234',
    participantId: 'host-id',
    token: 'token',
    localColor,
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
    emitMove(state: GameState, move: OnlineTokenMove) {
      listener?.({ type: 'game', state, turnTimeRemainingSeconds: 30, move });
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

  it.each(['red', 'green'] as const)('animates the authoritative move for local player %s, including observers', (localColor) => {
    const before = createSinglePawnState(3);
    const move = before.legalMoves[0];
    const applied = applyMove(before, { actorColor: 'red', tokenIndex: move.tokenIndex, tokenColor: 'red' });
    if (!applied.ok) throw new Error(applied.error);
    const nextState: GameState = {
      ...applied.state,
      players: applied.state.players.map((player) => player.color === 'red'
        ? { ...player, tokens: player.tokens.map((token) => token.index === 0 ? { ...token, stepCount: 14 } : token) }
        : player),
    };
    const session = createOnlineSession(before, localColor);
    render(<BoardGameScreen initialMode="classic_4p" onlineSession={session as unknown as OnlineRoomConnection} onExit={vi.fn()} />);

    act(() => session.emitMove(applied.state, { id: 'move-1', color: 'red', tokenIndex: 0, fromStep: 10, toStep: 13 }));
    expect(screen.getByTestId('board')).toHaveAttribute('data-step', '10');
    act(() => vi.advanceTimersByTime(220));
    expect(screen.getByTestId('board')).toHaveAttribute('data-step', '11');
    act(() => session.emitGame(applied.state));
    expect(screen.getByTestId('board')).toHaveAttribute('data-step', '11');
    act(() => session.emitMove(nextState, { id: 'move-2', color: 'red', tokenIndex: 0, fromStep: 13, toStep: 14 }));
    expect(screen.getByTestId('board')).toHaveAttribute('data-step', '11');
    act(() => vi.advanceTimersByTime(660));
    expect(screen.getByTestId('board')).toHaveAttribute('data-step', '13');
    act(() => vi.advanceTimersByTime(120));
    expect(screen.getByTestId('board')).toHaveAttribute('data-step', '13');
    act(() => vi.advanceTimersByTime(220));
    expect(screen.getByTestId('board')).toHaveAttribute('data-step', '14');
    expect(nextState.players.find(p => p.color === 'red')?.tokens[0].stepCount).toBe(14);
  });

  it.each(['red', 'green'] as const)('animates captured pawns for local player %s, including observers', (localColor) => {
    const before = createSinglePawnState(3);
    const move = before.legalMoves[0];
    const applied = applyMove(before, { actorColor: 'red', tokenIndex: move.tokenIndex, tokenColor: 'red' });
    if (!applied.ok) throw new Error(applied.error);
    const stateAfterCapture: GameState = {
      ...applied.state,
      players: applied.state.players.map((player) => player.color === 'green'
        ? { ...player, tokens: player.tokens.map((token) => token.index === 0 ? { ...token, stepCount: -1, isInYard: true } : token) }
        : player),
    };
    const session = createOnlineSession(before, localColor);
    render(<BoardGameScreen initialMode="classic_4p" onlineSession={session as unknown as OnlineRoomConnection} onExit={vi.fn()} />);

    act(() => session.emitMove(stateAfterCapture, {
      id: 'capture-move',
      color: 'red',
      tokenIndex: 0,
      fromStep: 10,
      toStep: 13,
      capturedTokens: [{ color: 'green', tokenIndex: 0, fromStep: 44 }],
    }));
    expect(screen.getByTestId('board')).toHaveAttribute('data-capture-step', '44');
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('board')).toHaveAttribute('data-step', '13');
    expect(screen.getByTestId('board')).toHaveAttribute('data-capture-step', '44');
    expect(screen.getByTestId('board')).toHaveAttribute('data-capturing', 'true');
    act(() => vi.advanceTimersByTime(240));
    expect(screen.getByTestId('board')).toHaveAttribute('data-capture-step', '-1');
    expect(screen.getByTestId('board')).toHaveAttribute('data-capturing', 'false');
  });
});
