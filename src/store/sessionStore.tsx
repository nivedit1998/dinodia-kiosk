// src/store/sessionStore.ts
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import CookieManager from '@react-native-cookies/cookies';
import type { AuthUser } from '../api/auth';
import type { HaConnection } from '../models/haConnection';
import { logoutRemote } from '../api/auth';
import { clearPlatformCookie } from '../api/platformFetch';
import { clearPlatformToken, getPlatformToken, setPlatformToken } from '../api/platformToken';
import { supabase } from '../api/supabaseClient';
import { clearTokens } from '../spotify/spotifyApi';
import { loadJson, saveJson, removeKey } from '../utils/storage';
import { clearAllDeviceCacheForUser } from './deviceStore';

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
      await removeKey(SESSION_KEY).catch(() => undefined);
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

    const { data, error } = await supabase
      .from('User')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      return;
    }

    if (!data) {
      await resetToCleanSlate(userId);
    }
  };

  useEffect(() => {
    void verifyUserStillExists();
  }, [loading, session.user?.id]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void verifyUserStillExists();
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

  const setSession = async (s: Session, opts?: { platformToken?: string | null }) => {
    const previousUserId = session.user?.id;
    if (previousUserId && s.user?.id && previousUserId !== s.user.id) {
      await clearAllDeviceCacheForUser(previousUserId).catch(() => undefined);
      await clearPlatformToken().catch(() => undefined);
      await clearPlatformCookie().catch(() => undefined);
    }
    setSessionState(s);
    setHaModeState('home');
    await saveJson(SESSION_KEY, s);
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
