import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AppSyncState,
  getChangesSince,
  getVersion,
  recordChange,
} from "./poll.js";

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
