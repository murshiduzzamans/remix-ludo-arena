/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Leaderboard screen component
 */

import { useState, useEffect } from 'react';

interface LeaderboardEntry {
  userId: string;
  displayName: string;
  avatarId: number;
  level: number;
  wins: number;
  gamesPlayed: number;
  winRate: number;
}

export function LeaderboardScreen() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeaderboard();
  }, []);

  const fetchLeaderboard = async () => {
    try {
      const response = await fetch('/api/leaderboard?limit=20');
      if (response.ok) {
        const data = await response.json() as { leaderboard: LeaderboardEntry[] };
        setLeaderboard(data.leaderboard);
      }
    } catch (error) {
      console.error('Failed to fetch leaderboard:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-pulse text-white">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <button
            onClick={() => window.history.back()}
            className="text-slate-400 hover:text-white flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back
          </button>
        </div>

        <div className="bg-gradient-to-r from-amber-500 to-yellow-600 rounded-xl p-6 mb-6">
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <span>🏆</span>
            <span>Leaderboard</span>
          </h1>
          <p className="text-amber-100 mt-2">Top players ranked by wins</p>
        </div>

        <div className="space-y-2">
          {leaderboard.length === 0 ? (
            <div className="bg-slate-800 rounded-xl p-6 text-center text-slate-400">
              No players on the leaderboard yet. Be the first!
            </div>
          ) : (
            leaderboard.map((entry, index) => (
              <div
                key={entry.userId}
                className={`bg-slate-800 rounded-xl p-4 flex items-center gap-4 ${
                  index < 3 ? 'border-2' : ''
                } ${
                  index === 0 ? 'border-yellow-500' :
                  index === 1 ? 'border-slate-400' :
                  index === 2 ? 'border-amber-700' : ''
                }`}
              >
                <div className="w-12 text-center">
                  {index < 3 ? (
                    <span className="text-3xl">
                      {index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉'}
                    </span>
                  ) : (
                    <span className="text-2xl font-bold text-slate-600">
                      #{index + 1}
                    </span>
                  )}
                </div>
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xl font-bold">
                  {entry.displayName.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="font-bold text-white">{entry.displayName}</div>
                  <div className="text-sm text-slate-400">
                    Level {entry.level} • {entry.gamesPlayed} games
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold text-green-400">
                    {entry.wins}
                  </div>
                  <div className="text-xs text-slate-400">
                    {entry.winRate}% win rate
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
