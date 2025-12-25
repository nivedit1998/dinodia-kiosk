// src/api/auth.ts
import type { Role } from '../models/roles';
import { clearPlatformCookie, platformFetch } from './platformFetch';
import { clearPlatformToken, setPlatformToken } from './platformToken';

export type AuthUser = {
  id: number;
  username: string;
  role: Role;
};

export type LoginStep =
  | { status: 'OK'; role: Role; token?: string }
  | { status: 'NEEDS_EMAIL' }
  | { status: 'CHALLENGE'; challengeId: string };

export type ChallengeStatus = 'PENDING' | 'APPROVED' | 'CONSUMED' | 'EXPIRED' | 'NOT_FOUND';

type LoginResponse = {
  ok?: boolean;
  role?: Role;
  token?: string;
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

const LOGIN_PATH = '/api/auth/mobile-login';
const LOGOUT_PATH = '/api/auth/logout';
const CHALLENGE_PATH = '/api/auth/challenges';
const ADMIN_CHANGE_PASSWORD_PATH = '/api/admin/profile/change-password';
const TENANT_CHANGE_PASSWORD_PATH = '/api/tenant/profile/change-password';

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
    const { data } = await platformFetch<LoginResponse>(LOGIN_PATH, {
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
      if (typeof data.token === 'string' && data.token.trim().length > 0) {
        await setPlatformToken(data.token);
      } else {
        throw new Error('Login succeeded but no token was returned. Please try again.');
      }
      return { status: 'OK', role: data.role, token: data.token };
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
  try {
    const { data } = await platformFetch<ChallengeStatusResponse>(
      `${CHALLENGE_PATH}/${encodeURIComponent(challengeId)}`,
      {
        method: 'GET',
      }
    );
    if (data.status) {
      return data.status;
    }
    throw new Error('Invalid verification status response.');
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message.toLowerCase().includes('not found') || message.includes('404')) {
      return 'NOT_FOUND';
    }
    if (err instanceof Error) throw err;
    throw new Error('Invalid verification status response.');
  }
}

export async function completeChallenge(
  challengeId: string,
  deviceId: string,
  deviceLabel: string
): Promise<{ role: Role }> {
  const { data } = await platformFetch<ChallengeCompleteResponse>(
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
  await Promise.all([
    clearPlatformToken().catch(() => undefined),
    clearPlatformCookie().catch(() => undefined),
  ]);
}
