import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  RefreshControl,
  SafeAreaView,
  NativeModules,
  Modal,
  Pressable,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { listAutomations, deleteAutomation, type AutomationSummary } from '../../api/automations';
import { useNavigation } from '@react-navigation/native';
import { useSession } from '../../store/sessionStore';
import { palette, maxContentWidth, radii, shadows, spacing, typography } from '../../ui/theme';
import { TopBar } from '../../components/ui/TopBar';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { HeaderMenu } from '../../components/HeaderMenu';
import { clearDeviceCacheForUserAndMode } from '../../store/deviceStore';
import { useRemoteAccessStatus } from '../../hooks/useRemoteAccessStatus';
import { useDeviceStatus } from '../../hooks/useDeviceStatus';
import { CloudModePrompt } from '../../components/CloudModePrompt';
import { useCloudModeSwitch } from '../../hooks/useCloudModeSwitch';
import { useDevices } from '../../store/deviceStore';
import { getEligibleDevicesForAutomations } from '../../capabilities/deviceCapabilities';
import { isDetailDevice } from '../../utils/deviceKinds';
import type { UIDevice } from '../../models/device';

const { InlineWifiSetupLauncher } = NativeModules;

type Props = NativeStackScreenProps<any>;

export function AutomationsListScreen({}: Props) {
  const navigation = useNavigation<any>();
  const { session, haMode, setHaMode, resetApp } = useSession();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [automations, setAutomations] = useState<AutomationSummary[]>([]);
  const [menuVisible, setMenuVisible] = useState(false);
  const userId = session.user?.id;
  const isAdmin = session.user?.role === 'ADMIN';
  const dashboardScreen = isAdmin ? 'AdminDashboard' : 'TenantDashboard';
  const addDevicesScreen = isAdmin ? null : 'TenantAddDevices';
  const isCloud = haMode === 'cloud';
  const remoteAccess = useRemoteAccessStatus(haMode);
  const { wifiName, batteryLevel } = useDeviceStatus();
  const { devices, refreshing: devicesRefreshing } = useDevices(userId || 0, haMode);
  const [selectedEntityId, setSelectedEntityId] = useState<string>('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listAutomations({ haConnection: session.haConnection, mode: haMode });
      setAutomations(data);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Unable to load automations.');
    } finally {
      setLoading(false);
    }
  }, [haMode, session.haConnection]);

  useEffect(() => {
    if (isCloud && remoteAccess.status !== 'enabled') return;
    void load();
  }, [isCloud, load, remoteAccess.status]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await listAutomations({ haConnection: session.haConnection, mode: haMode });
      setAutomations(data);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Unable to load automations.');
    } finally {
      setRefreshing(false);
    }
  }, [haMode, session.haConnection]);

  const handleDelete = useCallback(
    (id: string) => {
      Alert.alert('Delete automation', 'Are you sure you want to delete this automation?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAutomation(id, { haConnection: session.haConnection, mode: haMode });
              await refresh();
            } catch (err: any) {
              Alert.alert('Could not delete', err?.message ?? 'Unable to delete automation');
            }
          },
        },
      ]);
    },
    [haMode, refresh, session.haConnection]
  );

  const switchMode = useCallback(
    async (next: 'home' | 'cloud') => {
      if (userId) {
        await clearDeviceCacheForUserAndMode(userId, next).catch(() => undefined);
      }
      setHaMode(next);
    },
    [setHaMode, userId]
  );

  const {
    promptVisible: cloudPromptVisible,
    checking: cloudChecking,
    result: cloudCheckResult,
    openPrompt: handleToggleMode,
    cancelPrompt: handleCancelCloud,
    confirmPrompt: handleConfirmCloud,
  } = useCloudModeSwitch({
    isCloud,
    onSwitchToCloud: () => switchMode('cloud'),
    onSwitchToHome: () => switchMode('home'),
  });

  const handleOpenWifiSetup = useCallback(() => {
    if (InlineWifiSetupLauncher && typeof InlineWifiSetupLauncher.open === 'function') {
      InlineWifiSetupLauncher.open();
    } else {
      Alert.alert('Wi-Fi', 'Wi-Fi setup is not available on this device.');
    }
  }, []);

  const handleLogout = useCallback(async () => {
    await resetApp();
  }, [resetApp]);

  useEffect(() => {
    if (isCloud && remoteAccess.status === 'locked') {
      void switchMode('home');
    }
  }, [isCloud, remoteAccess.status, switchMode]);

  const primaryDevices = useMemo(() => {
    const eligible = getEligibleDevicesForAutomations(devices);
    return eligible.filter((d) => !isDetailDevice(d.state));
  }, [devices]);

  const entityToDeviceId = useMemo(() => {
    const map = new Map<string, string | null>();
    devices.forEach((d) => map.set(d.entityId, d.deviceId ?? null));
    return map;
  }, [devices]);

  const deviceOptions = useMemo(
    () =>
      primaryDevices.map((d) => ({
        id: d.entityId,
        label: buildDeviceLabel(d),
      })),
    [primaryDevices]
  );

  const selectedLabel =
    deviceOptions.find((opt) => opt.id === selectedEntityId)?.label || 'All automations';

  const selectedDeviceId = selectedEntityId ? entityToDeviceId.get(selectedEntityId) ?? null : null;

  const filteredAutomations = selectedEntityId
    ? automations.filter((a) =>
        matchesAutomationTarget(a, selectedEntityId, selectedDeviceId, entityToDeviceId)
      )
    : automations;

  return (
    <SafeAreaView style={styles.container}>
      <TopBar
        mode={haMode}
        activeTab="automations"
        tabs={
          isAdmin
            ? [
                { key: 'dashboard', label: 'Dashboard' },
                { key: 'automations', label: 'Automations' },
                { key: 'homeSetup', label: 'Home Setup' },
              ]
            : [
                { key: 'dashboard', label: 'Dashboard' },
                { key: 'automations', label: 'Automations' },
                { key: 'addDevices', label: 'Add Devices' },
              ]
        }
        onPressMenu={() => setMenuVisible(true)}
        onPressMode={handleToggleMode}
        wifiName={wifiName}
        batteryLevel={batteryLevel}
        onPressWifi={handleOpenWifiSetup}
        onChangeTab={(tab) => {
          if (tab === 'dashboard') {
            navigation.getParent()?.navigate('DashboardTab', {
              screen: dashboardScreen as never,
            });
            return;
          }
          if (tab === 'homeSetup' && isAdmin) {
            navigation.getParent()?.navigate('DashboardTab', { screen: 'AdminHomeSetup' as never });
            return;
          }
          if (tab === 'addDevices' && addDevicesScreen) {
            navigation.getParent()?.navigate('DashboardTab', {
              screen: addDevicesScreen as never,
            });
          }
        }}
      />

      <View style={styles.content}>
        <View style={styles.inner}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.title}>Automations</Text>
              <Text style={styles.subtitle}>Scenes that keep your place effortless.</Text>
            </View>
            <PrimaryButton
              title="+ Add"
              onPress={() => navigation.navigate('AutomationEditor' as never)}
              style={styles.addButton}
            />
          </View>

          <View style={styles.filterRow}>
            <Text style={styles.filterLabel}>Device / Entity</Text>
            <TouchableOpacity
              style={styles.dropdownButton}
              onPress={() => setPickerOpen(true)}
              disabled={devicesRefreshing}
            >
              <Text style={styles.dropdownButtonText} numberOfLines={1}>
                {selectedLabel}
              </Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color={palette.primary} />
              <Text style={styles.loadingText}>Loading automations…</Text>
            </View>
          ) : error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              <PrimaryButton title="Retry" onPress={load} />
            </View>
          ) : (
            <View style={styles.listWrap}>
              <FlatList
                data={filteredAutomations}
                keyExtractor={(item) => item.id}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
                renderItem={({ item }) => {
                  const detail = summarizeAutomation(item, devices);
                  const summary =
                    item.description ||
                    item.basicSummary ||
                    detail.actionSummary ||
                    'No summary from Home Assistant yet.';
                  const trigger = detail.triggerSummary || item.triggerSummary || 'Trigger info not available.';
                  const action =
                    detail.actionSummary || item.actionSummary || 'Action info not available.';
                  const target = detail.primaryName || '—';
                  const mode = item.mode || 'single';
                  const createdViaDinodia = item.id.toLowerCase().startsWith('dinodia_');
                  return (
                    <View style={styles.item}>
                      <View style={styles.itemHeader}>
                        <Text style={styles.itemTitle}>{item.alias}</Text>
                        <View style={styles.badges}>
                          <Text
                            style={[
                              styles.badge,
                              item.enabled ? styles.badgeEnabled : styles.badgeDisabled,
                            ]}
                          >
                            {item.enabled ? 'Enabled' : 'Disabled'}
                          </Text>
                          {item.hasTemplates && (
                            <Text style={[styles.badge, styles.badgeWarning]}>Template (view only)</Text>
                          )}
                          {item.canEdit === false && (
                            <Text style={[styles.badge, styles.badgeWarning]}>Read-only</Text>
                          )}
                          {createdViaDinodia && (
                            <Text style={[styles.badge, styles.badgeInfo]}>Created via Dinodia</Text>
                          )}
                        </View>
                      </View>
                      <Text style={styles.itemSubtitle} numberOfLines={2}>
                        {summary}
                      </Text>
                      <Text style={styles.metaSmall}>ID: {item.id}</Text>
                      <View style={styles.chipRow}>
                        <Text style={styles.metaChip}>Mode: {mode}</Text>
                        {target !== '—' && <Text style={styles.metaChip}>Target: {target}</Text>}
                        {item.entities && item.entities.length > 0 && (
                          <Text style={styles.metaChip} numberOfLines={2}>
                            Entities: {item.entities.join(', ')}
                          </Text>
                        )}
                      </View>
                      <View style={styles.metaRow}>
                        <Text style={styles.metaLabel}>Trigger</Text>
                        <Text style={styles.metaText} numberOfLines={2}>
                          {trigger}
                        </Text>
                      </View>
                      <View style={styles.metaRow}>
                        <Text style={styles.metaLabel}>Action</Text>
                        <Text style={styles.metaText} numberOfLines={2}>
                          {action}
                        </Text>
                      </View>
                      <View style={styles.itemActions}>
                        <TouchableOpacity onPress={() => handleDelete(item.id)} style={styles.deleteButton}>
                          <Text style={styles.deleteText}>Delete</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                }}
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <Text style={styles.emptyText}>No automations yet.</Text>
                    <Text style={styles.emptySub}>Create your first automation to get started.</Text>
                  </View>
                }
                ItemSeparatorComponent={() => <View style={styles.separator} />}
                contentContainerStyle={[
                  styles.listContent,
                  filteredAutomations.length === 0 ? styles.listContentEmpty : null,
                ]}
                ListFooterComponent={() => <View style={styles.listFooter} />}
                style={styles.listCard}
                contentInsetAdjustmentBehavior="automatic"
              />
            </View>
          )}
        </View>
      </View>
      <HeaderMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        onLogout={handleLogout}
        onManageDevices={() => {
          setMenuVisible(false);
          navigation.navigate('ManageDevices' as never);
        }}
        onRemoteAccess={
          isAdmin
            ? () => {
                setMenuVisible(false);
                navigation.navigate('RemoteAccessSetup' as never);
              }
            : undefined
        }
      />
      <Modal
        transparent
        visible={pickerOpen}
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable style={styles.pickerBackdrop} onPress={() => setPickerOpen(false)} />
        <View style={styles.pickerWrap} pointerEvents="box-none">
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>Select device</Text>
            <FlatList
              data={[{ id: '', label: 'All automations' }, ...deviceOptions]}
              keyExtractor={(item) => item.id || 'all'}
              renderItem={({ item }) => {
                const selected = item.id === selectedEntityId;
                return (
                  <TouchableOpacity
                    style={[styles.pickerItem, selected && styles.pickerItemSelected]}
                    onPress={() => {
                      setSelectedEntityId(item.id);
                      setPickerOpen(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.pickerItemText,
                        selected && styles.pickerItemTextSelected,
                      ]}
                      numberOfLines={1}
                    >
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                );
              }}
              ItemSeparatorComponent={() => <View style={styles.pickerSeparator} />}
              contentContainerStyle={styles.pickerListContent}
              style={styles.pickerList}
            />
          </View>
        </View>
      </Modal>
      <CloudModePrompt
        visible={cloudPromptVisible}
        checking={cloudChecking}
        result={cloudCheckResult}
        onCancel={handleCancelCloud}
        onConfirm={handleConfirmCloud}
        title={haMode === 'cloud' ? 'Move to Home mode?' : 'Move to Cloud mode?'}
        subtitle={
          haMode === 'cloud'
            ? 'Instant control when you are on your home network.'
            : 'Control your devices from anywhere in the world.'
        }
        checkingText={
          haMode === 'cloud'
            ? 'Checking your home network connection'
            : 'checking if remote access is enabled for this home'
        }
        successText={haMode === 'cloud' ? 'Home connection confirmed' : 'Cloud access confirmed'}
        errorText={
          haMode === 'cloud' ? 'Home network is not reachable right now' : 'Cloud access is not enabled yet'
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  content: {
    flex: 1,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
  },
  inner: { width: '100%', maxWidth: maxContentWidth, flex: 1 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    flexWrap: 'wrap',
    marginBottom: spacing.lg,
  },
  title: { ...typography.heading },
  subtitle: { color: palette.textMuted, marginTop: 4, fontSize: 13 },
  addButton: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  filterRow: { marginTop: spacing.md, gap: spacing.xs },
  filterLabel: { fontSize: 12, fontWeight: '700', color: palette.textMuted, marginBottom: 2 },
  dropdownButton: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.outline,
    backgroundColor: palette.surface,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    justifyContent: 'center',
    ...shadows.soft,
  },
  dropdownButtonText: { fontSize: 14, color: palette.text, fontWeight: '600' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  loadingText: { color: palette.textMuted },
  errorBox: {
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  errorText: { color: palette.danger, marginBottom: spacing.sm },
  listWrap: { flex: 1, width: '100%' },
  listCard: {
    backgroundColor: 'transparent',
  },
  listContent: { paddingVertical: spacing.md, paddingBottom: spacing.xxl + spacing.lg },
  listContentEmpty: { paddingVertical: spacing.xl },
  separator: {
    height: spacing.md,
  },
  listFooter: { height: spacing.xl },
  item: {
    backgroundColor: '#f9fafb',
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: palette.outline,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    gap: spacing.sm,
    ...shadows.soft,
  },
  itemMain: { flex: 1, gap: spacing.xs },
  itemTitle: { fontSize: 17, fontWeight: '700', color: palette.text },
  itemSubtitle: { fontSize: 13, color: palette.textMuted, lineHeight: 18 },
  metaRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', marginTop: 2 },
  metaLabel: { width: 56, fontSize: 11, fontWeight: '700', color: palette.textMuted },
  metaText: { flex: 1, fontSize: 12, color: palette.text, lineHeight: 18 },
  metaSmall: { fontSize: 11, color: palette.textMuted, marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 6 },
  metaChip: {
    fontSize: 11,
    color: palette.text,
    backgroundColor: '#eef2ff',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: '#e0e7ff',
  },
  itemActions: { alignItems: 'flex-end', paddingTop: 2 },
  deleteButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fff1f2',
  },
  deleteText: { color: palette.danger, fontWeight: '600', fontSize: 12 },
  empty: { paddingVertical: 40, alignItems: 'center', gap: spacing.xs },
  emptyText: { color: palette.text, fontSize: 16, fontWeight: '700' },
  emptySub: { color: palette.textMuted },
  itemHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  badge: {
    fontSize: 11,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: palette.outline,
  },
  badgeEnabled: { backgroundColor: '#ecfdf3', borderColor: '#bbf7d0', color: '#15803d' },
  badgeDisabled: { backgroundColor: '#f8fafc', borderColor: palette.outline, color: palette.textMuted },
  badgeWarning: { backgroundColor: '#fffbeb', borderColor: '#fcd34d', color: '#92400e' },
  badgeInfo: { backgroundColor: '#e0f2fe', borderColor: '#bae6fd', color: '#075985' },
  pickerBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  pickerWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  pickerCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: palette.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: palette.outline,
    padding: spacing.lg,
    ...shadows.soft,
  },
  pickerTitle: { fontSize: 16, fontWeight: '700', color: palette.text, marginBottom: spacing.sm },
  pickerItem: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.lg,
  },
  pickerItemSelected: {
    backgroundColor: 'rgba(10,132,255,0.08)',
    borderColor: palette.primary,
  },
  pickerItemText: { fontSize: 14, color: palette.text },
  pickerItemTextSelected: { color: palette.primary, fontWeight: '700' },
  pickerSeparator: { height: StyleSheet.hairlineWidth, backgroundColor: palette.outline },
  pickerListContent: { paddingVertical: spacing.xs },
  pickerList: { maxHeight: 420 },
});

