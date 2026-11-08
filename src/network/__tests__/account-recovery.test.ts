import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOAuthStateCookie, parseCookies } from '../../../worker/auth/cookies';
import { buildGithubAuthUrl } from '../../../worker/auth/github';
import { generateSyncCode, normalizeSyncCode } from '../../../worker/auth/syncCode';

describe('account recovery and GitHub sign-in utilities', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('generates strong, readable recovery codes and normalizes user input', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(1),
    });
    const code = generateSyncCode();

    expect(code).toMatch(/^LUDO-[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/);
    expect(normalizeSyncCode(code.toLowerCase().replaceAll('-', ' '))).toBe(code);
    expect(normalizeSyncCode('LUDO-XXXX-XXXX')).toBeNull();
    expect(normalizeSyncCode('LUDO-OOOO-XXXX-XXXX-XXXX')).toBeNull();
  });

  it('round-trips OAuth state through a cookie-safe encoding', () => {
    const state = '{"state":"random","nonce":"value","codeVerifier":"abc"}';
    const cookie = createOAuthStateCookie(state);

    expect(cookie).toContain(encodeURIComponent(state));
    expect(parseCookies(cookie.split(';')[0])['__Host-oauth-state']).toBe(state);
  });

  it('creates a GitHub authorization URL with the configured callback and state', () => {
    const url = new URL(buildGithubAuthUrl(
      'client-id',
      'https://ludo.example/api/auth/github/callback',
      'csrf-state'
    ));

    expect(url.origin).toBe('https://github.com');
    expect(url.pathname).toBe('/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('https://ludo.example/api/auth/github/callback');
    expect(url.searchParams.get('state')).toBe('csrf-state');
    expect(url.searchParams.get('scope')).toBe('read:user');
  });
});
