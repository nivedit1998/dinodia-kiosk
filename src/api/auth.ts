// src/api/auth.ts
import { ENV } from '../config/env';
import type { Role } from '../models/roles';

export type AuthUser = {
  id: number;
  username: string;
  role: Role;
};

export type LoginStep =
  | { status: 'OK'; role: Role }
  | { status: 'NEEDS_EMAIL' }
  | { status: 'CHALLENGE'; challengeId: string };

export type ChallengeStatus = 'PENDING' | 'APPROVED' | 'CONSUMED' | 'EXPIRED' | 'NOT_FOUND';

type LoginResponse = {
  ok?: boolean;
  role?: Role;
  requiresEmailVerification?: boolean;
  needsEmailInput?: boolean;
  challengeId?: string;
  error?: string;
};

type ChallengeStatusResponse = {
  status?: ChallengeStatus;
  error?: string;
};

type ChallengeCompleteResponse = {
  ok?: boolean;
  role?: Role;
  error?: string;
};

const LOGIN_PATH = '/api/auth/login';
const LOGOUT_PATH = '/api/auth/logout';
const CHALLENGE_PATH = '/api/auth/challenges';
const ADMIN_CHANGE_PASSWORD_PATH = '/api/admin/profile/change-password';
const TENANT_CHANGE_PASSWORD_PATH = '/api/tenant/profile/change-password';

function getPlatformBase(): string {
  const raw = (ENV.DINODIA_PLATFORM_API || '').trim();
  if (!raw) {
    throw new Error('Login is not available right now. Please try again in a moment.');
  }
  return raw.replace(/\/+$/, '');
}

async function platformFetch<T>(path: string, options: RequestInit): Promise<T> {
  const url = `${getPlatformBase()}${path}`;
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[auth] fetch', url, options);
  }
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
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[auth] fetch failed', res.status, data);
    }
    throw new Error((data as any).error || `HTTP ${res.status}`);
  }
  return data;
}

export async function loginWithCredentials(params: {
  username: string;
  password: string;
  deviceId: string;
  deviceLabel: string;
  email?: string;
}): Promise<LoginStep> {
  const trimmedUsername = params.username.trim();
  if (!trimmedUsername || !params.password) {
    throw new Error('Enter both username and password to sign in.');
  }

  const payload: Record<string, string> = {
    username: trimmedUsername,
    password: params.password,
    deviceId: params.deviceId,
    deviceLabel: params.deviceLabel,
  };
  if (params.email && params.email.trim().length > 0) {
    payload.email = params.email.trim();
  }

  try {
    const data = await platformFetch<LoginResponse>(LOGIN_PATH, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (data.requiresEmailVerification) {
      if (data.needsEmailInput) {
        return { status: 'NEEDS_EMAIL' };
      }
      if (data.challengeId) {
        return { status: 'CHALLENGE', challengeId: data.challengeId };
      }
      throw new Error('Email verification is required to continue.');
    }

    if (data.ok && data.role) {
      return { status: 'OK', role: data.role };
    }

    throw new Error(
      typeof data.error === 'string' && data.error.trim().length > 0
        ? data.error
        : 'We could not log you in right now. Please try again.'
    );
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(err.message || 'We could not log you in right now. Please try again.');
    }
    throw new Error('We could not log you in right now. Please try again.');
  }
}

export async function fetchChallengeStatus(challengeId: string): Promise<ChallengeStatus> {
  const url = `${getPlatformBase()}${CHALLENGE_PATH}/${encodeURIComponent(challengeId)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  if (res.status === 404) {
    return 'NOT_FOUND';
  }
  const data = (await res.json().catch(() => ({}))) as ChallengeStatusResponse;
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  if (data.status) {
    return data.status;
  }
  throw new Error('Invalid verification status response.');
}

export async function completeChallenge(
  challengeId: string,
  deviceId: string,
  deviceLabel: string
): Promise<{ role: Role }> {
  const data = await platformFetch<ChallengeCompleteResponse>(
    `${CHALLENGE_PATH}/${encodeURIComponent(challengeId)}/complete`,
    {
      method: 'POST',
      body: JSON.stringify({ deviceId, deviceLabel }),
    }
  );
  if (data.ok && data.role) {
    return { role: data.role };
  }
  throw new Error(
    typeof data.error === 'string' && data.error.trim().length > 0
      ? data.error
      : 'We could not complete verification. Please try again.'
  );
}

export async function resendChallenge(challengeId: string): Promise<void> {
  await platformFetch<{ ok?: boolean }>(
    `${CHALLENGE_PATH}/${encodeURIComponent(challengeId)}/resend`,
    { method: 'POST' }
  );
}

export async function changePassword(opts: {
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
  role: Role;
}): Promise<void> {
  const path =
    opts.role === 'ADMIN'
      ? ADMIN_CHANGE_PASSWORD_PATH
      : TENANT_CHANGE_PASSWORD_PATH;
  await platformFetch<{ ok: boolean }>(path, {
    method: 'POST',
    body: JSON.stringify({
      currentPassword: opts.currentPassword,
      newPassword: opts.newPassword,
      confirmNewPassword: opts.confirmNewPassword,
    }),
  });
}

// Logout: just clear local session on mobile.
export async function logoutRemote(): Promise<void> {
  try {
    await platformFetch<{ ok?: boolean }>(LOGOUT_PATH, { method: 'POST' });
  } catch {
    // ignore
  }
}
