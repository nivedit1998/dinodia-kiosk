// src/components/DeviceCard.tsx
import React, { memo, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import type { UIDevice } from '../models/device';
import { getPrimaryLabel } from '../utils/deviceLabels';
import { handleDeviceCommand } from '../utils/haCommands';
import { useSession } from '../store/sessionStore';
import { getDevicePreset, isDeviceActive } from './deviceVisuals';

export type DeviceCardSize = 'small' | 'medium' | 'large';

type Props = {
  device: UIDevice;
  isAdmin: boolean;
  size?: DeviceCardSize;
  onAfterCommand?: () => Promise<void> | void;
  onOpenDetails?: (device: UIDevice) => void;
};

export const DeviceCard = memo(function DeviceCard({
  device,
  size = 'small',
  onAfterCommand,
  onOpenDetails,
}: Props) {
  const label = getPrimaryLabel(device);
  const { session, haMode } = useSession();
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const connection = session.haConnection;
  const baseUrlRaw = haMode === 'cloud' ? connection?.cloudUrl ?? '' : connection?.baseUrl ?? '';
  const baseUrl = baseUrlRaw.trim().replace(/\/+$/, '');
  const ha =
    baseUrl && connection
      ? {
          baseUrl,
          longLivedToken: connection.longLivedToken,
        }
      : null;

  const primaryAction = getPrimaryAction(label, device);
  const preset = useMemo(() => getDevicePreset(label), [label]);
  const active = useMemo(() => isDeviceActive(label, device), [label, device]);
  const secondaryText = useMemo(() => getSecondaryLine(device), [device]);
  const attrs = device.attributes ?? {};
  const blindPosition =
    label === 'Blind' ? getBlindPosition(attrs as Record<string, unknown>) : null;
  const hasPending = pendingCommand !== null;
  const openPending = pendingCommand === 'blind/open';
  const closePending = pendingCommand === 'blind/close';

  const sizeStyles =
    size === 'small'
      ? { padding: 10, borderRadius: 16, minHeight: 80 }
      : size === 'medium'
      ? { padding: 14, borderRadius: 20, minHeight: 110 }
      : { padding: 18, borderRadius: 24, minHeight: 140 };

  const nameStyle =
    size === 'small'
      ? { fontSize: 13 }
      : size === 'medium'
      ? { fontSize: 14 }
      : { fontSize: 16 };

  const secondaryStyle =
    size === 'small'
      ? { fontSize: 11 }
      : size === 'medium'
      ? { fontSize: 12 }
      : { fontSize: 13 };

  async function sendCommand(command: string, value?: number) {
    if (!ha) {
      Alert.alert(
        'Almost there',
        haMode === 'cloud'
          ? 'Dinodia Cloud is not ready yet. The homeowner needs to finish setting up remote access for this property.'
          : 'We cannot find your Dinodia Hub on the home Wi-Fi. It looks like you are away from home—switch to Dinodia Cloud to control your place.'
      );
      return;
    }
    if (pendingCommand) return;
    setPendingCommand(command);
    try {
      await handleDeviceCommand({
        ha,
        entityId: device.entityId,
        command,
        value,
      });
      if (onAfterCommand) await Promise.resolve(onAfterCommand());
    } catch (err) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('device command error', err);
      }
      Alert.alert(
        'We could not complete that',
        err instanceof Error && err.message
          ? err.message
          : 'We could not send that to your Dinodia Hub. Please try again.'
      );
    } finally {
      setPendingCommand(null);
    }
  }

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={() => {
        onOpenDetails && onOpenDetails(device);
      }}
      style={[
        styles.card,
        sizeStyles,
        (() => {
          const baseBg = active ? preset.gradient[0] : preset.inactiveBackground;
          const bg =
            label === 'Blind' && blindPosition !== null
              ? mixColors(preset.inactiveBackground, preset.accent[0], blindPosition / 100)
              : baseBg;
          return {
            backgroundColor: bg,
            borderColor: active ? 'rgba(0,0,0,0.08)' : '#e5e7eb',
            opacity: label === 'Blind' && blindPosition !== null ? 1 : active ? 1 : 0.9,
          };
        })(),
      ]}
    >
      <View style={styles.topRow}>
        <Text style={[styles.label, { color: active ? '#0f172a' : '#9ca3af' }]}>{label}</Text>
      </View>
      <View style={styles.body}>
        <Text style={[styles.name, nameStyle, { color: active ? '#0f172a' : '#94a3b8' }]}>
          {device.name}
        </Text>
        <Text
          style={[styles.secondary, secondaryStyle, { color: active ? '#475569' : '#9ca3af' }]}
          numberOfLines={1}
        >
          {secondaryText}
        </Text>
        {label === 'Blind' ? (
          <View style={styles.blindActionsRow}>
            <TouchableOpacity
              onPress={() => sendCommand('blind/open')}
              activeOpacity={0.85}
              disabled={hasPending || blindPosition === 100}
              style={[
                styles.secondaryActionButton,
                {
                  backgroundColor: active ? preset.iconActiveBackground : '#111827',
                  opacity:
                    blindPosition === 100 ? 0.35 : openPending ? 0.6 : 1,
                },
              ]}
            >
              {openPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.primaryActionText}>Open</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => sendCommand('blind/close')}
              activeOpacity={0.85}
              disabled={hasPending || blindPosition === 0}
              style={[
                styles.secondaryActionButton,
                {
                  backgroundColor: active ? preset.iconActiveBackground : '#111827',
                  opacity:
                    blindPosition === 0 ? 0.35 : closePending ? 0.6 : 1,
                },
              ]}
            >
              {closePending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.primaryActionText}>Close</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          primaryAction && (
            <TouchableOpacity
              onPress={() => sendCommand(primaryAction.command, primaryAction.value)}
              activeOpacity={0.85}
              disabled={hasPending}
              style={[
                styles.primaryActionButton,
                { backgroundColor: active ? preset.iconActiveBackground : '#111827' },
                hasPending && styles.primaryActionButtonDisabled,
              ]}
            >
              {hasPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <View style={styles.primaryActionContent}>
                  <Text style={styles.primaryActionIcon}>{preset.icon}</Text>
                  <Text style={styles.primaryActionText}>
                    {primaryActionLabel(label, device)}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          )
        )}
      </View>
    </TouchableOpacity>
  );
});

