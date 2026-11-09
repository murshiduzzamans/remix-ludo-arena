/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  ClipboardPaste,
  Clock3,
  Copy,
  Crown,
  Hash,
  Hand,
  Headphones,
  Info,
  Loader2,
  Pencil,
  Play,
  Share2,
  Shield,
  Swords,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { sound } from '../../audio/soundEffects';
import { COLOR_ORDER, COLOR_TEAMS, COLOR_THEMES } from '../../engine/constants';
import { DEFAULT_RULES } from '../../engine/gameEngine';
import type { GameRules, PlayerColor, TeamId } from '../../engine/types';
import { OnlineRoomConnection } from '../../network/onlineClient';
import type { OnlineRoomMode, RoomEvent } from '../../network/onlineClient';
import type { RoomParticipant, RoomSnapshot } from '../../network/protocol';
import { isAvatarEmoji } from '../../shared/avatars';
import { atomicUpdateProfile, DEFAULT_PROFILE, getProfileEmoji, safeLoadProfile } from '../../storage/profileStore';
import { OnlineChatDock } from '../social/OnlineChatDock';

interface RoomLobbyScreenProps {
  onStartOnlineMatch: (connection: OnlineRoomConnection) => void;
  onBack: () => void;
  initialRoomCode?: string | null;
  rules: GameRules;
  existingConnection?: OnlineRoomConnection | null;
  onSessionChange?: (connection: OnlineRoomConnection | null) => void;
  externalSocialDock?: boolean;
}

const PLAYER_NAME_KEY = 'ludo-player-name';
const NAME_LIMIT = 24;

/** Profile name wins; the legacy saved lobby name is used only while the profile still has the default name. */
function getInitialPlayerName(): string {
  const profileName = safeLoadProfile().name?.trim();
  if (profileName && profileName !== DEFAULT_PROFILE.name) return profileName;
  try { return window.localStorage.getItem(PLAYER_NAME_KEY) || profileName || 'Player'; } catch { return profileName || 'Player'; }
}

/** Accepts a bare code, a code with spaces, or a full invite link. */
function extractRoomCode(input: string): string {
  const trimmed = input.trim();
  try {
    const fromUrl = new URL(trimmed).searchParams.get('room');
    if (fromUrl) return fromUrl.toUpperCase();
  } catch { /* Not a URL. */ }
  const match = trimmed.toUpperCase().match(/LUDO-?[A-Z0-9]{6}/);
  if (match) return match[0].includes('-') ? match[0] : `LUDO-${match[0].slice(4)}`;
  return trimmed.toUpperCase().replace(/\s+/g, '').slice(0, 11);
}

// ─── Mode metadata ───────────────────────────────────────────────────────────

interface ModeOption {
  id: OnlineRoomMode;
  label: string;
  caption: string;
  icon: LucideIcon;
  description: string;
  activeSeats: readonly PlayerColor[];
}

const MODE_OPTIONS: readonly ModeOption[] = [
  {
    id: 'head_to_head_1v1',
    label: '1v1 Duel',
    caption: '2 players',
    icon: Swords,
    description: 'You play Red, your friend plays Yellow. No bots.',
    activeSeats: ['red', 'yellow'],
  },
  {
    id: 'classic_4p',
    label: 'Classic',
    caption: 'Up to 4',
    icon: Users,
    description: 'Up to 4 friends. Bots fill any empty seats.',
    activeSeats: COLOR_ORDER,
  },
  {
    id: 'team_2v2',
    label: '2v2 Team',
    caption: '2 teams',
    icon: Shield,
    description: 'Red & Yellow vs Green & Blue. Partners win together.',
    activeSeats: COLOR_ORDER,
  },
];

const MODE_LABELS: Record<string, string> = {
  head_to_head_1v1: '1V1 DUEL',
  team_2v2: '2V2 TEAM',
  classic_4p: '4P CLASSIC',
};

const MODE_ICONS: Record<string, LucideIcon> = {
  head_to_head_1v1: Swords,
  team_2v2: Shield,
  classic_4p: Users,
};

// Board corner layout used by the seat previews: top row red/green, bottom row blue/yellow.
const PREVIEW_LAYOUT: readonly PlayerColor[] = ['red', 'green', 'blue', 'yellow'];

