import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  NativeModules,
  TouchableOpacity,
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  type DimensionValue,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { UIDevice } from '../models/device';
import { normalizeLabel } from '../utils/deviceLabels';
import { isDetailDevice, isSensorDevice } from '../utils/deviceKinds';
import { DeviceCard } from '../components/DeviceCard';
import type { DeviceCardSize } from '../components/DeviceCard';
import { DeviceDetail } from '../components/DeviceDetail';
import { CloudModePrompt } from '../components/CloudModePrompt';
import { useDevices, clearDeviceCacheForUserAndMode } from '../store/deviceStore';
import { HOME_WIFI_PROMPT, type HaMode } from '../api/dinodia';
import {
  buildDeviceSections,
  buildSectionLayoutRows,
  getDeviceDimensions,
  getDeviceLayoutSize,
  LayoutRow,
} from '../utils/deviceSections';
import { HeaderMenu } from '../components/HeaderMenu';
import { SpotifyCard } from '../components/SpotifyCard';
import { RingDoorbellCard } from '../components/RingDoorbellCard';
import { loadJson, saveJson } from '../utils/storage';
import type { Role } from '../models/roles';
import { useSession } from '../store/sessionStore';
import { useRemoteAccessStatus } from '../hooks/useRemoteAccessStatus';
import { useDeviceStatus } from '../hooks/useDeviceStatus';
import { TopBar } from '../components/ui/TopBar';
import { palette, maxContentWidth, radii, shadows, spacing } from '../ui/theme';
import { useCloudModeSwitch } from '../hooks/useCloudModeSwitch';
import type { HaConnection } from '../models/haConnection';

const { InlineWifiSetupLauncher } = NativeModules as {
  InlineWifiSetupLauncher?: { open?: () => void };
};

const CARD_BASE_ROW_HEIGHT = 130;
const ALL_AREAS = 'ALL';
const ALL_AREAS_LABEL = 'All Areas';

type DashboardContentProps = {
  userId: number;
  role: Role;
  haMode: HaMode;
  resetApp: () => Promise<void>;
  setHaMode: (mode: HaMode) => void;
  haConnection: HaConnection | null;
};

