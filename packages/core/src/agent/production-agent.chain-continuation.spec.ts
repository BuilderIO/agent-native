import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_BACKGROUND_RUN_CONTINUATIONS,
  MAX_TURN_WALL_CLOCK_MS,
} from "../app-config/run-lifecycle-invariants.js";
import {
  AGENT_CHAT_BACKGROUND_RUN_FIELD,
  AGENT_CHAT_PROCESS_RUN_PATH,
} from "./durable-background.js";
import {
  chainServerDrivenContinuation,
  isLoopProtectionDispatchError,
  MAX_NESTED_SELF_DISPATCH_DEPTH,
  AGENT_CHAT_PRIOR_CONTINUATION_REASON_FIELD,
  AGENT_CHAT_PRIOR_NO_PROGRESS_ERROR_CODE_FIELD,
  AGENT_CHAT_PRIOR_NO_PROGRESS_COUNT_FIELD,
  AGENT_CHAT_TURN_INPUT_TOKENS_FIELD,
  resolveContinuationDispatchBudget,
  resolvePriorContinuationReason,
  resolvePriorContinuationState,
  resolveSelfChainContinuationBudget,
  SELF_CHAIN_MIN_CONTINUATION_BUDGET_MS,
  type BackgroundNoProgressRepeat,
  type ChainServerDrivenContinuationDeps,
} from "./production-agent.js";
import type { ActiveRun } from "./run-manager.js";
import { RUN_DIAG_STAGE } from "./run-store.js";
import type { AgentChatEvent } from "./types.js";

const ENV_KEYS = [
  "NETLIFY",
  "NETLIFY_LOCAL",
  "SITE_ID",
  "AWS_LAMBDA_FUNCTION_NAME",
];
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  savedEnv = { ...process.env };
  for (const k of ENV_KEYS) Reflect.deleteProperty(process.env, k);
});

afterEach(() => {
  process.env = savedEnv;
});

function makeRun(
  events: AgentChatEvent[],
  status: ActiveRun["status"] = "completed",
): ActiveRun {
  return {
    runId: "run-chunk0",
    threadId: "thread-1",
    turnId: "turn-1",
    events: events.map((event, seq) => ({ seq, event })),
    status,
    subscribers: new Set(),
    abort: new AbortController(),
    startedAt: Date.now(),
  };
}

function timeoutBoundaryRun(): ActiveRun {
  return makeRun([{ type: "auto_continue", reason: "run_timeout" }]);
}

function recoverableErrorBoundaryRun(): ActiveRun {
  return makeRun([
    {
      type: "error",
      error: "Provider connection failed",
      errorCode: "provider_failed",
      recoverable: true,
    },
  ]);
}

function rateLimitedBoundaryRun(): ActiveRun {
  return makeRun([
    {
      type: "error",
      error: "429 status code (no body)",
      errorCode: "http_429",
      recoverable: true,
    },
  ]);
}

interface Harness {
  deps: Required<
    Pick<
      ChainServerDrivenContinuationDeps,
      | "countRunsForTurn"
      | "insertRun"
      | "fireInternalDispatch"
      | "readBackgroundRunClaim"
      | "updateRunHeartbeat"
      | "updateRunStatusIfRunning"
      | "setRunTerminalReason"
      | "recordRunDiagnostic"
      | "markBackgroundContinuationChunkTerminal"
      | "generateRunId"
      | "sleep"
      | "readTurnStartedAt"
      | "emitRunText"
      | "isTurnAborted"
      | "markRunAborted"
    >
  >;
  callOrder: string[];
}

function makeHarness(overrides?: {
  fireInternalDispatch?: ChainServerDrivenContinuationDeps["fireInternalDispatch"];
  readBackgroundRunClaim?: ChainServerDrivenContinuationDeps["readBackgroundRunClaim"];
  countRunsForTurn?: ChainServerDrivenContinuationDeps["countRunsForTurn"];
  readTurnStartedAt?: ChainServerDrivenContinuationDeps["readTurnStartedAt"];
}): Harness {
  const callOrder: string[] = [];
  const deps: Harness["deps"] = {
    countRunsForTurn: overrides?.countRunsForTurn ?? vi.fn(async () => 1),
    readTurnStartedAt:
      overrides?.readTurnStartedAt ?? vi.fn(async () => Date.now()),
    isTurnAborted: vi.fn(async () => false),
    emitRunText: vi.fn(async () => {}),
    insertRun: vi.fn(async () => {
      callOrder.push("insertRun");
    }),
    fireInternalDispatch:
      overrides?.fireInternalDispatch ?? (vi.fn(async () => {}) as any),
    readBackgroundRunClaim:
      overrides?.readBackgroundRunClaim ??
      vi.fn(async () => ({
        dispatchMode: "background",
        status: "running",
        diagStage: null,
        workerStage: null,
        lastLivenessAt: Date.now(),
      })),
    updateRunHeartbeat: vi.fn(async () => {}),
    updateRunStatusIfRunning: vi.fn(async () => true),
    markRunAborted: vi.fn(async () => {}),
    setRunTerminalReason: vi.fn(async () => {}),
    setRunError: vi.fn(async () => {}),
    recordRunDiagnostic: vi.fn(async () => {}),
    markBackgroundContinuationChunkTerminal: vi.fn(async () => {
      callOrder.push("markTerminal");
      return true;
    }),
    generateRunId: vi.fn(() => "run-next"),
    sleep: vi.fn(async () => {}),
  };
  const rawDispatch = deps.fireInternalDispatch;
  deps.fireInternalDispatch = vi.fn(async (opts: any) => {
    callOrder.push("dispatch");
    return (rawDispatch as any)(opts);
  }) as any;
  return { deps, callOrder };
}

