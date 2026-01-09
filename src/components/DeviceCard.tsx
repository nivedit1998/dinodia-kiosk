// src/components/DeviceCard.tsx
import React, { memo, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import type { UIDevice } from '../models/device';
import { getPrimaryLabel } from '../utils/deviceLabels';
import {
  getActionsForDevice,
  pickPrimaryAction,
  resolveToggleCommandForDevice,
  type DeviceActionSpec,
} from '../capabilities/deviceCapabilities';
import { getBlindPosition, getBrightnessPct, getVolumePct } from '../capabilities/attributeReaders';
import { useSession } from '../store/sessionStore';
import { getDevicePreset, isDeviceActive } from './deviceVisuals';
import { executeDeviceCommand } from '../devices/deviceExecutor';
import { palette, radii, shadows, spacing } from '../ui/theme';

export type DeviceCardSize = 'small' | 'medium' | 'large';

type Props = {
  device: UIDevice;
  isAdmin: boolean;
  size?: DeviceCardSize;
  onAfterCommand?: () => Promise<void> | void;
  onOpenDetails?: (device: UIDevice) => void;
  batteryPercent?: number | null;
  showControls?: boolean;
  kwhTotal?: number | null;
  energyCost?: number | null;
};

export const DeviceCard = memo(function DeviceCard({
  device,
  isAdmin,
  size = 'small',
  onAfterCommand,
  onOpenDetails,
  batteryPercent = null,
  showControls = true,
  kwhTotal = null,
  energyCost = null,
}: Props) {
  const label = getPrimaryLabel(device);
  const { session, haMode } = useSession();
  const allowControl = session.user?.role === 'TENANT';
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);

  const actions = useMemo(() => getActionsForDevice(device, 'dashboard'), [device]);
  const primaryAction = useMemo(() => pickPrimaryAction(device, 'dashboard'), [device]);
  const preset = useMemo(() => getDevicePreset(label), [label]);
  const active = useMemo(() => isDeviceActive(label, device), [label, device]);
  const secondaryText = useMemo(() => getSecondaryLine(device), [device]);
  const batteryDisplay = useMemo(() => formatBatteryForTile(batteryPercent), [batteryPercent]);
  const attrs = device.attributes ?? {};
  const blindPosition = label === 'Blind' ? getBlindPosition(attrs as Record<string, unknown>) : null;
  const hasPending = pendingCommand !== null;
  const openPending = pendingCommand === 'blind/open';
  const closePending = pendingCommand === 'blind/close';
  const CONTROL_HEIGHT = 44;

  const sizeStyles =
    size === 'small'
      ? { padding: spacing.md, borderRadius: radii.lg }
      : size === 'medium'
      ? { padding: spacing.lg, borderRadius: radii.xl }
      : { padding: spacing.xl, borderRadius: radii.xl };

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

  async function sendAction(action: DeviceActionSpec, overrideValue?: number) {
    if (!allowControl) {
      Alert.alert('View only', 'Device control is available to tenants only.');
      return;
    }
    if (pendingCommand) return;
    const resolved = resolveActionCommand(action, device, overrideValue);
    if (!resolved) return;
    const { command, value } = resolved;
    setPendingCommand(command);
    try {
      await executeDeviceCommand({
        haMode,
        connection: session.haConnection,
        device,
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
          : haMode === 'cloud'
          ? 'Dinodia Cloud could not send that command. Please try again.'
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
            borderColor: active ? 'rgba(0,0,0,0.04)' : palette.outline,
            opacity: label === 'Blind' && blindPosition !== null ? 1 : active ? 1 : 0.9,
          };
        })(),
      ]}
    >
      <View style={styles.body}>
        <View style={styles.topLineSpacer} />
        {batteryDisplay && (
          <Text
            style={[styles.batteryTopOverlay, { color: batteryDisplay.fg }]}
            numberOfLines={1}
            ellipsizeMode="clip"
          >
            {batteryDisplay.text}
          </Text>
        )}
        <View style={styles.content}>
          <View style={styles.headerRow}>
            <Text
              style={[styles.name, nameStyle, { color: active ? '#0f172a' : '#94a3b8' }]}
              numberOfLines={2}
              ellipsizeMode="tail"
              minimumFontScale={0.9}
              adjustsFontSizeToFit
            >
              {device.name}
            </Text>
          </View>
          <Text
            style={[styles.secondary, secondaryStyle, { color: active ? '#475569' : '#9ca3af' }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {secondaryText}
          </Text>
          {kwhTotal !== null && Number.isFinite(kwhTotal) && isAdmin && (
            <View style={styles.energyBlock}>
              <Text style={styles.energyLabel}>Energy Usage:</Text>
              <Text style={styles.energyValue}>{kwhTotal.toFixed(2)} kWh</Text>
              {energyCost !== null && Number.isFinite(energyCost) && (
                <>
                  <Text style={styles.energyLabel}>Cost:</Text>
                  <Text style={styles.energyValue}>£{energyCost.toFixed(2)}</Text>
                </>
              )}
            </View>
          )}
        </View>

        {showControls && (
          <View style={styles.footer}>
            {label === 'Blind' ? (
              <View style={styles.blindActionsRow}>
                {getBlindActions(actions).map((action) => {
                  const isOpen = action.command === 'blind/open';
                  const disabled =
                    hasPending ||
                    !allowControl ||
                    (isOpen ? blindPosition === 100 : blindPosition === 0);
                  const isPending = pendingCommand === action.command;
                  return (
                    <TouchableOpacity
                      key={action.id}
                      onPress={() => sendAction(action)}
                      activeOpacity={0.85}
                      disabled={disabled}
                      style={[
                        styles.secondaryActionButton,
                        {
                          backgroundColor: active ? preset.iconActiveBackground : '#0f172a',
                          opacity: disabled ? 0.35 : isPending ? 0.6 : 1,
                          height: CONTROL_HEIGHT,
                        },
                      ]}
                    >
                      {isPending ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.primaryActionText}>{action.label}</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : label === 'Boiler' ? (
              <View style={styles.boilerControlsRow}>
                <TouchableOpacity
                  onPress={() => {
                    const down = actions.find(
                      (a) => (a.kind === 'button' || a.kind === 'fixed') && a.command === 'boiler/temp_down'
                    );
                    if (down) sendAction(down);
                  }}
                  activeOpacity={0.85}
                  disabled={hasPending || !allowControl}
                  style={[
                    styles.boilerButton,
                    { backgroundColor: active ? preset.iconActiveBackground : '#0f172a', height: CONTROL_HEIGHT },
                    hasPending && styles.primaryActionButtonDisabled,
                  ]}
                >
                  {pendingCommand === 'boiler/temp_down' ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.primaryActionText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                      - Temp
                    </Text>
                  )}
                </TouchableOpacity>

                <View style={[styles.boilerTarget, { height: CONTROL_HEIGHT }]}>
                  <Text style={styles.boilerTargetValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                    {typeof attrs.temperature === 'number'
                      ? `${Math.round(attrs.temperature)}°`
                      : typeof (attrs as any).target_temp === 'number'
                      ? `${Math.round((attrs as any).target_temp)}°`
                      : '—'}
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={() => {
                    const up = actions.find(
                      (a) => (a.kind === 'button' || a.kind === 'fixed') && a.command === 'boiler/temp_up'
                    );
                    if (up) sendAction(up);
                  }}
                  activeOpacity={0.85}
                  disabled={hasPending || !allowControl}
                  style={[
                    styles.boilerButton,
                    { backgroundColor: active ? preset.iconActiveBackground : '#0f172a', height: CONTROL_HEIGHT },
                    hasPending && styles.primaryActionButtonDisabled,
                  ]}
                >
                  {pendingCommand === 'boiler/temp_up' ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.primaryActionText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                      + Temp
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              primaryAction && (
                <TouchableOpacity
                  onPress={() => sendAction(primaryAction)}
                  activeOpacity={0.85}
                  disabled={hasPending || !allowControl}
                  style={[
                    styles.primaryActionButton,
                    { backgroundColor: active ? preset.iconActiveBackground : '#0f172a', height: CONTROL_HEIGHT },
                    hasPending && styles.primaryActionButtonDisabled,
                  ]}
                >
                  {hasPending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <View style={styles.primaryActionContent}>
                      <Text style={styles.primaryActionIcon}>{preset.icon}</Text>
                      <Text
                        style={styles.primaryActionText}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        adjustsFontSizeToFit
                        minimumFontScale={0.85}
                      >
                        {primaryActionLabel(primaryAction, device)}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              )
            )}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
});

function primaryActionLabel(action: DeviceActionSpec, device: UIDevice): string {
  const label = getPrimaryLabel(device);
  if (action.kind === 'toggle') {
    const state = (device.state ?? '').toString().toLowerCase();
    const isOn = state === 'on' || state === 'playing';
    return isOn ? `Turn off ${label.toLowerCase()}` : `Turn on ${label.toLowerCase()}`;
  }
  if (action.kind === 'button' || action.kind === 'fixed') {
    return action.label;
  }
  if (action.kind === 'slider') {
    return action.label;
  }
  return 'Action';
}

function formatBatteryForTile(percent: number | null | undefined) {
  if (percent == null || !Number.isFinite(percent)) return null;
  const rounded = Math.round(percent);
  if (rounded <= 0) {
    return {
      text: `Battery ${rounded}% • Change Batteries !`,
      bg: 'rgba(248,113,113,0.2)',
      fg: '#b91c1c',
    };
  }
  if (rounded < 20) {
    return {
      text: `Battery ${rounded}% • Low Battery !`,
      bg: 'rgba(251,191,36,0.2)',
      fg: '#92400e',
    };
  }
  return {
    text: `Battery ${rounded}%`,
    bg: 'rgba(226,232,240,0.7)',
    fg: '#334155',
  };
}

function getSecondaryLine(device: UIDevice): string {
  const state = (device.state ?? '').toString();
  const attrs = device.attributes ?? {};
  const label = getPrimaryLabel(device);
  if (label === 'Light') {
    const pct = getBrightnessPct(attrs);
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
    const target = attrs.temperature ?? (attrs as any).target_temp;
    const current = (attrs as any).current_temperature;
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

function resolveActionCommand(
  action: DeviceActionSpec,
  device: UIDevice,
  overrideValue?: number
): { command: string; value?: number } | null {
  if (action.kind === 'toggle') {
    return { command: resolveToggleCommandForDevice(action, device) };
  }
  if (action.kind === 'button') {
    return { command: action.command, value: overrideValue ?? action.value };
  }
  if (action.kind === 'fixed') {
    return { command: action.command, value: action.value };
  }
  if (action.kind === 'slider') {
    const attrs = device.attributes ?? {};
    const volume = getVolumePct(attrs) ?? 0;
    const brightness = getBrightnessPct(attrs) ?? 0;
    const blind = getBlindPosition(attrs) ?? 0;
    const defaultValue = labelDefaultForSlider(action.id, volume, brightness, blind);
    return { command: action.command, value: overrideValue ?? defaultValue ?? 0 };
  }
  return null;
}

function labelDefaultForSlider(id: string, volume: number, brightness: number, blind: number) {
  if (id.includes('volume')) return volume;
  if (id.includes('brightness')) return brightness;
  if (id.includes('position')) return blind;
  return null;
}

function getBlindActions(actions: DeviceActionSpec[]) {
  return actions.filter(
    (a) => a.kind === 'fixed' && (a.command === 'blind/open' || a.command === 'blind/close')
  ) as Extract<DeviceActionSpec, { kind: 'fixed' }>[];
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
    flex: 1,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    paddingTop: spacing.xs,
    borderWidth: 1,
    borderColor: palette.outline,
    backgroundColor: palette.surface,
    ...shadows.soft,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    columnGap: spacing.xs,
  },
  topLineSpacer: {
    height: 12,
  },
  batteryTopOverlay: {
    position: 'absolute',
    top: 1,
    left: spacing.md,
    right: spacing.md,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  icon: { fontSize: 18, color: '#fff' },
  body: { marginTop: 1, flex: 1 },
  content: { gap: 0 },
  footer: { marginTop: 'auto', paddingTop: spacing.xs },
  name: { fontSize: 15, fontWeight: '700', color: palette.text },
  secondary: { fontSize: 12, color: palette.textMuted, marginTop: 2 },
  energyBlock: {
    marginTop: spacing.xs,
    alignSelf: 'flex-start',
  },
  energyLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.textMuted,
  },
  energyValue: {
    fontSize: 14,
    fontWeight: '700',
    color: palette.textMuted,
  },
  boilerControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.sm,
  },
  boilerButton: {
    flex: 1,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.soft,
  },
  boilerTarget: {
    minWidth: 86,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boilerTargetValue: {
    fontSize: 16,
    fontWeight: '800',
    color: palette.text,
  },
  primaryActionButton: {
    width: '100%',
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.soft,
  },
  primaryActionButtonDisabled: {
    opacity: 0.6,
  },
  blindActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
  },
  secondaryActionButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.soft,
  },
  primaryActionText: {
    fontSize: 14,
    fontWeight: '700',
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
