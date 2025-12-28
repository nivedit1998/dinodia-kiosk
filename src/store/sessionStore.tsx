// src/store/sessionStore.ts
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState, NativeModules } from 'react-native';
import NetInfo, { NetInfoStateType } from '@react-native-community/netinfo';
import CookieManager from '@react-native-cookies/cookies';
import type { AuthUser } from '../api/auth';
import type { HaConnection } from '../models/haConnection';
import { logoutRemote } from '../api/auth';
import { clearPlatformCookie } from '../api/platformFetch';
import { clearPlatformToken, getPlatformToken, setPlatformToken } from '../api/platformToken';
import { clearTokens } from '../spotify/spotifyApi';
import { loadJson, saveJson, removeKey } from '../utils/storage';
import { clearAllDeviceCacheForUser } from './deviceStore';
import { platformFetch } from '../api/platformFetch';
import { clearHomeModeSecrets } from '../api/haSecrets';
import { setOnSessionInvalid } from '../api/sessionInvalid';

type Session = {
  user: AuthUser | null;
  haConnection: HaConnection | null;
};

export type HaMode = 'home' | 'cloud';

type SessionContextValue = {
  session: Session;
  loading: boolean;
  setSession: (s: Session, opts?: { platformToken?: string | null }) => Promise<void>;
  clearSession: () => Promise<void>;
  resetApp: () => Promise<void>;
  haMode: HaMode;
  setHaMode: (mode: HaMode) => void;
};

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

