import { beforeEach, describe, expect, it, vi } from "vitest";

const getScopedSettingRecord = vi.hoisted(() => vi.fn());
const putScopedSettingRecord = vi.hoisted(() => vi.fn());
const getBigQueryProjectId = vi.hoisted(() => vi.fn());
const runQuery = vi.hoisted(() => vi.fn());
const getAccessToken = vi.hoisted(() => vi.fn());
const execute = vi.hoisted(() => vi.fn());

vi.mock("./scoped-settings.js", () => ({
  getScopedSettingRecord,
  putScopedSettingRecord,
}));
vi.mock("./bigquery.js", () => ({
  getBigQueryProjectId,
  runQuery,
}));
vi.mock("./gcloud.js", () => ({ getAccessToken }));
vi.mock("@agent-native/core/db", () => ({ getDbExec: () => ({ execute }) }));
vi.mock("./credentials-context.js", () => ({
  requireRequestCredentialContext: vi.fn(),
}));

import {
  backfillFirstPartyAnalyticsBatch,
  getFirstPartyAnalyticsBackend,
  getFirstPartyAnalyticsTable,
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
  execute.mockReset();
  resetFirstPartyAnalyticsBackendCacheForTests();
  getScopedSettingRecord.mockResolvedValue({
    sink: "dual",
    table: "builder-3b0a2.analytics.first_party_analytics_events_raw",
  });
  putScopedSettingRecord.mockResolvedValue(undefined);
  getBigQueryProjectId.mockResolvedValue("builder-3b0a2");
  getAccessToken.mockResolvedValue("test-token");
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

  it("uses the Builder production project and isolated raw table by default", async () => {
    await expect(getFirstPartyAnalyticsTable()).resolves.toEqual({
      projectId: "builder-3b0a2",
      datasetId: "analytics",
      tableId: "first_party_analytics_events_raw",
      fullyQualified:
        "builder-3b0a2.analytics.first_party_analytics_events_raw",
    });
  });

  it("uses separate indexed tenant branches for the backfill cursor", async () => {
    execute.mockResolvedValueOnce({ rows: [] });

    await expect(
      backfillFirstPartyAnalyticsBatch(
        { userEmail: "owner@example.com", orgId: "org_builder" },
        null,
        25,
        "builder-3b0a2.analytics.first_party_analytics_events_raw",
      ),
    ).resolves.toMatchObject({ copied: 0, complete: true });

    const [query] = execute.mock.calls[0] ?? [];
    expect(query.sql).toContain("UNION ALL");
    expect(query.sql).toContain("ORDER BY received_at ASC, id ASC LIMIT ?");
    expect(query.sql).not.toContain("org_id = ? OR");
    expect(query.sql).not.toContain("received_at > ?");
    expect(query.args).toEqual(["org_builder", "owner@example.com", 25]);
  });

  it("applies the tuple cursor after the initial backfill batch", async () => {
    execute.mockResolvedValueOnce({ rows: [] });

    await expect(
      backfillFirstPartyAnalyticsBatch(
        { userEmail: "owner@example.com", orgId: "org_builder" },
        JSON.stringify({
          receivedAt: "2026-07-25T11:01:33.023Z",
          id: "evt_last",
        }),
        25,
        "builder-3b0a2.analytics.first_party_analytics_events_raw",
      ),
    ).resolves.toMatchObject({ copied: 0, complete: true });

    const [query] = execute.mock.calls[0] ?? [];
    expect(query.sql).toContain("received_at > ?");
    expect(query.args).toEqual([
      "org_builder",
      "2026-07-25T11:01:33.023Z",
      "2026-07-25T11:01:33.023Z",
      "evt_last",
      "owner@example.com",
      "2026-07-25T11:01:33.023Z",
      "2026-07-25T11:01:33.023Z",
      "evt_last",
      25,
    ]);
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
