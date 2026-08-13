import { beforeEach, describe, expect, it, vi } from "vitest";

interface ExecCall {
  sql: string;
  args: unknown[];
}

const execCalls: ExecCall[] = [];
let latestEventRows: Array<{
  seq: number;
  event_at?: number | null;
  event_data: string;
}> = [];
let staleSelectRows: Array<{ id: string }> = [];
let claimSlotRows: Array<{ id: string }> = [];
let runStatusRows: Array<{ status: string }> = [];
let claimStateRows: Array<{
  dispatch_mode: string | null;
  status: string | null;
  diag_stage?: string | null;
  started_at?: number | null;
  heartbeat_at?: number | null;
}> = [];
let runListRows: Array<Record<string, unknown>> = [];
let refreshedRunListRows: Array<Record<string, unknown>> | null = null;
let runListSelectCount = 0;
let runOwnerRows: Array<{ owner_email: string | null }> = [];
let insertEventBehavior: () => void = () => {};
let abortRowsAffected = 1;
let dispatchPayloadRows: Array<{ dispatch_payload: string | null }> = [];
let unclaimedBackgroundRunRows: Array<{ id: string }> = [];
let unclaimedBackgroundRunRowsWithStartedAt: Array<{
  id: string;
  started_at: number;
  has_dispatch_payload?: boolean | number;
}> = [];
let runCountRows: Array<{ run_count: number }> = [];
// claimBackgroundRun CAS simulation: the real DB row only has `dispatch_mode
// = 'background'` ONCE, so only the FIRST `claimBackgroundRun` UPDATE for a
// given runId can match the WHERE clause; every subsequent attempt (a
// concurrent redispatch, a duplicate delivery, ...) must see rowsAffected=0.
// Modeled as a Set of already-claimed run ids rather than a single counter so
// a test can prove per-row independence too.
const claimedBackgroundRunIds = new Set<string>();

const mockDb = {
  execute: vi.fn(async (sql: string | { sql: string; args?: unknown[] }) => {
    const rawSql = typeof sql === "string" ? sql : sql.sql;
    const args = typeof sql === "string" ? [] : (sql.args ?? []);
    execCalls.push({ sql: rawSql, args });

    if (
      /SELECT seq,\s*event_data(?:,\s*event_at)?\s+FROM agent_run_events/i.test(
        rawSql,
      )
    ) {
      return { rows: latestEventRows, rowsAffected: 0 };
    }
    // tryClaimRunSlot: SELECT id FROM agent_runs WHERE thread_id = ? AND ...
    // Must come before the broader stale-run SELECT check since both match
    // "SELECT id FROM agent_runs ... status = 'running'". Matches both the
    // livenessBasisSql CASE expression and any legacy heartbeat-only form.
    if (
      /SELECT id FROM agent_runs\s*WHERE thread_id/i.test(rawSql) &&
      (/COALESCE\(last_progress_at, started_at\)/i.test(rawSql) ||
        /COALESCE\(heartbeat_at, started_at\)\s*>=/i.test(rawSql))
    ) {
      return { rows: claimSlotRows, rowsAffected: 0 };
    }
    // listUnclaimedBackgroundRunRows: SELECT id, started_at FROM agent_runs
    // WHERE status = 'running' AND dispatch_mode = 'background' AND ... Must
    // come before the narrower id-only variant below (both match
    // "dispatch_mode = 'background'").
    if (
      /SELECT id, started_at.*FROM agent_runs\s*WHERE status = 'running'/is.test(
        rawSql,
      ) &&
      /dispatch_mode = 'background'/i.test(rawSql)
    ) {
      return { rows: unclaimedBackgroundRunRowsWithStartedAt, rowsAffected: 0 };
    }
    // listUnclaimedBackgroundRunIds: SELECT id FROM agent_runs WHERE status =
    // 'running' AND dispatch_mode = 'background' AND ... Must also come before
    // the broader stale-run SELECT check below, which matches the same shape.
    if (
      /SELECT id FROM agent_runs\s*WHERE status = 'running'/i.test(rawSql) &&
      /dispatch_mode = 'background'/i.test(rawSql)
    ) {
      return { rows: unclaimedBackgroundRunRows, rowsAffected: 0 };
    }
    // hasRunningRuns probe. `status = 'running'` is a superset of every sweep
    // fixture below, so the double must report a row whenever ANY of them is
    // populated — a probe that disagrees with the fixture it guards would
    // short-circuit the very sweep the test is exercising.
    if (
      /SELECT id FROM agent_runs WHERE status = 'running' LIMIT 1/i.test(rawSql)
    ) {
      const anyRunning = [
        ...staleSelectRows,
        ...unclaimedBackgroundRunRows,
        ...unclaimedBackgroundRunRowsWithStartedAt,
      ];
      return { rows: anyRunning.slice(0, 1), rowsAffected: 0 };
    }
    if (/SELECT id FROM agent_runs[\s\S]*status = 'running'/i.test(rawSql)) {
      return { rows: staleSelectRows, rowsAffected: 0 };
    }
    // getRunStatus: SELECT status FROM agent_runs WHERE id = ?
    if (/SELECT status FROM agent_runs WHERE id/i.test(rawSql)) {
      return { rows: runStatusRows, rowsAffected: 0 };
    }
    if (
      /SELECT id, thread_id, turn_id, status, started_at, heartbeat_at, completed_at, last_progress_at, error_code, abort_reason, dispatch_mode, terminal_reason, diag_stage/i.test(
        rawSql,
      ) &&
      /WHERE thread_id = \?/i.test(rawSql) &&
      /LIMIT \?/i.test(rawSql)
    ) {
      const rows =
        refreshedRunListRows && runListSelectCount > 0
          ? refreshedRunListRows
          : runListRows;
      runListSelectCount++;
      return { rows, rowsAffected: 0 };
    }
    // readBackgroundRunClaim: SELECT dispatch_mode, status, diag_stage, started_at, heartbeat_at FROM agent_runs WHERE id = ?
    if (
      /SELECT dispatch_mode, status, diag_stage.*FROM agent_runs WHERE id/i.test(
        rawSql,
      )
    ) {
      return { rows: claimStateRows, rowsAffected: 0 };
    }
    // getRunOwnerEmail: SELECT t.owner_email FROM agent_runs r JOIN chat_threads t ...
    if (/JOIN chat_threads/i.test(rawSql)) {
      return { rows: runOwnerRows, rowsAffected: 0 };
    }
    if (/INSERT INTO agent_run_events/i.test(rawSql)) {
      insertEventBehavior();
      return { rows: [], rowsAffected: 1 };
    }
    if (/UPDATE agent_runs SET status = 'aborted'/i.test(rawSql)) {
      return { rows: [], rowsAffected: abortRowsAffected };
    }
    // Tool-call result ledger: SELECT result_summary FROM agent_tool_ledger
    if (/SELECT result_summary FROM agent_tool_ledger/i.test(rawSql)) {
      return { rows: ledgerRows, rowsAffected: 0 };
    }
    // readRunDispatchPayload: SELECT dispatch_payload FROM agent_runs WHERE id = ?
    if (/SELECT dispatch_payload FROM agent_runs WHERE id/i.test(rawSql)) {
      return { rows: dispatchPayloadRows, rowsAffected: 0 };
    }
    // countRunsForTurn: SELECT COUNT(*) AS run_count FROM agent_runs WHERE thread_id = ? AND turn_id = ?
    if (/SELECT COUNT\(\*\) AS run_count FROM agent_runs/i.test(rawSql)) {
      return { rows: runCountRows, rowsAffected: 0 };
    }
    // claimBackgroundRun: UPDATE agent_runs SET dispatch_mode =
    // 'background-processing' WHERE id = ? AND status = 'running' AND
    // dispatch_mode = 'background'. Stateful CAS simulation — see
    // `claimedBackgroundRunIds`.
    if (
      /UPDATE agent_runs\s*SET dispatch_mode = 'background-processing'/i.test(
        rawSql,
      )
    ) {
      const runId = String(args[0]);
      if (claimedBackgroundRunIds.has(runId)) {
        return { rows: [], rowsAffected: 0 };
      }
      claimedBackgroundRunIds.add(runId);
      return { rows: [], rowsAffected: 1 };
    }

    return {
      rows: [],
      rowsAffected: /^\s*(UPDATE|INSERT|DELETE)\b/i.test(rawSql) ? 1 : 0,
    };
  }),
};

