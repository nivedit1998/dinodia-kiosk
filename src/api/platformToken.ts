// src/api/platformToken.ts
import * as Keychain from 'react-native-keychain';
import { loadJson, removeKey } from '../utils/storage';

const SERVICE = 'dinodia_platform_bearer_v1';
const LEGACY_KEY = 'dinodia_platform_bearer_v1';

export async function getPlatformToken(): Promise<string | null> {
  const creds = await Keychain.getGenericPassword({ service: SERVICE });
  if (creds && creds.password) return creds.password;

  // One-time migration from legacy AsyncStorage key if present.
  try {
    const legacy = await loadJson<string>(LEGACY_KEY);
    if (legacy && legacy.trim().length > 0) {
      await Keychain.setGenericPassword('token', legacy, {
        service: SERVICE,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      await removeKey(LEGACY_KEY);
      return legacy;
    }
  } catch {
    // swallow migration errors; return null below
  }

  return null;
}

export async function setPlatformToken(token: string): Promise<void> {
  if (!token) {
    await clearPlatformToken();
    return;
  }
  await Keychain.setGenericPassword('token', token, {
    service: SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearPlatformToken(): Promise<void> {
  await Keychain.resetGenericPassword({ service: SERVICE });
}
