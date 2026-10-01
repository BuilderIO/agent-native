import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DbExec, DbExecStatement } from "../db/client.js";
import { runRecurringSweepHandlers } from "../jobs/sweep-hooks.js";
import {
  AppSyncState,
  registerSyncEventsPruneSweep,
  SYNC_EVENTS_PRUNE_STATE_CREATE_SQL,
  SYNC_EVENTS_PRUNE_SWEEP_ID,
} from "./poll.js";
import { readSyncEventsPruneState } from "./sync-events-prune.js";

const RETENTION_MS = 24 * 60 * 60 * 1000;
const WRITE_THROTTLE_MS = 5 * 60 * 1000;

let pg: PGlite;
let statements: string[];
let failWhen: ((sql: string) => boolean) | undefined;

function makeDb(): DbExec {
  return {
    async execute(statement: DbExecStatement) {
      const query =
        typeof statement === "string" ? { sql: statement } : statement;
      statements.push(query.sql);
      if (failWhen?.(query.sql)) throw new Error("canceling statement");
      let index = 0;
      const result = await pg.query(
        query.sql.replace(/\?/g, () => `$${++index}`),
        (query as { args?: unknown[] }).args ?? [],
      );
      return {
        rows: result.rows as any[],
        rowsAffected: result.affectedRows ?? 0,
      };
    },
  };
}

function stateWith(db: DbExec, pruneImmediately = true) {
  const state = new AppSyncState({ getDb: () => db });
  (
    state as unknown as { syncEventsInitPromise: Promise<boolean> }
  ).syncEventsInitPromise = Promise.resolve(true);
  if (pruneImmediately) {
    (state as unknown as { lastDurablePrune: number }).lastDurablePrune =
      Date.now() - WRITE_THROTTLE_MS - 1;
  }
  return state;
}

const probes = () =>
  statements.filter((sql) =>
    /SELECT version, created_at FROM sync_events/.test(sql),
  );

async function seedExpired(count: number) {
  await pg.query(
    `INSERT INTO sync_events (id, version, event_json, source, type, created_at)
     SELECT 'old-' || g, g, '{}', 'action', 'change', $1::bigint + g
     FROM generate_series(1, $2::int) g`,
    [Date.now() - RETENTION_MS - 10_000_000, count],
  );
}

const remaining = async (prefix: string) =>
  Number(
    (
      await pg.query(`SELECT COUNT(*) AS n FROM sync_events WHERE id LIKE $1`, [
        `${prefix}%`,
      ])
    ).rows[0]!.n,
  );

const event = { version: 1, source: "action", type: "change", key: "k" };

