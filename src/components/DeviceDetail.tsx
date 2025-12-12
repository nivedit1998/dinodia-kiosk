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
import { handleDeviceCommand } from '../utils/haCommands';
import { useSession } from '../store/sessionStore';
import { getDevicePreset, isDeviceActive } from './deviceVisuals';

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

  const label = device ? getPrimaryLabel(device) : null;
  const preset = useMemo(() => getDevicePreset(label), [label]);
  const active = device ? isDeviceActive(label, device) : false;
  const area = device?.area ?? device?.areaName ?? '';
  const sensors = linkedSensors ?? [];
  const canShowHistory = Boolean(allowSensorHistory && session.user);

  const connection = session.haConnection;

  const ha = device && connection
    ? (() => {
        const rawUrl =
          haMode === 'cloud' ? connection.cloudUrl ?? '' : connection.baseUrl ?? '';
        const cleaned = rawUrl.trim().replace(/\/+$/, '');
        if (!cleaned) return null;
        return { baseUrl: cleaned, longLivedToken: connection.longLivedToken };
      })()
    : null;

  useEffect(() => {
    if (label === 'Doorbell' || label === 'Home Security') {
      const id = setInterval(() => setCameraRefreshToken(Date.now()), 15000);
      return () => clearInterval(id);
    }
    return;
  }, [label]);

  const buildCameraUrl = (entityId: string) =>
    ha
      ? `${ha.baseUrl}/api/camera_proxy/${encodeURIComponent(entityId)}?token=${encodeURIComponent(
          ha.longLivedToken
        )}&ts=${cameraRefreshToken}`
      : '';

  async function sendCommand(command: string, value?: number) {
    if (!device) return;
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
      await handleDeviceCommand({ ha, entityId: device.entityId, command, value });
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
              brightnessPct,
              volumePct,
              pendingCommand,
              onCommand: sendCommand,
              cameraUrlBuilder: buildCameraUrl,
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
  brightnessPct: number | null;
  volumePct: number | null;
  pendingCommand: string | null;
  onCommand: (command: string, value?: number) => Promise<void>;
  cameraUrlBuilder: (entityId: string) => string;
  relatedDevices?: UIDevice[];
}) {
  const {
    device,
    label,
    brightnessPct,
    volumePct,
    pendingCommand,
    onCommand,
    cameraUrlBuilder,
    relatedDevices,
  } = opts;
  const state = (device.state ?? '').toString();
  const attrs = device.attributes ?? {};

  switch (label) {
    case 'Light':
      return (
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => onCommand('light/toggle')}
            disabled={!!pendingCommand}
          >
            <Text style={styles.primaryButtonText}>
              {state === 'on' ? 'Turn off' : 'Turn on'}
            </Text>
          </TouchableOpacity>
          {brightnessPct !== null && (
            <View style={styles.sliderBlock}>
              <Text style={styles.sliderLabel}>Brightness {brightnessPct}%</Text>
              <Slider
                minimumValue={0}
                maximumValue={100}
                step={1}
                value={brightnessPct}
                onSlidingComplete={(val) => {
                  onCommand('light/set_brightness', val);
                }}
                minimumTrackTintColor="#f59e0b"
                maximumTrackTintColor="#e5e7eb"
                thumbTintColor="#f59e0b"
              />
            </View>
          )}
        </View>
      );
    case 'Blind':
      return (
        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.secondaryButton, styles.buttonAlt]}
            onPress={() => onCommand('blind/open')}
            disabled={!!pendingCommand}
          >
            <Text style={styles.secondaryButtonText}>Open</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secondaryButton, styles.buttonAlt]}
            onPress={() => onCommand('blind/close')}
            disabled={!!pendingCommand}
          >
            <Text style={styles.secondaryButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
      );
    case 'Spotify':
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
              <Text style={styles.primaryButtonText}>
                {state === 'playing' ? 'Pause' : 'Play'}
              </Text>
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
    case 'TV':
    case 'Speaker':
      return (
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() =>
              onCommand(label === 'TV' ? 'tv/toggle_power' : 'speaker/toggle_power')
            }
            disabled={!!pendingCommand}
          >
            <Text style={styles.primaryButtonText}>
              {state === 'on' ? 'Power off' : 'Power on'}
            </Text>
          </TouchableOpacity>
          {volumePct !== null && (
            <View style={styles.sliderBlock}>
              <Text style={styles.sliderLabel}>Volume {volumePct}%</Text>
              <Slider
                minimumValue={0}
                maximumValue={100}
                step={1}
                value={volumePct}
                onSlidingComplete={(val) => {
                  onCommand('media/volume_set', val);
                }}
                minimumTrackTintColor="#4f46e5"
                maximumTrackTintColor="#e5e7eb"
                thumbTintColor="#4f46e5"
              />
            </View>
          )}
          <View style={styles.row}>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => onCommand('media/volume_down')}
              disabled={!!pendingCommand}
            >
              <Text style={styles.secondaryButtonText}>Volume -</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => onCommand('media/volume_up')}
              disabled={!!pendingCommand}
            >
              <Text style={styles.secondaryButtonText}>Volume +</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    case 'Boiler': {
      const target = attrs.temperature ?? attrs.target_temp;
      const current = attrs.current_temperature;
      return (
        <View style={styles.section}>
          <Text style={styles.titleSm}>
            Target: {typeof target === 'number' ? target : '—'}°
          </Text>
          <Text style={styles.subtitleSm}>
            Current: {typeof current === 'number' ? current : '—'}°
          </Text>
          <View style={styles.row}>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => onCommand('boiler/temp_down')}
              disabled={!!pendingCommand}
            >
              <Text style={styles.secondaryButtonText}>-</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => onCommand('boiler/temp_up')}
              disabled={!!pendingCommand}
            >
              <Text style={styles.secondaryButtonText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    case 'Motion Sensor': {
      const activeMotion = ['on', 'motion', 'detected', 'open'].includes(state.toLowerCase());
      return (
        <View style={styles.section}>
          <View
            style={[
              styles.motionBadge,
              { backgroundColor: activeMotion ? '#10b981' : '#d1d5db' },
            ]}
          >
            <Text style={styles.motionText}>
              {activeMotion ? 'Motion detected' : 'No motion'}
            </Text>
          </View>
        </View>
      );
    }
    case 'Doorbell': {
      const url = cameraUrlBuilder(device.entityId);
      return (
        <View style={styles.section}>
          <View style={styles.cameraCard}>
            <Image source={{ uri: url }} style={styles.cameraImage} resizeMode="cover" />
          </View>
        </View>
      );
    }
    case 'Home Security': {
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
                  source={{ uri: cameraUrlBuilder(cam.entityId) }}
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
    default:
      return (
        <View style={styles.section}>
          <Text style={styles.secondary}>No interactive controls available.</Text>
        </View>
      );
  }
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

function getBrightnessPct(attrs: Record<string, any>): number | null {
  if (typeof attrs.brightness_pct === 'number') return Math.round(attrs.brightness_pct);
  if (typeof attrs.brightness === 'number') return Math.round((attrs.brightness / 255) * 100);
  return null;
}

function getVolumePct(attrs: Record<string, any>): number | null {
  if (typeof attrs.volume_level === 'number') return Math.round(attrs.volume_level * 100);
  return null;
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
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    position: 'absolute',
    top: 80,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#f9fafb',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
  },
  handleBarWrapper: {
    paddingTop: 8,
    alignItems: 'center',
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d1d5db',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280' },
  title: { fontSize: 20, fontWeight: '700', color: '#111827', marginTop: 2 },
  subtitle: { fontSize: 13, color: '#4b5563', marginTop: 4 },
  secondary: { fontSize: 12, color: '#6b7280', marginTop: 6 },
  headerIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconText: { fontSize: 22, color: '#fff' },
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 },
  section: { marginBottom: 18 },
  sectionHeading: { fontSize: 13, fontWeight: '700', color: '#111827', marginBottom: 10 },
  row: { flexDirection: 'row', columnGap: 10 },
  primaryButton: {
    backgroundColor: '#111827',
    paddingVertical: 10,
    borderRadius: 14,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#e5e7eb',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonAlt: { backgroundColor: '#eef2ff' },
  secondaryButtonText: { color: '#111827', fontSize: 14, fontWeight: '600' },
  sliderBlock: { marginTop: 12 },
  sliderLabel: { fontSize: 13, color: '#111827', marginBottom: 6 },
  titleSm: { fontSize: 18, fontWeight: '700', color: '#111827', marginTop: 8 },
  subtitleSm: { fontSize: 13, color: '#4b5563', marginTop: 4 },
  artwork: {
    width: '100%',
    height: 170,
    borderRadius: 18,
    marginBottom: 12,
    backgroundColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  motionBadge: {
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  motionText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  sensorList: { gap: 8 },
  sensorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  sensorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#60a5fa',
    marginRight: 12,
  },
  sensorTextGroup: { flex: 1 },
  sensorName: { fontSize: 14, fontWeight: '700', color: '#111827' },
  sensorValue: { fontSize: 12, color: '#4b5563', marginTop: 2 },
  closeBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    borderTopWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
  },
  closeText: { fontSize: 15, color: '#111827', fontWeight: '600' },
  cameraCard: {
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  cameraImage: { width: '100%', height: 240, backgroundColor: '#f3f4f6' },
  cameraGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
  },
  cameraTile: {
    width: '48%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
    overflow: 'hidden',
    marginBottom: 10,
  },
  cameraThumb: { width: '100%', height: 140, backgroundColor: '#f3f4f6' },
  cameraName: { padding: 8, fontSize: 12, color: '#111827' },
  historyBlock: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  historyHeader: { fontSize: 13, fontWeight: '700', color: '#111827', marginBottom: 6 },
  bucketBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
  },
  bucketBtnSelected: { backgroundColor: '#111827' },
  bucketBtnText: { color: '#111827', fontWeight: '600' },
  bucketBtnTextSelected: { color: '#fff', fontWeight: '600' },
  historyList: { marginTop: 6 },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: '#f3f4f6',
  },
  historyLabel: { color: '#374151' },
  historyValue: { color: '#111827', fontWeight: '700' },
  errorText: { color: '#ef4444' },
});
