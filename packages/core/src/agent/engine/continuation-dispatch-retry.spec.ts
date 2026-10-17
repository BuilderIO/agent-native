import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import { SelfDispatchHttpError } from "../../server/self-dispatch.js";
import { attemptContinuationDispatch } from "./continuation-dispatch-retry.js";

function makeParams(overrides: Record<string, unknown> = {}) {
  const deps = {
    sleep: vi.fn(async (_ms: number) => {}),
    updateRunHeartbeat: vi.fn(async () => {}),
    fireInternalDispatch: vi.fn(async (): Promise<void> => {
      throw new Error("fetch failed");
    }),
    readBackgroundRunClaim: vi.fn(async () => null as any),
  };
  return {
    params: {
      event: {},
      chainViaDurableBackground: true,
      backgroundContinuationCount: 0,
      nextRunId: "run-next",
      nextRowInserted: true,
      continuationDispatchPath: "/.netlify/functions/agent-chat-background",
      dispatchBody: {},
      dispatchBudget: {
        maxDispatchAttempts: 3,
        dispatchResponseTimeoutMs: 1_000,
        backoffCapMs: 500,
        overloadWaitBudgetMs: 45_000,
      },
      isLoopProtectionDispatchError: () => false,
      maxNestedSelfDispatchDepth: 4,
      deps,
      ...overrides,
    },
    deps,
  };
}

describe("attemptContinuationDispatch", () => {
  it("treats a claimed successor as delivered even on the durable-background path", async () => {
    const { params, deps } = makeParams();
    deps.readBackgroundRunClaim.mockResolvedValue({
      dispatchMode: "foreground",
      status: "running",
    });

    const result = await attemptContinuationDispatch(params as any);

    expect(result.dispatched).toBe(true);
    expect(deps.readBackgroundRunClaim).toHaveBeenCalledWith("run-next");
    expect(deps.fireInternalDispatch).toHaveBeenCalledTimes(1);
  });

  it("keeps retrying a durable-background dispatch when the successor never claimed", async () => {
    const { params, deps } = makeParams();

    const result = await attemptContinuationDispatch(params as any);

    expect(result.dispatched).toBe(false);
    expect(deps.fireInternalDispatch).toHaveBeenCalledTimes(3);
  });

  it("does not consult the claim when no successor row was inserted", async () => {
    const { params, deps } = makeParams({ nextRowInserted: false });

    await attemptContinuationDispatch(params as any);

    expect(deps.readBackgroundRunClaim).not.toHaveBeenCalled();
  });
});

