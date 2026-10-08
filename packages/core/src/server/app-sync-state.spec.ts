import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppSyncState, type ChangeEvent } from "./poll.js";

vi.mock("../db/ddl-guard.js", () => ({
  ensureIndexExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExistsConcurrently: vi.fn().mockResolvedValue(undefined),
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
}));

function makeDb(insertedIds?: string[]) {
  return {
    execute: vi.fn(
      async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = typeof query === "string" ? query : query.sql;
        const args = typeof query === "string" ? [] : (query.args ?? []);
        if (
          insertedIds &&
          sql.includes("INSERT") &&
          sql.includes("sync_events") &&
          typeof args[0] === "string"
        ) {
          insertedIds.push(args[0] as string);
        }
        return { rows: [] as any[], rowsAffected: 0 };
      },
    ),
  };
}

const baseEvent = (over: Partial<ChangeEvent> = {}): ChangeEvent => ({
  version: 100,
  source: "action",
  type: "change",
  key: "k",
  owner: "u@example.com",
  ...over,
});

describe("AppSyncState multi-app isolation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS;
  });

  it("does not leak in-memory events or versions across apps", () => {
    const a = new AppSyncState({
      getDb: () => makeDb(),
    });
    const b = new AppSyncState({
      getDb: () => makeDb(),
    });

    a.recordChange({ source: "action", type: "change", key: "a1" });
    a.recordChange({ source: "action", type: "change", key: "a2" });

    expect(a.getChangesSince(0).events.map((e) => e.key)).toEqual(["a1", "a2"]);
    expect(b.getChangesSince(0).events).toEqual([]);
    expect(b.getVersion()).toBe(0);
    expect(a.getVersion()).toBeGreaterThan(0);
  });

  it("filters durable-independent per-user delivery per instance", () => {
    const a = new AppSyncState({
      getDb: () => makeDb(),
    });
    a.recordChange({
      source: "action",
      type: "change",
      key: "mine",
      owner: "me@x",
    });
    a.recordChange({
      source: "action",
      type: "change",
      key: "theirs",
      owner: "you@x",
    });
    a.recordChange({ source: "action", type: "change", key: "global" });

    const seen = a
      .getChangesSinceForUser(0, "me@x", undefined)
      .events.map((e) => e.key);
    expect(seen).toEqual(["mine", "global"]);
  });

  it("derives the SAME deterministic id across instances for one out-of-band write", async () => {
    process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
    const idsA: string[] = [];
    const idsB: string[] = [];
    const a = new AppSyncState({
      getDb: () => makeDb(idsA),
      deterministicEventIds: true,
    });
    const b = new AppSyncState({
      getDb: () => makeDb(idsB),
      deterministicEventIds: true,
    });

    await a.persistSyncEvent(baseEvent({ version: 111 }), "app-state|500");
    await b.persistSyncEvent(baseEvent({ version: 999 }), "app-state|500");

    expect(idsA[0]).toBeTruthy();
    expect(idsA[0]).toBe(idsB[0]);
  });

  it("keeps random ids when deterministic mode is off (default)", async () => {
    process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
    const ids: string[] = [];
    const s = new AppSyncState({
      getDb: () => makeDb(ids),
    });

    await s.persistSyncEvent(baseEvent({ version: 1 }), "app-state|500");
    await s.persistSyncEvent(baseEvent({ version: 2 }), "app-state|500");

    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("persists a transactional change before publishing it", async () => {
    process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
    const schemaDb = makeDb();
    const transaction = {
      execute: vi.fn(async () => ({ rows: [], rowsAffected: 1 })),
    };
    const state = new AppSyncState({
      getDb: () => schemaDb,
      isPostgres: () => false,
    });
    const change = await state.prepareTransactionalChange({
      source: "collab",
      type: "change",
      key: "doc-1",
      resourceType: "document",
      resourceId: "doc-1",
    });
    expect(change.isPersisted()).toBe(false);

    expect(state.getChangesSince(0).events).toEqual([]);
    const persisted = await change.persist(transaction);
    expect(change.isPersisted()).toBe(true);
    expect(state.getChangesSince(0).events).toEqual([]);
    expect(transaction.execute).toHaveBeenCalledOnce();
    expect(persisted.resourceId).toBe("doc-1");

    change.publish();
    expect(state.getChangesSince(0).events).toMatchObject([
      { source: "collab", resourceId: "doc-1" },
    ]);
  });

  it("does not reuse an org-A access decision under an org-B session", async () => {
    const flush = async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    };
    const resolveAccess = vi.fn(
      async (_rt: string, _rid: string, ctx: { orgId: string | undefined }) =>
        ctx.orgId === "org-a" ? { ok: true } : null,
    );
    const s = new AppSyncState({
      getDb: () => makeDb(),
      resolveAccess,
    });
    const event = {
      owner: "other@x",
      resourceType: "doc",
      resourceId: "d1",
    };

    expect(s.canSeeChangeForUser(event, "u@x", "org-a")).toBe(false);
    await flush();
    expect(s.canSeeChangeForUser(event, "u@x", "org-a")).toBe(true);

    // org-b must NOT inherit org-a's allow — the cache key includes orgId.
    expect(s.canSeeChangeForUser(event, "u@x", "org-b")).toBe(false);
    await flush();
    expect(s.canSeeChangeForUser(event, "u@x", "org-b")).toBe(false);

    expect(resolveAccess).toHaveBeenCalledWith("doc", "d1", {
      userEmail: "u@x",
      orgId: "org-a",
    });
    expect(resolveAccess).toHaveBeenCalledWith("doc", "d1", {
      userEmail: "u@x",
      orgId: "org-b",
    });
  });

  it("matches owner-scoped events case-insensitively", () => {
    const s = new AppSyncState({
      getDb: () => makeDb(),
    });

    expect(
      s.canSeeChangeForUser(
        { owner: "owner@example.com", resourceType: "deck", resourceId: "d1" },
        "Owner@Example.com",
        undefined,
      ),
    ).toBe(true);
  });

  it("delivers public resource tombstones without resolving the deleted row", () => {
    const resolveAccess = vi.fn(async () => null);
    const s = new AppSyncState({
      getDb: () => makeDb(),
      resolveAccess,
    });

    expect(
      s.canSeeChangeForUser(
        {
          resourceType: "deck",
          resourceId: "d1",
          visibility: "public",
        },
        "viewer@example.com",
        undefined,
      ),
    ).toBe(true);
    expect(resolveAccess).not.toHaveBeenCalled();
  });
});

