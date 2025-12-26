import React, { useCallback, useEffect, useState } from 'react';
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
import { logoutRemote } from '../../api/auth';
import { useRemoteAccessStatus } from '../../hooks/useRemoteAccessStatus';
import { useDeviceStatus } from '../../hooks/useDeviceStatus';
import { CloudModePrompt } from '../../components/CloudModePrompt';
import { useCloudModeSwitch } from '../../hooks/useCloudModeSwitch';

const { InlineWifiSetupLauncher } = NativeModules;

type Props = NativeStackScreenProps<any>;

export function AutomationsListScreen({}: Props) {
  const navigation = useNavigation<any>();
  const { session, haMode, setHaMode, clearSession } = useSession();
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
    await logoutRemote().catch(() => undefined);
    await clearSession();
  }, [clearSession]);

  useEffect(() => {
    if (isCloud && remoteAccess.status === 'locked') {
      void switchMode('home');
    }
  }, [isCloud, remoteAccess.status, switchMode]);

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
            <FlatList
              data={automations}
              keyExtractor={(item) => item.id}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
              renderItem={({ item }) => {
                const summary =
                  item.description || item.basicSummary || 'No summary from Home Assistant yet.';
                const trigger = item.triggerSummary || 'Trigger info not available.';
                const action = item.actionSummary || 'Action info not available.';
                return (
                  <View style={styles.item}>
                    <View style={styles.itemMain}>
                      <Text style={styles.itemTitle}>{item.alias}</Text>
                      <Text style={styles.itemSubtitle} numberOfLines={2}>
                        {summary}
                      </Text>
                      <View style={styles.metaRow}>
                        <Text style={styles.metaLabel}>When</Text>
                        <Text style={styles.metaText} numberOfLines={2}>
                          {trigger}
                        </Text>
                      </View>
                      <View style={styles.metaRow}>
                        <Text style={styles.metaLabel}>Then</Text>
                        <Text style={styles.metaText} numberOfLines={2}>
                          {action}
                        </Text>
                      </View>
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
                automations.length === 0 ? styles.listContentEmpty : null,
              ]}
              style={styles.listCard}
            />
          )}
        </View>
      </View>
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
  inner: { width: '100%', maxWidth: maxContentWidth },
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
  listCard: {
    backgroundColor: palette.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: palette.outline,
    ...shadows.soft,
  },
  listContent: { paddingVertical: spacing.xs, paddingBottom: spacing.xxl },
  listContentEmpty: { paddingVertical: spacing.xl },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: palette.outline,
    marginHorizontal: spacing.lg,
  },
  item: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  itemMain: { flex: 1, gap: spacing.xs },
  itemTitle: { fontSize: 16, fontWeight: '600', color: palette.text },
  itemSubtitle: { fontSize: 13, color: palette.textMuted },
  metaRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  metaLabel: { width: 46, fontSize: 11, fontWeight: '700', color: palette.textMuted },
  metaText: { flex: 1, fontSize: 12, color: palette.text },
  itemActions: { alignItems: 'flex-end', paddingTop: 2 },
  deleteButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fff1f2',
  },
  deleteText: { color: palette.danger, fontWeight: '600', fontSize: 12 },
  empty: { paddingVertical: 40, alignItems: 'center', gap: spacing.xs },
  emptyText: { color: palette.text, fontSize: 16, fontWeight: '700' },
  emptySub: { color: palette.textMuted },
});
