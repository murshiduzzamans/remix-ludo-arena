/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** A deterministic [0, 1) stream for bot choices and small timing variation. */
export function createSeededRandom(seed: string): () => number {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

export function getBotThinkingDelayMs(seed: string): number {
  return 600 + Math.floor(createSeededRandom(seed)() * 1101);
}
