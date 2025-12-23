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
import { TextField } from '../../components/ui/TextField';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { HeaderMenu } from '../../components/HeaderMenu';
import { clearDeviceCacheForUserAndMode } from '../../store/deviceStore';
import { logoutRemote } from '../../api/auth';

const { InlineWifiSetupLauncher } = NativeModules;
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

type Props = NativeStackScreenProps<any>;

export function AutomationEditorScreen({ route, navigation }: Props) {
  const automationId = route.params?.automationId as string | undefined;
  const initialAlias = route.params?.alias as string | undefined;
  const initialDescription = route.params?.description as string | undefined;
  const isEditing = Boolean(automationId);
  const { session, haMode, setHaMode, clearSession } = useSession();
  const userId = session.user?.id!;
  const { devices, refreshing } = useDevices(userId, haMode);
  const { width } = useWindowDimensions();
  const isWide = width > 900;
  const [menuVisible, setMenuVisible] = useState(false);
  const isCloud = haMode === 'cloud';

  const eligibleDevices = useMemo(() => getEligibleDevicesForAutomations(devices), [devices]);
  const [alias, setAlias] = useState(initialAlias ?? (isEditing ? 'Edit automation' : 'New automation'));
  const [description, setDescription] = useState(initialDescription ?? '');

  const [triggerDeviceId, setTriggerDeviceId] = useState<string | null>(eligibleDevices[0]?.entityId ?? null);
  const [actionDeviceId, setActionDeviceId] = useState<string | null>(eligibleDevices[0]?.entityId ?? null);

  const triggerDevice = triggerDeviceId ? eligibleDevices.find((d) => d.entityId === triggerDeviceId) ?? null : null;
  const actionDevice = eligibleDevices.find((d) => d.entityId === actionDeviceId) ?? null;

  const triggerSpecs = triggerDevice ? getTriggersForDevice(triggerDevice, 'automation') : [];
  const actionSpecs = actionDevice ? getActionsForDevice(actionDevice, 'automation') : [];
  const [selectedTriggerId, setSelectedTriggerId] = useState<string | null>(triggerSpecs[0]?.id ?? null);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(actionSpecs[0]?.id ?? null);
  const [actionValue, setActionValue] = useState<number | undefined>(undefined);
  const [daysOfWeek, setDaysOfWeek] = useState<string[]>([]);
  const [timeHour, setTimeHour] = useState<string | null>(null);
  const [timeMinute, setTimeMinute] = useState<string | null>(null);
  const [showHourDropdown, setShowHourDropdown] = useState(false);
  const [showMinuteDropdown, setShowMinuteDropdown] = useState(false);

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
    if (actionDeviceId === null && eligibleDevices.length > 0) {
      setActionDeviceId(eligibleDevices[0].entityId);
    }
  }, [eligibleDevices, actionDeviceId]);

  // Ensure time defaults when days are selected; hide/clear when not.
  useEffect(() => {
    if (daysOfWeek.length === 0) {
      setTimeHour(null);
      setTimeMinute(null);
      setShowHourDropdown(false);
      setShowMinuteDropdown(false);
    } else {
      if (!timeHour) setTimeHour('00');
      if (!timeMinute) setTimeMinute('00');
    }
  }, [daysOfWeek, timeHour, timeMinute]);

  const handleToggleMode = () => {
    const next = isCloud ? 'home' : 'cloud';
    void clearDeviceCacheForUserAndMode(userId, next).catch(() => undefined);
    setHaMode(next);
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

  const save = async () => {
    // Trigger device can be none; if so, we skip device-based triggers.
    if (!actionDevice || !selectedActionId) {
      Alert.alert('Choose an action device and action to continue.');
      return;
    }
    const actionSpec = actionSpecs.find((a) => a.id === selectedActionId);
    const triggerSpec = triggerDevice && selectedTriggerId ? triggerSpecs.find((t) => t.id === selectedTriggerId) : null;

    if (!actionSpec) {
      Alert.alert('Please choose an action.');
      return;
    }

    const actions: AutomationAction[] = [toActionDraft(actionSpec, actionDevice, actionValue)];
    const triggers: AutomationTrigger[] = [];
    if (triggerSpec) {
      triggers.push(toTriggerDraft(triggerSpec, triggerDevice!));
    } else if (daysOfWeek.length > 0 || (timeHour && timeMinute)) {
      const timeValue = buildTimeValue(timeHour, timeMinute) ?? '00:00';
      triggers.push({ kind: 'time', at: timeValue, daysOfWeek });
    }
    if (triggers.length === 0) {
      Alert.alert('Please select a trigger device/condition or choose days/time.');
      return;
    }

    const draft: AutomationDraft = {
      id: automationId,
      alias,
      description,
      triggers,
      actions,
      mode: 'single',
      daysOfWeek,
      triggerTime: buildTimeValue(timeHour, timeMinute),
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
        onPressMenu={() => setMenuVisible(true)}
        onChangeTab={(tab) => {
          if (tab === 'dashboard') navigation.getParent()?.navigate('DashboardTab');
        }}
      />
      <ScrollView contentContainerStyle={[styles.container, isWide && styles.containerWide]}>
        <View style={styles.headerBlock}>
          <Text style={styles.title}>{isEditing ? 'Edit Automation' : 'Create Automation'}</Text>
          <Text style={styles.subtitle}>Build beautiful flows for your home.</Text>
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
              <Text style={styles.label}>Days (optional)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 6 }}>
                {WEEKDAYS.map((day) => {
                  const selected = daysOfWeek.includes(day);
                  return (
                    <TouchableOpacity
                      key={day}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => {
                        setDaysOfWeek((prev) =>
                          prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
                        );
                      }}
                      disabled={refreshing}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                        {day.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {daysOfWeek.length > 0 && (
              <View style={styles.field}>
                <Text style={styles.label}>Time (required when days selected)</Text>
                <View style={styles.dropdownRow}>
                  <View style={styles.dropdown}>
                    <TouchableOpacity
                      style={styles.dropdownHeader}
                      onPress={() => {
                        setShowHourDropdown((v) => !v);
                        setShowMinuteDropdown(false);
                      }}
                    >
                      <Text style={styles.dropdownHeaderText}>{timeHour ?? 'HH'}</Text>
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
                  <Text style={styles.timeDivider}>:</Text>
                  <View style={styles.dropdown}>
                    <TouchableOpacity
                      style={styles.dropdownHeader}
                      onPress={() => {
                        setShowMinuteDropdown((v) => !v);
                        setShowHourDropdown(false);
                      }}
                    >
                      <Text style={styles.dropdownHeaderText}>{timeMinute ?? 'MM'}</Text>
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
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                  <Text style={styles.helper}>
                    {timeHour && timeMinute ? `Selected: ${timeHour}:${timeMinute}` : 'No time set'}
                  </Text>
                  {(timeHour || timeMinute) && (
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
            )}

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
        isCloud={isCloud}
        onClose={() => setMenuVisible(false)}
        onToggleMode={handleToggleMode}
        onOpenWifi={handleOpenWifiSetup}
        onLogout={handleLogout}
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
});
