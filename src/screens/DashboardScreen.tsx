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
} from 'react-native';
import type { UIDevice } from '../models/device';
import { normalizeLabel } from '../utils/deviceLabels';
import { isDetailDevice, isSensorDevice } from '../utils/deviceKinds';
import { logoutRemote } from '../api/auth';
import { DeviceCard } from '../components/DeviceCard';
import type { DeviceCardSize } from '../components/DeviceCard';
import { DeviceDetail } from '../components/DeviceDetail';
import { useDevices, clearDeviceCacheForUserAndMode } from '../store/deviceStore';
import type { HaMode } from '../api/dinodia';
import {
  buildDeviceSections,
  buildSectionLayoutRows,
  getDeviceDimensions,
  getDeviceLayoutSize,
  LayoutRow,
} from '../utils/deviceSections';
import { HeaderMenu } from '../components/HeaderMenu';
import { SpotifyCard } from '../components/SpotifyCard';
import { loadJson, saveJson } from '../utils/storage';
import type { Role } from '../models/roles';
import { useSession } from '../store/sessionStore';

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
  clearSession: () => Promise<void>;
  setHaMode: (mode: HaMode) => void;
};

function DashboardContent({ userId, role, haMode, clearSession, setHaMode }: DashboardContentProps) {
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
  const areaStorageKey = useMemo(
    () => (persistAreaSelection ? `tenant_selected_area_${userId}` : null),
    [persistAreaSelection, userId]
  );

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logoutRemote().catch(() => undefined);
    } finally {
      await clearSession();
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

  const handleToggleMode = useCallback(() => {
    const nextMode: HaMode = isCloud ? 'home' : 'cloud';
    void clearDeviceCacheForUserAndMode(userId, nextMode)
      .catch(() => undefined)
      .then(() => {
        setHaMode(nextMode);
      });
  }, [isCloud, setHaMode, userId]);

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
          const sectionWidth = `${section.span * 25}%`;
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
                  const widthPercent = `${Math.min(100, (widthUnits / section.span) * 100)}%`;
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
              </View>
            </View>
          );
        })}
      </View>
    ),
    [devices.length, handleBackgroundRefresh, handleOpenDetails, isAdmin, refreshing]
  );

  const isColdStart = !lastUpdated && devices.length === 0 && !error;
  const showErrorEmpty = !!error && devices.length === 0;
  const modeLabel = isCloud ? 'Cloud Mode' : 'Home Mode';
  const headerAreaLabel = selectedArea === ALL_AREAS ? ALL_AREAS_LABEL : selectedArea;

  return (
    <View style={styles.screen}>
      <FlatList
        style={styles.list}
        data={rows}
        keyExtractor={(item) => item.key}
        renderItem={renderDeviceRow}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.headerContainer}>
            <View style={styles.headerRow}>
              <View style={styles.headerTextGroup}>
                <TouchableOpacity
                  onPress={() => setAreaMenuVisible(true)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.headerArea}>{headerAreaLabel}</Text>
                </TouchableOpacity>
                <Text style={styles.headerMode}>{` • ${modeLabel}`}</Text>
              </View>
              <TouchableOpacity
                style={styles.menuIconButton}
                onPress={() => setMenuVisible(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.menuIconText}>⋯</Text>
              </TouchableOpacity>
            </View>
            {error && <Text style={styles.error}>{error}</Text>}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>
              {isColdStart
                ? 'Loading devices…'
                : showErrorEmpty
                ? 'Unable to reach devices. Please check your connection or HA URL.'
                : 'No devices available.'}
            </Text>
          </View>
        }
        refreshing={refreshing}
        onRefresh={handleRefresh}
        initialNumToRender={10}
        windowSize={5}
        removeClippedSubviews
      />
      <SpotifyCard />
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
        isCloud={isCloud}
        onClose={() => setMenuVisible(false)}
        onToggleMode={handleToggleMode}
        onOpenWifi={handleOpenWifiSetup}
        onLogout={handleLogout}
      />
    </View>
  );
}

type DashboardScreenProps = {
  role: Role;
};

export function DashboardScreen({ role }: DashboardScreenProps) {
  const { session, clearSession, haMode, setHaMode } = useSession();
  const userId = session.user?.id!;
  const key = `${userId}_${haMode}_${role}`;

  return (
    <DashboardContent
      key={key}
      userId={userId}
      role={role}
      haMode={haMode}
      clearSession={clearSession}
      setHaMode={setHaMode}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f5f7' },
  list: { flex: 1, backgroundColor: '#f5f5f7' },
  listContent: { padding: 16, backgroundColor: '#f5f5f7' },
  headerContainer: { marginBottom: 8 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerTextGroup: { flexDirection: 'row', alignItems: 'center' },
  headerArea: { fontSize: 20, fontWeight: '600', color: '#111827' },
  headerMode: { fontSize: 20, fontWeight: '600', color: '#111827' },
  error: { color: 'red', marginBottom: 8 },
  menuIconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e5e7eb',
  },
  menuIconText: { fontSize: 20, color: '#111827', marginTop: -2 },
  refreshing: { fontSize: 12, color: '#9ca3af' },
  deviceRow: { flexDirection: 'row', marginBottom: 12 },
  sectionContainer: { paddingHorizontal: 4 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 6,
    backgroundColor: '#eef2f7',
    borderRadius: 6,
    marginBottom: 6,
  },
  sectionTitle: { fontSize: 12, fontWeight: '600', color: '#6b7280' },
  sectionCards: { flexDirection: 'row', flexWrap: 'wrap' },
  cardWrapper: { paddingHorizontal: 4, paddingVertical: 6, flexShrink: 0 },
  emptyState: { paddingVertical: 32, alignItems: 'center' },
  emptyText: { color: '#6b7280' },
  areaMenuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' },
  areaMenuContainer: {
    position: 'absolute',
    top: 80,
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  areaMenuCard: {
    backgroundColor: '#f9fafb',
    borderRadius: 16,
    paddingVertical: 8,
    minWidth: 220,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  areaMenuItem: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  areaMenuItemText: {
    fontSize: 14,
    color: '#111827',
  },
  areaMenuItemSelected: {
    fontWeight: '700',
  },
});
