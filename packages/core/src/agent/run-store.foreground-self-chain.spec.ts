import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

/**
 * SQL invariants behind the OPT-IN foreground self-chain
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
});
