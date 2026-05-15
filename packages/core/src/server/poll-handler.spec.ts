import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getQuery: (event: any) => event.query ?? {},
  setResponseStatus: () => {},
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mockExecute }),
}));

// Stub auth so the handler doesn't try to read a real session cookie.
vi.mock("./auth.js", () => ({
  getSession: async () => ({ email: "test@example.com" }),
}));

describe("poll handler", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    mockExecute.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits screen-refresh events when the refresh marker changes", async () => {
    let appStateTs = 1_000;
    let settingsTs = 900;
    let extensionsTs = 800;
    let extensionMarkerTs = 0;
    let refreshTs = 500;
    let refreshValue = JSON.stringify({ scope: "initial" });
    let appStateRows = [
      {
        session_id: "test@example.com",
        key: "__screen_refresh__",
        updated_at: appStateTs,
      },
    ];

    mockExecute.mockImplementation(async (query: any) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (
        sql.includes("MAX(updated_at)") &&
        sql.includes("application_state") &&
        sql.includes("WHERE key = ?")
      ) {
        return { rows: [{ max_ts: extensionMarkerTs }] };
      }
      if (
        sql.includes("MAX(updated_at)") &&
        sql.includes("application_state")
      ) {
        return { rows: [{ max_ts: appStateTs }] };
      }
      if (sql.includes("MAX(updated_at)") && sql.includes("settings")) {
        return { rows: [{ max_ts: settingsTs }] };
      }
      if (sql.includes("MAX(updated_at)") && sql.includes("tools")) {
        return { rows: [{ max_ts: extensionsTs }] };
      }
      if (
        sql.includes("FROM application_state") &&
        sql.includes("key = ?") &&
        sql.includes("SELECT session_id, value, updated_at")
      ) {
        return { rows: [] };
      }
      if (
        sql.includes("SELECT session_id, key, updated_at") &&
        sql.includes("application_state")
      ) {
        const since = Number(query.args?.[0]) || 0;
        return {
          rows: appStateRows.filter((row) => row.updated_at > since),
        };
      }
      if (sql.includes("WHERE key = ?")) {
        return { rows: [{ updated_at: refreshTs, value: refreshValue }] };
      }
      if (
        sql.includes("SELECT id, owner_email") &&
        sql.includes("FROM tools")
      ) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const { createPollHandler } = await import("./poll.js");
    const handler = createPollHandler() as any;

    const baseline = await handler({ query: { since: "0" } });
    expect(baseline).toEqual({ version: 1_000, events: [] });

    vi.setSystemTime(101_500);
    appStateTs = 2_000;
    settingsTs = 900;
    extensionsTs = 800;
    extensionMarkerTs = 0;
    refreshTs = 2_000;
    refreshValue = JSON.stringify({ scope: "documents" });
    appStateRows = [
      {
        session_id: "test@example.com",
        key: "__screen_refresh__",
        updated_at: appStateTs,
      },
    ];

    const next = await handler({ query: { since: String(baseline.version) } });

    expect(next.version).toBeGreaterThan(baseline.version);
    expect(next.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "app-state",
          type: "change",
          key: "__screen_refresh__",
          owner: "test@example.com",
        }),
        expect.objectContaining({
          source: "screen-refresh",
          type: "change",
          key: "__screen_refresh__",
          scope: "documents",
        }),
      ]),
    );
  });

  it("emits scoped extension changes from the tools table fallback", async () => {
    let appStateTs = 1_000;
    let settingsTs = 900;
    let extensionsTs = "2026-05-15T12:00:00.000Z";
    let extensionMarkerTs = 700;
    let extensionRows: Array<Record<string, unknown>> = [];

    mockExecute.mockImplementation(async (query: any) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (
        sql.includes("MAX(updated_at)") &&
        sql.includes("application_state") &&
        sql.includes("WHERE key = ?")
      ) {
        return { rows: [{ max_ts: extensionMarkerTs }] };
      }
      if (
        sql.includes("MAX(updated_at)") &&
        sql.includes("application_state")
      ) {
        return { rows: [{ max_ts: appStateTs }] };
      }
      if (sql.includes("MAX(updated_at)") && sql.includes("settings")) {
        return { rows: [{ max_ts: settingsTs }] };
      }
      if (sql.includes("MAX(updated_at)") && sql.includes("tools")) {
        return { rows: [{ max_ts: extensionsTs }] };
      }
      if (
        sql.includes("FROM application_state") &&
        sql.includes("key = ?") &&
        sql.includes("SELECT session_id, value, updated_at")
      ) {
        return { rows: [] };
      }
      if (
        sql.includes("SELECT session_id, key, updated_at") &&
        sql.includes("application_state")
      ) {
        return { rows: [] };
      }
      if (sql.includes("WHERE key = ?")) {
        return { rows: [] };
      }
      if (
        sql.includes("SELECT id, owner_email") &&
        sql.includes("FROM tools")
      ) {
        return { rows: extensionRows };
      }
      if (sql.includes("FROM tool_shares")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const { createPollHandler } = await import("./poll.js");
    const handler = createPollHandler() as any;

    const baseline = await handler({ query: { since: "0" } });
    expect(baseline.events).toEqual([]);

    vi.setSystemTime(101_500);
    extensionsTs = "2026-05-15T12:00:01.250Z";
    extensionRows = [
      {
        id: "ext-1",
        owner_email: "test@example.com",
        org_id: "org-1",
        visibility: "private",
        updated_at: extensionsTs,
      },
    ];

    const next = await handler({ query: { since: String(baseline.version) } });

    expect(next.version).toBeGreaterThan(baseline.version);
    expect(next.events).toEqual([
      expect.objectContaining({
        source: "extensions",
        type: "change",
        key: "*",
        owner: "test@example.com",
      }),
    ]);
    const toolRowQueries = mockExecute.mock.calls
      .map(([query]) => query)
      .filter((query: any) => {
        const sql = typeof query === "string" ? query : query?.sql;
        return (
          typeof sql === "string" &&
          sql.includes("SELECT id, owner_email") &&
          sql.includes("FROM tools")
        );
      });
    const latestToolRowQuery = toolRowQueries[toolRowQueries.length - 1] as {
      sql: string;
      args?: unknown[];
    };
    expect(latestToolRowQuery.sql).toContain("FROM tools WHERE updated_at > ?");
    expect(latestToolRowQuery.args).toEqual(["2026-05-15T12:00:00.000Z"]);
    expect(executedSql()).not.toContain(
      "SELECT id, owner_email, org_id, visibility, updated_at FROM tools ORDER BY updated_at ASC",
    );
  });

  it("emits extension changes from durable markers for delete and hide fallback", async () => {
    let appStateTs = 1_000;
    let settingsTs = 900;
    let extensionsTs = 800;
    let extensionMarkerTs = 700;
    let extensionMarkerRows: Array<Record<string, unknown>> = [];

    mockExecute.mockImplementation(async (query: any) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (
        sql.includes("MAX(updated_at)") &&
        sql.includes("application_state") &&
        sql.includes("WHERE key = ?")
      ) {
        return { rows: [{ max_ts: extensionMarkerTs }] };
      }
      if (
        sql.includes("MAX(updated_at)") &&
        sql.includes("application_state")
      ) {
        return { rows: [{ max_ts: appStateTs }] };
      }
      if (sql.includes("MAX(updated_at)") && sql.includes("settings")) {
        return { rows: [{ max_ts: settingsTs }] };
      }
      if (sql.includes("MAX(updated_at)") && sql.includes("tools")) {
        return { rows: [{ max_ts: extensionsTs }] };
      }
      if (
        sql.includes("FROM application_state") &&
        sql.includes("key = ?") &&
        sql.includes("SELECT session_id, value, updated_at")
      ) {
        return { rows: extensionMarkerRows };
      }
      if (
        sql.includes("SELECT session_id, key, updated_at") &&
        sql.includes("application_state")
      ) {
        const since = Number(query.args?.[0]) || 0;
        return {
          rows: extensionMarkerRows
            .filter((row) => Number(row.updated_at) > since)
            .map((row) => ({
              session_id: row.session_id,
              key: "__extensions_change__",
              updated_at: row.updated_at,
            })),
        };
      }
      if (sql.includes("WHERE key = ?")) {
        return { rows: [] };
      }
      if (
        sql.includes("SELECT id, owner_email") &&
        sql.includes("FROM tools")
      ) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const { createPollHandler } = await import("./poll.js");
    const handler = createPollHandler() as any;

    const baseline = await handler({ query: { since: "0" } });
    expect(baseline.events).toEqual([]);

    vi.setSystemTime(101_500);
    appStateTs = 2_000;
    extensionMarkerTs = 2_000;
    extensionMarkerRows = [
      {
        session_id: "test@example.com",
        value: JSON.stringify({
          source: "extensions",
          owner: "test@example.com",
        }),
        updated_at: 2_000,
      },
    ];

    const next = await handler({ query: { since: String(baseline.version) } });

    expect(next.events).toEqual([
      expect.objectContaining({
        source: "extensions",
        type: "change",
        key: "*",
        owner: "test@example.com",
      }),
    ]);
    expect(executedSql()).not.toContain(
      "application_state WHERE key = ? AND updated_at > ?",
    );
  });
});

function executedSql(): string {
  return mockExecute.mock.calls
    .map(([query]) => (typeof query === "string" ? query : (query?.sql ?? "")))
    .join("\n");
}