const SeatPreview: React.FC<{ option: ModeOption; selected: boolean }> = ({ option, selected }) => (
  <span
    className={`relative grid h-9 w-9 grid-cols-2 gap-[3px] rounded-lg p-[3px] ${selected ? 'bg-[#072468]/15' : 'bg-white/5'}`}
    aria-hidden="true"
  >
    {PREVIEW_LAYOUT.map((color) => {
      const active = option.activeSeats.includes(color);
      const teamRing = option.id === 'team_2v2'
        ? COLOR_TEAMS[color] === 'team_A' ? 'ring-1 ring-white/80' : 'ring-1 ring-black/30'
        : '';
      return (
        <span
          key={color}
          className={`rounded-[3px] ${teamRing}`}
          style={{ backgroundColor: active ? COLOR_THEMES[color].primary : 'rgba(255,255,255,0.12)' }}
        />
      );
    })}
  </span>
);

// ─── Avatars & seats ─────────────────────────────────────────────────────────

interface SeatAvatarProps {
  participant: RoomParticipant;
  color: PlayerColor;
  size?: 'md' | 'lg';
  selfAvatarUrl?: string | null;
}

const SeatAvatar: React.FC<SeatAvatarProps> = ({ participant, color, size = 'md', selfAvatarUrl }) => {
  const dimension = size === 'lg' ? 'h-14 w-14 text-2xl' : 'h-10 w-10 text-lg';
  const theme = COLOR_THEMES[color];
  return (
    <span
      className={`relative flex ${dimension} shrink-0 items-center justify-center overflow-hidden rounded-full border-2 font-black text-white shadow-md`}
      style={{ backgroundColor: theme.primary, borderColor: theme.primaryLight }}
    >
      {selfAvatarUrl ? (
        <img src={selfAvatarUrl} alt="" className="h-full w-full object-cover" />
      ) : isAvatarEmoji(participant.avatar) ? (
        <span className="leading-none">{participant.avatar}</span>
      ) : (
        <span className="leading-none">{participant.name.trim().charAt(0).toUpperCase() || '?'}</span>
      )}
    </span>
  );
};

type SeatStatus = 'ready' | 'waiting' | 'reconnecting';

function seatStatus(participant: RoomParticipant, hostId: string): SeatStatus {
  const isHost = participant.id === hostId;
  if (!participant.isConnected && !isHost) return 'reconnecting';
  return isHost || participant.isReady ? 'ready' : 'waiting';
}

