import { describe, expect, it } from 'vitest';
import { OnlineRoomConnection } from '../onlineClient';

describe('OnlineRoomConnection chat protocol', () => {
  it('sends chat and reaction fields at the top level of the WebSocket message', () => {
    const sent: string[] = [];
    const connection = Object.create(OnlineRoomConnection.prototype) as OnlineRoomConnection;
    Object.assign(connection, {
      socket: {
        readyState: WebSocket.OPEN,
        send: (message: string) => sent.push(message),
      },
      listeners: new Set(),
    });

    connection.sendChat('Hello friends');
    connection.sendChatReaction('thumbs_up');

    expect(sent.map((message) => JSON.parse(message))).toEqual([
      { type: 'chat', text: 'Hello friends' },
      { type: 'chat_reaction', reaction: 'thumbs_up' },
    ]);
  });

  it('sends voice join, leave, and host setting messages with the expected shapes', () => {
    const sent: string[] = [];
    const connection = Object.create(OnlineRoomConnection.prototype) as OnlineRoomConnection;
    Object.assign(connection, {
      socket: {
        readyState: WebSocket.OPEN,
        send: (message: string) => sent.push(message),
      },
      listeners: new Set(),
      voiceRequested: false,
    });

    connection.joinVoice();
    connection.leaveVoice();
    connection.setVoiceEnabled(false);

    expect(sent.map((message) => JSON.parse(message))).toEqual([
      { type: 'voice_join' },
      { type: 'voice_leave' },
      { type: 'CLIENT_SET_VOICE_ENABLED', payload: { enabled: false } },
    ]);
  });
});
