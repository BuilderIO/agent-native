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
let runCountRows: Array<{ run_count: number }> = [];

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
    // "SELECT id FROM agent_runs ... status = 'running'".
    if (
      /SELECT id FROM agent_runs\s*WHERE thread_id/i.test(rawSql) &&
      /COALESCE\(heartbeat_at, started_at\) >=/i.test(rawSql)
    ) {
      return { rows: claimSlotRows, rowsAffected: 0 };
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
  markRunAborted,
  reapAllStaleRuns,
  reapIfStale,
  cleanupOldRuns,
  tryClaimRunSlot,
  updateRunStatusIfRunning,
  updateRunStatus,
  getRunStatus,
  listRunsForThread,
  readBackgroundRunClaim,
  getRunOwnerEmail,
  writeLedgerEntry,
  readLedgerEntry,
  clearLedgerForThread,
  insertRun,
  readRunDispatchPayload,
  clearRunDispatchPayload,
  listUnclaimedBackgroundRunIds,
  countRunsForTurn,
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
    runOwnerRows = [];
    ledgerRows = [];
    dispatchPayloadRows = [];
    unclaimedBackgroundRunRows = [];
    runCountRows = [];
    insertEventBehavior = () => {};
    abortRowsAffected = 1;
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
    expect(insert?.args[3]).toBe('{"type":"done"}');
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
    expect(update?.args[1]).toBe(STALE_RUN_ERROR_EVENT.errorCode);
    expect(update?.args[2]).toBe(STALE_RUN_ERROR_EVENT.details);
    expect(update?.args[3]).toBe(STALE_RUN_ERROR_EVENT.errorCode);
    expect(update?.args[4]).toBe("run-stale");

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
      expect(update.args[1]).toBe(STALE_RUN_ERROR_EVENT.errorCode);
      expect(update.args[2]).toBe(STALE_RUN_ERROR_EVENT.details);
      expect(update.args[3]).toBe(STALE_RUN_ERROR_EVENT.errorCode);
    }
  });

  it("keeps errored runs longer than completed runs during cleanup", async () => {
    await cleanupOldRuns(24 * 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000);

    const deleteEvents = execCalls.find((call) =>
      /DELETE FROM agent_run_events/i.test(call.sql),
    );
    expect(deleteEvents?.sql).toContain("status = 'completed'");
    expect(deleteEvents?.sql).toContain("status IN ('errored', 'aborted')");
    expect(Number(deleteEvents?.args[1])).toBeLessThan(
      Number(deleteEvents?.args[0]),
    );

    const deleteRuns = execCalls.find((call) =>
      /DELETE FROM agent_runs/i.test(call.sql),
    );
    expect(deleteRuns?.sql).toContain("status = 'completed'");
    expect(deleteRuns?.sql).toContain("status IN ('errored', 'aborted')");
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

  it("tryClaimRunSlot uses a heartbeat cutoff to exclude stale rows", async () => {
    claimSlotRows = []; // stale row was filtered by heartbeat cutoff in SQL
    const result = await tryClaimRunSlot("thread-stale");
    expect(result.claimed).toBe(true);

    const select = execCalls.find(
      (call) =>
        /SELECT id FROM agent_runs\s*WHERE thread_id/i.test(call.sql) &&
        /COALESCE\(heartbeat_at, started_at\) >=/i.test(call.sql),
    );
    expect(select).toBeDefined();
    // The heartbeat cutoff arg must be a recent timestamp
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
        /COALESCE\(heartbeat_at, started_at\) >=/i.test(call.sql),
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
});
