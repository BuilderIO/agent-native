import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

/**
 * A run row that already carries its reconciled terminal values is converged,
 * and `reconcileTerminalRunFromEvents` must say so by returning false.
 *
 * The repair UPDATE still matches such a row (its WHERE admits
 * errored/stale_run so a real repair can re-run), and SQL counts an unchanged
 * rewrite as an affected row. Returning `rowsAffected > 0` therefore reported
 * "repaired" on every call for a row that never changed, and `getRunByThread`
 * re-reads and re-reconciles whenever reconciliation claims a repair — so a
 * single settled errored/stale_run row made every lookup for that thread
 * recurse without a fixed point, pinning the event loop and hanging the server
 * for every request, not just chat.
 */

const sqlite = new Database(":memory:");

const client = {
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
  getDbExec: () => client,
  intType: () => "INTEGER",
  isPostgres: () => false,
  retryOnDdlRace: (fn: () => any) => fn(),
}));

const {
  insertRun,
  insertRunEvent,
  reconcileTerminalRunFromEvents,
  getRunByThread,
  STALE_RUN_ERROR_EVENT,
} = await import("./run-store.js");

async function seedStaleRun(name: string) {
  const runId = `run-${name}`;
  const threadId = `thread-${name}`;
  await insertRun(runId, threadId, `turn-${name}`);
  await insertRunEvent(runId, 0, JSON.stringify(STALE_RUN_ERROR_EVENT));
  return { runId, threadId };
}

function markReapedStale(runId: string) {
  sqlite
    .prepare(
      `UPDATE agent_runs
       SET status = 'errored', error_code = ?, error_detail = ?,
           terminal_reason = 'stale_run', completed_at = ?
       WHERE id = ?`,
    )
    .run(
      STALE_RUN_ERROR_EVENT.errorCode,
      STALE_RUN_ERROR_EVENT.details,
      Date.now(),
      runId,
    );
}

describe("reconcileTerminalRunFromEvents convergence", () => {
  it("repairs a still-running row whose terminal event already landed", async () => {
    const { runId } = await seedStaleRun("needs-repair");

    await expect(reconcileTerminalRunFromEvents(runId)).resolves.toBe(true);

    const row = sqlite
      .prepare(`SELECT status, error_code FROM agent_runs WHERE id = ?`)
      .get(runId) as { status: string; error_code: string };
    expect(row.status).toBe("errored");
    expect(row.error_code).toBe(STALE_RUN_ERROR_EVENT.errorCode);
  });

  it("reaches a fixed point instead of reporting a repair forever", async () => {
    const { runId } = await seedStaleRun("converged");
    markReapedStale(runId);

    // The reaper's own terminal_reason can differ from the one derived from
    // the event, so the first pass may legitimately repair it. What must not
    // happen is a repair being reported on a row that no longer changes.
    await reconcileTerminalRunFromEvents(runId);

    await expect(reconcileTerminalRunFromEvents(runId)).resolves.toBe(false);
    await expect(reconcileTerminalRunFromEvents(runId)).resolves.toBe(false);
  });

  it("terminates getRunByThread for a settled errored/stale_run row", async () => {
    const { runId, threadId } = await seedStaleRun("lookup");
    markReapedStale(runId);

    const before = client.execute.mock.calls.length;
    const run = await getRunByThread(threadId, { includeTerminal: true });

    expect(run?.id).toBe(runId);
    expect(run?.status).toBe("errored");
    // Bounded query count is the actual regression signal: the recursion had
    // no fixed point, so an unfixed build never reaches this assertion.
    expect(client.execute.mock.calls.length - before).toBeLessThan(12);
  });
});
