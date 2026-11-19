import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { AppSyncState } from "./poll.js";

beforeEach(() => {
  process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
});

afterEach(() => {
  delete process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS;
});

describe("durable read filter", () => {
  async function captureRead(userEmail: string) {
    const execute = vi.fn(async () => ({ rows: [] }));
    const state = new AppSyncState({ getDb: () => ({ execute }) as never });
    await state.getDurableChangesSinceForUser(5, userEmail, "org-a", {
      version: 5,
      id: "a",
    });
    return execute.mock.calls[0]![0] as unknown as {
      sql: string;
      args: unknown[];
    };
  }

  it("binds the normalized email for the owner match", async () => {
    const query = await captureRead("  Alice@Example.TEST ");
    expect(query.args).toContain("alice@example.test");
    expect(query.args).not.toContain("  Alice@Example.TEST ");
  });

  it("admits public events regardless of owner or org columns", async () => {
    const { sql } = await captureRead("alice@example.test");
    expect(sql).toMatch(/event_json::jsonb ->> 'visibility' = 'public'/);
    expect(sql).not.toMatch(/owner IS NULL AND org_id IS NULL/);
  });
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
      "hidden",
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
});

describe("a cold read past an event this app never registered", () => {
  it("hides it through the batch access check and delivers later events", async () => {
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
    state.recordChange({
      source: "app-state",
      type: "change",
      key: "navigate:tab-1",
      owner: "alice@x.test",
    });

    let result = state.getChangesSinceForUser(0, "alice@x.test", "o");
    await vi.waitFor(() => {
      result = state.getChangesSinceForUser(0, "alice@x.test", "o");
      expect(result.accessPending).toBeUndefined();
    });
    expect(result.events.map((e) => e.key)).toEqual(["navigate:tab-1"]);
    expect(result.unreadable).toBeUndefined();
  });
});

describe("an event whose access check keeps failing", () => {
  it("skips it, reports it, and still delivers the readable events", async () => {
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
        key: "doc-edit",
        owner: "bob@x.test",
        resourceType: "doc",
        resourceId: "d1",
      });
      state.recordChange({
        source: "app-state",
        type: "change",
        key: "navigate:tab-1",
        owner: "alice@x.test",
      });

      let result = state.getChangesSinceForUser(0, "alice@x.test", "o");
      await vi.waitFor(() => {
        result = state.getChangesSinceForUser(0, "alice@x.test", "o");
        expect(result.accessPending).toBeUndefined();
      });
      expect(result.events.map((e) => e.key)).toEqual(["navigate:tab-1"]);
      expect(result.unreadable).toEqual([
        expect.objectContaining({ resourceType: "doc", reason: "access" }),
      ]);
      expect(errors).toHaveBeenCalledWith(
        expect.stringContaining("resource_type=doc"),
        expect.anything(),
      );
    } finally {
      errors.mockRestore();
    }
  });
});
