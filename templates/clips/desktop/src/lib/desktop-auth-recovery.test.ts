import { afterEach, describe, expect, it, vi } from "vitest";

import { startUnavailableAuthRecovery } from "./desktop-auth-recovery";

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
