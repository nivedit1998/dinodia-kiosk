// src/utils/storage.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

export async function saveJson(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export async function loadJson<T>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function removeKey(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}
