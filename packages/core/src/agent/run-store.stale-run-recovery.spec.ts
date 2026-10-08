import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

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

let currentClient = makeRawClient(true);

vi.mock("../db/client.js", () => ({
  getDbExec: () => currentClient,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: (fn: () => any) => fn(),
}));

const fireInternalDispatchMock = vi.fn(async () => {});
vi.mock("../server/self-dispatch.js", () => ({
  fireInternalDispatch: (...args: unknown[]) =>
    fireInternalDispatchMock(...args),
}));

const {
  insertRun,
  tryClaimRunSlot,
  claimBackgroundRun,
  getRunByThread,
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

const STALE_PAST_MS = 5 * 60_000;

describe("FIX 3 — stale-run reaper server-owned recovery (reapIfStale)", () => {
  it("records an early Stop as a turn marker before any real run exists", async () => {
    currentClient = makeRawClient(true);
    const { thread, turn } = ids();

    await markTurnAborted(thread, turn);

    expect(await isTurnAborted(thread, turn)).toBe(true);
    expect(await isTurnAborted(thread, `${turn}-other`)).toBe(false);
    const [marker] = (await pglite
      .prepare(`SELECT status, dispatch_mode FROM agent_runs WHERE id = ?`)
      .all(
        `turn-abort:${encodeURIComponent(thread)}:${encodeURIComponent(turn)}`,
      )) as { status: string; dispatch_mode: string } | undefined;
    expect(marker).toEqual({ status: "aborted", dispatch_mode: "turn-abort" });
    const [legacyMarker] = (await pglite
      .prepare(`SELECT status, dispatch_mode FROM agent_runs WHERE id = ?`)
      .all(`turn-abort-${turn}`)) as
      | { status: string; dispatch_mode: string }
      | undefined;
    expect(legacyMarker).toEqual({
      status: "aborted",
      dispatch_mode: "turn-abort",
    });
  });

  it("keeps early Stop markers distinct when two threads reuse one turn id", async () => {
    currentClient = makeRawClient(true);
    const { thread, turn } = ids();
    const otherThread = `${thread}-other`;

    await markTurnAborted(thread, turn);
    await markTurnAborted(otherThread, turn);

    expect(await isTurnAborted(thread, turn)).toBe(true);
    expect(await isTurnAborted(otherThread, turn)).toBe(true);
    const markers = (await pglite
      .prepare(
        `SELECT id, thread_id FROM agent_runs WHERE turn_id = ? AND dispatch_mode = 'turn-abort' ORDER BY thread_id`,
      )
      .all(turn)) as Array<{ id: string; thread_id: string }>;
    expect(markers).toHaveLength(3);
    expect(new Set(markers.map((marker) => marker.id)).size).toBe(3);
  });

  it("also aborts a run inserted after the caller's first cancellation check", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, { dispatchMode: "background" });

    await markTurnAborted(thread, turn);

    expect(await isTurnAborted(thread, turn)).toBe(true);
    expect((await readRow(runId))?.status).toBe("aborted");
  });

  it("preserves a completed turn when cancellation arrives too late", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, { dispatchMode: "background" });
    await pglite
      .prepare(
        `UPDATE agent_runs SET status = 'completed', completed_at = ? WHERE id = ?`,
      )
      .run(Date.now(), runId);
    expect(await markTurnAborted(thread, turn)).toBe("already_terminal");

    expect(
      await getRunByThread(thread, { includeTerminal: true, turnId: turn }),
    ).toMatchObject({ id: runId, status: "completed" });
  });

  it("prevents a run claim after cancellation wins the thread lock", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    expect(await markTurnAborted(thread, turn)).toBe("aborted");

    await expect(
      tryClaimRunSlot(thread, runId, undefined, { turnId: turn }),
    ).resolves.toMatchObject({
      claimed: false,
      activeRunId: null,
      turnAborted: true,
    });
    expect(await readRow(runId)).toBeUndefined();
  });

  it("keeps an abort marker across a terminal continuation boundary", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, { dispatchMode: "background" });
    await pglite
      .prepare(
        `UPDATE agent_runs SET status = 'truncated', terminal_reason = 'loop_limit', completed_at = ? WHERE id = ?`,
      )
      .run(Date.now(), runId);
    await pglite
      .prepare(
        `INSERT INTO agent_run_events (run_id, seq, event_at, event_data) VALUES (?, ?, ?, ?)`,
      )
      .run(runId, 1, Date.now(), JSON.stringify({ type: "loop_limit" }));

    expect(await markTurnAborted(thread, turn)).toBe("aborted");
    await expect(
      tryClaimRunSlot(thread, `${runId}-successor`, undefined, {
        turnId: turn,
      }),
    ).resolves.toMatchObject({ turnAborted: true, claimed: false });
  });

  it("escalates Stop on one chunk to every run of the same turn", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, { dispatchMode: "background" });
    const successor = `${runId}-chunk2`;
    await insertRun(successor, thread, turn, { dispatchMode: "background" });

    const { abortTurnDurably } = await import("./run-manager.js");
    await abortTurnDurably(runId);

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
    expect(siblings).toHaveLength(2);
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
    expect(siblings).toHaveLength(2);
    let successorId = siblings.find((r) => r.id !== runId)!.id;

    await claimBackgroundRun(successorId);
    await setDeadOnArrival(successorId, longAgo);
    expect(await reapIfStale(successorId)).toBe(true);

    siblings = await rowsForTurn(turn);
    expect(siblings).toHaveLength(3);
    const thirdRunId = siblings.find(
      (r) => r.id !== runId && r.id !== successorId,
    )!.id;

    await claimBackgroundRun(thirdRunId);
    await setDeadOnArrival(thirdRunId, longAgo);
    expect(await reapIfStale(thirdRunId)).toBe(true);

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
    expect(await rowsForTurn(turn)).toHaveLength(5);
  });

  it("two prior stale rows plus the current one still allows a successor; three prior stale rows decline", async () => {
    currentClient = makeRawClient(true);

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
      expect(await rowsForTurn(turn)).toHaveLength(4);
    }

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

    expect(await rowsForTurn(turn)).toHaveLength(26);
  });

  it("does NOT create a successor when the dying run has no dispatch_payload to carry over", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, { dispatchMode: "background" });
    await claimBackgroundRun(runId);
    await setStaleLiveness(runId, Date.now() - STALE_PAST_MS);

    const reaped = await reapIfStale(runId);
    expect(reaped).toBe(true);
    expect((await readRow(runId))?.status).toBe("errored");
    expect((await readRow(runId))?.diag_stage).toContain("not_redispatchable");
    expect(await rowsForTurn(turn)).toHaveLength(1);
  });

  it("gives a claimed run with no redispatch path the wider background stale window", async () => {
    currentClient = makeRawClient(true);
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
    await new Promise((resolve) => setTimeout(resolve, 2));
    const newerRunId = `${runId}-already-continued`;
    await insertRun(newerRunId, thread, turn, { dispatchMode: "background" });

    const reaped = await reapIfStale(runId);
    expect(reaped).toBe(true);
    expect((await readRow(runId))?.status).toBe("errored");
    expect((await readRow(runId))?.diag_stage).toContain("newer_run_exists");
    expect(await rowsForTurn(turn)).toHaveLength(2);
  });

  it("does NOT attempt recovery for a foreground (non-background) run", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn);
    await setStaleLiveness(runId, Date.now() - 60_000);

    const reaped = await reapIfStale(runId);
    expect(reaped).toBe(true);
    expect((await readRow(runId))?.status).toBe("errored");
    expect((await readRow(runId))?.diag_stage ?? "").not.toContain(
      "stale_run_recovery_attempted",
    );
    expect(await rowsForTurn(turn)).toHaveLength(1);
  });

  it("falls back to insert-then-update ordering when the DbExec has no transaction() primitive, and still recovers", async () => {
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

    await reapAllStaleRuns();
    expect(await rowsForTurn(turn)).toHaveLength(2);
  });
});
