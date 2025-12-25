// src/api/remoteAccess.ts
import { platformFetch } from './platformFetch';

type AlexaDevicesResponse = {
  devices?: unknown[];
  error?: string;
};

export async function checkRemoteAccessEnabled(): Promise<boolean> {
  const { data } = await platformFetch<AlexaDevicesResponse>('/api/alexa/devices', {
    method: 'GET',
  });
  const devices = Array.isArray(data.devices) ? data.devices : [];
  return devices.length > 0;
}
