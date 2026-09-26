import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppSyncState, POLL_CHANGE_EVENT } from "./poll.js";

function makeAllocatorDb(shared?: { v: number; ids: Map<string, number> }) {
  const state = shared ?? { v: 0, ids: new Map<string, number>() };
  const log: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    state,
    log,
    failAllocation: false,
    failAllocationAfterCommit: false,
    returnEmptyAllocationOnce: false,
    returnEmptyAllocationWhileReseedingFails: false,
    failReseed: false,
    seedCalls: 0,
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
        db.seedCalls++;
        if (db.failReseed && db.seedCalls > 1) {
          throw new Error("allocator reseed unavailable");
        }
        if (state.v === 0) state.v = Date.now();
        return { rows: [], rowsAffected: 1 };
      }
      if (sql.includes("UPDATE sync_version SET v = GREATEST")) {
        state.v = Math.max(state.v, Number(args[0]));
        return { rows: [], rowsAffected: 1 };
      }
      if (sql.includes("SELECT version FROM sync_events WHERE id")) {
        const committed = state.ids.get(String(args[0]));
        return {
          rows: committed !== undefined ? [{ version: committed }] : [],
          rowsAffected: 0,
        };
      }
      if (sql.includes("WITH alloc")) {
        if (db.returnEmptyAllocationOnce) {
          if (!db.returnEmptyAllocationWhileReseedingFails) {
            db.returnEmptyAllocationOnce = false;
          }
          return { rows: [], rowsAffected: 0 };
        }
        if (db.failAllocation) throw new Error("neon unavailable");
        const floor = Number(args[0]);
        const id = String(args[1]);
        const existing = state.ids.get(id);
        state.v = Math.max(state.v + 1, Date.now(), floor);
        if (existing !== undefined) {
          return { rows: [{ version: existing }], rowsAffected: 1 };
        }
        state.ids.set(id, state.v);
        if (db.failAllocationAfterCommit) {
          throw new Error("timeout after commit");
        }
        return { rows: [{ version: state.v }], rowsAffected: 1 };
      }
      return { rows: [], rowsAffected: 0 };
    },
  };
  const transactionalDb = db as typeof db & {
    transaction: (fn: (tx: typeof db) => Promise<unknown>) => Promise<unknown>;
  };
  transactionalDb.transaction = async (fn) => fn(db);
  return transactionalDb;
}

function baseEvent(extra: Record<string, unknown> = {}) {
  return { source: "app-state", type: "change", key: "k", ...extra };
}

