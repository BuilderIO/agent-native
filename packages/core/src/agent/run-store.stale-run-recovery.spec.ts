import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

/**
 * FIX 3 (durable-background incident, 2026-07-12): when a background chat-
 * turn worker dies silently mid-stream (heartbeats stop, no terminal event,
 * no chain-continuation ever runs because the process is just gone), the
 * stale-run reapers (`reapIfStale`, the per-poll read path; `reapAllStaleRuns`,
 * the process-startup sweep) are the ONLY code that ever notices. Before this
 * fix they just flipped the row to errored/stale_run and stopped — no
 * successor was ever created, so the turn died mid-sentence with no recovery.
 *
 * These tests run against a REAL in-memory SQLite engine (not a hand-rolled
 * mock) so the conditional UPDATE / transaction / rowsAffected semantics the
 * recovery logic depends on are real, mirroring `run-store.foreground-self-
 * chain.spec.ts`. `client.transaction` is implemented here (unlike that
 * sibling file) specifically to exercise FIX 3's primary transactional path;
 * a dedicated test below exercises the non-transactional fallback too.
 */

const sqlite = new Database(":memory:");

function makeRawClient(withTransaction: boolean) {
  const client: {
    execute: ReturnType<typeof vi.fn>;
    transaction?: <T>(fn: (tx: typeof client) => Promise<T>) => Promise<T>;
  } = {
    execute: vi.fn(
      async (input: string | { sql: string; args?: unknown[] }) => {
        if (typeof input === "string") {
          sqlite.exec(input);
          return { rows: [] as unknown[], rowsAffected: 0 };
        }
        const stmt = sqlite.prepare(input.sql);
        const args = (input.args ?? []) as unknown[];
        if (/^\s*select/i.test(input.sql)) {
          return { rows: stmt.all(...args), rowsAffected: 0 };
        }
        const info = stmt.run(...args);
        return { rows: [] as unknown[], rowsAffected: info.changes };
      },
    ),
  };
  if (withTransaction) {
    client.transaction = async <T>(
      fn: (tx: typeof client) => Promise<T>,
    ): Promise<T> => {
      await client.execute("BEGIN");
      try {
        const result = await fn(client);
        await client.execute("COMMIT");
        return result;
      } catch (err) {
        await client.execute("ROLLBACK").catch(() => {});
        throw err;
      }
    };
  }
  return client;
}

// Default: transactional client (the primary, expected-in-production path —
// every real DbExec implementation provides `.transaction`, see db/client.ts).
let currentClient = makeRawClient(true);

vi.mock("../db/client.js", () => ({
  getDbExec: () => currentClient,
  intType: () => "INTEGER",
  isPostgres: () => false,
  retryOnDdlRace: (fn: () => any) => fn(),
}));

// FIX 3's best-effort immediate redispatch calls out to self-dispatch — stub
// it so tests never attempt a real network fetch (and never hang on one).
const fireInternalDispatchMock = vi.fn(async () => {});
vi.mock("../server/self-dispatch.js", () => ({
  fireInternalDispatch: (...args: unknown[]) =>
    fireInternalDispatchMock(...args),
}));

const {
  insertRun,
  claimBackgroundRun,
  isTurnAborted,
  markTurnAborted,
  reapIfStale,
  reapAllStaleRuns,
} = await import("./run-store.js");

let seq = 0;
function ids(): { runId: string; thread: string; turn: string } {
  seq += 1;
  return {
    runId: `run-recover-${seq}`,
    thread: `thread-recover-${seq}`,
    turn: `turn-recover-${seq}`,
  };
}

function setStaleLiveness(runId: string, atMs: number): void {
  sqlite
    .prepare(
      `UPDATE agent_runs SET heartbeat_at = ?, last_progress_at = ? WHERE id = ?`,
    )
    .run(atMs, atMs, runId);
}

function readRow(runId: string):
  | {
      id: string;
      status: string;
      turn_id: string | null;
      dispatch_mode: string | null;
      dispatch_payload: string | null;
      terminal_reason: string | null;
      diag_stage: string | null;
    }
  | undefined {
  return sqlite
    .prepare(
      `SELECT id, status, turn_id, dispatch_mode, dispatch_payload, terminal_reason, diag_stage FROM agent_runs WHERE id = ?`,
    )
    .get(runId) as any;
}

