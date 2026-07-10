import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_CHAT_BACKGROUND_RUN_FIELD,
  AGENT_CHAT_PROCESS_RUN_PATH,
} from "./durable-background.js";
import {
  chainServerDrivenContinuation,
  isLoopProtectionDispatchError,
  MAX_BACKGROUND_RUN_CONTINUATIONS,
  MAX_NESTED_SELF_DISPATCH_DEPTH,
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
    backgroundContinuationCount?: number;
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
      {
        runId: "run-chunk0",
        continuationReason: "run_timeout",
        terminalEvent: { type: "auto_continue", reason: "run_timeout" },
      },
    );
    // No failure path was taken.
    expect(h.deps.updateRunStatusIfRunning).not.toHaveBeenCalled();
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

  it("DEFERS (never errors) the pre-inserted successor when every attempt dies — the unclaimed-run sweep gets a chance to recover it", async () => {
    const dispatchMock = vi.fn().mockRejectedValue(new Error("dispatch down"));
    const h = makeHarness({ fireInternalDispatch: dispatchMock as any });
    await runChain(h);

    // Foreground path: 2 attempts (initial + one retry).
    expect(dispatchMock).toHaveBeenCalledTimes(2);
    // The pre-inserted successor is LEFT ALONE — still status='running',
    // dispatch_mode='background', dispatch_payload intact — so the
    // unclaimed-background-run sweep (agent-chat-plugin.ts) can redispatch
    // it. It is never marked errored from this path.
    expect(h.deps.updateRunStatusIfRunning).not.toHaveBeenCalledWith(
      "run-next",
      "errored",
    );
    expect(h.deps.setRunTerminalReason).not.toHaveBeenCalledWith(
      "run-next",
      expect.any(String),
    );
    // The successor's diag stage records WHY it was left for the sweep (the
    // only forensics channel — bg logs are unreadable).
    expect(h.deps.recordRunDiagnostic).toHaveBeenCalledWith(
      "run-next",
      RUN_DIAG_STAGE.workerThrew,
      expect.stringContaining("chain_dispatch_deferred"),
    );
    // …the finished chunk DOES go terminal — its own soft-timeout budget is
    // genuinely spent — but with the distinct, honest "deferred" reason: the
    // TURN is not dead, only this handoff attempt was.
    expect(h.deps.updateRunStatusIfRunning).toHaveBeenCalledWith(
      "run-chunk0",
      "errored",
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
    // The chunk is NOT marked as a clean continuation boundary.
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

    // No successor row was ever created, so there is nothing to defer to a
    // sweep — this is genuinely unrecoverable and must fail loud immediately,
    // same as before this change.
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
  it("retries up to 5 times at a 15s response timeout, using the capped backoff schedule, before deferring to the sweep", async () => {
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
    // target — only the budget widened). This is exactly the case the
    // recovery was built for: a background-function worker with NO
    // connected-client fallback — the pre-inserted successor is left for the
    // sweep instead of being errored immediately.
    expect(dispatch.path).toBe(AGENT_CHAT_PROCESS_RUN_PATH);
    expect(h.deps.updateRunStatusIfRunning).not.toHaveBeenCalledWith(
      "run-next",
      "errored",
    );
    expect(h.deps.updateRunStatusIfRunning).toHaveBeenCalledWith(
      "run-chunk0",
      "errored",
    );
    expect(h.deps.setRunTerminalReason).toHaveBeenCalledWith(
      "run-chunk0",
      "background_continuation_dispatch_deferred",
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
    // This chunk still goes terminal loudly, but the recoverable-vs-fatal
    // split applies uniformly regardless of dispatch target: the pre-inserted
    // successor row exists in SQL either way, so it is left for the sweep
    // instead of being errored immediately.
    expect(h.deps.updateRunStatusIfRunning).toHaveBeenCalledWith(
      "run-chunk0",
      "errored",
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

    // The foreground budget allows 2 attempts, but a 508 is a property of
    // this same nested call chain — retrying it will not help, so the loop
    // stops after the FIRST attempt instead of exhausting the budget.
    expect(dispatchMock).toHaveBeenCalledTimes(1);

    // Still deferred — never the fatal `background_continuation_dispatch_failed`.
    expect(h.deps.updateRunStatusIfRunning).toHaveBeenCalledWith(
      "run-chunk0",
      "errored",
    );
    expect(h.deps.setRunTerminalReason).toHaveBeenCalledWith(
      "run-chunk0",
      "background_continuation_dispatch_deferred",
    );
    expect(h.deps.setRunTerminalReason).not.toHaveBeenCalledWith(
      "run-chunk0",
      "background_continuation_dispatch_failed",
    );
    // The successor row itself is left alone for the sweep — never errored.
    expect(h.deps.updateRunStatusIfRunning).not.toHaveBeenCalledWith(
      "run-next",
      "errored",
    );
    // Distinctly classified in the diagnostics — greppable apart from a
    // generic "dispatch_budget_exhausted" deferral.
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

    // No nested self-dispatch was even attempted — avoided the doomed call
    // entirely instead of reacting to it after the fact.
    expect(dispatchMock).not.toHaveBeenCalled();
    // The successor row was still pre-inserted (so the sweep has something to
    // find) and this chunk is deferred, exactly like an exhausted retry budget.
    expect(h.deps.insertRun).toHaveBeenCalled();
    expect(h.deps.updateRunStatusIfRunning).toHaveBeenCalledWith(
      "run-chunk0",
      "errored",
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
    // Simulates a turn that has already been through several sweep-mediated
    // chain breaks (each resets backgroundContinuationCount to 0 — see the
    // "Unclaimed background-run sweep" in agent-chat-plugin.ts) but has
    // genuinely consumed far more runs than the intentional budget allows.
    // The durable SQL ledger (countRunsForTurn), NOT the in-marker count, is
    // what must catch this.
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
  });
});
