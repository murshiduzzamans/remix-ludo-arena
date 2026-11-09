/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Headphones, MessageCircle, Mic, MicOff, PhoneOff, Send, Volume2, VolumeX } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type RealtimeKitClient from '@cloudflare/realtimekit';
import type { PlayerColor } from '../../engine/types';
import type { OnlineRoomConnection, RoomEvent } from '../../network/onlineClient';
import type { ChatMessage, ChatReaction, RoomSnapshot } from '../../network/protocol';
import { COLOR_THEMES } from '../../engine/constants';

const REACTIONS: Array<{ value: ChatReaction; label: string }> = [
  { value: 'thumbs_up', label: '👍' },
  { value: 'laugh', label: '😂' },
  { value: 'wow', label: '😮' },
  { value: 'angry', label: '😠' },
  { value: 'party', label: '🎉' },
  { value: 'gg', label: 'GG' },
];

interface OnlineChatDockProps {
  connection: OnlineRoomConnection;
  room: RoomSnapshot;
  localColor: PlayerColor;
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

export const OnlineChatDock: React.FC<OnlineChatDockProps> = ({ connection, room, localColor }) => {
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
  const realtimeKitRef = useRef<RealtimeKitClient | null>(null);
  const roomParticipantsRef = useRef(room.participants);
  const voiceGenerationRef = useRef(0);
  const voiceStartingRef = useRef(false);
  const voiceRequestedRef = useRef(false);
  const messageListRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const isOpenRef = useRef(false);
  const isHost = room.participants.find((participant) => participant.id === connection.participantId)?.isHost ?? false;
  const chatEnabled = room.chatEnabled !== false;
  const voiceAvailable = room.voiceAvailable !== false;
  const visibleMessages = messages.filter((message) => !mutedColors.has(message.color));
  const characterCount = Array.from(draft).length;
  const isCoolingDown = cooldownUntil > Date.now();
  roomParticipantsRef.current = room.participants;

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
        const speaker = meeting?.participants.joined.get(peerId);
        const participant = roomParticipantsRef.current.find((entry) => entry.id === speaker?.customParticipantId);
        setActiveSpeakerColor(participant?.color ?? null);
      });
      await meeting.join();
      if (generation !== voiceGenerationRef.current) {
        await meeting.leave();
        return;
      }
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
        connection.leaveVoice();
        voiceRequestedRef.current = false;
        setVoiceStarting(false);
        setVoiceJoined(false);
        setMicrophoneEnabled(false);
        setVoiceError('Voice could not connect. Check your connection and try again.');
      }
    } finally {
      if (generation === voiceGenerationRef.current) voiceStartingRef.current = false;
    }
  }, [connection]);

  const stopVoiceClient = useCallback(async () => {
    voiceGenerationRef.current += 1;
    voiceStartingRef.current = false;
    voiceRequestedRef.current = false;
    connection.leaveVoice();
    const meeting = realtimeKitRef.current;
    realtimeKitRef.current = null;
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
  }, [connection]);

  useEffect(() => {
    isOpenRef.current = isOpen;
    if (isOpen) setUnreadCount(0);
  }, [isOpen]);

  useEffect(() => {
    return () => {
      voiceGenerationRef.current += 1;
      voiceStartingRef.current = false;
      voiceRequestedRef.current = false;
      const meeting = realtimeKitRef.current;
      realtimeKitRef.current = null;
      if (meeting) void meeting.leave().catch(() => console.warn('RealtimeKit leave failed during component cleanup.'));
    };
  }, []);

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
          setChatError(`Slow down and try again in ${seconds} seconds.`);
        } else if (event.code === 'CHAT_DISABLED') {
          setChatError('Chat has been turned off by the host.');
        } else {
          setChatError('That message could not be sent.');
        }
      } else if (event.type === 'error') {
        setChatError(event.message);
      } else if (event.type === 'connection' && !event.connected && voiceRequestedRef.current) {
        voiceGenerationRef.current += 1;
        voiceStartingRef.current = false;
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
        voiceRequestedRef.current = false;
        voiceGenerationRef.current += 1;
        voiceStartingRef.current = false;
        setVoiceStarting(false);
        setVoiceError(
          event.code === 'VOICE_DISABLED' ? 'Voice chat is disabled by the host.' :
            event.code === 'VOICE_BUDGET_REACHED' ? 'Room voice is unavailable for this month.' :
              event.code === 'VOICE_ROOM_FULL' ? 'The voice room is full.' :
                event.code === 'VOICE_RATE_LIMITED' ? `Please wait ${event.retryAfterSeconds ?? 2} seconds before retrying voice.` :
                  event.code === 'VOICE_NOT_ALLOWED' ? 'This seat cannot join voice chat.' :
                    'Voice is unavailable. Try again in a moment.'
        );
      } else if (event.type === 'voice_session_expired') {
        voiceRequestedRef.current = false;
        void stopVoiceClient();
        setVoiceError('Your voice session reached its time limit. Rejoin to continue.');
      } else if (event.type === 'voice_budget_warning') {
        setVoiceError(`Room voice is nearing its monthly usage limit (${event.totalMinutes}/${event.limitMinutes} minutes).`);
      }
    });
  }, [connection, localColor, startVoiceClient, stopVoiceClient]);

  useEffect(() => {
    if (voiceJoined && room.seatsInVoice && !room.seatsInVoice.includes(localColor)) {
      const message = room.voiceEnabled === false
        ? 'Voice chat was disabled by the host.'
        : 'The room voice session has ended.';
      void stopVoiceClient();
      setVoiceError(message);
    }
  }, [localColor, room.seatsInVoice, room.voiceEnabled, stopVoiceClient, voiceJoined]);

  useEffect(() => {
    const onPageHide = () => {
      voiceGenerationRef.current += 1;
      voiceStartingRef.current = false;
      voiceRequestedRef.current = false;
      connection.leaveVoice();
      const meeting = realtimeKitRef.current;
      realtimeKitRef.current = null;
      if (meeting) void meeting.leave().catch(() => console.warn('RealtimeKit leave failed during page navigation.'));
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      voiceGenerationRef.current += 1;
      voiceStartingRef.current = false;
      voiceRequestedRef.current = false;
      const meeting = realtimeKitRef.current;
      realtimeKitRef.current = null;
      if (meeting) void meeting.leave().catch(() => console.warn('RealtimeKit leave failed during component cleanup.'));
      connection.leaveVoice();
    };
  }, [connection]);

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
    voiceRequestedRef.current = true;
    setVoiceError('');
    setVoiceStarting(true);
    let microphoneGranted = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphoneGranted = true;
      stream.getTracks().forEach((track) => track.stop());
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      setVoiceError(name === 'NotAllowedError'
        ? 'Microphone access was denied.'
        : 'Microphone is unavailable in this browser.');
    }
    connection.joinVoice(microphoneGranted);
    setVoiceStarting(false);
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

  return (
    <section className="mx-auto mt-2 w-full max-w-[450px] md:flex md:justify-end" aria-label="Online social dock">
      <div className="w-full md:max-w-sm">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setIsOpen((open) => !open)}
            aria-expanded={isOpen}
            aria-controls="online-chat-panel"
            className="relative flex min-h-11 items-center gap-2 rounded-xl border border-sky-300/50 bg-[#003B99] px-4 text-sm font-bold text-white"
          >
            <MessageCircle className="h-4 w-4" />
            Chat
            {unreadCount > 0 && !isOpen && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black" aria-label={`${unreadCount} unread messages`}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
          {!voiceJoined ? (
            <button
              type="button"
              onClick={() => void joinVoice()}
              disabled={voiceStarting || room.voiceEnabled === false || !voiceAvailable}
              className="flex min-h-11 items-center gap-2 rounded-xl border border-emerald-300/50 bg-emerald-950/70 px-3 text-xs font-bold text-emerald-100 disabled:opacity-50"
              aria-label={voiceStarting ? 'Connecting to room voice' : voiceAvailable ? 'Join room voice' : 'Voice unavailable'}
            >
              <Headphones className="h-4 w-4" />
              {voiceStarting ? 'Connecting…' : voiceAvailable ? 'Join voice' : 'Voice unavailable'}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void toggleMicrophone()}
                className="flex min-h-11 items-center gap-2 rounded-xl border border-emerald-300/50 bg-emerald-950/70 px-3 text-xs font-bold text-emerald-100"
                aria-label={microphoneEnabled ? 'Mute microphone' : 'Turn microphone on'}
              >
                {microphoneEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                {microphoneEnabled ? 'Mute mic' : 'Turn mic on'}
              </button>
              <button
                type="button"
                onClick={() => void stopVoiceClient()}
                className="flex min-h-11 items-center gap-2 rounded-xl border border-rose-300/50 bg-rose-950/70 px-3 text-xs font-bold text-rose-100"
                aria-label="Leave room voice"
              >
                <PhoneOff className="h-4 w-4" />
                Leave voice
              </button>
            </>
          )}
          {isHost && (
            <button
              type="button"
              onClick={() => connection.setChatEnabled(!chatEnabled)}
              className="min-h-11 rounded-xl border border-sky-300/40 bg-slate-950/50 px-3 text-xs font-bold text-sky-100"
              aria-label={chatEnabled ? 'Disable chat for this room' : 'Enable chat for this room'}
            >
              {chatEnabled ? 'Disable chat' : 'Enable chat'}
            </button>
          )}
          {isHost && (
            <button
              type="button"
              onClick={() => connection.setVoiceEnabled(room.voiceEnabled === false)}
              className="min-h-11 rounded-xl border border-emerald-300/40 bg-slate-950/50 px-3 text-xs font-bold text-emerald-100"
              aria-label={room.voiceEnabled === false ? 'Enable voice for this room' : 'Disable voice for this room'}
            >
              {room.voiceEnabled === false ? 'Enable voice' : 'Disable voice'}
            </button>
          )}
        </div>
        {voiceError && <p className="mt-1 text-right text-xs text-amber-200" role="status">{voiceError}</p>}
        {voiceJoined && (
          <p className="mt-1 text-right text-[10px] text-emerald-200" aria-live="polite">
            {activeSpeakerColor ? `${room.participants.find((participant) => participant.color === activeSpeakerColor)?.name ?? activeSpeakerColor} is speaking` : 'Voice connected'}
          </p>
        )}

        {isOpen && (
          <div
            id="online-chat-panel"
            className="mt-2 overflow-hidden rounded-2xl border border-sky-300/40 bg-[#063278] shadow-xl"
            aria-label="Room chat"
          >
            <div className="flex items-center justify-between border-b border-sky-300/20 px-3 py-2">
              <h2 className="text-sm font-black text-[#FFD200]">Room chat</h2>
              <span className="text-[10px] text-sky-200">Messages disappear when the room closes</span>
            </div>
            <div
              ref={messageListRef}
              className="max-h-56 space-y-2 overflow-y-auto p-3"
              onScroll={(event) => {
                const element = event.currentTarget;
                shouldAutoScrollRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
              }}
              aria-live="polite"
              aria-relevant="additions text"
              aria-label="Chat messages"
            >
              {!chatEnabled && <p className="text-center text-xs text-amber-200">Chat is disabled by the host.</p>}
              {chatEnabled && visibleMessages.length === 0 && <p className="text-center text-xs text-sky-200">Say hello to your friends.</p>}
              {visibleMessages.map((message) => (
                <article key={message.id} className={`max-w-[90%] rounded-xl px-3 py-2 text-sm ${message.color === localColor ? 'ml-auto bg-[#0052CC]' : 'bg-slate-950/45'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-[11px] font-bold" style={{ color: COLOR_THEMES[message.color].primary }}>{message.name}</span>
                    <time className="shrink-0 text-[10px] text-sky-200" dateTime={new Date(message.sentAt).toISOString()}>
                      {new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(message.sentAt)}
                    </time>
                  </div>
                  <p className="break-words whitespace-pre-wrap text-white">{message.text}</p>
                  {message.color !== localColor && (
                    <button
                      type="button"
                      onClick={() => toggleMutedColor(message.color)}
                      className="mt-1 flex items-center gap-1 text-[10px] text-sky-200 underline"
                      aria-label={`${mutedColors.has(message.color) ? 'Unmute' : 'Mute'} ${message.name}`}
                    >
                      {mutedColors.has(message.color) ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                      {mutedColors.has(message.color) ? 'Unmute player' : 'Mute player'}
                    </button>
                  )}
                </article>
              ))}
            </div>
            {mutedColors.size > 0 && (
              <div className="flex flex-wrap gap-2 px-3 text-[10px]" aria-label="Muted players">
                {[...mutedColors].map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => toggleMutedColor(color)}
                    className="rounded-lg bg-slate-950/40 px-2 py-1 text-sky-100 underline"
                    aria-label={`Unmute ${room.participants.find((participant) => participant.color === color)?.name ?? color}`}
                  >
                    Unmute {room.participants.find((participant) => participant.color === color)?.name ?? color}
                  </button>
                ))}
              </div>
            )}
            {chatError && <p className="px-3 text-xs text-amber-200" role="status">{chatError}</p>}
            <div className="border-t border-sky-300/20 p-3">
              <div className="mb-2 flex items-center justify-between gap-1" aria-label="Quick reactions">
                {REACTIONS.map((reaction) => (
                  <button
                    key={reaction.value}
                    type="button"
                    onClick={() => sendReaction(reaction.value)}
                    disabled={!chatEnabled || isCoolingDown}
                    className="min-h-9 min-w-9 rounded-lg bg-slate-950/40 text-sm disabled:opacity-40"
                    aria-label={`Send ${reaction.value.replace('_', ' ')} reaction`}
                  >
                    {reaction.label}
                  </button>
                ))}
              </div>
              <form
                className="flex items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  sendMessage();
                }}
              >
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Chat message</span>
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        sendMessage();
                      }
                    }}
                    rows={1}
                    disabled={!chatEnabled || isCoolingDown}
                    placeholder={chatEnabled ? 'Message your friends…' : 'Chat is disabled'}
                    className="max-h-24 min-h-10 w-full resize-y rounded-xl border border-sky-300/30 bg-[#00245F] px-3 py-2 text-sm text-white outline-none focus:border-amber-300 disabled:opacity-50"
                  />
                </label>
                <button
                  type="submit"
                  disabled={!draft.trim() || characterCount > 200 || !chatEnabled || isCoolingDown}
                  className="flex min-h-10 min-w-10 items-center justify-center rounded-xl bg-amber-400 text-slate-950 disabled:opacity-40"
                  aria-label="Send chat message"
                >
                  <Send className="h-4 w-4" />
                </button>
                <span className={`sr-only ${characterCount > 180 ? '' : 'hidden'}`} aria-live="polite">
                  {characterCount} of 200 characters
                </span>
              </form>
              <p className={`mt-1 text-right text-[10px] ${characterCount > 200 ? 'text-rose-300' : 'text-sky-200'}`} aria-hidden="true">
                {characterCount}/200
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
