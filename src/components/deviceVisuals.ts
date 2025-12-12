// src/components/deviceVisuals.ts
import type { UIDevice } from '../models/device';

export type DeviceVisualPreset = {
  gradient: string[];
  inactiveBackground: string;
  icon: string;
  iconActiveBackground: string;
  iconInactiveBackground: string;
  accent: string[];
};

const DEFAULT_PRESET: DeviceVisualPreset = {
  gradient: ['#f2f2f7', '#e5e7eb'],
  inactiveBackground: '#f7f7fa',
  icon: '•',
  iconActiveBackground: '#d1d5db',
  iconInactiveBackground: '#e5e7eb',
  accent: ['#e5e7eb', '#f3f4f6'],
};

const PRESETS: Record<string, DeviceVisualPreset> = {
  Light: {
    gradient: ['#fef3c7', '#fcd34d'],
    inactiveBackground: '#fdf6e3',
    icon: '💡',
    iconActiveBackground: '#f59e0b',
    iconInactiveBackground: '#fcd34d',
    accent: ['#f59e0b', '#fcd34d'],
  },
  Blind: {
    gradient: ['#cffafe', '#22d3ee'],
    inactiveBackground: '#ecfeff',
    icon: '🪟',
    iconActiveBackground: '#06b6d4',
    iconInactiveBackground: '#bae6fd',
    accent: ['#06b6d4', '#22d3ee'],
  },
  'Motion Sensor': {
    gradient: ['#d1fae5', '#6ee7b7'],
    inactiveBackground: '#ecfdf3',
    icon: '🛰️',
    iconActiveBackground: '#10b981',
    iconInactiveBackground: '#bbf7d0',
    accent: ['#10b981', '#34d399'],
  },
  Spotify: {
    gradient: ['#d1fae5', '#34d399'],
    inactiveBackground: '#e8fff3',
    icon: '🎵',
    iconActiveBackground: '#10b981',
    iconInactiveBackground: '#bbf7d0',
    accent: ['#10b981', '#34d399'],
  },
  Boiler: {
    gradient: ['#ffedd5', '#fb923c'],
    inactiveBackground: '#fff4e5',
    icon: '🔥',
    iconActiveBackground: '#f97316',
    iconInactiveBackground: '#fed7aa',
    accent: ['#fb923c', '#fdba74'],
  },
  Doorbell: {
    gradient: ['#ffedd5', '#fbbf24'],
    inactiveBackground: '#fff8e1',
    icon: '🔔',
    iconActiveBackground: '#f59e0b',
    iconInactiveBackground: '#fde68a',
    accent: ['#f59e0b', '#fbbf24'],
  },
  'Home Security': {
    gradient: ['#e0e7ff', '#818cf8'],
    inactiveBackground: '#eef2ff',
    icon: '🛡️',
    iconActiveBackground: '#6366f1',
    iconInactiveBackground: '#c7d2fe',
    accent: ['#6366f1', '#818cf8'],
  },
  TV: {
    gradient: ['#e0e7ff', '#6366f1'],
    inactiveBackground: '#eef2ff',
    icon: '📺',
    iconActiveBackground: '#4f46e5',
    iconInactiveBackground: '#c7d2fe',
    accent: ['#4f46e5', '#818cf8'],
  },
  Speaker: {
    gradient: ['#ede9fe', '#a78bfa'],
    inactiveBackground: '#f5f3ff',
    icon: '🔊',
    iconActiveBackground: '#8b5cf6',
    iconInactiveBackground: '#ddd6fe',
    accent: ['#8b5cf6', '#a78bfa'],
  },
};

export function getDevicePreset(label?: string | null): DeviceVisualPreset {
  if (!label) return DEFAULT_PRESET;
  return PRESETS[label] ?? DEFAULT_PRESET;
}

export function isDeviceActive(label: string | null | undefined, device: UIDevice): boolean {
  const state = (device.state ?? '').toString().toLowerCase();
  const activeForMotion = ['on', 'motion', 'detected', 'open'];
  switch (label) {
    case 'Light':
    case 'Spotify':
    case 'TV':
    case 'Speaker':
      return state === 'on' || state === 'playing';
    case 'Blind':
      return state === 'open' || state === 'opening';
    case 'Home Security':
    case 'Doorbell':
    case 'Boiler':
      return true;
    case 'Motion Sensor':
      return activeForMotion.includes(state);
    default:
      return state === 'on' || state === 'playing';
  }
}
