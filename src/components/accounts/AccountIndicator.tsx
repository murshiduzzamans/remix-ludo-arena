/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Account indicator component for the lobby
 */

import { useState, useEffect } from 'react';

interface AccountUser {
  id: string;
  displayName: string;
  avatarId: number;
  isGuest: boolean;
  level: number;
}

interface AccountStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  captures: number;
  xp: number;
  level: number;
}

export function AccountIndicator() {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [stats, setStats] = useState<AccountStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showMenu, setShowMenu] = useState(false);

  useEffect(() => {
    fetchAccount();
  }, []);

  const fetchAccount = async () => {
    try {
      const response = await fetch('/api/me', {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json() as { user: AccountUser; stats: AccountStats };
        setUser(data.user);
        setStats(data.stats);
      }
    } catch (error) {
      console.error('Failed to fetch account:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLoginWithGoogle = () => {
    window.location.href = '/api/auth/google/start';
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
      setUser(null);
      setStats(null);
      window.location.reload();
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  if (loading) {
    return (
      <div className="px-4 py-3 bg-slate-800/50 rounded-lg">
        <div className="animate-pulse flex space-x-3">
          <div className="rounded-full bg-slate-700 h-10 w-10"></div>
          <div className="flex-1 space-y-2 py-1">
            <div className="h-3 bg-slate-700 rounded w-24"></div>
            <div className="h-2 bg-slate-700 rounded w-16"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="px-4 py-3 bg-gradient-to-r from-blue-600/20 to-purple-600/20 rounded-lg border border-blue-500/30">
        <p className="text-sm text-slate-300 mb-2">💾 Save your progress</p>
        <button
          onClick={handleLoginWithGoogle}
          className="w-full px-4 py-2 bg-white text-slate-900 rounded-lg font-medium hover:bg-slate-100 transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="w-full px-4 py-3 bg-slate-800/50 rounded-lg hover:bg-slate-800/70 transition-colors flex items-center gap-3"
      >
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold">
          {user.displayName.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="font-medium text-white">{user.displayName}</span>
            {user.isGuest && (
              <span className="text-xs px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded">Guest</span>
            )}
          </div>
          <div className="text-xs text-slate-400">Level {user.level} • {stats?.wins ?? 0} wins</div>
        </div>
        <svg className={`w-4 h-4 text-slate-400 transition-transform ${showMenu ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)}></div>
          <div className="absolute top-full left-0 right-0 mt-2 bg-slate-800 rounded-lg shadow-xl border border-slate-700 z-50 overflow-hidden">
            {user.isGuest && (
              <button
                onClick={handleLoginWithGoogle}
                className="w-full px-4 py-3 hover:bg-slate-700 transition-colors text-left flex items-center gap-2 border-b border-slate-700"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <div className="text-sm font-medium text-white">Link Google Account</div>
                  <div className="text-xs text-slate-400">Save your progress</div>
                </div>
              </button>
            )}
            <a
              href="/profile"
              className="block px-4 py-3 hover:bg-slate-700 transition-colors text-sm text-white"
            >
              View Profile
            </a>
            <a
              href="/leaderboard"
              className="block px-4 py-3 hover:bg-slate-700 transition-colors text-sm text-white"
            >
              Leaderboard
            </a>
            <button
              onClick={handleLogout}
              className="w-full px-4 py-3 hover:bg-slate-700 transition-colors text-left text-sm text-red-400"
            >
              Log Out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
