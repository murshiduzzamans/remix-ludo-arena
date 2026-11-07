/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { COLOR_THEMES } from '../../engine/constants';
import { Player } from '../../engine/types';

interface PlayerSeatProps {
  player: Player;
  isActive: boolean;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

export const PlayerSeat: React.FC<PlayerSeatProps> = ({
  player,
  isActive,
}) => {
  const theme = COLOR_THEMES[player.color];
  const inYard = player.tokens.filter((t) => t.isInYard).length;
  const onTrack = player.tokens.filter((t) => !t.isInYard && !t.isHome).length;
  const homeCount = player.tokensFinished;

  return (
    <div
      className={`p-2.5 sm:p-3 rounded-xl border transition-all duration-200 select-none ${
        isActive
          ? 'bg-slate-900/95 border-amber-400 shadow-lg'
          : 'bg-slate-900/60 border-slate-800 opacity-90'
      }`}
      style={{
        boxShadow: isActive ? `0 0 16px ${theme.glow}` : undefined,
      }}
    >
      <div className="flex items-center gap-2.5">
        {/* Avatar Ring */}
        <div className="relative shrink-0">
          <div
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center font-bold text-white text-xs sm:text-sm border-2 shadow-inner"
            style={{
              backgroundColor: theme.primary,
              borderColor: isActive ? '#F59E0B' : theme.border,
            }}
          >
            {player.color.charAt(0).toUpperCase()}
          </div>
          {isActive && (
            <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-amber-400 border-2 border-slate-900 flex items-center justify-center" />
          )}
        </div>

        {/* Player Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 truncate">
            <span className="text-xs sm:text-sm font-bold text-slate-100 truncate">
              {player.name}
            </span>
            {player.isBot && player.botPersonality && (
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-amber-300 font-medium capitalize border border-slate-700">
                {player.botPersonality}
              </span>
            )}
          </div>

          {/* Tokens status counters */}
          <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400 font-mono">
            <span title="Tokens in Yard">Yard: {inYard}</span>
            <span>·</span>
            <span title="Tokens on Track">Track: {onTrack}</span>
            <span>·</span>
            <span
              className="font-bold text-amber-400"
              title="Tokens Finished"
            >
              Home: {homeCount}/4
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
