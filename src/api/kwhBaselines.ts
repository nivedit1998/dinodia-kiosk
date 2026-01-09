import { platformFetch } from './platformFetch';

type BaselineResponse = {
  ok?: boolean;
  baselines?: { entityId: string; firstKwh: number | null; firstCapturedAt?: string | null }[];
  pricePerKwh?: number | null;
  error?: string;
};

export async function fetchAdminKwhBaselines(
  entityIds: string[]
): Promise<{ baselines: Record<string, number>; pricePerKwh: number | null }> {
  if (!Array.isArray(entityIds) || entityIds.length === 0) return { baselines: {}, pricePerKwh: null };
  const ids = Array.from(new Set(entityIds.filter((id) => typeof id === 'string' && id.trim().length > 0)));
  if (ids.length === 0) return { baselines: {}, pricePerKwh: null };

  const { data } = await platformFetch<BaselineResponse>('/api/admin/monitoring/kwh-totals', {
    method: 'POST',
    body: JSON.stringify({ entityIds: ids }),
  });

  if (!data?.ok || !Array.isArray(data.baselines)) {
    throw new Error(data?.error || 'Failed to load energy baselines');
  }

  const map: Record<string, number> = {};
  for (const row of data.baselines) {
    if (!row || typeof row.entityId !== 'string') continue;
    if (typeof row.firstKwh === 'number' && Number.isFinite(row.firstKwh)) {
      map[row.entityId] = row.firstKwh;
    }
  }

  const price =
    typeof data.pricePerKwh === 'number' && Number.isFinite(data.pricePerKwh) && data.pricePerKwh >= 0
      ? data.pricePerKwh
      : null;

  return { baselines: map, pricePerKwh: price };
}
