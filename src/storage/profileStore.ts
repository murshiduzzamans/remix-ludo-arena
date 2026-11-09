/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DEFAULT_RULES } from '../engine/gameEngine';
import { GameMode, GameRules, PlayerColor } from '../engine/types';

export interface MatchRecord {
  id: string;
  timestamp: number;
  mode: GameMode;
  playerColor: PlayerColor;
  outcome: 'victory' | 'defeat';
  place: number; // 1, 2, 3, 4
  captures: number;
  tokensHome: number;
  durationSeconds: number;
  sixesRolled?: number; // Sixes rolled during this match
}

export interface UserProfile {
  name: string;
  avatarSeed: string;
  avatarUrl?: string | null;
  level: number;
  xp: number;
  totalMatches: number;
  totalWins: number;
  totalCaptures: number;
  totalTokensHome: number;
  sixesRolled: number;
  preferredColor: PlayerColor;
}

export interface AppSettings {
  soundEnabled: boolean;
  soundVolume: number;
  hapticFeedback: boolean;
  fastAnimations: boolean;
  rules: GameRules;
}

const PROFILE_KEY = 'ludo_arena_profile_v1';
const HISTORY_KEY = 'ludo_arena_history_v1';
const SETTINGS_KEY = 'ludo_arena_settings_v1';
const COINS_KEY = 'ludo_arena_coins_v1';
const HAPTIC_DEFAULT_MIGRATION_KEY = 'ludo_arena_haptics_default_off_v1';
const IDEMPOTENCY_KEY = 'ludo_arena_idempotency_v1';
const RESULT_STATE_KEY = 'ludo_arena_result_state_v2';

export const DEFAULT_COINS = 5000;
export const AVATAR_EMOJI_OPTIONS = ['👩', '👦', '🦁', '🏎️', '👑', '🦊', '🐯', '🥷'] as const;

export function getProfileEmoji(profile: Pick<UserProfile, 'avatarSeed'>): string {
  if (profile.avatarSeed && (AVATAR_EMOJI_OPTIONS as readonly string[]).includes(profile.avatarSeed)) {
    return profile.avatarSeed;
  }
  return '👩';
}

export function getRankTitle(level: number, wins: number): string {
  if (level >= 10 || wins >= 25) return 'Arena Grandmaster 👑';
  if (level >= 6 || wins >= 12) return 'Diamond Champion 💎';
  if (level >= 4 || wins >= 6) return 'Gold Tactician 🏆';
  if (level >= 2 || wins >= 2) return 'Silver Contender ⚔️';
  return 'Arena Contender 👑';
}

export function loadCoins(): number {
  if (typeof window === 'undefined') return DEFAULT_COINS;
  try {
    const raw = localStorage.getItem(COINS_KEY);
    if (!raw) return DEFAULT_COINS;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_COINS;
    return Math.floor(parsed);
  } catch {
    return DEFAULT_COINS;
  }
}

export function saveCoins(coins: number): void {
  if (typeof window === 'undefined') return;
  try {
    const safeCoins = Math.max(0, Math.floor(Number.isFinite(coins) ? coins : DEFAULT_COINS));
    localStorage.setItem(COINS_KEY, String(safeCoins));
  } catch {}
}

export function addCoins(delta: number): number {
  const next = Math.max(0, loadCoins() + Math.floor(delta));
  saveCoins(next);
  return next;
}

export interface IdempotencyEntry {
  key: string;
  expiresAt: number;
}

/**
 * Discriminated union for validation results.
 */
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

// A new player starts with real zeros; stats only grow from recorded matches
export const DEFAULT_PROFILE: UserProfile = {
  name: 'Arena Master',
  avatarSeed: 'master-1',
  avatarUrl: null,
  level: 1,
  xp: 0,
  totalMatches: 0,
  totalWins: 0,
  totalCaptures: 0,
  totalTokensHome: 0,
  sixesRolled: 0,
  preferredColor: 'red',
};

// Ids used by the old demo seed data; removed so they never count as real history
const LEGACY_SEED_PREFIX = 'rec-';

/**
 * Generates a cryptographically random match id for idempotency protection.
 * Prevents duplicate match result submissions from the same client.
 */
