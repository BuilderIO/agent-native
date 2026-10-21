import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrgSetting: vi.fn(),
  getUserSetting: vi.fn(),
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
  runQuery: vi.fn(),
  getBigQueryProjectId: vi.fn(),
  getBigQueryAccessToken: vi.fn(),
  fetchGoogleWithRetry: vi.fn(),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  defineAction: (definition: unknown) => definition,
}));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));
vi.mock("@agent-native/core/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/settings")>()),
  getOrgSetting: mocks.getOrgSetting,
  getUserSetting: mocks.getUserSetting,
}));
vi.mock("../server/lib/bigquery.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/lib/bigquery.js")>()),
  runQuery: mocks.runQuery,
  getBigQueryProjectId: mocks.getBigQueryProjectId,
}));
vi.mock("../server/lib/gcloud.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/lib/gcloud.js")>()),
  getBigQueryAccessToken: mocks.getBigQueryAccessToken,
  fetchGoogleWithRetry: mocks.fetchGoogleWithRetry,
}));

const action = (await import("./get-first-party-analytics-backend")).default;
const { resetFirstPartyAnalyticsBackendCacheForTests } =
  await import("../server/lib/first-party-analytics-backend");

function expectNoBigQuery() {
  expect(mocks.runQuery).not.toHaveBeenCalled();
  expect(mocks.getBigQueryProjectId).not.toHaveBeenCalled();
  expect(mocks.getBigQueryAccessToken).not.toHaveBeenCalled();
  expect(mocks.fetchGoogleWithRetry).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFirstPartyAnalyticsBackendCacheForTests();
  mocks.getRequestUserEmail.mockReturnValue("alice@example.com");
  mocks.getRequestOrgId.mockReturnValue("org_123");
  mocks.getOrgSetting.mockResolvedValue(null);
  mocks.getUserSetting.mockResolvedValue(null);
});

describe("get-first-party-analytics-backend", () => {
  it("reports Postgres for every table when the scope has no backend setting", async () => {
    const result = await action.run({});
    expect(action.outputSchema!.parse(result)).toEqual(result);
    expect(result).toEqual({
      sink: "postgres",
      setting: "absent",
      tables: {
        analytics_events: "postgres",
        analytics_event_daily_rollups: "postgres",
        analytics_user_days: "postgres",
        session_recordings: "postgres",
        analytics_content_items: "postgres",
        analytics_content_metric_snapshots: "postgres",
        analytics_content_collection_runs: "postgres",
      },
    });
    expect(mocks.getOrgSetting).toHaveBeenCalledWith(
      "org_123",
      "first-party-analytics-backend",
    );
    expectNoBigQuery();
  });

  it("reports BigQuery event tables after the cutover without querying BigQuery", async () => {
    mocks.getOrgSetting.mockResolvedValue({
      sink: "bigquery",
      table: "analytics.first_party_analytics_events_raw",
    });

    await expect(action.run({})).resolves.toEqual({
      sink: "bigquery",
      setting: "recognized",
      tables: {
        analytics_events: "bigquery",
        analytics_event_daily_rollups: "bigquery",
        analytics_user_days: "bigquery",
        session_recordings: "postgres",
        analytics_content_items: "postgres",
        analytics_content_metric_snapshots: "postgres",
        analytics_content_collection_runs: "postgres",
      },
    });
    expectNoBigQuery();
  });

  it("reports an unrecognized stored backend instead of passing it off as the default", async () => {
    mocks.getOrgSetting.mockResolvedValue({ sink: "BigQuery" });

    await expect(action.run({})).resolves.toMatchObject({
      sink: "postgres",
      setting: "unrecognized",
      tables: { analytics_events: "postgres" },
    });
    expectNoBigQuery();
  });

  it("fails with a typed error instead of assuming Postgres when the setting is unreadable", async () => {
    mocks.getOrgSetting.mockRejectedValue(new Error("settings store down"));

    await expect(action.run({})).rejects.toMatchObject({
      errorCode: "first_party_backend_unreadable",
      statusCode: 503,
    });
    expectNoBigQuery();
  });
});
