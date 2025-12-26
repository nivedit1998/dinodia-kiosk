// src/api/remoteAccess.ts
import { platformFetch } from './platformFetch';
import type { HaConnection } from '../models/haConnection';
import { probeHaReachability } from './ha';

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

export async function checkHomeModeReachable(haConnection: HaConnection | null | undefined): Promise<boolean> {
  if (!haConnection || !haConnection.baseUrl || !haConnection.longLivedToken) return false;
  return probeHaReachability(
    { baseUrl: haConnection.baseUrl, longLivedToken: haConnection.longLivedToken },
    2000
  );
}
