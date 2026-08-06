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
      "FROM `builder-3b0a2.analytics.first_party_analytics_events_raw_query`",
    );
    expect(sql).toContain("'owner''o@example.com'");
    expect(sql).toContain("'2026-08-05'");
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