async function runChain(
  harness: Harness,
  opts?: {
    chainViaDurableBackground?: boolean;
    workerProvenInBackgroundFunction?: boolean;
    requestBody?: Record<string, unknown>;
    backgroundContinuationCount?: number;
    noProgressRepeat?: BackgroundNoProgressRepeat;
    run?: ActiveRun;
  },
): Promise<void> {
  await chainServerDrivenContinuation({
    event: {},
    run: opts?.run ?? timeoutBoundaryRun(),
    effectiveThreadId: "thread-1",
    effectiveTurnId: "turn-1",
    requestBody: opts?.requestBody ?? {
      message: "a very large user message",
      history: [{ role: "user", content: "x".repeat(1000) }],
      threadId: "thread-1",
      [AGENT_CHAT_BACKGROUND_RUN_FIELD]: { runId: "run-chunk0" },
    },
    backgroundContinuationCount: opts?.backgroundContinuationCount ?? 0,
    noProgressRepeat: opts?.noProgressRepeat,
    chainViaDurableBackground: opts?.chainViaDurableBackground ?? false,
    workerProvenInBackgroundFunction: opts?.workerProvenInBackgroundFunction,
    deps: harness.deps,
  });
}

describe("chainServerDrivenContinuation — transactional handoff (foreground self-chain)", () => {
  it("does not mint a successor after the logical turn has been durably aborted", async () => {
    const h = makeHarness();
    h.deps.isTurnAborted = vi.fn(async () => true);

    await runChain(h);

    expect(h.deps.insertRun).not.toHaveBeenCalled();
    expect(h.deps.markRunAborted).toHaveBeenCalledWith("run-chunk0", "user");
  });

  it("PRE-INSERTS the successor row before the dispatch fires, then marks the chunk terminal", async () => {
    const h = makeHarness();
    const run = timeoutBoundaryRun();
    await runChain(h, { run });

    expect(h.callOrder).toEqual(["insertRun", "dispatch", "markTerminal"]);

    expect(h.deps.insertRun).toHaveBeenCalledWith(
      "run-next",
      "thread-1",
      "turn-1",
      expect.objectContaining({ dispatchMode: "background" }),
    );
    const insertOptions = (h.deps.insertRun as any).mock.calls[0][3];
    expect(insertOptions.continuationOrder).toBeUndefined();
    const payload = JSON.parse(insertOptions.dispatchPayload);
    expect(payload.internalContinuation).toBe(true);
    expect(payload.message).toBe("a very large user message");
    expect(payload[AGENT_CHAT_BACKGROUND_RUN_FIELD]).toBeUndefined();
    expect(payload[AGENT_CHAT_PRIOR_CONTINUATION_REASON_FIELD]).toBe(
      "run_timeout",
    );

    expect(h.deps.markBackgroundContinuationChunkTerminal).toHaveBeenCalledWith(
      {
        runId: "run-chunk0",
        continuationReason: "run_timeout",
        terminalEvent: { type: "auto_continue", reason: "run_timeout" },
      },
    );
    expect(h.deps.updateRunStatusIfRunning).not.toHaveBeenCalled();
    expect(run.continuationTerminalEvent).toEqual({
      type: "auto_continue",
      reason: "run_timeout",
    });
  });

  it("passes a recoverable error boundary to the chunk terminal marker", async () => {
    const h = makeHarness();
    const run = recoverableErrorBoundaryRun();

    await runChain(h, { run });

    expect(h.deps.markBackgroundContinuationChunkTerminal).toHaveBeenCalledWith(
      {
        runId: "run-chunk0",
        continuationReason: expect.any(String),
        terminalEvent: run.events.at(-1)?.event,
      },
    );
  });

  it("dispatches IDS ONLY (payloadRef marker) — never the chat body — and fully awaits the response", async () => {
    const h = makeHarness();
    await runChain(h);

    const dispatch = (h.deps.fireInternalDispatch as any).mock.calls[0][0];
    expect(dispatch.path).toBe(AGENT_CHAT_PROCESS_RUN_PATH);
    expect(dispatch.taskId).toBe("run-next");
    expect(dispatch.awaitResponse).toBe(true);
    expect(dispatch.responseTimeoutMs).toBe(10_000);
    expect(Object.keys(dispatch.body).sort()).toEqual([
      AGENT_CHAT_BACKGROUND_RUN_FIELD,
      "internalContinuation",
    ]);
    expect(dispatch.body[AGENT_CHAT_BACKGROUND_RUN_FIELD]).toMatchObject({
      runId: "run-next",
      turnId: "turn-1",
      continuationCount: 1,
      continuationReason: "run_timeout",
      payloadRef: true,
      backgroundFunctionRuntimeExpected: false,
    });
    expect(dispatch.body.message).toBeUndefined();
    expect(dispatch.body.history).toBeUndefined();
  });

  it("carries the no-progress streak to the successor so the breaker survives the chunk boundary", async () => {
    const h = makeHarness();
    await runChain(h, {
      run: recoverableErrorBoundaryRun(),
      noProgressRepeat: {
        errorCode: "builder_gateway_internal_error",
        count: 1,
        tripped: false,
      },
    });

    const dispatch = (h.deps.fireInternalDispatch as any).mock.calls[0][0];
    expect(dispatch.body[AGENT_CHAT_BACKGROUND_RUN_FIELD]).toMatchObject({
      noProgressErrorCode: "builder_gateway_internal_error",
      noProgressCount: 1,
    });
    const insertOptions = (h.deps.insertRun as any).mock.calls[0][3];
    const payload = JSON.parse(insertOptions.dispatchPayload);
    expect(payload[AGENT_CHAT_PRIOR_NO_PROGRESS_ERROR_CODE_FIELD]).toBe(
      "builder_gateway_internal_error",
    );
    expect(payload[AGENT_CHAT_PRIOR_NO_PROGRESS_COUNT_FIELD]).toBe(1);
  });

  it("omits the no-progress body companion fields when the chunk made progress", async () => {
    const h = makeHarness();
    await runChain(h, { noProgressRepeat: { count: 0, tripped: false } });

    const insertOptions = (h.deps.insertRun as any).mock.calls[0][3];
    const payload = JSON.parse(insertOptions.dispatchPayload);
    expect(
      payload[AGENT_CHAT_PRIOR_NO_PROGRESS_ERROR_CODE_FIELD],
    ).toBeUndefined();
    expect(payload[AGENT_CHAT_PRIOR_NO_PROGRESS_COUNT_FIELD]).toBeUndefined();
  });

  it("labels the successor marker's continuationReason as rate_limited for an http_429 boundary", async () => {
    const h = makeHarness();
    await runChain(h, { run: rateLimitedBoundaryRun() });

    const dispatch = (h.deps.fireInternalDispatch as any).mock.calls[0][0];
    expect(dispatch.body[AGENT_CHAT_BACKGROUND_RUN_FIELD]).toMatchObject({
      continuationReason: "rate_limited",
    });
  });

  it("omits the no-progress streak entirely when the chunk made progress", async () => {
    const h = makeHarness();
    await runChain(h, { noProgressRepeat: { count: 0, tripped: false } });

    const dispatch = (h.deps.fireInternalDispatch as any).mock.calls[0][0];
    const marker = dispatch.body[AGENT_CHAT_BACKGROUND_RUN_FIELD];
    expect(marker.noProgressErrorCode).toBeUndefined();
    expect(marker.noProgressCount).toBeUndefined();
  });

  it("retries a transiently failed dispatch (one retry on the foreground path) and heartbeats the held row", async () => {
    const dispatchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(undefined);
    const h = makeHarness({ fireInternalDispatch: dispatchMock as any });
    await runChain(h);

    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(h.deps.updateRunHeartbeat).toHaveBeenCalledWith("run-next");
    expect(h.deps.markBackgroundContinuationChunkTerminal).toHaveBeenCalled();
    expect(h.deps.updateRunStatusIfRunning).not.toHaveBeenCalled();
  });

  it("treats the successor's ATOMIC CLAIM as the dispatch acknowledgment (regular-function timeout is not a dead handoff)", async () => {
    const dispatchMock = vi
      .fn()
      .mockRejectedValue(new Error("The operation was aborted due to timeout"));
    const h = makeHarness({
      fireInternalDispatch: dispatchMock as any,
      readBackgroundRunClaim: vi.fn(async () => ({
        dispatchMode: "background-processing",
        status: "running",
        diagStage: null,
        workerStage: null,
        lastLivenessAt: Date.now(),
      })) as any,
    });
    await runChain(h);

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(h.deps.markBackgroundContinuationChunkTerminal).toHaveBeenCalled();
    expect(h.deps.updateRunStatusIfRunning).not.toHaveBeenCalled();
  });

  it("DEFERS (never errors) the pre-inserted successor when every attempt dies — the unclaimed-run sweep gets a chance to recover it", async () => {
    const dispatchMock = vi.fn().mockRejectedValue(new Error("dispatch down"));
    const h = makeHarness({ fireInternalDispatch: dispatchMock as any });
    await runChain(h);

    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(h.deps.updateRunStatusIfRunning).not.toHaveBeenCalledWith(
      "run-next",
      "errored",
    );
    expect(h.deps.setRunTerminalReason).not.toHaveBeenCalledWith(
      "run-next",
      expect.any(String),
    );
    expect(h.deps.recordRunDiagnostic).toHaveBeenCalledWith(
      "run-next",
      RUN_DIAG_STAGE.workerThrew,
      expect.stringContaining("chain_dispatch_deferred"),
    );
    expect(h.deps.updateRunStatusIfRunning).toHaveBeenCalledWith(
      "run-chunk0",
      "completed",
    );
    expect(h.deps.setRunTerminalReason).toHaveBeenCalledWith(
      "run-chunk0",
      "background_continuation_dispatch_deferred",
    );
    expect(h.deps.recordRunDiagnostic).toHaveBeenCalledWith(
      "run-chunk0",
      RUN_DIAG_STAGE.workerThrew,
      expect.stringContaining("chain_dispatch_deferred"),
    );
    expect(
      h.deps.markBackgroundContinuationChunkTerminal,
    ).not.toHaveBeenCalled();
    // With this chunk terminal, the thread slot is free — the client's
    // existing auto_continue re-POST (it still receives the terminal event)
    // is a second, faster fallback alongside the sweep. See
    // run-store.foreground-self-chain.spec.
  });

  it("still fails LOUD immediately when the pre-insert itself failed — nothing exists for a sweep to recover", async () => {
    const dispatchMock = vi.fn().mockRejectedValue(new Error("dispatch down"));
    const h = makeHarness({ fireInternalDispatch: dispatchMock as any });
    (h.deps.insertRun as any).mockRejectedValueOnce(new Error("insert failed"));
    await runChain(h);

    expect(h.deps.updateRunStatusIfRunning).toHaveBeenCalledTimes(1);
    expect(h.deps.updateRunStatusIfRunning).toHaveBeenCalledWith(
      "run-chunk0",
      "errored",
    );
    expect(h.deps.setRunTerminalReason).toHaveBeenCalledWith(
      "run-chunk0",
      "background_continuation_dispatch_failed",
    );
    expect(h.deps.recordRunDiagnostic).toHaveBeenCalledWith(
      "run-chunk0",
      RUN_DIAG_STAGE.workerThrew,
      expect.stringContaining("chain_dispatch_failed"),
    );
    expect(h.deps.setRunError).toHaveBeenCalledWith(
      "run-chunk0",
      "background_continuation_dispatch_failed",
      "dispatch down",
    );
  });

  it("refuses to chain when the SQL per-turn run budget is exhausted (cross-chain loop killer)", async () => {
    const h = makeHarness({
      countRunsForTurn: vi.fn(
        async () => MAX_BACKGROUND_RUN_CONTINUATIONS + 6,
      ) as any,
    });
    await runChain(h);

    expect(h.deps.insertRun).not.toHaveBeenCalled();
    expect(h.deps.fireInternalDispatch).not.toHaveBeenCalled();
    expect(h.deps.updateRunStatusIfRunning).toHaveBeenCalledWith(
      "run-chunk0",
      "errored",
    );
    expect(h.deps.setRunTerminalReason).toHaveBeenCalledWith(
      "run-chunk0",
      "turn_continuation_budget_exhausted",
    );
  });
});

