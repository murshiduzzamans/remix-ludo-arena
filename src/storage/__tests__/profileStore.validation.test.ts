/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateProfile,
  validateSettings,
  validateMatchRecord,
  safeLoadProfile,
  safeLoadSettings,
  safeLoadMatchHistory,
} from '../profileStore';
import { GameMode } from '../../engine/types';
import { DEFAULT_RULES } from '../../engine/gameEngine';

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
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ProfileStore - validateProfile', () => {
  it('accepts a valid profile', () => {
    const valid = {
      name: 'Test',
      avatarSeed: 'avatar-1',
      level: 1,
      xp: 0,
      totalMatches: 0,
      totalWins: 0,
      totalCaptures: 0,
      totalTokensHome: 0,
      sixesRolled: 0,
      preferredColor: 'red',
    };
    const result = validateProfile(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe('Test');
    }
  });

  it('rejects missing name', () => {
    const result = validateProfile({ ...{}, name: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('name must be a non-empty string');
    }
  });

  it('rejects invalid level', () => {
    const result = validateProfile({
      name: 'Test',
      avatarSeed: 'a',
      level: 0,
      xp: 0,
      totalMatches: 0,
      totalWins: 0,
      totalCaptures: 0,
      totalTokensHome: 0,
      sixesRolled: 0,
      preferredColor: 'red',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('level must be a positive integer');
    }
  });

  it('rejects invalid preferredColor', () => {
    const result = validateProfile({
      name: 'Test',
      avatarSeed: 'a',
      level: 1,
      xp: 0,
      totalMatches: 0,
      totalWins: 0,
      totalCaptures: 0,
      totalTokensHome: 0,
      sixesRolled: 0,
      preferredColor: 'purple',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('preferredColor must be one of: red, green, yellow, blue');
    }
  });

  it('rejects null input', () => {
    const result = validateProfile(null);
    expect(result.ok).toBe(false);
  });
});

describe('ProfileStore - validateSettings', () => {
  it('accepts valid settings', () => {
    const valid = {
      soundEnabled: true,
      soundVolume: 0.6,
      hapticFeedback: true,
      fastAnimations: false,
    };
    const result = validateSettings(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.soundVolume).toBe(0.6);
    }
  });

  it('preserves valid custom game rules', () => {
    const rules = {
      sixToExit: false,
      extraTurnOnSix: false,
      extraTurnOnCapture: true,
      extraTurnOnFinish: false,
      consecutiveSixForfeit: true,
      safeStarsActive: false,
    };
    const result = validateSettings({
      soundEnabled: true,
      soundVolume: 0.6,
      hapticFeedback: true,
      fastAnimations: false,
      rules,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.rules).toEqual({ ...DEFAULT_RULES, ...rules });
  });

  it('rejects invalid soundVolume', () => {
    const result = validateSettings({
      soundEnabled: true,
      soundVolume: 1.5,
      hapticFeedback: true,
      fastAnimations: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('soundVolume must be a number between 0 and 1');
    }
  });

  it('rejects non-boolean soundEnabled', () => {
    const result = validateSettings({
      soundEnabled: 'yes',
      soundVolume: 0.6,
      hapticFeedback: true,
      fastAnimations: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('soundEnabled must be a boolean');
    }
  });
});

describe('ProfileStore - validateMatchRecord', () => {
  it('accepts a valid match record', () => {
    const valid = {
      id: 'match-1',
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
    const result = validateMatchRecord(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('match-1');
    }
  });

  it('rejects invalid place', () => {
    const result = validateMatchRecord({
      id: 'match-1',
      timestamp: 1000000,
      mode: 'solo_bots' as GameMode,
      playerColor: 'red' as const,
      outcome: 'victory' as const,
      place: 5,
      captures: 3,
      tokensHome: 4,
      durationSeconds: 120,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('place must be an integer between 1 and 4');
    }
  });

  it('rejects invalid outcome', () => {
    const result = validateMatchRecord({
      id: 'match-1',
      timestamp: 1000000,
      mode: 'solo_bots' as GameMode,
      playerColor: 'red' as const,
      outcome: 'draw' as any,
      place: 1,
      captures: 3,
      tokensHome: 4,
      durationSeconds: 120,
    });
    expect(result.ok).toBe(false);
  });
});

describe('ProfileStore - safeLoadProfile', () => {
  it('returns DEFAULT_PROFILE for invalid JSON', () => {
    localStorageMock['ludo_arena_profile_v1'] = 'not-json';
    const profile = safeLoadProfile();
    expect(profile.name).toBe('Arena Master');
    expect(profile.xp).toBe(0);
  });

  it('returns DEFAULT_PROFILE for invalid shape', () => {
    localStorageMock['ludo_arena_profile_v1'] = JSON.stringify({ name: '', xp: -5 });
    const profile = safeLoadProfile();
    expect(profile.name).toBe('Arena Master');
    expect(profile.xp).toBe(0);
  });

  it('returns valid profile when data is correct', () => {
    localStorageMock['ludo_arena_profile_v1'] = JSON.stringify({
      name: 'Custom',
      avatarSeed: 'a',
      level: 3,
      xp: 450,
      totalMatches: 10,
      totalWins: 6,
      totalCaptures: 15,
      totalTokensHome: 20,
      sixesRolled: 8,
      preferredColor: 'green',
    });
    const profile = safeLoadProfile();
    expect(profile.name).toBe('Custom');
    expect(profile.level).toBe(3);
    expect(profile.preferredColor).toBe('green');
  });
});

describe('ProfileStore - safeLoadSettings', () => {
  it('defaults vibration to off and persists a user choice', async () => {
    const { DEFAULT_SETTINGS, loadSettings, saveSettings } = await import('../profileStore');
    expect(DEFAULT_SETTINGS.hapticFeedback).toBe(false);
    expect(loadSettings().hapticFeedback).toBe(false);
    saveSettings({ ...DEFAULT_SETTINGS, hapticFeedback: true });
    expect(loadSettings().hapticFeedback).toBe(true);
  });

  it('returns DEFAULT_SETTINGS for invalid JSON', () => {
    localStorageMock['ludo_arena_settings_v1'] = 'not-json';
    const settings = safeLoadSettings();
    expect(settings.soundEnabled).toBe(true);
    expect(settings.soundVolume).toBe(0.6);
  });

  it('returns DEFAULT_SETTINGS for out-of-range volume', () => {
    localStorageMock['ludo_arena_settings_v1'] = JSON.stringify({
      soundEnabled: true,
      soundVolume: 2.0,
      hapticFeedback: true,
      fastAnimations: false,
    });
    const settings = safeLoadSettings();
    expect(settings.soundVolume).toBe(0.6);
  });
});

describe('ProfileStore - safeLoadMatchHistory', () => {
  it('filters invalid records', () => {
    localStorageMock['ludo_arena_history_v1'] = JSON.stringify([
      {
        id: 'match-1',
        timestamp: 1000000,
        mode: 'solo_bots' as GameMode,
        playerColor: 'red' as const,
        outcome: 'victory' as const,
        place: 1,
        captures: 3,
        tokensHome: 4,
        durationSeconds: 120,
      },
      {
        id: '',
        timestamp: 1000001,
        mode: 'solo_bots' as GameMode,
        playerColor: 'red' as const,
        outcome: 'defeat' as const,
        place: 2,
        captures: 1,
        tokensHome: 2,
        durationSeconds: 100,
      },
    ]);
    const history = safeLoadMatchHistory();
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe('match-1');
  });

  it('filters legacy seed records', () => {
    localStorageMock['ludo_arena_history_v1'] = JSON.stringify([
      {
        id: 'rec-123',
        timestamp: 1000000,
        mode: 'solo_bots' as GameMode,
        playerColor: 'red' as const,
        outcome: 'victory' as const,
        place: 1,
        captures: 3,
        tokensHome: 4,
        durationSeconds: 120,
      },
    ]);
    const history = safeLoadMatchHistory();
    expect(history).toHaveLength(0);
  });
});
