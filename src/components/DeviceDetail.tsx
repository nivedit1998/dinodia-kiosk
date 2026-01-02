// src/components/DeviceDetail.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ScrollView,
  Image,
  Alert,
} from 'react-native';
import Slider from '@react-native-community/slider';
import type { UIDevice } from '../models/device';
import { fetchSensorHistoryForCurrentUser, HistoryPoint } from '../api/monitoringHistory';
import { getPrimaryLabel } from '../utils/deviceLabels';
import {
  getActionsForDevice,
  type DeviceActionSpec,
  resolveToggleCommandForDevice,
} from '../capabilities/deviceCapabilities';
import {
  getBlindPosition,
  getBrightnessPct,
  getTargetTemperature,
  getVolumePct,
} from '../capabilities/attributeReaders';
import { useSession } from '../store/sessionStore';
import { getDevicePreset, isDeviceActive } from './deviceVisuals';
import { executeDeviceCommand } from '../devices/deviceExecutor';
import { palette, radii, shadows, spacing } from '../ui/theme';
import { fetchHomeModeSecrets } from '../api/haSecrets';
import { assertHaUrlAllowed } from '../api/haUrlPolicy';

type Props = {
  device: UIDevice | null;
  visible: boolean;
  onClose: () => void;
  onCommandComplete?: () => void | Promise<void>;
  relatedDevices?: UIDevice[];
  linkedSensors?: UIDevice[];
  allowSensorHistory?: boolean;
};

