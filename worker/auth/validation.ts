/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Input validation utilities for user data
 */

// Regex to detect control characters and zero-width characters
const CONTROL_AND_ZERO_WIDTH = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁯﻿]/gu;

/**
 * Validates a display name
 * - 2-20 user-perceived characters (grapheme clusters)
 * - Trimmed, whitespace collapsed
 * - No control characters or zero-width characters
 * - Supports international text including Bangla and emoji
 */
export function validateDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  // Remove control and zero-width characters
  const cleaned = value.replace(CONTROL_AND_ZERO_WIDTH, '');

  // Collapse whitespace and trim
  const normalized = cleaned
    .replace(/\s+/gu, ' ')
    .trim();

  if (!normalized) return null;

  // Count grapheme clusters (user-perceived characters)
  // This handles emoji and combining characters correctly
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const graphemes = Array.from(segmenter.segment(normalized));
  const length = graphemes.length;

  if (length < 2 || length > 20) return null;

  return normalized;
}

/**
 * Validates an avatar ID (must be in preset range)
 */
export function validateAvatarId(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < 0 || value > 11) return null; // 12 preset avatars (0-11)
  return value;
}

/**
 * Validates a profile avatar data URL.
 * Avatars are small cropped square images; accepting only common image data URLs
 * and a strict size bound keeps the profile payload predictable.
 */
export function validateAvatarImage(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const pattern = /^data:image\/(jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+\/=]+$/;
  if (!pattern.test(value)) return null;
  // The cropped 256x256 avatar is small; allow enough room for PNG while
  // still rejecting the old large-file path.
  return value.length < 3_000_000 ? value : null;
}

/**
 * Validates an email address format (basic check)
 */
export function validateEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length < 3 || trimmed.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Detects in-app browsers that block OAuth
 * Facebook, Instagram, Messenger, and other embedded webviews
 */
export function isInAppBrowser(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();

  // Facebook in-app browser
  if (ua.includes('fban') || ua.includes('fbav')) return true;

  // Instagram in-app browser
  if (ua.includes('instagram')) return true;

  // Messenger in-app browser
  if (ua.includes('fb_iab') || ua.includes('fbios')) return true;

  // Line in-app browser
  if (ua.includes('line/')) return true;

  // WeChat in-app browser
  if (ua.includes('micromessenger')) return true;

  // Twitter/X in-app browser
  if (ua.includes('twitter')) return true;

  // LinkedIn in-app browser
  if (ua.includes('linkedin')) return true;

  return false;
}

/**
 * Checks if origin header is allowed for CSRF protection
 */
export function isOriginAllowed(request: Request, allowedOrigins: string[]): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return false;

  const requestUrl = new URL(request.url);

  // Same-origin is always allowed
  if (origin === requestUrl.origin) return true;

  // Check against allowed origins list
  return allowedOrigins.includes(origin);
}

/**
 * Validates that a custom header is present (CSRF protection)
 */
export function hasRequiredHeader(request: Request, headerName: string): boolean {
  return request.headers.has(headerName);
}
