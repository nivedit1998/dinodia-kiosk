import type { AutomationDraft, AutomationAction, AutomationTrigger } from '../automations/automationModel';
import { compileAutomationDraftToHaConfig } from '../automations/haCompiler';
import type { HaMode } from './dinodia';
import type { HaConnection } from '../models/haConnection';
import { platformFetch } from './platformFetch';

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
};

type PlatformOpts = { haConnection?: HaConnection | null; mode?: HaMode };

function throwIfPlatformError(payload: any) {
  if (!payload || typeof payload !== 'object') return;
  const ok = (payload as any).ok;
  const err = (payload as any).error;
  if (ok === false || (typeof err === 'string' && err.trim().length > 0)) {
    throw new Error(typeof err === 'string' && err.trim().length > 0 ? err : 'Request failed');
  }
}

export async function listAutomations(opts: PlatformOpts = {}): Promise<AutomationSummary[]> {
  try {
    const { data } = await platformFetch<any>('/api/automations', {
      method: 'GET',
    });
    throwIfPlatformError(data);
    const response = Array.isArray(data) ? data : [];
    const mapped = response.map((item: any) => {
      const draft = isAutomationDraft(item.draft) ? (item.draft as AutomationDraft) : undefined;
      const draftSummaries = draft ? summarizeDraft(draft) : {};
      return {
        id: String(item.id ?? item.entity_id ?? item.slug ?? ''),
        alias: String(item.alias ?? item.name ?? 'Automation'),
        description: typeof item.description === 'string' ? item.description : '',
        enabled: item.enabled ?? item.state !== 'off',
        basicSummary: typeof item.basicSummary === 'string' ? item.basicSummary : draftSummaries.basicSummary,
        triggerSummary: typeof item.triggerSummary === 'string' ? item.triggerSummary : draftSummaries.triggerSummary,
        actionSummary: typeof item.actionSummary === 'string' ? item.actionSummary : draftSummaries.actionSummary,
        hasDeviceAction: typeof item.hasDeviceAction === 'boolean' ? item.hasDeviceAction : draftSummaries.hasDeviceAction,
        draft,
      };
    });
    const enriched = await enrichAutomationsWithHaDetails(mapped, opts);
    return filterAutomations(enriched);
  } catch (err) {
    const fallback = await maybeListAutomationsViaHa(opts);
    if (fallback) return fallback;
    throw err;
  }
}

