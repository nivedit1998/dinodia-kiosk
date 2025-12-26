// src/screens/AdminHomeSetupScreen.tsx
import React, { useEffect, useMemo, useState } from 'react';
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
import { createTenant, deregisterProperty } from '../api/admin';
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

type SellingMode = 'FULL_RESET' | 'OWNER_TRANSFER';

const { InlineWifiSetupLauncher } = NativeModules as {
  InlineWifiSetupLauncher?: { open?: () => void };
};

export function AdminHomeSetupScreen() {
  const navigation = useNavigation<any>();
  const { session, haMode, setHaMode, resetApp } = useSession();
  const userId = session.user?.id;
  const { devices, error, refreshing, refreshDevices } = useDevices(userId || 0, haMode);
  const remoteAccess = useRemoteAccessStatus(haMode);
  const isCloud = haMode === 'cloud';
  const { wifiName, batteryLevel } = useDeviceStatus();
  const [menuVisible, setMenuVisible] = useState(false);

  const [tenantUsername, setTenantUsername] = useState('');
  const [tenantPassword, setTenantPassword] = useState('');
  const [tenantAreas, setTenantAreas] = useState<string[]>([]);
  const [tenantLoading, setTenantLoading] = useState(false);
  const [tenantMsg, setTenantMsg] = useState<string | null>(null);

  const [sellingMode, setSellingMode] = useState<SellingMode | null>(null);
  const [sellingLoading, setSellingLoading] = useState(false);
  const [sellingError, setSellingError] = useState<string | null>(null);
  const [claimCode, setClaimCode] = useState<string | null>(null);
  const [confirmArmed, setConfirmArmed] = useState(false);

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
      const result = await deregisterProperty(mode);
      setClaimCode(result.claimCode);
      setSellingMode(mode);
    } catch (err) {
      setSellingError(err instanceof Error ? err.message : 'We could not process this request.');
    } finally {
      setSellingLoading(false);
    }
  };

  const handleSavedClaim = async () => {
    await resetApp();
  };

  const handleLogout = async () => {
    await resetApp();
  };

  useEffect(() => {
    if (isCloud && remoteAccess.status === 'locked') {
      setHaMode('home');
    }
  }, [isCloud, remoteAccess.status, setHaMode]);

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
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Home setup - add tenant</Text>
            <TouchableOpacity
              onPress={() => void refreshDevices()}
              disabled={refreshing}
              style={styles.refreshButton}
            >
              <Text style={styles.refreshText}>{refreshing ? 'Refreshing...' : 'Refresh areas'}</Text>
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
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  container: {
    padding: spacing.xl,
    gap: spacing.lg,
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
  label: { fontSize: 12, color: palette.textMuted, fontWeight: '600' },
  refreshButton: {
    borderRadius: radii.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  refreshText: { fontSize: 12, color: palette.primary, fontWeight: '600' },
  areaSuggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  areaChip: {
    borderRadius: radii.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: palette.outline,
    backgroundColor: palette.surfaceMuted,
  },
  areaChipSelected: { backgroundColor: 'rgba(10,132,255,0.12)', borderColor: palette.primary },
  areaChipText: { fontSize: 12, color: palette.textMuted, fontWeight: '600' },
  areaChipTextSelected: { color: palette.primary },
  helperText: { fontSize: 12, color: palette.textMuted },
  successText: { color: palette.success, fontWeight: '600' },
  errorText: { color: palette.danger, fontWeight: '600' },
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
