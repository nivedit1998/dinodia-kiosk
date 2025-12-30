import type { AutomationDraft, AutomationTrigger, AutomationAction } from './automationModel';
import type { DeviceCommandId } from '../capabilities/deviceCapabilities';

export type HaTrigger =
  | {
      platform: 'state';
      entity_id: string;
      to?: string;
      from?: string;
    }
  | {
      platform: 'numeric_state';
      entity_id: string;
      attribute: string;
      above?: number;
      below?: number;
    }
  | {
      platform: 'time';
      at: string;
      weekday?: string[];
    };

export type HaAction = {
  service: string;
  target?: { entity_id?: string };
  data?: Record<string, unknown>;
};

export type HaCondition =
  | {
      condition: 'time';
      weekday?: string[];
      after?: string;
      before?: string;
    }
  | {
      condition: 'template';
      value_template: string;
    };

export type HaAutomationConfig = {
  id?: string;
  alias: string;
  description?: string;
  trigger: HaTrigger[];
  action: HaAction[];
  mode?: string;
  condition?: HaCondition[];
};

export function compileAutomationDraftToHaConfig(draft: AutomationDraft): HaAutomationConfig {
  const trigger = draft.triggers.map(compileTrigger);
  const action = draft.actions
    .map((a) => compileAction(a))
    .filter((a): a is HaAction => !!a);
  const hasDays = draft.daysOfWeek && draft.daysOfWeek.length > 0;
  const at = (draft.triggerTime ?? '').trim();
  const condition: HaCondition[] = [];
  if (hasDays || at) {
    const cond: HaCondition = { condition: 'time' };
    if (hasDays) cond.weekday = draft.daysOfWeek;
    if (at) {
      const [h, m] = at.split(':').map((x) => Number(x));
      if (Number.isFinite(h) && Number.isFinite(m)) {
        const after = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        const minutesTotal = h * 60 + m;
        const next = (minutesTotal + 1) % (24 * 60);
        const nextH = Math.floor(next / 60);
        const nextM = next % 60;
        const before = `${String(nextH).padStart(2, '0')}:${String(nextM).padStart(2, '0')}`;
        cond.after = after;
        cond.before = before;
      }
    }
    condition.push(cond);
  }
  draft.triggers.forEach((t) => {
    const delta = deltaTemplateCondition(t);
    if (delta) condition.push(delta);
  });
  return {
    id: draft.id,
    alias: draft.alias,
    description: draft.description ?? '',
    trigger,
    action,
    mode: draft.mode ?? 'single',
    condition: condition.length > 0 ? condition : undefined,
  };
}

function compileTrigger(trigger: AutomationTrigger): HaTrigger {
  switch (trigger.kind) {
    case 'state':
      return {
        platform: 'state',
        entity_id: trigger.entityId,
        to: trigger.to ?? undefined,
        from: trigger.from ?? undefined,
      };
    case 'numeric_delta':
      return {
        platform: 'state',
        entity_id: trigger.entityId,
        attribute: trigger.attribute,
      };
    case 'position_equals':
      return {
        platform: 'numeric_state',
        entity_id: trigger.entityId,
        attribute: trigger.attribute,
        above: trigger.value - 0.01,
        below: trigger.value + 0.01,
      };
    case 'time':
      return {
        platform: 'time',
        at: trigger.at,
        weekday: trigger.daysOfWeek,
      };
    default:
      return { platform: 'state', entity_id: '' };
  }
}

function deltaTemplateCondition(trigger: AutomationTrigger): HaCondition | null {
  if (trigger.kind !== 'numeric_delta') return null;
  const attribute = trigger.attribute || 'state';
  const threshold = attribute.toLowerCase().includes('temp') ? 1 : 0.01;
  const path = attribute === 'state' ? 'state' : `attributes["${attribute}"]`;
  const toVal = `(trigger.to_state.${path} | float(0))`;
  const fromVal = `(trigger.from_state.${path} | float(0))`;
  const decrease = trigger.direction === 'decrease';
  const template = decrease
    ? `{{ (${fromVal} - ${toVal}) >= ${threshold} }}`
    : `{{ (${toVal} - ${fromVal}) >= ${threshold} }}`;
  return { condition: 'template', value_template: template };
}

function compileAction(action: AutomationAction): HaAction | null {
  if (action.kind !== 'device_command') return null;
  const entityId = action.entityId;
  const domain = entityId.split('.')[0] || '';
  const mapping = mapCommandToService(action.command, action.value, domain);
  if (!mapping) return null;
  return {
    service: mapping.service,
    target: { entity_id: entityId },
    data: mapping.data,
  };
}

function mapCommandToService(
  command: DeviceCommandId,
  value: number | undefined,
  domain: string
): { service: string; data?: Record<string, unknown> } | null {
  const lowerDomain = domain.toLowerCase();
  switch (command) {
    case 'light/turn_on':
      return { service: lowerDomain === 'light' ? 'light.turn_on' : 'homeassistant.turn_on' };
    case 'light/turn_off':
      return { service: lowerDomain === 'light' ? 'light.turn_off' : 'homeassistant.turn_off' };
    case 'light/set_brightness': {
      const pct = clamp(value ?? 0, 0, 100);
      if (lowerDomain === 'light') {
        return { service: 'light.turn_on', data: { brightness_pct: pct } };
      }
      // Fallback: best effort turn_on without brightness for non-light domains
      return { service: 'homeassistant.turn_on' };
    }
    case 'blind/open':
      return { service: 'cover.set_cover_position', data: { position: 100 } };
    case 'blind/close':
      return { service: 'cover.set_cover_position', data: { position: 0 } };
    case 'blind/set_position':
      return { service: 'cover.set_cover_position', data: { position: clamp(value ?? 0, 0, 100) } };
    case 'tv/turn_on':
    case 'speaker/turn_on':
      return { service: 'media_player.turn_on' };
    case 'tv/turn_off':
    case 'speaker/turn_off':
      return { service: 'media_player.turn_off' };
    case 'media/volume_set':
      return { service: 'media_player.volume_set', data: { volume_level: clamp((value ?? 0) / 100, 0, 1) } };
    case 'boiler/set_temperature':
      return { service: lowerDomain === 'climate' ? 'climate.set_temperature' : 'homeassistant.turn_on', data: { temperature: value } };
    case 'boiler/temp_up':
    case 'boiler/temp_down':
      return null; // dashboard-only convenience; avoid compiling to automations
    case 'media/play_pause':
      return { service: 'media_player.media_play_pause' };
    default:
      return null;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
