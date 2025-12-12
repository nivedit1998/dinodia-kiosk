// src/utils/haCommands.ts
import { callHaService, fetchHaState, HaConnectionLike } from '../api/ha';

export const NUMERIC_COMMANDS = new Set<string>([
  'light/set_brightness',
  'media/volume_set',
]);

export async function handleDeviceCommand(params: {
  ha: HaConnectionLike;
  entityId: string;
  command: string;
  value?: number;
}) {
  const { ha, entityId, command, value } = params;

  if (NUMERIC_COMMANDS.has(command) && typeof value !== 'number') {
    throw new Error('Command requires numeric value');
  }

  const state = await fetchHaState(ha, entityId);
  const currentState = String(state.state ?? '');
  const domain = entityId.split('.')[0];
  const attrs = (state.attributes ?? {}) as Record<string, unknown>;

  switch (command) {
    case 'light/toggle':
      if (domain === 'light') {
        await callHaService(ha, 'light', currentState === 'on' ? 'turn_off' : 'turn_on', {
          entity_id: entityId,
        });
      } else {
        await callHaService(ha, 'homeassistant', 'toggle', { entity_id: entityId });
      }
      break;
    case 'light/set_brightness':
      if (domain !== 'light') throw new Error('Brightness supported only for lights');
      await callHaService(ha, 'light', 'turn_on', {
        entity_id: entityId,
        brightness_pct: clamp(value ?? 0, 0, 100),
      });
      break;
    case 'blind/open':
      await callHaService(ha, 'cover', 'open_cover', { entity_id: entityId });
      break;
    case 'blind/close':
      await callHaService(ha, 'cover', 'close_cover', { entity_id: entityId });
      break;
    case 'media/play_pause':
      await callHaService(
        ha,
        'media_player',
        currentState === 'playing' ? 'media_pause' : 'media_play',
        { entity_id: entityId }
      );
      break;
    case 'media/next':
      await callHaService(ha, 'media_player', 'media_next_track', { entity_id: entityId });
      break;
    case 'media/previous':
      await callHaService(ha, 'media_player', 'media_previous_track', {
        entity_id: entityId,
      });
      break;
    case 'media/volume_up':
      await callHaService(ha, 'media_player', 'volume_up', { entity_id: entityId });
      break;
    case 'media/volume_down':
      await callHaService(ha, 'media_player', 'volume_down', { entity_id: entityId });
      break;
    case 'media/volume_set':
      await callHaService(ha, 'media_player', 'volume_set', {
        entity_id: entityId,
        volume_level: clamp((value ?? 0) / 100, 0, 1),
      });
      break;
    case 'boiler/temp_up':
    case 'boiler/temp_down': {
      const currentTemp =
        typeof attrs.temperature === 'number'
          ? (attrs.temperature as number)
          : typeof attrs.current_temperature === 'number'
          ? (attrs.current_temperature as number)
          : 20;
      const delta = command === 'boiler/temp_up' ? 1 : -1;
      const newTemp = currentTemp + delta;
      await callHaService(ha, 'climate', 'set_temperature', {
        entity_id: entityId,
        temperature: newTemp,
      });
      break;
    }
    case 'tv/toggle_power':
    case 'speaker/toggle_power':
      await callHaService(
        ha,
        'media_player',
        currentState === 'off' || currentState === 'standby' ? 'turn_on' : 'turn_off',
        { entity_id: entityId }
      );
      break;
    default:
      throw new Error(`Unsupported command ${command}`);
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
