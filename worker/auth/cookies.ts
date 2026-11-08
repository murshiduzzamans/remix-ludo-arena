/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cookie utilities for secure session management
 * Uses __Host- prefix for maximum security
 */

export const SESSION_COOKIE_NAME = '__Host-session';
export const OAUTH_STATE_COOKIE_NAME = '__Host-oauth-state';
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface CookieOptions {
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  path?: string;
}

/**
 * Creates a secure session cookie header
 * Uses __Host- prefix which requires Secure, Path=/, and no Domain
 */
export function createSessionCookie(token: string, maxAge = SESSION_DURATION_MS): string {
  const maxAgeSeconds = Math.floor(maxAge / 1000);
  return `${SESSION_COOKIE_NAME}=${token}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * Creates a short-lived OAuth state cookie (5 minutes)
 */
export function createOAuthStateCookie(state: string): string {
  const maxAgeSeconds = 5 * 60; // 5 minutes
  return `${OAUTH_STATE_COOKIE_NAME}=${state}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * Clears a cookie by setting it to expire immediately
 */
export function clearCookie(name: string): string {
  return `${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
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
      cookies[name] = valueParts.join('=');
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
