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

import {
  abortRun,
  DEFAULT_HOSTED_RUN_SOFT_TIMEOUT_MS,
  resolveRunSoftTimeoutMs,
  startRun,
} from "./run-manager.js";

const originalTimeoutEnv = process.env.AGENT_RUN_SOFT_TIMEOUT_MS;
const originalNetlify = process.env.NETLIFY;
const originalNetlifyLocal = process.env.NETLIFY_LOCAL;
const originalCfPages = process.env.CF_PAGES;
const originalVercel = process.env.VERCEL;
const originalVercelEnv = process.env.VERCEL_ENV;
const originalRender = process.env.RENDER;
const originalFlyAppName = process.env.FLY_APP_NAME;
const originalKService = process.env.K_SERVICE;

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

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
    delete process.env.K_SERVICE;
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
    restoreEnv("K_SERVICE", originalKService);
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

  it("uses a hosted default on serverless deploys", () => {
    process.env.NETLIFY = "true";

    expect(resolveRunSoftTimeoutMs()).toBe(DEFAULT_HOSTED_RUN_SOFT_TIMEOUT_MS);
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

  it("retires explicitly aborted in-memory runs without completing them", async () => {
    const onComplete = vi.fn();
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

    expect(abortRun("run-explicit-abort")).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(run.status).toBe("aborted");
    expect(run.events).toHaveLength(0);
    expect(onComplete).not.toHaveBeenCalled();
  });
});
