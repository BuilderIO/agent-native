import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as sharingAccess from "../sharing/access.js";
import {
  AppSyncState,
  getChangesSince,
  getVersion,
  recordChange,
} from "./poll.js";

// The default access checks, for the tests that use them. Design stands in
// for a type with a host access resolver.
vi.mock("../sharing/access.js", () => ({
  hasHostAccessResolver: vi.fn(
    (resourceType: string) => resourceType === "design",
  ),
  resolveAccess: vi.fn(async () => null),
  resolveAccessMany: vi.fn(async () => new Map()),
}));

describe("poll", () => {
  describe("getVersion", () => {
    it("returns the current version counter", () => {
      expect(typeof getVersion()).toBe("number");
      expect(getVersion()).toBeGreaterThanOrEqual(0);
    });
  });

  describe("recordChange", () => {
    it("strictly increases the version", () => {
      const before = getVersion();
      recordChange({ source: "app-state", type: "change", key: "test" });
      expect(getVersion()).toBeGreaterThan(before);
    });

    it("increases version for each call", () => {
      const before = getVersion();
      recordChange({ source: "settings", type: "change", key: "a" });
      const mid = getVersion();
      recordChange({ source: "settings", type: "delete", key: "b" });
      expect(mid).toBeGreaterThan(before);
      expect(getVersion()).toBeGreaterThan(mid);
    });
  });

  describe("getChangesSince", () => {
    it("returns empty events when since >= version", () => {
      const v = getVersion();
      const result = getChangesSince(v);
      expect(result.version).toBe(v);
      expect(result.events).toEqual([]);
    });

    it("returns empty events when since > version", () => {
      const v = getVersion();
      const result = getChangesSince(v + 100);
      expect(result.version).toBe(v);
      expect(result.events).toEqual([]);
    });

    it("returns events after a given version", () => {
      const before = getVersion();
      recordChange({ source: "resources", type: "change", key: "r1" });
      recordChange({ source: "app-state", type: "delete", key: "a1" });

      const result = getChangesSince(before);
      expect(result.version).toBeGreaterThan(before);
      expect(result.events.length).toBe(2);
      expect(result.events[0].source).toBe("resources");
      expect(result.events[0].key).toBe("r1");
      expect(result.events[1].source).toBe("app-state");
      expect(result.events[1].key).toBe("a1");
    });

    it("each event has a strictly increasing version number", () => {
      const before = getVersion();
      recordChange({ source: "s", type: "change" });
      recordChange({ source: "s", type: "change" });
      recordChange({ source: "s", type: "change" });

      const result = getChangesSince(before);
      expect(result.events.length).toBe(3);
      for (let i = 1; i < result.events.length; i++) {
        expect(result.events[i].version).toBeGreaterThan(
          result.events[i - 1].version,
        );
      }
    });

    it("preserves extra properties on events", () => {
      const before = getVersion();
      recordChange({
        source: "resources",
        type: "change",
        key: "x",
        id: "res-1",
        path: "file.md",
      });

      const result = getChangesSince(before);
      expect(result.events[0].id).toBe("res-1");
      expect(result.events[0].path).toBe("file.md");
    });
  });

  describe("ring buffer overflow", () => {
    it("trims old events when buffer exceeds MAX_BUFFER (200)", () => {
      const before = getVersion();

      for (let i = 0; i < 250; i++) {
        recordChange({ source: "test", type: "change", key: `k${i}` });
      }

      const result = getChangesSince(before);
      expect(result.events.length).toBeLessThanOrEqual(200);
      expect(result.version).toBeGreaterThan(before);
    });
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
    vi.useRealTimers();
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
      execute: vi.fn(
        async (query: string | { sql: string; args?: unknown[] }) => {
          const sql = typeof query === "string" ? query : query.sql;
          if (!sql.startsWith("SELECT id, version, event_json")) {
            return { rows: [], rowsAffected: 0 };
          }
          // The rows after the read's cursor, up to its limit.
          const args = typeof query === "string" ? [] : (query.args ?? []);
          const version = Number(args[0]);
          const id = String(args[2]);
          const after = sql.includes("version = ?")
            ? (row: (typeof rows)[number]) =>
                row.version > version ||
                (row.version === version && row.id > id)
            : (row: (typeof rows)[number]) => row.version > version;
          return {
            rows: rows.filter(after).slice(0, Number(args.at(-1))),
            rowsAffected: 0,
          };
        },
      ),
    };
    return new AppSyncState({ getDb: () => db, ...options });
  }

  const othersDocuments = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      resourceType: "document",
      resourceId: `others-${i}`,
    }));
  const readerDocument = { resourceType: "document", resourceId: "mine" };
  // A sharing resolver's answer that the reader may view a resource.
  const viewerOf = (id: string) => ({
    role: "viewer" as const,
    resource: {
      id,
      ownerEmail: "writer@example.com",
      orgId: null,
      visibility: "private" as const,
    },
  });

  it("passes a page of other people's resources in one poll", async () => {
    const rows = durableRows([...othersDocuments(240), readerDocument]);
    const resolveAccess = vi.fn(
      (_type: string, resourceId: string) =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve(resourceId === "mine" ? { role: "viewer" } : null),
            5,
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
      expect.any(Function),
    );
    expect(resolveAccessMany).toHaveBeenCalledWith(
      "deck",
      ["deck-1", "deck-2"],
      { userEmail: "reader@example.com", orgId: undefined },
      expect.any(Function),
    );
  });

  it("passes resources a batch has answered before the rest of it", async () => {
    const rows = durableRows(othersDocuments(3));
    // The batch answers its first resource, then waits on the others forever.
    const resolveAccessMany = vi.fn(
      (
        _type: string,
        ids: string[],
        _ctx: unknown,
        answered?: (resourceId: string, allowed: boolean) => void,
      ) => {
        if (ids[0] !== undefined) answered?.(ids[0], true);
        return new Promise<Set<string>>(() => {});
      },
    );
    const state = stateReading(rows, { resolveAccessMany });

    const result = await state.getCombinedChangesSinceForUser(
      5,
      "reader@example.com",
      undefined,
      true,
      { version: 5, id: "" },
    );

    expect(result.events.map((event) => event.resourceId)).toEqual([
      "others-0",
    ]);
    expect(result.cursorLimited).toBe(true);
  });

  it("checks on their own only the resources a failed batch left unanswered", async () => {
    const rows = durableRows(othersDocuments(12));
    // The batch answers its first two resources, then fails.
    const resolveAccessMany = vi.fn(
      async (
        _type: string,
        ids: string[],
        _ctx: unknown,
        answered?: (resourceId: string, allowed: boolean) => void,
      ) => {
        if (ids.length === 1) return new Set(ids);
        for (const id of ids.slice(0, 2)) answered?.(id, true);
        throw new Error("Builder unavailable");
      },
    );
    const state = stateReading(rows, { resolveAccessMany });

    const result = await state.getCombinedChangesSinceForUser(
      5,
      "reader@example.com",
      undefined,
      true,
      { version: 5, id: "" },
    );

    // The read after the wait starts a batch for the last two, so only the
    // single checks are counted here.
    expect(
      resolveAccessMany.mock.calls
        .map(([, ids]) => ids)
        .filter((ids) => ids.length === 1),
    ).toEqual(
      othersDocuments(12)
        .slice(2, 10)
        .map((resource) => [resource.resourceId]),
    );
    expect(result.events.map((event) => event.resourceId)).toEqual(
      othersDocuments(10).map((resource) => resource.resourceId),
    );
    expect(result.cursorLimited).toBe(true);
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
    const resolveAccessMany = vi.fn(
      async (_type: string, resourceIds: string[]) => {
        if (resourceIds.includes("broken")) {
          throw new Error("org membership lookup failed");
        }
        return new Set(resourceIds);
      },
    );
    const resolveAccess = vi.fn(async () => ({ role: "viewer" }));
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
    // The batch, then each resource as a batch of its own.
    expect(resolveAccessMany).toHaveBeenCalledTimes(4);
    // The single resolver may follow other rules, so the fallback never
    // asks it.
    expect(resolveAccess).not.toHaveBeenCalled();
  });

  it("checks only the first few of a failed batch on their own", async () => {
    const rows = durableRows(othersDocuments(20));
    // Any batch of more than one resource fails.
    const resolveAccessMany = vi.fn(
      async (_type: string, resourceIds: string[]) => {
        if (resourceIds.length > 1) throw new Error("database unavailable");
        return new Set(resourceIds);
      },
    );
    const state = stateReading(rows, { resolveAccessMany });

    const result = await state.getCombinedChangesSinceForUser(
      5,
      "reader@example.com",
      undefined,
      true,
      { version: 5, id: "" },
    );

    // The first 8 were checked on their own and pass; the read stops at the
    // 9th, whose check a later read starts.
    expect(result.events.map((event) => event.resourceId)).toEqual(
      othersDocuments(8).map((resource) => resource.resourceId),
    );
    expect(result.cursorLimited).toBe(true);
  });

  it("counts checks still running against a read's limit", async () => {
    const rows = durableRows(othersDocuments(300));
    // The first batch never finishes.
    const resolveAccessMany = vi.fn(() => new Promise<Set<string>>(() => {}));
    const state = stateReading(rows, { resolveAccessMany });

    await state.getCombinedChangesSinceForUser(
      5,
      "reader@example.com",
      undefined,
      true,
      { version: 5, id: "" },
    );

    // The read after the wait found 250 checks running and started no more.
    expect(resolveAccessMany).toHaveBeenCalledOnce();
    expect(resolveAccessMany.mock.calls[0]?.[1]).toHaveLength(250);
  });

  it("starts no batch once an instance has many checks running", async () => {
    const rows = durableRows(othersDocuments(300));
    // No check ever finishes.
    const resolveAccessMany = vi.fn(() => new Promise<Set<string>>(() => {}));
    const resolveAccess = vi.fn(() => new Promise(() => {}));
    const state = stateReading(rows, { resolveAccess, resolveAccessMany });

    const read = (reader: number) =>
      state.getDurableChangesSinceForUser(
        5,
        `reader-${reader}@example.com`,
        undefined,
        { version: 5, id: "" },
      );

    // Each reader's checks are their own.
    for (let reader = 0; reader < 4; reader++) await read(reader);
    // Sharing changed on a resource every batch covers. Their answers about
    // it no longer count, but their resolvers still run.
    state.invalidateCollabAccessCache("document", "others-0");
    await read(4);

    // Four reads' worth of checks fill the instance, so the fifth reader
    // checks only the change it stopped at.
    expect(resolveAccessMany).toHaveBeenCalledTimes(4);
    for (const [, ids] of resolveAccessMany.mock.calls) {
      expect(ids).toHaveLength(250);
    }
    expect(resolveAccess).toHaveBeenCalledOnce();
  });

  it("checks again after a batch that never answers runs out of time", async () => {
    vi.useFakeTimers();
    const rows = durableRows(othersDocuments(2));
    const resolveAccessMany = vi.fn(() => new Promise<Set<string>>(() => {}));
    const state = stateReading(rows, {
      resolveAccess: () => new Promise(() => {}),
      resolveAccessMany,
    });
    const read = () =>
      state.getDurableChangesSinceForUser(5, "reader@example.com", undefined, {
        version: 5,
        id: "",
      });

    await read();
    await vi.advanceTimersByTimeAsync(29_999);
    await read();
    expect(resolveAccessMany).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    await read();
    expect(resolveAccessMany).toHaveBeenCalledTimes(2);
  });

  it("ignores a batch's answer that arrives after its deadline", async () => {
    vi.useFakeTimers();
    const rows = durableRows([{ resourceType: "document", resourceId: "a" }]);
    let finishFirst!: (visible: Set<string>) => void;
    const resolveAccessMany = vi
      .fn<(type: string, ids: string[]) => Promise<Set<string>>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      // The reader lost access by the time the second check ran.
      .mockImplementation(async () => new Set());
    const state = stateReading(rows, {
      resolveAccess: () => new Promise(() => {}),
      resolveAccessMany,
    });
    const read = () =>
      state.getDurableChangesSinceForUser(5, "reader@example.com", undefined, {
        version: 5,
        id: "",
      });
    const event = {
      owner: "writer@example.com",
      resourceType: "document",
      resourceId: "a",
    };

    await read();
    await vi.advanceTimersByTimeAsync(30_000);
    await read();
    await vi.advanceTimersByTimeAsync(0);
    expect(resolveAccessMany).toHaveBeenCalledTimes(2);
    expect(
      state.getChangeVisibilityForUser(event, "reader@example.com", undefined),
    ).toBe("hidden");

    finishFirst(new Set(["a"]));
    await vi.advanceTimersByTimeAsync(0);

    expect(
      state.getChangeVisibilityForUser(event, "reader@example.com", undefined),
    ).toBe("hidden");
  });

  it("counts a batch past its deadline against the instance's limit until it ends", async () => {
    vi.useFakeTimers();
    const rows = durableRows(othersDocuments(300));
    const finish: Array<(visible: Set<string>) => void> = [];
    const resolveAccessMany = vi.fn(
      () =>
        new Promise<Set<string>>((resolve) => {
          finish.push(resolve);
        }),
    );
    const state = stateReading(rows, {
      resolveAccess: () => new Promise(() => {}),
      resolveAccessMany,
    });
    const read = (reader: number) =>
      state.getDurableChangesSinceForUser(
        5,
        `reader-${reader}@example.com`,
        undefined,
        { version: 5, id: "" },
      );

    for (let reader = 0; reader < 4; reader++) await read(reader);
    await vi.advanceTimersByTimeAsync(30_000);
    // The four batches are past their deadline, but their resolvers still
    // run, so a fifth reader starts none.
    await read(4);
    expect(resolveAccessMany).toHaveBeenCalledTimes(4);

    finish[0]?.(new Set());
    await vi.advanceTimersByTimeAsync(0);
    await read(4);
    expect(resolveAccessMany).toHaveBeenCalledTimes(5);
  });

  it("gives up on a single resolver's check that never answers", async () => {
    vi.useFakeTimers();
    const rows = durableRows([{ resourceType: "document", resourceId: "a" }]);
    // Only a single resolver is set, and its first check never answers.
    const resolveAccess = vi
      .fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementation(async () => ({ role: "viewer" }));
    const state = stateReading(rows, { resolveAccess });
    const read = () =>
      state.getDurableChangesSinceForUser(5, "reader@example.com", undefined, {
        version: 5,
        id: "",
      });

    expect((await read()).events).toEqual([]);
    await vi.advanceTimersByTimeAsync(30_000);
    await read();
    await vi.advanceTimersByTimeAsync(0);

    expect((await read()).events.map((event) => event.resourceId)).toEqual([
      "a",
    ]);
    expect(resolveAccess).toHaveBeenCalledTimes(2);
  });

  it("does not count a reset's old checks against the instance's limit", async () => {
    const rows = durableRows(othersDocuments(300));
    let finishEarly!: (visible: Set<string>) => void;
    const resolveAccessMany = vi
      .fn<(type: string, ids: string[]) => Promise<Set<string>>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishEarly = resolve;
          }),
      )
      .mockImplementation(() => new Promise(() => {}));
    const state = stateReading(rows, {
      resolveAccess: () => new Promise(() => {}),
      resolveAccessMany,
    });
    const read = (reader: string) =>
      state.getDurableChangesSinceForUser(
        5,
        `${reader}@example.com`,
        undefined,
        { version: 5, id: "" },
      );

    await read("early");
    state.__resetAccessCacheForTests();
    // The batch from before the reset ends after it, which must not hand the
    // instance room it never counted.
    finishEarly(new Set());
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let reader = 0; reader < 5; reader++) await read(`reader-${reader}`);

    // The early batch, then four reads' worth; the fifth reader starts none.
    expect(resolveAccessMany).toHaveBeenCalledTimes(5);
  });

  it("limits a combined read's checks across memory and the log together", async () => {
    const rows = durableRows(othersDocuments(250));
    const resolveAccessMany = vi.fn(
      async (_type: string, _ids: string[]) =>
        new Promise<Set<string>>(() => {}),
    );
    const state = stateReading(rows, {
      resolveAccess: () => new Promise(() => {}),
      resolveAccessMany,
    });
    for (let i = 0; i < 150; i++) {
      state.recordChange({
        source: "action",
        type: "change",
        key: "edit-document",
        owner: "writer@example.com",
        resourceType: "document",
        resourceId: `memory-${i}`,
      });
    }

    await state.getCombinedChangesSinceForUser(
      5,
      "reader@example.com",
      undefined,
      true,
      { version: 5, id: "" },
    );

    const checked = resolveAccessMany.mock.calls.flatMap(([, ids]) => ids);
    expect(checked.some((id) => id.startsWith("memory-"))).toBe(true);
    expect(checked.some((id) => id.startsWith("others-"))).toBe(true);
    expect(checked.length).toBeLessThanOrEqual(250);
  });

  it("loads whole rows for resource types a host resolver decides", async () => {
    vi.mocked(sharingAccess.resolveAccessMany).mockClear();
    // One type per read: of two dynamic imports of a mocked module started at
    // once, vitest gave only the first the mock.
    for (const resource of [
      { resourceType: "design", resourceId: "builder-hosted" },
      { resourceType: "document", resourceId: "doc" },
    ]) {
      await stateReading(
        durableRows([resource]),
        {},
      ).getDurableChangesSinceForUser(5, "reader@example.com", undefined, {
        version: 5,
        id: "",
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    // Design's host resolver reads the design's data to find its Builder
    // project, which a projected load leaves out.
    expect(sharingAccess.resolveAccessMany).toHaveBeenCalledWith(
      "design",
      ["builder-hosted"],
      { userEmail: "reader@example.com" },
    );
    expect(sharingAccess.resolveAccessMany).toHaveBeenCalledWith(
      "document",
      ["doc"],
      { userEmail: "reader@example.com" },
      { skipResourceBody: true },
    );
  });

  it("passes a host resolver's first answers before its slowest ones", async () => {
    const designs = Array.from({ length: 10 }, (_, i) => ({
      resourceType: "design",
      resourceId: `design-${i}`,
    }));
    const ids = designs.map((design) => design.resourceId);
    const resolveAccessMany = vi.mocked(sharingAccess.resolveAccessMany);
    resolveAccessMany.mockClear();
    // Builder answers the first eight designs and never the last two.
    resolveAccessMany.mockImplementation(async (_type, resourceIds) => {
      const id = String(resourceIds[0]);
      if (id === "design-8" || id === "design-9") {
        return new Promise<never>(() => {});
      }
      return new Map([[id, viewerOf(id)]]);
    });

    try {
      const result = await stateReading(
        durableRows(designs),
        {},
      ).getCombinedChangesSinceForUser(
        5,
        "reader@example.com",
        undefined,
        true,
        { version: 5, id: "" },
      );

      // Each design is checked on its own.
      expect(resolveAccessMany.mock.calls).toEqual(
        ids.map((id) => ["design", [id], { userEmail: "reader@example.com" }]),
      );
      expect(result.events.map((event) => event.resourceId)).toEqual(
        ids.slice(0, 8),
      );
      expect(result.cursorLimited).toBe(true);
    } finally {
      resolveAccessMany.mockImplementation(async () => new Map());
    }
  });

  it("re-checks a host resolver's failed check only once the rest of its group ends", async () => {
    const designs = Array.from({ length: 10 }, (_, i) => ({
      resourceType: "design",
      resourceId: `design-${i}`,
    }));
    const resolveAccessMany = vi.mocked(sharingAccess.resolveAccessMany);
    resolveAccessMany.mockClear();
    let releaseGroup!: () => void;
    const groupHeld = new Promise<void>((resolve) => {
      releaseGroup = resolve;
    });
    let running = 0;
    let mostRunning = 0;
    let failed = false;
    // Builder fails the first design's check once and holds the others.
    resolveAccessMany.mockImplementation(async (_type, resourceIds) => {
      const id = String(resourceIds[0]);
      running++;
      mostRunning = Math.max(mostRunning, running);
      try {
        if (id === "design-0" && !failed) {
          failed = true;
          throw new Error("Builder unavailable");
        }
        if (id !== "design-0") await groupHeld;
        return new Map([[id, viewerOf(id)]]);
      } finally {
        running--;
      }
    });

    try {
      await stateReading(
        durableRows(designs),
        {},
      ).getDurableChangesSinceForUser(5, "reader@example.com", undefined, {
        version: 5,
        id: "",
      });
      await vi.waitFor(() =>
        expect(resolveAccessMany).toHaveBeenCalledTimes(8),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      // The rest of the first group still runs, so neither the next group
      // nor the failed design's second check has started.
      expect(resolveAccessMany).toHaveBeenCalledTimes(8);

      releaseGroup();
      await vi.waitFor(() =>
        expect(resolveAccessMany).toHaveBeenCalledTimes(11),
      );
      expect(resolveAccessMany.mock.calls.at(-1)).toEqual([
        "design",
        ["design-0"],
        { userEmail: "reader@example.com" },
      ]);
      expect(mostRunning).toBeLessThanOrEqual(8);
    } finally {
      resolveAccessMany.mockImplementation(async () => new Map());
    }
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
    expect(resolveAccessMany).toHaveBeenCalledWith(
      "document",
      ["mine"],
      { userEmail: "reader@example.com", orgId: undefined },
      expect.any(Function),
    );
  });
});
