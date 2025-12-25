// src/screens/TenantAddDevicesScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  NativeModules,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  StyleProp,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../api/supabaseClient';
import type { HaConnectionLike } from '../api/ha';
import { listHaStates } from '../api/ha';
import { assignHaAreaToDevices } from '../api/haAreas';
import {
  abortConfigFlow,
  buildMatterUserInput,
  continueConfigFlow,
  startConfigFlow,
  type HaConfigFlowStep,
} from '../api/haConfigFlow';
import { applyHaLabel, listHaLabels, type HaLabel } from '../api/haLabels';
import {
  diffRegistrySnapshots,
  fetchRegistrySnapshot,
  type RegistrySnapshot,
} from '../api/haRegistry';
import { CAPABILITIES } from '../capabilities/deviceCapabilities';
import { HeaderMenu } from '../components/HeaderMenu';
import { RemoteAccessLocked } from '../components/RemoteAccessLocked';
import { TextField } from '../components/ui/TextField';
import { TopBar } from '../components/ui/TopBar';
import { useDeviceStatus } from '../hooks/useDeviceStatus';
import { useRemoteAccessStatus } from '../hooks/useRemoteAccessStatus';
import { logoutRemote } from '../api/auth';
import { useSession } from '../store/sessionStore';
import { palette, radii, shadows, spacing, typography, maxContentWidth } from '../ui/theme';

const { InlineWifiSetupLauncher, QrScanner } = NativeModules as {
  InlineWifiSetupLauncher?: { open?: () => void };
  QrScanner?: { open?: () => Promise<string> };
};

const steps = ['Area', 'Pairing code', 'Metadata', 'Wi-Fi', 'Progress'];

type FlowType = 'matter' | null;

type MatterStatus = 'NEEDS_INPUT' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';

type MatterSession = {
  id: string;
  status: MatterStatus;
  requestedArea: string;
  requestedName: string | null;
  requestedDinodiaType: string | null;
  requestedHaLabelId: string | null;
  haFlowId: string | null;
  error: string | null;
  lastHaStep?: HaConfigFlowStep | null;
  newDeviceIds: string[];
  newEntityIds: string[];
  isFinal?: boolean;
};

type LabelOption = HaLabel;

function deriveStatusFromFlowStep(step: HaConfigFlowStep): MatterStatus {
  switch (step.type) {
    case 'form':
      return 'NEEDS_INPUT';
    case 'progress':
      return 'IN_PROGRESS';
    case 'create_entry':
      return 'SUCCEEDED';
    case 'abort':
      return 'FAILED';
    default:
      return 'IN_PROGRESS';
  }
}

function buildStatusMessage(session: MatterSession | null) {
  if (!session) return 'Waiting to start commissioning...';
  if (session.status === 'SUCCEEDED') return 'Commissioning completed';
  if (session.status === 'FAILED') return session.error || 'Commissioning failed';
  if (session.status === 'CANCELED') return 'Commissioning was canceled';
  const lastStep = session.lastHaStep;
  if (lastStep?.progress_action === 'wait') return 'Home Assistant is configuring the device...';
  if (lastStep?.type === 'progress') return 'Commissioning in progress...';
  if (lastStep?.type === 'form') return 'Waiting for pairing details...';
  return 'Contacting Home Assistant...';
}

type SimpleButtonVariant = 'default' | 'primary' | 'danger';

type SimpleButtonProps = {
  title: string;
  onPress: () => void;
  variant?: SimpleButtonVariant;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

function SimpleButton({ title, onPress, variant = 'default', disabled, style }: SimpleButtonProps) {
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      disabled={disabled}
      style={[
        styles.simpleButton,
        isPrimary && styles.simpleButtonPrimary,
        isDanger && styles.simpleButtonDanger,
        disabled && styles.simpleButtonDisabled,
        style,
      ]}
    >
      <Text
        style={[
          styles.simpleButtonText,
          isPrimary && styles.simpleButtonTextPrimary,
          isDanger && styles.simpleButtonTextDanger,
          disabled && styles.simpleButtonTextDisabled,
        ]}
      >
        {title}
      </Text>
    </TouchableOpacity>
  );
}

