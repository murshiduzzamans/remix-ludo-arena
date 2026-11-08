/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Authentication route handlers
 */

import type { D1Database } from '@cloudflare/workers-types';
import {
  createGuestSession,
  validateSession,
  logout,
  linkOrMergeGoogleAccount,
  linkOrMergeGithubAccount,
  getUserSyncCode,
  restoreAccountWithSyncCode,
  getProfile,
  updateProfile,
  saveAvatar,
  deleteAccount,
  getPublic,
  getLeaderboard,
} from '../accounts/service';
import { createOAuthState, buildAuthorizationUrl, exchangeCodeForTokens, verifyIdToken } from '../auth/google';
import { buildGithubAuthUrl, exchangeGithubCodeForToken, fetchGithubUser } from '../auth/github';
import { createSessionCookie, createOAuthStateCookie, clearCookie, getCookie } from '../auth/cookies';
import { signData, verifySignature } from '../auth/crypto';
import { validateDisplayName, validateAvatarId, validateAvatarImage, isInAppBrowser, isOriginAllowed, hasRequiredHeader } from '../auth/validation';
import { LEADERBOARD_CONFIG } from '../accounts/config';

interface Env {
  DB?: D1Database;
  ACCOUNTS_ENABLED?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  ALLOWED_ORIGINS?: string;
}

function json(data: unknown, status = 200, origin: string | null = '*'): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
      'Access-Control-Allow-Credentials': 'true',
      'Cache-Control': 'no-store',
    },
  });
}

function isAccountsEnabled(env: Env): boolean {
  return env.ACCOUNTS_ENABLED === 'true' && Boolean(env.DB && env.SESSION_SECRET);
}

function getRedirectUri(request: Request, path: string): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}${path}`;
}

/**
 * POST /api/auth/guest - Create guest account
 */
export async function handleGuestAuth(request: Request, env: Env): Promise<Response> {
  if (!isAccountsEnabled(env)) {
    return json({ error: 'Accounts are not enabled.' }, 503);
  }

  const requestOrigin = request.headers.get('Origin');
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '').split(',').map(o => o.trim()).filter(Boolean);
  if (requestOrigin && !isOriginAllowed(request, allowedOrigins)) {
    return json({ error: 'Origin not allowed.' }, 403, null);
  }

  let body: { displayName?: unknown; avatarId?: unknown };
  try {
    body = await request.json() as { displayName?: unknown; avatarId?: unknown };
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const displayName = validateDisplayName(body.displayName);
  if (!displayName) {
    return json({ error: 'Display name must be 2-20 characters.' }, 400);
  }

  const avatarId = validateAvatarId(body.avatarId) ?? 0;

  try {
    const { user, sessionToken } = await createGuestSession(env.DB!, displayName, avatarId, env.SESSION_SECRET!);
    const cookie = createSessionCookie(sessionToken);

    return new Response(JSON.stringify({
      user: {
        id: user.id,
        displayName: user.displayName,
        avatarId: user.avatarId,
        isGuest: true,
      },
    }), {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': cookie,
        ...(requestOrigin ? { 'Access-Control-Allow-Origin': requestOrigin } : {}),
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  } catch (error) {
    console.error('Guest auth error:', error);
    return json({ error: 'Failed to create guest account.' }, 500);
  }
}

/**
 * GET /api/auth/google/start - Start OAuth flow
 */
export async function handleGoogleAuthStart(request: Request, env: Env): Promise<Response> {
  if (!isAccountsEnabled(env)) {
    return new Response('Accounts are not enabled.', { status: 503 });
  }

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return new Response('Google sign-in is not configured.', { status: 501 });
  }

  // Check for in-app browser
  const userAgent = request.headers.get('User-Agent') ?? '';
  if (isInAppBrowser(userAgent)) {
    const response = new Response(
      `<!DOCTYPE html>
<html>
<head><title>Open in Browser</title></head>
<body style="font-family: system-ui; text-align: center; padding: 2rem;">
  <h1>⚠️ Open in Your Browser</h1>
  <p>Google login doesn't work in embedded browsers.</p>
  <p>Please tap the menu and select "Open in Chrome" or "Open in Safari".</p>
  <button onclick="navigator.clipboard.writeText(window.location.origin).then(() => alert('Link copied!'))">Copy Link</button>
