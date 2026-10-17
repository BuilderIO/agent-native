import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DbExec, DbExecStatement } from "../db/client.js";
import { SYNC_EVENTS_PRUNE_STATE_CREATE_SQL } from "./poll.js";
import {
  pruneSyncEvents,
  readSyncEventsPruneState,
  SYNC_EVENTS_RETENTION_MS,
} from "./sync-events-prune.js";

const NOW = 1_800_000_000_000;
const CUTOFF = NOW - SYNC_EVENTS_RETENTION_MS;

type Recorded = { sql: string; timeoutMs?: number; maxAttempts?: number };

let pg: PGlite;
let recorded: Recorded[];
let failWhen: ((sql: string) => boolean) | undefined;

function toPostgres(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function makeClient(): DbExec {
  return {
    async execute(statement: DbExecStatement) {
      const query =
        typeof statement === "string" ? { sql: statement } : statement;
      recorded.push({
        sql: query.sql,
        timeoutMs: (query as { timeoutMs?: number }).timeoutMs,
        maxAttempts: (query as { maxAttempts?: number }).maxAttempts,
      });
      if (failWhen?.(query.sql)) throw new Error("canceling statement");
      const args = (query as { args?: unknown[] }).args ?? [];
      const result = await pg.query(toPostgres(query.sql), args);
      return {
        rows: result.rows as any[],
        rowsAffected: result.affectedRows ?? 0,
      };
    },
  };
}

async function seed(
  prefix: string,
  count: number,
  firstVersion: number,
  createdAtFor: (index: number) => number,
) {
  await pg.query(
    `INSERT INTO sync_events (id, version, event_json, source, type, created_at)
     SELECT $1 || g, $2::bigint + g, '{}', 'action', 'change', ($3::bigint + g * $4::bigint)
     FROM generate_series(1, $5::int) g`,
    [
      prefix,
      firstVersion,
      createdAtFor(0),
      createdAtFor(1) - createdAtFor(0),
      count,
    ],
  );
}

const count = async (where = "TRUE") =>
  Number(
    (await pg.query(`SELECT COUNT(*) AS n FROM sync_events WHERE ${where}`))
      .rows[0]!.n as number | string,
  );

beforeEach(async () => {
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
  recorded = [];
  failWhen = undefined;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await pg.close();
});

describe("pruneSyncEvents", () => {
  it("makes bounded forward progress through a large old burst and never touches newer rows", async () => {
    const client = makeClient();
    // 12k expired rows (a burst) followed by 300 rows inside the window.
    await seed("old-", 12_000, 1_000_000, (i) => CUTOFF - 5_000_000 + i);
    await seed("new-", 300, 2_000_000, (i) => NOW - 60_000 + i);

    let calls = 0;
    let previousCursor = 0;
    for (; calls < 10; calls++) {
      const result = await pruneSyncEvents(client, {
        now: NOW,
        batchSize: 1_000,
        maxBatches: 3,
      });
      if (result.status !== "pruned") break;
      expect(result.deleted).toBeLessThanOrEqual(3_000);
      expect(result.cursorVersion).toBeGreaterThan(previousCursor);
      previousCursor = result.cursorVersion;
    }

    expect(calls).toBe(4);
    expect(await count("id LIKE 'old-%'")).toBe(0);
    expect(await count("id LIKE 'new-%'")).toBe(300);
    const state = await readSyncEventsPruneState(client);
    expect(state).toMatchObject({
      totalDeleted: 12_000,
      backlog: false,
      consecutiveFailures: 0,
      lastError: null,
    });
    expect(state.lastSuccessAt).not.toBeNull();
  });

  it("deletes strictly before the cutoff and keeps rows at or after it", async () => {
    const client = makeClient();
    await pg.query(
      `INSERT INTO sync_events (id, version, event_json, source, type, created_at) VALUES
       ('before', 1, '{}', 'a', 'b', $1), ('at', 2, '{}', 'a', 'b', $2), ('after', 3, '{}', 'a', 'b', $3)`,
      [CUTOFF - 1, CUTOFF, CUTOFF + 1],
    );

    const result = await pruneSyncEvents(client, { now: NOW });

    expect(result).toMatchObject({ status: "pruned", deleted: 1 });
    const ids = (
      await pg.query(`SELECT id FROM sync_events ORDER BY version`)
    ).rows.map((row: any) => row.id);
    expect(ids).toEqual(["at", "after"]);
  });

  it("pins the cursor below a survivor and prunes it once it ages out", async () => {
    const client = makeClient();
    // Version order is not perfectly time order: v5 is still inside the window.
    await pg.query(
      `INSERT INTO sync_events (id, version, event_json, source, type, created_at)
       SELECT 'v' || g, g, '{}', 'a', 'b', CASE WHEN g = 5 THEN $1::bigint ELSE $2::bigint END
       FROM generate_series(1, 10) g`,
      [NOW - 1_000, CUTOFF - 1_000],
    );

    const first = await pruneSyncEvents(client, { now: NOW });

    expect(first).toMatchObject({ status: "pruned", deleted: 9 });
    expect(await count()).toBe(1);
    expect((await readSyncEventsPruneState(client)).cursorVersion).toBe(4);

    const later = await pruneSyncEvents(client, {
      now: NOW + SYNC_EVENTS_RETENTION_MS,
      force: true,
    });
    expect(later).toMatchObject({ status: "pruned", deleted: 1 });
    expect(await count()).toBe(0);
  });

  it("bounds every statement and walks the version keyset, not created_at", async () => {
    const client = makeClient();
    await seed("old-", 50, 100, (i) => CUTOFF - 1_000_000 + i);

    await pruneSyncEvents(client, { now: NOW });

    const scans = recorded.filter((entry) =>
      /FROM sync_events\s/.test(entry.sql),
    );
    expect(scans.length).toBeGreaterThan(0);
    for (const entry of scans) {
      expect(entry.sql).not.toMatch(/ORDER BY[^)]*created_at/);
      expect(entry.sql).toMatch(/version >/);
      expect(entry.maxAttempts).toBe(1);
      expect(entry.timeoutMs).toBeGreaterThan(0);
      expect(entry.timeoutMs).toBeLessThanOrEqual(4_000);
    }
  });

  it("reports idle without taking the lease when the head is inside the window", async () => {
    const client = makeClient();
    await seed("new-", 5, 100, (i) => NOW - 1_000 + i);

    const result = await pruneSyncEvents(client, { now: NOW });

    expect(result).toEqual({ status: "idle" });
    expect(recorded.some((entry) => /lease_owner = \?/.test(entry.sql))).toBe(
      false,
    );
    expect(await count()).toBe(5);

    const before = recorded.length;
    expect(await pruneSyncEvents(client, { now: NOW })).toEqual({
      status: "idle",
    });
    // The recheck throttle answers from the state row without probing again.
    expect(
      recorded
        .slice(before)
        .some((entry) => /FROM sync_events\s/.test(entry.sql)),
    ).toBe(false);
  });

  it("returns a distinguishable failure, records it, and recovers", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = makeClient();
    await seed("old-", 40, 100, (i) => CUTOFF - 1_000_000 + i);
    failWhen = (sql) => /DELETE FROM sync_events/.test(sql);

    const first = await pruneSyncEvents(client, { now: NOW });
    expect(first).toMatchObject({
      status: "failed",
      error: "canceling statement",
      consecutiveFailures: 1,
    });
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toContain(
      "sync_events prune FAILED",
    );
    const second = await pruneSyncEvents(client, { now: NOW });
    expect(second).toMatchObject({ status: "failed", consecutiveFailures: 2 });
    expect(await count()).toBe(40);

    const failedState = await readSyncEventsPruneState(client);
    expect(failedState).toMatchObject({
      consecutiveFailures: 2,
      lastError: "canceling statement",
      backlog: true,
      leaseExpiresAt: 0,
    });
    expect(failedState.lastErrorAt).not.toBeNull();

    failWhen = undefined;
    const recovered = await pruneSyncEvents(client, { now: NOW });
    expect(recovered).toMatchObject({ status: "pruned", deleted: 40 });
    expect(await readSyncEventsPruneState(client)).toMatchObject({
      consecutiveFailures: 0,
      lastError: null,
      backlog: false,
    });
  });

  it("does not repeat the error log on every consecutive failure", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = makeClient();
    await seed("old-", 5, 100, (i) => CUTOFF - 1_000_000 + i);
    failWhen = (sql) => /DELETE FROM sync_events/.test(sql);

    for (let run = 0; run < 12; run++) {
      await pruneSyncEvents(client, { now: NOW });
    }

    // Logged for failures 1-3 and every 10th (10), not on all twelve.
    expect(error).toHaveBeenCalledTimes(4);
  });

  it("fails loudly when the state table is missing instead of reporting idle", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await pg.exec("DROP TABLE sync_events_prune_state");
    const client = makeClient();

    const result = await pruneSyncEvents(client, { now: NOW });

    expect(result).toMatchObject({ status: "failed" });
    expect(
      error.mock.calls.map((call) => String(call[0])).join("\n"),
    ).toContain("could not be recorded");
  });

  it("skips while another instance holds the lease and takes over once it expires", async () => {
    const client = makeClient();
    await seed("old-", 10, 100, (i) => CUTOFF - 1_000_000 + i);
    await readSyncEventsPruneState(client);
    await pg.query(
      `UPDATE sync_events_prune_state SET lease_owner = 'other', lease_expires_at = $1`,
      [Date.now() + 60_000],
    );

    expect(await pruneSyncEvents(client, { now: NOW })).toEqual({
      status: "lease-held",
    });
    expect(await count()).toBe(10);

    await pg.query(`UPDATE sync_events_prune_state SET lease_expires_at = $1`, [
      Date.now() - 1,
    ]);
    expect(await pruneSyncEvents(client, { now: NOW })).toMatchObject({
      status: "pruned",
      deleted: 10,
    });
  });

  it("lets exactly one of two racing instances prune", async () => {
    const client = makeClient();
    await seed("old-", 500, 100, (i) => CUTOFF - 1_000_000 + i);

    const results = await Promise.all([
      pruneSyncEvents(client, { now: NOW, force: true }),
      pruneSyncEvents(client, { now: NOW, force: true }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "lease-held",
      "pruned",
    ]);
    expect(await count()).toBe(0);
  });

  it("stops at its time budget and resumes from the persisted cursor", async () => {
    const client = makeClient();
    await seed("old-", 4_000, 100, (i) => CUTOFF - 5_000_000 + i);

    const first = await pruneSyncEvents(client, {
      now: NOW,
      batchSize: 500,
      maxBatches: 2,
    });
    expect(first).toMatchObject({
      status: "pruned",
      deleted: 1_000,
      drained: false,
    });
    expect((await readSyncEventsPruneState(client)).backlog).toBe(true);

    // A fresh process (new client, no memory) continues past the cursor.
    const resumed = await pruneSyncEvents(makeClient(), {
      now: NOW,
      batchSize: 500,
    });
    expect(resumed).toMatchObject({
      status: "pruned",
      deleted: 3_000,
      drained: true,
    });
    expect(await count()).toBe(0);
  });
});
