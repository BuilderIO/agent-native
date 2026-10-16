import { beforeEach, describe, expect, it, vi } from "vitest";

import { FirstPartyAnalyticsValidationError } from "../server/lib/first-party-analytics-errors.js";

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

  it("records a bounded error class and hides backend details", async () => {
    const sql = "SELECT 'sensitive query text' FROM analytics_events";
    const error = new Error("backend details with sensitive query text");
    mocks.queryFirstPartyAnalytics.mockRejectedValueOnce(error);

    const thrown = await action.run({ sql }).catch((caught: Error) => caught);

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toContain("[query_error; recovery=stop]");
    expect(thrown.message).not.toContain(error.message);
    expect(thrown.message).not.toContain(sql);

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

  it("gives one corrective path for unsupported SQL without echoing the query", async () => {
    const sql =
      "SELECT COUNT(*) FILTER (WHERE secret_column = 'private') FROM analytics_events";
    const error = Object.assign(new Error(`provider echoed ${sql}`), {
      name: "FirstPartyAnalyticsUnsupportedSqlError",
      construct: "FILTER (WHERE ...)",
    });
    mocks.queryFirstPartyAnalytics.mockRejectedValueOnce(error);

    const thrown = await action.run({ sql }).catch((caught: Error) => caught);

    expect(thrown.message).toContain(
      "[unsupported_sql; recovery=rewrite_once]",
    );
    expect(thrown.message).toContain("SUM(CASE WHEN condition THEN value");
    expect(thrown.message).toContain("Do not repeat unchanged SQL");
    expect(thrown.message).not.toContain(sql);
    expect(thrown.message).not.toContain(error.message);
    expect(mocks.track).toHaveBeenCalledWith(
      "query_failed",
      expect.objectContaining({
        failure_class: "unsupported_sql",
        sql_construct: "filter",
      }),
      undefined,
    );
  });

  it("explains how to recover from the rejected DIV function without changing the metric scope", async () => {
    const sql =
      "SELECT DIV(active_users, total_users) FROM analytics_user_days";
    const error = new FirstPartyAnalyticsValidationError(
      "unsupported_function",
      "First-party analytics queries cannot call unapproved SQL function div",
    );
    mocks.queryFirstPartyAnalytics.mockRejectedValueOnce(error);

    const thrown = await action.run({ sql }).catch((caught: Error) => caught);

    expect(thrown.message).toContain(
      "For a ratio, use numerator / NULLIF(denominator, 0)",
    );
    expect(thrown.message).toContain("clarify the requested rounding");
    expect(thrown.message).toContain("same source, filters, and grain");
    expect(thrown.message).toContain("do not repeat DIV()");
    expect(thrown.message).not.toContain(sql);
    expect(thrown.message).not.toContain(error.message);
    expect(mocks.track).toHaveBeenCalledWith(
      "query_failed",
      expect.objectContaining({ failure_class: "unsupported_sql" }),
      undefined,
    );
  });

  it.each([
    [
      "invalid_shape",
      "[invalid_shape; recovery=rewrite_once]",
      "one read-only SELECT or WITH query",
    ],
    [
      "disallowed_source",
      "[disallowed_source; recovery=check_schema]",
      "search-bigquery-schema",
    ],
    [
      "unsupported_function",
      "[unsupported_sql; recovery=rewrite_once]",
      "function it does not support",
    ],
    [
      "cross_backend_join",
      "[cross_backend_join; recovery=stop]",
      "Query each source separately",
    ],
  ] as const)(
    "maps source validation code %s to safe recovery without echoing SQL",
    async (code, expectedClass, guidance) => {
      const sql = "SELECT private_column FROM private_table";
      const error = new FirstPartyAnalyticsValidationError(
        code,
        `private validator detail: ${sql}`,
      );
      mocks.queryFirstPartyAnalytics.mockRejectedValueOnce(error);

      const thrown = await action.run({ sql }).catch((caught: Error) => caught);

      expect(thrown.message).toContain(expectedClass);
      expect(thrown.message).toContain(guidance);
      expect(thrown.message).not.toContain(sql);
      expect(thrown.message).not.toContain(error.message);
      expect(mocks.track).toHaveBeenCalledWith(
        "query_failed",
        expect.objectContaining({ failure_class: expect.any(String) }),
        undefined,
      );
      expect(JSON.stringify(mocks.track.mock.calls)).not.toContain(sql);
    },
  );

  it.each([
    ["invalid_query", "invalid_query", "make one corrected attempt"],
    ["not_found", "missing_source", "verify the exact table and column names"],
    ["access_denied", "permission_denied", "Do not retry this query"],
    ["quota_exceeded", "quota_exceeded", "Narrow the date range"],
    ["rate_limited", "rate_limited", "Retry this query once unchanged"],
    ["backend_error", "backend_error", "temporary backend failure"],
  ])(
    "maps warehouse reason %s to bounded recovery guidance",
    async (backendReason, expectedClass, guidance) => {
      const error = Object.assign(new Error("private provider detail"), {
        name: "BigQueryBackendError",
        backendReason,
      });
      mocks.queryFirstPartyAnalytics.mockRejectedValueOnce(error);

      const thrown = await action
        .run({ sql: "SELECT event_count FROM analytics_event_daily_rollups" })
        .catch((caught: Error) => caught);

      expect(thrown.message).toContain(`[${expectedClass}; recovery=`);
      expect(thrown.message).toContain(guidance);
      expect(thrown.message).not.toContain(error.message);
    },
  );

  it("allows one retry for a typed query timeout", async () => {
    const error = Object.assign(new Error("private timeout detail"), {
      name: "BigQueryQueryTimeoutError",
    });
    mocks.queryFirstPartyAnalytics.mockRejectedValueOnce(error);

    const thrown = await action
      .run({ sql: "SELECT event_count FROM analytics_event_daily_rollups" })
      .catch((caught: Error) => caught);

    expect(thrown.message).toContain("[timeout; recovery=retry_once]");
    expect(thrown.message).not.toContain(error.message);
    expect(mocks.track).toHaveBeenCalledWith(
      "query_failed",
      expect.objectContaining({ failure_class: "timeout" }),
      undefined,
    );
  });

  it("records caller cancellation separately from query failures", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = new DOMException("sensitive abort details", "AbortError");
    mocks.queryFirstPartyAnalytics.mockRejectedValueOnce(error);

    const thrown = await action
      .run(
        { sql: "SELECT events FROM analytics_events" },
        { caller: "tool", signal: controller.signal },
      )
      .catch((caught: Error) => caught);

    expect(thrown.name).toBe("AbortError");
    expect(thrown.message).not.toContain(error.message);

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
    expect(action.description).toMatch(/do not call DIV\(\)/i);
    expect(action.description).toContain("/ NULLIF(denominator, 0)");
    expect(action.description).toContain("properties::jsonb ->> 'key'");
    expect(action.description).toContain("LATERAL/unnest/generate_series");
    expect(action.description).toContain("Use `||` explicitly between strings");
    expect(action.schema.shape.sql.description).toMatch(
      /unbounded raw-event scan/i,
    );
  });
});