function rowsForTurn(turnId: string): Array<{ id: string; status: string }> {
  return sqlite
    .prepare(`SELECT id, status FROM agent_runs WHERE turn_id = ?`)
    .all(turnId) as any;
}

const STALE_PAST_MS = 5 * 60_000; // comfortably past BACKGROUND_RUN_STALE_MS (90s)

describe("FIX 3 — stale-run reaper server-owned recovery (reapIfStale)", () => {
  it("records an early Stop as a turn marker before any real run exists", async () => {
    currentClient = makeRawClient(true);
    const { thread, turn } = ids();

    await markTurnAborted(thread, turn);

    expect(await isTurnAborted(thread, turn)).toBe(true);
    expect(await isTurnAborted(thread, `${turn}-other`)).toBe(false);
    const marker = sqlite
      .prepare(`SELECT status, dispatch_mode FROM agent_runs WHERE id = ?`)
      .get(`turn-abort-${turn}`) as
      | { status: string; dispatch_mode: string }
      | undefined;
    expect(marker).toEqual({ status: "aborted", dispatch_mode: "turn-abort" });
  });

  it("creates exactly one unclaimed recovery successor for a dead claimed background worker, and does not stack a second on a re-reap", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    const payload = JSON.stringify({ message: "original ingress", foo: "bar" });
    await insertRun(runId, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: payload,
    });
    // Mirror the incident: the worker claimed the run (background ->
    // background-processing) and was genuinely executing before it died.
    expect(await claimBackgroundRun(runId)).toBe(true);
    setStaleLiveness(runId, Date.now() - STALE_PAST_MS);

    const reaped = await reapIfStale(runId);
    expect(reaped).toBe(true);

    const oldRow = readRow(runId);
    expect(oldRow?.status).toBe("errored");
    expect(oldRow?.terminal_reason).toBe("stale_run");
    // Terminal writes elsewhere NULL dispatch_payload, but reapIfStale's own
    // UPDATE never touches it directly — the important invariant is that the
    // payload was captured into the successor before the row went terminal.
    expect(oldRow?.diag_stage).toContain("stale_run_recovery_attempted");
    expect(oldRow?.diag_stage).toContain("recovered");

    const siblings = rowsForTurn(turn);
    expect(siblings).toHaveLength(2); // the original + exactly one successor
    const successorRow = siblings.find((r) => r.id !== runId);
    expect(successorRow).toBeDefined();
    expect(successorRow?.status).toBe("running");
    const successorFull = readRow(successorRow!.id);
    expect(successorFull?.dispatch_mode).toBe("background");
    expect(JSON.parse(successorFull?.dispatch_payload ?? "null")).toEqual({
      message: "original ingress",
      foo: "bar",
      internalContinuation: true,
    });

    // Re-reaping the now-terminal row is a no-op (status is no longer
    // 'running', so the conditional UPDATE's WHERE clause can't match) — at
    // most ONE recovery successor per reaped run, even under a retry.
    const reapedAgain = await reapIfStale(runId);
    expect(reapedAgain).toBe(false);
    expect(rowsForTurn(turn)).toHaveLength(2);
  });

  it("does NOT create a successor once the per-turn run budget is exhausted", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    // Seed the turn's SQL ledger past STALE_RUN_RECOVERY_MAX_TURN_RUNS (25)
    // with prior (already-terminal) chunks, mirroring a pathological
    // continuation loop that ran long before this worker ever died.
    for (let i = 0; i < 25; i++) {
      await insertRun(`${runId}-prior-${i}`, thread, turn, {
        dispatchMode: "background",
      });
    }
    await insertRun(runId, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({ ok: true }),
    });
    await claimBackgroundRun(runId);
    setStaleLiveness(runId, Date.now() - STALE_PAST_MS);

    const reaped = await reapIfStale(runId);
    expect(reaped).toBe(true);
    expect(readRow(runId)?.status).toBe("errored");
    expect(readRow(runId)?.diag_stage).toContain("declined");
    expect(readRow(runId)?.diag_stage).toContain("budget_exhausted");

    // 25 priors + the reaped row itself = 26 rows for the turn; no successor.
    expect(rowsForTurn(turn)).toHaveLength(26);
  });

  it("does NOT create a successor when the dying run has no dispatch_payload to carry over", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    // No dispatchPayload — e.g. a row whose payload was already cleared, or
    // one that predates this fix.
    await insertRun(runId, thread, turn, { dispatchMode: "background" });
    await claimBackgroundRun(runId);
    setStaleLiveness(runId, Date.now() - STALE_PAST_MS);

    const reaped = await reapIfStale(runId);
    expect(reaped).toBe(true);
    expect(readRow(runId)?.status).toBe("errored");
    expect(readRow(runId)?.diag_stage).toContain("payload_missing");
    expect(rowsForTurn(turn)).toHaveLength(1); // no successor inserted
  });

  it("does NOT create a successor when a newer run already exists for the same turn", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({ ok: true }),
    });
    await claimBackgroundRun(runId);
    setStaleLiveness(runId, Date.now() - STALE_PAST_MS);
    // A normal chainServerDrivenContinuation (or an earlier recovery pass)
    // already continued this turn with a genuinely newer row.
    await new Promise((resolve) => setTimeout(resolve, 2));
    const newerRunId = `${runId}-already-continued`;
    await insertRun(newerRunId, thread, turn, { dispatchMode: "background" });

    const reaped = await reapIfStale(runId);
    expect(reaped).toBe(true);
    expect(readRow(runId)?.status).toBe("errored");
    expect(readRow(runId)?.diag_stage).toContain("newer_run_exists");
    // Only the original + the pre-existing newer run — nothing new inserted.
    expect(rowsForTurn(turn)).toHaveLength(2);
  });

  it("does NOT attempt recovery for a foreground (non-background) run", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn); // no dispatchMode => plain foreground row
    setStaleLiveness(runId, Date.now() - 60_000);

    const reaped = await reapIfStale(runId);
    expect(reaped).toBe(true);
    expect(readRow(runId)?.status).toBe("errored");
    // "not_background" is the common case and is deliberately NOT recorded
    // as a diag stage (see attemptStaleRunRecovery's doc comment) — the row
    // must not gain a stale-run-recovery diag entry at all.
    expect(readRow(runId)?.diag_stage ?? "").not.toContain(
      "stale_run_recovery_attempted",
    );
    expect(rowsForTurn(turn)).toHaveLength(1);
  });

  it("falls back to insert-then-update ordering when the DbExec has no transaction() primitive, and still recovers", async () => {
    // Defensive fallback path — see reapSingleStaleRun's comment. Every real
    // DbExec provides `.transaction`; this proves the degraded path still
    // produces a correct, recoverable outcome.
    currentClient = makeRawClient(false);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({ ok: true }),
    });
    await claimBackgroundRun(runId);
    setStaleLiveness(runId, Date.now() - STALE_PAST_MS);

    const reaped = await reapIfStale(runId);
    expect(reaped).toBe(true);
    expect(readRow(runId)?.status).toBe("errored");
    expect(rowsForTurn(turn)).toHaveLength(2);
  });
});

describe("FIX 3 — stale-run reaper server-owned recovery (reapAllStaleRuns)", () => {
  it("recovers a dead background worker discovered by the bulk startup sweep", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({ ok: true }),
    });
    await claimBackgroundRun(runId);
    setStaleLiveness(runId, Date.now() - STALE_PAST_MS);

    const reapedCount = await reapAllStaleRuns();
    expect(reapedCount).toBeGreaterThanOrEqual(1);
    expect(readRow(runId)?.status).toBe("errored");
    expect(rowsForTurn(turn)).toHaveLength(2);

    // A second sweep pass over the now-terminal row must not stack another
    // successor.
    await reapAllStaleRuns();
    expect(rowsForTurn(turn)).toHaveLength(2);
  });
});
