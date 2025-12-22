import type { UIDevice } from '../models/device';
import { getPrimaryLabel } from '../utils/deviceLabels';
import { getBlindPosition } from './attributeReaders';

export const DEVICE_COMMANDS = [
  // Lights
  'light/turn_on',
  'light/turn_off',
  'light/toggle',
  'light/set_brightness',
  // Blinds
  'blind/open',
  'blind/close',
  'blind/set_position',
  // Media / TV / Speaker
  'media/play_pause',
  'media/next',
  'media/previous',
  'media/volume_up',
  'media/volume_down',
  'media/volume_set',
  'tv/turn_on',
  'tv/turn_off',
  'tv/toggle_power',
  'speaker/turn_on',
  'speaker/turn_off',
  'speaker/toggle_power',
  // Boiler
  'boiler/temp_up',
  'boiler/temp_down',
  'boiler/set_temperature',
] as const;

export type DeviceCommandId = (typeof DEVICE_COMMANDS)[number];

export function isDeviceCommandId(value: unknown): value is DeviceCommandId {
  return typeof value === 'string' && (DEVICE_COMMANDS as readonly string[]).includes(value);
}

export type Surface = 'dashboard' | 'automation';

export type DeviceActionSpec =
  | {
      kind: 'toggle';
      id: string;
      label: string;
      commandOn: DeviceCommandId;
      commandOff: DeviceCommandId;
      surfaces: Surface[];
      primary?: boolean;
    }
  | {
      kind: 'button';
      id: string;
      label: string;
      command: DeviceCommandId;
      value?: number;
      surfaces: Surface[];
      primary?: boolean;
    }
  | {
      kind: 'fixed';
      id: string;
      label: string;
      command: DeviceCommandId;
      value: number;
      surfaces: Surface[];
      primary?: boolean;
    }
  | {
      kind: 'slider';
      id: string;
      label: string;
      command: DeviceCommandId;
      min: number;
      max: number;
      step?: number;
      surfaces: Surface[];
      primary?: boolean;
    };

export type DeviceTriggerSpec =
  | {
      kind: 'state';
      id: string;
      label: string;
      entityState: 'on' | 'off';
      surfaces: Surface[];
    }
  | {
      kind: 'attribute_delta';
      id: string;
      label: string;
      attribute: string;
      direction: 'increase' | 'decrease';
      surfaces: Surface[];
    }
  | {
      kind: 'position';
      id: string;
      label: string;
      equals: number;
      attributes: string[];
      surfaces: Surface[];
    }
  | {
      kind: 'time';
      id: string;
      label: string;
      at: string;
      daysOfWeek?: string[];
      surfaces: Surface[];
    };

export type DeviceCapability = {
  actions: DeviceActionSpec[];
  triggers: DeviceTriggerSpec[];
  excludeFromAutomations?: boolean;
};

const makeSurfaces = (...s: Surface[]): Surface[] => s;