export function TenantAddDevicesScreen() {
  const navigation = useNavigation<any>();
  const { session, haMode, setHaMode, clearSession } = useSession();
  const userId = session.user?.id ?? null;
  const remoteAccess = useRemoteAccessStatus(haMode);
  const { wifiName, batteryLevel } = useDeviceStatus();
  const isCloud = haMode === 'cloud';
  const resolvedHa = useMemo<HaConnectionLike | null>(() => {
    const conn = session.haConnection;
    if (!conn) return null;
    const raw = haMode === 'cloud' ? conn.cloudUrl : conn.baseUrl;
    const base = (raw ?? '').trim();
    if (!base) return null;
    return {
      baseUrl: base.replace(/\/+$/, ''),
      longLivedToken: conn.longLivedToken,
    };
  }, [haMode, session.haConnection]);
  const [menuVisible, setMenuVisible] = useState(false);
  const [activeFlow, setActiveFlow] = useState<FlowType>(null);

  const [areas, setAreas] = useState<string[]>([]);
  const [areasLoading, setAreasLoading] = useState(false);
  const [areasError, setAreasError] = useState<string | null>(null);
  const [selectedArea, setSelectedArea] = useState('');

  const [currentStep, setCurrentStep] = useState(0);
  const [pairingCode, setPairingCode] = useState('');
  const [requestedName, setRequestedName] = useState('');
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [selectedHaLabelId, setSelectedHaLabelId] = useState<string | null>(null);
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [sessionState, setSessionState] = useState<MatterSession | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [labels, setLabels] = useState<LabelOption[]>([]);
  const [labelsLoading, setLabelsLoading] = useState(false);
  const [labelsError, setLabelsError] = useState<string | null>(null);
  const [typePickerVisible, setTypePickerVisible] = useState(false);
  const [labelPickerVisible, setLabelPickerVisible] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const beforeSnapshotRef = useRef<RegistrySnapshot | null>(null);

  const capabilityOptions = useMemo(
    () => Object.keys(CAPABILITIES).sort((a, b) => a.localeCompare(b)),
    []
  );

  const selectedLabelName = useMemo(() => {
    if (!selectedHaLabelId) return null;
    return labels.find((l) => l.label_id === selectedHaLabelId)?.name ?? null;
  }, [labels, selectedHaLabelId]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    async function loadAreas() {
      setAreasLoading(true);
      setAreasError(null);
      try {
        const { data, error: fetchError } = await supabase
          .from('AccessRule')
          .select('area')
          .eq('userId', userId);
        if (fetchError) throw fetchError;
        const list = Array.from(
          new Set((data ?? []).map((row: { area: string }) => row.area).filter(Boolean))
        ).sort((a, b) => a.localeCompare(b));
        if (!active) return;
        setAreas(list);
      } catch (err) {
        if (!active) return;
        setAreasError(
          err instanceof Error ? err.message : 'Unable to load your shared areas right now.'
        );
      } finally {
        if (active) setAreasLoading(false);
      }
    }
    void loadAreas();
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    if (areas.length > 0 && !areas.includes(selectedArea)) {
      setSelectedArea(areas[0]);
    }
    if (areas.length === 0) {
      setSelectedArea('');
    }
  }, [areas, selectedArea]);

  useEffect(() => {
    let active = true;
    async function loadLabels() {
      if (!resolvedHa) {
        setLabels([]);
        setLabelsError('Dinodia Hub connection is not configured for this mode.');
        setLabelsLoading(false);
        return;
      }
      setLabelsLoading(true);
      setLabelsError(null);
      try {
        const list = await listHaLabels(resolvedHa);
        if (!active) return;
        setLabels(list);
      } catch (err) {
        if (!active) return;
        setLabelsError(
          err instanceof Error ? err.message : 'Home Assistant labels are unavailable right now.'
        );
      } finally {
        if (active) setLabelsLoading(false);
      }
    }
    void loadLabels();
    return () => {
      active = false;
    };
  }, [resolvedHa]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const pollSession = (flowId: string) => {
    if (!resolvedHa) return;
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const step = await continueConfigFlow(resolvedHa, flowId, {});
        const nextStatus = deriveStatusFromFlowStep(step);
        const nextSession: MatterSession = {
          id: flowId,
          status: nextStatus,
          requestedArea: selectedArea,
          requestedName: requestedName.trim() || null,
          requestedDinodiaType: selectedType,
          requestedHaLabelId: selectedHaLabelId,
          haFlowId: flowId,
          error:
            nextStatus === 'FAILED'
              ? step.errors
                ? Object.values(step.errors).filter(Boolean).join(', ')
                : 'Home Assistant aborted the commissioning flow.'
              : null,
          lastHaStep: step,
          newDeviceIds: sessionState?.newDeviceIds ?? [],
          newEntityIds: sessionState?.newEntityIds ?? [],
          isFinal: nextStatus === 'SUCCEEDED' || nextStatus === 'FAILED' || nextStatus === 'CANCELED',
        };
        setSessionState(nextSession);
        if (nextSession.isFinal) {
          stopPolling();
          if (nextSession.status === 'SUCCEEDED') {
            setCurrentStep(4);
            void finalizeCommissioning(nextSession);
          }
        }
      } catch {
        // Ignore polling errors.
      }
    }, 3000);
  };

  const resetWizard = useCallback(() => {
    stopPolling();
    beforeSnapshotRef.current = null;
    setSessionState(null);
    setWarnings([]);
    setError(null);
    setPairingCode('');
    setRequestedName('');
    setSelectedType(null);
    setSelectedHaLabelId(null);
    setWifiSsid('');
    setWifiPassword('');
    setCurrentStep(0);
  }, []);

  const finalizeCommissioning = useCallback(
    async (nextSession: MatterSession) => {
      if (!resolvedHa || !session.haConnection) return;
      const warningsList: string[] = [];

      let afterSnapshot: RegistrySnapshot | null = null;
      try {
        afterSnapshot = await fetchRegistrySnapshot(resolvedHa);
      } catch (err) {
        warningsList.push(
          err instanceof Error ? err.message : 'Unable to capture the final device registry snapshot.'
        );
      }

      const diff = diffRegistrySnapshots(beforeSnapshotRef.current, afterSnapshot);
      if (diff.newEntityIds.length === 0) {
        warningsList.push('No new entities were detected yet. Check Home Assistant if devices appear.');
      }

      try {
        const states = await listHaStates(resolvedHa);
        const nameMap = new Map<string, string>();
        for (const st of states) {
          const entityId = st.entity_id;
          const friendly =
            typeof st.attributes?.friendly_name === 'string' && st.attributes.friendly_name.trim().length > 0
              ? st.attributes.friendly_name.trim()
              : entityId;
          nameMap.set(entityId, friendly);
        }
        if (diff.newEntityIds.length > 0) {
          const overrideRows = diff.newEntityIds.map((entityId) => ({
            haConnectionId: session.haConnection!.id,
            entityId,
            name: requestedName.trim() || nameMap.get(entityId) || entityId,
            area: selectedArea,
            label: selectedType ?? null,
          }));
          const { error: upsertError } = await supabase.from('Device').upsert(overrideRows, {
            onConflict: 'haConnectionId,entityId',
          } as any);
          if (upsertError) {
            warningsList.push(upsertError.message || 'Could not save device overrides.');
          }
        }
      } catch (err) {
        warningsList.push(
          err instanceof Error ? err.message : 'Could not update device overrides.'
        );
      }

      if (selectedHaLabelId) {
        const labelResult = await applyHaLabel(resolvedHa, selectedHaLabelId, diff);
        if (!labelResult.ok && labelResult.warning) {
          warningsList.push(labelResult.warning);
        }
      }

      const areaResult = await assignHaAreaToDevices(resolvedHa, selectedArea, diff.newDeviceIds);
      if (!areaResult.ok && areaResult.warning) {
        warningsList.push(areaResult.warning);
      }

      setWarnings((prev) => [...prev, ...warningsList]);
      setSessionState({
        ...nextSession,
        newDeviceIds: diff.newDeviceIds,
        newEntityIds: diff.newEntityIds,
        isFinal: true,
      });
    },
    [resolvedHa, requestedName, selectedArea, selectedType, selectedHaLabelId, session.haConnection]
  );

  const handleStartCommissioning = async () => {
    setError(null);
    setWarnings([]);
    if (!selectedArea) {
      setError('Please choose an area.');
      return;
    }
    if (!pairingCode.trim()) {
      setError('Pairing code is required.');
      return;
    }
    if (!wifiSsid.trim() || !wifiPassword.trim()) {
      setError('Wi-Fi credentials are required.');
      return;
    }
    if (!resolvedHa) {
      setError('Dinodia Hub connection is not configured for this mode.');
      return;
    }

    setIsSubmitting(true);
    try {
      beforeSnapshotRef.current = null;
      try {
        beforeSnapshotRef.current = await fetchRegistrySnapshot(resolvedHa);
      } catch {
        // Snapshot is optional, continue without blocking.
      }

      const firstStep = await startConfigFlow(resolvedHa, 'matter', { showAdvanced: true });
      const flowId = firstStep.flow_id;
      if (!flowId) {
        throw new Error('Commissioning flow could not be started.');
      }
      const initialStatus = deriveStatusFromFlowStep(firstStep);
      const initialSession: MatterSession = {
        id: flowId,
        status: initialStatus,
        requestedArea: selectedArea,
        requestedName: requestedName.trim() || null,
        requestedDinodiaType: selectedType,
        requestedHaLabelId: selectedHaLabelId,
        haFlowId: flowId,
        error: null,
        lastHaStep: firstStep,
        newDeviceIds: [],
        newEntityIds: [],
        isFinal: false,
      };
      setSessionState(initialSession);
      setCurrentStep(4);

      const userInput = buildMatterUserInput(firstStep, {
        pairingCode,
        wifiSsid,
        wifiPassword,
      });
      const step = await continueConfigFlow(resolvedHa, flowId, userInput);
      const stepStatus = deriveStatusFromFlowStep(step);
      const nextSession: MatterSession = {
        ...initialSession,
        status: stepStatus,
        lastHaStep: step,
        error:
          stepStatus === 'FAILED'
            ? step.errors
              ? Object.values(step.errors).filter(Boolean).join(', ')
              : 'Home Assistant aborted the commissioning flow.'
            : null,
      };
      setWifiPassword('');
      setSessionState(nextSession);

      if (stepStatus === 'SUCCEEDED') {
        stopPolling();
        await finalizeCommissioning(nextSession);
      } else if (stepStatus === 'FAILED') {
        setCurrentStep(3);
      } else {
        pollSession(flowId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start commissioning.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelSession = async () => {
    if (!sessionState || !sessionState.haFlowId || !resolvedHa) return;
    try {
      stopPolling();
      await abortConfigFlow(resolvedHa, sessionState.haFlowId);
      setSessionState({
        ...sessionState,
        status: 'CANCELED',
        error: 'Commissioning was canceled by the user.',
        isFinal: true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to cancel commissioning right now.');
    }
  };

  const handleScanQr = async () => {
    setScanError(null);
    if (!QrScanner || typeof QrScanner.open !== 'function') {
      setScanError('QR scanning is not available on this device.');
      return;
    }
    if (scanning) return;
    setScanning(true);
    try {
      const result = await QrScanner.open();
      if (typeof result === 'string' && result.trim().length > 0) {
        setPairingCode(result.trim());
      } else {
        setScanError('No QR code was detected.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to scan QR code.';
      if (!message.toLowerCase().includes('cancel')) {
        setScanError(message);
      }
    } finally {
      setScanning(false);
    }
  };

  const handleOpenWifiSetup = () => {
    if (InlineWifiSetupLauncher && typeof InlineWifiSetupLauncher.open === 'function') {
      InlineWifiSetupLauncher.open();
    } else {
      Alert.alert('Wi-Fi', 'Wi-Fi setup is not available on this device.');
    }
  };

  const handleLogout = async () => {
    await logoutRemote().catch(() => undefined);
    await clearSession();
  };

  const handleToggleMode = () => {
    setHaMode(isCloud ? 'home' : 'cloud');
  };

  if (isCloud && remoteAccess.status !== 'enabled') {
    const message =
      remoteAccess.message || 'Page unlocked when remote access is enabled by homeowner.';
    return (
      <SafeAreaView style={styles.screen}>
        <RemoteAccessLocked message={message} onBackHome={handleToggleMode} />
      </SafeAreaView>
    );
  }

  const statusMessage = buildStatusMessage(sessionState);

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <View style={styles.stepSection}>
            <Text style={styles.bodyText}>
              Choose where this device should appear for you. You can only place devices in areas you
              have access to.
            </Text>
            {areasLoading ? <Text style={styles.helperText}>Loading areas...</Text> : null}
            {areasError ? <Text style={styles.errorText}>{areasError}</Text> : null}
            <View style={styles.areaSuggestions}>
              {areas.map((area) => (
                <TouchableOpacity
                  key={area}
                  style={[styles.areaChip, selectedArea === area && styles.areaChipSelected]}
                  onPress={() => setSelectedArea(area)}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      styles.areaChipText,
                      selectedArea === area && styles.areaChipTextSelected,
                    ]}
                  >
                    {area}
                  </Text>
                </TouchableOpacity>
              ))}
              {areas.length === 0 && !areasLoading ? (
                <View style={styles.emptyState}>
                  <Text style={styles.helperText}>
                    No areas have been shared with you yet. Ask the homeowner to grant access.
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        );
      case 1:
        return (
          <View style={styles.stepSection}>
            <Text style={styles.bodyText}>
              Enter the Matter pairing code. You can find it on the device or its packaging.
            </Text>
            <SimpleButton
              title={scanning ? 'Opening camera...' : 'Scan QR code'}
              onPress={() => void handleScanQr()}
              disabled={scanning}
              style={styles.scanButton}
            />
            {scanError ? <Text style={styles.errorText}>{scanError}</Text> : null}
            <TextField
              label="Pairing code"
              placeholder="MT:..."
              value={pairingCode}
              onChangeText={setPairingCode}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        );
      case 2:
        return (
          <View style={styles.stepSection}>
            <TextField
              label="Optional name"
              placeholder="Give this device a friendly name"
              value={requestedName}
              onChangeText={setRequestedName}
            />
            <View style={styles.selectBlock}>
              <Text style={styles.label}>Dinodia device type override</Text>
              <TouchableOpacity
                style={styles.selectButton}
                onPress={() => setTypePickerVisible(true)}
                activeOpacity={0.85}
              >
                <Text style={styles.selectButtonText}>
                  {selectedType || 'Choose type (optional)'}
                </Text>
              </TouchableOpacity>
              <Text style={styles.helperText}>
                This controls how the device tile behaves in the dashboard.
              </Text>
            </View>
            <View style={styles.selectBlock}>
              <Text style={styles.label}>Home Assistant label</Text>
              <TouchableOpacity
                style={styles.selectButton}
                onPress={() => {
                  if (!labelsLoading) setLabelPickerVisible(true);
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.selectButtonText}>
                  {labelsLoading
                    ? 'Loading labels...'
                    : labelsError
                    ? 'Labels unavailable'
                    : selectedLabelName || 'Choose label (optional)'}
                </Text>
              </TouchableOpacity>
              {labelsError ? <Text style={styles.helperText}>{labelsError}</Text> : null}
            </View>
          </View>
        );
      case 3:
        return (
          <View style={styles.stepSection}>
            <Text style={styles.bodyText}>
              Enter the Wi-Fi credentials for the network your Matter device should join. We only send
              these to Home Assistant for commissioning and do not store them.
            </Text>
            <TextField
              label="Wi-Fi name (SSID)"
              placeholder="Network name"
              value={wifiSsid}
              onChangeText={setWifiSsid}
              autoCapitalize="none"
            />
            <TextField
              label="Wi-Fi password"
              placeholder="********"
              secureTextEntry
              secureToggle
              value={wifiPassword}
              onChangeText={setWifiPassword}
            />
          </View>
        );
      case 4:
      default:
        return (
          <View style={styles.stepSection}>
            <Text style={styles.bodyText}>
              We are sending the pairing request to Home Assistant. Keep this page open until it finishes.
            </Text>
            <View style={styles.statusCard}>
              <Text style={styles.statusText}>{statusMessage}</Text>
            </View>
            {warnings.length > 0 ? (
              <View style={styles.warningCard}>
                <Text style={styles.warningTitle}>Warnings</Text>
                {warnings.map((warning, idx) => (
                  <Text key={`${warning}-${idx}`} style={styles.warningText}>
                    {warning}
                  </Text>
                ))}
              </View>
            ) : null}
            {sessionState?.newEntityIds?.length ? (
              <View style={styles.entityCard}>
                <Text style={styles.entityTitle}>New entities</Text>
                {sessionState.newEntityIds.map((id) => (
                  <Text key={id} style={styles.entityText}>
                    {id}
                  </Text>
                ))}
              </View>
            ) : null}
            {sessionState?.status === 'SUCCEEDED' ? (
              <View style={styles.successCard}>
                <Text style={styles.successTitle}>Applied overrides</Text>
                <Text style={styles.successText}>Area: {sessionState.requestedArea}</Text>
                {sessionState.requestedDinodiaType ? (
                  <Text style={styles.successText}>
                    Dinodia type: {sessionState.requestedDinodiaType}
                  </Text>
                ) : null}
                {sessionState.requestedHaLabelId ? (
                  <Text style={styles.successText}>
                    HA label: {sessionState.requestedHaLabelId}
                  </Text>
                ) : null}
                {sessionState.requestedName ? (
                  <Text style={styles.successText}>Name override: {sessionState.requestedName}</Text>
                ) : null}
              </View>
            ) : null}
          </View>
        );
    }
  };

  const hasAllInputs =
    Boolean(selectedArea) &&
    Boolean(pairingCode.trim()) &&
    Boolean(wifiSsid.trim()) &&
    Boolean(wifiPassword.trim());

  return (
    <SafeAreaView style={styles.screen}>
      <TopBar
        mode={haMode}
        activeTab="addDevices"
        tabs={[
          { key: 'dashboard', label: 'Dashboard' },
          { key: 'automations', label: 'Automations' },
          { key: 'addDevices', label: 'Add Devices' },
        ]}
        onPressMenu={() => setMenuVisible(true)}
        onPressMode={handleToggleMode}
        wifiName={wifiName}
        batteryLevel={batteryLevel}
        onPressWifi={handleOpenWifiSetup}
        onChangeTab={(tab) => {
          if (tab === 'dashboard') {
            navigation.getParent()?.navigate('DashboardTab', {
              screen: 'TenantDashboard' as never,
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
        <View style={styles.headerBlock}>
          <Text style={styles.header}>Add devices</Text>
          <Text style={styles.subheader}>Choose how you want to add a device.</Text>
        </View>

        {activeFlow === null ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Device types</Text>
            <TouchableOpacity
              style={styles.deviceOption}
              onPress={() => {
                resetWizard();
                setActiveFlow('matter');
              }}
              activeOpacity={0.9}
            >
              <View>
                <Text style={styles.optionTitle}>Add Matter device</Text>
                <Text style={styles.optionText}>
                  Walk through pairing a Matter-over-Wi-Fi device.
                </Text>
              </View>
              <Text style={styles.optionAction}>Start</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Add Matter device</Text>
              <SimpleButton
                title="Back to device types"
                onPress={() => {
                  resetWizard();
                  setActiveFlow(null);
                }}
              />
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.stepRow}
            >
              {steps.map((label, idx) => {
                const isActive = idx === currentStep;
                const isDone = idx < currentStep;
                return (
                  <View
                    key={label}
                    style={[
                      styles.stepChip,
                      isActive && styles.stepChipActive,
                      isDone && styles.stepChipDone,
                    ]}
                  >
                    <View
                      style={[
                        styles.stepIndex,
                        isActive && styles.stepIndexActive,
                        isDone && styles.stepIndexDone,
                      ]}
                    >
                      <Text style={styles.stepIndexText}>{idx + 1}</Text>
                    </View>
                    <Text
                      style={[
                        styles.stepLabel,
                        isActive && styles.stepLabelActive,
                        isDone && styles.stepLabelDone,
                      ]}
                    >
                      {label}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            {renderStepContent()}

            <View style={styles.footerRow}>
              <Text style={styles.footerStep}>Step {currentStep + 1} of {steps.length}</Text>
              <View style={styles.footerButtons}>
                {currentStep > 0 && currentStep < 4 ? (
                  <SimpleButton
                    title="Back"
                    onPress={() => setCurrentStep((prev) => Math.max(0, prev - 1))}
                  />
                ) : null}
                {currentStep < 3 ? (
                  <SimpleButton
                    title="Continue"
                    onPress={() => {
                      setError(null);
                      if (currentStep === 0 && !selectedArea) {
                        setError('Please choose an area.');
                        return;
                      }
                      if (currentStep === 1 && !pairingCode.trim()) {
                        setError('Pairing code is required.');
                        return;
                      }
                      setCurrentStep((prev) => Math.min(3, prev + 1));
                    }}
                  />
                ) : null}
                {currentStep === 3 ? (
                  <SimpleButton
                    title={isSubmitting ? 'Starting...' : 'Start commissioning'}
                    onPress={() => void handleStartCommissioning()}
                    disabled={!hasAllInputs || isSubmitting}
                    variant="primary"
                  />
                ) : null}
                {currentStep >= 4 && sessionState && sessionState.status !== 'SUCCEEDED' ? (
                  <SimpleButton
                    title="Cancel"
                    variant="danger"
                    onPress={() => void handleCancelSession()}
                  />
                ) : null}
                {sessionState?.status === 'SUCCEEDED' ? (
                  <>
                    <SimpleButton
                      title="View devices"
                      onPress={() =>
                        navigation.getParent()?.navigate('DashboardTab', {
                          screen: 'TenantDashboard' as never,
                        })
                      }
                      variant="primary"
                    />
                    <SimpleButton title="Add another" onPress={resetWizard} />
                  </>
                ) : null}
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      <HeaderMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        onLogout={handleLogout}
      />

      <Modal visible={typePickerVisible} transparent animationType="fade" onRequestClose={() => setTypePickerVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setTypePickerVisible(false)}>
          <View />
        </Pressable>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Choose type</Text>
          <FlatList
            data={['', ...capabilityOptions]}
            keyExtractor={(item) => item || 'none'}
            renderItem={({ item }) => {
              const label = item || 'None';
              const selected = (item || null) === selectedType;
              return (
                <TouchableOpacity
                  style={[styles.modalItem, selected && styles.modalItemSelected]}
                  onPress={() => {
                    setSelectedType(item || null);
                    setTypePickerVisible(false);
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.modalItemText, selected && styles.modalItemTextSelected]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </Modal>

      <Modal visible={labelPickerVisible} transparent animationType="fade" onRequestClose={() => setLabelPickerVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setLabelPickerVisible(false)}>
          <View />
        </Pressable>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Choose label</Text>
          {labelsLoading ? (
            <Text style={styles.helperText}>Loading labels...</Text>
          ) : labels.length === 0 ? (
            <Text style={styles.helperText}>No labels found.</Text>
          ) : (
            <FlatList
              data={[{ label_id: '', name: 'None' }, ...labels]}
              keyExtractor={(item) => item.label_id || 'none'}
              renderItem={({ item }) => {
                const selected =
                  (item.label_id ? item.label_id : null) === selectedHaLabelId;
                return (
                  <TouchableOpacity
                    style={[styles.modalItem, selected && styles.modalItemSelected]}
                    onPress={() => {
                      setSelectedHaLabelId(item.label_id || null);
                      setLabelPickerVisible(false);
                    }}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.modalItemText, selected && styles.modalItemTextSelected]}>
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      </Modal>
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
  headerBlock: { gap: 4 },
  header: { ...typography.heading },
  subheader: { color: palette.textMuted },
  section: {
    backgroundColor: palette.surface,
    borderRadius: radii.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: palette.outline,
    ...shadows.soft,
    gap: spacing.md,
  },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: palette.text },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  deviceOption: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.outline,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: palette.surface,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  optionTitle: { fontSize: 15, fontWeight: '700', color: palette.text },
  optionText: { fontSize: 12, color: palette.textMuted, marginTop: 4 },
  optionAction: { fontSize: 12, fontWeight: '600', color: palette.textMuted },
  stepRow: { gap: spacing.sm, paddingVertical: spacing.xs },
  stepChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: palette.outline,
    backgroundColor: palette.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  stepChipActive: { borderColor: palette.primary, backgroundColor: 'rgba(10,132,255,0.1)' },
  stepChipDone: { borderColor: palette.success, backgroundColor: 'rgba(16,185,129,0.12)' },
  stepIndex: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: palette.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepIndexActive: { backgroundColor: palette.primary },
  stepIndexDone: { backgroundColor: palette.success },
  stepIndexText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  stepLabel: { fontSize: 12, fontWeight: '700', color: palette.textMuted },
  stepLabelActive: { color: palette.primary },
  stepLabelDone: { color: palette.success },
  stepSection: { gap: spacing.md },
  bodyText: { color: palette.textMuted, fontSize: 13 },
  helperText: { fontSize: 12, color: palette.textMuted },
  errorText: { color: palette.danger, fontWeight: '600' },
  scanButton: { alignSelf: 'flex-start' },
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
  emptyState: {
    borderRadius: radii.lg,
    padding: spacing.md,
    backgroundColor: palette.surfaceMuted,
    borderWidth: 1,
    borderColor: palette.outline,
  },
  selectBlock: { gap: spacing.xs },
  label: { fontSize: 12, color: palette.textMuted, fontWeight: '600' },
  selectButton: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.outline,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  selectButtonText: { fontSize: 14, fontWeight: '600', color: palette.text },
  statusCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.2)',
    backgroundColor: 'rgba(59,130,246,0.08)',
    padding: spacing.md,
  },
  statusText: { color: palette.text, fontWeight: '600' },
  warningCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.35)',
    backgroundColor: 'rgba(251,191,36,0.12)',
    padding: spacing.md,
    gap: spacing.xs,
  },
  warningTitle: { fontWeight: '700', color: '#92400e' },
  warningText: { color: '#92400e', fontSize: 12 },
  entityCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.outline,
    backgroundColor: palette.surface,
    padding: spacing.md,
    gap: spacing.xs,
  },
  entityTitle: { fontWeight: '700', color: palette.text },
  entityText: { color: palette.textMuted, fontSize: 12 },
  successCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.35)',
    backgroundColor: 'rgba(16,185,129,0.12)',
    padding: spacing.md,
    gap: spacing.xs,
  },
  successTitle: { fontWeight: '700', color: '#065f46' },
  successText: { color: '#065f46', fontSize: 12 },
  footerRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  footerStep: { fontSize: 12, color: palette.textMuted },
  footerButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  simpleButton: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: palette.outline,
    backgroundColor: palette.surface,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    ...shadows.soft,
  },
  simpleButtonPrimary: {
    borderColor: palette.primary,
    backgroundColor: 'rgba(10,132,255,0.08)',
  },
  simpleButtonDanger: {
    borderColor: palette.danger,
    backgroundColor: 'rgba(239,68,68,0.08)',
  },
  simpleButtonDisabled: {
    opacity: 0.6,
  },
  simpleButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: palette.text,
  },
  simpleButtonTextPrimary: {
    color: palette.primary,
  },
  simpleButtonTextDanger: {
    color: palette.danger,
  },
  simpleButtonTextDisabled: {
    color: palette.textMuted,
  },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)' },
  modalCard: {
    position: 'absolute',
    top: 120,
    right: 30,
    left: 30,
    maxHeight: 420,
    backgroundColor: palette.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: palette.outline,
    ...shadows.medium,
    gap: spacing.sm,
  },
  modalTitle: { fontSize: 16, fontWeight: '800', color: palette.text },
  modalItem: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
  },
  modalItemSelected: { backgroundColor: 'rgba(10,132,255,0.12)' },
  modalItemText: { color: palette.text, fontWeight: '600' },
  modalItemTextSelected: { color: palette.primary },
});
