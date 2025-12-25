// src/api/haRegistry.ts
import type { HaConnectionLike } from './ha';
import { haWsCall } from './haWebSocket';

type HaDeviceRegistryEntry = { id?: string };
type HaEntityRegistryEntry = { entity_id?: string };

export type RegistrySnapshot = {
  deviceIds: string[];
  entityIds: string[];
};

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
