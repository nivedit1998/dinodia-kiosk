// src/api/platformToken.ts
// Simple bearer token storage that can be swapped for secure storage later.
import { loadJson, removeKey, saveJson } from '../utils/storage';

const TOKEN_KEY = 'dinodia_platform_bearer_v1';

export async function getPlatformToken(): Promise<string | null> {
  try {
    const val = await loadJson<string>(TOKEN_KEY);
    return val ?? null;
  } catch {
    return null;
  }
}

export async function setPlatformToken(token: string): Promise<void> {
  if (!token) {
    await clearPlatformToken();
    return;
  }
  await saveJson(TOKEN_KEY, token);
}

export async function clearPlatformToken(): Promise<void> {
  await removeKey(TOKEN_KEY);
}
