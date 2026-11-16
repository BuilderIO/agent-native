// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchFirstRunOnboardingStatus,
  completeFirstRunOnboarding,
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

  it("leaves the decision unresolved when the status request fails", async () => {
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
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(
      FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT,
      listener,
    );
  });

  it("publishes only the successful decision after a transient failure", async () => {
    const listener = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ firstRun: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    window.addEventListener(
      FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT,
      listener,
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchFirstRunOnboardingStatus()).rejects.toThrow(
      "first-run status: 503",
    );
    expect(listener).not.toHaveBeenCalled();
    await expect(fetchFirstRunOnboardingStatus()).resolves.toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      firstRun: true,
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
    await vi.advanceTimersByTimeAsync(4_999);
    expect(listener).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    await requestExpectation;
    expect(requestSignal?.aborted).toBe(true);
    expect(listener).not.toHaveBeenCalled();
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
    await vi.advanceTimersByTimeAsync(4_999);
    expect(listener).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    await requestExpectation;
    expect(requestSignal?.aborted).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(
      FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT,
      listener,
    );
  });
});

describe("app-owned first-run completion", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([
    { status: 503, body: { ok: true } },
    { status: 200, body: { ok: false } },
    { status: 200, body: {} },
  ])(
    "does not release the app on an unacknowledged completion: %j",
    async ({ status, body }) => {
      const done = vi.fn();
      window.addEventListener("agent-native:first-run-completed", done);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify(body), { status })),
      );
      await expect(completeFirstRunOnboarding()).rejects.toThrow();
      expect(done).not.toHaveBeenCalled();
      window.removeEventListener("agent-native:first-run-completed", done);
    },
  );
  it("retries the actual failed completion and releases only after acknowledgement", async () => {
    const done = vi.fn();
    window.addEventListener("agent-native:first-run-completed", done);
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal("fetch", request);
    await expect(completeFirstRunOnboarding()).rejects.toThrow("offline");
    expect(done).not.toHaveBeenCalled();
    await completeFirstRunOnboarding();
    expect(request).toHaveBeenCalledTimes(2);
    expect(done).toHaveBeenCalledOnce();
    expect(request.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      credentials: "same-origin",
    });
    window.removeEventListener("agent-native:first-run-completed", done);
  });
});
