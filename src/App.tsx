/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { sound } from './audio/soundEffects';
import { ActiveScreen, TopNavBar } from './components/navigation/TopNavBar';
import { OfflineIndicator } from './components/pwa/PWAInstallBanner';
import { BoardGameScreen } from './components/screens/BoardGameScreen';
import { LobbyScreen } from './components/screens/LobbyScreen';
import { MatchmakingScreen } from './components/screens/MatchmakingScreen';
import { ProfileScreen } from './components/screens/ProfileScreen';
import { RoomLobbyScreen } from './components/screens/RoomLobbyScreen';
import { SettingsScreen } from './components/screens/SettingsScreen';
import { SoloSetupScreen } from './components/screens/SoloSetupScreen';
import { DEFAULT_RULES } from './engine/gameEngine';
import { BotPersonality, GameMode, GameRules, PlayerColor } from './engine/types';
import { OnlineRoomConnection, roomCodeFromUrl } from './network/onlineClient';
import { loadSettings } from './storage/profileStore';

export default function App() {
  useEffect(() => { sound.setHapticsEnabled(loadSettings().hapticFeedback); }, []);
  const [inviteCode] = useState(() => roomCodeFromUrl());
  const [currentScreen, setCurrentScreen] = useState<ActiveScreen>(() => inviteCode ? 'room_lobby' : 'lobby');
  const [activeMode, setActiveMode] = useState<GameMode>('solo_bots');
  const [humanColor, setHumanColor] = useState<PlayerColor>('red');
  const [botPersonalities, setBotPersonalities] = useState<Record<PlayerColor, BotPersonality>>({
    red: 'balanced',
    green: 'aggressive',
    yellow: 'balanced',
    blue: 'defensive',
  });
  const [activeRules, setActiveRules] = useState<GameRules>(() => loadSettings().rules || DEFAULT_RULES);
  const [onlineSession, setOnlineSession] = useState<OnlineRoomConnection | null>(null);

  const startMatch = (
    mode: GameMode,
    color: PlayerColor = 'red',
    personalities?: Record<PlayerColor, BotPersonality>,
    customRules?: GameRules
  ) => {
    onlineSession?.close();
    setOnlineSession(null);
    setActiveMode(mode);
    setHumanColor(color);
    if (personalities) setBotPersonalities(personalities);
    if (customRules) setActiveRules(customRules);
    setCurrentScreen('board_game');
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#090D16] text-slate-100 font-sans">
      {/* Compact icon menu; no persistent top or bottom navigation bars. */}
      <TopNavBar
        currentScreen={currentScreen}
        onNavigate={setCurrentScreen}
        onQuickPlay={() => startMatch('solo_bots', 'red')}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col justify-center">
        {currentScreen === 'lobby' && (
          <LobbyScreen
            onSelectMode={(mode) => startMatch(mode, 'red')}
            onOpenSoloSetup={() => setCurrentScreen('solo_setup')}
            onOpenPrivateRooms={() => setCurrentScreen('room_lobby')}
            onOpenMatchmaking={() => setCurrentScreen('matchmaking')}
            onOpenProfile={() => setCurrentScreen('profile')}
            onOpenSettings={() => setCurrentScreen('settings')}
          />
        )}

        {currentScreen === 'solo_setup' && (
          <SoloSetupScreen
            onStartMatch={(mode, color, personalities, rules) =>
              startMatch(mode, color, personalities, rules)
            }
            onBack={() => setCurrentScreen('lobby')}
            initialRules={activeRules}
          />
        )}

        {currentScreen === 'room_lobby' && (
          <RoomLobbyScreen
            initialRoomCode={inviteCode}
            rules={activeRules}
            existingConnection={onlineSession}
            onStartOnlineMatch={(session) => {
              setOnlineSession(session);
              setActiveMode(session.currentRoom.mode);
              setHumanColor(session.localColor);
              setActiveRules(session.currentRoom.rules);
              setCurrentScreen('board_game');
            }}
            onBack={() => {
              window.history.replaceState({}, '', window.location.pathname);
              setOnlineSession(null);
              setCurrentScreen('lobby');
            }}
          />
        )}

        {currentScreen === 'matchmaking' && (
          <MatchmakingScreen
            onCancel={() => setCurrentScreen('lobby')}
            onEnterMatch={() => startMatch('classic_4p', 'red')}
          />
        )}

        {currentScreen === 'board_game' && (
          <BoardGameScreen
            initialMode={activeMode}
            humanColor={onlineSession?.localColor ?? humanColor}
            botPersonalities={botPersonalities}
            rules={onlineSession?.currentRoom.rules ?? activeRules}
            onlineSession={onlineSession ?? undefined}
            onExit={() => {
              onlineSession?.close();
              setOnlineSession(null);
              setCurrentScreen('lobby');
            }}
            onBackToRoom={() => setCurrentScreen('room_lobby')}
          />
        )}

        {currentScreen === 'profile' && (
          <ProfileScreen onBack={() => setCurrentScreen('lobby')} />
        )}

        {currentScreen === 'settings' && (
          <SettingsScreen onBack={() => setCurrentScreen('lobby')} />
        )}
      </main>

      {/* Offline Status Toast */}
      <OfflineIndicator />

    </div>
  );
}
