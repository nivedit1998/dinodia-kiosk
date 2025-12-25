// src/api/remoteAccess.ts
import { ENV } from '../config/env';

type AlexaDevicesResponse = {
  devices?: unknown[];
  error?: string;
};

function getPlatformBase(): string {
  const raw = (ENV.DINODIA_PLATFORM_API || '').trim();
  if (!raw) {
    throw new Error('Dinodia Platform API is not configured.');
  }
  return raw.replace(/\/+$/, '');
}

export async function checkRemoteAccessEnabled(): Promise<boolean> {
  const url = `${getPlatformBase()}/api/alexa/devices`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  const data = (await res.json().catch(() => ({}))) as AlexaDevicesResponse;
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  const devices = Array.isArray(data.devices) ? data.devices : [];
  return devices.length > 0;
}
