// Shared helpers for reading device attributes in a consistent way
import type { UIDevice } from '../models/device';

export type AttributeMap = Record<string, unknown>;

export function getBrightnessPct(attrs: AttributeMap): number | null {
  if (typeof attrs.brightness_pct === 'number') return Math.round(attrs.brightness_pct);
  if (typeof attrs.brightness === 'number') return Math.round((attrs.brightness / 255) * 100);
  return null;
}

export function getVolumePct(attrs: AttributeMap): number | null {
  if (typeof attrs.volume_level === 'number') return Math.round(attrs.volume_level * 100);
  return null;
}

export function getBlindPosition(attrs: AttributeMap): number | null {
  const candidates = ['blind_position', 'position', 'current_position', 'position_percent'];
  for (const key of candidates) {
    const raw = attrs[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return Math.round(raw);
    }
    if (typeof raw === 'string') {
      const n = Number(raw);
      if (!Number.isNaN(n)) {
        return Math.round(n);
      }
    }
  }
  return null;
}

export function getTargetTemperature(attrs: AttributeMap): number | null {
  const candidates = ['temperature', 'target_temp'];
  for (const key of candidates) {
    const raw = attrs[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw;
    }
  }
  return null;
}

export function getCurrentTemperature(attrs: AttributeMap): number | null {
  const candidates = ['current_temperature', 'temperature', 'temp'];
  for (const key of candidates) {
    const raw = attrs[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw;
    }
  }
  return null;
}

export function isDeviceStateOn(device: UIDevice): boolean {
  const state = (device.state ?? '').toString().toLowerCase();
  return state === 'on' || state === 'playing' || state === 'open' || state === 'opening';
}