export function DeviceDetail({
  device,
  visible,
  onClose,
  onCommandComplete,
  relatedDevices,
  linkedSensors,
  allowSensorHistory,
}: Props) {
  const { session, haMode } = useSession();
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [cameraRefreshToken, setCameraRefreshToken] = useState<number>(Date.now());
  const [cameraAuth, setCameraAuth] = useState<{ baseUrl: string; token: string } | null>(null);

  const label = device ? getPrimaryLabel(device) : null;
  const preset = useMemo(() => getDevicePreset(label), [label]);
  const active = device ? isDeviceActive(label, device) : false;
  const area = device?.area ?? device?.areaName ?? '';
  const sensors = linkedSensors ?? [];
  const canShowHistory = Boolean(allowSensorHistory && session.user);

  const connection = session.haConnection;

  useEffect(() => {
    if (label === 'Doorbell' || label === 'Home Security') {
      const id = setInterval(() => setCameraRefreshToken(Date.now()), 15000);
      return () => clearInterval(id);
    }
    return;
  }, [label]);

  useEffect(() => {
    let active = true;
    if (!visible || !device) {
      setCameraAuth(null);
      return;
    }
    (async () => {
      try {
        const secrets = await fetchHomeModeSecrets();
        if (haMode === 'cloud') {
          if (active) setCameraAuth(null);
          return;
        }
        const base = secrets.baseUrl;
        if (!active) return;
        if (!base || !secrets.longLivedToken) {
          setCameraAuth(null);
          return;
        }
        try {
          assertHaUrlAllowed(base);
        } catch {
          setCameraAuth(null);
          return;
        }
        setCameraAuth({ baseUrl: base, token: secrets.longLivedToken });
      } catch {
        if (active) setCameraAuth(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [device, haMode, visible]);

  const buildCameraSource = (entityId: string) =>
    cameraAuth
      ? {
          uri: `${cameraAuth.baseUrl}/api/camera_proxy/${encodeURIComponent(entityId)}?ts=${cameraRefreshToken}`,
          headers: { Authorization: `Bearer ${cameraAuth.token}` },
        }
      : { uri: '' };

  async function sendCommand(command: string, value?: number) {
    if (!device) return;
    if (pendingCommand) return;
    setPendingCommand(command);
    try {
      await executeDeviceCommand({
        haMode,
        connection,
        device,
        command,
        value,
      });
      if (onCommandComplete) await Promise.resolve(onCommandComplete());
    } catch (err) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('device detail command error', err);
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

  const attrs = device?.attributes ?? {};
  const brightnessPct = getBrightnessPct(attrs);
  const volumePct = getVolumePct(attrs);
  const secondary = device ? getSecondaryLine(device) : '';

  const headerBg = active ? preset.accent[0] : '#e5e7eb';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View />
      </Pressable>
      <View style={styles.sheet}>
        <View style={styles.handleBarWrapper}>
          <View style={styles.handleBar} />
        </View>
        <View style={[styles.header, { backgroundColor: headerBg }]}>
          <View>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.title}>{device?.name ?? ''}</Text>
            <Text style={styles.subtitle}>{area || 'Unassigned area'}</Text>
            <Text style={styles.secondary}>{secondary}</Text>
          </View>
          <View style={[styles.headerIcon, { backgroundColor: preset.iconActiveBackground }]}>
            <Text style={styles.headerIconText}>{preset.icon}</Text>
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {device &&
            renderControls({
              device,
              label,
              pendingCommand,
              onCommand: sendCommand,
              cameraSourceBuilder: buildCameraSource,
              relatedDevices,
            })}
          {device && sensors.length > 0 && (
            <LinkedSensorList sensors={sensors} canShowHistory={canShowHistory} userId={session.user?.id} />
          )}
        </ScrollView>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeText}>Close</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

function renderControls(opts: {
  device: UIDevice;
  label: string | null;
  pendingCommand: string | null;
  onCommand: (command: string, value?: number) => Promise<void>;
  cameraSourceBuilder: (entityId: string) => { uri: string; headers?: Record<string, string> };
  relatedDevices?: UIDevice[];
}) {
  const {
    device,
    label,
    pendingCommand,
    onCommand,
    cameraSourceBuilder,
    relatedDevices,
  } = opts;
  const state = (device.state ?? '').toString();
  const attrs = device.attributes ?? {};
  const brightnessPct = getBrightnessPct(attrs);
  const volumePct = getVolumePct(attrs);
  const actions = getActionsForDevice(device, 'dashboard');

  if (label === 'Spotify') {
    return (
      <View style={styles.section}>
        {typeof attrs.entity_picture === 'string' && attrs.entity_picture.length > 0 && (
          <Image source={{ uri: attrs.entity_picture }} style={styles.artwork} />
        )}
        <Text style={styles.titleSm}>{String(attrs.media_title ?? 'Track')}</Text>
        <Text style={styles.subtitleSm}>{attrs.media_artist ? String(attrs.media_artist) : ''}</Text>
        <View style={styles.row}>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => onCommand('media/previous')}
            disabled={!!pendingCommand}
          >
            <Text style={styles.secondaryButtonText}>Prev</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => onCommand('media/play_pause')}
            disabled={!!pendingCommand}
          >
            <Text style={styles.primaryButtonText}>{state === 'playing' ? 'Pause' : 'Play'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => onCommand('media/next')}
            disabled={!!pendingCommand}
          >
            <Text style={styles.secondaryButtonText}>Next</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (label === 'Doorbell') {
    const source = cameraSourceBuilder(device.entityId);
    return (
      <View style={styles.section}>
        <View style={styles.cameraCard}>
          <Image source={source} style={styles.cameraImage} resizeMode="cover" />
        </View>
      </View>
    );
  }

  if (label === 'Home Security') {
    const cams = relatedDevices ?? [];
    if (!cams.length) {
      return (
        <View style={styles.section}>
          <Text style={styles.secondary}>No cameras available.</Text>
        </View>
      );
    }
    return (
      <View style={styles.section}>
        <View style={styles.cameraGrid}>
          {cams.map((cam) => (
            <View key={cam.entityId} style={styles.cameraTile}>
              <Image
                source={cameraSourceBuilder(cam.entityId)}
                style={styles.cameraThumb}
                resizeMode="cover"
              />
              <Text style={styles.cameraName} numberOfLines={1}>
                {cam.name}
              </Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (!actions.length) {
    return (
      <View style={styles.section}>
        <Text style={styles.secondary}>No interactive controls available.</Text>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      {actions.map((action) =>
        renderActionControl({
          action,
          device,
          pendingCommand,
          onCommand,
        })
      )}
    </View>
  );
}

function renderActionControl(params: {
  action: DeviceActionSpec;
  device: UIDevice;
  pendingCommand: string | null;
  onCommand: (command: string, value?: number) => Promise<void>;
}) {
  const { action, device, pendingCommand, onCommand } = params;
  const attrs = device.attributes ?? {};
  const blindPosition = getBlindPosition(attrs);
  const pendingId = resolvePendingId(action);
  const isPending = pendingId ? pendingCommand === pendingId : false;

  if (action.kind === 'slider') {
    const value = readSliderValue(action.id, attrs) ?? action.min;
    return (
      <View key={action.id} style={styles.sliderBlock}>
        <Text style={styles.sliderLabel}>
          {action.label} {Math.round(value)}{action.id.includes('temperature') ? '°' : '%'}
        </Text>
        <Slider
          minimumValue={action.min}
          maximumValue={action.max}
          step={action.step ?? 1}
          value={value}
          disabled={!!pendingCommand}
          onSlidingComplete={(val) => {
            const cmd = action.command;
            onCommand(cmd, val);
          }}
          minimumTrackTintColor="#4f46e5"
          maximumTrackTintColor="#e5e7eb"
          thumbTintColor="#4f46e5"
        />
      </View>
    );
  }

  if (action.kind === 'fixed') {
    const disabled =
      !!pendingCommand ||
      (action.command === 'blind/open' && blindPosition === 100) ||
      (action.command === 'blind/close' && blindPosition === 0);
    return (
      <TouchableOpacity
        key={action.id}
        style={[styles.secondaryButton, styles.buttonAlt, { marginBottom: 10 }]}
        onPress={() => onCommand(action.command, action.value)}
        disabled={disabled}
      >
        <Text style={styles.secondaryButtonText}>{action.label}</Text>
      </TouchableOpacity>
    );
  }

  if (action.kind === 'button') {
    return (
      <TouchableOpacity
        key={action.id}
        style={[styles.primaryButton, { marginBottom: 10 }]}
        disabled={!!pendingCommand}
        onPress={() => onCommand(action.command, action.value)}
      >
        <Text style={styles.primaryButtonText}>{action.label}</Text>
      </TouchableOpacity>
    );
  }

  if (action.kind === 'toggle') {
    const cmd = resolveToggleCommandForDevice(action, device);
    const isOn = (device.state ?? '').toString().toLowerCase() === 'on';
    return (
      <TouchableOpacity
        key={action.id}
        style={[styles.primaryButton, { marginBottom: 10 }]}
        disabled={!!pendingCommand}
        onPress={() => onCommand(cmd)}
      >
        <Text style={styles.primaryButtonText}>{isOn ? `Turn off ${getPrimaryLabel(device)}` : `Turn on ${getPrimaryLabel(device)}`}</Text>
      </TouchableOpacity>
    );
  }

  return null;
}

function resolvePendingId(action: DeviceActionSpec): string | null {
  if (action.kind === 'toggle') return action.commandOn;
  if (action.kind === 'button') return action.command;
  if (action.kind === 'fixed') return action.command;
  if (action.kind === 'slider') return action.command;
  return null;
}

function readSliderValue(id: string, attrs: Record<string, unknown>): number | null {
  if (id.includes('brightness')) return getBrightnessPct(attrs) ?? 0;
  if (id.includes('volume')) return getVolumePct(attrs) ?? 0;
  if (id.includes('position')) return getBlindPosition(attrs) ?? 0;
  if (id.includes('temp')) {
    const target = getTargetTemperature(attrs);
    if (target !== null) return target;
  }
  return null;
}

function LinkedSensorList({
  sensors,
  canShowHistory,
  userId,
}: {
  sensors: UIDevice[];
  canShowHistory: boolean;
  userId?: number | null;
}) {
  type SensorHistoryBucket = 'daily' | 'weekly' | 'monthly';
  type SensorHistoryState = {
    expanded: boolean;
    bucket: SensorHistoryBucket;
    loading: boolean;
    error: string | null;
    unit: string | null;
    points: HistoryPoint[] | null;
  };

  const [sensorHistory, setSensorHistory] = useState<Record<string, SensorHistoryState>>({});

  function ensureState(entityId: string) {
    setSensorHistory((s) => {
      if (s[entityId]) return s;
      return {
        ...s,
        [entityId]: {
          expanded: false,
          bucket: 'daily',
          loading: false,
          error: null,
          unit: null,
          points: null,
        },
      };
    });
  }

  useEffect(() => {
    sensors.forEach((s) => ensureState(s.entityId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sensors.map((s) => s.entityId).join('|')]);

  async function loadHistoryFor(entityId: string, bucket: SensorHistoryBucket) {
    if (!userId) return;
    setSensorHistory((prev) => ({
      ...prev,
      [entityId]: { ...(prev[entityId] ?? { expanded: true, bucket }), loading: true, error: null, points: null, unit: null },
    }));
    try {
      const res = await fetchSensorHistoryForCurrentUser(userId, entityId, bucket);
      setSensorHistory((prev) => ({
        ...prev,
        [entityId]: { ...(prev[entityId] ?? {} as any), loading: false, error: null, points: res.points, unit: res.unit, bucket },
      }));
    } catch (err: any) {
      setSensorHistory((prev) => ({
        ...prev,
        [entityId]: { ...(prev[entityId] ?? {} as any), loading: false, error: err?.message ?? String(err), points: [], unit: null, bucket },
      }));
    }
  }

  function toggleExpand(entityId: string) {
    setSensorHistory((prev) => {
      const cur = prev[entityId] ?? { expanded: false, bucket: 'daily', loading: false, error: null, unit: null, points: null };
      const next = { ...cur, expanded: !cur.expanded };
      return { ...prev, [entityId]: next };
    });
    const state = sensorHistory[entityId];
    const willExpand = !(state?.expanded ?? false);
    if (willExpand && (!state || state.points === null)) {
      const bucket = state?.bucket ?? 'daily';
      void loadHistoryFor(entityId, bucket);
    }
  }

  function changeBucket(entityId: string, bucket: SensorHistoryBucket) {
    setSensorHistory((prev) => ({ ...prev, [entityId]: { ...(prev[entityId] ?? {} as any), bucket, loading: true, error: null } }));
    void loadHistoryFor(entityId, bucket);
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionHeading}>Linked sensors</Text>
      <View style={styles.sensorList}>
        {sensors.map((sensor) => {
          const st = sensorHistory[sensor.entityId] ?? { expanded: false, bucket: 'daily', loading: false, error: null, unit: null, points: null };
          return (
            <View key={sensor.entityId}>
              <TouchableOpacity
                activeOpacity={canShowHistory ? 0.7 : 1}
                onPress={() => {
                  if (canShowHistory) toggleExpand(sensor.entityId);
                }}
                style={styles.sensorRow}
              >
                <View style={styles.sensorDot} />
                <View style={styles.sensorTextGroup}>
                  <Text style={styles.sensorName} numberOfLines={1}>
                    {sensor.name}
                  </Text>
                  <Text style={styles.sensorValue}>{formatSensorValue(sensor)}</Text>
                </View>
                {canShowHistory && (
                  <View style={{ marginLeft: 8 }}>
                    <Text style={{ color: '#6b7280', fontSize: 13 }}>{st.expanded ? 'Hide' : 'History'}</Text>
                  </View>
                )}
              </TouchableOpacity>

              {st.expanded && (
                <View style={styles.historyBlock}>
                  <Text style={styles.historyHeader}>History</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                    {(['daily', 'weekly', 'monthly'] as SensorHistoryBucket[]).map((b) => {
                      const selected = st.bucket === b;
                      return (
                        <TouchableOpacity
                          key={b}
                          onPress={() => changeBucket(sensor.entityId, b)}
                          style={[
                            styles.bucketBtn,
                            selected ? styles.bucketBtnSelected : undefined,
                          ]}
                        >
                          <Text style={selected ? styles.bucketBtnTextSelected : styles.bucketBtnText}>
                            {b.charAt(0).toUpperCase() + b.slice(1)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <View style={styles.historyList}>
                    {st.loading && <Text style={styles.secondary}>Loading…</Text>}
                    {!st.loading && st.error && <Text style={styles.errorText}>{st.error}</Text>}
                    {!st.loading && !st.error && st.points && st.points.length === 0 && (
                      <Text style={styles.secondary}>No history yet.</Text>
                    )}
                    {!st.loading && !st.error && st.points && st.points.length > 0 && (
                      <ScrollView style={{ maxHeight: 220 }}>
                        {st.points.map((p) => (
                          <View key={p.bucketStart} style={styles.historyRow}>
                            <Text style={styles.historyLabel}>{p.label}</Text>
                            <Text style={styles.historyValue}>
                              {Number.isFinite(p.value) ? p.value.toFixed(2) : String(p.value)}{st.unit ? ` ${st.unit}` : ''}
                            </Text>
                          </View>
                        ))}
                      </ScrollView>
                    )}
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
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
    if (typeof attrs.media_title === 'string') return attrs.media_title;
    return state === 'playing' ? 'Playing' : state === 'paused' ? 'Paused' : state;
  }
  if (label === 'Blind') {
    const pos = getBlindPosition(attrs);
    if (pos !== null) return `Position ${pos}%`;
    const s = state.toLowerCase();
    if (s === 'stop' || s === 'stopped') return '';
    return state;
  }
  return state;
}

function formatSensorValue(sensor: UIDevice): string {
  const state = (sensor.state ?? '').toString();
  const attrs = sensor.attributes ?? {};
  const unit =
    attrs && typeof (attrs as Record<string, unknown>).unit_of_measurement === 'string'
      ? String((attrs as Record<string, unknown>).unit_of_measurement)
      : '';
  if (!state) return '—';
  if (state.toLowerCase() === 'unavailable') return 'Unavailable';
  if (unit) return `${state} ${unit}`.trim();
  return state.charAt(0).toUpperCase() + state.slice(1);
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.32)' },
  sheet: {
    position: 'absolute',
    top: 60,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: palette.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    overflow: 'hidden',
    ...shadows.medium,
  },
  handleBarWrapper: {
    paddingTop: spacing.sm,
    alignItems: 'center',
  },
  handleBar: {
    width: 52,
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: palette.outline,
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', columnGap: spacing.sm },
  label: { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: palette.textMuted },
  title: { fontSize: 22, fontWeight: '800', color: palette.text, marginTop: 2 },
  subtitle: { fontSize: 13, color: palette.textMuted, marginTop: 4 },
  secondary: { fontSize: 12, color: palette.textMuted, marginTop: 6 },
  headerIcon: {
    width: 52,
    height: 52,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconText: { fontSize: 22, color: '#fff' },
  closeChip: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeChipText: { fontSize: 18, color: palette.text },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xl },
  section: {
    marginBottom: spacing.lg,
    backgroundColor: palette.surfaceMuted,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: palette.outline,
  },
  sectionHeading: { fontSize: 13, fontWeight: '700', color: palette.text, marginBottom: 10 },
  row: { flexDirection: 'row', columnGap: spacing.sm },
  primaryButton: {
    backgroundColor: palette.primary,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    alignItems: 'center',
    ...shadows.soft,
  },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondaryButton: {
    flex: 1,
    backgroundColor: palette.surface,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.outline,
  },
  buttonAlt: { backgroundColor: palette.surfaceMuted },
  secondaryButtonText: { color: palette.text, fontSize: 14, fontWeight: '700' },
  sliderBlock: { marginTop: spacing.sm },
  sliderLabel: { fontSize: 13, color: palette.text, marginBottom: 6 },
  titleSm: { fontSize: 18, fontWeight: '700', color: palette.text, marginTop: 8 },
  subtitleSm: { fontSize: 13, color: palette.textMuted, marginTop: 4 },
  artwork: {
    width: '100%',
    height: 170,
    borderRadius: radii.xl,
    marginBottom: spacing.sm,
    backgroundColor: palette.surface,
    ...shadows.soft,
  },
  motionBadge: {
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    alignItems: 'center',
  },
  motionText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  sensorList: { gap: 8 },
  sensorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.outline,
    ...shadows.soft,
  },
  sensorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#60a5fa',
    marginRight: spacing.md,
  },
  sensorTextGroup: { flex: 1 },
  sensorName: { fontSize: 14, fontWeight: '700', color: palette.text },
  sensorValue: { fontSize: 12, color: palette.textMuted, marginTop: 2 },
  cameraCard: {
    borderRadius: radii.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: palette.outline,
    backgroundColor: palette.surface,
    ...shadows.soft,
  },
  cameraImage: { width: '100%', height: 240, backgroundColor: palette.surfaceMuted },
  cameraGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cameraTile: {
    width: '48%',
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.outline,
    backgroundColor: palette.surface,
    overflow: 'hidden',
    marginBottom: spacing.sm,
    ...shadows.soft,
  },
  cameraThumb: { width: '100%', height: 140, backgroundColor: palette.surfaceMuted },
  cameraName: { padding: spacing.sm, fontSize: 12, color: palette.text },
  historyBlock: {
    backgroundColor: palette.surface,
    borderRadius: radii.lg,
    padding: spacing.sm,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: palette.outline,
  },
  historyHeader: { fontSize: 13, fontWeight: '700', color: palette.text, marginBottom: 6 },
  bucketBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radii.md,
    backgroundColor: palette.surfaceMuted,
  },
  bucketBtnSelected: { backgroundColor: palette.text },
  bucketBtnText: { color: palette.text, fontWeight: '600' },
  bucketBtnTextSelected: { color: '#fff', fontWeight: '600' },
  historyList: { marginTop: 6 },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: palette.outline,
  },
  historyLabel: { color: palette.textMuted },
  historyValue: { color: palette.text, fontWeight: '700' },
  closeBtn: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderTopWidth: 1,
    borderColor: palette.outline,
    backgroundColor: palette.surface,
  },
  closeText: { fontSize: 16, fontWeight: '700', color: palette.text },
  errorText: { color: '#ef4444' },
});
