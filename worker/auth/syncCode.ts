/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const SYNC_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Generates an easy-to-read, cryptographically secure sync/recovery code.
 * Format: LUDO-XXXX-XXXX-XXXX-XXXX
 */
export function generateSyncCode(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => SYNC_CODE_ALPHABET[b % SYNC_CODE_ALPHABET.length]);
  return `LUDO-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}-${chars.slice(12, 16).join('')}`;
}

/**
 * Normalizes user-entered sync code:
 * - Trims whitespace
 * - Converts to uppercase
 * - Strips extra spaces
 * - Ensures prefix LUDO- if user omitted it
 */
export function normalizeSyncCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let code = input.trim().toUpperCase().replace(/[\s_]+/g, '-');
  if (!code.startsWith('LUDO-')) {
    code = `LUDO-${code}`;
  }
  const pattern = /^LUDO-[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/;
  if (!pattern.test(code)) return null;
  return code;
}