const mockCaptureError = vi.fn();

vi.mock("../db/client.js", () => ({
  getDbExec: () => mockDb,
  intType: () => "INTEGER",
  isPostgres: () => false,
}));

vi.mock("../server/capture-error.js", () => ({
  captureError: mockCaptureError,
}));

const {
  STALE_RUN_ERROR_EVENT,
  STALE_RUN_TERMINAL_REASON,
  markRunAborted,
  reapAllStaleRuns,
  reapIfStale,
  cleanupOldRuns,
  tryClaimRunSlot,
  updateRunStatusIfRunning,
  updateRunStatus,
  bumpRunProgress,
  getRunStatus,
  listRunsForThread,
  readBackgroundRunClaim,
  getRunOwnerEmail,
  writeLedgerEntry,
  readLedgerEntry,
  clearLedgerForThread,
  insertRun,
  insertRunEvent,
  readRunDispatchPayload,
  clearRunDispatchPayload,
  listUnclaimedBackgroundRunIds,
  listUnclaimedBackgroundRunRows,
  countRunsForTurn,
  UNCLAIMED_BACKGROUND_RUN_REDISPATCH_BOUND_MS,
  UNCLAIMED_BACKGROUND_RUN_GRACE_MS,
  UNCLAIMED_BACKGROUND_RUN_FAST_SWEEP_MS,
  shouldRedispatchUnclaimedBackgroundRun,
  claimBackgroundRun,
  terminalEventForAbortReason,
  persistRunCheckpointEvent,
  reconcileTerminalRunFromEvents,
  setRunTerminalReason,
  getRunEventsSince,
  CHECKPOINT_TERMINAL_EVENT_SEQ,
  getCurrentTurnEventsForThread,
  __resetNoRunningRunsProbeForTests,
} = await import("./run-store.js");

// Mock storage for ledger SELECT responses, keyed by toolKey
let ledgerRows: Array<{ result_summary: string }> = [];

