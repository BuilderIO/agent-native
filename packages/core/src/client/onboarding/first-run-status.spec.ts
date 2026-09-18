// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchFirstRunOnboardingStatus,
  FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT,
} from "./first-run-status.js";

describe("first-run onboarding status", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("publishes the server decision for other initial flows", async () => {
    const listener = vi.fn();
    window.addEventListener(
      FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT,
      listener,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ firstRun: false }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    await expect(fetchFirstRunOnboardingStatus()).resolves.toBe(false);
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      firstRun: false,
    });
    window.removeEventListener(
      FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT,
      listener,
    );
  });

  it("publishes an ineligible decision when the status request fails", async () => {
    const listener = vi.fn();
    window.addEventListener(
      FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT,
      listener,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );

    await expect(fetchFirstRunOnboardingStatus()).rejects.toThrow(
      "first-run status: 503",
    );
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      firstRun: false,
    });
    window.removeEventListener(
      FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT,
      listener,
    );
  });

  it("shares concurrent status requests", async () => {
    const listener = vi.fn();
    window.addEventListener(
      FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT,
      listener,
    );
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ firstRun: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      Promise.all([
        fetchFirstRunOnboardingStatus(),
        fetchFirstRunOnboardingStatus(),
      ]),
    ).resolves.toEqual([true, true]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      firstRun: true,
    });
    window.removeEventListener(
      FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT,
      listener,
    );
  });

  it("fails closed when the status request hangs", async () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    let requestSignal: AbortSignal | undefined;
    window.addEventListener(
      FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT,
      listener,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
        requestSignal = init?.signal;
        return new Promise<Response>(() => {});
      }),
    );

    const request = fetchFirstRunOnboardingStatus();
    const requestExpectation = expect(request).rejects.toThrow(
      "first-run status timed out",
    );
    await vi.advanceTimersByTimeAsync(10_000);

    await requestExpectation;
    expect(requestSignal?.aborted).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      firstRun: false,
    });
    window.removeEventListener(
      FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT,
      listener,
    );
  });

  it("times out when the status response body hangs", async () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    let requestSignal: AbortSignal | undefined;
    window.addEventListener(
      FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT,
      listener,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
        requestSignal = init?.signal;
        return Promise.resolve({
          ok: true,
          json: () => new Promise<never>(() => {}),
        } as Response);
      }),
    );

    const request = fetchFirstRunOnboardingStatus();
    const requestExpectation = expect(request).rejects.toThrow(
      "first-run status timed out",
    );
    await vi.advanceTimersByTimeAsync(10_000);

    await requestExpectation;
    expect(requestSignal?.aborted).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      firstRun: false,
    });
    window.removeEventListener(
      FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT,
      listener,
    );
  });
});
