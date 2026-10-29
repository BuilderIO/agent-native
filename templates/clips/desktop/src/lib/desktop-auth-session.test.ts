import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkDesktopAuthSession,
  type DesktopAuthStatus,
} from "./desktop-auth-session";

afterEach(() => {
  vi.useRealTimers();
});

function makeHarness() {
  let token = "stored-session-token";
  let status: DesktopAuthStatus = "unknown";
  let reachable = true;
  let signedInAs: string | null = null;
  const saveToken = vi.fn((_serverUrl: string, nextToken: string) => {
    token = nextToken;
  });
  const clearToken = vi.fn(() => {
    token = "";
  });
  const persistServerUrl = vi.fn();
  const setAuthStatus = vi.fn(
    (
      next:
        | DesktopAuthStatus
        | ((current: DesktopAuthStatus) => DesktopAuthStatus),
    ) => {
      status = typeof next === "function" ? next(status) : next;
    },
  );
  const setSignedInAs = vi.fn((email: string | null) => {
    signedInAs = email;
  });
  const setServerReachable = vi.fn((next: boolean) => {
    reachable = next;
  });

  return {
    get token() {
      return token;
    },
    get status() {
      return status;
    },
    get reachable() {
      return reachable;
    },
    get signedInAs() {
      return signedInAs;
    },
    saveToken,
    clearToken,
    persistServerUrl,
    setAuthStatus,
    setSignedInAs,
    setServerReachable,
  };
}

function checkOptions(
  harness: ReturnType<typeof makeHarness>,
  fetchSession: typeof fetch,
  isCurrentRequest = () => true,
) {
  return {
    serverUrl: "https://clips.example.test",
    isCurrentRequest,
    fetchSession,
    saveToken: harness.saveToken,
    clearToken: harness.clearToken,
    persistServerUrl: harness.persistServerUrl,
    setAuthStatus: harness.setAuthStatus,
    setSignedInAs: harness.setSignedInAs,
    setServerReachable: harness.setServerReachable,
  };
}

