import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { OnlineRoomConnection, RoomEvent } from '../../../network/onlineClient';
import type { RoomSnapshot } from '../../../network/protocol';
import { OnlineChatDock } from '../OnlineChatDock';

const sdkMocks = vi.hoisted(() => {
  const activeSpeaker = { listener: undefined as ((payload: { peerId: string; volume: number }) => void) | undefined };
  return {
    init: vi.fn(),
    activeSpeaker,
    meeting: {
      participants: {
        on: vi.fn((event: string, listener: (payload: { peerId: string; volume: number }) => void) => {
          if (event === 'activeSpeaker') activeSpeaker.listener = listener;
        }),
        joined: { get: vi.fn() },
      },
      join: vi.fn(),
      leave: vi.fn(),
      self: { enableAudio: vi.fn(), disableAudio: vi.fn() },
    },
  };
});

vi.mock('@cloudflare/realtimekit', () => ({
  default: { init: sdkMocks.init },
}));

const initialMessages = [{
  id: 'message-1',
  color: 'green' as const,
  name: 'Friend',
  text: '<img src=x onerror=alert(1)>',
  sentAt: 1_800_000_000_000,
}];

const room = {
  code: 'LUDO-ABC234',
  hostId: 'host-id',
  mode: 'classic_4p',
  rules: {},
  participants: [
    { id: 'host-id', name: 'Host', color: 'red', isHost: true, isReady: true, isBot: false, pingMs: 0 },
    { id: 'friend-id', name: 'Friend', color: 'green', isHost: false, isReady: true, isBot: false, pingMs: 0 },
  ],
  maxPlayers: 4,
  isMatchInProgress: true,
  chatEnabled: true,
} as RoomSnapshot;

function createConnection() {
  const listeners: Array<(event: RoomEvent) => void> = [];
  const connection = {
    participantId: 'host-id',
    localColor: 'red',
    subscribe: vi.fn((listener: (event: RoomEvent) => void) => {
      listeners.push(listener);
      listener({ type: 'chat_history', messages: initialMessages });
      return () => listeners.splice(listeners.indexOf(listener), 1);
    }),
    sendChat: vi.fn(),
    sendChatReaction: vi.fn(),
    setChatEnabled: vi.fn(),
    joinVoice: vi.fn(),
    leaveVoice: vi.fn(),
    setVoiceEnabled: vi.fn(),
  };
  return { connection: connection as unknown as OnlineRoomConnection, listeners };
}

describe('OnlineChatDock', () => {
  it('renders chat as plain text and supports unread messages and local mute', () => {
    const { connection, listeners } = createConnection();
    const { container } = render(<OnlineChatDock connection={connection} room={room} localColor="red" />);

    fireEvent.click(screen.getByRole('button', { name: /^Chat/ }));
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Mute Friend' }));
    expect(screen.queryByText('<img src=x onerror=alert(1)>')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Unmute Friend' }));
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Chat/ }));
    act(() => listeners[0]({ type: 'chat', message: { ...initialMessages[0], id: 'message-2', text: 'New message' } }));
    expect(screen.getByLabelText('1 unread messages')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Chat/ }));
    expect(screen.queryByLabelText('1 unread messages')).toBeNull();
  });

  it('disables empty sends, sends text and quick reactions, and exposes host chat control', () => {
    const { connection } = createConnection();
    render(<OnlineChatDock connection={connection} room={room} localColor="red" />);
    fireEvent.click(screen.getByRole('button', { name: /^Chat/ }));

    const sendButton = screen.getByRole('button', { name: 'Send chat message' });
    expect(sendButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Chat message'), { target: { value: 'Hello friends' } });
    expect(sendButton).toBeEnabled();
    fireEvent.click(sendButton);
    expect(connection.sendChat).toHaveBeenCalledWith('Hello friends');
    fireEvent.click(screen.getByRole('button', { name: 'Send thumbs up reaction' }));
    expect(connection.sendChatReaction).toHaveBeenCalledWith('thumbs_up');
    fireEvent.click(screen.getByRole('button', { name: 'Disable chat for this room' }));
    expect(connection.setChatEnabled).toHaveBeenCalledWith(false);
  });

  it('initializes audio-only voice on demand and supports mic, speaker, and leave controls', async () => {
    const { connection, listeners } = createConnection();
    sdkMocks.init.mockResolvedValue(sdkMocks.meeting);
    sdkMocks.meeting.join.mockResolvedValue(undefined);
    sdkMocks.meeting.leave.mockResolvedValue(undefined);
    sdkMocks.meeting.self.enableAudio.mockResolvedValue(undefined);
    sdkMocks.meeting.self.disableAudio.mockResolvedValue(undefined);
    sdkMocks.meeting.participants.joined.get.mockReturnValue({ customParticipantId: 'friend-id' });

    render(<OnlineChatDock connection={connection} room={room} localColor="red" />);
    expect(sdkMocks.init).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Join room voice' }));
    expect(connection.joinVoice).toHaveBeenCalledOnce();

    act(() => listeners[0]({ type: 'voice_token', authToken: 'participant-token' }));
    await waitFor(() => expect(sdkMocks.init).toHaveBeenCalledWith({
      authToken: 'participant-token',
      defaults: { audio: false, video: false },
    }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Turn microphone on' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Turn microphone on' }));
    await waitFor(() => expect(sdkMocks.meeting.self.enableAudio).toHaveBeenCalledOnce());

    act(() => sdkMocks.activeSpeaker.listener?.({ peerId: 'friend-peer', volume: 1 }));
    expect(screen.getByText('Friend is speaking')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Leave room voice' }));
    await waitFor(() => expect(sdkMocks.meeting.leave).toHaveBeenCalledOnce());
    expect(connection.leaveVoice).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Join room voice' })).toBeTruthy();
  });
});
