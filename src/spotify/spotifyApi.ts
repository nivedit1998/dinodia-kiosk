// src/spotify/spotifyApi.ts
import { loadJson, saveJson, removeKey } from '../utils/storage';

export type SpotifyTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAtMillis: number;
};

export type SpotifyDevice = {
  id: string;
  name: string;
  isActive: boolean;
  isRestricted: boolean;
  type: string;
};

export type SpotifyPlaybackState = {
  isPlaying: boolean;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  coverUrl?: string;
  deviceId?: string;
  deviceName?: string;
};

const TOKENS_STORAGE_KEY = 'spotify_tokens_v1';

// Replace these placeholders in production with your real values.
export const SPOTIFY_CLIENT_ID = '9e88d4fb6e0c44049242fac02aaddea0';
export const SPOTIFY_REDIRECT_URI = 'dinodia://spotify-auth';
export const SPOTIFY_SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
];

function ensureClientConfigured() {
  if (
    !SPOTIFY_CLIENT_ID ||
    SPOTIFY_CLIENT_ID === 'YOUR_SPOTIFY_CLIENT_ID' ||
    !SPOTIFY_REDIRECT_URI
  ) {
    throw new Error('Spotify client is not configured. Set SPOTIFY_CLIENT_ID and SPOTIFY_REDIRECT_URI.');
  }
}

export function buildAuthorizeUrl(codeChallenge: string, state: string): string {
  ensureClientConfigured();
  const scope = encodeURIComponent(SPOTIFY_SCOPES.join(' '));
  const redirect = encodeURIComponent(SPOTIFY_REDIRECT_URI);
  const params = [
    `client_id=${encodeURIComponent(SPOTIFY_CLIENT_ID)}`,
    'response_type=code',
    `redirect_uri=${redirect}`,
    `scope=${scope}`,
    `state=${encodeURIComponent(state)}`,
    'code_challenge_method=S256',
    `code_challenge=${encodeURIComponent(codeChallenge)}`,
    'show_dialog=true',
  ].join('&');
  return `https://accounts.spotify.com/authorize?${params}`;
}

export async function loadTokens(): Promise<SpotifyTokens | null> {
  const tokens = await loadJson<SpotifyTokens>(TOKENS_STORAGE_KEY);
  if (!tokens) return null;
  if (!tokens.accessToken || !tokens.expiresAtMillis) {
    return null;
  }
  return tokens;
}

export async function saveTokens(tokens: SpotifyTokens): Promise<void> {
  await saveJson(TOKENS_STORAGE_KEY, tokens);
}

export async function clearTokens(): Promise<void> {
  await removeKey(TOKENS_STORAGE_KEY);
}

async function exchange(
  body: Record<string, string>
): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  ensureClientConfigured();
  const form = Object.entries(body)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      text && text.trim().length > 0
        ? `We could not finish Spotify login. ${text}`
        : 'We could not finish Spotify login. Please try again.'
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await response.json();
  return {
    access_token: String(json.access_token),
    refresh_token: json.refresh_token ? String(json.refresh_token) : undefined,
    expires_in: Number(json.expires_in ?? 3600),
  };
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<SpotifyTokens> {
  const { access_token, refresh_token, expires_in } = await exchange({
    client_id: SPOTIFY_CLIENT_ID,
    grant_type: 'authorization_code',
    code,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    code_verifier: codeVerifier,
  });

  const expiresAtMillis = Date.now() + expires_in * 1000;
  const tokens: SpotifyTokens = {
    accessToken: access_token,
    refreshToken: refresh_token ?? null,
    expiresAtMillis,
  };
  await saveTokens(tokens);
  return tokens;
}

