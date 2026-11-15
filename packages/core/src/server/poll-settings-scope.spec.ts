import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

const mockSession = vi.hoisted(() => ({
  value: { email: "alice@example.test", orgId: "org-a" } as {
    email: string;
    orgId?: string;
  } | null,
}));

const pgliteRef = vi.hoisted(() => ({
  value: null as Awaited<ReturnType<typeof createTestPglite>> | null,
}));

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    const db = pgliteRef.value;
    if (!db) throw new Error("Test database is unavailable");
    if (typeof input === "string") {
      await db.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const stmt = await db.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql)) {
      return { rows: await stmt.all(...args), rowsAffected: 0 };
    }
    const result = await stmt.run(...args);
    return { rows: [], rowsAffected: result.changes };
  }),
};

vi.mock("h3", () => ({
  defineEventHandler: (handler: (event: unknown) => unknown) => handler,
  getQuery: (event: { query?: Record<string, unknown> }) => event.query ?? {},
  setResponseStatus: () => {},
  createEventStream: (event: Record<string, unknown>) => ({
    push: (data: unknown) => {
      (event.pushed as unknown[]).push(data);
    },
    onClosed: (callback: () => void) => {
      event.close = callback;
    },
    close: async () => {
      event.close?.();
    },
    send: () => ({ stream: true }),
  }),
}));

vi.mock("../db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/client.js")>();
  return { ...actual, getDbExec: () => rawClient };
});

vi.mock("../db/ddl-guard.js", () => ({
  ensureIndexExists: vi.fn().mockResolvedValue(undefined),
  ensureColumnExists: vi.fn().mockResolvedValue(undefined),
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../db/widen-columns.js", () => ({
  widenIntColumnsToBigInt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./auth.js", () => ({
  getSession: async () => mockSession.value,
}));

beforeEach(async () => {
  process.env.AGENT_NATIVE_SYNC_EVENTS_DISABLE = "1";
  pgliteRef.value = await createTestPglite();
  await pgliteRef.value.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);
  await pgliteRef.value.exec(`
    CREATE TABLE resources (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      owner TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT 'text/markdown',
      size BIGINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL DEFAULT 'user',
      visibility TEXT NOT NULL DEFAULT 'workspace',
      thread_id TEXT,
      run_id TEXT,
      expires_at BIGINT,
      metadata TEXT,
      UNIQUE(path, owner)
    )
  `);
});

afterEach(async () => {
  delete process.env.AGENT_NATIVE_SYNC_EVENTS_DISABLE;
  delete process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS;
  await pgliteRef.value?.close();
  pgliteRef.value = null;
  vi.resetModules();
});

