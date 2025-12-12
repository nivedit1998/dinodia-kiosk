// src/api/auth.ts
import { ENV } from '../config/env';
import type { Role } from '../models/roles';

export type AuthUser = {
  id: number;
  username: string;
  role: Role;
};

type LoginResponse = {
  ok: boolean;
  role?: Role;
  user?: AuthUser;
  error?: string;
};

const LOGIN_PATH = '/auth-login'; // implemented on backend (Edge Function)

async function apiFetch<T>(path: string, options: RequestInit): Promise<T> {
  const url = `${ENV.AUTH_BASE_URL}${path}`;
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[auth] fetch', url, options);
  }
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      apikey: ENV.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${ENV.SUPABASE_ANON_KEY}`,
      ...(options.headers || {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[auth] fetch failed', res.status, data);
    }
    throw new Error((data as any).error || `HTTP ${res.status}`);
  }
  return data;
}

export async function loginWithCredentials(
  username: string,
  password: string
): Promise<AuthUser> {
  const trimmedUsername = username.trim();
  if (!trimmedUsername || !password) {
    throw new Error('Enter both username and password to sign in.');
  }

  if (!ENV.AUTH_BASE_URL) {
    throw new Error('Login is not available right now. Please try again in a moment.');
  }

  try {
    const body = JSON.stringify({ username: trimmedUsername, password });
    const data = await apiFetch<LoginResponse>(LOGIN_PATH, {
      method: 'POST',
      body,
    });

    if (!data.ok || !data.user) {
      throw new Error(
        typeof data.error === 'string' && data.error.trim().length > 0
          ? data.error
          : 'We could not find that username and password. Please try again.'
      );
    }

    return data.user;
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(err.message || 'We could not log you in right now. Please try again.');
    }
    throw new Error('We could not log you in right now. Please try again.');
  }
}

// For change password endpoints, mirror your Next.js:
// - /admin/profile/change-password
// - /tenant/profile/change-password
export async function changePassword(opts: {
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
  role: Role;
}): Promise<void> {
  const path =
    opts.role === 'ADMIN'
      ? '/auth/admin/change-password'
      : '/auth/tenant/change-password';
  await apiFetch<{ ok: boolean }>(path, {
    method: 'POST',
    body: JSON.stringify({
      currentPassword: opts.currentPassword,
      newPassword: opts.newPassword,
      confirmNewPassword: opts.confirmNewPassword,
    }),
  });
}

// Logout: just clear local session on mobile.
// If your backend issues cookies, you may also call a /logout endpoint.
export async function logoutRemote(): Promise<void> {
  try {
    await apiFetch<{ ok: boolean }>('/auth/logout', { method: 'POST', body: '{}' });
  } catch {
    // ignore
  }
}
