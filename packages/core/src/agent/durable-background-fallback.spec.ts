import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

/**
 * Safety invariants behind the durable-background *inline fallback*.
 *
 * When `fireInternalDispatch` throws (the self-POST failed fast, before any
 * background worker could claim the run), `production-agent.ts` no longer
 * errors the chat with "Failed to dispatch background run". Instead it claims
 * the already-inserted run row atomically via `claimBackgroundRun` and runs the
 * turn inline. The SQL atomic claim is the single backstop that guarantees at
 * most ONE of {inline fallback, a delayed background delivery} ever executes a
 * given run — these tests pin that claim's exclusivity against a real SQLite
 * engine (so the conditional UPDATE / rowsAffected semantics are exercised for
 * real, not mocked).
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

const { insertRun, claimBackgroundRun, getRunById, updateRunStatusIfRunning } =
  await import("./run-store.js");

let seq = 0;
function nextRunId(): string {
  seq += 1;
  return `run-fallback-${seq}`;
}

function dispatchModeOf(runId: string): string | null {
  const row = sqlite
    .prepare(`SELECT dispatch_mode FROM agent_runs WHERE id = ?`)
    .get(runId) as { dispatch_mode: string | null } | undefined;
  return row?.dispatch_mode ?? null;
}

describe("durable-background inline fallback — claimBackgroundRun exclusivity", () => {
  it("a single claimer wins on a freshly-inserted background row", async () => {
    const runId = nextRunId();
    await insertRun(runId, "thread-1", runId, { dispatchMode: "background" });

    // The inline fallback claims the row it inserted as 'background'.
    expect(await claimBackgroundRun(runId)).toBe(true);

    // The row is now owned (background-processing), still running.
    expect(dispatchModeOf(runId)).toBe("background-processing");
    expect((await getRunById(runId))?.status).toBe("running");
  });

  it("only ONE of two concurrent claimers wins (inline fallback vs delayed delivery)", async () => {
    const runId = nextRunId();
    await insertRun(runId, "thread-2", runId, { dispatchMode: "background" });

    // Race: the inline fallback and a (late) background worker both try to own
    // the same run. Exactly one conditional UPDATE may match dispatch_mode =
    // 'background', so exactly one wins.
    const [a, b] = await Promise.all([
      claimBackgroundRun(runId),
      claimBackgroundRun(runId),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("a second claim after the first loses — the delayed delivery no-ops", async () => {
    const runId = nextRunId();
    await insertRun(runId, "thread-3", runId, { dispatchMode: "background" });

    // Inline fallback wins first.
    expect(await claimBackgroundRun(runId)).toBe(true);
    // A delayed background delivery arrives later and tries to claim — it must
    // lose (so it returns the benign "already-claimed" ack and never runs).
    expect(await claimBackgroundRun(runId)).toBe(false);
  });

  it("cannot be claimed once the run is terminal (errored/reaped)", async () => {
    const runId = nextRunId();
    await insertRun(runId, "thread-4", runId, { dispatchMode: "background" });

    // Foreground gave up and flipped the row terminal before any claim.
    await updateRunStatusIfRunning(runId, "errored");
    // No worker (or fallback) may claim a terminal row.
    expect(await claimBackgroundRun(runId)).toBe(false);

    const row = await getRunById(runId);
    expect(row?.status).toBe("errored");
  });

  it("does NOT match a normal foreground (non-background) run", async () => {
    const runId = nextRunId();
    // Inline path inserts with no dispatch mode (foreground).
    await insertRun(runId, "thread-5", runId);
    expect(await claimBackgroundRun(runId)).toBe(false);
  });
});
