// @vitest-environment happy-dom

import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analyticsMocks = vi.hoisted(() => ({ trackEvent: vi.fn() }));
vi.mock("./analytics.js", () => analyticsMocks);

const sessionMocks = vi.hoisted(() => ({
  recheckSessionAfterUnauthorized: vi.fn(),
}));
vi.mock("./use-session.js", () => sessionMocks);

import { resetActionFailureCircuits } from "./action-failure-circuit.js";
import {
  resetActionCircuitTripEventsForTests,
  useActionMutation,
  useActionQuery,
} from "./use-action.js";

function json(body: unknown, status: number, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("useActionQuery failure handling", () => {
  const roots: ReturnType<typeof createRoot>[] = [];
  const containers: HTMLDivElement[] = [];
  let queryClient: QueryClient;
  let mutate: ((vars: Record<string, unknown>) => void) | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    resetActionFailureCircuits();
    queryClient = new QueryClient();
    mutate = undefined;
  });

  afterEach(() => {
    for (const root of roots) act(() => root.unmount());
    for (const container of containers) container.remove();
    roots.length = 0;
    containers.length = 0;
    onlineManager.setOnline(true);
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function respondWith(next: () => Response) {
    fetchMock = vi.fn(async () => next());
    vi.stubGlobal("fetch", fetchMock);
  }

  async function mount(
    options: Parameters<typeof useActionQuery>[2],
    name = "get-generation-run",
    params: Record<string, unknown> = { runId: "run-1" },
  ) {
    let client: QueryClient | undefined;
    function Probe() {
      client = useQueryClient();
      useActionQuery(name as never, params as never, options);
      const mutation = useActionMutation("save-thing" as never);
      mutate = (vars) => mutation.mutate(vars as never);
      return null;
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    return client!;
  }

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function invalidate() {
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["action"] });
    });
  }

  it("stops polling a deleted run after one terminal not_found", async () => {
    respondWith(() =>
      json({ error: "Generation run not found.", errorCode: "not_found" }, 404),
    );
    await mount({ refetchInterval: 1_000 });

    await advance(60_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps polling through a plain 404, which a resource still being created can return", async () => {
    let calls = 0;
    respondWith(() => {
      calls += 1;
      return calls < 3
        ? json({ error: "Design not found" }, 404)
        : json({ ok: true }, 200);
    });
    await mount({ refetchInterval: 1_000 }, "get-design", { id: "d1" });

    await advance(2_500);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      queryClient.getQueryState(["action", "get-design", { id: "d1" }])?.data,
    ).toEqual({ ok: true });
  });

  it("answers a sync invalidation as soon as the server recovers from a 5xx outage", async () => {
    let healthy = false;
    respondWith(() =>
      healthy ? json({ ok: true }, 200) : json({ error: "Bad gateway" }, 502),
    );
    await mount({ refetchInterval: 2_000 });

    // About 2.5 minutes of a deploy or upstream blip, polling every 2s.
    await advance(150_000);
    healthy = true;
    const atRecovery = fetchMock.mock.calls.length;
    // A cycle may be mid-retry; its backoff is at most 2s.
    await act(async () => {
      void queryClient.invalidateQueries({ queryKey: ["action"] });
      await vi.advanceTimersByTimeAsync(2_500);
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(atRecovery);
    const state = queryClient.getQueryState([
      "action",
      "get-generation-run",
      { runId: "run-1" },
    ]);
    expect(state?.error).toBeNull();
    expect(state?.data).toEqual({ ok: true });
  });

  it("never pauses a query for network failures", async () => {
    fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);
    await mount({});
    // Retries wait on (fake) backoff timers, so each cycle is settled by time.
    const invalidateAndSettle = () =>
      act(async () => {
        void queryClient.invalidateQueries({ queryKey: ["action"] });
        await vi.advanceTimersByTimeAsync(5_000);
      });
    // Five failed cycles is where a counted failure would open the circuit.
    for (let i = 0; i < 5; i++) await invalidateAndSettle();
    const before = fetchMock.mock.calls.length;

    await invalidateAndSettle();

    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
    expect(
      queryClient.getQueryState([
        "action",
        "get-generation-run",
        { runId: "run-1" },
      ])?.error,
    ).not.toMatchObject({ name: "ActionCircuitOpenError" });
  });

  it("closes every circuit when the browser comes back online", async () => {
    respondWith(() => json({ error: "Bad input" }, 422));
    await mount({});
    for (let i = 0; i < 5; i++) await invalidate();
    await invalidate();
    expect(fetchMock).toHaveBeenCalledTimes(5);

    respondWith(() => json({ ok: true }, 200));
    act(() => {
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("online"));
    });
    await invalidate();

    expect(fetchMock).toHaveBeenCalled();
    expect(
      queryClient.getQueryState([
        "action",
        "get-generation-run",
        { runId: "run-1" },
      ])?.data,
    ).toEqual({ ok: true });
  });

  it("keeps polling a healthy query on the caller's interval", async () => {
    respondWith(() => json({ ok: true }, 200));
    await mount({ refetchInterval: 1_000 });

    await advance(3_500);

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("honors Retry-After: one request, no inner retries, polling resumes after the cooldown", async () => {
    respondWith(() =>
      json(
        {
          error: "Gmail is briefly busy.",
          errorCode: "gmail_quota_cooldown",
        },
        429,
        { "Retry-After": "45" },
      ),
    );
    await mount({ refetchInterval: 1_000 }, "manage-gmail-filters", {
      operation: "list",
    });

    await advance(44_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await advance(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("pauses a poll after five refusals and probes again after a growing cooldown", async () => {
    respondWith(() => json({ error: "Bad input" }, 422));
    await mount({ refetchInterval: 1_000 });

    await advance(4_500);
    expect(fetchMock).toHaveBeenCalledTimes(5);

    await advance(14_000);
    expect(fetchMock).toHaveBeenCalledTimes(5);

    await advance(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(6);

    await advance(28_000);
    expect(fetchMock).toHaveBeenCalledTimes(6);

    await advance(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it("reports one trip event with the action and code when the circuit opens, not one per failure", async () => {
    resetActionCircuitTripEventsForTests();
    analyticsMocks.trackEvent.mockClear();
    respondWith(() => json({ error: "Bad input" }, 422));
    await mount({ refetchInterval: 1_000 });

    await advance(4_500);
    expect(fetchMock).toHaveBeenCalledTimes(5);

    const trips = analyticsMocks.trackEvent.mock.calls.filter(
      ([name]) => name === "action_circuit_tripped",
    );
    expect(trips).toEqual([
      [
        "action_circuit_tripped",
        expect.objectContaining({
          action_name: "get-generation-run",
          error_code: "untyped",
          status_code: 422,
          failures: 5,
        }),
      ],
    ]);
  });

  it("reports a typed cooldown as a trip with its code", async () => {
    resetActionCircuitTripEventsForTests();
    analyticsMocks.trackEvent.mockClear();
    respondWith(() =>
      json(
        { error: "Gmail is briefly busy.", errorCode: "gmail_quota_cooldown" },
        429,
        { "Retry-After": "45" },
      ),
    );
    await mount({}, "manage-gmail-filters", { operation: "list" });

    expect(
      analyticsMocks.trackEvent.mock.calls.filter(
        ([name]) => name === "action_circuit_tripped",
      ),
    ).toEqual([
      [
        "action_circuit_tripped",
        expect.objectContaining({
          action_name: "manage-gmail-filters",
          error_code: "gmail_quota_cooldown",
          status_code: 429,
          cooldown_ms: 45_000,
        }),
      ],
    ]);
  });

  it("counts consecutive failures only: a success restarts the count", async () => {
    let calls = 0;
    respondWith(() => {
      calls += 1;
      return calls === 5
        ? json({ ok: true }, 200)
        : json({ error: "Bad input" }, 422);
    });
    await mount({ refetchInterval: 1_000 });

    await advance(8_500);

    expect(fetchMock).toHaveBeenCalledTimes(9);
  });

  it("rejects automatic refetches without a request while open, then a successful mutation reopens it", async () => {
    respondWith(() => json({ error: "Bad input" }, 422));
    await mount({});
    for (let i = 0; i < 4; i++) await invalidate();
    expect(fetchMock).toHaveBeenCalledTimes(5);

    await invalidate();
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const state = queryClient.getQueryState([
      "action",
      "get-generation-run",
      { runId: "run-1" },
    ]);
    expect(state?.error).toMatchObject({
      name: "ActionCircuitOpenError",
      status: 422,
    });

    respondWith(() => json({ ok: true }, 200));
    await act(async () => {
      mutate!({ id: "x" });
      await vi.advanceTimersByTimeAsync(0);
    });
    // The mutation's POST plus the refetch it invalidates.
    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toContain(
      "GET",
    );
    expect(
      queryClient.getQueryState([
        "action",
        "get-generation-run",
        { runId: "run-1" },
      ])?.error,
    ).toBeNull();
  });

  it("lets an explicit retry through while the user's gesture is active", async () => {
    respondWith(() => json({ error: "Bad input" }, 422));
    const client = await mount({});
    for (let i = 0; i < 4; i++) await invalidate();
    expect(fetchMock).toHaveBeenCalledTimes(5);

    vi.stubGlobal("navigator", { userActivation: { isActive: true } });
    await act(async () => {
      await client.refetchQueries({ queryKey: ["action"] });
    });

    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("holds a missing provider paused until a provider is connected", async () => {
    respondWith(() =>
      json(
        {
          error: "No LLM provider is connected.",
          errorCode: "llm_provider_missing",
        },
        424,
      ),
    );
    await mount({ retry: false }, "generate-home-suggestions", {});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await invalidate();
    await invalidate();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event("agent-engine:configured-changed"));
    });
    await invalidate();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("jitters the retry delay for a transient failure instead of retrying in lockstep", async () => {
    respondWith(() => new Response("", { status: 503 }));
    await mount({});

    // Math.random is 0.5, so the first delay is 375ms (500ms step, upper half).
    await advance(300);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
