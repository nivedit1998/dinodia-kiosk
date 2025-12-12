import { NativeModules } from 'react-native';

const { IdleTimerModule } = NativeModules as {
  IdleTimerModule?: { resetIdleTimer?: () => void };
};

export function resetIdleTimer() {
  try {
    IdleTimerModule?.resetIdleTimer?.();
  } catch {
    // Ignore errors; kiosk should keep working even if the module is unavailable
  }
}
