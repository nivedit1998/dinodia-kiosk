// src/api/ha.ts
import { classifyDeviceByLabel, LabelCategory } from '../utils/labelCatalog';
import { fetchEntityToDeviceMap } from './haRegistry';
import { assertHaUrlAllowed } from './haUrlPolicy';

export type HaConnectionLike = {
  baseUrl: string;
  longLivedToken: string;
};

type HaRefresher = (failedHa: HaConnectionLike) => Promise<HaConnectionLike | null>;
let homeSecretsRefresher: HaRefresher | null = null;

export function setHomeSecretsRefresher(refresher: HaRefresher | null) {
  homeSecretsRefresher = refresher;
}

export type HAState = {
  entity_id: string;
  state: string;
  attributes: {
    friendly_name?: string;
    [key: string]: unknown;
  };
};

export type TemplateDeviceMeta = {
  entity_id: string;
  area_name: string | null;
  labels: string[];
  device_id: string | null;
};

export type EnrichedDevice = {
  entityId: string;
  name: string;
  state: string;
  areaName: string | null;
  labels: string[];
  labelCategory: LabelCategory | null;
  domain: string;
  attributes: Record<string, unknown>;
  deviceId: string | null;
};

function buildHaUrl(baseUrl: string, path: string): string {
  if (path.startsWith('/')) {
    return `${baseUrl}${path}`;
  }
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  return `${normalizedBase}/${path}`;
}

function describeNetworkFailure(baseUrl: string, path: string, err: unknown): Error {
  const original = err instanceof Error ? err.message : String(err);
  const hints: string[] = [];
  try {
    const parsed = new URL(baseUrl);
    const host = parsed.hostname.toLowerCase();
    if (host.endsWith('.local')) {
      hints.push(
        'Android devices often cannot resolve .local hostnames. Update the Dinodia Hub URL to use the IP address in Settings.'
      );
    }
    if (parsed.protocol === 'http:') {
      hints.push('Make sure you are on the same trusted home Wi‑Fi as the Dinodia Hub.');
    }
  } catch {
    // ignore parsing issues; baseUrl should already be valid
  }
  const hintText = hints.length > 0 ? ` ${hints.join(' ')}` : '';
  return new Error(`Dinodia Hub network issue: ${original}.${hintText} Please try again.`);
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 5000
): Promise<Response> {
  if (timeoutMs <= 0) {
    return fetch(url, options);
  }

  if (typeof AbortController !== 'undefined') {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(id);
    }
  }

  // Fallback: no AbortController support; race manually without cancelling.
  return await Promise.race([
    fetch(url, options),
    new Promise<Response>((_, reject) =>
      setTimeout(() => reject(new Error('Dinodia Hub request timed out. Please try again.')), timeoutMs)
    ),
  ]);
}

async function callHomeAssistantAPI<T>(
  ha: HaConnectionLike,
  path: string,
  init?: RequestInit,
  timeoutMs = 5000
): Promise<T> {
  assertHaUrlAllowed(ha.baseUrl);
  let attempt = 0;
  let currentHa = ha;

  while (attempt < 2) {
    attempt += 1;
    let res: Response;
    try {
      res = await fetchWithTimeout(
        buildHaUrl(currentHa.baseUrl, path),
        {
          ...init,
          headers: {
            Authorization: `Bearer ${currentHa.longLivedToken}`,
            'Content-Type': 'application/json',
            ...(init?.headers || {}),
          },
        },
        timeoutMs
      );
    } catch (err) {
      throw describeNetworkFailure(currentHa.baseUrl, path, err);
    }

    if (res.ok) {
      try {
        return (await res.json()) as T;
      } catch {
        return {} as T;
      }
    }

    if ((res.status === 401 || res.status === 403) && attempt === 1 && homeSecretsRefresher) {
      try {
        const refreshed = await homeSecretsRefresher(currentHa);
        if (refreshed && refreshed.baseUrl === currentHa.baseUrl) {
          currentHa = refreshed;
          continue;
        }
      } catch {
        // ignore refresh failures and fall through to error handling
      }
    }

    const text = await res.text().catch(() => '');
    throw new Error(
      `Dinodia Hub could not complete that request (${res.status}). ${text || 'Please try again.'}`
    );
  }

  throw new Error('Dinodia Hub request failed. Please try again.');
}

export async function callHaApi<T>(
  ha: HaConnectionLike,
  path: string,
  init?: RequestInit,
  timeoutMs = 5000
): Promise<T> {
  return callHomeAssistantAPI<T>(ha, path, init, timeoutMs);
}

export async function listHaStates(ha: HaConnectionLike): Promise<HAState[]> {
  return callHomeAssistantAPI<HAState[]>(ha, '/api/states');
}

async function renderHomeAssistantTemplate<T>(
  ha: HaConnectionLike,
  template: string,
  timeoutMs = 5000
): Promise<T> {
  const path = '/api/template';
  return callHomeAssistantAPI<T>(
    ha,
    path,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ template }),
    },
    timeoutMs
  );
}

