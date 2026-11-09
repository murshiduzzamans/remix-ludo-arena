/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AlertCircle,
  Headphones,
  Loader2,
  MessageCircle,
  MessageSquare,
  MessageSquareOff,
  Mic,
  MicOff,
  PhoneOff,
  Radio,
  Send,
  Shield,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type RealtimeKitClient from '@cloudflare/realtimekit';
import type { PlayerColor } from '../../engine/types';
import type { OnlineRoomConnection, RoomEvent } from '../../network/onlineClient';
import type { ChatMessage, ChatReaction, RoomSnapshot } from '../../network/protocol';
import { COLOR_THEMES } from '../../engine/constants';
import { isAvatarEmoji } from '../../shared/avatars';

const REACTIONS: Array<{ value: ChatReaction; label: string }> = [
  { value: 'thumbs_up', label: '👍' },
  { value: 'laugh', label: '😂' },
  { value: 'wow', label: '😮' },
  { value: 'angry', label: '😠' },
  { value: 'party', label: '🎉' },
  { value: 'gg', label: 'GG' },
];

export interface OnlineChatDockProps {
  connection: OnlineRoomConnection;
  room: RoomSnapshot;
  localColor: PlayerColor;
  /** Mounts as a persistent floating bottom dock so screen changes never interrupt voice or chat. */
  floating?: boolean;
}

function mutedColorsKey(roomCode: string): string {
  return `ludo-chat-muted:${roomCode}`;
}

function readMutedColors(roomCode: string): Set<PlayerColor> {
  try {
    const stored = JSON.parse(window.localStorage.getItem(mutedColorsKey(roomCode)) ?? '[]') as unknown;
    if (!Array.isArray(stored)) return new Set();
    return new Set(stored.filter((color): color is PlayerColor =>
      color === 'red' || color === 'green' || color === 'yellow' || color === 'blue'
    ));
  } catch {
    return new Set();
  }
}

