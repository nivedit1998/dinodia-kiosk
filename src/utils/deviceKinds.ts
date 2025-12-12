// Shared helpers to describe whether a device is primary vs sensor/detail.
import type { UIDevice } from '../models/device';

const PRIMARY_CATEGORIES = new Set([
  'light',
  'blind',
  'tv',
  'speaker',
  'boiler',
  'spotify',
  'switch',
  'thermostat',
  'media',
  'vacuum',
  'camera',
  'security',
]);

const SENSOR_CATEGORIES = new Set(['sensor', 'motion sensor']);

function normalizeCategory(category?: string | null) {
  return (category ?? '').toString().trim().toLowerCase();
}

export function isDetailDevice(state: string) {
  const trimmed = (state ?? '').toString().trim();
  if (!trimmed) return false;
  const isUnavailable = trimmed.toLowerCase() === 'unavailable';
  const isNumeric = !Number.isNaN(Number(trimmed));
  return isUnavailable || isNumeric;
}

export function isSensorDevice(device: UIDevice): boolean {
  const category = normalizeCategory(device.labelCategory);
  if (SENSOR_CATEGORIES.has(category)) return true;
  if (isDetailDevice(device.state)) return true;
  return false;
}

export function isPrimaryDevice(device: UIDevice): boolean {
  const category = normalizeCategory(device.labelCategory);
  if (PRIMARY_CATEGORIES.has(category)) return true;
  if (isSensorDevice(device)) return false;
  return !isDetailDevice(device.state);
}
