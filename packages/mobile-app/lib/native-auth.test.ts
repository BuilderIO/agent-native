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

import { authenticateWithPassword } from "./native-auth";
import { getSessionToken } from "./session-token-store";

describe("mobile parent authentication", () => {
  beforeEach(() => {
    platform.OS = "ios";
    plaintextStorage.clear();
    secureStorage.clear();
    vi.restoreAllMocks();
  });

  it("signs in once and stores the returned parent session", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            email: "steve@builderio",
            token: "parent-session",
            orgId: "org-builder",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      authenticateWithPassword({
        mode: "sign-in",
        email: " steve@builderio ",
        password: "password-not-stored",
        baseUrl: "https://dispatch.example",
      }),
    ).resolves.toEqual({
      email: "steve@builderio",
      token: "parent-session",
      orgId: "org-builder",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dispatch.example/_agent-native/auth/login",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-Request-Source": "mobile" }),
        body: JSON.stringify({
          email: "steve@builderio",
          password: "password-not-stored",
        }),
      }),
    );
    await expect(getSessionToken()).resolves.toBe("parent-session");
  });

  it("creates an account, then signs in through the same parent path", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            token: "new-session",
            email: "new@example.com",
          }),
          {
            status: 200,
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      authenticateWithPassword({
        mode: "sign-up",
        email: "new@example.com",
        password: "password-not-stored",
        baseUrl: "https://dispatch.example",
      }),
    ).resolves.toMatchObject({
      email: "new@example.com",
      token: "new-session",
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://dispatch.example/_agent-native/auth/register",
      "https://dispatch.example/_agent-native/auth/login",
    ]);
  });

  it("surfaces server auth errors without persisting a token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: "Google sign-in is required." }),
            {
              status: 403,
            },
          ),
      ),
    );

    await expect(
      authenticateWithPassword({
        mode: "sign-in",
        email: "google@example.com",
        password: "password-not-stored",
      }),
    ).rejects.toThrow("Google sign-in is required.");
    await expect(getSessionToken()).resolves.toBeNull();
  });
});
