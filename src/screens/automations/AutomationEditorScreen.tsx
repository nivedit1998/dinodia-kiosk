import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
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
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

type Props = NativeStackScreenProps<any>;

export function AutomationEditorScreen({ route, navigation }: Props) {
  const automationId = route.params?.automationId as string | undefined;
  const initialAlias = route.params?.alias as string | undefined;
  const initialDescription = route.params?.description as string | undefined;
  const isEditing = Boolean(automationId);
  const { session, haMode } = useSession();
  const userId = session.user?.id!;
  const { devices, refreshing } = useDevices(userId, haMode);

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
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{isEditing ? 'Edit Automation' : 'Create Automation'}</Text>

      <View style={styles.field}>
        <Text style={styles.label}>Name</Text>
        <TextInput value={alias} onChangeText={setAlias} placeholder="Automation name" style={styles.input} />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Description (optional)</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="What does this do?"
          style={[styles.input, { height: 80 }]}
          multiline
        />
      </View>

      <View style={styles.sectionCard}>
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
              <Text style={{ marginHorizontal: 6, fontWeight: '700', color: '#111827' }}>:</Text>
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

      <View style={styles.sectionCard}>
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
      </View>

      {actionDevice && selectedActionId && (() => {
        const spec = actionSpecs.find((a) => a.id === selectedActionId);
        if (spec && spec.kind === 'slider') {
          const min = spec.min;
          const max = spec.max;
          const step = spec.step ?? 1;
          const current = typeof actionValue === 'number' ? actionValue : min;
          return (
            <View style={styles.field}>
              <Text style={styles.label}>{spec.label}: {Math.round(current)}</Text>
              <Slider
                minimumValue={min}
                maximumValue={max}
                step={step}
                value={current}
                onValueChange={(v) => setActionValue(v)}
                minimumTrackTintColor="#4f46e5"
                maximumTrackTintColor="#e5e7eb"
                thumbTintColor="#4f46e5"
              />
            </View>
          );
        }
        return null;
      })()}

      <TouchableOpacity style={styles.saveBtn} onPress={save}>
        <Text style={styles.saveText}>{isEditing ? 'Save changes' : 'Create automation'}</Text>
      </TouchableOpacity>
    </ScrollView>
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
  container: { padding: 16, backgroundColor: '#f5f5f7' },
  title: { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 12 },
  field: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '700', color: '#111827', marginBottom: 6 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
    marginRight: 8,
  },
  chipSelected: { backgroundColor: '#111827', borderColor: '#111827' },
  chipText: { color: '#111827', fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  helper: { color: '#6b7280', fontSize: 13 },
  rowItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
    marginBottom: 8,
  },
  rowItemSelected: { borderColor: '#111827', backgroundColor: '#111827' },
  rowItemText: { color: '#111827', fontWeight: '600' },
  rowItemTextSelected: { color: '#fff' },
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 8 },
  saveBtn: {
    backgroundColor: '#111827',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  saveText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dropdownRow: { flexDirection: 'row', alignItems: 'center' },
  dropdown: { minWidth: 70, position: 'relative' },
  dropdownHeader: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  dropdownHeaderText: { color: '#111827', fontWeight: '700' },
  dropdownList: {
    maxHeight: 200,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    backgroundColor: '#fff',
    position: 'absolute',
    top: 48,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  dropdownItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  dropdownItemText: { color: '#111827', fontSize: 14 },
});