export const OnlineChatDock: React.FC<OnlineChatDockProps> = ({
  connection,
  room,
  localColor,
  floating = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [mutedColors, setMutedColors] = useState<Set<PlayerColor>>(() => readMutedColors(room.code));
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatError, setChatError] = useState('');
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [voiceStarting, setVoiceStarting] = useState(false);
  const [voiceJoined, setVoiceJoined] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [activeSpeakerColor, setActiveSpeakerColor] = useState<PlayerColor | null>(null);
  const [voiceError, setVoiceError] = useState('');
  const [liveVoiceSeats, setLiveVoiceSeats] = useState<PlayerColor[]>(() => room.seatsInVoice ?? []);

  const dockContainerRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const realtimeKitRef = useRef<RealtimeKitClient | null>(null);
  const roomParticipantsRef = useRef(room.participants);
  const voiceGenerationRef = useRef(0);
  const voiceStartingRef = useRef(false);
  const voiceRequestedRef = useRef(false);
  const seenInVoiceSeatsRef = useRef(false);
  const voiceJoinTimeoutRef = useRef<number | undefined>(undefined);
  const speakerClearTimerRef = useRef<number | undefined>(undefined);
  const messageListRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const isOpenRef = useRef(false);

  const isHost = room.participants.find((participant) => participant.id === connection.participantId)?.isHost ?? false;
  const chatEnabled = room.chatEnabled !== false;
  const voiceEnabled = room.voiceEnabled !== false;
  const voiceAvailable = room.voiceAvailable !== false;
  const visibleMessages = messages.filter((message) => !mutedColors.has(message.color));
  const characterCount = Array.from(draft).length;
  const isCoolingDown = cooldownUntil > Date.now();
  const seatsInVoice = liveVoiceSeats;

  roomParticipantsRef.current = room.participants;

  const clearVoiceTimers = useCallback(() => {
    if (voiceJoinTimeoutRef.current !== undefined) {
      window.clearTimeout(voiceJoinTimeoutRef.current);
      voiceJoinTimeoutRef.current = undefined;
    }
    if (speakerClearTimerRef.current !== undefined) {
      window.clearTimeout(speakerClearTimerRef.current);
      speakerClearTimerRef.current = undefined;
    }
  }, []);

  useEffect(() => {
    setMutedColors(readMutedColors(room.code));
  }, [room.code]);

  useEffect(() => {
    if (room.seatsInVoice) setLiveVoiceSeats(room.seatsInVoice);
  }, [room.seatsInVoice]);

  const startVoiceClient = useCallback(async (authToken: string) => {
    if (realtimeKitRef.current || voiceStartingRef.current) return;
    voiceStartingRef.current = true;
    const generation = ++voiceGenerationRef.current;
    let meeting: RealtimeKitClient | null = null;
    try {
      const { default: RealtimeKit } = await import('@cloudflare/realtimekit');
      meeting = await RealtimeKit.init({ authToken, defaults: { audio: true, video: false } });
      if (generation !== voiceGenerationRef.current) {
        await meeting.leave();
        return;
      }
      realtimeKitRef.current = meeting;
      meeting.participants.on('activeSpeaker', ({ peerId }) => {
        if (speakerClearTimerRef.current !== undefined) {
          window.clearTimeout(speakerClearTimerRef.current);
        }
        const speaker = peerId ? meeting?.participants.joined.get(peerId) : undefined;
        const participant = roomParticipantsRef.current.find((entry) => entry.id === speaker?.customParticipantId);
        const speakerColor = participant?.color ?? null;
        setActiveSpeakerColor(speakerColor);
        if (speakerColor) {
          speakerClearTimerRef.current = window.setTimeout(() => {
            setActiveSpeakerColor((current) => (current === speakerColor ? null : current));
          }, 2600);
        }
      });
      await meeting.join();
      if (generation !== voiceGenerationRef.current) {
        await meeting.leave();
        return;
      }
      clearVoiceTimers();
      setMicrophoneEnabled(true);
      setVoiceJoined(true);
      setVoiceStarting(false);
      setVoiceError('');
    } catch {
      if (meeting) {
        try {
          await meeting.leave();
        } catch {
          setVoiceError('Could not close the voice connection cleanly.');
        }
      }
      if (realtimeKitRef.current === meeting) realtimeKitRef.current = null;
      if (generation === voiceGenerationRef.current) {
        clearVoiceTimers();
        connection.leaveVoice?.();
        voiceRequestedRef.current = false;
        seenInVoiceSeatsRef.current = false;
        setVoiceStarting(false);
        setVoiceJoined(false);
        setMicrophoneEnabled(false);
        setVoiceError('Voice could not connect. Check your connection and try again.');
      }
    } finally {
      if (generation === voiceGenerationRef.current) voiceStartingRef.current = false;
    }
  }, [clearVoiceTimers, connection]);

  const stopVoiceClient = useCallback(async () => {
    clearVoiceTimers();
    voiceGenerationRef.current += 1;
    voiceStartingRef.current = false;
    voiceRequestedRef.current = false;
    seenInVoiceSeatsRef.current = false;
    connection.leaveVoice?.();
    const meeting = realtimeKitRef.current;
    realtimeKitRef.current = null;
    setVoiceStarting(false);
    setVoiceJoined(false);
    setMicrophoneEnabled(false);
    setActiveSpeakerColor(null);
    if (meeting) {
      try {
        await meeting.leave();
      } catch {
        setVoiceError('Could not close the voice connection cleanly.');
      }
    }
  }, [clearVoiceTimers, connection]);

  useEffect(() => {
    isOpenRef.current = isOpen;
    if (isOpen) {
      setUnreadCount(0);
      window.requestAnimationFrame(() => chatInputRef.current?.focus());
    }
  }, [isOpen]);

  // Close popover cleanly on Escape or outside click without shifting anything
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    const onPointerDown = (event: MouseEvent) => {
      const container = dockContainerRef.current;
      if (container && event.target instanceof Node && !container.contains(event.target)) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onPointerDown);
    };
  }, [isOpen]);

  useEffect(() => {
    return connection.subscribe((event: RoomEvent) => {
      if (event.type === 'chat_history') {
        setMessages(event.messages.slice(-50));
        setChatError('');
      } else if (event.type === 'chat') {
        setMessages((current) => [...current, event.message].slice(-50));
        if (!isOpenRef.current && event.message.color !== localColor) {
          setUnreadCount((count) => count + 1);
        }
      } else if (event.type === 'chat_error') {
        if (event.code === 'CHAT_RATE_LIMITED') {
          const seconds = event.retryAfterSeconds ?? 2;
          setCooldownUntil(Date.now() + seconds * 1000);
          setChatError(`Slow down (${seconds}s).`);
        } else if (event.code === 'CHAT_DISABLED') {
          setChatError('Chat has been turned off by the host.');
        } else {
          setChatError('That message could not be sent.');
        }
      } else if (event.type === 'error') {
        setChatError(event.message);
      } else if (event.type === 'room') {
        if (event.room.seatsInVoice) setLiveVoiceSeats(event.room.seatsInVoice);
      } else if (event.type === 'voice_status') {
        setLiveVoiceSeats(event.seatsInVoice);
      } else if (event.type === 'connection' && !event.connected && voiceRequestedRef.current) {
        voiceGenerationRef.current += 1;
        voiceStartingRef.current = false;
        seenInVoiceSeatsRef.current = false;
        const meeting = realtimeKitRef.current;
        realtimeKitRef.current = null;
        if (meeting) void meeting.leave().catch(() => console.warn('RealtimeKit leave failed during room reconnect.'));
        setVoiceJoined(false);
        setMicrophoneEnabled(false);
        setActiveSpeakerColor(null);
        setVoiceStarting(true);
      } else if (event.type === 'voice_token') {
        setVoiceStarting(true);
        void startVoiceClient(event.authToken);
      } else if (event.type === 'voice_error') {
        clearVoiceTimers();
        voiceRequestedRef.current = false;
        seenInVoiceSeatsRef.current = false;
        voiceGenerationRef.current += 1;
        voiceStartingRef.current = false;
        setVoiceStarting(false);
        setVoiceError(
          event.code === 'VOICE_DISABLED' ? 'Voice chat is disabled by the host.' :
            event.code === 'VOICE_BUDGET_REACHED' ? 'Room voice is unavailable for this month.' :
              event.code === 'VOICE_ROOM_FULL' ? 'The voice room is full.' :
                event.code === 'VOICE_RATE_LIMITED' ? `Wait ${event.retryAfterSeconds ?? 2}s before retrying voice.` :
                  event.code === 'VOICE_NOT_ALLOWED' ? 'This seat cannot join voice chat.' :
                    'Voice is unavailable right now.'
        );
      } else if (event.type === 'voice_session_expired') {
        voiceRequestedRef.current = false;
        seenInVoiceSeatsRef.current = false;
        void stopVoiceClient();
        setVoiceError('Voice session reached its time limit. Tap to rejoin.');
      } else if (event.type === 'voice_budget_warning') {
        setVoiceError(`Voice usage warning (${event.totalMinutes}/${event.limitMinutes} min).`);
      }
    });
  }, [clearVoiceTimers, connection, localColor, startVoiceClient, stopVoiceClient]);

  // Track when the server confirms our seat in seatsInVoice so we only auto-disconnect on real removal or host disable
  useEffect(() => {
    if (seatsInVoice.includes(localColor)) {
      seenInVoiceSeatsRef.current = true;
    }
    if (!voiceJoined) return;
    if (!voiceEnabled) {
      void stopVoiceClient();
      setVoiceError('Voice chat was disabled by the host.');
    } else if (seenInVoiceSeatsRef.current && !seatsInVoice.includes(localColor)) {
      void stopVoiceClient();
      setVoiceError('The room voice session has ended.');
    }
  }, [localColor, seatsInVoice, stopVoiceClient, voiceEnabled, voiceJoined]);

  useEffect(() => {
    const cleanupActiveVoice = () => {
      clearVoiceTimers();
      const hadVoice = voiceRequestedRef.current || realtimeKitRef.current !== null;
      voiceGenerationRef.current += 1;
      voiceStartingRef.current = false;
      voiceRequestedRef.current = false;
      seenInVoiceSeatsRef.current = false;
      const meeting = realtimeKitRef.current;
      realtimeKitRef.current = null;
      if (meeting) void meeting.leave().catch(() => console.warn('RealtimeKit leave failed during cleanup.'));
      if (hadVoice) connection.leaveVoice?.();
    };
    window.addEventListener('pagehide', cleanupActiveVoice);
    return () => {
      window.removeEventListener('pagehide', cleanupActiveVoice);
      cleanupActiveVoice();
    };
  }, [clearVoiceTimers, connection]);

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const timer = window.setInterval(() => {
      if (cooldownUntil <= Date.now()) {
        setCooldownUntil(0);
        setChatError('');
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  useEffect(() => {
    try {
      window.localStorage.setItem(mutedColorsKey(room.code), JSON.stringify([...mutedColors]));
    } catch {
      setChatError('Muted players could not be saved on this device.');
    }
  }, [mutedColors, room.code]);

  useEffect(() => {
    const messageList = messageListRef.current;
    if (isOpen && messageList && shouldAutoScrollRef.current) {
      messageList.scrollTop = messageList.scrollHeight;
    }
  }, [isOpen, visibleMessages.length]);

  const sendMessage = () => {
    const text = draft.trim();
    if (!text || characterCount > 200 || !chatEnabled || isCoolingDown) return;
    connection.sendChat(text);
    setDraft('');
    setChatError('');
    shouldAutoScrollRef.current = true;
  };

  const sendReaction = (reaction: ChatReaction) => {
    if (!chatEnabled || isCoolingDown) return;
    connection.sendChatReaction(reaction);
    setChatError('');
    shouldAutoScrollRef.current = true;
  };

  const joinVoice = async () => {
    if (voiceStarting || voiceJoined) return;
    voiceRequestedRef.current = true;
    seenInVoiceSeatsRef.current = false;
    setVoiceError('');
    setVoiceStarting(true);
    let microphoneGranted = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphoneGranted = true;
      stream.getTracks().forEach((track) => track.stop());
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotAllowedError') {
        setVoiceError('Microphone access was denied (joining listen-only).');
      }
    }
    if (voiceJoinTimeoutRef.current !== undefined) window.clearTimeout(voiceJoinTimeoutRef.current);
    voiceJoinTimeoutRef.current = window.setTimeout(() => {
      if (!realtimeKitRef.current && voiceRequestedRef.current) {
        voiceRequestedRef.current = false;
        setVoiceStarting(false);
        setVoiceError('Voice connection timed out. Tap to try again.');
      }
    }, 12000);
    connection.joinVoice(microphoneGranted);
  };

  const toggleMicrophone = async () => {
    const meeting = realtimeKitRef.current;
    if (!meeting) return;
    try {
      if (microphoneEnabled) await meeting.self.disableAudio();
      else await meeting.self.enableAudio();
      setMicrophoneEnabled(!microphoneEnabled);
      setVoiceError('');
    } catch {
      setVoiceError('Microphone access was denied or is unavailable in this browser.');
    }
  };

  const toggleMutedColor = (color: PlayerColor) => {
    setMutedColors((current) => {
      const next = new Set(current);
      if (next.has(color)) next.delete(color);
      else next.add(color);
      return next;
    });
  };

  const activeSpeakerName = activeSpeakerColor
    ? room.participants.find((participant) => participant.color === activeSpeakerColor)?.name ?? activeSpeakerColor
    : null;

  const voiceButtonLabel = voiceStarting
    ? 'Connecting to room voice'
    : !voiceEnabled
      ? 'Voice disabled by host'
      : voiceAvailable
        ? 'Join room voice'
        : 'Voice unavailable';

  return (
    <section
      className={
        floating
          ? 'pointer-events-none fixed bottom-2.5 left-1/2 z-[60] -translate-x-1/2 select-none md:bottom-4 md:left-auto md:right-4 md:translate-x-0'
          : 'relative mx-auto mt-1 flex h-12 w-full max-w-[450px] select-none items-center justify-center md:justify-end'
      }
      aria-label="Online social dock"
    >
      <div ref={dockContainerRef} className="pointer-events-auto relative inline-flex items-center">
        {/* Floating overlay stack (status pills + chat popover) — never takes flow height or shifts layout */}
        <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 flex -translate-x-1/2 flex-col items-center gap-1.5 md:left-auto md:right-0 md:translate-x-0 md:items-end">
          {voiceError && (
            <div
              role="status"
              className="pointer-events-auto flex max-w-[300px] items-center gap-1.5 rounded-full border border-amber-400/45 bg-slate-950/95 px-2.5 py-1 text-[11px] font-semibold text-amber-200 shadow-lg backdrop-blur-md"
            >
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />
              <span className="truncate">{voiceError}</span>
              <button
                type="button"
                onClick={() => setVoiceError('')}
                className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-amber-200/70 hover:bg-white/10 hover:text-white"
                aria-label="Dismiss voice notice"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
          )}

          {voiceJoined && (
            <div
              aria-live="polite"
              className={`pointer-events-auto inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-black shadow-md backdrop-blur-md ${
                activeSpeakerColor
                  ? 'border-emerald-300/70 bg-emerald-950/95 text-emerald-200'
                  : 'border-emerald-400/35 bg-slate-950/90 text-emerald-200/90'
              }`}
            >
              <Radio className={`h-3 w-3 ${activeSpeakerColor ? 'animate-pulse text-emerald-300' : 'text-emerald-400'}`} aria-hidden="true" />
              <span>{activeSpeakerName ? `${activeSpeakerName} is speaking` : 'Voice connected'}</span>
            </div>
          )}

          {isOpen && (
            <div
              id="online-chat-panel"
              className="pointer-events-auto flex w-[min(92vw,344px)] flex-col overflow-hidden rounded-2xl border border-sky-300/35 bg-gradient-to-b from-[#08358A]/98 to-[#041D52]/98 shadow-[0_16px_40px_rgba(0,0,0,0.65)] backdrop-blur-md"
              aria-label="Room chat"
            >
              {/* Compact chat header */}
              <div className="flex h-11 shrink-0 items-center justify-between border-b border-white/10 bg-[#041A47]/60 px-3">
                <div className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-[#FFD200]" aria-hidden="true" />
                  <h2 className="text-xs font-black uppercase tracking-wider text-[#FFD200]">Room Chat</h2>
                  {!chatEnabled && (
                    <span className="rounded-full border border-amber-400/40 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-black uppercase text-amber-200">
                      Off
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-sky-200 transition-colors hover:bg-white/15 hover:text-white"
                  aria-label="Close room chat"
                  title="Close chat"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              {/* Fixed-height message viewport (never shifts panel height) */}
              <div
                ref={messageListRef}
                className="h-52 space-y-2 overflow-y-auto px-3 py-2.5"
                onScroll={(event) => {
                  const element = event.currentTarget;
                  shouldAutoScrollRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
                }}
                aria-live="polite"
                aria-relevant="additions text"
                aria-label="Chat messages"
              >
                {!chatEnabled && (
                  <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center text-amber-200">
                    <MessageSquareOff className="h-6 w-6 opacity-80" aria-hidden="true" />
                    <p className="text-xs font-semibold">Chat is disabled by the host.</p>
                  </div>
                )}
                {chatEnabled && visibleMessages.length === 0 && (
                  <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center text-sky-200/75">
                    <MessageCircle className="h-6 w-6 opacity-60" aria-hidden="true" />
                    <p className="text-xs font-semibold">Tap a reaction or say hello to your friends.</p>
                  </div>
                )}
                {visibleMessages.map((message) => {
                  const isMine = message.color === localColor;
                  const isSenderMuted = mutedColors.has(message.color);
                  return (
                    <article
                      key={message.id}
                      className={`max-w-[88%] rounded-2xl border px-3 py-1.5 text-xs shadow-sm ${
                        isMine
                          ? 'ml-auto rounded-br-sm border-sky-300/30 bg-[#0052CC]'
                          : 'rounded-bl-sm border-white/10 bg-slate-950/55'
                      }`}
                    >
                      <div className="mb-0.5 flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: COLOR_THEMES[message.color].primary }}
                            aria-hidden="true"
                          />
                          <span
                            className="truncate text-[11px] font-black"
                            style={{ color: isMine ? '#FFE066' : COLOR_THEMES[message.color].primaryLight }}
                          >
                            {message.name}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <time className="text-[9px] font-semibold text-sky-200/75" dateTime={new Date(message.sentAt).toISOString()}>
                            {new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(message.sentAt)}
                          </time>
                          {!isMine && (
                            <button
                              type="button"
                              onClick={() => toggleMutedColor(message.color)}
                              className="flex h-5 w-5 items-center justify-center rounded-md text-sky-200/75 transition-colors hover:bg-white/10 hover:text-white"
                              aria-label={`${isSenderMuted ? 'Unmute' : 'Mute'} ${message.name}`}
                              title={`${isSenderMuted ? 'Unmute' : 'Mute'} ${message.name}`}
                            >
                              {isSenderMuted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                            </button>
                          )}
                        </span>
                      </div>
                      <p className="break-words whitespace-pre-wrap leading-relaxed text-white">{message.text}</p>
                    </article>
                  );
                })}
              </div>

              {/* Muted player chips (icon + name) */}
              {mutedColors.size > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 border-t border-white/10 bg-slate-950/35 px-3 py-1.5" aria-label="Muted players">
                  {[...mutedColors].map((color) => {
                    const mutedName = room.participants.find((participant) => participant.color === color)?.name ?? color;
                    return (
                      <button
                        key={color}
                        type="button"
                        onClick={() => toggleMutedColor(color)}
                        className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-bold text-sky-100 hover:bg-white/15"
                        aria-label={`Unmute ${mutedName}`}
                        title={`Unmute ${mutedName}`}
                      >
                        <VolumeX className="h-3 w-3 text-amber-300" aria-hidden="true" />
                        <span className="max-w-[96px] truncate">{mutedName}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {chatError && (
                <div className="flex items-center gap-1.5 border-t border-amber-400/20 bg-amber-950/40 px-3 py-1 text-[11px] font-semibold text-amber-200" role="status">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{chatError}</span>
                </div>
              )}

              {/* Quick reactions + single-line message capsule */}
              <div className="space-y-2 border-t border-white/10 bg-[#031740]/80 p-2.5">
                <div className="grid grid-cols-6 gap-1" aria-label="Quick reactions">
                  {REACTIONS.map((reaction) => (
                    <button
                      key={reaction.value}
                      type="button"
                      onClick={() => sendReaction(reaction.value)}
                      disabled={!chatEnabled || isCoolingDown}
                      className="flex h-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-xs font-black text-white transition-transform hover:bg-white/15 active:scale-90 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={`Send ${reaction.value.replace('_', ' ')} reaction`}
                      title={`Send ${reaction.label}`}
                    >
                      {reaction.label}
                    </button>
                  ))}
                </div>

                <form
                  className="flex h-10 items-center gap-1.5 rounded-xl border border-white/15 bg-[#001D4F] pl-3 pr-1 focus-within:border-[#FFD200]/80"
                  onSubmit={(event) => {
                    event.preventDefault();
                    sendMessage();
                  }}
                >
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">Chat message</span>
                    <input
                      ref={chatInputRef}
                      type="text"
                      value={draft}
                      maxLength={200}
                      autoComplete="off"
                      onChange={(event) => setDraft(event.target.value)}
                      disabled={!chatEnabled || isCoolingDown}
                      placeholder={chatEnabled ? 'Message…' : 'Chat is off'}
                      className="h-9 w-full bg-transparent text-xs font-medium text-white outline-none placeholder:text-sky-200/45 disabled:opacity-50"
                    />
                  </label>
                  {characterCount >= 160 && (
                    <span
                      className={`shrink-0 font-mono text-[10px] font-bold ${characterCount > 200 ? 'text-rose-300' : 'text-sky-300/80'}`}
                      aria-live="polite"
                    >
                      {200 - characterCount}
                    </span>
                  )}
                  <button
                    type="submit"
                    disabled={!draft.trim() || characterCount > 200 || !chatEnabled || isCoolingDown}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FFD200] text-[#072468] shadow-sm transition-transform hover:bg-[#FFE04D] active:scale-95 disabled:cursor-not-allowed disabled:opacity-35"
                    aria-label="Send chat message"
                    title="Send message"
                  >
                    <Send className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>

        {/* Fixed-height icon-only control capsule */}
        <div className="inline-flex h-12 items-center gap-1.5 rounded-2xl border border-sky-300/35 bg-[#041E5A]/95 px-2 shadow-[0_10px_26px_rgba(0,0,0,0.48),inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-md">
          {/* Chat icon button */}
          <button
            type="button"
            onClick={() => setIsOpen((open) => !open)}
            aria-label="Chat"
            aria-expanded={isOpen}
            aria-controls="online-chat-panel"
            title={isOpen ? 'Close chat' : chatEnabled ? 'Room chat' : 'Room chat (disabled by host)'}
            className={`relative flex h-9 w-9 items-center justify-center rounded-xl border transition-all active:scale-95 ${
              isOpen
                ? 'border-white bg-[#FFD200] text-[#072468] shadow-md'
                : chatEnabled
                  ? 'border-sky-300/35 bg-[#004ECC] text-white hover:bg-[#0B64F0]'
                  : 'border-white/10 bg-slate-800/80 text-slate-400'
            }`}
          >
            {chatEnabled ? <MessageCircle className="h-4 w-4" aria-hidden="true" /> : <MessageSquareOff className="h-4 w-4" aria-hidden="true" />}
            {unreadCount > 0 && !isOpen && (
              <span
                className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-[#041E5A] bg-rose-500 px-1 text-[9px] font-black leading-none text-white shadow"
                aria-label={`${unreadCount} unread messages`}
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {/* Voice icon controls */}
          {!voiceJoined ? (
            <button
              type="button"
              onClick={() => void joinVoice()}
              disabled={voiceStarting || !voiceEnabled || !voiceAvailable}
              aria-label={voiceButtonLabel}
              title={voiceButtonLabel}
              className={`relative flex h-9 w-9 items-center justify-center rounded-xl border transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-45 ${
                voiceStarting
                  ? 'border-emerald-300/60 bg-emerald-900/70 text-emerald-200'
                  : voiceEnabled && voiceAvailable
                    ? 'border-emerald-400/45 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30'
                    : 'border-white/10 bg-slate-800/80 text-slate-400'
              }`}
            >
              {voiceStarting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : voiceEnabled && voiceAvailable ? (
                <Headphones className="h-4 w-4" aria-hidden="true" />
              ) : (
                <MicOff className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          ) : (
            <div className="inline-flex h-9 items-center gap-1 rounded-xl border border-emerald-400/40 bg-emerald-950/85 px-1">
              <button
                type="button"
                onClick={() => void toggleMicrophone()}
                aria-label={microphoneEnabled ? 'Mute microphone' : 'Turn microphone on'}
                aria-pressed={microphoneEnabled}
                title={microphoneEnabled ? 'Mute microphone' : 'Turn microphone on'}
                className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all active:scale-95 ${
                  microphoneEnabled
                    ? `bg-emerald-400 text-slate-950 shadow-sm ${activeSpeakerColor === localColor ? 'ring-2 ring-white' : ''}`
                    : 'bg-amber-500/25 text-amber-200 hover:bg-amber-500/35'
                }`}
              >
                {microphoneEnabled ? <Mic className="h-3.5 w-3.5" aria-hidden="true" /> : <MicOff className="h-3.5 w-3.5" aria-hidden="true" />}
              </button>
              <button
                type="button"
                onClick={() => void stopVoiceClient()}
                aria-label="Leave room voice"
                title="Leave voice chat"
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/25 text-rose-200 transition-all hover:bg-rose-500 hover:text-white active:scale-95"
              >
                <PhoneOff className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          )}

          {/* Compact live seat badges for everyone currently in voice */}
          {seatsInVoice.length > 0 && (
            <div className="flex items-center -space-x-1 px-0.5" aria-label="Players in voice">
              {seatsInVoice.map((seatColor) => {
                const participant = room.participants.find((entry) => entry.color === seatColor);
                const isSpeaking = activeSpeakerColor === seatColor;
                const badgeText = participant && isAvatarEmoji(participant.avatar)
                  ? participant.avatar
                  : (participant?.name.trim().charAt(0).toUpperCase() || seatColor.charAt(0).toUpperCase());
                return (
                  <span
                    key={seatColor}
                    title={`${participant?.name ?? COLOR_THEMES[seatColor].name} (in voice)`}
                    className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-black text-white shadow-sm transition-transform ${
                      isSpeaking ? 'z-10 scale-110 border-emerald-300 ring-2 ring-emerald-400' : 'border-[#041E5A]'
                    }`}
                    style={{ backgroundColor: COLOR_THEMES[seatColor].primary }}
                  >
                    {badgeText}
                  </span>
                );
              })}
            </div>
          )}

          {/* Host room-level chat & voice toggles (clean icon buttons, no bulky text labels) */}
          {isHost && (
            <>
              <span className="mx-0.5 h-5 w-px bg-white/15" aria-hidden="true" />
              <button
                type="button"
                onClick={() => connection.setChatEnabled(!chatEnabled)}
                aria-label={chatEnabled ? 'Disable chat for this room' : 'Enable chat for this room'}
                aria-pressed={chatEnabled}
                title={chatEnabled ? 'Host: Turn off room chat' : 'Host: Turn on room chat'}
                className={`relative flex h-9 w-9 items-center justify-center rounded-xl border transition-all active:scale-95 ${
                  chatEnabled
                    ? 'border-white/15 bg-white/5 text-sky-200 hover:bg-white/10'
                    : 'border-rose-400/45 bg-rose-950/70 text-rose-200 hover:bg-rose-900/70'
                }`}
              >
                {chatEnabled ? <MessageSquare className="h-4 w-4" aria-hidden="true" /> : <MessageSquareOff className="h-4 w-4" aria-hidden="true" />}
                <Shield className="absolute bottom-1 right-1 h-2.5 w-2.5 text-[#FFD200]" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => connection.setVoiceEnabled(room.voiceEnabled === false)}
                aria-label={room.voiceEnabled === false ? 'Enable voice for this room' : 'Disable voice for this room'}
                aria-pressed={voiceEnabled}
                title={room.voiceEnabled === false ? 'Host: Turn on room voice' : 'Host: Turn off room voice'}
                className={`relative flex h-9 w-9 items-center justify-center rounded-xl border transition-all active:scale-95 ${
                  voiceEnabled
                    ? 'border-white/15 bg-white/5 text-emerald-200 hover:bg-white/10'
                    : 'border-rose-400/45 bg-rose-950/70 text-rose-200 hover:bg-rose-900/70'
                }`}
              >
                {voiceEnabled ? <Volume2 className="h-4 w-4" aria-hidden="true" /> : <VolumeX className="h-4 w-4" aria-hidden="true" />}
                <Shield className="absolute bottom-1 right-1 h-2.5 w-2.5 text-[#FFD200]" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
};
