// src/utils/deviceIdentity.ts
import { Platform } from 'react-native';
import { loadJson, saveJson } from './storage';

type DeviceIdentity = {
  deviceId: string;
  deviceLabel: string;
};

const DEVICE_ID_KEY = 'dinodia_device_id';
const DEVICE_LABEL_KEY = 'dinodia_device_label';

function generateDeviceId(): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `kiosk_${stamp}_${rand}`;
}

function defaultDeviceLabel(): string {
  const platform = Platform.OS === 'android' ? 'Android' : 'iOS';
  const version =
    Platform.Version === undefined || Platform.Version === null
      ? ''
      : ` ${String(Platform.Version)}`;
  return `Dinodia Kiosk (${platform}${version})`;
}

export async function getDeviceIdentity(): Promise<DeviceIdentity> {
  let storedId: string | null = null;
  let storedLabel: string | null = null;
  try {
    storedId = await loadJson<string>(DEVICE_ID_KEY);
    storedLabel = await loadJson<string>(DEVICE_LABEL_KEY);
  } catch {
    storedId = null;
    storedLabel = null;
  }

  const deviceId =
    typeof storedId === 'string' && storedId.trim().length > 0
      ? storedId
      : generateDeviceId();
  const deviceLabel =
    typeof storedLabel === 'string' && storedLabel.trim().length > 0
      ? storedLabel
      : defaultDeviceLabel();

  if (!storedId) {
    try {
      await saveJson(DEVICE_ID_KEY, deviceId);
    } catch {
      // ignore storage write errors
    }
  }
  if (!storedLabel) {
    try {
      await saveJson(DEVICE_LABEL_KEY, deviceLabel);
    } catch {
      // ignore storage write errors
    }
  }

  return { deviceId, deviceLabel };
}
