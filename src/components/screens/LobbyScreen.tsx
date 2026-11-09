/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Crown,
  Download,
  Globe,
  Heart,
  Pencil,
  Plus,
  Settings,
  Share2,
  Smartphone,
  ThumbsUp,
  Users,
} from 'lucide-react';
import React, { useState } from 'react';
import { sound } from '../../audio/soundEffects';
import { GameMode } from '../../engine/types';
import { addCoins, getProfileEmoji, loadCoins, loadProfile } from '../../storage/profileStore';
import { usePWAInstall } from '../pwa/usePWAInstall';
import { AccountIndicator } from '../accounts/AccountIndicator';

interface LobbyScreenProps {
  onSelectMode: (mode: GameMode) => void;
  onOpenSoloSetup: () => void;
  onOpenPrivateRooms: () => void;
  onOpenMatchmaking: () => void;
  onOpenProfile: () => void;
  onOpenLeaderboard?: () => void;
  onOpenSettings?: () => void;
}

export const LobbyScreen: React.FC<LobbyScreenProps> = ({
  onSelectMode,
  onOpenSoloSetup,
  onOpenPrivateRooms,
  onOpenMatchmaking,
  onOpenProfile,
  onOpenLeaderboard,
  onOpenSettings,
}) => {
  const [profile, setProfile] = useState(() => loadProfile());
  const [copiedShare, setCopiedShare] = useState(false);
  const [showCoinsReward, setShowCoinsReward] = useState(false);
  const [showRateToast, setShowRateToast] = useState(false);
  const [coinsCount, setCoinsCount] = useState(() => loadCoins());
  const { isInstallable, install } = usePWAInstall();

  // Sound & Haptic on card press
  const handleCardClick = (action: () => void) => {
    sound.playMove();
    sound.triggerHaptic(20);
    action();
  };

  // Add more coins interaction
  const handleAddMoreCoins = () => {
    sound.playHomeFinish();
    sound.triggerHaptic([30, 40, 50]);
    const nextCoins = addCoins(500);
    setCoinsCount(nextCoins);
    setShowCoinsReward(true);
    setTimeout(() => setShowCoinsReward(false), 2000);
  };

  // Rate action
  const handleRate = () => {
    sound.playVictory();
    sound.triggerHaptic([20, 30, 40]);
    setShowRateToast(true);
    setTimeout(() => setShowRateToast(false), 2500);
  };

  // Share action
  const handleShare = () => {
    sound.triggerHaptic(15);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2000);
    }
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
      {/* 1. Top Profile Bar (matching screenshot, with right padding reserved for TopNavBar) */}
      <header className="w-full bg-gradient-to-r from-[#0052CC] via-[#0066FF] to-[#0052CC] border-b-2 border-[#FFD200] shadow-lg pl-3 pr-16 py-1.5 flex items-center justify-between z-20">
        <div className="flex items-center gap-2">
          {/* Framed Avatar with Edit Icon */}
          <div
            onClick={onOpenProfile}
            className="relative cursor-pointer group active:scale-95 transition-transform"
          >
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-b from-amber-200 to-amber-500 p-0.5 shadow-md">
              <div className="w-full h-full rounded-lg bg-[#0F2F7D] overflow-hidden flex items-center justify-center text-xl">
                {profile.avatarUrl ? (
                  <img
                    src={profile.avatarUrl}
                    alt={`${profile.name}'s avatar`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  getProfileEmoji(profile)
                )}
              </div>
            </div>
            {/* Yellow Pencil Edit Icon */}
            <span className="absolute -top-1 -left-1 w-4 h-4 rounded-full bg-[#FFD200] border border-amber-600 flex items-center justify-center text-slate-950 shadow">
              <Pencil className="w-2.5 h-2.5 stroke-[2.5]" />
            </span>
          </div>

          {/* Player Name Pill */}
          <div
            onClick={onOpenProfile}
            className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#003B99] border border-sky-400/50 shadow-inner cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5 text-sky-300" />
            <span className="text-xs sm:text-sm font-black text-white tracking-wide truncate max-w-[100px] sm:max-w-[140px]">
              {profile.name || 'Arena Master'}
            </span>
          </div>
        </div>

        {/* Coins & More Coins Pill */}
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-1.5 font-mono font-black text-xs sm:text-sm text-white drop-shadow">
            <span>{coinsCount.toLocaleString()}</span>
            <span className="text-base leading-none">🪙</span>
          </div>

          <button
            onClick={handleAddMoreCoins}
            className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-gradient-to-r from-[#FFD200] via-[#FFB800] to-[#FFA000] border border-yellow-300 shadow-md text-[10px] font-black text-[#0B2A68] hover:brightness-110 active:scale-95 transition-transform cursor-pointer"
          >
            <Plus className="w-3 h-3 stroke-[3]" />
            <span>More Coins</span>
          </button>
        </div>
      </header>

      {/* Coins Reward Notification */}
      {showCoinsReward && (
        <div className="fixed top-16 z-50 px-4 py-1.5 rounded-full bg-[#FFD200] text-slate-950 font-black text-xs shadow-xl animate-bounce border-2 border-yellow-400">
          +500 Coins Collected! 🪙
        </div>
      )}

      {/* Rate Toast Notification */}
      {showRateToast && (
        <div className="fixed top-16 z-50 px-4 py-1.5 rounded-full bg-[#FFD200] text-slate-950 font-black text-xs shadow-xl animate-bounce border-2 border-yellow-400">
          ★★★★★ Thanks for rating 5 stars!
        </div>
      )}

      {/* Main Container constrained to mobile phone canvas */}
      <div className="w-full max-w-[420px] mx-auto px-4 flex-1 flex flex-col justify-between py-2 space-y-3">
        {/* Account & Sync Status */}
        <AccountIndicator onProfileSync={() => setProfile(loadProfile())} />

        {/* 2. Hero Logo & Isometric 3D Board Illustration */}
        <div className="flex flex-col items-center justify-center pt-1 select-none">
          {/* LUDO ARENA Title with Crown & Circles */}
          <div className="relative flex flex-col items-center">
            {/* Golden Crown */}
            <div className="text-3xl filter drop-shadow(0 2px 4px rgba(0,0,0,0.4)) animate-pulse">
              👑
            </div>

            {/* Letter Badges: L(cyan) U(red) D(green) O(yellow) */}
            <div className="flex items-center gap-1 -mt-1">
              <span className="w-8 h-8 rounded-full bg-gradient-to-b from-[#38BDF8] to-[#0284C7] border-2 border-white shadow-md flex items-center justify-center text-white font-black text-base drop-shadow">
                L
              </span>
              <span className="w-8 h-8 rounded-full bg-gradient-to-b from-[#F87171] to-[#DC2626] border-2 border-white shadow-md flex items-center justify-center text-white font-black text-base drop-shadow">
                U
              </span>
              <span className="w-8 h-8 rounded-full bg-gradient-to-b from-[#4ADE80] to-[#16A34A] border-2 border-white shadow-md flex items-center justify-center text-white font-black text-base drop-shadow">
                D
              </span>
              <span className="w-8 h-8 rounded-full bg-gradient-to-b from-[#FDE047] to-[#CA8A04] border-2 border-white shadow-md flex items-center justify-center text-white font-black text-base drop-shadow">
                O
              </span>
              <span className="ml-1 text-sm font-black text-[#FFD200] tracking-wider drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                ARENA
              </span>
            </div>
          </div>

          {/* 3D Board Graphic with 4 Standing Pawns & Center 3D Dice */}
          <div className="relative w-64 h-32 flex items-center justify-center my-1">
            {/* Isometric Board Base */}
            <svg
              viewBox="0 0 200 100"
              className="w-full h-full filter drop-shadow(0 8px 16px rgba(0,0,0,0.6))"
            >
              {/* Board Floor Polygon */}
              <polygon
                points="100,10 190,50 100,90 10,50"
                fill="#FFFFFF"
                stroke="#0A2D78"
                strokeWidth="3"
              />
              {/* 4 Quadrants */}
              <polygon points="100,10 145,30 100,50 55,30" fill="#E52521" /> {/* Red Top */}
              <polygon points="145,30 190,50 145,70 100,50" fill="#00A651" /> {/* Green Right */}
              <polygon points="100,50 145,70 100,90 55,70" fill="#FFC200" /> {/* Yellow Bottom */}
              <polygon points="55,30 100,50 55,70 10,50" fill="#0088FF" /> {/* Blue Left */}

              {/* Grid Lines */}
              <line x1="10" y1="50" x2="190" y2="50" stroke="#E2E8F0" strokeWidth="1" />
              <line x1="100" y1="10" x2="100" y2="90" stroke="#E2E8F0" strokeWidth="1" />
            </svg>

            {/* 3D Dice in Center of Board */}
            <div className="absolute z-10 w-8 h-8 rounded-lg bg-gradient-to-br from-white to-slate-200 border border-slate-300 shadow-xl flex items-center justify-center -translate-y-1 rotate-6">
              <div className="grid grid-cols-2 grid-rows-2 gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-900" />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-900" />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-900" />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-900" />
              </div>
            </div>

            {/* Blue Token (Front Left) */}
            <div className="absolute left-4 bottom-2 z-20 flex flex-col items-center">
              <span className="w-5 h-5 rounded-full bg-[#1E88E5] border-2 border-white shadow-sm" />
            </div>

            {/* Red Token (Back Left) */}
            <div className="absolute left-14 top-3 z-10 flex flex-col items-center">
              <span className="w-4 h-4 rounded-full bg-[#D9383A] border-2 border-white shadow-sm" />
            </div>

            {/* Green Token (Back Right) */}
            <div className="absolute right-14 top-3 z-10 flex flex-col items-center">
              <span className="w-4 h-4 rounded-full bg-[#2E7D32] border-2 border-white shadow-sm" />
            </div>

            {/* Yellow Token (Front Right) */}
            <div className="absolute right-4 bottom-2 z-20 flex flex-col items-center">
              <span className="w-5 h-5 rounded-full bg-[#E5A100] border-2 border-white shadow-sm" />
            </div>

            {/* Golden TM */}
            <span className="absolute right-1 bottom-6 text-[10px] font-black text-[#FFD200]">
              TM
            </span>
          </div>
        </div>

        {/* 3. The Four Main Game Mode Cards (2x2 Grid with Golden Frames & Yellow Banners) */}
        <div className="grid grid-cols-2 gap-3 w-full">
          {/* Card 1: VS COMPUTER */}
          <div className="flex flex-col items-center">
            <button
              onClick={() => handleCardClick(onOpenSoloSetup)}
              className="w-full h-22 sm:h-24 rounded-2xl bg-gradient-to-b from-[#0B64F0] via-[#0448BC] to-[#023188] border-[3px] border-[#FFD200] shadow-xl hover:brightness-110 active:scale-95 transition-all flex flex-col justify-between overflow-hidden cursor-pointer"
            >
              {/* Graphic Icon */}
              <div className="flex-1 flex items-center justify-center pt-2">
                <div className="w-10 h-7 rounded-md bg-[#FFD200] border border-amber-600 flex items-center justify-center font-black text-xs text-[#072468] shadow">
                  VS
                </div>
              </div>

              {/* Yellow Banner Bottom */}
              <div className="w-full bg-gradient-to-r from-[#FFD200] via-[#FFC000] to-[#FFD200] py-1 text-center border-t-2 border-amber-600">
                <span className="text-xs font-black uppercase tracking-tight text-[#072468]">
                  VS COMPUTER
                </span>
              </div>
            </button>
            <span className="text-[10px] font-bold text-sky-200 mt-1 flex items-center gap-1 drop-shadow">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Players: 36,050
            </span>
          </div>

          {/* Card 2: LOCAL MULTIPLAYER */}
          <div className="flex flex-col items-center">
            <button
              onClick={() => handleCardClick(() => onSelectMode('pass_and_play'))}
              className="w-full h-22 sm:h-24 rounded-2xl bg-gradient-to-b from-[#0B64F0] via-[#0448BC] to-[#023188] border-[3px] border-[#FFD200] shadow-xl hover:brightness-110 active:scale-95 transition-all flex flex-col justify-between overflow-hidden cursor-pointer"
            >
              {/* Graphic Icon */}
              <div className="flex-1 flex items-center justify-center pt-2 gap-1 text-[#FFD200]">
                <Users className="w-7 h-7 stroke-[2.2]" />
              </div>

              {/* Yellow Banner Bottom */}
              <div className="w-full bg-gradient-to-r from-[#FFD200] via-[#FFC000] to-[#FFD200] py-1 text-center border-t-2 border-amber-600">
                <span className="text-xs font-black uppercase tracking-tight text-[#072468]">
                  LOCAL PLAY
                </span>
              </div>
            </button>
            <span className="text-[10px] font-bold text-sky-200 mt-1 flex items-center gap-1 drop-shadow">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Players: 41,842
            </span>
          </div>

          {/* Card 3: ONLINE MULTIPLAYER */}
          <div className="flex flex-col items-center">
            <button
              onClick={() => handleCardClick(onOpenMatchmaking)}
              className="w-full h-22 sm:h-24 rounded-2xl bg-gradient-to-b from-[#0B64F0] via-[#0448BC] to-[#023188] border-[3px] border-[#FFD200] shadow-xl hover:brightness-110 active:scale-95 transition-all flex flex-col justify-between overflow-hidden cursor-pointer"
            >
              {/* Graphic Icon */}
              <div className="flex-1 flex items-center justify-center pt-2 gap-1 text-[#FFD200]">
                <Smartphone className="w-4 h-4" />
                <Globe className="w-5 h-5 animate-spin" style={{ animationDuration: '8s' }} />
                <Smartphone className="w-4 h-4" />
              </div>

              {/* Yellow Banner Bottom */}
              <div className="w-full bg-gradient-to-r from-[#FFD200] via-[#FFC000] to-[#FFD200] py-1 text-center border-t-2 border-amber-600">
                <span className="text-xs font-black uppercase tracking-tight text-[#072468]">
                  ONLINE PLAY
                </span>
              </div>
            </button>
            <span className="text-[10px] font-bold text-sky-200 mt-1 flex items-center gap-1 drop-shadow">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Players: 6,183
            </span>
          </div>

          {/* Card 4: PLAY WITH FRIENDS */}
          <div className="flex flex-col items-center">
            <button
              onClick={() => handleCardClick(onOpenPrivateRooms)}
              className="w-full h-22 sm:h-24 rounded-2xl bg-gradient-to-b from-[#0B64F0] via-[#0448BC] to-[#023188] border-[3px] border-[#FFD200] shadow-xl hover:brightness-110 active:scale-95 transition-all flex flex-col justify-between overflow-hidden cursor-pointer"
            >
              {/* Graphic Icon */}
              <div className="flex-1 flex items-center justify-center pt-2 gap-1 text-[#FFD200]">
                <Smartphone className="w-4 h-4" />
                <Heart className="w-4 h-4 fill-[#FFD200] animate-pulse" />
                <Smartphone className="w-4 h-4" />
              </div>

              {/* Yellow Banner Bottom */}
              <div className="w-full bg-gradient-to-r from-[#FFD200] via-[#FFC000] to-[#FFD200] py-1 text-center border-t-2 border-amber-600">
                <span className="text-xs font-black uppercase tracking-tight text-[#072468]">
                  WITH FRIENDS
                </span>
              </div>
            </button>
            <span className="text-[10px] font-bold text-sky-200 mt-1 flex items-center gap-1 drop-shadow">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Players: 2,343
            </span>
          </div>
        </div>

        {/* 4. Three Golden Circular Icon Buttons */}
        <div className="flex items-center justify-center gap-5 pt-1">
          {/* Button 1: Leaderboard / Career Crown */}
          <button
            onClick={() => handleCardClick(onOpenLeaderboard || onOpenProfile)}
            className="w-14 h-14 rounded-2xl bg-gradient-to-b from-[#0948BA] to-[#042874] border-[3px] border-[#FFD200] shadow-xl shadow-black/40 flex items-center justify-center hover:scale-105 active:scale-90 transition-transform cursor-pointer"
            title="Hall of Champions & Leaderboard"
          >
            <Crown className="w-7 h-7 text-[#FFD200] fill-[#FFD200]" />
          </button>

          {/* Button 2: Settings / Gears */}
          <button
            onClick={() => handleCardClick(onOpenSettings || onOpenProfile)}
            className="relative w-14 h-14 rounded-2xl bg-gradient-to-b from-[#0948BA] to-[#042874] border-[3px] border-[#FFD200] shadow-xl shadow-black/40 flex items-center justify-center hover:scale-105 active:scale-90 transition-transform cursor-pointer"
            title="Settings & Rules"
          >
            <Settings className="w-7 h-7 text-[#FFD200]" />
            {/* Mail notification tag */}
            <span className="absolute -top-1 -right-1 text-xs">✉️</span>
          </button>

          {/* Button 3: 2v2 Team Battle Mode */}
          <button
            onClick={() => handleCardClick(() => onSelectMode('team_2v2'))}
            className="w-14 h-14 rounded-2xl bg-gradient-to-b from-[#0948BA] to-[#042874] border-[3px] border-[#FFD200] shadow-xl shadow-black/40 flex items-center justify-center hover:scale-105 active:scale-90 transition-transform cursor-pointer text-xl"
            title="2v2 Team Battle"
          >
            🎲
          </button>
        </div>

        {/* 5. Three Glossy Action Buttons (Rate / Share / Install) */}
        <div className="flex items-center justify-center gap-2 pt-1">
          <button
            onClick={handleRate}
            className="min-h-[44px] flex-1 py-1.5 px-3 rounded-full bg-gradient-to-b from-[#0B58D8] to-[#022A78] border-2 border-[#FFD200] text-xs font-black text-white shadow-md flex items-center justify-center gap-1.5 hover:brightness-110 active:scale-95 transition-transform cursor-pointer"
          >
            <ThumbsUp className="w-3.5 h-3.5 text-[#FFD200]" />
            <span>Rate</span>
          </button>

          <button
            onClick={handleShare}
            className="min-h-[44px] flex-1 py-1.5 px-3 rounded-full bg-gradient-to-b from-[#0B58D8] to-[#022A78] border-2 border-[#FFD200] text-xs font-black text-white shadow-md flex items-center justify-center gap-1.5 hover:brightness-110 active:scale-95 transition-transform cursor-pointer"
          >
            <Share2 className="w-3.5 h-3.5 text-[#FFD200]" />
            <span>{copiedShare ? 'Copied!' : 'Share'}</span>
          </button>

          <button
            onClick={isInstallable ? install : handleAddMoreCoins}
            className="min-h-[44px] flex-1 py-1.5 px-3 rounded-full bg-gradient-to-b from-[#0B58D8] to-[#022A78] border-2 border-[#FFD200] text-xs font-black text-white shadow-md flex items-center justify-center gap-1.5 hover:brightness-110 active:scale-95 transition-transform cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[#FFD200]" />
            <span>Install</span>
          </button>
        </div>

        {/* 6. Stack of Gold Coins Pedestal & Footer Copyright */}
        <div className="relative flex items-center justify-center pt-2 pb-1">
          {/* Stack of Coins Icon (Bottom Left as in screenshot) */}
          <button
            onClick={handleAddMoreCoins}
            className="absolute left-1 bottom-0 cursor-pointer active:scale-90 transition-transform flex flex-col items-center"
            title="Collect Daily Coins"
          >
            <div className="text-2xl filter drop-shadow">💰</div>
            <div className="w-8 h-2 rounded-full bg-yellow-400/40 border border-yellow-400" />
          </button>

          {/* Copyright Version Badge */}
          <div className="flex items-center gap-1 text-[11px] font-bold text-sky-300 select-none">
            <span>©</span>
            <span className="w-3.5 h-3.5 rounded-full bg-[#0284C7] text-[8px] text-white flex items-center justify-center font-bold">
              L
            </span>
            <span className="w-3.5 h-3.5 rounded-full bg-[#DC2626] text-[8px] text-white flex items-center justify-center font-bold">
              U
            </span>
            <span className="w-3.5 h-3.5 rounded-full bg-[#16A34A] text-[8px] text-white flex items-center justify-center font-bold">
              D
            </span>
            <span className="w-3.5 h-3.5 rounded-full bg-[#CA8A04] text-[8px] text-white flex items-center justify-center font-bold">
              O
            </span>
            <span className="text-[#FFD200] ml-0.5">ARENA</span>
            <span className="text-sky-400 font-mono text-[9px] ml-1">v1.7.1</span>
          </div>
        </div>
      </div>
    </div>
  );
};