describe("sync_events prune wiring", () => {
  beforeEach(async () => {
    process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
    pg = await PGlite.create("memory://");
    await pg.exec(`
      CREATE TABLE sync_events (
        id TEXT PRIMARY KEY, version BIGINT NOT NULL, event_json TEXT NOT NULL,
        source TEXT NOT NULL, type TEXT NOT NULL, event_key TEXT, owner TEXT,
        org_id TEXT, resource_type TEXT, resource_id TEXT, created_at BIGINT NOT NULL
      );
      CREATE INDEX sync_events_version_idx ON sync_events (version);
    `);
    await pg.exec(SYNC_EVENTS_PRUNE_STATE_CREATE_SQL);
    statements = [];
    failWhen = undefined;
  });
  afterEach(async () => {
    delete process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS;
    vi.restoreAllMocks();
    await pg.close();
  });

  it("prunes in the background after a write without delaying the write", async () => {
    const db = makeDb();
    await seedExpired(500);
    await stateWith(db).persistSyncEvent(event);

    await vi.waitFor(async () => expect(await remaining("old-")).toBe(0));
    expect(await remaining("")).toBe(1);
  });

  it("defers the first prune on a cold process until its throttle window", async () => {
    const db = makeDb();
    await seedExpired(5);
    await stateWith(db, false).persistSyncEvent(event);

    expect(probes()).toHaveLength(0);
    expect(await remaining("old-")).toBe(5);
  });

  it("throttles the write-path prune to once per five minutes per process", async () => {
    const db = makeDb();
    const state = stateWith(db);
    await state.persistSyncEvent(event);
    await vi.waitFor(() => expect(probes()).toHaveLength(1));
    await state.persistSyncEvent(event);
    await state.persistSyncEvent(event);

    expect(probes()).toHaveLength(1);
  });

  it("shares one run between concurrent callers in a process", async () => {
    const db = makeDb();
    await seedExpired(50);
    const state = stateWith(db);

    const [a, b] = await Promise.all([
      state.pruneDurableEvents(db),
      state.pruneDurableEvents(db),
    ]);

    expect(a).toBe(b);
    expect(probes()).toHaveLength(1);
  });

  it("fails the recurring sweep tick when the prune fails, and records why", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = makeDb();
    await seedExpired(20);
    const unregister = registerSyncEventsPruneSweep(stateWith(db));
    failWhen = (sql) => /DELETE FROM sync_events/.test(sql);
    try {
      const tick = await runRecurringSweepHandlers({
        deadlineAt: Date.now() + 60_000,
      });

      expect(tick).toEqual({
        registered: 1,
        failed: [SYNC_EVENTS_PRUNE_SWEEP_ID],
      });
      expect(await remaining("old-")).toBe(20);
      expect(await readSyncEventsPruneState(db)).toMatchObject({
        consecutiveFailures: 1,
        lastError: "canceling statement",
        backlog: true,
      });
      expect(
        error.mock.calls.some((call) =>
          String(call[0]).includes("sync_events prune FAILED"),
        ),
      ).toBe(true);
    } finally {
      unregister();
    }
  });

  it("drains the backlog through the recurring sweep tick", async () => {
    const db = makeDb();
    await seedExpired(300);
    const unregister = registerSyncEventsPruneSweep(stateWith(db));
    try {
      const tick = await runRecurringSweepHandlers({
        deadlineAt: Date.now() + 60_000,
      });

      expect(tick.failed).toEqual([]);
      expect(await remaining("old-")).toBe(0);
    } finally {
      unregister();
    }
  });

  it("fails the sweep tick, not an idle pass, when sync_events cannot be prepared", async () => {
    const state = new AppSyncState({ getDb: makeDb });
    (
      state as unknown as { syncEventsInitPromise: Promise<boolean> }
    ).syncEventsInitPromise = Promise.resolve(false);

    await expect(
      state.pruneDurableEventsForSweep({ deadlineAt: Date.now() + 60_000 }),
    ).rejects.toThrow("retention prune skipped");
  });

  it("creates sync_events with only the indexes the read and the prune can use", async () => {
    await pg.exec(`DROP TABLE sync_events; DROP TABLE sync_events_prune_state`);
    const state = new AppSyncState({ getDb: makeDb });

    expect(await state.ensureSyncEventsTable()).toBe(true);

    const indexes = (
      await pg.query(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'sync_events' ORDER BY indexname`,
      )
    ).rows.map((row: any) => row.indexname);
    expect(indexes).toEqual(["sync_events_pkey", "sync_events_version_idx"]);
    expect(await readSyncEventsPruneState(makeDb())).toMatchObject({
      cursorVersion: 0,
      backlog: false,
    });
  });

  it("keeps writing sync events, loudly, when the prune state table cannot be created", async () => {
    await pg.exec(`DROP TABLE sync_events; DROP TABLE sync_events_prune_state`);
    failWhen = (sql) => sql.includes("sync_events_prune_state");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const state = new AppSyncState({ getDb: makeDb });

      expect(await state.ensureSyncEventsTable()).toBe(true);
      await state.persistSyncEvent(event);

      expect(await remaining("")).toBe(1);
      expect(
        errors.mock.calls.some((call) =>
          String(call[0]).includes("sync_events_prune_state_unavailable"),
        ),
      ).toBe(true);
    } finally {
      errors.mockRestore();
    }
  });

  it("skips the sweep prune when durable sync events are disabled", async () => {
    delete process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS;
    const db = makeDb();

    expect(
      await stateWith(db).pruneDurableEventsForSweep({
        deadlineAt: Date.now() + 60_000,
      }),
    ).toBeNull();
    expect(statements).toHaveLength(0);
  });
});
