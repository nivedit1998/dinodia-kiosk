import { ENV } from '../config/env';
import type { AutomationDraft } from '../automations/automationModel';
import { compileAutomationDraftToHaConfig } from '../automations/haCompiler';
import type { HaMode } from './dinodia';
import type { HaConnection } from '../models/haConnection';

export type AutomationSummary = {
  id: string;
  alias: string;
  description?: string;
  enabled: boolean;
};

function getPlatformApiBase(): string {
  const raw = (ENV.DINODIA_PLATFORM_API || '').trim();
  if (!raw) throw new Error('Dinodia Platform API is not configured. Set DINODIA_PLATFORM_API.');
  return raw.replace(/\/+$/, '');
}

async function handleResponse(res: Response) {
  if (res.ok) {
    try {
      const json = await res.json();
      if (json && typeof json === 'object') {
        const ok = (json as any).ok;
        const err = (json as any).error;
        if (ok === false || (typeof err === 'string' && err.trim().length > 0)) {
          throw new Error(typeof err === 'string' && err.trim().length > 0 ? err : 'Request failed');
        }
      }
      return json;
    } catch {
      return null;
    }
  }
  const text = await res.text().catch(() => '');
  throw new Error(text || `Request failed (${res.status})`);
}

type PlatformOpts = { haConnection?: HaConnection | null; mode?: HaMode };

export async function listAutomations(opts: PlatformOpts = {}): Promise<AutomationSummary[]> {
  try {
    const base = getPlatformApiBase();
    const res = await fetch(`${base}/api/automations`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    const data = await handleResponse(res);
    if (!Array.isArray(data)) return [];
    return data.map((item: any) => ({
      id: String(item.id ?? item.entity_id ?? item.slug ?? ''),
      alias: String(item.alias ?? item.name ?? 'Automation'),
      description: typeof item.description === 'string' ? item.description : '',
      enabled: item.enabled ?? item.state !== 'off',
    }));
  } catch (err) {
    const fallback = await maybeListAutomationsViaHa(opts);
    if (fallback) return fallback;
    throw err;
  }
}

export async function createAutomation(draft: AutomationDraft, opts: PlatformOpts = {}): Promise<void> {
  const payload = { draft, haConfig: compileAutomationDraftToHaConfig(draft) };
  try {
    const base = getPlatformApiBase();
    const res = await fetch(`${base}/api/automations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    await handleResponse(res);
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
    const base = getPlatformApiBase();
    const res = await fetch(`${base}/api/automations/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    await handleResponse(res);
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
    const base = getPlatformApiBase();
    const res = await fetch(`${base}/api/automations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    await handleResponse(res);
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
    const base = getPlatformApiBase();
    const res = await fetch(`${base}/api/automations/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    await handleResponse(res);
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
    return states
      .filter((s: any) => typeof s?.entity_id === 'string' && s.entity_id.startsWith('automation.'))
      .map((s: any) => ({
        id: s.attributes?.id || s.entity_id.replace('automation.', ''),
        alias: s.attributes?.friendly_name || s.entity_id,
        description: s.attributes?.description ?? '',
        enabled: String(s.state || '').toLowerCase() !== 'off',
      }));
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
