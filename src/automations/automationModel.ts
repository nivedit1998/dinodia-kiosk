import type { DeviceCommandId } from '../capabilities/deviceCapabilities';

export type AutomationMode = 'single' | 'restart' | 'queued' | 'parallel';

export type StateTrigger = {
  kind: 'state';
  entityId: string;
  to?: string | null;
  from?: string | null;
};

export type NumericDeltaTrigger = {
  kind: 'numeric_delta';
  entityId: string;
  attribute: string;
  direction: 'increase' | 'decrease';
};

export type PositionTrigger = {
  kind: 'position_equals';
  entityId: string;
  attribute: string;
  value: number;
};

export type TimeTrigger = {
  kind: 'time';
  at: string; // HH:mm
  daysOfWeek?: string[];
};

export type AutomationTrigger = StateTrigger | NumericDeltaTrigger | PositionTrigger | TimeTrigger;

export type DeviceAction = {
  kind: 'device_command';
  entityId: string;
  command: DeviceCommandId;
  value?: number;
};

export type AutomationAction = DeviceAction;

export type AutomationDraft = {
  id?: string;
  alias: string;
  description?: string;
  mode?: AutomationMode;
  triggers: AutomationTrigger[];
  actions: AutomationAction[];
  daysOfWeek?: string[];
  triggerTime?: string | null;
};
