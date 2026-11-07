/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { COLOR_THEMES } from '../../engine/constants';
import { Player, PlayerColor } from '../../engine/types';

interface CornerPlayerPodProps {
  player: Player;
  isActive: boolean;
  diceValue: number | null;
  isRolling: boolean;
  canRoll: boolean;
  onRoll: () => void;
  consecutiveSixes?: number;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  coins?: number;
  gems?: number;
  onDiceClickDuringMove?: () => void;
  isLocalPlayer?: boolean;
  teamLabel?: string;
}

/**
 * Short label for a player: "You (Captain)" -> "You", "Bot GREEN (Aggressive)" -> "Bot GREEN"
 */
export function shortPlayerName(name: string): string {
  return name.replace(/\s*[([].*[)\]]$/, '').trim() || name;
}

// 3x3 dot coordinates (1..6)
const DICE_DOTS: Record<number, Array<{ col: number; row: number }>> = {
  1: [{ col: 2, row: 2 }],
  2: [
    { col: 1, row: 1 },
    { col: 3, row: 3 },
  ],
  3: [
    { col: 1, row: 1 },
    { col: 2, row: 2 },
    { col: 3, row: 3 },
  ],
  4: [
    { col: 1, row: 1 },
    { col: 3, row: 1 },
    { col: 1, row: 3 },
    { col: 3, row: 3 },
  ],
  5: [
    { col: 1, row: 1 },
    { col: 3, row: 1 },
    { col: 2, row: 2 },
    { col: 1, row: 3 },
    { col: 3, row: 3 },
  ],
  6: [
    { col: 1, row: 1 },
    { col: 3, row: 1 },
    { col: 1, row: 2 },
    { col: 3, row: 2 },
    { col: 1, row: 3 },
    { col: 3, row: 3 },
  ],
};

// Avatar artwork matching the reference screenshot
const AVATAR_DATA: Record<
  PlayerColor,
  { icon: string; flag?: string; defaultName: string; defaultCoins: number }
> = {
  red: { icon: '👦🏽', flag: '💎', defaultName: 'ClayCannon', defaultCoins: 650 },
  green: { icon: '🐯', flag: 'India 🇮🇳', defaultName: 'Mr / 800', defaultCoins: 1162 },
  yellow: { icon: '🏎️', flag: '⚡', defaultName: 'Alianza', defaultCoins: 1600 },
  blue: { icon: '🧑🏽', flag: '👑', defaultName: 'Soyeb', defaultCoins: 1000 },
};

