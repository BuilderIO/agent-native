import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BACKGROUND_SOFT_TIMEOUT_CEILING_MS,
  BACKGROUND_AUTOMATION_SOFT_TIMEOUT_HEADROOM_MS,
  RUN_NO_PROGRESS_HARD_TIMEOUT_MS,
} from "../app-config/run-lifecycle-invariants.js";
import {
  LLM_MISSING_CREDENTIALS_ERROR_CODE,
  LLM_MISSING_CREDENTIALS_MESSAGE,
} from "./engine/credential-errors.js";
import { EngineError } from "./engine/types.js";
import type { AgentChatEvent } from "./types.js";

const RUN_RECORD_MISSING_ERROR_CODE = "run_record_missing";
const UNKNOWN_RUN_STATUS_ERROR_CODE = "unknown_run_status";
const RUN_TERMINAL_LOOKUP_FAILED_ERROR_CODE = "run_terminal_lookup_failed";

const runStoreTestState = vi.hoisted(() => ({ runRecordMissingGraceMs: 0 }));

vi.mock("./run-store.js", () => ({
  RUN_RECORD_MISSING_ERROR_EVENT: {
    type: "error",
    error:
      "The agent run record is no longer available, so this turn could not be confirmed as finished. Retry if the result is missing.",
    errorCode: "run_record_missing",
    recoverable: true,
  },
  UNKNOWN_RUN_STATUS_ERROR_EVENT: {
    type: "error",
    error:
      "The agent run ended in a state this app does not recognize, so the result could not be confirmed. Retry if the result is missing.",
    errorCode: "unknown_run_status",
    recoverable: true,
  },
  RUN_TERMINAL_LOOKUP_FAILED_ERROR_EVENT: {
    type: "error",
    error:
      "The agent run's final state could not be read, so this turn could not be confirmed as finished. Retry if the result is missing.",
    errorCode: "run_terminal_lookup_failed",
    recoverable: true,
  },
  get RUN_RECORD_MISSING_GRACE_MS() {
    return runStoreTestState.runRecordMissingGraceMs;
  },
  insertRun: vi.fn(() => Promise.resolve()),
  insertRunEvent: vi.fn(() => Promise.resolve()),
  updateRunStatus: vi.fn(() => Promise.resolve()),
  updateRunStatusIfRunning: vi.fn(() => Promise.resolve(true)),
  getRunStatus: vi.fn(() => Promise.resolve("running")),
  tryClaimRunSlot: vi.fn(() =>
    Promise.resolve({ claimed: true, activeRunId: null }),
  ),
  markRunAborted: vi.fn(() => Promise.resolve()),
  markTurnAborted: vi.fn(() => Promise.resolve()),
  isRunAborted: vi.fn(() => Promise.resolve(false)),
  getRunAbortState: vi.fn(() => Promise.resolve({ aborted: false })),
  getRunEventsSince: vi.fn(() => Promise.resolve([])),
  getCurrentTurnEventsForThread: vi.fn(() => Promise.resolve([])),
  getCurrentTurnRunEventsForThread: vi.fn(() => Promise.resolve([])),
  getRunById: vi.fn(() => Promise.resolve(null)),
  isContinuationTerminalReason: (reason: unknown) =>
    reason === "auto_continue" ||
    reason === "run_timeout" ||
    reason === "loop_limit" ||
    reason === "max_tokens" ||
    reason === "stream_ended" ||
    reason === "gateway_timeout" ||
    reason === "network_interrupted" ||
    reason === "no_progress",
  getRunByThread: vi.fn(() => Promise.resolve(null)),
  cleanupOldRuns: vi.fn(() => Promise.resolve()),
  updateRunHeartbeat: vi.fn(() => Promise.resolve()),
  bumpRunProgress: vi.fn(() => Promise.resolve()),
  setRunInFlightMarker: vi.fn(() => Promise.resolve()),
  reapIfStale: vi.fn(() => Promise.resolve(null)),
  reapUnclaimedBackgroundRun: vi.fn(() => Promise.resolve(false)),
  UNCLAIMED_BACKGROUND_RUN_REDISPATCH_BOUND_MS: 5 * 60_000,
  shouldRedispatchUnclaimedBackgroundRun: (
    row: { startedAt: number },
    now: number = Date.now(),
  ) => now - row.startedAt < 5 * 60_000,
  reconcileTerminalRunFromEvents: vi.fn(() => Promise.resolve(false)),
  ensureTerminalRunEvent: vi.fn(() => Promise.resolve()),
  getLastTerminalRunEvent: vi.fn(() => Promise.resolve(null)),
  resolveErroredRunTerminalEvent: vi.fn((run) => {
    const code = typeof run?.errorCode === "string" ? run.errorCode.trim() : "";
    const detail =
      typeof run?.errorDetail === "string" ? run.errorDetail.trim() : "";
    if (detail || (code && code !== "unknown")) {
      return {
        event: {
          type: "error",
          error: detail || "The agent run failed.",
          ...(code && code !== "unknown" ? { errorCode: code } : {}),
        },
        shouldPersist: true,
      };
    }
    return {
      event: {
        type: "error",
        error:
          "The agent stopped before it could finish. It may have hit a server timeout or the worker may have been interrupted.",
        errorCode: "stale_run",
        recoverable: true,
        details:
          "The run heartbeat stopped while the run was still marked running. Partial output and tool calls were preserved when available.",
      },
      shouldPersist: true,
    };
  }),
  setRunError: vi.fn(() => Promise.resolve()),
  setRunTerminalReason: vi.fn(() => Promise.resolve()),
  persistRunCheckpointEvent: vi.fn(() => Promise.resolve()),
  recordRunDiagnostic: vi.fn(() => Promise.resolve()),
  RUN_DIAG_STAGE: { runBoundaryReached: "run_boundary_reached" },
  terminalEventForAbortReason: (reason: string | undefined) => {
    const normalized = (reason ?? "").trim() || "user";
    if (
      [
        "auto_continue",
        "run_timeout",
        "loop_limit",
        "max_tokens",
        "no_progress",
        "stream_ended",
        "gateway_timeout",
        "network_interrupted",
      ].includes(normalized)
    ) {
      return { type: "auto_continue", reason: normalized };
    }
    if (
      normalized === "user" ||
      normalized === "displaced" ||
      normalized.startsWith("user_")
    ) {
      return { type: "done" };
    }
    return {
      type: "error",
      error: "The agent run was stopped before it finished.",
      errorCode: `aborted_${normalized}`,
      recoverable: normalized === "background_worker_died",
    };
  },
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

vi.mock("../tracking/registry.js", () => ({
  track: vi.fn(),
}));
vi.mock("../observability/tracking-identity.js", () => ({
  trackingIdentityProperties: vi.fn(() => ({ app: "test-app" })),
}));

import { registerErrorCaptureProvider } from "../server/capture-error.js";
import { track } from "../tracking/registry.js";
import { isInBackgroundFunctionRuntime } from "./durable-background.js";
import {
  abortRun,
  abortRunDurably,
  abortTurnByRefDurably,
  engineRequestShapeTags,
  DEFAULT_BACKGROUND_NO_PROGRESS_TIMEOUT_MS,
  DEFAULT_COMPLETED_RUN_RETENTION_MS,
  DEFAULT_ERRORED_RUN_RETENTION_MS,
  DEFAULT_HOSTED_RUN_SOFT_TIMEOUT_MS,
  HOSTED_SOFT_TIMEOUT_CEILING_MS,
  resolveRunNoProgressTimeoutMs,
  resolveRunToolTimeoutCeilingMs,
  getActiveRunForThreadAsync,
  getRun,
  IN_MEMORY_TERMINAL_SETTLE_MS,
  resolveCompletedRunRetentionMs,
  resolveErroredRunRetentionMs,
  resolveRunSoftTimeoutMs,
  replayCompletedTurn,
  nextSqlSubscriptionEmptyPolls,
  resolveSqlSubscriptionPollMs,
  resolveSqlSubscriptionRetryMs,
  startRun,
  subscribeToRun,
  SQL_SUBSCRIPTION_ACTIVE_POLL_MS,
  SQL_SUBSCRIPTION_IDLE_DECAY_AFTER_POLLS,
  SQL_SUBSCRIPTION_IDLE_MAX_POLL_MS,
  SQL_SUBSCRIPTION_IDLE_POLL_MS,
  SQL_SUBSCRIPTION_MAX_CONSECUTIVE_FAILURES,
  SQL_SUBSCRIPTION_RETRY_BASE_MS,
  TERMINAL_RUN_RECONNECT_WINDOW_MS,
  type ActiveRun,
} from "./run-manager.js";
import {
  getRunAbortState,
  getRunStatus,
  insertRun,
  insertRunEvent,
  getRunById,
  getRunByThread,
  getRunEventsSince,
  getCurrentTurnRunEventsForThread,
  markRunAborted,
  markTurnAborted,
  updateRunStatus,
  updateRunStatusIfRunning,
  ensureTerminalRunEvent,
  getLastTerminalRunEvent,
  cleanupOldRuns,
  bumpRunProgress,
  setRunError,
  setRunTerminalReason,
  reapIfStale,
  reapUnclaimedBackgroundRun,
  reconcileTerminalRunFromEvents,
  persistRunCheckpointEvent,
  setRunInFlightMarker,
} from "./run-store.js";

const originalTimeoutEnv = process.env.AGENT_RUN_SOFT_TIMEOUT_MS;
const originalRetentionEnv = process.env.AGENT_RUN_RETENTION_MS;
const originalErroredRetentionEnv = process.env.AGENT_ERRORED_RUN_RETENTION_MS;
const originalNetlify = process.env.NETLIFY;
const originalNetlifyLocal = process.env.NETLIFY_LOCAL;
const originalSiteId = process.env.SITE_ID; // guard:allow-env-credential -- Netlify's read-only public site identifier is a runtime host marker, not a user credential.
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
  delete process.env.SITE_ID; // guard:allow-env-credential -- tests isolate Netlify's public runtime host marker.
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
  if (originalSiteId === undefined)
    delete process.env.SITE_ID; // guard:allow-env-credential -- tests restore Netlify's public runtime host marker.
  else process.env.SITE_ID = originalSiteId; // guard:allow-env-credential -- tests restore Netlify's public runtime host marker.
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
    runStoreTestState.runRecordMissingGraceMs = 0;
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
    vi.mocked(bumpRunProgress).mockClear();
    vi.mocked(setRunError).mockClear();
    vi.mocked(setRunTerminalReason).mockClear();
    vi.mocked(persistRunCheckpointEvent).mockReset();
    vi.mocked(persistRunCheckpointEvent).mockResolvedValue(undefined);
    vi.mocked(reapUnclaimedBackgroundRun).mockReset();
    vi.mocked(reapUnclaimedBackgroundRun).mockResolvedValue(false);
    vi.mocked(reapIfStale).mockReset();
    vi.mocked(reapIfStale).mockResolvedValue(null as any);
    vi.mocked(reconcileTerminalRunFromEvents).mockReset();
    vi.mocked(reconcileTerminalRunFromEvents).mockResolvedValue(false);
    vi.mocked(track).mockClear();
  });

  afterEach(() => {
    restoreHostedEnvAfterTest();
    vi.useRealTimers();
  });

  it("uses the active SQL subscription cadence only inside the active polling window", () => {
    expect(resolveSqlSubscriptionPollMs(1_000, 1_001)).toBe(
      SQL_SUBSCRIPTION_ACTIVE_POLL_MS,
    );
    expect(resolveSqlSubscriptionPollMs(1_000, 1_000)).toBe(
      SQL_SUBSCRIPTION_IDLE_POLL_MS,
    );
    expect(resolveSqlSubscriptionPollMs(1_000, 999)).toBe(
      SQL_SUBSCRIPTION_IDLE_POLL_MS,
    );
  });

  it("holds the idle cadence until the decay threshold, then backs off to the cap", () => {
    for (let n = 0; n <= SQL_SUBSCRIPTION_IDLE_DECAY_AFTER_POLLS; n += 1) {
      expect(resolveSqlSubscriptionPollMs(1_000, 999, n)).toBe(
        SQL_SUBSCRIPTION_IDLE_POLL_MS,
      );
    }

    expect(
      resolveSqlSubscriptionPollMs(
        1_000,
        999,
        SQL_SUBSCRIPTION_IDLE_DECAY_AFTER_POLLS + 1,
      ),
    ).toBe(SQL_SUBSCRIPTION_IDLE_POLL_MS * 2);

    expect(resolveSqlSubscriptionPollMs(1_000, 999, 500)).toBe(
      SQL_SUBSCRIPTION_IDLE_MAX_POLL_MS,
    );
    expect(
      resolveSqlSubscriptionPollMs(1_000, 999, Number.MAX_SAFE_INTEGER),
    ).toBe(SQL_SUBSCRIPTION_IDLE_MAX_POLL_MS);
  });

  it("counts only idle polls toward the decay ladder", () => {
    expect(nextSqlSubscriptionEmptyPolls(9, true, 1_000, 0)).toBe(0);
    expect(nextSqlSubscriptionEmptyPolls(9, true, 1_000, 5_000)).toBe(0);

    expect(nextSqlSubscriptionEmptyPolls(3, false, 1_000, 5_000)).toBe(3);
    expect(nextSqlSubscriptionEmptyPolls(0, false, 1_000, 1_001)).toBe(0);

    expect(nextSqlSubscriptionEmptyPolls(3, false, 1_000, 1_000)).toBe(4);
    expect(nextSqlSubscriptionEmptyPolls(3, false, 1_000, 0)).toBe(4);
  });

  it("resumes at the idle cadence, not the cap, after a brief mid-stream pause", () => {
    let empties = 0;
    const activeUntil = 2_000;
    for (const now of [125, 250, 375, 500, 1_000, 1_500, 1_999]) {
      empties = nextSqlSubscriptionEmptyPolls(empties, false, now, activeUntil);
    }
    expect(empties).toBe(0);
    expect(resolveSqlSubscriptionPollMs(2_000, activeUntil, empties)).toBe(
      SQL_SUBSCRIPTION_IDLE_POLL_MS,
    );
  });

  it("never decays while the active polling window is open", () => {
    expect(resolveSqlSubscriptionPollMs(1_000, 1_001, 999)).toBe(
      SQL_SUBSCRIPTION_ACTIVE_POLL_MS,
    );
  });

  it("uses bounded exponential backoff for SQL subscription retries", () => {
    expect(resolveSqlSubscriptionRetryMs(1)).toBe(
      SQL_SUBSCRIPTION_RETRY_BASE_MS,
    );
    expect(resolveSqlSubscriptionRetryMs(2)).toBe(
      SQL_SUBSCRIPTION_RETRY_BASE_MS * 2,
    );
    expect(resolveSqlSubscriptionRetryMs(3)).toBe(
      SQL_SUBSCRIPTION_RETRY_BASE_MS * 4,
    );
    expect(resolveSqlSubscriptionRetryMs(100)).toBe(2_000);
  });

  it("registers the run with the explicit request waitUntil callback", () => {
    const waitUntil = vi.fn();

    startRun(
      "run-request-wait-until",
      "thread-request-wait-until",
      async () => {},
      undefined,
      { waitUntil },
    );

    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
  });

  it("emits an internal continuation signal and aborts the run chunk", async () => {
    const events: AgentChatEvent[] = [];
    let aborted = false;
    let abortReason: unknown;

    const run = startRun(
      "run-soft-timeout",
      "thread-soft-timeout",
      async (_send, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            abortReason = signal.reason;
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
    expect(abortReason).toBe("run_timeout");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "auto_continue",
        reason: "run_timeout",
      }),
    );
    expect(run.status).toBe("completed");
    await vi.waitFor(() =>
      expect(setRunTerminalReason).toHaveBeenCalledWith(
        "run-soft-timeout",
        "run_timeout",
      ),
    );
  });

  it("persists a soft-timeout chunk as `truncated`, never as `completed`", async () => {
    startRun(
      "run-truncated-status",
      "thread-truncated-status",
      async (_send, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve());
        });
      },
      undefined,
      { softTimeoutMs: 10 },
    );

    await vi.advanceTimersByTimeAsync(11);

    await vi.waitFor(() =>
      expect(updateRunStatusIfRunning).toHaveBeenCalledWith(
        "run-truncated-status",
        "truncated",
      ),
    );
    expect(updateRunStatusIfRunning).not.toHaveBeenCalledWith(
      "run-truncated-status",
      "completed",
    );
  });

  it("makes the chunk boundary durable when the soft timeout fires, not after the unwind", async () => {
    let unwound = false;
    let releaseCheckpoint!: () => void;
    vi.mocked(persistRunCheckpointEvent).mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseCheckpoint = resolve)),
    );
    startRun(
      "run-durable-checkpoint",
      "thread-durable-checkpoint",
      async (_send, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            unwound = true;
            resolve();
          });
        });
      },
      undefined,
      { softTimeoutMs: 10 },
    );

    await vi.advanceTimersByTimeAsync(11);

    expect(unwound).toBe(false);
    expect(persistRunCheckpointEvent).toHaveBeenCalledWith(
      "run-durable-checkpoint",
      { type: "auto_continue", reason: "run_timeout" },
      "run_timeout",
    );
    releaseCheckpoint();
    await vi.advanceTimersByTimeAsync(0);
    expect(unwound).toBe(true);
  });

  it("persists the terminal auto_continue with a unique seq when the run emits events after the soft timeout", async () => {
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

    const terminalPersists = persisted.filter(
      (e) => e.type === "auto_continue",
    );
    expect(terminalPersists).toHaveLength(1);
    const terminalSeq = terminalPersists[0].seq;
    const collisions = persisted.filter(
      (e) => e.seq === terminalSeq && e.type !== "auto_continue",
    );
    expect(collisions).toHaveLength(0);
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

  it("uses a hosted default with Netlify's runtime-only SITE_ID", () => {
    process.env.SITE_ID = "00000000-0000-0000-0000-000000000000"; // guard:allow-env-credential -- fake value exercises Netlify's public runtime host marker.

    expect(resolveRunSoftTimeoutMs(undefined, { useHostedDefault: true })).toBe(
      DEFAULT_HOSTED_RUN_SOFT_TIMEOUT_MS,
    );
  });

  it("keeps SITE_ID local under netlify dev", () => {
    process.env.SITE_ID = "00000000-0000-0000-0000-000000000000"; // guard:allow-env-credential -- fake value exercises Netlify's public runtime host marker.
    process.env.NETLIFY_LOCAL = "true";

    expect(resolveRunSoftTimeoutMs(undefined, { useHostedDefault: true })).toBe(
      0,
    );
  });

  it("lets NETLIFY=false roll back SITE_ID hosted detection", () => {
    process.env.SITE_ID = "00000000-0000-0000-0000-000000000000"; // guard:allow-env-credential -- fake value exercises Netlify's public runtime host marker.
    process.env.NETLIFY = "false";

    expect(resolveRunSoftTimeoutMs(undefined, { useHostedDefault: true })).toBe(
      0,
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


  it("FOREGROUND hosted run still clamps to the 40s interactive ceiling (guardrail)", () => {
    process.env.NETLIFY = "true";
    expect(resolveRunSoftTimeoutMs(240_000)).toBe(
      HOSTED_SOFT_TIMEOUT_CEILING_MS,
    );
    expect(HOSTED_SOFT_TIMEOUT_CEILING_MS).toBe(40_000);
  });

  it("BACKGROUND hosted run uses the host-natural ~13min budget by default", () => {
    process.env.NETLIFY = "true";
    expect(
      resolveRunSoftTimeoutMs(undefined, { backgroundFunction: true }),
    ).toBe(BACKGROUND_SOFT_TIMEOUT_CEILING_MS);
    expect(BACKGROUND_SOFT_TIMEOUT_CEILING_MS).toBeGreaterThan(
      HOSTED_SOFT_TIMEOUT_CEILING_MS,
    );
  });

  it("BACKGROUND hosted run clamps to the 13min ceiling, NOT the 40s one", () => {
    process.env.NETLIFY = "true";
    const resolved = resolveRunSoftTimeoutMs(60 * 60_000, {
      backgroundFunction: true,
    });
    expect(resolved).toBe(BACKGROUND_SOFT_TIMEOUT_CEILING_MS);
    expect(resolved).toBeGreaterThan(HOSTED_SOFT_TIMEOUT_CEILING_MS);
  });

  it("BACKGROUND override below the ceiling is honored as-is on hosted", () => {
    process.env.NETLIFY = "true";
    expect(
      resolveRunSoftTimeoutMs(5 * 60_000, { backgroundFunction: true }),
    ).toBe(5 * 60_000);
  });

  it("BACKGROUND on a non-hosted (long-lived) runtime is effectively unbounded (0)", () => {
    expect(
      resolveRunSoftTimeoutMs(undefined, { backgroundFunction: true }),
    ).toBe(0);
  });

  function resolveForWorker(opts: {
    isBackgroundWorker: boolean;
    overrideMs?: number;
  }): number {
    const runsInBackgroundFunction =
      opts.isBackgroundWorker && isInBackgroundFunctionRuntime();
    return resolveRunSoftTimeoutMs(opts.overrideMs, {
      useHostedDefault: true,
      backgroundFunction: runsInBackgroundFunction,
    });
  }

  it("FOREGROUND POST (not a worker) uses the 40s hosted default regardless of function name", () => {
    process.env.NETLIFY = "true";
    process.env.AWS_LAMBDA_FUNCTION_NAME = "server";
    expect(resolveForWorker({ isBackgroundWorker: false })).toBe(
      DEFAULT_HOSTED_RUN_SOFT_TIMEOUT_MS,
    );
  });

  it("INLINE FALLBACK (foreground ~60s fn, not a worker) uses the 40s default", () => {
    process.env.NETLIFY = "true";
    process.env.AWS_LAMBDA_FUNCTION_NAME = "server";
    expect(
      resolveForWorker({ isBackgroundWorker: false, overrideMs: 240_000 }),
    ).toBe(HOSTED_SOFT_TIMEOUT_CEILING_MS);
  });

  it("WORKER on the regular ~60s function (name does NOT end in -background) keeps the 40s clamp (the bug)", () => {
    process.env.NETLIFY = "true";
    process.env.AWS_LAMBDA_FUNCTION_NAME = "server";
    expect(isInBackgroundFunctionRuntime()).toBe(false);
    expect(resolveForWorker({ isBackgroundWorker: true })).toBe(
      DEFAULT_HOSTED_RUN_SOFT_TIMEOUT_MS,
    );
  });

  it("WORKER inside a real -background function gets the ~13min budget", () => {
    process.env.NETLIFY = "true";
    process.env.AWS_LAMBDA_FUNCTION_NAME = "server-agent-background";
    expect(isInBackgroundFunctionRuntime()).toBe(true);
    expect(resolveForWorker({ isBackgroundWorker: true })).toBe(
      BACKGROUND_SOFT_TIMEOUT_CEILING_MS,
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

  it("resolves finalized only after the terminal event and status are durable", async () => {
    let persistFinalStatus: ((updated: boolean) => void) | undefined;
    vi.mocked(updateRunStatusIfRunning).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          persistFinalStatus = resolve;
        }),
    );
    const onComplete = vi.fn(async () => {});
    const run = startRun(
      "run-finalization-boundary",
      "thread-finalization-boundary",
      async (send) => {
        send({ type: "text", text: "Finished response" });
      },
      onComplete,
      { softTimeoutMs: 0 },
    );
    let finalized = false;
    void run.finalized.then(() => {
      finalized = true;
    });

    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(updateRunStatusIfRunning).toHaveBeenCalledWith(
        "run-finalization-boundary",
        "completed",
      ),
    );

    expect(insertRunEvent).toHaveBeenCalledWith(
      "run-finalization-boundary",
      1,
      JSON.stringify({ type: "done" }),
    );
    expect(finalized).toBe(false);

    persistFinalStatus?.(true);
    await run.finalized;

    expect(setRunTerminalReason).toHaveBeenCalledWith(
      "run-finalization-boundary",
      "done",
    );
    expect(finalized).toBe(true);
  });

  it("rejects finalized when terminal event persistence cannot be established", async () => {
    const terminalError = new Error("terminal event persistence failed");
    vi.mocked(insertRunEvent).mockImplementation(
      async (_runId, _seq, eventData) => {
        if (JSON.parse(eventData).type === "done") throw terminalError;
      },
    );

    const run = startRun(
      "run-terminal-persistence-failed",
      "thread-terminal-persistence-failed",
      async (send) => {
        send({ type: "done" });
      },
      undefined,
      { softTimeoutMs: 0 },
    );

    await expect(run.finalized).rejects.toThrow(
      "terminal event persistence failed",
    );
    expect(updateRunStatusIfRunning).not.toHaveBeenCalledWith(
      "run-terminal-persistence-failed",
      "completed",
    );
  });

  it("persists missing credential terminal events as errored runs", async () => {
    const events: AgentChatEvent[] = [];
    const onComplete = vi.fn(async () => {});
    const run = startRun(
      "run-missing-credential-terminal",
      "thread-missing-credential-terminal",
      async (send) => {
        send({ type: "missing_api_key" });
      },
      onComplete,
      { softTimeoutMs: 0 },
    );
    run.subscribers.add((event) => events.push(event.event));

    await vi.waitFor(() =>
      expect(updateRunStatusIfRunning).toHaveBeenCalledWith(
        "run-missing-credential-terminal",
        "errored",
      ),
    );

    expect(updateRunStatusIfRunning).not.toHaveBeenCalledWith(
      "run-missing-credential-terminal",
      "completed",
    );
    expect(insertRunEvent).toHaveBeenCalledWith(
      "run-missing-credential-terminal",
      0,
      JSON.stringify({ type: "missing_api_key" }),
    );
    expect(setRunTerminalReason).toHaveBeenCalledWith(
      "run-missing-credential-terminal",
      "missing_api_key",
    );
    expect(setRunError).toHaveBeenCalledWith(
      "run-missing-credential-terminal",
      LLM_MISSING_CREDENTIALS_ERROR_CODE,
      LLM_MISSING_CREDENTIALS_MESSAGE,
    );
    expect(events).toContainEqual({ type: "missing_api_key" });
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "errored",
        events: [
          expect.objectContaining({ event: { type: "missing_api_key" } }),
        ],
      }),
    );
  });

  it("passes an emitted terminal error to completion callbacks as errored", async () => {
    const onComplete = vi.fn(async () => {});

    startRun(
      "run-error-terminal-callback",
      "thread-error-terminal-callback",
      async (send) => {
        send({
          type: "error",
          error: "Provider failed",
          errorCode: "provider_failed",
          recoverable: true,
        });
      },
      onComplete,
      { softTimeoutMs: 0 },
    );

    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "errored",
        events: [
          expect.objectContaining({
            event: expect.objectContaining({
              type: "error",
              errorCode: "provider_failed",
            }),
          }),
        ],
      }),
    );
  });

  it("maps exhausted provider 429s to a terminal rate-limit error code", async () => {
    const events: AgentChatEvent[] = [];

    const run = startRun(
      "run-provider-rate-limit",
      "thread-provider-rate-limit",
      async () => {
        throw new EngineError("429 status code (no body)", {
          statusCode: 429,
        });
      },
      undefined,
      { softTimeoutMs: 0 },
    );
    run.subscribers.add((event) => events.push(event.event));

    await vi.waitFor(() => {
      expect(events).toContainEqual({
        type: "error",
        error: "429 status code (no body)",
        errorCode: "provider_rate_limited",
        details: "429 status code (no body)",
      });
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
    expect(run.events).toEqual([{ seq: 0, event: { type: "done" } }]);
    expect(run.subscribers.size).toBe(0);
    expect(terminalEvents).toContainEqual({ type: "done" });

    const replay = subscribeToRun("run-explicit-abort", 0);
    const reader = replay!.getReader();
    const chunks: string[] = [];
    const decoder = new TextDecoder();
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      chunks.push(decoder.decode(result.value));
    }
    expect(chunks.join("")).toContain(
      'data: {"type":"done","seq":0,"eventId":"run-explicit-abort:0"}',
    );

    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(markRunAborted).toHaveBeenCalledWith("run-explicit-abort", "user");
  });

  it("waits for a cross-isolate abort to become durable before resolving", async () => {
    let persistAbort: (() => void) | undefined;
    vi.mocked(markRunAborted).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          persistAbort = resolve;
        }),
    );

    let resolved = false;
    const abortPromise = abortRunDurably(
      "run-cross-isolate",
      "user_stuck_retry",
    ).then((abortedInMemory) => {
      resolved = true;
      return abortedInMemory;
    });

    await Promise.resolve();
    expect(markRunAborted).toHaveBeenCalledWith(
      "run-cross-isolate",
      "user_stuck_retry",
    );
    expect(resolved).toBe(false);

    persistAbort?.();
    await expect(abortPromise).resolves.toBe(false);
    expect(resolved).toBe(true);
  });

  it("aborts the in-process run before a turn-reference abort resolves", async () => {
    let observedAbortReason: unknown;
    const run = startRun(
      "run-turn-ref-abort",
      "thread-turn-ref-abort",
      async (_send, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              observedAbortReason = signal.reason;
              resolve();
            },
            { once: true },
          );
        });
      },
      undefined,
      { softTimeoutMs: 0, turnId: "turn-ref-abort" },
    );

    await abortTurnByRefDurably(
      "thread-turn-ref-abort",
      "turn-ref-abort",
      "dismissed",
    );

    expect(observedAbortReason).toBe("dismissed");
    expect(run.status).toBe("aborted");
    expect(markTurnAborted).toHaveBeenCalledWith(
      "thread-turn-ref-abort",
      "turn-ref-abort",
      "dismissed",
    );
  });

  it("replays every chunk of a completed logical turn as one stream", async () => {
    vi.mocked(getCurrentTurnRunEventsForThread).mockResolvedValueOnce([
      {
        runId: "run-turn-1",
        seq: 0,
        event: { type: "text", text: "first chunk" },
      },
      {
        runId: "run-turn-1",
        seq: 1,
        event: { type: "auto_continue", reason: "run_timeout" },
      },
      {
        runId: "run-turn-2",
        seq: 0,
        event: { type: "text", text: "second chunk" },
      },
      { runId: "run-turn-2", seq: 1, event: { type: "done" } },
    ]);

    const stream = await replayCompletedTurn("thread-turn", "turn-1");
    const reader = stream!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(decoder.decode(next.value));
    }

    const output = chunks.join("");
    expect(output).toContain(
      'data: {"type":"text","text":"first chunk","seq":0,"eventId":"run-turn-1:0"}',
    );
    expect(output).toContain(
      'data: {"type":"text","text":"second chunk","seq":1,"eventId":"run-turn-2:0"}',
    );
    expect(output).toContain(
      'data: {"type":"done","seq":2,"eventId":"run-turn-2:1"}',
    );
    expect(output).not.toContain("auto_continue");
    expect(getCurrentTurnRunEventsForThread).toHaveBeenCalledWith(
      "thread-turn",
      "turn-1",
    );
  });

  it("keeps an in-memory abort successful when durable cleanup fails", async () => {
    const persistenceError = new Error("abort persistence unavailable");
    vi.mocked(markRunAborted).mockRejectedValueOnce(persistenceError);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    let abortReason: unknown;
    const run = startRun(
      "run-durable-abort-failure",
      "thread-durable-abort-failure",
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

    try {
      await expect(
        abortRunDurably("run-durable-abort-failure", "user_stuck_retry"),
      ).resolves.toBe(true);
    } finally {
      consoleError.mockRestore();
    }

    expect(abortReason).toBe("user_stuck_retry");
    expect(run.status).toBe("aborted");
    expect(markRunAborted).toHaveBeenCalledWith(
      "run-durable-abort-failure",
      "user_stuck_retry",
    );
  });

  it("persists the partial turn on a no-progress recovery abort", async () => {
    const onComplete = vi.fn();
    const run = startRun(
      "run-no-progress-abort",
      "thread-no-progress-abort",
      async (send, signal) => {
        send({ type: "text", text: "half an answer" });
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      onComplete,
      { softTimeoutMs: 0 },
    );

    expect(abortRun("run-no-progress-abort", "no_progress")).toBe(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(run.status).toBe("aborted");
    expect(onComplete).toHaveBeenCalledTimes(1);
    const savedRun = vi.mocked(onComplete).mock.calls[0][0] as ActiveRun;
    expect(savedRun.events).toContainEqual({
      seq: 0,
      event: { type: "text", text: "half an answer" },
    });
    expect(markRunAborted).toHaveBeenCalledWith(
      "run-no-progress-abort",
      "no_progress",
    );
  });

  it("emits a reason-shaped terminal event to subscribers instead of a bare done", async () => {
    const seen: AgentChatEvent[] = [];
    const run = startRun(
      "run-abort-terminal-shape",
      "thread-abort-terminal-shape",
      async (_send, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      undefined,
      { softTimeoutMs: 0 },
    );
    run.subscribers.add((runEvent) => {
      seen.push(runEvent.event);
    });

    abortRun("run-abort-terminal-shape", "no_progress");
    await vi.advanceTimersByTimeAsync(0);

    expect(seen).toEqual([{ type: "auto_continue", reason: "no_progress" }]);
  });

  it("emits a plain done for a user stop", async () => {
    const seen: AgentChatEvent[] = [];
    const run = startRun(
      "run-abort-user-stop",
      "thread-abort-user-stop",
      async (_send, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      undefined,
      { softTimeoutMs: 0 },
    );
    run.subscribers.add((runEvent) => {
      seen.push(runEvent.event);
    });

    abortRun("run-abort-user-stop", "user");
    await vi.advanceTimersByTimeAsync(0);

    expect(seen).toEqual([{ type: "done" }]);
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

  it("does not bump durable progress for keepalives or anonymous zero-byte action preparation", async () => {
    vi.setSystemTime(10_000);

    const run = startRun(
      "run-empty-prep-progress",
      "thread-empty-prep-progress",
      async (send, signal) => {
        send({ type: "stream_keepalive" });
        send({
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
        });
        send({
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
          progressBytes: 0,
        });
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      undefined,
      { softTimeoutMs: 0 },
    );

    expect(bumpRunProgress).not.toHaveBeenCalled();

    expect(abortRun("run-empty-prep-progress")).toBe(true);
    await vi.waitFor(() => expect(run.status).toBe("aborted"));
  });

  it("bumps durable progress for the first identified zero-byte action preparation", async () => {
    vi.setSystemTime(10_000);

    const run = startRun(
      "run-identified-empty-prep-progress",
      "thread-identified-empty-prep-progress",
      async (send, signal) => {
        send({
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
          id: "call-a",
          progressBytes: 0,
        });
        vi.setSystemTime(12_000);
        send({
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
          id: "call-a",
          progressBytes: 0,
        });
        vi.setSystemTime(14_000);
        send({
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
          id: "call-b",
          progressBytes: 0,
        });
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      undefined,
      { softTimeoutMs: 0 },
    );

    expect(bumpRunProgress).toHaveBeenCalledTimes(1);
    expect(bumpRunProgress).toHaveBeenCalledWith(
      "run-identified-empty-prep-progress",
    );

    expect(abortRun("run-identified-empty-prep-progress")).toBe(true);
    await vi.waitFor(() => expect(run.status).toBe("aborted"));
  });

  it("does not bump durable progress for clear events or lower-byte restarts", async () => {
    vi.setSystemTime(10_000);

    const run = startRun(
      "run-clear-not-progress",
      "thread-clear-not-progress",
      async (send, signal) => {
        send({
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
          id: "call-a",
          progressBytes: 64,
        });
        vi.setSystemTime(12_000);
        send({ type: "clear" });
        vi.setSystemTime(14_000);
        send({
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
          id: "call-b",
          progressBytes: 0,
        });
        vi.setSystemTime(16_000);
        send({
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
          id: "call-b",
          progressBytes: 32,
        });
        vi.setSystemTime(18_000);
        send({
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
          id: "call-c",
          progressBytes: 64,
        });
        vi.setSystemTime(20_000);
        send({
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
          id: "call-c",
          progressBytes: 96,
        });
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      undefined,
      { softTimeoutMs: 0 },
    );

    await vi.waitFor(() => expect(bumpRunProgress).toHaveBeenCalledTimes(2));
    expect(bumpRunProgress).toHaveBeenNthCalledWith(
      1,
      "run-clear-not-progress",
    );
    expect(bumpRunProgress).toHaveBeenNthCalledWith(
      2,
      "run-clear-not-progress",
    );

    expect(abortRun("run-clear-not-progress")).toBe(true);
    await vi.waitFor(() => expect(run.status).toBe("aborted"));
  });

  it("applies clear restart high-water to no-id preparation progress", async () => {
    vi.setSystemTime(10_000);

    const run = startRun(
      "run-clear-no-id-progress",
      "thread-clear-no-id-progress",
      async (send, signal) => {
        send({
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
          progressBytes: 64,
        });
        vi.setSystemTime(12_000);
        send({ type: "clear" });
        vi.setSystemTime(14_000);
        send({
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
          progressBytes: 32,
        });
        vi.setSystemTime(16_000);
        send({
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
          progressBytes: 96,
        });
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      undefined,
      { softTimeoutMs: 0 },
    );

    await vi.waitFor(() => expect(bumpRunProgress).toHaveBeenCalledTimes(2));
    expect(bumpRunProgress).toHaveBeenNthCalledWith(
      1,
      "run-clear-no-id-progress",
    );
    expect(bumpRunProgress).toHaveBeenNthCalledWith(
      2,
      "run-clear-no-id-progress",
    );

    expect(abortRun("run-clear-no-id-progress")).toBe(true);
    await vi.waitFor(() => expect(run.status).toBe("aborted"));
  });

  it("bumps durable progress only when action-preparation bytes increase", async () => {
    vi.setSystemTime(10_000);

    const run = startRun(
      "run-streaming-prep-progress",
      "thread-streaming-prep-progress",
      async (send, signal) => {
        send({
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
          id: "call-a",
          progressBytes: 0,
        });
        send({
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
          id: "call-a",
          progressBytes: 64,
        });
        vi.setSystemTime(12_000);
        send({
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
          id: "call-a",
          progressBytes: 64,
        });
        vi.setSystemTime(14_000);
        send({
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
          id: "call-a",
          progressBytes: 96,
        });
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      undefined,
      { softTimeoutMs: 0 },
    );

    await vi.waitFor(() => expect(bumpRunProgress).toHaveBeenCalledTimes(2));
    expect(bumpRunProgress).toHaveBeenNthCalledWith(
      1,
      "run-streaming-prep-progress",
    );
    expect(bumpRunProgress).toHaveBeenNthCalledWith(
      2,
      "run-streaming-prep-progress",
    );

    expect(abortRun("run-streaming-prep-progress")).toBe(true);
    await vi.waitFor(() => expect(run.status).toBe("aborted"));
  });

  it("keys durable action-preparation progress by activity id", async () => {
    vi.setSystemTime(10_000);

    const run = startRun(
      "run-parallel-prep-progress",
      "thread-parallel-prep-progress",
      async (send, signal) => {
        send({
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
          id: "call-a",
          progressBytes: 128,
        });
        vi.setSystemTime(12_000);
        send({
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
          id: "call-b",
          progressBytes: 64,
        });
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      undefined,
      { softTimeoutMs: 0 },
    );

    await vi.waitFor(() => expect(bumpRunProgress).toHaveBeenCalledTimes(2));
    expect(bumpRunProgress).toHaveBeenNthCalledWith(
      1,
      "run-parallel-prep-progress",
    );
    expect(bumpRunProgress).toHaveBeenNthCalledWith(
      2,
      "run-parallel-prep-progress",
    );

    expect(abortRun("run-parallel-prep-progress")).toBe(true);
    await vi.waitFor(() => expect(run.status).toBe("aborted"));
  });

  it("treats no-id positive preparation bytes as durable progress", async () => {
    vi.setSystemTime(10_000);

    const run = startRun(
      "run-no-id-prep-progress",
      "thread-no-id-prep-progress",
      async (send, signal) => {
        send({
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
          progressBytes: 128,
        });
        vi.setSystemTime(12_000);
        send({
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
          progressBytes: 64,
        });
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      undefined,
      { softTimeoutMs: 0 },
    );

    await vi.waitFor(() => expect(bumpRunProgress).toHaveBeenCalledTimes(2));
    expect(bumpRunProgress).toHaveBeenNthCalledWith(
      1,
      "run-no-id-prep-progress",
    );
    expect(bumpRunProgress).toHaveBeenNthCalledWith(
      2,
      "run-no-id-prep-progress",
    );

    expect(abortRun("run-no-id-prep-progress")).toBe(true);
    await vi.waitFor(() => expect(run.status).toBe("aborted"));
  });

  it("retries a progress write that races the initial run-row insert", async () => {
    let resolveInsert!: () => void;
    const insertPromise = new Promise<void>((resolve) => {
      resolveInsert = resolve;
    });
    vi.mocked(insertRun).mockReturnValueOnce(insertPromise);
    vi.mocked(bumpRunProgress)
      .mockImplementationOnce(async () => false)
      .mockImplementationOnce(async () => true);

    const run = startRun(
      "run-progress-insert-race",
      "thread-progress-insert-race",
      async (send, signal) => {
        send({ type: "tool_input_delta", text: "{" });
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      undefined,
      { softTimeoutMs: 0 },
    );

    await vi.waitFor(() => expect(bumpRunProgress).toHaveBeenCalledTimes(1));
    expect(bumpRunProgress).toHaveBeenNthCalledWith(
      1,
      "run-progress-insert-race",
    );

    resolveInsert();
    await vi.waitFor(() => expect(bumpRunProgress).toHaveBeenCalledTimes(2));
    expect(bumpRunProgress).toHaveBeenNthCalledWith(
      2,
      "run-progress-insert-race",
    );

    expect(abortRun("run-progress-insert-race")).toBe(true);
    await vi.waitFor(() => expect(run.status).toBe("aborted"));
  });

  it("surfaces and retries a failed durable progress write", async () => {
    const provider = vi.fn(() => "evt_run_progress");
    const unregister = registerErrorCaptureProvider(
      "run-manager-progress-persistence-test",
      provider,
    );
    const error = new Error("progress write failed");
    vi.mocked(bumpRunProgress)
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(true);

    try {
      const run = startRun(
        "run-progress-write-failure",
        "thread-progress-write-failure",
        async (send, signal) => {
          send({ type: "tool_input_delta", text: "{" });
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
        },
        undefined,
        { softTimeoutMs: 0 },
      );

      await vi.waitFor(() =>
        expect(provider).toHaveBeenCalledWith(
          error,
          expect.objectContaining({
            route: "/_agent-native/agent-chat",
            tags: expect.objectContaining({
              source: "agent-run-manager",
              phase: "progress",
            }),
            extra: expect.objectContaining({
              runId: "run-progress-write-failure",
              threadId: "thread-progress-write-failure",
            }),
          }),
        ),
      );
      expect(bumpRunProgress).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1_000);
      await vi.waitFor(() => expect(bumpRunProgress).toHaveBeenCalledTimes(2));

      expect(abortRun("run-progress-write-failure")).toBe(true);
      await vi.waitFor(() => expect(run.status).toBe("aborted"));
    } finally {
      unregister();
    }
  });

  it("re-arms progress coalescing after intermittent write failures on long streams", async () => {
    vi.setSystemTime(10_000);
    let attempts = 0;
    const successfulWrites: number[] = [];
    vi.mocked(bumpRunProgress).mockImplementation(async () => {
      attempts += 1;
      if (attempts % 3 !== 0) {
        throw new Error(`intermittent progress failure ${attempts}`);
      }
      successfulWrites.push(Date.now());
      return true;
    });

    let emitProgress: ((event: AgentChatEvent) => void) | undefined;
    const run = startRun(
      "run-progress-rearms-after-failure",
      "thread-progress-rearms-after-failure",
      async (send, signal) => {
        emitProgress = send;
        for (let index = 0; index < 2_000; index += 1) {
          send({ type: "tool_input_delta", text: "x" });
        }
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      undefined,
      { softTimeoutMs: 0 },
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(emitProgress).toBeTypeOf("function");

    await vi.advanceTimersByTimeAsync(3_000);
    expect(attempts).toBe(3);
    expect(successfulWrites).toEqual([12_000]);

    emitProgress!({ type: "tool_input_delta", text: "after-recovery" });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(attempts).toBe(6);
    expect(successfulWrites).toEqual([12_000, 15_000]);

    expect(abortRun("run-progress-rearms-after-failure")).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(run.status).toBe("aborted");
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

  it("reconciles from the terminal event when the final status write misses", async () => {
    vi.mocked(updateRunStatusIfRunning).mockRejectedValueOnce(
      new Error("transient status write failure"),
    );
    vi.mocked(reconcileTerminalRunFromEvents).mockResolvedValueOnce(true);

    const run = startRun(
      "run-terminal-reconcile-fallback",
      "thread-terminal-reconcile-fallback",
      async (send) => {
        send({ type: "text", text: "fast answer" });
      },
      undefined,
      { softTimeoutMs: 0 },
    );

    await vi.waitFor(() => expect(run.status).toBe("completed"));
    await vi.waitFor(() =>
      expect(updateRunStatusIfRunning).toHaveBeenCalledWith(
        "run-terminal-reconcile-fallback",
        "completed",
      ),
    );
    expect(reconcileTerminalRunFromEvents).toHaveBeenCalledWith(
      "run-terminal-reconcile-fallback",
    );
  });

  it("captures initial run-row persistence failures with the run id", async () => {
    const provider = vi.fn(() => "evt_run_insert");
    const unregister = registerErrorCaptureProvider(
      "run-manager-insert-persistence-test",
      provider,
    );
    const err = new Error("insert failed");
    vi.mocked(insertRun).mockRejectedValueOnce(err);

    try {
      startRun(
        "run-insert-missing",
        "thread-insert-missing",
        async () => {},
        undefined,
        { softTimeoutMs: 0 },
      );

      await vi.waitFor(() =>
        expect(provider).toHaveBeenCalledWith(
          err,
          expect.objectContaining({
            route: "/_agent-native/agent-chat",
            tags: expect.objectContaining({
              source: "agent-run-manager",
              phase: "insert-run",
            }),
            extra: expect.objectContaining({
              runId: "run-insert-missing",
              threadId: "thread-insert-missing",
            }),
          }),
        ),
      );
    } finally {
      unregister();
    }
  });

  it("captures run-event persistence failures with the sequence and event type", async () => {
    const provider = vi.fn(() => "evt_run_event");
    const unregister = registerErrorCaptureProvider(
      "run-manager-event-persistence-test",
      provider,
    );
    const err = new Error("event insert failed");
    vi.mocked(insertRunEvent).mockRejectedValueOnce(err);

    try {
      startRun(
        "run-event-missing",
        "thread-event-missing",
        async (send) => {
          send({ type: "text", text: "hello" });
        },
        undefined,
        { softTimeoutMs: 0 },
      );

      await vi.waitFor(() =>
        expect(provider).toHaveBeenCalledWith(
          err,
          expect.objectContaining({
            route: "/_agent-native/agent-chat",
            tags: expect.objectContaining({
              source: "agent-run-manager",
              phase: "insert-event",
            }),
            extra: expect.objectContaining({
              runId: "run-event-missing",
              threadId: "thread-event-missing",
              seq: 0,
              eventType: "text",
            }),
          }),
        ),
      );
    } finally {
      unregister();
    }
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

  it("does not capture expected quota or rate-limit terminal run errors", async () => {
    const provider = vi.fn(() => "evt_run");
    const unregister = registerErrorCaptureProvider(
      "run-manager-expected-errors-test",
      provider,
    );
    const events: AgentChatEvent[] = [];

    try {
      const run = startRun(
        "run-credits-limit",
        "thread-credits-limit",
        async () => {
          throw new EngineError(
            "You've reached the daily AI credits limit for your current plan.",
            {
              errorCode: "credits-limit-daily",
              upgradeUrl: "https://builder.io/account/billing",
            },
          );
        },
        undefined,
        { softTimeoutMs: 0 },
      );
      run.subscribers.add((event) => events.push(event.event));

      await vi.waitFor(() =>
        expect(updateRunStatusIfRunning).toHaveBeenCalledWith(
          "run-credits-limit",
          "errored",
        ),
      );
    } finally {
      unregister();
    }

    expect(provider).not.toHaveBeenCalled();
    expect(events).toContainEqual({
      type: "error",
      error: "You've reached the daily AI credits limit for your current plan.",
      errorCode: "credits-limit-daily",
      upgradeUrl: "https://builder.io/account/billing",
    });
  });

  it("does not capture exhausted provider 429s while preserving the terminal event", async () => {
    const provider = vi.fn(() => "evt_run");
    const unregister = registerErrorCaptureProvider(
      "run-manager-provider-rate-limit-test",
      provider,
    );
    const events: AgentChatEvent[] = [];

    try {
      const run = startRun(
        "run-provider-429-no-capture",
        "thread-provider-429-no-capture",
        async () => {
          throw new EngineError("429 status code (no body)", {
            statusCode: 429,
          });
        },
        undefined,
        { softTimeoutMs: 0 },
      );
      run.subscribers.add((event) => events.push(event.event));

      await vi.waitFor(() =>
        expect(updateRunStatusIfRunning).toHaveBeenCalledWith(
          "run-provider-429-no-capture",
          "errored",
        ),
      );
    } finally {
      unregister();
    }

    expect(provider).not.toHaveBeenCalled();
    expect(events).toContainEqual({
      type: "error",
      error: "429 status code (no body)",
      errorCode: "provider_rate_limited",
      details: "429 status code (no body)",
    });
  });

  it("carries a provider-retryable engine failure on the wire", async () => {
    const events: AgentChatEvent[] = [];

    const run = startRun(
      "run-provider-retryable",
      "thread-provider-retryable",
      async () => {
        throw new EngineError(
          "AI features aren't available on this site right now.",
          {
            providerRetryable: true,
          },
        );
      },
      undefined,
      { softTimeoutMs: 0 },
    );
    run.subscribers.add((event) => events.push(event.event));

    await vi.waitFor(() =>
      expect(updateRunStatusIfRunning).toHaveBeenCalledWith(
        "run-provider-retryable",
        "errored",
      ),
    );

    expect(events).toContainEqual(
      expect.objectContaining({ type: "error", providerRetryable: true }),
    );
    const retryableEvent = events.find((event) => event.type === "error");
    expect(retryableEvent).not.toHaveProperty("recoverable");
  });

  it("leaves a terminal engine failure unrecoverable on the wire", async () => {
    const events: AgentChatEvent[] = [];

    const run = startRun(
      "run-provider-terminal",
      "thread-provider-terminal",
      async () => {
        throw new EngineError(
          "AI features aren't available on this site right now.",
          {
            errorCode: "credits-limit-reached",
          },
        );
      },
      undefined,
      { softTimeoutMs: 0 },
    );
    run.subscribers.add((event) => events.push(event.event));

    await vi.waitFor(() =>
      expect(updateRunStatusIfRunning).toHaveBeenCalledWith(
        "run-provider-terminal",
        "errored",
      ),
    );

    const errorEvent = events.find((event) => event.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent).not.toHaveProperty("recoverable");
    expect(errorEvent).not.toHaveProperty("providerRetryable");
  });

  it("does not capture missing LLM provider errors while preserving the terminal event", async () => {
    const provider = vi.fn(() => "evt_run");
    const unregister = registerErrorCaptureProvider(
      "run-manager-missing-provider-test",
      provider,
    );
    const events: AgentChatEvent[] = [];

    try {
      const run = startRun(
        "run-missing-provider-no-capture",
        "thread-missing-provider-no-capture",
        async () => {
          throw new EngineError(LLM_MISSING_CREDENTIALS_MESSAGE);
        },
        undefined,
        { softTimeoutMs: 0 },
      );
      run.subscribers.add((event) => events.push(event.event));

      await vi.waitFor(() =>
        expect(updateRunStatusIfRunning).toHaveBeenCalledWith(
          "run-missing-provider-no-capture",
          "errored",
        ),
      );
    } finally {
      unregister();
    }

    expect(provider).not.toHaveBeenCalled();
    expect(events).toContainEqual({
      type: "error",
      error: LLM_MISSING_CREDENTIALS_MESSAGE,
    });
  });

  it("does not capture provider auth failures while preserving the terminal event", async () => {
    const provider = vi.fn(() => "evt_run");
    const unregister = registerErrorCaptureProvider(
      "run-manager-provider-auth-test",
      provider,
    );
    const events: AgentChatEvent[] = [];

    try {
      const run = startRun(
        "run-provider-auth-no-capture",
        "thread-provider-auth-no-capture",
        async () => {
          throw new EngineError("401 status code (no body)");
        },
        undefined,
        { softTimeoutMs: 0 },
      );
      run.subscribers.add((event) => events.push(event.event));

      await vi.waitFor(() =>
        expect(updateRunStatusIfRunning).toHaveBeenCalledWith(
          "run-provider-auth-no-capture",
          "errored",
        ),
      );
    } finally {
      unregister();
    }

    expect(provider).not.toHaveBeenCalled();
    expect(events).toContainEqual({
      type: "error",
      error: "401 status code (no body)",
    });
  });

  it("does not capture provider connection failures and marks them recoverable", async () => {
    const provider = vi.fn(() => "evt_run");
    const unregister = registerErrorCaptureProvider(
      "run-manager-provider-connection-test",
      provider,
    );
    const events: AgentChatEvent[] = [];

    try {
      const run = startRun(
        "run-provider-connection-no-capture",
        "thread-provider-connection-no-capture",
        async () => {
          throw new EngineError("Connection error.");
        },
        undefined,
        { softTimeoutMs: 0 },
      );
      run.subscribers.add((event) => events.push(event.event));

      await vi.waitFor(() =>
        expect(updateRunStatusIfRunning).toHaveBeenCalledWith(
          "run-provider-connection-no-capture",
          "errored",
        ),
      );
    } finally {
      unregister();
    }

    expect(provider).not.toHaveBeenCalled();
    expect(events).toContainEqual({
      type: "error",
      error: "Connection error.",
      errorCode: "provider_network_error",
    });
  });

  it("classifies raw retry-wrapped OpenAI TLS failures as provider network errors", async () => {
    const provider = vi.fn(() => "evt_run");
    const unregister = registerErrorCaptureProvider(
      "run-manager-provider-tls-test",
      provider,
    );
    const events: AgentChatEvent[] = [];
    const message =
      "Failed after 2 attempts. Last error: Cannot connect to API: " +
      "ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR tlsv1 alert internal error";

    try {
      const run = startRun(
        "run-provider-tls-no-capture",
        "thread-provider-tls-no-capture",
        async () => {
          throw new Error(message);
        },
        undefined,
        { softTimeoutMs: 0 },
      );
      run.subscribers.add((event) => events.push(event.event));

      await vi.waitFor(() =>
        expect(updateRunStatusIfRunning).toHaveBeenCalledWith(
          "run-provider-tls-no-capture",
          "errored",
        ),
      );
    } finally {
      unregister();
    }

    expect(provider).not.toHaveBeenCalled();
    expect(events).toContainEqual({
      type: "error",
      error: message,
      errorCode: "provider_network_error",
    });
  });

  it("keeps a truncated gateway stream out of Sentry on both lanes", async () => {
    for (const [name, message] of [
      ["owner", "Builder gateway stream ended without a stop event"],
      ["visitor", "AI features aren't available on this site right now."],
    ] as const) {
      const provider = vi.fn(() => "evt_run");
      const unregister = registerErrorCaptureProvider(
        `run-manager-stream-ended-${name}`,
        provider,
      );
      const events: AgentChatEvent[] = [];

      try {
        const run = startRun(
          `run-stream-ended-${name}`,
          `thread-stream-ended-${name}`,
          async () => {
            throw new EngineError(message, {
              errorCode: "builder_gateway_stream_ended",
            });
          },
          undefined,
          { softTimeoutMs: 0 },
        );
        run.subscribers.add((event) => events.push(event.event));

        await vi.waitFor(() =>
          expect(updateRunStatusIfRunning).toHaveBeenCalledWith(
            `run-stream-ended-${name}`,
            "errored",
          ),
        );
      } finally {
        unregister();
      }

      expect(provider).not.toHaveBeenCalled();
      expect(events).toContainEqual({
        type: "error",
        error: message,
        errorCode: "builder_gateway_stream_ended",
      });
    }
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

  it("emits a continuation signal installed by the completion callback", async () => {
    const events: AgentChatEvent[] = [];
    const onComplete = vi.fn(async (completionRun: ActiveRun) => {
      completionRun.continuationTerminalEvent = {
        type: "auto_continue",
        reason: "stream_ended",
      };
    });
    const run = startRun(
      "run-server-continuation-terminal",
      "thread-server-continuation-terminal",
      async (send) => {
        send({
          type: "tool_done",
          tool: "generate-image-batch",
          id: "call-1",
          input: {},
          result: "generated",
          completedSideEffect: true,
        });
      },
      onComplete,
      { softTimeoutMs: 0 },
    );
    run.subscribers.add((event) => events.push(event.event));

    await run.finalized;

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({
      type: "auto_continue",
      reason: "stream_ended",
    });
    expect(events).not.toContainEqual({ type: "done" });
    expect(insertRunEvent).toHaveBeenCalledWith(
      "run-server-continuation-terminal",
      1,
      JSON.stringify({ type: "auto_continue", reason: "stream_ended" }),
    );
  });

  it("emits a terminal event the callback installed even when the loop already stashed one", async () => {
    const events: AgentChatEvent[] = [];
    const onComplete = vi.fn(async (completionRun: ActiveRun) => {
      completionRun.continuationTerminalEvent = {
        type: "error",
        error: "Sorry, we ran into an issue. ERROR ID: 0f3c9ab21d7e",
        errorCode: "builder_gateway_internal_error",
        recoverable: false,
      };
    });
    const run = startRun(
      "run-callback-terminal-override",
      "thread-callback-terminal-override",
      async (send) => {
        send({
          type: "error",
          error: "Sorry, we ran into an issue. ERROR ID: 0f3c9ab21d7e",
          errorCode: "builder_gateway_internal_error",
          recoverable: true,
        });
      },
      onComplete,
      { softTimeoutMs: 0 },
    );
    run.subscribers.add((event) => events.push(event.event));

    await run.finalized;

    expect(events.at(-1)).toEqual({
      type: "error",
      error: "Sorry, we ran into an issue. ERROR ID: 0f3c9ab21d7e",
      errorCode: "builder_gateway_internal_error",
      recoverable: false,
    });
    expect(setRunError).toHaveBeenCalledWith(
      "run-callback-terminal-override",
      "builder_gateway_internal_error",
      "Sorry, we ran into an issue. ERROR ID: 0f3c9ab21d7e",
    );
  });

  it("auto-continues a foreground run that ends after completed tool work", async () => {
    const events: AgentChatEvent[] = [];
    const run = startRun(
      "run-foreground-tool-only",
      "thread-foreground-tool-only",
      async (send) => {
        await Promise.resolve();
        send({
          type: "tool_done",
          tool: "provider-api-request",
          id: "call-1",
          input: {},
          result: '{"ok":true}',
          completedSideEffect: false,
        });
        send({ type: "done" });
      },
      undefined,
      { softTimeoutMs: 0 },
    );
    run.subscribers.add((event) => events.push(event.event));

    await run.finalized;

    expect(events).toEqual([
      expect.objectContaining({ type: "tool_done" }),
      { type: "auto_continue", reason: "stream_ended" },
    ]);
    expect(events).not.toContainEqual({ type: "done" });
    expect(run.status).toBe("completed");
    expect(setRunTerminalReason).toHaveBeenCalledWith(
      "run-foreground-tool-only",
      "stream_ended",
    );
  });

  it("auto-continues a foreground run whose last tool call failed", async () => {
    const events: AgentChatEvent[] = [];
    const run = startRun(
      "run-foreground-tool-error",
      "thread-foreground-tool-error",
      async (send) => {
        await Promise.resolve();
        send({ type: "text", text: "I'll build this as production code." });
        send({
          type: "tool_done",
          tool: "resources",
          id: "call-1",
          input: {},
          result: "Resource not found: design/handoff",
          isError: true,
        });
        send({
          type: "tool_done",
          tool: "web_request",
          id: "call-2",
          input: {},
          result: "Request timed out after 15000ms",
          isError: true,
        });
        send({ type: "done" });
      },
      undefined,
      { softTimeoutMs: 0 },
    );
    run.subscribers.add((event) => events.push(event.event));

    await run.finalized;

    expect(events).not.toContainEqual({ type: "done" });
    expect(events.at(-1)).toEqual({
      type: "auto_continue",
      reason: "stream_ended",
    });
    expect(setRunTerminalReason).toHaveBeenCalledWith(
      "run-foreground-tool-error",
      "stream_ended",
    );
  });

  it("auto-continues when a precondition failure is the last tool result", async () => {
    const events: AgentChatEvent[] = [];
    const run = startRun(
      "run-precondition-tool-error",
      "thread-precondition-tool-error",
      async (send) => {
        await Promise.resolve();
        send({
          type: "tool_done",
          tool: "search-analytics-query-catalog",
          id: "call-1",
          input: {},
          result: '{"matches":3}',
        });
        send({
          type: "tool_done",
          tool: "data-source-status",
          id: "call-2",
          input: {},
          result: '{"sources":["bigquery"]}',
        });
        send({
          type: "tool_done",
          tool: "provider-api-request",
          id: "call-3",
          input: {},
          result:
            "Error running provider-api-request: stripe credential not configured.",
          isError: true,
        });
        send({ type: "done" });
      },
      undefined,
      { softTimeoutMs: 0 },
    );
    run.subscribers.add((event) => events.push(event.event));

    await run.finalized;

    expect(events).not.toContainEqual({ type: "done" });
    expect(events.at(-1)).toEqual({
      type: "auto_continue",
      reason: "stream_ended",
    });
    expect(setRunTerminalReason).toHaveBeenCalledWith(
      "run-precondition-tool-error",
      "stream_ended",
    );
  });

  it("does not continue a failed tool the agent already stopped on", async () => {
    const events: AgentChatEvent[] = [];
    const run = startRun(
      "run-permanent-precondition",
      "thread-permanent-precondition",
      async (send) => {
        await Promise.resolve();
        send({
          type: "tool_done",
          tool: "provider-api-request",
          id: "call-1",
          input: {},
          result: "Stopped: provider-api-request can't run yet.",
          isError: true,
        });
        send({
          type: "error",
          error:
            "I stopped because provider-api-request needs a setup step outside this turn.",
          errorCode: "permanent_precondition",
          recoverable: false,
        });
      },
      undefined,
      { softTimeoutMs: 0 },
    );
    run.subscribers.add((event) => events.push(event.event));

    await run.finalized;

    expect(events).not.toContainEqual({
      type: "auto_continue",
      reason: "stream_ended",
    });
    expect(events.at(-1)).toMatchObject({
      type: "error",
      errorCode: "permanent_precondition",
    });
    expect(setRunTerminalReason).toHaveBeenCalledWith(
      "run-permanent-precondition",
      "error:permanent_precondition",
    );
  });

  it("auto-continues a run that ends during action preparation", async () => {
    const events: AgentChatEvent[] = [];
    const run = startRun(
      "run-action-preparation-only",
      "thread-action-preparation-only",
      async (send) => {
        send({ type: "text", text: "I will build the design now." });
        send({
          type: "activity",
          label: "Preparing generate-design action",
          tool: "generate-design",
          id: "call-generate-design",
        });
        send({
          type: "tool_input_start",
          tool: "generate-design",
          id: "call-generate-design",
        });
        send({
          type: "tool_input_delta",
          tool: "generate-design",
          id: "call-generate-design",
          text: '{"files":',
        });
        send({ type: "done" });
      },
      undefined,
      { softTimeoutMs: 0 },
    );
    run.subscribers.add((event) => events.push(event.event));

    await run.finalized;

    expect(events).toContainEqual({
      type: "auto_continue",
      reason: "stream_ended",
    });
    expect(events).not.toContainEqual({ type: "done" });
    expect(run.status).toBe("completed");
    expect(setRunTerminalReason).toHaveBeenCalledWith(
      "run-action-preparation-only",
      "stream_ended",
    );
  });

  it("keeps a completed custom UI tool result terminal", async () => {
    const events: AgentChatEvent[] = [];
    const run = startRun(
      "run-foreground-custom-ui",
      "thread-foreground-custom-ui",
      async (send) => {
        await Promise.resolve();
        send({
          type: "tool_done",
          tool: "render-inline-extension",
          id: "call-ui",
          input: {},
          result: '{"rendered":true}',
          chatUI: { renderer: "core.inline-extension" },
        });
        send({ type: "done" });
      },
      undefined,
      { softTimeoutMs: 0 },
    );
    run.subscribers.add((event) => events.push(event.event));

    await run.finalized;

    expect(events).toEqual([
      expect.objectContaining({ type: "tool_done" }),
      { type: "done" },
    ]);
    expect(events).not.toContainEqual({
      type: "auto_continue",
      reason: "stream_ended",
    });
    expect(setRunTerminalReason).toHaveBeenCalledWith(
      "run-foreground-custom-ui",
      "done",
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

  it("does not advertise a continuation when completion persistence fails before handoff", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const events: AgentChatEvent[] = [];
    const run = startRun(
      "run-completion-boundary-failed",
      "thread-completion-boundary-failed",
      async (send) => {
        send({ type: "text", text: "partial response" });
        send({ type: "auto_continue", reason: "stream_ended" });
      },
      async () => {
        throw new Error("thread_data write failed");
      },
      { softTimeoutMs: 0 },
    );
    run.subscribers.add((event) => events.push(event.event));

    await run.finalized;

    expect(events).toContainEqual({
      type: "error",
      error: "Agent response could not be saved.",
    });
    expect(events).not.toContainEqual({
      type: "auto_continue",
      reason: "stream_ended",
    });
    expect(setRunTerminalReason).toHaveBeenCalledWith(
      "run-completion-boundary-failed",
      "completion_error",
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

  it("retries a transient SQL subscription polling failure and preserves terminal events", async () => {
    vi.mocked(getRunEventsSince)
      .mockClear()
      .mockRejectedValueOnce(new Error("transient pool timeout"))
      .mockResolvedValueOnce([
        {
          seq: 0,
          eventData: JSON.stringify({ type: "text", text: "recovered" }),
        },
        {
          seq: 1,
          eventData: JSON.stringify({ type: "done" }),
        },
      ]);

    const stream = subscribeToRun("run-sql-retry", 0);
    const reader = stream!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    const first = await reader.read();
    if (!first.done) chunks.push(decoder.decode(first.value));
    await vi.waitFor(() => expect(getRunEventsSince).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(SQL_SUBSCRIPTION_RETRY_BASE_MS);

    for (let i = 0; i < 3; i++) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(decoder.decode(next.value));
    }

    const output = chunks.join("");
    expect(getRunEventsSince).toHaveBeenCalledTimes(2);
    expect(output).toContain(
      'data: {"type":"text","text":"recovered","seq":0,"eventId":"run-sql-retry:0"}',
    );
    expect(output).toContain(
      'data: {"type":"done","seq":1,"eventId":"run-sql-retry:1"}',
    );
    expect(output).not.toContain("run_subscription_poll_failed");
  });

  it("keeps the exact SQL cursor after a recoverable poll failure", async () => {
    vi.mocked(getRunEventsSince)
      .mockClear()
      .mockRejectedValueOnce(new Error("transient pool timeout"))
      .mockResolvedValueOnce([
        {
          seq: 4,
          eventData: JSON.stringify({ type: "text", text: "cursor-safe" }),
        },
        { seq: 5, eventData: JSON.stringify({ type: "done" }) },
      ]);

    const stream = subscribeToRun("run-sql-cursor-safe", 4);
    const reader = stream!.getReader();
    const decoder = new TextDecoder();

    await vi.waitFor(() => expect(getRunEventsSince).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(SQL_SUBSCRIPTION_RETRY_BASE_MS);

    const chunks: string[] = [];
    for (let i = 0; i < 2; i++) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(decoder.decode(next.value));
    }

    expect(getRunEventsSince).toHaveBeenNthCalledWith(
      1,
      "run-sql-cursor-safe",
      4,
    );
    expect(getRunEventsSince).toHaveBeenNthCalledWith(
      2,
      "run-sql-cursor-safe",
      4,
    );
    expect(chunks.join("")).toContain(
      '"text":"cursor-safe","seq":4,"eventId":"run-sql-cursor-safe:4"',
    );
  });

  it("fails a SQL subscription loudly after bounded consecutive polling failures", async () => {
    const capture = vi.fn();
    const unregister = registerErrorCaptureProvider(
      "run-manager-sql-subscription-test",
      capture,
    );
    vi.mocked(getRunEventsSince)
      .mockClear()
      .mockRejectedValue(new Error("database unavailable"));

    try {
      const stream = subscribeToRun("run-sql-persistent-failure", 4);
      const reader = stream!.getReader();
      const decoder = new TextDecoder();
      const chunks: string[] = [];

      const first = await reader.read();
      if (!first.done) chunks.push(decoder.decode(first.value));
      await vi.waitFor(() =>
        expect(getRunEventsSince).toHaveBeenCalledTimes(1),
      );
      await vi.advanceTimersByTimeAsync(
        SQL_SUBSCRIPTION_RETRY_BASE_MS +
          SQL_SUBSCRIPTION_RETRY_BASE_MS * 2 +
          SQL_SUBSCRIPTION_RETRY_BASE_MS * 4,
      );

      for (let i = 0; i < 3; i++) {
        const next = await reader.read();
        if (next.done) break;
        chunks.push(decoder.decode(next.value));
      }

      expect(getRunEventsSince).toHaveBeenCalledTimes(
        SQL_SUBSCRIPTION_MAX_CONSECUTIVE_FAILURES,
      );
      expect(chunks.join("")).toContain(
        '"errorCode":"run_subscription_poll_failed"',
      );
      expect(chunks.join("")).toContain('"recoverable":true');
      const failure = chunks
        .join("")
        .split("data: ")
        .map((chunk) => chunk.split("\n", 1)[0])
        .map((chunk) => {
          try {
            return JSON.parse(chunk) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .find((event) => event?.errorCode === "run_subscription_poll_failed");
      expect(failure).toEqual(
        expect.not.objectContaining({ seq: expect.anything() }),
      );
      expect(failure).toEqual(
        expect.not.objectContaining({ eventId: expect.anything() }),
      );
      expect(capture).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          tags: expect.objectContaining({
            phase: "sql-subscription-poll",
            consecutiveFailures: String(
              SQL_SUBSCRIPTION_MAX_CONSECUTIVE_FAILURES,
            ),
          }),
          extra: expect.objectContaining({
            runId: "run-sql-persistent-failure",
            fromSeq: 4,
            lastSeq: 4,
          }),
        }),
      );
    } finally {
      unregister();
    }
  });

  it("closes SQL subscriptions cleanly for aborted runs without terminal events", async () => {
    vi.mocked(getRunById).mockResolvedValue({
      id: "run-sql-aborted",
      threadId: "thread-sql-aborted",
      status: "aborted",
      startedAt: Date.now(),
      errorCode: null,
      errorDetail: null,
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

    expect(chunks.join("")).toContain(
      'data: {"type":"done","seq":0,"eventId":"run-sql-aborted:0"}',
    );
    expect(getRunEventsSince).toHaveBeenCalledWith("run-sql-aborted", 0);
  });

  it("synthesizes done for completed SQL runs missing terminal events", async () => {
    vi.mocked(getRunById).mockResolvedValue({
      id: "run-sql-completed",
      threadId: "thread-sql-completed",
      status: "completed",
      startedAt: Date.now(),
      errorCode: null,
      errorDetail: null,
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

    expect(chunks.join("")).toContain(
      'data: {"type":"done","seq":0,"eventId":"run-sql-completed:0"}',
    );
  });

  it("preserves continuation boundaries for completed SQL runs", async () => {
    vi.mocked(getRunById).mockResolvedValue({
      id: "run-sql-continuation",
      threadId: "thread-sql-continuation",
      status: "completed",
      startedAt: Date.now(),
      errorCode: null,
      errorDetail: null,
      terminalReason: "stream_ended",
    });
    vi.mocked(getRunEventsSince).mockResolvedValue([]);
    vi.mocked(getLastTerminalRunEvent).mockResolvedValue(null);

    const stream = subscribeToRun("run-sql-continuation", 0);
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
    expect(output).toContain(
      'data: {"type":"auto_continue","reason":"stream_ended","seq":0,"eventId":"run-sql-continuation:0"}',
    );
    expect(output).not.toContain('"type":"done"');
  });

  it("re-emits auto_continue instead of done for a completed chunk-boundary SQL run", async () => {
    vi.mocked(getRunById).mockResolvedValue({
      id: "run-sql-chunk",
      threadId: "thread-sql-chunk",
      status: "completed",
      startedAt: Date.now(),
      errorCode: null,
      errorDetail: null,
      terminalReason: "run_timeout",
    } as any);
    vi.mocked(getRunEventsSince).mockResolvedValue([]);
    vi.mocked(getLastTerminalRunEvent).mockResolvedValue(null);

    const stream = subscribeToRun("run-sql-chunk", 0);
    const reader = stream!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    for (let i = 0; i < 5; i++) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(decoder.decode(next.value));
    }

    expect(chunks.join("")).toContain(
      'data: {"type":"auto_continue","reason":"run_timeout","seq":0,"eventId":"run-sql-chunk:0"}',
    );
    expect(chunks.join("")).not.toContain('"type":"done"');
  });

  it("re-emits auto_continue instead of done for an aborted no-progress SQL run", async () => {
    vi.mocked(getRunById).mockResolvedValue({
      id: "run-sql-aborted",
      threadId: "thread-sql-aborted",
      status: "aborted",
      startedAt: Date.now(),
      errorCode: null,
      errorDetail: null,
      terminalReason: "aborted:no_progress",
    } as any);
    vi.mocked(getRunEventsSince).mockResolvedValue([]);
    vi.mocked(getLastTerminalRunEvent).mockResolvedValue(null);

    const stream = subscribeToRun("run-sql-aborted", 0);
    const reader = stream!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    for (let i = 0; i < 5; i++) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(decoder.decode(next.value));
    }

    expect(chunks.join("")).toContain(
      'data: {"type":"auto_continue","reason":"no_progress","seq":0,"eventId":"run-sql-aborted:0"}',
    );
    expect(chunks.join("")).not.toContain('"type":"done"');
  });

  it("prefers the persisted terminal event over a synthesized one for an aborted SQL run", async () => {
    vi.mocked(getRunById).mockResolvedValue({
      id: "run-sql-aborted-real",
      threadId: "thread-sql-aborted-real",
      status: "aborted",
      startedAt: Date.now(),
      errorCode: null,
      errorDetail: null,
      terminalReason: "aborted:no_progress",
    } as any);
    vi.mocked(getRunEventsSince).mockResolvedValue([]);
    vi.mocked(getLastTerminalRunEvent).mockResolvedValue({
      seq: 12,
      event: { type: "auto_continue", reason: "run_timeout" },
    });

    const stream = subscribeToRun("run-sql-aborted-real", 20);
    const reader = stream!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    for (let i = 0; i < 5; i++) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(decoder.decode(next.value));
    }

    expect(chunks.join("")).toContain(
      'data: {"type":"auto_continue","reason":"run_timeout","seq":12,"eventId":"run-sql-aborted-real:12"}',
    );
  });

  it("waits for the real terminal event when an in-memory run has none buffered", async () => {
    const run = startRun(
      "run-memory-terminal-race",
      "thread-memory-terminal-race",
      async () => {},
      undefined,
      { softTimeoutMs: 0 },
    );
    await vi.waitFor(() => expect(run.status).not.toBe("running"));
    run.events.length = 0;

    const stream = subscribeToRun("run-memory-terminal-race", 0);
    const reader = stream!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let closed = false;
    const pump = (async () => {
      while (true) {
        const next = await reader.read();
        if (next.done) {
          closed = true;
          return;
        }
        chunks.push(decoder.decode(next.value));
      }
    })();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(closed).toBe(false);
    expect(chunks.join("")).not.toContain('"type":"done"');

    for (const notify of run.subscribers) {
      notify({ seq: 0, event: { type: "done" } });
    }
    await pump;
    expect(closed).toBe(true);
    expect(chunks.join("")).toContain(
      'data: {"type":"done","seq":0,"eventId":"run-memory-terminal-race:0"}',
    );
  });

  it("re-emits an in-memory terminal event when the cursor is past it", async () => {
    const run = startRun(
      "run-memory-past-cursor",
      "thread-memory-past-cursor",
      async () => {},
      undefined,
      { softTimeoutMs: 0 },
    );
    await vi.waitFor(() => expect(run.status).not.toBe("running"));
    expect(run.events).toEqual([{ seq: 0, event: { type: "done" } }]);

    const stream = subscribeToRun("run-memory-past-cursor", 1);
    const reader = stream!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    for (let i = 0; i < 5; i++) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(decoder.decode(next.value));
    }

    expect(chunks.join("")).toContain(
      'data: {"type":"done","seq":0,"eventId":"run-memory-past-cursor:0"}',
    );
  });

  it("retries instead of reporting a missing row when the terminal lookup fails", async () => {
    vi.mocked(getRunById).mockResolvedValue(null);
    vi.mocked(getRunEventsSince).mockResolvedValue([]);
    vi.mocked(getLastTerminalRunEvent).mockRejectedValue(
      new Error("connection terminated unexpectedly"),
    );

    const stream = subscribeToRun("run-sql-terminal-lookup-failed", 0);
    const reader = stream!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    const pump = (async () => {
      while (true) {
        const next = await reader.read();
        if (next.done) return;
        chunks.push(decoder.decode(next.value));
      }
    })();

    await vi.advanceTimersByTimeAsync(1_000);
    await pump;

    const output = chunks.join("");
    expect(output).not.toContain(RUN_RECORD_MISSING_ERROR_CODE);
    expect(output).toContain(RUN_TERMINAL_LOOKUP_FAILED_ERROR_CODE);
  });

  it("fails loud when an in-memory run never emits its terminal event", async () => {
    const run = startRun(
      "run-memory-terminal-lost",
      "thread-memory-terminal-lost",
      async () => {},
      undefined,
      { softTimeoutMs: 0 },
    );
    await vi.waitFor(() => expect(run.status).not.toBe("running"));
    run.events.length = 0;

    const stream = subscribeToRun("run-memory-terminal-lost", 0);
    const reader = stream!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    const pump = (async () => {
      while (true) {
        const next = await reader.read();
        if (next.done) return;
        chunks.push(decoder.decode(next.value));
      }
    })();

    await vi.advanceTimersByTimeAsync(IN_MEMORY_TERMINAL_SETTLE_MS + 10);
    await pump;

    expect(chunks.join("")).toContain(UNKNOWN_RUN_STATUS_ERROR_CODE);
  });

  it("emits a terminal event when the run row is gone instead of closing silently", async () => {
    vi.mocked(getRunById).mockResolvedValue(null);
    vi.mocked(getRunEventsSince).mockResolvedValue([]);
    vi.mocked(getLastTerminalRunEvent).mockResolvedValue(null);

    const stream = subscribeToRun("run-sql-missing-row", 0);
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
    expect(output).toContain(RUN_RECORD_MISSING_ERROR_CODE);
  });

  it("keeps polling a not-yet-visible run row instead of ending the stream", async () => {
    // producer's INSERT. That ordinary race must not end the turn.
    runStoreTestState.runRecordMissingGraceMs = 60_000;
    vi.mocked(getRunById).mockResolvedValue(null);
    vi.mocked(getRunEventsSince).mockResolvedValue([]);
    vi.mocked(getLastTerminalRunEvent).mockResolvedValue(null);

    const stream = subscribeToRun("run-sql-not-yet-inserted", 0);
    const reader = stream!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let closed = false;
    const pump = (async () => {
      while (true) {
        const next = await reader.read();
        if (next.done) {
          closed = true;
          return;
        }
        chunks.push(decoder.decode(next.value));
      }
    })();

    await vi.advanceTimersByTimeAsync(3_000);

    const output = chunks.join("");
    expect(closed).toBe(false);
    expect(output).not.toContain('"type":"error"');
    expect(output).not.toContain('"type":"done"');
    await reader.cancel();
    await pump;
  });

  it("replays a pruned run's real terminal event rather than a missing-row error", async () => {
    vi.mocked(getRunById).mockResolvedValue(null);
    vi.mocked(getRunEventsSince).mockResolvedValue([]);
    vi.mocked(getLastTerminalRunEvent).mockResolvedValue({
      seq: 5,
      event: { type: "done" },
    });

    const stream = subscribeToRun("run-sql-missing-row-with-event", 9);
    const reader = stream!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    for (let i = 0; i < 5; i++) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(decoder.decode(next.value));
    }

    expect(chunks.join("")).toContain(
      'data: {"type":"done","seq":5,"eventId":"run-sql-missing-row-with-event:5"}',
    );
  });

  it("emits a terminal event for an unrecognized non-running status", async () => {
    vi.mocked(getRunById).mockResolvedValue({
      id: "run-sql-unknown-status",
      threadId: "thread-sql-unknown-status",
      status: "some_future_status",
      startedAt: Date.now(),
      errorCode: null,
      errorDetail: null,
      terminalReason: null,
    } as any);
    vi.mocked(getRunEventsSince).mockResolvedValue([]);
    vi.mocked(getLastTerminalRunEvent).mockResolvedValue(null);

    const stream = subscribeToRun("run-sql-unknown-status", 0);
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
    expect(output).toContain(UNKNOWN_RUN_STATUS_ERROR_CODE);
  });

  it("re-emits the run's real terminal event when the subscriber cursor is past it", async () => {
    vi.mocked(getRunById).mockResolvedValue({
      id: "run-sql-past-cursor",
      threadId: "thread-sql-past-cursor",
      status: "completed",
      startedAt: Date.now(),
      errorCode: null,
      errorDetail: null,
      terminalReason: "auto_continue",
    } as any);
    vi.mocked(getRunEventsSince).mockResolvedValue([]);
    vi.mocked(getLastTerminalRunEvent).mockResolvedValue({
      seq: 7,
      event: { type: "auto_continue", reason: "no_progress" },
    });

    const stream = subscribeToRun("run-sql-past-cursor", 9);
    const reader = stream!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    for (let i = 0; i < 5; i++) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(decoder.decode(next.value));
    }

    expect(chunks.join("")).toContain(
      'data: {"type":"auto_continue","reason":"no_progress","seq":7,"eventId":"run-sql-past-cursor:7"}',
    );
  });

  it("returns recently-completed SQL runs from /runs/active so reconnect can replay them", async () => {
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
    expect(getRunByThread).toHaveBeenCalledWith("thread-recent", {
      includeTerminal: true,
    });
  });

  it("surfaces a truncated SQL run on /runs/active, reported with the legacy wire status", async () => {
    vi.mocked(getRunByThread).mockResolvedValue({
      id: "run-recent-truncated",
      threadId: "thread-truncated",
      status: "truncated",
      startedAt: Date.now() - 1000,
      heartbeatAt: Date.now() - 1000,
      completedAt: Date.now() - 500,
      lastProgressAt: Date.now() - 800,
      terminalReason: "run_timeout",
    });

    const result = await getActiveRunForThreadAsync("thread-truncated");

    expect(result).toMatchObject({
      runId: "run-recent-truncated",
      status: "completed",
      terminalReason: "run_timeout",
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

  it("keeps terminal replay available beyond the durable client watchdog", async () => {
    const {
      SSE_DURABLE_NO_PROGRESS_TIMEOUT_MS,
      SSE_IN_FLIGHT_WORK_TIMEOUT_MS,
    } = await import("../client/sse-event-processor.js");

    expect(TERMINAL_RUN_RECONNECT_WINDOW_MS).toBeGreaterThan(
      SSE_DURABLE_NO_PROGRESS_TIMEOUT_MS,
    );
    expect(TERMINAL_RUN_RECONNECT_WINDOW_MS).toBeGreaterThan(
      SSE_IN_FLIGHT_WORK_TIMEOUT_MS,
    );
  });

  it("uses completed_at (not started_at) for the reconnect window so long-running tasks are still reachable", async () => {
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

  it("enriches in-memory active runs with SQL dispatch metadata", async () => {
    const run = startRun(
      "run-mem-background",
      "thread-mem-background",
      async (_send, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    );
    vi.mocked(getRunByThread).mockResolvedValueOnce({
      id: "run-mem-background",
      threadId: "thread-mem-background",
      status: "running",
      startedAt: Date.now() - 5_000,
      heartbeatAt: Date.now() - 1_000,
      completedAt: null,
      lastProgressAt: Date.now() - 1_000,
      dispatchMode: "background-processing",
      terminalReason: null,
      diagStage: '{"stage":"worker_started","at":1}',
    });

    const result = await getActiveRunForThreadAsync("thread-mem-background");

    expect(result).toMatchObject({
      runId: "run-mem-background",
      status: "running",
      dispatchMode: "background-processing",
      terminalReason: null,
      diagStage: '{"stage":"worker_started","at":1}',
    });
    abortRun(run.runId, "test");
  });

  it("prefers terminal SQL truth over a stale in-memory running buffer", async () => {
    const run = startRun(
      "run-mem-terminal",
      "thread-mem-terminal",
      async (_send, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    );
    vi.mocked(getRunByThread).mockResolvedValueOnce({
      id: "run-mem-terminal",
      threadId: "thread-mem-terminal",
      status: "completed",
      startedAt: Date.now() - 120_000,
      heartbeatAt: Date.now() - 5_000,
      completedAt: Date.now() - 2_000,
      lastProgressAt: Date.now() - 3_000,
      dispatchMode: "background-processing",
      terminalReason: "done",
      diagStage: '{"stage":"completed","at":1}',
    });

    const result = await getActiveRunForThreadAsync("thread-mem-terminal");

    expect(result).toMatchObject({
      runId: "run-mem-terminal",
      status: "completed",
      dispatchMode: "background-processing",
      terminalReason: "done",
    });
    abortRun(run.runId, "test");
  });

  it("FIX 1: prefers a newer running successor over a stale in-memory chunk-terminal run for the same turn", async () => {
    const run = startRun(
      "run-fix1-chunk0",
      "thread-fix1-successor",
      async (_send, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      undefined,
      { softTimeoutMs: 10, turnId: "turn-fix1" },
    );

    await vi.advanceTimersByTimeAsync(11);
    expect(run.status).toBe("completed");

    vi.mocked(getRunByThread).mockResolvedValue({
      id: "run-fix1-successor",
      threadId: "thread-fix1-successor",
      turnId: "turn-fix1",
      status: "running",
      startedAt: run.startedAt + 1_000,
      heartbeatAt: Date.now(),
      completedAt: null,
      lastProgressAt: Date.now(),
      dispatchMode: "background",
      terminalReason: null,
      diagStage: null,
    });

    const result = await getActiveRunForThreadAsync("thread-fix1-successor");

    expect(result).toMatchObject({
      runId: "run-fix1-successor",
      status: "running",
      dispatchMode: "background",
      awaitingRedispatch: false,
    });
  });

  it("FIX 1: falls back to the stale in-memory terminal status when no successor exists yet", async () => {
    const run = startRun(
      "run-fix1-nosucc",
      "thread-fix1-nosucc",
      async (_send, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      undefined,
      { softTimeoutMs: 10, turnId: "turn-fix1-nosucc" },
    );
    await vi.advanceTimersByTimeAsync(11);
    expect(run.status).toBe("completed");

    vi.mocked(getRunByThread).mockResolvedValue(null);

    const result = await getActiveRunForThreadAsync("thread-fix1-nosucc");
    expect(result).toMatchObject({
      runId: "run-fix1-nosucc",
      status: "completed",
    });
  });

  it("FIX 1: does not adopt a newer run on the same thread that belongs to a DIFFERENT turn", async () => {
    const run = startRun(
      "run-fix1-diffturn",
      "thread-fix1-diffturn",
      async (_send, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      undefined,
      { softTimeoutMs: 10, turnId: "turn-fix1-A" },
    );
    await vi.advanceTimersByTimeAsync(11);
    expect(run.status).toBe("completed");

    vi.mocked(getRunByThread).mockResolvedValue({
      id: "run-fix1-unrelated",
      threadId: "thread-fix1-diffturn",
      turnId: "turn-fix1-B",
      status: "running",
      startedAt: run.startedAt + 1_000,
      heartbeatAt: Date.now(),
      completedAt: null,
      lastProgressAt: Date.now(),
      dispatchMode: null,
      terminalReason: null,
      diagStage: null,
    });

    const result = await getActiveRunForThreadAsync("thread-fix1-diffturn");
    expect(result).toMatchObject({
      runId: "run-fix1-diffturn",
      status: "completed",
    });
  });

  it("reaps an unclaimed-stale background run PAST the redispatch bound (202 acked, worker never started, no recovery left)", async () => {
    vi.mocked(getRunByThread).mockResolvedValue({
      id: "run-unclaimed",
      threadId: "thread-unclaimed",
      status: "running",
      startedAt: Date.now() - (5 * 60_000 + 30_000), // past the 5-min bound
      heartbeatAt: Date.now() - 30_000,
      completedAt: null,
      lastProgressAt: null,
      dispatchMode: "background",
      diagStage: null,
    });
    vi.mocked(reapUnclaimedBackgroundRun).mockResolvedValueOnce(true);
    vi.mocked(reapIfStale).mockClear();

    const result = await getActiveRunForThreadAsync("thread-unclaimed");

    expect(result).toBeNull();
    expect(reapUnclaimedBackgroundRun).toHaveBeenCalledWith("run-unclaimed");
    expect(reapIfStale).not.toHaveBeenCalled();
  });

  it("does NOT reap a deferred background successor while still WITHIN the redispatch bound — leaves it for the sweep", async () => {
    vi.mocked(getRunByThread).mockResolvedValue({
      id: "run-deferred",
      threadId: "thread-deferred",
      status: "running",
      startedAt: Date.now() - 30_000, // within the 5-min bound
      heartbeatAt: Date.now() - 30_000,
      completedAt: null,
      lastProgressAt: null,
      dispatchMode: "background",
      diagStage: null,
    });
    vi.mocked(reapUnclaimedBackgroundRun).mockClear();
    vi.mocked(reapIfStale).mockResolvedValueOnce(false);

    const result = await getActiveRunForThreadAsync("thread-deferred");

    expect(reapUnclaimedBackgroundRun).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      runId: "run-deferred",
      status: "running",
      dispatchMode: "background",
      awaitingRedispatch: true,
    });
  });

  it("does NOT attempt unclaimed recovery for a claimed (background-processing) run", async () => {
    vi.mocked(getRunByThread).mockResolvedValue({
      id: "run-processing",
      threadId: "thread-processing",
      status: "running",
      startedAt: Date.now() - 5_000,
      heartbeatAt: Date.now() - 1_000,
      completedAt: null,
      lastProgressAt: Date.now() - 1_000,
      dispatchMode: "background-processing",
      diagStage: '{"stage":"worker_started","at":1}',
    });
    vi.mocked(reapUnclaimedBackgroundRun).mockClear();

    const result = await getActiveRunForThreadAsync("thread-processing");

    expect(reapUnclaimedBackgroundRun).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      runId: "run-processing",
      status: "running",
      dispatchMode: "background-processing",
      diagStage: '{"stage":"worker_started","at":1}',
      awaitingRedispatch: false,
    });
  });

  it("surfaces hasInFlightWork: true from the SQL fallback path when in_flight_since is set", async () => {
    vi.mocked(getRunByThread).mockResolvedValue({
      id: "run-in-flight",
      threadId: "thread-in-flight",
      status: "running",
      startedAt: Date.now() - 5_000,
      heartbeatAt: Date.now() - 95_000, // stale heartbeat, exactly the bug scenario
      completedAt: null,
      lastProgressAt: Date.now() - 95_000,
      dispatchMode: "background-processing",
      diagStage: null,
      inFlightSince: Date.now() - 5_000,
    } as any);
    vi.mocked(reapIfStale).mockResolvedValueOnce(false);

    const result = await getActiveRunForThreadAsync("thread-in-flight");

    expect(result).toMatchObject({
      runId: "run-in-flight",
      status: "running",
      hasInFlightWork: true,
    });
  });

  it("surfaces hasInFlightWork: false from the SQL fallback path when in_flight_since is not set", async () => {
    vi.mocked(getRunByThread).mockResolvedValue({
      id: "run-idle",
      threadId: "thread-idle",
      status: "running",
      startedAt: Date.now() - 5_000,
      heartbeatAt: Date.now() - 1_000,
      completedAt: null,
      lastProgressAt: Date.now() - 1_000,
      dispatchMode: "background-processing",
      diagStage: null,
      inFlightSince: null,
    } as any);
    vi.mocked(reapIfStale).mockResolvedValueOnce(false);

    const result = await getActiveRunForThreadAsync("thread-idle");

    expect(result).toMatchObject({
      runId: "run-idle",
      status: "running",
      hasInFlightWork: false,
    });
  });

  it("surfaces hasInFlightWork: false for a terminal run — no live work can still be in flight", async () => {
    vi.mocked(getRunByThread).mockResolvedValue({
      id: "run-terminal",
      threadId: "thread-terminal",
      status: "completed",
      startedAt: Date.now() - 10_000,
      heartbeatAt: Date.now() - 2_000,
      completedAt: Date.now() - 1_000,
      lastProgressAt: Date.now() - 2_000,
      dispatchMode: null,
      diagStage: null,
      inFlightSince: Date.now() - 2_000, // stale marker from before completion
    } as any);

    const result = await getActiveRunForThreadAsync("thread-terminal");

    expect(result).toMatchObject({
      runId: "run-terminal",
      status: "completed",
      hasInFlightWork: false,
    });
  });

  it("synthesizes a friendly stale-run error for errored SQL runs missing terminal events and heals SQL", async () => {
    vi.mocked(getRunById).mockResolvedValue({
      id: "run-sql-errored",
      threadId: "thread-sql-errored",
      status: "errored",
      startedAt: Date.now(),
      errorCode: null,
      errorDetail: null,
    });
    vi.mocked(getRunEventsSince).mockResolvedValue([]);
    vi.mocked(getLastTerminalRunEvent).mockResolvedValue(null);
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
    expect(ensureTerminalRunEvent).toHaveBeenCalledWith(
      "run-sql-errored",
      expect.objectContaining({ errorCode: "stale_run" }),
    );
  });

  it("replays the real Connection error. instead of inventing stale_run on reconnect", async () => {
    vi.mocked(getRunById).mockResolvedValue({
      id: "run-connection-error",
      threadId: "thread-connection-error",
      status: "errored",
      startedAt: Date.now(),
      errorCode: "unknown",
      errorDetail: "Connection error.",
    });
    vi.mocked(getRunEventsSince).mockResolvedValue([]);
    vi.mocked(getLastTerminalRunEvent).mockResolvedValue({
      seq: 2,
      event: { type: "error", error: "Connection error." },
    });
    vi.mocked(ensureTerminalRunEvent).mockClear();

    const stream = subscribeToRun("run-connection-error", 3);
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
    expect(output).toContain('"error":"Connection error."');
    expect(output).not.toContain('"errorCode":"stale_run"');
    expect(output).not.toContain("heartbeat stopped");
    expect(ensureTerminalRunEvent).not.toHaveBeenCalled();
  });

  it("uses row error_detail when the terminal event row is missing", async () => {
    vi.mocked(getRunById).mockResolvedValue({
      id: "run-row-detail",
      threadId: "thread-row-detail",
      status: "errored",
      startedAt: Date.now(),
      errorCode: "unknown",
      errorDetail: "Connection error.",
    });
    vi.mocked(getRunEventsSince).mockResolvedValue([]);
    vi.mocked(getLastTerminalRunEvent).mockResolvedValue(null);
    vi.mocked(ensureTerminalRunEvent).mockClear();

    const stream = subscribeToRun("run-row-detail", 0);
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
    expect(output).toContain('"error":"Connection error."');
    expect(output).not.toContain('"errorCode":"stale_run"');
    expect(ensureTerminalRunEvent).toHaveBeenCalledWith(
      "run-row-detail",
      expect.objectContaining({
        type: "error",
        error: "Connection error.",
      }),
    );
  });

  it("still streams the synthesized stale-run error when persistence to SQL fails", async () => {
    vi.mocked(getRunById).mockResolvedValue({
      id: "run-sql-errored-persist-fail",
      threadId: "thread-persist-fail",
      status: "errored",
      startedAt: Date.now(),
      errorCode: null,
      errorDetail: null,
    });
    vi.mocked(getRunEventsSince).mockResolvedValue([]);
    vi.mocked(getLastTerminalRunEvent).mockResolvedValue(null);
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

  it("self-aborts and does not overwrite status when the SQL row is no longer running", async () => {
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

    await vi.advanceTimersByTimeAsync(3001);

    expect(abortFired).toBe(true);
    expect(run.abortReason).toBe("displaced");
  });

  it("uses a conditional WHERE status=running write so a reaped row is not overwritten", async () => {
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
    await vi.waitFor(() => expect(updateRunStatusIfRunning).toHaveBeenCalled());
    expect(updateRunStatus).not.toHaveBeenCalledWith(
      "run-no-clobber",
      expect.anything(),
    );
  });

  it("keeps running to completion when every abort-state read fails", async () => {
    vi.mocked(getRunAbortState).mockRejectedValue(new Error("read timeout"));
    vi.mocked(getRunStatus).mockRejectedValue(new Error("read timeout"));

    let abortFired = false;
    const run = startRun(
      "run-abort-check-unreadable",
      "thread-abort-check-unreadable",
      async (send, signal) => {
        signal.addEventListener("abort", () => {
          abortFired = true;
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 120_000));
        send({ type: "done" });
      },
      undefined,
      { softTimeoutMs: 0 },
    );

    await vi.advanceTimersByTimeAsync(60_000);
    expect(abortFired).toBe(false);
    expect(run.status).toBe("running");

    await vi.advanceTimersByTimeAsync(61_000);
    expect(abortFired).toBe(false);
    expect(run.status).toBe("completed");
    expect(run.abortReason).toBeUndefined();
  });

  it("chains event persistence so inserts commit in seq order", async () => {
    const persistOrder: number[] = [];
    let resolveSeq0!: () => void;
    const seq0Barrier = new Promise<void>((r) => {
      resolveSeq0 = r;
    });

    vi.mocked(insertRunEvent).mockImplementation(async (_runId, seq) => {
      if (seq === 0) {
        await seq0Barrier;
      }
      persistOrder.push(seq);
    });

    const run = startRun(
      "run-persist-order",
      "thread-persist-order",
      async (send) => {
        send({ type: "text", text: "first" });
        send({ type: "text", text: "second" });
      },
      undefined,
      { softTimeoutMs: 0 },
    );
    run.subscribers.add(() => {});

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(persistOrder).not.toContain(1);

    resolveSeq0();
    await vi.waitFor(() => expect(persistOrder).toContain(1));

    expect(persistOrder.indexOf(0)).toBeLessThan(persistOrder.indexOf(1));
  });

  it("retries a failed sequence before persisting later events", async () => {
    const attempts: number[] = [];
    const durableOrder: number[] = [];
    let seq0Attempts = 0;
    const transientError = new Error("transient event persistence failure");

    vi.mocked(insertRunEvent).mockImplementation(async (_runId, seq) => {
      attempts.push(seq);
      if (seq === 0 && seq0Attempts++ === 0) {
        throw transientError;
      }
      durableOrder.push(seq);
    });

    const run = startRun(
      "run-persist-retry-order",
      "thread-persist-retry-order",
      async (send) => {
        send({ type: "text", text: "first" });
        send({ type: "text", text: "second" });
        send({ type: "done" });
      },
      undefined,
      { softTimeoutMs: 0 },
    );

    await run.finalized;

    expect(attempts).toEqual([0, 0, 1, 2]);
    expect(durableOrder).toEqual([0, 1, 2]);
    expect(updateRunStatusIfRunning).toHaveBeenCalledWith(
      "run-persist-retry-order",
      "completed",
    );
  });

  it.each(["done", "auto_continue"] as const)(
    "does not finalize %s after a permanent gap",
    async (terminalType) => {
      const attempts: number[] = [];
      const durableOrder: number[] = [];
      const permanentError = new Error("permanent event persistence failure");
      const onComplete = vi.fn();

      vi.mocked(insertRunEvent).mockImplementation(async (_runId, seq) => {
        attempts.push(seq);
        if (seq === 0) throw permanentError;
        durableOrder.push(seq);
      });

      const run = startRun(
        "run-persist-permanent-gap",
        "thread-persist-permanent-gap",
        async (send) => {
          send({ type: "text", text: "first" });
          send({ type: "text", text: "second" });
          send(
            terminalType === "done"
              ? { type: "done" }
              : { type: "auto_continue", reason: "stream_ended" },
          );
        },
        onComplete,
        { softTimeoutMs: 0 },
      );

      await expect(run.finalized).rejects.toThrow(
        "permanent event persistence failure",
      );

      expect(attempts).toEqual([0, 0]);
      expect(durableOrder).toEqual([]);
      expect(updateRunStatusIfRunning).not.toHaveBeenCalledWith(
        "run-persist-permanent-gap",
        "completed",
      );
      expect(updateRunStatusIfRunning).toHaveBeenCalledWith(
        "run-persist-permanent-gap",
        "errored",
      );
      expect(setRunError).toHaveBeenCalledWith(
        "run-persist-permanent-gap",
        "run_event_persistence_failed",
        "Agent run ended unexpectedly",
      );
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "errored",
          events: expect.arrayContaining([
            expect.objectContaining({
              event: expect.objectContaining({
                type: "error",
                errorCode: "run_event_persistence_failed",
              }),
            }),
          ]),
        }),
      );
      expect(onComplete.mock.calls[0][0].events.at(-1).event.type).toBe(
        "error",
      );
      expect(setRunTerminalReason).toHaveBeenCalledWith(
        "run-persist-permanent-gap",
        "error:run_event_persistence_failed",
      );
      expect(cleanupOldRuns).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(getRun("run-persist-permanent-gap")).toBeNull();
    },
  );

  describe("no-progress backstop", () => {
    it("exports foreground and background backstop constants", () => {
      expect(RUN_NO_PROGRESS_HARD_TIMEOUT_MS).toBe(150_000);
      expect(DEFAULT_BACKGROUND_NO_PROGRESS_TIMEOUT_MS).toBe(
        RUN_NO_PROGRESS_HARD_TIMEOUT_MS,
      );
      expect(DEFAULT_BACKGROUND_NO_PROGRESS_TIMEOUT_MS).toBeLessThan(
        BACKGROUND_SOFT_TIMEOUT_CEILING_MS,
      );
    });

    it("keeps every foreground watchdog strictly inside the chunk budget", () => {
      const softTimeoutMs = DEFAULT_HOSTED_RUN_SOFT_TIMEOUT_MS;
      const noProgress = resolveRunNoProgressTimeoutMs({ softTimeoutMs });
      const toolCeiling = resolveRunToolTimeoutCeilingMs(softTimeoutMs);

      expect(noProgress).toBeLessThan(softTimeoutMs);
      expect(toolCeiling).toBeLessThan(softTimeoutMs);
      expect(softTimeoutMs).toBeLessThanOrEqual(HOSTED_SOFT_TIMEOUT_CEILING_MS);
      expect(noProgress).toBe(30_000);
      expect(toolCeiling).toBe(35_000);
    });

    it("keeps the tool ceiling inside a background AUTOMATION's own budget", () => {
      const automationHardAbortMs = 10 * 60_000;
      const automationBudgetMs =
        automationHardAbortMs - BACKGROUND_AUTOMATION_SOFT_TIMEOUT_HEADROOM_MS;

      expect(
        resolveRunToolTimeoutCeilingMs(BACKGROUND_SOFT_TIMEOUT_CEILING_MS),
      ).toBeGreaterThan(automationBudgetMs);

      expect(resolveRunToolTimeoutCeilingMs(automationBudgetMs)).toBeLessThan(
        automationBudgetMs,
      );
    });

    it("clamps a background-sized foreground override down to the chunk budget", () => {
      expect(
        resolveRunNoProgressTimeoutMs({
          softTimeoutMs: DEFAULT_HOSTED_RUN_SOFT_TIMEOUT_MS,
          overrideMs: 3 * 60_000,
        }),
      ).toBe(30_000);
      expect(
        resolveRunNoProgressTimeoutMs({
          softTimeoutMs: DEFAULT_HOSTED_RUN_SOFT_TIMEOUT_MS,
          overrideMs: 0,
        }),
      ).toBe(0);
      expect(
        resolveRunNoProgressTimeoutMs({
          softTimeoutMs: DEFAULT_HOSTED_RUN_SOFT_TIMEOUT_MS,
          overrideMs: 12_000,
        }),
      ).toBe(12_000);
    });

    it("uses the server-owned bound for background no-progress while preserving its override", () => {
      expect(
        resolveRunNoProgressTimeoutMs({
          softTimeoutMs: BACKGROUND_SOFT_TIMEOUT_CEILING_MS,
          backgroundFunction: true,
        }),
      ).toBe(DEFAULT_BACKGROUND_NO_PROGRESS_TIMEOUT_MS);
      expect(
        resolveRunNoProgressTimeoutMs({
          softTimeoutMs: BACKGROUND_SOFT_TIMEOUT_CEILING_MS,
          backgroundFunction: true,
          overrideMs: 30_000,
          backgroundOverrideMs: 3 * 60_000,
        }),
      ).toBe(3 * 60_000);
      expect(resolveRunNoProgressTimeoutMs({ softTimeoutMs: 0 })).toBe(0);
    });

    it("checkpoints via auto_continue(no_progress) and aborts when only keepalives stream past the window", async () => {
      const events: AgentChatEvent[] = [];
      let aborted = false;
      let abortReason: unknown;

      const run = startRun(
        "run-no-progress-keepalive-only",
        "thread-no-progress-keepalive-only",
        async (send, signal) => {
          const keepaliveTimer = setInterval(() => {
            send({ type: "stream_keepalive" });
          }, 1500);
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => {
              clearInterval(keepaliveTimer);
              aborted = true;
              abortReason = signal.reason;
              resolve();
            });
          });
        },
        undefined,
        { softTimeoutMs: 0, noProgressTimeoutMs: 5_000 },
      );
      run.subscribers.add((event) => events.push(event.event));

      await vi.advanceTimersByTimeAsync(6_001);

      expect(aborted).toBe(true);
      expect(abortReason).toBe("no_progress");
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "auto_continue",
          reason: "no_progress",
        }),
      );
      expect(run.status).toBe("completed");
    });

    it("does NOT backstop a run with a tool_start in flight (no tool_done yet)", async () => {
      let aborted = false;

      const run = startRun(
        "run-no-progress-tool-in-flight",
        "thread-no-progress-tool-in-flight",
        async (send, signal) => {
          send({
            type: "tool_start",
            tool: "long-running-tool",
            id: "call-1",
            input: {},
          });
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => {
              aborted = true;
              resolve();
            });
          });
        },
        undefined,
        { softTimeoutMs: 0, noProgressTimeoutMs: 5_000 },
      );

      await vi.advanceTimersByTimeAsync(20_000);

      expect(aborted).toBe(false);
      expect(run.status).toBe("running");

      expect(abortRun("run-no-progress-tool-in-flight")).toBe(true);
      await vi.waitFor(() => expect(aborted).toBe(true));
    });

    it("does NOT backstop a run with an agent_call in flight (status start, no done/error yet)", async () => {
      let aborted = false;

      const run = startRun(
        "run-no-progress-agent-call-in-flight",
        "thread-no-progress-agent-call-in-flight",
        async (send, signal) => {
          send({ type: "agent_call", agent: "sub-agent", status: "start" });
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => {
              aborted = true;
              resolve();
            });
          });
        },
        undefined,
        { softTimeoutMs: 0, noProgressTimeoutMs: 5_000 },
      );

      await vi.advanceTimersByTimeAsync(20_000);

      expect(aborted).toBe(false);
      expect(run.status).toBe("running");

      expect(abortRun("run-no-progress-agent-call-in-flight")).toBe(true);
      await vi.waitFor(() => expect(aborted).toBe(true));
    });

    it("a real progress event resets the no-progress window", async () => {
      let aborted = false;

      const run = startRun(
        "run-no-progress-reset-by-progress",
        "thread-no-progress-reset-by-progress",
        async (send, signal) => {
          setTimeout(
            () => send({ type: "text", text: "still working" }),
            3_000,
          );
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => {
              aborted = true;
              resolve();
            });
          });
        },
        undefined,
        { softTimeoutMs: 0, noProgressTimeoutMs: 5_000 },
      );
      run.subscribers.add(() => {});

      await vi.advanceTimersByTimeAsync(6_000);
      expect(aborted).toBe(false);
      expect(run.status).toBe("running");

      await vi.advanceTimersByTimeAsync(3_000);
      expect(aborted).toBe(true);
      expect(run.status).toBe("completed");
    });

    it("resolves a tool_start/tool_done pair back to zero in-flight, so the backstop can fire again afterward", async () => {
      let aborted = false;
      let abortReason: unknown;

      const run = startRun(
        "run-no-progress-after-tool-completes",
        "thread-no-progress-after-tool-completes",
        async (send, signal) => {
          send({
            type: "tool_start",
            tool: "quick-tool",
            id: "call-1",
            input: {},
          });
          setTimeout(() => {
            send({
              type: "tool_done",
              tool: "quick-tool",
              id: "call-1",
              result: "ok",
            });
          }, 1_000);
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => {
              aborted = true;
              abortReason = signal.reason;
              resolve();
            });
          });
        },
        undefined,
        { softTimeoutMs: 0, noProgressTimeoutMs: 5_000 },
      );
      run.subscribers.add(() => {});

      await vi.advanceTimersByTimeAsync(5_001);
      expect(aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(aborted).toBe(true);
      expect(abortReason).toBe("no_progress");
    });

    it("is disabled by default (noProgressTimeoutMs=0) when no soft-timeout regime is active (non-hosted)", async () => {
      let aborted = false;

      const run = startRun(
        "run-no-progress-disabled-default",
        "thread-no-progress-disabled-default",
        async (send, signal) => {
          const keepaliveTimer = setInterval(() => {
            send({ type: "stream_keepalive" });
          }, 1500);
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => {
              clearInterval(keepaliveTimer);
              aborted = true;
              resolve();
            });
          });
        },
        undefined,
        { softTimeoutMs: 0 },
      );

      await vi.advanceTimersByTimeAsync(
        RUN_NO_PROGRESS_HARD_TIMEOUT_MS + 10_000,
      );

      expect(aborted).toBe(false);
      expect(run.status).toBe("running");

      expect(abortRun("run-no-progress-disabled-default")).toBe(true);
      await vi.waitFor(() => expect(aborted).toBe(true));
    });

    it("is armed with the default 150s window when a foreground soft-timeout regime is active and no override is given", async () => {
      let aborted = false;
      let abortReason: unknown;

      const run = startRun(
        "run-no-progress-hosted-default-armed",
        "thread-no-progress-hosted-default-armed",
        async (send, signal) => {
          const keepaliveTimer = setInterval(() => {
            send({ type: "stream_keepalive" });
          }, 1500);
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => {
              clearInterval(keepaliveTimer);
              aborted = true;
              abortReason = signal.reason;
              resolve();
            });
          });
        },
        undefined,
        { softTimeoutMs: BACKGROUND_SOFT_TIMEOUT_CEILING_MS },
      );
      run.subscribers.add(() => {});

      await vi.advanceTimersByTimeAsync(RUN_NO_PROGRESS_HARD_TIMEOUT_MS + 1);

      expect(aborted).toBe(true);
      expect(abortReason).toBe("no_progress");
      expect(run.status).toBe("completed");
    });

    it("stops a stalled durable-background run at the server-owned no-progress bound", async () => {
      let aborted = false;
      let abortReason: unknown;

      const run = startRun(
        "run-no-progress-background-default-armed",
        "thread-no-progress-background-default-armed",
        async (send, signal) => {
          const keepaliveTimer = setInterval(() => {
            send({ type: "stream_keepalive" });
          }, 1500);
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => {
              clearInterval(keepaliveTimer);
              aborted = true;
              abortReason = signal.reason;
              resolve();
            });
          });
        },
        undefined,
        {
          softTimeoutMs: BACKGROUND_SOFT_TIMEOUT_CEILING_MS,
          backgroundFunction: true,
        },
      );
      run.subscribers.add(() => {});

      await vi.advanceTimersByTimeAsync(RUN_NO_PROGRESS_HARD_TIMEOUT_MS + 1);

      expect(aborted).toBe(true);
      expect(abortReason).toBe("no_progress");
      expect(run.status).toBe("completed");
    });

    it("does NOT backstop a run with a model stream in flight, and re-arms when it ends", async () => {
      const events: AgentChatEvent[] = [];
      let aborted = false;
      let abortReason: unknown;
      let endStream: (() => void) | undefined;

      const run = startRun(
        "run-no-progress-model-stream-in-flight",
        "thread-no-progress-model-stream-in-flight",
        async (send, signal) => {
          send({ type: "model_stream", status: "start" });
          const keepaliveTimer = setInterval(() => {
            send({ type: "stream_keepalive" });
          }, 1500);
          endStream = () => {
            clearInterval(keepaliveTimer);
            send({ type: "model_stream", status: "end" });
          };
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => {
              clearInterval(keepaliveTimer);
              aborted = true;
              abortReason = signal.reason;
              resolve();
            });
          });
        },
        undefined,
        { softTimeoutMs: 0, noProgressTimeoutMs: 5_000 },
      );
      run.subscribers.add((event) => events.push(event.event));

      await vi.advanceTimersByTimeAsync(30_000);
      expect(aborted).toBe(false);
      expect(events).not.toContainEqual(
        expect.objectContaining({ type: "auto_continue" }),
      );

      endStream?.();
      await vi.advanceTimersByTimeAsync(3_000);
      expect(aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(3_000);
      expect(aborted).toBe(true);
      expect(abortReason).toBe("no_progress");
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "auto_continue",
          reason: "no_progress",
        }),
      );
    });

    it("mirrors the SQL in-flight marker across the model-stream bracket", async () => {
      vi.mocked(setRunInFlightMarker).mockClear();
      let endStream: (() => void) | undefined;

      const run = startRun(
        "run-in-flight-marker-model-stream",
        "thread-in-flight-marker-model-stream",
        async (send, signal) => {
          send({ type: "model_stream", status: "start" });
          endStream = () => send({ type: "model_stream", status: "end" });
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve());
          });
        },
        undefined,
        { softTimeoutMs: 0 },
      );

      await vi.waitFor(() =>
        expect(vi.mocked(setRunInFlightMarker)).toHaveBeenCalledWith(
          "run-in-flight-marker-model-stream",
          true,
          expect.any(Number),
        ),
      );

      endStream?.();
      await vi.waitFor(() =>
        expect(vi.mocked(setRunInFlightMarker)).toHaveBeenCalledWith(
          "run-in-flight-marker-model-stream",
          false,
          expect.any(Number),
        ),
      );

      expect(abortRun("run-in-flight-marker-model-stream")).toBe(true);
      await run.finalized;
    });

    it("clears a model-stream bracket leaked by a throw mid-stream", async () => {
      vi.mocked(setRunInFlightMarker).mockClear();

      const run = startRun(
        "run-in-flight-marker-model-stream-leak",
        "thread-in-flight-marker-model-stream-leak",
        async (send) => {
          send({ type: "model_stream", status: "start" });
          throw new Error("transport died mid-stream");
        },
        undefined,
        { softTimeoutMs: 0 },
      );

      await run.finalized;

      expect(vi.mocked(setRunInFlightMarker)).toHaveBeenCalledWith(
        "run-in-flight-marker-model-stream-leak",
        false,
        expect.any(Number),
      );
    });
  });

  describe("chunk-scoped checkpoints", () => {
    it("bounds recoverable chunks with the cumulative soft-timeout timer", async () => {
      let signalReason: unknown;
      let boundaryReason: string | null = null;

      const run = startRun(
        "run-chunk-soft-timeout",
        "thread-chunk-soft-timeout",
        async (_send, signal, control) => {
          await new Promise<void>((resolve) => {
            signal.addEventListener(
              "abort",
              () => {
                signalReason = signal.reason;
                boundaryReason = control.chunkBoundaryReason();
                resolve();
              },
              { once: true },
            );
          });
        },
        undefined,
        { softTimeoutMs: 100, recoverChunkBoundaries: true },
      );

      await vi.advanceTimersByTimeAsync(101);
      await run.finalized;

      expect(signalReason).toBe("run_timeout");
      expect(boundaryReason).toBe("run_timeout");
      expect(run.abort.signal.aborted).toBe(true);
    });

    it("ends only the chunk on a no-progress boundary, leaving the turn alive", async () => {
      const chunkAborts: unknown[] = [];
      let turnAborted = false;
      let boundaryReason: string | null = null;
      let finish: (() => void) | undefined;

      const run = startRun(
        "run-chunk-no-progress",
        "thread-chunk-no-progress",
        async (send, signal, control) => {
          control.turnSignal.addEventListener("abort", () => {
            turnAborted = true;
          });
          const keepaliveTimer = setInterval(() => {
            send({ type: "stream_keepalive" });
          }, 1500);
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
          clearInterval(keepaliveTimer);
          chunkAborts.push(signal.reason);
          boundaryReason = control.chunkBoundaryReason();
          const next = control.beginChunk();
          send({ type: "text", text: "recovered" });
          await new Promise<void>((resolve) => {
            finish = resolve;
            next.addEventListener("abort", () => resolve(), { once: true });
          });
        },
        undefined,
        {
          softTimeoutMs: BACKGROUND_SOFT_TIMEOUT_CEILING_MS,
          backgroundFunction: true,
          recoverChunkBoundaries: true,
        },
      );
      run.subscribers.add(() => {});

      await vi.advanceTimersByTimeAsync(
        DEFAULT_BACKGROUND_NO_PROGRESS_TIMEOUT_MS + 1,
      );

      expect(chunkAborts).toEqual(["no_progress"]);
      expect(boundaryReason).toBe("no_progress");
      expect(turnAborted).toBe(false);
      expect(run.abort.signal.aborted).toBe(false);
      expect(run.status).toBe("running");
      expect(run.events.some((e) => e.event.type === "auto_continue")).toBe(
        false,
      );
      expect(run.events.some((e) => e.event.type === "text")).toBe(true);

      finish?.();
      await run.finalized;
      expect(run.status).toBe("completed");
    });

    it("re-arms the backstop for each recovered chunk instead of firing on the previous chunk's silence", async () => {
      const chunkAborts: unknown[] = [];

      const run = startRun(
        "run-chunk-rearm",
        "thread-chunk-rearm",
        async (send, signal, control) => {
          let current = signal;
          for (let i = 0; i < 2; i++) {
            await new Promise<void>((resolve) => {
              current.addEventListener("abort", () => resolve(), {
                once: true,
              });
            });
            chunkAborts.push(current.reason);
            current = control.beginChunk();
          }
          await new Promise<void>((resolve) => {
            current.addEventListener("abort", () => resolve(), { once: true });
          });
        },
        undefined,
        {
          softTimeoutMs: BACKGROUND_SOFT_TIMEOUT_CEILING_MS,
          backgroundFunction: true,
          recoverChunkBoundaries: true,
        },
      );
      run.subscribers.add(() => {});

      await vi.advanceTimersByTimeAsync(
        DEFAULT_BACKGROUND_NO_PROGRESS_TIMEOUT_MS + 1,
      );
      expect(chunkAborts).toEqual(["no_progress"]);

      await vi.advanceTimersByTimeAsync(
        DEFAULT_BACKGROUND_NO_PROGRESS_TIMEOUT_MS - 5_000,
      );
      expect(chunkAborts).toEqual(["no_progress"]);
      await vi.advanceTimersByTimeAsync(5_001);
      expect(chunkAborts).toEqual(["no_progress", "no_progress"]);

      expect(abortRun("run-chunk-rearm")).toBe(true);
      await run.finalized;
    });

    it("still ends the turn immediately on a user Stop", async () => {
      let turnAborted = false;
      let boundaryReason: string | null = "unset";

      const run = startRun(
        "run-chunk-user-stop",
        "thread-chunk-user-stop",
        async (send, signal, control) => {
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
          turnAborted = control.turnSignal.aborted;
          boundaryReason = control.chunkBoundaryReason();
          expect(control.beginChunk().aborted).toBe(true);
        },
        undefined,
        {
          softTimeoutMs: BACKGROUND_SOFT_TIMEOUT_CEILING_MS,
          backgroundFunction: true,
          recoverChunkBoundaries: true,
        },
      );
      run.subscribers.add(() => {});

      expect(abortRun("run-chunk-user-stop")).toBe(true);
      await run.finalized;

      expect(turnAborted).toBe(true);
      expect(boundaryReason).toBeNull();
      expect(run.status).toBe("aborted");
    });

    it("still cancels the chunk opened AFTER a recovery when the turn aborts", async () => {
      let recoveredChunk: AbortSignal | undefined;
      let recoveredChunkAbortReason: unknown;

      const run = startRun(
        "run-chunk-abort-after-recovery",
        "thread-chunk-abort-after-recovery",
        async (send, signal, control) => {
          const keepaliveTimer = setInterval(() => {
            send({ type: "stream_keepalive" });
          }, 1500);
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
          clearInterval(keepaliveTimer);
          recoveredChunk = control.beginChunk();
          await new Promise<void>((resolve) => {
            recoveredChunk!.addEventListener(
              "abort",
              () => {
                recoveredChunkAbortReason = recoveredChunk!.reason;
                resolve();
              },
              { once: true },
            );
          });
        },
        undefined,
        {
          softTimeoutMs: BACKGROUND_SOFT_TIMEOUT_CEILING_MS,
          backgroundFunction: true,
          recoverChunkBoundaries: true,
        },
      );
      run.subscribers.add(() => {});

      await vi.advanceTimersByTimeAsync(
        DEFAULT_BACKGROUND_NO_PROGRESS_TIMEOUT_MS + 1,
      );
      expect(recoveredChunk).toBeDefined();
      expect(recoveredChunk!.aborted).toBe(false);

      expect(abortRun("run-chunk-abort-after-recovery", "user")).toBe(true);
      await run.finalized;

      expect(recoveredChunkAbortReason).toBe("user");
      expect(run.status).toBe("aborted");
    });

    it("reports a run that ends on a terminal error event as errored, not completed", async () => {
      const completions: string[] = [];

      const run = startRun(
        "run-terminal-error-return",
        "thread-terminal-error-return",
        async (send) => {
          send({ type: "text", text: "partial" });
          send({
            type: "error",
            error: "I ran out of time before finishing this step.",
            errorCode: "run_budget_exhausted",
            recoverable: false,
          });
        },
        (completed) => {
          completions.push(completed.status);
        },
        { softTimeoutMs: 0 },
      );

      await run.finalized;

      expect(completions).toEqual(["errored"]);
      expect(run.status).toBe("errored");
      expect(getRun("run-terminal-error-return")?.status).toBe("errored");
    });

    it("counts a boundary as recovered only once a round actually starts", async () => {
      const boundaryEvents: Array<Record<string, unknown>> = [];
      track.mockImplementation((name: string, properties: unknown) => {
        if (name === "agent_run_boundary") {
          boundaryEvents.push(properties as Record<string, unknown>);
        }
      });

      const run = startRun(
        "run-boundary-not-recovered",
        "thread-boundary-not-recovered",
        async (send, signal) => {
          const keepaliveTimer = setInterval(() => {
            send({ type: "stream_keepalive" });
          }, 1500);
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
          clearInterval(keepaliveTimer);
          // Gives up instead of calling beginChunk() — the budget-exhausted case.
        },
        undefined,
        {
          softTimeoutMs: BACKGROUND_SOFT_TIMEOUT_CEILING_MS,
          backgroundFunction: true,
          recoverChunkBoundaries: true,
        },
      );
      run.subscribers.add(() => {});

      await vi.advanceTimersByTimeAsync(
        DEFAULT_BACKGROUND_NO_PROGRESS_TIMEOUT_MS + 1,
      );
      await run.finalized;

      await vi.waitFor(() => expect(boundaryEvents.length).toBe(1));
      expect(boundaryEvents[0]).toMatchObject({
        reason: "no_progress",
        recovered: false,
      });
    });

    it("counts a boundary as recovered when the caller opens the next round", async () => {
      const boundaryEvents: Array<Record<string, unknown>> = [];
      track.mockImplementation((name: string, properties: unknown) => {
        if (name === "agent_run_boundary") {
          boundaryEvents.push(properties as Record<string, unknown>);
        }
      });
      let finish: (() => void) | undefined;

      const run = startRun(
        "run-boundary-recovered",
        "thread-boundary-recovered",
        async (send, signal, control) => {
          const keepaliveTimer = setInterval(() => {
            send({ type: "stream_keepalive" });
          }, 1500);
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
          clearInterval(keepaliveTimer);
          const next = control.beginChunk();
          await new Promise<void>((resolve) => {
            finish = resolve;
            next.addEventListener("abort", () => resolve(), { once: true });
          });
        },
        undefined,
        {
          softTimeoutMs: BACKGROUND_SOFT_TIMEOUT_CEILING_MS,
          backgroundFunction: true,
          recoverChunkBoundaries: true,
        },
      );
      run.subscribers.add(() => {});

      await vi.advanceTimersByTimeAsync(
        DEFAULT_BACKGROUND_NO_PROGRESS_TIMEOUT_MS + 1,
      );
      await vi.waitFor(() => expect(boundaryEvents.length).toBe(1));
      expect(boundaryEvents[0]).toMatchObject({
        reason: "no_progress",
        recovered: true,
      });

      finish?.();
      await run.finalized;
    });

    it("keeps the terminal turn-ending checkpoint for a run that did not opt in", async () => {
      let abortReason: unknown;

      const run = startRun(
        "run-chunk-not-opted-in",
        "thread-chunk-not-opted-in",
        async (send, signal) => {
          const keepaliveTimer = setInterval(() => {
            send({ type: "stream_keepalive" });
          }, 1500);
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => {
              clearInterval(keepaliveTimer);
              abortReason = signal.reason;
              resolve();
            });
          });
        },
        undefined,
        {
          softTimeoutMs: BACKGROUND_SOFT_TIMEOUT_CEILING_MS,
          backgroundFunction: true,
        },
      );
      run.subscribers.add(() => {});

      await vi.advanceTimersByTimeAsync(
        DEFAULT_BACKGROUND_NO_PROGRESS_TIMEOUT_MS + 1,
      );

      expect(abortReason).toBe("no_progress");
      expect(run.events.at(-1)?.event).toMatchObject({
        type: "auto_continue",
        reason: "no_progress",
      });
      expect(vi.mocked(persistRunCheckpointEvent)).toHaveBeenCalledWith(
        "run-chunk-not-opted-in",
        { type: "auto_continue", reason: "no_progress" },
        "no_progress",
      );
    });
  });

  describe("terminal tracking event", () => {
    it("does not emit when status persistence and reconciliation both fail", async () => {
      vi.mocked(updateRunStatusIfRunning).mockRejectedValueOnce(
        new Error("status persistence failed"),
      );
      vi.mocked(reconcileTerminalRunFromEvents).mockResolvedValueOnce(false);

      const run = startRun(
        "run-tracking-persistence-failed",
        "thread-tracking-persistence-failed",
        async (send) => {
          send({ type: "text", text: "fast answer" });
        },
        undefined,
        { softTimeoutMs: 0 },
      );

      await run.finalized;

      expect(reconcileTerminalRunFromEvents).toHaveBeenCalledWith(
        "run-tracking-persistence-failed",
      );
      expect(track).not.toHaveBeenCalled();
    });

    it("emits after reconciliation positively confirms terminal persistence", async () => {
      vi.mocked(updateRunStatusIfRunning).mockResolvedValueOnce(false);
      vi.mocked(reconcileTerminalRunFromEvents).mockResolvedValueOnce(true);

      const run = startRun(
        "run-tracking-reconciled",
        "thread-tracking-reconciled",
        async (send) => {
          send({ type: "text", text: "fast answer" });
        },
        undefined,
        { softTimeoutMs: 0 },
      );

      await run.finalized;
      await vi.waitFor(() => expect(track).toHaveBeenCalledTimes(1));

      expect(reconcileTerminalRunFromEvents).toHaveBeenCalledWith(
        "run-tracking-reconciled",
      );
      expect(track).toHaveBeenCalledWith(
        "agent_run_terminal",
        expect.objectContaining({
          run_id: "run-tracking-reconciled",
          status: "completed",
          terminal_reason: "done",
        }),
        expect.anything(),
      );
    });

    it("emits exactly one agent_run_terminal event on a normal completion", async () => {
      startRun(
        "run-tracking-done",
        "thread-tracking-done",
        async (send) => {
          send({ type: "text", text: "fast answer" });
        },
        undefined,
        { softTimeoutMs: 0 },
      );

      await vi.waitFor(() => expect(track).toHaveBeenCalledTimes(1));

      expect(track).toHaveBeenCalledWith(
        "agent_run_terminal",
        expect.objectContaining({
          run_id: "run-tracking-done",
          thread_id: "thread-tracking-done",
          turn_id: "run-tracking-done",
          status: "completed",
          terminal_reason: "done",
          duration_ms: expect.any(Number),
          app: "test-app",
        }),
        expect.anything(),
      );
      const [, properties] = vi.mocked(track).mock.calls[0];
      expect(properties).not.toHaveProperty("error_code");
      expect(properties).not.toHaveProperty("error_detail");
      expect(properties).not.toHaveProperty("abort_reason");
      expect(properties).not.toHaveProperty("dispatch_mode");
    });

    it("emits an aborted event with the abort reason, not a false completion", async () => {
      startRun(
        "run-tracking-abort",
        "thread-tracking-abort",
        async (send, signal) => {
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
        },
        undefined,
        { softTimeoutMs: 0 },
      );

      expect(abortRun("run-tracking-abort")).toBe(true);

      await vi.waitFor(() => expect(track).toHaveBeenCalledTimes(1));

      expect(track).toHaveBeenCalledWith(
        "agent_run_terminal",
        expect.objectContaining({
          run_id: "run-tracking-abort",
          status: "aborted",
          terminal_reason: "aborted:user",
          abort_reason: "user",
        }),
        expect.anything(),
      );
    });

    it("emits an errored event carrying error_code and error_detail", async () => {
      startRun(
        "run-tracking-error",
        "thread-tracking-error",
        async () => {
          throw new Error("boom");
        },
        undefined,
        { softTimeoutMs: 0 },
      );

      await vi.waitFor(() => expect(track).toHaveBeenCalledTimes(1));

      expect(track).toHaveBeenCalledWith(
        "agent_run_terminal",
        expect.objectContaining({
          run_id: "run-tracking-error",
          status: "errored",
          terminal_reason: "error:unknown",
          error_code: "unknown",
          error_detail: "boom",
        }),
        expect.anything(),
      );
    });

    it("reports a soft-timeout continuation boundary as truncated, not completed", async () => {
      startRun(
        "run-tracking-truncated",
        "thread-tracking-truncated",
        async (send, signal) => {
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
        },
        undefined,
        { softTimeoutMs: 1_000 },
      );

      await vi.advanceTimersByTimeAsync(1_001);
      await vi.waitFor(() => expect(track).toHaveBeenCalledTimes(2));

      expect(track).toHaveBeenCalledWith(
        "agent_run_boundary",
        expect.objectContaining({
          run_id: "run-tracking-truncated",
          reason: "run_timeout",
          recovered: false,
        }),
        expect.anything(),
      );
      expect(track).toHaveBeenCalledWith(
        "agent_run_terminal",
        expect.objectContaining({
          run_id: "run-tracking-truncated",
          status: "truncated",
          terminal_reason: "run_timeout",
        }),
        expect.anything(),
      );
    });

    it("omits dispatch_mode rather than calling an unlabelled run foreground", async () => {
      startRun(
        "run-dispatch-mode-absent",
        "thread-dispatch-mode-absent",
        async (send) => {
          send({ type: "text", text: "answer" });
        },
        undefined,
        { softTimeoutMs: 0 },
      );

      await vi.waitFor(() => expect(track).toHaveBeenCalled());
      const [, properties] =
        track.mock.calls.find(([name]) => name === "agent_run_terminal") ?? [];
      expect(properties).toBeDefined();
      expect(properties).not.toHaveProperty("dispatch_mode");
    });

    it("reports the caller's dispatch mode when it supplies one", async () => {
      startRun(
        "run-dispatch-mode-background",
        "thread-dispatch-mode-background",
        async (send) => {
          send({ type: "text", text: "answer" });
        },
        undefined,
        { softTimeoutMs: 0, dispatchMode: "background" },
      );

      await vi.waitFor(() =>
        expect(
          track.mock.calls.some(
            ([name, properties]) =>
              name === "agent_run_terminal" &&
              (properties as Record<string, unknown>).dispatch_mode ===
                "background",
          ),
        ).toBe(true),
      );
    });

    it("forwards model, engine, and attempt_count when the caller supplies them", async () => {
      startRun(
        "run-tracking-model",
        "thread-tracking-model",
        async (send) => {
          send({ type: "text", text: "answer" });
        },
        undefined,
        {
          softTimeoutMs: 0,
          model: "gpt-5-6-sol",
          engineName: "openai",
          attemptCount: 2,
        },
      );

      await vi.waitFor(() => expect(track).toHaveBeenCalledTimes(1));

      expect(track).toHaveBeenCalledWith(
        "agent_run_terminal",
        expect.objectContaining({
          run_id: "run-tracking-model",
          model: "gpt-5-6-sol",
          engine: "openai",
          attempt_count: 2,
        }),
        expect.anything(),
      );
    });

    it("omits model/engine from the event rather than emitting them empty when unknown", async () => {
      startRun(
        "run-tracking-no-model",
        "thread-tracking-no-model",
        async (send) => {
          send({ type: "text", text: "answer" });
        },
        undefined,
        { softTimeoutMs: 0 },
      );

      await vi.waitFor(() => expect(track).toHaveBeenCalledTimes(1));

      const [, properties] = vi.mocked(track).mock.calls[0];
      expect(properties).not.toHaveProperty("model");
      expect(properties).not.toHaveProperty("engine");
      expect(properties).not.toHaveProperty("attempt_count");
    });

    it("carries a model resolved mid-run via mutation of the same options object", async () => {
      const runOptions: Parameters<typeof startRun>[4] = { softTimeoutMs: 0 };
      startRun(
        "run-tracking-late-model",
        "thread-tracking-late-model",
        async (send) => {
          runOptions.model = "resolved-late-model";
          send({ type: "text", text: "answer" });
        },
        undefined,
        runOptions,
      );

      await vi.waitFor(() => expect(track).toHaveBeenCalledTimes(1));

      expect(track).toHaveBeenCalledWith(
        "agent_run_terminal",
        expect.objectContaining({
          run_id: "run-tracking-late-model",
          model: "resolved-late-model",
        }),
        expect.anything(),
      );
    });
  });
});

describe("engineRequestShapeTags", () => {
  it("reports what was sent as searchable string tags", () => {
    expect(
      engineRequestShapeTags({
        model: "gpt-5-6-sol",
        payloadBytes: 131072,
        toolCount: 39,
        messageCount: 13,
      }),
    ).toEqual({
      engineModel: "gpt-5-6-sol",
      enginePayloadBytes: "131072",
      engineToolCount: "39",
      engineMessageCount: "13",
    });
  });

  it("emits nothing when the failure happened before a request was built", () => {
    expect(engineRequestShapeTags(undefined)).toEqual({});
  });
});