export async function refreshAccessToken(refreshToken: string): Promise<SpotifyTokens> {
  const { access_token, refresh_token, expires_in } = await exchange({
    client_id: SPOTIFY_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const expiresAtMillis = Date.now() + expires_in * 1000;
  const tokens: SpotifyTokens = {
    accessToken: access_token,
    refreshToken: refresh_token ? refresh_token : refreshToken,
    expiresAtMillis,
  };
  await saveTokens(tokens);
  return tokens;
}

export async function getValidAccessToken(): Promise<string | null> {
  const tokens = await loadTokens();
  if (!tokens) return null;
  const now = Date.now();
  if (tokens.expiresAtMillis - now > 60 * 1000) {
    return tokens.accessToken;
  }
  if (!tokens.refreshToken) {
    return null;
  }
  try {
    const refreshed = await refreshAccessToken(tokens.refreshToken);
    return refreshed.accessToken;
  } catch {
    await clearTokens();
    return null;
  }
}

async function authorizedFetch(
  path: string,
  options: RequestInit & { method?: string }
): Promise<Response> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Not logged in to Spotify');
  }
  const url = path.startsWith('http')
    ? path
    : `https://api.spotify.com/v1${path}`;

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
    Authorization: `Bearer ${accessToken}`,
  };

  return fetch(url, {
    ...options,
    headers,
  });
}

export async function getPlaybackState(): Promise<SpotifyPlaybackState | null> {
  const response = await authorizedFetch('/me/player', {
    method: 'GET',
  });

  if (response.status === 204) {
    // No active playback
    return null;
  }

  if (!response.ok) {
    if (response.status === 401) {
      await clearTokens();
    }
    await response.text().catch(() => '');
    throw new Error('We could not load Spotify right now. Please try again.');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await response.json();
  if (!json) return null;

  const item = json.item;
  const artists: string[] = Array.isArray(item?.artists)
    ? item.artists.map((a: { name?: string }) => a.name).filter(Boolean)
    : [];

  const images: { url?: string }[] = Array.isArray(item?.album?.images)
    ? item.album.images
    : [];

  const state: SpotifyPlaybackState = {
    isPlaying: !!json.is_playing,
    trackName: item?.name ?? undefined,
    artistName: artists.join(', '),
    albumName: item?.album?.name ?? undefined,
    coverUrl: images[0]?.url,
    deviceId: json.device?.id ?? undefined,
    deviceName: json.device?.name ?? undefined,
  };

  return state;
}

export async function getDevices(): Promise<SpotifyDevice[]> {
  const response = await authorizedFetch('/me/player/devices', {
    method: 'GET',
  });

  if (!response.ok) {
    await response.text().catch(() => '');
    throw new Error('We could not load your Spotify devices right now. Please try again.');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await response.json();
  const devices: SpotifyDevice[] = Array.isArray(json.devices)
    ? json.devices.map((d: any) => ({
        id: String(d.id),
        name: String(d.name),
        isActive: !!d.is_active,
        isRestricted: !!d.is_restricted,
        type: String(d.type),
      }))
    : [];

  return devices;
}

export async function transferPlayback(deviceId: string): Promise<void> {
  const response = await authorizedFetch('/me/player', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      device_ids: [deviceId],
      play: true,
    }),
  });

  if (!response.ok && response.status !== 204) {
    await response.text().catch(() => '');
    throw new Error('We could not move playback to that device. Please try again.');
  }
}

export async function resumePlayback(): Promise<void> {
  const response = await authorizedFetch('/me/player/play', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  if (!response.ok && response.status !== 204) {
    await response.text().catch(() => '');
    throw new Error('We could not resume playback. Please try again.');
  }
}

export async function pausePlayback(): Promise<void> {
  const response = await authorizedFetch('/me/player/pause', {
    method: 'PUT',
  });
  if (!response.ok && response.status !== 204) {
    await response.text().catch(() => '');
    throw new Error('We could not pause playback. Please try again.');
  }
}

export async function skipToNext(): Promise<void> {
  const response = await authorizedFetch('/me/player/next', {
    method: 'POST',
  });
  if (!response.ok && response.status !== 204) {
    await response.text().catch(() => '');
    throw new Error('We could not skip to the next track. Please try again.');
  }
}

export async function skipToPrevious(): Promise<void> {
  const response = await authorizedFetch('/me/player/previous', {
    method: 'POST',
  });
  if (!response.ok && response.status !== 204) {
    await response.text().catch(() => '');
    throw new Error('We could not go back to the previous track. Please try again.');
  }
}
