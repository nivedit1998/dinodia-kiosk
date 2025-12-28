// src/api/platformFetch.ts
import { ENV } from '../config/env';
import { getPlatformToken } from './platformToken';
import { getDeviceIdentity } from '../utils/deviceIdentity';
import { triggerSessionInvalidOnce } from './sessionInvalid';

function getPlatformBase(): string {
  const raw = (ENV.DINODIA_PLATFORM_API || '').trim();
  if (!raw) {
    throw new Error('Platform API is not configured. Please try again later.');
  }
  return raw.replace(/\/+$/, '');
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
  if (setCookie && __DEV__ && url.includes('/api/auth/login')) {
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
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[platformFetch] data', data);
    }
    const message =
      (data && (data.error as string)) || `HTTP ${res.status} while calling platform API`;

    if (res.status === 401) {
      void triggerSessionInvalidOnce();
      throw new Error('Session expired, please log in again.');
    }

    if (res.status === 403) {
      // Do NOT logout if step-up is required; caller will handle the UI flow.
      if (data && (data as any).stepUpRequired) {
        throw new Error(message);
      }
      const msgLower = (message || '').toLowerCase();
      if (msgLower.includes('device is stolen') || msgLower.includes('device is blocked')) {
        void triggerSessionInvalidOnce();
      }
      // Other 403s (e.g., device blocked) should not force logout by default.
      throw new Error(message);
    }

    throw new Error(message);
  }

  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[platformFetch] success', { path: normalizedPath, status: res.status });
  }

  return { res, data: data as T };
}

export async function clearPlatformCookie(): Promise<void> {
  return Promise.resolve();
}
