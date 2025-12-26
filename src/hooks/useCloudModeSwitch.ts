import { useCallback, useState } from 'react';
import { checkHomeModeReachable, checkRemoteAccessEnabled } from '../api/remoteAccess';
import type { HaConnection } from '../models/haConnection';

type ResultState = 'idle' | 'checking' | 'success' | 'error';

type Options = {
  isCloud: boolean;
  onSwitchToCloud: () => void | Promise<void>;
  onSwitchToHome?: () => void | Promise<void>;
  haConnection?: HaConnection | null;
};

export function useCloudModeSwitch({ isCloud, onSwitchToCloud, onSwitchToHome, haConnection }: Options) {
  const [promptVisible, setPromptVisible] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ResultState>('idle');
  const [targetMode, setTargetMode] = useState<'cloud' | 'home'>(isCloud ? 'home' : 'cloud');

  const openPrompt = useCallback(() => {
    setResult('idle');
    setTargetMode(isCloud ? 'home' : 'cloud');
    setPromptVisible(true);
  }, [isCloud]);

  const cancelPrompt = useCallback(() => {
    if (checking) return;
    setPromptVisible(false);
  }, [checking]);

  const confirmPrompt = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    setResult('checking');
    let ok = false;
    if (targetMode === 'cloud') {
      try {
        ok = await checkRemoteAccessEnabled();
      } catch {
        // ignore, fallback to cloud locked screen
      }
      setChecking(false);
      if (ok) {
        setResult('success');
        setTimeout(() => {
          setPromptVisible(false);
          void onSwitchToCloud();
        }, 700);
      } else {
        setResult('error');
        setTimeout(() => {
          setPromptVisible(false);
          setResult('idle');
        }, 900);
      }
    } else {
      try {
        ok = haConnection ? await checkHomeModeReachable(haConnection) : false;
      } catch {
        ok = false;
      }
      setChecking(false);
      if (ok) {
        setResult('success');
        setTimeout(() => {
          setPromptVisible(false);
          onSwitchToHome && onSwitchToHome();
        }, 700);
      } else {
        setResult('error');
        setTimeout(() => {
          setPromptVisible(false);
          setResult('idle');
        }, 900);
      }
    }
  }, [checking, haConnection, onSwitchToCloud, onSwitchToHome, targetMode]);

  return {
    promptVisible,
    checking,
    result,
    targetMode,
    openPrompt,
    cancelPrompt,
    confirmPrompt,
  };
}