describe("run store", () => {
  beforeEach(() => {
    execCalls.length = 0;
    latestEventRows = [];
    staleSelectRows = [];
    claimSlotRows = [];
    runStatusRows = [];
    claimStateRows = [];
    runListRows = [];
    refreshedRunListRows = null;
    runListSelectCount = 0;
    claimedBackgroundRunIds.clear();
    runOwnerRows = [];
    ledgerRows = [];
    dispatchPayloadRows = [];
    unclaimedBackgroundRunRows = [];
    unclaimedBackgroundRunRowsWithStartedAt = [];
    runCountRows = [];
    insertEventBehavior = () => {};
    abortRowsAffected = 1;
    __resetNoRunningRunsProbeForTests();
    vi.clearAllMocks();
  });

  it("readBackgroundRunClaim parses dispatch_mode + status + diag_stage + liveness, or null when missing", async () => {
    claimStateRows = [
      {
        dispatch_mode: "background",
        status: "running",
        diag_stage: '{"stage":"route_entered"}',
        started_at: 1000,
        heartbeat_at: null,
      },
    ];
    expect(await readBackgroundRunClaim("run-bg")).toEqual({
      dispatchMode: "background",
      status: "running",
      diagStage: '{"stage":"route_entered"}',
      workerStage: null,
      lastLivenessAt: 1000, // COALESCE(heartbeat_at, started_at)
    });

    claimStateRows = [
      {
        dispatch_mode: "background-processing",
        status: "running",
        started_at: 2000,
        heartbeat_at: 2500,
      },
    ];
    expect(await readBackgroundRunClaim("run-claimed")).toEqual({
      dispatchMode: "background-processing",
      status: "running",
      diagStage: null,
      workerStage: null,
      lastLivenessAt: 2500, // heartbeat_at wins over started_at
    });

    claimStateRows = [];
    expect(await readBackgroundRunClaim("run-missing")).toBeNull();
  });

  it("getRunOwnerEmail resolves the thread owner for a run, or null when missing", async () => {
    runOwnerRows = [{ owner_email: "owner@example.com" }];
    expect(await getRunOwnerEmail("run-1")).toBe("owner@example.com");
    // resolves by joining agent_runs to chat_threads, keyed by the runId only —
    // the caller cannot supply the owner, only select the HMAC-signed run row.
    const joinCall = execCalls.find((c) => /JOIN chat_threads/i.test(c.sql));
    expect(joinCall).toBeTruthy();
    expect(joinCall?.args).toEqual(["run-1"]);

    runOwnerRows = [];
    expect(await getRunOwnerEmail("run-missing")).toBeNull();
  });

  it("persists a terminal event when marking a run aborted", async () => {
    await markRunAborted("run-abort");

    const update = execCalls.find((call) =>
      /UPDATE agent_runs SET status = 'aborted'/i.test(call.sql),
    );
    expect(update?.args[0]).toBe("user");
    expect(update?.args[2]).toBe("aborted:user");
    expect(update?.args[3]).toBe("run-abort");

    const insert = execCalls.find((call) =>
      /INSERT INTO agent_run_events/i.test(call.sql),
    );
    expect(insert?.args[0]).toBe("run-abort");
    expect(insert?.args[1]).toBe(0);
    expect(typeof insert?.args[2]).toBe("number");
    expect(insert?.args[3]).toBe('{"type":"done","reason":"user"}');
  });

  it("persists a reason-shaped terminal event for a recovery abort", async () => {
    // A synthetic `done` is indistinguishable from a real finish on the wire —
    // 45 of 49 prod no_progress runs ended on one, and the client rendered
    // every one as "the agent stopped without sending a final message".
    await markRunAborted("run-abort-no-progress", "no_progress");

    const insert = execCalls.find((call) =>
      /INSERT INTO agent_run_events/i.test(call.sql),
    );
    expect(insert?.args[3]).toBe(
      '{"type":"auto_continue","reason":"no_progress"}',
    );
  });

  it("maps abort reasons to truthful terminal events", () => {
    expect(terminalEventForAbortReason("run_timeout")).toEqual({
      type: "auto_continue",
      reason: "run_timeout",
    });
    expect(terminalEventForAbortReason(undefined)).toEqual({
      type: "done",
      reason: "user",
    });
    expect(terminalEventForAbortReason("user")).toEqual({
      type: "done",
      reason: "user",
    });
    expect(terminalEventForAbortReason("user_stuck_retry")).toEqual({
      type: "done",
      reason: "user",
    });
    // The displacing writer already recorded the row's real terminal state.
    expect(terminalEventForAbortReason("displaced")).toEqual({ type: "done" });
    expect(terminalEventForAbortReason("background_worker_died")).toEqual({
      type: "error",
      error: "The agent run was stopped before it finished.",
      errorCode: "aborted_background_worker_died",
      recoverable: true,
    });
    expect(terminalEventForAbortReason("slack_cancel")).toEqual({
      type: "error",
      error: "The agent run was stopped before it finished.",
      errorCode: "aborted_slack_cancel",
      recoverable: false,
    });
  });

  it("writes a chunk-boundary checkpoint into the reserved seq band", async () => {
    await persistRunCheckpointEvent(
      "run-checkpoint",
      { type: "auto_continue", reason: "run_timeout" },
      "run_timeout",
    );

    const insert = execCalls.find((call) =>
      /INSERT INTO agent_run_events/i.test(call.sql),
    );
    expect(insert?.args[1]).toBe(CHECKPOINT_TERMINAL_EVENT_SEQ);
    expect(insert?.args[3]).toBe(
      '{"type":"auto_continue","reason":"run_timeout"}',
    );
    const reason = execCalls.find((call) =>
      /UPDATE agent_runs SET terminal_reason/i.test(call.sql),
    );
    expect(reason?.args).toEqual(["run_timeout", "run-checkpoint"]);
  });

  it("hides the reserved checkpoint band from the live event feed", async () => {
    // Streaming the checkpoint to a live subscriber would close the SSE stream
    // at the chunk boundary before onComplete has made thread_data durable.
    await getRunEventsSince("run-feed", 3);

    const select = execCalls.find((call) =>
      /SELECT seq, event_data FROM agent_run_events WHERE run_id = \? AND seq >= \?/i.test(
        call.sql,
      ),
    );
    expect(select?.sql).toMatch(/AND seq < \?/i);
    expect(select?.args).toEqual([
      "run-feed",
      3,
      CHECKPOINT_TERMINAL_EVENT_SEQ,
    ]);
  });

  it("atomically rejects producer events after the run becomes terminal", async () => {
    await insertRunEvent(
      "run-terminal",
      8,
      '{"type":"thinking","text":"zombie"}',
    );

    const insert = execCalls.find((call) =>
      /INSERT INTO agent_run_events/i.test(call.sql),
    );
    expect(insert?.sql).toMatch(
      /WHERE NOT EXISTS\s*\(\s*SELECT 1 FROM agent_runs\s*WHERE id = \? AND status <> 'running'/i,
    );
    expect(insert?.args).toEqual([
      "run-terminal",
      8,
      expect.any(Number),
      '{"type":"thinking","text":"zombie"}',
      "run-terminal",
    ]);
  });

  it("never lets an older progress write move the stored timestamp backward", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(12_345);

    await bumpRunProgress("run-progress");
    nowSpy.mockRestore();

    const update = execCalls.find((call) =>
      /UPDATE agent_runs SET last_progress_at/i.test(call.sql),
    );
    expect(update?.sql).toMatch(
      /CASE WHEN last_progress_at IS NULL OR last_progress_at < \? THEN \? ELSE last_progress_at END/i,
    );
    expect(update?.sql).toMatch(/AND status = 'running'/i);
    expect(update?.args).toEqual([12_345, 12_345, "run-progress"]);
  });

  it("does not append another terminal event after auto_continue", async () => {
    latestEventRows = [
      {
        seq: 4,
        event_data: JSON.stringify({
          type: "auto_continue",
          reason: "run_timeout",
        }),
      },
    ];

    await markRunAborted("run-abort-after-terminal", "no_progress");

    const eventInserts = execCalls.filter((call) =>
      /INSERT INTO agent_run_events/i.test(call.sql),
    );
    expect(eventInserts).toHaveLength(0);
  });

  it("does not rewrite a run that is already terminal", async () => {
    abortRowsAffected = 0;

    await markRunAborted("run-already-completed", "user");

    const update = execCalls.find((call) =>
      /UPDATE agent_runs SET status = 'aborted'/i.test(call.sql),
    );
    expect(update?.sql).toMatch(/AND status = 'running'/i);
    const eventInserts = execCalls.filter((call) =>
      /INSERT INTO agent_run_events/i.test(call.sql),
    );
    expect(eventInserts).toHaveLength(0);
  });

  it("retries a failed terminal-event insert before giving up", async () => {
    let attempts = 0;
    insertEventBehavior = () => {
      attempts++;
      if (attempts === 1) throw new Error("transient SQL blip");
    };

    await markRunAborted("run-retry-success");

    expect(attempts).toBe(2);
    expect(mockCaptureError).not.toHaveBeenCalled();
  });

  it("captures to Sentry when the terminal-event retry also fails", async () => {
    insertEventBehavior = () => {
      throw new Error("DB unavailable");
    };

    await markRunAborted("run-retry-fail");

    expect(mockCaptureError).toHaveBeenCalledTimes(1);
    const [err, ctx] = mockCaptureError.mock.calls[0];
    expect((err as Error).message).toBe("DB unavailable");
    expect(ctx?.tags?.operation).toBe("append-terminal-event");
    expect(ctx?.tags?.source).toBe("mark-aborted");
    expect(ctx?.extra?.runId).toBe("run-retry-fail");
  });

  it("persists stale error diagnostics and appends a terminal event for runs reaped by reapIfStale", async () => {
    await reapIfStale("run-stale");

    const update = execCalls.find((call) =>
      /UPDATE agent_runs[\s\S]*SET status = 'errored'[\s\S]*WHERE id = \?/i.test(
        call.sql,
      ),
    );
    expect(update?.sql).toContain("error_code = ?");
    expect(update?.sql).toContain("error_detail = ?");
    expect(update?.sql).toContain("terminal_reason = ?");
    // `completed_at` is no longer bound — it comes from the row's liveness
    // basis, so the SET list binds exactly these three.
    expect(update?.args[0]).toBe(STALE_RUN_ERROR_EVENT.errorCode);
    expect(update?.args[1]).toBe(STALE_RUN_ERROR_EVENT.details);
    expect(update?.args[2]).toBe(STALE_RUN_TERMINAL_REASON);
    expect(update?.args[3]).toBe("run-stale");

    const insert = execCalls.find((call) =>
      /INSERT INTO agent_run_events/i.test(call.sql),
    );
    expect(insert?.args[0]).toBe("run-stale");
    expect(typeof insert?.args[2]).toBe("number");
    const eventJson = insert?.args[3] as string;
    expect(JSON.parse(eventJson)).toEqual(STALE_RUN_ERROR_EVENT);
  });

  it("reconciles a persisted terminal event instead of stale-reaping the run", async () => {
    latestEventRows = [
      {
        seq: 9,
        event_at: 123_456,
        event_data: JSON.stringify({ type: "done" }),
      },
    ];

    const reaped = await reapIfStale("run-done-event");

    expect(reaped).toBe(false);
    const repair = execCalls.find(
      (call) =>
        /UPDATE agent_runs/i.test(call.sql) &&
        /SET status = \?/i.test(call.sql),
    );
    expect(repair?.args[0]).toBe("completed");
    expect(repair?.args[1]).toBe(123_456);
    expect(repair?.args[2]).toBeNull();
    expect(repair?.args[3]).toBeNull();
    expect(repair?.args[4]).toBe("done");
    expect(repair?.args[5]).toBe("run-done-event");
    expect(
      execCalls.some(
        (call) =>
          /UPDATE agent_runs[\s\S]*SET status = 'errored'/i.test(call.sql) &&
          call.args.includes("run-done-event"),
      ),
    ).toBe(false);
  });

  it("reconciles missing credential terminal events as errored runs", async () => {
    latestEventRows = [
      {
        seq: 9,
        event_at: 123_456,
        event_data: JSON.stringify({ type: "missing_api_key" }),
      },
    ];

    const reaped = await reapIfStale("run-missing-key-event");

    expect(reaped).toBe(false);
    const repair = execCalls.find(
      (call) =>
        /UPDATE agent_runs/i.test(call.sql) &&
        /SET status = \?/i.test(call.sql),
    );
    expect(repair?.args[0]).toBe("errored");
    expect(repair?.args[1]).toBe(123_456);
    expect(repair?.args[2]).toBe("missing_credentials");
    expect(repair?.args[3]).toEqual(
      expect.stringContaining("No LLM provider is connected"),
    );
    expect(repair?.args[4]).toBe("missing_api_key");
    expect(repair?.args[5]).toBe("run-missing-key-event");
  });

  it("keeps an earlier stream error from reconciling as a later successful terminal event", async () => {
    latestEventRows = [
      {
        seq: 10,
        event_at: 124_000,
        event_data: JSON.stringify({ type: "done" }),
      },
      {
        seq: 9,
        event_at: 123_456,
        event_data: JSON.stringify({
          type: "error",
          errorCode: "provider_failed",
          error: "Provider failed",
          details: "model returned 500",
        }),
      },
    ];

    const reaped = await reapIfStale("run-error-then-done");

    expect(reaped).toBe(false);
    const repair = execCalls.find(
      (call) =>
        /UPDATE agent_runs/i.test(call.sql) &&
        /SET status = \?/i.test(call.sql),
    );
    expect(repair?.args[0]).toBe("errored");
    expect(repair?.args[1]).toBe(123_456);
    expect(repair?.args[2]).toBe("provider_failed");
    expect(repair?.args[3]).toBe("model returned 500");
    expect(repair?.args[4]).toBe("error:provider_failed");
    expect(repair?.args[5]).toBe("run-error-then-done");
    const eventLookup = execCalls.find((call) =>
      /SELECT seq, event_data, event_at/i.test(call.sql),
    );
    expect(eventLookup?.sql).toMatch(/ORDER BY seq DESC\s+LIMIT \?/i);
    expect(eventLookup?.args).toEqual(["run-error-then-done", 100]);
  });

  it("keeps an earlier missing credential event from reconciling as a later successful terminal event", async () => {
    latestEventRows = [
      {
        seq: 10,
        event_at: 124_000,
        event_data: JSON.stringify({ type: "done" }),
      },
      {
        seq: 9,
        event_at: 123_456,
        event_data: JSON.stringify({ type: "missing_api_key" }),
      },
    ];

    await reapIfStale("run-missing-then-done");

    const repair = execCalls.find(
      (call) =>
        /UPDATE agent_runs/i.test(call.sql) &&
        /SET status = \?/i.test(call.sql),
    );
    expect(repair?.args[0]).toBe("errored");
    expect(repair?.args[1]).toBe(123_456);
    expect(repair?.args[2]).toBe("missing_credentials");
    expect(repair?.args[4]).toBe("missing_api_key");
    expect(repair?.args[5]).toBe("run-missing-then-done");
  });

  it("still repairs a synthetic stale-run event when a later done event was persisted", async () => {
    latestEventRows = [
      {
        seq: 10,
        event_at: 124_000,
        event_data: JSON.stringify({ type: "done" }),
      },
      {
        seq: 9,
        event_at: 123_456,
        event_data: JSON.stringify(STALE_RUN_ERROR_EVENT),
      },
    ];

    await reapIfStale("run-stale-then-done");

    const repair = execCalls.find(
      (call) =>
        /UPDATE agent_runs/i.test(call.sql) &&
        /SET status = \?/i.test(call.sql),
    );
    expect(repair?.args[0]).toBe("completed");
    expect(repair?.args[1]).toBe(124_000);
    expect(repair?.args[2]).toBeNull();
    expect(repair?.args[3]).toBeNull();
    expect(repair?.args[4]).toBe("done");
    expect(repair?.args[5]).toBe("run-stale-then-done");
  });

  it("reconciles legacy terminal events without stamping repair time", async () => {
    latestEventRows = [
      { seq: 9, event_data: JSON.stringify({ type: "done" }) },
    ];

    await reapIfStale("run-legacy-done-event");

    const repair = execCalls.find(
      (call) =>
        /UPDATE agent_runs/i.test(call.sql) &&
        /SET status = \?/i.test(call.sql),
    );
    expect(repair?.sql).toContain("completed_at = COALESCE");
    expect(repair?.sql).toContain("last_progress_at");
    expect(repair?.sql).toContain("heartbeat_at");
    expect(repair?.args[0]).toBe("completed");
    expect(repair?.args[1]).toBeNull();
  });

  it("repairs terminal event rows before listing runs for debug surfaces", async () => {
    runListRows = [
      {
        id: "run-done-event",
        thread_id: "thread-done",
        turn_id: null,
        status: "running",
        started_at: 1000,
        heartbeat_at: 1500,
        completed_at: null,
        last_progress_at: 1500,
        error_code: null,
        abort_reason: null,
        dispatch_mode: "background-processing",
        terminal_reason: null,
        diag_stage: null,
      },
    ];
    refreshedRunListRows = [
      {
        ...runListRows[0],
        status: "completed",
        completed_at: 123_456,
        terminal_reason: "done",
      },
    ];
    latestEventRows = [
      {
        seq: 9,
        event_at: 123_456,
        event_data: JSON.stringify({ type: "done" }),
      },
    ];

    const runs = await listRunsForThread("thread-done");

    expect(runs[0]?.status).toBe("completed");
    expect(runs[0]?.completedAt).toBe(123_456);
    expect(runs[0]?.terminalReason).toBe("done");
    expect(runListSelectCount).toBe(2);
    const repair = execCalls.find(
      (call) =>
        /UPDATE agent_runs/i.test(call.sql) &&
        /SET status = \?/i.test(call.sql),
    );
    expect(repair?.args[0]).toBe("completed");
    expect(repair?.args[2]).toBeNull();
    expect(repair?.args[3]).toBeNull();
    expect(repair?.args[4]).toBe("done");
    expect(repair?.args[5]).toBe("run-done-event");
  });

  it("reconciles multiple stale candidate runs in parallel, not sequentially", async () => {
    runListRows = [
      {
        id: "run-stale-a",
        thread_id: "thread-multi-stale",
        turn_id: null,
        status: "running",
        started_at: 1000,
        heartbeat_at: 1500,
        completed_at: null,
        last_progress_at: 1500,
        error_code: null,
        abort_reason: null,
        dispatch_mode: "background-processing",
        terminal_reason: null,
        diag_stage: null,
      },
      {
        id: "run-stale-b",
        thread_id: "thread-multi-stale",
        turn_id: null,
        status: "running",
        started_at: 900,
        heartbeat_at: 1400,
        completed_at: null,
        last_progress_at: 1400,
        error_code: null,
        abort_reason: null,
        dispatch_mode: "background-processing",
        terminal_reason: null,
        diag_stage: null,
      },
    ];
    refreshedRunListRows = runListRows.map((row) => ({
      ...row,
      status: "completed",
      completed_at: 123_456,
      terminal_reason: "done",
    }));
    latestEventRows = [
      {
        seq: 9,
        event_at: 123_456,
        event_data: JSON.stringify({ type: "done" }),
      },
    ];

    const runs = await listRunsForThread("thread-multi-stale");

    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.status === "completed")).toBe(true);
    // Only one refetch of the row list, no matter how many candidates were
    // reconciled — the reconciliations run concurrently, not per-row.
    expect(runListSelectCount).toBe(2);
    const repairCalls = execCalls.filter(
      (call) =>
        /UPDATE agent_runs/i.test(call.sql) &&
        /SET status = \?/i.test(call.sql),
    );
    expect(repairCalls).toHaveLength(2);
    const reconciledRunIds = repairCalls.map((call) => call.args[5]).sort();
    expect(reconciledRunIds).toEqual(["run-stale-a", "run-stale-b"]);
  });

  it("reapIfStale honors last_progress_at as liveness so a progressing run is not reaped mid-tool", async () => {
    await reapIfStale("run-progressing");

    const update = execCalls.find((call) =>
      /UPDATE agent_runs[\s\S]*SET status = 'errored'[\s\S]*WHERE id = \?/i.test(
        call.sql,
      ),
    );
    // The stale predicate must key off the MOST RECENT of heartbeat_at (process
    // timer) and last_progress_at (real work — a long tool's activity every 8s),
    // not heartbeat_at alone. Otherwise a run that is demonstrably generating is
    // reaped when the process-liveness write lags, aborting the in-flight tool
    // ("Run aborted").
    expect(update?.sql).toContain("last_progress_at");
    expect(update?.sql).toMatch(
      /CASE WHEN COALESCE\(last_progress_at, started_at\) > COALESCE\(heartbeat_at, started_at\)/,
    );
  });

  it("cleanupOldRuns SELECTs both heartbeat-stale AND age-stale rows for terminal-event append", async () => {
    staleSelectRows = [{ id: "old-but-heartbeating-run" }];

    await cleanupOldRuns(24 * 60 * 60 * 1000);

    // The broadened SELECT — both predicates in one query — is what catches
    // a 24h-old row whose heartbeat somehow stayed fresh. The older
    // heartbeat-only SELECT would have left it without a terminal event.
    const select = execCalls.find(
      (call) =>
        /SELECT id FROM agent_runs/i.test(call.sql) &&
        // The heartbeat predicate keys on the liveness basis (most recent of
        // heartbeat_at and last_progress_at) against the background-aware cutoff
        // fragment `(CAST(? AS BIGINT) - CASE WHEN dispatch_mode LIKE
        // 'background%' THEN ... END)`, so a progressing run isn't reaped and a
        // slow background cold-start isn't reaped early. Still one query, still
        // covering both predicates.
        /CASE WHEN COALESCE\(last_progress_at, started_at\) > COALESCE\(heartbeat_at, started_at\)/.test(
          call.sql,
        ) &&
        /< \(CAST\(\? AS BIGINT\) -/.test(call.sql) &&
        /dispatch_mode LIKE 'background%'/.test(call.sql) &&
        /OR started_at < \?/.test(call.sql),
    );
    expect(select).toBeDefined();

    const insert = execCalls.find((call) =>
      /INSERT INTO agent_run_events/i.test(call.sql),
    );
    expect(insert?.args[0]).toBe("old-but-heartbeating-run");
    expect(insert?.args[3] as string).toContain('"errorCode":"stale_run"');
  });

  it("persists stale error diagnostics for all stale-run reap paths", async () => {
    staleSelectRows = [{ id: "run-stale-startup" }];

    await reapAllStaleRuns();
    await cleanupOldRuns(24 * 60 * 60 * 1000);

    const staleUpdates = execCalls.filter(
      (call) =>
        /UPDATE agent_runs/i.test(call.sql) &&
        /SET status = 'errored'/i.test(call.sql) &&
        /error_code = \?/i.test(call.sql) &&
        /error_detail = \?/i.test(call.sql) &&
        /terminal_reason = \?/i.test(call.sql),
    );
    expect(staleUpdates.length).toBeGreaterThanOrEqual(3);
    for (const update of staleUpdates) {
      expect(update.args[0]).toBe(STALE_RUN_ERROR_EVENT.errorCode);
      expect(update.args[1]).toBe(STALE_RUN_ERROR_EVENT.details);
      expect(update.args[2]).toBe(STALE_RUN_TERMINAL_REASON);
    }
  });

  it("keeps errored runs longer than completed runs during cleanup", async () => {
    await cleanupOldRuns(24 * 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000);

    const deleteEvents = execCalls.find((call) =>
      /DELETE FROM agent_run_events/i.test(call.sql),
    );
    expect(deleteEvents?.sql).toContain("status = 'completed'");
    expect(deleteEvents?.sql).toContain(
      "status IN ('errored', 'aborted', 'truncated')",
    );
    expect(Number(deleteEvents?.args[1])).toBeLessThan(
      Number(deleteEvents?.args[0]),
    );

    const deleteRuns = execCalls.find((call) =>
      /DELETE FROM agent_runs/i.test(call.sql),
    );
    expect(deleteRuns?.sql).toContain("status = 'completed'");
    expect(deleteRuns?.sql).toContain(
      "status IN ('errored', 'aborted', 'truncated')",
    );
    expect(Number(deleteRuns?.args[1])).toBeLessThan(
      Number(deleteRuns?.args[0]),
    );
  });

  // Fix 2: atomic run lease
  it("tryClaimRunSlot grants the slot when no live running row exists", async () => {
    claimSlotRows = []; // no current runner
    const result = await tryClaimRunSlot("thread-free");
    expect(result.claimed).toBe(true);
    expect(result.activeRunId).toBeNull();
  });

  it("tryClaimRunSlot denies the slot when a live running row exists", async () => {
    claimSlotRows = [{ id: "run-active-123" }];
    const result = await tryClaimRunSlot("thread-busy");
    expect(result.claimed).toBe(false);
    expect(result.activeRunId).toBe("run-active-123");
  });

  it("tryClaimRunSlot uses a liveness cutoff to exclude stale rows", async () => {
    claimSlotRows = []; // stale row was filtered by liveness cutoff in SQL
    const result = await tryClaimRunSlot("thread-stale");
    expect(result.claimed).toBe(true);

    const select = execCalls.find(
      (call) =>
        /SELECT id FROM agent_runs\s*WHERE thread_id/i.test(call.sql) &&
        /COALESCE\(last_progress_at, started_at\)/i.test(call.sql) &&
        /COALESCE\(heartbeat_at, started_at\)/i.test(call.sql),
    );
    expect(select).toBeDefined();
    // The liveness cutoff arg must be a recent timestamp
    expect(Number(select?.args[1])).toBeGreaterThan(Date.now() - 60_000);
  });

  it("tryClaimRunSlot casts the now param to BIGINT so a ms epoch can't be typed as int4", async () => {
    // Regression: the default (background-aware) cutoff does `? - <int4
    // literal>` in SQL. Without an explicit cast Postgres infers the parameter
    // as int4 from the literal windows, and Date.now() overflows with
    // `value "…" is out of range for type integer`, failing every chat turn.
    claimSlotRows = [];
    await tryClaimRunSlot("thread-cast");
    const select = execCalls.find(
      (call) =>
        /SELECT id FROM agent_runs\s*WHERE thread_id/i.test(call.sql) &&
        /COALESCE\(last_progress_at, started_at\)/i.test(call.sql),
    );
    expect(select?.sql).toMatch(/CAST\(\?\s+AS\s+BIGINT\)\s*-\s*CASE/i);
    // And the bound value is a full ms epoch (would overflow int4).
    expect(Number(select?.args[1])).toBeGreaterThan(2_147_483_647);
  });

  // Fix 1c: conditional terminal status write
  it("updateRunStatusIfRunning only updates rows still status=running", async () => {
    const result = await updateRunStatusIfRunning("run-alive", "completed");
    // The mock returns rowsAffected=1 for any UPDATE — truthy return
    expect(result).toBe(true);

    const update = execCalls.find(
      (call) =>
        /UPDATE agent_runs/i.test(call.sql) &&
        /WHERE id = \? AND status = 'running'/i.test(call.sql),
    );
    expect(update).toBeDefined();
    expect(update?.args[0]).toBe("completed");
    expect(update?.args[2]).toBe("run-alive");
  });

  it("getRunStatus returns the current status string for a run", async () => {
    runStatusRows = [{ status: "errored" }];
    const status = await getRunStatus("run-check");
    expect(status).toBe("errored");

    const select = execCalls.find((call) =>
      /SELECT status FROM agent_runs WHERE id/i.test(call.sql),
    );
    expect(select?.args[0]).toBe("run-check");
  });

  it("getRunStatus returns null when the run row is missing", async () => {
    runStatusRows = [];
    const status = await getRunStatus("run-missing");
    expect(status).toBeNull();
  });

  // ─── Tool-call result ledger ───────────────────────────────────────────────

  it("writeLedgerEntry persists result via INSERT with UPSERT semantics", async () => {
    await writeLedgerEntry("thread-abc", "my-tool:{}", "the result");

    const insert = execCalls.find((call) =>
      /INSERT INTO agent_tool_ledger/i.test(call.sql),
    );
    expect(insert).toBeDefined();
    expect(insert?.args[0]).toBe("thread-abc");
    expect(insert?.args[1]).toBe("my-tool:{}");
    expect(insert?.args[2]).toBe("the result");
    expect(insert?.sql).toContain("ON CONFLICT");
  });

  it("writeLedgerEntry caps result at 8 000 chars and appends truncation marker", async () => {
    const longResult = "X".repeat(8_500);
    await writeLedgerEntry("thread-cap", "tool:key", longResult);

    const insert = execCalls.find((call) =>
      /INSERT INTO agent_tool_ledger/i.test(call.sql),
    );
    const stored = insert?.args[2] as string;
    expect(stored.length).toBeLessThanOrEqual(8_050); // 8000 + truncation marker
    expect(stored).toContain("ledger truncated");
    expect(stored.startsWith("X".repeat(8_000))).toBe(true);
  });

  it("readLedgerEntry returns the result when an entry exists", async () => {
    ledgerRows = [{ result_summary: "cached output" }];
    const result = await readLedgerEntry("thread-abc", "my-tool:{}");

    expect(result).toBe("cached output");
    const select = execCalls.find((call) =>
      /SELECT result_summary FROM agent_tool_ledger/i.test(call.sql),
    );
    expect(select?.args[0]).toBe("thread-abc");
    expect(select?.args[1]).toBe("my-tool:{}");
  });

  it("readLedgerEntry returns null when no entry exists", async () => {
    ledgerRows = [];
    const result = await readLedgerEntry("thread-abc", "tool-unknown:{}");
    expect(result).toBeNull();
  });

  it("readLedgerEntry returns null (never throws) on DB error", async () => {
    mockDb.execute.mockRejectedValueOnce(new Error("DB unavailable"));
    const result = await readLedgerEntry("thread-err", "any-tool:{}");
    expect(result).toBeNull();
  });

  it("writeLedgerEntry never throws on DB error (best-effort)", async () => {
    mockDb.execute.mockRejectedValueOnce(new Error("DB unavailable"));
    await expect(
      writeLedgerEntry("thread-err", "any-tool:{}", "result"),
    ).resolves.toBeUndefined();
  });

  it("clearLedgerForThread deletes all entries for the thread", async () => {
    await clearLedgerForThread("thread-done");

    const del = execCalls.find((call) =>
      /DELETE FROM agent_tool_ledger WHERE thread_id/i.test(call.sql),
    );
    expect(del?.args[0]).toBe("thread-done");
  });

  it("clearLedgerForThread never throws on DB error (best-effort)", async () => {
    mockDb.execute.mockRejectedValueOnce(new Error("DB unavailable"));
    await expect(clearLedgerForThread("thread-err")).resolves.toBeUndefined();
  });

  // ─── dispatch_payload persistence (payload-ref rehydration) ────────────────

  it("insertRun persists dispatchPayload into the dispatch_payload column", async () => {
    await insertRun("run-payload", "thread-1", "turn-1", {
      dispatchMode: "background",
      dispatchPayload: '{"messages":[]}',
    });

    const insert = execCalls.find((call) =>
      /INSERT INTO agent_runs/i.test(call.sql),
    );
    expect(insert?.sql).toContain("dispatch_payload");
    expect(insert?.args).toEqual([
      "run-payload",
      "thread-1",
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      "turn-1",
      "background",
      '{"messages":[]}',
    ]);
  });

  it("insertRun binds null dispatch_payload when no payload is given", async () => {
    await insertRun("run-no-payload", "thread-1");

    const insert = execCalls.find((call) =>
      /INSERT INTO agent_runs/i.test(call.sql),
    );
    expect(insert?.args[7]).toBeNull();
  });

  it("insertRun is idempotent for retried or pre-claimed run rows", async () => {
    await insertRun("run-retry", "thread-1");

    const insert = execCalls.find((call) =>
      /INSERT INTO agent_runs/i.test(call.sql),
    );
    expect(insert?.sql).toContain("ON CONFLICT (id) DO NOTHING");
  });

  it("readRunDispatchPayload returns the persisted payload string", async () => {
    dispatchPayloadRows = [{ dispatch_payload: '{"foo":"bar"}' }];
    const payload = await readRunDispatchPayload("run-payload");
    expect(payload).toBe('{"foo":"bar"}');

    const select = execCalls.find((call) =>
      /SELECT dispatch_payload FROM agent_runs WHERE id/i.test(call.sql),
    );
    expect(select?.args[0]).toBe("run-payload");
  });

  it("readRunDispatchPayload returns null when missing, cleared, or empty", async () => {
    dispatchPayloadRows = [];
    expect(await readRunDispatchPayload("run-missing")).toBeNull();

    dispatchPayloadRows = [{ dispatch_payload: null }];
    expect(await readRunDispatchPayload("run-cleared")).toBeNull();

    dispatchPayloadRows = [{ dispatch_payload: "" }];
    expect(await readRunDispatchPayload("run-empty")).toBeNull();
  });

  it("clearRunDispatchPayload issues an UPDATE setting dispatch_payload to NULL", async () => {
    await clearRunDispatchPayload("run-clear-me");

    const update = execCalls.find(
      (call) =>
        /UPDATE agent_runs SET dispatch_payload = NULL/i.test(call.sql) &&
        /WHERE id = \?/i.test(call.sql),
    );
    expect(update?.args).toEqual(["run-clear-me"]);
  });

  it("updateRunStatus also NULLs dispatch_payload on the terminal write", async () => {
    await updateRunStatus("run-terminal", "completed");

    const update = execCalls.find((call) =>
      /UPDATE agent_runs SET status = \?, completed_at = \?, dispatch_payload = NULL WHERE id = \?/i.test(
        call.sql,
      ),
    );
    expect(update).toBeDefined();
    expect(update?.args).toEqual([
      "completed",
      expect.any(Number),
      "run-terminal",
    ]);
  });

  it("updateRunStatusIfRunning also NULLs dispatch_payload on the conditional terminal write", async () => {
    await updateRunStatusIfRunning("run-terminal-if-running", "errored");

    const update = execCalls.find((call) =>
      /UPDATE agent_runs SET status = \?, completed_at = \?, dispatch_payload = NULL WHERE id = \? AND status = 'running'/i.test(
        call.sql,
      ),
    );
    expect(update).toBeDefined();
    expect(update?.args).toEqual([
      "errored",
      expect.any(Number),
      "run-terminal-if-running",
    ]);
  });

  // ─── countRunsForTurn (durable per-turn ledger) ─────────────────────────────

  it("countRunsForTurn returns the SQL count, scoped by thread_id AND turn_id", async () => {
    runCountRows = [{ run_count: 7 }];
    const count = await countRunsForTurn("thread-x", "turn-y");
    expect(count).toBe(7);

    const select = execCalls.find((call) =>
      /SELECT COUNT\(\*\) AS run_count FROM agent_runs/i.test(call.sql),
    );
    expect(select?.sql).toContain("thread_id = ?");
    expect(select?.sql).toContain("turn_id = ?");
    expect(select?.args).toEqual(["thread-x", "turn-y"]);
  });

  it("countRunsForTurn returns 0 for a non-finite/missing count", async () => {
    runCountRows = [];
    expect(await countRunsForTurn("thread-x", "turn-missing")).toBe(0);

    runCountRows = [{ run_count: Number.NaN }];
    expect(await countRunsForTurn("thread-x", "turn-nan")).toBe(0);
  });

  // ─── listUnclaimedBackgroundRunIds (lost-handoff sweep) ────────────────────

  it("listUnclaimedBackgroundRunIds filters running+background rows past the grace window", async () => {
    unclaimedBackgroundRunRows = [{ id: "run-lost-1" }, { id: "run-lost-2" }];
    const ids = await listUnclaimedBackgroundRunIds();
    expect(ids).toEqual(["run-lost-1", "run-lost-2"]);

    const select = execCalls.find((call) =>
      /SELECT id FROM agent_runs\s*WHERE status = 'running'/i.test(call.sql),
    );
    expect(select?.sql).toContain("dispatch_mode = 'background'");
    expect(select?.sql).toContain("COALESCE(heartbeat_at, started_at)");
  });

  it("getCurrentTurnEventsForThread uses a supplied turnId instead of inferring it from the latest run row", async () => {
    await getCurrentTurnEventsForThread("thread-1", "turn-known");

    const inference = execCalls.find((c) =>
      /SELECT id, turn_id FROM agent_runs/i.test(c.sql),
    );
    expect(inference).toBeUndefined();

    const eventsCall = execCalls.find((c) =>
      /COALESCE\(r\.turn_id, r\.id\) = \?/i.test(c.sql),
    );
    expect(eventsCall?.args).toEqual(["thread-1", "turn-known"]);
  });

  it("getCurrentTurnEventsForThread still infers the turn when the caller has none", async () => {
    await getCurrentTurnEventsForThread("thread-1");

    expect(
      execCalls.some((c) => /SELECT id, turn_id FROM agent_runs/i.test(c.sql)),
    ).toBe(true);
  });

  it("listUnclaimedBackgroundRunIds casts the now param to BIGINT and binds a full ms epoch", async () => {
    // Regression guard mirroring the tryClaimRunSlot BIGINT-cast test: without
    // an explicit cast, Postgres can infer the parameter as int4 from the
    // literal grace-window subtraction, and a ms epoch overflows int4.
    unclaimedBackgroundRunRows = [];
    await listUnclaimedBackgroundRunIds();

    const select = execCalls.find((call) =>
      /SELECT id FROM agent_runs\s*WHERE status = 'running'/i.test(call.sql),
    );
    expect(select?.sql).toMatch(/CAST\(\?\s+AS\s+BIGINT\)/i);
    expect(Number(select?.args[0])).toBeGreaterThan(2_147_483_647);
  });

  it("listUnclaimedBackgroundRunIds ignores non-string/empty ids defensively", async () => {
    unclaimedBackgroundRunRows = [
      { id: "run-ok" },
      // @ts-expect-error -- exercising defensive filtering of malformed rows
      { id: null },
      // @ts-expect-error -- exercising defensive filtering of malformed rows
      { id: "" },
    ];
    const ids = await listUnclaimedBackgroundRunIds();
    expect(ids).toEqual(["run-ok"]);
  });

  // ─── listUnclaimedBackgroundRunRows (sweep redispatch bound) ───────────────

  it("listUnclaimedBackgroundRunRows returns each row's original started_at alongside its id", async () => {
    unclaimedBackgroundRunRowsWithStartedAt = [
      { id: "run-lost-1", started_at: 111 },
      { id: "run-lost-2", started_at: 222 },
    ];
    const rows = await listUnclaimedBackgroundRunRows();
    expect(rows).toEqual([
      { id: "run-lost-1", startedAt: 111, hasDispatchPayload: false },
      { id: "run-lost-2", startedAt: 222, hasDispatchPayload: false },
    ]);

    const select = execCalls.find((call) =>
      /SELECT id, started_at.*FROM agent_runs\s*WHERE status = 'running'/is.test(
        call.sql,
      ),
    );
    expect(select?.sql).toContain("dispatch_mode = 'background'");
    expect(select?.sql).toContain("COALESCE(heartbeat_at, started_at)");
  });

  it("listUnclaimedBackgroundRunRows ignores rows with a non-string/empty id defensively", async () => {
    unclaimedBackgroundRunRowsWithStartedAt = [
      { id: "run-ok", started_at: 100 },
      // @ts-expect-error -- exercising defensive filtering of malformed rows
      { id: null, started_at: 200 },
    ];
    const rows = await listUnclaimedBackgroundRunRows();
    expect(rows).toEqual([
      { id: "run-ok", startedAt: 100, hasDispatchPayload: false },
    ]);
  });

  // Sweep eligibility does not imply the row can be redispatched. A row with no
  // `dispatch_payload` sent to a worker under `payloadRef: true` dies as
  // `dispatch_payload_missing` — 98 production runs did exactly that — so the
  // sweep has to be able to tell the two apart.
  it("listUnclaimedBackgroundRunRows reports whether the row can still be rehydrated", async () => {
    unclaimedBackgroundRunRowsWithStartedAt = [
      { id: "run-with-payload", started_at: 1, has_dispatch_payload: true },
      { id: "run-no-payload", started_at: 2, has_dispatch_payload: false },
      // SQLite reports booleans as 1/0.
      { id: "run-sqlite", started_at: 3, has_dispatch_payload: 1 },
    ];

    const rows = await listUnclaimedBackgroundRunRows();

    expect(rows).toEqual([
      { id: "run-with-payload", startedAt: 1, hasDispatchPayload: true },
      { id: "run-no-payload", startedAt: 2, hasDispatchPayload: false },
      { id: "run-sqlite", startedAt: 3, hasDispatchPayload: true },
    ]);
  });

  // ─── Idle sweep cost ──────────────────────────────────────────────────────

  it("an idle fast-sweep tick costs one query, not one per sweep", async () => {
    // agent-chat-plugin's 20s fast sweep runs these two back to back. On an
    // idle app both scan for rows that do not exist, which on a remote database
    // is a round trip each, per app, forever. One shared `status='running'`
    // probe must answer both.
    await reapAllStaleRuns();
    await listUnclaimedBackgroundRunRows();

    const runTableReads = execCalls.filter((call) =>
      /FROM agent_runs/i.test(call.sql),
    );
    expect(runTableReads).toHaveLength(1);
    expect(runTableReads[0]?.sql).toContain("LIMIT 1");
  });

  it("a running row makes both sweeps run their own scan again", async () => {
    staleSelectRows = [{ id: "run-stale" }];
    unclaimedBackgroundRunRowsWithStartedAt = [
      { id: "run-unclaimed", started_at: 1 },
    ];

    await reapAllStaleRuns();
    await listUnclaimedBackgroundRunRows();

    expect(
      execCalls.some((call) =>
        /SELECT id FROM agent_runs\s*WHERE status = 'running'\s*AND/i.test(
          call.sql,
        ),
      ),
    ).toBe(true);
    expect(
      execCalls.some((call) =>
        /SELECT id, started_at.*FROM agent_runs/is.test(call.sql),
      ),
    ).toBe(true);
  });

  it("UNCLAIMED_BACKGROUND_RUN_REDISPATCH_BOUND_MS is a real bound wider than the grace window — never zero, never infinite", () => {
    // The sweep must get more than one redispatch attempt (grace window is
    // 25s, sweep tick is ~2min) but the bound must still be finite so a
    // permanently-dead handoff eventually fails loud instead of retrying
    // forever.
    expect(UNCLAIMED_BACKGROUND_RUN_REDISPATCH_BOUND_MS).toBeGreaterThan(
      2 * 60_000,
    );
    expect(Number.isFinite(UNCLAIMED_BACKGROUND_RUN_REDISPATCH_BOUND_MS)).toBe(
      true,
    );
  });

  // ─── shouldRedispatchUnclaimedBackgroundRun (bounded recovery backstop) ────

  it("shouldRedispatchUnclaimedBackgroundRun allows redispatch while inside the bound", () => {
    const now = 1_000_000;
    const row = {
      startedAt: now - UNCLAIMED_BACKGROUND_RUN_REDISPATCH_BOUND_MS + 1,
    };
    expect(shouldRedispatchUnclaimedBackgroundRun(row, now)).toBe(true);
  });

  it("shouldRedispatchUnclaimedBackgroundRun falls back to the reap once the bound is exceeded — the loud backstop", () => {
    const now = 1_000_000;
    // Exactly at the bound: no longer "within" it (strict <).
    const atBound = {
      startedAt: now - UNCLAIMED_BACKGROUND_RUN_REDISPATCH_BOUND_MS,
    };
    expect(shouldRedispatchUnclaimedBackgroundRun(atBound, now)).toBe(false);

    // Well past the bound — a genuinely dead handoff must stop being
    // redispatched forever and go to the reap instead.
    const wayPast = {
      startedAt: now - UNCLAIMED_BACKGROUND_RUN_REDISPATCH_BOUND_MS * 10,
    };
    expect(shouldRedispatchUnclaimedBackgroundRun(wayPast, now)).toBe(false);
  });

  it("shouldRedispatchUnclaimedBackgroundRun defaults `now` to the real clock", () => {
    // A row that just started is always within the bound right now.
    expect(
      shouldRedispatchUnclaimedBackgroundRun({ startedAt: Date.now() }),
    ).toBe(true);
    // A row from a very long time ago is not.
    expect(shouldRedispatchUnclaimedBackgroundRun({ startedAt: 0 })).toBe(
      false,
    );
  });

  // ─── UNCLAIMED_BACKGROUND_RUN_FAST_SWEEP_MS (derived timing budget) ───────
  // See this constant's doc comment for the full derivation. These assertions
  // pin the DERIVED relationship, not the exact numbers, so the budget stays
  // self-consistent if any one constant is retuned later.

  it("the fast sweep is a real, finite, short interval — strictly tighter than the redispatch bound", () => {
    expect(UNCLAIMED_BACKGROUND_RUN_FAST_SWEEP_MS).toBeGreaterThan(0);
    expect(Number.isFinite(UNCLAIMED_BACKGROUND_RUN_FAST_SWEEP_MS)).toBe(true);
    expect(UNCLAIMED_BACKGROUND_RUN_FAST_SWEEP_MS).toBeLessThan(
      UNCLAIMED_BACKGROUND_RUN_REDISPATCH_BOUND_MS,
    );
  });

  // ─── claimBackgroundRun CAS (no-double-execution invariant) ───────────────
  // Adding a tighter fast sweep alongside the existing slow sweep means two
  // independent timers can now both try to redispatch the SAME unclaimed row
  // around the same time, and a client-poll reap could interleave too. The
  // CAS on `claimBackgroundRun` — not any sweep-level locking — is what makes
  // that safe: only the FIRST claim attempt for a row can win.

  it("claimBackgroundRun's CAS rejects a second claimer racing the same row (fast sweep vs slow sweep vs a real worker)", async () => {
    const first = await claimBackgroundRun("run-race");
    const second = await claimBackgroundRun("run-race");
    const third = await claimBackgroundRun("run-race");

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(third).toBe(false);
  });

  it("claimBackgroundRun's CAS is per-row — one row's claim never blocks a different row's claim", async () => {
    const rowA = await claimBackgroundRun("run-race-a");
    const rowBFirst = await claimBackgroundRun("run-race-b");
    const rowASecond = await claimBackgroundRun("run-race-a");
    const rowBSecond = await claimBackgroundRun("run-race-b");

    expect(rowA).toBe(true);
    expect(rowBFirst).toBe(true);
    expect(rowASecond).toBe(false);
    expect(rowBSecond).toBe(false);
  });

  it("worst-case time-to-first-redispatch-attempt (grace + one fast-sweep tick, plus one retry) still leaves real headroom before the redispatch bound", () => {
    // The full inequality against the CLIENT's
    // BACKGROUND_FOLLOW_IDLE_TIMEOUT_MS is asserted in
    // agent-chat-adapter.spec.ts, which imports these same run-store
    // constants (safe direction — a client test importing pure server
    // constants) rather than the reverse (this server spec importing a
    // browser-surface client module). This test proves the server-side half
    // of the budget stands on its own: even with room for a full failed
    // first attempt, recovery is a small fraction of the outer hard bound.
    const worstCaseFirstAttemptMs =
      UNCLAIMED_BACKGROUND_RUN_GRACE_MS +
      UNCLAIMED_BACKGROUND_RUN_FAST_SWEEP_MS;
    const worstCaseWithOneRetryMs =
      worstCaseFirstAttemptMs + UNCLAIMED_BACKGROUND_RUN_FAST_SWEEP_MS;
    expect(worstCaseWithOneRetryMs).toBeLessThan(
      UNCLAIMED_BACKGROUND_RUN_REDISPATCH_BOUND_MS / 2,
    );
  });
});

