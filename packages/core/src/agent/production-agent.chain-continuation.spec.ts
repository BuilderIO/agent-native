import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_CHAT_BACKGROUND_RUN_FIELD,
  AGENT_CHAT_PROCESS_RUN_PATH,
} from "./durable-background.js";
import {
  chainServerDrivenContinuation,
  MAX_BACKGROUND_RUN_CONTINUATIONS,
  resolveContinuationDispatchBudget,
  type ChainServerDrivenContinuationDeps,
} from "./production-agent.js";
import type { ActiveRun } from "./run-manager.js";
import { RUN_DIAG_STAGE } from "./run-store.js";
import type { AgentChatEvent } from "./types.js";

/**
 * Unit tests for the server-driven continuation handoff shared by the
 * durable-background worker chain and the foreground self-chain
 * (`AGENT_CHAT_FOREGROUND_SELF_CHAIN`). Every dependency is injected, so
 * each Phase-0 discipline is pinned in isolation:
 *   - the successor run row is PRE-INSERTED before the dispatch fires,
 *   - the dispatch is fully awaited (with retry), carrying ids only,
 *   - a failed handoff is LOUD (diag stage + errored rows + terminal
 *     reasons), never a silent loss,
 *   - the foreground path treats the successor's atomic claim as the
 *     dispatch acknowledgment (a regular-function target responds only
 *     after the successor chunk finishes, so a response timeout is not
 *     proof of a dead handoff),
 *   - the durable path's behavior (target, attempts, timeout) is unchanged.
 */

const ENV_KEYS = ["NETLIFY", "NETLIFY_LOCAL", "AWS_LAMBDA_FUNCTION_NAME"];
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
    >
  >;
  /** Ordered log of the calls that matter for handoff-ordering assertions. */
  callOrder: string[];
}

function makeHarness(overrides?: {
  fireInternalDispatch?: ChainServerDrivenContinuationDeps["fireInternalDispatch"];
  readBackgroundRunClaim?: ChainServerDrivenContinuationDeps["readBackgroundRunClaim"];
  countRunsForTurn?: ChainServerDrivenContinuationDeps["countRunsForTurn"];
}): Harness {
  const callOrder: string[] = [];
  const deps: Harness["deps"] = {
    countRunsForTurn: overrides?.countRunsForTurn ?? vi.fn(async () => 1),
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
    setRunTerminalReason: vi.fn(async () => {}),
    recordRunDiagnostic: vi.fn(async () => {}),
    markBackgroundContinuationChunkTerminal: vi.fn(async () => {
      callOrder.push("markTerminal");
      return true;
    }),
    generateRunId: vi.fn(() => "run-next"),
    sleep: vi.fn(async () => {}),
  };
  // Wrap dispatch so ordering is recorded even for injected overrides.
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
  },
): Promise<void> {
  await chainServerDrivenContinuation({
    event: {},
    run: timeoutBoundaryRun(),
    effectiveThreadId: "thread-1",
    effectiveTurnId: "turn-1",
    requestBody: opts?.requestBody ?? {
      message: "a very large user message",
      history: [{ role: "user", content: "x".repeat(1000) }],
      threadId: "thread-1",
      [AGENT_CHAT_BACKGROUND_RUN_FIELD]: { runId: "run-chunk0" },
    },
    backgroundContinuationCount: 0,
    chainViaDurableBackground: opts?.chainViaDurableBackground ?? false,
    workerProvenInBackgroundFunction: opts?.workerProvenInBackgroundFunction,
    deps: harness.deps,
  });
}

