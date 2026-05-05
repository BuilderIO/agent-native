import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentChatEvent } from "./types.js";

vi.mock("./run-store.js", () => ({
  insertRun: vi.fn(() => Promise.resolve()),
  insertRunEvent: vi.fn(() => Promise.resolve()),
  updateRunStatus: vi.fn(() => Promise.resolve()),
  markRunAborted: vi.fn(() => Promise.resolve()),
  isRunAborted: vi.fn(() => Promise.resolve(false)),
  getRunAbortState: vi.fn(() => Promise.resolve({ aborted: false })),
  getRunEventsSince: vi.fn(() => Promise.resolve([])),
  getRunById: vi.fn(() => Promise.resolve(null)),
  getRunByThread: vi.fn(() => Promise.resolve(null)),
  cleanupOldRuns: vi.fn(() => Promise.resolve()),
  updateRunHeartbeat: vi.fn(() => Promise.resolve()),
  reapIfStale: vi.fn(() => Promise.resolve(null)),
}));

import {
  abortRun,
  DEFAULT_HOSTED_RUN_SOFT_TIMEOUT_MS,
  resolveRunSoftTimeoutMs,
  startRun,
  subscribeToRun,
} from "./run-manager.js";
import {
  getRunAbortState,
  getRunById,
  getRunEventsSince,
  markRunAborted,
} from "./run-store.js";

const originalTimeoutEnv = process.env.AGENT_RUN_SOFT_TIMEOUT_MS;
const originalNetlify = process.env.NETLIFY;
const originalNetlifyLocal = process.env.NETLIFY_LOCAL;
const originalCfPages = process.env.CF_PAGES;
const originalVercel = process.env.VERCEL;
const originalVercelEnv = process.env.VERCEL_ENV;
const originalRender = process.env.RENDER;
const originalFlyAppName = process.env.FLY_APP_NAME;
const originalKService = process.env.K_SERVICE;

function clearHostedEnvForTest() {
  delete process.env.AGENT_RUN_SOFT_TIMEOUT_MS;
  delete process.env.NETLIFY;
  delete process.env.NETLIFY_LOCAL;
  delete process.env.CF_PAGES;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.RENDER;
  delete process.env.FLY_APP_NAME;
  delete process.env.K_SERVICE;
}

function restoreHostedEnvAfterTest() {
  if (originalTimeoutEnv === undefined)
    delete process.env.AGENT_RUN_SOFT_TIMEOUT_MS;
  else process.env.AGENT_RUN_SOFT_TIMEOUT_MS = originalTimeoutEnv;
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
}

describe("run manager soft timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearHostedEnvForTest();
    vi.mocked(getRunAbortState).mockResolvedValue({ aborted: false });
    vi.mocked(getRunById).mockResolvedValue(null);
    vi.mocked(getRunEventsSince).mockResolvedValue([]);
    vi.mocked(markRunAborted).mockClear();
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
});