describe("resolveContinuationDispatchBudget — retry budget matrix", () => {
  it("sizes the durable-background worker chain at 3 attempts / 15s (unchanged), regardless of workerProvenInBackgroundFunction", () => {
    expect(
      resolveContinuationDispatchBudget({
        chainViaDurableBackground: true,
        workerProvenInBackgroundFunction: false,
      }),
    ).toMatchObject({
      maxDispatchAttempts: 3,
      dispatchResponseTimeoutMs: 15_000,
    });
    expect(
      resolveContinuationDispatchBudget({
        chainViaDurableBackground: true,
        workerProvenInBackgroundFunction: true,
      }),
    ).toMatchObject({
      maxDispatchAttempts: 3,
      dispatchResponseTimeoutMs: 15_000,
    });
  });

  it("widens the budget for a worker PROVEN in a real background function forced onto the foreground target", () => {
    const budget = resolveContinuationDispatchBudget({
      chainViaDurableBackground: false,
      workerProvenInBackgroundFunction: true,
    });
    expect(budget.maxDispatchAttempts).toBe(5);
    expect(budget.dispatchResponseTimeoutMs).toBe(15_000);
    expect(budget.backoffCapMs).toBe(4_000);
    const worstCaseDispatchMs =
      budget.maxDispatchAttempts * budget.dispatchResponseTimeoutMs;
    const worstCaseBackoffMs = [1, 2, 3, 4]
      .map((attempt) => Math.min(500 * 2 ** (attempt - 1), budget.backoffCapMs))
      .reduce((a, b) => a + b, 0);
    expect(worstCaseBackoffMs).toBe(7_500);
    expect(worstCaseDispatchMs + worstCaseBackoffMs).toBeLessThan(120_000);
  });

  it("keeps a true foreground caller (not proven in a background function) at 2 attempts / 10s (unchanged)", () => {
    expect(
      resolveContinuationDispatchBudget({
        chainViaDurableBackground: false,
        workerProvenInBackgroundFunction: false,
      }),
    ).toMatchObject({
      maxDispatchAttempts: 2,
      dispatchResponseTimeoutMs: 10_000,
      backoffCapMs: Infinity,
    });
  });
});

