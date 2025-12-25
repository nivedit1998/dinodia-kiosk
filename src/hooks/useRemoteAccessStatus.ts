// src/hooks/useRemoteAccessStatus.ts
import { useEffect, useState } from 'react';
import type { HaMode } from '../api/dinodia';
import { checkRemoteAccessEnabled } from '../api/remoteAccess';

export type RemoteAccessStatus = 'checking' | 'enabled' | 'locked';

const LOCKED_MESSAGE = 'Page unlocked when remote access is enabled by homeowner.';

export function useRemoteAccessStatus(mode: HaMode) {
  const [status, setStatus] = useState<RemoteAccessStatus>('enabled');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (mode !== 'cloud') {
      setStatus('enabled');
      setMessage(null);
      return;
    }

    setStatus('checking');
    setMessage(null);

    checkRemoteAccessEnabled()
      .then((enabled) => {
        if (!active) return;
        if (enabled) {
          setStatus('enabled');
          setMessage(null);
        } else {
          setStatus('locked');
          setMessage(LOCKED_MESSAGE);
        }
      })
      .catch(() => {
        if (!active) return;
        setStatus('locked');
        setMessage(LOCKED_MESSAGE);
      });

    return () => {
      active = false;
    };
  }, [mode]);

  return { status, message };
}
