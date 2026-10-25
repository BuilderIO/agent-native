import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export const SESSION_TOKEN_KEY = "agent-native:session-token";
const NATIVE_TOKEN_MUTATION_TIMEOUT_MS = 5_000;
const nativeTokenMutationTails = new Map<string, Promise<void>>();
const nativeTokenMutationVersions = new Map<string, number>();

function nativeTokenMutationVersion(logicalKey: string): number {
  return nativeTokenMutationVersions.get(logicalKey) ?? 0;
}

function advanceNativeTokenMutationVersion(logicalKey: string): void {
  nativeTokenMutationVersions.set(
    logicalKey,
    nativeTokenMutationVersion(logicalKey) + 1,
  );
}

async function waitForNativeTokenMutations(logicalKey: string): Promise<void> {
  while (true) {
    const pending = nativeTokenMutationTails.get(logicalKey);
    if (!pending) return;
    await pending;
  }
}

async function withNativeTokenMutationLock<T>(
  logicalKey: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous =
    nativeTokenMutationTails.get(logicalKey) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => turn);
  nativeTokenMutationTails.set(logicalKey, tail);

  await previous;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const operationPromise = operation();
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () =>
          reject(
            new Error(
              `Session token storage operation timed out after ${NATIVE_TOKEN_MUTATION_TIMEOUT_MS}ms`,
            ),
          ),
        NATIVE_TOKEN_MUTATION_TIMEOUT_MS,
      );
    });
    return await Promise.race([operationPromise, timeoutPromise]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    release();
    if (nativeTokenMutationTails.get(logicalKey) === tail) {
      nativeTokenMutationTails.delete(logicalKey);
    }
  }
}

async function withNativeTokenMutation<T>(
  logicalKey: string,
  operation: () => Promise<T>,
): Promise<T> {
  advanceNativeTokenMutationVersion(logicalKey);
  try {
    return await withNativeTokenMutationLock(logicalKey, operation);
  } finally {
    advanceNativeTokenMutationVersion(logicalKey);
  }
}

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
  if (Platform.OS === "web") {
    return clean(await AsyncStorage.getItem(logicalKey));
  }

  const key = secureStoreKey(logicalKey);
  while (true) {
    await waitForNativeTokenMutations(logicalKey);
    const readVersion = nativeTokenMutationVersion(logicalKey);
    const secured = clean(await SecureStore.getItemAsync(key));
    if (
      readVersion !== nativeTokenMutationVersion(logicalKey) ||
      nativeTokenMutationTails.has(logicalKey)
    ) {
      continue;
    }
    if (secured) return secured;

    // Read legacy storage before taking the mutation lock. A timed-out storage
    // read must not block a later sign-in or sign-out behind an unresolved lock.
    const legacy = clean(await AsyncStorage.getItem(logicalKey));
    if (
      readVersion !== nativeTokenMutationVersion(logicalKey) ||
      nativeTokenMutationTails.has(logicalKey)
    ) {
      continue;
    }
    if (!legacy) return null;

    const migration = await withNativeTokenMutationLock(
      logicalKey,
      async () => {
        if (readVersion !== nativeTokenMutationVersion(logicalKey)) {
          return { status: "retry" } as const;
        }
        advanceNativeTokenMutationVersion(logicalKey);
        try {
          await SecureStore.setItemAsync(key, legacy, {
            keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
          });
          await AsyncStorage.removeItem(logicalKey);
          return { status: "migrated", token: legacy } as const;
        } finally {
          advanceNativeTokenMutationVersion(logicalKey);
        }
      },
    );
    if (
      migration.status === "retry" ||
      nativeTokenMutationVersion(logicalKey) !== readVersion + 2 ||
      nativeTokenMutationTails.has(logicalKey)
    ) {
      continue;
    }
    return migration.token;
  }
}

export async function saveSessionToken(
  token: string,
  logicalKey = SESSION_TOKEN_KEY,
): Promise<void> {
  const value = clean(token);
  if (!value) throw new Error("Session token is missing");

  if (Platform.OS === "web") {
    await AsyncStorage.setItem(logicalKey, value);
    return;
  }

  await withNativeTokenMutation(logicalKey, async () => {
    await SecureStore.setItemAsync(secureStoreKey(logicalKey), value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    await AsyncStorage.removeItem(logicalKey);
  });
}

export async function clearSessionToken(
  logicalKey = SESSION_TOKEN_KEY,
): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(logicalKey);
    return;
  }

  await withNativeTokenMutation(logicalKey, async () => {
    const results = await Promise.allSettled([
      SecureStore.deleteItemAsync(secureStoreKey(logicalKey)),
      AsyncStorage.removeItem(logicalKey),
    ]);
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  });
}