describe("checkDesktopAuthSession", () => {
  it("persists the authenticated server URL when a cookie-only session is accepted", async () => {
    const harness = makeHarness();
    const fetchSession = vi.fn<typeof fetch>(
      async () =>
        new Response('{"email":"user@example.test"}', { status: 200 }),
    );

    await expect(
      checkDesktopAuthSession(checkOptions(harness, fetchSession)),
    ).resolves.toEqual({ state: "authenticated" });

    expect(harness.persistServerUrl).toHaveBeenCalledWith(
      "https://clips.example.test",
    );
    expect(harness.token).toBe("stored-session-token");
    expect(harness.status).toBe("authed");
    expect(harness.signedInAs).toBe("user@example.test");
  });

  it("keeps the stored token when the server is temporarily unavailable", async () => {
    const harness = makeHarness();
    const fetchSession = vi.fn<typeof fetch>(
      async () => new Response("maintenance", { status: 503 }),
    );

    await expect(
      checkDesktopAuthSession(checkOptions(harness, fetchSession)),
    ).resolves.toEqual({ state: "unavailable" });

    expect(harness.token).toBe("stored-session-token");
    expect(harness.clearToken).not.toHaveBeenCalled();
    expect(harness.status).toBe("unavailable");
    expect(harness.reachable).toBe(false);
    expect(fetchSession).toHaveBeenCalledWith(
      "https://clips.example.test/_agent-native/auth/session",
      expect.objectContaining({
        credentials: "include",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("preserves credentials when a successful response body cannot be read", async () => {
    const harness = makeHarness();
    const fetchSession = vi.fn<typeof fetch>(
      async () => new Response("not-json", { status: 200 }),
    );

    await expect(
      checkDesktopAuthSession(checkOptions(harness, fetchSession)),
    ).resolves.toEqual({ state: "unavailable" });

    expect(harness.token).toBe("stored-session-token");
    expect(harness.clearToken).not.toHaveBeenCalled();
    expect(harness.status).toBe("unavailable");
  });

  it("treats a readable success without an authenticated identity as unavailable", async () => {
    const harness = makeHarness();
    const fetchSession = vi.fn<typeof fetch>(
      async () =>
        new Response('{"message":"session response was incomplete"}', {
          status: 200,
        }),
    );

    await expect(
      checkDesktopAuthSession(checkOptions(harness, fetchSession)),
    ).resolves.toEqual({ state: "unavailable" });

    expect(harness.token).toBe("stored-session-token");
    expect(harness.clearToken).not.toHaveBeenCalled();
    expect(harness.status).toBe("unavailable");
  });

  it("does not accept a malformed identity as an authenticated session", async () => {
    const harness = makeHarness();
    const fetchSession = vi.fn<typeof fetch>(
      async () =>
        new Response('{"email":{"unexpected":true}}', { status: 200 }),
    );

    await expect(
      checkDesktopAuthSession(checkOptions(harness, fetchSession)),
    ).resolves.toEqual({ state: "unavailable" });
    expect(harness.token).toBe("stored-session-token");
    expect(harness.signedInAs).toBeNull();
  });

  it("clears the token only when the current session check is rejected", async () => {
    const harness = makeHarness();
    const fetchSession = vi.fn<typeof fetch>(
      async () =>
        new Response('{"error":"Not authenticated"}', { status: 401 }),
    );

    await expect(
      checkDesktopAuthSession(checkOptions(harness, fetchSession)),
    ).resolves.toEqual({ state: "anonymous" });

    expect(harness.token).toBe("");
    expect(harness.clearToken).toHaveBeenCalledOnce();
    expect(harness.status).toBe("anon");
  });

  it("clears credentials when the session endpoint rejects access with 403", async () => {
    const harness = makeHarness();
    const fetchSession = vi.fn<typeof fetch>(
      async () => new Response('{"error":"Forbidden"}', { status: 403 }),
    );

    await expect(
      checkDesktopAuthSession(checkOptions(harness, fetchSession)),
    ).resolves.toEqual({ state: "anonymous" });

    expect(harness.token).toBe("");
    expect(harness.clearToken).toHaveBeenCalledOnce();
    expect(harness.status).toBe("anon");
  });

  it("does not clear credentials or update state from a stale response", async () => {
    const harness = makeHarness();
    let isCurrent = true;
    let resolveResponse!: (response: Response) => void;
    const fetchSession = vi.fn<typeof fetch>(
      () =>
        new Promise((resolve) => {
          resolveResponse = resolve;
        }),
    );

    const check = checkDesktopAuthSession(
      checkOptions(harness, fetchSession, () => isCurrent),
    );
    isCurrent = false;
    resolveResponse(new Response("{}", { status: 401 }));

    await expect(check).resolves.toEqual({ state: "stale" });
    expect(harness.token).toBe("stored-session-token");
    expect(harness.clearToken).not.toHaveBeenCalled();
    expect(harness.setAuthStatus).not.toHaveBeenCalled();
    expect(harness.setSignedInAs).not.toHaveBeenCalled();
  });

  it("turns a stalled request into an unavailable result without dropping the token", async () => {
    vi.useFakeTimers();
    const harness = makeHarness();
    const fetchSession = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Request timed out", "AbortError"));
          });
        }),
    );

    const check = checkDesktopAuthSession({
      ...checkOptions(harness, fetchSession),
      timeoutMs: 25,
    });
    await vi.advanceTimersByTimeAsync(25);

    await expect(check).resolves.toEqual({ state: "unavailable" });
    expect(harness.token).toBe("stored-session-token");
    expect(harness.clearToken).not.toHaveBeenCalled();
    expect(harness.status).toBe("unavailable");
    expect(vi.getTimerCount()).toBe(0);
  });
});
