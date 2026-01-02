// src/api/dinodia.ts
import type { User } from '../models/user';
import type { AccessRule } from '../models/accessRule';
import type { UIDevice } from '../models/device';
import { getDevicesWithMetadata, EnrichedDevice, HaConnectionLike, probeHaReachability } from './ha';
import { classifyDeviceByLabel } from '../utils/labelCatalog';
import { platformFetch } from './platformFetch';
import type { Role } from '../models/roles';
import type { HaConnection } from '../models/haConnection';
import { fetchHomeModeSecrets } from './haSecrets';
import { isLocalIp } from '../utils/net';

type HaConnectionSafe = {
  id: number;
  ownerId?: number | null;
  cloudEnabled?: boolean;
};

export type HaMode = 'home' | 'cloud';
export const HOME_WIFI_PROMPT =
  'To use Home mode connect to your home Wi-Fi by clicking the Wi-Fi name in the navigation bar';

type UserWithRelations = User & { accessRules?: AccessRule[] };

type KioskContextResponse = {
  user: {
    id: number;
    username: string;
    role: Role;
    homeId: number;
  };
  haConnection: HaConnectionSafe | null;
  accessRules?: AccessRule[];
};

export async function fetchKioskContext(): Promise<{
  user: UserWithRelations;
  haConnection: HaConnectionSafe | null;
}> {
  const { data } = await platformFetch<KioskContextResponse>('/api/kiosk/context', {
    method: 'GET',
  });
  if (!data || !data.user || !data.haConnection) {
    throw new Error('We could not load your account. Please sign in again.');
  }

  return {
    user: {
      id: data.user.id,
      username: data.user.username,
      role: data.user.role,
      homeId: data.user.homeId,
      accessRules: Array.isArray(data.accessRules)
        ? data.accessRules.filter((r): r is AccessRule => !!r && typeof r.area === 'string')
        : [],
    },
    haConnection: data.haConnection,
  };
}

// For compatibility with existing callers
export async function getUserWithHaConnection(_userId: number) {
  return fetchKioskContext();
}

export async function fetchDevicesForUser(
  _userId: number,
  mode: HaMode = 'home'
): Promise<UIDevice[]> {
  const { user, haConnection } = await fetchKioskContext();
  if (!haConnection) {
    throw new Error('Dinodia Hub connection is not configured for this account.');
  }

  if (mode === 'cloud') {
    try {
      const { data } = await platformFetch<{ devices?: UIDevice[]; error?: string }>(
        '/api/devices?fresh=1',
        { method: 'GET' }
      );
      const list = Array.isArray(data.devices) ? data.devices : [];
      return user.role === 'TENANT'
        ? list.filter((d) => d.areaName && (user.accessRules ?? []).some((r) => r.area === d.areaName))
        : list;
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Dinodia Cloud is not ready yet. The homeowner needs to finish setting up remote access for this property.';
      throw new Error(message);
    }
  }

  // Home mode: fetch secrets just-in-time.
  const secrets = await fetchHomeModeSecrets();
  const haLike: HaConnectionLike = {
    baseUrl: secrets.baseUrl,
    longLivedToken: secrets.longLivedToken,
  };

  // Fast reachability pre-check to fail quickly when HA is unreachable.
  const reachable = await probeHaReachability(haLike, 2000);
  if (!reachable) {
    throw new Error(HOME_WIFI_PROMPT);
  }

  let enriched: EnrichedDevice[] = [];
  try {
    enriched = await getDevicesWithMetadata(haLike);
  } catch (err) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error('Failed to fetch devices from HA:', err);
    }
    const message =
      err instanceof Error && err.message
        ? err.message
        : 'We could not connect to your Dinodia Hub right now. Please try again.';
    throw new Error(message);
  }

  const devices: UIDevice[] = enriched.map((d) => {
    const areaName = d.areaName ?? null;
    const labels = d.labels;
    const labelCategory = classifyDeviceByLabel(labels) ?? d.labelCategory ?? null;
    const primaryLabel = labels.length > 0 && labels[0] ? String(labels[0]) : null;
    const label = primaryLabel ?? labelCategory ?? null;

    return {
      entityId: d.entityId,
      deviceId: d.deviceId ?? null,
      name: d.name,
      state: d.state,
      area: areaName,
      areaName,
      labels,
      label,
      labelCategory,
      domain: d.domain,
      attributes: d.attributes ?? {},
      blindTravelSeconds: null,
    };
  });

  if (user.role === 'TENANT') {
    const rules = (user.accessRules ?? []) as AccessRule[];
    return devices.filter(
      (d) => d.areaName !== null && rules.some((r) => r.area === d.areaName)
    );
  }

  return devices;
}

export async function updateHaSettings(params: {
  adminId: number;
  haUsername: string;
  haBaseUrl: string;
  haPassword?: string;
  haLongLivedToken?: string;
}): Promise<HaConnection> {
  const { haConnection } = await fetchKioskContext();
  if (!haConnection) {
    throw new Error('Dinodia Hub connection is not configured for this account.');
  }
  const normalizedBaseUrl = normalizeHaBaseUrl(params.haBaseUrl);

  type UpdateResponse = {
    ok?: boolean;
    haUsername?: string;
    haBaseUrl?: string;
    cloudEnabled?: boolean;
    hasHaPassword?: boolean;
    hasLongLivedToken?: boolean;
    role?: Role;
    error?: string;
  };

  const payload: Record<string, string> = {
    haUsername: params.haUsername.trim(),
    haBaseUrl: normalizedBaseUrl,
  };
  if (params.haPassword && params.haPassword.length > 0) {
    payload.haPassword = params.haPassword;
  }
  if (params.haLongLivedToken && params.haLongLivedToken.length > 0) {
    payload.haLongLivedToken = params.haLongLivedToken;
  }

  try {
    const { data } = await platformFetch<UpdateResponse>('/api/admin/profile/ha-settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });

    if (data && data.ok === false) {
      throw new Error(
        (data.error && typeof data.error === 'string' && data.error.trim().length > 0
          ? data.error
          : null) ||
          'We could not save these Dinodia Hub settings. Please try again.'
      );
    }

    const merged: HaConnection = {
      id: haConnection.id,
      haUsername: data.haUsername ?? params.haUsername,
      baseUrl: data.haBaseUrl ?? normalizedBaseUrl,
      ownerId: haConnection.ownerId ?? null,
      cloudEnabled:
        typeof data.cloudEnabled === 'boolean' ? data.cloudEnabled : haConnection.cloudEnabled,
    };

    return merged;
  } catch (err) {
    if (err instanceof Error) {
      throw err;
    }
    throw new Error('We could not reach the server. Please try again.');
  }
}

function normalizeHaBaseUrl(value: string): string {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Invalid Dinodia Hub URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Dinodia Hub URL must start with http:// or https://');
  }
  if (parsed.protocol === 'http:' && !isLocalIp(parsed.hostname)) {
    throw new Error('For security, http:// Dinodia Hub URLs are only allowed on the local network.');
  }
  return trimmed.replace(/\/+$/, '');
}