function buildDeviceLabel(device: UIDevice) {
  const area = (device.area ?? device.areaName ?? '').trim();
  return area ? `${device.name} (${area})` : device.name;
}

function toArray<T>(val: T | T[] | undefined | null): T[] {
  if (Array.isArray(val)) return val;
  if (val === undefined || val === null) return [];
  return [val];
}

function getTriggerSummary(trigger: unknown, devices: UIDevice[]): string {
  if (!trigger || typeof trigger !== 'object') return 'Custom trigger';
  const t = trigger as Record<string, any>;
  const entityCandidate = t.entity_id ?? t.entityId;
  const entity = toArray<string>(
    typeof entityCandidate === 'string' || Array.isArray(entityCandidate)
      ? (entityCandidate as string | string[])
      : undefined
  )[0];
  const friendly = devices.find((d) => d.entityId === entity)?.name || entity || 'Unknown entity';
  const platform = typeof t.platform === 'string' ? t.platform : (t.trigger as string | undefined);
  if (platform === 'time') {
    const at = typeof t.at === 'string' ? t.at : '';
    const weekdayValue = t.weekday ?? t.daysOfWeek;
    const weekdays = toArray<string>(
      Array.isArray(weekdayValue) || typeof weekdayValue === 'string'
        ? (weekdayValue as string | string[])
        : undefined
    ).join(', ');
    if (at && weekdays) return `Time: ${at} on ${weekdays}`;
    if (at) return `Time: ${at}`;
    if (weekdays) return `Time on ${weekdays}`;
    return 'Scheduled time';
  }
  if (platform === 'state') {
    const to = (t.to as string | undefined) ?? (t.state as string | undefined);
    const from = (t.from as string | undefined) ?? (t.from_state as string | undefined);
    if (from && to) return `State: ${friendly} ${from} → ${to}`;
    if (to) return `State: ${friendly} → ${to}`;
    if (from) return `State: ${friendly} from ${from}`;
    return `State: ${friendly}`;
  }
  return 'Custom trigger';
}

