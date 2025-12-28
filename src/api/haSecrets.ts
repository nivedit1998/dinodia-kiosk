import { platformFetch } from './platformFetch';
import type { HaConnectionLike } from './ha';
import type { HaMode } from './dinodia';
import type { HaConnection } from '../models/haConnection';
import { isLocalIp } from '../utils/net';

export type HomeModeSecrets = {
  baseUrl: string;
  longLivedToken: string;
};

const TTL_MS = 15 * 60 * 1000; // 15 minutes
let cachedHomeSecrets: HomeModeSecrets | null = null;
let cachedAtMs = 0;
let inflight: Promise<HomeModeSecrets> | null = null;

async function loadSecrets(): Promise<HomeModeSecrets> {
  const { data } = await platformFetch<HomeModeSecrets & { error?: string }>('/api/kiosk/home-mode/secrets', {
    method: 'POST',
  });

  if (!data || !data.baseUrl || !data.longLivedToken) {
    throw new Error(
      (data && typeof data.error === 'string' && data.error) ||
        'We could not load Dinodia Hub access details. Please try again.'
    );
  }

  const normalizedBaseUrl = data.baseUrl.replace(/\/+$/, '');
  try {
    const url = new URL(normalizedBaseUrl);
    const isHttp = url.protocol === 'http:';
    if (isHttp) {
      if (!isLocalIp(url.hostname)) {
        throw new Error('Dinodia Hub must be on your local network. Please connect to home Wi‑Fi and try again.');
      }
    }
  } catch (err) {
    throw new Error(
      err instanceof Error && err.message
        ? err.message
        : 'We could not load Dinodia Hub access details. Please try again.'
    );
  }

  return {
    baseUrl: normalizedBaseUrl,
    longLivedToken: data.longLivedToken,
  };
}

export async function fetchHomeModeSecrets(force = false): Promise<HomeModeSecrets> {
  const now = Date.now();
  if (!force && cachedHomeSecrets && now - cachedAtMs < TTL_MS) {
    return cachedHomeSecrets;
  }
  if (!inflight) {
    inflight = loadSecrets()
      .then((secrets) => {
        cachedHomeSecrets = secrets;
        cachedAtMs = Date.now();
        return secrets;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function clearHomeModeSecrets() {
  cachedHomeSecrets = null;
  cachedAtMs = 0;
}

export async function getHaConnectionForMode(
  mode: HaMode,
  _haMeta?: Pick<HaConnection, 'cloudEnabled'> | null
): Promise<HaConnectionLike> {
  const home = await fetchHomeModeSecrets();
  if (mode === 'home') {
    return home;
  }
  throw new Error('Cloud mode is not available for direct Hub access.');
}
