// src/api/dinodia.ts
import { supabase } from './supabaseClient';
import type { User } from '../models/user';
import type { Role } from '../models/roles';
import type { HaConnection } from '../models/haConnection';
import type { AccessRule } from '../models/accessRule';
import type { UIDevice, DeviceOverride } from '../models/device';
import { getDevicesWithMetadata, EnrichedDevice, HaConnectionLike, probeHaReachability } from './ha';
import { classifyDeviceByLabel } from '../utils/labelCatalog';

export type HaMode = 'home' | 'cloud';

type UserWithRelations = User & {
  accessRules?: AccessRule[];
};

async function fetchUserWithRelations(userId: number): Promise<UserWithRelations | null> {
  const { data, error } = await supabase
    .from('User')
    .select('id, username, role, haConnectionId')
    .eq('id', userId)
    .single();

  if (error) throw error;
  if (!data) return null;

  const user: UserWithRelations = data as UserWithRelations;

  const { data: rules, error: rulesError } = await supabase
    .from('AccessRule')
    .select('*')
    .eq('userId', userId);
  if (!rulesError && rules) {
    user.accessRules = rules as AccessRule[];
  }

  return user;
}

async function fetchHaConnectionById(id: number): Promise<HaConnection | null> {
  const { data, error } = await supabase.from('HaConnection').select('*').eq('id', id).single();
  if (error || !data) return null;
  return data as HaConnection;
}

async function fetchHaConnectionOwnedBy(userId: number): Promise<HaConnection | null> {
  const { data, error } = await supabase
    .from('HaConnection')
    .select('*')
    .eq('ownerId', userId)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as HaConnection;
}

// This mimics src/lib/haConnection.getUserWithHaConnection
export async function getUserWithHaConnection(
  userId: number
): Promise<{ user: UserWithRelations; haConnection: HaConnection }> {
  let user = await fetchUserWithRelations(userId);
  if (!user) throw new Error('User not found');

  let haConnection: HaConnection | null = null;

  if (user.haConnectionId) {
    haConnection = await fetchHaConnectionById(user.haConnectionId);
  }

  if (!haConnection && user.role === 'ADMIN') {
    haConnection = await fetchHaConnectionOwnedBy(user.id);
  }

  if (user.role === 'TENANT') {
    // For tenants, always resolve the canonical HA connection from an admin,
    // so they stay in sync with the admin's HA settings (base URL, token, etc.).
    const { data: admins, error } = await supabase
      .from('User')
      .select('id, haConnectionId')
      .eq('role', 'ADMIN')
      .limit(1);
    if (error) throw error;

    type AdminRow = {
      id: number;
      haConnectionId: number | null;
    };
    const admin = admins?.[0] as AdminRow | undefined;
    const adminOwned = admin ? await fetchHaConnectionOwnedBy(admin.id) : null;
    const adminHaConnectionId = admin?.haConnectionId ?? adminOwned?.id ?? null;

    if (admin && !admin.haConnectionId && adminHaConnectionId) {
      await supabase
        .from('User')
        .update({ haConnectionId: adminHaConnectionId })
        .eq('id', admin.id);
    }

    if (adminHaConnectionId) {
      await supabase
        .from('User')
        .update({ haConnectionId: adminHaConnectionId })
        .eq('id', user.id);

      const ha = await fetchHaConnectionById(adminHaConnectionId);
      if (!ha) throw new Error('Dinodia Hub connection not found');

      haConnection = ha;
      user = (await fetchUserWithRelations(userId))!;
    } else if (!haConnection) {
      throw new Error(
        'Dinodia Hub connection is not configured for this property. The homeowner needs to set it up.'
      );
    }
  }

  if (!user || !haConnection) {
    throw new Error('Dinodia Hub connection is not configured for this home.');
  }

  return { user, haConnection };
}

