import type { AutomationDraft, AutomationAction, AutomationTrigger } from '../automations/automationModel';
import { compileAutomationDraftToHaConfig } from '../automations/haCompiler';
import type { HaMode } from './dinodia';
import type { HaConnection } from '../models/haConnection';
import { platformFetch } from './platformFetch';
import { getHaConnectionForMode } from './haSecrets';

export type AutomationSummary = {
  id: string;
  alias: string;
  description?: string;
  enabled: boolean;
  basicSummary?: string;
  triggerSummary?: string;
  actionSummary?: string;
  hasDeviceAction?: boolean;
  draft?: AutomationDraft | null;
  entities?: string[];
  hasTemplates?: boolean;
  canEdit?: boolean;
  mode?: string;
  raw?: {
    triggers?: unknown[];
    trigger?: unknown[];
    actions?: unknown[];
    action?: unknown[];
    conditions?: unknown[];
    condition?: unknown[];
    [key: string]: unknown;
  };
};

type PlatformOpts = { haConnection?: HaConnection | null; mode?: HaMode };

type HaConn = { baseUrl: string; token: string };

function makeAutomationId() {
  // Lightweight unique id that matches Next.js style: dinodia_<uuid-like>
  const random = Math.random().toString(16).slice(2);
  const time = Date.now().toString(16);
  return `dinodia_${time}${random}`.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
}

async function resolveHa(conn: HaConnection | null | undefined, mode?: HaMode): Promise<HaConn | null> {
  const targetMode: HaMode = mode === 'cloud' ? 'cloud' : 'home';
  try {
    const ha = await getHaConnectionForMode(targetMode, conn ?? undefined);
    return { baseUrl: ha.baseUrl.replace(/\/+$/, ''), token: ha.longLivedToken };
  } catch {
    return null;
  }
}

async function haFetch(ha: HaConn, path: string, init: RequestInit = {}) {
  const url = `${ha.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${ha.token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HA request failed (${res.status})`);
  }
  return res;
}

function entityIdFromTarget(target: any): string | null {
  if (!target) return null;
  if (typeof target === 'string' && target.trim().length > 0) return target;
  const direct = target.entity_id ?? target.device_id ?? target.area_id;
  if (Array.isArray(direct) && direct.length > 0) return String(direct[0]);
  if (typeof direct === 'string' && direct.trim().length > 0) return direct;
  return null;
}

function actionTargetsDevice(action: any): boolean {
  if (!action || typeof action !== 'object') return false;
  if (typeof action.device_id === 'string' && action.device_id.trim().length > 0) return true;
  const targetEntity = entityIdFromTarget(action.target);
  if (targetEntity) return true;
  const directEntity = action.entity_id ?? action.data?.entity_id;
  if (typeof directEntity === 'string' && directEntity.trim().length > 0) return true;
  if (Array.isArray(directEntity) && directEntity.length > 0) return true;
  if (Array.isArray(action.choose)) {
    return action.choose.some((branch: any) => {
      if (Array.isArray(branch.sequence) && branch.sequence.some(actionTargetsDevice)) return true;
      if (Array.isArray(branch.conditions) && branch.conditions.some(actionTargetsDevice)) return true;
      return false;
    });
  }
  if (Array.isArray(action.sequence)) {
    return action.sequence.some(actionTargetsDevice);
  }
  return false;
}

function summarizeTrigger(trigger: any): string | null {
  if (!trigger || typeof trigger !== 'object') return null;
  const platform = trigger.platform || trigger.kind;
  switch (platform) {
    case 'state': {
      const entityId = trigger.entity_id || trigger.entityId;
      if (!entityId) return 'State change';
      const from = trigger.from ?? trigger.from_state;
      const to = trigger.to ?? trigger.to_state;
      if (from && to) return `${entityId}: ${from} → ${to}`;
      if (to) return `${entityId} → ${to}`;
      if (from) return `${entityId} from ${from}`;
      return `${entityId} changed`;
    }
    case 'numeric_state': {
      const entityId = trigger.entity_id || trigger.entityId;
      const attribute = trigger.attribute ? ` (${trigger.attribute})` : '';
      const above = typeof trigger.above !== 'undefined' ? `>${trigger.above}` : '';
      const below = typeof trigger.below !== 'undefined' ? `<${trigger.below}` : '';
      const bounds = [above, below].filter(Boolean).join(' ');
      return `${entityId || 'Value'}${attribute} ${bounds}`.trim();
    }
    case 'numeric_delta': {
      const entityId = trigger.entityId || trigger.entity_id;
      const attribute = trigger.attribute ? ` (${trigger.attribute})` : '';
      const dir = trigger.direction === 'decrease' ? 'decreases' : 'increases';
      return `${entityId || 'Value'}${attribute} ${dir}`;
    }
    case 'position_equals': {
      const entityId = trigger.entityId || trigger.entity_id;
      const attribute = trigger.attribute ? ` (${trigger.attribute})` : '';
      const val = typeof trigger.value !== 'undefined' ? `=${trigger.value}` : '';
      return `${entityId || 'Position'}${attribute} ${val}`.trim();
    }
    case 'time': {
      const at = trigger.at || trigger.time || '';
      const daysArr = Array.isArray(trigger.weekday)
        ? trigger.weekday
        : Array.isArray(trigger.daysOfWeek)
        ? trigger.daysOfWeek
        : [];
      const days = daysArr.join(', ');
      if (at && days) return `${days} @ ${at}`;
      if (at) return `At ${at}`;
      if (days) return `On ${days}`;
      return 'Scheduled time';
    }
    default:
      return platform ? String(platform) : null;
  }
}

