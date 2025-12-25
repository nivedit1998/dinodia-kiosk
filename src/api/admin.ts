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

export async function deregisterProperty(mode: SellingMode): Promise<{ claimCode: string }> {
  const { data } = await platformFetch<SellingResponse>('/api/admin/selling-property', {
    method: 'POST',
    body: JSON.stringify({ mode }),
  });
  if (!data.ok || !data.claimCode) {
    throw new Error(data.error || 'We could not retrieve the claim code. Please try again.');
  }
  return { claimCode: data.claimCode };
}