export async function fetchDevicesForUser(
  userId: number,
  mode: HaMode = 'home'
): Promise<UIDevice[]> {
  const { user, haConnection } = await getUserWithHaConnection(userId);
  const rawUrl = mode === 'cloud' ? haConnection.cloudUrl : haConnection.baseUrl;
  const baseUrl = (rawUrl ?? '').trim().replace(/\/+$/, '');

  // If there is no URL for this mode, return an empty dashboard.
  if (!baseUrl) {
    return [];
  }

  const haLike: HaConnectionLike = {
    baseUrl,
    longLivedToken: haConnection.longLivedToken,
  };

  // Fast reachability pre-check to fail quickly when HA is unreachable.
  const reachable = await probeHaReachability(haLike, mode === 'home' ? 2000 : 4000);
  if (!reachable) {
    if (mode === 'home') {
      throw new Error(
        'We cannot find your Dinodia Hub on the home Wi-Fi. It looks like you are away from home—switch to Dinodia Cloud to control your place.'
      );
    } else {
      throw new Error(
        'Dinodia Cloud is not ready yet. The homeowner needs to finish setting up remote access for this property.'
      );
    }
  }

  // 1) Fetch devices from HA
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
    // Let the hook handle the error and clear stale devices.
    throw new Error(message);
  }

  // 2) Load overrides
  const { data: dbDevices, error } = await supabase
    .from('Device')
    .select('*')
    .eq('haConnectionId', haConnection.id);
  if (error) throw error;

  const overrideMap = new Map<string, DeviceOverride>();
  (dbDevices ?? []).forEach((d: any) => {
    overrideMap.set(d.entityId, d as DeviceOverride);
  });

  // 3) Apply overrides and shape
  const devices: UIDevice[] = enriched.map((d) => {
    const override = overrideMap.get(d.entityId);
    const name = override?.name ?? d.name;
    const areaName = override?.area ?? d.areaName ?? null;
    const labels = override?.label ? [override.label] : d.labels;
    const labelCategory =
      classifyDeviceByLabel(labels) ?? d.labelCategory ?? null;
    const primaryLabel =
      labels.length > 0 && labels[0] ? String(labels[0]) : null;
    const label = override?.label ?? primaryLabel ?? labelCategory ?? null;

    return {
      entityId: d.entityId,
      deviceId: d.deviceId ?? null,
      name,
      state: d.state,
      area: areaName,
      areaName,
      labels,
      label,
      labelCategory,
      domain: d.domain,
      attributes: d.attributes ?? {},
    };
  });

  // 4) Tenant filtering by AccessRule
  if (user.role === 'TENANT') {
    const rules = (user.accessRules ?? []) as AccessRule[];
    const result = devices.filter(
      (d) =>
        d.areaName !== null && rules.some((r) => r.area === d.areaName)
    );
    return result;
  }

  return devices;
}

export async function updateDeviceOverride(params: {
  adminId: number;
  entityId: string;
  name: string;
  area: string;
  label: string;
}): Promise<void> {
  const { haConnection } = await getUserWithHaConnection(params.adminId);

  const cleanArea = params.area.trim() === '' ? null : params.area.trim();
  const cleanLabel = params.label.trim() === '' ? null : params.label.trim();

  const { error } = await supabase.from('Device').upsert(
    {
      haConnectionId: haConnection.id,
      entityId: params.entityId,
      name: params.name,
      area: cleanArea,
      label: cleanLabel,
    },
    {
      onConflict: 'haConnectionId,entityId',
    } as any
  );
  if (error) throw error;
}

export async function createTenant(params: {
  adminId: number;
  username: string;
  passwordHash: string; // You will hash server-side if you expose a secure endpoint
  area: string;
}): Promise<void> {
  const { haConnection } = await getUserWithHaConnection(params.adminId);

  // In practice, you should not send `passwordHash` from the client; instead call a secure endpoint.
  const { data: tenant, error } = await supabase
    .from('User')
    .insert({
      username: params.username,
      passwordHash: params.passwordHash,
      role: 'TENANT',
      haConnectionId: haConnection.id,
    })
    .select('id')
    .single();

  if (error) throw error;

  const tenantId = (tenant as { id: number }).id;
  const { error: errAccess } = await supabase
    .from('AccessRule')
    .insert({
      userId: tenantId,
      area: params.area,
    });

  if (errAccess) throw errAccess;
}

export async function updateHaSettings(params: {
  adminId: number;
  haUsername: string;
  haBaseUrl: string;
  haCloudUrl?: string;
  haPassword?: string;
  haLongLivedToken?: string;
}): Promise<HaConnection> {
  const { haConnection } = await getUserWithHaConnection(params.adminId);
  const normalizedBaseUrl = normalizeHaBaseUrl(params.haBaseUrl);

  const updateData: Partial<HaConnection> = {
    haUsername: params.haUsername.trim(),
    baseUrl: normalizedBaseUrl,
  };
  if (params.haCloudUrl !== undefined) {
    const trimmedCloud = params.haCloudUrl.trim();
    (updateData as any).cloudUrl = trimmedCloud.length === 0 ? null : trimmedCloud.replace(/\/+$/, '');
  }
  if (params.haPassword && params.haPassword.length > 0) {
    (updateData as any).haPassword = params.haPassword;
  }
  if (params.haLongLivedToken && params.haLongLivedToken.length > 0) {
    (updateData as any).longLivedToken = params.haLongLivedToken;
  }

  const { data, error } = await supabase
    .from('HaConnection')
    .update(updateData)
    .eq('id', haConnection.id)
    .select('*')
    .single();
  if (error) throw error;

  return data as HaConnection;
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
  return trimmed.replace(/\/+$/, '');
}
