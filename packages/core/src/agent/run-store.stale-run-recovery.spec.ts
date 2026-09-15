import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

/**
 * FIX 3 (durable-background incident, 2026-07-12): when a background chat-
 * turn worker dies silently mid-stream (heartbeats stop, no terminal event,
 * no chain-continuation ever runs because the process is just gone), the
 * stale-run reapers (`reapIfStale`, the per-poll read path; `reapAllStaleRuns`,
 * the process-startup sweep) are the ONLY code that ever notices. Before this
 * fix they just flipped the row to errored/stale_run and stopped — no
 * successor was ever created, so the turn died mid-sentence with no recovery.
 *
 * These tests run against a REAL in-memory PGlite engine (not a hand-rolled
 * mock) so the conditional UPDATE / transaction / rowsAffected semantics the
 * recovery logic depends on are real, mirroring `run-store.foreground-self-
 * chain.spec.ts`. `client.transaction` is implemented here (unlike that
 * sibling file) specifically to exercise FIX 3's primary transactional path;
 * a dedicated test below exercises the non-transactional fallback too.
 */

const pglite = await createTestPglite();

afterAll(async () => {
  await pglite.close();
});

function makeRawClient(withTransaction: boolean) {
  const client: {
    execute: ReturnType<typeof vi.fn>;
    transaction?: <T>(fn: (tx: typeof client) => Promise<T>) => Promise<T>;
  } = {
    execute: vi.fn(
      async (input: string | { sql: string; args?: unknown[] }) => {
        if (typeof input === "string") {
          await pglite.exec(input);
          return { rows: [] as unknown[], rowsAffected: 0 };
        }
        const stmt = await pglite.prepare(input.sql);
        const args = (input.args ?? []) as unknown[];
        if (/^\s*select/i.test(input.sql)) {
          return { rows: await stmt.all(...args), rowsAffected: 0 };
        }
        const info = await stmt.run(...args);
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
  isProductionServerlessFunctionRuntime: () => false,
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
  recordRunDiagnostic,
  RUN_DIAG_STAGE,
  BACKGROUND_PROCESSING_RUN_STALE_MS,
  STALE_RUN_TERMINAL_REASON,
  __resetNoRunningRunsProbeForTests,
} = await import("./run-store.js");

// The sweeps' shared `status='running'` probe caches a negative answer for
// seconds; tests insert their rows in milliseconds, so clear it per test.
beforeEach(async () => {
  __resetNoRunningRunsProbeForTests();
});

let seq = 0;
function ids(): { runId: string; thread: string; turn: string } {
  seq += 1;
  return {
    runId: `run-recover-${seq}`,
    thread: `thread-recover-${seq}`,
    turn: `turn-recover-${seq}`,
  };
}

async function setStaleLiveness(runId: string, atMs: number): Promise<void> {
  await pglite
    .prepare(
      `UPDATE agent_runs SET heartbeat_at = ?, last_progress_at = ? WHERE id = ?`,
    )
    .run(atMs, atMs, runId);
}

// Simulates a run that started long enough ago to be reap-eligible, made a
// token of real progress a few seconds in, then went completely silent for
// the rest of its life — the "deterministic early hang" signature behind
// the STALE_RUN_RECOVERY_CONSECUTIVE_NO_PROGRESS_LIMIT circuit breaker.
async function setDeadOnArrival(
  runId: string,
  startedAtMs: number,
): Promise<void> {
  await pglite
    .prepare(
      `UPDATE agent_runs SET started_at = ?, heartbeat_at = ?, last_progress_at = ? WHERE id = ?`,
    )
    .run(startedAtMs, startedAtMs + 5_000, startedAtMs + 5_000, runId);
}

async function readRow(runId: string): Promise<
  | {
      id: string;
      status: string;
      turn_id: string | null;
      dispatch_mode: string | null;
      dispatch_payload: string | null;
      terminal_reason: string | null;
      diag_stage: string | null;
    }
  | undefined
> {
  const rows = await pglite
    .prepare(
      `SELECT id, status, turn_id, dispatch_mode, dispatch_payload, terminal_reason, diag_stage FROM agent_runs WHERE id = ?`,
    )
    .all(runId);
  return rows[0] as any;
}

async function rowsForTurn(
  turnId: string,
): Promise<Array<{ id: string; status: string }>> {
  return (await pglite
    .prepare(`SELECT id, status FROM agent_runs WHERE turn_id = ?`)
    .all(turnId)) as any;
}

// Seeds a PRIOR, already-terminal run for a turn directly (bypassing the
// reap path) so a test can control its error_code/started_at independently —
// used to build the "N stale_run rows already exist for this turn" fixtures
// the total-cap check reads.
async function seedPriorRun(
  runId: string,
  thread: string,
  turn: string,
  opts: { errorCode: string; startedAtMs: number },
): Promise<void> {
  await insertRun(runId, thread, turn, { dispatchMode: "background" });
  await pglite
    .prepare(
      `UPDATE agent_runs SET status = 'errored', error_code = ?, started_at = ? WHERE id = ?`,
    )
    .run(opts.errorCode, opts.startedAtMs, runId);
}

const STALE_PAST_MS = 5 * 60_000; // comfortably past BACKGROUND_RUN_STALE_MS (90s)

describe("FIX 3 — stale-run reaper server-owned recovery (reapIfStale)", () => {
  it("records an early Stop as a turn marker before any real run exists", async () => {
    currentClient = makeRawClient(true);
    const { thread, turn } = ids();

    await markTurnAborted(thread, turn);

    expect(await isTurnAborted(thread, turn)).toBe(true);
    expect(await isTurnAborted(thread, `${turn}-other`)).toBe(false);
    const [marker] = (await pglite
      .prepare(`SELECT status, dispatch_mode FROM agent_runs WHERE id = ?`)
      .all(`turn-abort-${turn}`)) as
      | { status: string; dispatch_mode: string }
      | undefined;
    expect(marker).toEqual({ status: "aborted", dispatch_mode: "turn-abort" });
  });

  it("also aborts a run inserted after the caller's first cancellation check", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, { dispatchMode: "background" });

    await markTurnAborted(thread, turn);

    expect(await isTurnAborted(thread, turn)).toBe(true);
    expect((await readRow(runId))?.status).toBe("aborted");
  });

  it("escalates Stop on one chunk to every run of the same turn", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, { dispatchMode: "background" });
    const successor = `${runId}-chunk2`;
    await insertRun(successor, thread, turn, { dispatchMode: "background" });

    const { abortTurnDurably } = await import("./run-manager.js");
    await abortTurnDurably(runId);

    // Without the turn marker the successor claims itself and the turn keeps
    // looping — the "Stop didn't stop it" report.
    expect(await isTurnAborted(thread, turn)).toBe(true);
    expect((await readRow(successor))?.status).toBe("aborted");
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
    await setStaleLiveness(runId, Date.now() - STALE_PAST_MS);

    const reaped = await reapIfStale(runId);
    expect(reaped).toBe(true);

    const oldRow = await readRow(runId);
    expect(oldRow?.status).toBe("errored");
    expect(oldRow?.terminal_reason).toBe(STALE_RUN_TERMINAL_REASON);
    // Terminal writes elsewhere NULL dispatch_payload, but reapIfStale's own
    // UPDATE never touches it directly — the important invariant is that the
    // payload was captured into the successor before the row went terminal.
    expect(oldRow?.diag_stage).toContain("stale_run_recovery_attempted");
    expect(oldRow?.diag_stage).toContain("recovered");

    const siblings = await rowsForTurn(turn);
    expect(siblings).toHaveLength(2); // the original + exactly one successor
    const successorRow = siblings.find((r) => r.id !== runId);
    expect(successorRow).toBeDefined();
    expect(successorRow?.status).toBe("running");
    const successorFull = await readRow(successorRow!.id);
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
    expect(await rowsForTurn(turn)).toHaveLength(2);
  });

  it("stops recovering after 3 consecutive stale_run reaps that made near-zero progress (deterministic dead-on-arrival loop)", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    const payload = JSON.stringify({ message: "doomed request" });
    const longAgo = Date.now() - STALE_PAST_MS;

    await insertRun(runId, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: payload,
    });
    await claimBackgroundRun(runId);
    await setDeadOnArrival(runId, longAgo);
    expect(await reapIfStale(runId)).toBe(true);

    let siblings = await rowsForTurn(turn);
    expect(siblings).toHaveLength(2); // original + 1st successor (recovered)
    let successorId = siblings.find((r) => r.id !== runId)!.id;

    await claimBackgroundRun(successorId);
    await setDeadOnArrival(successorId, longAgo);
    expect(await reapIfStale(successorId)).toBe(true);

    siblings = await rowsForTurn(turn);
    expect(siblings).toHaveLength(3); // + 2nd successor (recovered) — 2 in a row isn't enough to trip the breaker
    const thirdRunId = siblings.find(
      (r) => r.id !== runId && r.id !== successorId,
    )!.id;

    await claimBackgroundRun(thirdRunId);
    await setDeadOnArrival(thirdRunId, longAgo);
    expect(await reapIfStale(thirdRunId)).toBe(true);

    // The 3rd consecutive dead-on-arrival stale_run reap trips the breaker —
    // no 4th successor, and the decline is diagnosable.
    expect((await readRow(thirdRunId))?.diag_stage).toContain("declined");
    expect((await readRow(thirdRunId))?.diag_stage).toContain(
      "repeated_no_progress",
    );
    expect(await rowsForTurn(turn)).toHaveLength(3);
  });

  it("stops recovering once 3 stale_run rows exist for a turn even when a non-stale run is interleaved (total cap, order-independent)", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    const longAgo = Date.now() - STALE_PAST_MS;

    // 3 prior stale_run rows, with a non-stale http_429 row interleaved
    // between them — the CONSECUTIVE check (3-in-a-row) would be reset by
    // the interleaved row, but the total cap counts all 3 regardless of
    // order or what happened in between.
    await seedPriorRun(`${runId}-p1`, thread, turn, {
      errorCode: "stale_run",
      startedAtMs: longAgo,
    });
    await seedPriorRun(`${runId}-p2`, thread, turn, {
      errorCode: "http_429",
      startedAtMs: longAgo + 1_000,
    });
    await seedPriorRun(`${runId}-p3`, thread, turn, {
      errorCode: "stale_run",
      startedAtMs: longAgo + 2_000,
    });
    await seedPriorRun(`${runId}-p4`, thread, turn, {
      errorCode: "stale_run",
      startedAtMs: longAgo + 3_000,
    });

    await insertRun(runId, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({ ok: true }),
    });
    await claimBackgroundRun(runId);
    await setStaleLiveness(runId, longAgo + 4_000);

    const reaped = await reapIfStale(runId);
    expect(reaped).toBe(true);
    expect((await readRow(runId))?.diag_stage).toContain("declined");
    expect((await readRow(runId))?.diag_stage).toContain(
      "repeated_no_progress",
    );
    // 4 priors + the reaped row = 5 rows; no successor inserted.
    expect(await rowsForTurn(turn)).toHaveLength(5);
  });

  it("two prior stale rows plus the current one still allows a successor; three prior stale rows decline", async () => {
    currentClient = makeRawClient(true);

    // 2 PRIOR stale_run rows — below the cap — and the row currently being
    // reaped is NOT a prior row, so it still gets a successor (3rd
    // successor overall would come from a 3rd prior, not from this one).
    {
      const { runId, thread, turn } = ids();
      const longAgo = Date.now() - STALE_PAST_MS;
      await seedPriorRun(`${runId}-p1`, thread, turn, {
        errorCode: "stale_run",
        startedAtMs: longAgo,
      });
      await seedPriorRun(`${runId}-p2`, thread, turn, {
        errorCode: "stale_run",
        startedAtMs: longAgo + 1_000,
      });
      await insertRun(runId, thread, turn, {
        dispatchMode: "background",
        dispatchPayload: JSON.stringify({ ok: true }),
      });
      await claimBackgroundRun(runId);
      await setStaleLiveness(runId, longAgo + 2_000);

      expect(await reapIfStale(runId)).toBe(true);
      expect((await readRow(runId))?.diag_stage).toContain("recovered");
      // 2 priors + the reaped row + 1 new successor = 4.
      expect(await rowsForTurn(turn)).toHaveLength(4);
    }

    // 3 PRIOR stale_run rows — AT the cap — this reap is declined.
    {
      const { runId, thread, turn } = ids();
      const longAgo = Date.now() - STALE_PAST_MS;
      await seedPriorRun(`${runId}-p1`, thread, turn, {
        errorCode: "stale_run",
        startedAtMs: longAgo,
      });
      await seedPriorRun(`${runId}-p2`, thread, turn, {
        errorCode: "stale_run",
        startedAtMs: longAgo + 1_000,
      });
      await seedPriorRun(`${runId}-p3`, thread, turn, {
        errorCode: "stale_run",
        startedAtMs: longAgo + 2_000,
      });
      await insertRun(runId, thread, turn, {
        dispatchMode: "background",
        dispatchPayload: JSON.stringify({ ok: true }),
      });
      await claimBackgroundRun(runId);
      await setStaleLiveness(runId, longAgo + 3_000);

      const reaped = await reapIfStale(runId);
      expect(reaped).toBe(true);
      expect((await readRow(runId))?.diag_stage).toContain(
        "repeated_no_progress",
      );
      // 3 priors + the reaped row = 4; no successor inserted.
      expect(await rowsForTurn(turn)).toHaveLength(4);
    }
  });

  it("preserves the dying worker's own last-recorded stage in the recovery diagnostic before it gets overwritten", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({ ok: true }),
    });
    await claimBackgroundRun(runId);
    // The dying run's own worker recorded losing the claim (a duplicate
    // delivery already owned it) right before it went silent — this is the
    // forensic signal `reapSingleStaleRun` must capture before its own
    // `staleRunRecoveryAttempted` write overwrites `diag_stage`.
    await recordRunDiagnostic(runId, RUN_DIAG_STAGE.workerClaimLost);
    await setStaleLiveness(runId, Date.now() - STALE_PAST_MS);

    const reaped = await reapIfStale(runId);
    expect(reaped).toBe(true);
    const diag = (await readRow(runId))?.diag_stage ?? "";
    expect(diag).toContain("recovered");
    expect(diag).toContain("priorDiag=worker_claim_lost");
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
    await setStaleLiveness(runId, Date.now() - STALE_PAST_MS);

    const reaped = await reapIfStale(runId);
    expect(reaped).toBe(true);
    expect((await readRow(runId))?.status).toBe("errored");
    expect((await readRow(runId))?.diag_stage).toContain("declined");
    expect((await readRow(runId))?.diag_stage).toContain("budget_exhausted");

    // 25 priors + the reaped row itself = 26 rows for the turn; no successor.
    expect(await rowsForTurn(turn)).toHaveLength(26);
  });

  it("does NOT create a successor when the dying run has no dispatch_payload to carry over", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    // No dispatchPayload — an in-process background automation, which was never
    // HTTP-dispatched and so has no request body to rehydrate.
    await insertRun(runId, thread, turn, { dispatchMode: "background" });
    await claimBackgroundRun(runId);
    await setStaleLiveness(runId, Date.now() - STALE_PAST_MS);

    const reaped = await reapIfStale(runId);
    expect(reaped).toBe(true);
    expect((await readRow(runId))?.status).toBe("errored");
    // Named for what it is. "payload_missing" read as data loss in production
    // forensics for the one case where nothing was ever lost.
    expect((await readRow(runId))?.diag_stage).toContain("not_redispatchable");
    expect(await rowsForTurn(turn)).toHaveLength(1); // no successor inserted
  });

  it("gives a claimed run with no redispatch path the wider background stale window", async () => {
    currentClient = makeRawClient(true);
    // A payload-less claimed run is an in-process automation: reaping it at the
    // 45s post-claim window kills a job that is still working and that nothing
    // can recover. It must survive to the 90s background window instead.
    const noPayload = ids();
    await insertRun(noPayload.runId, noPayload.thread, noPayload.turn, {
      dispatchMode: "background",
    });
    await claimBackgroundRun(noPayload.runId);
    await setStaleLiveness(
      noPayload.runId,
      Date.now() - (BACKGROUND_PROCESSING_RUN_STALE_MS + 5_000),
    );
    expect(await reapIfStale(noPayload.runId)).toBe(false);
    expect((await readRow(noPayload.runId))?.status).toBe("running");

    // A genuine HTTP worker (payload present) keeps the tight window, because
    // for it an early reap does buy a durable successor.
    const withPayload = ids();
    await insertRun(withPayload.runId, withPayload.thread, withPayload.turn, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({ threadId: withPayload.thread }),
    });
    await claimBackgroundRun(withPayload.runId);
    await setStaleLiveness(
      withPayload.runId,
      Date.now() - (BACKGROUND_PROCESSING_RUN_STALE_MS + 5_000),
    );
    expect(await reapIfStale(withPayload.runId)).toBe(true);
  });

  it("does NOT create a successor when a newer run already exists for the same turn", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({ ok: true }),
    });
    await claimBackgroundRun(runId);
    await setStaleLiveness(runId, Date.now() - STALE_PAST_MS);
    // A normal chainServerDrivenContinuation (or an earlier recovery pass)
    // already continued this turn with a genuinely newer row.
    await new Promise((resolve) => setTimeout(resolve, 2));
    const newerRunId = `${runId}-already-continued`;
    await insertRun(newerRunId, thread, turn, { dispatchMode: "background" });

    const reaped = await reapIfStale(runId);
    expect(reaped).toBe(true);
    expect((await readRow(runId))?.status).toBe("errored");
    expect((await readRow(runId))?.diag_stage).toContain("newer_run_exists");
    // Only the original + the pre-existing newer run — nothing new inserted.
    expect(await rowsForTurn(turn)).toHaveLength(2);
  });

  it("does NOT attempt recovery for a foreground (non-background) run", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn); // no dispatchMode => plain foreground row
    await setStaleLiveness(runId, Date.now() - 60_000);

    const reaped = await reapIfStale(runId);
    expect(reaped).toBe(true);
    expect((await readRow(runId))?.status).toBe("errored");
    // "not_background" is the common case and is deliberately NOT recorded
    // as a diag stage (see attemptStaleRunRecovery's doc comment) — the row
    // must not gain a stale-run-recovery diag entry at all.
    expect((await readRow(runId))?.diag_stage ?? "").not.toContain(
      "stale_run_recovery_attempted",
    );
    expect(await rowsForTurn(turn)).toHaveLength(1);
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
    await setStaleLiveness(runId, Date.now() - STALE_PAST_MS);

    const reaped = await reapIfStale(runId);
    expect(reaped).toBe(true);
    expect((await readRow(runId))?.status).toBe("errored");
    expect(await rowsForTurn(turn)).toHaveLength(2);
  });

  it("serializes two concurrent reapers for the same turn so the cap is never exceeded", async () => {
    // Two stale rows of the SAME turn reaped at the same moment — e.g. a
    // client's `reapIfStale` poll racing the startup `reapAllStaleRuns`
    // sweep. Before the per-turn `pg_advisory_xact_lock`, both transactions
    // could read the stale-successor count before either had inserted, and
    // both would pass the cap check and create a successor.
    //
    // NOTE ON THIS HARNESS: production's real `DbExec.transaction()` (see
    // `db/client.ts`) checks out a DEDICATED connection from a pool per
    // call, so two concurrent `.transaction()` calls get real, isolated
    // Postgres sessions — exactly what `pg_advisory_xact_lock` is built to
    // serialize. This spec file's mock instead runs every "transaction"
    // through ONE shared PGlite instance with hand-rolled `BEGIN`/`COMMIT`
    // text, so a second concurrent `BEGIN` here never opens a real nested
    // transaction — Postgres just keeps using the first one, merging both
    // reaps' statements into a single visibility scope. Confirmed with
    // tracing: both reaps' own terminal UPDATEs land before EITHER reads
    // the stale-successor count, so both counts come out identical (each
    // sees the other as already-stale), and the two reaps always reach the
    // SAME pass/fail verdict — this harness cannot reproduce "one wins, one
    // loses". What it CAN still assert is the invariant that must never
    // break regardless: the turn never ends up with MORE successors than
    // the cap allows, even when two reaps are launched concurrently.
    currentClient = makeRawClient(true);
    const { thread, turn } = ids();
    const longAgo = Date.now() - STALE_PAST_MS;

    // 2 PRIOR stale rows — at the cap (3) once EITHER concurrent reap below
    // counts the other as a 3rd already-stale sibling (see NOTE above), so
    // neither creates a successor: the turn is never left with more than
    // the 1 successor slot the cap actually had room for.
    const p1 = `${turn}-p1`;
    const p2 = `${turn}-p2`;
    await seedPriorRun(p1, thread, turn, {
      errorCode: "stale_run",
      startedAtMs: longAgo,
    });
    await seedPriorRun(p2, thread, turn, {
      errorCode: "stale_run",
      startedAtMs: longAgo + 1_000,
    });

    const runA = `${turn}-a`;
    const runB = `${turn}-b`;
    await insertRun(runA, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({ ok: true }),
    });
    await insertRun(runB, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({ ok: true }),
    });
    await claimBackgroundRun(runA);
    await claimBackgroundRun(runB);
    // Same `started_at` for both — the pre-existing `newer_run_exists` guard
    // (a DIFFERENT, already-correct check) compares each row's own
    // started_at against its siblings', and would otherwise deterministically
    // decline whichever of A/B is older regardless of the race this test is
    // actually targeting.
    const sameStartedAt = longAgo + 2_000;
    await pglite
      .prepare(
        `UPDATE agent_runs SET started_at = ?, heartbeat_at = ?, last_progress_at = ? WHERE id = ?`,
      )
      .run(sameStartedAt, sameStartedAt, sameStartedAt, runA);
    await pglite
      .prepare(
        `UPDATE agent_runs SET started_at = ?, heartbeat_at = ?, last_progress_at = ? WHERE id = ?`,
      )
      .run(sameStartedAt, sameStartedAt, sameStartedAt, runB);

    const [reapedA, reapedB] = await Promise.all([
      reapIfStale(runA),
      reapIfStale(runB),
    ]);
    expect(reapedA).toBe(true);
    expect(reapedB).toBe(true);

    const rows = await rowsForTurn(turn);
    const knownIds = new Set([p1, p2, runA, runB]);
    const successors = rows.filter((r) => !knownIds.has(r.id));
    // Never more than 1 successor for the turn, however the two concurrent
    // reaps interleave — this is the invariant `pg_advisory_xact_lock`
    // exists to guarantee once each reaper has its own real connection.
    expect(successors.length).toBeLessThanOrEqual(1);
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
    await setStaleLiveness(runId, Date.now() - STALE_PAST_MS);

    const swept = await reapAllStaleRuns();
    expect(swept.reaped).toBeGreaterThanOrEqual(1);
    expect(swept.failed).toBe(0);
    expect((await readRow(runId))?.status).toBe("errored");
    expect(await rowsForTurn(turn)).toHaveLength(2);

    // A second sweep pass over the now-terminal row must not stack another
    // successor.
    await reapAllStaleRuns();
    expect(await rowsForTurn(turn)).toHaveLength(2);
  });
});