export const CornerPlayerPod: React.FC<CornerPlayerPodProps> = ({
  player,
  isActive,
  diceValue,
  isRolling,
  canRoll,
  onRoll,
  consecutiveSixes = 0,
  position,
  coins,
  gems,
  onDiceClickDuringMove,
  isLocalPlayer = false,
  teamLabel,
}) => {
  const theme = COLOR_THEMES[player.color];
  const avatar = AVATAR_DATA[player.color];

  // Rapidly cycle random faces while rolling so the dice is visibly tumbling
  const [justLanded, setJustLanded] = useState(false);

  useEffect(() => {
    if (isRolling) {
      setJustLanded(false);
    } else if (diceValue !== null) {
      setJustLanded(true);
      const timer = setTimeout(() => setJustLanded(false), 380);
      return () => clearTimeout(timer);
    }
  }, [isRolling, diceValue]);

  // Layout alignment
  const isDiceOnLeft = position === 'top-right' || position === 'bottom-right';

  // Before a roll there is no value yet, so the die shows blank instead of a fake 6
  const showBlankFace = !isRolling && diceValue === null;
  const displayDice = diceValue ?? 1;
  const coinCount = coins ?? avatar.defaultCoins;

  const renderDots = (value: number) => (
    <div className="dice-pips">
      {[1, 2, 3].map((row) =>
        [1, 2, 3].map((col) => {
          const hasDot = (DICE_DOTS[value] || DICE_DOTS[1]).some(
            (dot) => dot.col === col && dot.row === row
          );
          return (
            <span key={`${value}-${row}-${col}`}>
              {hasDot && <i className={player.color === 'yellow' ? 'dice-pip dice-pip-dark' : 'dice-pip'} />}
            </span>
          );
        })
      )}
    </div>
  );

  // If player is inactive in 1v1 mode, render a clean muted socket
  if (player.isActiveInMatch === false) {
    return (
      <div className="flex flex-col items-center select-none opacity-35 pointer-events-none">
        <div className="p-1 rounded-2xl border border-slate-700 bg-slate-900/50 shadow flex items-center justify-center w-28 sm:w-32 h-14">
          <span className="text-[10px] font-mono font-bold text-slate-400">1v1 Inactive</span>
        </div>
      </div>
    );
  }

  // The dice is the only tap target. Tapping it rolls when allowed, otherwise it may move.
  // (The pod wrapper has no click handler, so one tap fires exactly one action.)
  const handleInteractiveClick = () => {
    if (isRolling) return;
    if (canRoll) {
      onRoll();
    } else {
      onDiceClickDuringMove?.();
    }
  };

  // 1. The Dice Compartment (Active 3D Colored Dice or Inactive Tray Socket)
  const diceCompartment = (
    <div className="relative w-12 h-12 sm:w-14 sm:h-14 shrink-0 flex items-center justify-center">
      {isActive ? (
        /* Active Player's 3D Colored Dice */
        <div
          onClick={handleInteractiveClick}
          className={`dice-cube-shell w-full h-full rounded-xl border-2 select-none touch-manipulation relative cursor-pointer ${
            canRoll && !isRolling
              ? 'hover:scale-105 active:scale-90 shadow-lg shadow-amber-400/50 animate-pulse'
              : ''
          }`}
          style={{
            backgroundColor: theme.primary,
            borderColor: '#FFFFFF',
            boxShadow: `0 4px 14px ${theme.glow}, 0 0 10px rgba(255,255,255,0.45)`,
            '--dice-face-color': theme.primary,
          } as React.CSSProperties & { '--dice-face-color': string }}
          role="button"
          tabIndex={0}
          aria-label={`${player.name} dice ${showBlankFace ? 'not rolled yet' : `showing ${displayDice}`}. ${canRoll ? 'Tap to roll' : ''}`}
        >
          <div
            className={`dice-cube ${showBlankFace ? 'dice-cube-blank' : ''} ${isRolling ? 'animate-dice-roll' : justLanded ? 'animate-dice-land' : ''}`}
            data-value={displayDice}
            aria-hidden="true"
          >
            <div className="dice-face dice-face-front">{renderDots(1)}</div>
            <div className="dice-face dice-face-back">{renderDots(6)}</div>
            <div className="dice-face dice-face-right">{renderDots(3)}</div>
            <div className="dice-face dice-face-left">{renderDots(4)}</div>
            <div className="dice-face dice-face-top">{renderDots(2)}</div>
            <div className="dice-face dice-face-bottom">{renderDots(5)}</div>
          </div>

          {/* Roll prompt ripple indicator when waiting for roll */}
          {canRoll && !isRolling && (
            <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-amber-400 border-2 border-white animate-ping pointer-events-none" />
          )}

          <span className="dice-gloss" />
        </div>
      ) : (
        /* Inactive Dice Tray Socket (Glossy socket matching uploaded screenshot) */
        <div className="w-full h-full rounded-xl bg-slate-900/60 border-2 border-slate-600/70 shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)] flex items-center justify-center">
          <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-md border border-slate-600 bg-slate-800/60" />
        </div>
      )}
    </div>
  );

  // 2. The Avatar Compartment (Framed Character + Name Banner + Flag)
  const avatarCompartment = (
    <div className="relative w-12 h-12 sm:w-14 sm:h-14 shrink-0 rounded-xl overflow-hidden bg-gradient-to-b from-slate-900 to-[#072468] border border-sky-400/50 shadow-inner flex flex-col items-center justify-center">
      {/* Flag / Header Tag at top */}
      {avatar.flag && (
        <span className="absolute top-0.5 inset-x-0 text-[8px] sm:text-[9px] font-bold text-center z-10 leading-none text-sky-200 truncate px-0.5 pointer-events-none">
          {avatar.flag}
        </span>
      )}

      {/* 3D Character Avatar Art */}
      <div className="text-xl sm:text-2xl select-none mt-1 pointer-events-none">{avatar.icon}</div>

      {/* Name Banner at bottom */}
      <div className="absolute bottom-0 inset-x-0 bg-[#004ECC] text-[8px] sm:text-[9px] font-extrabold text-white text-center py-0.5 truncate px-0.5 border-t border-sky-400/60 shadow pointer-events-none">
        {shortPlayerName(player.name) || avatar.defaultName}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col items-center select-none">
      {/* Coin counter badge above pod (for top row) */}
      {(position === 'top-left' || position === 'top-right') && (
        <div className="flex items-center gap-1 text-[10px] sm:text-xs font-black font-mono text-[#FFD200] drop-shadow mb-0.5">
          <span>🪙</span>
          <span>{coinCount.toLocaleString()}</span>
        </div>
      )}

      {/* The Iconic Blue Pod Frame with Gold Trim matching screenshot 100% */}
      <div
        className={`relative p-1 rounded-2xl transition-all duration-200 border-[2.5px] ${
          isActive
            ? 'bg-gradient-to-b from-[#0066FF] to-[#003EA8] border-[#FFD200] shadow-xl ring-2 ring-[#FFD200]/70 scale-[1.02]'
            : 'bg-gradient-to-b from-[#0B4DB2] to-[#063278] border-[#0A5AE6] opacity-[0.92]'
        }`}
        style={{
          boxShadow: isActive ? `0 0 18px ${theme.glow}, 0 4px 12px rgba(0,0,0,0.6)` : undefined,
        }}
      >
        <div className="flex items-center gap-1">
          {isDiceOnLeft ? (
            <>
              {diceCompartment}
              {avatarCompartment}
            </>
          ) : (
            <>
              {avatarCompartment}
              {diceCompartment}
            </>
          )}
        </div>

        {/* Consecutive 6s badge */}
        {isActive && consecutiveSixes > 0 && (
          <div className="absolute -bottom-2 inset-x-0 flex justify-center z-10 pointer-events-none">
            <span className="text-[8px] font-mono font-black px-1.5 py-0.5 rounded-full bg-[#FFD200] text-slate-950 shadow-md">
              {consecutiveSixes}/3 6s
            </span>
          </div>
        )}
      </div>

      <div className={`mt-1 flex ${teamLabel ? 'max-w-[156px] bg-slate-950/90 px-2' : 'max-w-[132px] bg-slate-950/75 px-1.5'} flex-col items-center rounded-lg border border-sky-200/30 py-1 text-center shadow-sm`}>
        <div className="flex max-w-full items-center justify-center gap-1">
          <span className={`${teamLabel ? 'max-w-[112px]' : 'max-w-[92px]'} truncate text-[10px] font-black leading-tight text-white`}>{player.name}</span>
          {isLocalPlayer && <span className="shrink-0 rounded bg-amber-400 px-1 py-0.5 text-[8px] font-black leading-none text-slate-950">YOU</span>}
        </div>
        <span className={`text-[9px] font-bold uppercase leading-tight ${teamLabel ? 'text-sky-100' : 'text-sky-200'}`}>
          {teamLabel ? `${theme.name} player · ${teamLabel}` : theme.name}
        </span>
      </div>

      {/* Coin & Gem counters below pod (for bottom row) */}
      {(position === 'bottom-left' || position === 'bottom-right') && (
        <div className="flex flex-col items-center mt-0.5">
          <div className="flex items-center gap-1 text-[10px] sm:text-xs font-black font-mono text-[#FFD200] drop-shadow">
            <span>🪙</span>
            <span>{coinCount.toLocaleString()}</span>
          </div>
          {position === 'bottom-left' && gems !== undefined && (
            <div className="flex items-center gap-1 text-[9px] font-bold font-mono text-sky-300">
              <span>💎</span>
              <span>{gems}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