describe("resolveSelfChainContinuationBudget — synchronous self-chain time budgeting", () => {
  const CEILING_MS = 40_000;

  it("reduces the budget by exactly the elapsed setup time instead of granting a fresh ceiling", () => {
    expect(resolveSelfChainContinuationBudget(10_000, CEILING_MS)).toEqual({
      skipToBoundary: false,
      softTimeoutMs: 30_000,
    });
  });

  it("grants the full ceiling when no setup time has elapsed", () => {
    expect(resolveSelfChainContinuationBudget(0, CEILING_MS)).toEqual({
      skipToBoundary: false,
      softTimeoutMs: CEILING_MS,
    });
  });

  it("never exceeds the ceiling — negative/zero elapsed cannot inflate the budget", () => {
    expect(
      resolveSelfChainContinuationBudget(-5_000, CEILING_MS).softTimeoutMs,
    ).toBeLessThanOrEqual(CEILING_MS);
  });

  it("skips straight to the run_timeout boundary instead of starting a doomed run when remaining budget drops below the minimum", () => {
    const budget = resolveSelfChainContinuationBudget(33_000, CEILING_MS);
    expect(budget.skipToBoundary).toBe(true);
    expect(budget.softTimeoutMs).toBe(0);
  });

  it("skips to the boundary when setup already consumed the entire (or more than the) ceiling", () => {
    expect(
      resolveSelfChainContinuationBudget(45_000, CEILING_MS).skipToBoundary,
    ).toBe(true);
  });

  it("does not skip right at the minimum-budget boundary — only strictly below it", () => {
    const elapsed = CEILING_MS - SELF_CHAIN_MIN_CONTINUATION_BUDGET_MS;
    const budget = resolveSelfChainContinuationBudget(elapsed, CEILING_MS);
    expect(budget.skipToBoundary).toBe(false);
    expect(budget.softTimeoutMs).toBe(SELF_CHAIN_MIN_CONTINUATION_BUDGET_MS);
  });

  it("honors a custom minimum-continuation-budget override", () => {
    const budget = resolveSelfChainContinuationBudget(
      37_000,
      CEILING_MS,
      2_000,
    );
    expect(budget.skipToBoundary).toBe(false);
    expect(budget.softTimeoutMs).toBe(3_000);
  });
});

