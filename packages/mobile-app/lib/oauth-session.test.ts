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

import { completeOAuthCallback, rememberOAuthState } from "./oauth-session";
import { OAUTH_STATE_KEY } from "./oauth-storage";
import { getSessionToken } from "./session-token-store";

describe("mobile OAuth session handoff", () => {
  beforeEach(() => {
    platform.OS = "ios";
    plaintextStorage.clear();
    secureStorage.clear();
  });

  it("persists state before accepting the callback token", async () => {
    await rememberOAuthState(
      "https://accounts.google.com/o/oauth2/v2/auth?state=server-state",
    );

    await expect(
      completeOAuthCallback(
        "agentnative://oauth-complete?token=mobile-token&state=server-state",
        { tokenKey: null, ownerKeyName: null, baseUrl: null },
      ),
    ).resolves.toBe("mobile-token");
    await expect(getSessionToken()).resolves.toBe("mobile-token");
    await expect(
      (
        await import("@react-native-async-storage/async-storage")
      ).default.getItem(OAUTH_STATE_KEY),
    ).resolves.toBeNull();
  });

  it("keeps the pending state when a callback does not match", async () => {
    await rememberOAuthState(
      "https://accounts.google.com/o/oauth2/v2/auth?state=server-state",
    );

    await expect(
      completeOAuthCallback(
        "agentnative://oauth-complete?token=forged-token&state=other-state",
        { tokenKey: null, ownerKeyName: null, baseUrl: null },
      ),
    ).resolves.toBeNull();
    await expect(getSessionToken()).resolves.toBeNull();
    await expect(
      (
        await import("@react-native-async-storage/async-storage")
      ).default.getItem(OAUTH_STATE_KEY),
    ).resolves.toBe("server-state");
  });
});