</body>
</html>`,
      { status: 200, headers: { 'Content-Type': 'text/html' } }
    );
  }

  const redirectUri = getRedirectUri(request, '/api/auth/google/callback');
  const oauthState = createOAuthState(redirectUri);

  // Sign the state to prevent tampering
  const stateData = JSON.stringify(oauthState);
  const signature = await signData(stateData, env.SESSION_SECRET!);
  const signedState = `${stateData}.${signature}`;

  try {
    const authUrl = await buildAuthorizationUrl(
      env.GOOGLE_CLIENT_ID!,
      redirectUri,
      oauthState.state,
      oauthState.nonce,
      oauthState.codeVerifier
    );

    const stateCookie = createOAuthStateCookie(signedState);

    return new Response(null, {
      status: 302,
      headers: {
        Location: authUrl,
        'Set-Cookie': stateCookie,
      },
    });
  } catch (error) {
    console.error('OAuth start error:', error);
    return new Response('Failed to start authentication.', { status: 500 });
  }
}

/**
 * GET /api/auth/google/callback - OAuth callback
 */
export async function handleGoogleAuthCallback(request: Request, env: Env): Promise<Response> {
  if (!isAccountsEnabled(env)) {
    return new Response('Accounts are not enabled.', { status: 503 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    return new Response(`Authentication failed: ${error}`, { status: 400 });
  }

  if (!code || !state) {
    return new Response('Missing code or state.', { status: 400 });
  }

  // Retrieve and verify OAuth state
  const signedState = getCookie(request, '__Host-oauth-state');
  if (!signedState) {
    return new Response('OAuth state not found.', { status: 400 });
  }

  const [stateData, signature] = signedState.split('.');
  if (!stateData || !signature) {
    return new Response('Invalid OAuth state.', { status: 400 });
  }

  const isValid = await verifySignature(stateData, signature, env.SESSION_SECRET!);
  if (!isValid) {
    return new Response('Invalid OAuth state signature.', { status: 400 });
  }

  let oauthState: ReturnType<typeof createOAuthState>;
  try {
    oauthState = JSON.parse(stateData);
  } catch {
    return new Response('Invalid OAuth state format.', { status: 400 });
  }

  if (oauthState.state !== state) {
    return new Response('State mismatch.', { status: 400 });
  }

  if (Date.now() > oauthState.expiresAt) {
    return new Response('OAuth state expired.', { status: 400 });
  }

  try {
    // Exchange code for tokens
    const { idToken } = await exchangeCodeForTokens(
      code,
      env.GOOGLE_CLIENT_ID!,
      env.GOOGLE_CLIENT_SECRET!,
      oauthState.redirectUri,
      oauthState.codeVerifier
    );

    // Verify ID token
    const claims = await verifyIdToken(idToken, env.GOOGLE_CLIENT_ID!, oauthState.nonce);

    // Get current session if exists
    const sessionToken = getCookie(request, '__Host-session');
    let currentUserId: string | undefined;

    if (sessionToken) {
      const session = await validateSession(env.DB!, sessionToken, env.SESSION_SECRET!);
      currentUserId = session?.user.id;
    }

    // If no current session, create guest first
    if (!currentUserId) {
      const displayName = claims.name ?? claims.email?.split('@')[0] ?? 'Player';
      const { user, sessionToken: guestToken } = await createGuestSession(env.DB!, displayName, 0, env.SESSION_SECRET!);
      await logout(env.DB!, guestToken, env.SESSION_SECRET!);
      currentUserId = user.id;
    }

    // Link or merge Google account
    const result = await linkOrMergeGoogleAccount(
      env.DB!,
      currentUserId,
      claims.sub,
      claims.name ?? 'Player',
      claims.email,
      env.SESSION_SECRET!
    );

    const cookie = createSessionCookie(result.sessionToken);
    const clearStateCookie = clearCookie('__Host-oauth-state');

    const response = new Response(
      `<!DOCTYPE html>
