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

import { resolveRunSoftTimeoutMs, startRun } from "./run-manager.js";

const originalTimeoutEnv = process.env.AGENT_RUN_SOFT_TIMEOUT_MS;

describe("run manager soft timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete process.env.AGENT_RUN_SOFT_TIMEOUT_MS;
  });

  afterEach(() => {
    if (originalTimeoutEnv === undefined) {
      delete process.env.AGENT_RUN_SOFT_TIMEOUT_MS;
    } else {
      process.env.AGENT_RUN_SOFT_TIMEOUT_MS = originalTimeoutEnv;
    }
    vi.useRealTimers();
  });

  it("emits a recoverable timeout error and aborts the run", async () => {
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
        type: "error",
        errorCode: "run_timeout",
        recoverable: true,
      }),
    );
    expect(run.status).toBe("errored");
  });

  it("prefers an explicit soft timeout over the environment default", () => {
    process.env.AGENT_RUN_SOFT_TIMEOUT_MS = "25000";

    expect(resolveRunSoftTimeoutMs(5000)).toBe(5000);
  });
});
