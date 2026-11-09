/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Emoji avatars a player can pick. Shared by the client profile and the multiplayer
 * Worker, which only accepts avatars from this list so rooms never carry arbitrary text.
 */
export const AVATAR_EMOJI_OPTIONS = ['👩', '👦', '🦁', '🏎️', '👑', '🦊', '🐯', '🥷'] as const;

export type AvatarEmoji = (typeof AVATAR_EMOJI_OPTIONS)[number];

export function isAvatarEmoji(value: unknown): value is AvatarEmoji {
  return typeof value === 'string' && (AVATAR_EMOJI_OPTIONS as readonly string[]).includes(value);
}
