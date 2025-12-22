// src/api/deviceControl.ts
import { ENV } from '../config/env';

export type DeviceCommandPayload = {
  entityId: string;
  command: string;
  value?: number;
};

function getPlatformApiBase(): string {
  const raw = (ENV.DINODIA_PLATFORM_API || '').trim();
  if (!raw) {
    throw new Error('Dinodia Cloud is not configured. Please set DINODIA_PLATFORM_API.');
  }
  return raw.replace(/\/+$/, '');
}

export async function sendCloudDeviceCommand(payload: DeviceCommandPayload): Promise<void> {
  const base = getPlatformApiBase();
  const url = `${base}/api/device-control`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const message =
      text ||
      `Dinodia Cloud could not complete that request (${res.status}). Please try again.`;
    throw new Error(message);
  }
}