function getActionEntity(action: unknown): string | null {
  if (!action || typeof action !== 'object') return null;
  const target = (action as Record<string, any>).target as Record<string, any> | undefined;
  const candidate = target?.entity_id ?? (action as Record<string, any>).entity_id ?? null;
  if (Array.isArray(candidate)) return candidate[0] ?? null;
  return typeof candidate === 'string' ? candidate : null;
}

function getActionSummary(
  action: unknown,
  devices: UIDevice[]
): { summary: string; primaryName?: string } {
  if (!action || typeof action !== 'object') return { summary: 'Custom action' };
  const a = action as Record<string, any>;
  const entityId = getActionEntity(a);
  const friendly =
    devices.find((d) => d.entityId === entityId)?.name || entityId || 'Unknown device';
  const service = typeof a.service === 'string' ? a.service : undefined;
  const type = typeof a.type === 'string' ? a.type : undefined;
  if (service) {
    return { summary: `${service} on ${friendly}`, primaryName: friendly };
  }
  if (type) {
    return { summary: `${type} on ${friendly}`, primaryName: friendly };
  }
  return { summary: `Custom action on ${friendly}`, primaryName: friendly };
}

function summarizeAutomation(auto: AutomationSummary, devices: UIDevice[]) {
  const raw = auto.raw ?? {};
  const triggers = toArray(raw.triggers ?? raw.trigger);
  const actions = toArray(raw.actions ?? raw.action);
  const triggerSummary = triggers.length > 0 ? getTriggerSummary(triggers[0], devices) : '—';
  const actionSummary = actions.length > 0 ? getActionSummary(actions[0], devices) : { summary: '—' };
  return {
    triggerSummary,
    actionSummary: actionSummary.summary,
    primaryName: actionSummary.primaryName,
  };
}

function matchesAutomationTarget(
  automation: AutomationSummary,
  selectedEntityId: string,
  selectedDeviceId: string | null,
  entityToDeviceId: Map<string, string | null>
) {
  const targetEntities = automation.entities ?? [];
  if (targetEntities.includes(selectedEntityId)) return true;

  if (selectedDeviceId) {
    const targetDeviceIds = automation.targetDeviceIds ?? [];
    if (targetDeviceIds.includes(selectedDeviceId)) return true;
    if (targetEntities.some((entityId) => entityToDeviceId.get(entityId) === selectedDeviceId)) {
      return true;
    }
  }

  // Safe fallback: if we lack deviceId mapping, at least match primary entity id lists.
  if (!selectedDeviceId && targetEntities.length > 0) {
    return targetEntities.includes(selectedEntityId);
  }

  return false;
}