const SESSION_KEY = 'dinodia_session';
const SPOTIFY_EPHEMERAL_KEY = 'spotify_auth_ephemeral_v1';

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<Session>({
    user: null,
    haConnection: null,
  });
  const [loading, setLoading] = useState(true);
  const [haMode, setHaModeState] = useState<HaMode>('home');
  const resettingRef = useRef(false);
  const lastConnectionType = useRef<NetInfoStateType | null>(null);
  const lastWifiId = useRef<string | null>(null);
  const lastWifiCheckMs = useRef(0);

  useEffect(() => {
    void (async () => {
      const [stored, token] = await Promise.all([
        loadJson<Session>(SESSION_KEY),
        getPlatformToken(),
      ]);
      if (stored && token) {
        setSessionState(stored);
      } else {
        await removeKey(SESSION_KEY).catch(() => undefined);
      }
      // Always start new app sessions in home mode.
      setHaModeState('home');
      setLoading(false);
    })();
  }, []);

  const resetToCleanSlate = async (userId?: number) => {
    if (resettingRef.current) return;
    resettingRef.current = true;
    try {
      await logoutRemote().catch(() => undefined);
      if (userId) {
        await clearAllDeviceCacheForUser(userId).catch(() => undefined);
        await removeKey(`tenant_selected_area_${userId}`).catch(() => undefined);
      }
      await clearPlatformToken().catch(() => undefined);
      await clearPlatformCookie().catch(() => undefined);
      await clearTokens().catch(() => undefined);
      await removeKey(SPOTIFY_EPHEMERAL_KEY).catch(() => undefined);
      await CookieManager.clearAll(true).catch(() => undefined);
      if (CookieManager.flush) {
        await CookieManager.flush().catch(() => undefined);
      }
      await removeKey(SESSION_KEY).catch(() => undefined);
      clearHomeModeSecrets();
    } finally {
      setSessionState({ user: null, haConnection: null });
      setHaModeState('home');
      resettingRef.current = false;
    }
  };

  const verifyUserStillExists = async () => {
    const userId = session.user?.id;
    if (!userId || loading) return;
    if (resettingRef.current) return;

    try {
      const { data } = await platformFetch<{ user: AuthUser | null }>('/api/auth/me', {
        method: 'GET',
      });
      if (!data.user || data.user.id !== userId) {
        await resetToCleanSlate(userId);
      }
    } catch {
      // ignore transient errors; will retry on next check
    }
  };

  useEffect(() => {
    void verifyUserStillExists();
  }, [loading, session.user?.id]);

  useEffect(() => {
    let mounted = true;
    NetInfo.fetch()
      .then((state) => {
        if (mounted) {
          lastConnectionType.current = state.type;
          if (state.type === NetInfoStateType.wifi) {
            const ssid = (state.details as any)?.ssid || (state.details as any)?.bssid || null;
            lastWifiId.current = typeof ssid === 'string' && ssid.trim().length > 0 ? ssid.trim() : null;
          }
        }
      })
      .catch(() => undefined);

    const unsubscribe = NetInfo.addEventListener((state) => {
      const previous = lastConnectionType.current;
      const currentType = state.type;
      lastConnectionType.current = currentType;

      const now = Date.now();
      const wifiDetailsSsid = (state.details as any)?.ssid || (state.details as any)?.bssid || null;
      const wifiIdFromNetInfo =
        typeof wifiDetailsSsid === 'string' && wifiDetailsSsid.trim().length > 0
          ? wifiDetailsSsid.trim()
          : null;

      const updateLastWifiId = async () => {
        // Throttle Wi-Fi ID checks to avoid rapid loops.
        if (now - lastWifiCheckMs.current < 1000) return lastWifiId.current;
        lastWifiCheckMs.current = now;
        if (wifiIdFromNetInfo) {
          lastWifiId.current = wifiIdFromNetInfo;
          return lastWifiId.current;
        }
        // Fallback to native module SSID when NetInfo lacks SSID/BSSID.
        try {
          const { DeviceStatus } = NativeModules as any;
          const ssid = DeviceStatus?.getWifiName ? await DeviceStatus.getWifiName() : null;
          lastWifiId.current = typeof ssid === 'string' && ssid.trim().length > 0 ? ssid.trim() : null;
          return lastWifiId.current;
        } catch {
          return lastWifiId.current;
        }
      };

      const handleWifiChange = async () => {
        if (!session.user?.id) return;

        // Wi-Fi -> non-Wi-Fi: logout (existing behavior).
        if (previous === NetInfoStateType.wifi && currentType !== NetInfoStateType.wifi) {
          void resetToCleanSlate(session.user.id);
          return;
        }

        // Wi-Fi -> Wi-Fi but different network: logout.
        if (previous === NetInfoStateType.wifi && currentType === NetInfoStateType.wifi) {
          const currentWifiId = await updateLastWifiId();
          const prevWifiId = lastWifiId.current;
          if (prevWifiId && currentWifiId && prevWifiId !== currentWifiId) {
            void resetToCleanSlate(session.user.id);
            return;
          }
          // If we have no fingerprint yet, just update without logging out.
          return;
        }

        // First time establishing Wi-Fi.
        if (currentType === NetInfoStateType.wifi && !lastWifiId.current) {
          void updateLastWifiId();
        }
      };

      void handleWifiChange();

      if (!session.user?.id) return;
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [session.user?.id]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void verifyUserStillExists();
      } else {
        clearHomeModeSecrets();
      }
    });
    return () => {
      sub.remove();
    };
  }, [loading, session.user?.id]);

  useEffect(() => {
    if (loading || !session.user?.id) return;
    const id = setInterval(() => {
      void verifyUserStillExists();
    }, 60000);
    return () => {
      clearInterval(id);
    };
  }, [loading, session.user?.id]);

  useEffect(() => {
    // Hook platformFetch session-invalid into resetApp.
    setOnSessionInvalid(async () => {
      const uid = session.user?.id;
      await resetToCleanSlate(uid);
    });
  }, [session.user?.id]);

  const setSession = async (s: Session, opts?: { platformToken?: string | null }) => {
    const previousUserId = session.user?.id;
    const sanitizedHaConnection = s.haConnection
      ? {
          id: s.haConnection.id,
          cloudEnabled: Boolean(s.haConnection.cloudEnabled),
          ownerId: s.haConnection.ownerId,
        }
      : null;
    const sanitizedSession: Session = { user: s.user, haConnection: sanitizedHaConnection };
    if (previousUserId && s.user?.id && previousUserId !== s.user.id) {
      await clearAllDeviceCacheForUser(previousUserId).catch(() => undefined);
      await clearPlatformToken().catch(() => undefined);
      await clearPlatformCookie().catch(() => undefined);
      clearHomeModeSecrets();
    }
    setSessionState(sanitizedSession);
    setHaModeState('home');
    await saveJson(SESSION_KEY, sanitizedSession);
    if (opts?.platformToken && typeof opts.platformToken === 'string' && opts.platformToken.trim().length > 0) {
      await setPlatformToken(opts.platformToken);
    }
  };

  const clearSession = async () => {
    const userId = session.user?.id;
    setSessionState({ user: null, haConnection: null });
    setHaModeState('home');
    await removeKey(SESSION_KEY);
    await clearPlatformToken().catch(() => undefined);
    await clearPlatformCookie().catch(() => undefined);
    clearHomeModeSecrets();
    if (userId) {
      await clearAllDeviceCacheForUser(userId).catch(() => undefined);
    }
  };

  return (
    <SessionContext.Provider
      value={{
        session,
        loading,
        setSession,
        clearSession,
        resetApp: async () => resetToCleanSlate(session.user?.id),
        haMode,
        setHaMode: setHaModeState,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
