// src/screens/ManageDevicesScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ManagedDevice, fetchManagedDevices, markDeviceStolen, markDeviceActive } from '../api/manageDevices';
import { palette, radii, shadows, spacing, typography } from '../ui/theme';
import { TopBar } from '../components/ui/TopBar';
import { HeaderMenu } from '../components/HeaderMenu';
import { useSession } from '../store/sessionStore';
import { useDeviceStatus } from '../hooks/useDeviceStatus';
import { friendlyError } from '../ui/friendlyError';

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

const statusCopy: Record<ManagedDevice['status'], { label: string; badge: string }> = {
  ACTIVE: { label: 'Active', badge: '#10b981' },
  STOLEN: { label: 'Stolen', badge: '#ef4444' },
  BLOCKED: { label: 'Blocked', badge: '#f59e0b' },
};

export function ManageDevicesScreen() {
  const navigation = useNavigation<any>();
  const { session, resetApp, haMode } = useSession();
  const isAdmin = session.user?.role === 'ADMIN';
  const { wifiName, batteryLevel } = useDeviceStatus();
  const [devices, setDevices] = useState<ManagedDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const dashboardScreen = isAdmin ? 'AdminDashboard' : 'TenantDashboard';
  const addDevicesScreen = isAdmin ? null : 'TenantAddDevices';

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchManagedDevices();
      setDevices(list);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleLogout = useCallback(async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await resetApp();
    } finally {
      setLoggingOut(false);
    }
  }, [loggingOut, resetApp]);

  const sorted = useMemo(() => {
    return [...devices].sort((a, b) => {
      if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
      if (a.status !== 'ACTIVE' && b.status === 'ACTIVE') return 1;
      return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
    });
  }, [devices]);

  const handleMarkStolen = async (deviceId: string) => {
    if (savingId) return;
    setSavingId(deviceId);
    try {
      await markDeviceStolen(deviceId);
      await load();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSavingId(null);
    }
  };

  const handleRestore = async (deviceId: string) => {
    if (savingId) return;
    setSavingId(deviceId);
    try {
      await markDeviceActive(deviceId);
      await load();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSavingId(null);
    }
  };

  const renderDevice = ({ item }: { item: ManagedDevice }) => {
    const status = statusCopy[item.status];
    const name =
      item.label?.trim() ||
      item.registryLabel?.trim() ||
      `Device ${item.deviceId.slice(-6)}`;
    const canRestore = item.status === 'STOLEN' || item.status === 'BLOCKED';
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleWrap}>
            <View style={[styles.badgeDot, { backgroundColor: status.badge }]} />
            <Text style={styles.cardTitle}>{name}</Text>
          </View>
          <Text style={styles.cardStatus}>{status.label}</Text>
        </View>
        <Text style={styles.muted}>ID: {item.deviceId}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>First seen</Text>
          <Text style={styles.metaValue}>{formatDate(item.firstSeenAt)}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Last seen</Text>
          <Text style={styles.metaValue}>{formatDate(item.lastSeenAt)}</Text>
        </View>
        {item.revokedAt ? (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Revoked</Text>
            <Text style={styles.metaValue}>{formatDate(item.revokedAt)}</Text>
          </View>
        ) : null}
        {item.status === 'ACTIVE' ? (
          <TouchableOpacity
            style={[styles.stolenButton, savingId === item.deviceId && styles.stolenButtonDisabled]}
            onPress={() => handleMarkStolen(item.deviceId)}
            disabled={!!savingId}
            activeOpacity={0.9}
          >
            <Text style={styles.stolenButtonText}>
              {savingId === item.deviceId ? 'Updating…' : 'Mark as stolen'}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.restoreButton, savingId === item.deviceId && styles.restoreButtonDisabled]}
            onPress={() => void handleRestore(item.deviceId)}
            disabled={!canRestore || !!savingId}
            activeOpacity={0.9}
          >
            <Text style={styles.restoreButtonText}>
              {savingId === item.deviceId ? 'Updating…' : 'Restore device'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <TopBar
        mode={haMode}
        activeTab={null}
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
              ]
        }
        onChangeTab={(tab) => {
          if (tab === 'dashboard') {
            navigation.getParent()?.navigate('DashboardTab', { screen: dashboardScreen as never });
            return;
          }
          if (tab === 'automations') {
            navigation.getParent()?.navigate('AutomationsTab', { screen: 'AutomationsList' as never });
            return;
          }
          if (tab === 'homeSetup' && isAdmin) {
            navigation.getParent()?.navigate('DashboardTab', { screen: 'AdminHomeSetup' as never });
            return;
          }
          if (tab === 'addDevices' && addDevicesScreen) {
            navigation.getParent()?.navigate('DashboardTab', { screen: addDevicesScreen as never });
          }
        }}
        onPressMenu={() => setMenuVisible(true)}
        onPressMode={undefined}
        wifiName={wifiName}
        batteryLevel={batteryLevel}
      />

      <View style={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Manage Devices</Text>
          <Text style={styles.heroCopy}>
            Block stolen or lost devices instantly. Active devices can fetch Dinodia Hub keys; stolen ones are locked out.
          </Text>
        </View>

        <TouchableOpacity onPress={load} activeOpacity={0.85} style={styles.refreshButton}>
          <Text style={styles.refreshText}>Refresh</Text>
        </TouchableOpacity>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="small" color={palette.text} />
            <Text style={styles.muted}>Loading devices…</Text>
          </View>
        ) : error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={load} activeOpacity={0.9}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : sorted.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.heroTitle}>No devices yet</Text>
            <Text style={styles.heroCopy}>Add a device by signing in from that tablet or phone.</Text>
          </View>
        ) : (
          <FlatList
            data={sorted}
            keyExtractor={(item) => item.id || item.deviceId}
            renderItem={renderDevice}
            contentContainerStyle={styles.list}
          />
        )}
      </View>

      <HeaderMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        onLogout={handleLogout}
        onManageDevices={undefined}
        onRemoteAccess={
          isAdmin
            ? () => {
                setMenuVisible(false);
                navigation.navigate('RemoteAccessSetup' as never);
              }
            : undefined
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  container: { flex: 1, paddingHorizontal: spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: palette.outline,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    ...shadows.soft,
  },
  backGlyph: { fontSize: 18, fontWeight: '700', color: palette.text },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800', color: palette.text },
  hero: { paddingVertical: spacing.lg },
  heroTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: palette.text,
    marginBottom: spacing.xs,
  },
  heroCopy: {
    fontSize: 15,
    color: palette.textMuted,
    lineHeight: 22,
  },
  loading: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.outline,
    alignItems: 'center',
    gap: spacing.xs,
  },
  empty: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.outline,
  },
  errorCard: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    gap: spacing.sm,
  },
  errorText: {
    color: palette.danger,
    fontWeight: '700',
  },
  retryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: palette.text,
  },
  retryText: {
    color: '#fff',
    fontWeight: '700',
  },
  list: { paddingBottom: spacing.xl, gap: spacing.md },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: '#edf2f7',
    ...shadows.medium,
    gap: spacing.xs,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  cardTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  badgeDot: { width: 10, height: 10, borderRadius: 10 },
  cardTitle: { fontSize: 17, fontWeight: '800', color: palette.text },
  cardStatus: { fontSize: 13, color: palette.textMuted, fontWeight: '600' },
  muted: { color: palette.textMuted, fontSize: 13 },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  metaLabel: { fontSize: 13, color: palette.textMuted },
  metaValue: { fontSize: 13, color: palette.text, fontWeight: '600' },
  stolenButton: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 14,
    backgroundColor: palette.danger,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  stolenButtonDisabled: {
    backgroundColor: '#fca5a5',
    opacity: 0.7,
  },
  stolenButtonText: { color: '#fff', fontWeight: '800', letterSpacing: 0.2 },
  restoreButton: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 14,
    backgroundColor: palette.success,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  restoreButtonDisabled: {
    backgroundColor: '#a7f3d0',
    opacity: 0.7,
  },
  restoreButtonText: { color: '#065f46', fontWeight: '800', letterSpacing: 0.2 },
  refreshButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: '#0f172a',
    minWidth: 90,
    alignItems: 'center',
  },
  refreshText: { color: '#fff', fontWeight: '700', fontSize: 12 },
});
