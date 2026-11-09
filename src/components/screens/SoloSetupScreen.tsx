/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ArrowLeft,
  Play,
  Scale,
  Shield,
  Swords,
} from 'lucide-react';
import React, { useState } from 'react';
import { sound } from '../../audio/soundEffects';
import { COLOR_ORDER, COLOR_THEMES } from '../../engine/constants';
import { BotPersonality, GameMode, GameRules, PlayerColor } from '../../engine/types';
import { loadCoins } from '../../storage/profileStore';

interface SoloSetupScreenProps {
  onStartMatch: (
    mode: GameMode,
    humanColor: PlayerColor,
    personalities: Record<PlayerColor, BotPersonality>,
    rules: GameRules
  ) => void;
  onBack: () => void;
  initialRules: GameRules;
}

export const SoloSetupScreen: React.FC<SoloSetupScreenProps> = ({
  onStartMatch,
  onBack,
  initialRules,
}) => {
  const [selectedMode, setSelectedMode] = useState<GameMode>('solo_bots');
  const [selectedColor, setSelectedColor] = useState<PlayerColor>('red');
  const [rules, setRules] = useState<GameRules>(initialRules);
  const [coins] = useState<number>(loadCoins);

  const [personalities, setPersonalities] = useState<Record<PlayerColor, BotPersonality>>({
    red: 'balanced',
    green: 'aggressive',
    yellow: 'balanced',
    blue: 'defensive',
  });

  const handlePersonalityChange = (color: PlayerColor, p: BotPersonality) => {
    sound.playMove();
    sound.triggerHaptic(15);
    setPersonalities((prev) => ({ ...prev, [color]: p }));
  };

  const handleColorChange = (color: PlayerColor) => {
    sound.playMove();
    sound.triggerHaptic(20);
    setSelectedColor(color);
  };

  const handleModeChange = (mode: GameMode) => {
    sound.playMove();
    sound.triggerHaptic(20);
    setSelectedMode(mode);
  };

  const handleStart = () => {
    sound.playVictory();
    sound.triggerHaptic([30, 40, 50]);
    onStartMatch(selectedMode, selectedColor, personalities, rules);
  };

  // Bot avatar icons
  const botAvatars: Record<PlayerColor, string> = {
    red: '🦁',
    green: '🐯',
    yellow: '🤖',
    blue: '🏎️',
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
      {/* 1. Mobile Top Bar (Matching Lobby Header, with right padding reserved for TopNavBar) */}
      <header className="w-full bg-gradient-to-r from-[#0052CC] via-[#0066FF] to-[#0052CC] border-b-2 border-[#FFD200] shadow-lg pl-3 pr-16 py-1.5 flex items-center justify-between z-20">
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
            VS COMPUTER
          </span>
        </div>

        {/* Coins Pill */}
        <div className="flex items-center gap-1 px-3 py-1 rounded-md bg-[#003B99] border border-sky-400/50 shadow-inner font-mono font-black text-xs text-white">
          <span>{coins.toLocaleString()}</span>
          <span>🪙</span>
        </div>
      </header>

      {/* Main Container constrained to mobile phone canvas */}
      <div className="w-full max-w-[420px] mx-auto px-4 flex-1 flex flex-col justify-between py-2 space-y-3">
        {/* Section 0: Choose Game Mode (1v1, Classic 4P, 2v2 Team) */}
        <div className="w-full rounded-2xl bg-gradient-to-b from-[#0B64F0] via-[#0448BC] to-[#023188] border-[3px] border-[#FFD200] p-3 shadow-xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase text-[#FFD200] tracking-wide flex items-center gap-1.5">
              <span>⚔️</span>
              <span>MATCH FORMAT</span>
            </span>
            <span className="text-[10px] font-bold text-sky-200">
              {selectedMode === 'head_to_head_1v1'
                ? '1v1 Head-to-Head'
                : selectedMode === 'team_2v2'
                ? '2v2 Partnership'
                : 'Classic 4-Player'}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1.5 pt-1">
            <button
              type="button"
              onClick={() => handleModeChange('head_to_head_1v1')}
              className={`min-h-[46px] p-2 rounded-xl flex flex-col items-center justify-center transition-all cursor-pointer ${
                selectedMode === 'head_to_head_1v1'
                  ? 'bg-gradient-to-b from-[#FFD200] to-[#FFA000] border-2 border-white shadow-lg text-[#072468]'
                  : 'bg-[#003080] border border-sky-400/40 text-sky-200 hover:brightness-110'
              }`}
            >
              <span className="text-xs font-black">1v1 DUEL</span>
              <span className="text-[9px] font-bold opacity-80">Head-to-Head</span>
            </button>

            <button
              type="button"
              onClick={() => handleModeChange('solo_bots')}
              className={`min-h-[46px] p-2 rounded-xl flex flex-col items-center justify-center transition-all cursor-pointer ${
                selectedMode === 'solo_bots'
                  ? 'bg-gradient-to-b from-[#FFD200] to-[#FFA000] border-2 border-white shadow-lg text-[#072468]'
                  : 'bg-[#003080] border border-sky-400/40 text-sky-200 hover:brightness-110'
              }`}
            >
              <span className="text-xs font-black">CLASSIC</span>
              <span className="text-[9px] font-bold opacity-80">4-Player</span>
            </button>

            <button
              type="button"
              onClick={() => handleModeChange('team_2v2')}
              className={`min-h-[46px] p-2 rounded-xl flex flex-col items-center justify-center transition-all cursor-pointer ${
                selectedMode === 'team_2v2'
                  ? 'bg-gradient-to-b from-[#FFD200] to-[#FFA000] border-2 border-white shadow-lg text-[#072468]'
                  : 'bg-[#003080] border border-sky-400/40 text-sky-200 hover:brightness-110'
              }`}
            >
              <span className="text-xs font-black">2v2 TEAM</span>
              <span className="text-[9px] font-bold opacity-80">Partnership</span>
            </button>
          </div>
        </div>

        {/* Section 1: Choose Your Color */}
        <div className="w-full rounded-2xl bg-gradient-to-b from-[#0B64F0] via-[#0448BC] to-[#023188] border-[3px] border-[#FFD200] p-3 shadow-xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase text-[#FFD200] tracking-wide flex items-center gap-1.5">
              <span>👑</span>
              <span>YOUR COLOR</span>
            </span>
            <span className="text-[10px] font-bold text-sky-200">Tap to Select</span>
          </div>

          <div className="grid grid-cols-4 gap-2 pt-1">
            {COLOR_ORDER.map((color) => {
              const theme = COLOR_THEMES[color];
              const isSelected = selectedColor === color;

              return (
                <button
                  key={color}
                  onClick={() => handleColorChange(color)}
                  className={`min-h-[48px] py-2 rounded-xl flex flex-col items-center justify-center gap-1 transition-all cursor-pointer relative ${
                    isSelected
                      ? 'bg-gradient-to-b from-[#FFD200] to-[#FFA000] border-2 border-white shadow-lg scale-105'
                      : 'bg-[#003080] border border-sky-400/40 hover:brightness-110 active:scale-95'
                  }`}
                >
                  {/* Pawn Icon */}
                  <div
                    className="w-6 h-6 rounded-full border-2 border-white shadow flex items-center justify-center text-xs"
                    style={{ backgroundColor: theme.primary }}
                  >
                    {isSelected ? '✓' : ''}
                  </div>
                  <span
                    className={`text-[10px] font-black uppercase ${
                      isSelected ? 'text-[#072468]' : 'text-sky-200'
                    }`}
                  >
                    {color}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Section 2: AI Bot Opponents & Playstyles */}
        <div className="w-full rounded-2xl bg-gradient-to-b from-[#0B64F0] via-[#0448BC] to-[#023188] border-[3px] border-[#FFD200] p-3 shadow-xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase text-[#FFD200] tracking-wide flex items-center gap-1.5">
              <span>🤖</span>
              <span>BOT PERSONALITIES</span>
            </span>
            <span className="text-[10px] font-bold text-sky-200">3 Opponents</span>
          </div>

          <div className="space-y-2 pt-1">
            {COLOR_ORDER.filter((c) => c !== selectedColor).map((color) => {
              const theme = COLOR_THEMES[color];
              const currentP = personalities[color];

              return (
                <div
                  key={color}
                  className="p-2 rounded-xl bg-[#003080] border border-sky-400/40 flex items-center justify-between gap-2"
                >
                  {/* Bot Avatar + Name */}
                  <div className="flex items-center gap-2">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-base border-2 border-white shadow"
                      style={{ backgroundColor: theme.primary }}
                    >
                      {botAvatars[color]}
                    </div>
                    <div>
                      <span className="text-xs font-black text-white capitalize block">
                        Bot {color}
                      </span>
                      <span className="text-[9px] font-bold text-sky-300">
                        {currentP === 'aggressive'
                          ? '⚔️ Hunter'
                          : currentP === 'defensive'
                          ? '🛡️ Guardian'
                          : '⚖️ Tactician'}
                      </span>
                    </div>
                  </div>

                  {/* Icon Selectors: ⚔️ Hunter, 🛡️ Guardian, ⚖️ Tactician */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handlePersonalityChange(color, 'aggressive')}
                      title="Aggressive Hunter"
                      className={`min-h-[44px] min-w-[44px] rounded-lg flex items-center justify-center transition-all cursor-pointer ${
                        currentP === 'aggressive'
                          ? 'bg-[#FFD200] text-[#072468] font-black border border-white shadow'
                          : 'bg-[#002060] text-sky-300 border border-sky-500/30 hover:brightness-125'
                      }`}
                    >
                      <Swords className="w-4 h-4 stroke-[2.5]" />
                    </button>

                    <button
                      onClick={() => handlePersonalityChange(color, 'defensive')}
                      title="Defensive Guardian"
                      className={`min-h-[44px] min-w-[44px] rounded-lg flex items-center justify-center transition-all cursor-pointer ${
                        currentP === 'defensive'
                          ? 'bg-[#FFD200] text-[#072468] font-black border border-white shadow'
                          : 'bg-[#002060] text-sky-300 border border-sky-500/30 hover:brightness-125'
                      }`}
                    >
                      <Shield className="w-4 h-4 stroke-[2.5]" />
                    </button>

                    <button
                      onClick={() => handlePersonalityChange(color, 'balanced')}
                      title="Balanced Tactician"
                      className={`min-h-[44px] min-w-[44px] rounded-lg flex items-center justify-center transition-all cursor-pointer ${
                        currentP === 'balanced'
                          ? 'bg-[#FFD200] text-[#072468] font-black border border-white shadow'
                          : 'bg-[#002060] text-sky-300 border border-sky-500/30 hover:brightness-125'
                      }`}
                    >
                      <Scale className="w-4 h-4 stroke-[2.5]" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>



        {/* Launch Match Golden Button */}
        <div className="pt-1 pb-2">
          <button
            onClick={handleStart}
            className="w-full min-h-[50px] rounded-2xl bg-gradient-to-r from-[#FFD200] via-[#FFB800] to-[#FFA000] border-2 border-white shadow-xl hover:brightness-110 active:scale-95 transition-transform flex items-center justify-center gap-2 cursor-pointer font-black text-sm uppercase tracking-wider text-[#072468]"
          >
            <Play className="w-5 h-5 fill-[#072468]" />
            <span>START BATTLE</span>
          </button>
        </div>
      </div>
    </div>
  );
};
