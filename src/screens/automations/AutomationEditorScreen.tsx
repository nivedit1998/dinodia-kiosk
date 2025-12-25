import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  SafeAreaView,
  useWindowDimensions,
  NativeModules,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSession } from '../../store/sessionStore';
import { useDevices } from '../../store/deviceStore';
import {
  getActionsForDevice,
  getEligibleDevicesForAutomations,
  getTriggersForDevice,
  type DeviceActionSpec,
  type DeviceTriggerSpec,
} from '../../capabilities/deviceCapabilities';
import { AutomationDraft, AutomationAction, AutomationTrigger } from '../../automations/automationModel';
import { createAutomation, updateAutomation } from '../../api/automations';
import { getPrimaryLabel } from '../../utils/deviceLabels';
import { getBlindPosition, getBrightnessPct, getTargetTemperature, getVolumePct } from '../../capabilities/attributeReaders';
import { palette, radii, spacing, maxContentWidth, shadows, typography } from '../../ui/theme';
import { TopBar } from '../../components/ui/TopBar';
import { CloudModePrompt } from '../../components/CloudModePrompt';
import { TextField } from '../../components/ui/TextField';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { HeaderMenu } from '../../components/HeaderMenu';
import { clearDeviceCacheForUserAndMode } from '../../store/deviceStore';
import { logoutRemote } from '../../api/auth';
import { useRemoteAccessStatus } from '../../hooks/useRemoteAccessStatus';
import { useDeviceStatus } from '../../hooks/useDeviceStatus';
import { checkRemoteAccessEnabled } from '../../api/remoteAccess';

const { InlineWifiSetupLauncher } = NativeModules;
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

type Props = NativeStackScreenProps<any>;

