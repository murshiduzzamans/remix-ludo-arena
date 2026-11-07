/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Home, Menu, Play, Settings, Trophy, Users, X } from 'lucide-react';
import React, { useState } from 'react';
import { PWAInstallBanner } from '../pwa/PWAInstallBanner';

export type ActiveScreen =
  | 'lobby'
  | 'solo_setup'
  | 'room_lobby'
  | 'matchmaking'
  | 'board_game'
  | 'profile'
  | 'settings';

interface TopNavBarProps {
  currentScreen: ActiveScreen;
  onNavigate: (screen: ActiveScreen) => void;
  onQuickPlay: () => void;
}

const navigationItems = [
  { screen: 'lobby' as const, label: 'Lobby', icon: Home },
  { screen: 'room_lobby' as const, label: 'Rooms', icon: Users },
  { screen: 'matchmaking' as const, label: 'Matchmaking', icon: Trophy },
  { screen: 'profile' as const, label: 'Profile', icon: Users },
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
  if (['board_game', 'room_lobby', 'matchmaking'].includes(currentScreen)) return null;

  const navigate = (screen: ActiveScreen) => {
    onNavigate(screen);
    setOpen(false);
  };

  return (
    <div className="fixed right-3 top-3 z-40 flex flex-col items-end gap-2">
      {open && (
        <nav
          aria-label="Game navigation"
          className="flex flex-col gap-2 rounded-2xl border border-slate-700 bg-slate-950/95 p-2 shadow-2xl backdrop-blur"
        >
          <button
            onClick={() => { onQuickPlay(); setOpen(false); }}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-amber-500 text-slate-950 hover:bg-amber-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            aria-label="Quick play versus bots"
            title="Quick play versus bots"
          >
            <Play className="h-5 w-5" />
          </button>
          {navigationItems.map(({ screen, label, icon: Icon }) => (
            <button
              key={screen}
              onClick={() => navigate(screen)}
              className={`flex min-h-11 min-w-11 items-center justify-center rounded-xl border focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${
                currentScreen === screen
                  ? 'border-amber-400 bg-amber-500 text-slate-950'
                  : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
              aria-label={label}
              aria-current={currentScreen === screen ? 'page' : undefined}
              title={label}
            >
              <Icon className="h-5 w-5" />
            </button>
          ))}
          <div className="flex min-h-11 min-w-11 items-center justify-center" aria-label="Install app">
            <PWAInstallBanner />
          </div>
        </nav>
      )}
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-600 bg-slate-950/90 text-slate-100 shadow-lg backdrop-blur hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400"
        aria-label={open ? 'Close game menu' : 'Open game menu'}
        aria-expanded={open}
        title={open ? 'Close menu' : 'Open menu'}
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
    </div>
  );
};
