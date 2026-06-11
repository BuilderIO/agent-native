import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentChatEvent } from "./types.js";

vi.mock("./run-store.js", () => ({
  insertRun: vi.fn(() => Promise.resolve()),
  insertRunEvent: vi.fn(() => Promise.resolve()),
  updateRunStatus: vi.fn(() => Promise.resolve()),
  updateRunStatusIfRunning: vi.fn(() => Promise.resolve(true)),
  getRunStatus: vi.fn(() => Promise.resolve("running")),
  tryClaimRunSlot: vi.fn(() =>
    Promise.resolve({ claimed: true, activeRunId: null }),
  ),
  markRunAborted: vi.fn(() => Promise.resolve()),
  isRunAborted: vi.fn(() => Promise.resolve(false)),
  getRunAbortState: vi.fn(() => Promise.resolve({ aborted: false })),
  getRunEventsSince: vi.fn(() => Promise.resolve([])),
  getRunById: vi.fn(() => Promise.resolve(null)),
  getRunByThread: vi.fn(() => Promise.resolve(null)),
  cleanupOldRuns: vi.fn(() => Promise.resolve()),
  updateRunHeartbeat: vi.fn(() => Promise.resolve()),
  bumpRunProgress: vi.fn(() => Promise.resolve()),
  reapIfStale: vi.fn(() => Promise.resolve(null)),
  ensureTerminalRunEvent: vi.fn(() => Promise.resolve()),
  setRunError: vi.fn(() => Promise.resolve()),
  STALE_RUN_ERROR_EVENT: {
    type: "error",
    error:
      "The agent stopped before it could finish. It may have hit a server timeout or the worker may have been interrupted.",
    errorCode: "stale_run",
    recoverable: true,
    details:
      "The run heartbeat stopped while the run was still marked running. Partial output and tool calls were preserved when available.",
  },
}));

import {
  abortRun,
  DEFAULT_COMPLETED_RUN_RETENTION_MS,
  DEFAULT_ERRORED_RUN_RETENTION_MS,
  DEFAULT_HOSTED_RUN_SOFT_TIMEOUT_MS,
  HOSTED_SOFT_TIMEOUT_CEILING_MS,
  getActiveRunForThreadAsync,
  resolveCompletedRunRetentionMs,
  resolveErroredRunRetentionMs,
  resolveRunSoftTimeoutMs,
  startRun,
  subscribeToRun,
  TERMINAL_RUN_RECONNECT_WINDOW_MS,
} from "./run-manager.js";
import {
  getRunAbortState,
  getRunStatus,
  insertRun,
  insertRunEvent,
  getRunById,
  getRunByThread,
  getRunEventsSince,
  markRunAborted,
  updateRunStatus,
  updateRunStatusIfRunning,
  ensureTerminalRunEvent,
  cleanupOldRuns,
  setRunError,
} from "./run-store.js";
import { registerErrorCaptureProvider } from "../server/capture-error.js";

const originalTimeoutEnv = process.env.AGENT_RUN_SOFT_TIMEOUT_MS;
const originalRetentionEnv = process.env.AGENT_RUN_RETENTION_MS;
const originalErroredRetentionEnv = process.env.AGENT_ERRORED_RUN_RETENTION_MS;
const originalNetlify = process.env.NETLIFY;
const originalNetlifyLocal = process.env.NETLIFY_LOCAL;
const originalCfPages = process.env.CF_PAGES;
const originalVercel = process.env.VERCEL;
const originalVercelEnv = process.env.VERCEL_ENV;
const originalRender = process.env.RENDER;
const originalFlyAppName = process.env.FLY_APP_NAME;
const originalKService = process.env.K_SERVICE;
const originalAwsLambdaFunctionName = process.env.AWS_LAMBDA_FUNCTION_NAME;

function clearHostedEnvForTest() {
  delete process.env.AGENT_RUN_SOFT_TIMEOUT_MS;
  delete process.env.AGENT_RUN_RETENTION_MS;
  delete process.env.AGENT_ERRORED_RUN_RETENTION_MS;
  delete process.env.NETLIFY;
  delete process.env.NETLIFY_LOCAL;
  delete process.env.CF_PAGES;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.RENDER;
  delete process.env.FLY_APP_NAME;
  delete process.env.K_SERVICE;
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
}

