// src/api/monitoringHistory.ts
import { platformFetch } from './platformFetch';
import type { Role } from '../models/roles';
import { fetchKioskContext } from './dinodia';

export type HistoryBucket = 'daily' | 'weekly' | 'monthly';

export type HistoryPoint = {
  bucketStart: string;
  label: string;
  value: number;
  count: number;
};

export type HistoryResult = {
  unit: string | null;
  points: HistoryPoint[];
};

export async function fetchSensorHistoryForCurrentUser(
  _userId: number,
  entityId: string,
  bucket: HistoryBucket
): Promise<HistoryResult> {
  const { user } = await fetchKioskContext();
  const endpoint =
    user.role === ('ADMIN' as Role)
      ? '/api/admin/monitoring/history'
      : '/api/tenant/monitoring/history';

  const url = `${endpoint}?entityId=${encodeURIComponent(entityId)}&bucket=${encodeURIComponent(bucket)}`;

  const { data } = await platformFetch<{ unit?: string | null; points?: HistoryPoint[] }>(url, {
    method: 'GET',
  });

  return {
    unit: data.unit ?? null,
    points: Array.isArray(data.points) ? data.points : [],
  };
}
