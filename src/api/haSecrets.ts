import * as Keychain from 'react-native-keychain';
import { platformFetch } from './platformFetch';
import { setHomeSecretsRefresher, type HaConnectionLike } from './ha';
import type { HaMode } from './dinodia';
import type { HaConnection } from '../models/haConnection';
import { isLocalIp } from '../utils/net';

export type HomeModeSecrets = {
  baseUrl: string;
  longLivedToken: string;
};

const SERVICE = 'dinodia_home_mode_secrets_v1';
let cachedHomeSecrets: HomeModeSecrets | null = null;
let inflight: Promise<HomeModeSecrets> | null = null;

const CONFIGURING_ERROR_SUBSTRINGS = [
  'no published hub token',
  'hub agent is not linked to this home',
  'hub not paired yet',
];

export function isHubConfiguringError(err: unknown): boolean {
  const msg =
    (err instanceof Error && err.message) ||
    (typeof err === 'string' ? err : '') ||
    '';
  const lower = msg.toLowerCase();
  return CONFIGURING_ERROR_SUBSTRINGS.some((needle) => lower.includes(needle));
}

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

async function loadFromKeychain(): Promise<HomeModeSecrets | null> {
  const creds = await Keychain.getGenericPassword({ service: SERVICE });
  if (!creds || !creds.password) return null;
  try {
    const parsed = JSON.parse(creds.password) as HomeModeSecrets;
    if (parsed.baseUrl && parsed.longLivedToken) {
      return parsed;
    }
  } catch {
    // ignore malformed keychain entry
  }
  return null;
}

async function saveToKeychain(secrets: HomeModeSecrets) {
  if (!secrets?.baseUrl || !secrets?.longLivedToken) return;
  await Keychain.setGenericPassword('secrets', JSON.stringify(secrets), {
    service: SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function fetchHomeModeSecrets(force = false): Promise<HomeModeSecrets> {
  if (!force && cachedHomeSecrets) {
    return cachedHomeSecrets;
  }
  if (!force) {
    const stored = await loadFromKeychain();
    if (stored) {
      cachedHomeSecrets = stored;
      return stored;
    }
  }
  if (!inflight || force) {
    const promise = loadSecrets()
      .then(async (secrets) => {
        cachedHomeSecrets = secrets;
        await saveToKeychain(secrets);
        return secrets;
      })
      .finally(() => {
        if (inflight === promise) {
          inflight = null;
        }
      });
    inflight = promise;
  }
  return inflight;
}

export function clearHomeModeSecrets(options?: { deletePersisted?: boolean }) {
  cachedHomeSecrets = null;
  inflight = null;
  if (options?.deletePersisted) {
    void Keychain.resetGenericPassword({ service: SERVICE });
  }
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

setHomeSecretsRefresher(async (failed) => {
  try {
    const refreshed = await fetchHomeModeSecrets(true);
    if (refreshed.baseUrl.replace(/\/+$/, '') === failed.baseUrl.replace(/\/+$/, '')) {
      return refreshed;
    }
  } catch {
    // ignore refresh failures; caller will handle errors.
  }
  return null;
});
