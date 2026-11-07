/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import confetti from 'canvas-confetti';
import { ArrowRight, RotateCcw, Sparkles, Trophy } from 'lucide-react';
import React, { useEffect, useMemo } from 'react';
import { sound } from '../../audio/soundEffects';
import { COLOR_THEMES } from '../../engine/constants';
import { GameState, PlayerColor } from '../../engine/types';

interface ResultsModalProps {
  gameState: GameState;
  onRematch: () => void;
  onExitLobby: () => void;
  showRematch?: boolean;
  isOnline?: boolean;
  isRoomHost?: boolean;
  rematchRequested?: boolean;
  rematchRequestCount?: number;
  connectedHumanCount?: number;
  isConnected?: boolean;
  statusMessage?: string;
}

// Sparkle / Particle definition for CSS animations
interface SparkleParticle {
  id: number;
  left: number; // percentage 0..100
  top: number; // percentage 0..100
  size: number; // size in px
  delay: number; // seconds
  duration: number; // seconds
  color: string;
  symbol: string;
}

export const ResultsModal: React.FC<ResultsModalProps> = ({
  gameState,
  onRematch,
  onExitLobby,
  showRematch = true,
  isOnline = false,
  isRoomHost = false,
  rematchRequested = false,
  rematchRequestCount = 0,
  connectedHumanCount = 0,
  isConnected = true,
  statusMessage = '',
}) => {
  const { winnerColor, players, isTeamMode, winningTeam } = gameState;
  const safeWinnerColor: PlayerColor = winnerColor || 'red';
  const winnerTheme = COLOR_THEMES[safeWinnerColor];
  const winningPlayer = players.find((p) => p.color === winnerColor) || players[0];
  const isHumanWinner = winningPlayer && !winningPlayer.isBot;

  // Victory fanfare and confetti only when the local player wins
  useEffect(() => {
    if (!isHumanWinner) {
      sound.playTurnNotification();
      return;
    }

    sound.playVictory();
    try {
      confetti({
        particleCount: 100,
        spread: 90,
        origin: { y: 0.5 },
        colors: ['#FFD200', '#E52521', '#00A651', '#0088FF', '#FFFFFF'],
      });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tokens the winning side got home (a whole team in 2v2)
  const winnerTokens = isTeamMode
    ? players
        .filter((p) => p.teamId === winningTeam)
        .reduce((sum, p) => sum + p.tokensFinished, 0)
    : winningPlayer?.tokensFinished ?? 0;
  const tokensNeeded = isTeamMode ? 8 : 4;

  // Generate 42 CSS-based sparkle and particle items with deterministic varied coordinates
  const particles: SparkleParticle[] = useMemo(() => {
    const symbols = ['✦', '✧', '✨', '★', '●', '◆'];
    const palette = [
      '#FFD200',
      '#FFFFFF',
      winnerTheme.primary,
      '#60A5FA',
      '#34D399',
      '#F472B6',
    ];

    return Array.from({ length: 42 }).map((_, i) => {
      // Deterministic spread across width and height
      const left = (i * 17 + 7) % 96;
      const top = (i * 23 + 5) % 92;
      const size = 10 + (i % 5) * 4;
      const delay = ((i * 13) % 25) / 10; // 0.0s to 2.4s
      const duration = 1.6 + ((i * 7) % 15) / 10; // 1.6s to 3.0s
      const color = palette[i % palette.length];
      const symbol = symbols[i % symbols.length];

      return {
        id: i,
        left,
        top,
        size,
        delay,
        duration,
        color,
        symbol,
      };
    });
  }, [winnerTheme.primary]);

  // Sort players by finished count descending
  const sortedPlayers = [...players].sort((a, b) => b.tokensFinished - a.tokensFinished);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 select-none overflow-hidden animate-fadeIn">
      {/* 1. Full-Screen Backdrop with Dark Radial Vignette */}
      <div
        className="absolute inset-0 bg-black/85 backdrop-blur-md"
        style={{
          backgroundImage: `radial-gradient(circle at 50% 45%, ${winnerTheme.glow} 0%, rgba(7, 36, 104, 0.7) 40%, rgba(0, 0, 0, 0.9) 85%)`,
        }}
      />

      {/* 2. Rotating Golden Sunburst in Background */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
        <div
          className="w-[520px] h-[520px] rounded-full animate-sunburst"
          style={{
            background:
              'conic-gradient(from 0deg, #FFD200 0deg 15deg, transparent 15deg 30deg, #FFD200 30deg 45deg, transparent 45deg 60deg, #FFD200 60deg 75deg, transparent 75deg 90deg, #FFD200 90deg 105deg, transparent 105deg 120deg, #FFD200 120deg 135deg, transparent 135deg 150deg, #FFD200 150deg 165deg, transparent 165deg 180deg, #FFD200 180deg 195deg, transparent 195deg 210deg, #FFD200 210deg 225deg, transparent 225deg 240deg, #FFD200 240deg 255deg, transparent 255deg 270deg, #FFD200 270deg 285deg, transparent 285deg 300deg, #FFD200 300deg 315deg, transparent 315deg 330deg, #FFD200 330deg 345deg, transparent 345deg 360deg)',
            filter: 'blur(1px)',
          }}
        />
      </div>

      {/* 3. CSS Particle & Sparkle Overlay Field */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {particles.map((p) => {
          const isFloatingParticle = p.id % 2 === 0;

          return (
            <div
              key={p.id}
              className={`absolute select-none font-black ${
                isFloatingParticle ? 'animate-particle-float' : 'animate-sparkle-twinkle'
              }`}
              style={{
                left: `${p.left}%`,
                top: `${p.top}%`,
                fontSize: `${p.size}px`,
                color: p.color,
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.duration}s`,
                textShadow: `0 0 10px ${p.color}, 0 0 20px ${p.color}`,
              }}
            >
              {p.symbol}
            </div>
          );
        })}
      </div>

      {/* 4. Victory Center Card with Grand Entrance */}
      <div className="relative z-10 w-full max-w-[400px] rounded-3xl bg-gradient-to-b from-[#0B5FD8] via-[#0444B4] to-[#022878] border-[3px] border-[#FFD200] p-5 shadow-[0_10px_40px_rgba(0,0,0,0.8),0_0_30px_rgba(255,210,0,0.4)] space-y-3.5 text-center animate-victory-pop">
        {/* Crown Trophy & 4-Tokens Home Icon */}
        <div className="relative mx-auto w-20 h-20 rounded-2xl bg-gradient-to-b from-[#FFD200] via-[#FFB800] to-[#FFA000] p-1 shadow-2xl flex items-center justify-center border-2 border-white">
          <div className="w-full h-full rounded-xl bg-[#002D80] flex flex-col items-center justify-center relative overflow-hidden">
            <span className="text-3xl filter drop-shadow">🏆</span>

            {/* 4 Small Golden Token Dots representing all 4 tokens finished in center */}
            <div className="flex items-center gap-1 mt-0.5">
              {[0, 1, 2, 3].map((dotIdx) => (
                <span
                  key={dotIdx}
                  className="w-2 h-2 rounded-full border border-white shadow-sm"
                  style={{ backgroundColor: winnerTheme.primary }}
                />
              ))}
            </div>
          </div>

          {/* Sparkle badge on corner of trophy */}
          <span className="absolute -top-2 -right-2 text-xl animate-spin" style={{ animationDuration: '4s' }}>
            ✨
          </span>
        </div>

        {/* Victory Announcement & Congratulations */}
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-[#FFD200] text-slate-950 font-black text-[10px] tracking-widest uppercase shadow">
            <Sparkles className="w-3 h-3 text-[#072468]" />
            <span>
              {winnerTokens} / {tokensNeeded} TOKENS IN CENTER
            </span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-black text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] tracking-tight">
            {isTeamMode
              ? `Team ${winningTeam === 'team_A' ? 'Alpha' : 'Omega'} Wins!`
              : `${winningPlayer?.name ?? 'Player'} Wins!`}
          </h2>

          <p className="text-xs text-sky-200 font-bold px-2">
            {isTeamMode
              ? isHumanWinner
                ? 'Your team brought every token to the center. Victory!'
                : `${winningTeam === 'team_A' ? 'Team Alpha' : 'Team Omega'} brought every token to the center.`
              : isHumanWinner
              ? 'Congratulations! You brought all 4 tokens to the center and conquered the board!'
              : `${winningPlayer?.name} brought all 4 tokens to the center first.`}
          </p>

        </div>

        {/* Podium Final Standings */}
        <div className="rounded-2xl bg-[#002D80]/90 border border-sky-400/40 p-2.5 space-y-1.5 text-left shadow-inner">
          <div className="text-[10px] font-mono font-bold text-sky-300 uppercase px-1 flex items-center justify-between">
            <span>Player</span>
            <span>Tokens Reached</span>
          </div>

          {sortedPlayers.map((player, idx) => {
            const theme = COLOR_THEMES[player.color];
            const isWinner = player.color === safeWinnerColor;

            return (
              <div
                key={player.id}
                className={`p-2 rounded-xl flex items-center justify-between text-xs border transition-all ${
                  isWinner
                    ? 'bg-[#FFD200]/25 border-[#FFD200] shadow-sm'
                    : 'bg-[#001D54]/70 border-sky-500/20'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="w-5 text-center font-bold text-sm">
                    {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '4th'}
                  </span>
                  <div
                    className="w-6 h-6 rounded-md flex items-center justify-center font-black text-[10px] text-white border border-white shadow"
                    style={{ backgroundColor: theme.primary }}
                  >
                    {player.color.charAt(0).toUpperCase()}
                  </div>
                  <span className={`font-black ${isWinner ? 'text-[#FFD200]' : 'text-white'}`}>
                    {player.name}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 font-mono font-black">
                  <span className={isWinner ? 'text-[#FFD200]' : 'text-sky-200'}>
                    {player.tokensFinished}/4
                  </span>
                  {player.tokensFinished === 4 && <span>🏁</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Action Rematch & Lobby Buttons */}
        {isOnline && statusMessage && (
          <p role="alert" className="text-xs font-bold text-red-100">{statusMessage}</p>
        )}
        <div className="flex gap-2 pt-1">
          {showRematch && <button
            onClick={onRematch}
            disabled={isOnline && (!isConnected || rematchRequested)}
            className="flex-1 min-h-[48px] py-2.5 rounded-xl bg-gradient-to-r from-[#FFD200] via-[#FFB800] to-[#FFA000] text-[#072468] font-black text-xs uppercase tracking-wider hover:brightness-110 active:scale-95 transition-transform shadow-lg flex items-center justify-center gap-1.5 cursor-pointer border border-white disabled:cursor-not-allowed disabled:opacity-70"
          >
            <RotateCcw className="w-4 h-4 stroke-[3]" />
            <span>
              {isOnline
                ? rematchRequested
                  ? `Waiting (${rematchRequestCount}/${connectedHumanCount})`
                  : `Request Rematch (${rematchRequestCount}/${connectedHumanCount})`
                : 'Play Again'}
            </span>
          </button>}

          <button
            onClick={onExitLobby}
            className={`${showRematch ? 'flex-1' : 'w-full'} min-h-[48px] px-4 py-2.5 rounded-xl bg-[#004ECC] hover:bg-[#005FE0] text-white font-black text-xs border border-sky-300 transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 shadow`}
          >
            <span>{isOnline && isRoomHost ? 'Back to Room' : 'Exit to Lobby'}</span>
            <ArrowRight className="w-4 h-4 stroke-[3]" />
          </button>
        </div>
      </div>
    </div>
  );
};
