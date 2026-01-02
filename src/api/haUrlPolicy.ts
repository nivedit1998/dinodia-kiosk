import { isLocalIp } from '../utils/net';

export function assertHaUrlAllowed(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol === 'https:') {
    return url;
  }
  if (url.protocol === 'http:' && isLocalIp(url.hostname)) {
    return url;
  }
  throw new Error('Dinodia Hub over http:// is only allowed on the local network.');
}

