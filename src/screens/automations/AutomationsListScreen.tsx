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
  const isCloud = haMode === 'cloud';

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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
  }, []);

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
    [refresh]
  );

  const handleToggleMode = useCallback(() => {
    const next = isCloud ? 'home' : 'cloud';
    if (userId) {
      void clearDeviceCacheForUserAndMode(userId, next).catch(() => undefined);
    }
    setHaMode(next);
  }, [isCloud, setHaMode, userId]);

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

  return (
    <SafeAreaView style={styles.container}>
      <TopBar
        mode={haMode}
        activeTab="automations"
        onPressMenu={() => setMenuVisible(true)}
        onChangeTab={(tab) => {
          if (tab === 'dashboard') navigation.getParent()?.navigate('DashboardTab');
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
              style={{ paddingHorizontal: spacing.xl }}
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
              renderItem={({ item }) => (
                <View style={styles.item}>
                  <View style={{ flex: 1, gap: spacing.xs }}>
                    <Text style={styles.itemTitle}>{item.alias}</Text>
                    {item.description ? <Text style={styles.itemSubtitle}>{item.description}</Text> : null}
                    <View style={styles.summaryGroup}>
                      <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Basic</Text>
                        <Text style={styles.summaryText}>{item.basicSummary || item.description || 'No summary from Home Assistant yet.'}</Text>
                      </View>
                      <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Trigger</Text>
                        <Text style={styles.summaryText}>{item.triggerSummary || 'Trigger info not available.'}</Text>
                      </View>
                      <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Action</Text>
                        <Text style={styles.summaryText}>{item.actionSummary || 'Action info not available.'}</Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.itemActions}>
                    <TouchableOpacity onPress={() => handleDelete(item.id)} style={styles.deleteButton}>
                      <Text style={styles.deleteText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>No automations yet.</Text>
                  <Text style={styles.emptySub}>Create your first automation to get started.</Text>
                </View>
              }
              contentContainerStyle={{ paddingBottom: spacing.xxl }}
            />
          )}
        </View>
      </View>
      <HeaderMenu
        visible={menuVisible}
        isCloud={isCloud}
        onClose={() => setMenuVisible(false)}
        onToggleMode={handleToggleMode}
        onOpenWifi={handleOpenWifiSetup}
        onLogout={handleLogout}
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
    marginBottom: spacing.lg,
  },
  title: { ...typography.heading },
  subtitle: { color: palette.textMuted, marginTop: 4 },
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
  item: {
    backgroundColor: palette.surface,
    padding: spacing.lg,
    borderRadius: radii.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: palette.outline,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    ...shadows.soft,
  },
  itemTitle: { fontSize: 16, fontWeight: '700', color: palette.text },
  itemSubtitle: { fontSize: 13, color: palette.textMuted, marginTop: 2 },
  itemStatus: { fontSize: 12, color: palette.textMuted, marginTop: 6 },
  itemActions: { gap: spacing.sm, alignItems: 'flex-end' },
  deleteButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: '#ffe8e8',
  },
  deleteText: { color: palette.danger, fontWeight: '700' },
  empty: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { color: palette.text, fontSize: 16, fontWeight: '700' },
  emptySub: { color: palette.textMuted, marginTop: 4 },
  summaryGroup: {
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: palette.background,
    borderWidth: 1,
    borderColor: palette.outline,
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  summaryRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  summaryLabel: { width: 70, fontSize: 12, color: palette.textMuted, fontWeight: '700' },
  summaryText: { flex: 1, fontSize: 12, color: palette.text },
});
