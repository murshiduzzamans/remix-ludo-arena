/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { loadProfile } from '../../storage/profileStore';

interface AccountUser {
  id: string;
  displayName: string;
  avatarId: number;
  avatarUrl?: string | null;
  isGuest: boolean;
  level: number;
  hasGithub?: boolean;
  hasGoogle?: boolean;
  syncCode?: string | null;
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
  const [syncCode, setSyncCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accountsEnabled, setAccountsEnabled] = useState<boolean | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [restoreInput, setRestoreInput] = useState('');
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [authError, setAuthError] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const err = new URLSearchParams(window.location.search).get('auth_error');
    if (err) {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('auth_error');
      window.history.replaceState({}, '', cleanUrl.toString());
      if (err === 'github_not_configured') {
        return 'GitHub OAuth is not configured yet on this server. Add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to .dev.vars or Cloudflare secrets.';
      }
      if (err === 'google_not_configured') {
        return 'Google OAuth is not configured yet on this server. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .dev.vars or Cloudflare secrets.';
      }
      return 'Authentication could not be completed. Please try again or use Guest / Sync Code.';
    }
    return null;
  });

  useEffect(() => {
    fetchAccount();
  }, []);

  const fetchAccount = async () => {
    try {
      let response = await fetch('/api/me', {
        credentials: 'include',
      });

      if (response.status === 503) {
        setAccountsEnabled(false);
        return;
      }

      setAccountsEnabled(true);

      if (response.status === 401) {
        const localProfile = loadProfile();
        const guestResponse = await fetch('/api/auth/guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            displayName: localProfile.name || 'Arena Master',
            avatarId: 0,
          }),
        });
        if (guestResponse.ok) {
          response = await fetch('/api/me', { credentials: 'include' });
        }
      }

      if (response.ok) {
        const data = (await response.json()) as { user: AccountUser; stats: AccountStats };
        setUser(data.user);
        setStats(data.stats);
        fetchSyncCode();
      }
    } catch (error) {
      console.error('Failed to fetch account:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSyncCode = async () => {
    try {
      const res = await fetch('/api/auth/sync-code', { credentials: 'include' });
      if (res.ok) {
        const data = (await res.json()) as { syncCode: string };
        setSyncCode(data.syncCode);
      } else {
        const errorData = await res.json().catch(() => ({ error: 'Failed to fetch sync code' }));
        console.error('Failed to fetch sync code:', errorData);
        // Show error in UI if you have a global error handling system
      }
    } catch (error) {
      console.error('Error fetching sync code:', error);
    }
  };

  const handleLoginWithGithub = () => {
    window.location.href = '/api/auth/github/start';
  };

  const handleLoginWithGoogle = () => {
    window.location.href = '/api/auth/google/start';
  };

  const handleCopySyncCode = () => {
    if (!syncCode) return;
    navigator.clipboard?.writeText(syncCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRestoreAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restoreInput.trim()) return;

    setRestoring(true);
    setRestoreError(null);

    try {
      const response = await fetch('/api/auth/sync-restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Ludo-Action': 'sync-restore' },
        credentials: 'include',
        body: JSON.stringify({ syncCode: restoreInput.trim() }),
      });

      if (!response.ok) {
        const err = (await response.json()) as { error?: string };
        setRestoreError(err.error || 'Failed to restore account.');
        setRestoring(false);
        return;
      }

      setShowSyncModal(false);
      await fetchAccount();
      setRestoreInput('');
      setRestoreError(null);
      setShowMenu(false);
    } catch {
      setRestoreError('Network error. Please try again.');
      setRestoring(false);
    }
  };

  const handleLogout = async () => {
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to log out' }));
        console.error('Logout failed:', errorData);
        setLogoutError(errorData.error || 'Failed to log out. Please try again.');
        return;
      }
      setUser(null);
      setStats(null);
      setSyncCode(null);
      setLogoutError(null);
      setShowMenu(false);
    } catch (error) {
      console.error('Logout failed:', error);
      setLogoutError('Network error. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="w-full px-4 py-2 bg-slate-900/60 rounded-xl border border-slate-700/50">
        <div className="animate-pulse flex items-center space-x-3">
          <div className="rounded-full bg-slate-700 h-9 w-9"></div>
          <div className="flex-1 space-y-1.5 py-1">
            <div className="h-3 bg-slate-700 rounded w-24"></div>
            <div className="h-2 bg-slate-700 rounded w-16"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!accountsEnabled) {
    return null;
  }

  // Not signed in / Guest state
  if (!user) {
    return (
      <div className="w-full px-4 py-3 bg-gradient-to-r from-blue-900/40 via-indigo-900/40 to-slate-900/60 rounded-2xl border border-blue-500/30 shadow-lg text-slate-100">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold tracking-wide uppercase text-amber-300 flex items-center gap-1.5">
            <span>💾</span> Save Progress & Stats
          </span>
          <button
            onClick={() => setShowSyncModal(true)}
            className="text-xs text-sky-300 hover:text-white underline cursor-pointer"
          >
            Have a Sync Code?
          </button>
        </div>

        {authError && (
          <div className="p-2.5 rounded-xl bg-amber-950/70 border border-amber-500/50 text-amber-200 text-xs flex items-start justify-between gap-2">
            <span>⚠️ {authError}</span>
            <button
              onClick={() => setAuthError(null)}
              className="text-amber-300 hover:text-white font-bold text-xs"
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {/* GitHub Login (No CC / No billing needed) */}
          <button
            onClick={handleLoginWithGithub}
            className="w-full px-3 py-2 bg-[#24292F] hover:bg-[#1a1f24] text-white rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2 shadow border border-slate-600 active:scale-95 cursor-pointer"
          >
            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
            Sign in with GitHub
          </button>

          {/* Google Login (Optional) */}
          <button
            onClick={handleLoginWithGoogle}
            className="w-full px-3 py-2 bg-white hover:bg-slate-100 text-slate-800 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2 shadow border border-slate-300 active:scale-95 cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Sign in with Google
          </button>
        </div>

        {/* Restore modal */}
        {showSyncModal && (
          <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                🔑 Restore with Sync Code
              </h3>
              <p className="text-xs text-slate-300">
                Enter your unique recovery code (e.g. <span className="font-mono text-amber-300">LUDO-ABCD-EFGH-JKLM-NPQR</span>) from your previous device to restore your account.
              </p>
              <form onSubmit={handleRestoreAccount} className="space-y-3">
                <input
                  type="text"
                  placeholder="LUDO-XXXX-XXXX-XXXX-XXXX"
                  value={restoreInput}
                  onChange={(e) => setRestoreInput(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-xl text-sm font-mono text-center tracking-widest uppercase focus:outline-none focus:border-amber-400"
                  maxLength={30}
                  autoFocus
                />
                {restoreError && (
                  <p className="text-xs text-red-400 text-center">{restoreError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setShowSyncModal(false); setRestoreError(null); }}
                    className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-medium cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={restoring}
                    className="flex-1 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs transition-colors cursor-pointer"
                  >
                    {restoring ? 'Restoring...' : 'Restore'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Signed in state
  return (
    <div className="relative w-full">
      <div className="w-full px-4 py-2.5 bg-slate-900/80 rounded-2xl border border-slate-700/60 shadow flex items-center justify-between">
        <div className="flex items-center gap-3">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt={`${user.displayName}'s profile`} className="w-9 h-9 rounded-xl object-cover shadow" />
          ) : (
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-slate-950 font-black text-sm shadow">
              {user.displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-xs text-white">{user.displayName}</span>
              {user.isGuest && (
                <span className="text-[10px] px-1.5 py-0.2 bg-amber-500/20 text-amber-300 rounded font-semibold">
                  Guest
                </span>
              )}
              {user.hasGithub && (
                <span className="text-[10px] px-1.5 py-0.2 bg-emerald-500/20 text-emerald-300 rounded font-semibold">
                  GitHub
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-400 font-medium">
              Lv. {user.level} • {stats?.wins ?? 0} wins • {stats?.xp ?? 0} XP
            </div>
          </div>
        </div>

        <button
          onClick={() => setShowMenu(!showMenu)}
          className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-medium text-slate-200 transition-colors flex items-center gap-1 cursor-pointer"
        >
          <span>Account</span>
          <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${showMenu ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {logoutError && (
        <p className="text-xs text-red-400 mt-1 text-right" role="alert">{logoutError}</p>
      )}

      {showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)}></div>
          <div className="absolute top-full right-0 mt-2 w-72 bg-slate-900/95 backdrop-blur-lg rounded-2xl shadow-2xl border border-slate-700 z-50 overflow-hidden divide-y divide-slate-800">
            {/* Sync Code Box */}
            <div className="p-3 bg-slate-800/40">
              <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-1">
                Your Sync Code (Use on any device)
              </div>
              <div className="flex items-center justify-between bg-slate-950/80 px-2.5 py-1.5 rounded-lg border border-slate-700">
                <span className="font-mono text-xs text-amber-300 font-bold select-all">
                  {syncCode || 'Loading...'}
                </span>
                <button
                  onClick={handleCopySyncCode}
                  className="text-[11px] px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-semibold rounded transition-colors cursor-pointer"
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Link Options (if guest) */}
            {user.isGuest && (
              <div className="p-2 space-y-1">
                <button
                  onClick={handleLoginWithGithub}
                  className="w-full px-3 py-2 hover:bg-slate-800 rounded-xl text-left text-xs text-white flex items-center gap-2 cursor-pointer"
                >
                  <span className="text-base">🐙</span>
                  <div>
                    <div className="font-semibold">Link GitHub Account</div>
                    <div className="text-[10px] text-slate-400">1-click login, never lose stats</div>
                  </div>
                </button>
                <button
                  onClick={handleLoginWithGoogle}
                  className="w-full px-3 py-2 hover:bg-slate-800 rounded-xl text-left text-xs text-white flex items-center gap-2 cursor-pointer"
                >
                  <span className="text-base">🌐</span>
                  <div>
                    <div className="font-semibold">Link Google Account</div>
                    <div className="text-[10px] text-slate-400">Optional Google sign-in</div>
                  </div>
                </button>
              </div>
            )}

            {/* Restore Another Account */}
            <div className="p-1">
              <button
                onClick={() => { setShowMenu(false); setShowSyncModal(true); }}
                className="w-full px-3 py-2 hover:bg-slate-800 rounded-xl text-left text-xs text-sky-300 flex items-center gap-2 cursor-pointer"
              >
                <span>🔄</span> Switch / Restore with Code
              </button>
              <button
                onClick={handleLogout}
                className="w-full px-3 py-2 hover:bg-slate-800 rounded-xl text-left text-xs text-red-400 flex items-center gap-2 cursor-pointer"
              >
                <span>🚪</span> Log Out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