function DashboardContent({
  userId,
  role,
  haMode,
  resetApp,
  setHaMode,
  haConnection,
}: DashboardContentProps) {
  const navigation = useNavigation<any>();
  const isAdmin = role === 'ADMIN';
  const hideSensors = false; // Show sensors for all roles; tenants are already filtered by access rules.
  const persistAreaSelection = role === 'TENANT';
  const { devices, refreshing, error, refreshDevices, lastUpdated } = useDevices(userId, haMode);
  const [loggingOut, setLoggingOut] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [selected, setSelected] = useState<UIDevice | null>(null);
  const [selectedArea, setSelectedArea] = useState<string | typeof ALL_AREAS>(ALL_AREAS);
  const [areaMenuVisible, setAreaMenuVisible] = useState(false);
  const [areaPrefLoaded, setAreaPrefLoaded] = useState(!persistAreaSelection);
  const isCloud = haMode === 'cloud';
  const remoteAccess = useRemoteAccessStatus(haMode);
  const { wifiName, batteryLevel } = useDeviceStatus();
  const areaStorageKey = useMemo(
    () => (persistAreaSelection ? `tenant_selected_area_${userId}` : null),
    [persistAreaSelection, userId]
  );

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await resetApp();
    } finally {
      setLoggingOut(false);
    }
  };

  useEffect(() => {
    if (!selected) return;
    const updated = devices.find((d) => d.entityId === selected.entityId);
    if (updated && updated !== selected) {
      setSelected(updated);
    }
  }, [devices, selected]);

  useEffect(() => {
    setSelected(null);
  }, [haMode]);

  useEffect(() => {
    if (!areaStorageKey) return;
    let cancelled = false;
    (async () => {
      try {
        const stored = await loadJson<string>(areaStorageKey);
        if (!cancelled && typeof stored === 'string' && stored.length > 0) {
          setSelectedArea(stored);
        }
      } catch {
        // Ignore storage read errors
      } finally {
        if (!cancelled) setAreaPrefLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [areaStorageKey]);

  useEffect(() => {
    if (!areaPrefLoaded || !areaStorageKey) return;
    void saveJson(areaStorageKey, selectedArea).catch(() => undefined);
  }, [areaPrefLoaded, areaStorageKey, selectedArea]);

  const areaOptions = useMemo(() => {
    const names = new Set<string>();
    for (const d of devices) {
      const areaName = (d.area ?? d.areaName ?? '').trim();
      if (areaName.length > 0) {
        names.add(areaName);
      }
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [devices]);

  const visibleDevices = useMemo(
    () =>
      devices.filter((d) => {
        const areaName = (d.area ?? d.areaName ?? '').trim();
        const labels = Array.isArray(d.labels) ? d.labels : [];
        const hasLabel =
          normalizeLabel(d.label).length > 0 ||
          labels.some((lbl) => normalizeLabel(lbl).length > 0);
        const matchesArea = selectedArea === ALL_AREAS ? true : areaName === selectedArea;
        const filteredOut = hideSensors && (isSensorDevice(d) || isDetailDevice(d.state));
        return areaName.length > 0 && hasLabel && matchesArea && !filteredOut;
      }),
    [devices, hideSensors, selectedArea]
  );

  useEffect(() => {
    if (selectedArea === ALL_AREAS) return;
    if (!areaOptions.includes(selectedArea)) {
      setSelectedArea(ALL_AREAS);
    }
  }, [areaOptions, selectedArea]);

  const sections = useMemo(() => buildDeviceSections(visibleDevices), [visibleDevices]);
  const rows = useMemo(() => buildSectionLayoutRows(sections), [sections]);

  const linkedSensors = useMemo(
    () =>
      selected?.deviceId
        ? devices.filter(
            (d) =>
              d.deviceId === selected.deviceId &&
              d.entityId !== selected.entityId &&
              isSensorDevice(d)
          )
        : [],
    [devices, selected]
  );

  const handleRefresh = useCallback(() => {
    void refreshDevices();
  }, [refreshDevices]);

  const handleBackgroundRefresh = useCallback(() => {
    void refreshDevices({ background: true });
  }, [refreshDevices]);

  const handleOpenDetails = useCallback((device: UIDevice) => setSelected(device), []);
  const handleCloseDetails = useCallback(() => setSelected(null), []);
  const handleCommandComplete = useCallback(
    () => handleBackgroundRefresh(),
    [handleBackgroundRefresh]
  );

  const switchMode = useCallback(
    async (nextMode: HaMode) => {
      await clearDeviceCacheForUserAndMode(userId, nextMode).catch(() => undefined);
      setHaMode(nextMode);
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
    haConnection,
  });

  const handleOpenWifiSetup = useCallback(() => {
    if (InlineWifiSetupLauncher && typeof InlineWifiSetupLauncher.open === 'function') {
      InlineWifiSetupLauncher.open();
    } else {
      Alert.alert('Wi-Fi', 'Wi-Fi setup is not available on this device.');
    }
  }, []);

  const renderDeviceRow = useCallback(
    ({ item }: { item: LayoutRow }) => (
      <View style={styles.deviceRow}>
        {item.sections.map((section) => {
          const sectionWidth: DimensionValue = `${section.span * 25}%`;
          return (
            <View key={section.key} style={[styles.sectionContainer, { width: sectionWidth }]}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                {refreshing && devices.length === 0 && (
                  <Text style={styles.refreshing}>Refreshing…</Text>
                )}
              </View>
              <View style={styles.sectionCards}>
                {section.devices.map((device) => {
                  const size: DeviceCardSize = getDeviceLayoutSize(device);
                  const { width: widthUnits, height: heightUnits } = getDeviceDimensions(size);
                  const widthPercent: DimensionValue =
                    `${Math.min(100, (widthUnits / section.span) * 100)}%`;
                  const minHeight = CARD_BASE_ROW_HEIGHT * heightUnits;
                  return (
                    <View
                      key={device.entityId}
                      style={[styles.cardWrapper, { width: widthPercent, minHeight }]}
                    >
                      <DeviceCard
                        device={device}
                        isAdmin={isAdmin}
                        size={size}
                        onAfterCommand={handleBackgroundRefresh}
                        onOpenDetails={handleOpenDetails}
                      />
                    </View>
                  );
                })}

                {section.title === 'Doorbell' && (
                  <View
                    style={[
                      styles.cardWrapper,
                      { width: section.span > 1 ? '50%' : '100%', minHeight: CARD_BASE_ROW_HEIGHT },
                    ]}
                  >
                    <RingDoorbellCard />
                  </View>
                )}
              </View>
            </View>
          );
        })}
      </View>
    ),
    [devices.length, handleBackgroundRefresh, handleOpenDetails, isAdmin, refreshing]
  );

  const isColdStart = !lastUpdated && devices.length === 0 && !error;
  const showHomeWifiPrompt = haMode === 'home' && error === HOME_WIFI_PROMPT;
  const showErrorEmpty = !!error && devices.length === 0 && !showHomeWifiPrompt;
  const modeLabel = isCloud ? 'Cloud Mode' : 'Home Mode';
  const headerAreaLabel = selectedArea === ALL_AREAS ? ALL_AREAS_LABEL : selectedArea;
  useEffect(() => {
    if (isCloud && remoteAccess.status === 'locked') {
      void switchMode('home');
    }
  }, [isCloud, remoteAccess.status, switchMode]);

  return (
    <SafeAreaView style={styles.screen}>
      <TopBar
        areaLabel={headerAreaLabel}
        mode={haMode}
        activeTab="dashboard"
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
        onPressArea={() => setAreaMenuVisible(true)}
        onPressMenu={() => setMenuVisible(true)}
        onPressMode={handleToggleMode}
        wifiName={wifiName}
        batteryLevel={batteryLevel}
        onPressWifi={handleOpenWifiSetup}
        onChangeTab={(tab) => {
          if (tab === 'automations') {
            navigation.getParent()?.navigate('AutomationsTab', {
              screen: 'AutomationsList' as never,
            });
            return;
          }
          if (tab === 'homeSetup' && isAdmin) {
            navigation.navigate('AdminHomeSetup' as never);
            return;
          }
          if (tab === 'addDevices' && !isAdmin) {
            navigation.navigate('TenantAddDevices' as never);
          }
        }}
      />

      {error && !showHomeWifiPrompt ? <Text style={styles.errorBanner}>{error}</Text> : null}

      <View style={styles.content}>
        <FlatList
          style={styles.list}
          data={rows}
          keyExtractor={(item) => item.key}
          renderItem={renderDeviceRow}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>
                {isColdStart
                  ? 'Loading devices...'
                  : showHomeWifiPrompt
                  ? HOME_WIFI_PROMPT
                  : showErrorEmpty
                  ? 'Unable to reach devices.'
                  : 'No devices available.'}
              </Text>
              {!showHomeWifiPrompt ? (
                <Text style={styles.emptySub}>
                  {showErrorEmpty
                    ? 'Check your connection or switch modes.'
                    : 'Add devices to this area to get started.'}
                </Text>
              ) : null}
            </View>
          }
          refreshing={refreshing}
          onRefresh={handleRefresh}
          initialNumToRender={10}
          windowSize={5}
          removeClippedSubviews
        />
      </View>

      <View style={styles.spotifyCardWrap} pointerEvents="box-none">
        <SpotifyCard />
      </View>
      <Modal
        visible={areaMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAreaMenuVisible(false)}
      >
        <Pressable style={styles.areaMenuBackdrop} onPress={() => setAreaMenuVisible(false)}>
          <View />
        </Pressable>
        <View style={styles.areaMenuContainer}>
          <View style={styles.areaMenuCard}>
            <TouchableOpacity
              style={styles.areaMenuItem}
              onPress={() => {
                setSelectedArea(ALL_AREAS);
                setAreaMenuVisible(false);
              }}
              activeOpacity={0.85}
            >
              <Text
                style={[
                  styles.areaMenuItemText,
                  selectedArea === ALL_AREAS && styles.areaMenuItemSelected,
                ]}
              >
                {ALL_AREAS_LABEL}
              </Text>
            </TouchableOpacity>

            {areaOptions.map((area) => (
              <TouchableOpacity
                key={area}
                style={styles.areaMenuItem}
                onPress={() => {
                  setSelectedArea(area);
                  setAreaMenuVisible(false);
                }}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.areaMenuItemText,
                    selectedArea === area && styles.areaMenuItemSelected,
                  ]}
                >
                  {area}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>
      <DeviceDetail
        device={selected}
        visible={!!selected}
        onClose={handleCloseDetails}
        onCommandComplete={handleCommandComplete}
        relatedDevices={
          selected && selected.label === 'Home Security'
            ? devices.filter((d) => d.label === 'Home Security')
            : undefined
        }
        linkedSensors={linkedSensors}
        allowSensorHistory
      />
      <HeaderMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        onLogout={handleLogout}
        onRemoteAccess={
          isAdmin
            ? () => {
                setMenuVisible(false);
                navigation.navigate('RemoteAccessSetup' as never);
              }
            : undefined
        }
      />
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

type DashboardScreenProps = {
  role: Role;
};

export function DashboardScreen({ role }: DashboardScreenProps) {
  const { session, resetApp, haMode, setHaMode } = useSession();
  const userId = session.user?.id!;
  const key = `${userId}_${haMode}_${role}`;

  return (
    <DashboardContent
      key={key}
      userId={userId}
      role={role}
      haMode={haMode}
      resetApp={resetApp}
      setHaMode={setHaMode}
      haConnection={session.haConnection}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background, position: 'relative' },
  content: {
    flex: 1,
    alignItems: 'center',
  },
  list: { flex: 1, width: '100%' },
  listContent: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xxl + 140,
    gap: spacing.md,
    alignItems: 'center',
  },
  errorBanner: {
    backgroundColor: '#fef2f2',
    color: palette.danger,
    marginHorizontal: spacing.xl,
    padding: spacing.sm,
    borderRadius: radii.md,
    ...shadows.soft,
  },
  refreshing: { fontSize: 12, color: '#9ca3af' },
  deviceRow: {
    flexDirection: 'row',
    marginBottom: spacing.md,
    width: '100%',
    maxWidth: maxContentWidth,
  },
  sectionContainer: { paddingHorizontal: 6 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: palette.surfaceMuted,
    borderRadius: radii.md,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: palette.outline,
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: palette.textMuted, letterSpacing: 0.2 },
  sectionCards: { flexDirection: 'row', flexWrap: 'wrap' },
  cardWrapper: { paddingHorizontal: 6, paddingVertical: 8, flexShrink: 0 },
  emptyState: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyTitle: { color: palette.text, fontSize: 18, fontWeight: '700', marginBottom: 6 },
  emptySub: { color: palette.textMuted },
  areaMenuBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)' },
  areaMenuContainer: {
    position: 'absolute',
    top: 120,
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  areaMenuCard: {
    backgroundColor: palette.surface,
    borderRadius: radii.xl,
    paddingVertical: 10,
    minWidth: 240,
    ...shadows.medium,
  },
  areaMenuItem: {
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  areaMenuItemText: {
    fontSize: 14,
    color: palette.text,
  },
  areaMenuItemSelected: {
    fontWeight: '700',
    color: palette.primary,
  },
  spotifyCardWrap: {
    position: 'absolute',
    bottom: spacing.md,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
});
