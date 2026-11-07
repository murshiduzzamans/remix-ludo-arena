/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ArrowLeft, Check, Copy, Link2, Loader2, Play, Users, Wifi, WifiOff } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { sound } from '../../audio/soundEffects';
import { COLOR_ORDER, COLOR_TEAMS, COLOR_THEMES } from '../../engine/constants';
import { DEFAULT_RULES } from '../../engine/gameEngine';
import type { GameRules, TeamId } from '../../engine/types';
import { OnlineRoomConnection } from '../../network/onlineClient';
import type { RoomEvent } from '../../network/onlineClient';
import type { RoomParticipant, RoomSnapshot } from '../../network/protocol';

interface RoomLobbyScreenProps {
  onStartOnlineMatch: (connection: OnlineRoomConnection) => void;
  onBack: () => void;
  initialRoomCode?: string | null;
  rules: GameRules;
  existingConnection?: OnlineRoomConnection | null;
}

function getSavedPlayerName(): string {
  try { return window.localStorage.getItem('ludo-player-name') || 'Player'; } catch { return 'Player'; }
}

export const RoomLobbyScreen: React.FC<RoomLobbyScreenProps> = ({
  onStartOnlineMatch,
  onBack,
  initialRoomCode,
  rules,
  existingConnection,
}) => {
  const [playerName, setPlayerName] = useState(getSavedPlayerName);
  const [joinCode, setJoinCode] = useState(initialRoomCode ?? '');
  const [mode, setMode] = useState<'classic_4p' | 'team_2v2'>('classic_4p');
  const [connection, setConnection] = useState<OnlineRoomConnection | null>(() => existingConnection ?? null);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const transferredToGame = useRef(false);

  useEffect(() => {
    if (!connection) return;
    return connection.subscribe((event: RoomEvent) => {
      if (event.type === 'room') setRoom(event.room);
      if (event.type === 'connection') setConnected(event.connected);
      if (event.type === 'error') setError(event.message);
      if (event.type === 'game') {
        transferredToGame.current = true;
        onStartOnlineMatch(connection);
      }
    });
  }, [connection, onStartOnlineMatch]);

  useEffect(() => {
    if (!initialRoomCode || connection || existingConnection) return;
    let cancelled = false;
    setBusy(true);
    setError('');
    void OnlineRoomConnection.reconnect(initialRoomCode, getSavedPlayerName())
      .then((nextConnection) => {
        if (cancelled) {
          nextConnection?.close();
          return;
        }
        if (!nextConnection) return;
        setConnection(nextConnection);
        setRoom(nextConnection.currentRoom);
        setConnected(true);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not reconnect to your game.');
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => { cancelled = true; };
  }, [connection, existingConnection, initialRoomCode]);

  useEffect(() => () => {
    if (!transferredToGame.current) connection?.close();
  }, [connection]);

  const connectToRoom = async (action: () => Promise<OnlineRoomConnection>) => {
    const trimmedName = playerName.trim();
    if (!trimmedName) {
      setError('Enter your name first.');
      return;
    }
    setBusy(true);
    setError('');
    try { window.localStorage.setItem('ludo-player-name', trimmedName.slice(0, 24)); } catch { /* Name stays in component state. */ }
    try {
      const nextConnection = await action();
      const roomUrl = new URL(window.location.href);
      roomUrl.searchParams.set('room', nextConnection.roomCode);
      window.history.replaceState({}, '', roomUrl);
      setConnection(nextConnection);
      setRoom(nextConnection.currentRoom);
      setConnected(true);
      sound.triggerHaptic(20);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not connect to that room.');
    } finally {
      setBusy(false);
    }
  };

  const createRoom = () => connectToRoom(() => OnlineRoomConnection.create({
    mode,
    playerName: playerName.trim().slice(0, 24),
    rules: rules ?? DEFAULT_RULES,
  }));

  const joinRoom = () => connectToRoom(() => OnlineRoomConnection.join(joinCode, playerName.trim().slice(0, 24)));

  const shareInvite = async () => {
    if (!room) return;
    const url = OnlineRoomConnection.inviteUrl(room.code);
    try {
      if (navigator.share) await navigator.share({ title: 'Join my Ludo Arena room', text: `Join my Ludo Arena game with code ${room.code}`, url });
      else {
        await navigator.clipboard.writeText(`${url}\nRoom code: ${room.code}`);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      // Closing the native share sheet is not an error.
    }
  };

  const currentPlayer = room?.participants.find((participant) => participant.id === connection?.participantId);
  const currentTeam = currentPlayer ? currentPlayer.teamId ?? COLOR_TEAMS[currentPlayer.color] : undefined;
  const pendingTeamSwap = room?.teamSwapRequest ?? null;
  const pendingSwapRequester = room?.participants.find((participant) => participant.id === pendingTeamSwap?.requesterId);
  const isPendingSwapTarget = pendingTeamSwap?.targetId === currentPlayer?.id;
  const swapCandidates = room?.participants.filter((participant) =>
    participant.id !== currentPlayer?.id && !participant.isBot && participant.isConnected &&
    (participant.teamId ?? COLOR_TEAMS[participant.color]) !== currentTeam
  ) ?? [];
  const getTeamRoster = (teamId: TeamId): Array<RoomParticipant | null> => {
    if (!room) return [];
    const members = room.participants
      .filter((participant) => (participant.teamId ?? COLOR_TEAMS[participant.color]) === teamId)
      .sort((a, b) => COLOR_ORDER.indexOf(a.color) - COLOR_ORDER.indexOf(b.color));
    return [...members, ...Array.from({ length: Math.max(0, 2 - members.length) }, () => null)];
  };
  const canStart = Boolean(
    currentPlayer?.isHost && room && room.participants.length >= 2 && room.participants.every((participant) => participant.isReady) && connected && !room.teamSwapRequest
  );

  return (
    <div className="min-h-[100dvh] w-full bg-[#092569] px-4 py-3 text-white" style={{ backgroundImage: 'radial-gradient(circle at 50% 20%, rgba(20,80,200,.35), transparent 60%)' }}>
      <div className="mx-auto flex w-full max-w-lg flex-col gap-3">
        <header className="flex items-center justify-between rounded-2xl border border-sky-400/40 bg-[#0052CC] px-3 py-2 shadow-lg">
          <button onClick={onBack} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-[#003B99]" aria-label="Back to lobby">
            <ArrowLeft className="h-5 w-5 text-[#FFD200]" />
          </button>
          <h1 className="text-sm font-black uppercase tracking-wide text-[#FFD200]">Play with friends</h1>
          <div className="flex items-center gap-1 text-xs font-bold" aria-label={connected ? 'Connected' : 'Not connected'}>
            {connected ? <Wifi className="h-4 w-4 text-emerald-300" /> : <WifiOff className="h-4 w-4 text-amber-300" />}
            <span>{connected ? 'Live' : 'Offline'}</span>
          </div>
        </header>

        {!room ? (
          <>
            {busy && initialRoomCode && <div role="status" className="rounded-xl border border-sky-300/40 bg-[#063278] p-3 text-center text-xs font-semibold text-sky-100">Reconnecting to your game…</div>}
            {!OnlineRoomConnection.configured && (
              <div role="status" className="rounded-xl border border-amber-400/40 bg-amber-950/40 p-3 text-xs font-semibold text-amber-200">
                Add the multiplayer Worker URL to <code>.env</code> to enable friend rooms. The server setup steps are in the README.
              </div>
            )}
            {error && <div role="alert" className="rounded-xl border border-red-400/40 bg-red-950/50 p-3 text-xs font-semibold text-red-100">{error}</div>}

            <section className="space-y-3 rounded-2xl border-2 border-[#FFD200] bg-gradient-to-b from-[#0B64F0] to-[#023188] p-4 shadow-xl">
              <div className="flex items-center gap-2 text-sm font-black uppercase text-[#FFD200]"><Users className="h-4 w-4" /> Create a private room</div>
              <label className="block text-xs font-bold text-sky-100">Your name
                <input value={playerName} maxLength={24} onChange={(event) => setPlayerName(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-sky-300/40 bg-[#00245F] px-3 text-sm text-white outline-none focus:border-amber-300" placeholder="Your name" />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setMode('classic_4p')} className={`min-h-11 rounded-xl border px-2 text-xs font-black ${mode === 'classic_4p' ? 'border-white bg-amber-400 text-slate-950' : 'border-sky-300/40 bg-[#00245F]'}`}>4P CLASSIC</button>
                <button onClick={() => setMode('team_2v2')} className={`min-h-11 rounded-xl border px-2 text-xs font-black ${mode === 'team_2v2' ? 'border-white bg-amber-400 text-slate-950' : 'border-sky-300/40 bg-[#00245F]'}`}>2V2 TEAM</button>
              </div>
              <p className="text-[11px] leading-relaxed text-sky-100">Create a room, share its link or code, then start once at least one friend is ready. Empty seats are filled by server bots.</p>
              <button disabled={!OnlineRoomConnection.configured || busy} onClick={createRoom} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-white bg-gradient-to-r from-[#FFD200] to-[#FFA000] text-sm font-black uppercase text-[#072468] disabled:cursor-not-allowed disabled:opacity-50">
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5 fill-current" />} Create Room
              </button>
            </section>

            <section className="space-y-3 rounded-2xl border border-sky-300/40 bg-[#063278] p-4">
              <h2 className="text-sm font-black uppercase text-white">Join a friend</h2>
              <label className="block text-xs font-bold text-sky-100">Room code
                <input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} maxLength={11} className="mt-1 min-h-11 w-full rounded-xl border border-sky-300/40 bg-[#00245F] px-3 font-mono text-lg font-black tracking-widest text-white outline-none focus:border-amber-300" placeholder="LUDO-ABC234" />
              </label>
              <button disabled={!OnlineRoomConnection.configured || busy || !joinCode.trim()} onClick={joinRoom} className="min-h-12 w-full rounded-xl border border-sky-200 bg-[#0052CC] text-sm font-black uppercase disabled:opacity-50">Join Room</button>
            </section>
          </>
        ) : (
          <>
            {error && <div role="alert" className="rounded-xl border border-red-400/40 bg-red-950/50 p-3 text-xs font-semibold text-red-100">{error}</div>}
            <section className="space-y-3 rounded-2xl border-2 border-[#FFD200] bg-gradient-to-b from-[#0B64F0] to-[#023188] p-4 shadow-xl">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-black uppercase text-sky-100">Room code</p>
                  <p className="font-mono text-xl font-black tracking-widest text-white">{room.code}</p>
                </div>
                <button onClick={() => void shareInvite()} className="flex min-h-11 items-center gap-2 rounded-xl bg-amber-400 px-3 text-xs font-black text-slate-950">
                  {copied ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}{copied ? 'Copied' : 'Share invite'}
                </button>
              </div>
              <button onClick={() => void navigator.clipboard?.writeText(room.code)} className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-sky-200/30 bg-[#00245F] text-xs font-bold text-sky-100"><Copy className="h-4 w-4" /> Copy room code</button>
            </section>

            <section className="space-y-3 rounded-2xl border border-sky-300/40 bg-[#063278] p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black uppercase text-[#FFD200]">Players ({room.participants.length}/{room.maxPlayers})</h2>
                <span className="text-[10px] font-bold text-sky-200">{room.mode === 'team_2v2' ? '2V2 TEAM' : '4P CLASSIC'}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {room.mode === 'team_2v2' ? (['team_A', 'team_B'] as const).map((teamId) => {
                  const teamName = teamId === 'team_A' ? 'Team A' : 'Team B';
                  return (
                    <div key={teamId} className="col-span-2 rounded-xl border border-amber-300/40 bg-slate-950/20 p-2">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-black uppercase tracking-wide text-amber-200">{teamName} · teammates</span>
                        <span className="text-[10px] font-bold text-sky-100">{getTeamRoster(teamId).filter(Boolean).length}/2 seats</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {getTeamRoster(teamId).map((participant, index) => {
                          const theme = participant ? COLOR_THEMES[participant.color] : null;
                          return (
                            <div key={participant?.id ?? `${teamId}-open-${index}`} className="flex min-h-[70px] items-center gap-2 rounded-xl border border-sky-300/30 bg-[#00245F] p-2">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-2 border-white text-sm font-black text-white" style={{ backgroundColor: theme?.primary ?? '#063278' }}>{participant ? participant.color.slice(0, 1).toUpperCase() : '+'}</span>
                              <span className="min-w-0">
                                <span className="block truncate text-xs font-black">{participant?.name ?? 'Open seat'}</span>
                                <span className="block text-[10px] font-bold text-sky-200">{participant ? `${theme?.name} seat · ${participant.id === room.hostId ? 'Host' : participant.isConnected ? 'Connected' : 'Reconnecting'}` : 'Server bot if left open'}</span>
                              </span>
                              {participant?.isReady && <Check className="ml-auto h-4 w-4 shrink-0 text-emerald-300" />}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                }) : Array.from({ length: room.maxPlayers }, (_, index) => {
                  const participant = room.participants[index];
                  const theme = participant ? COLOR_THEMES[participant.color] : null;
                  return (
                    <div key={participant?.id ?? `empty-${index}`} className="flex min-h-[70px] items-center gap-2 rounded-xl border border-sky-300/30 bg-[#00245F] p-2">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-2 border-white text-sm font-black text-white" style={{ backgroundColor: theme?.primary ?? '#063278' }}>{room.mode === 'team_2v2' ? participant ? theme?.name.slice(0, 1) : '+' : participant ? '👤' : '+'}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-black">{participant?.name ?? 'Open seat'}</span>
                        <span className="text-[10px] text-sky-200">{participant ? `${theme?.name} player · ${participant.id === room.hostId ? 'Host' : participant.isConnected ? 'Connected' : 'Reconnecting'}` : 'Server bot if left open'}</span>
                      </span>
                      {participant?.isReady && <Check className="ml-auto h-4 w-4 shrink-0 text-emerald-300" />}
                    </div>
                  );
                })}
              </div>
              {room.mode === 'team_2v2' && (
                <div className="space-y-2 rounded-xl border border-amber-300/30 bg-slate-950/20 p-2">
                  <p className="text-center text-[10px] font-semibold text-sky-100">Team changes are available here before the match. Seat colors and turn order stay the same.</p>
                  {isPendingSwapTarget && pendingTeamSwap && pendingSwapRequester ? (
                    <div className="text-center" role="dialog" aria-label="Team switch request">
                      <p className="text-xs font-bold">{pendingSwapRequester.name} wants to switch teams with you.</p>
                      <div className="mt-2 flex justify-center gap-2">
                        <button className="min-h-10 rounded-lg bg-emerald-600 px-4 text-xs font-bold" onClick={() => connection?.respondToTeamSwap(pendingTeamSwap.id, true)}>Accept</button>
                        <button className="min-h-10 rounded-lg bg-slate-700 px-4 text-xs font-bold" onClick={() => connection?.respondToTeamSwap(pendingTeamSwap.id, false)}>Decline</button>
                      </div>
                    </div>
                  ) : pendingTeamSwap && pendingTeamSwap.requesterId === currentPlayer?.id ? (
                    <p className="text-center text-xs font-semibold text-sky-100" role="status">Waiting for {room.participants.find((participant) => participant.id === pendingTeamSwap.targetId)?.name ?? 'your friend'} to reply. The request expires automatically.</p>
                  ) : pendingTeamSwap ? (
                    <p className="text-center text-xs font-semibold text-sky-100" role="status">A team switch request is waiting for a reply.</p>
                  ) : currentPlayer ? (
                    <div className="flex flex-wrap justify-center gap-2">
                      {swapCandidates.length > 0 ? swapCandidates.map((candidate) => (
                        <button key={candidate.id} disabled={!connected} className="min-h-10 rounded-lg border border-amber-300/60 bg-slate-950/75 px-3 text-xs font-bold text-amber-100 disabled:opacity-50" onClick={() => connection?.requestTeamSwap(candidate.id)} aria-label={`Request to switch teams with ${candidate.name}`}>
                          Switch with {candidate.name}
                        </button>
                      )) : <span className="text-center text-xs text-sky-100">A connected player on the other team is needed to switch.</span>}
                    </div>
                  ) : null}
                </div>
              )}
              {!currentPlayer?.isHost && (
                <button onClick={() => connection?.setReady(!currentPlayer?.isReady)} disabled={!connected} className="min-h-11 w-full rounded-xl border border-sky-200 bg-[#0052CC] text-xs font-black uppercase disabled:opacity-50">
                  {currentPlayer?.isReady ? 'I’m Ready ✓' : 'Tap when you’re ready'}
                </button>
              )}
              {currentPlayer?.isHost && room.participants.length < 2 && <p className="text-center text-xs font-semibold text-amber-200">Share your invite and wait for a friend to join.</p>}
              {currentPlayer?.isHost && (
                <button onClick={() => connection?.startMatch()} disabled={!canStart} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-white bg-gradient-to-r from-[#FFD200] to-[#FFA000] text-sm font-black uppercase text-[#072468] disabled:cursor-not-allowed disabled:opacity-50">
                  <Play className="h-5 w-5 fill-current" /> Start Match
                </button>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
};