const STATUS_META: Record<SeatStatus, { label: string; icon: LucideIcon; className: string }> = {
  ready: { label: 'Ready', icon: Check, className: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300' },
  waiting: { label: 'Not ready', icon: Clock3, className: 'border-sky-300/25 bg-slate-950/30 text-sky-200' },
  reconnecting: { label: 'Reconnecting', icon: WifiOff, className: 'border-amber-400/40 bg-amber-500/15 text-amber-200' },
};

const StatusPill: React.FC<{ status: SeatStatus }> = ({ status }) => {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${meta.className}`}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {meta.label}
    </span>
  );
};

interface SeatTileProps {
  color: PlayerColor;
  participant: RoomParticipant | undefined;
  hostId: string;
  selfId: string | undefined;
  selfAvatarUrl: string | null | undefined;
  inVoice?: boolean;
}

/** Compact horizontal seat used by the 4-seat modes. */
const SeatTile: React.FC<SeatTileProps> = ({ color, participant, hostId, selfId, selfAvatarUrl, inVoice }) => {
  const theme = COLOR_THEMES[color];
  if (!participant) {
    return (
      <div className="flex min-h-[64px] items-center gap-2.5 rounded-xl border border-dashed border-white/15 bg-white/[0.03] p-2.5" aria-label={`${theme.name} seat open`}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-dashed text-white/60" style={{ borderColor: `${theme.primary}99` }}>
          <Bot className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-black text-white/70">Open</span>
          <span className="block text-[10px] font-semibold text-sky-300/80">{theme.name} · bot if empty</span>
        </span>
      </div>
    );
  }
  const isSelf = participant.id === selfId;
  const isHost = participant.id === hostId;
  return (
    <div className="relative flex min-h-[64px] items-center gap-2.5 overflow-hidden rounded-xl border border-white/10 bg-[#00245F] p-2.5 pl-3" aria-label={`${theme.name} seat: ${participant.name}`}>
      <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: theme.primary }} />
      <span className="relative shrink-0">
        <SeatAvatar participant={participant} color={color} selfAvatarUrl={isSelf ? selfAvatarUrl : undefined} />
        {inVoice && (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-[#00245F] bg-emerald-400 text-slate-950 shadow" title="In voice chat">
            <Headphones className="h-2.5 w-2.5" aria-hidden="true" />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className="truncate text-xs font-black text-white">{participant.name}</span>
          {isHost && <Crown className="h-3.5 w-3.5 shrink-0 text-[#FFD200]" aria-label="Host" />}
        </span>
        <span className="mt-0.5 flex items-center gap-1">
          <StatusPill status={seatStatus(participant, hostId)} />
          {isSelf && <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-black uppercase text-white/80">You</span>}
        </span>
      </span>
    </div>
  );
};

interface DuelSeatProps {
  participant: RoomParticipant | undefined;
  color: 'red' | 'yellow';
  hostId: string;
  isSelf: boolean;
  selfAvatarUrl: string | null | undefined;
  inVoice?: boolean;
}

/** Tall seat card used by the 1v1 VS layout. */
const DuelSeat: React.FC<DuelSeatProps> = ({ participant, color, hostId, isSelf, selfAvatarUrl, inVoice }) => {
  const theme = COLOR_THEMES[color];
  if (!participant) {
    return (
      <div className="flex min-h-[156px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/20 bg-white/[0.03] p-3 text-center" aria-label="Open opponent seat">
        <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed text-white/70" style={{ borderColor: `${theme.primary}aa` }}>
          <UserPlus className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="text-xs font-black text-white/80">Waiting for opponent</span>
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-300">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Share the invite
        </span>
      </div>
    );
  }

  const isHost = participant.id === hostId;
  return (
    <div
      className="relative flex min-h-[156px] flex-col items-center gap-2 overflow-hidden rounded-2xl border border-white/10 p-3 pt-4 text-center"
      style={{ background: `linear-gradient(180deg, ${theme.primary}33 0%, #00245F 55%)` }}
      aria-label={`${theme.name} seat: ${participant.name}`}
    >
      <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: theme.primary }} />
      <span className="relative">
        <SeatAvatar participant={participant} color={color} size="lg" selfAvatarUrl={isSelf ? selfAvatarUrl : undefined} />
        {isHost && (
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-[#072468] bg-[#FFD200]" aria-label="Host">
            <Crown className="h-3 w-3 text-[#072468]" aria-hidden="true" />
          </span>
        )}
        {inVoice && (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-[#072468] bg-emerald-400 text-slate-950 shadow" title="In voice chat">
            <Headphones className="h-3 w-3" aria-hidden="true" />
          </span>
        )}
      </span>
      <span className="w-full min-w-0">
        <span className="block truncate text-sm font-black text-white">{participant.name}</span>
        <span className="block text-[10px] font-bold uppercase tracking-wide text-sky-300">
          {theme.name}{isSelf ? ' · You' : ''}
        </span>
      </span>
      <span className="mt-auto"><StatusPill status={seatStatus(participant, hostId)} /></span>
    </div>
  );
};

// ─── Small building blocks ───────────────────────────────────────────────────

const IconButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; tone?: 'gold' | 'ghost' }> = ({
  label,
  tone = 'ghost',
  className = '',
  children,
  ...rest
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-40 ${
      tone === 'gold'
        ? 'bg-[#FFD200] text-[#072468] shadow-md hover:bg-[#FFDD33] active:bg-[#FFB800]'
        : 'border border-white/15 bg-white/5 text-sky-100 hover:bg-white/10'
    } ${className}`}
    {...rest}
  >
    {children}
  </button>
);

const Panel: React.FC<{ children: React.ReactNode; className?: string; highlight?: boolean }> = ({ children, className = '', highlight }) => (
  <section
    className={`rounded-2xl border p-4 shadow-[0_8px_24px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.08)] ${
      highlight ? 'border-[#FFD200]/70 bg-gradient-to-b from-[#0B4FC4] to-[#06297A]' : 'border-white/10 bg-gradient-to-b from-[#0A3384] to-[#072667]'
    } ${className}`}
  >
    {children}
  </section>
);

const SectionLabel: React.FC<{ children: React.ReactNode; id?: string }> = ({ children, id }) => (
  <p id={id} className="mb-2 text-[11px] font-black uppercase tracking-[0.12em] text-sky-200/90">{children}</p>
);

// ─── Screen ──────────────────────────────────────────────────────────────────

export const RoomLobbyScreen: React.FC<RoomLobbyScreenProps> = ({
  onStartOnlineMatch,
  onBack,
  initialRoomCode,
  rules,
  existingConnection,
  onSessionChange,
  externalSocialDock = false,
}) => {
  const [profile, setProfile] = useState(safeLoadProfile);
  const [playerName, setPlayerName] = useState(getInitialPlayerName);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(playerName);
  const [joinCode, setJoinCode] = useState(initialRoomCode ?? '');
  const [mode, setMode] = useState<OnlineRoomMode>('classic_4p');
  const [connection, setConnection] = useState<OnlineRoomConnection | null>(() => existingConnection ?? null);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const transferredToGame = useRef(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const profileEmoji = getProfileEmoji(profile);

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
    void OnlineRoomConnection.reconnect(initialRoomCode, getInitialPlayerName())
      .then((nextConnection) => {
        if (cancelled) {
          nextConnection?.close();
          return;
        }
        if (!nextConnection) return;
        setConnection(nextConnection);
        setRoom(nextConnection.currentRoom);
        setConnected(true);
        onSessionChange?.(nextConnection);
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

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus();
  }, [editingName]);

  // Keep the lobby avatar in step with profile edits made in other tabs/screens.
  useEffect(() => {
    const refresh = () => setProfile(safeLoadProfile());
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const commitName = () => {
    const trimmed = nameDraft.trim().slice(0, NAME_LIMIT);
    if (!trimmed) {
      setNameDraft(playerName);
      setEditingName(false);
      return;
    }
    setPlayerName(trimmed);
    setEditingName(false);
    try { window.localStorage.setItem(PLAYER_NAME_KEY, trimmed); } catch { /* Name stays in component state. */ }
    try { setProfile(atomicUpdateProfile((current) => ({ ...current, name: trimmed }))); } catch { /* Profile storage unavailable. */ }
  };

  const connectToRoom = async (action: () => Promise<OnlineRoomConnection>) => {
    const trimmedName = playerName.trim();
    if (!trimmedName) {
      setError('Add your name first.');
      setEditingName(true);
      return;
    }
    setBusy(true);
    setError('');
    try { window.localStorage.setItem(PLAYER_NAME_KEY, trimmedName.slice(0, NAME_LIMIT)); } catch { /* Name stays in component state. */ }
    try {
      const nextConnection = await action();
      const roomUrl = new URL(window.location.href);
      roomUrl.searchParams.set('room', nextConnection.roomCode);
      window.history.replaceState({}, '', roomUrl);
      setConnection(nextConnection);
      setRoom(nextConnection.currentRoom);
      setConnected(true);
      onSessionChange?.(nextConnection);
      sound.triggerHaptic(20);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not connect to that room.');
    } finally {
      setBusy(false);
    }
  };

  const createRoom = () => connectToRoom(() => OnlineRoomConnection.create({
    mode,
    playerName: playerName.trim().slice(0, NAME_LIMIT),
    avatar: profileEmoji,
    rules: rules ?? DEFAULT_RULES,
  }));

  const joinRoom = () => connectToRoom(() => OnlineRoomConnection.join(extractRoomCode(joinCode), playerName.trim().slice(0, NAME_LIMIT), profileEmoji));

  const pasteCode = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setJoinCode(extractRoomCode(text));
    } catch {
      setError('Clipboard access was blocked. Type the code instead.');
    }
  };

  const flashCopied = (kind: 'code' | 'link') => {
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1800);
  };

  const copyCode = async () => {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.code);
      flashCopied('code');
    } catch { /* Clipboard unavailable. */ }
  };

  const shareInvite = async () => {
    if (!room) return;
    const url = OnlineRoomConnection.inviteUrl(room.code);
    try {
      if (navigator.share) await navigator.share({ title: 'Join my Ludo Arena room', text: `Join my Ludo Arena game with code ${room.code}`, url });
      else {
        await navigator.clipboard.writeText(`${url}\nRoom code: ${room.code}`);
        flashCopied('link');
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
  const openTeamColors = (teamId: TeamId): PlayerColor[] => COLOR_ORDER.filter(
    (color) => COLOR_TEAMS[color] === teamId && !room?.participants.some((participant) => participant.color === color)
  );
  const notReady = room?.participants.filter((participant) => !participant.isReady) ?? [];
  const canStart = Boolean(
    currentPlayer?.isHost && room && room.participants.length >= 2 && notReady.length === 0 && connected && !room.teamSwapRequest
  );
  const selectedMode = MODE_OPTIONS.find((option) => option.id === mode) ?? MODE_OPTIONS[1];
  const selfAvatarUrl = profile.avatarUrl;
  const RoomModeIcon = room ? MODE_ICONS[room.mode] ?? Users : Users;

  const errorBanner = error && (
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-400/40 bg-red-950/60 p-3 text-xs font-semibold text-red-100">
      <AlertCircle className="mt-px h-4 w-4 shrink-0 text-red-300" aria-hidden="true" />
      <span>{error}</span>
    </div>
  );

  return (
    <div
      className={`min-h-[100dvh] w-full bg-[#092569] px-4 pt-3 text-white ${room ? 'pb-20' : 'pb-8'}`}
      style={{ backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(40,110,240,.35), transparent 55%), repeating-linear-gradient(45deg, rgba(255,255,255,.02) 0 20px, transparent 20px 40px)' }}
    >
      <div className="mx-auto flex w-full max-w-lg flex-col gap-3">
        <header className="flex items-center justify-between gap-2 rounded-2xl border border-white/10 bg-[#0052CC] px-2 py-2 shadow-lg">
          <IconButton label="Back to lobby" onClick={onBack} className="border-0 bg-[#003B99] text-[#FFD200] hover:bg-[#00337F]">
            <ArrowLeft className="h-5 w-5" />
          </IconButton>
          <h1 className="text-sm font-black uppercase tracking-[0.14em] text-[#FFD200]">Play with friends</h1>
          <span
            className={`flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[10px] font-black uppercase ${connected ? 'bg-emerald-500/20 text-emerald-200' : 'bg-black/20 text-sky-200'}`}
            aria-label={connected ? 'Connected' : 'Not connected'}
          >
            {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {connected ? 'Live' : 'Offline'}
          </span>
        </header>

        {!room ? (
          <>
            {busy && initialRoomCode && (
              <div role="status" className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-[#063278] p-3 text-xs font-semibold text-sky-100">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Reconnecting to your game…
              </div>
            )}
            {!OnlineRoomConnection.configured && (
              <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-400/40 bg-amber-950/40 p-3 text-xs font-semibold text-amber-200">
                <Info className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Add the multiplayer Worker URL to <code>.env</code> to enable friend rooms. The server setup steps are in the README.</span>
              </div>
            )}
            {errorBanner}

            {/* Player identity: avatar + name, editable inline */}
            <Panel className="!p-3">
              <div className="flex items-center gap-3">
                <span className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[#FFD200] bg-[#072468] text-2xl shadow-md">
                  {selfAvatarUrl ? <img src={selfAvatarUrl} alt="" className="h-full w-full object-cover" /> : <span aria-hidden="true">{profileEmoji}</span>}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-black uppercase tracking-[0.12em] text-sky-300">Playing as</p>
                  {editingName ? (
                    <input
                      ref={nameInputRef}
                      value={nameDraft}
                      maxLength={NAME_LIMIT}
                      aria-label="Your name"
                      onChange={(event) => setNameDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitName();
                        if (event.key === 'Escape') { setNameDraft(playerName); setEditingName(false); }
                      }}
                      onBlur={commitName}
                      className="mt-0.5 h-9 w-full rounded-lg border border-[#FFD200]/60 bg-[#00245F] px-2 text-base font-black text-white outline-none"
                    />
                  ) : (
                    <p className="truncate text-lg font-black leading-tight text-white">{playerName}</p>
                  )}
                </div>
                {editingName ? (
                  <IconButton label="Save name" tone="gold" onMouseDown={(event) => event.preventDefault()} onClick={commitName}>
                    <Check className="h-5 w-5" />
                  </IconButton>
                ) : (
                  <IconButton label="Edit name" onClick={() => { setNameDraft(playerName); setEditingName(true); }}>
                    <Pencil className="h-4 w-4" />
                  </IconButton>
                )}
              </div>
            </Panel>

            {/* Create room */}
            <Panel highlight>
              <SectionLabel id="room-mode-label">Choose a mode</SectionLabel>
              <div role="radiogroup" aria-labelledby="room-mode-label" className="grid grid-cols-3 gap-2">
                {MODE_OPTIONS.map((option) => {
                  const selected = mode === option.id;
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setMode(option.id)}
                      className={`relative flex min-h-[104px] flex-col items-center justify-center gap-1.5 rounded-xl border-2 px-1 py-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
                        selected
                          ? 'border-white bg-gradient-to-b from-[#FFE04D] to-[#FFB300] text-[#072468] shadow-[0_6px_16px_rgba(255,190,0,0.35)]'
                          : 'border-white/10 bg-[#00245F] text-sky-100 hover:border-white/25'
                      }`}
                    >
                      {selected && (
                        <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#072468]">
                          <Check className="h-2.5 w-2.5 text-[#FFD200]" aria-hidden="true" />
                        </span>
                      )}
                      <SeatPreview option={option} selected={selected} />
                      <span className="flex items-center gap-1 text-[11px] font-black uppercase leading-tight">
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />{option.label}
                      </span>
                      <span className={`text-[10px] font-semibold leading-tight ${selected ? 'text-[#072468]/70' : 'text-sky-300'}`}>{option.caption}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 flex items-start gap-1.5 text-[11px] font-medium leading-relaxed text-sky-100">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" aria-hidden="true" />
                {selectedMode.description}
              </p>
              <button
                type="button"
                disabled={!OnlineRoomConnection.configured || busy}
                onClick={createRoom}
                className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-white bg-gradient-to-r from-[#FFD200] to-[#FFA000] text-sm font-black uppercase tracking-wide text-[#072468] shadow-lg transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5 fill-current" />} Create Room
              </button>
            </Panel>

            <div className="flex items-center gap-3 px-2" aria-hidden="true">
              <span className="h-px flex-1 bg-white/15" />
              <span className="text-[10px] font-black uppercase tracking-[0.14em] text-sky-300">or join a friend</span>
              <span className="h-px flex-1 bg-white/15" />
            </div>

            {/* Join room */}
            <Panel>
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => { event.preventDefault(); if (joinCode.trim()) void joinRoom(); }}
              >
                <label className="relative flex-1">
                  <span className="sr-only">Room code</span>
                  <Hash className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sky-300" aria-hidden="true" />
                  <input
                    value={joinCode}
                    onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                    onBlur={() => joinCode && setJoinCode(extractRoomCode(joinCode))}
                    maxLength={64}
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    className="h-12 w-full rounded-xl border border-white/15 bg-[#00245F] pl-9 pr-2 font-mono text-base font-black tracking-[0.14em] text-white outline-none placeholder:text-white/30 focus:border-[#FFD200]/70"
                    placeholder="LUDO-ABC234"
                  />
                </label>
                <IconButton label="Paste room code" onClick={() => void pasteCode()} className="h-12 w-12">
                  <ClipboardPaste className="h-5 w-5" />
                </IconButton>
                <IconButton
                  label="Join room"
                  tone="gold"
                  type="submit"
                  disabled={!OnlineRoomConnection.configured || busy || !joinCode.trim()}
                  className="h-12 w-12"
                >
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5" />}
                </IconButton>
              </form>
            </Panel>
          </>
        ) : (
          <>
            {errorBanner}

            {/* Room ticket */}
            <Panel highlight className="!p-0 overflow-hidden">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-[#FFD200]">
                  <RoomModeIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  {MODE_LABELS[room.mode] ?? '4P CLASSIC'}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-sky-200">Private room</span>
              </div>
              <div className="flex items-center gap-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-black uppercase tracking-[0.12em] text-sky-300">Room code</p>
                  <p className="truncate font-mono text-2xl font-black tracking-[0.12em] text-white">{room.code}</p>
                </div>
                <IconButton label={copied === 'code' ? 'Room code copied' : 'Copy room code'} onClick={() => void copyCode()}>
                  {copied === 'code' ? <Check className="h-5 w-5 text-emerald-300" /> : <Copy className="h-5 w-5" />}
                </IconButton>
                <IconButton label={copied === 'link' ? 'Invite link copied' : 'Share invite'} tone="gold" onClick={() => void shareInvite()}>
                  {copied === 'link' ? <Check className="h-5 w-5" /> : <Share2 className="h-5 w-5" />}
                </IconButton>
              </div>
            </Panel>

            {/* Seats */}
            <Panel>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-black uppercase tracking-wide text-[#FFD200]">Players ({room.participants.length}/{room.maxPlayers})</h2>
                <span className="flex gap-1" aria-hidden="true">
                  {Array.from({ length: room.maxPlayers }, (_, index) => (
                    <span key={index} className={`h-1.5 w-4 rounded-full ${index < room.participants.length ? 'bg-[#FFD200]' : 'bg-white/15'}`} />
                  ))}
                </span>
              </div>

              {room.mode === 'head_to_head_1v1' ? (
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <DuelSeat
                    color="red"
                    hostId={room.hostId}
                    participant={room.participants.find((participant) => participant.color === 'red')}
                    isSelf={currentPlayer?.color === 'red'}
                    selfAvatarUrl={selfAvatarUrl}
                    inVoice={room.seatsInVoice?.includes('red')}
                  />
                  <span className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-[#FFD200] bg-[#072468] text-xs font-black tracking-wider text-[#FFD200] shadow-[0_0_18px_rgba(255,210,0,0.35)]" aria-hidden="true">VS</span>
                  <DuelSeat
                    color="yellow"
                    hostId={room.hostId}
                    participant={room.participants.find((participant) => participant.color === 'yellow')}
                    isSelf={currentPlayer?.color === 'yellow'}
                    selfAvatarUrl={selfAvatarUrl}
                    inVoice={room.seatsInVoice?.includes('yellow')}
                  />
                </div>
              ) : room.mode === 'team_2v2' ? (
                <div className="space-y-2">
                  {(['team_A', 'team_B'] as const).map((teamId) => {
                    const roster = getTeamRoster(teamId);
                    const openColors = openTeamColors(teamId);
                    let openIndex = 0;
                    return (
                      <div key={teamId} className="rounded-xl border border-white/10 bg-black/10 p-2">
                        <div className="mb-2 flex items-center justify-between px-1">
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-amber-200">
                            <Shield className="h-3.5 w-3.5" aria-hidden="true" />{teamId === 'team_A' ? 'Team A' : 'Team B'}
                          </span>
                          <span className="text-[10px] font-bold text-sky-200">{roster.filter(Boolean).length}/2 seats</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {roster.map((participant, index) => {
                            const color = participant?.color ?? openColors[openIndex++] ?? COLOR_ORDER.filter((c) => COLOR_TEAMS[c] === teamId)[index];
                            return (
                              <SeatTile
                                key={participant?.id ?? `${teamId}-open-${index}`}
                                color={color}
                                participant={participant ?? undefined}
                                hostId={room.hostId}
                                selfId={currentPlayer?.id}
                                selfAvatarUrl={selfAvatarUrl}
                                inVoice={room.seatsInVoice?.includes(color)}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {COLOR_ORDER.slice(0, room.maxPlayers).map((color) => (
                    <SeatTile
                      key={color}
                      color={color}
                      participant={room.participants.find((participant) => participant.color === color)}
                      hostId={room.hostId}
                      selfId={currentPlayer?.id}
                      selfAvatarUrl={selfAvatarUrl}
                      inVoice={room.seatsInVoice?.includes(color)}
                    />
                  ))}
                </div>
              )}

              {room.mode === 'team_2v2' && (
                <div className="mt-3 space-y-2 rounded-xl border border-amber-300/25 bg-black/15 p-2.5">
                  <p className="text-center text-[10px] font-semibold text-sky-100">Team changes are available here before the match. Seat colors and turn order stay the same.</p>
                  {isPendingSwapTarget && pendingTeamSwap && pendingSwapRequester ? (
                    <div className="text-center" role="dialog" aria-label="Team switch request">
                      <p className="text-xs font-bold">{pendingSwapRequester.name} wants to switch teams with you.</p>
                      <div className="mt-2 flex justify-center gap-2">
                        <button className="flex min-h-10 items-center gap-1 rounded-lg bg-emerald-600 px-4 text-xs font-bold" onClick={() => connection?.respondToTeamSwap(pendingTeamSwap.id, true)}><Check className="h-3.5 w-3.5" aria-hidden="true" />Accept</button>
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
                        <button key={candidate.id} disabled={!connected} className="min-h-10 rounded-lg border border-amber-300/60 bg-slate-950/60 px-3 text-xs font-bold text-amber-100 disabled:opacity-50" onClick={() => connection?.requestTeamSwap(candidate.id)} aria-label={`Request to switch teams with ${candidate.name}`}>
                          Switch with {candidate.name}
                        </button>
                      )) : <span className="text-center text-xs text-sky-100">A connected player on the other team is needed to switch.</span>}
                    </div>
                  ) : null}
                </div>
              )}
            </Panel>

            {/* Actions */}
            <Panel className="space-y-2.5 !p-3">
              {currentPlayer?.isHost ? (
                <>
                  {room.participants.length < 2 ? (
                    <p className="flex items-center justify-center gap-1.5 text-center text-xs font-semibold text-amber-200">
                      <UserPlus className="h-4 w-4" aria-hidden="true" />
                      {room.mode === 'head_to_head_1v1' ? 'Share your invite and wait for your opponent to join.' : 'Share your invite and wait for a friend to join.'}
                    </p>
                  ) : notReady.length > 0 ? (
                    <p className="flex items-center justify-center gap-1.5 text-center text-xs font-semibold text-sky-100" role="status">
                      <Clock3 className="h-4 w-4" aria-hidden="true" />
                      Waiting for {notReady.map((participant) => participant.name).join(', ')} to get ready.
                    </p>
                  ) : (
                    <p className="flex items-center justify-center gap-1.5 text-center text-xs font-semibold text-emerald-300" role="status">
                      <Check className="h-4 w-4" aria-hidden="true" />Everyone is ready.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => connection?.startMatch()}
                    disabled={!canStart}
                    className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-white bg-gradient-to-r from-[#FFD200] to-[#FFA000] text-sm font-black uppercase tracking-wide text-[#072468] shadow-lg transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Play className="h-5 w-5 fill-current" /> Start Match
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => connection?.setReady(!currentPlayer?.isReady)}
                    disabled={!connected}
                    aria-pressed={Boolean(currentPlayer?.isReady)}
                    className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 text-sm font-black uppercase tracking-wide transition-colors disabled:opacity-50 ${
                      currentPlayer?.isReady
                        ? 'border-emerald-300 bg-emerald-600 text-white'
                        : 'border-white bg-gradient-to-r from-[#FFD200] to-[#FFA000] text-[#072468]'
                    }`}
                  >
                    {currentPlayer?.isReady ? <><Check className="h-5 w-5" /> I’m Ready</> : <><Hand className="h-5 w-5" /> Tap when you’re ready</>}
                  </button>
                  <p className="text-center text-[11px] font-semibold text-sky-200">
                    {currentPlayer?.isReady ? 'Waiting for the host to start the match.' : 'The host can start once everyone is ready.'}
                  </p>
                </>
              )}
            </Panel>

            {!externalSocialDock && connection && currentPlayer && (
              <OnlineChatDock connection={connection} room={room} localColor={currentPlayer.color} floating />
            )}
          </>
        )}
      </div>
    </div>
  );
};