type PrimaryAction = { command: string; value?: number } | null;

function getPrimaryAction(label: string, device: UIDevice): PrimaryAction {
  switch (label) {
    case 'Light':
      return { command: 'light/toggle' };
    case 'Blind': {
      const normalized = device.state.toLowerCase();
      const isOpen = normalized === 'open' || normalized === 'opening' || normalized === 'on';
      return { command: isOpen ? 'blind/close' : 'blind/open' };
    }
    case 'Spotify':
      return { command: 'media/play_pause' };
    case 'TV':
      return { command: 'tv/toggle_power' };
    case 'Speaker':
      return { command: 'speaker/toggle_power' };
    default:
      return null;
  }
}

function primaryActionLabel(label: string, device: UIDevice): string {
  switch (label) {
    case 'Light':
      return 'Toggle light';
    case 'Blind': {
      const state = (device.state ?? '').toString().toLowerCase();
      const isOpen = state === 'open' || state === 'opening' || state === 'on';
      return isOpen ? 'Close blinds' : 'Open blinds';
    }
    case 'Spotify': {
      const state = (device.state ?? '').toString().toLowerCase();
      const isPlaying = state === 'playing';
      return isPlaying ? 'Pause' : 'Play';
    }
    case 'TV': {
      const state = (device.state ?? '').toString().toLowerCase();
      const isOn = state === 'on';
      return isOn ? 'Turn off TV' : 'Turn on TV';
    }
    case 'Speaker': {
      const state = (device.state ?? '').toString().toLowerCase();
      const isOn = state === 'on' || state === 'playing';
      return isOn ? 'Turn off speaker' : 'Turn on speaker';
    }
    default:
      return 'Action';
  }
}

function getSecondaryLine(device: UIDevice): string {
  const state = (device.state ?? '').toString();
  const attrs = device.attributes ?? {};
  const label = getPrimaryLabel(device);
  if (label === 'Light') {
    const pct =
      typeof attrs.brightness_pct === 'number'
        ? Math.round(attrs.brightness_pct)
        : typeof attrs.brightness === 'number'
        ? Math.round((attrs.brightness / 255) * 100)
        : null;
    if (pct !== null) return `${pct}% brightness`;
    return state === 'on' ? 'On' : 'Off';
  }
  if (label === 'Spotify' || label === 'TV' || label === 'Speaker') {
    if (typeof attrs.media_title === 'string') {
      return attrs.media_title;
    }
    return state === 'playing' ? 'Playing' : state === 'paused' ? 'Paused' : state;
  }
  if (label === 'Boiler') {
    const target = attrs.temperature ?? attrs.target_temp;
    const current = attrs.current_temperature;
    if (typeof target === 'number' && typeof current === 'number') {
      return `Target ${target}° • Now ${current}°`;
    }
    if (typeof target === 'number') return `Target ${target}°`;
  }
  if (label === 'Blind') {
    const pos = getBlindPosition(attrs);
    if (pos !== null) return `Position ${pos}%`;
    const s = state.toLowerCase();
    if (s === 'stop' || s === 'stopped') return 'Idle';
    return state || 'Idle';
  }
  if (label === 'Motion Sensor') {
    const active = ['on', 'motion', 'detected', 'open'].includes(state.toLowerCase());
    return active ? 'Motion detected' : 'No motion';
  }
  return state || 'Unknown';
}

function getBlindPosition(attrs: Record<string, unknown>): number | null {
  const candidates = ['blind_position', 'position', 'current_position', 'position_percent'];
  for (const key of candidates) {
    const raw = (attrs as Record<string, unknown>)[key];
    if (typeof raw === 'number') {
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

function mixColors(from: string, to: string, t: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  if (!a || !b) return from;
  const ratio = Math.min(1, Math.max(0, t));
  const r = Math.round(a.r + (b.r - a.r) * ratio);
  const g = Math.round(a.g + (b.g - a.g) * ratio);
  const bb = Math.round(a.b + (b.b - a.b) * ratio);
  return rgbToHex(r, g, bb);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = hex.replace('#', '');
  if (cleaned.length === 3) {
    const r = parseInt(cleaned[0] + cleaned[0], 16);
    const g = parseInt(cleaned[1] + cleaned[1], 16);
    const b = parseInt(cleaned[2] + cleaned[2], 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return { r, g, b };
  }
  if (cleaned.length === 6) {
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return { r, g, b };
  }
  return null;
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (value: number) => {
    const clamped = Math.min(255, Math.max(0, value));
    return clamped.toString(16).padStart(2, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 11,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    fontWeight: '700',
    color: '#111827',
  },
  icon: { fontSize: 18, color: '#fff' },
  body: { marginTop: 8 },
  name: { fontSize: 14, fontWeight: '600', color: '#111827' },
  secondary: { fontSize: 11, color: '#4b5563', marginTop: 4 },
  primaryActionButton: {
    marginTop: 10,
    width: '100%',
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  primaryActionButtonDisabled: {
    opacity: 0.6,
  },
  blindActionsRow: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    columnGap: 8,
  },
  secondaryActionButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  primaryActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  primaryActionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionIcon: {
    fontSize: 16,
    marginRight: 6,
  },
});
