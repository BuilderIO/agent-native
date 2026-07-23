import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppSyncState, POLL_CHANGE_EVENT } from "./poll.js";

/**
 * Emulates the Postgres side of the DB-assigned version allocator: ddl-guard
 * probes report everything as existing (no DDL), the seed is accepted, and the
 * allocating INSERT advances a shared one-row allocator with
 * GREATEST(v + 1, now, floor) — including the ON CONFLICT winner-version
 * semantics for duplicate deterministic ids.
 */
function makeAllocatorDb(shared?: { v: number; ids: Map<string, number> }) {
  const state = shared ?? { v: 0, ids: new Map<string, number>() };
  const log: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    state,
    log,
    failAllocation: false,
    async execute(query: string | { sql: string; args?: unknown[] }) {
      const sql = typeof query === "string" ? query : query.sql;
      const args = typeof query === "string" ? [] : (query.args ?? []);
      log.push({ sql, args });
      if (
        sql.includes("information_schema.tables") ||
        sql.includes("pg_indexes")
      ) {
        return { rows: [{ "1": 1 }], rowsAffected: 0 };
      }
      if (sql.includes("INSERT INTO sync_version")) {
        if (state.v === 0) state.v = Date.now();
        return { rows: [], rowsAffected: 1 };
      }
      if (sql.includes("WITH alloc")) {
        if (db.failAllocation) throw new Error("neon unavailable");
        const floor = Number(args[0]);
        const id = String(args[1]);
        const existing = state.ids.get(id);
        // The allocator row advances even for a conflict loser (burnt gap).
        state.v = Math.max(state.v + 1, Date.now(), floor);
        if (existing !== undefined) {
          return { rows: [{ version: existing }], rowsAffected: 1 };
        }
        state.ids.set(id, state.v);
        return { rows: [{ version: state.v }], rowsAffected: 1 };
      }
      // Legacy INSERT / DELETE prune / anything else.
      return { rows: [], rowsAffected: 0 };
    },
  };
  return db;
}

function baseEvent(extra: Record<string, unknown> = {}) {
  return { source: "app-state", type: "change", key: "k", ...extra };
}