describe("chainServerDrivenContinuation — worker proven in background function gets the widened budget", () => {
  it("retries up to 5 times at a 15s response timeout, using the capped backoff schedule, before deferring to the sweep", async () => {
    const dispatchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const h = makeHarness({ fireInternalDispatch: dispatchMock as any });
    await runChain(h, {
      chainViaDurableBackground: false,
      workerProvenInBackgroundFunction: true,
    });

    expect(dispatchMock).toHaveBeenCalledTimes(5);
    const dispatch = dispatchMock.mock.calls[0][0];
    expect(dispatch.responseTimeoutMs).toBe(15_000);
    const sleepCalls = (h.deps.sleep as any).mock.calls.map(
      (c: unknown[]) => c[0],
    );
    expect(sleepCalls).toEqual([500, 1000, 2000, 4000]);
    expect(dispatch.path).toBe(AGENT_CHAT_PROCESS_RUN_PATH);
    expect(h.deps.updateRunStatusIfRunning).not.toHaveBeenCalledWith(
      "run-next",
      "errored",
    );
    expect(h.deps.updateRunStatusIfRunning).toHaveBeenCalledWith(
      "run-chunk0",
      "completed",
    );
    expect(h.deps.setRunTerminalReason).toHaveBeenCalledWith(
      "run-chunk0",
      "background_continuation_dispatch_deferred",
    );
  });
});

