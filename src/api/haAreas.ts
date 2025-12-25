// src/api/haAreas.ts
import type { HaConnectionLike } from './ha';
import { haWsCall } from './haWebSocket';

type HaAreaEntry = {
  area_id?: string;
  name?: string;
};

function normalize(value: string) {
  return value.trim().toLowerCase();
}

export async function assignHaAreaToDevices(
  ha: HaConnectionLike,
  areaName: string | null | undefined,
  deviceIds: string[]
): Promise<{ ok: boolean; warning?: string }> {
  const normalizedArea = typeof areaName === 'string' ? areaName.trim() : '';
  const targets = deviceIds.map((id) => id.trim()).filter(Boolean);
  if (!normalizedArea || targets.length === 0) {
    return { ok: true };
  }

  try {
    const areas = await haWsCall<HaAreaEntry[]>(ha, 'config/area_registry/list');
    const match = (areas ?? []).find((entry) => {
      const name = typeof entry.name === 'string' ? entry.name : '';
      return normalize(name) === normalize(normalizedArea);
    });
    if (!match?.area_id) {
      return { ok: false, warning: 'Area not found in Home Assistant.' };
    }

    await Promise.all(
      targets.map((deviceId) =>
        haWsCall(ha, 'config/device_registry/update', {
          device_id: deviceId,
          area_id: match.area_id,
        })
      )
    );
    return { ok: true };
  } catch (err) {
    const warning =
      err instanceof Error && err.message
        ? err.message
        : 'Failed to assign the device to the selected area.';
    return { ok: false, warning };
  }
}
