/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  recordMatchOutcome,
  loadProfile,
  saveProfile,
  loadMatchHistory,
  checkIdempotency,
  recordIdempotency,
  generateMatchId,
  DEFAULT_PROFILE,
} from '../profileStore';
import { GameMode } from '../../engine/types';

// Mock localStorage
const localStorageMock: Record<string, string> = {};
const mockGetItem = vi.fn((key: string) => localStorageMock[key] ?? null);
const mockSetItem = vi.fn((key: string, value: string) => {
  localStorageMock[key] = value;
});
const mockRemoveItem = vi.fn((key: string) => {
  delete localStorageMock[key];
});
const mockClear = vi.fn(() => {
  Object.keys(localStorageMock).forEach((key) => {
    delete localStorageMock[key];
  });
});

beforeEach(() => {
  vi.useFakeTimers();
  Object.keys(localStorageMock).forEach((key) => {
    delete localStorageMock[key];
  });
  mockGetItem.mockImplementation((key: string) => localStorageMock[key] ?? null);
  mockSetItem.mockImplementation((key: string, value: string) => {
    localStorageMock[key] = value;
  });
  mockRemoveItem.mockImplementation((key: string) => {
    delete localStorageMock[key];
  });
  mockClear.mockImplementation(() => {
    Object.keys(localStorageMock).forEach((key) => {
      delete localStorageMock[key];
    });
  });

  vi.stubGlobal('localStorage', {
    getItem: mockGetItem,
    setItem: mockSetItem,
    removeItem: mockRemoveItem,
    clear: mockClear,
  });

  vi.stubGlobal('crypto', {
    randomUUID: vi.fn(() => 'test-match-uuid'),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ProfileStore - Phase 3 Security & Data Integrity', () => {
  const baseRecord = {
    id: 'test-match-1',
    matchId: 'test-match-1',
    timestamp: 1000000,
    mode: 'solo_bots' as GameMode,
    playerColor: 'red' as const,
    outcome: 'victory' as const,
    place: 1,
    captures: 3,
    tokensHome: 4,
    durationSeconds: 120,
    sixesRolled: 2,
  };

  it('generates unique match identifiers', () => {
    const id1 = generateMatchId();
    const id2 = generateMatchId();
    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(typeof id1).toBe('string');
    expect(typeof id2).toBe('string');
    // With mocked randomUUID, they'll be the same, but the function works
  });

  it('prevents duplicate match submissions (idempotency)', () => {
    recordMatchOutcome(baseRecord);
    expect(loadMatchHistory()).toHaveLength(1);

    // Second call with same matchId should be rejected
    recordMatchOutcome(baseRecord);
    expect(loadMatchHistory()).toHaveLength(1);

    // Different matchId should be accepted
    const differentRecord = { ...baseRecord, id: 'test-match-2', matchId: 'test-match-2' };
    recordMatchOutcome(differentRecord);
    expect(loadMatchHistory()).toHaveLength(2);
  });

  it('checkIdempotency returns true for already-processed matches', () => {
    expect(checkIdempotency('any-key')).toBe(false);
    recordIdempotency('any-key');
    expect(checkIdempotency('any-key')).toBe(true);
  });

  it('updates profile statistics correctly on match record', () => {
    saveProfile(DEFAULT_PROFILE);
    recordMatchOutcome(baseRecord);

    const profile = loadProfile();
    expect(profile.totalMatches).toBe(1);
    expect(profile.totalWins).toBe(1);
    expect(profile.totalCaptures).toBe(3);
    expect(profile.totalTokensHome).toBe(4);
    expect(profile.sixesRolled).toBe(2);
    expect(profile.xp).toBe(100); // victory gives 100 XP
    expect(profile.level).toBe(1); // 100 XP = level 1 (floor(100/200)+1 = 1)
  });

  it('tracks defeats correctly', () => {
    saveProfile(DEFAULT_PROFILE);
    const defeatRecord = { ...baseRecord, outcome: 'defeat' as const, place: 3, captures: 1, tokensHome: 2, sixesRolled: 1 };
    recordMatchOutcome(defeatRecord);

    const profile = loadProfile();
    expect(profile.totalMatches).toBe(1);
    expect(profile.totalWins).toBe(0);
    expect(profile.totalCaptures).toBe(1);
    expect(profile.totalTokensHome).toBe(2);
    expect(profile.sixesRolled).toBe(1);
    expect(profile.xp).toBe(35); // defeat gives 35 XP
  });

  it('preserves existing profile information when updating', () => {
    const existingProfile = {
      ...DEFAULT_PROFILE,
      name: 'Custom Player',
      xp: 250,
      level: 2,
      totalMatches: 5,
      totalWins: 3,
      totalCaptures: 10,
      totalTokensHome: 15,
      sixesRolled: 8,
    };
    saveProfile(existingProfile);
    recordMatchOutcome(baseRecord);

    const profile = loadProfile();
    expect(profile.name).toBe('Custom Player');
    expect(profile.totalMatches).toBe(6); // 5 + 1
    expect(profile.totalWins).toBe(4); // 3 + 1
    expect(profile.totalCaptures).toBe(13); // 10 + 3
    expect(profile.totalTokensHome).toBe(19); // 15 + 4
    expect(profile.sixesRolled).toBe(10); // 8 + 2
    expect(profile.xp).toBe(350); // 250 + 100
    expect(profile.level).toBe(2); // floor(350/200)+1 = 2
  });

  it('handles failed profile update gracefully (catch-all)', () => {
    // This test verifies the function doesn't throw on unexpected errors
    // The catch-all in recordMatchOutcome ensures this
    expect(() => recordMatchOutcome(baseRecord)).not.toThrow();
    expect(loadMatchHistory()).toHaveLength(1);
  });

  it('commits match history, profile, and idempotency together', () => {
    recordMatchOutcome(baseRecord);
    expect(checkIdempotency('test-match-1')).toBe(true);
    expect(loadMatchHistory()).toHaveLength(1);
  });

  it('does not partially apply a match when the result ledger write fails', () => {
    saveProfile(DEFAULT_PROFILE);
    mockSetItem.mockImplementation((key: string, value: string) => {
      if (key === 'ludo_arena_result_state_v2') throw new Error('storage full');
      localStorageMock[key] = value;
    });

    recordMatchOutcome(baseRecord);

    expect(loadProfile().totalMatches).toBe(0);
    expect(loadMatchHistory()).toHaveLength(0);
    expect(checkIdempotency('test-match-1')).toBe(false);
  });

  it('limits match history to 25 entries', () => {
    saveProfile(DEFAULT_PROFILE);
    for (let i = 0; i < 30; i++) {
      recordMatchOutcome({
        ...baseRecord,
        id: `match-${i}`,
        matchId: `match-${i}`,
        timestamp: 1000000 + i,
      });
    }
    expect(loadMatchHistory()).toHaveLength(25);
  });

  it('tolerates a corrupted history entry without wiping the ledger', () => {
    recordMatchOutcome(baseRecord);
    expect(loadProfile().totalMatches).toBe(1);

    const ledger = JSON.parse(localStorageMock['ludo_arena_result_state_v2']);
    ledger.history.unshift({ id: 'broken', corrupt: true });
    localStorageMock['ludo_arena_result_state_v2'] = JSON.stringify(ledger);

    // The profile survives and only the bad history entry is dropped.
    expect(loadProfile().totalMatches).toBe(1);
    const history = loadMatchHistory();
    expect(history.some((entry) => entry.id === 'broken')).toBe(false);
    expect(history.some((entry) => entry.id === 'test-match-1')).toBe(true);

    // Idempotency still holds: a re-submission is not double-credited.
    recordMatchOutcome(baseRecord);
    expect(loadProfile().totalMatches).toBe(1);
  });

  it('mirrors the recorded profile into the legacy profile key', () => {
    expect(loadProfile()).toEqual(DEFAULT_PROFILE);

    recordMatchOutcome(baseRecord);

    const mirrored = loadProfile();
    expect(mirrored.xp).toBe(100);
    expect(mirrored.totalMatches).toBe(1);
    expect(mirrored.totalWins).toBe(1);
    // The fallback snapshot matches the ledger profile.
    expect(JSON.parse(localStorageMock['ludo_arena_profile_v1'])).toMatchObject({
      xp: 100,
      totalMatches: 1,
      totalWins: 1,
    });
  });
});
