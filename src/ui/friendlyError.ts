import { HUB_NAME } from './terms';

const sessionPhrases = ['session expired', 'expired session', 'unauthorized', '401'];
const networkPhrases = ['network', 'timed out', 'timeout', 'unreachable', 'failed to fetch'];
const verificationPhrases = ['verification', 'challenge', 'step-up', 'step up'];
const hubPhrases = ['home assistant', 'dinodia hub', 'hub'];

function includesAny(message: string, phrases: string[]) {
  return phrases.some((p) => message.includes(p));
}

export type FriendlyContext =
  | 'login'
  | 'setup'
  | 'claim'
  | 'remoteAccess'
  | 'addDevice'
  | 'settings'
  | 'generic';

export function friendlyError(err: unknown, context: FriendlyContext = 'generic'): string {
  const raw = (err instanceof Error ? err.message : String(err ?? '')).trim();
  const message = raw.toLowerCase();

  if (includesAny(message, sessionPhrases)) {
    return 'Session expired. Please log in again.';
  }

  if (includesAny(message, networkPhrases)) {
    return 'We could not reach Dinodia right now. Check Wi‑Fi and try again.';
  }

  if (context === 'remoteAccess' && includesAny(message, verificationPhrases)) {
    return 'Verify your email to continue remote access.';
  }

  if (context === 'addDevice' && includesAny(message, hubPhrases)) {
    return `${HUB_NAME} needs a moment. Stay on home Wi‑Fi and try again.`;
  }

  if (context === 'setup' && message.includes('email')) {
    return 'Please confirm your email to finish setup.';
  }

  if (context === 'login' && message.includes('credentials')) {
    return 'We could not log you in. Check your username and password and try again.';
  }

  if (raw.length > 0 && raw.length <= 200 && !/http[s]?:\/\//i.test(raw)) {
    return raw;
  }

  return 'We could not complete that right now. Please try again.';
}
