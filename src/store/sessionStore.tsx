// src/store/sessionStore.ts
import React, { createContext, useContext, useEffect, useState } from 'react';
import type { AuthUser } from '../api/auth';
import type { HaConnection } from '../models/haConnection';
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
  setSession: (s: Session) => Promise<void>;
  clearSession: () => Promise<void>;
  haMode: HaMode;
  setHaMode: (mode: HaMode) => void;
};

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

const SESSION_KEY = 'dinodia_session';

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<Session>({
    user: null,
    haConnection: null,
  });
  const [loading, setLoading] = useState(true);
  const [haMode, setHaModeState] = useState<HaMode>('home');

  useEffect(() => {
    void (async () => {
      const stored = await loadJson<Session>(SESSION_KEY);
      if (stored) {
        setSessionState(stored);
      }
      // Always start new app sessions in home mode.
      setHaModeState('home');
      setLoading(false);
    })();
  }, []);

  const setSession = async (s: Session) => {
    const previousUserId = session.user?.id;
    if (previousUserId && s.user?.id && previousUserId !== s.user.id) {
      await clearAllDeviceCacheForUser(previousUserId).catch(() => undefined);
    }
    setSessionState(s);
    setHaModeState('home');
    await saveJson(SESSION_KEY, s);
  };

  const clearSession = async () => {
    const userId = session.user?.id;
    setSessionState({ user: null, haConnection: null });
    setHaModeState('home');
    await removeKey(SESSION_KEY);
    if (userId) {
      await clearAllDeviceCacheForUser(userId).catch(() => undefined);
    }
  };

  return (
    <SessionContext.Provider
      value={{ session, loading, setSession, clearSession, haMode, setHaMode: setHaModeState }}
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
