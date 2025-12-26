// src/screens/AdminHomeSetupScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  NativeModules,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  createTenant,
  deleteTenant as deleteTenantApi,
  deregisterProperty,
  fetchSellingCleanupTargets,
  fetchTenants,
  updateTenantAreas,
  type TenantRecord,
} from '../api/admin';
import { useDevices } from '../store/deviceStore';
import { useSession } from '../store/sessionStore';
import { CloudModePrompt } from '../components/CloudModePrompt';
import { useRemoteAccessStatus } from '../hooks/useRemoteAccessStatus';
import { useDeviceStatus } from '../hooks/useDeviceStatus';
import { HeaderMenu } from '../components/HeaderMenu';
import { TopBar } from '../components/ui/TopBar';
import { maxContentWidth, palette, radii, spacing, typography } from '../ui/theme';
import { TextField } from '../components/ui/TextField';
import { PrimaryButton } from '../components/ui/PrimaryButton';
import { useCloudModeSwitch } from '../hooks/useCloudModeSwitch';
import { callHaService, probeHaReachability, type HaConnectionLike } from '../api/ha';
import { haWsCall } from '../api/haWebSocket';

type SellingMode = 'FULL_RESET' | 'OWNER_TRANSFER';
type TenantInfo = TenantRecord;
type TenantActionState = { saving: boolean; error: string | null };

const { InlineWifiSetupLauncher } = NativeModules as {
  InlineWifiSetupLauncher?: { open?: () => void };
};

const MAX_REGISTRY_REMOVALS = 200;

function buildHaCandidates(
  haConnection: { baseUrl: string; cloudUrl?: string | null; longLivedToken: string }
): HaConnectionLike[] {
  const candidates: HaConnectionLike[] = [];
  const seen = new Set<string>();
  const base = (haConnection.baseUrl || '').trim().replace(/\/+$/, '');
  const cloud = (haConnection.cloudUrl || '').trim().replace(/\/+$/, '');
  if (base) {
    candidates.push({ baseUrl: base, longLivedToken: haConnection.longLivedToken });
    seen.add(base);
  }
  if (cloud && !seen.has(cloud)) {
    candidates.push({ baseUrl: cloud, longLivedToken: haConnection.longLivedToken });
  }
  return candidates;
}

