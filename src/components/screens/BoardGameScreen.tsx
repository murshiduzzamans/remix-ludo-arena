/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ArrowLeft, RotateCw, Volume2, VolumeX } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { sound } from '../../audio/soundEffects';
import { chooseBotMove } from '../../engine/botEngine';
import { COLOR_TEAMS } from '../../engine/constants';
import { applyMove, createDiceSource, createInitialGameState, getAutomaticMove, passTurn, rollDice } from '../../engine/gameEngine';
import { getMoveDestination } from '../../engine/rules';
import { getStepPath } from '../../engine/boardCoordinates';
import {
  BotPersonality,
  GameMode,
  GameRules,
  GameState,
  PlayerColor,
} from '../../engine/types';
import { recordMatchOutcomeResilient } from '../../storage/profileStore';
import { useGameTimer } from '../../hooks/useGameTimer';
import type { OnlineRoomConnection, RoomEvent } from '../../network/onlineClient';
import { AnimatingTokenInfo, LudoBoard } from '../board/LudoBoard';
import { CornerPlayerPod, shortPlayerName } from '../game/CornerPlayerPod';
import { ResultsModal } from './ResultsModal';

interface BoardGameScreenProps {
  initialMode: GameMode;
  humanColor?: PlayerColor;
  botPersonalities?: Record<PlayerColor, BotPersonality>;
  rules?: GameRules;
  onlineSession?: OnlineRoomConnection;
  onExit: () => void;
  onBackToRoom?: () => void;
}

interface CornerLayout {
  topLeft: PlayerColor;
  topRight: PlayerColor;
  bottomLeft: PlayerColor;
  bottomRight: PlayerColor;
}

const CORNER_LAYOUTS_BY_ROTATION: Record<number, CornerLayout> = {
  0: { topLeft: 'red', topRight: 'green', bottomLeft: 'blue', bottomRight: 'yellow' },
  90: { topLeft: 'blue', topRight: 'red', bottomLeft: 'yellow', bottomRight: 'green' },
  180: { topLeft: 'yellow', topRight: 'blue', bottomLeft: 'green', bottomRight: 'red' },
  270: { topLeft: 'green', topRight: 'yellow', bottomLeft: 'red', bottomRight: 'blue' },
};

const NOMINAL_ROTATION_MAP: Record<PlayerColor, number> = {
  blue: 0,
  yellow: 90,
  green: 180,
  red: 270,
};

// Timing (ms)
const ROLL_MS = 500; // dice tumble before the result lands
const STEP_MS = 220; // let each one-square hop finish before the next begins
const LAND_PAUSE_MS = 120; // short pause on the final square before the move commits
const BOT_ROLL_DELAY_MS = 650;
const BOT_MOVE_DELAY_MS = 700;
const AUTO_PASS_MS = 950;
const AUTO_MOVE_DELAY_MS = 450;

function getNextContinuousRotation(currentDegrees: number, targetColor: PlayerColor): number {
  const targetNominal = NOMINAL_ROTATION_MAP[targetColor];
  let delta = (targetNominal - (currentDegrees % 360)) % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return currentDegrees + delta;
}

function createLocalGame(
  mode: GameMode,
  humanColor: PlayerColor,
  botPersonalities?: Partial<Record<PlayerColor, BotPersonality>>,
  rules?: GameRules
): GameState {
  const seed = crypto.randomUUID();
  return createInitialGameState({ id: `local-${seed}`, seed, mode, humanColor, botPersonalities, customRules: rules });
}