export async function createAutomation(draft: AutomationDraft, opts: PlatformOpts = {}): Promise<void> {
  const payload = { draft, haConfig: compileAutomationDraftToHaConfig(draft) };
  try {
    const { data } = await platformFetch('/api/automations', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    throwIfPlatformError(data);
    return;
  } catch (err) {
    try {
      const ok = await maybeUpsertAutomationViaHa(payload.haConfig, opts);
      if (ok) return;
    } catch (fallbackErr) {
      throw fallbackErr;
    }
    throw err;
  }
}

export async function updateAutomation(id: string, draft: AutomationDraft, opts: PlatformOpts = {}): Promise<void> {
  const payload = { draft: { ...draft, id }, haConfig: compileAutomationDraftToHaConfig({ ...draft, id }) };
  try {
    const { data } = await platformFetch(`/api/automations/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    throwIfPlatformError(data);
    return;
  } catch (err) {
    try {
      const ok = await maybeUpsertAutomationViaHa(payload.haConfig, opts);
      if (ok) return;
    } catch (fallbackErr) {
      throw fallbackErr;
    }
    throw err;
  }
}

export async function deleteAutomation(id: string, opts: PlatformOpts = {}): Promise<void> {
  try {
    const { data } = await platformFetch(`/api/automations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    throwIfPlatformError(data);
    return;
  } catch (err) {
    try {
      const ok = await maybeDeleteAutomationViaHa(id, opts);
      if (ok) return;
    } catch (fallbackErr) {
      throw fallbackErr;
    }
    throw err;
  }
}

export async function setAutomationEnabled(id: string, enabled: boolean, opts: PlatformOpts = {}): Promise<void> {
  const action = enabled ? 'enable' : 'disable';
  try {
    const { data } = await platformFetch(`/api/automations/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
    });
    throwIfPlatformError(data);
    return;
  } catch (err) {
    try {
      const ok = await maybeToggleAutomationViaHa(id, enabled, opts);
      if (ok) return;
    } catch (fallbackErr) {
      throw fallbackErr;
    }
    throw err;
  }
}

type HaConn = { baseUrl: string; token: string };

function resolveHa(conn: HaConnection | null | undefined, mode?: HaMode): HaConn | null {
  if (!conn) return null;
  const raw = mode === 'cloud' && conn.cloudUrl ? conn.cloudUrl : conn.baseUrl;
  if (!raw) return null;
  return { baseUrl: raw.replace(/\/+$/, ''), token: conn.longLivedToken };
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

async function maybeListAutomationsViaHa(opts: PlatformOpts): Promise<AutomationSummary[] | null> {
  const ha = resolveHa(opts.haConnection, opts.mode);
  if (!ha) return null;
  try {
    const res = await haFetch(ha, '/api/states');
    const states = await res.json();
    if (!Array.isArray(states)) return [];
    const base = states
      .filter((s: any) => typeof s?.entity_id === 'string' && s.entity_id.startsWith('automation.'))
      .map((s: any) => ({
        id: s.attributes?.id || s.entity_id.replace('automation.', ''),
        alias: s.attributes?.friendly_name || s.entity_id,
        description: s.attributes?.description ?? '',
        enabled: String(s.state || '').toLowerCase() !== 'off',
      }));
    const enriched = await enrichAutomationsWithHaDetails(base, opts);
    return filterAutomations(enriched);
  } catch {
    return null;
  }
}

async function maybeUpsertAutomationViaHa(haConfig: any, opts: PlatformOpts): Promise<boolean> {
  const ha = resolveHa(opts.haConnection, opts.mode);
  if (!ha) return false;
  try {
    const id = haConfig.id || haConfig.alias || `mobile_${Date.now()}`;
    await haFetch(ha, `/api/config/automation/config/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify({ ...haConfig, id }),
    });
    return true;
  } catch (err) {
    throw err;
  }
}

async function maybeDeleteAutomationViaHa(id: string, opts: PlatformOpts): Promise<boolean> {
  const ha = resolveHa(opts.haConnection, opts.mode);
  if (!ha) return false;
  try {
    await haFetch(ha, `/api/config/automation/config/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return true;
  } catch {
    return false;
  }
}

async function maybeToggleAutomationViaHa(id: string, enabled: boolean, opts: PlatformOpts): Promise<boolean> {
  const ha = resolveHa(opts.haConnection, opts.mode);
  if (!ha) return false;
  try {
    const service = enabled ? 'turn_on' : 'turn_off';
    await haFetch(ha, `/api/services/automation/${service}`, {
      method: 'POST',
      body: JSON.stringify({ entity_id: `automation.${id}` }),
    });
    return true;
  } catch {
    return false;
  }
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

function isAutomationDraft(value: any): value is AutomationDraft {
  return value && typeof value === 'object' && Array.isArray(value.actions) && Array.isArray(value.triggers);
}

function summarizeDraft(draft: AutomationDraft) {
  const triggerSummary = summarizeTriggers(draft.triggers as unknown as AutomationTrigger[]);
  const actionSummary = summarizeActions(draft.actions as unknown as AutomationAction[]);
  const hasDeviceAction = Array.isArray(draft.actions) ? draft.actions.some((a) => a.kind === 'device_command') : undefined;
  const basicSummary = draft.description || draft.alias;
  return { triggerSummary, actionSummary, hasDeviceAction, basicSummary };
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

async function enrichAutomationsWithHaDetails(list: AutomationSummary[], opts: PlatformOpts): Promise<AutomationSummary[]> {
  const ha = resolveHa(opts.haConnection, opts.mode);
  if (!ha || list.length === 0) return list;
  let cachedConfigs: any[] | null = null;

  const ensureConfigs = async () => {
    if (cachedConfigs !== null) return cachedConfigs;
    cachedConfigs = await fetchHaAutomationConfigs(ha);
    return cachedConfigs;
  };

  const enriched = await Promise.all(
    list.map(async (item) => {
      if (item.triggerSummary && item.actionSummary && typeof item.hasDeviceAction === 'boolean') {
        return item;
      }
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
      return {
        ...item,
        description: item.description || config.description || '',
        basicSummary: item.basicSummary || config.description || config.alias || item.alias,
        triggerSummary: item.triggerSummary || triggerSummary,
        actionSummary: item.actionSummary || actionSummary,
        hasDeviceAction: typeof item.hasDeviceAction === 'boolean' ? item.hasDeviceAction : hasDeviceAction,
      };
    })
  );
  return enriched;
}

function filterAutomations(list: AutomationSummary[]): AutomationSummary[] {
  return list.filter((item) => {
    const alias = (item.alias || '').toLowerCase();
    const description = (item.description || '').toLowerCase();
    const isDefault = alias.includes('default') || description.includes('default');
    return !isDefault;
  });
}
