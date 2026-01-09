// src/api/deviceOverrides.ts
import { platformFetch } from './platformFetch';

type UpdateDeviceParams = {
  entityId: string;
  name: string;
  blindTravelSeconds?: number | null;
};

export async function updateDeviceOverride(params: UpdateDeviceParams): Promise<void> {
  const payload: Record<string, unknown> = {
    entityId: params.entityId,
    name: params.name,
  };
  if (params.blindTravelSeconds !== undefined) {
    payload.blindTravelSeconds = params.blindTravelSeconds;
  }
  await platformFetch<{ ok?: boolean; error?: string }>('/api/admin/device', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
