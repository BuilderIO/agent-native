import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppSyncState, type ChangeEvent } from "./poll.js";

/** Minimal DbExec-shaped mock that records the ids inserted into sync_events. */
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
      isPostgres: () => false,
    });
    const b = new AppSyncState({
      getDb: () => makeDb(),
      isPostgres: () => false,
    });

    a.recordChange({ source: "action", type: "change", key: "a1" });
    a.recordChange({ source: "action", type: "change", key: "a2" });

    expect(a.getChangesSince(0).events.map((e) => e.key)).toEqual(["a1", "a2"]);
    // App B shares no buffer and no version space with A.
    expect(b.getChangesSince(0).events).toEqual([]);
    expect(b.getVersion()).toBe(0);
    expect(a.getVersion()).toBeGreaterThan(0);
  });

  it("filters durable-independent per-user delivery per instance", () => {
    const a = new AppSyncState({
      getDb: () => makeDb(),
      isPostgres: () => false,
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
      isPostgres: () => false,
      deterministicEventIds: true,
    });
    const b = new AppSyncState({
      getDb: () => makeDb(idsB),
      isPostgres: () => false,
      deterministicEventIds: true,
    });

    // Same logical event + dedupe signal, but different per-instance versions.
    await a.persistSyncEvent(baseEvent({ version: 111 }), "app-state|500");
    await b.persistSyncEvent(baseEvent({ version: 999 }), "app-state|500");

    expect(idsA[0]).toBeTruthy();
    expect(idsA[0]).toBe(idsB[0]); // version excluded → collides → ON CONFLICT dedupes
  });

  it("keeps random ids when deterministic mode is off (default)", async () => {
    process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
    const ids: string[] = [];
    const s = new AppSyncState({
      getDb: () => makeDb(ids),
      isPostgres: () => false,
    });

    await s.persistSyncEvent(baseEvent({ version: 1 }), "app-state|500");
    await s.persistSyncEvent(baseEvent({ version: 2 }), "app-state|500");

    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("does not reuse an org-A access decision under an org-B session", async () => {
    const flush = async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    };
    // Resource is allowed only in org-a.
    const resolveAccess = vi.fn(
      async (_rt: string, _rid: string, ctx: { orgId: string | undefined }) =>
        ctx.orgId === "org-a" ? { ok: true } : null,
    );
    const s = new AppSyncState({
      getDb: () => makeDb(),
      isPostgres: () => false,
      resolveAccess,
    });
    // Owned by someone else + resource-scoped → forces the access-aware branch.
    const event = {
      owner: "other@x",
      resourceType: "doc",
      resourceId: "d1",
    };

    // org-a: first call misses (fail-closed), then the cached allow lands.
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
});
