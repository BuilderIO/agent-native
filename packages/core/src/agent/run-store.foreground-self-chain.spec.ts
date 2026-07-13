import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

/**
 * SQL invariants behind the foreground self-chain
 * (`AGENT_CHAT_FOREGROUND_SELF_CHAIN`) — the "no double-run when the client
 * also continues" proof, exercised against a real SQLite engine (so the
 * conditional UPDATE / rowsAffected semantics are real, not mocked).
 *
 * The handoff protocol (see `chainServerDrivenContinuation` in
 * production-agent.ts): the finishing chunk PRE-INSERTS the successor row
 * (`dispatch_mode='background'`, status running, same thread + turn) BEFORE
 * the terminal `auto_continue` is ever emitted to the client (run-manager
 * emits terminal events only after onComplete). So by the time the client
 * could fire its own continuation re-POST, the successor row already exists —
 * and these tests pin that:
 *   1. `tryClaimRunSlot` refuses a racing client continuation POST for the
 *      whole handoff window (unclaimed AND claimed successor states), pointing
 *      it at the successor run to reconnect to instead (the 409 → adopt path).
 *   2. Duplicate deliveries of the successor dispatch dedupe via the atomic
 *      `claimBackgroundRun` CAS — at most one executes.
 *   3. When the handoff fails LOUDLY (successor errored), the thread slot is
 *      free again so the client's existing auto_continue re-POST fallback can
 *      proceed — a failed self-chain never deadlocks the turn.
 *   4. A successor whose dispatch was silently lost is covered by the SAME
 *      unclaimed-background reaper machinery as durable-background handoffs
 *      (`listUnclaimedBackgroundRunIds` + `reapUnclaimedBackgroundRun`).
 */

const sqlite = new Database(":memory:");

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
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
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => rawClient,
  intType: () => "INTEGER",
  isPostgres: () => false,
  retryOnDdlRace: (fn: () => any) => fn(),
}));

const {
  insertRun,
  claimBackgroundRun,
  tryClaimRunSlot,
  updateRunStatusIfRunning,
  listUnclaimedBackgroundRunIds,
  reapUnclaimedBackgroundRun,
  getRunById,
  getRunByThread,
  reapIfStale,
  setRunInFlightMarker,
  IN_FLIGHT_RUN_STALE_GRACE_MS,
  BACKGROUND_RUN_STALE_MS,
} = await import("./run-store.js");

let seq = 0;
function ids(): { chunk0: string; successor: string; thread: string } {
  seq += 1;
  return {
    chunk0: `run-fg-chunk0-${seq}`,
    successor: `run-fg-next-${seq}`,
    thread: `thread-fg-${seq}`,
  };
}

function setLiveness(runId: string, atMs: number): void {
  sqlite
    .prepare(
      `UPDATE agent_runs SET heartbeat_at = ?, started_at = ? WHERE id = ?`,
    )
    .run(atMs, atMs, runId);
}

/** Backdates BOTH heartbeat_at and last_progress_at (the full liveness basis
 *  `reapIfStale` reads — see `livenessBasisSql`, which takes the MAX of the
 *  two), leaving started_at (and in_flight_since) untouched. Mirrors the real
 *  incident: a run that started seconds ago (recent started_at) whose
 *  heartbeat AND progress writes both went silent for the whole stale window
 *  (reported time-since-progress: 90.1s) while an A2A call was demonstrably
 *  still in flight. Backdating heartbeat_at alone is NOT enough to reproduce
 *  the bug — a fresh `last_progress_at` from `insertRun` would keep the
 *  MAX-based liveness basis "fresh" regardless of in-flight grace. */
function setStaleLiveness(runId: string, atMs: number): void {
  sqlite
    .prepare(
      `UPDATE agent_runs SET heartbeat_at = ?, last_progress_at = ? WHERE id = ?`,
    )
    .run(atMs, atMs, runId);
}

function readInFlightSince(runId: string): number | null {
  const row = sqlite
    .prepare(`SELECT in_flight_since FROM agent_runs WHERE id = ?`)
    .get(runId) as { in_flight_since: number | null } | undefined;
  return row?.in_flight_since ?? null;
}

