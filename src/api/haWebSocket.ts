// src/api/haWebSocket.ts
import type { HaConnectionLike } from './ha';

type HaWsResult<T> = {
  id?: number;
  type?: string;
  success?: boolean;
  result?: T;
  error?: { message?: string };
};

function buildWsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  const proto = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${url.host}/api/websocket`;
}

export async function haWsCall<T>(
  ha: HaConnectionLike,
  type: string,
  payload: Record<string, unknown> = {},
  timeoutMs = 15000
): Promise<T> {
  const wsUrl = buildWsUrl(ha.baseUrl);
  return new Promise((resolve, reject) => {
    let settled = false;
    const requestId = 1;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Home Assistant request timed out.'));
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
        reject(new Error('Home Assistant request failed.'));
      }
    };

    ws.onerror = () => finish(new Error('Home Assistant connection failed.'));

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
        finish(new Error('Home Assistant authentication failed.'));
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
            new Error(
              data.error?.message || 'Home Assistant request was not successful.'
            )
          );
        }
      }
    };
  });
}
