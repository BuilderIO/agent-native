import { beforeEach, describe, expect, it, vi } from "vitest";

const plaintextStorage = new Map<string, string>();
const secureStorage = new Map<string, string>();
const platform = vi.hoisted(() => ({ OS: "ios" as string }));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => plaintextStorage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      plaintextStorage.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      plaintextStorage.delete(key);
    }),
  },
}));

vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: vi.fn(async (key: string) => secureStorage.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    secureStorage.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    secureStorage.delete(key);
  }),
}));

vi.mock("react-native", () => ({ Platform: platform }));

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

import {
  clearSessionToken,
  getSessionToken,
  saveSessionToken,
  SESSION_TOKEN_KEY,
} from "./session-token-store";

describe("secure mobile session token storage", () => {
  beforeEach(() => {
    platform.OS = "ios";
    plaintextStorage.clear();
    secureStorage.clear();
  });

  it("migrates a legacy plaintext token and removes the old value", async () => {
    plaintextStorage.set(SESSION_TOKEN_KEY, "legacy-token");

    await expect(getSessionToken()).resolves.toBe("legacy-token");

    expect(plaintextStorage.has(SESSION_TOKEN_KEY)).toBe(false);
    expect([...secureStorage.values()]).toEqual(["legacy-token"]);
  });

  it("stores and deletes tokens without leaving a plaintext copy", async () => {
    plaintextStorage.set(SESSION_TOKEN_KEY, "stale-token");

    await saveSessionToken(" secure-token ");
    expect(plaintextStorage.has(SESSION_TOKEN_KEY)).toBe(false);
    await expect(getSessionToken()).resolves.toBe("secure-token");

    await clearSessionToken();
    await expect(getSessionToken()).resolves.toBeNull();
  });

  it("does not let a delayed legacy read overwrite a newer saved token", async () => {
    plaintextStorage.set(SESSION_TOKEN_KEY, "legacy-token");
    let resolveSecureRead!: (value: string | null) => void;
    vi.mocked(SecureStore.getItemAsync).mockImplementationOnce(
      () => new Promise((resolve) => (resolveSecureRead = resolve)),
    );

    const delayedRead = getSessionToken();
    await saveSessionToken("new-token");
    resolveSecureRead(null);

    await expect(delayedRead).resolves.toBe("new-token");
    await expect(getSessionToken()).resolves.toBe("new-token");
    expect(plaintextStorage.has(SESSION_TOKEN_KEY)).toBe(false);
  });

  it("does not let a never-settling legacy read block a later save", async () => {
    const logicalKey = "agent-native:session-token:unresolved-legacy-read";
    let markLegacyReadStarted!: () => void;
    const legacyReadStarted = new Promise<void>(
      (resolve) => (markLegacyReadStarted = resolve),
    );
    vi.mocked(AsyncStorage.getItem).mockImplementationOnce(() => {
      markLegacyReadStarted();
      return new Promise<null>(() => {});
    });

    const pendingRead = getSessionToken(logicalKey);
    await legacyReadStarted;
    const save = saveSessionToken("new-token", logicalKey);
    const saveFinished = await Promise.race([
      save.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);

    expect(saveFinished).toBe(true);
    await expect(getSessionToken(logicalKey)).resolves.toBe("new-token");
    void pendingRead;
  });

  it("holds the mutation lock until both token deletions settle", async () => {
    let releaseSecureDelete!: () => void;
    let markSecureDeleteStarted!: () => void;
    const secureDeleteStarted = new Promise<void>(
      (resolve) => (markSecureDeleteStarted = resolve),
    );
    vi.mocked(SecureStore.deleteItemAsync).mockImplementationOnce(
      (key) =>
        new Promise<void>((resolve) => {
          markSecureDeleteStarted();
          releaseSecureDelete = () => {
            secureStorage.delete(key);
            resolve();
          };
        }),
    );
    const asyncStorageFailure = new Error("AsyncStorage delete failed");
    vi.mocked(AsyncStorage.removeItem).mockRejectedValueOnce(
      asyncStorageFailure,
    );

    const clearing = clearSessionToken().then(
      () => null,
      (error: unknown) => error,
    );
    await secureDeleteStarted;
    const saving = saveSessionToken("new-token");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect([...secureStorage.values()]).toEqual([]);

    releaseSecureDelete();
    await expect(clearing).resolves.toBe(asyncStorageFailure);
    await saving;
    await expect(getSessionToken()).resolves.toBe("new-token");
  });

  it("uses web storage when SecureStore is unavailable", async () => {
    platform.OS = "web";

    await saveSessionToken("web-token");
    expect(plaintextStorage.get(SESSION_TOKEN_KEY)).toBe("web-token");
    expect(secureStorage).toEqual(new Map());
    await expect(getSessionToken()).resolves.toBe("web-token");

    await clearSessionToken();
    await expect(getSessionToken()).resolves.toBeNull();
  });
});