<html>
<head><title>Login Successful</title></head>
<body style="font-family: system-ui; text-align: center; padding: 2rem;">
  <h1>✓ Login Successful</h1>
  <p>${result.merged ? 'Your progress has been merged.' : 'Welcome back!'}</p>
  <p>Redirecting...</p>
  <script>
    setTimeout(() => window.location.href = '/', 1500);
  </script>
</body>
</html>`,
      {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
        },
      }
    );
    response.headers.append('Set-Cookie', cookie);
    response.headers.append('Set-Cookie', clearStateCookie);
    return response;
  } catch (error) {
    console.error('OAuth callback error:', error);
    return new Response('Authentication failed.', { status: 500 });
  }
}

/**
 * POST /api/auth/logout
 */
export async function handleLogout(request: Request, env: Env): Promise<Response> {
  if (!isAccountsEnabled(env)) {
    return json({ error: 'Accounts are not enabled.' }, 503);
  }

  const requestOrigin = request.headers.get('Origin');
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '').split(',').map(o => o.trim()).filter(Boolean);
  if (requestOrigin && !isOriginAllowed(request, allowedOrigins)) {
    return json({ error: 'Origin not allowed.' }, 403, null);
  }

  const sessionToken = getCookie(request, '__Host-session');
  if (sessionToken) {
    try {
      await logout(env.DB!, sessionToken, env.SESSION_SECRET!);
    } catch {
      // Ignore errors on logout
    }
  }

  const cookie = clearCookie('__Host-session');

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookie,
      ...(requestOrigin ? { 'Access-Control-Allow-Origin': requestOrigin } : {}),
      'Access-Control-Allow-Credentials': 'true',
    },
  });
}

/**
 * GET /api/me - Get current user profile
 */
export async function handleGetMe(request: Request, env: Env): Promise<Response> {
  if (!isAccountsEnabled(env)) {
    return json({ error: 'Accounts are not enabled.' }, 503);
  }

  const sessionToken = getCookie(request, '__Host-session');
  if (!sessionToken) {
    return json({ error: 'Not authenticated.' }, 401);
  }

  try {
    const session = await validateSession(env.DB!, sessionToken, env.SESSION_SECRET!);
    if (!session) {
      return json({ error: 'Session expired.' }, 401);
    }

    const userWithStats = await getProfile(env.DB!, session.user.id);
    if (!userWithStats) {
      return json({ error: 'User not found.' }, 404);
    }

    return json({
      user: {
        id: userWithStats.id,
        displayName: userWithStats.displayName,
        avatarId: userWithStats.avatarId,
        avatarUrl: userWithStats.avatarUrl ?? null,
        isGuest: userWithStats.isGuest,
        level: userWithStats.stats.level,
        hasGithub: Boolean(userWithStats.githubId),
        hasGoogle: Boolean(userWithStats.googleSub),
      },
      stats: {
        gamesPlayed: userWithStats.stats.gamesPlayed,
        wins: userWithStats.stats.wins,
        losses: userWithStats.stats.losses,
        captures: userWithStats.stats.captures,
        xp: userWithStats.stats.xp,
        level: userWithStats.stats.level,
      },
    });
  } catch (error) {
    console.error('Get me error:', error);
    return json({ error: 'Failed to get profile.' }, 500);
  }
}

/**
 * PATCH /api/me - Update profile
 */
export async function handleUpdateMe(request: Request, env: Env): Promise<Response> {
  if (!isAccountsEnabled(env)) {
    return json({ error: 'Accounts are not enabled.' }, 503);
  }

  const requestOrigin = request.headers.get('Origin');
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '').split(',').map(o => o.trim()).filter(Boolean);
  if (requestOrigin && !isOriginAllowed(request, allowedOrigins)) {
    return json({ error: 'Origin not allowed.' }, 403, null);
  }

  const sessionToken = getCookie(request, '__Host-session');
  if (!sessionToken) {
    return json({ error: 'Not authenticated.' }, 401);
  }

  let body: { displayName?: unknown; avatarId?: unknown };
  try {
    body = await request.json() as { displayName?: unknown; avatarId?: unknown };
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const displayName = validateDisplayName(body.displayName);
  if (!displayName) {
    return json({ error: 'Display name must be 2-20 characters.' }, 400);
  }

  const avatarId = validateAvatarId(body.avatarId);
  if (avatarId === null) {
    return json({ error: 'Avatar ID must be 0-11.' }, 400);
  }

  try {
    const session = await validateSession(env.DB!, sessionToken, env.SESSION_SECRET!);
    if (!session) {
      return json({ error: 'Session expired.' }, 401);
    }

    await updateProfile(env.DB!, session.user.id, displayName, avatarId);

    return json({ success: true });
  } catch (error) {
    console.error('Update profile error:', error);
    return json({ error: 'Failed to update profile.' }, 500);
  }
}

/**
 * DELETE /api/me - Delete account
 */
export async function handleDeleteMe(request: Request, env: Env): Promise<Response> {
  if (!isAccountsEnabled(env)) {
    return json({ error: 'Accounts are not enabled.' }, 503);
  }

  const requestOrigin = request.headers.get('Origin');
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '').split(',').map(o => o.trim()).filter(Boolean);
  if (requestOrigin && !isOriginAllowed(request, allowedOrigins)) {
    return json({ error: 'Origin not allowed.' }, 403, null);
  }

  const sessionToken = getCookie(request, '__Host-session');
  if (!sessionToken) {
    return json({ error: 'Not authenticated.' }, 401);
  }

  try {
    const session = await validateSession(env.DB!, sessionToken, env.SESSION_SECRET!);
    if (!session) {
      return json({ error: 'Session expired.' }, 401);
    }

    await deleteAccount(env.DB!, session.user.id);
    const cookie = clearCookie('__Host-session');

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': cookie,
        ...(requestOrigin ? { 'Access-Control-Allow-Origin': requestOrigin } : {}),
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  } catch (error) {
    console.error('Delete account error:', error);
    return json({ error: 'Failed to delete account.' }, 500);
  }
}

/**
 * GET /api/profile/:id - Get public profile
 */
export async function handleGetPublicProfile(userId: string, env: Env): Promise<Response> {
  if (!isAccountsEnabled(env)) {
    return json({ error: 'Accounts are not enabled.' }, 503);
  }

  try {
    const profile = await getPublic(env.DB!, userId);
    if (!profile) {
      return json({ error: 'User not found.' }, 404);
    }

    return json(profile);
  } catch (error) {
    console.error('Get public profile error:', error);
    return json({ error: 'Failed to get profile.' }, 500);
  }
}

/**
 * GET /api/leaderboard - Get leaderboard
 */
export async function handleGetLeaderboard(request: Request, env: Env): Promise<Response> {
  if (!isAccountsEnabled(env)) {
    return json({ error: 'Accounts are not enabled.' }, 503);
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10), 1), LEADERBOARD_CONFIG.MAX_ENTRIES) : 20;

  try {
    const leaderboard = await getLeaderboard(env.DB!, limit, LEADERBOARD_CONFIG.CACHE_TTL_SECONDS);
    return json({ leaderboard });
  } catch (error) {
    console.error('Get leaderboard error:', error);
    return json({ error: 'Failed to get leaderboard.' }, 500);
  }
}

/**
 * GET /api/auth/github/start - Start GitHub OAuth flow
 */
export async function handleGithubAuthStart(request: Request, env: Env): Promise<Response> {
  if (!isAccountsEnabled(env)) {
    return new Response('Accounts are not enabled.', { status: 503 });
  }

  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return new Response('GitHub sign-in is not configured.', { status: 501 });
  }

  const redirectUri = getRedirectUri(request, '/api/auth/github/callback');
  const oauthState = createOAuthState(redirectUri);

  const stateData = JSON.stringify(oauthState);
  const signature = await signData(stateData, env.SESSION_SECRET!);
  const signedState = `${stateData}.${signature}`;

  try {
    const authUrl = buildGithubAuthUrl(
      env.GITHUB_CLIENT_ID,
      redirectUri,
      oauthState.state
    );

    const stateCookie = createOAuthStateCookie(signedState);

    return new Response(null, {
      status: 302,
      headers: {
        Location: authUrl,
        'Set-Cookie': stateCookie,
      },
    });
  } catch (error) {
    console.error('GitHub OAuth start error:', error);
    return new Response('Failed to start GitHub authentication.', { status: 500 });
  }
}

/**
 * GET /api/auth/github/callback - Handle GitHub OAuth callback
 */
export async function handleGithubAuthCallback(request: Request, env: Env): Promise<Response> {
  if (!isAccountsEnabled(env)) {
    return new Response('Accounts are not enabled.', { status: 503 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    return new Response('Missing code or state parameter.', { status: 400 });
  }

  const signedState = getCookie(request, '__Host-oauth-state');
  if (!signedState) {
    return new Response('Invalid state cookie.', { status: 400 });
  }

  const [stateData, signature] = signedState.split('.');
  if (!stateData || !signature) {
    return new Response('Malformed state cookie.', { status: 400 });
  }

  const isValid = await verifySignature(stateData, signature, env.SESSION_SECRET!);
  if (!isValid) {
    return new Response('Invalid OAuth state signature.', { status: 400 });
  }

  let oauthState: ReturnType<typeof createOAuthState>;
  try {
    oauthState = JSON.parse(stateData);
  } catch {
    return new Response('Invalid OAuth state format.', { status: 400 });
  }

  if (oauthState.state !== state) {
    return new Response('State mismatch.', { status: 400 });
  }

  if (Date.now() > oauthState.expiresAt) {
    return new Response('OAuth state expired.', { status: 400 });
  }

  const redirectUri = getRedirectUri(request, '/api/auth/github/callback');

  try {
    const accessToken = await exchangeGithubCodeForToken(
      env.GITHUB_CLIENT_ID!,
      env.GITHUB_CLIENT_SECRET!,
      code,
      redirectUri
    );

    const githubUser = await fetchGithubUser(accessToken);
    const displayName = validateDisplayName(githubUser.name) ??
      validateDisplayName(githubUser.login) ??
      'Player';

    // Get current session if exists
    const sessionToken = getCookie(request, '__Host-session');
    let currentUserId: string | undefined;

    if (sessionToken) {
      const session = await validateSession(env.DB!, sessionToken, env.SESSION_SECRET!);
      currentUserId = session?.user.id;
    }

    // If no current session, create guest first
    if (!currentUserId) {
      const { user: newGuest, sessionToken: guestToken } = await createGuestSession(env.DB!, displayName, 0, env.SESSION_SECRET!);
      await logout(env.DB!, guestToken, env.SESSION_SECRET!);
      currentUserId = newGuest.id;
    }

    const result = await linkOrMergeGithubAccount(
      env.DB!,
      currentUserId,
      githubUser.id,
      displayName,
      env.SESSION_SECRET!
    );

    const cookie = createSessionCookie(result.sessionToken);
    const clearStateCookie = clearCookie('__Host-oauth-state');

    const response = new Response(
      `<!DOCTYPE html>
