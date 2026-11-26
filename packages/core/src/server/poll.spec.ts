import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as sharingAccess from "../sharing/access.js";
import {
  AppSyncState,
  canSeeChangeForUser,
  getChangesSince,
  getVersion,
  recordChange,
} from "./poll.js";

vi.mock("../sharing/registry.js", () => ({
  getShareableResource: (type: string) =>
    type === "document" ? {} : undefined,
}));

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

  it("keeps user settings notifications private even without owner metadata", () => {
    const alice = {
      source: "settings",
      key: "u:Alice@example.test:calendar-view-settings",
    };
    const bob = {
      source: "settings",
      key: "u:bob@example.test:calendar-view-settings",
      orgId: "shared-org",
    };
    const theme = {
      source: "settings",
      key: "theme",
      visibility: "public" as const,
    };
    const visibleTo = (email: string) =>
      [alice, bob, theme].filter((event) =>
        canSeeChangeForUser(event, email, "shared-org"),
      );
    expect(visibleTo("alice@example.test")).toEqual([alice, theme]);
    expect(visibleTo("bob@example.test")).toEqual([bob, theme]);
    expect(visibleTo("stranger@example.test")).toEqual([theme]);
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
      expect.any(Function),
    );
    expect(resolveAccessMany).toHaveBeenCalledWith(
      "deck",
      ["deck-1", "deck-2"],
      { userEmail: "reader@example.com", orgId: undefined },
      expect.any(Function),
      expect.any(Function),
    );
  });

  it("passes resources a batch has answered before the rest of it", async () => {
    const rows = durableRows(othersDocuments(3));
    const resolveAccessMany = vi.fn(
      (
        _type: string,
        ids: string[],
        _ctx: unknown,
        answered?: (resourceId: string, allowed: boolean) => void,
      ) => {
        for (const id of ids.slice(0, 1)) answered?.(id, true);
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

    expect(resolveAccessMany.mock.calls.map(([, ids]) => ids)).toEqual([
      othersDocuments(12).map((resource) => resource.resourceId),
      ...othersDocuments(11)
        .slice(2)
        .map((resource) => [resource.resourceId]),
    ]);
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
    expect(polls).toBeGreaterThan(1);
    expect(polls).toBeLessThanOrEqual(3);
    for (const [, ids] of resolveAccessMany.mock.calls) {
      expect(ids.length).toBeLessThanOrEqual(250);
    }
  });

  it("marks only the failing resource unreadable when a batch check fails", async () => {
    const rows = durableRows([
      { resourceType: "document", resourceId: "shared" },
      { resourceType: "document", resourceId: "broken" },
      readerDocument,
    ]);
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

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
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
    expect(result.unreadable).toEqual([{ type: "access-unavailable" }]);
    expect(log).toHaveBeenCalledWith(
      "[agent-native] sync event unreadable",
      expect.objectContaining({
        resourceType: "document",
        resourceId: "broken",
        cause: "threw",
        errorName: "Error",
      }),
    );
    log.mockRestore();
    const visibilityOf = (resourceId: string) =>
      state.getChangeVisibilityForUser(
        {
          owner: "writer@example.com",
          resourceType: "document",
          resourceId,
        },
        "reader@example.com",
        undefined,
      );
    expect(["shared", "broken", "mine"].map(visibilityOf)).toEqual([
      "visible",
      "unreadable",
      "visible",
    ]);
    expect(resolveAccessMany).toHaveBeenCalledTimes(4);
    expect(resolveAccess).not.toHaveBeenCalled();
  });

  it("checks only the first few of a failed batch on their own", async () => {
    const rows = durableRows(othersDocuments(20));
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

    expect(result.events.map((event) => event.resourceId)).toEqual(
      othersDocuments(8).map((resource) => resource.resourceId),
    );
    expect(result.cursorLimited).toBe(true);
  });

  it("counts checks still running against a read's limit", async () => {
    const rows = durableRows(othersDocuments(300));
    const resolveAccessMany = vi.fn(() => new Promise<Set<string>>(() => {}));
    const state = stateReading(rows, { resolveAccessMany });

    await state.getCombinedChangesSinceForUser(
      5,
      "reader@example.com",
      undefined,
      true,
      { version: 5, id: "" },
    );

    expect(resolveAccessMany).toHaveBeenCalledOnce();
    expect(resolveAccessMany.mock.calls[0]?.[1]).toHaveLength(250);
  });

  it("starts no batch once an instance has many checks running", async () => {
    const rows = durableRows(othersDocuments(300));
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

    for (let reader = 0; reader < 4; reader++) await read(reader);
    state.invalidateCollabAccessCache("document", "others-0");
    await read(4);

    expect(resolveAccessMany).toHaveBeenCalledTimes(4);
    for (const [, ids] of resolveAccessMany.mock.calls) {
      expect(ids).toHaveLength(250);
    }
    expect(resolveAccess).toHaveBeenCalledOnce();
  });

  it("bounds single checks past the instance's limit too", async () => {
    vi.useFakeTimers();
    const rows = durableRows(othersDocuments(250));
    const resolveAccessMany = vi.fn(() => new Promise<Set<string>>(() => {}));
    const resolveAccess = vi.fn(() => new Promise(() => {}));
    const state = stateReading(rows, { resolveAccess, resolveAccessMany });
    for (let reader = 0; reader < 4; reader++) {
      await state.getDurableChangesSinceForUser(
        5,
        `reader-${reader}@example.com`,
        undefined,
        { version: 5, id: "" },
      );
    }
    const visibilityOf = (resourceId: string) =>
      state.getChangeVisibilityForUser(
        {
          owner: "writer@example.com",
          resourceType: "document",
          resourceId,
        },
        "single@example.com",
        undefined,
      );

    for (let i = 0; i < 251; i++) visibilityOf(`single-${i}`);
    await vi.advanceTimersByTimeAsync(0);
    expect(resolveAccess).toHaveBeenCalledTimes(250);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(visibilityOf("single-0")).toBe("pending");
    await vi.advanceTimersByTimeAsync(0);
    expect(resolveAccess).toHaveBeenCalledTimes(250);
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

  it("asks for a resync when a change's checks miss their deadline twice in a row", async () => {
    vi.useFakeTimers();
    const rows = durableRows([
      { resourceType: "document", resourceId: "a" },
      { resourceType: "document", resourceId: "b" },
    ]);
    const resolveAccess = vi.fn((_type: string, id: string) =>
      id === "a" ? new Promise(() => {}) : Promise.resolve(viewerOf(id)),
    );
    const state = stateReading(rows, {
      resolveAccess,
      accessAllowTtlMs: 300_000,
    });
    const readIds = async () =>
      (
        await state.getDurableChangesSinceForUser(
          5,
          "reader@example.com",
          undefined,
          { version: 5, id: "" },
        )
      ).events.map((event) => event.resourceId);

    expect(await readIds()).toEqual([]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await readIds()).toEqual([]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await readIds()).toEqual(["b"]);
  });

  it("starts the count of missed deadlines over after an answer", async () => {
    vi.useFakeTimers();
    const never = () => new Promise(() => {});
    const resolveAccess = vi
      .fn()
      .mockImplementationOnce(never)
      .mockImplementationOnce(async () => viewerOf("a"))
      .mockImplementation(never);
    const state = stateReading([], { resolveAccess, accessAllowTtlMs: 1_000 });
    const visibility = () =>
      state.getChangeVisibilityForUser(
        {
          owner: "writer@example.com",
          resourceType: "document",
          resourceId: "a",
        },
        "reader@example.com",
        undefined,
      );

    expect(visibility()).toBe("pending");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(visibility()).toBe("pending");
    await vi.advanceTimersByTimeAsync(0);
    expect(visibility()).toBe("visible");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(visibility()).toBe("pending");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(visibility()).toBe("pending");
    await vi.advanceTimersByTimeAsync(0);
    expect(resolveAccess).toHaveBeenCalledTimes(4);
  });

  it("starts the count of missed deadlines over when sharing changes", async () => {
    vi.useFakeTimers();
    const resolveAccess = vi.fn(() => new Promise(() => {}));
    const state = stateReading([], { resolveAccess });
    const event = {
      owner: "writer@example.com",
      resourceType: "document",
      resourceId: "a",
    };
    const visibility = () =>
      state.getChangeVisibilityForUser(event, "reader@example.com", undefined);

    expect(visibility()).toBe("pending");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(visibility()).toBe("pending");
    await vi.advanceTimersByTimeAsync(10_000);
    state.invalidateCollabAccessCache("document", "a");
    expect(visibility()).toBe("pending");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(visibility()).toBe("pending");
    await vi.advanceTimersByTimeAsync(0);
    expect(resolveAccess).toHaveBeenCalledTimes(4);
  });

  it("counts no missed deadline for a resource its batch never started checking", async () => {
    vi.useFakeTimers();
    const ids = Array.from({ length: 9 }, (_, i) => `slow-${i}`);
    const rows = durableRows(
      ids.map((resourceId) => ({ resourceType: "document", resourceId })),
    );
    const resolveAccess = vi.fn(() => new Promise(() => {}));
    const state = stateReading(rows, { resolveAccess });
    const read = () =>
      state.getDurableChangesSinceForUser(5, "reader@example.com", undefined, {
        version: 5,
        id: "",
      });
    const visibilityOf = (resourceId: string) =>
      state.getChangeVisibilityForUser(
        { owner: "writer@example.com", resourceType: "document", resourceId },
        "reader@example.com",
        undefined,
      );

    await read();
    await vi.advanceTimersByTimeAsync(30_000);
    await read();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(resolveAccess).toHaveBeenCalledTimes(16);
    expect(visibilityOf("slow-0")).toBe("unreadable");
    expect(visibilityOf("slow-8")).toBe("pending");
  });

  it("starts no more of a batch's checks once its deadline passes", async () => {
    vi.useFakeTimers();
    const ids = Array.from({ length: 9 }, (_, i) => `slow-${i}`);
    const rows = durableRows(
      ids.map((resourceId) => ({ resourceType: "document", resourceId })),
    );
    const finish: Array<() => void> = [];
    const resolveAccess = vi.fn(
      () =>
        new Promise((resolve) => {
          finish.push(() => resolve({ role: "viewer" }));
        }),
    );
    const state = stateReading(rows, { resolveAccess });

    await state.getDurableChangesSinceForUser(
      5,
      "reader@example.com",
      undefined,
      { version: 5, id: "" },
    );
    await vi.advanceTimersByTimeAsync(30_000);
    for (const answer of finish) answer();
    await vi.advanceTimersByTimeAsync(0);

    expect(resolveAccess).toHaveBeenCalledTimes(8);
    expect(
      state.getChangeVisibilityForUser(
        {
          owner: "writer@example.com",
          resourceType: "document",
          resourceId: "slow-8",
        },
        "reader@example.com",
        undefined,
      ),
    ).toBe("pending");
  });

  it("starts no group of a batch after one of its checks fails", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `doc-${i}`);
    const rows = durableRows(
      ids.map((resourceId) => ({ resourceType: "document", resourceId })),
    );
    const resolveAccess = vi.fn(async (_type: string, resourceId: string) => {
      if (resourceId === "doc-0") throw new Error("Builder unavailable");
      return { role: "viewer" };
    });
    const state = stateReading(rows, { resolveAccess });

    await state
      .getDurableChangesSinceForUser(5, "reader@example.com", undefined, {
        version: 5,
        id: "",
      })
      .catch(() => undefined);
    await vi.waitFor(() => expect(resolveAccess).toHaveBeenCalledTimes(16));
    // fixed-sleep-ok: gives a later group time to start, to show none does
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(resolveAccess).toHaveBeenCalledTimes(16);
    expect(resolveAccess.mock.calls.slice(8).map(([, id]) => id)).toEqual([
      "doc-0",
      ...ids.slice(8, 15),
    ]);
  });

  it("counts a missed deadline for a failed batch's retry the batch never reported", async () => {
    vi.useFakeTimers();
    const rows = durableRows([
      { resourceType: "document", resourceId: "a" },
      { resourceType: "document", resourceId: "b" },
    ]);
    const resolveAccessMany = vi.fn(
      (
        _type: string,
        ids: string[],
        _ctx: unknown,
        _answered?: unknown,
        starting?: (resourceIds: readonly string[]) => void,
      ): Promise<Set<string>> => {
        if (ids.length === 1) return new Promise(() => {});
        starting?.(ids.slice(0, 1));
        return Promise.reject(new Error("Builder unavailable"));
      },
    );
    const state = stateReading(rows, { resolveAccessMany });
    const read = () =>
      state.getDurableChangesSinceForUser(5, "reader@example.com", undefined, {
        version: 5,
        id: "",
      });

    await read();
    await vi.advanceTimersByTimeAsync(30_000);
    await read();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(
      state.getChangeVisibilityForUser(
        {
          owner: "writer@example.com",
          resourceType: "document",
          resourceId: "b",
        },
        "reader@example.com",
        undefined,
      ),
    ).toBe("unreadable");
  });

  it("counts no missed deadline for a resource its batch answered, once the cache drops the answer", async () => {
    vi.useFakeTimers();
    const never = () => new Promise(() => {});
    const checkB = vi.fn().mockResolvedValueOnce(viewerOf("b"));
    checkB.mockImplementation(never);
    const resolveAccess = vi.fn((_type: string, id: string) =>
      id === "a"
        ? never()
        : id === "b"
          ? checkB()
          : Promise.resolve(viewerOf(id)),
    );
    const rows = durableRows([
      { resourceType: "document", resourceId: "a" },
      { resourceType: "document", resourceId: "b" },
    ]);
    const state = stateReading(rows, { resolveAccess });
    const visibilityOf = (resourceId: string) =>
      state.getChangeVisibilityForUser(
        { owner: "writer@example.com", resourceType: "document", resourceId },
        "reader@example.com",
        undefined,
      );

    await state.getDurableChangesSinceForUser(
      5,
      "reader@example.com",
      undefined,
      { version: 5, id: "" },
    );
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 5_000; i++) {
      visibilityOf(`other-${i}`);
      if (i % 250 === 249) await vi.advanceTimersByTimeAsync(0);
    }
    expect(visibilityOf("other-0")).toBe("visible");

    await vi.advanceTimersByTimeAsync(30_000);
    expect(visibilityOf("b")).toBe("pending");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(visibilityOf("b")).toBe("pending");
    await vi.advanceTimersByTimeAsync(0);
    expect(checkB).toHaveBeenCalledTimes(3);
  });

  it("does not count a reset's old checks against the instance's limit", async () => {
    vi.useFakeTimers();
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
    finishEarly(new Set());
    await vi.advanceTimersByTimeAsync(0);
    for (let reader = 0; reader < 5; reader++) await read(`reader-${reader}`);

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
    for (const [index, resource] of [
      { resourceType: "design", resourceId: "builder-hosted" },
      { resourceType: "document", resourceId: "doc" },
    ].entries()) {
      await stateReading(
        durableRows([resource]),
        {},
      ).getDurableChangesSinceForUser(5, "reader@example.com", undefined, {
        version: 5,
        id: "",
      });
      await vi.waitFor(() =>
        expect(sharingAccess.resolveAccessMany).toHaveBeenCalledTimes(
          index + 1,
        ),
      );
    }

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
    resolveAccessMany.mockImplementation(async (_type, resourceIds) => {
      const id = String(resourceIds[0]);
      running++;
      mostRunning = Math.max(mostRunning, running);
      try {
        if (id === "design-8" && !failed) {
          failed = true;
          throw new Error("Builder unavailable");
        }
        if (id === "design-9") await groupHeld;
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
        expect(resolveAccessMany).toHaveBeenCalledTimes(10),
      );
      // fixed-sleep-ok: gives the failed design's re-check time to start early, to show it waits
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(resolveAccessMany).toHaveBeenCalledTimes(10);

      releaseGroup();
      await vi.waitFor(() =>
        expect(resolveAccessMany).toHaveBeenCalledTimes(11),
      );
      expect(resolveAccessMany.mock.calls.at(-1)).toEqual([
        "design",
        ["design-8"],
        { userEmail: "reader@example.com" },
      ]);
      expect(mostRunning).toBeLessThanOrEqual(8);
    } finally {
      resolveAccessMany.mockImplementation(async () => new Map());
    }
  });

  it("keeps a newer check running when an older batch for its resource ends", async () => {
    vi.useFakeTimers();
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
    state.invalidateCollabAccessCache("document", "a");
    expect(
      state.getChangeVisibilityForUser(event, "reader@example.com", undefined),
    ).toBe("pending");
    await Promise.resolve();
    expect(resolveAccess).toHaveBeenCalledOnce();

    finishBatch(new Set(["a"]));
    await vi.advanceTimersByTimeAsync(0);

    expect(
      state.getChangeVisibilityForUser(event, "reader@example.com", undefined),
    ).toBe("pending");
    expect(resolveAccess).toHaveBeenCalledOnce();
  });

  it("gives up on a single check that never answers", async () => {
    vi.useFakeTimers();
    const resolveAccess = vi
      .fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementation(async () => ({ role: "viewer" }));
    const state = stateReading([], { resolveAccess });
    const visibility = () =>
      state.getChangeVisibilityForUser(
        {
          owner: "writer@example.com",
          resourceType: "document",
          resourceId: "a",
        },
        "reader@example.com",
        undefined,
      );

    expect(visibility()).toBe("pending");
    await vi.advanceTimersByTimeAsync(29_999);
    expect(visibility()).toBe("pending");
    expect(resolveAccess).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    expect(visibility()).toBe("pending");
    await vi.advanceTimersByTimeAsync(0);
    expect(visibility()).toBe("visible");
    expect(resolveAccess).toHaveBeenCalledTimes(2);
  });

  it("starts no more checks when a read reads again after its wait", async () => {
    const rows = durableRows(othersDocuments(600));
    const resolveAccessMany = vi.fn(
      async (_type: string, _ids: string[]) => new Set<string>(),
    );
    const state = stateReading(rows, {
      resolveAccess: async () => null,
      resolveAccessMany,
    });

    const result = await state.getCombinedChangesSinceForUser(
      5,
      "reader@example.com",
      undefined,
      true,
      { version: 5, id: "" },
    );

    expect(resolveAccessMany.mock.calls.flatMap(([, ids]) => ids)).toEqual(
      othersDocuments(250).map((resource) => resource.resourceId),
    );
    expect(result.cursorLimited).toBe(true);
  });

  it("checks a single resource through the batch resolver when only it is set", async () => {
    const resolveAccessMany = vi.fn(
      async (_type: string, ids: string[]) => new Set(ids),
    );
    const state = stateReading([], { resolveAccessMany });
    const event = {
      owner: "writer@example.com",
      resourceType: "document",
      resourceId: "a",
    };

    expect(
      state.getChangeVisibilityForUser(event, "reader@example.com", undefined),
    ).toBe("pending");

    await vi.waitFor(() =>
      expect(
        state.getChangeVisibilityForUser(
          event,
          "reader@example.com",
          undefined,
        ),
      ).toBe("visible"),
    );
    expect(resolveAccessMany).toHaveBeenCalledWith("document", ["a"], {
      userEmail: "reader@example.com",
      orgId: undefined,
    });
  });

  it("waits only on the checks a read stopped at", async () => {
    vi.useFakeTimers();
    const rows = durableRows([readerDocument]);
    const resolveAccessMany = vi.fn(
      (_type: string, ids: string[], ctx: { userEmail: string }) =>
        new Promise<Set<string>>((resolve) => {
          if (ctx.userEmail === "reader@example.com") {
            setTimeout(() => resolve(new Set(ids)), 10);
          }
        }),
    );
    const state = stateReading(rows, { resolveAccessMany });
    await state.getDurableChangesSinceForUser(
      5,
      "stuck@example.com",
      undefined,
      { version: 5, id: "" },
    );

    let delivered: string[] | undefined;
    void state
      .getCombinedChangesSinceForUser(
        5,
        "reader@example.com",
        undefined,
        true,
        { version: 5, id: "" },
      )
      .then((result) => {
        delivered = result.events.map((event) => String(event.resourceId));
      });
    await vi.advanceTimersByTimeAsync(50);

    expect(delivered).toEqual(["mine"]);
  });

  it("waits on no check of a change the other source's stop filters out", async () => {
    vi.useFakeTimers();
    const rows = durableRows([readerDocument]);
    const resolveAccessMany = vi.fn(
      (_type: string, ids: string[]) =>
        new Promise<Set<string>>((resolve) => {
          if (!ids.includes("stuck")) {
            setTimeout(() => resolve(new Set(ids)), 10);
          }
        }),
    );
    const state = stateReading(rows, { resolveAccessMany });
    for (const [owner, resourceId] of [
      ["reader@example.com", "note"],
      ["writer@example.com", "stuck"],
    ]) {
      state.recordChange({
        source: "action",
        type: "change",
        key: "edit-document",
        owner,
        resourceType: "document",
        resourceId,
      });
    }

    let delivered: string[] | undefined;
    void state
      .getCombinedChangesSinceForUser(
        5,
        "reader@example.com",
        undefined,
        true,
        { version: 5, id: "" },
      )
      .then((result) => {
        delivered = result.events.map((event) => String(event.resourceId));
      });
    await vi.advanceTimersByTimeAsync(50);

    expect(delivered).toEqual(["mine", "note"]);
  });

  it("does not report an unknown-scope row beyond the combined cursor", async () => {
    const rows: ReturnType<typeof durableRows> = [];
    const state = stateReading(rows, {
      resolveAccess: () => new Promise(() => {}),
    });
    state.recordChange({
      source: "action",
      type: "change",
      owner: "writer@example.com",
      resourceType: "document",
      resourceId: "stuck",
    });
    rows.push({
      id: "malformed",
      version: state.getChangesSince(0).version + 1,
      event_json: "{invalid",
    });
    const result = await state.getCombinedChangesSinceForUser(
      5,
      "reader@example.com",
      undefined,
      true,
      { version: 5, id: "" },
    );
    expect(result.cursorLimited).toBe(true);
    expect(result.unreadable).toBeUndefined();
  });

  it("stops at an unchecked change before an unreadable row after it", async () => {
    const rows = [
      ...durableRows([{ resourceType: "document", resourceId: "a" }]),
      { id: "row-0001", version: 7, event_json: "{not json" },
    ];
    const state = stateReading(rows, {
      resolveAccess: () => new Promise(() => {}),
    });
    const read = () =>
      state.getDurableChangesSinceForUser(5, "reader@example.com", undefined, {
        version: 5,
        id: "",
      });

    const result = await read();
    expect(result.events).toEqual([]);
    expect(result.cursorLimited).toBe(true);

    const shared = stateReading(rows, {
      resolveAccess: async () => viewerOf("a"),
    });
    await shared.getDurableChangesSinceForUser(
      5,
      "reader@example.com",
      undefined,
      { version: 5, id: "" },
    );
    await vi.waitFor(() =>
      expect(
        shared.getChangeVisibilityForUser(
          {
            owner: "writer@example.com",
            resourceType: "document",
            resourceId: "a",
          },
          "reader@example.com",
          undefined,
        ),
      ).toBe("visible"),
    );
    await expect(
      shared.getDurableChangesSinceForUser(5, "reader@example.com", undefined, {
        version: 5,
        id: "",
      }),
    ).resolves.toMatchObject({
      unreadable: [{ type: "unknown-scope" }],
    });
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
      expect.any(Function),
    );
  });
});
