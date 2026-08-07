import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppSyncState } from "./poll.js";

/**
 * Records every DELETE issued against sync_events and lets a test decide how
 * many rows each one removed, so batching and stop conditions are observable.
 */
function makeDb(
  options: {
    deletedPerBatch?: number[];
    failDeletes?: boolean;
  } = {},
) {
  const deletes: Array<{ sql: string; args: unknown[] }> = [];
  let batch = 0;
  return {
    deletes,
    exec: {
      execute: vi.fn(
        async (query: string | { sql: string; args?: unknown[] }) => {
          const sql = typeof query === "string" ? query : query.sql;
          const args = typeof query === "string" ? [] : (query.args ?? []);
          if (sql.includes("DELETE") && sql.includes("sync_events")) {
            if (options.failDeletes) throw new Error("deadlock detected");
            deletes.push({ sql, args });
            const n = options.deletedPerBatch?.[batch] ?? 0;
            batch++;
            return { rows: [] as any[], rowsAffected: n };
          }
          return { rows: [] as any[], rowsAffected: 0 };
        },
      ),
    },
  };
}

function stateWith(db: { exec: { execute: unknown } }) {
  return new AppSyncState({
    getDb: () => db.exec as never,
    isPostgres: () => false,
  });
}

describe("sync_events prune", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS;
    vi.restoreAllMocks();
  });

  // The old statement was `DELETE FROM sync_events WHERE created_at < ?`.
  // Only `version` is indexed, so that planned as a sequential scan over the
  // whole table — 47 GB on one production app.
  it("prunes by the indexed version column, oldest first, in bounded batches", async () => {
    const db = makeDb({ deletedPerBatch: [10_000, 3] });
    await stateWith(db).persistSyncEvent({
      version: 1,
      source: "action",
      type: "change",
      key: "k",
    });

    expect(db.deletes).toHaveLength(2);
    const [first] = db.deletes;
    expect(first.sql).toContain("version < ?");
    expect(first.sql).toContain("ORDER BY version");
    expect(first.sql).not.toContain("created_at <");
    // Bounded: a LIMIT argument, and a cutoff 24h behind the clock.
    expect(first.args).toEqual([1_800_000_000_000 - 86_400_000, 10_000]);
  });

  it("stops as soon as a batch comes back short, instead of spinning", async () => {
    const db = makeDb({ deletedPerBatch: [5] });
    await stateWith(db).persistSyncEvent({
      version: 1,
      source: "action",
      type: "change",
      key: "k",
    });
    expect(db.deletes).toHaveLength(1);
  });

  it("caps how long one prune call can run when there is a backlog", async () => {
    // Every batch comes back full, i.e. the table is far behind.
    const db = makeDb({ deletedPerBatch: Array(50).fill(10_000) });
    await stateWith(db).persistSyncEvent({
      version: 1,
      source: "action",
      type: "change",
      key: "k",
    });
    expect(db.deletes).toHaveLength(20);
  });

  // The previous `.catch(() => {})` is why a table could reach 47 GB with
  // nobody finding out: a prune that never succeeded looked exactly like a
  // prune with nothing to do.
  it("warns when the prune fails instead of swallowing it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = makeDb({ failDeletes: true });
    await stateWith(db).persistSyncEvent({
      version: 1,
      source: "action",
      type: "change",
      key: "k",
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toContain("sync_events prune failed");
  });

  it("does not repeat the warning every five minutes while it stays broken", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = makeDb({ failDeletes: true });
    const state = stateWith(db);
    const event = {
      version: 1,
      source: "action",
      type: "change",
      key: "k",
    };
    await state.persistSyncEvent(event);
    vi.setSystemTime(1_800_000_000_000 + 10 * 60 * 1000);
    await state.persistSyncEvent(event);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("throttles pruning to once per five minutes per process", async () => {
    const db = makeDb({ deletedPerBatch: [1] });
    const state = stateWith(db);
    const event = {
      version: 1,
      source: "action",
      type: "change",
      key: "k",
    };
    await state.persistSyncEvent(event);
    await state.persistSyncEvent(event);
    expect(db.deletes).toHaveLength(1);

    vi.setSystemTime(1_800_000_000_000 + 5 * 60 * 1000 + 1);
    await state.persistSyncEvent(event);
    expect(db.deletes).toHaveLength(2);
  });
});
