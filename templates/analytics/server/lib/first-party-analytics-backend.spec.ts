import { lexAgentSql, readAgentSqlQuery } from "@agent-native/core/agent-sql";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getScopedSettingRecord = vi.hoisted(() => vi.fn());
const getOrgSetting = vi.hoisted(() => vi.fn());
const putScopedSettingRecord = vi.hoisted(() => vi.fn());
const getBigQueryProjectId = vi.hoisted(() => vi.fn());
const runQuery = vi.hoisted(() => vi.fn());
const getAccessToken = vi.hoisted(() => vi.fn());
const fetchGoogleWithRetry = vi.hoisted(() => vi.fn());
const execute = vi.hoisted(() => vi.fn());

vi.mock("./scoped-settings.js", () => ({
  getScopedSettingRecord,
  putScopedSettingRecord,
}));
vi.mock("@agent-native/core/settings", () => ({ getOrgSetting }));
vi.mock("./bigquery.js", () => ({
  getBigQueryProjectId,
  runQuery,
}));
vi.mock("./gcloud.js", () => ({ fetchGoogleWithRetry, getAccessToken }));
vi.mock("@agent-native/core/db", () => ({ getDbExec: () => ({ execute }) }));
vi.mock("./credentials-context.js", () => ({
  requireRequestCredentialContext: vi.fn(),
}));

import {
  backfillFirstPartyAnalyticsBatch,
  createFirstPartyAnalyticsInserter,
  FIRST_PARTY_ANALYTICS_BACKEND_SETTING,
  FirstPartyAnalyticsUnsupportedSqlError,
  getFirstPartyAnalyticsBackend,
  getFirstPartyAnalyticsBigQueryMetrics,
  getFirstPartyAnalyticsTable,
  insertFirstPartyAnalyticsRows,
  insertFirstPartyAnalyticsRowsWithResults,
  renderFirstPartyAnalyticsBigQuerySql,
  resetFirstPartyAnalyticsBackendCacheForTests,
  saveFirstPartyAnalyticsBackend,
} from "./first-party-analytics-backend.js";

beforeEach(() => {
  getScopedSettingRecord.mockReset();
  getOrgSetting.mockReset();
  putScopedSettingRecord.mockReset();
  getBigQueryProjectId.mockReset();
  runQuery.mockReset();
  getAccessToken.mockReset();
  fetchGoogleWithRetry.mockReset();
  execute.mockReset();
  resetFirstPartyAnalyticsBackendCacheForTests();
  getScopedSettingRecord.mockResolvedValue({
    sink: "dual",
    table: "builder-3b0a2.analytics.first_party_analytics_events_raw",
  });
  getOrgSetting.mockResolvedValue({
    sink: "dual",
    table: "builder-3b0a2.analytics.first_party_analytics_events_raw",
  });
  putScopedSettingRecord.mockResolvedValue(undefined);
  getBigQueryProjectId.mockResolvedValue("builder-3b0a2");
  getAccessToken.mockResolvedValue("test-token");
  fetchGoogleWithRetry.mockImplementation((url, init) => fetch(url, init));
});