function summarizeTriggers(triggers: any[]): string | undefined {
  if (!Array.isArray(triggers) || triggers.length === 0) return undefined;
  const parts = triggers
    .map((t) => summarizeTrigger(t))
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
  if (parts.length === 0) return undefined;
  return parts.join('; ');
}

function summarizeAction(action: any): string | null {
  if (!action || typeof action !== 'object') return null;
  if (action.kind === 'device_command') {
    const target = action.entityId || action.entity_id;
    return target ? `${action.command} → ${target}` : String(action.command);
  }
  const targetVal =
    entityIdFromTarget(action.target) ||
    (typeof action.entity_id === 'string' ? action.entity_id : null) ||
    (Array.isArray(action.entity_id) ? action.entity_id.join(', ') : null) ||
    (typeof action.data?.entity_id === 'string' ? action.data.entity_id : null) ||
    (Array.isArray(action.data?.entity_id) ? action.data.entity_id.join(', ') : null);
  const target = typeof targetVal === 'string' ? targetVal : null;
  if (action.service) {
    return target ? `${action.service} → ${target}` : String(action.service);
  }
  if (action.type) {
    return target ? `${action.type} → ${target}` : String(action.type);
  }
  if (Array.isArray(action.sequence) && action.sequence.length > 0) {
    const nested = summarizeAction(action.sequence[0]);
    return nested ? `Sequence: ${nested}` : 'Sequence';
  }
  if (Array.isArray(action.choose) && action.choose.length > 0) {
    return 'Choice action';
  }
  return null;
}

function summarizeActions(actions: any[]): string | undefined {
  if (!Array.isArray(actions) || actions.length === 0) return undefined;
  const parts = actions
    .map((a) => summarizeAction(a))
    .filter((a): a is string => typeof a === 'string' && a.trim().length > 0);
  if (parts.length === 0) return undefined;
  return parts.join('; ');
}

function hasTemplates(node: any): boolean {
  if (node == null) return false;
  if (typeof node === 'string') return node.includes('{{');
  if (Array.isArray(node)) return node.some(hasTemplates);
  if (typeof node === 'object') {
    return Object.values(node as Record<string, unknown>).some(hasTemplates);
  }
  return false;
}

export async function listAutomations(opts: PlatformOpts = {}): Promise<AutomationSummary[]> {
  const ha = await resolveHa(opts.haConnection, opts.mode);
  if (!ha) throw new Error('Dinodia Hub connection is not configured.');
  const list = await maybeListAutomationsViaHa(ha);
  const enriched = await enrichAutomationsWithHaDetails(list, ha);
  return filterAutomations(enriched);
}

