/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ArrowLeft,
  Check,
  Pencil,
  Camera,
} from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { sound } from '../../audio/soundEffects';
import {
  loadMatchHistory,
  loadProfile,
  MatchRecord,
  saveProfile,
  UserProfile,
} from '../../storage/profileStore';
import { AvatarUploader } from '../accounts/AvatarUploader';

interface ProfileScreenProps {
  onBack: () => void;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({ onBack }) => {
  const [profile, setProfile] = useState<UserProfile>(loadProfile);
  const [history] = useState<MatchRecord[]>(loadMatchHistory);
  const [isEditing, setIsEditing] = useState(false);
  const [nameInput, setNameInput] = useState(profile.name);
  const [showAvatarUploader, setShowAvatarUploader] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState('👩');
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarOptions = ['👩', '👦', '🦁', '🏎️', '👑', '🦊', '🐯', '🥷'];

  useEffect(() => {
    const refreshServerProfile = async () => {
      try {
        const response = await fetch('/api/me', { credentials: 'include' });
        if (!response.ok) return;
        const data = (await response.json()) as { user?: { avatarUrl?: string | null } };
        if (data.user?.avatarUrl) {
          setProfile((current) => {
            if (data.user?.avatarUrl === current.avatarUrl) return current;
            const updated = { ...current, avatarUrl: data.user?.avatarUrl ?? null };
            saveProfile(updated);
            return updated;
          });
        }
      } catch {
        // Local profile remains the offline source of truth.
      }
    };
    void refreshServerProfile();
  }, []);

  const handleSaveName = () => {
    sound.triggerHaptic(15);
    sound.playMove();
    if (!nameInput.trim()) return;
    const updated = { ...profile, name: nameInput.trim() };
    setProfile(updated);
    saveProfile(updated);
    setIsEditing(false);
  };

  const handleSelectAvatar = (av: string) => {
    sound.triggerHaptic(20);
    sound.playMove();
    setSelectedAvatar(av);
  };

  const handleAvatarUpload = async (base64Image: string) => {
    setAvatarError(null);
    let savedOnline = false;
    let syncError: string | null = null;
    try {
      const response = await fetch('/api/profile/avatar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Ludo-Action': 'save-avatar',
        },
        credentials: 'include',
        body: JSON.stringify({ avatarUrl: base64Image }),
      });
      savedOnline = response.ok;
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Upload failed' }));
        const serverError = typeof errorData.error === 'string' ? errorData.error : 'Upload failed';
        syncError = response.status === 503
          ? 'Account sync is not enabled on this Worker. The image remains on this device.'
          : response.status === 401
            ? 'Your account session expired. Sign in again, then retry the upload.'
            : serverError;
      }
    } catch {
      syncError = 'Account sync failed. The local copy was saved.';
    }

    const updated = { ...profile, avatarUrl: base64Image };
    setProfile(updated);
    saveProfile(updated);
    if (syncError) setAvatarError(syncError);
    sound.triggerHaptic(20);
    sound.playMove();
    return savedOnline;
  };

  const winRate =
    profile.totalMatches > 0
      ? Math.round((profile.totalWins / profile.totalMatches) * 100)
      : 0;

  const currentLevelProgress = profile.xp % 200;
  const progressPercent = Math.min(100, Math.round((currentLevelProgress / 200) * 100));

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
      {/* 1. Mobile Top Bar (Matching Lobby Header) */}
      <header className="w-full bg-gradient-to-r from-[#0052CC] via-[#0066FF] to-[#0052CC] border-b-2 border-[#FFD200] shadow-lg px-3 py-1.5 flex items-center justify-between z-20">
        <button
          onClick={onBack}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-[#003B99] border border-sky-400/50 shadow text-white hover:brightness-110 active:scale-95 transition-transform cursor-pointer"
          aria-label="Back to Lobby"
        >
          <ArrowLeft className="w-5 h-5 text-[#FFD200]" />
        </button>

        {/* Title Badge */}
        <div className="flex items-center gap-1.5 px-4 py-1 rounded-full bg-gradient-to-r from-[#FFD200] via-[#FFB800] to-[#FFA000] border border-yellow-300 shadow-md">
          <span className="text-xs sm:text-sm font-black text-[#0B2A68] tracking-wider uppercase">
            PLAYER PROFILE
          </span>
        </div>

        {/* Coins Pill */}
        <div className="flex items-center gap-1 px-3 py-1 rounded-md bg-[#003B99] border border-sky-400/50 shadow-inner font-mono font-black text-xs text-white">
          <span>5,000</span>
          <span>🪙</span>
        </div>
      </header>

      {/* Main Container constrained to mobile phone canvas */}
      <div className="w-full max-w-[420px] mx-auto px-4 flex-1 flex flex-col justify-between py-2 space-y-3">
        {/* Profile Card */}
        <div className="w-full rounded-2xl bg-gradient-to-b from-[#0B64F0] via-[#0448BC] to-[#023188] border-[3px] border-[#FFD200] p-3.5 shadow-xl space-y-3">
          <div className="flex items-center gap-3">
            {/* Framed Avatar */}
            <div className="relative">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-b from-amber-200 to-amber-500 p-0.5 shadow-md">
                {profile.avatarUrl ? (
                  <img
                    src={profile.avatarUrl}
                    alt={`${profile.name}'s profile`}
                    className="w-full h-full rounded-xl object-cover"
                  />
                ) : (
                  <div className="w-full h-full rounded-xl bg-[#0F2F7D] flex items-center justify-center text-3xl">
                    {selectedAvatar}
                  </div>
                )}
              </div>
              <span className="absolute -bottom-1 -right-1 px-1.5 py-0.2 rounded bg-[#FFD200] text-[#072468] font-black text-[9px] shadow">
                Lvl {profile.level}
              </span>
            </div>

            {/* Name & Rank */}
            <div className="flex-1 space-y-1">
              {isEditing ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    className="px-2 py-0.5 rounded bg-[#003080] border border-[#FFD200] text-white font-black text-sm w-full focus:outline-none"
                    maxLength={16}
                  />
                  <button
                    onClick={handleSaveName}
                    className="min-h-[36px] min-w-[36px] rounded bg-[#FFD200] text-[#072468] font-black flex items-center justify-center cursor-pointer shadow"
                  >
                    <Check className="w-4 h-4 stroke-[3]" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="text-base font-black text-white truncate max-w-[150px]">
                    {profile.name || 'Divya'}
                  </span>
                  <button
                    onClick={() => setIsEditing(true)}
                    className="w-5 h-5 rounded-full bg-[#FFD200] text-slate-950 flex items-center justify-center shadow cursor-pointer active:scale-95"
                  >
                    <Pencil className="w-2.5 h-2.5 stroke-[2.5]" />
                  </button>
                </div>
              )}

              <span className="text-[10px] font-bold text-sky-200 block">
                Rank: Arena Grandmaster 👑
              </span>

              {/* XP Progress Bar */}
              <div className="w-full space-y-0.5">
                <div className="flex justify-between text-[9px] font-mono text-sky-300">
                  <span>Level Progress</span>
                  <span className="text-[#FFD200] font-black">{currentLevelProgress}/200 XP</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-[#002060] overflow-hidden border border-sky-400/30">
                  <div
                    className="h-full bg-gradient-to-r from-[#FFD200] to-[#FFA000] rounded-full transition-all"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Avatar Customization */}
          <div className="pt-2 border-t border-sky-400/30 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black text-sky-200 uppercase">
                Avatar
              </span>
              <button
                onClick={() => setShowAvatarUploader(true)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#FFD200] text-[#072468] text-[10px] font-black hover:brightness-110 active:scale-95 transition-transform cursor-pointer"
              >
                <Camera className="w-3 h-3" />
                <span>Upload Picture</span>
              </button>
            </div>

            {/* Quick Avatar Picker Strip */}
            <div>
              <span className="text-[10px] text-sky-300 block mb-1.5">
                Or choose emoji:
              </span>
              <div className="grid grid-cols-8 gap-1">
                {avatarOptions.map((av) => (
                  <button
                    key={av}
                    onClick={() => handleSelectAvatar(av)}
                    className={`min-h-[36px] rounded-lg flex items-center justify-center text-lg transition-all cursor-pointer ${
                      selectedAvatar === av
                        ? 'bg-[#FFD200] border-2 border-white scale-110 shadow'
                        : 'bg-[#003080] border border-sky-400/30 hover:brightness-125'
                    }`}
                  >
                    {av}
                  </button>
                ))}
              </div>
            </div>

            {profile.avatarUrl && (
              <div className="flex items-center gap-2 bg-[#003080] rounded-lg p-2 border border-sky-400/30">
                <span className="text-[10px] text-sky-300 flex-1">Custom picture uploaded</span>
                <button
                  onClick={async () => {
                    try {
                      const response = await fetch('/api/profile/avatar', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'X-Ludo-Action': 'save-avatar',
                        },
                        credentials: 'include',
                        body: JSON.stringify({ avatarUrl: null }),
                      });
                      if (!response.ok) {
                        const errorData = await response.json().catch(() => ({ error: 'Failed to remove avatar online.' }));
                        setAvatarError(errorData.error);
                        return;
                      }
                    } catch {
                      setAvatarError('Avatar remove failed online. The local copy was kept.');
                      return;
                    }
                    const updated = { ...profile, avatarUrl: null };
                    setProfile(updated);
                    saveProfile(updated);
                    sound.triggerHaptic(10);
                  }}
                  className="text-[10px] text-red-300 hover:text-red-200 font-bold px-2 py-1 rounded bg-red-500/20 transition-colors cursor-pointer"
                >
                  Remove
                </button>
              </div>
            )}
            {avatarError && (
              <p className="text-[10px] text-red-300 bg-red-500/10 border border-red-400/30 rounded-lg px-2 py-1.5" role="alert">{avatarError}</p>
            )}
          </div>
        </div>

        {/* 4 Golden Career Metric Badges (2x2 Grid) */}
        <div className="grid grid-cols-2 gap-2.5">
          {/* Card 1: Win Rate */}
          <div className="p-3 rounded-2xl bg-gradient-to-b from-[#0B64F0] via-[#0448BC] to-[#023188] border-[3px] border-[#FFD200] shadow-xl flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-[#003080] border border-sky-400/40 flex items-center justify-center text-xl shrink-0">
              🏆
            </div>
            <div>
              <span className="text-[10px] font-bold text-sky-200 uppercase block">WIN RATE</span>
              <span className="text-lg font-black text-[#FFD200] font-mono leading-none">
                {winRate}%
              </span>
            </div>
          </div>

          {/* Card 2: Matches Won */}
          <div className="p-3 rounded-2xl bg-gradient-to-b from-[#0B64F0] via-[#0448BC] to-[#023188] border-[3px] border-[#FFD200] shadow-xl flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-[#003080] border border-sky-400/40 flex items-center justify-center text-xl shrink-0">
              🎖️
            </div>
            <div>
              <span className="text-[10px] font-bold text-sky-200 uppercase block">VICTORIES</span>
              <span className="text-lg font-black text-[#FFD200] font-mono leading-none">
                {profile.totalWins}
              </span>
            </div>
          </div>

          {/* Card 3: Enemy Captures */}
          <div className="p-3 rounded-2xl bg-gradient-to-b from-[#0B64F0] via-[#0448BC] to-[#023188] border-[3px] border-[#FFD200] shadow-xl flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-[#003080] border border-sky-400/40 flex items-center justify-center text-xl shrink-0">
              ⚡
            </div>
            <div>
              <span className="text-[10px] font-bold text-sky-200 uppercase block">STRIKES</span>
              <span className="text-lg font-black text-[#FFD200] font-mono leading-none">
                {profile.totalCaptures}
              </span>
            </div>
          </div>

          {/* Card 4: Tokens Home */}
          <div className="p-3 rounded-2xl bg-gradient-to-b from-[#0B64F0] via-[#0448BC] to-[#023188] border-[3px] border-[#FFD200] shadow-xl flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-[#003080] border border-sky-400/40 flex items-center justify-center text-xl shrink-0">
              🏁
            </div>
            <div>
              <span className="text-[10px] font-bold text-sky-200 uppercase block">TOKENS HOME</span>
              <span className="text-lg font-black text-[#FFD200] font-mono leading-none">
                {profile.totalTokensHome}
              </span>
            </div>
          </div>
        </div>

        {/* Recent Matches Section */}
        <div className="w-full rounded-2xl bg-gradient-to-b from-[#0B64F0] via-[#0448BC] to-[#023188] border-[3px] border-[#FFD200] p-3 shadow-xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase text-[#FFD200] tracking-wide flex items-center gap-1.5">
              <span>📜</span>
              <span>MATCH HISTORY</span>
            </span>
            <span className="text-[10px] font-bold text-sky-200">{history.length} Matches</span>
          </div>

          <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
            {history.length === 0 ? (
              <div className="p-3 text-center text-xs text-sky-200 font-bold bg-[#003080] rounded-xl">
                No matches logged yet. Play to earn trophies! 🏆
              </div>
            ) : (
              history.map((record) => {
                const isVictory = record.outcome === 'victory';

                return (
                  <div
                    key={record.id}
                    className="p-2 rounded-xl bg-[#003080] border border-sky-400/30 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-base">{isVictory ? '🥇' : '🥈'}</span>
                      <div>
                        <span className="font-black text-white block capitalize">
                          {record.mode.replace('_', ' ')}
                        </span>
                        <span className="text-[9px] font-bold text-sky-300">
                          {record.captures} strikes · {record.tokensHome} home
                        </span>
                      </div>
                    </div>

                    <div className="text-right">
                      <span
                        className={`text-[10px] font-black uppercase block ${
                          isVictory ? 'text-emerald-300' : 'text-slate-300'
                        }`}
                      >
                        {record.outcome}
                      </span>
                      <span className="text-[10px] font-mono font-bold text-[#FFD200]">
                        +{isVictory ? '500' : '150'} 🪙
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Back Button */}
        <div className="pt-1 pb-2">
          <button
            onClick={onBack}
            className="w-full min-h-[48px] rounded-2xl bg-gradient-to-r from-[#FFD200] via-[#FFB800] to-[#FFA000] border-2 border-white shadow-xl hover:brightness-110 active:scale-95 transition-transform flex items-center justify-center gap-2 cursor-pointer font-black text-xs uppercase tracking-wider text-[#072468]"
          >
            <span>BACK TO ARENA</span>
          </button>
        </div>

        {showAvatarUploader && (
          <AvatarUploader
            currentAvatarUrl={profile.avatarUrl}
            onUpload={handleAvatarUpload}
            onClose={() => setShowAvatarUploader(false)}
          />
        )}
      </div>
    </div>
  );
};
