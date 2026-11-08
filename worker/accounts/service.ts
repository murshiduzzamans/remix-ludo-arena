/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Account service - high-level account operations
 */

import type { D1Database } from '@cloudflare/workers-types';
import { generateToken } from '../auth/crypto';
import {
  createGuestUser,
  createSession,
  findAndRefreshSession,
  deleteSession as dbDeleteSession,
  findUserByGoogleSub,
  linkGoogleAccount,
  findUserByGithubId,
  linkGithubAccount,
  findUserBySyncCode,
  ensureUserSyncCode,
  mergeGuestIntoAccount,
  getUserWithStats,
  updateUserProfile,
  deleteUserAccount,
  getPublicProfile,
  getLeaderboard as dbGetLeaderboard,
} from './database';
import { normalizeSyncCode } from '../auth/syncCode';
import { SESSION_CONFIG } from './config';
import type { User, UserWithStats, PublicProfile, LeaderboardEntry } from './types';

/**
 * Creates a guest account and session
 */
export async function createGuestSession(
  db: D1Database,
  displayName: string,
  avatarId: number
): Promise<{ user: User; sessionToken: string }> {
  const user = await createGuestUser(db, displayName, avatarId);
  const sessionToken = generateToken(32);
  await createSession(db, user.id, sessionToken, SESSION_CONFIG.DURATION_MS);

  return { user, sessionToken };
}

/**
 * Validates a session and returns user
 */
export async function validateSession(
  db: D1Database,
  sessionToken: string
): Promise<{ user: User } | null> {
  const result = await findAndRefreshSession(db, sessionToken, SESSION_CONFIG.SLIDING_WINDOW_MS);
  return result ? { user: result.user } : null;
}

/**
 * Logs out a user by deleting their session
 */
export async function logout(db: D1Database, sessionToken: string): Promise<void> {
  await dbDeleteSession(db, sessionToken);
}

/**
 * Links a Google account to the current user
 * Returns whether a merge happened
 */
export async function linkOrMergeGoogleAccount(
  db: D1Database,
  currentUserId: string,
  googleSub: string,
  googleName: string,
  googleEmail: string | undefined
): Promise<{ merged: boolean; userId: string; sessionToken: string }> {
  const currentUser = await getUserWithStats(db, currentUserId);
  if (!currentUser) {
    throw new Error('Current user not found');
  }

  // Check if Google account already exists
  const existingGoogleUser = await findUserByGoogleSub(db, googleSub);

  if (!existingGoogleUser) {
    // New Google account - link it to current user
    await linkGoogleAccount(db, currentUserId, googleSub, googleName);
    const sessionToken = generateToken(32);
    await createSession(db, currentUserId, sessionToken, SESSION_CONFIG.DURATION_MS);
    return { merged: false, userId: currentUserId, sessionToken };
  }

  // Google account already exists
  if (existingGoogleUser.id === currentUserId) {
    // Same user, just create new session
    const sessionToken = generateToken(32);
    await createSession(db, currentUserId, sessionToken, SESSION_CONFIG.DURATION_MS);
    return { merged: false, userId: currentUserId, sessionToken };
  }

  // Different users - merge guest into Google account if current is guest with progress
  if (currentUser.isGuest && currentUser.stats.gamesPlayed > 0) {
    await mergeGuestIntoAccount(db, existingGoogleUser.id, currentUserId);
    const sessionToken = generateToken(32);
    await createSession(db, existingGoogleUser.id, sessionToken, SESSION_CONFIG.DURATION_MS);
    return { merged: true, userId: existingGoogleUser.id, sessionToken };
  }

  // Current user is not guest or has no progress - just switch to Google account
  const sessionToken = generateToken(32);
  await createSession(db, existingGoogleUser.id, sessionToken, SESSION_CONFIG.DURATION_MS);
  return { merged: false, userId: existingGoogleUser.id, sessionToken };
}

/**
 * Links a GitHub account to the current user
 * Returns whether a merge happened
 */