<html>
<head><title>Login Successful</title></head>
<body style="font-family: system-ui; text-align: center; padding: 2rem;">
  <h1>✓ GitHub Login Successful</h1>
  <p>${result.merged ? 'Your progress has been merged.' : 'Your account is connected.'}</p>
  <p>Redirecting to Ludo Arena...</p>
  <script>
    setTimeout(() => window.location.href = '/', 1200);
  </script>
</body>
</html>`,
      {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
        },
      }
    );
    response.headers.append('Set-Cookie', cookie);
    response.headers.append('Set-Cookie', clearStateCookie);
    return response;
  } catch (error) {
    console.error('GitHub callback error:', error);
    return new Response('Authentication failed.', { status: 500 });
  }
}

/**
 * GET /api/auth/sync-code - Get or generate current player's sync code
 */
export async function handleGetSyncCode(request: Request, env: Env): Promise<Response> {
  if (!isAccountsEnabled(env)) {
    return json({ error: 'Accounts are not enabled.' }, 503);
  }

  const sessionToken = getCookie(request, '__Host-session');
  if (!sessionToken) {
    return json({ error: 'Not authenticated.' }, 401);
  }

  try {
    const session = await validateSession(env.DB!, sessionToken, env.SESSION_SECRET!);
    if (!session) {
      return json({ error: 'Session expired.' }, 401);
    }

    const syncCode = await getUserSyncCode(env.DB!, session.user.id);
    return json({ syncCode });
  } catch (error) {
    console.error('Get sync code error:', error);
    return json({ error: 'Failed to retrieve sync code.' }, 500);
  }
}

/**
 * POST /api/profile/avatar - Save the authenticated profile avatar
 */
export async function handleSaveAvatar(request: Request, env: Env): Promise<Response> {
  if (!isAccountsEnabled(env)) {
    return json({ error: 'Accounts are not enabled.' }, 503);
  }

  const requestOrigin = request.headers.get('Origin');
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '').split(',').map(o => o.trim()).filter(Boolean);
  if (requestOrigin && !isOriginAllowed(request, allowedOrigins)) {
    return json({ error: 'Origin not allowed.' }, 403, null);
  }

  const sessionToken = getCookie(request, '__Host-session');
  if (!sessionToken) {
    return json({ error: 'Not authenticated.' }, 401);
  }

  let body: { avatarUrl?: unknown };
  try {
    body = await request.json() as { avatarUrl?: unknown };
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  if (body.avatarUrl !== null && typeof body.avatarUrl !== 'string') {
    return json({ error: 'Avatar URL must be a data URL or null.' }, 400);
  }

  const avatarUrl = body.avatarUrl === null ? null : validateAvatarImage(body.avatarUrl);
  if (body.avatarUrl !== null && !avatarUrl) {
    return json({ error: 'Invalid image format. Use JPG, PNG, WebP, or GIF data URL (max 2MB).' }, 400);
  }

  try {
    const session = await validateSession(env.DB!, sessionToken, env.SESSION_SECRET!);
    if (!session) {
      return json({ error: 'Session expired.' }, 401);
    }

    await saveAvatar(env.DB!, session.user.id, avatarUrl);
    return json({ success: true, avatarUrl });
  } catch (error) {
    console.error('Save avatar error:', error);
    return json({ error: 'Failed to save avatar.' }, 500);
  }
}

/**
 * POST /api/auth/sync-restore - Restore account on this device using sync code
 */
export async function handleRestoreWithSyncCode(request: Request, env: Env): Promise<Response> {
  if (!isAccountsEnabled(env)) {
    return json({ error: 'Accounts are not enabled.' }, 503);
  }

  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '').split(',').map(o => o.trim()).filter(Boolean);
  if (!isOriginAllowed(request, allowedOrigins) ||
      !hasRequiredHeader(request, 'X-Ludo-Action') ||
      request.headers.get('X-Ludo-Action') !== 'sync-restore') {
    return json({ error: 'Origin or request validation failed.' }, 403, null);
  }

  let body: { syncCode?: unknown };
  try {
    body = await request.json() as { syncCode?: unknown };
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  if (typeof body.syncCode !== 'string' || !body.syncCode.trim()) {
    return json({ error: 'Please enter your sync code (e.g. LUDO-XXXX-XXXX-XXXX-XXXX).' }, 400);
  }

  try {
    const restored = await restoreAccountWithSyncCode(env.DB!, body.syncCode, env.SESSION_SECRET!);
    if (!restored) {
      return json({ error: 'Sync code not found. Check the code and try again.' }, 404);
    }

    const profile = await getProfile(env.DB!, restored.user.id);
    if (!profile) {
      return json({ error: 'Restored profile not found.' }, 404);
    }
    const cookie = createSessionCookie(restored.sessionToken);

    return new Response(JSON.stringify({
      user: {
        id: profile.id,
        displayName: profile.displayName,
        avatarId: profile.avatarId,
        avatarUrl: profile.avatarUrl ?? null,
        isGuest: profile.isGuest,
        level: profile.stats.level,
      },
      stats: {
        gamesPlayed: profile.stats.gamesPlayed,
        wins: profile.stats.wins,
        losses: profile.stats.losses,
        captures: profile.stats.captures,
        xp: profile.stats.xp,
        level: profile.stats.level,
      },
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': cookie,
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  } catch (error) {
    console.error('Restore sync code error:', error);
    return json({ error: 'Failed to restore account.' }, 500);
  }
}
