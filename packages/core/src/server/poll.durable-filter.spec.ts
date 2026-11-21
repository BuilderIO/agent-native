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

  it("counts each unreadable event in the metric by cause", async () => {
    vi.mocked(recordUnreadableSyncEvent).mockClear();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const state = new AppSyncState({
        resolveAccess: async () => {
          throw new Error("db down");
        },
      });
      const event = { resourceType: "doc", resourceId: "d1" };
      state.getChangeVisibilityForUser(event, "a@x.test", "o");
      await vi.waitFor(() =>
        expect(recordUnreadableSyncEvent).toHaveBeenCalledWith("threw"),
      );
    } finally {
      errors.mockRestore();
    }
  });
});
