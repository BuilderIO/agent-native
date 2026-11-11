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

  it("does not wait for a pending check beyond the boundary the durable read stopped at", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000_000);
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
          rows: sql.startsWith("SELECT id, version, event_json") ? rows : [],
          rowsAffected: 0,
        };
      }),
    };
    const state = new AppSyncState({
      getDb: () => db,
      resolveAccess: () => new Promise(() => {}),
    });
    state.recordChange(resourceEvent);

    let settled = false;
    const read = state
      .getCombinedChangesSinceForUser(5, "reader@example.com", undefined, true)
      .then((result) => {
        settled = true;
        return result;
      });
    await vi.advanceTimersByTimeAsync(0);

    expect(settled).toBe(true);
    expect(await read).toMatchObject({ version: 1_005, cursorLimited: true });
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

describe("AppSyncState read through other people's resources", () => {
  // Beta and production share one change log, so most resource events a tab
  // reads are other people's. Each needs an access check before the read can
  // pass it, and a read used to stop at the first unchecked one, wait, and
  // read again, passing one or two per poll: an open tab fell minutes behind
  // and never saw an agent's suggestion until a reload.
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    delete process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS;
  });

  function durableRows(
    resources: Array<{ resourceType: string; resourceId: string }>,
  ) {
    return resources.map((resource, i) => ({
      id: `row-${String(i).padStart(4, "0")}`,
      version: 6 + i,
      event_json: JSON.stringify({
        source: "action",
        type: "change",
        key: "edit-document",
        owner: "writer@example.com",
        ...resource,
      }),
    }));
  }

  function stateReading(
    rows: ReturnType<typeof durableRows>,
    options: ConstructorParameters<typeof AppSyncState>[0],
  ) {
    process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
    const db = {
      execute: vi.fn(async (query: string | { sql: string }) => {
        const sql = typeof query === "string" ? query : query.sql;
        return {
          rows: sql.startsWith("SELECT id, version, event_json") ? rows : [],
          rowsAffected: 0,
        };
      }),
    };
    return new AppSyncState({ getDb: () => db, ...options });
  }

  const othersDocuments = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      resourceType: "document",
      resourceId: `others-${i}`,
    }));
  const readerDocument = { resourceType: "document", resourceId: "mine" };

  it("passes a page of other people's resources in one poll", async () => {
    const rows = durableRows([...othersDocuments(240), readerDocument]);
    const resolveAccess = vi.fn(
      (_type: string, resourceId: string) =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve(resourceId === "mine" ? { role: "viewer" } : null),
            20,
          ),
        ),
    );
    const state = stateReading(rows, { resolveAccess });

    const result = await state.getCombinedChangesSinceForUser(
      5,
      "reader@example.com",
      undefined,
      true,
      { version: 5, id: "" },
    );

    expect(result.events).toMatchObject([{ resourceId: "mine" }]);
    expect(result.cursorLimited).toBeUndefined();
    expect(result.cursor).toBe(`${6 + 240}.${rows[240].id}`);
    expect(resolveAccess).toHaveBeenCalledTimes(241);
  });

  it("checks a page's resources in one batch per resource type", async () => {
    const others = othersDocuments(200);
    const decks = [
      { resourceType: "deck", resourceId: "deck-1" },
      { resourceType: "deck", resourceId: "deck-2" },
    ];
    const rows = durableRows([...others, ...decks, readerDocument]);
    const resolveAccess = vi.fn(async () => {
      throw new Error("a page's checks go in batches");
    });
    const resolveAccessMany = vi.fn(
      async (_type: string, ids: string[]) =>
        new Set(ids.filter((id) => id === "mine" || id === "deck-2")),
    );
    const state = stateReading(rows, { resolveAccess, resolveAccessMany });

    const result = await state.getCombinedChangesSinceForUser(
      5,
      "reader@example.com",
      undefined,
      true,
      { version: 5, id: "" },
    );

    expect(result.events.map((event) => event.resourceId)).toEqual([
      "deck-2",
      "mine",
    ]);
    expect(result.cursorLimited).toBeUndefined();
    expect(resolveAccess).not.toHaveBeenCalled();
    expect(resolveAccessMany).toHaveBeenCalledTimes(2);
    expect(resolveAccessMany).toHaveBeenCalledWith(
      "document",
      [...others.map((doc) => doc.resourceId), "mine"],
      { userEmail: "reader@example.com", orgId: undefined },
    );
    expect(resolveAccessMany).toHaveBeenCalledWith(
      "deck",
      ["deck-1", "deck-2"],
      { userEmail: "reader@example.com", orgId: undefined },
    );
  });

  it("catches up over a few polls when the log holds more than one read checks", async () => {
    const rows = durableRows([...othersDocuments(700), readerDocument]);
    const resolveAccessMany = vi.fn(
      async (_type: string, ids: string[]) =>
        new Set(ids.filter((id) => id === "mine")),
    );
    const state = stateReading(rows, {
      resolveAccess: async () => null,
      resolveAccessMany,
    });

    let cursor = { version: 5, id: "" };
    const delivered: string[] = [];
    let polls = 0;
    while (!delivered.includes("mine") && polls < 10) {
      polls++;
      const result = await state.getCombinedChangesSinceForUser(
        cursor.version,
        "reader@example.com",
        undefined,
        true,
        cursor,
      );
      delivered.push(...result.events.map((event) => String(event.resourceId)));
      const [version, id] = String(result.cursor).split(".");
      cursor = { version: Number(version), id };
    }

    expect(delivered).toEqual(["mine"]);
    // Each read starts at most 250 checks, so 701 resources take more than
    // one poll, and only a few.
    expect(polls).toBeGreaterThan(1);
    expect(polls).toBeLessThanOrEqual(3);
    for (const [, ids] of resolveAccessMany.mock.calls) {
      expect(ids.length).toBeLessThanOrEqual(250);
    }
  });

  it("hides only the failing resource when a batch check fails", async () => {
    const rows = durableRows([
      { resourceType: "document", resourceId: "shared" },
      { resourceType: "document", resourceId: "broken" },
      readerDocument,
    ]);
    // One resource's failure fails the whole batch.
    const resolveAccessMany = vi.fn(async () => {
      throw new Error("org membership lookup failed");
    });
    const resolveAccess = vi.fn(async (_type: string, resourceId: string) => {
      if (resourceId === "broken") {
        throw new Error("org membership lookup failed");
      }
      return { role: "viewer" };
    });
    const state = stateReading(rows, { resolveAccess, resolveAccessMany });

    const result = await state.getCombinedChangesSinceForUser(
      5,
      "reader@example.com",
      undefined,
      true,
      { version: 5, id: "" },
    );

    expect(result.events.map((event) => event.resourceId)).toEqual([
      "shared",
      "mine",
    ]);
    expect(result.cursorLimited).toBeUndefined();
    expect(resolveAccessMany).toHaveBeenCalledOnce();
    expect(resolveAccess).toHaveBeenCalledTimes(3);
  });

  it("keeps a newer check running when an older batch for its resource ends", async () => {
    const rows = durableRows([{ resourceType: "document", resourceId: "a" }]);
    let finishBatch!: (visible: Set<string>) => void;
    const resolveAccessMany = vi.fn(
      () =>
        new Promise<Set<string>>((resolve) => {
          finishBatch = resolve;
        }),
    );
    const resolveAccess = vi.fn(() => new Promise(() => {}));
    const state = stateReading(rows, { resolveAccess, resolveAccessMany });
    const event = {
      owner: "writer@example.com",
      resourceType: "document",
      resourceId: "a",
    };

    await state.getDurableChangesSinceForUser(
      5,
      "reader@example.com",
      undefined,
      { version: 5, id: "" },
    );
    expect(resolveAccessMany).toHaveBeenCalledOnce();
    // Sharing changed while the batch ran: its answer is stale, and a fresh
    // check replaces it.
    state.invalidateCollabAccessCache("document", "a");
    expect(
      state.getChangeVisibilityForUser(event, "reader@example.com", undefined),
    ).toBe("pending");
    expect(resolveAccess).toHaveBeenCalledOnce();

    finishBatch(new Set(["a"]));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The stale batch neither answered nor dropped the fresh check, so the
    // next read waits on that check instead of starting another.
    expect(
      state.getChangeVisibilityForUser(event, "reader@example.com", undefined),
    ).toBe("pending");
    expect(resolveAccess).toHaveBeenCalledOnce();
  });

  it("does not check resources the reader owns or that are public", async () => {
    const rows = [
      ...durableRows([readerDocument]),
      {
        id: "row-own",
        version: 50,
        event_json: JSON.stringify({
          source: "action",
          type: "change",
          owner: "Reader@Example.com",
          resourceType: "document",
          resourceId: "own",
        }),
      },
      {
        id: "row-public",
        version: 51,
        event_json: JSON.stringify({
          source: "action",
          type: "change",
          owner: "writer@example.com",
          visibility: "public",
          resourceType: "document",
          resourceId: "public",
        }),
      },
    ];
    const resolveAccessMany = vi.fn(async () => new Set<string>());
    const state = stateReading(rows, { resolveAccessMany });

    const result = await state.getCombinedChangesSinceForUser(
      5,
      "reader@example.com",
      undefined,
      true,
      { version: 5, id: "" },
    );

    expect(result.events.map((event) => event.resourceId)).toEqual([
      "own",
      "public",
    ]);
    expect(resolveAccessMany).toHaveBeenCalledOnce();
    expect(resolveAccessMany).toHaveBeenCalledWith("document", ["mine"], {
      userEmail: "reader@example.com",
      orgId: undefined,
    });
  });
});