async function flush() {
  // The first gated record awaits the whole ensure chain (ddl-guard probes +
  // seed) — macrotask turns drain arbitrarily deep microtask chains.
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("dbAssignedVersions", () => {
  beforeEach(() => {
    process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
  });
  afterEach(() => {
    delete process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS;
    vi.useRealTimers();
  });

  it("gate off: recordChange stays synchronous and never touches the allocator", () => {
    const db = makeAllocatorDb();
    const s = new AppSyncState({
      getDb: () => db as never,
      isPostgres: () => true,
    });
    s.recordChange(baseEvent());
    // Synchronous contract: the event is visible before any await.
    expect(s.getChangesSince(0).events).toHaveLength(1);
    expect(db.log.some((q) => q.sql.includes("sync_version"))).toBe(false);
  });

  it("SQLite + gate on: falls through to the synchronous clock path", () => {
    const db = makeAllocatorDb();
    const s = new AppSyncState({
      getDb: () => db as never,
      isPostgres: () => false,
      dbAssignedVersions: true,
    });
    s.recordChange(baseEvent());
    expect(s.getChangesSince(0).events).toHaveLength(1);
    expect(db.log.some((q) => q.sql.includes("sync_version"))).toBe(false);
  });

  it("gated: emits ONLY the DB-allocated version, never a provisional clock value", async () => {
    const db = makeAllocatorDb();
    const s = new AppSyncState({
      getDb: () => db as never,
      isPostgres: () => true,
      dbAssignedVersions: true,
    });
    const emitted: number[] = [];
    s.getPollEmitter().on(POLL_CHANGE_EVENT, (e: { version: number }) => {
      emitted.push(e.version);
    });

    s.recordChange(baseEvent());
    // Deferred emit: nothing is visible synchronously in gated mode.
    expect(s.getChangesSince(0).events).toHaveLength(0);
    await flush();

    const events = s.getChangesSince(0).events;
    expect(events).toHaveLength(1);
    expect(events[0].version).toBe(db.state.v);
    expect(emitted).toEqual([db.state.v]);
    expect(s.getVersion()).toBe(db.state.v);
    // The seed ran during ensure.
    expect(db.log.some((q) => q.sql.includes("INSERT INTO sync_version"))).toBe(
      true,
    );
  });

  it("two skewed writers sharing one allocator get strictly increasing versions", async () => {
    vi.useFakeTimers();
    const T = 1_800_000_000_000;
    const shared = { v: 0, ids: new Map<string, number>() };
    const dbA = makeAllocatorDb(shared);
    const dbB = makeAllocatorDb(shared);
    const a = new AppSyncState({
      getDb: () => dbA as never,
      isPostgres: () => true,
      dbAssignedVersions: true,
    });
    const b = new AppSyncState({
      getDb: () => dbB as never,
      isPostgres: () => true,
      dbAssignedVersions: true,
    });

    // Writer A has a fast clock (60s ahead) and writes FIRST.
    vi.setSystemTime(T + 60_000);
    a.recordChange(baseEvent({ key: "from-a" }));
    await vi.advanceTimersByTimeAsync(0);
    const versionA = a.getChangesSince(0).events[0]?.version;

    // Writer B's clock is 60s behind but its event is LATER. Under clock
    // allocation this would invert; the shared allocator forbids it.
    vi.setSystemTime(T);
    b.recordChange(baseEvent({ key: "from-b" }));
    await vi.advanceTimersByTimeAsync(0);
    const versionB = b.getChangesSince(0).events[0]?.version;

    expect(versionA).toBeGreaterThan(0);
    expect(versionB).toBeGreaterThan(versionA);
  });

  it("deterministic-id dedupe loser adopts the winner's version", async () => {
    const shared = { v: 0, ids: new Map<string, number>() };
    const a = new AppSyncState({
      getDb: () => makeAllocatorDb(shared) as never,
      isPostgres: () => true,
      dbAssignedVersions: true,
      deterministicEventIds: true,
    });
    const b = new AppSyncState({
      getDb: () => makeAllocatorDb(shared) as never,
      isPostgres: () => true,
      dbAssignedVersions: true,
      deterministicEventIds: true,
    });

    // Same logical out-of-band write detected by both instances.
    a.recordChange(baseEvent(), { dedupeKey: "app-state|500" });
    await flush();
    b.recordChange(baseEvent(), { dedupeKey: "app-state|500" });
    await flush();

    const winner = a.getChangesSince(0).events[0]?.version;
    const loser = b.getChangesSince(0).events[0]?.version;
    expect(winner).toBeGreaterThan(0);
    expect(loser).toBe(winner);
    expect(shared.ids.size).toBe(1); // one durable row
  });

  it("falls back to clock versions when allocation fails, and still persists", async () => {
    const db = makeAllocatorDb();
    db.failAllocation = true;
    const s = new AppSyncState({
      getDb: () => db as never,
      isPostgres: () => true,
      dbAssignedVersions: true,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const before = Date.now();
    s.recordChange(baseEvent());
    await flush();

    const events = s.getChangesSince(0).events;
    expect(events).toHaveLength(1);
    expect(events[0].version).toBeGreaterThanOrEqual(before);
    // The legacy best-effort INSERT ran for the fallback event.
    expect(
      db.log.some(
        (q) =>
          q.sql.includes("INSERT INTO sync_events") &&
          !q.sql.includes("WITH alloc"),
      ),
    ).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("a throwing poll listener does not poison the chain", async () => {
    const db = makeAllocatorDb();
    const s = new AppSyncState({
      getDb: () => db as never,
      isPostgres: () => true,
      dbAssignedVersions: true,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    s.getPollEmitter().on(POLL_CHANGE_EVENT, () => {
      throw new Error("listener bug");
    });

    s.recordChange(baseEvent({ key: "first" }));
    await flush();
    s.recordChange(baseEvent({ key: "second" }));
    await flush();

    // Both events reached the buffer despite the throwing listener; later
    // events were not silently dropped by a poisoned chain.
    const events = s.getChangesSince(0).events;
    expect(events.map((e) => e.key)).toEqual(["first", "second"]);
    warn.mockRestore();
  });

  it("fallback reuses the allocating attempt's id so a commit-then-timeout cannot double-persist", async () => {
    const db = makeAllocatorDb();
    db.failAllocation = true;
    const s = new AppSyncState({
      getDb: () => db as never,
      isPostgres: () => true,
      dbAssignedVersions: true,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    s.recordChange(baseEvent());
    await flush();

    const allocAttempt = db.log.find((q) => q.sql.includes("WITH alloc"));
    const legacyInsert = db.log.find(
      (q) =>
        q.sql.includes("INSERT INTO sync_events") &&
        !q.sql.includes("WITH alloc"),
    );
    expect(allocAttempt).toBeTruthy();
    expect(legacyInsert).toBeTruthy();
    // Same durable id on both statements → ON CONFLICT dedupes if the first
    // actually committed server-side.
    expect(legacyInsert!.args[0]).toBe(allocAttempt!.args[1]);
    warn.mockRestore();
  });

  it("seedVersionFromDb lifts the allocator to the seed's updated_at domain", async () => {
    const db = makeAllocatorDb();
    const skewedUpdatedAt = Date.now() + 60_000;
    const baseExecute = db.execute.bind(db);
    db.execute = async (query: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (sql.includes("MAX(updated_at)")) {
        db.log.push({
          sql,
          args: typeof query === "string" ? [] : (query.args ?? []),
        });
        return { rows: [{ max_ts: skewedUpdatedAt }], rowsAffected: 0 };
      }
      if (sql.includes("UPDATE sync_version SET v = GREATEST")) {
        db.log.push({
          sql,
          args: typeof query === "string" ? [] : (query.args ?? []),
        });
        const floor = Number(
          (typeof query === "string" ? [] : (query.args ?? []))[0],
        );
        db.state.v = Math.max(db.state.v, floor);
        return { rows: [], rowsAffected: 1 };
      }
      return baseExecute(query);
    };
    const s = new AppSyncState({
      getDb: () => db as never,
      isPostgres: () => true,
      dbAssignedVersions: true,
    });

    await s.seedVersionFromDb();

    // The allocator was aligned to the (skew-ahead) seed, so the next
    // allocation lands ABOVE the seeded cursor instead of below it.
    expect(db.state.v).toBeGreaterThanOrEqual(skewedUpdatedAt);
    s.recordChange(baseEvent());
    await flush();
    expect(s.getChangesSince(0).events[0]?.version).toBeGreaterThan(
      skewedUpdatedAt,
    );
  });

  it("stays synchronous when sync events are disabled, without a misleading warning", () => {
    delete process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS;
    const db = makeAllocatorDb();
    const s = new AppSyncState({
      getDb: () => db as never,
      isPostgres: () => true,
      dbAssignedVersions: true,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    s.recordChange(baseEvent());
    expect(s.getChangesSince(0).events).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("later events keep flowing after a fallback (chain does not wedge)", async () => {
    const db = makeAllocatorDb();
    db.failAllocation = true;
    const s = new AppSyncState({
      getDb: () => db as never,
      isPostgres: () => true,
      dbAssignedVersions: true,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    s.recordChange(baseEvent({ key: "first" }));
    await flush();
    db.failAllocation = false;
    s.recordChange(baseEvent({ key: "second" }));
    await flush();

    const events = s.getChangesSince(0).events;
    expect(events.map((e) => e.key)).toEqual(["first", "second"]);
    // Recovery: the second version is DB-allocated and above the fallback one
    // (the floor parameter guarantees local monotonicity).
    expect(events[1].version).toBeGreaterThan(events[0].version);
    warn.mockRestore();
  });
});
