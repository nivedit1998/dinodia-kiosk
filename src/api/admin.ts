// src/api/admin.ts
import { platformFetch } from './platformFetch';

type TenantResponse = {
  ok?: boolean;
  tenantId?: number;
  error?: string;
};

type SellingMode = 'FULL_RESET' | 'OWNER_TRANSFER';

type SellingResponse = {
  ok?: boolean;
  claimCode?: string;
  error?: string;
};

export type TenantRecord = {
  id: number;
  username: string;
  areas: string[];
};

type TenantsResponse = {
  ok?: boolean;
  tenants?: TenantRecord[];
  error?: string;
};

type UpdateTenantResponse = {
  ok?: boolean;
  tenant?: TenantRecord;
  error?: string;
};

export async function createTenant(params: {
  username: string;
  password: string;
  areas: string[];
}): Promise<void> {
  const { data } = await platformFetch<TenantResponse>('/api/admin/tenant', {
    method: 'POST',
    body: JSON.stringify({
      username: params.username,
      password: params.password,
      areas: params.areas,
    }),
  });

  if (!data.ok) {
    throw new Error(data.error || "We couldn't create this tenant right now. Please try again.");
  }
}

export async function fetchTenants(): Promise<TenantRecord[]> {
  const { data } = await platformFetch<TenantsResponse>('/api/admin/tenant', {
    method: 'GET',
  });
  if (!data.ok) {
    throw new Error(data.error || 'Failed to load tenants.');
  }
  const tenants = Array.isArray(data.tenants) ? data.tenants : [];
  return tenants
    .map((t) => ({
      id: typeof t.id === 'number' ? t.id : Number(t.id),
      username: typeof t.username === 'string' ? t.username : '',
      areas: Array.isArray(t.areas)
        ? t.areas
            .filter((a: unknown): a is string => typeof a === 'string')
            .map((a) => a.trim())
            .filter(Boolean)
        : [],
    }))
    .filter((t) => Number.isFinite(t.id) && t.username.length > 0);
}

export async function updateTenantAreas(tenantId: number, areas: string[]): Promise<TenantRecord> {
  const { data } = await platformFetch<UpdateTenantResponse>(`/api/admin/tenant/${tenantId}`, {
    method: 'PATCH',
    body: JSON.stringify({ areas }),
  });
  if (!data.ok || !data.tenant) {
    throw new Error(data.error || 'Failed to update tenant areas.');
  }
  return {
    id: data.tenant.id,
    username: data.tenant.username,
    areas: Array.isArray(data.tenant.areas)
      ? data.tenant.areas
          .filter((a: unknown): a is string => typeof a === 'string')
          .map((a) => a.trim())
          .filter(Boolean)
      : [],
  };
}

export async function deleteTenant(tenantId: number): Promise<void> {
  const { data } = await platformFetch<UpdateTenantResponse>(`/api/admin/tenant/${tenantId}`, {
    method: 'DELETE',
  });
  if (!data.ok) {
    throw new Error(data.error || 'Failed to delete tenant.');
  }
}

export async function fetchSellingCleanupTargets(): Promise<{ deviceIds: string[]; entityIds: string[] }> {
  const { data } = await platformFetch<{ ok: boolean; targets?: { deviceIds: string[]; entityIds: string[] } }>(
    '/api/admin/selling-property',
    {
      method: 'GET',
    }
  );
  if (!data.ok || !data.targets) {
    throw new Error(data.error || 'Failed to load cleanup targets.');
  }
  return {
    deviceIds: Array.isArray(data.targets.deviceIds) ? data.targets.deviceIds : [],
    entityIds: Array.isArray(data.targets.entityIds) ? data.targets.entityIds : [],
  };
}

export async function deregisterProperty(
  mode: SellingMode,
  opts: { cleanup?: 'platform' | 'device' } = {}
): Promise<{ claimCode: string }> {
  const { data } = await platformFetch<SellingResponse>('/api/admin/selling-property', {
    method: 'POST',
    body: JSON.stringify({ mode, cleanup: opts.cleanup }),
  });
  if (!data.ok || !data.claimCode) {
    throw new Error(data.error || 'We could not retrieve the claim code. Please try again.');
  }
  return { claimCode: data.claimCode };
}
