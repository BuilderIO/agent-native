import { afterEach, describe, expect, it, vi } from "vitest";

import {
  callAction,
  defaultActionQueryRetry,
  defaultActionQueryRetryDelay,
  serializeActionQueryParams,
} from "./use-action.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("serializeActionQueryParams", () => {
  it("serializes array GET params with bracket keys so single values stay arrays", () => {
    const query = serializeActionQueryParams({
      libraryId: "lib-1",
      candidateRunIds: ["run-1", "run-2"],
      empty: undefined,
      none: null,
    });

    const params = new URLSearchParams(query);
    expect(params.get("libraryId")).toBe("lib-1");
    expect(params.getAll("candidateRunIds[]")).toEqual(["run-1", "run-2"]);
    expect(params.has("empty")).toBe(false);
    expect(params.has("none")).toBe(false);
  });
});

describe("callAction", () => {
  it("calls mutating actions through the framework action transport", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ok: true, id: "meal-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(callAction("log-meal", { name: "Salad" })).resolves.toEqual({
      ok: true,
      id: "meal-1",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/_agent-native/actions/log-meal",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
        cache: "no-store",
        body: JSON.stringify({ name: "Salad" }),
        // Every action fetch carries a timeout AbortController signal.
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("serializes GET params for imperative reads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse([{ id: "meal-1" }]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callAction("list-meals", { tags: ["lunch", "fresh"] }, { method: "GET" }),
    ).resolves.toEqual([{ id: "meal-1" }]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/_agent-native/actions/list-meals?tags%5B%5D=lunch&tags%5B%5D=fresh",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("times out hung requests with a typed, non-retryable error", async () => {
    vi.useFakeTimers();
    try {
      // Simulate a hung server: the fetch promise only settles when the
      // request's abort signal fires (matching real fetch semantics).
      const fetchMock = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(
                new DOMException("The operation was aborted.", "AbortError"),
              ),
            );
          }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const promise = callAction("slow-action", {}, { timeoutMs: 1_000 });
      // Attach the rejection assertion BEFORE advancing timers so the
      // rejection is never unhandled.
      const assertion = expect(promise).rejects.toMatchObject({
        message: expect.stringContaining("slow-action timed out after 1s"),
        timedOut: true,
        status: 408,
      });
      await vi.advanceTimersByTimeAsync(1_001);
      await assertion;
      // The timeout error must be classified as non-retryable, or the user
      // waits the full window again for each silent retry.
      const timeoutError = await promise.catch((err) => err);
      expect(defaultActionQueryRetry(0, timeoutError)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out when the response body hangs after headers arrive", async () => {
    vi.useFakeTimers();
    try {
      // Headers arrive immediately, but the body stream never ends and
      // res.text() only rejects when the request is aborted.
      const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () =>
            new Promise<string>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(
                  new DOMException("The operation was aborted.", "AbortError"),
                ),
              );
            }),
        } as unknown as Response),
      );
      vi.stubGlobal("fetch", fetchMock);

      const promise = callAction("slow-body", {}, { timeoutMs: 1_000 });
      const assertion = expect(promise).rejects.toMatchObject({
        timedOut: true,
        status: 408,
      });
      await vi.advanceTimersByTimeAsync(1_001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("propagates caller aborts as cancellation, not an action failure", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            ),
          );
          if (init?.signal?.aborted) {
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            );
          }
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const promise = callAction("any-action", {}, { signal: controller.signal });
    // Attach before aborting so the rejection is handled.
    const assertion = expect(promise).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await assertion;
    // Must NOT be wrapped into the "Action X failed: ..." error shape —
    // React Query relies on recognizing the original cancellation.
    const error = await promise.catch((err) => err);
    expect(String(error.message)).not.toContain("Action any-action failed");
  });
});

describe("action query retry defaults", () => {
  it("does not retry auth failures or timeouts, retries other errors up to 3 times", () => {
    const authError = Object.assign(new Error("nope"), { status: 401 });
    const timeoutError = Object.assign(new Error("slow"), { timedOut: true });
    const flakyError = new Error("ECONNRESET");

    expect(defaultActionQueryRetry(0, authError)).toBe(false);
    expect(defaultActionQueryRetry(0, timeoutError)).toBe(false);
    expect(defaultActionQueryRetry(0, flakyError)).toBe(true);
    expect(defaultActionQueryRetry(2, flakyError)).toBe(true);
    expect(defaultActionQueryRetry(3, flakyError)).toBe(false);
  });

  it("caps retry backoff at 2s so real failures surface fast", () => {
    expect(defaultActionQueryRetryDelay(0)).toBe(500);
    expect(defaultActionQueryRetryDelay(1)).toBe(1_000);
    expect(defaultActionQueryRetryDelay(2)).toBe(2_000);
    expect(defaultActionQueryRetryDelay(5)).toBe(2_000);
  });
});
