import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppSyncState } from "./poll.js";

const NOW = 1_800_000_000_000;

/**
 * Stands in for an app's `application_state`, where every mutating action
 * leaves one never-pruned `__action_change__` row per identity.
 */
function makeDb(
  markers: Array<{ session: string; ts: number; action: string }>,
) {
  const persisted: Array<{ id: string; key: string; owner: string }> = [];
  const markerQueries: Array<{ sql: string; args: unknown[] }> = [];
  return {
    persisted,
    markerQueries,
    exec: {
      execute: vi.fn(
        async (query: string | { sql: string; args?: unknown[] }) => {
          const sql = typeof query === "string" ? query : query.sql;
          const args = typeof query === "string" ? [] : (query.args ?? []);

          // Postgres uses `INSERT INTO`, sqlite `INSERT OR IGNORE INTO`.
          if (/insert(\s+or\s+ignore)?\s+into\s+sync_events/i.test(sql)) {
            persisted.push({
              id: String(args[0]),
              key: String(args[5] ?? ""),
              owner: String(args[6] ?? ""),
            });
            return { rows: [], rowsAffected: 1 };
          }
          // Order matters: the MAX probe also targets __action_change__.
          if (/max\(updated_at\)/i.test(sql)) {
            const max =
              args[0] === "__action_change__"
                ? markers.reduce((a, m) => Math.max(a, m.ts), 0)
                : 0;
            return { rows: [{ max_ts: max }], rowsAffected: 0 };
          }
          if (
            sql.includes("application_state") &&
            args[0] === "__action_change__"
          ) {
            markerQueries.push({ sql, args });
            // Honour a watermark bound if the query carries one.
            const since = typeof args[1] === "number" ? args[1] : -1;
            return {
              rows: markers
                .filter((m) => m.ts > since)
                .map((m) => ({
                  session_id: m.session,
                  value: JSON.stringify({
                    actionName: m.action,
                    owner: m.session,
                  }),
                  updated_at: m.ts,
                })),
              rowsAffected: 0,
            };
          }
          return { rows: [], rowsAffected: 0 };
        },
      ),
    },
  };
}

describe("action marker replay on cold start", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS;
  });

  // A never-pruned marker table plus a watermark rewound to 0 meant every cold
  // start re-emitted the whole history. On one app that was 2,188 rows replayed
  // ~32x/min = 1,169 sync events/sec, none of it real traffic.
  it("does not replay markers older than the replay window", async () => {
    const db = makeDb([
      { session: "ancient@x.com", ts: NOW - 60 * 86_400_000, action: "a" },
      { session: "old@x.com", ts: NOW - 3_600_000, action: "b" },
      { session: "recent@x.com", ts: NOW - 5_000, action: "c" },
    ]);
    const state = new AppSyncState({
      getDb: () => db.exec as never,
      isPostgres: () => false,
    });
    await state.seedVersionFromDb();
    await state.checkExternalDbChanges({ durableEvents: false });

    const bounded = db.markerQueries.find((q) =>
      q.sql.includes("updated_at > ?"),
    );
    // The read itself must be bounded — an unbounded SELECT of the whole
    // marker table is the cost even when the rows are filtered afterwards.
    expect(bounded).toBeDefined();
    // Window is measured back from the NEWEST marker (here NOW - 5s), not from
    // this process's clock — a serverless container's clock is not the
    // database's, and the point is to catch markers written just before boot.
    expect(Number(bounded?.args[1])).toBe(NOW - 5_000 - 60_000);
    // The 60-day-old row is excluded; that row and its 2,187 siblings are what
    // every cold start used to re-emit.
    expect(db.persisted.map((p) => p.owner)).not.toContain("ancient@x.com");
    expect(db.persisted.map((p) => p.owner)).toContain("recent@x.com");
  });

  it("still replays a marker written just before boot", async () => {
    // The rewind exists so a separate action process's write is not missed by
    // the first poll. Bounding the window must not break that.
    const db = makeDb([
      { session: "recent@x.com", ts: NOW - 5_000, action: "update-thing" },
    ]);
    const state = new AppSyncState({
      getDb: () => db.exec as never,
      isPostgres: () => false,
    });
    await state.seedVersionFromDb();
    await state.checkExternalDbChanges({ durableEvents: false });
    const bounded = db.markerQueries.find((q) =>
      q.sql.includes("updated_at > ?"),
    );
    expect(Number(bounded?.args[1])).toBeLessThan(NOW - 5_000);
  });
});
