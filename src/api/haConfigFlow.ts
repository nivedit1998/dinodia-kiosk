// src/api/haConfigFlow.ts
import type { HaConnectionLike } from './ha';
import { callHaApi } from './ha';

export type HaConfigFlowStep = {
  type?: string;
  flow_id?: string;
  handler?: string;
  step_id?: string;
  data_schema?: unknown;
  description_placeholders?: Record<string, unknown>;
  errors?: Record<string, string>;
  progress_action?: string;
};

export async function startConfigFlow(
  ha: HaConnectionLike,
  handler: string,
  opts?: { showAdvanced?: boolean }
): Promise<HaConfigFlowStep> {
  const step = await callHaApi<HaConfigFlowStep>(ha, '/api/config/config_entries/flow', {
    method: 'POST',
    body: JSON.stringify({
      handler,
      show_advanced_options: opts?.showAdvanced ?? false,
    }),
  }, 12000);
  return step ?? {};
}

export async function continueConfigFlow(
  ha: HaConnectionLike,
  flowId: string,
  userInput: Record<string, unknown>
): Promise<HaConfigFlowStep> {
  const body: Record<string, unknown> = {};
  if (userInput && Object.keys(userInput).length > 0) {
    body.user_input = userInput;
  }
  const step = await callHaApi<HaConfigFlowStep>(
    ha,
    `/api/config/config_entries/flow/${encodeURIComponent(flowId)}`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    12000
  );
  return step ?? {};
}

export async function abortConfigFlow(ha: HaConnectionLike, flowId: string): Promise<void> {
  await callHaApi<void>(
    ha,
    `/api/config/config_entries/flow/${encodeURIComponent(flowId)}`,
    { method: 'DELETE' },
    12000
  );
}

export function buildMatterUserInput(
  step: HaConfigFlowStep | null,
  input: { pairingCode: string; wifiSsid: string; wifiPassword: string }
) {
  const userInput: Record<string, unknown> = {};
  const schema = Array.isArray(step?.data_schema) ? step?.data_schema : [];
  const pairingCode = input.pairingCode.trim();
  const wifiSsid = input.wifiSsid.trim();
  const wifiPassword = input.wifiPassword;

  for (const field of schema) {
    const name =
      field && typeof field === 'object' && typeof (field as Record<string, unknown>).name === 'string'
        ? ((field as Record<string, unknown>).name as string)
        : null;
    if (!name) continue;
    const lower = name.toLowerCase();
    if (pairingCode && (lower.includes('code') || lower.includes('pin') || lower.includes('payload'))) {
      userInput[name] = pairingCode;
      continue;
    }
    if (wifiSsid && (lower.includes('ssid') || (lower.includes('network') && lower.includes('name')))) {
      userInput[name] = wifiSsid;
      continue;
    }
    if (
      wifiPassword &&
      (lower.includes('password') || lower.includes('passphrase') || lower.includes('psk'))
    ) {
      userInput[name] = wifiPassword;
    }
  }
  return userInput;
}
