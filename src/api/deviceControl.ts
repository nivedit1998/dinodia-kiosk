// src/api/deviceControl.ts
import { platformFetch } from './platformFetch';

export type DeviceCommandPayload = {
  entityId: string;
  command: string;
  value?: number;
};

export async function sendCloudDeviceCommand(payload: DeviceCommandPayload): Promise<void> {
  await platformFetch('/api/device-control', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
