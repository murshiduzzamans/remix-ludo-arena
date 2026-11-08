/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Google OAuth 2.0 / OpenID Connect implementation
 * Uses authorization code flow with PKCE for security
 */

import { generateCodeVerifier, generateCodeChallenge, generateToken } from './crypto';

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_JWKS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs';
export const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';

// Required scopes for OpenID Connect
export const OAUTH_SCOPES = ['openid', 'profile', 'email'];

/**
 * OAuth state stored in signed cookie during flow
 */
export interface OAuthState {
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  expiresAt: number;
}

/**
 * Google ID token claims (after verification)
 */
export interface GoogleIdToken {
  iss: string;
  sub: string; // Stable Google user ID
  aud: string;
  exp: number;
  iat: number;
  nonce: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  locale?: string;
}

/**
 * Generates the OAuth authorization URL
 */
export async function buildAuthorizationUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  nonce: string,
  codeVerifier: string
): Promise<string> {
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: OAUTH_SCOPES.join(' '),
    redirect_uri: redirectUri,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'online', // We don't need refresh tokens
    prompt: 'select_account', // Let user choose account
  });

  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * Exchanges authorization code for tokens
 */
export async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  codeVerifier: string
): Promise<{ idToken: string; accessToken: string }> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`);
  }

  const data = await response.json() as {
    id_token?: string;
    access_token?: string;
    error?: string;
  };

  if (data.error || !data.id_token || !data.access_token) {
    throw new Error(`Token exchange failed: ${data.error ?? 'missing tokens'}`);
  }

  return {
    idToken: data.id_token,
    accessToken: data.access_token,
  };
}

/**
 * Decodes a JWT without verification (for inspection only)
 */
function decodeJwt(token: string): GoogleIdToken {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');

  const payload = parts[1];
  // Base64 URL decode
  const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(decoded) as GoogleIdToken;
}

/**
 * Fetches Google's public keys for JWT verification
 */
async function fetchGoogleJwks(): Promise<{ keys: Array<{ kid: string; n: string; e: string; alg: string; kty: string }> }> {
  const response = await fetch(GOOGLE_JWKS_ENDPOINT, {
    // @ts-expect-error - Cloudflare Workers specific fetch option
    cf: { cacheTtl: 3600 }, // Cache for 1 hour
  });

  if (!response.ok) {
    throw new Error('Failed to fetch Google JWKS');
  }

  return await response.json() as { keys: Array<{ kid: string; n: string; e: string; alg: string; kty: string }> };
}

/**
 * Verifies Google ID token signature and claims
 */
export async function verifyIdToken(
  idToken: string,
  clientId: string,
  expectedNonce: string
): Promise<GoogleIdToken> {
  // Decode without verification first
  const decoded = decodeJwt(idToken);

  // Verify issuer
  if (decoded.iss !== 'https://accounts.google.com' && decoded.iss !== 'accounts.google.com') {
    throw new Error('Invalid issuer');
  }

  // Verify audience
  if (decoded.aud !== clientId) {
    throw new Error('Invalid audience');
  }

  // Verify expiration
  const now = Math.floor(Date.now() / 1000);
  if (decoded.exp < now) {
    throw new Error('Token expired');
  }

  // Verify nonce
  if (decoded.nonce !== expectedNonce) {
    throw new Error('Invalid nonce');
  }

  // Verify signature using Google's public keys
  const jwks = await fetchGoogleJwks();
  const header = JSON.parse(atob(idToken.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))) as { kid: string; alg: string };

  const key = jwks.keys.find((k) => k.kid === header.kid);
  if (!key) {
    throw new Error('Public key not found');
  }

  // Import the public key
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: key.kty,
      n: key.n,
      e: key.e,
      alg: key.alg,
      use: 'sig',
    },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  // Verify signature
  const [headerB64, payloadB64, signatureB64] = idToken.split('.');
  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = Uint8Array.from(atob(signatureB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

  const isValid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    signature,
    signedData
  );

  if (!isValid) {
    throw new Error('Invalid signature');
  }

  return decoded;
}

/**
 * Creates OAuth state for the authorization flow
 */
export function createOAuthState(redirectUri: string): OAuthState {
  return {
    state: generateToken(16),
    nonce: generateToken(16),
    codeVerifier: generateCodeVerifier(),
    redirectUri,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
  };
}
