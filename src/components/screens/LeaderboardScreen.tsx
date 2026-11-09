/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ArrowLeft, RefreshCw, Trophy } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { sound } from '../../audio/soundEffects';

interface LeaderboardEntry {
  userId: string;
  displayName: string;
  avatarId: number;
  level: number;
  wins: number;
  gamesPlayed: number;
  winRate: number;
}

interface LeaderboardScreenProps {
  onBack: () => void;
}

export const LeaderboardScreen: React.FC<LeaderboardScreenProps> = ({ onBack }) => {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaderboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/leaderboard?limit=20');
      if (response.ok) {
        const data = (await response.json()) as { leaderboard: LeaderboardEntry[] };
        setLeaderboard(data.leaderboard || []);
      } else {
        setError('Could not load leaderboard data.');
      }
    } catch {
      setError('Could not reach the server. Check your connection.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchLeaderboard();
  }, []);

  const handleBack = () => {
    sound.triggerHaptic(15);
    onBack();
  };

  return (
    <div
      className="w-full min-h-screen flex flex-col items-center justify-between py-0 px-0 select-none overflow-x-hidden"
      style={{
        backgroundColor: '#092569',
        backgroundImage: `
          radial-gradient(circle at 50% 30%, rgba(20, 80, 220, 0.45) 0%, transparent 70%),
          repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.02) 0px, rgba(255, 255, 255, 0.02) 24px, transparent 24px, transparent 48px)
        `,
      }}
    >
      {/* Header */}
      <header className="w-full bg-gradient-to-r from-[#0052CC] via-[#0066FF] to-[#0052CC] border-b-2 border-[#FFD200] shadow-lg px-3 py-1.5 flex items-center justify-between z-20">
        <button
          onClick={handleBack}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-[#003B99] border border-sky-400/50 shadow text-white hover:brightness-110 active:scale-95 transition-transform cursor-pointer"
          aria-label="Back to Lobby"
        >
          <ArrowLeft className="w-5 h-5 text-[#FFD200]" />
        </button>

        <div className="flex items-center gap-1.5 px-4 py-1 rounded-full bg-gradient-to-r from-[#FFD200] via-[#FFB800] to-[#FFA000] border border-yellow-300 shadow-md">
          <Trophy className="w-4 h-4 text-[#0B2A68]" />
          <span className="text-xs sm:text-sm font-black text-[#0B2A68] tracking-wider uppercase">
            LEADERBOARD
          </span>
        </div>

        <button
          onClick={() => void fetchLeaderboard()}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-[#003B99] border border-sky-400/50 shadow text-white hover:brightness-110 active:scale-95 transition-transform cursor-pointer"
          aria-label="Refresh Leaderboard"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 text-[#FFD200] ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {/* Main Content */}
      <div className="w-full max-w-[480px] mx-auto px-4 flex-1 flex flex-col py-4 space-y-3">
        <div className="text-center space-y-1">
          <h2 className="text-lg font-black text-[#FFD200] tracking-wide drop-shadow">
            HALL OF CHAMPIONS
          </h2>
          <p className="text-xs font-semibold text-sky-200">
            Top ranked players across all competitive matches
          </p>
        </div>

        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-16 space-y-3">
            <div className="w-10 h-10 border-4 border-[#FFD200] border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-bold text-sky-200">Loading champions…</span>
          </div>
        ) : error ? (
          <div className="rounded-2xl bg-rose-950/60 border border-rose-500/40 p-4 text-center space-y-2">
            <p className="text-xs font-bold text-rose-200">{error}</p>
            <button
              onClick={() => void fetchLeaderboard()}
              className="px-4 py-1.5 text-xs font-bold rounded-xl bg-rose-600 text-white hover:bg-rose-500"
            >
              Retry
            </button>
          </div>
        ) : leaderboard.length === 0 ? (
          <div className="rounded-2xl bg-[#022166]/80 border-2 border-sky-400/30 p-8 text-center space-y-2">
            <Trophy className="w-12 h-12 text-[#FFD200]/50 mx-auto" />
            <p className="text-sm font-bold text-sky-100">No champions ranked yet.</p>
            <p className="text-xs text-sky-300">Play competitive matches to claim the #1 spot!</p>
          </div>
        ) : (
          <div className="space-y-2 overflow-y-auto max-h-[70vh] pr-1">
            {leaderboard.map((entry, index) => (
              <div
                key={entry.userId}
                className={`rounded-2xl p-3 flex items-center gap-3 transition-all ${
                  index === 0
                    ? 'bg-gradient-to-r from-amber-500/20 via-yellow-500/10 to-amber-500/20 border-2 border-[#FFD200] shadow-lg'
                    : index === 1
                      ? 'bg-[#022166]/90 border border-slate-300/40'
                      : index === 2
                        ? 'bg-[#022166]/90 border border-amber-700/40'
                        : 'bg-[#022166]/70 border border-sky-400/20'
                }`}
              >
                <div className="w-8 text-center font-black text-sm">
                  {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}
                </div>
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 border border-white/20 flex items-center justify-center text-sm font-black text-white shadow">
                  {entry.displayName.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-xs sm:text-sm text-white truncate">
                    {entry.displayName}
                  </div>
                  <div className="text-[10px] text-sky-300">
                    Lvl {entry.level} • {entry.gamesPlayed} games
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-black text-emerald-400">
                    {entry.wins} {entry.wins === 1 ? 'win' : 'wins'}
                  </div>
                  <div className="text-[10px] text-sky-300">
                    {entry.winRate}% win rate
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
