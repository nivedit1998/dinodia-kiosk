import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { listAutomations, setAutomationEnabled, deleteAutomation, type AutomationSummary } from '../../api/automations';
import { useNavigation } from '@react-navigation/native';
import { useSession } from '../../store/sessionStore';

type Props = NativeStackScreenProps<any>;

export function AutomationsListScreen({}: Props) {
  const navigation = useNavigation();
  const { session, haMode } = useSession();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [automations, setAutomations] = useState<AutomationSummary[]>([]);

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

  const handleToggleEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      try {
        await setAutomationEnabled(id, !enabled, { haConnection: session.haConnection, mode: haMode });
        await refresh();
      } catch (err: any) {
        Alert.alert('Could not update', err?.message ?? 'Unable to toggle automation');
      }
    },
    [refresh]
  );

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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Home Automations</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => navigation.navigate('AutomationEditor' as never)}
        >
          <Text style={styles.addButtonText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" />
          <Text style={styles.loadingText}>Loading automations…</Text>
        </View>
      ) : error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={automations}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.item}
              onPress={() =>
                navigation.navigate('AutomationEditor' as never, { automationId: item.id, alias: item.alias, description: item.description } as never)
              }
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>{item.alias}</Text>
                {item.description ? <Text style={styles.itemSubtitle}>{item.description}</Text> : null}
                <Text style={styles.itemStatus}>{item.enabled ? 'Enabled' : 'Disabled'}</Text>
              </View>
              <View style={styles.itemActions}>
                <TouchableOpacity
                  style={[styles.smallBtn, { backgroundColor: '#e5e7eb' }]}
                  onPress={() => handleToggleEnabled(item.id, item.enabled)}
                >
                  <Text style={styles.smallBtnText}>{item.enabled ? 'Disable' : 'Enable'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.smallBtn, { backgroundColor: '#fee2e2' }]}
                  onPress={() => handleDelete(item.id)}
                >
                  <Text style={[styles.smallBtnText, { color: '#b91c1c' }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No automations yet.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f7', padding: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '700', color: '#111827' },
  addButton: {
    backgroundColor: '#111827',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  addButtonText: { color: '#fff', fontWeight: '700' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  loadingText: { color: '#6b7280' },
  errorBox: { padding: 12, borderRadius: 12, backgroundColor: '#fef2f2' },
  errorText: { color: '#b91c1c', marginBottom: 8 },
  retryBtn: {
    backgroundColor: '#111827',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  retryText: { color: '#fff', fontWeight: '700' },
  item: {
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  itemTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  itemSubtitle: { fontSize: 13, color: '#4b5563', marginTop: 2 },
  itemStatus: { fontSize: 12, color: '#6b7280', marginTop: 6 },
  itemActions: { gap: 6 },
  smallBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  smallBtnText: { fontWeight: '700', color: '#111827', fontSize: 12 },
  empty: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { color: '#6b7280' },
});