function restoreHostedEnvAfterTest() {
  if (originalTimeoutEnv === undefined)
    delete process.env.AGENT_RUN_SOFT_TIMEOUT_MS;
  else process.env.AGENT_RUN_SOFT_TIMEOUT_MS = originalTimeoutEnv;
  if (originalRetentionEnv === undefined)
    delete process.env.AGENT_RUN_RETENTION_MS;
  else process.env.AGENT_RUN_RETENTION_MS = originalRetentionEnv;
  if (originalErroredRetentionEnv === undefined)
    delete process.env.AGENT_ERRORED_RUN_RETENTION_MS;
  else process.env.AGENT_ERRORED_RUN_RETENTION_MS = originalErroredRetentionEnv;
  if (originalNetlify === undefined) delete process.env.NETLIFY;
  else process.env.NETLIFY = originalNetlify;
  if (originalNetlifyLocal === undefined) delete process.env.NETLIFY_LOCAL;
  else process.env.NETLIFY_LOCAL = originalNetlifyLocal;
  if (originalCfPages === undefined) delete process.env.CF_PAGES;
  else process.env.CF_PAGES = originalCfPages;
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
  if (originalRender === undefined) delete process.env.RENDER;
  else process.env.RENDER = originalRender;
  if (originalFlyAppName === undefined) delete process.env.FLY_APP_NAME;
  else process.env.FLY_APP_NAME = originalFlyAppName;
  if (originalKService === undefined) delete process.env.K_SERVICE;
  else process.env.K_SERVICE = originalKService;
  if (originalAwsLambdaFunctionName === undefined)
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  else process.env.AWS_LAMBDA_FUNCTION_NAME = originalAwsLambdaFunctionName;
}