describe("chainServerDrivenContinuation — transactional handoff (foreground self-chain)", () => {
  it("PRE-INSERTS the successor row before the dispatch fires, then marks the chunk terminal", async () => {
    const h = makeHarness();
    await runChain(h);

    // Ordering: insert BEFORE dispatch BEFORE terminal-marking. The pre-insert
    // is what keeps /runs/active gap-free and lets a racing client
    // continuation 409 against the successor instead of double-running.
    expect(h.callOrder).toEqual(["insertRun", "dispatch", "markTerminal"]);

    expect(h.deps.insertRun).toHaveBeenCalledWith(
      "run-next",
      "thread-1",
      "turn-1",
      expect.objectContaining({ dispatchMode: "background" }),
    );
    // The successor's rehydration payload is persisted ON the row…
    const insertOptions = (h.deps.insertRun as any).mock.calls[0][3];
    const payload = JSON.parse(insertOptions.dispatchPayload);
    expect(payload.internalContinuation).toBe(true);
    expect(payload.message).toBe("a very large user message");
    // …with the finished chunk's own marker stripped.
    expect(payload[AGENT_CHAT_BACKGROUND_RUN_FIELD]).toBeUndefined();

    // The chunk is marked terminal ONLY after the handoff landed.
    expect(h.deps.markBackgroundContinuationChunkTerminal).toHaveBeenCalledWith(
      { runId: "run-chunk0", continuationReason: "run_timeout" },
    );
    // No failure path was taken.
    expect(h.deps.updateRunStatusIfRunning).not.toHaveBeenCalled();
  });

  it("dispatches IDS ONLY (payloadRef marker) — never the chat body — and fully awaits the response", async () => {
    const h = makeHarness();
    await runChain(h);

    const dispatch = (h.deps.fireInternalDispatch as any).mock.calls[0][0];
    // Foreground self-chain targets the framework route on the REGULAR
    // function: with AGENT_CHAT_DURABLE_BACKGROUND off the `-background`
    // function is never emitted, so this is the only guaranteed target.
    expect(dispatch.path).toBe(AGENT_CHAT_PROCESS_RUN_PATH);
    expect(dispatch.taskId).toBe("run-next");
    expect(dispatch.awaitResponse).toBe(true);
    expect(dispatch.responseTimeoutMs).toBe(10_000);
    // Ids-only body: marker + continuation flag, nothing else (Netlify caps
    // background bodies at 256KB; the payload lives on the run row).
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
      // Framework-route target → the successor keeps the 40s chunk clamp.
      backgroundFunctionRuntimeExpected: false,
    });
    expect(dispatch.body.message).toBeUndefined();
    expect(dispatch.body.history).toBeUndefined();
  });

  it("retries a transiently failed dispatch (one retry on the foreground path) and heartbeats the held row", async () => {
    const dispatchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(undefined);
    const h = makeHarness({ fireInternalDispatch: dispatchMock as any });
    await runChain(h);

    expect(dispatchMock).toHaveBeenCalledTimes(2);
    // The retry backoff keeps the pre-inserted successor visibly alive so the
    // unclaimed-run sweep cannot reap a handoff still being delivered.
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
        // The successor re-entered and claimed the run while the awaited
        // response was still streaming its ~40s chunk.
        dispatchMode: "background-processing",
        status: "running",
        diagStage: null,
        workerStage: null,
        lastLivenessAt: Date.now(),
      })) as any,
    });
    await runChain(h);

    // One attempt, no retry — the claim proved the handoff landed; a
    // duplicate delivery would only lose the CAS and no-op anyway.
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(h.deps.markBackgroundContinuationChunkTerminal).toHaveBeenCalled();
    // Nothing was errored — this is a SUCCESSFUL handoff.
    expect(h.deps.updateRunStatusIfRunning).not.toHaveBeenCalled();
  });

  it("fails LOUD when every attempt dies: successor + chunk errored, diag stage recorded — never silent", async () => {
    const dispatchMock = vi.fn().mockRejectedValue(new Error("dispatch down"));
    const h = makeHarness({ fireInternalDispatch: dispatchMock as any });
    await runChain(h);

    // Foreground path: 2 attempts (initial + one retry).
    expect(dispatchMock).toHaveBeenCalledTimes(2);
    // The pre-inserted successor is errored immediately (not left for the
    // sweep) with a truthful terminal reason…
    expect(h.deps.updateRunStatusIfRunning).toHaveBeenCalledWith(
      "run-next",
      "errored",
    );
    expect(h.deps.setRunTerminalReason).toHaveBeenCalledWith(
      "run-next",
      "background_continuation_dispatch_failed",
    );
    // …and the finished chunk is errored too, with the failure written as its
    // diag stage (the only forensics channel — bg logs are unreadable).
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
    // The chunk is NOT marked as a clean continuation boundary.
    expect(
      h.deps.markBackgroundContinuationChunkTerminal,
    ).not.toHaveBeenCalled();
    // With both rows terminal, the thread slot is free — the client's
    // existing auto_continue re-POST (it still receives the terminal event)
    // takes over as the fallback. See run-store.foreground-self-chain.spec.
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
    // The dispatch TARGET takes priority over the worker's proven runtime —
    // a durable-background dispatch is always sized the same regardless of
    // where the CALLER happens to be running.
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
    // Materially larger than the foreground budget: this worker has minutes
    // of remaining wall clock and no connected-client fallback.
    expect(budget.maxDispatchAttempts).toBe(5);
    expect(budget.dispatchResponseTimeoutMs).toBe(15_000);
    expect(budget.backoffCapMs).toBe(4_000);
    // Worst case stays well inside the ~2min gap between the 13-min soft
    // timeout ceiling and Netlify's ~15-min background-function hard limit.
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

describe("chainServerDrivenContinuation — worker proven in background function gets the widened budget", () => {
  it("retries up to 5 times at a 15s response timeout, using the capped backoff schedule, before failing loud", async () => {
    const dispatchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const h = makeHarness({ fireInternalDispatch: dispatchMock as any });
    await runChain(h, {
      chainViaDurableBackground: false,
      workerProvenInBackgroundFunction: true,
    });

    // Full budget consumed — a transient/resumable error (`fetch failed`)
    // does not short-circuit the retry loop.
    expect(dispatchMock).toHaveBeenCalledTimes(5);
    const dispatch = dispatchMock.mock.calls[0][0];
    expect(dispatch.responseTimeoutMs).toBe(15_000);
    // Capped exponential backoff: 500ms, 1s, 2s, 4s across the 4 gaps.
    const sleepCalls = (h.deps.sleep as any).mock.calls.map(
      (c: unknown[]) => c[0],
    );
    expect(sleepCalls).toEqual([500, 1000, 2000, 4000]);
    // Dispatch still targets the regular `_process-run` route (unchanged
    // target — only the budget widened), and both rows go terminal loudly
    // on final exhaustion, same as the foreground exhaustion path.
    expect(dispatch.path).toBe(AGENT_CHAT_PROCESS_RUN_PATH);
    expect(h.deps.updateRunStatusIfRunning).toHaveBeenCalledWith(
      "run-next",
      "errored",
    );
    expect(h.deps.updateRunStatusIfRunning).toHaveBeenCalledWith(
      "run-chunk0",
      "errored",
    );
    expect(h.deps.setRunTerminalReason).toHaveBeenCalledWith(
      "run-chunk0",
      "background_continuation_dispatch_failed",
    );
  });
});

describe("chainServerDrivenContinuation — durable-background path unchanged", () => {
  it("keeps the durable worker chain's target, 3 attempts, 15s timeout, and never consults the claim on failure", async () => {
    process.env.NETLIFY = "true";
    const dispatchMock = vi.fn().mockRejectedValue(new Error("dead handoff"));
    const readClaim = vi.fn();
    const h = makeHarness({
      fireInternalDispatch: dispatchMock as any,
      readBackgroundRunClaim: readClaim as any,
    });
    await runChain(h, { chainViaDurableBackground: true });

    // The Netlify background function's default url (15-min budget) with the
    // pre-existing 3-attempt / 15s-await discipline.
    expect(dispatchMock).toHaveBeenCalledTimes(3);
    const dispatch = dispatchMock.mock.calls[0][0];
    expect(dispatch.path).toBe("/.netlify/functions/server-agent-background");
    expect(dispatch.responseTimeoutMs).toBe(15_000);
    expect(dispatch.body[AGENT_CHAT_BACKGROUND_RUN_FIELD]).toMatchObject({
      backgroundFunctionRuntimeExpected: true,
    });
    // A Netlify background fn 202s on enqueue, so a failed await IS a dead
    // handoff — the claim-check shortcut is foreground-only.
    expect(readClaim).not.toHaveBeenCalled();
    expect(h.deps.updateRunStatusIfRunning).toHaveBeenCalledWith(
      "run-chunk0",
      "errored",
    );
  });
});