describe("first-party BigQuery backend", () => {
  it("caches the org sink setting briefly instead of reading settings per event", async () => {
    const scope = { userEmail: "owner@example.com", orgId: "org_builder" };

    await expect(getFirstPartyAnalyticsBackend(scope)).resolves.toMatchObject({
      sink: "dual",
      table: "builder-3b0a2.analytics.first_party_analytics_events_raw",
    });
    await getFirstPartyAnalyticsBackend(scope);

    expect(getScopedSettingRecord).toHaveBeenCalledTimes(1);
  });

  it("uses only the org sink setting for org-scoped previews", async () => {
    getOrgSetting.mockResolvedValue(null);

    await expect(
      getFirstPartyAnalyticsBackend({
        userEmail: "admin@example.com",
        orgId: "customer-org",
        credentialScope: "org",
      }),
    ).resolves.toEqual({
      sink: "postgres",
      table: null,
      backfillCursor: null,
      backfillCompleted: false,
    });

    expect(getOrgSetting).toHaveBeenCalledWith(
      "customer-org",
      FIRST_PARTY_ANALYTICS_BACKEND_SETTING,
    );
    expect(getScopedSettingRecord).not.toHaveBeenCalled();
  });

  it("does not reuse a personal fallback backend cached for the same org", async () => {
    getScopedSettingRecord.mockResolvedValue({
      sink: "bigquery",
      table: "personal-project.analytics.personal_events",
    });
    getOrgSetting.mockResolvedValue(null);

    await expect(
      getFirstPartyAnalyticsBackend({
        userEmail: "admin@example.com",
        orgId: "customer-org",
      }),
    ).resolves.toMatchObject({ sink: "bigquery" });
    await expect(
      getFirstPartyAnalyticsBackend({
        userEmail: "admin@example.com",
        orgId: "customer-org",
        credentialScope: "org",
      }),
    ).resolves.toMatchObject({ sink: "postgres", table: null });

    expect(getOrgSetting).toHaveBeenCalledTimes(1);
  });

  it("qualifies logical sources and quotes scope values for BigQuery", () => {
    const sql = renderFirstPartyAnalyticsBigQuerySql(
      "SELECT * FROM (SELECT * FROM analytics_events WHERE owner_email = ? AND event_date <= ?) AS analytics_events",
      ["owner'o@example.com", "2026-08-05"],
      {
        projectId: "builder-3b0a2",
        datasetId: "analytics",
        tableId: "first_party_analytics_events_raw",
        fullyQualified:
          "builder-3b0a2.analytics.first_party_analytics_events_raw",
      },
    );

    expect(sql).toContain(
      "FROM `builder-3b0a2.analytics.first_party_analytics_events_raw`",
    );
    expect(sql).toContain(
      "QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY received_at DESC) = 1",
    );
    expect(sql).toContain("'owner\\'o@example.com'");
    expect(sql).toContain("'2026-08-05'");
  });

  it("does not bind markers inside SQL string literals", () => {
    const sql = renderFirstPartyAnalyticsBigQuerySql(
      "SELECT '$1' AS marker FROM analytics_events WHERE owner_email = $1",
      ["owner@example.com"],
      {
        projectId: "builder-3b0a2",
        datasetId: "analytics",
        tableId: "first_party_analytics_events_raw",
        fullyQualified:
          "builder-3b0a2.analytics.first_party_analytics_events_raw",
      },
    );

    expect(sql).toContain("SELECT '$1' AS marker");
    expect(sql).toContain("owner_email = 'owner@example.com'");
  });

  it("keeps regular PostgreSQL backslashes from hiding later binds", () => {
    const sql = renderFirstPartyAnalyticsBigQuerySql(
      "SELECT 'ends with \\' AS marker FROM analytics_events WHERE owner_email = $1",
      ["owner@example.com"],
      {
        projectId: "builder-3b0a2",
        datasetId: "analytics",
        tableId: "first_party_analytics_events_raw",
        fullyQualified:
          "builder-3b0a2.analytics.first_party_analytics_events_raw",
      },
    );

    expect(sql).toContain("owner_email = 'owner@example.com'");
    expect(sql).toContain("SELECT 'ends with \\\\' AS marker");
  });

  it.each([
    "-- ignored $2 ?\r",
    "/* outer /* inner $2 ? */ still ignored $2 ? */",
  ])("binds only executable markers after %s", (comment) => {
    const sql = renderFirstPartyAnalyticsBigQuerySql(
      `SELECT '$2 ?' AS marker ${comment} FROM analytics_events WHERE owner_email = $1`,
      ["synthetic@example.test"],
      {
        projectId: "example-project",
        datasetId: "analytics",
        tableId: "synthetic_events",
        fullyQualified: "example-project.analytics.synthetic_events",
      },
    );

    expect(sql).toContain("SELECT '$2 ?' AS marker");
    expect(sql).toContain("owner_email = 'synthetic@example.test'");
    expect(
      readAgentSqlQuery(sql, { dialect: "bigquery" }).sources,
    ).toMatchObject([
      {
        name: "synthetic_events",
        qualifiers: ["example-project", "analytics"],
      },
    ]);
    expect(
      lexAgentSql(sql, { dialect: "bigquery" }).some(
        (token) => token.kind === "parameter",
      ),
    ).toBe(false);
  });

  it("preserves literal FROM text while qualifying CTE inputs", () => {
    const sql = renderFirstPartyAnalyticsBigQuerySql(
      "WITH analytics_events AS (SELECT * FROM analytics_event_daily_rollups) SELECT 'FROM analytics_events' AS marker FROM analytics_events",
      [],
      {
        projectId: "example-project",
        datasetId: "analytics",
        tableId: "synthetic_events",
        fullyQualified: "example-project.analytics.synthetic_events",
      },
    );

    expect(sql).toContain(
      "SELECT 'FROM analytics_events' AS marker FROM analytics_events",
    );
    expect(
      readAgentSqlQuery(sql, { dialect: "bigquery" }).sources,
    ).toMatchObject([
      {
        name: "synthetic_events_daily_rollups",
        qualifiers: ["example-project", "analytics"],
        cte: false,
      },
      { name: "analytics_events", cte: true },
    ]);
  });

  it("preserves PostgreSQL quote, backslash and multiline string content", () => {
    const sql = renderFirstPartyAnalyticsBigQuerySql(
      "SELECT 'can''t \\n\nFROM analytics_events' AS marker FROM analytics_events",
      [],
      {
        projectId: "example-project",
        datasetId: "analytics",
        tableId: "synthetic_events",
        fullyQualified: "example-project.analytics.synthetic_events",
      },
    );

    expect(sql).toContain(
      "SELECT 'can\\'t \\\\n\\nFROM analytics_events' AS marker",
    );
    expect(
      readAgentSqlQuery(sql, { dialect: "bigquery" }).sources,
    ).toHaveLength(1);
  });

  it("keeps translation syntax inside literal data unchanged", () => {
    const sql = renderFirstPartyAnalyticsBigQuerySql(
      "SELECT 'now()::date INTERVAL ''3 days'' event_date <= ''2026-08-05'' coalesce(a, b) ::jsonb ->> ''key''' AS marker FROM analytics_events",
      [],
      {
        projectId: "example-project",
        datasetId: "analytics",
        tableId: "synthetic_events",
        fullyQualified: "example-project.analytics.synthetic_events",
      },
    );

    expect(sql).toContain(
      String.raw`SELECT 'now()::date INTERVAL \'3 days\' event_date <= \'2026-08-05\' coalesce(a, b) ::jsonb ->> \'key\'' AS marker`,
    );
    expect(
      readAgentSqlQuery(sql, { dialect: "bigquery" }).sources,
    ).toHaveLength(1);
  });

  it("translates quoted identifiers without binding their marker text", () => {
    const sql = renderFirstPartyAnalyticsBigQuerySql(
      'SELECT "$1?" AS marker FROM "analytics_events" WHERE owner_email = $1',
      ["synthetic@example.test"],
      {
        projectId: "example-project",
        datasetId: "analytics",
        tableId: "synthetic_events",
        fullyQualified: "example-project.analytics.synthetic_events",
      },
    );

    expect(sql).toContain(
      "SELECT `$1?` AS marker FROM `example-project.analytics.synthetic_events`",
    );
    expect(sql).toContain("owner_email = 'synthetic@example.test'");
  });

  it.each(['"has`backtick"', '"has\\backslash"'])(
    "refuses an identifier that cannot be represented by the BigQuery reader: %s",
    (identifier) => {
      expect(() =>
        renderFirstPartyAnalyticsBigQuerySql(
          `SELECT ${identifier} FROM analytics_events`,
          [],
          {
            projectId: "example-project",
            datasetId: "analytics",
            tableId: "synthetic_events",
            fullyQualified: "example-project.analytics.synthetic_events",
          },
        ),
      ).toThrow(FirstPartyAnalyticsUnsupportedSqlError);
    },
  );

  it.each([
    'WITH "analytics.analytics_events" AS (SELECT * FROM analytics_event_daily_rollups) SELECT * FROM "analytics.analytics_events"',
    'WITH "Analytics_Events" AS (SELECT * FROM analytics_event_daily_rollups) SELECT * FROM analytics_events',
    'WITH "A" AS (SELECT * FROM analytics_events), wrapper AS (WITH "a" AS (SELECT * FROM analytics_event_daily_rollups) SELECT * FROM "A") SELECT * FROM wrapper',
  ])("refuses changed source bindings across dialects: %s", (query) => {
    expect(() =>
      renderFirstPartyAnalyticsBigQuerySql(query, [], {
        projectId: "example-project",
        datasetId: "analytics",
        tableId: "synthetic_events",
        fullyQualified: "example-project.analytics.synthetic_events",
      }),
    ).toThrow(FirstPartyAnalyticsUnsupportedSqlError);
  });

  it("refuses PostgreSQL word/string adjacency that GoogleSQL reads as a raw literal", () => {
    expect(() =>
      renderFirstPartyAnalyticsBigQuerySql(
        "SELECT r'path\\suffix' AS marker FROM analytics_events",
        [],
        {
          projectId: "example-project",
          datasetId: "analytics",
          tableId: "synthetic_events",
          fullyQualified: "example-project.analytics.synthetic_events",
        },
      ),
    ).toThrow(FirstPartyAnalyticsUnsupportedSqlError);
  });

  it.each([
    [
      "SELECT DATE '2026-08-05' AS marker FROM ANALYTICS_EVENTS",
      "DATE '2026-08-05'",
    ],
    [
      "SELECT INTERVAL '3 days' AS marker FROM analytics_events",
      "INTERVAL 3 DAY",
    ],
  ])(
    "keeps separated typed literals and unquoted source folding: %s",
    (query, literal) => {
      const sql = renderFirstPartyAnalyticsBigQuerySql(query, [], {
        projectId: "example-project",
        datasetId: "analytics",
        tableId: "synthetic_events",
        fullyQualified: "example-project.analytics.synthetic_events",
      });

      expect(sql).toContain(literal);
      expect(sql).toContain(
        "FROM `example-project.analytics.synthetic_events`",
      );
    },
  );

  it.each([
    "E'escaped\\n'",
    "B'0101'",
    "X'ab'",
    "N'national'",
    "$$FROM analytics_events $1$$",
  ])(
    "refuses unsupported PostgreSQL literal %s before running BigQuery",
    (literal) => {
      expect(() =>
        renderFirstPartyAnalyticsBigQuerySql(
          `SELECT ${literal} AS marker FROM analytics_events WHERE owner_email = $1`,
          ["synthetic@example.test"],
          {
            projectId: "example-project",
            datasetId: "analytics",
            tableId: "synthetic_events",
            fullyQualified: "example-project.analytics.synthetic_events",
          },
        ),
      ).toThrow(FirstPartyAnalyticsUnsupportedSqlError);
      expect(runQuery).not.toHaveBeenCalled();
    },
  );

  it("keeps special scope values inside GoogleSQL literals through deduplication", () => {
    const sql = renderFirstPartyAnalyticsBigQuerySql(
      "SELECT * FROM (SELECT * FROM analytics_events WHERE owner_email = $1 AND org_id = $2 AND event_date <= $3) AS analytics_events",
      [
        "synthetic'\\) UNION ALL@example.test",
        "synthetic'\\org\nline",
        "2026-08-05",
      ],
      {
        projectId: "example-project",
        datasetId: "analytics",
        tableId: "synthetic_events",
        fullyQualified: "example-project.analytics.synthetic_events",
      },
    );

    expect(sql).toContain(
      "owner_email = 'synthetic\\'\\\\) UNION ALL@example.test'",
    );
    expect(sql).toContain("org_id = 'synthetic\\'\\\\org\\nline'");
    expect(sql).toContain(
      "event_date <= DATE '2026-08-05' QUALIFY ROW_NUMBER()",
    );
    expect(
      readAgentSqlQuery(sql, { dialect: "bigquery" }).sources,
    ).toHaveLength(1);
    const tokens = lexAgentSql(sql, { dialect: "bigquery" });
    expect(
      tokens.filter(
        (token) => token.kind === "word" && token.value === "union",
      ),
    ).toHaveLength(0);
    expect(
      tokens.filter(
        (token) => token.kind === "word" && token.value === "qualify",
      ),
    ).toHaveLength(1);
  });

  it("keeps union branches separated after source deduplication", () => {
    const sql = renderFirstPartyAnalyticsBigQuerySql(
      "SELECT * FROM analytics_events WHERE event_name = 'signup' UNION ALL SELECT * FROM analytics_events WHERE event_name = 'login'",
      [],
      {
        projectId: "builder-3b0a2",
        datasetId: "analytics",
        tableId: "first_party_analytics_events_raw",
        fullyQualified:
          "builder-3b0a2.analytics.first_party_analytics_events_raw",
      },
    );

    expect(sql).toContain(
      "QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY received_at DESC) = 1 UNION ALL",
    );
    expect(sql).not.toContain("= 1UNION ALL");
  });

  it("translates the PostgreSQL date expressions used by dashboard SQL", () => {
    const sql = renderFirstPartyAnalyticsBigQuerySql(
      "SELECT to_char(CURRENT_DATE - INTERVAL '30 days', 'YYYY-MM-DD') AS start_date FROM analytics_events",
      [],
      {
        projectId: "builder-3b0a2",
        datasetId: "analytics",
        tableId: "first_party_analytics_events_raw",
        fullyQualified:
          "builder-3b0a2.analytics.first_party_analytics_events_raw",
      },
    );

    expect(sql).toContain(
      "FORMAT_DATE('%Y-%m-%d', CAST(DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) AS DATE))",
    );
    expect(sql).not.toMatch(/to_char|INTERVAL '30 days'/i);
  });

  it("keeps event_date comparisons typed as BigQuery dates", () => {
    const table = {
      projectId: "builder-3b0a2",
      datasetId: "analytics",
      tableId: "first_party_analytics_events_raw",
      fullyQualified:
        "builder-3b0a2.analytics.first_party_analytics_events_raw",
    };
    const scopedDate = renderFirstPartyAnalyticsBigQuerySql(
      "SELECT * FROM (SELECT * FROM analytics_events WHERE event_date <= ?) AS analytics_events WHERE event_date >= to_char(CURRENT_DATE - INTERVAL '7 days', 'YYYY-MM-DD')",
      ["2026-08-14"],
      table,
    );

    expect(scopedDate).toContain("event_date <= DATE '2026-08-14'");
    expect(scopedDate).toContain(
      "event_date >= CAST(DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) AS DATE)",
    );
    expect(scopedDate).not.toContain("event_date <= '2026-08-14'");
  });

  it("keeps derived cohort_date comparisons typed as BigQuery dates", () => {
    const table = {
      projectId: "builder-3b0a2",
      datasetId: "analytics",
      tableId: "first_party_analytics_events_raw",
      fullyQualified:
        "builder-3b0a2.analytics.first_party_analytics_events_raw",
    };
    const scopedDate = renderFirstPartyAnalyticsBigQuerySql(
      "WITH base AS (SELECT event_date AS cohort_date FROM analytics_events) SELECT * FROM base WHERE base.cohort_date >= to_char(CURRENT_DATE - INTERVAL '7 days', 'YYYY-MM-DD') AND base.cohort_date <= ?",
      ["2026-08-14"],
      table,
    );

    expect(scopedDate).toContain(
      "base.cohort_date >= CAST(DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) AS DATE)",
    );
    expect(scopedDate).toContain("base.cohort_date <= DATE '2026-08-14'");
    expect(scopedDate).not.toContain("cohort_date >= FORMAT_DATE");
  });

  it("removes redundant COALESCE arguments from dashboard SQL", () => {
    const table = {
      projectId: "builder-3b0a2",
      datasetId: "analytics",
      tableId: "first_party_analytics_events_raw",
      fullyQualified:
        "builder-3b0a2.analytics.first_party_analytics_events_raw",
    };
    const rendered = renderFirstPartyAnalyticsBigQuerySql(
      "SELECT COALESCE(template, template, app) AS value FROM analytics_events",
      [],
      table,
    );

    expect(rendered).toContain("COALESCE(template, app)");
    expect(rendered).not.toContain("COALESCE(template, template, app)");
  });

  it.each([
    [
      "SELECT sum(amount)::numeric AS v FROM analytics_events",
      "CAST(sum(amount) AS NUMERIC)",
    ],
    [
      "SELECT count(*)::int AS v FROM analytics_events",
      "CAST(count(*) AS INT64)",
    ],
    [
      "SELECT (COALESCE(properties, '{}'))::text AS v FROM analytics_events",
      "CAST((COALESCE(properties, '{}')) AS STRING)",
    ],
    [
      "SELECT '2026-08-01'::date AS v FROM analytics_events",
      "CAST('2026-08-01' AS DATE)",
    ],
    [
      "SELECT properties::jsonb ->> '$ai_model' AS v FROM analytics_events",
      `JSON_VALUE(properties, '$."$ai_model"')`,
    ],
    [
      "SELECT properties::jsonb ->> 'page.title' AS v FROM analytics_events",
      `JSON_VALUE(properties, '$."page.title"')`,
    ],
    [
      "SELECT properties::jsonb ->> 'owner''s\\key' AS v FROM analytics_events",
      String.raw`JSON_VALUE(properties, '$."owner\'s\\\\key"')`,
    ],
    [
      "SELECT COALESCE(properties,'{}')::jsonb ->> 'k' AS v FROM analytics_events",
      `JSON_VALUE(COALESCE(properties, '{}'), '$."k"')`,
    ],
    [
      "SELECT date_trunc('month', event_date) AS v FROM analytics_events",
      "DATE_TRUNC(CAST(event_date AS DATE), MONTH)",
    ],
    [
      "SELECT date_trunc('day', event_date) AS v FROM analytics_events",
      "DATE_TRUNC(CAST(event_date AS DATE), DAY)",
    ],
    [
      "SELECT date_trunc('week', event_date) AS v FROM analytics_events",
      "DATE_TRUNC(CAST(event_date AS DATE), WEEK(MONDAY))",
    ],
  ])("translates %s for BigQuery", (sql, expected) => {
    const rendered = renderFirstPartyAnalyticsBigQuerySql(sql, [], {
      projectId: "builder-3b0a2",
      datasetId: "analytics",
      tableId: "first_party_analytics_events_raw",
      fullyQualified:
        "builder-3b0a2.analytics.first_party_analytics_events_raw",
    });

    expect(rendered).toContain(expected);
  });

  it.each([
    [
      "SELECT date_trunc('hour', timestamp) AS d FROM analytics_events",
      "date_trunc('hour', ...)",
    ],
    [
      "SELECT DISTINCT ON (user_id) user_id FROM analytics_events",
      "SELECT DISTINCT ON",
    ],
    [
      "SELECT properties ->> 'plan' AS d FROM analytics_events",
      "PostgreSQL JSON operators",
    ],
    [
      "SELECT to_char(event_date, 'YYYY-MM') AS d FROM analytics_events",
      "to_char(..., 'YYYY-MM')",
    ],
    [
      "SELECT properties::json AS p FROM analytics_events",
      "a PostgreSQL json cast",
    ],
    [
      "SELECT id FROM analytics_events WHERE path ILIKE '%signup%'",
      "ILIKE/SIMILAR TO",
    ],
  ])("names the unsupported construct for %s", (sql, construct) => {
    const table = {
      projectId: "builder-3b0a2",
      datasetId: "analytics",
      tableId: "first_party_analytics_events_raw",
      fullyQualified:
        "builder-3b0a2.analytics.first_party_analytics_events_raw",
    };

    let thrown: unknown;
    try {
      renderFirstPartyAnalyticsBigQuerySql(sql, [], table);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(FirstPartyAnalyticsUnsupportedSqlError);
    expect((thrown as FirstPartyAnalyticsUnsupportedSqlError).construct).toBe(
      construct,
    );
  });

  it("uses the Builder production project and isolated raw table by default", async () => {
    await expect(getFirstPartyAnalyticsTable()).resolves.toEqual({
      projectId: "builder-3b0a2",
      datasetId: "analytics",
      tableId: "first_party_analytics_events_raw",
      fullyQualified:
        "builder-3b0a2.analytics.first_party_analytics_events_raw",
    });
  });

  it("compares BigQuery retention metrics against the copied non-http scope", async () => {
    runQuery.mockResolvedValue({
      rows: [
        {
          event_count: "12",
          daily_rollup_rows: "3",
          first_event_date: "2026-07-01",
          last_event_date: "2026-08-01",
        },
      ],
    });

    await expect(
      getFirstPartyAnalyticsBigQueryMetrics(
        { userEmail: "owner@example.com", orgId: "org_builder" },
        "builder-3b0a2.analytics.first_party_analytics_events_raw",
        { includeLegacyOwnerRows: false, startDate: "2026-07-01" },
      ),
    ).resolves.toMatchObject({ eventCount: 12, dailyRollupRows: 3 });

    expect(runQuery).toHaveBeenCalledWith(
      expect.stringContaining("event_name IS DISTINCT FROM 'http.response'"),
    );
  });

  it("uses separate indexed tenant branches for the backfill cursor", async () => {
    execute.mockResolvedValue({ rows: [] });

    await expect(
      backfillFirstPartyAnalyticsBatch(
        { userEmail: "owner@example.com", orgId: "org_builder" },
        null,
        25,
        "builder-3b0a2.analytics.first_party_analytics_events_raw",
        { now: () => "2026-08-08T00:00:00.000Z" },
      ),
    ).resolves.toMatchObject({ nextCursor: null, copied: 0, complete: true });

    expect(execute).toHaveBeenCalledTimes(2);
    const [orgQuery] = execute.mock.calls[0] ?? [];
    const [personalQuery] = execute.mock.calls[1] ?? [];
    for (const query of [orgQuery, personalQuery]) {
      expect(query.sql).toContain("SELECT id, received_at");
      expect(query.sql).toContain(
        "event_name IS DISTINCT FROM 'http.response'",
      );
      expect(query.sql).toContain("ORDER BY received_at ASC, id ASC LIMIT $3");
      expect(query.sql).not.toContain("SELECT *");
      expect(query.sql).not.toContain("UNION ALL");
    }
    expect(orgQuery.args).toEqual([
      "org_builder",
      "2026-06-09T00:00:00.000Z",
      25,
    ]);
    expect(personalQuery.args).toEqual([
      "owner@example.com",
      "2026-06-09T00:00:00.000Z",
      25,
    ]);
  });

  it("applies the tuple cursor after the initial backfill batch", async () => {
    execute.mockResolvedValue({ rows: [] });

    await expect(
      backfillFirstPartyAnalyticsBatch(
        { userEmail: "owner@example.com", orgId: "org_builder" },
        JSON.stringify({
          receivedAt: "2026-07-25T11:01:33.023Z",
          id: "evt_last",
        }),
        25,
        "builder-3b0a2.analytics.first_party_analytics_events_raw",
        { now: () => "2026-08-08T00:00:00.000Z" },
      ),
    ).resolves.toMatchObject({ copied: 0, complete: true });

    expect(execute).toHaveBeenCalledTimes(2);
    const [orgQuery] = execute.mock.calls[0] ?? [];
    const [personalQuery] = execute.mock.calls[1] ?? [];
    expect(orgQuery.sql).toContain("(received_at, id) > ($3, $4)");
    expect(personalQuery.sql).toContain("(received_at, id) > ($3, $4)");
    expect(orgQuery.args).toEqual([
      "org_builder",
      "2026-06-09T00:00:00.000Z",
      "2026-07-25T11:01:33.023Z",
      "evt_last",
      25,
    ]);
    expect(personalQuery.args).toEqual([
      "owner@example.com",
      "2026-06-09T00:00:00.000Z",
      "2026-07-25T11:01:33.023Z",
      "evt_last",
      25,
    ]);
  });

  it("keeps shard bounds disjoint while continuing from a shard cursor", async () => {
    execute.mockResolvedValue({ rows: [] });

    await expect(
      backfillFirstPartyAnalyticsBatch(
        { userEmail: "owner@example.com", orgId: "org_builder" },
        JSON.stringify({
          receivedAt: "2026-07-25T11:01:33.023Z",
          id: "evt_last",
        }),
        25,
        "builder-3b0a2.analytics.first_party_analytics_events_raw",
        {
          now: () => "2026-08-08T00:00:00.000Z",
          rangeStart: {
            receivedAt: "2026-07-25T00:00:00.000Z",
            id: "",
          },
          rangeEnd: {
            receivedAt: "2026-07-26T00:00:00.000Z",
            id: "",
          },
          rangeEndInclusive: false,
        },
      ),
    ).resolves.toMatchObject({ copied: 0, complete: true });

    const [orgQuery] = execute.mock.calls[0] ?? [];
    expect(orgQuery.sql).toContain("(received_at, id) < ($3, $4)");
    expect(orgQuery.sql).toContain("(received_at, id) > ($5, $6)");
    expect(orgQuery.args).toEqual([
      "org_builder",
      "2026-06-09T00:00:00.000Z",
      "2026-07-26T00:00:00.000Z",
      "",
      "2026-07-25T11:01:33.023Z",
      "evt_last",
      25,
    ]);
  });

  it("keeps an oversized backfill request bounded", async () => {
    execute.mockResolvedValue({ rows: [] });

    await backfillFirstPartyAnalyticsBatch(
      { userEmail: "owner@example.com", orgId: "org_builder" },
      null,
      10_000,
      "builder-3b0a2.analytics.first_party_analytics_events_raw",
    );

    const [orgQuery] = execute.mock.calls[0] ?? [];
    const [personalQuery] = execute.mock.calls[1] ?? [];
    expect(orgQuery.args.at(-1)).toBe(750);
    expect(personalQuery.args.at(-1)).toBe(750);
  });

  it("keeps BigQuery streaming requests bounded", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      insertFirstPartyAnalyticsRows(
        Array.from({ length: 201 }, (_, index) => ({ id: `event-${index}` })),
        "builder-3b0a2.analytics.first_party_analytics_events_raw",
      ),
    ).resolves.toBe(201);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string),
    ).toMatchObject({ skipInvalidRows: true, ignoreUnknownValues: false });
    expect(
      JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string).rows,
    ).toHaveLength(200);
    expect(
      JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string).rows,
    ).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("delivers only rows BigQuery did not reject", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        insertErrors: [{ index: 1, errors: [{ message: "invalid event" }] }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      insertFirstPartyAnalyticsRowsWithResults(
        [{ id: "event-1" }, { id: "event-2" }],
        "builder-3b0a2.analytics.first_party_analytics_events_raw",
      ),
    ).resolves.toEqual({
      acceptedIds: ["event-1"],
      rejectedIds: ["event-2"],
      error: "BigQuery rejected 1 event row(s): invalid event",
    });
    vi.unstubAllGlobals();
  });

  it("reconciles rows after an ambiguous insert response", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("socket closed"));
    vi.stubGlobal("fetch", fetchMock);
    runQuery.mockResolvedValue({
      rows: [{ id: "event-1" }],
      schema: [{ name: "id", type: "STRING" }],
    });

    await expect(
      insertFirstPartyAnalyticsRowsWithResults(
        [{ id: "event-1" }, { id: "event-2" }],
        "builder-3b0a2.analytics.first_party_analytics_events_raw",
      ),
    ).resolves.toEqual({
      acceptedIds: ["event-1"],
      rejectedIds: ["event-2"],
      error: "socket closed",
    });
    expect(runQuery).toHaveBeenCalledWith(
      expect.stringContaining("SELECT id FROM"),
    );
    vi.unstubAllGlobals();
  });

  it("reuses the table resolver and bounds dedicated BigQuery concurrency", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const insertRows = await createFirstPartyAnalyticsInserter(
      "builder-3b0a2.analytics.first_party_analytics_events_raw",
      { maxRowsPerRequest: 500, maxConcurrentRequests: 2 },
    );
    await expect(
      insertRows(
        Array.from({ length: 1_001 }, (_, index) => ({
          id: `event-${index}`,
        })),
      ),
    ).resolves.toBe(1_001);

    expect(getBigQueryProjectId).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBe(2);
    vi.unstubAllGlobals();
  });

  it("hydrates only the bounded indexed keys selected for a batch", async () => {
    execute
      .mockResolvedValueOnce({
        rows: [
          {
            id: "org-event",
            received_at: "2026-07-25T11:01:33.023Z",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "org-event",
            public_key_id: "pk",
            event_name: "page_view",
            timestamp: "2026-07-25T11:01:33.023Z",
            event_date: "2026-07-25",
            received_at: "2026-07-25T11:01:33.023Z",
            properties: "{}",
            context: "{}",
            owner_email: "owner@example.com",
            org_id: "org_builder",
          },
        ],
      });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      backfillFirstPartyAnalyticsBatch(
        { userEmail: "owner@example.com", orgId: "org_builder" },
        null,
        25,
        "builder-3b0a2.analytics.first_party_analytics_events_raw",
      ),
    ).resolves.toMatchObject({ copied: 1, complete: true });

    expect(execute).toHaveBeenCalledTimes(3);
    const [hydrateQuery] = execute.mock.calls[2] ?? [];
    expect(hydrateQuery.sql).toContain("SELECT id, public_key_id, event_name");
    expect(hydrateQuery.sql).toContain("WHERE id IN ($1)");
    expect(hydrateQuery.args).toEqual(["org-event"]);
    vi.unstubAllGlobals();
  });

  it("chunks hydration keys without changing selected event order", async () => {
    const indexedRows = Array.from({ length: 901 }, (_, index) => ({
      id: `event-${index}`,
      received_at: new Date(Date.UTC(2026, 6, 25, 0, 0, index)).toISOString(),
    }));
    const hydratedRows = indexedRows.map((row) => ({
      ...row,
      public_key_id: "pk",
      event_name: "page_view",
      timestamp: row.received_at,
      event_date: "2026-07-25",
      properties: "{}",
      context: "{}",
      owner_email: "owner@example.com",
      org_id: "org_builder",
    }));
    execute.mockImplementation(
      async (query: { sql: string; args: string[] }) => {
        if (query.sql.includes("SELECT id, received_at")) {
          return {
            rows: query.sql.includes("org_id = $1") ? indexedRows : [],
          };
        }
        return {
          rows: hydratedRows.filter((row) => query.args.includes(row.id)),
        };
      },
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      backfillFirstPartyAnalyticsBatch(
        { userEmail: "owner@example.com", orgId: "org_builder" },
        null,
        901,
        "builder-3b0a2.analytics.first_party_analytics_events_raw",
      ),
    ).resolves.toMatchObject({ copied: 750 });

    expect(execute).toHaveBeenCalledTimes(3);
    const [firstHydration] = execute.mock.calls.slice(2);
    expect(firstHydration?.[0].args).toHaveLength(750);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    vi.unstubAllGlobals();
  });

  it("persists the cutover setting with its table and completion marker", async () => {
    await saveFirstPartyAnalyticsBackend(
      { userEmail: "owner@example.com", orgId: "org_builder" },
      {
        sink: "bigquery",
        table: "builder-3b0a2.analytics.first_party_analytics_events_raw",
        backfillCursor: "evt_last",
        backfillCompleted: true,
      },
    );

    expect(putScopedSettingRecord).toHaveBeenCalledWith(
      { email: "owner@example.com", orgId: "org_builder" },
      "first-party-analytics-backend",
      expect.objectContaining({
        sink: "bigquery",
        table: "builder-3b0a2.analytics.first_party_analytics_events_raw",
        backfillCursor: "evt_last",
        backfillCompleted: true,
      }),
    );
  });
});