async function listHaAutomationIds(ha: HaConnectionLike): Promise<string[]> {
  const url = `${ha.baseUrl.replace(/\/+$/, '')}/api/config/automation`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${ha.longLivedToken}` },
  });
  if (!res.ok) return [];
  const json = await res.json().catch(() => []);
  if (!Array.isArray(json)) return [];
  return json
    .map((a: any) => (typeof a?.id === 'string' ? a.id.trim() : ''))
    .filter(Boolean);
}

async function deleteHaAutomation(ha: HaConnectionLike, id: string) {
  const url = `${ha.baseUrl.replace(/\/+$/, '')}/api/config/automation/config/${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ha.longLivedToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Failed to delete automation ${id}`);
  }
}

async function removeEntities(ha: HaConnectionLike, entityIds: string[]) {
  for (const id of entityIds) {
    try {
      await haWsCall(ha, 'config/entity_registry/remove', { entity_id: id });
    } catch {
      // continue; failures are tolerated
    }
  }
}

async function removeDevices(ha: HaConnectionLike, deviceIds: string[]) {
  for (const id of deviceIds) {
    try {
      await haWsCall(ha, 'config/device_registry/remove', { device_id: id });
    } catch {
      // continue; failures are tolerated
    }
  }
}

export function AdminHomeSetupScreen() {
  const navigation = useNavigation<any>();
  const { session, haMode, setHaMode, resetApp } = useSession();
  const userId = session.user?.id;
  const { devices, error, refreshing, refreshDevices } = useDevices(userId || 0, haMode);
  const remoteAccess = useRemoteAccessStatus(haMode);
  const tenantLocked = remoteAccess.status !== 'enabled';
  const isCloud = haMode === 'cloud';
  const { wifiName, batteryLevel } = useDeviceStatus();
  const [menuVisible, setMenuVisible] = useState(false);

  const [tenantUsername, setTenantUsername] = useState('');
  const [tenantPassword, setTenantPassword] = useState('');
  const [tenantAreas, setTenantAreas] = useState<string[]>([]);
  const [tenantLoading, setTenantLoading] = useState(false);
  const [tenantMsg, setTenantMsg] = useState<string | null>(null);
  const [viewTenantsOpen, setViewTenantsOpen] = useState(false);
  const [addTenantOpen, setAddTenantOpen] = useState(false);
  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(false);
  const [tenantsError, setTenantsError] = useState<string | null>(null);
  const [tenantAreaInputs, setTenantAreaInputs] = useState<Record<number, string>>({});
  const [tenantActions, setTenantActions] = useState<Record<number, TenantActionState>>({});

  const [sellingMode, setSellingMode] = useState<SellingMode | null>(null);
  const [sellingLoading, setSellingLoading] = useState(false);
  const [sellingError, setSellingError] = useState<string | null>(null);
  const [claimCode, setClaimCode] = useState<string | null>(null);
  const [confirmArmed, setConfirmArmed] = useState(false);
  const [cleanupStep, setCleanupStep] = useState<string | null>(null);

  const availableAreas = useMemo(() => {
    const set = new Set<string>();
    for (const device of devices) {
      const areaName = (device.area ?? device.areaName ?? '').trim();
      if (areaName) {
        set.add(areaName);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [devices]);

  const toggleArea = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setTenantAreas((prev) =>
      prev.includes(trimmed) ? prev.filter((area) => area !== trimmed) : [...prev, trimmed]
    );
  };

  const updateTenantActionState = (tenantId: number, updates: Partial<TenantActionState>) => {
    setTenantActions((prev) => ({
      ...prev,
      [tenantId]: { ...(prev[tenantId] ?? { saving: false, error: null }), ...updates },
    }));
  };

  const refreshTenants = useCallback(async () => {
    setTenantsLoading(true);
    setTenantsError(null);
    try {
      const list = await fetchTenants();
      setTenants(list);
      setTenantAreaInputs((prev) => {
        const next: Record<number, string> = {};
        list.forEach((t) => {
          next[t.id] = prev[t.id] ?? '';
        });
        return next;
      });
    } catch (err) {
      setTenantsError(err instanceof Error ? err.message : 'Failed to load tenants.');
    } finally {
      setTenantsLoading(false);
    }
  }, []);

  const ensureTenantsLoaded = useCallback(async () => {
    if (tenants.length === 0 && !tenantsLoading) {
      await refreshTenants();
    }
  }, [refreshTenants, tenants.length, tenantsLoading]);

  const handleRemoveTenantArea = async (tenant: TenantInfo, area: string) => {
    const nextAreas = tenant.areas.filter((a) => a !== area);
    updateTenantActionState(tenant.id, { saving: true, error: null });
    try {
      const updated = await updateTenantAreas(tenant.id, nextAreas);
      setTenants((prev) => prev.map((t) => (t.id === tenant.id ? updated : t)));
    } catch (err) {
      updateTenantActionState(tenant.id, {
        saving: false,
        error: err instanceof Error ? err.message : 'Failed to update areas.',
      });
      return;
    }
    updateTenantActionState(tenant.id, { saving: false, error: null });
  };

  const handleAddTenantArea = async (tenant: TenantInfo) => {
    const input = (tenantAreaInputs[tenant.id] ?? '').trim();
    if (!input || tenant.areas.includes(input)) return;
    const nextAreas = [...tenant.areas, input];
    updateTenantActionState(tenant.id, { saving: true, error: null });
    try {
      const updated = await updateTenantAreas(tenant.id, nextAreas);
      setTenants((prev) => prev.map((t) => (t.id === tenant.id ? updated : t)));
      setTenantAreaInputs((prev) => ({ ...prev, [tenant.id]: '' }));
    } catch (err) {
      updateTenantActionState(tenant.id, {
        saving: false,
        error: err instanceof Error ? err.message : 'Failed to update areas.',
      });
      return;
    }
    updateTenantActionState(tenant.id, { saving: false, error: null });
  };

  const handleDeleteTenant = (tenant: TenantInfo) => {
    Alert.alert(
      'Delete tenant',
      `Are you sure you want to delete ${tenant.username}? This removes their areas and devices added via Dinodia.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            updateTenantActionState(tenant.id, { saving: true, error: null });
            try {
              await deleteTenantApi(tenant.id);
              setTenants((prev) => prev.filter((t) => t.id !== tenant.id));
            } catch (err) {
              updateTenantActionState(tenant.id, {
                saving: false,
                error: err instanceof Error ? err.message : 'Failed to delete tenant.',
              });
              return;
            }
            updateTenantActionState(tenant.id, { saving: false, error: null });
          },
        },
      ]
    );
  };

  const handleCreateTenant = async () => {
    setTenantMsg(null);
    if (!tenantUsername.trim() || !tenantPassword) {
      setTenantMsg('Please enter a username and password.');
      return;
    }
    if (tenantAreas.length === 0) {
      setTenantMsg('Add at least one area this tenant can access.');
      return;
    }
    setTenantLoading(true);
    try {
      await createTenant({
        username: tenantUsername.trim(),
        password: tenantPassword,
        areas: tenantAreas,
      });
      setTenantMsg('Tenant created successfully.');
      setTenantUsername('');
      setTenantPassword('');
      setTenantAreas([]);
      if (viewTenantsOpen && !tenantLocked) {
        await refreshTenants();
      }
    } catch (err) {
      setTenantMsg(err instanceof Error ? err.message : 'We could not add that tenant right now.');
    } finally {
      setTenantLoading(false);
    }
  };

  const handleConfirmDeregister = async (mode: SellingMode) => {
    if (sellingLoading) return;
    if (!confirmArmed) {
      setConfirmArmed(true);
      return;
    }
    setSellingLoading(true);
    setSellingError(null);
    try {
      if (mode === 'FULL_RESET') {
        await runLocalFullResetCleanup();
      }
      const result = await deregisterProperty(mode, {
        cleanup: mode === 'FULL_RESET' ? 'device' : 'platform',
      });
      if (mode === 'OWNER_TRANSFER' && result.claimCode) {
        setClaimCode(result.claimCode);
        setSellingMode(mode);
      } else if (mode === 'FULL_RESET') {
        await resetApp();
      } else {
        throw new Error('We could not retrieve the claim code. Please try again.');
      }
    } catch (err) {
      setSellingError(err instanceof Error ? err.message : 'We could not process this request.');
    } finally {
      setSellingLoading(false);
      setCleanupStep(null);
    }
  };

  const handleSavedClaim = async () => {
    await resetApp();
  };

  const handleLogout = async () => {
    await resetApp();
  };

  const runLocalFullResetCleanup = useCallback(async () => {
    if (!session.haConnection) {
      throw new Error('Dinodia Hub connection is not configured.');
    }
    setCleanupStep('Fetching cleanup targets…');
    const targets = await fetchSellingCleanupTargets();
    const deviceIds = Array.isArray(targets.deviceIds)
      ? targets.deviceIds.filter((id) => typeof id === 'string' && id.trim()).slice(0, MAX_REGISTRY_REMOVALS)
      : [];
    const entityIds = Array.isArray(targets.entityIds)
      ? targets.entityIds.filter((id) => typeof id === 'string' && id.trim()).slice(0, MAX_REGISTRY_REMOVALS)
      : [];

    const candidates = buildHaCandidates(session.haConnection);
    if (candidates.length === 0) {
      throw new Error('Dinodia Hub connection is missing.');
    }

    let lastError: unknown = null;
    for (const ha of candidates) {
      const reachable = await probeHaReachability(ha).catch(() => false);
      if (!reachable) {
        lastError = new Error(`Could not reach Dinodia Hub at ${ha.baseUrl}`);
        continue;
      }
      try {
        setCleanupStep('Removing Dinodia automations…');
        const automationIds = await listHaAutomationIds(ha);
        const dinodiaIds = automationIds.filter((id) => id.toLowerCase().startsWith('dinodia_'));
        for (const id of dinodiaIds) {
          await deleteHaAutomation(ha, id);
        }

        setCleanupStep('Removing Dinodia devices…');
        if (entityIds.length > 0) {
          await removeEntities(ha, entityIds);
        }
        if (deviceIds.length > 0) {
          await removeDevices(ha, deviceIds);
        }

        setCleanupStep('Signing out cloud session…');
        await callHaService(ha, 'cloud', 'logout', {}, 4000).catch(() => undefined);
        setCleanupStep(null);
        return;
      } catch (err) {
        lastError = err;
      }
    }
    setCleanupStep(null);
    throw lastError instanceof Error
      ? lastError
      : new Error('Local cleanup failed. Please try again from your home network.');
  }, [session.haConnection]);

  useEffect(() => {
    if (!viewTenantsOpen || tenantLocked) return;
    void refreshTenants();
  }, [refreshTenants, tenantLocked, viewTenantsOpen]);

  const {
    promptVisible: cloudPromptVisible,
    checking: cloudChecking,
    result: cloudCheckResult,
    openPrompt: handleToggleMode,
    cancelPrompt: handleCancelCloud,
    confirmPrompt: handleConfirmCloud,
  } = useCloudModeSwitch({
    isCloud,
    onSwitchToCloud: () => setHaMode('cloud'),
    onSwitchToHome: () => setHaMode('home'),
    haConnection: session.haConnection,
  });

  const handleOpenWifiSetup = () => {
    if (InlineWifiSetupLauncher && typeof InlineWifiSetupLauncher.open === 'function') {
      InlineWifiSetupLauncher.open();
    } else {
      Alert.alert('Wi-Fi', 'Wi-Fi setup is not available on this device.');
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <TopBar
        mode={haMode}
        activeTab="homeSetup"
        tabs={[
          { key: 'dashboard', label: 'Dashboard' },
          { key: 'automations', label: 'Automations' },
          { key: 'homeSetup', label: 'Home Setup' },
        ]}
        onPressMenu={() => setMenuVisible(true)}
        onPressMode={handleToggleMode}
        wifiName={wifiName}
        batteryLevel={batteryLevel}
        onPressWifi={handleOpenWifiSetup}
        onChangeTab={(tab) => {
          if (tab === 'dashboard') {
            navigation.getParent()?.navigate('DashboardTab', {
              screen: 'AdminDashboard' as never,
            });
            return;
          }
          if (tab === 'automations') {
            navigation.getParent()?.navigate('AutomationsTab', {
              screen: 'AutomationsList' as never,
            });
          }
        }}
      />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.header}>Home setup</Text>
        <Text style={styles.subheader}>Admin only</Text>

        <View style={styles.section}>
          <TouchableOpacity
            style={styles.collapseHeader}
            activeOpacity={0.85}
            onPress={() => {
              const next = !viewTenantsOpen;
              setViewTenantsOpen(next);
              if (next && !tenantLocked) {
                void ensureTenantsLoaded();
              }
            }}
          >
            <Text style={styles.sectionTitle}>Home setup - view tenants</Text>
            <Text style={styles.collapseToggle}>{viewTenantsOpen ? 'Hide' : 'Show'}</Text>
          </TouchableOpacity>
          {tenantLocked ? (
            <Text style={styles.lockBanner}>
              {remoteAccess.message ??
                'Remote access must be enabled before managing tenants from this device.'}
            </Text>
          ) : null}
          {viewTenantsOpen ? (
            <View
              style={[
                styles.sectionBody,
                tenantLocked && styles.sectionDisabled,
              ]}
              pointerEvents={tenantLocked ? 'none' : 'auto'}
            >
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.helperText}>
                  View tenants in this home and update their areas.
                </Text>
                <TouchableOpacity
                  onPress={() => void refreshTenants()}
                  disabled={tenantsLoading || tenantLocked}
                  style={styles.refreshButton}
                >
                  <Text style={styles.refreshText}>
                    {tenantsLoading ? 'Refreshing...' : 'Refresh'}
                  </Text>
                </TouchableOpacity>
              </View>
              {tenantsError ? <Text style={styles.errorText}>{tenantsError}</Text> : null}
              {tenantsLoading ? (
                <Text style={styles.helperText}>Loading tenants…</Text>
              ) : tenants.length === 0 ? (
                <Text style={styles.helperText}>No tenants yet.</Text>
              ) : (
                <View style={styles.tenantList}>
                  {tenants.map((tenant) => {
                    const state = tenantActions[tenant.id] ?? { saving: false, error: null };
                    const areaInput = tenantAreaInputs[tenant.id] ?? '';
                    const suggestions = availableAreas.filter(
                      (a) => !tenant.areas.includes(a)
                    );
                    return (
                      <View key={tenant.id} style={styles.tenantCard}>
                        <View style={styles.tenantHeaderRow}>
                          <Text style={styles.tenantName}>{tenant.username}</Text>
                          <TouchableOpacity
                            onPress={() => handleDeleteTenant(tenant)}
                            disabled={state.saving}
                            style={styles.deleteButton}
                          >
                            <Text style={styles.deleteText}>Delete</Text>
                          </TouchableOpacity>
                        </View>
                        <Text style={styles.label}>Areas</Text>
                        <View style={styles.areaSuggestions}>
                          {tenant.areas.length > 0 ? (
                            tenant.areas.map((area) => (
                              <TouchableOpacity
                                key={area}
                                style={styles.areaChip}
                                onPress={() => void handleRemoveTenantArea(tenant, area)}
                                disabled={state.saving}
                              >
                                <Text style={styles.areaChipText}>{area}</Text>
                                <Text style={styles.removeChip}>x</Text>
                              </TouchableOpacity>
                              ))
                            ) : (
                              <Text style={styles.helperText}>No areas assigned.</Text>
                            )}
                        </View>

                        <Text style={styles.label}>Add area</Text>
                        {suggestions.length > 0 ? (
                          <View style={styles.areaSuggestions}>
                            {suggestions.map((area) => (
                              <TouchableOpacity
                                key={area}
                                style={[
                                  styles.areaChipSmall,
                                  areaInput === area && styles.areaChipSelected,
                                ]}
                                onPress={() =>
                                  setTenantAreaInputs((prev) => ({ ...prev, [tenant.id]: area }))
                                }
                                activeOpacity={0.85}
                              >
                                <Text
                                  style={[
                                    styles.areaChipText,
                                    areaInput === area && styles.areaChipTextSelected,
                                  ]}
                                >
                                  {area}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        ) : (
                          <Text style={styles.helperText}>No unassigned areas available.</Text>
                        )}
                        {state.error ? <Text style={styles.errorText}>{state.error}</Text> : null}
                        <PrimaryButton
                          title={state.saving ? 'Saving…' : 'Add area'}
                          onPress={() => void handleAddTenantArea(tenant)}
                          disabled={state.saving || !areaInput.trim()}
                          style={styles.compactButton}
                        />
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <TouchableOpacity
            style={styles.collapseHeader}
            activeOpacity={0.85}
            onPress={() => setAddTenantOpen((prev) => !prev)}
          >
            <Text style={styles.sectionTitle}>Home setup - add tenant</Text>
            <Text style={styles.collapseToggle}>{addTenantOpen ? 'Hide' : 'Show'}</Text>
          </TouchableOpacity>
          {tenantLocked ? (
            <Text style={styles.lockBanner}>
              {remoteAccess.message ??
                'Remote access must be enabled before adding tenants from this device.'}
            </Text>
          ) : null}
          {addTenantOpen ? (
            <View
              style={[
                styles.sectionBody,
                tenantLocked && styles.sectionDisabled,
              ]}
              pointerEvents={tenantLocked ? 'none' : 'auto'}
            >
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.helperText}>Create a new tenant and assign their rooms.</Text>
                <TouchableOpacity
                  onPress={() => void refreshDevices()}
                  disabled={refreshing}
                  style={styles.refreshButton}
                >
                  <Text style={styles.refreshText}>
                    {refreshing ? 'Refreshing...' : 'Refresh areas'}
                  </Text>
                </TouchableOpacity>
              </View>

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <TextField
                label="Tenant username"
                placeholder="tenant@example.com"
                autoCapitalize="none"
                value={tenantUsername}
                onChangeText={setTenantUsername}
                keyboardType="email-address"
              />
              <TextField
                label="Tenant password"
                placeholder="********"
                secureTextEntry
                secureToggle
                value={tenantPassword}
                onChangeText={setTenantPassword}
              />

              <Text style={styles.label}>Select rooms</Text>
              {availableAreas.length > 0 ? (
                <View style={styles.areaSuggestions}>
                  {availableAreas.map((area) => (
                    <TouchableOpacity
                      key={area}
                      style={[
                        styles.areaChip,
                        tenantAreas.includes(area) && styles.areaChipSelected,
                      ]}
                      onPress={() => toggleArea(area)}
                      activeOpacity={0.85}
                    >
                      <Text
                        style={[
                          styles.areaChipText,
                          tenantAreas.includes(area) && styles.areaChipTextSelected,
                        ]}
                      >
                        {area}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <Text style={styles.helperText}>No areas available yet. Add devices to create areas.</Text>
              )}

              {tenantMsg ? (
                <Text style={tenantMsg.includes('success') ? styles.successText : styles.errorText}>
                  {tenantMsg}
                </Text>
              ) : null}

              <PrimaryButton
                title={tenantLoading ? 'Adding...' : 'Add tenant'}
                onPress={() => void handleCreateTenant()}
                disabled={tenantLoading}
                style={[styles.compactButton, { marginTop: spacing.sm }]}
              />
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Deregister Property</Text>

          {claimCode ? (
            <View style={styles.claimBox}>
              <Text style={styles.claimTitle}>Your claim code</Text>
              <Text style={styles.claimCode}>{claimCode}</Text>
              <Text style={styles.helperText}>
                Save this code to transfer or reset the property.
              </Text>
              <PrimaryButton
                title="I saved the code"
                onPress={handleSavedClaim}
                style={styles.compactButton}
              />
            </View>
          ) : (
            <>
              <TouchableOpacity
                style={[
                  styles.deregisterOption,
                  sellingMode === 'FULL_RESET' && styles.deregisterSelected,
                ]}
                onPress={() => {
                  setSellingMode('FULL_RESET');
                  setConfirmArmed(false);
                }}
                activeOpacity={0.85}
                disabled={sellingLoading}
              >
                <Text style={styles.optionTitle}>
                  Deregister your whole household (Homeowner + Occupiers)
                </Text>
                <Text style={styles.optionText}>
                  Fully reset this home so the next owner starts fresh.
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.deregisterOption,
                  sellingMode === 'OWNER_TRANSFER' && styles.deregisterSelected,
                ]}
                onPress={() => {
                  setSellingMode('OWNER_TRANSFER');
                  setConfirmArmed(false);
                }}
                activeOpacity={0.85}
                disabled={sellingLoading}
              >
                <Text style={styles.optionTitle}>
                  Deregister yourself but keep all occupiers control active
                </Text>
                <Text style={styles.optionText}>
                  Remove your ownership while keeping tenant devices and automations.
                </Text>
              </TouchableOpacity>

              {sellingMode ? (
                <View style={styles.confirmBox}>
                  <Text style={styles.confirmTitle}>
                    {confirmArmed ? 'Are you sure?' : 'Please confirm'}
                  </Text>
                  <Text style={styles.confirmText}>
                    {sellingMode === 'FULL_RESET'
                      ? 'This will remove all tenant devices, automations, alexa links and accounts and fully reset your Dinodia home.'
                      : 'This will remove your property but keep all tenants, devices, automations, and integrations.'}
                  </Text>
                  {cleanupStep ? <Text style={styles.helperText}>{cleanupStep}</Text> : null}
                  <View style={styles.confirmActions}>
                    <PrimaryButton
                      title={sellingLoading ? 'Working...' : confirmArmed ? "Yes, I'm sure" : 'Yes'}
                      onPress={() => void handleConfirmDeregister(sellingMode)}
                      variant="danger"
                      disabled={sellingLoading}
                      style={styles.compactButton}
                    />
                    <PrimaryButton
                      title="Cancel"
                      onPress={() => {
                        setSellingMode(null);
                        setConfirmArmed(false);
                      }}
                      variant="ghost"
                      style={[styles.compactButton, styles.cancelButton]}
                      disabled={sellingLoading}
                    />
                  </View>
                  {sellingError ? <Text style={styles.errorText}>{sellingError}</Text> : null}
                </View>
              ) : null}
            </>
          )}
        </View>
      </ScrollView>
      <HeaderMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        onLogout={handleLogout}
        onRemoteAccess={() => {
          setMenuVisible(false);
          navigation.navigate('RemoteAccessSetup' as never);
        }}
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  container: {
    padding: spacing.xl,
    gap: spacing.md,
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
  },
  header: { ...typography.heading, letterSpacing: 0.2 },
  subheader: { color: palette.textMuted, lineHeight: 18 },
  section: {
    backgroundColor: palette.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: palette.outline,
    gap: spacing.sm,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: palette.text },
  collapseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  collapseToggle: { fontSize: 12, color: palette.textMuted, fontWeight: '600' },
  lockBanner: {
    marginTop: spacing.sm,
    backgroundColor: '#fef3c7',
    borderColor: '#fcd34d',
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.sm,
    color: '#92400e',
    fontSize: 12,
    fontWeight: '600',
  },
  sectionBody: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  sectionDisabled: { opacity: 0.5 },
  label: { fontSize: 12, color: palette.textMuted, fontWeight: '600' },
  refreshButton: {
    borderRadius: radii.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  refreshText: { fontSize: 12, color: palette.primary, fontWeight: '600' },
  areaSuggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  areaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: palette.outline,
    backgroundColor: palette.surfaceMuted,
  },
  areaChipSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: palette.outline,
    backgroundColor: palette.surface,
  },
  areaChipSelected: { backgroundColor: 'rgba(10,132,255,0.12)', borderColor: palette.primary },
  areaChipText: { fontSize: 12, color: palette.textMuted, fontWeight: '600' },
  areaChipTextSelected: { color: palette.primary },
  removeChip: { marginLeft: spacing.xs, color: palette.textMuted, fontWeight: '700' },
  helperText: { fontSize: 12, color: palette.textMuted },
  successText: { color: palette.success, fontWeight: '600' },
  errorText: { color: palette.danger, fontWeight: '600' },
  tenantList: { gap: spacing.sm },
  tenantCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: spacing.md,
    backgroundColor: palette.surface,
    gap: spacing.xs,
  },
  tenantHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tenantName: { fontSize: 14, fontWeight: '700', color: palette.text },
  deleteButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: '#fecdd3',
    backgroundColor: '#fff1f2',
  },
  deleteText: { color: palette.danger, fontWeight: '700', fontSize: 12 },
  claimBox: {
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: palette.outline,
    backgroundColor: palette.surfaceMuted,
    gap: spacing.sm,
  },
  claimTitle: { fontSize: 14, fontWeight: '700', color: palette.text },
  claimCode: { fontSize: 24, fontWeight: '800', color: palette.primary },
  deregisterOption: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.outline,
    padding: spacing.lg,
    backgroundColor: palette.surfaceMuted,
    marginTop: spacing.sm,
  },
  deregisterSelected: { borderColor: palette.primary, backgroundColor: 'rgba(10,132,255,0.08)' },
  optionTitle: { fontSize: 14, fontWeight: '700', color: palette.text },
  optionText: { fontSize: 12, color: palette.textMuted, marginTop: 4 },
  confirmBox: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: '#fde68a',
    backgroundColor: '#fffbeb',
    padding: spacing.lg,
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  confirmTitle: { fontSize: 14, fontWeight: '700', color: '#92400e' },
  confirmText: { fontSize: 12, color: '#92400e' },
  confirmActions: { flexDirection: 'row', gap: spacing.sm },
  cancelButton: {
    backgroundColor: palette.surfaceMuted,
    borderColor: palette.outline,
  },
  compactButton: {
    paddingVertical: spacing.sm,
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
});