describe("chainServerDrivenContinuation — durable-background path unchanged", () => {
  it("keeps the durable worker chain's target, 3 attempts, and 15s timeout, and consults the claim on failure", async () => {
    process.env.NETLIFY = "true";
    const dispatchMock = vi.fn().mockRejectedValue(new Error("dead handoff"));
    const readClaim = vi.fn().mockResolvedValue(null);
    const h = makeHarness({
      fireInternalDispatch: dispatchMock as any,
      readBackgroundRunClaim: readClaim as any,
    });
    await runChain(h, { chainViaDurableBackground: true });

    expect(dispatchMock).toHaveBeenCalledTimes(3);
    const dispatch = dispatchMock.mock.calls[0][0];
    expect(dispatch.path).toBe("/.netlify/functions/server-agent-background");
    expect(dispatch.responseTimeoutMs).toBe(15_000);
    expect(dispatch.body[AGENT_CHAT_BACKGROUND_RUN_FIELD]).toMatchObject({
      backgroundFunctionRuntimeExpected: true,
    });
    expect(readClaim).toHaveBeenCalledWith("run-next");
    expect(h.deps.updateRunStatusIfRunning).toHaveBeenCalledWith(
      "run-chunk0",
      "completed",
    );
    expect(h.deps.setRunTerminalReason).toHaveBeenCalledWith(
      "run-chunk0",
      "background_continuation_dispatch_deferred",
    );
    expect(h.deps.updateRunStatusIfRunning).not.toHaveBeenCalledWith(
      "run-next",
      "errored",
    );
  });

  it("stops retrying and does not report a deferred handoff once the successor has claimed", async () => {
    process.env.NETLIFY = "true";
    const dispatchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const readClaim = vi
      .fn()
      .mockResolvedValue({ dispatchMode: "foreground", status: "running" });
    const h = makeHarness({
      fireInternalDispatch: dispatchMock as any,
      readBackgroundRunClaim: readClaim as any,
    });
    await runChain(h, { chainViaDurableBackground: true });

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(h.deps.setRunTerminalReason).not.toHaveBeenCalledWith(
      "run-chunk0",
      "background_continuation_dispatch_deferred",
    );
  });
});

describe("isLoopProtectionDispatchError — classifies Netlify's undocumented loop-protection response", () => {
  it("matches the exact message self-dispatch.ts's dispatchResponseError constructs for a 508", () => {
    expect(
      isLoopProtectionDispatchError(
        new Error(
          "Self-dispatch to /_agent-native/agent-chat/_process-run returned HTTP 508 Loop Detected",
        ),
      ),
    ).toBe(true);
  });

  it("does not match a generic transient dispatch failure", () => {
    expect(isLoopProtectionDispatchError(new Error("fetch failed"))).toBe(
      false,
    );
    expect(
      isLoopProtectionDispatchError(
        new Error(
          "Self-dispatch to /_agent-native/agent-chat/_process-run returned HTTP 503 Service Unavailable",
        ),
      ),
    ).toBe(false);
  });

  it("does not match a non-Error value", () => {
    expect(isLoopProtectionDispatchError("HTTP 508")).toBe(false);
    expect(isLoopProtectionDispatchError(undefined)).toBe(false);
  });
});

describe("chainServerDrivenContinuation — Netlify loop-protection 508 is classified and DEFERRED, not fatally errored", () => {
  it("stops retrying immediately on a 508 instead of burning the full dispatch budget — distinct from a generic 'fetch failed'", async () => {
    const dispatchMock = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "Self-dispatch to /_agent-native/agent-chat/_process-run returned HTTP 508 Loop Detected",
        ),
      );
    const h = makeHarness({ fireInternalDispatch: dispatchMock as any });
    await runChain(h);

    expect(dispatchMock).toHaveBeenCalledTimes(1);

    expect(h.deps.updateRunStatusIfRunning).toHaveBeenCalledWith(
      "run-chunk0",
      "completed",
    );
    expect(h.deps.setRunTerminalReason).toHaveBeenCalledWith(
      "run-chunk0",
      "background_continuation_dispatch_deferred",
    );
    expect(h.deps.setRunTerminalReason).not.toHaveBeenCalledWith(
      "run-chunk0",
      "background_continuation_dispatch_failed",
    );
    expect(h.deps.updateRunStatusIfRunning).not.toHaveBeenCalledWith(
      "run-next",
      "errored",
    );
    expect(h.deps.recordRunDiagnostic).toHaveBeenCalledWith(
      "run-chunk0",
      RUN_DIAG_STAGE.workerThrew,
      expect.stringContaining(
        "chain_dispatch_deferred[netlify_loop_protection]",
      ),
    );
  });

  it("still burns the full retry budget for a generic transient error (unchanged behavior)", async () => {
    const dispatchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const h = makeHarness({ fireInternalDispatch: dispatchMock as any });
    await runChain(h);

    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(h.deps.recordRunDiagnostic).toHaveBeenCalledWith(
      "run-chunk0",
      RUN_DIAG_STAGE.workerThrew,
      expect.stringContaining(
        "chain_dispatch_deferred[dispatch_budget_exhausted]",
      ),
    );
  });
});