/**
 * The invariant that was never tested, and whose absence let 30 `run_timeout`
 * runs outnumber 20 real completions on Plan while all 50 were filed as
 * `completed`: a terminal event yields `completed` if and only if its reason is
 * `done`. Anything else is a failure or a truncation, and retention/telemetry
 * key off exactly that distinction.
 */
describe("terminal status is `completed` iff the terminal reason is `done`", () => {
  beforeEach(() => {
    execCalls.length = 0;
    latestEventRows = [];
    vi.clearAllMocks();
  });

  async function reconcileStatusFor(
    event: Record<string, unknown>,
  ): Promise<{ status: unknown; terminalReason: unknown }> {
    latestEventRows = [
      {
        seq: 3,
        event_at: 1_700_000_000_000,
        event_data: JSON.stringify(event),
      },
    ];
    await reconcileTerminalRunFromEvents("run-invariant");
    const update = execCalls.find(
      (call) =>
        /UPDATE agent_runs/i.test(call.sql) &&
        /terminal_reason = \?/i.test(call.sql),
    );
    return { status: update?.args[0], terminalReason: update?.args[4] };
  }

  const terminalEvents: Array<Record<string, unknown>> = [
    { type: "done" },
    { type: "loop_limit", maxIterations: 25 },
    { type: "auto_continue", reason: "run_timeout" },
    { type: "auto_continue", reason: "no_progress" },
    { type: "auto_continue", reason: "loop_limit" },
    { type: "auto_continue", reason: "max_tokens" },
    { type: "auto_continue", reason: "stream_ended" },
    { type: "auto_continue", reason: "gateway_timeout" },
    { type: "auto_continue", reason: "network_interrupted" },
    { type: "auto_continue" },
    { type: "error", error: "boom", errorCode: "provider_network_error" },
    { type: "missing_api_key" },
  ];

  for (const event of terminalEvents) {
    const label = `${event.type}${event.reason ? `:${event.reason}` : ""}`;
    it(`records ${label} as completed only when the reason is done`, async () => {
      const { status, terminalReason } = await reconcileStatusFor(event);
      expect(terminalReason).toBeTruthy();
      expect(status === "completed").toBe(terminalReason === "done");
    });
  }

  it("records every non-error boundary event as truncated, not completed", async () => {
    for (const event of terminalEvents) {
      execCalls.length = 0;
      const { status, terminalReason } = await reconcileStatusFor(event);
      if (terminalReason === "done") continue;
      const expected =
        event.type === "error" || event.type === "missing_api_key"
          ? "errored"
          : "truncated";
      expect(status).toBe(expected);
    }
  });

  it("setRunTerminalReason downgrades a completed row to truncated for a boundary reason", async () => {
    await setRunTerminalReason("run-boundary", "no_progress");

    const update = execCalls.find((call) =>
      /UPDATE agent_runs/i.test(call.sql),
    );
    expect(update?.sql).toContain(
      "status = CASE WHEN status = 'completed' THEN 'truncated' ELSE status END",
    );
    expect(update?.args).toEqual(["no_progress", "run-boundary"]);
  });

  it("setRunTerminalReason never rewrites the status for a genuine finish or failure", async () => {
    for (const reason of [
      "done",
      "error:provider_network_error",
      "aborted:user",
    ]) {
      execCalls.length = 0;
      await setRunTerminalReason("run-final", reason);
      const update = execCalls.find((call) =>
        /UPDATE agent_runs/i.test(call.sql),
      );
      // The SET clause is what must leave status alone — the WHERE clause reads
      // it deliberately, to keep the write once-only (see the guard below).
      const setClause = update?.sql.split(/\bWHERE\b/i)[0] ?? "";
      expect(setClause).not.toContain("status");
    }
  });

  // Three writers in three isolates race on terminal_reason with no ordering.
  // Last-writer-wins let a late mid-run checkpoint relabel a row another
  // isolate had already finalized, producing rows whose reason names a failure
  // the run never hit.
  it("setRunTerminalReason will not relabel a row that already recorded one", async () => {
    for (const reason of ["done", "no_progress", "dispatch_payload_missing"]) {
      execCalls.length = 0;
      await setRunTerminalReason("run-final", reason);
      const update = execCalls.find((call) =>
        /UPDATE agent_runs/i.test(call.sql),
      );
      expect(update?.sql).toContain(
        "(status = 'running' OR terminal_reason IS NULL OR terminal_reason = '')",
      );
    }
  });
});
