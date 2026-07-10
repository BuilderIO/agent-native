import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getQuery: (event: any) => event.query ?? {},
  setResponseStatus: () => {},
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mockExecute }),
  isPostgres: () => false,
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
    process.env.AGENT_NATIVE_SYNC_EVENTS_DISABLE = "1";
    delete process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS;
    mockExecute.mockReset();
  });

  afterEach(() => {
    delete process.env.AGENT_NATIVE_SYNC_EVENTS_DISABLE;
    delete process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS;
    vi.useRealTimers();
  });

  it("returns durable sync events without running the legacy watermark scan", async () => {
    delete process.env.AGENT_NATIVE_SYNC_EVENTS_DISABLE;
    process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
    const durableEvent = {
      version: 2_000,
      source: "action",
      type: "change",
      key: "create-project",
      owner: "test@example.com",
    };

    mockExecute.mockImplementation(async (query: any) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (typeof sql === "string" && sql.includes("sync_events")) {
        if (sql.includes("MAX(version)")) {
          return { rows: [{ max_version: 2_000 }] };
        }
        if (sql.includes("WHERE version > ?")) {
          const since = Number(query.args?.[0]) || 0;
          return {
            rows:
              durableEvent.version > since
                ? [
                    {
                      version: durableEvent.version,
                      event_json: JSON.stringify(durableEvent),
                    },
                  ]
                : [],
          };
        }
        return { rows: [] };
      }
      if (
        sql.includes("MAX(updated_at)") &&
        sql.includes("application_state") &&
        sql.includes("WHERE key = ?")
      ) {
        return { rows: [{ max_ts: 0 }] };
      }
      if (
        sql.includes("MAX(updated_at)") &&
        (sql.includes("application_state") ||
          sql.includes("settings") ||
          sql.includes("tools"))
      ) {
        return { rows: [{ max_ts: 0 }] };
      }
      if (sql.includes("FROM application_state WHERE key = ?")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const { createPollHandler } = await import("./poll.js");
    const handler = createPollHandler() as any;

    const result = await handler({ query: { since: "1000" } });

    expect(result).toEqual({
      version: 2_000,
      events: [expect.objectContaining(durableEvent)],
    });
    expect(executedSql()).toContain("FROM sync_events WHERE version > ?");
    expect(executedSql()).not.toContain(
      "SELECT session_id, key, updated_at FROM application_state WHERE updated_at > ?",
    );
  });

  it("does not advance past an unread durable event page when memory is ahead", async () => {
    delete process.env.AGENT_NATIVE_SYNC_EVENTS_DISABLE;
    process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
    const durableRows = Array.from({ length: 1000 }, (_, index) => {
      const version = 1_001 + index;
      return {
        version,
        event_json: JSON.stringify({
          version,
          source: "action",
          type: "change",
          key: `action-${version}`,
          owner: "test@example.com",
        }),
      };
    });

    mockExecute.mockImplementation(async (query: any) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (typeof sql === "string" && sql.includes("sync_events")) {
        if (sql.includes("MAX(version)")) {
          return { rows: [{ max_version: 10_000 }] };
        }
        if (sql.includes("WHERE version > ?")) {
          return { rows: durableRows };
        }
        return { rows: [] };
      }
      if (
        sql.includes("MAX(updated_at)") &&
        sql.includes("application_state") &&
        sql.includes("WHERE key = ?")
      ) {
        return { rows: [{ max_ts: 0 }] };
      }
      if (
        sql.includes("MAX(updated_at)") &&
        (sql.includes("application_state") ||
          sql.includes("settings") ||
          sql.includes("tools"))
      ) {
        return { rows: [{ max_ts: 0 }] };
      }
      if (sql.includes("FROM application_state WHERE key = ?")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const { createPollHandler } = await import("./poll.js");
    const handler = createPollHandler() as any;

    const result = await handler({ query: { since: "1000" } });

    expect(result.version).toBe(2_000);
    expect(result.events).toHaveLength(1000);
    expect(result.events.at(-1)).toMatchObject({ version: 2_000 });
  });

  it("does not skip same-version durable events at a page boundary", async () => {
    delete process.env.AGENT_NATIVE_SYNC_EVENTS_DISABLE;
    process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
    const durableRows = [
      ...Array.from({ length: 999 }, (_, index) => {
        const version = 1_001 + index;
        return {
          version,
          event_json: JSON.stringify({
            version,
            source: "action",
            type: "change",
            key: `action-${version}`,
            owner: "test@example.com",
          }),
        };
      }),
      {
        version: 2_000,
        event_json: JSON.stringify({
          version: 2_000,
          source: "settings",
          type: "change",
          key: "first-boundary",
          owner: "test@example.com",
        }),
      },
      {
        version: 2_000,
        event_json: JSON.stringify({
          version: 2_000,
          source: "settings",
          type: "change",
          key: "second-boundary",
          owner: "test@example.com",
        }),
      },
    ];

    mockExecute.mockImplementation(async (query: any) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (typeof sql === "string" && sql.includes("sync_events")) {
        if (sql.includes("MAX(version)")) {
          return { rows: [{ max_version: 10_000 }] };
        }
        if (sql.includes("WHERE version > ?")) {
          return { rows: durableRows };
        }
        return { rows: [] };
      }
      if (
        sql.includes("MAX(updated_at)") &&
        sql.includes("application_state") &&
        sql.includes("WHERE key = ?")
      ) {
        return { rows: [{ max_ts: 0 }] };
      }
      if (
        sql.includes("MAX(updated_at)") &&
        (sql.includes("application_state") ||
          sql.includes("settings") ||
          sql.includes("tools"))
      ) {
        return { rows: [{ max_ts: 0 }] };
      }
      if (sql.includes("FROM application_state WHERE key = ?")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const { createPollHandler } = await import("./poll.js");
    const handler = createPollHandler() as any;

    const result = await handler({ query: { since: "1000" } });

    expect(result.version).toBe(1_999);
    expect(result.events).toHaveLength(999);
    expect(result.events.at(-1)).toMatchObject({ version: 1_999 });
    expect(result.events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "first-boundary" }),
      ]),
    );
  });

  it("does not advance past a durable event waiting on access resolution", async () => {
    delete process.env.AGENT_NATIVE_SYNC_EVENTS_DISABLE;
    process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
    const pendingEvent = {
      version: 2_000,
      source: "collab",
      type: "change",
      resourceType: "document",
      resourceId: "doc-1",
      owner: "someone@example.com",
    };

    mockExecute.mockImplementation(async (query: any) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (typeof sql === "string" && sql.includes("sync_events")) {
        if (sql.includes("MAX(version)")) {
          return { rows: [{ max_version: 10_000 }] };
        }
        if (sql.includes("WHERE version > ?")) {
          return {
            rows: [
              { version: 2_000, event_json: JSON.stringify(pendingEvent) },
              {
                version: 3_000,
                event_json: JSON.stringify({
                  version: 3_000,
                  source: "action",
                  type: "change",
                  owner: "test@example.com",
                }),
              },
            ],
          };
        }
        return { rows: [] };
      }
      if (
        sql.includes("MAX(updated_at)") &&
        sql.includes("application_state") &&
        sql.includes("WHERE key = ?")
      ) {
        return { rows: [{ max_ts: 0 }] };
      }
      if (
        sql.includes("MAX(updated_at)") &&
        (sql.includes("application_state") ||
          sql.includes("settings") ||
          sql.includes("tools"))
      ) {
        return { rows: [{ max_ts: 0 }] };
      }
      if (sql.includes("FROM application_state WHERE key = ?")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const { createPollHandler } = await import("./poll.js");
    const handler = createPollHandler() as any;

    const result = await handler({ query: { since: "1000" } });

    expect(result).toEqual({ version: 1_999, events: [] });
  });

  it("preserves distinct durable events that share the same version", async () => {
    delete process.env.AGENT_NATIVE_SYNC_EVENTS_DISABLE;
    process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
    const firstEvent = {
      version: 2_000,
      source: "settings",
      type: "change",
      key: "theme",
    };
    const secondEvent = {
      version: 2_000,
      source: "action",
      type: "change",
      key: "update-dashboard",
      owner: "test@example.com",
    };

    mockExecute.mockImplementation(async (query: any) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (typeof sql === "string" && sql.includes("sync_events")) {
        if (sql.includes("MAX(version)")) {
          return { rows: [{ max_version: 2_000 }] };
        }
        if (sql.includes("WHERE version > ?")) {
          return {
            rows: [
              { version: 2_000, event_json: JSON.stringify(firstEvent) },
              { version: 2_000, event_json: JSON.stringify(secondEvent) },
            ],
          };
        }
        return { rows: [] };
      }
      if (
        sql.includes("MAX(updated_at)") &&
        sql.includes("application_state") &&
        sql.includes("WHERE key = ?")
      ) {
        return { rows: [{ max_ts: 0 }] };
      }
      if (
        sql.includes("MAX(updated_at)") &&
        (sql.includes("application_state") ||
          sql.includes("settings") ||
          sql.includes("tools"))
      ) {
        return { rows: [{ max_ts: 0 }] };
      }
      if (sql.includes("FROM application_state WHERE key = ?")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const { createPollHandler } = await import("./poll.js");
    const handler = createPollHandler() as any;

    const result = await handler({ query: { since: "1000" } });

    expect(result.version).toBe(2_000);
    expect(result.events).toEqual([
      expect.objectContaining(firstEvent),
      expect.objectContaining(secondEvent),
    ]);
  });

  it("emits screen-refresh events when the refresh marker changes", async () => {
    let appStateTs = 1_000;
    let settingsTs = 900;
    let extensionsTs = 800;
    let extensionMarkerTs = 0;
    let actionMarkerTs = 0;
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
        const key = query.args?.[0];
        return {
          rows: [
            {
              max_ts:
                key === "__action_change__"
                  ? actionMarkerTs
                  : extensionMarkerTs,
            },
          ],
        };
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
        if (query.args?.[0] === "__action_change__") {
          return { rows: [] };
        }
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
        return {
          rows: [
            {
              session_id: "test@example.com",
              updated_at: refreshTs,
              value: refreshValue,
            },
          ],
        };
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
    actionMarkerTs = 0;
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
          owner: "test@example.com",
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
    let actionMarkerTs = 0;
    let extensionRows: Array<Record<string, unknown>> = [];

    mockExecute.mockImplementation(async (query: any) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (
        sql.includes("MAX(updated_at)") &&
        sql.includes("application_state") &&
        sql.includes("WHERE key = ?")
      ) {
        const key = query.args?.[0];
        return {
          rows: [
            {
              max_ts:
                key === "__action_change__"
                  ? actionMarkerTs
                  : extensionMarkerTs,
            },
          ],
        };
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

  it("emits action changes from durable markers for child-process actions", async () => {
    let appStateTs = 1_000;
    let settingsTs = 900;
    let extensionsTs = 800;
    let extensionMarkerTs = 0;
    let actionMarkerTs = 700;
    let actionMarkerRows: Array<Record<string, unknown>> = [];

    mockExecute.mockImplementation(async (query: any) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (
        sql.includes("MAX(updated_at)") &&
        sql.includes("application_state") &&
        sql.includes("WHERE key = ?")
      ) {
        const key = query.args?.[0];
        return {
          rows: [
            {
              max_ts:
                key === "__action_change__"
                  ? actionMarkerTs
                  : extensionMarkerTs,
            },
          ],
        };
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
        if (query.args?.[0] === "__action_change__") {
          return { rows: actionMarkerRows };
        }
        return { rows: [] };
      }
      if (
        sql.includes("SELECT session_id, key, updated_at") &&
        sql.includes("application_state")
      ) {
        const since = Number(query.args?.[0]) || 0;
        return {
          rows: actionMarkerRows
            .filter((row) => Number(row.updated_at) > since)
            .map((row) => ({
              session_id: row.session_id,
              key: "__action_change__",
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
    actionMarkerTs = 2_000;
    actionMarkerRows = [
      {
        session_id: "test@example.com",
        value: JSON.stringify({
          source: "action",
          actionName: "create-project",
          owner: "test@example.com",
        }),
        updated_at: 2_000,
      },
    ];

    const next = await handler({ query: { since: String(baseline.version) } });

    expect(next.events).toEqual([
      expect.objectContaining({
        source: "action",
        type: "change",
        key: "create-project",
        owner: "test@example.com",
      }),
    ]);
    expect(next.events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "app-state",
          key: "__action_change__",
        }),
      ]),
    );
  });

  it("emits existing action markers on cold start instead of baselining past them", async () => {
    const appStateTs = 1_000;
    const settingsTs = 900;
    const extensionsTs = 800;
    const extensionMarkerTs = 0;
    const actionMarkerTs = 1_000;
    const actionMarkerRows: Array<Record<string, unknown>> = [
      {
        session_id: "test@example.com",
        value: JSON.stringify({
          source: "action",
          actionName: "create-project",
          owner: "test@example.com",
        }),
        updated_at: 1_000,
      },
    ];

    mockExecute.mockImplementation(async (query: any) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (
        sql.includes("MAX(updated_at)") &&
        sql.includes("application_state") &&
        sql.includes("WHERE key = ?")
      ) {
        const key = query.args?.[0];
        return {
          rows: [
            {
              max_ts:
                key === "__action_change__"
                  ? actionMarkerTs
                  : extensionMarkerTs,
            },
          ],
        };
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
        if (query.args?.[0] === "__action_change__") {
          return { rows: actionMarkerRows };
        }
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
        return { rows: [] };
      }
      return { rows: [] };
    });

    const { createPollHandler } = await import("./poll.js");
    const handler = createPollHandler() as any;

    const baseline = await handler({ query: { since: "0" } });

    expect(baseline.events).toEqual([
      expect.objectContaining({
        source: "action",
        type: "change",
        key: "create-project",
        owner: "test@example.com",
      }),
    ]);
    expect(baseline.events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "app-state",
          key: "__action_change__",
        }),
      ]),
    );
  });

  it("emits extension changes from durable markers for delete and hide fallback", async () => {
    let appStateTs = 1_000;
    let settingsTs = 900;
    let extensionsTs = 800;
    let extensionMarkerTs = 700;
    let actionMarkerTs = 0;
    let extensionMarkerRows: Array<Record<string, unknown>> = [];
    let actionMarkerRows: Array<Record<string, unknown>> = [];

    mockExecute.mockImplementation(async (query: any) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (
        sql.includes("MAX(updated_at)") &&
        sql.includes("application_state") &&
        sql.includes("WHERE key = ?")
      ) {
        const key = query.args?.[0];
        return {
          rows: [
            {
              max_ts:
                key === "__action_change__"
                  ? actionMarkerTs
                  : extensionMarkerTs,
            },
          ],
        };
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
        if (query.args?.[0] === "__action_change__") {
          return { rows: actionMarkerRows };
        }
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
    actionMarkerTs = 0;
    actionMarkerRows = [];
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
