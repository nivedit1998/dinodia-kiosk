// src/api/haLabels.ts
import type { HaConnectionLike } from './ha';
import { haWsCall } from './haWebSocket';

export type HaLabel = {
  label_id: string;
  name: string;
};

type HaDeviceRegistryEntry = {
  id?: string;
  labels?: string[] | null;
};

type HaEntityRegistryEntry = {
  entity_id?: string;
  labels?: string[] | null;
};

function normalizeLabels(labels: string[] | null | undefined) {
  return Array.from(
    new Set(
      (labels ?? [])
        .filter((lbl) => typeof lbl === 'string')
        .map((lbl) => lbl.trim())
        .filter(Boolean)
    )
  );
}

export async function listHaLabels(ha: HaConnectionLike): Promise<HaLabel[]> {
  const labels = await haWsCall<HaLabel[]>(ha, 'config/label_registry/list');
  return (labels ?? [])
    .filter((label) => typeof label?.label_id === 'string')
    .map((label) => ({
      label_id: label.label_id,
      name:
        typeof label?.name === 'string' && label.name.trim().length > 0
          ? label.name
          : label.label_id,
    }));
}

export async function applyHaLabel(
  ha: HaConnectionLike,
  labelId: string,
  targets: { deviceIds?: string[]; entityIds?: string[] }
): Promise<{ ok: boolean; warning?: string }> {
  const targetDeviceIds = new Set((targets.deviceIds ?? []).map((id) => id.trim()).filter(Boolean));
  const targetEntityIds = new Set((targets.entityIds ?? []).map((id) => id.trim()).filter(Boolean));
  if (!labelId || (targetDeviceIds.size === 0 && targetEntityIds.size === 0)) {
    return { ok: true };
  }

  try {
    const [devices, entities] = await Promise.all([
      haWsCall<HaDeviceRegistryEntry[]>(ha, 'config/device_registry/list'),
      haWsCall<HaEntityRegistryEntry[]>(ha, 'config/entity_registry/list'),
    ]);

    for (const device of devices ?? []) {
      const id = typeof device.id === 'string' ? device.id.trim() : '';
      if (!id || !targetDeviceIds.has(id)) continue;
      const labels = normalizeLabels(device.labels);
      if (labels.includes(labelId)) continue;
      labels.push(labelId);
      await haWsCall(ha, 'config/device_registry/update', {
        device_id: id,
        labels,
      });
    }

    for (const entity of entities ?? []) {
      const id = typeof entity.entity_id === 'string' ? entity.entity_id.trim() : '';
      if (!id || !targetEntityIds.has(id)) continue;
      const labels = normalizeLabels(entity.labels);
      if (labels.includes(labelId)) continue;
      labels.push(labelId);
      await haWsCall(ha, 'config/entity_registry/update', {
        entity_id: id,
        labels,
      });
    }

    return { ok: true };
  } catch (err) {
    const warning =
      err instanceof Error && err.message
        ? err.message
        : 'Failed to apply HA label to new device entities.';
    return { ok: false, warning };
  }
}
