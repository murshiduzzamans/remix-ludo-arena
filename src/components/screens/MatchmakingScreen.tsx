/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ArrowLeft,
  Globe,
  Loader2,
  Play,
  Wifi,
} from 'lucide-react';
import React from 'react';
import { sound } from '../../audio/soundEffects';

interface MatchmakingScreenProps {
  onCancel: () => void;
  onEnterMatch: () => void;
}

export const MatchmakingScreen: React.FC<MatchmakingScreenProps> = ({
  onCancel,
  onEnterMatch,
}) => {
  const handleCancelClick = () => {
    sound.triggerHaptic(15);
    onCancel();
  };

  const slots = [
    { color: '#E52521', name: 'You (Host)', avatar: '👩', ready: true },
    { color: '#00A651', name: 'Sample player', avatar: '🦁', ready: true },
    { color: '#FFC200', name: 'Sample player', avatar: '🏎️', ready: true },
    { color: '#0088FF', name: 'Sample player', avatar: '🐯', ready: true },
  ];

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
          onClick={handleCancelClick}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-[#003B99] border border-sky-400/50 shadow text-white hover:brightness-110 active:scale-95 transition-transform cursor-pointer"
          aria-label="Back to Lobby"
        >
          <ArrowLeft className="w-5 h-5 text-[#FFD200]" />
        </button>

        {/* Title Badge */}
        <div className="flex items-center gap-1.5 px-4 py-1 rounded-full bg-gradient-to-r from-[#FFD200] via-[#FFB800] to-[#FFA000] border border-yellow-300 shadow-md">
          <span className="text-xs sm:text-sm font-black text-[#0B2A68] tracking-wider uppercase">
            ONLINE MATCHMAKING
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
        <div role="status" className="w-full p-3 bg-amber-900/20 border border-amber-500/30 rounded-xl text-[10px] font-bold text-amber-300 flex items-center gap-2">
          <span className="w-2 h-2 shrink-0 rounded-full bg-amber-500" />
          <span>Preview only: online matchmaking is not connected. Start Local Demo plays against bots on this device.</span>
        </div>

        {/* Radar & Search Visual Card */}
        <div className="w-full rounded-2xl bg-gradient-to-b from-[#0B64F0] via-[#0448BC] to-[#023188] border-[3px] border-[#FFD200] p-4 shadow-xl flex flex-col items-center justify-center space-y-3">
          {/* Animated Globe / Radar Core */}
          <div className="relative w-36 h-36 flex items-center justify-center">
            {/* Pulsing rings */}
            <div className="absolute inset-0 rounded-full border-2 border-[#FFD200]/30 animate-ping" />
            <div className="absolute w-28 h-28 rounded-full border-2 border-sky-400/40 animate-pulse" />
            <div className="absolute w-20 h-20 rounded-full bg-[#003080] border-2 border-[#FFD200] flex items-center justify-center shadow-lg">
              <Globe className="w-10 h-10 text-[#FFD200] animate-spin" style={{ animationDuration: '6s' }} />
            </div>

            {/* Orbiting device icon */}
            <div className="absolute top-1 right-2 text-lg animate-bounce">
              📱
            </div>
          </div>

          {/* Timer Display */}
          <div className="text-center space-y-0.5">
            <span className="text-2xl font-mono font-black text-[#FFD200] tracking-wider drop-shadow">
              PREVIEW
            </span>
            <span className="text-xs font-black text-sky-200 block uppercase tracking-wide">
              Online matchmaking is not connected yet
            </span>
          </div>

          {/* Edge Telemetry */}
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#002060] border border-sky-400/30 text-[10px] font-mono text-sky-300">
            <Wifi className="w-3 h-3 text-emerald-400" />
            <span>Local interface preview · no server connection</span>
          </div>
        </div>

        {/* 4 Player Slots Card */}
        <div className="w-full rounded-2xl bg-gradient-to-b from-[#0B64F0] via-[#0448BC] to-[#023188] border-[3px] border-[#FFD200] p-3 shadow-xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase text-[#FFD200] tracking-wide flex items-center gap-1.5">
              <span>👥</span>
              <span>SAMPLE PLAYERS</span>
            </span>
            <span className="text-[10px] font-bold text-sky-200">Preview only</span>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            {slots.map((slot, idx) => (
              <div
                key={idx}
                className={`p-2.5 rounded-xl border flex items-center justify-between transition-all min-h-[64px] ${
                  slot.ready
                    ? 'bg-[#003080] border-sky-300 shadow-md'
                    : 'bg-[#002060]/70 border-dashed border-sky-500/40'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm text-white border-2 border-white shadow"
                    style={{ backgroundColor: slot.color }}
                  >
                    {slot.avatar ? slot.avatar : <Loader2 className="w-4 h-4 text-sky-300 animate-spin" />}
                  </div>
                  <div>
                    <span className="text-xs font-black text-white truncate max-w-[90px] block">
                      {slot.name}
                    </span>
                    <span className="text-[9px] font-bold text-sky-300">
                      {slot.ready ? 'Ready' : 'Connecting...'}
                    </span>
                  </div>
                </div>

                {slot.ready && (
                  <span className="w-4 h-4 rounded-full bg-emerald-400 text-slate-950 flex items-center justify-center text-[10px] font-bold">
                    ✓
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 pt-1 pb-2">
          <button
            onClick={handleCancelClick}
            className="flex-1 min-h-[48px] rounded-xl bg-gradient-to-b from-[#0B58D8] to-[#022A78] border-2 border-[#FFD200] text-xs font-black text-white shadow-md flex items-center justify-center gap-1.5 hover:brightness-110 active:scale-95 transition-transform cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 text-[#FFD200]" />
            <span>Back to Lobby</span>
          </button>

          <button
            onClick={onEnterMatch}
            className="flex-1 min-h-[48px] rounded-xl bg-gradient-to-r from-[#FFD200] via-[#FFB800] to-[#FFA000] border-2 border-white text-xs font-black text-[#072468] shadow-md flex items-center justify-center gap-1.5 hover:brightness-110 active:scale-95 transition-transform cursor-pointer uppercase"
          >
            <Play className="w-4 h-4 fill-[#072468]" />
            <span>Start Local Demo</span>
          </button>
        </div>
      </div>
    </div>
  );
};
