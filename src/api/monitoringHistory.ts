// src/api/monitoringHistory.ts
import { supabase } from './supabaseClient';
import { getUserWithHaConnection } from './dinodia';
import { ENV } from '../config/env';

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

type BucketInfo = {
  key: string;
  bucketStart: Date;
  label: string;
};

type AggregatedBucket = {
  sum: number;
  count: number;
  bucketStart: Date;
  label: string;
};

const DEFAULT_DAYS: Record<HistoryBucket, number> = {
  daily: 30,
  weekly: 7 * 12,
  monthly: 365,
};

function startOfDayLocal(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDateLabel(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatMonthLabel(date: Date): string {
  const y = date.getFullYear();
  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${monthNames[date.getMonth()]} ${y}`;
}

function getIsoWeekInfo(date: Date) {
  const temp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = temp.getUTCDay() || 7;
  temp.setUTCDate(temp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(temp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((temp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);

  const weekStart = new Date(
    Date.UTC(temp.getUTCFullYear(), temp.getUTCMonth(), temp.getUTCDate())
  );
  const weekStartDay = weekStart.getUTCDay() || 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - (weekStartDay - 1));

  return { year: temp.getUTCFullYear(), week, weekStart };
}

function getBucketInfo(bucket: HistoryBucket, capturedAt: Date): BucketInfo {
  if (bucket === 'weekly') {
    const { year, week, weekStart } = getIsoWeekInfo(capturedAt);
    const label = `Week of ${formatDateLabel(new Date(weekStart))}`;
    return {
      key: `${year}-W${String(week).padStart(2, '0')}`,
      bucketStart: new Date(weekStart),
      label,
    };
  }

  if (bucket === 'monthly') {
    const start = new Date(capturedAt.getFullYear(), capturedAt.getMonth(), 1);
    return {
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
      bucketStart: start,
      label: formatMonthLabel(start),
    };
  }

  const start = startOfDayLocal(capturedAt);
  return {
    key: formatDateLabel(start),
    bucketStart: start,
    label: formatDateLabel(start),
  };
}

export async function fetchSensorHistoryForCurrentUser(
  userId: number,
  entityId: string,
  bucket: HistoryBucket
): Promise<HistoryResult> {
  const { haConnection } = await getUserWithHaConnection(userId);
  const days = DEFAULT_DAYS[bucket] ?? DEFAULT_DAYS.daily;
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from('MonitoringReading')
    .select('*')
    .eq('haConnectionId', haConnection.id)
    .eq('entityId', entityId)
    .gte('capturedAt', fromDate.toISOString())
    .order('capturedAt', { ascending: true });

  if (error) {
    // If direct table access is blocked by RLS, fall back to platform API (if configured).
    const msg = String(error.message || '');
    if (
      ENV.DINODIA_PLATFORM_API &&
      msg.toLowerCase().includes('permission')
    ) {
      try {
        const apiBase = ENV.DINODIA_PLATFORM_API.replace(/\/+$/, '');
        const url = `${apiBase}/api/admin/monitoring/history`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, entityId, bucket }),
        });
        if (!res.ok) {
          throw new Error(`Platform API error ${res.status}`);
        }
        const body = await res.json();
        // Expect { unit, points }
        return { unit: body.unit ?? null, points: Array.isArray(body.points) ? body.points : [] };
      } catch (err: any) {
        throw new Error('We could not load your history right now. Please try again.');
      }
    }

    throw new Error('We could not load your history right now. Please try again.');
  }

  const readings = Array.isArray(data) ? data : [];

  let unit: string | null = null;
  const buckets: Record<string, AggregatedBucket> = {};

  for (const reading of readings as any[]) {
    const readingUnit =
      typeof reading.unit === 'string' && reading.unit.trim().length > 0
        ? String(reading.unit).trim()
        : null;
    if (unit === null && readingUnit) {
      unit = readingUnit;
    }

    const numeric =
      typeof reading.numericValue === 'number'
        ? reading.numericValue
        : typeof reading.numericValue === 'string'
        ? Number(reading.numericValue)
        : NaN;
    if (!Number.isFinite(numeric)) continue;

    const capturedAt = new Date(reading.capturedAt);
    if (Number.isNaN(capturedAt.getTime())) continue;

    const info = getBucketInfo(bucket, capturedAt);
    const existing = buckets[info.key];
    if (!existing) {
      buckets[info.key] = {
        sum: numeric,
        count: 1,
        bucketStart: info.bucketStart,
        label: info.label,
      };
    } else {
      existing.sum += numeric;
      existing.count += 1;
    }
  }

  const shouldUseSum = typeof unit === 'string' && unit.toLowerCase().includes('wh');

  const points: HistoryPoint[] = Object.values(buckets)
    .filter((b) => b.count > 0)
    .sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime())
    .map((b) => ({
      bucketStart: b.bucketStart.toISOString(),
      label: b.label,
      value: shouldUseSum ? b.sum : b.sum / b.count,
      count: b.count,
    }));

  return {
    unit,
    points,
  };
}