async function flush() {
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
    });
    s.recordChange(baseEvent());
    expect(s.getChangesSince(0).events).toHaveLength(1);
    expect(db.log.some((q) => q.sql.includes("sync_version"))).toBe(false);
  });

  it("gated: emits ONLY the DB-allocated version, never a provisional clock value", async () => {
    const db = makeAllocatorDb();
    const s = new AppSyncState({
      getDb: () => db as never,
      dbAssignedVersions: true,
    });
    const emitted: number[] = [];
    s.getPollEmitter().on(POLL_CHANGE_EVENT, (e: { version: number }) => {
      emitted.push(e.version);
    });

    s.recordChange(baseEvent());
    expect(s.getChangesSince(0).events).toHaveLength(0);
    await flush();

    const events = s.getChangesSince(0).events;
    expect(events).toHaveLength(1);
    expect(events[0].version).toBe(db.state.v);
    expect(emitted).toEqual([db.state.v]);
    expect(s.getVersion()).toBe(db.state.v);
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
      dbAssignedVersions: true,
    });
    const b = new AppSyncState({
      getDb: () => dbB as never,
      dbAssignedVersions: true,
    });

    vi.setSystemTime(T + 60_000);
    a.recordChange(baseEvent({ key: "from-a" }));
    await vi.advanceTimersByTimeAsync(0);
    const versionA = a.getChangesSince(0).events[0]?.version;

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
      dbAssignedVersions: true,
      deterministicEventIds: true,
    });
    const b = new AppSyncState({
      getDb: () => makeAllocatorDb(shared) as never,
      dbAssignedVersions: true,
      deterministicEventIds: true,
    });

    a.recordChange(baseEvent(), { dedupeKey: "app-state|500" });
    await flush();
    b.recordChange(baseEvent(), { dedupeKey: "app-state|500" });
    await flush();

    const winner = a.getChangesSince(0).events[0]?.version;
    const loser = b.getChangesSince(0).events[0]?.version;
    expect(winner).toBeGreaterThan(0);
    expect(loser).toBe(winner);
    expect(shared.ids.size).toBe(1);
  });

  it("falls back to clock versions when allocation fails, and still persists", async () => {
    const db = makeAllocatorDb();
    db.failAllocation = true;
    const s = new AppSyncState({
      getDb: () => db as never,
      dbAssignedVersions: true,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const before = Date.now();
    s.recordChange(baseEvent());
    await flush();

    const events = s.getChangesSince(0).events;
    expect(events).toHaveLength(1);
    expect(events[0].version).toBeGreaterThanOrEqual(before);
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

  it("warns when allocator reseeding fails before retrying allocation", async () => {
    const db = makeAllocatorDb();
    db.returnEmptyAllocationOnce = true;
    db.returnEmptyAllocationWhileReseedingFails = true;
    db.failReseed = true;
    const s = new AppSyncState({
      getDb: () => db as never,
      dbAssignedVersions: true,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    s.recordChange(baseEvent());
    await flush();

    expect(warn).toHaveBeenCalledWith(
      "[agent-native] sync version allocator reseed failed; retrying allocation:",
      "allocator reseed unavailable",
    );
    const events = s.getChangesSince(0).events;
    expect(events).toHaveLength(1);
    expect(events[0]?.version).toBeGreaterThan(0);
    expect(
      db.log.some(
        (q) =>
          q.sql.includes("INSERT INTO sync_events") &&
          !q.sql.includes("WITH alloc"),
      ),
    ).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      "[agent-native] sync version allocation failed; falling back to clock-assigned versions",
    );
    warn.mockRestore();
  });

  it("commit-then-timeout recovers the durable row's version instead of clock-falling-back", async () => {
    const db = makeAllocatorDb();
    db.failAllocationAfterCommit = true;
    const s = new AppSyncState({
      getDb: () => db as never,
      dbAssignedVersions: true,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    s.recordChange(baseEvent());
    await flush();

    const events = s.getChangesSince(0).events;
    expect(events).toHaveLength(1);
    expect(events[0].version).toBe(db.state.v);
    expect(warn).not.toHaveBeenCalled();
    expect(
      db.log.some(
        (q) =>
          q.sql.includes("INSERT INTO sync_events") &&
          !q.sql.includes("WITH alloc"),
      ),
    ).toBe(false);
    warn.mockRestore();
  });

  it("a true allocation failure lifts the allocator to the fallback version before emitting", async () => {
    const db = makeAllocatorDb();
    db.failAllocation = true;
    const s = new AppSyncState({
      getDb: () => db as never,
      dbAssignedVersions: true,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    s.recordChange(baseEvent());
    await flush();

    const emitted = s.getChangesSince(0).events[0]?.version ?? 0;
    expect(emitted).toBeGreaterThan(0);
    expect(db.state.v).toBeGreaterThanOrEqual(emitted);
    warn.mockRestore();
  });

  it("a throwing poll listener does not poison the chain", async () => {
    const db = makeAllocatorDb();
    const s = new AppSyncState({
      getDb: () => db as never,
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

    const events = s.getChangesSince(0).events;
    expect(events.map((e) => e.key)).toEqual(["first", "second"]);
    warn.mockRestore();
  });

  it("fallback reuses the allocating attempt's id so a commit-then-timeout cannot double-persist", async () => {
    const db = makeAllocatorDb();
    db.failAllocation = true;
    const s = new AppSyncState({
      getDb: () => db as never,
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
      dbAssignedVersions: true,
    });

    await s.seedVersionFromDb();

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
    expect(events[1].version).toBeGreaterThan(events[0].version);
    warn.mockRestore();
  });
});
