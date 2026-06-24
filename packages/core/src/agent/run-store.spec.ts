import { beforeEach, describe, expect, it, vi } from "vitest";

interface ExecCall {
  sql: string;
  args: unknown[];
}

const execCalls: ExecCall[] = [];
let latestEventRows: Array<{ seq: number; event_data: string }> = [];
let staleSelectRows: Array<{ id: string }> = [];
let claimSlotRows: Array<{ id: string }> = [];
let runStatusRows: Array<{ status: string }> = [];
let claimStateRows: Array<{
  dispatch_mode: string | null;
  status: string | null;
}> = [];
let insertEventBehavior: () => void = () => {};

const mockDb = {
  execute: vi.fn(async (sql: string | { sql: string; args?: unknown[] }) => {
    const rawSql = typeof sql === "string" ? sql : sql.sql;
    const args = typeof sql === "string" ? [] : (sql.args ?? []);
    execCalls.push({ sql: rawSql, args });

    if (/SELECT seq, event_data FROM agent_run_events/i.test(rawSql)) {
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
    if (/SELECT id FROM agent_runs[\s\S]*status = 'running'/i.test(rawSql)) {
      return { rows: staleSelectRows, rowsAffected: 0 };
    }
    // getRunStatus: SELECT status FROM agent_runs WHERE id = ?
    if (/SELECT status FROM agent_runs WHERE id/i.test(rawSql)) {
      return { rows: runStatusRows, rowsAffected: 0 };
    }
    // readBackgroundRunClaim: SELECT dispatch_mode, status FROM agent_runs WHERE id = ?
    if (/SELECT dispatch_mode, status FROM agent_runs WHERE id/i.test(rawSql)) {
      return { rows: claimStateRows, rowsAffected: 0 };
    }
    if (/INSERT INTO agent_run_events/i.test(rawSql)) {
      insertEventBehavior();
      return { rows: [], rowsAffected: 1 };
    }
    // Tool-call result ledger: SELECT result_summary FROM agent_tool_ledger
    if (/SELECT result_summary FROM agent_tool_ledger/i.test(rawSql)) {
      return { rows: ledgerRows, rowsAffected: 0 };
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
  getRunStatus,
  readBackgroundRunClaim,
  writeLedgerEntry,
  readLedgerEntry,
  clearLedgerForThread,
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
    ledgerRows = [];
    insertEventBehavior = () => {};
    vi.clearAllMocks();
  });

  it("readBackgroundRunClaim parses dispatch_mode + status, or null when missing", async () => {
    claimStateRows = [{ dispatch_mode: "background", status: "running" }];
    expect(await readBackgroundRunClaim("run-bg")).toEqual({
      dispatchMode: "background",
      status: "running",
    });

    claimStateRows = [
      { dispatch_mode: "background-processing", status: "running" },
    ];
    expect(await readBackgroundRunClaim("run-claimed")).toEqual({
      dispatchMode: "background-processing",
      status: "running",
    });

    claimStateRows = [];
    expect(await readBackgroundRunClaim("run-missing")).toBeNull();
  });

  it("persists a terminal event when marking a run aborted", async () => {
    await markRunAborted("run-abort");

    const update = execCalls.find((call) =>
      /UPDATE agent_runs SET status = 'aborted'/i.test(call.sql),
    );
    expect(update?.args[0]).toBe("user");
    expect(update?.args[2]).toBe("run-abort");

    const insert = execCalls.find((call) =>
      /INSERT INTO agent_run_events/i.test(call.sql),
    );
    expect(insert?.args).toEqual(["run-abort", 0, '{"type":"done"}']);
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
    expect(update?.args[1]).toBe(STALE_RUN_ERROR_EVENT.errorCode);
    expect(update?.args[2]).toBe(STALE_RUN_ERROR_EVENT.details);
    expect(update?.args[3]).toBe("run-stale");

    const insert = execCalls.find((call) =>
      /INSERT INTO agent_run_events/i.test(call.sql),
    );
    expect(insert?.args[0]).toBe("run-stale");
    const eventJson = insert?.args[2] as string;
    expect(JSON.parse(eventJson)).toEqual(STALE_RUN_ERROR_EVENT);
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
        // The heartbeat predicate now uses the background-aware cutoff fragment
        // `(CAST(? AS BIGINT) - CASE WHEN dispatch_mode LIKE 'background%' THEN
        // ... END)` so a slow background cold-start isn't reaped early. Still one
        // query, still covering both predicates.
        /COALESCE\(heartbeat_at, started_at\) < \(CAST\(\? AS BIGINT\) -/.test(
          call.sql,
        ) &&
        /dispatch_mode LIKE 'background%'/.test(call.sql) &&
        /OR started_at < \?/.test(call.sql),
    );
    expect(select).toBeDefined();

    const insert = execCalls.find((call) =>
      /INSERT INTO agent_run_events/i.test(call.sql),
    );
    expect(insert?.args[0]).toBe("old-but-heartbeating-run");
    expect(insert?.args[2] as string).toContain('"errorCode":"stale_run"');
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
        /error_detail = \?/i.test(call.sql),
    );
    expect(staleUpdates.length).toBeGreaterThanOrEqual(3);
    for (const update of staleUpdates) {
      expect(update.args[1]).toBe(STALE_RUN_ERROR_EVENT.errorCode);
      expect(update.args[2]).toBe(STALE_RUN_ERROR_EVENT.details);
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
});
