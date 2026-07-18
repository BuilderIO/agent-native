import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

export const SESSION_TOKEN_KEY = "agent-native:session-token";

function secureStoreKey(logicalKey: string): string {
  return Array.from(logicalKey, (character) =>
    /[A-Za-z0-9.-]/.test(character)
      ? character
      : `_${character.codePointAt(0)?.toString(16)}_`,
  ).join("");
}

function clean(value: string | null | undefined): string | null {
  const result = value?.trim();
  return result ? result : null;
}

export async function getSessionToken(
  logicalKey = SESSION_TOKEN_KEY,
): Promise<string | null> {
  const key = secureStoreKey(logicalKey);
  const secured = clean(await SecureStore.getItemAsync(key));
  if (secured) return secured;

  const legacy = clean(await AsyncStorage.getItem(logicalKey));
  if (!legacy) return null;

  await SecureStore.setItemAsync(key, legacy, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  await AsyncStorage.removeItem(logicalKey);
  return legacy;
}

export async function saveSessionToken(
  token: string,
  logicalKey = SESSION_TOKEN_KEY,
): Promise<void> {
  const value = clean(token);
  if (!value) throw new Error("Session token is missing");
  await SecureStore.setItemAsync(secureStoreKey(logicalKey), value, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  await AsyncStorage.removeItem(logicalKey);
}

export async function clearSessionToken(
  logicalKey = SESSION_TOKEN_KEY,
): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(secureStoreKey(logicalKey)),
    AsyncStorage.removeItem(logicalKey),
  ]);
}
