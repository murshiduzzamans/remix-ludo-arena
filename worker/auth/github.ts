/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface GitHubUserProfile {
  id: string;
  login: string;
  name: string;
  avatarUrl?: string;
}

/**
 * Builds the GitHub OAuth authorization URL
 */
export function buildGithubAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'read:user',
    state,
  });

  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

/**
 * Exchanges the authorization code for a GitHub access token
 */
export async function exchangeGithubCodeForToken(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string
): Promise<string> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'Ludo-Arena-Multiplayer',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub token exchange failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!data.access_token) {
    throw new Error(data.error_description || data.error || 'Failed to obtain access token from GitHub');
  }

  return data.access_token;
}

/**
 * Fetches the user's GitHub profile
 */
export async function fetchGithubUser(accessToken: string): Promise<GitHubUserProfile> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Ludo-Arena-Multiplayer',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch GitHub user: HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    id: number;
    login: string;
    name?: string | null;
    avatar_url?: string;
  };

  return {
    id: String(data.id),
    login: data.login,
    name: data.name?.trim() || data.login,
    avatarUrl: data.avatar_url,
  };
}