describe("settings change feed scope", () => {
  it("keeps user, org, and personal seed changes within their scope", async () => {
    const { AppSyncState } = await import("./poll.js");
    const { createPollHandler } = await import("./poll.js");
    const { getSettingsEmitter } = await import("../settings/store.js");
    const { putUserSetting } = await import("../settings/user-settings.js");
    const { putOrgSetting } = await import("../settings/org-settings.js");
    const { ensurePersonalDefaults } = await import("../resources/store.js");
    const { createPollEventsHandler } = await import("./poll-events.js");
    const state = new AppSyncState({
      getDb: () => ({ execute: rawClient.execute }) as never,
    });
    state.wireLocalEmitters();
    expect(getSettingsEmitter().listenerCount("settings")).toBeGreaterThan(0);

    await putUserSetting("alice@example.test", "theme", { mode: "dark" });
    await putOrgSetting("org-a", "workspace-name", { name: "A" });
    await putUserSetting("bob@example.test", "theme", { mode: "light" });
    await putOrgSetting("org-b", "workspace-name", { name: "B" });
    await ensurePersonalDefaults("alice@example.test");
    await ensurePersonalDefaults("bob@example.test");

    const poll = createPollHandler(state);
    mockSession.value = { email: "alice@example.test", orgId: "org-a" };
    const alicePoll = (
      await (
        poll as (event: unknown) => Promise<{
          events: unknown[];
        }>
      )({ query: { since: "0" } })
    ).events;
    mockSession.value = { email: "bob@example.test", orgId: "org-b" };
    const bobPoll = (
      await (
        poll as (event: unknown) => Promise<{
          events: unknown[];
        }>
      )({ query: { since: "0" } })
    ).events;
    const eventText = (events: unknown[]) => JSON.stringify(events);
    expect.soft(eventText(alicePoll)).toContain("alice@example.test");
    expect.soft(eventText(alicePoll)).not.toContain("bob@example.test");
    expect.soft(eventText(alicePoll)).toContain("org-a");
    expect.soft(eventText(alicePoll)).not.toContain("org-b");
    expect.soft(eventText(bobPoll)).toContain("bob@example.test");
    expect.soft(eventText(bobPoll)).not.toContain("alice@example.test");
    expect.soft(eventText(bobPoll)).toContain("org-b");
    expect.soft(eventText(bobPoll)).not.toContain("org-a");

    const aliceStreamEvent = {
      pushed: [] as unknown[],
      close: undefined as (() => void) | undefined,
    };
    mockSession.value = { email: "alice@example.test", orgId: "org-a" };
    await (createPollEventsHandler(state) as (event: unknown) => unknown)(
      aliceStreamEvent,
    );
    await putUserSetting("bob@example.test", "live-theme", { mode: "light" });
    await putOrgSetting("org-b", "live-name", { name: "B" });
    await putUserSetting("alice@example.test", "live-theme", { mode: "dark" });
    await putOrgSetting("org-a", "live-name", { name: "A" });
    const aliceStream = eventText(
      aliceStreamEvent.pushed.filter((value) => typeof value === "string"),
    );
    expect.soft(aliceStream).toContain("alice@example.test");
    expect.soft(aliceStream).not.toContain("bob@example.test");
    expect.soft(aliceStream).toContain("org-a");
    expect.soft(aliceStream).not.toContain("org-b");
    aliceStreamEvent.close?.();
  });

  it("drops legacy durable rows without stored scope", async () => {
    delete process.env.AGENT_NATIVE_SYNC_EVENTS_DISABLE;
    process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
    const { AppSyncState } = await import("./poll.js");
    const legacy = {
      id: "legacy-null-scope",
      version: 2,
      event_json: JSON.stringify({
        source: "settings",
        type: "change",
        key: "u:bob@example.test:private",
      }),
      owner: null,
      org_id: null,
      resource_type: null,
      resource_id: null,
    };
    const publicEvent = {
      id: "explicit-public",
      version: 3,
      event_json: JSON.stringify({
        source: "settings",
        type: "change",
        key: "private-key",
        visibility: "public",
      }),
      owner: null,
      org_id: null,
      resource_type: null,
      resource_id: null,
    };
    const execute = vi.fn(async (input: string | { sql: string }) => {
      const sql = typeof input === "string" ? input : input.sql;
      if (sql.includes("SELECT id, version, event_json")) {
        return { rows: [legacy, publicEvent], rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: 0 };
    });
    const state = new AppSyncState({
      getDb: () => ({ execute }) as never,
    });

    const result = await state.getDurableChangesSinceForUser(
      1,
      "alice@example.test",
      undefined,
    );

    expect(result.events).toMatchObject([
      { source: "settings", visibility: "public", key: "*" },
    ]);
    expect(JSON.stringify(result.events)).not.toContain("bob@example.test");
    expect(JSON.stringify(result.events)).not.toContain("private-key");
    expect(
      execute.mock.calls.some(([input]) =>
        (typeof input === "string" ? input : input.sql).includes(
          "event_json::jsonb ->> 'visibility' = 'public'",
        ),
      ),
    ).toBe(true);
  });
});