describe("chainServerDrivenContinuation — proactive nested-dispatch depth cap", () => {
  it("defers WITHOUT ever attempting a dispatch once backgroundContinuationCount reaches MAX_NESTED_SELF_DISPATCH_DEPTH", async () => {
    const dispatchMock = vi.fn().mockResolvedValue(undefined);
    const h = makeHarness({ fireInternalDispatch: dispatchMock as any });
    await runChain(h, {
      backgroundContinuationCount: MAX_NESTED_SELF_DISPATCH_DEPTH,
    });

    expect(dispatchMock).not.toHaveBeenCalled();
    expect(h.deps.insertRun).toHaveBeenCalled();
    expect(h.deps.updateRunStatusIfRunning).toHaveBeenCalledWith(
      "run-chunk0",
      "completed",
    );
    expect(h.deps.setRunTerminalReason).toHaveBeenCalledWith(
      "run-chunk0",
      "background_continuation_dispatch_deferred",
    );
    expect(h.deps.recordRunDiagnostic).toHaveBeenCalledWith(
      "run-chunk0",
      RUN_DIAG_STAGE.workerThrew,
      expect.stringContaining("chain_dispatch_deferred[proactive_depth_cap]"),
    );
  });

  it("dispatches normally below the depth cap", async () => {
    const dispatchMock = vi.fn().mockResolvedValue(undefined);
    const h = makeHarness({ fireInternalDispatch: dispatchMock as any });
    await runChain(h, {
      backgroundContinuationCount: MAX_NESTED_SELF_DISPATCH_DEPTH - 1,
    });

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(h.deps.markBackgroundContinuationChunkTerminal).toHaveBeenCalled();
    expect(h.deps.updateRunStatusIfRunning).not.toHaveBeenCalled();
  });

  it("applies the SAME depth cap regardless of continuation reason (run_timeout, loop_limit alike) — the cap is about nested self-dispatch mechanics, not turn behavior", async () => {
    const loopLimitRun = makeRun([{ type: "loop_limit" }]);
    const dispatchMock = vi.fn().mockResolvedValue(undefined);
    const h = makeHarness({ fireInternalDispatch: dispatchMock as any });
    await runChain(h, {
      backgroundContinuationCount: MAX_NESTED_SELF_DISPATCH_DEPTH,
      run: loopLimitRun,
    });

    expect(dispatchMock).not.toHaveBeenCalled();
    expect(h.deps.setRunTerminalReason).toHaveBeenCalledWith(
      "run-chunk0",
      "background_continuation_dispatch_deferred",
    );
  });

  it("applies uniformly on the durable-background dispatch target too (Background Functions do not escape Netlify's loop protection)", async () => {
    process.env.NETLIFY = "true";
    const dispatchMock = vi.fn().mockResolvedValue(undefined);
    const h = makeHarness({ fireInternalDispatch: dispatchMock as any });
    await runChain(h, {
      chainViaDurableBackground: true,
      backgroundContinuationCount: MAX_NESTED_SELF_DISPATCH_DEPTH,
    });

    expect(dispatchMock).not.toHaveBeenCalled();
    expect(h.deps.setRunTerminalReason).toHaveBeenCalledWith(
      "run-chunk0",
      "background_continuation_dispatch_deferred",
    );
  });
});