describe("foreground self-chain — pre-inserted successor vs racing client continuation", () => {
  it("tryClaimRunSlot refuses the client's continuation POST while the UNCLAIMED successor holds the slot", async () => {
    const { chunk0, successor, thread } = ids();
    await insertRun(chunk0, thread, "turn-1");
    // Chunk-0 finishes at its soft-timeout boundary; the chain pre-inserts the
    // successor BEFORE chunk-0 goes terminal (so there is never a gap where
    // the thread looks idle).
    await insertRun(successor, thread, "turn-1", {
      dispatchMode: "background",
    });
    await updateRunStatusIfRunning(chunk0, "completed");

    // A racing client auto_continue re-POST hits the atomic thread-slot claim
    // and must NOT be allowed to start a duplicate run — it is pointed at the
    // successor run to reconnect to (the client's 409 → adopt path).
    const slot = await tryClaimRunSlot(thread);
    expect(slot.claimed).toBe(false);
    expect(slot.activeRunId).toBe(successor);
  });

  it("tryClaimRunSlot still refuses after the successor worker CLAIMED the run", async () => {
    const { chunk0, successor, thread } = ids();
    await insertRun(chunk0, thread, "turn-1");
    await insertRun(successor, thread, "turn-1", {
      dispatchMode: "background",
    });
    await updateRunStatusIfRunning(chunk0, "completed");

    expect(await claimBackgroundRun(successor)).toBe(true);

    const slot = await tryClaimRunSlot(thread);
    expect(slot.claimed).toBe(false);
    expect(slot.activeRunId).toBe(successor);
  });

  it("duplicate deliveries of the successor dispatch dedupe via the atomic claim", async () => {
    const { successor, thread } = ids();
    await insertRun(successor, thread, "turn-1", {
      dispatchMode: "background",
    });

    // E.g. the awaited first dispatch attempt timed out (regular-function
    // target responds only after the chunk finishes) and a retry delivered a
    // second copy: exactly ONE re-entered worker may win the claim.
    const [a, b] = await Promise.all([
      claimBackgroundRun(successor),
      claimBackgroundRun(successor),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    // The loser no-ops (already-claimed ack) — it never runs the chunk.
    expect(await claimBackgroundRun(successor)).toBe(false);
  });

  it("a LOUDLY failed handoff frees the slot so the client auto_continue fallback can proceed", async () => {
    const { chunk0, successor, thread } = ids();
    await insertRun(chunk0, thread, "turn-1");
    await insertRun(successor, thread, "turn-1", {
      dispatchMode: "background",
    });

    // Chain dispatch failed on every attempt: chainServerDrivenContinuation
    // errors BOTH rows (never a silent loss)...
    await updateRunStatusIfRunning(successor, "errored");
    await updateRunStatusIfRunning(chunk0, "errored");

    // ...and the client (which still receives the terminal auto_continue —
    // run-manager emits it after onComplete) can re-POST its continuation:
    // the thread slot is free again. No deadlock, no double-run.
    const slot = await tryClaimRunSlot(thread);
    expect(slot.claimed).toBe(true);
  });
});

describe("foreground self-chain — reaper coverage for the handoff window", () => {
  it("a successor stuck unclaimed past the grace is swept into a loud recoverable error", async () => {
    const { successor, thread } = ids();
    await insertRun(successor, thread, "turn-1", {
      dispatchMode: "background",
    });
    // The dispatch was silently lost; the row's liveness ages out.
    setLiveness(successor, Date.now() - 60_000);

    // The SAME sweep that covers durable-background handoffs picks it up —
    // the foreground self-chain adds no new reaper brain.
    const staleIds = await listUnclaimedBackgroundRunIds();
    expect(staleIds).toContain(successor);
    expect(await reapUnclaimedBackgroundRun(successor)).toBe(true);
    expect((await getRunById(successor))?.status).toBe("errored");
    // Terminal → the atomic claim refuses a late delivery of the lost dispatch.
    expect(await claimBackgroundRun(successor)).toBe(false);
  });

  it("a FRESH successor (dispatch in flight) is NOT reaped", async () => {
    const { successor, thread } = ids();
    await insertRun(successor, thread, "turn-1", {
      dispatchMode: "background",
    });

    expect(await listUnclaimedBackgroundRunIds()).not.toContain(successor);
    expect(await reapUnclaimedBackgroundRun(successor)).toBe(false);
    expect((await getRunById(successor))?.status).toBe("running");
  });

  // ── Deferred-successor recovery: sweep redispatch vs. reap interleaving ──
  // A dispatch-deferred successor can now be recovered by the sweep OR reaped by
  // a backstop; these prove the claim CAS keeps the two mutually exclusive so
  // there is never a double-run and never a run-forever.

  it("a redispatched worker that ARRIVES AFTER the row was reaped cannot execute (CAS requires status='running')", async () => {
    const { successor, thread } = ids();
    await insertRun(successor, thread, "turn-1", {
      dispatchMode: "background",
    });
    setLiveness(successor, Date.now() - 60_000);

    // A backstop (client-poll past the bound, or reapIfStale) reaps the row
    // first: it is now terminal.
    expect(await reapUnclaimedBackgroundRun(successor)).toBe(true);
    expect((await getRunById(successor))?.status).toBe("errored");

    // A sweep redispatch that was already in flight lands late; the worker it
    // wakes tries to claim — the CAS (status='running' AND
    // dispatch_mode='background') rejects the reaped row, so it no-ops instead
    // of executing a turn nobody is watching.
    expect(await claimBackgroundRun(successor)).toBe(false);
  });

  it("once a redispatched worker CLAIMS the row, a later reap cannot resurrect or double-run it", async () => {
    const { successor, thread } = ids();
    await insertRun(successor, thread, "turn-1", {
      dispatchMode: "background",
    });

    // The sweep redispatched and a worker won the claim first: the row is now
    // dispatch_mode='background-processing', still running.
    expect(await claimBackgroundRun(successor)).toBe(true);

    // A concurrent unclaimed-reap can no longer touch it — its WHERE clause
    // requires dispatch_mode='background', which the claim already changed. So
    // the claimed worker owns the run exclusively; no reap, no second claim.
    setLiveness(successor, Date.now() - 60_000);
    expect(await reapUnclaimedBackgroundRun(successor)).toBe(false);
    expect((await getRunById(successor))?.status).toBe("running");
    expect(await claimBackgroundRun(successor)).toBe(false);
  });
});

/**
 * In-flight grace for `reapIfStale` — the fix for the Design/Assets A2A
 * incident: a `call-agent` A2A delegation held a background-dispatched run in
 * genuine, demonstrable progress while the heartbeat WRITE failed (Neon
 * pooler saturation), and the cross-isolate reaper (a client's SQL-
 * subscription poll / `getActiveRunForThreadAsync`) killed it at
 * `BACKGROUND_RUN_STALE_MS` anyway because it had no visibility into
 * run-manager's in-memory `inFlightWorkCount`. `setRunInFlightMarker` mirrors
 * that counter's 0<->N transitions into the additive `in_flight_since`
 * column so the reaper — running in a different isolate, against a real SQL
 * engine here — can grant a bounded grace instead.
 */
describe("reapIfStale — in-flight grace (in_flight_since)", () => {
  it("setRunInFlightMarker round-trips through real SQL: sets on true, clears on false", async () => {
    const { successor: runId, thread } = ids();
    await insertRun(runId, thread, "turn-1", {
      dispatchMode: "background",
    });
    // Simulate a worker having claimed the run (dispatch_mode
    // 'background' -> 'background-processing') — the real state while it
    // holds a long A2A call.
    await claimBackgroundRun(runId);
    expect(readInFlightSince(runId)).toBeNull();

    await setRunInFlightMarker(runId, true);
    const since = readInFlightSince(runId);
    expect(since).not.toBeNull();
    expect(since).toBeGreaterThan(Date.now() - 5_000);

    // A nested 0->1 transition (defense-in-depth WHERE) must not clobber the
    // ORIGINAL start time with a later one.
    await new Promise((r) => setTimeout(r, 5));
    await setRunInFlightMarker(runId, true);
    expect(readInFlightSince(runId)).toBe(since);

    await setRunInFlightMarker(runId, false);
    expect(readInFlightSince(runId)).toBeNull();
  });

  it("does NOT reap a background run whose heartbeat lapsed past BACKGROUND_RUN_STALE_MS while in-flight work is within the bounded grace", async () => {
    const { successor: runId, thread } = ids();
    await insertRun(runId, thread, "turn-1", {
      dispatchMode: "background",
    });
    // Simulate a worker having claimed the run (dispatch_mode
    // 'background' -> 'background-processing') — the real state while it
    // holds a long A2A call.
    await claimBackgroundRun(runId);
    // Heartbeat write failed for the whole stale window (the reported
    // incident: 90.1s time-since-progress) while an A2A call started only
    // seconds ago and is still well within IN_FLIGHT_RUN_STALE_GRACE_MS.
    setStaleLiveness(runId, Date.now() - (BACKGROUND_RUN_STALE_MS + 5_000));
    await setRunInFlightMarker(runId, true);

    const reaped = await reapIfStale(runId);

    expect(reaped).toBe(false);
    expect((await getRunById(runId))?.status).toBe("running");
  });

  it("DOES reap the SAME run loudly once the bounded in-flight grace is exceeded", async () => {
    const { successor: runId, thread } = ids();
    await insertRun(runId, thread, "turn-1", {
      dispatchMode: "background",
    });
    // Simulate a worker having claimed the run (dispatch_mode
    // 'background' -> 'background-processing') — the real state while it
    // holds a long A2A call.
    await claimBackgroundRun(runId);
    setStaleLiveness(runId, Date.now() - (BACKGROUND_RUN_STALE_MS + 5_000));
    // The marker is still SET (work never resolved), but its own start time
    // is now past the bounded grace — a genuinely dead in-flight call, not a
    // slow one. Written directly (not via setRunInFlightMarker, which only
    // writes when NULL) to simulate time having passed since the real 0->1
    // transition.
    sqlite
      .prepare(`UPDATE agent_runs SET in_flight_since = ? WHERE id = ?`)
      .run(Date.now() - (IN_FLIGHT_RUN_STALE_GRACE_MS + 5_000), runId);

    const reaped = await reapIfStale(runId);

    expect(reaped).toBe(true);
    const row = await getRunById(runId);
    expect(row?.status).toBe("errored");
    expect(row?.errorCode).toBe("stale_run");
  });

  it("still reaps a background run with NO in-flight work at the ORIGINAL BACKGROUND_RUN_STALE_MS — no weakening of the no-in-flight case", async () => {
    const { successor: runId, thread } = ids();
    await insertRun(runId, thread, "turn-1", {
      dispatchMode: "background",
    });
    // Simulate a worker having claimed the run (dispatch_mode
    // 'background' -> 'background-processing') — the real state while it
    // holds a long A2A call.
    await claimBackgroundRun(runId);
    setStaleLiveness(runId, Date.now() - (BACKGROUND_RUN_STALE_MS + 5_000));
    // No setRunInFlightMarker call — in_flight_since stays NULL, exactly like
    // every pre-existing row before this migration.
    expect(readInFlightSince(runId)).toBeNull();

    const reaped = await reapIfStale(runId);

    expect(reaped).toBe(true);
    expect((await getRunById(runId))?.status).toBe("errored");
  });

  it("surfaces hasInFlightWork via getRunByThread's inFlightSince for the /runs/active wire signal", async () => {
    const { successor: runId, thread } = ids();
    await insertRun(runId, thread, "turn-1", {
      dispatchMode: "background",
    });
    // Simulate a worker having claimed the run (dispatch_mode
    // 'background' -> 'background-processing') — the real state while it
    // holds a long A2A call.
    await claimBackgroundRun(runId);

    let byThread = await getRunByThread(thread);
    expect(byThread?.inFlightSince).toBeNull();

    await setRunInFlightMarker(runId, true);
    byThread = await getRunByThread(thread);
    expect(byThread?.inFlightSince).not.toBeNull();

    await setRunInFlightMarker(runId, false);
    byThread = await getRunByThread(thread);
    expect(byThread?.inFlightSince).toBeNull();
  });

  it("claimBackgroundRun's CAS still rejects a second claimer on a row that also carries an in-flight marker", async () => {
    const { successor: runId, thread } = ids();
    await insertRun(runId, thread, "turn-1", {
      dispatchMode: "background",
    });
    await setRunInFlightMarker(runId, true);

    const [a, b] = await Promise.all([
      claimBackgroundRun(runId),
      claimBackgroundRun(runId),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await claimBackgroundRun(runId)).toBe(false);
  });
});