export async function linkOrMergeGithubAccount(
  db: D1Database,
  currentUserId: string,
  githubId: string,
  githubName: string
): Promise<{ merged: boolean; userId: string; sessionToken: string }> {
  const currentUser = await getUserWithStats(db, currentUserId);
  if (!currentUser) {
    throw new Error('Current user not found');
  }

  // Check if GitHub account already exists
  const existingGithubUser = await findUserByGithubId(db, githubId);

  if (!existingGithubUser) {
    // New GitHub account - link it to current user
    await linkGithubAccount(db, currentUserId, githubId, githubName);
    const sessionToken = generateToken(32);
    await createSession(db, currentUserId, sessionToken, SESSION_CONFIG.DURATION_MS);
    return { merged: false, userId: currentUserId, sessionToken };
  }

  // GitHub account already exists
  if (existingGithubUser.id === currentUserId) {
    const sessionToken = generateToken(32);
    await createSession(db, currentUserId, sessionToken, SESSION_CONFIG.DURATION_MS);
    return { merged: false, userId: currentUserId, sessionToken };
  }

  // Different users - merge guest into GitHub account if current is guest with progress
  if (currentUser.isGuest && currentUser.stats.gamesPlayed > 0) {
    await mergeGuestIntoAccount(db, existingGithubUser.id, currentUserId);
    const sessionToken = generateToken(32);
    await createSession(db, existingGithubUser.id, sessionToken, SESSION_CONFIG.DURATION_MS);
    return { merged: true, userId: existingGithubUser.id, sessionToken };
  }

  // Current user is not guest or has no progress - just switch to GitHub account
  const sessionToken = generateToken(32);
  await createSession(db, existingGithubUser.id, sessionToken, SESSION_CONFIG.DURATION_MS);
  return { merged: false, userId: existingGithubUser.id, sessionToken };
}

/**
 * Gets or generates a sync code for a user
 */
export async function getUserSyncCode(db: D1Database, userId: string): Promise<string> {
  return await ensureUserSyncCode(db, userId);
}

/**
 * Restores an account using a sync code and creates a new session
 */
export async function restoreAccountWithSyncCode(
  db: D1Database,
  syncCodeInput: string
): Promise<{ user: User; sessionToken: string } | null> {
  const normalized = normalizeSyncCode(syncCodeInput);
  if (!normalized) return null;

  const user = await findUserBySyncCode(db, normalized);
  if (!user) return null;

  const sessionToken = generateToken(32);
  await createSession(db, user.id, sessionToken, SESSION_CONFIG.DURATION_MS);
  return { user, sessionToken };
}

/**
 * Gets user profile with stats
 */
export async function getProfile(db: D1Database, userId: string): Promise<UserWithStats | null> {
  return await getUserWithStats(db, userId);
}

/**
 * Updates user profile
 */
export async function updateProfile(
  db: D1Database,
  userId: string,
  displayName: string,
  avatarId: number
): Promise<void> {
  await updateUserProfile(db, userId, displayName, avatarId);
}

/**
 * Deletes user account
 */
export async function deleteAccount(db: D1Database, userId: string): Promise<void> {
  await deleteUserAccount(db, userId);
}

/**
 * Gets public profile
 */
export async function getPublic(db: D1Database, userId: string): Promise<PublicProfile | null> {
  return await getPublicProfile(db, userId);
}

/**
 * Gets leaderboard with caching
 */
const leaderboardCache = new Map<string, { data: LeaderboardEntry[]; expiresAt: number }>();

export async function getLeaderboard(
  db: D1Database,
  limit: number,
  cacheTtlSeconds: number
): Promise<LeaderboardEntry[]> {
  const cacheKey = `leaderboard:${limit}`;
  const cached = leaderboardCache.get(cacheKey);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const data = await dbGetLeaderboard(db, limit);
  leaderboardCache.set(cacheKey, { data, expiresAt: now + cacheTtlSeconds * 1000 });

  return data;
}
