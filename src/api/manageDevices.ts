// src/api/manageDevices.ts
import { platformFetch } from './platformFetch';

export type ManagedDevice = {
  id: string;
  deviceId: string;
  label: string | null;
  registryLabel: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  status: 'ACTIVE' | 'STOLEN' | 'BLOCKED';
};

type ManageDevicesResponse = {
  devices?: ManagedDevice[];
  error?: string;
};

export async function fetchManagedDevices(): Promise<ManagedDevice[]> {
  const { data } = await platformFetch<ManageDevicesResponse>('/api/devices/manage', {
    method: 'GET',
  });
  if (data.error) {
    throw new Error(data.error);
  }
  return Array.isArray(data.devices) ? data.devices : [];
}

export async function markDeviceStolen(deviceId: string): Promise<void> {
  if (!deviceId) throw new Error('Device id is required.');
  const { data } = await platformFetch<{ ok?: boolean; error?: string }>(
    '/api/devices/manage/stolen',
    {
      method: 'POST',
      body: JSON.stringify({ deviceId }),
    }
  );
  if (!data.ok) {
    throw new Error(data.error || 'Unable to mark device as stolen.');
  }
}

export async function markDeviceActive(deviceId: string): Promise<void> {
  if (!deviceId) throw new Error('Device id is required.');
  const { data } = await platformFetch<{ ok?: boolean; error?: string }>(
    '/api/devices/manage/restore',
    {
      method: 'POST',
      body: JSON.stringify({ deviceId }),
    }
  );
  if (!data.ok) {
    throw new Error(data.error || 'Unable to restore device.');
  }
}
