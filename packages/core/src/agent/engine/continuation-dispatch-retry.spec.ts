import { describe, it, expect, vi } from "vitest";

import { attemptContinuationDispatch } from "./continuation-dispatch-retry.js";

function makeParams(overrides: Record<string, unknown> = {}) {
  const deps = {
    sleep: vi.fn(async () => {}),
    updateRunHeartbeat: vi.fn(async () => {}),
    fireInternalDispatch: vi.fn(async () => {
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
      } as any,
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
    // Prod: the dispatch response was lost to a connection-level `fetch
    // failed` while the successor had already started 8s earlier. Gating the
    // claim check on the foreground path made that indistinguishable from a
    // dead handoff, so the parent re-dispatched and then reported `deferred`.
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