export const CAPABILITIES: Record<string, DeviceCapability> = {
  Light: {
    actions: [
      {
        kind: 'toggle',
        id: 'light-power',
        label: 'Toggle',
        commandOn: 'light/turn_on',
        commandOff: 'light/turn_off',
        surfaces: makeSurfaces('dashboard'),
        primary: true,
      },
      {
        kind: 'button',
        id: 'light-on',
        label: 'Turn on',
        command: 'light/turn_on',
        surfaces: makeSurfaces('automation'),
        primary: true,
      },
      {
        kind: 'button',
        id: 'light-off',
        label: 'Turn off',
        command: 'light/turn_off',
        surfaces: makeSurfaces('automation'),
      },
      {
        kind: 'slider',
        id: 'light-brightness',
        label: 'Brightness',
        command: 'light/set_brightness',
        min: 0,
        max: 100,
        step: 1,
        surfaces: makeSurfaces('dashboard', 'automation'),
      },
    ],
    triggers: [
      {
        kind: 'state',
        id: 'light-on',
        label: 'Turns on',
        entityState: 'on',
        surfaces: makeSurfaces('automation'),
      },
      {
        kind: 'state',
        id: 'light-off',
        label: 'Turns off',
        entityState: 'off',
        surfaces: makeSurfaces('automation'),
      },
      {
        kind: 'attribute_delta',
        id: 'brightness-increase',
        label: 'Brightness increases',
        attribute: 'brightness',
        direction: 'increase',
        surfaces: makeSurfaces('automation'),
      },
      {
        kind: 'attribute_delta',
        id: 'brightness-decrease',
        label: 'Brightness decreases',
        attribute: 'brightness',
        direction: 'decrease',
        surfaces: makeSurfaces('automation'),
      },
    ],
  },
  Blind: {
    actions: [
      {
        kind: 'fixed',
        id: 'blind-open',
        label: 'Open',
        command: 'blind/open',
        value: 100,
        surfaces: makeSurfaces('dashboard', 'automation'),
        primary: true,
      },
      {
        kind: 'fixed',
        id: 'blind-close',
        label: 'Close',
        command: 'blind/close',
        value: 0,
        surfaces: makeSurfaces('dashboard', 'automation'),
        primary: true,
      },
      {
        kind: 'slider',
        id: 'blind-position',
        label: 'Position',
        command: 'blind/set_position',
        min: 0,
        max: 100,
        step: 1,
        surfaces: makeSurfaces('dashboard'),
      },
    ],
    triggers: [
      {
        kind: 'position',
        id: 'blind-opened',
        label: 'Opened',
        equals: 100,
        attributes: ['current_position', 'position'],
        surfaces: makeSurfaces('automation'),
      },
      {
        kind: 'position',
        id: 'blind-closed',
        label: 'Closed',
        equals: 0,
        attributes: ['current_position', 'position'],
        surfaces: makeSurfaces('automation'),
      },
    ],
  },
  TV: {
    actions: [
      {
        kind: 'toggle',
        id: 'tv-power',
        label: 'Power',
        commandOn: 'tv/turn_on',
        commandOff: 'tv/turn_off',
        surfaces: makeSurfaces('dashboard'),
        primary: true,
      },
      {
        kind: 'button',
        id: 'tv-on',
        label: 'Turn on',
        command: 'tv/turn_on',
        surfaces: makeSurfaces('automation'),
        primary: true,
      },
      {
        kind: 'button',
        id: 'tv-off',
        label: 'Turn off',
        command: 'tv/turn_off',
        surfaces: makeSurfaces('automation'),
      },
      {
        kind: 'slider',
        id: 'tv-volume',
        label: 'Volume',
        command: 'media/volume_set',
        min: 0,
        max: 100,
        step: 1,
        surfaces: makeSurfaces('dashboard', 'automation'),
      },
      {
        kind: 'button',
        id: 'tv-volume-up',
        label: 'Volume +',
        command: 'media/volume_up',
        surfaces: makeSurfaces('dashboard'),
      },
      {
        kind: 'button',
        id: 'tv-volume-down',
        label: 'Volume -',
        command: 'media/volume_down',
        surfaces: makeSurfaces('dashboard'),
      },
    ],
    triggers: [
      { kind: 'state', id: 'tv-on', label: 'Turns on', entityState: 'on', surfaces: makeSurfaces('automation') },
      { kind: 'state', id: 'tv-off', label: 'Turns off', entityState: 'off', surfaces: makeSurfaces('automation') },
    ],
  },
  Speaker: {
    actions: [
      {
        kind: 'toggle',
        id: 'speaker-power',
        label: 'Power',
        commandOn: 'speaker/turn_on',
        commandOff: 'speaker/turn_off',
        surfaces: makeSurfaces('dashboard'),
        primary: true,
      },
      {
        kind: 'button',
        id: 'speaker-on',
        label: 'Turn on',
        command: 'speaker/turn_on',
        surfaces: makeSurfaces('automation'),
        primary: true,
      },
      {
        kind: 'button',
        id: 'speaker-off',
        label: 'Turn off',
        command: 'speaker/turn_off',
        surfaces: makeSurfaces('automation'),
      },
      {
        kind: 'slider',
        id: 'speaker-volume',
        label: 'Volume',
        command: 'media/volume_set',
        min: 0,
        max: 100,
        step: 1,
        surfaces: makeSurfaces('dashboard', 'automation'),
      },
      {
        kind: 'button',
        id: 'speaker-volume-up',
        label: 'Volume +',
        command: 'media/volume_up',
        surfaces: makeSurfaces('dashboard'),
      },
      {
        kind: 'button',
        id: 'speaker-volume-down',
        label: 'Volume -',
        command: 'media/volume_down',
        surfaces: makeSurfaces('dashboard'),
      },
    ],
    triggers: [
      { kind: 'state', id: 'speaker-on', label: 'Turns on', entityState: 'on', surfaces: makeSurfaces('automation') },
      { kind: 'state', id: 'speaker-off', label: 'Turns off', entityState: 'off', surfaces: makeSurfaces('automation') },
    ],
  },
  Boiler: {
    actions: [
      {
        kind: 'button',
        id: 'boiler-temp-up',
        label: 'Temp +',
        command: 'boiler/temp_up',
        surfaces: makeSurfaces('dashboard'),
        primary: true,
      },
      {
        kind: 'button',
        id: 'boiler-temp-down',
        label: 'Temp -',
        command: 'boiler/temp_down',
        surfaces: makeSurfaces('dashboard'),
      },
      {
        kind: 'slider',
        id: 'boiler-set-temp',
        label: 'Set temperature',
        command: 'boiler/set_temperature',
        min: 10,
        max: 35,
        step: 1,
        surfaces: makeSurfaces('automation'),
        primary: true,
      },
    ],
    triggers: [
      {
        kind: 'attribute_delta',
        id: 'boiler-temp-increase',
        label: 'Temperature increases',
        attribute: 'current_temperature',
        direction: 'increase',
        surfaces: makeSurfaces('automation'),
      },
      {
        kind: 'attribute_delta',
        id: 'boiler-temp-decrease',
        label: 'Temperature decreases',
        attribute: 'current_temperature',
        direction: 'decrease',
        surfaces: makeSurfaces('automation'),
      },
    ],
  },
  Spotify: {
    actions: [
      {
        kind: 'button',
        id: 'spotify-play-pause',
        label: 'Play / Pause',
        command: 'media/play_pause',
        surfaces: makeSurfaces('dashboard'),
        primary: true,
      },
      {
        kind: 'button',
        id: 'spotify-next',
        label: 'Next',
        command: 'media/next',
        surfaces: makeSurfaces('dashboard'),
      },
      {
        kind: 'button',
        id: 'spotify-prev',
        label: 'Previous',
        command: 'media/previous',
        surfaces: makeSurfaces('dashboard'),
      },
      {
        kind: 'slider',
        id: 'spotify-volume',
        label: 'Volume',
        command: 'media/volume_set',
        min: 0,
        max: 100,
        step: 1,
        surfaces: makeSurfaces('dashboard'),
      },
    ],
    triggers: [],
    excludeFromAutomations: true,
  },
};

