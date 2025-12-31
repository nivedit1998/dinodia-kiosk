// src/api/haRegistry.ts
import type { HaConnectionLike } from './ha';
import { haWsCall } from './haWebSocket';

type HaDeviceRegistryEntry = { id?: string };
type HaEntityRegistryEntry = { entity_id?: string; device_id?: string | null };

export type RegistrySnapshot = {
  deviceIds: string[];
  entityIds: string[];
};

export async function fetchEntityToDeviceMap(
  ha: HaConnectionLike
): Promise<Map<string, string>> {
  const [entities] = await Promise.all([
    haWsCall<HaEntityRegistryEntry[]>(ha, 'config/entity_registry/list'),
  ]);
  const map = new Map<string, string>();
  for (const entry of entities ?? []) {
    const entityId =
      typeof entry?.entity_id === 'string' ? entry.entity_id.trim() : '';
    const deviceId =
      typeof entry?.device_id === 'string' ? entry.device_id.trim() : '';
    if (entityId && deviceId) {
      map.set(entityId, deviceId);
    }
  }
  return map;
}

export async function fetchRegistrySnapshot(ha: HaConnectionLike): Promise<RegistrySnapshot> {
  const [devices, entities] = await Promise.all([
    haWsCall<HaDeviceRegistryEntry[]>(ha, 'config/device_registry/list'),
    haWsCall<HaEntityRegistryEntry[]>(ha, 'config/entity_registry/list'),
  ]);

  const deviceIds = (devices ?? [])
    .map((d) => (typeof d?.id === 'string' ? d.id.trim() : ''))
    .filter(Boolean);
  const entityIds = (entities ?? [])
    .map((e) => (typeof e?.entity_id === 'string' ? e.entity_id.trim() : ''))
    .filter(Boolean);

  return {
    deviceIds: Array.from(new Set(deviceIds)),
    entityIds: Array.from(new Set(entityIds)),
  };
}

export function diffRegistrySnapshots(
  before: RegistrySnapshot | null,
  after: RegistrySnapshot | null
): { newDeviceIds: string[]; newEntityIds: string[] } {
  const beforeDevices = new Set(before?.deviceIds ?? []);
  const beforeEntities = new Set(before?.entityIds ?? []);
  const newDeviceIds = (after?.deviceIds ?? []).filter((id) => !beforeDevices.has(id));
  const newEntityIds = (after?.entityIds ?? []).filter((id) => !beforeEntities.has(id));
  return { newDeviceIds, newEntityIds };
}
