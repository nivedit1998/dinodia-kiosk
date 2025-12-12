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
  const [pending, setPending] = useState(false);
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

  async function onPrimaryPress() {
    if (!primaryAction) return;
    if (!ha) {
      Alert.alert(
        'Almost there',
        haMode === 'cloud'
          ? 'Dinodia Cloud is not ready yet. The homeowner needs to finish setting up remote access for this property.'
          : 'We cannot find your Dinodia Hub on the home Wi-Fi. It looks like you are away from home—switch to Dinodia Cloud to control your place.'
      );
      return;
    }
    if (pending) return;
    setPending(true);
    try {
      await handleDeviceCommand({
        ha,
        entityId: device.entityId,
        command: primaryAction.command,
        value: primaryAction.value,
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
      setPending(false);
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
        {
          backgroundColor: active ? preset.gradient[0] : preset.inactiveBackground,
          borderColor: active ? 'rgba(0,0,0,0.08)' : '#e5e7eb',
          opacity: active ? 1 : 0.9,
        },
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
        {primaryAction && (
          <TouchableOpacity
            onPress={onPrimaryPress}
            activeOpacity={0.85}
            disabled={pending}
            style={[
              styles.primaryActionButton,
              { backgroundColor: active ? preset.iconActiveBackground : '#111827' },
              pending && styles.primaryActionButtonDisabled,
            ]}
          >
            {pending ? (
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
    return state || 'Idle';
  }
  if (label === 'Motion Sensor') {
    const active = ['on', 'motion', 'detected', 'open'].includes(state.toLowerCase());
    return active ? 'Motion detected' : 'No motion';
  }
  return state || 'Unknown';
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
