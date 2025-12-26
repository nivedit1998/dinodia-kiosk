import { useCallback, useState } from 'react';
import { checkRemoteAccessEnabled } from '../api/remoteAccess';

type ResultState = 'idle' | 'checking' | 'success' | 'error';

type Options = {
  isCloud: boolean;
  onSwitchToCloud: () => void | Promise<void>;
  onSwitchToHome?: () => void | Promise<void>;
};

export function useCloudModeSwitch({ isCloud, onSwitchToCloud, onSwitchToHome }: Options) {
  const [promptVisible, setPromptVisible] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ResultState>('idle');

  const openPrompt = useCallback(() => {
    if (isCloud) {
      if (onSwitchToHome) {
        void onSwitchToHome();
      }
      return;
    }
    setResult('idle');
    setPromptVisible(true);
  }, [isCloud, onSwitchToHome]);

  const cancelPrompt = useCallback(() => {
    if (checking) return;
    setPromptVisible(false);
  }, [checking]);

  const confirmPrompt = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    setResult('checking');
    let ok = false;
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
  }, [checking, onSwitchToCloud]);

  return {
    promptVisible,
    checking,
    result,
    openPrompt,
    cancelPrompt,
    confirmPrompt,
  };
}