export async function getDevicesWithMetadata(
  ha: HaConnectionLike
): Promise<EnrichedDevice[]> {
  const states = await callHomeAssistantAPI<HAState[]>(ha, '/api/states');

  const template = `{% set ns = namespace(result=[]) %}
{% for s in states %}
  {% set item = {
    "entity_id": s.entity_id,
    "area_name": area_name(s.entity_id),
    "device_id": device_id(s.entity_id),
    "labels": (labels(s.entity_id) | map('label_name') | list)
  } %}
  {% set ns.result = ns.result + [item] %}
{% endfor %}
{{ ns.result | tojson }}`;

  let meta: TemplateDeviceMeta[] = [];
  try {
    meta = await renderHomeAssistantTemplate<TemplateDeviceMeta[]>(ha, template);
  } catch {
    meta = [];
  }

  // Fallback: if template failed OR if any meta entries are missing device_id, supplement via entity registry.
  const hasAnyMissingDeviceId = meta.length === 0 || meta.some((m) => !m.device_id);
  const entityToDeviceMap = hasAnyMissingDeviceId ? await fetchEntityToDeviceMap(ha) : null;

  const metaByEntity = new Map<string, TemplateDeviceMeta>();
  for (const m of meta) {
    metaByEntity.set(m.entity_id, m);
  }

  return states.map((s) => {
    const domain = s.entity_id.split('.')[0] || '';
    const metaEntry = metaByEntity.get(s.entity_id);
    const deviceIdFromMeta =
      metaEntry && typeof metaEntry.device_id === 'string' && metaEntry.device_id.trim().length > 0
        ? metaEntry.device_id
        : null;
    const deviceId =
      deviceIdFromMeta ??
      (entityToDeviceMap ? entityToDeviceMap.get(s.entity_id) ?? null : null);
    const labels = (metaEntry?.labels ?? []).filter(
      (label): label is string =>
        typeof label === 'string' && label.trim().length > 0
    );
    const labelCategory =
      classifyDeviceByLabel(labels) ?? classifyDeviceByLabel([domain]);

    return {
      entityId: s.entity_id,
      name: s.attributes.friendly_name ?? s.entity_id,
      state: s.state,
      areaName: metaEntry?.area_name ?? null,
      labels,
      labelCategory,
      domain,
      attributes: s.attributes ?? {},
      deviceId,
    };
  });
}

export async function callHaService(
  ha: HaConnectionLike,
  domain: string,
  service: string,
  data: Record<string, unknown> = {},
  timeoutMs = 5000
) {
  const path = `/api/services/${domain}/${service}`;
  return callHomeAssistantAPI<any>(
    ha,
    path,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    },
    timeoutMs
  );
}

export async function probeHaReachability(
  ha: HaConnectionLike,
  timeoutMs = 2000
): Promise<boolean> {
  const url = buildHaUrl(ha.baseUrl, '/api/');
  let attempt = 0;
  let currentHa = ha;
  let currentUrl = buildHaUrl(currentHa.baseUrl, '/api/');

  while (attempt < 2) {
    attempt += 1;
    try {
      const res = await fetchWithTimeout(
        currentUrl,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${currentHa.longLivedToken}`,
          },
        },
        timeoutMs
      );
      if (res.ok) return true;
      if ((res.status === 401 || res.status === 403) && attempt === 1 && homeSecretsRefresher) {
        const refreshed = await homeSecretsRefresher(currentHa).catch(() => null);
        if (refreshed && refreshed.baseUrl === currentHa.baseUrl) {
          currentHa = refreshed;
          currentUrl = buildHaUrl(currentHa.baseUrl, '/api/');
          continue;
        }
      }
      return res.status > 0;
    } catch {
      return false;
    }
  }
  return false;
}

export async function fetchHaState(
  ha: HaConnectionLike,
  entityId: string
): Promise<HAState> {
  return callHomeAssistantAPI<HAState>(ha, `/api/states/${entityId}`);
}

export async function detectNabuCasaCloudUrl(
  ha: HaConnectionLike,
  timeoutMs = 4000
): Promise<string | null> {
  try {
    const data = await callHomeAssistantAPI<{ external_url?: string }>(
      ha,
      '/api/config',
      { method: 'GET' },
      timeoutMs
    );
    const candidate = (data?.external_url ?? '').trim();
    if (candidate && candidate.includes('.ui.nabu.casa')) {
      return candidate.replace(/\/+$/, '');
    }
    return null;
  } catch {
    return null;
  }
}

const MASK_REGEX = /[•●∙⋅·*]/;

export function isMaskedCloudUrl(url: string): boolean {
  return MASK_REGEX.test(url);
}

function collectUiUrls(obj: any): string[] {
  const results: string[] = [];
  const stack = [obj];
  while (stack.length) {
    const current = stack.pop();
    if (typeof current === 'string') {
      if (current.includes('.ui.nabu.casa')) {
        results.push(current);
      }
    } else if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
    } else if (current && typeof current === 'object') {
      for (const key of Object.keys(current)) {
        stack.push((current as any)[key]);
      }
    }
  }
  return results;
}

export async function detectNabuCasaRemoteUiUrl(
  ha: HaConnectionLike,
  timeoutMs = 4000
): Promise<string | null> {
  // Strategy A: WebSocket cloud/status
  try {
    const mod = await import('./haWebSocket');
    if (mod && typeof mod.haWsCall === 'function') {
      try {
        const wsResult = await mod.haWsCall<any>(ha, 'cloud/status');
        const urls = collectUiUrls(wsResult)
          .filter((u) => typeof u === 'string' && u.startsWith('https://') && u.includes('.ui.nabu.casa'))
          .map((u) => u.replace(/\/+$/, ''));
        const first = urls.find((u) => !isMaskedCloudUrl(u));
        if (first) return first;
      } catch {
        // ignore ws failures
      }
    }
  } catch {
    // ignore dynamic import issues
  }

  // Strategy B: REST /api/config external_url
  try {
    const restUrl = await detectNabuCasaCloudUrl(ha, timeoutMs);
    if (restUrl && !isMaskedCloudUrl(restUrl)) {
      return restUrl;
    }
  } catch {
    // ignore
  }

  return null;
}

export async function verifyHaCloudConnection(
  ha: HaConnectionLike,
  timeoutMs = 4000
): Promise<boolean> {
  try {
    await callHomeAssistantAPI(
      ha,
      '/api/config',
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      },
      timeoutMs
    );
    return true;
  } catch {
    return false;
  }
}