function resolveCapabilityKey(label: string): string | null {
  const normalized = label.trim().toLowerCase();
  for (const key of Object.keys(CAPABILITIES)) {
    if (key.toLowerCase() === normalized) return key;
  }
  return null;
}

export function getCapabilitiesForDevice(device: UIDevice): DeviceCapability | null {
  const label = getPrimaryLabel(device);
  const key = resolveCapabilityKey(label);
  if (!key) return null;
  return CAPABILITIES[key] ?? null;
}

export function getActionsForDevice(device: UIDevice, surface: Surface): DeviceActionSpec[] {
  const caps = getCapabilitiesForDevice(device);
  if (!caps) return [];
  return caps.actions.filter((a) => a.surfaces.includes(surface));
}

export function getTriggersForDevice(device: UIDevice, surface: Surface): DeviceTriggerSpec[] {
  const caps = getCapabilitiesForDevice(device);
  if (!caps) return [];
  return caps.triggers.filter((t) => t.surfaces.includes(surface));
}

export function isAutomationExcluded(device: UIDevice): boolean {
  const caps = getCapabilitiesForDevice(device);
  return !!caps?.excludeFromAutomations;
}

export function getEligibleDevicesForAutomations(devices: UIDevice[]): UIDevice[] {
  return devices.filter((d) => {
    const caps = getCapabilitiesForDevice(d);
    if (!caps || caps.excludeFromAutomations) return false;
    const actions = caps.actions.some((a) => a.surfaces.includes('automation'));
    const triggers = caps.triggers.some((t) => t.surfaces.includes('automation'));
    return actions || triggers;
  });
}

export function getTileEligibleDevicesForDashboard(devices: UIDevice[]): UIDevice[] {
  return devices.filter((d) => {
    const caps = getCapabilitiesForDevice(d);
    return !!caps && caps.actions.some((a) => a.surfaces.includes('dashboard'));
  });
}

export function pickPrimaryAction(device: UIDevice, surface: Surface): DeviceActionSpec | null {
  const actions = getActionsForDevice(device, surface);
  if (actions.length === 0) return null;
  const explicit = actions.find((a) => a.primary);
  return explicit ?? actions[0];
}

export function resolveToggleCommandForDevice(
  action: Extract<DeviceActionSpec, { kind: 'toggle' }>,
  device: UIDevice
): DeviceCommandId {
  const pos = getBlindPosition(device.attributes ?? {});
  const state = (device.state ?? '').toString().toLowerCase();
  const isOn =
    state === 'on' ||
    state === 'playing' ||
    state === 'opening' ||
    state === 'open' ||
    state === 'heat' ||
    (pos !== null && pos > 0);
  return isOn ? action.commandOff : action.commandOn;
}