export const BoardGameScreen: React.FC<BoardGameScreenProps> = ({
  initialMode,
  humanColor = 'red',
  botPersonalities,
  rules,
  onlineSession,
  onExit,
  onBackToRoom,
}) => {
  const [gameState, setGameState] = useState<GameState>(() =>
    onlineSession?.currentGameState ?? createLocalGame(initialMode, humanColor, botPersonalities, rules)
  );

  const [autoOrient, setAutoOrient] = useState(true);
  const [boardRotation, setBoardRotation] = useState(
    () => NOMINAL_ROTATION_MAP[initialMode === 'pass_and_play' ? 'red' : humanColor] ?? 270
  );
  const [isSoundMuted, setIsSoundMuted] = useState(() => sound.getMuted());
  const [isRolling, setIsRolling] = useState(false);
  const [animatingToken, setAnimatingToken] = useState<AnimatingTokenInfo | null>(null);
  const [onlineConnected, setOnlineConnected] = useState(Boolean(onlineSession));
  const [onlineError, setOnlineError] = useState('');
  const [turnSecondsRemaining, setTurnSecondsRemaining] = useState<number | null>(() => onlineSession ? 30 : null);
  const [roomSnapshot, setRoomSnapshot] = useState(() => onlineSession?.currentRoom ?? null);

  // Refs let timers and handlers read the latest state instead of a stale closure,
  // and let us cancel every pending timer on rematch or unmount.
  const stateRef = useRef(gameState);
  const rollingRef = useRef(false);
  const movingRef = useRef(false);
  const matchStartRef = useRef(Date.now());
  const matchRecordedRef = useRef(false);
  const sixesRolledRef = useRef(0);
  const { start: startTimer, cancelTimer, cancelAll: cancelAllTimers } = useGameTimer();

  useEffect(() => {
    stateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    if (!onlineSession) return;
    return onlineSession.subscribe((event: RoomEvent) => {
      if (event.type === 'game') {
        const previousState = stateRef.current;
        const movedToken = event.state.players.flatMap((player) => {
          const previousPlayer = previousState.players.find((item) => item.color === player.color);
          if (!previousPlayer) return [];
          return player.tokens.flatMap((token) => {
            const previousToken = previousPlayer.tokens.find((item) => item.index === token.index);
            return previousToken && token.stepCount > previousToken.stepCount
              ? [{ color: player.color, tokenIndex: token.index, fromStep: previousToken.stepCount, toStep: token.stepCount }]
              : [];
          });
        })[0];

        setOnlineError('');
        setTurnSecondsRemaining(event.turnTimeRemainingSeconds);
        stateRef.current = event.state;
        setGameState(event.state);
        setIsRolling(false);
        rollingRef.current = false;

        if (movedToken) {
          const steps = Array.from(
            { length: movedToken.toStep - movedToken.fromStep },
            (_, index) => movedToken.fromStep + index + 1
          );
          movingRef.current = true;
          setAnimatingToken({
            color: movedToken.color,
            tokenIndex: movedToken.tokenIndex,
            currentStep: steps[0],
            isHopping: true,
          });
          let stepIndex = 1;
          const animateNextStep = () => {
            if (stepIndex >= steps.length) {
              setAnimatingToken(null);
              movingRef.current = false;
              return;
            }
            setAnimatingToken({
              color: movedToken.color,
              tokenIndex: movedToken.tokenIndex,
              currentStep: steps[stepIndex],
              isHopping: true,
            });
            stepIndex += 1;
            startTimer(animateNextStep, STEP_MS);
          };
          startTimer(animateNextStep, STEP_MS);
        } else {
          setAnimatingToken(null);
          movingRef.current = false;
        }
      } else if (event.type === 'room') {
        setRoomSnapshot(event.room);
        if (!event.room.isMatchInProgress && stateRef.current.phase === 'game_over') {
          onBackToRoom?.();
        }
      } else if (event.type === 'error') {
        setOnlineError(event.message);
        setIsRolling(false);
        rollingRef.current = false;
        movingRef.current = false;
      } else if (event.type === 'connection') {
        setOnlineConnected(event.connected);
        if (event.connected) setOnlineError('');
      } else if (event.type === 'timeout') {
        const timedOutPlayer = stateRef.current.players.find((player) => player.color === event.color);
        setOnlineError(`${timedOutPlayer?.name ?? event.color} timed out. Their turn was skipped.`);
      }
    });
  }, [onlineSession, onBackToRoom]);

  useEffect(() => {
    if (!onlineSession || !onlineConnected) return;
    const timer = window.setInterval(() => {
      setTurnSecondsRemaining((seconds) => seconds === null ? null : Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [onlineSession, onlineConnected]);

  // Track sixes rolled during the match for stats
  useEffect(() => {
    if (gameState.diceValue === 6) {
      sixesRolledRef.current += 1;
    }
  }, [gameState.diceValue]);

  const matchIdRef = useRef(gameState.id);
  useEffect(() => {
    if (matchIdRef.current === gameState.id) return;
    matchIdRef.current = gameState.id;
    matchStartRef.current = Date.now();
    matchRecordedRef.current = false;
    sixesRolledRef.current = 0;
  }, [gameState.id]);

  const currentPlayer = gameState.players.find((p) => p.color === gameState.currentTurnColor)!;
  // Pass & play: every seat is local, so the local side always controls the turn
  const humanControlsTurn = onlineSession
    ? currentPlayer.color === onlineSession.localColor
    : !currentPlayer.isBot;

  const cancelAllTimersAndRefs = () => {
    cancelAllTimers();
    rollingRef.current = false;
    movingRef.current = false;
  };

  // Stop all pending timers when leaving the screen
  useEffect(() => cancelAllTimersAndRefs, []);

  // Smooth continuous rotation: keeps the controlling colour at the bottom
  useEffect(() => {
    if (!autoOrient) return;
    const targetBottomColor =
      gameState.mode === 'pass_and_play' ? gameState.currentTurnColor : humanColor;
    setBoardRotation((current) => getNextContinuousRotation(current, targetBottomColor));
  }, [gameState.currentTurnColor, gameState.mode, humanColor, autoOrient]);

  const toggleSound = () => {
    const nextVal = !isSoundMuted;
    setIsSoundMuted(nextVal);
    sound.setMuted(nextVal);
    sound.triggerHaptic(15);
  };

  // Roll the dice (human or bot). Ignored unless it is a rolling phase and nothing else is busy.
  const performRoll = () => {
    const s = stateRef.current;
    if (s.phase !== 'rolling' || rollingRef.current || movingRef.current) return;

    rollingRef.current = true;
    setOnlineError('');
    setIsRolling(true);
    sound.playDiceRoll();

    if (onlineSession) {
      onlineSession.rollDice();
      return;
    }

    startTimer(() => {
      rollingRef.current = false;
      setGameState((prev) => {
        const result = rollDice(prev, createDiceSource(`${prev.seed}:${prev.rngState}`)());
        return result.ok ? result.state : prev;
      });
      setIsRolling(false);
    }, ROLL_MS);
  };

  // Hop a token square by square, then commit the move to the engine.
  const playMove = (tokenIndex: number, tokenColor?: PlayerColor) => {
    const s = stateRef.current;
    if (s.phase !== 'moving' || movingRef.current || rollingRef.current) return;

    const move = s.legalMoves.find((m) => m.tokenIndex === tokenIndex && (!tokenColor || (m.tokenColor ?? s.currentTurnColor) === tokenColor));
    if (!move) return;

    if (onlineSession) {
      movingRef.current = true;
      setOnlineError('');
      onlineSession.selectMove(tokenIndex, tokenColor);
      return;
    }

    const color = move.tokenColor ?? s.currentTurnColor;
    // Yard deployment is one placement onto step 0. Otherwise animate exactly
    // one square for each pip in the roll, including the home stretch.
    const diceValue = s.diceValue;
    if (diceValue === null) return;
    const destination = getMoveDestination(move.fromStep, diceValue, move.isExitYard);
    const path = getStepPath(color, move.fromStep, destination, tokenIndex);
    // getStepPath returns destination squares only for track/home movement,
    // but includes the yard position for a yard exit. Keep those path shapes
    // distinct so the last destination is not dropped before the move commits.
    const steps = move.isExitYard
      ? [0]
      : Array.from({ length: path.length }, (_, index) => move.fromStep + index + 1);
    if (steps[steps.length - 1] !== move.toStep) return;

    movingRef.current = true;
    let index = 0;

    const hop = () => {
      if (index < steps.length) {
        const currentStep = steps[index];
        index += 1;
        setAnimatingToken({ color, tokenIndex, currentStep, isHopping: true });
        sound.playMove();
        startTimer(hop, STEP_MS);
        return;
      }

      startTimer(() => {
        if (move.willCaptureTokens.length > 0) {
          sound.playCapture();
        } else if (move.isFinish) {
          sound.playHomeFinish();
        }
        setGameState((prev) => {
          const result = applyMove(prev, { actorColor: s.currentTurnColor, tokenIndex, tokenColor });
          return result.ok ? result.state : prev;
        });
        setAnimatingToken(null);
        movingRef.current = false;
      }, LAND_PAUSE_MS);
    };

    hop();
  };

  // A tap on a token. Bots move themselves, so taps during their turn are ignored.
  const handleTokenTap = (tokenIndex: number, tokenColor?: PlayerColor) => {
    const s = stateRef.current;
    const turn = s.players.find((p) => p.color === s.currentTurnColor);
    if (!turn || (onlineSession ? turn.color !== onlineSession.localColor : turn.isBot)) return;
    playMove(tokenIndex, tokenColor);
  };

  // A tap on the active dice only rolls; moving tokens are selected on the board.
  const handleDiceTap = () => {
    const s = stateRef.current;
    const turn = s.players.find((p) => p.color === s.currentTurnColor);
    if (!turn || (onlineSession ? turn.color !== onlineSession.localColor : turn.isBot)) return;

    if (s.phase === 'rolling') {
      performRoll();
    }
  };

  // Bot turns: roll, then choose and play a move
  useEffect(() => {
    if (onlineSession) return;
    if (gameState.phase === 'game_over' || animatingToken !== null || isRolling) return;
    if (!currentPlayer.isBot) return;

    let botDecisionTimer: number | undefined;
    if (gameState.phase === 'rolling') {
      botDecisionTimer = startTimer(performRoll, BOT_ROLL_DELAY_MS);
    } else if (gameState.phase === 'moving' && gameState.legalMoves.length > 0) {
      botDecisionTimer = startTimer(() => {
        const s = stateRef.current;
        const turn = s.players.find((p) => p.color === s.currentTurnColor)!;
        const chosen = chooseBotMove(s.legalMoves, turn, s.players, s.rules, s.isTeamMode, createDiceSource(`${s.seed}:${s.nextEventId}`));
        if (chosen) playMove(chosen.tokenIndex, chosen.tokenColor);
      }, BOT_MOVE_DELAY_MS);
    }

    return () => {
      if (botDecisionTimer !== undefined) cancelTimer(botDecisionTimer);
    };
  }, [
    gameState.phase,
    gameState.currentTurnColor,
    gameState.legalMoves.length,
    currentPlayer.isBot,
    animatingToken,
    isRolling,
    onlineSession,
  ]);

  // Auto-play a unique non-six move for every human seat, including online rooms.
  // A six always stays a deliberate choice because deploying from the yard may
  // compete with advancing an already deployed pawn.
  useEffect(() => {
    if (gameState.phase !== 'moving' || !humanControlsTurn || animatingToken !== null || isRolling || movingRef.current) {
      return;
    }

    const automaticMove = getAutomaticMove(gameState);
    if (!automaticMove) return;

    const autoMoveTimer = startTimer(
      () => playMove(automaticMove.tokenIndex, automaticMove.tokenColor),
      AUTO_MOVE_DELAY_MS
    );
    return () => cancelTimer(autoMoveTimer);
  }, [gameState, humanControlsTurn, animatingToken, isRolling, onlineSession]);

  // No legal moves: pass the turn after a short pause so the roll can be seen
  useEffect(() => {
    if (onlineSession) return;
    if (gameState.phase !== 'moving' || gameState.legalMoves.length > 0 || animatingToken !== null) {
      return;
    }
    const autoPassTimer = startTimer(() => {
      setGameState((prev) => {
        const result = passTurn(prev);
        return result.ok ? result.state : prev;
      });
    }, AUTO_PASS_MS);

    return () => cancelTimer(autoPassTimer);
  }, [gameState.phase, gameState.legalMoves.length, animatingToken, onlineSession]);

  // Record the result once per match
  useEffect(() => {
    if (gameState.phase !== 'game_over' || matchRecordedRef.current) return;
    matchRecordedRef.current = true;

    // Local multiplayer has no single player to credit
    if (gameState.mode === 'pass_and_play') return;

    const human = onlineSession
      ? gameState.players.find((p) => p.color === onlineSession.localColor)
      : gameState.players.find((p) => !p.isBot);
    if (!human) return;

    const isVictory = gameState.isTeamMode
      ? gameState.winningTeam === human.teamId
      : gameState.winnerColor === human.color;

    // Place: victory is 1st; otherwise 1 + the number of rivals who finished ahead of the human
    const rivalsAhead = gameState.players.filter(
      (p) =>
        p.color !== human.color &&
        p.isActiveInMatch !== false &&
        !(gameState.isTeamMode && p.teamId === human.teamId) &&
        (p.hasWon || p.tokensFinished > human.tokensFinished)
    ).length;

    recordMatchOutcomeResilient({
      id: gameState.id,
      matchId: gameState.id,
      timestamp: Date.now(),
      mode: gameState.mode,
      playerColor: human.color,
      outcome: isVictory ? 'victory' : 'defeat',
      place: isVictory ? 1 : rivalsAhead + 1,
      captures: human.captures,
      tokensHome: human.tokensFinished,
      sixesRolled: sixesRolledRef.current,
      durationSeconds: Math.max(10, Math.round((Date.now() - matchStartRef.current) / 1000)),
    });
  }, [gameState, onlineSession]);

  const handleRematch = () => {
    if (onlineSession) {
      onlineSession.requestRematch();
      return;
    }
    cancelAllTimersAndRefs();
    setAnimatingToken(null);
    setIsRolling(false);
    matchRecordedRef.current = false;
    matchStartRef.current = Date.now();
    sixesRolledRef.current = 0;
    setGameState(createLocalGame(initialMode, humanColor, botPersonalities, rules));
  };

  const isRoomHost = roomSnapshot?.participants.find(
    (participant) => participant.id === onlineSession?.participantId
  )?.isHost ?? false;
  const rematchRequests = roomSnapshot?.rematchRequests ?? [];
  const rematchRequested = rematchRequests.includes(onlineSession?.participantId ?? '');
  const connectedHumanCount = roomSnapshot?.participants.filter(
    (participant) => !participant.isBot && participant.isConnected
  ).length ?? 0;
  const handleExitResults = () => {
    if (onlineSession && isRoomHost) {
      onlineSession.backToLobby();
      return;
    }
    onExit();
  };

  // Normalize board rotation to [0, 90, 180, 270] to look up the corner layout
  const normalizedRotation = ((Math.round(boardRotation) % 360) + 360) % 360;
  const layout = CORNER_LAYOUTS_BY_ROTATION[normalizedRotation] || CORNER_LAYOUTS_BY_ROTATION[0];

  const turnLabel = shortPlayerName(currentPlayer.name);

  // One line telling the local player what to do right now
  const statusText = (() => {
    if (gameState.phase === 'game_over') return '';
    if (onlineSession && onlineError) return onlineError;
    if (onlineSession && !onlineConnected) return 'Reconnecting to your friends…';
    if (isRolling) return humanControlsTurn ? 'Rolling…' : `${turnLabel} is rolling…`;
    if (animatingToken !== null) return `${turnLabel} is moving…`;
    if (!humanControlsTurn) return currentPlayer.isBot ? `${turnLabel} is thinking…` : `${turnLabel}'s turn`;
    if (gameState.phase === 'rolling') return `${turnLabel}: tap the dice to roll`;
    if (gameState.legalMoves.length === 0) return `No legal move with ${gameState.diceValue}. Passing…`;
    return gameState.legalMoves.length === 1
      ? `${turnLabel}: tap the glowing token or the dice`
      : `${turnLabel}: tap a glowing token to move`;
  })();

  const renderCornerPod = (
    color: PlayerColor,
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  ) => {
    const player = gameState.players.find((p) => p.color === color);
    if (!player) return null;

    const isPlayerActive = gameState.currentTurnColor === color;
    const isCurrentHuman = onlineSession
      ? player.color === onlineSession.localColor
      : !player.isBot;

    let coins = 1000;
    let gems: number | undefined = undefined;
    if (color === 'red') coins = 650;
    else if (color === 'green') coins = 1162;
    else if (color === 'yellow') coins = 1600;
    else if (color === 'blue') {
      coins = 1000;
      if (position === 'bottom-left' || position === 'bottom-right') gems = 50;
    }

    return (
      <CornerPlayerPod
        key={color}
        player={player}
        isActive={isPlayerActive}
        diceValue={gameState.diceValue}
        isRolling={isRolling && isPlayerActive}
        canRoll={
          isCurrentHuman &&
          isPlayerActive &&
          gameState.phase === 'rolling' &&
          !isRolling &&
          animatingToken === null
        }
        onRoll={handleDiceTap}
        onDiceClickDuringMove={handleDiceTap}
        consecutiveSixes={isPlayerActive ? gameState.consecutiveSixes : 0}
        position={position}
        coins={coins}
        gems={gems}
        isLocalPlayer={Boolean(onlineSession && player.color === onlineSession.localColor)}
        teamLabel={gameState.isTeamMode && player.teamId ? (player.teamId === 'team_A' ? 'Team A' : 'Team B') : undefined}
      />
    );
  };

  return (
    <div
      className="w-full min-h-[100dvh] flex flex-col justify-center gap-1 py-2 px-2 select-none"
      style={{
        backgroundColor: '#092569',
        backgroundImage: `
          radial-gradient(circle at 50% 20%, rgba(20, 80, 200, 0.45) 0%, transparent 60%),
          repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.02) 0px, rgba(255, 255, 255, 0.02) 20px, transparent 20px, transparent 40px)
        `,
      }}
    >
      {/* Header: exit, mode and turn, rotate and sound */}
      <header className="w-full max-w-[460px] mx-auto flex items-center justify-between px-2 py-1">
        <div className="flex items-center gap-2">
          <button
            onClick={onExit}
            className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl bg-[#004ECC]/70 hover:bg-[#004ECC] text-white border border-sky-400/40 shadow-md cursor-pointer active:scale-95 transition-all"
            aria-label="Back to lobby"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-950/70 border border-sky-400/40 text-xs font-mono font-bold text-sky-300 shadow">
            <span>💎</span>
            <span>50</span>
          </div>
        </div>

        <div className="flex flex-col items-center">
          <span className="text-[11px] font-black uppercase tracking-wider text-[#FFD200] drop-shadow">
            {gameState.mode === 'head_to_head_1v1'
              ? '1V1 HEAD-TO-HEAD DUEL'
              : gameState.mode === 'team_2v2'
              ? '2V2 TEAM BATTLE'
              : gameState.mode === 'pass_and_play'
              ? 'LOCAL MULTIPLAYER'
              : 'CLASSIC LUDO'}
          </span>
          <span className="text-[11px] font-bold text-sky-200">
            Turn: {turnLabel}
            {gameState.isTeamMode && COLOR_TEAMS[currentPlayer.color] === 'team_A' ? ' · Alpha' : ''}
            {gameState.isTeamMode && COLOR_TEAMS[currentPlayer.color] === 'team_B' ? ' · Omega' : ''}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              setAutoOrient((prev) => !prev);
              sound.triggerHaptic(15);
            }}
            className={`min-h-[42px] px-2 flex items-center gap-1 rounded-xl border shadow-md cursor-pointer active:scale-95 transition-all text-[11px] font-bold ${
              autoOrient
                ? 'bg-[#004ECC] text-white border-sky-400'
                : 'bg-slate-800/80 text-slate-300 border-slate-600'
            }`}
            title={autoOrient ? 'Auto-rotate on: board turns to the current player' : 'Auto-rotate off: static board'}
            aria-label="Toggle auto rotate board"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{autoOrient ? 'Rotate: ON' : 'Rotate: OFF'}</span>
          </button>

          <button
            onClick={toggleSound}
            className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl bg-[#004ECC]/70 hover:bg-[#004ECC] text-white border border-sky-400/40 shadow-md cursor-pointer active:scale-95 transition-all"
            aria-label={isSoundMuted ? 'Unmute' : 'Mute'}
          >
            {isSoundMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Top player pods */}
      <div className="w-full max-w-[450px] mx-auto flex items-center justify-between px-2">
        {renderCornerPod(layout.topLeft, 'top-left')}
        {renderCornerPod(layout.topRight, 'top-right')}
      </div>

      {/* Board and status line */}
      <div className="relative w-full max-w-[450px] mx-auto flex flex-col items-center justify-center">
        <div className="w-full flex justify-center">
          <LudoBoard
            gameState={gameState}
            onTokenClick={handleTokenTap}
            interactiveColor={humanControlsTurn ? currentPlayer.color : null}
            animatingToken={animatingToken}
            rotationDegrees={boardRotation}
          />
        </div>
        <p
          className="mt-0.5 min-h-[1.25rem] text-center text-xs font-bold text-sky-100 drop-shadow"
          role="status"
          aria-live="polite"
        >
          {statusText}
          {onlineSession && humanControlsTurn && onlineConnected && turnSecondsRemaining !== null && gameState.phase !== 'game_over' && (
            <span className="ml-2 tabular-nums text-amber-200" aria-label={`${turnSecondsRemaining} seconds remaining`}>{turnSecondsRemaining}s</span>
          )}
        </p>
      </div>

      {/* Bottom player pods */}
      <div className="w-full max-w-[450px] mx-auto flex items-center justify-between px-2">
        {renderCornerPod(layout.bottomLeft, 'bottom-left')}
        {renderCornerPod(layout.bottomRight, 'bottom-right')}
      </div>

      {gameState.phase === 'game_over' && (
        <ResultsModal
          gameState={gameState}
          onRematch={handleRematch}
          onExitLobby={handleExitResults}
          isOnline={Boolean(onlineSession)}
          isRoomHost={isRoomHost}
          rematchRequested={rematchRequested}
          rematchRequestCount={rematchRequests.length}
          connectedHumanCount={connectedHumanCount}
          isConnected={onlineConnected}
          statusMessage={onlineError}
          showRematch
        />
      )}
    </div>
  );
};

