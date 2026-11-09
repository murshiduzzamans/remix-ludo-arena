/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { getProfileEmoji, loadProfile, saveProfile } from '../../storage/profileStore';

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

interface AccountIndicatorProps {
  onProfileSync?: () => void;
}

export function AccountIndicator({ onProfileSync }: AccountIndicatorProps = {}) {
  const [localProfile, setLocalProfile] = useState(() => loadProfile());
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
        const currentProfile = loadProfile();
        const guestResponse = await fetch('/api/auth/guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            displayName: currentProfile.name || 'Arena Master',
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
        const current = loadProfile();
        const nextAvatarUrl = data.user.avatarUrl ?? current.avatarUrl ?? null;
        const nextName = data.user.displayName && data.user.displayName !== 'Arena Master'
          ? data.user.displayName
          : current.name;
        if (nextAvatarUrl !== current.avatarUrl || nextName !== current.name) {
          const updated = { ...current, avatarUrl: nextAvatarUrl, name: nextName };
          saveProfile(updated);
          setLocalProfile(updated);
          onProfileSync?.();
        } else {
          setLocalProfile(current);
        }
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
      <div className="w-full px-3.5 py-2 bg-gradient-to-r from-[#0B64F0]/80 via-[#0448BC]/80 to-[#023188]/80 rounded-2xl border-2 border-[#FFD200]/60 shadow-md">
        <div className="animate-pulse flex items-center space-x-3">
          <div className="rounded-xl bg-[#003080] border border-sky-400/30 h-9 w-9"></div>
          <div className="flex-1 space-y-1.5 py-1">
            <div className="h-3 bg-[#003080] rounded w-24"></div>
            <div className="h-2 bg-[#003080] rounded w-16"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!accountsEnabled) {
    return null;
  }

  const syncModal = showSyncModal && (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-gradient-to-b from-[#0B64F0] via-[#0448BC] to-[#023188] border-[3px] border-[#FFD200] rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
        <h3 className="text-base font-black text-[#FFD200] uppercase tracking-wide flex items-center gap-2">
          <span>🔑</span> Restore with Sync Code
        </h3>
        <p className="text-xs font-semibold text-sky-100">
          Enter your unique recovery code (e.g. <span className="font-mono text-[#FFD200]">LUDO-ABCD-EFGH-JKLM-NPQR</span>) from your previous device to restore your account.
        </p>
        <form onSubmit={handleRestoreAccount} className="space-y-3">
          <input
            type="text"
            placeholder="LUDO-XXXX-XXXX-XXXX-XXXX"
            value={restoreInput}
            onChange={(e) => setRestoreInput(e.target.value)}
            className="w-full px-3 py-2.5 bg-[#00245F] border-2 border-sky-400/50 rounded-xl text-sm font-mono font-black text-white text-center tracking-widest uppercase focus:outline-none focus:border-[#FFD200]"
            maxLength={30}
            autoFocus
          />
          {restoreError && (
            <p className="text-xs font-bold text-rose-300 text-center">{restoreError}</p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setShowSyncModal(false); setRestoreError(null); }}
              className="flex-1 min-h-10 py-2 bg-[#003080] hover:bg-[#003B99] border border-sky-400/40 rounded-xl text-xs font-black text-sky-100 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={restoring}
              className="flex-1 min-h-10 py-2 bg-gradient-to-r from-[#FFD200] to-[#FFA000] hover:brightness-110 text-[#072468] font-black rounded-xl text-xs border border-white transition-all cursor-pointer"
            >
              {restoring ? 'Restoring...' : 'Restore'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  // Not signed in / Guest state
  if (!user) {
    return (
      <div className="w-full px-3.5 py-2.5 bg-gradient-to-b from-[#0B64F0] via-[#0448BC] to-[#023188] rounded-2xl border-2 border-[#FFD200] shadow-lg text-white space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-black tracking-wide uppercase text-[#FFD200] flex items-center gap-1.5 drop-shadow">
            <span>💾</span> Cloud Account Sync
          </span>
          <button
            onClick={() => setShowSyncModal(true)}
            className="text-[11px] font-bold text-sky-200 hover:text-[#FFD200] underline cursor-pointer"
          >
            Have a Sync Code?
          </button>
        </div>

        {authError && (
          <div className="p-2.5 rounded-xl bg-amber-950/80 border border-amber-400/60 text-amber-200 text-xs flex items-start justify-between gap-2">
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
          {/* GitHub Login */}
          <button
            onClick={handleLoginWithGithub}
            className="w-full px-3 py-2 bg-[#00245F] hover:bg-[#003080] text-white rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 shadow border border-sky-400/50 active:scale-95 cursor-pointer"
          >
            <svg className="w-4 h-4 fill-[#FFD200]" viewBox="0 0 24 24">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
            Sign in with GitHub
          </button>

          {/* Google Login */}
          <button
            onClick={handleLoginWithGoogle}
            className="w-full px-3 py-2 bg-white hover:bg-slate-100 text-[#072468] rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 shadow border border-yellow-300 active:scale-95 cursor-pointer"
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

        {syncModal}
      </div>
    );
  }

  const avatarToRender = user.avatarUrl || localProfile.avatarUrl;
  const displayName = user.displayName === 'Arena Master' && localProfile.name !== 'Arena Master'
    ? localProfile.name
    : user.displayName;

  // Signed in state
  return (
    <div className="relative w-full">
      <div className="w-full px-3.5 py-2 bg-gradient-to-r from-[#0B64F0] via-[#0448BC] to-[#023188] rounded-2xl border-2 border-[#FFD200] shadow-lg flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-b from-amber-200 to-amber-500 p-0.5 shadow shrink-0">
            {avatarToRender ? (
              <img src={avatarToRender} alt={`${displayName}'s profile`} className="w-full h-full rounded-[10px] object-cover" />
            ) : (
              <div className="w-full h-full rounded-[10px] bg-[#0F2F7D] flex items-center justify-center text-lg">
                {getProfileEmoji(localProfile)}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-black text-xs text-white truncate max-w-[125px]">{displayName}</span>
              {user.isGuest && (
                <span className="text-[9px] px-1.5 py-0.5 bg-[#FFD200] text-[#072468] rounded font-black uppercase tracking-tight">
                  Guest
                </span>
              )}
              {user.hasGithub && (
                <span className="text-[9px] px-1.5 py-0.5 bg-emerald-400 text-slate-950 rounded font-black uppercase tracking-tight">
                  GitHub ✓
                </span>
              )}
              {user.hasGoogle && (
                <span className="text-[9px] px-1.5 py-0.5 bg-sky-300 text-slate-950 rounded font-black uppercase tracking-tight">
                  Google ✓
                </span>
              )}
            </div>
            <div className="text-[10px] text-sky-200 font-bold">
              Lv. {Math.max(user.level, localProfile.level)} • {Math.max(stats?.wins ?? 0, localProfile.totalWins)} wins • {Math.max(stats?.xp ?? 0, localProfile.xp)} XP
            </div>
          </div>
        </div>

        <button
          onClick={() => setShowMenu(!showMenu)}
          className="px-2.5 py-1.5 bg-[#002B7A] hover:bg-[#003B99] border border-[#FFD200]/80 rounded-xl text-xs font-black text-[#FFD200] transition-all flex items-center gap-1 cursor-pointer shadow shrink-0"
        >
          <span>Account</span>
          <svg className={`w-3.5 h-3.5 text-[#FFD200] transition-transform ${showMenu ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {logoutError && (
        <p className="text-xs text-rose-300 font-bold mt-1 text-right" role="alert">{logoutError}</p>
      )}

      {showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)}></div>
          <div className="absolute top-full right-0 mt-2 w-72 bg-gradient-to-b from-[#0847B8] to-[#021E5C] rounded-2xl shadow-2xl border-2 border-[#FFD200] z-50 overflow-hidden divide-y divide-sky-400/30">
            {/* Sync Code Box */}
            <div className="p-3 bg-[#00245F]/70">
              <div className="text-[10px] uppercase font-black tracking-wider text-sky-200 mb-1">
                Your Sync Code (Use on any device)
              </div>
              <div className="flex items-center justify-between bg-[#001845] px-2.5 py-1.5 rounded-xl border border-sky-400/40">
                <span className="font-mono text-xs text-[#FFD200] font-black select-all">
                  {syncCode || 'Loading...'}
                </span>
                <button
                  onClick={handleCopySyncCode}
                  className="text-[10px] px-2 py-0.5 bg-[#FFD200] hover:brightness-110 text-[#072468] font-black rounded-md transition-all cursor-pointer"
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
                  className="w-full px-3 py-2 hover:bg-[#003080] rounded-xl text-left text-xs text-white flex items-center gap-2.5 cursor-pointer transition-colors"
                >
                  <span className="text-base">🐙</span>
                  <div>
                    <div className="font-black text-[#FFD200]">Link GitHub Account</div>
                    <div className="text-[10px] font-semibold text-sky-200">1-click login, never lose stats</div>
                  </div>
                </button>
                <button
                  onClick={handleLoginWithGoogle}
                  className="w-full px-3 py-2 hover:bg-[#003080] rounded-xl text-left text-xs text-white flex items-center gap-2.5 cursor-pointer transition-colors"
                >
                  <span className="text-base">🌐</span>
                  <div>
                    <div className="font-black text-white">Link Google Account</div>
                    <div className="text-[10px] font-semibold text-sky-200">Optional Google sign-in</div>
                  </div>
                </button>
              </div>
            )}

            {/* Restore Another Account */}
            <div className="p-1.5 space-y-0.5">
              <button
                onClick={() => { setShowMenu(false); setShowSyncModal(true); }}
                className="w-full px-3 py-2 hover:bg-[#003080] rounded-xl text-left text-xs font-bold text-sky-200 flex items-center gap-2 cursor-pointer transition-colors"
              >
                <span>🔄</span> Switch / Restore with Code
              </button>
              <button
                onClick={handleLogout}
                className="w-full px-3 py-2 hover:bg-rose-950/60 rounded-xl text-left text-xs font-bold text-rose-300 flex items-center gap-2 cursor-pointer transition-colors"
              >
                <span>🚪</span> Log Out
              </button>
            </div>
          </div>
        </>
      )}

      {syncModal}
    </div>
  );
}
