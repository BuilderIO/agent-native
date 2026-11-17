import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    expect(resolveAccess).toHaveBeenCalledTimes(2);

    resolvers[0]!({ role: "viewer" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    state.getChangeVisibilityForUser(event, "a@x.test", "o");
    expect(resolveAccess).toHaveBeenCalledTimes(2);
  });
});
