// src/api/haWebSocket.ts
import type { HaConnectionLike } from './ha';
import { assertHaUrlAllowed } from './haUrlPolicy';

type HaWsResult<T> = {
  id?: number;
  type?: string;
  success?: boolean;
  result?: T;
  error?: { message?: string };
};

function buildWsUrl(baseUrl: string): string {
  const url = assertHaUrlAllowed(baseUrl);
  return url.protocol === 'https:'
    ? `wss://${url.host}/api/websocket`
    : `ws://${url.host}/api/websocket`;
}

export async function haWsCall<T>(
  ha: HaConnectionLike,
  type: string,
  payload: Record<string, unknown> = {},
  timeoutMs = 15000,
  allowAuthRetry = true
): Promise<T> {
  const wsUrl = buildWsUrl(ha.baseUrl);
  return new Promise((resolve, reject) => {
    let settled = false;
    const requestId = 1;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Dinodia Hub request timed out.'));
      }
    }, timeoutMs);

    const ws = new WebSocket(wsUrl);

    const finish = (err?: Error, result?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // ignore
      }
      if (err) {
        reject(err);
      } else if (result !== undefined) {
        resolve(result);
      } else {
        reject(new Error('Dinodia Hub request failed.'));
      }
    };

    ws.onerror = () => finish(new Error('Dinodia Hub connection failed.'));

    ws.onmessage = (event) => {
      let data: HaWsResult<T> | null = null;
      try {
        data = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (!data) return;

      if (data.type === 'auth_required') {
        ws.send(
          JSON.stringify({
            type: 'auth',
            access_token: ha.longLivedToken,
          })
        );
        return;
      }

      if (data.type === 'auth_invalid') {
        // One-time retry: refresh home secrets and reconnect with a fresh token if available.
        if (allowAuthRetry) {
          (async () => {
            try {
              const { fetchHomeModeSecrets } = await import('./haSecrets');
              const refreshed = await fetchHomeModeSecrets(true);
              const normalizedBase = refreshed.baseUrl.replace(/\/+$/, '');
              if (normalizedBase === ha.baseUrl.replace(/\/+$/, '')) {
                const retried = await haWsCall<T>(
                  { baseUrl: normalizedBase, longLivedToken: refreshed.longLivedToken },
                  type,
                  payload,
                  timeoutMs,
                  false
                );
                finish(undefined, retried);
                return;
              }
            } catch {
              // ignore and fall through to failure
            }
            finish(new Error('Dinodia Hub authentication failed.'));
          })();
          return;
        }
        finish(new Error('Dinodia Hub authentication failed.'));
        return;
      }

      if (data.type === 'auth_ok') {
        ws.send(
          JSON.stringify({
            id: requestId,
            type,
            ...payload,
          })
        );
        return;
      }

      if (data.id === requestId) {
        if (data.success) {
          finish(undefined, data.result as T);
        } else {
          finish(
            new Error(data.error?.message || 'Dinodia Hub request was not successful.')
          );
        }
      }
    };
  });
}
