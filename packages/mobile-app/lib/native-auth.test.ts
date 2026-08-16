import { beforeEach, describe, expect, it, vi } from "vitest";

const plaintextStorage = new Map<string, string>();
const secureStorage = new Map<string, string>();
const platform = vi.hoisted(() => ({ OS: "ios" as string }));
const browser = vi.hoisted(() => ({
  openAuthSessionAsync: vi.fn(),
  getCustomTabsSupportingBrowsersAsync: vi.fn(),
  openBrowserAsync: vi.fn(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => plaintextStorage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      plaintextStorage.set(key, value);
    }),
    multiSet: vi.fn(async (entries: [string, string][]) => {
      for (const [key, value] of entries) plaintextStorage.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      plaintextStorage.delete(key);
    }),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const key of keys) plaintextStorage.delete(key);
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
vi.mock("expo-web-browser", () => browser);

import {
  authenticateWithPassword,
  signInWithGoogle,
  signInWithMagicLink,
  validateNativeSession,
} from "./native-auth";
import { getSessionToken } from "./session-token-store";

describe("mobile parent authentication", () => {
  beforeEach(() => {
    platform.OS = "ios";
    plaintextStorage.clear();
    secureStorage.clear();
    vi.restoreAllMocks();
    browser.openAuthSessionAsync.mockReset();
    browser.getCustomTabsSupportingBrowsersAsync.mockReset();
    browser.openBrowserAsync.mockReset();
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

  it("accepts a valid parent session when checking the native app", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ email: "steve@builderio", orgId: "org-builder" }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      validateNativeSession("parent-session", "https://dispatch.example"),
    ).resolves.toEqual({
      email: "steve@builderio",
      token: "parent-session",
      orgId: "org-builder",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://dispatch.example/_agent-native/auth/session?_session=parent-session",
      { headers: { Accept: "application/json" } },
    );
  });

  it("rejects a child or expired token as the native parent session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
          }),
      ),
    );

    await expect(
      validateNativeSession("child-session", "https://dispatch.example"),
    ).resolves.toBeNull();
  });

  it("completes Google sign-in in the parent session", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ url: "https://accounts.google.com/auth?state=s1" }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ email: "steve@builderio", orgId: "org-builder" }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    browser.openAuthSessionAsync.mockResolvedValue({
      type: "success",
      url: "agentnative://oauth-complete?token=google-session&state=s1",
    });

    await expect(
      signInWithGoogle({ baseUrl: "https://dispatch.example" }),
    ).resolves.toEqual({
      email: "steve@builderio",
      token: "google-session",
      orgId: "org-builder",
    });
    await expect(getSessionToken()).resolves.toBe("google-session");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://dispatch.example/_agent-native/google/auth-url?mobile=1",
      "https://dispatch.example/_agent-native/auth/session?_session=google-session",
    ]);
  });

  it("waits for a verified magic link through the one-time parent exchange", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            flowId: "flow-1",
            verifier: "v".repeat(32),
          }),
          {
            status: 200,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ pending: true }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ email: "steve@builderio", orgId: "org-builder" }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      signInWithMagicLink({
        email: " steve@builderio ",
        baseUrl: "https://dispatch.example",
        timeoutMs: 100,
      }),
    ).rejects.toThrow("expired");

    const fastFetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            flowId: "flow-2",
            verifier: "v".repeat(32),
          }),
          {
            status: 200,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "magic-session" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ email: "steve@builderio", orgId: "org-builder" }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fastFetchMock);

    await expect(
      signInWithMagicLink({
        email: "steve@builderio",
        baseUrl: "https://dispatch.example",
      }),
    ).resolves.toEqual({
      email: "steve@builderio",
      token: "magic-session",
      orgId: "org-builder",
    });
  });
});
