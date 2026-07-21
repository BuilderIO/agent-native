import { beforeEach, describe, expect, it, vi } from "vitest";

const plaintextStorage = new Map<string, string>();
const secureStorage = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => plaintextStorage.get(key) ?? null),
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

import {
  clearSessionToken,
  getSessionToken,
  saveSessionToken,
  SESSION_TOKEN_KEY,
} from "./session-token-store";

describe("secure mobile session token storage", () => {
  beforeEach(() => {
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
});
