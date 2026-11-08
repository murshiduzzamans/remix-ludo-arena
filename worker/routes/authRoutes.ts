/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Authentication route handlers
 */

import type { D1Database } from '@cloudflare/workers-types';
import { createGuestSession, validateSession, logout, linkOrMergeGoogleAccount, getProfile, updateProfile, deleteAccount, getPublic, getLeaderboard } from '../accounts/service';
import { createOAuthState, buildAuthorizationUrl, exchangeCodeForTokens, verifyIdToken } from '../auth/google';
import { createSessionCookie, createOAuthStateCookie, clearCookie, getCookie } from '../auth/cookies';
import { signData, verifySignature } from '../auth/crypto';
import { validateDisplayName, validateAvatarId, isInAppBrowser, isOriginAllowed } from '../auth/validation';
import { LEADERBOARD_CONFIG } from '../accounts/config';

interface Env {
  DB?: D1Database;
  ACCOUNTS_ENABLED?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
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
  return env.ACCOUNTS_ENABLED === 'true' && Boolean(env.DB && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_SECRET);
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
    const { user, sessionToken } = await createGuestSession(env.DB!, displayName, avatarId);
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

  // Check for in-app browser
  const userAgent = request.headers.get('User-Agent') ?? '';
  if (isInAppBrowser(userAgent)) {
    return new Response(
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
      const session = await validateSession(env.DB!, sessionToken);
      currentUserId = session?.user.id;
    }

    // If no current session, create guest first
    if (!currentUserId) {
      const displayName = claims.name ?? claims.email?.split('@')[0] ?? 'Player';
      const { user, sessionToken: guestToken } = await createGuestSession(env.DB!, displayName, 0);
      currentUserId = user.id;
    }

    // Link or merge Google account
    const result = await linkOrMergeGoogleAccount(
      env.DB!,
      currentUserId,
      claims.sub,
      claims.name ?? 'Player',
      claims.email
    );

    const cookie = createSessionCookie(result.sessionToken);
    const clearStateCookie = clearCookie('__Host-oauth-state');

    return new Response(
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
          'Set-Cookie': [cookie, clearStateCookie].join(', '),
        },
      }
    );
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
      await logout(env.DB!, sessionToken);
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
    const session = await validateSession(env.DB!, sessionToken);
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
        isGuest: userWithStats.isGuest,
        level: userWithStats.stats.level,
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
    const session = await validateSession(env.DB!, sessionToken);
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
    const session = await validateSession(env.DB!, sessionToken);
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
