// src/api/admin.ts
import { ENV } from '../config/env';

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

function getPlatformBase(): string {
  const raw = (ENV.DINODIA_PLATFORM_API || '').trim();
  if (!raw) {
    throw new Error('Dinodia Platform API is not configured.');
  }
  return raw.replace(/\/+$/, '');
}

async function platformFetch<T>(path: string, options: RequestInit): Promise<T> {
  const url = `${getPlatformBase()}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    credentials: 'include',
  });
  const data = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) {
    throw new Error((data as any).error || `HTTP ${res.status}`);
  }
  return data;
}

export async function createTenant(params: {
  username: string;
  password: string;
  areas: string[];
}): Promise<void> {
  const data = await platformFetch<TenantResponse>('/api/admin/tenant', {
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

export async function deregisterProperty(mode: SellingMode): Promise<{ claimCode: string }> {
  const data = await platformFetch<SellingResponse>('/api/admin/selling-property', {
    method: 'POST',
    body: JSON.stringify({ mode }),
  });
  if (!data.ok || !data.claimCode) {
    throw new Error(data.error || 'We could not retrieve the claim code. Please try again.');
  }
  return { claimCode: data.claimCode };
}
