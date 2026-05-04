import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentChatEvent } from "./types.js";

vi.mock("./run-store.js", () => ({
  insertRun: vi.fn(() => Promise.resolve()),
  insertRunEvent: vi.fn(() => Promise.resolve()),
  updateRunStatus: vi.fn(() => Promise.resolve()),
  markRunAborted: vi.fn(() => Promise.resolve()),
  isRunAborted: vi.fn(() => Promise.resolve(false)),
  getRunEventsSince: vi.fn(() => Promise.resolve([])),
  getRunById: vi.fn(() => Promise.resolve(null)),
  getRunByThread: vi.fn(() => Promise.resolve(null)),
  cleanupOldRuns: vi.fn(() => Promise.resolve()),
  updateRunHeartbeat: vi.fn(() => Promise.resolve()),
  reapIfStale: vi.fn(() => Promise.resolve(null)),
}));

const enqueueRunContinuationMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve()),
);
const countRecentRunContinuationsForThreadMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve(0)),
);
const dispatchRunContinuationMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve()),
);

vi.mock("../run-continuations/store.js", () => ({
  enqueueRunContinuation: enqueueRunContinuationMock,
  countRecentRunContinuationsForThread:
    countRecentRunContinuationsForThreadMock,
}));

vi.mock("../run-continuations/dispatch.js", () => ({
  dispatchRunContinuation: dispatchRunContinuationMock,
}));

import { resolveRunSoftTimeoutMs, startRun } from "./run-manager.js";

const originalTimeoutEnv = process.env.AGENT_RUN_SOFT_TIMEOUT_MS;
const originalNetlify = process.env.NETLIFY;
const originalNetlifyLocal = process.env.NETLIFY_LOCAL;
const originalCfPages = process.env.CF_PAGES;
const originalVercel = process.env.VERCEL;
const originalVercelEnv = process.env.VERCEL_ENV;
const originalRender = process.env.RENDER;
const originalFlyAppName = process.env.FLY_APP_NAME;

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

const originalAutoContinuation = process.env.AGENT_AUTO_CONTINUATION;

describe("run manager soft timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete process.env.AGENT_RUN_SOFT_TIMEOUT_MS;
    delete process.env.NETLIFY;
    delete process.env.NETLIFY_LOCAL;
    delete process.env.CF_PAGES;
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.RENDER;
    delete process.env.FLY_APP_NAME;
    delete process.env.AGENT_AUTO_CONTINUATION;
    enqueueRunContinuationMock.mockClear();
    countRecentRunContinuationsForThreadMock.mockClear();
    countRecentRunContinuationsForThreadMock.mockResolvedValue(0);
    dispatchRunContinuationMock.mockClear();
  });

  afterEach(() => {
    restoreEnv("AGENT_RUN_SOFT_TIMEOUT_MS", originalTimeoutEnv);
    restoreEnv("NETLIFY", originalNetlify);
    restoreEnv("NETLIFY_LOCAL", originalNetlifyLocal);
    restoreEnv("CF_PAGES", originalCfPages);
    restoreEnv("VERCEL", originalVercel);
    restoreEnv("VERCEL_ENV", originalVercelEnv);
    restoreEnv("RENDER", originalRender);
    restoreEnv("FLY_APP_NAME", originalFlyAppName);
    restoreEnv("AGENT_AUTO_CONTINUATION", originalAutoContinuation);
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

  it("does not impose a hosted default on serverless deploys", () => {
    process.env.NETLIFY = "true";

    expect(resolveRunSoftTimeoutMs()).toBe(0);
  });

  it("treats Netlify local as a local runtime", () => {
    process.env.NETLIFY = "true";
    process.env.NETLIFY_LOCAL = "true";

    expect(resolveRunSoftTimeoutMs()).toBe(0);
  });

  it("allows the environment to disable hosted soft timeouts", () => {
    process.env.NETLIFY = "true";
    process.env.AGENT_RUN_SOFT_TIMEOUT_MS = "0";

    expect(resolveRunSoftTimeoutMs()).toBe(0);
  });

  // Helper for the auto-continuation suite below: drives the run to its
  // soft-timeout abort, then awaits the .finally() chain so the post-status
  // enqueue logic has a chance to run. Returns the run handle.
  async function startTimedOutRun(
    opts: {
      runId?: string;
      threadId?: string;
      ownerEmail?: string;
      orgId?: string | null;
    } = {},
  ) {
    const run = startRun(
      opts.runId ?? "run-x",
      opts.threadId ?? "thread-x",
      async (_send, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve());
        });
      },
      undefined,
      {
        softTimeoutMs: 10,
        ownerEmail: opts.ownerEmail,
        orgId: opts.orgId ?? null,
      },
    );
    await vi.advanceTimersByTimeAsync(11);
    // Two extra ticks let the .finally() chain (await onComplete, await
    // updateRunStatus, await enqueueRunContinuation) all settle before we
    // assert against the mocks.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    return run;
  }

  it("enqueues a continuation when soft timeout fires and ownerEmail is provided", async () => {
    await startTimedOutRun({
      threadId: "thread-cont",
      ownerEmail: "alice+qa@agent-native.test",
      orgId: "org-1",
    });

    expect(enqueueRunContinuationMock).toHaveBeenCalledTimes(1);
    expect(enqueueRunContinuationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-cont",
        ownerEmail: "alice+qa@agent-native.test",
        orgId: "org-1",
        parentRunId: "run-x",
      }),
    );
    expect(dispatchRunContinuationMock).toHaveBeenCalledTimes(1);
  });

  it("does not enqueue when ownerEmail is missing", async () => {
    await startTimedOutRun({ threadId: "thread-noowner" });

    expect(enqueueRunContinuationMock).not.toHaveBeenCalled();
    expect(dispatchRunContinuationMock).not.toHaveBeenCalled();
  });

  it("does not enqueue when AGENT_AUTO_CONTINUATION=false", async () => {
    process.env.AGENT_AUTO_CONTINUATION = "false";

    await startTimedOutRun({
      threadId: "thread-killswitch",
      ownerEmail: "alice+qa@agent-native.test",
    });

    expect(enqueueRunContinuationMock).not.toHaveBeenCalled();
    expect(dispatchRunContinuationMock).not.toHaveBeenCalled();
  });

  it("does not enqueue past the cascade limit (3 in 10 minutes)", async () => {
    countRecentRunContinuationsForThreadMock.mockResolvedValue(3);

    await startTimedOutRun({
      threadId: "thread-cascade",
      ownerEmail: "alice+qa@agent-native.test",
    });

    expect(enqueueRunContinuationMock).not.toHaveBeenCalled();
    expect(dispatchRunContinuationMock).not.toHaveBeenCalled();
  });

  it("does not enqueue when the run completed normally (no soft timeout)", async () => {
    const run = startRun(
      "run-normal",
      "thread-normal",
      async (_send, _signal) => {
        // Resolve immediately — no soft timeout, no abort.
      },
      undefined,
      {
        softTimeoutMs: 10,
        ownerEmail: "alice+qa@agent-native.test",
      },
    );
    // Allow the .finally() chain to settle.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(run.status).toBe("completed");

    expect(enqueueRunContinuationMock).not.toHaveBeenCalled();
  });
});