describe("run manager soft timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearHostedEnvForTest();
    vi.mocked(getRunAbortState).mockResolvedValue({ aborted: false });
    vi.mocked(getRunStatus).mockResolvedValue("running");
    vi.mocked(getRunById).mockResolvedValue(null);
    vi.mocked(getRunEventsSince).mockResolvedValue([]);
    vi.mocked(insertRun).mockResolvedValue(undefined);
    vi.mocked(insertRunEvent).mockResolvedValue(undefined);
    vi.mocked(markRunAborted).mockClear();
    vi.mocked(insertRunEvent).mockClear();
    vi.mocked(updateRunStatus).mockClear();
    vi.mocked(updateRunStatusIfRunning).mockReset();
    vi.mocked(updateRunStatusIfRunning).mockResolvedValue(true);
    vi.mocked(cleanupOldRuns).mockClear();
    vi.mocked(setRunError).mockClear();
  });

  afterEach(() => {
    restoreHostedEnvAfterTest();
    vi.useRealTimers();
  });

  it("emits an internal continuation signal and aborts the run chunk", async () => {
    const events: AgentChatEvent[] = [];
    let aborted = false;

    const run = startRun(
      "run-soft-timeout",
      "thread-soft-timeout",
      async (_send, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve();
          });
        });
      },
      undefined,
      { softTimeoutMs: 10 },
    );
    run.subscribers.add((event) => events.push(event.event));

    await vi.advanceTimersByTimeAsync(11);

    expect(aborted).toBe(true);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "auto_continue",
        reason: "run_timeout",
      }),
    );
    expect(run.status).toBe("completed");
  });

  it("persists the terminal auto_continue with a unique seq when the run emits events after the soft timeout", async () => {
    // Regression: the soft-timeout terminal event (auto_continue) is stashed
    // with the seq captured at `send()` time. If the runFn streams MORE events
    // before it actually stops on the abort signal, those events reuse that
    // seq and get persisted first. If the terminal event were emitted with its
    // stale captured seq, insertRunEvent's `ON CONFLICT (run_id, seq) DO
    // NOTHING` would silently drop it and the client would lose the
    // continuation signal. The terminal event must always land in SQL with a
    // unique seq.
    const persisted: Array<{ seq: number; type: string }> = [];
    vi.mocked(insertRunEvent).mockImplementation(
      async (_runId, seq, eventData) => {
        persisted.push({ seq, type: JSON.parse(eventData).type });
      },
    );

    const run = startRun(
      "run-soft-timeout-late-events",
      "thread-soft-timeout-late-events",
      async (send, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            // Simulate the runFn streaming a couple more chunks before it
            // actually unwinds on the abort signal — these get pushed and
            // would reuse the auto_continue's stashed seq.
            send({ type: "text", text: "late chunk 1" });
            send({ type: "text", text: "late chunk 2" });
            resolve();
          });
        });
      },
      undefined,
      { softTimeoutMs: 10 },
    );
    run.subscribers.add(() => {});

    await vi.advanceTimersByTimeAsync(11);
    await vi.waitFor(() =>
      expect(persisted.some((e) => e.type === "auto_continue")).toBe(true),
    );

    // The terminal auto_continue must be persisted exactly once...
    const terminalPersists = persisted.filter(
      (e) => e.type === "auto_continue",
    );
    expect(terminalPersists).toHaveLength(1);
    // ...and with a seq that doesn't collide with any other persisted event.
    const terminalSeq = terminalPersists[0].seq;
    const collisions = persisted.filter(
      (e) => e.seq === terminalSeq && e.type !== "auto_continue",
    );
    expect(collisions).toHaveLength(0);
    // All persisted seqs must be unique (no ON CONFLICT drops).
    const allSeqs = persisted.map((e) => e.seq);
    expect(new Set(allSeqs).size).toBe(allSeqs.length);
    expect(run.status).toBe("completed");
  });

  it("prefers an explicit soft timeout over the environment default", () => {
    process.env.AGENT_RUN_SOFT_TIMEOUT_MS = "25000";

    expect(resolveRunSoftTimeoutMs(5000)).toBe(5000);
  });

  it("disables the default soft timeout in local runtimes", () => {
    expect(resolveRunSoftTimeoutMs()).toBe(0);
  });

  it("does not use a hosted default unless the caller opts in", () => {
    process.env.NETLIFY = "true";

    expect(resolveRunSoftTimeoutMs()).toBe(0);
  });

  it("uses a hosted default for callers that opt in", () => {
    process.env.NETLIFY = "true";

    expect(resolveRunSoftTimeoutMs(undefined, { useHostedDefault: true })).toBe(
      DEFAULT_HOSTED_RUN_SOFT_TIMEOUT_MS,
    );
  });

  it("detects truthy Netlify runtime values beyond the literal string true", () => {
    process.env.NETLIFY = "1";

    expect(resolveRunSoftTimeoutMs(undefined, { useHostedDefault: true })).toBe(
      DEFAULT_HOSTED_RUN_SOFT_TIMEOUT_MS,
    );
  });

  it("uses a hosted default inside Netlify's Lambda runtime", () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = "analytics-agent-chat";

    expect(resolveRunSoftTimeoutMs(undefined, { useHostedDefault: true })).toBe(
      DEFAULT_HOSTED_RUN_SOFT_TIMEOUT_MS,
    );
  });

  it("treats Netlify local as a local runtime", () => {
    process.env.NETLIFY = "true";
    process.env.NETLIFY_LOCAL = "true";

    expect(resolveRunSoftTimeoutMs(undefined, { useHostedDefault: true })).toBe(
      0,
    );
  });

  it("allows the environment to disable hosted soft timeouts", () => {
    process.env.NETLIFY = "true";
    process.env.AGENT_RUN_SOFT_TIMEOUT_MS = "0";

    expect(resolveRunSoftTimeoutMs(undefined, { useHostedDefault: true })).toBe(
      0,
    );
  });

  it("clamps hosted soft timeout overrides under the gateway hard wall", () => {
    process.env.NETLIFY = "true";

    expect(resolveRunSoftTimeoutMs(240_000)).toBe(
      HOSTED_SOFT_TIMEOUT_CEILING_MS,
    );
  });

  it("clamps hosted soft timeout env values under the gateway hard wall", () => {
    process.env.NETLIFY = "true";
    process.env.AGENT_RUN_SOFT_TIMEOUT_MS = "240000";

    expect(resolveRunSoftTimeoutMs(undefined, { useHostedDefault: true })).toBe(
      HOSTED_SOFT_TIMEOUT_CEILING_MS,
    );
  });

  it("keeps persisted run events for a day by default", () => {
    expect(resolveCompletedRunRetentionMs()).toBe(
      DEFAULT_COMPLETED_RUN_RETENTION_MS,
    );
  });

  it("allows run event retention to be configured by environment", () => {
    process.env.AGENT_RUN_RETENTION_MS = "60000";

    expect(resolveCompletedRunRetentionMs()).toBe(60000);
  });

  it("keeps errored run events for seven days by default", () => {
    expect(resolveErroredRunRetentionMs()).toBe(
      DEFAULT_ERRORED_RUN_RETENTION_MS,
    );
  });

  it("allows errored run event retention to be configured by environment", () => {
    process.env.AGENT_ERRORED_RUN_RETENTION_MS = "120000";

    expect(resolveErroredRunRetentionMs()).toBe(120000);
  });

  it("prunes completed and errored run events with separate retention windows", async () => {
    process.env.AGENT_RUN_RETENTION_MS = "60000";
    process.env.AGENT_ERRORED_RUN_RETENTION_MS = "120000";

    startRun(
      "run-retention-cleanup",
      "thread-retention-cleanup",
      async () => {},
      undefined,
      { softTimeoutMs: 0 },
    );

    await vi.waitFor(() => {
      expect(cleanupOldRuns).toHaveBeenCalledWith(60000, 120000);
    });
  });

  it("persists the logical turn id for continuation runs", async () => {
    startRun(
      "run-continuation-chunk",
      "thread-continuation-chunk",
      async () => {},
      undefined,
      { softTimeoutMs: 0, turnId: "turn-original" },
    );

    await vi.waitFor(() => {
      expect(insertRun).toHaveBeenCalledWith(
        "run-continuation-chunk",
        "thread-continuation-chunk",
        "turn-original",
      );
    });
  });

  it("persists terminal error events before marking errored runs complete", async () => {
    let releaseTerminalEvent!: () => void;
    const terminalEventPersisted = new Promise<void>((resolve) => {
      releaseTerminalEvent = resolve;
    });
    vi.mocked(insertRunEvent).mockImplementation(
      async (_runId, _seq, eventData) => {
        const event = JSON.parse(eventData);
        if (event.type === "error") {
          await terminalEventPersisted;
        }
      },
    );

    startRun(
      "run-terminal-event-order",
      "thread-terminal-event-order",
      async () => {
        throw new Error("boom");
      },
      undefined,
      { softTimeoutMs: 0 },
    );

    await vi.waitFor(() => {
      expect(insertRunEvent).toHaveBeenCalledWith(
        "run-terminal-event-order",
        0,
        expect.stringContaining('"type":"error"'),
      );
    });
    expect(updateRunStatusIfRunning).not.toHaveBeenCalled();

    releaseTerminalEvent();

    await vi.waitFor(() => {
      expect(updateRunStatusIfRunning).toHaveBeenCalledWith(
        "run-terminal-event-order",
        "errored",
      );
    });
  });

  it("records terminal error diagnostics for errored runs", async () => {
    startRun(
      "run-error-diagnostics",
      "thread-error-diagnostics",
      async () => {
        throw new Error("boom");
      },
      undefined,
      { softTimeoutMs: 0 },
    );

    await vi.waitFor(() => {
      expect(setRunError).toHaveBeenCalledWith(
        "run-error-diagnostics",
        "unknown",
        "boom",
      );
    });
  });

  it("retires explicitly aborted in-memory runs while preserving completion callbacks", async () => {
    const onComplete = vi.fn();
    const terminalEvents: AgentChatEvent[] = [];
    const run = startRun(
      "run-explicit-abort",
      "thread-explicit-abort",
      async (send, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        send({ type: "text", text: "late event after abort" });
      },
      onComplete,
      { softTimeoutMs: 0 },
    );
    run.subscribers.add((event) => terminalEvents.push(event.event));

    expect(abortRun("run-explicit-abort")).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(run.status).toBe("aborted");
    expect(run.events).toHaveLength(0);
    expect(run.subscribers.size).toBe(0);
    expect(terminalEvents).toContainEqual({ type: "done" });
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(markRunAborted).toHaveBeenCalledWith("run-explicit-abort", "user");
  });

  it("skips completion callbacks for no-progress recovery aborts", async () => {
    const onComplete = vi.fn();
    const run = startRun(
      "run-no-progress-abort",
      "thread-no-progress-abort",
      async (_send, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      onComplete,
      { softTimeoutMs: 0 },
    );

    expect(abortRun("run-no-progress-abort", "no_progress")).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(run.status).toBe("aborted");
    expect(onComplete).not.toHaveBeenCalled();
    expect(markRunAborted).toHaveBeenCalledWith(
      "run-no-progress-abort",
      "no_progress",
    );
  });

  it("observes cross-isolate SQL aborts even when the run is idle", async () => {
    vi.mocked(getRunAbortState).mockResolvedValue({
      aborted: true,
      reason: "no_progress",
    });
    let abortReason: unknown;

    const run = startRun(
      "run-sql-abort",
      "thread-sql-abort",
      async (_send, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              abortReason = signal.reason;
              resolve();
            },
            { once: true },
          );
        });
      },
      undefined,
      { softTimeoutMs: 0 },
    );

    await vi.advanceTimersByTimeAsync(1501);

    expect(abortReason).toBe("no_progress");
    expect(run.abortReason).toBe("no_progress");
  });

  it("waits for the SQL run row insert before writing terminal status", async () => {
    let resolveInsert!: () => void;
    const insertPromise = new Promise<void>((resolve) => {
      resolveInsert = resolve;
    });
    vi.mocked(insertRun).mockReturnValueOnce(insertPromise);

    const run = startRun(
      "run-insert-race",
      "thread-insert-race",
      async (send) => {
        send({ type: "text", text: "fast answer" });
      },
      undefined,
      { softTimeoutMs: 0 },
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(run.status).toBe("completed");
    expect(updateRunStatusIfRunning).not.toHaveBeenCalledWith(
      "run-insert-race",
      "completed",
    );

    resolveInsert();

    await vi.waitFor(() =>
      expect(updateRunStatusIfRunning).toHaveBeenCalledWith(
        "run-insert-race",
        "completed",
      ),
    );
  });

  it("captures background run errors through the generic capture registry", async () => {
    const provider = vi.fn(() => "evt_run");
    const unregister = registerErrorCaptureProvider(
      "run-manager-test",
      provider,
    );
    const err = new Error("llm stream failed");
    const events: AgentChatEvent[] = [];

    const run = startRun(
      "run-capture-error",
      "thread-capture-error",
      async () => {
        throw err;
      },
      undefined,
      { softTimeoutMs: 0 },
    );
    run.subscribers.add((event) => events.push(event.event));

    await vi.waitFor(() =>
      expect(updateRunStatusIfRunning).toHaveBeenCalledWith(
        "run-capture-error",
        "errored",
      ),
    );
    unregister();

    expect(provider).toHaveBeenCalledWith(
      err,
      expect.objectContaining({
        route: "/_agent-native/agent-chat",
        tags: expect.objectContaining({
          source: "agent-run-manager",
          phase: "run",
          runStatus: "errored",
        }),
        extra: expect.objectContaining({
          runId: "run-capture-error",
          threadId: "thread-capture-error",
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        error: "llm stream failed",
      }),
    );
  });

  it("emits terminal events only after the completion callback resolves", async () => {
    let resolveComplete!: () => void;
    const onComplete = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveComplete = resolve;
        }),
    );
    const events: AgentChatEvent[] = [];

    const run = startRun(
      "run-terminal-after-save",
      "thread-terminal-after-save",
      async (send) => {
        await Promise.resolve();
        send({ type: "text", text: "saved first" });
        send({ type: "done" });
      },
      onComplete,
      { softTimeoutMs: 0 },
    );
    run.subscribers.add((event) => events.push(event.event));

    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));

    expect(run.status).toBe("completed");
    expect(events).toEqual([{ type: "text", text: "saved first" }]);
    expect(
      onComplete.mock.calls[0][0].events.map((event) => event.event),
    ).toEqual([{ type: "text", text: "saved first" }, { type: "done" }]);
    expect(insertRunEvent).toHaveBeenCalledTimes(1);
    expect(insertRunEvent).toHaveBeenCalledWith(
      "run-terminal-after-save",
      0,
      JSON.stringify({ type: "text", text: "saved first" }),
    );
    expect(updateRunStatusIfRunning).not.toHaveBeenCalledWith(
      "run-terminal-after-save",
      "completed",
    );

    resolveComplete();

    await vi.waitFor(() => expect(events).toContainEqual({ type: "done" }));
    expect(insertRunEvent).toHaveBeenCalledWith(
      "run-terminal-after-save",
      1,
      JSON.stringify({ type: "done" }),
    );
    expect(updateRunStatusIfRunning).toHaveBeenCalledWith(
      "run-terminal-after-save",
      "completed",
    );
  });

  it("marks runs errored when completion persistence fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const events: AgentChatEvent[] = [];
    const run = startRun(
      "run-completion-failed",
      "thread-completion-failed",
      async (send) => {
        send({ type: "text", text: "not durable yet" });
        send({ type: "done" });
      },
      async () => {
        throw new Error("thread_data write failed");
      },
      { softTimeoutMs: 0 },
    );
    run.subscribers.add((event) => events.push(event.event));

    await vi.waitFor(() =>
      expect(updateRunStatusIfRunning).toHaveBeenCalledWith(
        "run-completion-failed",
        "errored",
      ),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        error: "Agent response could not be saved.",
      }),
    );
    consoleError.mockRestore();
  });

  it("normalizes missing SQL abort reasons to user aborts", async () => {
    vi.mocked(getRunAbortState).mockResolvedValue({ aborted: true });
    let abortReason: unknown;

    const run = startRun(
      "run-sql-abort-default",
      "thread-sql-abort-default",
      async (_send, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              abortReason = signal.reason;
              resolve();
            },
            { once: true },
          );
        });
      },
      undefined,
      { softTimeoutMs: 0 },
    );

    await vi.advanceTimersByTimeAsync(1501);

    expect(abortReason).toBe("user");
    expect(run.abortReason).toBe("user");
  });

  it("closes SQL subscriptions cleanly for aborted runs without terminal events", async () => {
    vi.mocked(getRunById).mockResolvedValue({
      id: "run-sql-aborted",
      threadId: "thread-sql-aborted",
      status: "aborted",
      startedAt: Date.now(),
    });
    vi.mocked(getRunEventsSince).mockResolvedValue([]);

    const stream = subscribeToRun("run-sql-aborted", 0);
    expect(stream).not.toBeNull();
    const reader = stream!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    for (let i = 0; i < 5; i++) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(decoder.decode(next.value));
    }

    expect(chunks.join("")).toContain('data: {"type":"done","seq":0}');
    expect(getRunEventsSince).toHaveBeenCalledWith("run-sql-aborted", 0);
  });

  it("synthesizes done for completed SQL runs missing terminal events", async () => {
    vi.mocked(getRunById).mockResolvedValue({
      id: "run-sql-completed",
      threadId: "thread-sql-completed",
      status: "completed",
      startedAt: Date.now(),
    });
    vi.mocked(getRunEventsSince).mockResolvedValue([]);

    const stream = subscribeToRun("run-sql-completed", 0);
    expect(stream).not.toBeNull();
    const reader = stream!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    for (let i = 0; i < 5; i++) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(decoder.decode(next.value));
    }

    expect(chunks.join("")).toContain('data: {"type":"done","seq":0}');
  });

  it("returns recently-completed SQL runs from /runs/active so reconnect can replay them", async () => {
    // Memory miss — different isolate than the producer.
    // SQL has the run in completed status with a recent startedAt.
    vi.mocked(getRunByThread).mockResolvedValue({
      id: "run-recent-completed",
      threadId: "thread-recent",
      status: "completed",
      startedAt: Date.now() - 1000,
      heartbeatAt: Date.now() - 1000,
      completedAt: Date.now() - 500,
      lastProgressAt: Date.now() - 800,
    });

    const result = await getActiveRunForThreadAsync("thread-recent");

    expect(result).toMatchObject({
      runId: "run-recent-completed",
      threadId: "thread-recent",
      turnId: "run-recent-completed",
      status: "completed",
      heartbeatAt: expect.any(Number),
    });
    // Confirm we passed includeTerminal so SQL surfaced a non-running row.
    expect(getRunByThread).toHaveBeenCalledWith("thread-recent", {
      includeTerminal: true,
    });
  });

  it("ignores stale terminal runs older than the reconnect window", async () => {
    const completedAt = Date.now() - TERMINAL_RUN_RECONNECT_WINDOW_MS - 60_000;
    vi.mocked(getRunByThread).mockResolvedValue({
      id: "run-old-completed",
      threadId: "thread-old",
      status: "completed",
      startedAt: completedAt - 5_000,
      heartbeatAt: null,
      completedAt,
      lastProgressAt: null,
    });

    const result = await getActiveRunForThreadAsync("thread-old");

    expect(result).toBeNull();
  });

  it("uses completed_at (not started_at) for the reconnect window so long-running tasks are still reachable", async () => {
    // The run started long enough ago that it would fall outside the window
    // if we measured from startedAt — but it completed seconds ago, which is
    // when the user actually disconnected. A senior engineer reconnecting
    // here expects to replay the synthesized terminal events, not to retry
    // the POST.
    const startedAt = Date.now() - TERMINAL_RUN_RECONNECT_WINDOW_MS - 120_000;
    vi.mocked(getRunByThread).mockResolvedValue({
      id: "run-long-then-recent-complete",
      threadId: "thread-long",
      status: "completed",
      startedAt,
      heartbeatAt: Date.now() - 5_000,
      completedAt: Date.now() - 2_000,
      lastProgressAt: Date.now() - 5_000,
    });

    const result = await getActiveRunForThreadAsync("thread-long");

    expect(result).toMatchObject({
      runId: "run-long-then-recent-complete",
      status: "completed",
    });
  });

  it("falls back to heartbeat_at when completed_at is missing on legacy rows", async () => {
    // Older deployments may have terminal rows without a completed_at value.
    // The reconnect window should still work — fall back to the freshest
    // signal we have (heartbeat) before reaching for startedAt.
    vi.mocked(getRunByThread).mockResolvedValue({
      id: "run-legacy-no-completed-at",
      threadId: "thread-legacy",
      status: "errored",
      startedAt: Date.now() - TERMINAL_RUN_RECONNECT_WINDOW_MS - 120_000,
      heartbeatAt: Date.now() - 3_000,
      completedAt: null,
      lastProgressAt: null,
    });

    const result = await getActiveRunForThreadAsync("thread-legacy");

    expect(result).toMatchObject({
      runId: "run-legacy-no-completed-at",
      status: "errored",
    });
  });

  it("returns recently-errored SQL runs so the client can reconnect to the synthesized error", async () => {
    vi.mocked(getRunByThread).mockResolvedValue({
      id: "run-recent-errored",
      threadId: "thread-errored",
      status: "errored",
      startedAt: Date.now() - 1000,
      heartbeatAt: null,
      completedAt: Date.now() - 500,
      lastProgressAt: null,
    });

    const result = await getActiveRunForThreadAsync("thread-errored");

    expect(result).toMatchObject({
      runId: "run-recent-errored",
      status: "errored",
    });
  });

  it("synthesizes a friendly stale-run error for errored SQL runs missing terminal events and heals SQL", async () => {
    vi.mocked(getRunById).mockResolvedValue({
      id: "run-sql-errored",
      threadId: "thread-sql-errored",
      status: "errored",
      startedAt: Date.now(),
    });
    vi.mocked(getRunEventsSince).mockResolvedValue([]);
    vi.mocked(ensureTerminalRunEvent).mockClear();

    const stream = subscribeToRun("run-sql-errored", 0);
    expect(stream).not.toBeNull();
    const reader = stream!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    for (let i = 0; i < 5; i++) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(decoder.decode(next.value));
    }

    const output = chunks.join("");
    expect(output).toContain('"type":"error"');
    expect(output).toContain('"errorCode":"stale_run"');
    expect(output).toContain('"recoverable":true');
    // Self-heal: persist the synthesized terminal event back to SQL so future
    // reconnects replay it normally instead of regenerating it each time.
    expect(ensureTerminalRunEvent).toHaveBeenCalledWith(
      "run-sql-errored",
      expect.objectContaining({ errorCode: "stale_run" }),
    );
  });

  it("still streams the synthesized stale-run error when persistence to SQL fails", async () => {
    vi.mocked(getRunById).mockResolvedValue({
      id: "run-sql-errored-persist-fail",
      threadId: "thread-persist-fail",
      status: "errored",
      startedAt: Date.now(),
    });
    vi.mocked(getRunEventsSince).mockResolvedValue([]);
    vi.mocked(ensureTerminalRunEvent).mockRejectedValueOnce(
      new Error("DB unavailable"),
    );

    const stream = subscribeToRun("run-sql-errored-persist-fail", 0);
    expect(stream).not.toBeNull();
    const reader = stream!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    for (let i = 0; i < 5; i++) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(decoder.decode(next.value));
    }

    const output = chunks.join("");
    expect(output).toContain('"errorCode":"stale_run"');
  });

  // Fix 1a/b: zombie self-abort — run whose row was reaped must self-abort
  it("self-aborts and does not overwrite status when the SQL row is no longer running", async () => {
    // Simulate a run that gets reaped mid-execution: the SQL row flips to
    // 'errored' after the heartbeat interval fires and checkSqlAbort reads it.
    vi.mocked(getRunStatus).mockResolvedValueOnce("errored");

    let abortFired = false;
    const run = startRun(
      "run-zombie-reap",
      "thread-zombie-reap",
      async (_send, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            abortFired = true;
            resolve();
          });
        });
      },
      undefined,
      { softTimeoutMs: 0 },
    );

    // Advance past the 3s checkSqlAbort threshold
    await vi.advanceTimersByTimeAsync(3001);

    expect(abortFired).toBe(true);
    // The zombie must NOT have written a terminal status on top of the reaper's
    // 'errored' write — the conditional updateRunStatusIfRunning call should
    // have been skipped because the run was aborted (status="aborted").
    expect(run.abortReason).toBe("displaced");
  });

  it("uses a conditional WHERE status=running write so a reaped row is not overwritten", async () => {
    // Simulate the reaper having flipped the row to 'errored'. The zombie's
    // own terminal write must use updateRunStatusIfRunning (WHERE id=? AND
    // status='running') so it is a no-op when the row is already errored.
    // The mock returns false (rowsAffected=0) to simulate the row being gone.
    vi.mocked(updateRunStatusIfRunning).mockResolvedValue(false);
    vi.mocked(getRunStatus).mockResolvedValue("errored");

    startRun(
      "run-no-clobber",
      "thread-no-clobber",
      async (_send, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve());
        });
      },
      undefined,
      { softTimeoutMs: 0 },
    );

    await vi.advanceTimersByTimeAsync(3001);
    // Wait for the run to finish winding down (status flips to aborted)
    await vi.waitFor(() => expect(updateRunStatusIfRunning).toHaveBeenCalled());
    // The unconditional updateRunStatus must NOT have been called — only the
    // guarded conditional variant is allowed on the terminal status write path.
    expect(updateRunStatus).not.toHaveBeenCalledWith(
      "run-no-clobber",
      expect.anything(),
    );
  });

  // Fix 3: ordered event persistence
  it("chains event persistence so inserts commit in seq order", async () => {
    const persistOrder: number[] = [];
    let resolveSeq0!: () => void;
    const seq0Barrier = new Promise<void>((r) => {
      resolveSeq0 = r;
    });

    vi.mocked(insertRunEvent).mockImplementation(async (_runId, seq) => {
      if (seq === 0) {
        // seq=0 is intentionally slow
        await seq0Barrier;
      }
      persistOrder.push(seq);
    });

    const run = startRun(
      "run-persist-order",
      "thread-persist-order",
      async (send) => {
        send({ type: "text", text: "first" }); // seq 0
        send({ type: "text", text: "second" }); // seq 1
      },
      undefined,
      { softTimeoutMs: 0 },
    );
    run.subscribers.add(() => {});

    // Let the run complete; seq=1 insert would normally beat seq=0 without the chain
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // seq=1 must not have committed yet because seq=0 is still pending
    expect(persistOrder).not.toContain(1);

    // Release seq=0 — seq=1 should follow
    resolveSeq0();
    await vi.waitFor(() => expect(persistOrder).toContain(1));

    // Order must be preserved: seq=0 before seq=1
    expect(persistOrder.indexOf(0)).toBeLessThan(persistOrder.indexOf(1));
  });
});
