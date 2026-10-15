import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
  queryFirstPartyAnalytics: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  dataTableWidgetResultSchema: {},
  defineAction: (definition: unknown) => definition,
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));
vi.mock("@agent-native/core/tracking", () => ({ track: mocks.track }));
vi.mock("../server/lib/first-party-analytics.js", () => ({
  queryFirstPartyAnalytics: mocks.queryFirstPartyAnalytics,
}));

const action = (await import("./query-agent-native-analytics")).default;

beforeEach(() => {
  mocks.getRequestOrgId.mockReset();
  mocks.getRequestUserEmail.mockReset();
  mocks.queryFirstPartyAnalytics.mockReset();
  mocks.track.mockReset();
  mocks.getRequestOrgId.mockReturnValue("org_123");
  mocks.getRequestUserEmail.mockReturnValue("alice@example.com");
  mocks.queryFirstPartyAnalytics.mockResolvedValue({
    rows: [{ events: 3 }],
    schema: [{ name: "events", type: "number" }],
  });
});

describe("query-agent-native-analytics", () => {
  it("records successful first-party query lifecycle events", async () => {
    await action.run({
      sql: "SELECT events FROM analytics_event_daily_rollups",
    });

    expect(mocks.track.mock.calls.map(([name]) => name)).toEqual([
      "query_asked",
      "query_executed",
    ]);
    expect(mocks.track).toHaveBeenCalledWith(
      "query_executed",
      expect.objectContaining({
        query_mode: "first_party",
        surface: "agent",
        row_count: 1,
        column_count: 1,
      }),
      undefined,
    );
  });

  it("records a safe failure event and rethrows the original query error", async () => {
    const sql = "SELECT 'sensitive query text' FROM analytics_events";
    const error = new Error("backend details with sensitive query text");
    mocks.queryFirstPartyAnalytics.mockRejectedValueOnce(error);

    await expect(action.run({ sql })).rejects.toBe(error);

    expect(mocks.track).toHaveBeenCalledWith(
      "query_failed",
      {
        app_name: "analytics",
        template_name: "analytics",
        query_mode: "first_party",
        surface: "agent",
        failure_class: "query_error",
      },
      undefined,
    );
    const telemetry = JSON.stringify(mocks.track.mock.calls);
    expect(telemetry).not.toContain(sql);
    expect(telemetry).not.toContain(error.message);
  });

  it("records caller cancellation separately from query failures", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = new DOMException("sensitive abort details", "AbortError");
    mocks.queryFirstPartyAnalytics.mockRejectedValueOnce(error);

    await expect(
      action.run(
        { sql: "SELECT events FROM analytics_events" },
        { caller: "tool", signal: controller.signal },
      ),
    ).rejects.toBe(error);

    expect(mocks.track).toHaveBeenCalledWith(
      "query_cancelled",
      {
        app_name: "analytics",
        template_name: "analytics",
        query_mode: "first_party",
        surface: "agent",
        cancellation_class: "caller_abort",
      },
      { caller: "tool", signal: controller.signal },
    );
    expect(mocks.track.mock.calls.map(([name]) => name)).not.toContain(
      "query_failed",
    );
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain(error.message);
  });

  it("passes the action cancellation signal to the analytics query", async () => {
    const controller = new AbortController();
    const sql = "SELECT events FROM analytics_event_daily_rollups";

    await action.run({ sql }, { caller: "tool", signal: controller.signal });

    expect(mocks.queryFirstPartyAnalytics).toHaveBeenCalledWith(
      sql,
      { userEmail: "alice@example.com", orgId: "org_123" },
      {
        cache: true,
        includeTestIdentities: false,
        signal: controller.signal,
      },
    );
  });

  it("enables the tenant-scoped result cache for agent queries", async () => {
    const sql =
      "SELECT event_date, event_name, SUM(event_count) AS events FROM analytics_event_daily_rollups GROUP BY event_date, event_name";

    await expect(action.run({ sql })).resolves.toEqual({
      rows: [{ events: 3 }],
      schema: [{ name: "events", type: "number" }],
    });
    expect(mocks.queryFirstPartyAnalytics).toHaveBeenCalledWith(
      sql,
      { userEmail: "alice@example.com", orgId: "org_123" },
      { cache: true, includeTestIdentities: false },
    );
  });

  it("returns a native table only when the user asked to see query rows", async () => {
    const sql = "SELECT events FROM analytics_event_daily_rollups";
    await expect(action.run({ sql, showTable: true })).resolves.toEqual({
      widget: "data-table",
      widgetId: "analytics.query.v1",
      title: "Analytics query result",
      table: {
        title: "Analytics query result",
        columns: [{ key: "events", label: "events", align: "right" }],
        rows: [{ events: 3 }],
      },
    });
  });

  it("preserves truncation and omits a complete-looking scalar card", async () => {
    const result = {
      rows: [{ events: 3 }],
      schema: [{ name: "events", type: "number" }],
      truncated: true,
    };
    mocks.queryFirstPartyAnalytics.mockResolvedValueOnce(result);

    await expect(
      action.run({ sql: "SELECT events FROM analytics_events" }),
    ).resolves.toEqual(result);
    expect(action.chatUI.when({}, result)).toBe(false);

    mocks.queryFirstPartyAnalytics.mockResolvedValueOnce(result);
    await expect(
      action.run({
        sql: "SELECT events FROM analytics_events",
        showTable: true,
      }),
    ).resolves.toMatchObject({
      table: { rows: result.rows, truncated: true },
    });
  });

  it("attaches the result renderer only for a single numeric value or a requested table", () => {
    expect(action.outputSchema).toBeDefined();
    expect(action.chatUI).toEqual({
      renderer: "analytics.analysis-result",
      when: expect.any(Function),
    });
    expect(
      action.chatUI.when(
        {},
        { rows: [{ events: 3 }], schema: [{ name: "events", type: "number" }] },
      ),
    ).toBe(true);
    const comparison = {
      rows: [
        {
          metric: "activated users",
          current_value: 482,
          previous_value: 408,
          period: "Last 30 days",
        },
      ],
      schema: [
        { name: "metric", type: "string" },
        { name: "current_value", type: "number" },
        { name: "previous_value", type: "number" },
        { name: "period", type: "string" },
      ],
    };
    expect(action.chatUI.when({}, comparison)).toBe(true);
    expect(
      action.chatUI.when(
        {},
        {
          ...comparison,
          rows: [{ ...comparison.rows[0], period: "" }],
        },
      ),
    ).toBe(false);
    expect(
      action.chatUI.when(
        {},
        {
          rows: [{ events: 3 }, { events: 4 }],
          schema: [{ name: "events", type: "number" }],
        },
      ),
    ).toBe(false);
    expect(
      action.chatUI.when(
        { showTable: true },
        {
          rows: [{ events: 3 }, { events: 4 }],
          schema: [{ name: "events", type: "number" }],
        },
      ),
    ).toBe(true);
  });

  it("teaches the agent to prefer rollups and bound raw reads", () => {
    expect(action.description).toContain("analytics_event_daily_rollups");
    expect(action.description).toContain("analytics_user_days");
    expect(action.description).toMatch(
      /updated transactionally with new ingest/i,
    );
    expect(action.description).toMatch(/explicit BigQuery cutover/i);
    expect(action.description).toMatch(
      /cross-backend joins are not supported/i,
    );
    expect(action.description).toMatch(/bounded recent drill-downs/i);
    expect(action.description).toMatch(/all-time|lifetime/i);
    expect(action.schema.shape.sql.description).toMatch(
      /unbounded raw-event scan/i,
    );
  });
});
