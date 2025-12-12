// src/store/deviceStore.ts
import { AppState } from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchDevicesForUser, HaMode } from '../api/dinodia';
import type { UIDevice } from '../models/device';
import { loadJson, saveJson, removeKey } from '../utils/storage';

type DeviceCacheEntry = {
  devices: UIDevice[];
  updatedAt: number;
};

type RefreshOptions = {
  background?: boolean;
};

const memoryCache = new Map<string, DeviceCacheEntry>();
const inFlight = new Map<string, Promise<DeviceCacheEntry>>();
const cacheKey = (userId: number, mode: HaMode) => `dinodia_devices_${userId}_${mode}`;

async function readFromStorage(userId: number, mode: HaMode): Promise<DeviceCacheEntry | null> {
  const key = cacheKey(userId, mode);
  const existing = memoryCache.get(key);
  if (existing) return existing;

  try {
    const stored = await loadJson<DeviceCacheEntry>(key);
    if (
      stored &&
      Array.isArray((stored as any).devices) &&
      typeof (stored as any).updatedAt === 'number'
    ) {
      memoryCache.set(key, stored);
      return stored;
    }
  } catch {
    // Ignore storage errors; we'll fetch fresh data below
  }

  return null;
}

async function persistCache(userId: number, mode: HaMode, entry: DeviceCacheEntry): Promise<void> {
  const key = cacheKey(userId, mode);
  memoryCache.set(key, entry);
  try {
    await saveJson(key, entry);
  } catch {
    // Ignore storage write failures to avoid blocking UI
  }
}

async function fetchAndCacheDevices(userId: number, mode: HaMode): Promise<DeviceCacheEntry> {
  const key = cacheKey(userId, mode);
  const ongoing = inFlight.get(key);
  if (ongoing) {
    return ongoing;
  }

  const request = (async () => {
    const devices = await fetchDevicesForUser(userId, mode);
    const entry: DeviceCacheEntry = { devices, updatedAt: Date.now() };
    await persistCache(userId, mode, entry);
    return entry;
  })();

  inFlight.set(key, request);
  try {
    return await request;
  } finally {
    inFlight.delete(key);
  }
}

export function useDevices(userId: number, mode: HaMode) {
  const initialKey = useMemo(() => cacheKey(userId, mode), [mode, userId]);
  const initial = useMemo(() => memoryCache.get(initialKey) ?? null, [initialKey]);
  const [devices, setDevices] = useState<UIDevice[]>(initial?.devices ?? []);
  const [lastUpdated, setLastUpdated] = useState<number | null>(initial?.updatedAt ?? null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  // Track whether the app is in the foreground to avoid background polling.
  const appStateRef = useRef<string>(AppState.currentState);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      appStateRef.current = state;
    });
    return () => {
      sub.remove();
    };
  }, []);

  const updateState = useCallback(
    (entry: DeviceCacheEntry | null) => {
      if (!mountedRef.current || !entry) return;
      setDevices(entry.devices);
      setLastUpdated(entry.updatedAt);
    },
    []
  );

  const refreshDevices = useCallback(
    async (opts: RefreshOptions = {}): Promise<UIDevice[] | null> => {
      const silent = opts.background === true;
      let currentRequestId: number | null = null;

      if (!silent) {
        const nextId = requestIdRef.current + 1;
        requestIdRef.current = nextId;
        currentRequestId = nextId;
        setRefreshing(true);
      }

      try {
        const entry = await fetchAndCacheDevices(userId, mode);
        if (!mountedRef.current) {
          return null;
        }
        if (currentRequestId !== null && currentRequestId !== requestIdRef.current) {
          return null;
        }
        updateState(entry);
        setError(null);
        return entry.devices;
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'We could not load your devices right now. Please refresh or switch modes.';
        if (mountedRef.current && (currentRequestId === null || currentRequestId === requestIdRef.current)) {
          setError(message);
          // Clear devices for this mode on error to avoid showing stale data.
          const emptyEntry: DeviceCacheEntry = { devices: [], updatedAt: Date.now() };
          await persistCache(userId, mode, emptyEntry);
          updateState(emptyEntry);
        }
        return null;
      } finally {
        if (mountedRef.current && !silent && currentRequestId !== null && currentRequestId === requestIdRef.current) {
          setRefreshing(false);
        }
      }
    },
    [mode, updateState, userId]
  );

  useEffect(() => {
    const key = cacheKey(userId, mode);
    const cached = memoryCache.get(key);
    if (cached) {
      setDevices(cached.devices);
      setLastUpdated(cached.updatedAt);
    } else {
      setDevices([]);
      setLastUpdated(null);
    }
    setError(null);
  }, [mode, userId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await readFromStorage(userId, mode);
      if (cancelled || !mountedRef.current) return;
      updateState(cached);
      await refreshDevices({ background: true });
    })();

    const interval = setInterval(() => {
      if (appStateRef.current !== 'active') return;
      void refreshDevices({ background: true });
    }, 12000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [mode, refreshDevices, updateState, userId]);

  return {
    devices,
    lastUpdated,
    refreshing,
    error,
    refreshDevices,
  };
}

export async function clearDeviceCacheForUserAndMode(
  userId: number,
  mode: HaMode
): Promise<void> {
  const key = cacheKey(userId, mode);
  memoryCache.delete(key);
  inFlight.delete(key);
  try {
    await removeKey(key);
  } catch {
    // Ignore storage errors when clearing cache
  }
}

export async function clearAllDeviceCacheForUser(userId: number): Promise<void> {
  const modes: HaMode[] = ['home', 'cloud'];
  for (const mode of modes) {
    await clearDeviceCacheForUserAndMode(userId, mode);
  }
}