export async function createAutomation(draft: AutomationDraft, opts: PlatformOpts = {}): Promise<void> {
  const ha = await resolveHa(opts.haConnection, opts.mode);
  if (!ha) throw new Error('Dinodia Hub connection is not configured.');
  const haConfig = compileAutomationDraftToHaConfig(draft);
  const id = (haConfig.id || makeAutomationId()).replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
  const payload = { ...haConfig, id };
  await haFetch(ha, `/api/config/automation/config/${encodeURIComponent(id)}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  try {
    await platformFetch('/api/automations?recordOnly=1', {
      method: 'POST',
      body: JSON.stringify({ automationId: id }),
    });
  } catch {
    // best effort
  }
}

export async function updateAutomation(id: string, draft: AutomationDraft, opts: PlatformOpts = {}) {
  const ha = await resolveHa(opts.haConnection, opts.mode);
  if (!ha) throw new Error('Dinodia Hub connection is not configured.');
  const haConfig = compileAutomationDraftToHaConfig({ ...draft, id });
  await haFetch(ha, `/api/config/automation/config/${encodeURIComponent(id)}`, {
    method: 'POST',
    body: JSON.stringify({ ...haConfig, id }),
  });
}

export async function deleteAutomation(id: string, opts: PlatformOpts = {}): Promise<void> {
  const ha = await resolveHa(opts.haConnection, opts.mode);
  if (!ha) throw new Error('Dinodia Hub connection is not configured.');
  await haFetch(ha, `/api/config/automation/config/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(
    () => undefined
  );
  try {
    await platformFetch(`/api/automations/${encodeURIComponent(id)}?recordOnly=1`, {
      method: 'DELETE',
    });
  } catch {
    // best effort
  }
}

export async function setAutomationEnabled(id: string, enabled: boolean, opts: PlatformOpts = {}): Promise<void> {
  const ha = await resolveHa(opts.haConnection, opts.mode);
  if (!ha) throw new Error('Dinodia Hub connection is not configured.');
  const service = enabled ? 'turn_on' : 'turn_off';
  await haFetch(ha, `/api/services/automation/${service}`, {
    method: 'POST',
    body: JSON.stringify({ entity_id: `automation.${id}` }),
  });
}

async function fetchHaAutomationConfig(ha: HaConn, id: string) {
  try {
    const res = await haFetch(ha, `/api/config/automation/config/${encodeURIComponent(id)}`);
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchHaAutomationConfigs(ha: HaConn) {
  try {
    const res = await haFetch(ha, '/api/config/automation');
    const json = await res.json();
    return Array.isArray(json) ? json : null;
  } catch {
    return null;
  }
}

async function maybeListAutomationsViaHa(ha: HaConn): Promise<AutomationSummary[]> {
  try {
    const res = await haFetch(ha, '/api/states');
    const states = await res.json();
    if (!Array.isArray(states)) return [];
    return states
      .filter((s: any) => typeof s?.entity_id === 'string' && s.entity_id.startsWith('automation.'))
      .map((s: any) => ({
        id: s.attributes?.id || s.entity_id.replace('automation.', ''),
        alias: s.attributes?.friendly_name || s.entity_id,
        description: s.attributes?.description ?? '',
        enabled: String(s.state || '').toLowerCase() !== 'off',
        entities: [],
        mode: s.attributes?.mode ?? 'single',
      }));
  } catch {
    return [];
  }
}

async function enrichAutomationsWithHaDetails(list: AutomationSummary[], ha: HaConn): Promise<AutomationSummary[]> {
  if (list.length === 0) return list;
  let cachedConfigs: any[] | null = null;

  const ensureConfigs = async () => {
    if (cachedConfigs !== null) return cachedConfigs;
    cachedConfigs = await fetchHaAutomationConfigs(ha);
    return cachedConfigs;
  };

  const enriched = await Promise.all(
    list.map(async (item) => {
      let config = await fetchHaAutomationConfig(ha, item.id);
      if (!config) {
        const allConfigs = await ensureConfigs();
        if (allConfigs) {
          config = findMatchingConfig(item, allConfigs);
        }
      }
      if (!config) return item;
      const triggers = Array.isArray(config.trigger) ? config.trigger : [];
      const actions = Array.isArray(config.action) ? config.action : [];
      const triggerSummary = summarizeTriggers(triggers);
      const actionSummary = summarizeActions(actions);
      const hasDeviceAction = actions.length > 0 ? actions.some(actionTargetsDevice) : false;
      const entities = extractActionEntities(actions);
      const templates =
        hasTemplates(triggers) || hasTemplates(actions) || hasTemplates(config.condition ?? config.conditions);
      return {
        ...item,
        description: item.description || config.description || '',
        basicSummary: item.basicSummary || config.description || config.alias || item.alias,
        triggerSummary: item.triggerSummary || triggerSummary,
        actionSummary: item.actionSummary || actionSummary,
        hasDeviceAction: typeof item.hasDeviceAction === 'boolean' ? item.hasDeviceAction : hasDeviceAction,
        entities,
        hasTemplates: templates,
        canEdit: !templates,
        mode: config.mode ?? item.mode ?? 'single',
        raw: config,
      };
    })
  );
  return enriched;
}

function extractActionEntities(actions: any[]): string[] {
  const entities = new Set<string>();
  actions.forEach((action) => {
    const fromTarget = entityIdFromTarget(action.target);
    if (fromTarget) entities.add(fromTarget);
    const direct = action.entity_id ?? action.data?.entity_id;
    if (typeof direct === 'string') entities.add(direct);
    if (Array.isArray(direct)) {
      direct.forEach((d) => {
        if (typeof d === 'string') entities.add(d);
      });
    }
  });
  return Array.from(entities);
}

function findMatchingConfig(item: AutomationSummary, configs: any[]): any | null {
  const normalize = (v: any) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
  const targetIds = [item.id, `automation.${item.id}`].map(normalize);
  const targetAlias = normalize(item.alias);
  for (const cfg of configs) {
    const cfgId = normalize(cfg.id);
    const cfgAlias = normalize(cfg.alias);
    const cfgEntityId = normalize(cfg.entity_id);
    if (targetIds.includes(cfgId) || targetIds.includes(cfgEntityId) || (cfgAlias && cfgAlias === targetAlias)) {
      return cfg;
    }
  }
  return null;
}

function filterAutomations(list: AutomationSummary[]): AutomationSummary[] {
  return list.filter((item) => {
    const alias = (item.alias || '').toLowerCase();
    const description = (item.description || '').toLowerCase();
    const isDefault = alias.includes('default') || description.includes('default');
    return !isDefault;
  });
}
