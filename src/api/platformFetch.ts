// src/api/platformFetch.ts
import CookieManager from '@react-native-cookies/cookies';
import { ENV } from '../config/env';
import { loadJson, saveJson } from '../utils/storage';
import { getPlatformToken } from './platformToken';
import { getDeviceIdentity } from '../utils/deviceIdentity';

const COOKIE_KEY = 'dinodia_platform_cookie_v1';

function getPlatformBase(): string {
  const raw = (ENV.DINODIA_PLATFORM_API || '').trim();
  if (!raw) {
    throw new Error('Platform API is not configured. Please try again later.');
  }
  return raw.replace(/\/+$/, '');
}

async function getStoredCookie(): Promise<string | null> {
  const val = await loadJson<string>(COOKIE_KEY);
  return val ?? null;
}

async function setStoredCookie(cookie: string): Promise<void> {
  if (!cookie) return;
  await saveJson(COOKIE_KEY, cookie);
}

function buildCookieHeaderFromStored(cookie: string | null, url: string): string | null {
  if (!cookie) return null;
  return cookie;
}

function cookieObjectToHeader(cookies: Record<string, any>): string | null {
  const pairs = Object.entries(cookies)
    .filter(([, v]) => v && typeof v.value === 'string')
    .map(([k, v]) => `${k}=${v.value}`);
  return pairs.length > 0 ? pairs.join('; ') : null;
}

export async function platformFetch<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<{ res: Response; data: T }> {
  if (/^https?:\/\//i.test(path)) {
    throw new Error('platformFetch expects a relative API path, not a full URL.');
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${getPlatformBase()}${normalizedPath}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  const token = await getPlatformToken().catch(() => null);
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    try {
      const { deviceId, deviceLabel } = await getDeviceIdentity();
      if (deviceId) headers['x-device-id'] = deviceId;
      if (deviceLabel) headers['x-device-label'] = deviceLabel;
    } catch {
      // If device identity fails, continue without blocking the request.
    }
  }

  try {
    const cmCookies = await CookieManager.get(url);
    const headerFromCM = cookieObjectToHeader(cmCookies);
    if (headerFromCM) {
      headers.Cookie = headerFromCM;
    } else {
      const stored = await getStoredCookie().catch(() => null);
      const fromStored = buildCookieHeaderFromStored(stored, url);
      if (fromStored) headers.Cookie = fromStored;
    }
  } catch {
    const stored = await getStoredCookie().catch(() => null);
    const fromStored = buildCookieHeaderFromStored(stored, url);
    if (fromStored) headers.Cookie = fromStored;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers,
      credentials: 'include',
    });
  } catch (err) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[platformFetch] network error', { path: normalizedPath, error: String(err) });
    }
    throw new Error('Unable to reach Dinodia servers. Please try again.');
  }

  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    try {
      await CookieManager.setFromResponse(url, setCookie);
    } catch {
      // Fallback: store only cookie pairs
      const cookiePairs = setCookie.split(',').map((chunk) => chunk.split(';')[0]).join('; ');
      await setStoredCookie(cookiePairs);
    }
  } else if (__DEV__ && url.includes('/api/auth/login')) {
    // eslint-disable-next-line no-console
    console.log('[platformFetch] login response missing set-cookie header');
  }

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[platformFetch] failed', { path: normalizedPath, status: res.status });
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error('Session expired, please log in again.');
    }
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[platformFetch] data', data);
    }
    const message =
      (data && (data.error as string)) || `HTTP ${res.status} while calling platform API`;
    throw new Error(message);
  }

  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[platformFetch] success', { path: normalizedPath, status: res.status });
  }

  return { res, data: data as T };
}

export async function clearPlatformCookie(): Promise<void> {
  await saveJson(COOKIE_KEY, null);
}

export { getStoredCookie, setStoredCookie };