export function generateMatchId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `match-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Loads processed match keys for idempotency checking.
 * Expired entries are cleaned up on read.
 */
function loadIdempotency(): IdempotencyEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(IDEMPOTENCY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return (parsed as IdempotencyEntry[]).filter(
      (e) => e && typeof e.key === 'string' && typeof e.expiresAt === 'number' && e.expiresAt > now
    );
  } catch {
    return [];
  }
}

/**
 * Saves processed match keys for idempotency checking.
 */
function saveIdempotency(entries: IdempotencyEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(IDEMPOTENCY_KEY, JSON.stringify(entries));
  } catch {}
}

/**
 * Returns true if the given idempotency key has already been processed.
 * Call `recordIdempotency` immediately after to mark it as processed.
 */
export function checkIdempotency(key: string): boolean {
  if (loadResultState()?.processedMatchIds.includes(key)) return true;
  const entries = loadIdempotency();
  return entries.some((e) => e.key === key);
}

/**
 * Marks an idempotency key as processed with a 24-hour expiration.
 */
export function recordIdempotency(key: string): void {
  const entries = loadIdempotency();
  entries.push({ key, expiresAt: Date.now() + 86_400_000 }); // 24 hours
  saveIdempotency(entries);
}

/**
 * Validates a raw parsed profile object against the UserProfile schema.
 */
export function validateProfile(raw: unknown): ValidationResult<UserProfile> {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['Profile is not an object'] };
  }
  const p = raw as Record<string, unknown>;

  if (typeof p.name !== 'string' || p.name.length === 0) {
    errors.push('name must be a non-empty string');
  }
  if (typeof p.avatarSeed !== 'string') {
    errors.push('avatarSeed must be a string');
  }
  if (p.avatarUrl !== undefined && p.avatarUrl !== null && typeof p.avatarUrl !== 'string') {
    errors.push('avatarUrl must be a string or null');
  }
  if (typeof p.level !== 'number' || !Number.isInteger(p.level) || p.level < 1) {
    errors.push('level must be a positive integer');
  }
  if (typeof p.xp !== 'number' || !Number.isFinite(p.xp) || p.xp < 0) {
    errors.push('xp must be a non-negative number');
  }
  if (typeof p.totalMatches !== 'number' || !Number.isInteger(p.totalMatches) || p.totalMatches < 0) {
    errors.push('totalMatches must be a non-negative integer');
  }
  if (typeof p.totalWins !== 'number' || !Number.isInteger(p.totalWins) || p.totalWins < 0) {
    errors.push('totalWins must be a non-negative integer');
  }
  if (typeof p.totalCaptures !== 'number' || !Number.isInteger(p.totalCaptures) || p.totalCaptures < 0) {
    errors.push('totalCaptures must be a non-negative integer');
  }
  if (typeof p.totalTokensHome !== 'number' || !Number.isInteger(p.totalTokensHome) || p.totalTokensHome < 0) {
    errors.push('totalTokensHome must be a non-negative integer');
  }
  if (typeof p.sixesRolled !== 'number' || !Number.isInteger(p.sixesRolled) || p.sixesRolled < 0) {
    errors.push('sixesRolled must be a non-negative integer');
  }
  if (
    p.preferredColor !== 'red' &&
    p.preferredColor !== 'green' &&
    p.preferredColor !== 'yellow' &&
    p.preferredColor !== 'blue'
  ) {
    errors.push('preferredColor must be one of: red, green, yellow, blue');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      name: p.name as string,
      avatarSeed: p.avatarSeed as string,
      avatarUrl: (p.avatarUrl as string | null | undefined) ?? null,
      level: p.level as number,
      xp: p.xp as number,
      totalMatches: p.totalMatches as number,
      totalWins: p.totalWins as number,
      totalCaptures: p.totalCaptures as number,
      totalTokensHome: p.totalTokensHome as number,
      sixesRolled: p.sixesRolled as number,
      preferredColor: p.preferredColor as PlayerColor,
    },
  };
}

/**
 * Validates a raw parsed settings object against the AppSettings schema.
 */
export function validateSettings(raw: unknown): ValidationResult<AppSettings> {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['Settings is not an object'] };
  }
  const s = raw as Record<string, unknown>;

  if (typeof s.soundEnabled !== 'boolean') {
    errors.push('soundEnabled must be a boolean');
  }
  if (typeof s.soundVolume !== 'number' || !Number.isFinite(s.soundVolume) || s.soundVolume < 0 || s.soundVolume > 1) {
    errors.push('soundVolume must be a number between 0 and 1');
  }
  if (typeof s.hapticFeedback !== 'boolean') {
    errors.push('hapticFeedback must be a boolean');
  }
  if (typeof s.fastAnimations !== 'boolean') {
    errors.push('fastAnimations must be a boolean');
  }

  const rawRules = s.rules;
  if (rawRules !== undefined && (!rawRules || typeof rawRules !== 'object')) {
    errors.push('rules must be an object');
  } else if (rawRules !== undefined) {
    const ruleValues = rawRules as Record<string, unknown>;
    for (const key of [
      'sixToExit',
      'extraTurnOnSix',
      'extraTurnOnCapture',
      'extraTurnOnFinish',
      'consecutiveSixForfeit',
      'safeStarsActive',
    ] as const) {
      if (typeof ruleValues[key] !== 'boolean') {
        errors.push(`rules.${key} must be a boolean`);
      }
    }
    for (const key of [
      'startSquaresAlwaysSafe',
      'blocksEnabled',
      'blockStopsPassing',
      'extraTurnOnSixNoMove',
      'continueUntilRanked',
    ] as const) {
      if (ruleValues[key] !== undefined && typeof ruleValues[key] !== 'boolean') {
        errors.push(`rules.${key} must be a boolean`);
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      soundEnabled: s.soundEnabled as boolean,
      soundVolume: s.soundVolume as number,
      hapticFeedback: s.hapticFeedback as boolean,
      fastAnimations: s.fastAnimations as boolean,
      rules: { ...DEFAULT_RULES, ...((s.rules as GameRules | undefined) ?? {}) },
    },
  };
}

/**
 * Validates a raw parsed match record against the MatchRecord schema.
 */
export function validateMatchRecord(raw: unknown): ValidationResult<MatchRecord> {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['Match record is not an object'] };
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.id !== 'string' || r.id.length === 0) {
    errors.push('id must be a non-empty string');
  }
  if (typeof r.timestamp !== 'number' || !Number.isFinite(r.timestamp)) {
    errors.push('timestamp must be a number');
  }
  if (
    r.mode !== 'classic_4p' &&
    r.mode !== 'team_2v2' &&
    r.mode !== 'solo_bots' &&
    r.mode !== 'pass_and_play' &&
    r.mode !== 'head_to_head_1v1'
  ) {
    errors.push('mode must be a valid GameMode');
  }
  if (
    r.playerColor !== 'red' &&
    r.playerColor !== 'green' &&
    r.playerColor !== 'yellow' &&
    r.playerColor !== 'blue'
  ) {
    errors.push('playerColor must be one of: red, green, yellow, blue');
  }
  if (r.outcome !== 'victory' && r.outcome !== 'defeat') {
    errors.push('outcome must be "victory" or "defeat"');
  }
  if (typeof r.place !== 'number' || !Number.isInteger(r.place) || r.place < 1 || r.place > 4) {
    errors.push('place must be an integer between 1 and 4');
  }
  if (typeof r.captures !== 'number' || !Number.isInteger(r.captures) || r.captures < 0) {
    errors.push('captures must be a non-negative integer');
  }
  if (typeof r.tokensHome !== 'number' || !Number.isInteger(r.tokensHome) || r.tokensHome < 0) {
    errors.push('tokensHome must be a non-negative integer');
  }
  if (typeof r.durationSeconds !== 'number' || !Number.isFinite(r.durationSeconds) || r.durationSeconds < 0) {
    errors.push('durationSeconds must be a non-negative number');
  }
  if (
    r.sixesRolled !== undefined &&
    (typeof r.sixesRolled !== 'number' || !Number.isInteger(r.sixesRolled) || r.sixesRolled < 0)
  ) {
    errors.push('sixesRolled must be a non-negative integer');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      id: r.id as string,
      timestamp: r.timestamp as number,
      mode: r.mode as GameMode,
      playerColor: r.playerColor as PlayerColor,
      outcome: r.outcome as 'victory' | 'defeat',
      place: r.place as number,
      captures: r.captures as number,
      tokensHome: r.tokensHome as number,
      durationSeconds: r.durationSeconds as number,
      sixesRolled: r.sixesRolled as number | undefined,
    },
  };
}

/**
 * Atomically loads the profile, applies an updater function, and saves.
 * Prevents lost-update race conditions when multiple rapid calls occur.
 */
export function atomicUpdateProfile(updater: (p: UserProfile) => UserProfile): UserProfile {
  const profile = loadProfile();
  const updated = updater(profile);
  saveProfile(updated);
  return updated;
}

export const DEFAULT_SETTINGS: AppSettings = {
  soundEnabled: true,
  soundVolume: 0.6,
  hapticFeedback: false,
  fastAnimations: false,
  rules: DEFAULT_RULES,
};

export function loadProfile(): UserProfile {
  const state = loadResultState();
  if (state) return state.profile;
  return safeLoadProfile();
}

/**
 * Safely loads the profile with validation. Returns DEFAULT_PROFILE on invalid data.
 */
export function safeLoadProfile(): UserProfile {
  if (typeof window === 'undefined') return DEFAULT_PROFILE;
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return DEFAULT_PROFILE;
    const parsed = JSON.parse(raw);
    const result = validateProfile(parsed);
    return result.ok ? result.value : DEFAULT_PROFILE;
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function saveProfile(profile: UserProfile): void {
  if (typeof window === 'undefined') return;
  try {
    const state = loadResultState();
    if (state) {
      localStorage.setItem(RESULT_STATE_KEY, JSON.stringify({ ...state, profile }));
      try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch {}
    } else {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    }
  } catch {}
}

export function loadMatchHistory(): MatchRecord[] {
  const state = loadResultState();
  if (state) return state.history;
  return safeLoadMatchHistory();
}

/**
 * Safely loads match history with per-record validation. Filters invalid records.
 */
export function safeLoadMatchHistory(): MatchRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid: MatchRecord[] = [];
    for (const item of parsed) {
      const result = validateMatchRecord(item);
      if (result.ok && !result.value.id.startsWith(LEGACY_SEED_PREFIX)) {
        valid.push(result.value);
      }
    }
    return valid;
  } catch {
    return [];
  }
}

export function recordMatchOutcome(record: MatchRecord & { matchId?: string }): void {
  if (typeof window === 'undefined') return;
  try {
    const matchId = record.matchId ?? record.id;
    const result = validateMatchRecord(record);
    if (!result.ok || checkIdempotency(matchId) || loadResultState()?.processedMatchIds.includes(matchId)) return;

    const previous = loadResultState();
    const profile = previous?.profile ?? safeLoadProfile();
    const history = previous?.history ?? safeLoadMatchHistory();
    const newXP = profile.xp + (record.outcome === 'victory' ? 100 : 35);
    const updatedProfile: UserProfile = {
      ...profile,
      xp: newXP,
      level: Math.floor(newXP / 200) + 1,
      totalMatches: profile.totalMatches + 1,
      totalWins: profile.totalWins + (record.outcome === 'victory' ? 1 : 0),
      totalCaptures: profile.totalCaptures + record.captures,
      totalTokensHome: profile.totalTokensHome + record.tokensHome,
      sixesRolled: profile.sixesRolled + (record.sixesRolled ?? 0),
    };
    const nextHistory = [result.value, ...history].slice(0, 25);

    // A single storage write commits history, profile totals, and idempotency together.
    localStorage.setItem(RESULT_STATE_KEY, JSON.stringify({
      version: 2,
      profile: updatedProfile,
      history: nextHistory,
      processedMatchIds: [...(previous?.processedMatchIds ?? []), matchId].slice(-500),
    }));
    // Mirror the updated profile so the fallback PROFILE_KEY snapshot never lags
    // behind matches recorded through the result ledger.
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(updatedProfile)); } catch {}
    addCoins(record.outcome === 'victory' ? 500 : 150);
  } catch {}
}

/** Records a match through the same single-write result ledger used by the app. */
export function recordMatchOutcomeResilient(record: MatchRecord & { matchId?: string }): void {
  recordMatchOutcome(record);
}

interface ResultState {
  version: 2;
  profile: UserProfile;
  history: MatchRecord[];
  processedMatchIds: string[];
}

function loadResultState(): ResultState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(RESULT_STATE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const state = parsed as Partial<ResultState>;
    const profile = validateProfile(state.profile);
    if (state.version !== 2 || !profile.ok || !Array.isArray(state.history) || !Array.isArray(state.processedMatchIds)) return null;
    const validatedHistory = state.history.map(validateMatchRecord);
    // A single corrupt entry must not void the whole ledger: drop bad history
    // entries and non-string idempotency ids instead of returning null, which
    // would reset stats and re-credit already-processed matches.
    return {
      version: 2,
      profile: profile.value,
      history: validatedHistory.flatMap((entry) => entry.ok ? [entry.value] : []),
      processedMatchIds: state.processedMatchIds.filter((id) => typeof id === 'string'),
    };
  } catch {
    return null;
  }
}

export function loadSettings(): AppSettings {
  return safeLoadSettings();
}

/**
 * Safely loads settings with validation. Returns DEFAULT_SETTINGS on invalid data.
 */
export function safeLoadSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      localStorage.setItem(HAPTIC_DEFAULT_MIGRATION_KEY, '1');
      return DEFAULT_SETTINGS;
    }
    const parsed = JSON.parse(raw);
    const result = validateSettings(parsed);
    if (!result.ok) return DEFAULT_SETTINGS;
    if (!localStorage.getItem(HAPTIC_DEFAULT_MIGRATION_KEY)) {
      localStorage.setItem(HAPTIC_DEFAULT_MIGRATION_KEY, '1');
      if (result.value.hapticFeedback) {
        const migrated = { ...result.value, hapticFeedback: false };
        saveSettings(migrated);
        return migrated;
      }
    }
    return result.value;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}
