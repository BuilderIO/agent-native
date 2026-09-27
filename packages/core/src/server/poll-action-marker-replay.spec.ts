import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppSyncState } from "./poll.js";

vi.mock("../db/ddl-guard.js", () => ({
  ensureIndexExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExistsConcurrently: vi.fn().mockResolvedValue(undefined),
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
}));

const NOW = 1_800_000_000_000;

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

          if (/insert\s+into\s+sync_events/i.test(sql)) {
            persisted.push({
              id: String(args[0]),
              key: String(args[5] ?? ""),
              owner: String(args[6] ?? ""),
            });
            return { rows: [], rowsAffected: 1 };
          }
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

  it("does not replay markers older than the replay window", async () => {
    const db = makeDb([
      { session: "ancient@x.com", ts: NOW - 60 * 86_400_000, action: "a" },
      { session: "old@x.com", ts: NOW - 3_600_000, action: "b" },
      { session: "recent@x.com", ts: NOW - 5_000, action: "c" },
    ]);
    const state = new AppSyncState({
      getDb: () => db.exec as never,
    });
    await state.seedVersionFromDb();
    await state.checkExternalDbChanges({ durableEvents: false });

    const bounded = db.markerQueries.find((q) =>
      q.sql.includes("updated_at > ?"),
    );
    expect(bounded).toBeDefined();
    expect(Number(bounded?.args[1])).toBe(NOW - 5_000 - 60_000);
    expect(db.persisted.map((p) => p.owner)).not.toContain("ancient@x.com");
    expect(db.persisted.map((p) => p.owner)).toContain("recent@x.com");
  });

  it("still replays a marker written just before boot", async () => {
    const db = makeDb([
      { session: "recent@x.com", ts: NOW - 5_000, action: "update-thing" },
    ]);
    const state = new AppSyncState({
      getDb: () => db.exec as never,
    });
    await state.seedVersionFromDb();
    await state.checkExternalDbChanges({ durableEvents: false });
    const bounded = db.markerQueries.find((q) =>
      q.sql.includes("updated_at > ?"),
    );
    expect(Number(bounded?.args[1])).toBeLessThan(NOW - 5_000);
  });
});
