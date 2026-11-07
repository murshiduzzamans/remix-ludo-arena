/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { COLOR_THEMES } from '../../engine/constants';
import { GameLogEntry } from '../../engine/types';

interface GameLogProps {
  entries: GameLogEntry[];
}

export const GameLog: React.FC<GameLogProps> = ({ entries }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length]);

  return (
    <div className="flex flex-col h-44 sm:h-52 rounded-xl bg-slate-900/80 border border-slate-800 p-2.5">
      <div className="flex items-center justify-between pb-2 border-b border-slate-800/80 mb-2">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
          Match Commentary
        </span>
        <span className="text-[11px] font-mono text-slate-500">
          {entries.length} actions
        </span>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-1.5 pr-1 text-xs select-none"
      >
        {entries.map((entry) => {
          const theme = COLOR_THEMES[entry.color];
          const isCapture = entry.type === 'capture';
          const isFinish = entry.type === 'finish';

          return (
            <div
              key={entry.id}
              className={`p-1.5 rounded-lg transition-colors flex items-start gap-2 ${
                isCapture
                  ? 'bg-red-950/40 border border-red-500/30'
                  : isFinish
                  ? 'bg-amber-950/40 border border-amber-500/30'
                  : 'bg-slate-950/40'
              }`}
            >
              {/* Color Dot Indicator */}
              <span
                className="w-2 h-2 rounded-full mt-1 shrink-0"
                style={{ backgroundColor: theme.primary }}
              />

              <div className="flex-1 leading-snug">
                <span
                  className={
                    isCapture
                      ? 'text-red-300 font-semibold'
                      : isFinish
                      ? 'text-amber-300 font-semibold'
                      : 'text-slate-300'
                  }
                >
                  {entry.message}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