describe("attemptContinuationDispatch — overload backoff", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function overloaded(status = 429, retryAfterMs?: number) {
    return new SelfDispatchHttpError(
      `Self-dispatch to /x returned HTTP ${status}`,
      status,
      retryAfterMs,
    );
  }

  function sleptMs(deps: ReturnType<typeof makeParams>["deps"]): number[] {
    return deps.sleep.mock.calls.map((call) => call[0]);
  }

  it("waits out 429s with full-jitter exponential backoff past the fixed attempt cap", async () => {
    const { params, deps } = makeParams({
      dispatchBudget: {
        maxDispatchAttempts: 2,
        dispatchResponseTimeoutMs: 1_000,
        backoffCapMs: Infinity,
        overloadWaitBudgetMs: 45_000,
      },
      random: () => 0.5,
    });
    deps.fireInternalDispatch
      .mockRejectedValueOnce(overloaded())
      .mockRejectedValueOnce(overloaded())
      .mockRejectedValueOnce(overloaded())
      .mockRejectedValueOnce(overloaded())
      .mockResolvedValueOnce(undefined);

    const result = await attemptContinuationDispatch(params as any);

    expect(result.dispatched).toBe(true);
    expect(deps.fireInternalDispatch).toHaveBeenCalledTimes(5);
    expect(sleptMs(deps)).toEqual([500, 1_000, 2_000, 4_000]);
    expect(deps.updateRunHeartbeat).toHaveBeenCalledTimes(4);
  });

  it("counts slow overload responses against the wait budget", async () => {
    let clock = 0;
    const { params, deps } = makeParams({
      dispatchBudget: {
        maxDispatchAttempts: 2,
        dispatchResponseTimeoutMs: 1_000,
        backoffCapMs: Infinity,
        overloadWaitBudgetMs: 20_000,
      },
      random: () => 0.5,
      now: () => clock,
    });
    // Each response takes 12s; sleeps are instant under the fake sleep.
    deps.fireInternalDispatch.mockImplementation(async () => {
      clock += 12_000;
      throw overloaded();
    });

    const result = await attemptContinuationDispatch(params as any);

    expect(result.dispatched).toBe(false);
    expect(deps.fireInternalDispatch).toHaveBeenCalledTimes(2);
  });

  it("caps a single jittered wait at 30s", async () => {
    const { params, deps } = makeParams({
      dispatchBudget: {
        maxDispatchAttempts: 2,
        dispatchResponseTimeoutMs: 1_000,
        backoffCapMs: Infinity,
        overloadWaitBudgetMs: 10 * 60_000,
      },
      random: () => 1,
    });
    deps.fireInternalDispatch.mockRejectedValue(overloaded());

    await attemptContinuationDispatch(params as any);

    expect(sleptMs(deps)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
    ]);
  });

  it("honors Retry-After, clamped to 60s", async () => {
    const { params, deps } = makeParams({
      dispatchBudget: {
        maxDispatchAttempts: 2,
        dispatchResponseTimeoutMs: 1_000,
        backoffCapMs: Infinity,
        overloadWaitBudgetMs: 120_000,
      },
      random: () => 0,
    });
    deps.fireInternalDispatch
      .mockRejectedValueOnce(overloaded(429, 5_000))
      .mockRejectedValueOnce(overloaded(429, 300_000))
      .mockResolvedValueOnce(undefined);

    const result = await attemptContinuationDispatch(params as any);

    expect(result.dispatched).toBe(true);
    expect(sleptMs(deps)).toEqual([5_000, 60_000]);
  });

  it("defers immediately when Retry-After is longer than the remaining wait budget", async () => {
    const { params, deps } = makeParams();
    const err = overloaded(429, 50_000);
    deps.fireInternalDispatch.mockRejectedValue(err);

    const result = await attemptContinuationDispatch(params as any);

    expect(result.dispatched).toBe(false);
    expect(result.lastDispatchErr).toBe(err);
    expect(deps.fireInternalDispatch).toHaveBeenCalledTimes(1);
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it("stops once the ~45s total wait budget is spent, using all of it", async () => {
    const { params, deps } = makeParams({ random: () => 0.999 });
    deps.fireInternalDispatch.mockRejectedValue(overloaded());

    const result = await attemptContinuationDispatch(params as any);

    const waited = sleptMs(deps).reduce((a, b) => a + b, 0);
    expect(result.dispatched).toBe(false);
    expect(waited).toBeCloseTo(45_000, 3);
    expect(deps.fireInternalDispatch).toHaveBeenCalledTimes(7);
  });

  it("uses the budget's own wait allowance when it sets one", async () => {
    const { params, deps } = makeParams({
      dispatchBudget: {
        maxDispatchAttempts: 2,
        dispatchResponseTimeoutMs: 1_000,
        backoffCapMs: Infinity,
        overloadWaitBudgetMs: 3_000,
      },
      random: () => 0.999,
    });
    deps.fireInternalDispatch.mockRejectedValue(overloaded());

    await attemptContinuationDispatch(params as any);

    expect(sleptMs(deps).reduce((a, b) => a + b, 0)).toBeCloseTo(3_000, 3);
  });

  it("still terminates when jitter keeps drawing zero and the wait budget never drains", async () => {
    const { params, deps } = makeParams({ random: () => 0 });
    deps.fireInternalDispatch.mockRejectedValue(overloaded());

    const result = await attemptContinuationDispatch(params as any);

    expect(result.dispatched).toBe(false);
    // First attempt plus 8 overload retries.
    expect(deps.fireInternalDispatch).toHaveBeenCalledTimes(9);
  });

  it.each([429, 502, 503, 504, 520])(
    "retries HTTP %i beyond the fixed attempt cap",
    async (status) => {
      const { params, deps } = makeParams({
        dispatchBudget: {
          maxDispatchAttempts: 1,
          dispatchResponseTimeoutMs: 1_000,
          backoffCapMs: Infinity,
          overloadWaitBudgetMs: 45_000,
        },
        random: () => 0,
      });
      deps.fireInternalDispatch
        .mockRejectedValueOnce(overloaded(status))
        .mockResolvedValueOnce(undefined);

      const result = await attemptContinuationDispatch(params as any);

      expect(result.dispatched).toBe(true);
      expect(deps.fireInternalDispatch).toHaveBeenCalledTimes(2);
    },
  );

  it.each([400, 401, 404, 500])(
    "gives HTTP %i only the fixed attempt cap and its old backoff",
    async (status) => {
      const { params, deps } = makeParams();
      deps.fireInternalDispatch.mockRejectedValue(overloaded(status));

      const result = await attemptContinuationDispatch(params as any);

      expect(result.dispatched).toBe(false);
      expect(deps.fireInternalDispatch).toHaveBeenCalledTimes(3);
      expect(sleptMs(deps)).toEqual([500, 500]);
    },
  );

  it("spends the attempt cap only on non-overload failures", async () => {
    const { params, deps } = makeParams({
      dispatchBudget: {
        maxDispatchAttempts: 2,
        dispatchResponseTimeoutMs: 1_000,
        backoffCapMs: Infinity,
      },
      random: () => 0,
    });
    deps.fireInternalDispatch
      .mockRejectedValueOnce(overloaded())
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockRejectedValueOnce(overloaded())
      .mockRejectedValueOnce(new Error("fetch failed"));

    const result = await attemptContinuationDispatch(params as any);

    expect(result.dispatched).toBe(false);
    expect(deps.fireInternalDispatch).toHaveBeenCalledTimes(4);
  });

  it("treats a claimed successor as delivered between overload retries", async () => {
    const { params, deps } = makeParams({ random: () => 0 });
    deps.fireInternalDispatch.mockRejectedValue(overloaded());
    deps.readBackgroundRunClaim
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ dispatchMode: "foreground", status: "running" });

    const result = await attemptContinuationDispatch(params as any);

    expect(result.dispatched).toBe(true);
    expect(deps.fireInternalDispatch).toHaveBeenCalledTimes(2);
  });

  it("stops at once on Netlify loop protection", async () => {
    const { params, deps } = makeParams({
      isLoopProtectionDispatchError: (err: unknown) =>
        /HTTP 508/.test(String((err as Error).message)),
    });
    deps.fireInternalDispatch.mockRejectedValue(overloaded(508));

    const result = await attemptContinuationDispatch(params as any);

    expect(result.dispatched).toBe(false);
    expect(deps.fireInternalDispatch).toHaveBeenCalledTimes(1);
    expect(deps.sleep).not.toHaveBeenCalled();
  });
});
