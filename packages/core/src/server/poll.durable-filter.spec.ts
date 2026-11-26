import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { recordUnreadableSyncEvent } from "../observability/metrics.js";
import { AppSyncState } from "./poll.js";

vi.mock("../observability/metrics.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../observability/metrics.js")>()),
  recordUnreadableSyncEvent: vi.fn(),
}));

beforeEach(() => {
  process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
});

afterEach(() => {
  delete process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS;
});

describe("access check bookkeeping", () => {
  it("keeps a newer in-flight check when an older one settles", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const resolveAccess = vi.fn(
      () => new Promise<unknown>((resolve) => resolvers.push(resolve)),
    );
    const state = new AppSyncState({ resolveAccess });
    const event = { resourceType: "doc", resourceId: "d1" };

    expect(state.getChangeVisibilityForUser(event, "a@x.test", "o")).toBe(
      "pending",
    );
    state.invalidateCollabAccessCache("doc", "d1");
    expect(state.getChangeVisibilityForUser(event, "a@x.test", "o")).toBe(
      "pending",
    );
    await vi.waitFor(() => expect(resolveAccess).toHaveBeenCalledTimes(2));

    resolvers[0]!({ role: "viewer" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    state.getChangeVisibilityForUser(event, "a@x.test", "o");
    expect(resolveAccess).toHaveBeenCalledTimes(2);
  });
});

// oracle-change: Malformed JSON uses a parsed-row fallback; stored-row and settings-scope tests cover normalization and public visibility across both paths.
describe("durable read filter against stored rows", () => {
  it("matches a stored owner with mixed case and padding", async () => {
    const db = await createTestPglite();
    try {
      await db.exec(`CREATE TABLE sync_events (
        id TEXT PRIMARY KEY, version BIGINT NOT NULL, event_json TEXT NOT NULL,
        source TEXT NOT NULL, type TEXT NOT NULL, event_key TEXT, owner TEXT,
        org_id TEXT, resource_type TEXT, resource_id TEXT, created_at BIGINT NOT NULL)`);
      const event = { source: "action", type: "change", version: 10 };
      await (
        await db.prepare(
          "INSERT INTO sync_events (id, version, event_json, source, type, owner, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
      ).run(
        "e1",
        10,
        JSON.stringify(event),
        "action",
        "change",
        " Alice@Example.TEST ",
        1,
      );
      const execute = async (query: { args?: unknown[]; sql: string }) => ({
        rows: await (await db.prepare(query.sql)).all(...(query.args ?? [])),
        rowsAffected: 0,
      });
      const state = new AppSyncState({ getDb: () => ({ execute }) as never });
      const result = await state.getDurableChangesSinceForUser(
        5,
        "alice@example.test",
        undefined,
        { version: 5, id: "" },
      );
      expect(result.events.map((e) => e.version)).toEqual([10]);
    } finally {
      await db.close();
    }
  });
});

describe("events for resource types this app never registered", () => {
  it("hides another app's event instead of wedging the feed across resyncs", async () => {
    const state = new AppSyncState({
      getDb: () =>
        ({
          execute: async () => ({ rows: [], rowsAffected: 0 }),
        }) as never,
    });
    state.recordChange({
      source: "action",
      type: "change",
      key: "other-app-edit",
      owner: "bob@x.test",
      resourceType: "other-app-page",
      resourceId: "p1",
    });
    const read = () => state.getChangesSinceForUser(0, "alice@x.test", "o");
    const target = {
      owner: "bob@x.test",
      resourceType: "other-app-page",
      resourceId: "p1",
    };
    await vi.waitFor(() =>
      expect(
        state.getChangeVisibilityForUser(target, "alice@x.test", "o"),
      ).not.toBe("pending"),
    );

    for (let resync = 0; resync < 5; resync++) {
      expect(read().events).toEqual([]);
    }
    expect(state.getChangeVisibilityForUser(target, "alice@x.test", "o")).toBe(
      "foreign",
    );
  });

  it("skips an unregistered foreign type in the batch read", async () => {
    const state = new AppSyncState();
    state.recordChange({
      source: "action",
      type: "change",
      owner: "other@x.test",
      resourceType: "foreign-unregistered",
      resourceId: "not-a-uuid",
    });
    await vi.waitFor(
      async () => {
        const result = await state.getCombinedChangesSinceForUser(
          0,
          "a@x.test",
          "o",
          false,
        );
        expect(result.events).toEqual([]);
        expect(result.cursorLimited).toBeUndefined();
      },
      { timeout: 5000 },
    );
  });

  it("still reports a failing resolver for a registered type as unreadable", async () => {
    const state = new AppSyncState({
      resolveAccess: async () => {
        throw new Error("db down");
      },
    });
    const event = { resourceType: "doc", resourceId: "d1" };
    state.getChangeVisibilityForUser(event, "a@x.test", "o");
    await vi.waitFor(() =>
      expect(state.getChangeVisibilityForUser(event, "a@x.test", "o")).toBe(
        "unreadable",
      ),
    );
  });

  it("counts each skipped unreadable event in the metric by cause, not query-level casts", async () => {
    vi.mocked(recordUnreadableSyncEvent).mockClear();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const state = new AppSyncState({
        resolveAccess: async () => {
          throw new Error("db down");
        },
      });
      state.recordChange({
        source: "action",
        type: "change",
        resourceType: "doc",
        resourceId: "d1",
      });
      state.recordChange({
        source: "action",
        type: "change",
        resourceType: "doc",
        resourceId: "d1",
      });
      const result = await state.getCombinedChangesSinceForUser(
        0,
        "a@x.test",
        "o",
        false,
      );
      expect(result.unreadable).toEqual([{ type: "access-unavailable" }]);
      expect(recordUnreadableSyncEvent).toHaveBeenCalledTimes(2);
      expect(recordUnreadableSyncEvent).toHaveBeenNthCalledWith(1, "threw");
      expect(recordUnreadableSyncEvent).toHaveBeenNthCalledWith(2, "threw");

      vi.mocked(recordUnreadableSyncEvent).mockClear();
      const fallbackState = new AppSyncState({
        getDb: () =>
          ({
            execute: async (query: { sql?: string }) => {
              if (query.sql?.includes("event_json::jsonb")) {
                throw Object.assign(
                  new Error("invalid input syntax for type json"),
                  { code: "22P02" },
                );
              }
              if (query.sql?.includes("FROM sync_events")) {
                return {
                  rows: [
                    {
                      id: "bad-1",
                      version: 10,
                      event_json: "{not-json",
                      resource_type: "doc",
                      resource_id: "d1",
                    },
                  ],
                  rowsAffected: 0,
                };
              }
              return { rows: [], rowsAffected: 0 };
            },
          }) as never,
      });
      const durableResult = await fallbackState.getDurableChangesSinceForUser(
        5,
        "a@x.test",
        "o",
      );
      expect(durableResult.unreadable).toEqual([{ type: "unknown-scope" }]);
      expect(recordUnreadableSyncEvent).toHaveBeenCalledTimes(1);
      expect(recordUnreadableSyncEvent).toHaveBeenCalledWith("missing-event");
    } finally {
      errors.mockRestore();
    }
  });

  it("deduplicates unreadable events appearing in both memory and durable reads", async () => {
    vi.mocked(recordUnreadableSyncEvent).mockClear();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      let recordedEvent: Record<string, unknown> | undefined;
      const state = new AppSyncState({
        getDb: () =>
          ({
            execute: async (query: { sql?: string }) => {
              if (query.sql?.includes("FROM sync_events") && recordedEvent) {
                return {
                  rows: [
                    {
                      id: recordedEvent.cursorId,
                      version: recordedEvent.version,
                      event_json: JSON.stringify(recordedEvent),
                      resource_type: "doc",
                      resource_id: "d1",
                    },
                  ],
                  rowsAffected: 0,
                };
              }
              return { rows: [], rowsAffected: 0 };
            },
          }) as never,
        resolveAccess: async () => {
          throw new Error("db down");
        },
      });
      state.recordChange({
        source: "action",
        type: "change",
        resourceType: "doc",
        resourceId: "d1",
      });
      const memSnapshot = state.getChangesSince(0);
      recordedEvent = memSnapshot.events[0] as unknown as Record<
        string,
        unknown
      >;
      vi.mocked(recordUnreadableSyncEvent).mockClear();
      const result = await state.getCombinedChangesSinceForUser(
        1,
        "a@x.test",
        "o",
        true,
      );
      expect(result.unreadable).toEqual([{ type: "access-unavailable" }]);
      expect(recordUnreadableSyncEvent).toHaveBeenCalledTimes(1);
      expect(recordUnreadableSyncEvent).toHaveBeenCalledWith("threw");
    } finally {
      errors.mockRestore();
    }
  });

  it("does not count a corrupt durable copy when memory delivers the event", async () => {
    vi.mocked(recordUnreadableSyncEvent).mockClear();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      let recordedEvent: { cursorId?: string; version: number } | undefined;
      const state = new AppSyncState({
        getDb: () =>
          ({
            execute: async (query: { sql?: string }) => {
              if (query.sql?.includes("FROM sync_events") && recordedEvent) {
                return {
                  rows: [
                    {
                      id: recordedEvent.cursorId,
                      version: recordedEvent.version,
                      event_json: "{bad",
                    },
                  ],
                  rowsAffected: 0,
                };
              }
              return { rows: [], rowsAffected: 0 };
            },
          }) as never,
      });
      state.recordChange({
        source: "action",
        type: "change",
        visibility: "public",
      });
      recordedEvent = state.getChangesSince(0).events[0];
      expect(recordedEvent).toBeDefined();
      const result = await state.getCombinedChangesSinceForUser(
        1,
        "a@x.test",
        "o",
        true,
      );
      expect(result.events).toHaveLength(1);
      expect(result.unreadable).toBeUndefined();
      expect(recordUnreadableSyncEvent).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  it("records timeout cause with normalized userEmail and direct read paths", async () => {
    vi.mocked(recordUnreadableSyncEvent).mockClear();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      const state = new AppSyncState({
        resolveAccess: async (_type, id) => {
          if (id === "slow" || id === "pending-doc") {
            return new Promise(() => {});
          }
          throw new Error("db down");
        },
      });
      const slowEvent = { resourceType: "doc", resourceId: "slow" };
      expect(state.getChangeVisibilityForUser(slowEvent, "a@x.test", "o")).toBe(
        "pending",
      );
      await vi.advanceTimersByTimeAsync(31_000);
      expect(state.getChangeVisibilityForUser(slowEvent, "a@x.test", "o")).toBe(
        "pending",
      );
      await vi.advanceTimersByTimeAsync(31_000);
      expect(state.getChangeVisibilityForUser(slowEvent, "a@x.test", "o")).toBe(
        "unreadable",
      );

      state.recordChange({
        source: "action",
        type: "change",
        resourceType: "doc",
        resourceId: "slow",
      });
      const directMem = state.getChangesSinceForUser(0, "  A@X.TEST  ", "o");
      expect(directMem.unreadable).toEqual([{ type: "access-unavailable" }]);
      expect(recordUnreadableSyncEvent).toHaveBeenCalledTimes(1);
      expect(recordUnreadableSyncEvent).toHaveBeenCalledWith("timeout");

      vi.mocked(recordUnreadableSyncEvent).mockClear();
      state.recordChange({
        source: "action",
        type: "change",
        resourceType: "doc",
        resourceId: "pending-doc",
      });
      const pendingMem = state.getChangesSinceForUser(0, "a@x.test", "o");
      expect(pendingMem.cursorLimited).toBe(true);
      expect(pendingMem.accessPending).toBe(true);
      expect(recordUnreadableSyncEvent).toHaveBeenCalledTimes(1);
      expect(recordUnreadableSyncEvent).toHaveBeenCalledWith("timeout");
    } finally {
      vi.useRealTimers();
      errors.mockRestore();
    }
  });

  it("bounds unreadable counts at cursorLimited boundaries in durable and combined reads", async () => {
    vi.mocked(recordUnreadableSyncEvent).mockClear();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const makeRows = (count: number, sameLastVersion: boolean) =>
        Array.from({ length: count }, (_, index) => {
          const version =
            sameLastVersion && index >= count - 2 ? count : index + 2;
          return {
            id: `r-${index + 1}`,
            version,
            event_json: JSON.stringify({
              id: `r-${index + 1}`,
              version,
              source: "action",
              type: "change",
              resourceType: "doc",
              resourceId: index === 0 ? "bad" : "ok",
            }),
            resource_type: "doc",
            resource_id: index === 0 ? "bad" : "ok",
          };
        });

      let mode: "overflow-same" | "overflow-diff" | "pending" = "overflow-same";
      const state = new AppSyncState({
        getDb: () =>
          ({
            execute: async (query: { sql?: string }) => {
              if (!query.sql?.includes("FROM sync_events")) {
                return { rows: [], rowsAffected: 0 };
              }
              if (mode === "pending") {
                return {
                  rows: [
                    {
                      id: "r-1",
                      version: 2,
                      event_json: JSON.stringify({
                        id: "r-1",
                        version: 2,
                        source: "action",
                        type: "change",
                        resourceType: "doc",
                        resourceId: "bad",
                      }),
                      resource_type: "doc",
                      resource_id: "bad",
                    },
                    {
                      id: "r-2",
                      version: 3,
                      event_json: JSON.stringify({
                        id: "r-2",
                        version: 3,
                        source: "action",
                        type: "change",
                        resourceType: "doc",
                        resourceId: "pending-doc",
                      }),
                      resource_type: "doc",
                      resource_id: "pending-doc",
                    },
                  ],
                  rowsAffected: 0,
                };
              }
              return {
                rows: makeRows(1001, mode === "overflow-same"),
                rowsAffected: 0,
              };
            },
          }) as never,
        resolveAccess: async (_type, id) => {
          if (id === "bad") throw new Error("db down");
          if (id === "pending-doc") return new Promise(() => {});
          return true;
        },
      });
      state.getChangeVisibilityForUser(
        { resourceType: "doc", resourceId: "bad" },
        "a@x.test",
        "o",
      );
      await vi.waitFor(() =>
        expect(
          state.getChangeVisibilityForUser(
            { resourceType: "doc", resourceId: "bad" },
            "a@x.test",
            "o",
          ),
        ).toBe("unreadable"),
      );

      vi.mocked(recordUnreadableSyncEvent).mockClear();
      const overflowSame = await state.getDurableChangesSinceForUser(
        1,
        "a@x.test",
        "o",
      );
      expect(overflowSame.cursorLimited).toBe(true);
      expect(recordUnreadableSyncEvent).toHaveBeenCalledTimes(1);

      vi.mocked(recordUnreadableSyncEvent).mockClear();
      const withCursor = await state.getDurableChangesSinceForUser(
        1,
        "a@x.test",
        "o",
        { version: 1, id: "" },
      );
      expect(withCursor.cursorLimited).toBe(true);
      expect(recordUnreadableSyncEvent).toHaveBeenCalledTimes(1);

      mode = "overflow-diff";
      vi.mocked(recordUnreadableSyncEvent).mockClear();
      const overflowDiff = await state.getDurableChangesSinceForUser(
        1,
        "a@x.test",
        "o",
      );
      expect(overflowDiff.cursorLimited).toBe(true);
      expect(recordUnreadableSyncEvent).toHaveBeenCalledTimes(1);

      mode = "pending";
      vi.mocked(recordUnreadableSyncEvent).mockClear();
      const pendingDurable = await state.getDurableChangesSinceForUser(
        1,
        "a@x.test",
        "o",
      );
      expect(pendingDurable.accessPending).toBe(true);
      expect(recordUnreadableSyncEvent).toHaveBeenCalledTimes(1);

      mode = "overflow-diff";
      for (let i = 0; i < 1002; i++) {
        state.recordChange({
          source: "action",
          type: "change",
          resourceType: "doc",
          resourceId: i === 1001 ? "bad" : "ok",
        });
      }
      vi.mocked(recordUnreadableSyncEvent).mockClear();
      const combinedNoCursor = await state.getCombinedChangesSinceForUser(
        1,
        "a@x.test",
        "o",
        true,
      );
      expect(combinedNoCursor.cursorLimited).toBe(true);
      expect(recordUnreadableSyncEvent).toHaveBeenCalledTimes(1);

      vi.mocked(recordUnreadableSyncEvent).mockClear();
      const combinedWithCursor = await state.getCombinedChangesSinceForUser(
        1,
        "a@x.test",
        "o",
        true,
        { version: 1, id: "" },
      );
      expect(combinedWithCursor.cursorLimited).toBe(true);
      expect(recordUnreadableSyncEvent).toHaveBeenCalledTimes(1);
    } finally {
      errors.mockRestore();
    }
  });
});