describe("chainServerDrivenContinuation — the intentional per-turn budget still caps a chain of deferred/redispatched segments", () => {
  it("refuses to chain past the SQL per-turn ledger even when backgroundContinuationCount has been reset by sweep-mediated chain breaks", async () => {
    const h = makeHarness({
      countRunsForTurn: vi.fn(
        async () => MAX_BACKGROUND_RUN_CONTINUATIONS + 6,
      ) as any,
    });
    const dispatchMock = h.deps.fireInternalDispatch as any;
    await runChain(h, { backgroundContinuationCount: 0 });

    expect(h.deps.insertRun).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(h.deps.updateRunStatusIfRunning).toHaveBeenCalledWith(
      "run-chunk0",
      "errored",
    );
    expect(h.deps.setRunTerminalReason).toHaveBeenCalledWith(
      "run-chunk0",
      "turn_continuation_budget_exhausted",
    );
    expect(h.deps.emitRunText).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("I stopped after"),
    );
  });

  it("refuses to chain past the turn wall-clock ceiling even while the run-count ledger still has room", async () => {
    const h = makeHarness({
      countRunsForTurn: vi.fn(async () => 2) as any,
      readTurnStartedAt: vi.fn(
        async () => Date.now() - (MAX_TURN_WALL_CLOCK_MS + 60_000),
      ) as any,
    });
    await runChain(h);

    expect(h.deps.insertRun).not.toHaveBeenCalled();
    expect(h.deps.fireInternalDispatch).not.toHaveBeenCalled();
    expect(h.deps.setRunTerminalReason).toHaveBeenCalledWith(
      "run-chunk0",
      "turn_wall_clock_budget_exhausted",
    );
    expect(h.deps.emitRunText).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("minutes"),
    );
  });

  it("keeps chaining a long-but-not-expired turn, and when the turn start is unreadable", async () => {
    const live = makeHarness({
      readTurnStartedAt: vi.fn(
        async () => Date.now() - (MAX_TURN_WALL_CLOCK_MS - 60_000),
      ) as any,
    });
    await runChain(live);
    expect(live.deps.fireInternalDispatch).toHaveBeenCalled();

    const unknownStart = makeHarness({
      readTurnStartedAt: vi.fn(async () => null) as any,
    });
    await runChain(unknownStart);
    expect(unknownStart.deps.fireInternalDispatch).toHaveBeenCalled();
  });
});

describe("chainServerDrivenContinuation — per-turn token total is carried to the successor", () => {
  it("writes the running total onto the successor's rehydration body so the ceiling is not reset per chunk", async () => {
    const h = makeHarness();
    await chainServerDrivenContinuation({
      event: {},
      run: timeoutBoundaryRun(),
      effectiveThreadId: "thread-1",
      effectiveTurnId: "turn-1",
      requestBody: { message: "go", threadId: "thread-1" },
      backgroundContinuationCount: 0,
      turnInputTokens: 1_234_567,
      chainViaDurableBackground: false,
      deps: h.deps,
    });

    const insertOpts = (h.deps.insertRun as any).mock.calls[0][3];
    expect(JSON.parse(insertOpts.dispatchPayload)).toMatchObject({
      [AGENT_CHAT_TURN_INPUT_TOKENS_FIELD]: 1_234_567,
    });
  });
});

describe("resolvePriorContinuationReason", () => {
  it("reads continuationReason straight off a normal chain-hop marker", () => {
    expect(
      resolvePriorContinuationReason(
        { continuationReason: "rate_limited" },
        {},
      ),
    ).toBe("rate_limited");
  });

  it("falls back to the body's stashed reason for a payloadRef redelivery whose marker has none", () => {
    expect(
      resolvePriorContinuationReason(
        { runId: "run-1", payloadRef: true },
        { [AGENT_CHAT_PRIOR_CONTINUATION_REASON_FIELD]: "rate_limited" },
      ),
    ).toBe("rate_limited");
  });

  it("returns undefined when neither the marker nor the body carries a reason", () => {
    expect(resolvePriorContinuationReason(null, {})).toBeUndefined();
    expect(
      resolvePriorContinuationReason({ runId: "run-1" }, {}),
    ).toBeUndefined();
  });
});

describe("resolvePriorContinuationState", () => {
  it("resolves priorNoProgressErrorCode/priorNoProgressCount from the body for a skeleton-marker redelivery", () => {
    const state = resolvePriorContinuationState(
      { runId: "run-1", payloadRef: true },
      {
        [AGENT_CHAT_PRIOR_CONTINUATION_REASON_FIELD]: "rate_limited",
        [AGENT_CHAT_PRIOR_NO_PROGRESS_ERROR_CODE_FIELD]:
          "builder_gateway_internal_error",
        [AGENT_CHAT_PRIOR_NO_PROGRESS_COUNT_FIELD]: 1,
      },
    );
    expect(state).toEqual({
      continuationReason: "rate_limited",
      noProgressErrorCode: "builder_gateway_internal_error",
      noProgressCount: 1,
    });
  });

  it("prefers the marker over the body when both carry the no-progress streak", () => {
    const state = resolvePriorContinuationState(
      { noProgressErrorCode: "http_429", noProgressCount: 2 },
      {
        [AGENT_CHAT_PRIOR_NO_PROGRESS_ERROR_CODE_FIELD]: "stale_body_value",
        [AGENT_CHAT_PRIOR_NO_PROGRESS_COUNT_FIELD]: 99,
      },
    );
    expect(state.noProgressErrorCode).toBe("http_429");
    expect(state.noProgressCount).toBe(2);
  });

  it("defaults noProgressCount to 0 when neither the marker nor the body carries it", () => {
    expect(resolvePriorContinuationState(null, {})).toEqual({
      continuationReason: undefined,
      noProgressErrorCode: undefined,
      noProgressCount: 0,
    });
  });
});
