import { beforeEach, describe, expect, it, vi } from "vitest";

const getScopedSettingRecord = vi.hoisted(() => vi.fn());
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
  getFirstPartyAnalyticsBackend,
  getFirstPartyAnalyticsBigQueryMetrics,
  getFirstPartyAnalyticsTable,
  insertFirstPartyAnalyticsRows,
  renderFirstPartyAnalyticsBigQuerySql,
  resetFirstPartyAnalyticsBackendCacheForTests,
  saveFirstPartyAnalyticsBackend,
} from "./first-party-analytics-backend.js";

beforeEach(() => {
  getScopedSettingRecord.mockReset();
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
    expect(sql).toContain("'owner''o@example.com'");
    expect(sql).toContain("'2026-08-05'");
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
      expect(query.sql).toContain("ORDER BY received_at ASC, id ASC LIMIT ?");
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
    expect(orgQuery.sql).toContain("(received_at, id) > (?, ?)");
    expect(personalQuery.sql).toContain("(received_at, id) > (?, ?)");
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
    expect(orgQuery.sql).toContain("(received_at, id) < (?, ?)");
    expect(orgQuery.sql).toContain("(received_at, id) > (?, ?)");
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
      JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string).rows,
    ).toHaveLength(200);
    expect(
      JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string).rows,
    ).toHaveLength(1);
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
    expect(hydrateQuery.sql).toContain("WHERE id IN (?)");
    expect(hydrateQuery.args).toEqual(["org-event"]);
    vi.unstubAllGlobals();
  });

  it("chunks SQLite hydration keys without changing selected event order", async () => {
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
            rows: query.sql.includes("org_id = ?") ? indexedRows : [],
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
