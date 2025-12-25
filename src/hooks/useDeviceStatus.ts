// src/hooks/useDeviceStatus.ts
import { useEffect, useState } from 'react';
import { AppState, NativeModules } from 'react-native';

type DeviceStatusModule = {
  getWifiName?: () => Promise<string | null>;
  getBatteryLevel?: () => Promise<number | null>;
};

const DEVICE_STATUS = NativeModules.DeviceStatus as DeviceStatusModule | undefined;

export function useDeviceStatus() {
  const [wifiName, setWifiName] = useState<string | null>(null);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);

  const loadStatus = async () => {
    if (!DEVICE_STATUS) return;
    try {
      const [wifi, battery] = await Promise.all([
        DEVICE_STATUS.getWifiName ? DEVICE_STATUS.getWifiName() : Promise.resolve(null),
        DEVICE_STATUS.getBatteryLevel ? DEVICE_STATUS.getBatteryLevel() : Promise.resolve(null),
      ]);
      setWifiName(typeof wifi === 'string' ? wifi : null);
      setBatteryLevel(typeof battery === 'number' ? battery : null);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void loadStatus();
    const interval = setInterval(() => {
      void loadStatus();
    }, 30000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void loadStatus();
      }
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, []);

  return { wifiName, batteryLevel };
}
