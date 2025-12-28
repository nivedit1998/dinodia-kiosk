// src/api/remoteAccess.ts
import { platformFetch } from './platformFetch';
import { probeHaReachability } from './ha';
import { fetchHomeModeSecrets } from './haSecrets';

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

export async function checkHomeModeReachable(): Promise<boolean> {
  try {
    const secrets = await fetchHomeModeSecrets();
    return probeHaReachability(
      { baseUrl: secrets.baseUrl, longLivedToken: secrets.longLivedToken },
      2000
    );
  } catch {
    return false;
  }
}
