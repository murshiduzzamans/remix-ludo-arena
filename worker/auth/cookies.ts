/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cookie utilities for secure session management
 * Uses __Host- prefix for maximum security over HTTPS, with safe fallback for local/LAN HTTP development
 */

export const SESSION_COOKIE_NAME = '__Host-session';
export const INSECURE_SESSION_COOKIE_NAME = 'ludo_session';
export const OAUTH_STATE_COOKIE_NAME = '__Host-oauth-state';
export const INSECURE_OAUTH_STATE_COOKIE_NAME = 'ludo_oauth_state';
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function isSecureConnection(request?: Request): boolean {
  if (!request) return true;
  try {
    const url = new URL(request.url);
    if (url.protocol === 'https:') return true;
    const proto = request.headers.get('x-forwarded-proto');
    if (proto === 'https') return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * Creates a session cookie header.
 * Uses __Host- prefix and Secure flag over HTTPS.
 * Over non-secure HTTP (e.g. mobile device on LAN Wi-Fi testing), uses ludo_session without Secure flag
 * because browsers strictly reject Secure/__Host- cookies over plain HTTP.
 */
export function createSessionCookie(
  token: string,
  maxAge = SESSION_DURATION_MS,
  request?: Request
): string {
  const maxAgeSeconds = Math.floor(maxAge / 1000);
  const secure = isSecureConnection(request);
  const name = secure ? SESSION_COOKIE_NAME : INSECURE_SESSION_COOKIE_NAME;
  const secureAttr = secure ? ' Secure;' : '';
  return `${name}=${token}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly;${secureAttr} SameSite=Lax`;
}

/**
 * Creates a short-lived OAuth state cookie (5 minutes)
 */
export function createOAuthStateCookie(state: string, request?: Request): string {
  const maxAgeSeconds = 5 * 60; // 5 minutes
  const secure = isSecureConnection(request);
  const name = secure ? OAUTH_STATE_COOKIE_NAME : INSECURE_OAUTH_STATE_COOKIE_NAME;
  const secureAttr = secure ? ' Secure;' : '';
  return `${name}=${encodeURIComponent(state)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly;${secureAttr} SameSite=Lax`;
}

/**
 * Clears a cookie by setting it to expire immediately
 */
export function clearCookie(name: string, request?: Request): string {
  const secure = isSecureConnection(request);
  const secureAttr = secure ? ' Secure;' : '';
  return `${name}=; Max-Age=0; Path=/; HttpOnly;${secureAttr} SameSite=Lax`;
}

/**
 * Parses cookies from a request header
 */
export function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};

  const cookies: Record<string, string> = {};
  const pairs = cookieHeader.split(';');

  for (const pair of pairs) {
    const [name, ...valueParts] = pair.trim().split('=');
    if (name && valueParts.length > 0) {
      const value = valueParts.join('=');
      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        cookies[name] = value;
      }
    }
  }

  return cookies;
}

/**
 * Gets a specific cookie value from a request
 */
export function getCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('Cookie');
  const cookies = parseCookies(cookieHeader);
  return cookies[name] ?? null;
}

/**
 * Retrieves the session token, checking both secure and dev cookie names
 */
export function getSessionToken(request: Request): string | null {
  return getCookie(request, SESSION_COOKIE_NAME) || getCookie(request, INSECURE_SESSION_COOKIE_NAME);
}

/**
 * Retrieves the OAuth state token, checking both secure and dev cookie names
 */
export function getOAuthStateToken(request: Request): string | null {
  return getCookie(request, OAUTH_STATE_COOKIE_NAME) || getCookie(request, INSECURE_OAUTH_STATE_COOKIE_NAME);
}