export function AutomationEditorScreen({ route, navigation }: Props) {
  const automationId = route.params?.automationId as string | undefined;
  const initialAlias = route.params?.alias as string | undefined;
  const initialDescription = route.params?.description as string | undefined;
  const initialDraft = route.params?.draft as AutomationDraft | undefined;
  const isEditing = Boolean(automationId);
  const { session, haMode, setHaMode, clearSession } = useSession();
  const userId = session.user?.id!;
  const { devices, refreshing } = useDevices(userId, haMode);
  const { width } = useWindowDimensions();
  const isWide = width > 900;
  const [menuVisible, setMenuVisible] = useState(false);
  const isAdmin = session.user?.role === 'ADMIN';
  const isCloud = haMode === 'cloud';
  const remoteAccess = useRemoteAccessStatus(haMode);
  const { wifiName, batteryLevel } = useDeviceStatus();
  const dashboardScreen = isAdmin ? 'AdminDashboard' : 'TenantDashboard';
  const addDevicesScreen = isAdmin ? null : 'TenantAddDevices';
  const [cloudPromptVisible, setCloudPromptVisible] = useState(false);
  const [cloudChecking, setCloudChecking] = useState(false);
  const [cloudCheckResult, setCloudCheckResult] = useState<'idle' | 'checking' | 'success' | 'error'>('idle');

  const eligibleDevices = useMemo(() => getEligibleDevicesForAutomations(devices), [devices]);
  const [alias, setAlias] = useState(initialDraft?.alias ?? initialAlias ?? (isEditing ? 'Edit automation' : 'New automation'));
  const [description, setDescription] = useState(initialDraft?.description ?? initialDescription ?? '');

  const [triggerDeviceId, setTriggerDeviceId] = useState<string | null>(null);
  const [actionDeviceId, setActionDeviceId] = useState<string | null>(eligibleDevices[0]?.entityId ?? null);

  const triggerDevice = triggerDeviceId ? eligibleDevices.find((d) => d.entityId === triggerDeviceId) ?? null : null;
  const actionDevice = eligibleDevices.find((d) => d.entityId === actionDeviceId) ?? null;

  const triggerSpecs = triggerDevice ? getTriggersForDevice(triggerDevice, 'automation') : [];
  const actionSpecs = actionDevice ? getActionsForDevice(actionDevice, 'automation') : [];
  const [selectedTriggerId, setSelectedTriggerId] = useState<string | null>(triggerSpecs[0]?.id ?? null);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(actionSpecs[0]?.id ?? null);
  const [actionValue, setActionValue] = useState<number | undefined>(undefined);
  const [anyTime, setAnyTime] = useState(true);
  const [daysOfWeek, setDaysOfWeek] = useState<string[]>([...WEEKDAYS]);
  const [timeHour, setTimeHour] = useState<string | null>(null);
  const [timeMinute, setTimeMinute] = useState<string | null>(null);
  const [showHourDropdown, setShowHourDropdown] = useState(false);
  const [showMinuteDropdown, setShowMinuteDropdown] = useState(false);
  const [pendingPrefillAction, setPendingPrefillAction] = useState<AutomationAction | null>(
    initialDraft?.actions?.[0] ?? null
  );
  const [pendingPrefillTrigger, setPendingPrefillTrigger] = useState<AutomationTrigger | null>(
    initialDraft?.triggers?.[0] ?? null
  );
  const [prefillApplied, setPrefillApplied] = useState(false);

  useEffect(() => {
    if (!isEditing || !initialDraft || prefillApplied) return;
    setAlias(initialDraft.alias ?? initialAlias ?? alias);
    setDescription(initialDraft.description ?? initialDescription ?? '');

    if (Array.isArray(initialDraft.daysOfWeek) && initialDraft.daysOfWeek.length > 0) {
      setDaysOfWeek(initialDraft.daysOfWeek);
    }
    const time = initialDraft.triggerTime || (initialDraft.triggers?.find((t) => t.kind === 'time') as any)?.at;
    if (typeof time === 'string' && time.includes(':')) {
      const [h, m] = time.split(':');
      if (h) setTimeHour(h.padStart(2, '0'));
      if (m) setTimeMinute(m.padStart(2, '0'));
    }

    const firstTrigger = initialDraft.triggers?.[0];
    const hasTimeTrigger = firstTrigger?.kind === 'time';
    setAnyTime(!hasTimeTrigger);
    if (firstTrigger) {
      if (firstTrigger.kind === 'time') {
        setTriggerDeviceId(null);
        setSelectedTriggerId(null);
        if (Array.isArray((firstTrigger as any).daysOfWeek)) {
          setDaysOfWeek((firstTrigger as any).daysOfWeek as string[]);
        }
      } else if ((firstTrigger as any).entityId) {
        setTriggerDeviceId((firstTrigger as any).entityId);
      }
      setPendingPrefillTrigger(firstTrigger);
    }

    const firstAction = initialDraft.actions?.[0];
    if (firstAction) {
      if ((firstAction as any).entityId) setActionDeviceId((firstAction as any).entityId);
      if (typeof (firstAction as any).value === 'number') setActionValue((firstAction as any).value);
      setPendingPrefillAction(firstAction);
    }

    setPrefillApplied(true);
  }, [initialDraft, isEditing, prefillApplied, initialAlias, initialDescription]);

  useEffect(() => {
    setShowHourDropdown(false);
    setShowMinuteDropdown(false);
    if (!anyTime) {
      setTriggerDeviceId(null);
      setSelectedTriggerId(null);
    }
  }, [anyTime]);

  useEffect(() => {
    if (!triggerDevice) {
      setSelectedTriggerId(null);
      return;
    }
    // Keep existing selection if still valid for this device.
    if (selectedTriggerId && triggerSpecs.some((t) => t.id === selectedTriggerId)) {
      return;
    }
    const fallback = triggerSpecs[0]?.id ?? null;
    setSelectedTriggerId(fallback);
  }, [triggerDeviceId]);

  useEffect(() => {
    if (!pendingPrefillTrigger) return;
    if (pendingPrefillTrigger.kind === 'time') {
      setPendingPrefillTrigger(null);
      return;
    }
    if (!triggerDevice) return;
    const match = findMatchingTriggerSpec(pendingPrefillTrigger, triggerSpecs);
    if (match) {
      setSelectedTriggerId(match.id);
    }
    setPendingPrefillTrigger(null);
  }, [pendingPrefillTrigger, triggerSpecs, triggerDevice]);

  useEffect(() => {
    if (actionDevice && actionSpecs.length > 0) {
      if (!selectedActionId || !actionSpecs.some((a) => a.id === selectedActionId)) {
        setSelectedActionId(actionSpecs[0].id);
      }
    }
    const attrs = actionDevice?.attributes ?? {};
    const label = actionDevice ? getPrimaryLabel(actionDevice) : '';
    if (label === 'Light') setActionValue(getBrightnessPct(attrs) ?? 50);
    else if (label === 'Blind') setActionValue(getBlindPosition(attrs) ?? 0);
    else if (label === 'TV' || label === 'Speaker') setActionValue(getVolumePct(attrs) ?? 20);
    else if (label === 'Boiler') setActionValue(getTargetTemperature(attrs) ?? 20);
  }, [actionDeviceId, actionDevice]);

  useEffect(() => {
    if (!pendingPrefillAction || !actionDevice) return;
    const match = findMatchingActionSpec(pendingPrefillAction, actionSpecs);
    if (match) {
      setSelectedActionId(match.id);
    }
    setPendingPrefillAction(null);
  }, [pendingPrefillAction, actionSpecs, actionDevice]);

  useEffect(() => {
    if (actionDeviceId === null && eligibleDevices.length > 0) {
      setActionDeviceId(eligibleDevices[0].entityId);
    }
  }, [eligibleDevices, actionDeviceId]);

  // Ensure time defaults when days are selected; hide/clear when not.
  useEffect(() => {
    if (anyTime) return;
    if (daysOfWeek.length === 0) {
      setTimeHour(null);
      setTimeMinute(null);
      setShowHourDropdown(false);
      setShowMinuteDropdown(false);
    } else {
      if (!timeHour) setTimeHour('00');
      if (!timeMinute) setTimeMinute('00');
    }
  }, [anyTime, daysOfWeek, timeHour, timeMinute]);

  const switchMode = async (next: 'home' | 'cloud') => {
    await clearDeviceCacheForUserAndMode(userId, next).catch(() => undefined);
    setHaMode(next);
  };

  const handleToggleMode = () => {
    if (isCloud) {
      void switchMode('home');
      return;
    }
    setCloudCheckResult('idle');
    setCloudPromptVisible(true);
  };

  const handleConfirmCloud = async () => {
    if (cloudChecking) return;
    setCloudChecking(true);
    setCloudCheckResult('checking');
    let ok = false;
    try {
      ok = await checkRemoteAccessEnabled();
    } catch {
      // ignore, fallback to cloud locked screen
    }
    setCloudChecking(false);
    if (ok) {
      setCloudCheckResult('success');
      setTimeout(() => {
        setCloudPromptVisible(false);
        void switchMode('cloud');
      }, 700);
    } else {
      setCloudCheckResult('error');
      setTimeout(() => {
        setCloudPromptVisible(false);
        setCloudCheckResult('idle');
      }, 900);
    }
  };

  const handleCancelCloud = () => {
    if (cloudChecking) return;
    setCloudPromptVisible(false);
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

  useEffect(() => {
    if (isCloud && remoteAccess.status === 'locked') {
      void switchMode('home');
    }
  }, [isCloud, remoteAccess.status, switchMode]);

  const save = async () => {
    if (!actionDevice || !selectedActionId) {
      Alert.alert('Choose an action device and action to continue.');
      return;
    }
    const actionSpec = actionSpecs.find((a) => a.id === selectedActionId);

    if (!actionSpec) {
      Alert.alert('Please choose an action.');
      return;
    }

    const actions: AutomationAction[] = [toActionDraft(actionSpec, actionDevice, actionValue)];
    const triggers: AutomationTrigger[] = [];

    if (anyTime) {
      if (!triggerDevice || !selectedTriggerId) {
        Alert.alert('Please select a trigger device and condition.');
        return;
      }
      const triggerSpec = triggerSpecs.find((t) => t.id === selectedTriggerId);
      if (!triggerSpec) {
        Alert.alert('Please select a trigger condition.');
        return;
      }
      triggers.push(toTriggerDraft(triggerSpec, triggerDevice));
    } else {
      if (daysOfWeek.length === 0) {
        Alert.alert('Select at least one day for the time trigger.');
        return;
      }
      const timeValue = buildTimeValue(timeHour, timeMinute);
      if (!timeValue) {
        Alert.alert('Choose a specific time (HH:MM).');
        return;
      }
      triggers.push({ kind: 'time', at: timeValue, daysOfWeek });
    }

    const draft: AutomationDraft = {
      id: automationId,
      alias,
      description,
      triggers,
      actions,
      mode: 'single',
      daysOfWeek,
      triggerTime: anyTime ? null : buildTimeValue(timeHour, timeMinute),
    };

    try {
      if (isEditing && automationId) {
        await updateAutomation(automationId, draft, { haConnection: session.haConnection, mode: haMode });
      } else {
        await createAutomation(draft, { haConnection: session.haConnection, mode: haMode });
      }
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Could not save', err?.message ?? 'Something went wrong saving automation.');
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
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
      <ScrollView contentContainerStyle={[styles.container, isWide && styles.containerWide]}>
        <View style={styles.headerBlock}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{isEditing ? 'Edit Automation' : 'Create Automation'}</Text>
            <Text style={styles.subtitle}>Build beautiful flows for your home.</Text>
          </View>
          <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.surface}>
          <TextField
            label="Name"
            placeholder="Automation name"
            value={alias}
            onChangeText={setAlias}
          />
          <View style={{ height: spacing.sm }} />
          <TextField
            label="Description (optional)"
            placeholder="What does this do?"
            value={description}
            onChangeText={setDescription}
            multiline
            style={{ height: 90, textAlignVertical: 'top' }}
          />
        </View>

        <View style={[styles.sectionRow, isWide && styles.sectionRowWide]}>
          <View style={[styles.sectionCard, styles.sectionHalf]}>
            <Text style={styles.sectionTitle}>Trigger</Text>
            <View style={styles.field}>
              <Text style={styles.label}>Time</Text>
              <View style={styles.timeBlock}>
                <Text style={[styles.label, styles.subLabel]}>Days (optional)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 6 }}>
                  {WEEKDAYS.map((day) => {
                    const selected = daysOfWeek.includes(day);
                    return (
                      <TouchableOpacity
                        key={day}
                        style={[
                          styles.chip,
                          selected && styles.chipSelected
                        ]}
                        onPress={() => {
                          setDaysOfWeek((prev) =>
                            prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
                          );
                        }}
                        disabled={refreshing}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            selected && styles.chipTextSelected
                          ]}
                        >
                          {day.toUpperCase()}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                <View style={{ height: spacing.xs }} />
                <Text style={[styles.label, styles.subLabel, anyTime && styles.disabledText]}>Specific time</Text>
                <View style={[styles.dropdownRow, styles.timeRow]}>
                  <View style={[styles.dropdown, anyTime && styles.dropdownDisabled]}>
                    <TouchableOpacity
                      style={styles.dropdownHeader}
                      onPress={() => {
                        setShowHourDropdown((v) => !v);
                        setShowMinuteDropdown(false);
                      }}
                      disabled={anyTime}
                    >
                      <Text style={[styles.dropdownHeaderText, anyTime && styles.disabledText]}>{timeHour ?? 'HH'}</Text>
                    </TouchableOpacity>
                    {showHourDropdown && (
                      <ScrollView style={styles.dropdownList} nestedScrollEnabled showsVerticalScrollIndicator>
                        {HOURS.map((h) => (
                          <TouchableOpacity
                            key={h}
                            style={styles.dropdownItem}
                            onPress={() => {
                              setTimeHour(h);
                              setShowHourDropdown(false);
                            }}
                          >
                            <Text style={styles.dropdownItemText}>{h}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    )}
                  </View>
                  <Text style={[styles.timeDivider, anyTime && styles.disabledText]}>:</Text>
                  <View style={[styles.dropdown, anyTime && styles.dropdownDisabled]}>
                    <TouchableOpacity
                      style={styles.dropdownHeader}
                      onPress={() => {
                        setShowMinuteDropdown((v) => !v);
                        setShowHourDropdown(false);
                      }}
                      disabled={anyTime}
                    >
                      <Text style={[styles.dropdownHeaderText, anyTime && styles.disabledText]}>{timeMinute ?? 'MM'}</Text>
                    </TouchableOpacity>
                    {showMinuteDropdown && (
                      <ScrollView style={styles.dropdownList} nestedScrollEnabled showsVerticalScrollIndicator>
                        {MINUTES.map((m) => (
                          <TouchableOpacity
                            key={m}
                            style={styles.dropdownItem}
                            onPress={() => {
                              setTimeMinute(m);
                              setShowMinuteDropdown(false);
                            }}
                          >
                            <Text style={styles.dropdownItemText}>{m}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    )}
                  </View>
                  <TouchableOpacity
                    style={[styles.anyTimeButton, anyTime && styles.anyTimeButtonActive]}
                    onPress={() => {
                      setAnyTime((prev) => !prev);
                    }}
                  >
                    <Text style={[styles.anyTimeText, anyTime && styles.anyTimeTextActive]}>Any Time</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                  <Text style={[styles.helper, anyTime && styles.disabledText]}>
                    {timeHour && timeMinute ? `Selected: ${timeHour}:${timeMinute}` : 'No time set'}
                  </Text>
                  {(timeHour || timeMinute) && !anyTime && (
                    <TouchableOpacity
                      style={[styles.chip, { marginLeft: 10 }]}
                      onPress={() => {
                        setTimeHour('00');
                        setTimeMinute('00');
                        setShowHourDropdown(false);
                        setShowMinuteDropdown(false);
                      }}
                    >
                      <Text style={styles.chipText}>Reset to 00:00</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              {anyTime ? (
                <Text style={styles.helper}>Any time (00:00–23:59). You can still pick days to limit when it runs.</Text>
              ) : (
                <Text style={styles.helper}>Select at least one day and a time.</Text>
              )}
            </View>

            {anyTime && (
              <>
                <View style={styles.field}>
                  <Text style={styles.label}>Trigger device</Text>
                  {eligibleDevices.length === 0 ? (
                    <Text style={styles.helper}>No eligible devices for automations.</Text>
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 6 }}>
                      <TouchableOpacity
                        key="none"
                        style={[styles.chip, triggerDeviceId === null && styles.chipSelected]}
                        onPress={() => setTriggerDeviceId(null)}
                        disabled={refreshing}
                      >
                        <Text style={[styles.chipText, triggerDeviceId === null && styles.chipTextSelected]}>None</Text>
                      </TouchableOpacity>
                      {eligibleDevices.map((d) => {
                        const selected = d.entityId === triggerDeviceId;
                        return (
                          <TouchableOpacity
                            key={d.entityId}
                            style={[styles.chip, selected && styles.chipSelected]}
                            onPress={() => setTriggerDeviceId(d.entityId)}
                            disabled={refreshing}
                          >
                            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{d.name}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  )}
                </View>

                {triggerDevice && (
                  <View style={styles.field}>
                    <Text style={styles.label}>Trigger condition</Text>
                    {triggerSpecs.length === 0 ? (
                      <Text style={styles.helper}>No triggers available for this device.</Text>
                    ) : (
                      triggerSpecs.map((t) => {
                        const selected = t.id === selectedTriggerId;
                        return (
                          <TouchableOpacity
                            key={t.id}
                            style={[styles.rowItem, selected && styles.rowItemSelected]}
                            onPress={() => setSelectedTriggerId(t.id)}
                          >
                            <Text style={[styles.rowItemText, selected && styles.rowItemTextSelected]}>{t.label}</Text>
                          </TouchableOpacity>
                        );
                      })
                    )}
                  </View>
                )}
              </>
            )}
          </View>

          <View style={[styles.sectionCard, styles.sectionHalf]}>
            <Text style={styles.sectionTitle}>Action</Text>
            <View style={styles.field}>
              <Text style={styles.label}>Action device</Text>
              {eligibleDevices.length === 0 ? (
                <Text style={styles.helper}>No eligible devices for automations.</Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 6 }}>
                  {eligibleDevices.map((d) => {
                    const selected = d.entityId === actionDeviceId;
                    return (
                      <TouchableOpacity
                        key={d.entityId}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => setActionDeviceId(d.entityId)}
                        disabled={refreshing}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{d.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Action to perform</Text>
              {actionSpecs.length === 0 ? (
                <Text style={styles.helper}>No actions available for this device.</Text>
              ) : (
                actionSpecs.map((a) => {
                  const selected = a.id === selectedActionId;
                  return (
                    <TouchableOpacity
                      key={a.id}
                      style={[styles.rowItem, selected && styles.rowItemSelected]}
                      onPress={() => setSelectedActionId(a.id)}
                    >
                      <Text style={[styles.rowItemText, selected && styles.rowItemTextSelected]}>{a.label}</Text>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>

            {(() => {
              if (!actionDevice || !selectedActionId) return null;
              const spec = actionSpecs.find((a) => a.id === selectedActionId);
              if (!spec) return null;
              if (spec.kind === 'slider') {
                const step = spec.step ?? 1;
                const min = spec.min ?? 0;
                const max = spec.max ?? 100;
                const attrs = actionDevice.attributes ?? {};
                const label = getPrimaryLabel(actionDevice);
                const current =
                  actionValue ??
                  (label === 'Light'
                    ? getBrightnessPct(attrs) ?? 50
                    : label === 'Blind'
                    ? getBlindPosition(attrs) ?? 0
                    : label === 'TV' || label === 'Speaker'
                    ? getVolumePct(attrs) ?? 20
                    : 0);
                return (
                  <View style={styles.field}>
                    <Text style={styles.label}>{spec.label}: {Math.round(current)}</Text>
                    <Slider
                      minimumValue={min}
                      maximumValue={max}
                      step={step}
                      value={current}
                      onValueChange={(v) => setActionValue(v)}
                      minimumTrackTintColor={palette.primary}
                      maximumTrackTintColor={palette.outline}
                      thumbTintColor={palette.primary}
                    />
                  </View>
                );
              }
              return null;
            })()}
          </View>
        </View>

        <PrimaryButton
          title={isEditing ? 'Save changes' : 'Create automation'}
          onPress={save}
          style={{ marginTop: spacing.md }}
        />
      </ScrollView>
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

function toActionDraft(spec: DeviceActionSpec, device: any, value?: number): AutomationAction {
  switch (spec.kind) {
    case 'button':
      return { kind: 'device_command', command: spec.command, entityId: device.entityId, value: value ?? spec.value };
    case 'fixed':
      return { kind: 'device_command', command: spec.command, entityId: device.entityId, value: spec.value };
    case 'slider':
      return { kind: 'device_command', command: spec.command, entityId: device.entityId, value: value };
    case 'toggle': {
      // Should not appear for automation surface; fallback to deterministic "on".
      return { kind: 'device_command', command: spec.commandOn, entityId: device.entityId };
    }
    default:
      return { kind: 'device_command', command: spec.kind as any, entityId: device.entityId };
  }
}

function toTriggerDraft(spec: DeviceTriggerSpec, device: any): AutomationTrigger {
  switch (spec.kind) {
    case 'state':
      return { kind: 'state', entityId: device.entityId, to: spec.entityState };
    case 'attribute_delta':
      return { kind: 'numeric_delta', entityId: device.entityId, attribute: spec.attribute, direction: spec.direction };
    case 'position':
      return { kind: 'position_equals', entityId: device.entityId, attribute: spec.attributes[0], value: spec.equals };
    case 'time':
      return { kind: 'time', at: spec.at, daysOfWeek: spec.daysOfWeek };
    default:
      return { kind: 'state', entityId: device.entityId };
  }
}

function buildTimeValue(hour: string | null, minute: string | null): string | null {
  if (!hour || !minute) return null;
  return `${hour}:${minute}`;
}

function findMatchingActionSpec(action: AutomationAction, specs: DeviceActionSpec[]): DeviceActionSpec | null {
  if (action.kind !== 'device_command') return null;
  return (
    specs.find((s) => s.kind === 'button' && s.command === action.command) ||
    specs.find((s) => s.kind === 'fixed' && s.command === action.command) ||
    specs.find((s) => s.kind === 'slider' && s.command === action.command) ||
    specs.find((s) => s.kind === 'toggle' && (s.commandOn === action.command || s.commandOff === action.command)) ||
    null
  );
}

function findMatchingTriggerSpec(trigger: AutomationTrigger, specs: DeviceTriggerSpec[]): DeviceTriggerSpec | null {
  switch (trigger.kind) {
    case 'state':
      return specs.find((s) => s.kind === 'state' && s.entityState === trigger.to) ?? null;
    case 'numeric_delta':
      return specs.find(
        (s) => s.kind === 'attribute_delta' && s.attribute === trigger.attribute && s.direction === trigger.direction
      ) ?? null;
    case 'position_equals':
      return specs.find((s) => s.kind === 'position' && s.equals === trigger.value) ?? null;
    case 'time':
      return specs.find((s) => s.kind === 'time') ?? null;
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  container: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
    backgroundColor: palette.background,
  },
  containerWide: { alignItems: 'center' },
  headerBlock: {
    gap: 4,
    marginBottom: spacing.xs,
    width: '100%',
    maxWidth: maxContentWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { ...typography.heading },
  subtitle: { color: palette.textMuted },
  surface: {
    backgroundColor: palette.surface,
    padding: spacing.xl,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: palette.outline,
    ...shadows.soft,
    width: '100%',
    maxWidth: maxContentWidth,
  },
  sectionRow: {
    flexDirection: 'column',
    gap: spacing.md,
    width: '100%',
    maxWidth: maxContentWidth,
  },
  sectionRowWide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  sectionCard: {
    backgroundColor: palette.surface,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: palette.outline,
    ...shadows.soft,
    flex: 1,
  },
  sectionHalf: { minWidth: 0 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: palette.text, marginBottom: spacing.sm },
  field: { marginBottom: spacing.md },
  label: { fontSize: 14, fontWeight: '700', color: palette.text, marginBottom: 6 },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: palette.outline,
    backgroundColor: palette.surface,
    marginRight: 8,
  },
  chipSelected: { backgroundColor: palette.text, borderColor: palette.text },
  chipText: { color: palette.text, fontWeight: '700' },
  chipTextSelected: { color: '#fff' },
  helper: { color: palette.textMuted, fontSize: 13 },
  rowItem: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.outline,
    backgroundColor: palette.surface,
    marginBottom: 8,
  },
  rowItemSelected: { borderColor: palette.primary, backgroundColor: palette.primary },
  rowItemText: { color: palette.text, fontWeight: '700' },
  rowItemTextSelected: { color: '#fff' },
  dropdownRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dropdown: { minWidth: 80, position: 'relative' },
  dropdownHeader: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.outline,
    backgroundColor: palette.surface,
  },
  dropdownHeaderText: { color: palette.text, fontWeight: '700' },
  dropdownList: {
    maxHeight: 200,
    borderWidth: 1,
    borderColor: palette.outline,
    borderRadius: radii.lg,
    backgroundColor: palette.surface,
    position: 'absolute',
    top: 48,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  dropdownItem: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: palette.outline,
  },
  dropdownItemText: { color: palette.text, fontSize: 14 },
  timeDivider: { marginHorizontal: 6, fontWeight: '700', color: palette.text },
  anyTimeButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: palette.outline,
    backgroundColor: palette.surface,
  },
  anyTimeButtonActive: { backgroundColor: '#111', borderColor: '#111' },
  anyTimeText: { color: palette.text, fontWeight: '700' },
  anyTimeTextActive: { color: '#fff' },
  timeBlock: {
    marginTop: spacing.xs,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: palette.outline,
    borderRadius: radii.md,
    backgroundColor: palette.surface,
  },
  subLabel: { fontSize: 12, color: palette.textMuted, marginBottom: 4 },
  dropdownDisabled: { opacity: 0.7 },
  disabledText: { color: palette.textMuted },
  timeRow: { flexWrap: 'nowrap', gap: spacing.sm },
  closeButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: palette.outline,
    backgroundColor: palette.surface,
  },
  closeButtonText: { color: palette.text, fontWeight: '700' },
});
