/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Globe, Home, Menu, Play, Settings, Trophy, User, Users, X } from 'lucide-react';
import React, { useState } from 'react';
import { PWAInstallBanner } from '../pwa/PWAInstallBanner';

export type ActiveScreen =
  | 'lobby'
  | 'solo_setup'
  | 'room_lobby'
  | 'matchmaking'
  | 'board_game'
  | 'profile'
  | 'leaderboard'
  | 'settings';

interface TopNavBarProps {
  currentScreen: ActiveScreen;
  onNavigate: (screen: ActiveScreen) => void;
  onQuickPlay: () => void;
}

const navigationItems = [
  { screen: 'lobby' as const, label: 'Lobby', icon: Home },
  { screen: 'room_lobby' as const, label: 'Rooms', icon: Users },
  { screen: 'leaderboard' as const, label: 'Leaderboard', icon: Trophy },
  { screen: 'matchmaking' as const, label: 'Matchmaking', icon: Globe },
  { screen: 'profile' as const, label: 'Profile', icon: User },
  { screen: 'settings' as const, label: 'Settings', icon: Settings },
];

export const TopNavBar: React.FC<TopNavBarProps> = ({
  currentScreen,
  onNavigate,
  onQuickPlay,
}) => {
  const [open, setOpen] = useState(false);

  // These screens have their own back controls; keep the floating menu clear
  // of their compact headers and primary actions.
  if (['board_game', 'room_lobby', 'matchmaking', 'leaderboard'].includes(currentScreen)) return null;

  const navigate = (screen: ActiveScreen) => {
    onNavigate(screen);
    setOpen(false);
  };

  return (
    <div className="fixed right-2.5 top-2 z-40 flex flex-col items-end gap-2">
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border-2 border-[#FFD200] bg-gradient-to-b from-[#0B64F0] to-[#003B99] text-[#FFD200] shadow-lg hover:brightness-110 active:scale-95 transition-all cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        aria-label={open ? 'Close game menu' : 'Open game menu'}
        aria-expanded={open}
        title={open ? 'Close menu' : 'Open menu'}
      >
        {open ? <X className="h-5 w-5 stroke-[2.5]" /> : <Menu className="h-5 w-5 stroke-[2.5]" />}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 -z-10" onClick={() => setOpen(false)} />
          <nav
            aria-label="Game navigation"
            className="flex flex-col gap-1.5 rounded-2xl border-2 border-[#FFD200] bg-gradient-to-b from-[#0847B8] to-[#021E5C] p-2 shadow-2xl backdrop-blur min-w-[170px]"
          >
            <button
              onClick={() => { onQuickPlay(); setOpen(false); }}
              className="flex min-h-10 w-full items-center gap-2.5 px-3 rounded-xl bg-gradient-to-r from-[#FFD200] to-[#FFA000] text-[#072468] font-black text-xs uppercase tracking-wide hover:brightness-110 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-white shadow"
              aria-label="Quick play versus bots"
              title="Quick play versus bots"
            >
              <Play className="h-4 w-4 fill-current shrink-0" />
              <span>Quick Play</span>
            </button>
            {navigationItems.map(({ screen, label, icon: Icon }) => (
              <button
                key={screen}
                onClick={() => navigate(screen)}
                className={`flex min-h-10 w-full items-center gap-2.5 px-3 rounded-xl border text-xs font-black tracking-wide transition-all cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${
                  currentScreen === screen
                    ? 'border-white bg-[#FFD200] text-[#072468] shadow'
                    : 'border-sky-400/30 bg-[#002B7A]/90 text-white hover:bg-[#003B99]'
                }`}
                aria-label={label}
                aria-current={currentScreen === screen ? 'page' : undefined}
                title={label}
              >
                <Icon className={`h-4 w-4 shrink-0 ${currentScreen === screen ? 'text-[#072468]' : 'text-[#FFD200]'}`} />
                <span>{label}</span>
              </button>
            ))}
            <div className="flex items-center justify-center pt-0.5" aria-label="Install app">
              <PWAInstallBanner />
            </div>
          </nav>
        </>
      )}
    </div>
  );
};
