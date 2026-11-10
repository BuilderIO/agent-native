import { afterEach, describe, expect, it, vi } from "vitest";

import {
  startUnavailableAuthRecovery,
  trackAuthRecoveryResult,
} from "./desktop-auth-recovery";
import {
  checkDesktopAuthSession,
  type DesktopAuthStatus,
} from "./desktop-auth-session";

afterEach(() => {
  vi.useRealTimers();
});

function makeRecoveryEnvironment() {
  let visible = true;
  const listeners = new Set<() => void>();
  return {
    options: {
      isVisible: () => visible,
      subscribeToResume: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    setVisible: (next: boolean) => {
      visible = next;
    },
    resume: () => {
      for (const listener of listeners) listener();
    },
  };
}

describe("startUnavailableAuthRecovery", () => {
  it("retries an unavailable check while preserving the authenticated session UI", async () => {
    vi.useFakeTimers();
    const environment = makeRecoveryEnvironment();
    let authStatus: DesktopAuthStatus = "authed";
    let signedInAs: string | null = "account@example.test";
    let recoveryActive = false;
    let token = "stored-session-token";
    const fetchSession = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("maintenance", { status: 503 }))
      .mockResolvedValueOnce(
        new Response('{"email":"account@example.test"}', { status: 200 }),
      );
    const setAuthStatus = (
      next:
        | DesktopAuthStatus
        | ((current: DesktopAuthStatus) => DesktopAuthStatus),
    ) => {
      authStatus = typeof next === "function" ? next(authStatus) : next;
    };
    const checkAuth = async () => {
      const result = await checkDesktopAuthSession({
        serverUrl: "https://clips.example.test",
        isCurrentRequest: () => true,
        fetchSession,
        saveToken: (_serverUrl, nextToken) => {
          token = nextToken;
        },
        clearToken: () => {
          token = "";
        },
        persistServerUrl: () => {},
        setAuthStatus,
        setSignedInAs: (email) => {
          signedInAs = email;
        },
        setServerReachable: () => {},
      });
      return trackAuthRecoveryResult(
        result,
        () => true,
        (active) => {
          recoveryActive = active;
        },
      );
    };

    await expect(checkAuth()).resolves.toEqual({ state: "unavailable" });
    expect(authStatus).toBe("authed");
    expect(signedInAs).toBe("account@example.test");
    expect(token).toBe("stored-session-token");
    expect(recoveryActive).toBe(true);

    const stop = startUnavailableAuthRecovery(checkAuth, environment.options);
    await vi.advanceTimersByTimeAsync(1000);

    expect(fetchSession).toHaveBeenCalledTimes(2);
    expect(authStatus).toBe("authed");
    expect(signedInAs).toBe("account@example.test");
    expect(recoveryActive).toBe(false);
    expect(token).toBe("stored-session-token");

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchSession).toHaveBeenCalledTimes(2);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not let a superseded check change recovery state", () => {
    const setRecoveryActive = vi.fn();

    expect(
      trackAuthRecoveryResult(
        { state: "unavailable" },
        () => false,
        setRecoveryActive,
      ),
    ).toEqual({ state: "stale" });
    expect(setRecoveryActive).not.toHaveBeenCalled();
  });

  it("retries with backoff until the session is accepted, then stops", async () => {
    vi.useFakeTimers();
    const environment = makeRecoveryEnvironment();
    const checkAuth = vi
      .fn()
      .mockResolvedValueOnce({ state: "unavailable" as const })
      .mockResolvedValueOnce({ state: "unavailable" as const })
      .mockResolvedValueOnce({ state: "authenticated" as const });
    const stop = startUnavailableAuthRecovery(checkAuth, environment.options);

    await vi.advanceTimersByTimeAsync(999);
    expect(checkAuth).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(checkAuth).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2999);
    expect(checkAuth).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(checkAuth).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(checkAuth).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(checkAuth).toHaveBeenCalledTimes(3);

    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("coalesces focus and visibility retries while a check is in flight", async () => {
    vi.useFakeTimers();
    const environment = makeRecoveryEnvironment();
    let resolveCheck!: (result: { state: "unavailable" }) => void;
    const checkAuth = vi.fn(
      () =>
        new Promise<{ state: "unavailable" }>((resolve) => {
          resolveCheck = resolve;
        }),
    );
    const stop = startUnavailableAuthRecovery(checkAuth, environment.options);

    environment.resume();
    expect(checkAuth).toHaveBeenCalledOnce();
    environment.resume();
    environment.resume();
    expect(checkAuth).toHaveBeenCalledOnce();

    stop();
    resolveCheck({ state: "unavailable" });
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(checkAuth).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rechecks immediately when the WebView becomes visible", async () => {
    vi.useFakeTimers();
    const environment = makeRecoveryEnvironment();
    environment.setVisible(false);
    const checkAuth = vi
      .fn()
      .mockResolvedValue({ state: "anonymous" as const });
    const stop = startUnavailableAuthRecovery(checkAuth, environment.options);

    await vi.advanceTimersByTimeAsync(1000);
    expect(checkAuth).not.toHaveBeenCalled();

    environment.setVisible(true);
    environment.resume();
    vi.runAllTicks();
    expect(checkAuth).toHaveBeenCalledOnce();

    stop();
  });
});
