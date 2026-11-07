/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ArrowLeft,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import React, { useState } from 'react';
import { sound } from '../../audio/soundEffects';
import {
  AppSettings,
  loadSettings,
  saveSettings,
} from '../../storage/profileStore';

interface SettingsScreenProps {
  onBack: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ onBack }) => {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [savedToast, setSavedToast] = useState(false);

  const handleToggleSound = () => {
    const nextVal = !settings.soundEnabled;
    const updated = { ...settings, soundEnabled: nextVal };
    sound.setMuted(!nextVal);
    sound.triggerHaptic(20);
    setSettings(updated);
    saveSettings(updated);
    if (nextVal) sound.playMove();
  };

  const handleVolumeChange = (vol: number) => {
    const updated = { ...settings, soundVolume: vol };
    sound.setVolume(vol);
    setSettings(updated);
    saveSettings(updated);
  };

  const handleToggleVibration = () => {
    const updated = { ...settings, hapticFeedback: !settings.hapticFeedback };
    setSettings(updated);
    saveSettings(updated);
    sound.setHapticsEnabled(updated.hapticFeedback);
  };

  const handleToggleTurbo = () => {
    sound.playMove();
    sound.triggerHaptic(15);
    const updated = { ...settings, fastAnimations: !settings.fastAnimations };
    setSettings(updated);
    saveSettings(updated);
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
            SETTINGS & RULES
          </span>
        </div>

        {/* Coins Pill */}
        <div className="flex items-center gap-1 px-3 py-1 rounded-md bg-[#003B99] border border-sky-400/50 shadow-inner font-mono font-black text-xs text-white">
          <span>5,000</span>
          <span>🪙</span>
        </div>
      </header>

      {/* Saved Toast */}
      {savedToast && (
        <div className="fixed top-16 z-50 px-4 py-1.5 rounded-full bg-[#FFD200] text-slate-950 font-black text-xs shadow-xl animate-bounce border-2 border-yellow-400">
          Settings Saved! ✓
        </div>
      )}

      {/* Main Container constrained to mobile phone canvas */}
      <div className="w-full max-w-[420px] mx-auto px-4 flex-1 flex flex-col justify-between py-2 space-y-3">
        {/* Section 1: Audio & Speed Card */}
        <div className="w-full rounded-2xl bg-gradient-to-b from-[#0B64F0] via-[#0448BC] to-[#023188] border-[3px] border-[#FFD200] p-3 shadow-xl space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase text-[#FFD200] tracking-wide flex items-center gap-1.5">
              <span>🔊</span>
              <span>AUDIO & GAMEPLAY</span>
            </span>
          </div>

          {/* Sound Toggle Button */}
          <div className="p-2.5 rounded-xl bg-[#003080] border border-sky-400/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">{settings.soundEnabled ? '🔊' : '🔇'}</span>
              <div>
                <span className="text-xs font-black text-white block">Sound Effects</span>
                <span className="text-[9px] font-bold text-sky-300">Dice roll & clack</span>
              </div>
            </div>

            <button
              onClick={handleToggleSound}
              className={`min-h-[44px] px-3 rounded-lg border font-black text-xs flex items-center gap-1 transition-all cursor-pointer ${
                settings.soundEnabled
                  ? 'bg-[#FFD200] text-[#072468] border-white shadow'
                  : 'bg-[#002060] text-slate-400 border-sky-500/30'
              }`}
            >
              {settings.soundEnabled ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* Volume Slider (if sound on) */}
          <div className="p-2.5 rounded-xl bg-[#003080] border border-sky-400/30 flex items-center justify-between">
            <div><span className="text-xs font-black text-white block">Vibration</span><span className="text-[9px] font-bold text-sky-300">Dice and token movement</span></div>
            <button type="button" role="switch" aria-checked={settings.hapticFeedback} onClick={handleToggleVibration} className={`min-h-[44px] px-3 rounded-lg border font-black text-xs ${settings.hapticFeedback ? 'bg-[#FFD200] text-[#072468] border-white shadow' : 'bg-[#002060] text-slate-400 border-sky-500/30'}`}>{settings.hapticFeedback ? 'ON' : 'OFF'}</button>
          </div>

          {settings.soundEnabled && (
            <div className="p-2 rounded-xl bg-[#003080] border border-sky-400/30 space-y-1">
              <div className="flex justify-between text-[10px] font-black text-sky-200">
                <span>Volume</span>
                <span className="text-[#FFD200] font-mono">{Math.round(settings.soundVolume * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.soundVolume}
                onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                className="w-full accent-[#FFD200] cursor-pointer"
              />
            </div>
          )}

          {/* Turbo Speed Toggle */}
          <div className="p-2.5 rounded-xl bg-[#003080] border border-sky-400/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">⚡</span>
              <div>
                <span className="text-xs font-black text-white block">Turbo Speed</span>
                <span className="text-[9px] font-bold text-sky-300">Fast bot deliberation</span>
              </div>
            </div>

            <button
              onClick={handleToggleTurbo}
              className={`min-h-[44px] px-3 rounded-lg border font-black text-xs flex items-center gap-1 transition-all cursor-pointer ${
                settings.fastAnimations
                  ? 'bg-[#FFD200] text-[#072468] border-white shadow'
                  : 'bg-[#002060] text-slate-400 border-sky-500/30'
              }`}
            >
              {settings.fastAnimations ? 'FAST' : 'NORMAL'}
            </button>
          </div>
        </div>

        {/* Section 2: Official Tournament Standard Rules (Locked & Enforced) */}
        <div className="w-full rounded-2xl bg-gradient-to-b from-[#0B64F0] via-[#0448BC] to-[#023188] border-[3px] border-[#FFD200] p-3 shadow-xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase text-[#FFD200] tracking-wide flex items-center gap-1.5">
              <span>🔒</span>
              <span>TOURNAMENT RULES</span>
            </span>
            <span className="text-[10px] font-black px-2 py-0.5 rounded bg-emerald-400 text-slate-950">
              LOCKED
            </span>
          </div>

          <div className="p-3 rounded-xl bg-[#003080] border border-sky-400/30 text-center space-y-1">
            <span className="text-xs font-black text-white block">
              Official Arena Regulations Enforced
            </span>
            <span className="text-[10px] font-bold text-sky-200 block">
              Rules are locked to tournament standards (6 to exit, safe stars, strike bonus) to prevent modifications and guarantee fair competition.
            </span>
          </div>
        </div>

        {/* Action Button: Return */}
        <div className="pt-1 pb-2">
          <button
            onClick={onBack}
            className="w-full min-h-[48px] rounded-2xl bg-gradient-to-r from-[#FFD200] via-[#FFB800] to-[#FFA000] border-2 border-white shadow-xl hover:brightness-110 active:scale-95 transition-transform flex items-center justify-center gap-2 cursor-pointer font-black text-xs uppercase tracking-wider text-[#072468]"
          >
            <span>RETURN TO ARENA</span>
          </button>
        </div>
      </div>
    </div>
  );
};