describe("AppSyncState first event after an access check miss", () => {
  const resourceEvent = {
    source: "collab",
    type: "change",
    key: "doc-1",
    owner: "writer@example.com",
    resourceType: "document",
    resourceId: "doc-1",
  };

  it("delivers a resource event in the same read once its access check settles", async () => {
    const resolveAccess = vi.fn(
      () =>
        new Promise<{ ok: true }>((resolve) =>
          setTimeout(() => resolve({ ok: true }), 50),
        ),
    );
    const state = new AppSyncState({
      getDb: () => makeDb(),
      resolveAccess,
    });
    state.recordChange(resourceEvent);

    const result = await state.getCombinedChangesSinceForUser(
      0,
      "reader@example.com",
      undefined,
      false,
    );

    expect(result.events).toMatchObject([{ resourceId: "doc-1" }]);
    expect(result.cursorLimited).toBeUndefined();
    expect(resolveAccess).toHaveBeenCalledOnce();
  });

  it("stops waiting after a second when the access check never settles", async () => {
    vi.useFakeTimers();
    try {
      const state = new AppSyncState({
        getDb: () => makeDb(),
        resolveAccess: () => new Promise(() => {}),
      });
      state.recordChange(resourceEvent);

      const pending = state.getCombinedChangesSinceForUser(
        0,
        "reader@example.com",
        undefined,
        false,
      );
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await pending;

      expect(result.events).toEqual([]);
      expect(result.cursorLimited).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves the input cursor when a pending durable read cannot advance", async () => {
    vi.useFakeTimers();
    process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
    const state = new AppSyncState({
      getDb: () => makeDb(),
      resolveAccess: () => new Promise(() => {}),
    });
    state.recordChange(resourceEvent);

    const pending = state.getCombinedChangesSinceForUser(
      0,
      "reader@example.com",
      undefined,
      true,
      { version: 0, id: "baseline" },
    );
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await pending;

    expect(result).toEqual({
      version: 0,
      cursor: "0.baseline",
      cursorLimited: true,
      events: [],
    });
  });

  it("does not wait for an unrelated access check when a durable read hits the row limit", async () => {
    vi.useFakeTimers();
    process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
    const rows = Array.from({ length: 1_001 }, (_, i) => ({
      id: `row-${i}`,
      version: 6 + i,
      event_json: JSON.stringify({
        source: "action",
        type: "change",
        key: "k",
      }),
    }));
    const db = {
      execute: vi.fn(async (query: string | { sql: string }) => {
        const sql = typeof query === "string" ? query : query.sql;
        return {
          rows: sql.includes("event_json") ? rows : [],
          rowsAffected: 0,
        };
      }),
    };
    const state = new AppSyncState({ getDb: () => db });
    (state as any).accessInFlight.set("unrelated", new Promise(() => {}));

    let settled = false;
    const read = state
      .getCombinedChangesSinceForUser(5, "reader@example.com", undefined, true)
      .then((result) => {
        settled = true;
        return result;
      });
    await vi.advanceTimersByTimeAsync(0);

    expect(settled).toBe(true);
    expect(await read).toMatchObject({ cursorLimited: true });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it("does not wait when the read is not blocked on an access check", async () => {
    const state = new AppSyncState({
      getDb: () => makeDb(),
      resolveAccess: () => new Promise(() => {}),
    });
    state.recordChange({ ...resourceEvent, owner: "reader@example.com" });

    const result = await state.getCombinedChangesSinceForUser(
      0,
      "reader@example.com",
      undefined,
      false,
    );

    expect(result.events).toMatchObject([{ resourceId: "doc-1" }]);
  });
});
