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

  it("does not charge queue wait toward a native mutation timeout", async () => {
    vi.useFakeTimers();
    try {
      const logicalKey = "agent-native:session-token:slow-mutation-queue";
      const startedValues: string[] = [];
      let markFirstStarted!: () => void;
      let markSecondStarted!: () => void;
      const firstStarted = new Promise<void>(
        (resolve) => (markFirstStarted = resolve),
      );
      const secondStarted = new Promise<void>(
        (resolve) => (markSecondStarted = resolve),
      );
      vi.mocked(SecureStore.setItemAsync).mockImplementation(
        (key, value) =>
          new Promise<void>((resolve) => {
            startedValues.push(value);
            if (value === "first-token") markFirstStarted();
            if (value === "second-token") markSecondStarted();
            setTimeout(() => {
              secureStorage.set(key, value);
              resolve();
            }, 4_000);
          }),
      );

      const first = saveSessionToken("first-token", logicalKey);
      await firstStarted;
      const second = saveSessionToken("second-token", logicalKey);
      const third = saveSessionToken("third-token", logicalKey);
      const settled = Promise.allSettled([first, second, third]);

      await vi.advanceTimersByTimeAsync(4_000);
      await secondStarted;
      await vi.advanceTimersByTimeAsync(4_000);
      expect(startedValues).toEqual([
        "first-token",
        "second-token",
        "third-token",
      ]);
      await vi.advanceTimersByTimeAsync(4_000);

      expect((await settled).map((result) => result.status)).toEqual([
        "fulfilled",
        "fulfilled",
        "fulfilled",
      ]);
      await expect(getSessionToken(logicalKey)).resolves.toBe("third-token");
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails fast while a timed-out SecureStore write remains unsettled", async () => {
    vi.useFakeTimers();
    try {
      const logicalKey = "agent-native:session-token:unresolved-secure-write";
      let markSecureWriteStarted!: () => void;
      let releaseSecureWrite!: () => void;
      const secureWriteStarted = new Promise<void>(
        (resolve) => (markSecureWriteStarted = resolve),
      );
      vi.mocked(SecureStore.setItemAsync).mockImplementationOnce(
        (key, value) =>
          new Promise<void>((resolve) => {
            markSecureWriteStarted();
            releaseSecureWrite = () => {
              secureStorage.set(key, value);
              resolve();
            };
          }),
      );

      const stalledSave = saveSessionToken("stalled-token", logicalKey).then(
        () => null,
        (error: unknown) => error,
      );
      await secureWriteStarted;
      await vi.advanceTimersByTimeAsync(5_000);

      const error = await stalledSave;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/timed out/);
      await expect(
        saveSessionToken("overlapping-token", logicalKey),
      ).rejects.toThrow(/timed out/);
      await expect(getSessionToken(logicalKey)).rejects.toThrow(/timed out/);
      await expect(clearSessionToken(logicalKey)).rejects.toThrow(/timed out/);
      expect([...secureStorage.values()]).toEqual([]);

      vi.useRealTimers();
      releaseSecureWrite();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await expect(
        saveSessionToken("new-token", logicalKey),
      ).resolves.toBeUndefined();
      await expect(getSessionToken(logicalKey)).resolves.toBe("new-token");
    } finally {
      vi.useRealTimers();
    }
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
