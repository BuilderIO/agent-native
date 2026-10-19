import { beforeEach, describe, expect, it, vi } from "vitest";

const runQuery = vi.hoisted(() => vi.fn());
const resolveSourceGeneration = vi.hoisted(() => vi.fn());

vi.mock("./bigquery.js", () => ({
  getBigQueryProjectId: vi.fn(),
  runQuery,
}));
vi.mock("./source-generation.js", () => ({ resolveSourceGeneration }));
vi.mock("./scoped-settings.js", () => ({
  getScopedSettingRecord: vi.fn(),
  putScopedSettingRecord: vi.fn(),
}));
vi.mock("@agent-native/core/settings", () => ({ getOrgSetting: vi.fn() }));
vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute: vi.fn() }),
}));
vi.mock("./credentials-context.js", () => ({
  requireRequestCredentialContext: vi.fn(),
}));

import {
  firstPartyEventsModelIneligibility,
  planFirstPartyEventsSource,
  queryFirstPartyAnalyticsInBigQuery,
  renderFirstPartyAnalyticsBigQuerySql,
} from "./first-party-analytics-backend.js";

const MODEL = "example-project.dbt_mart.fact_events";
const table = {
  projectId: "example-project",
  datasetId: "analytics",
  tableId: "events",
  fullyQualified: "example-project.analytics.events",
};
const scopedSql =
  "SELECT event_name, COUNT(*) AS n FROM (SELECT * FROM analytics_events WHERE org_id = 'org' AND event_date <= DATE '2026-10-16') AS e GROUP BY 1";

const okGeneration = {
  status: "ok",
  sources: [],
  generation: `${MODEL}@1760612400000`,
  oldestModifiedAt: "2026-10-16T11:00:00.000Z",
  ageMs: 60 * 60_000,
  stale: false,
  checkedAt: "2026-10-16T12:00:00.000Z",
} as const;

function unavailable(reason: string) {
  return {
    status: "unavailable",
    sources: [],
    reason,
    checkedAt: "2026-10-16T12:00:00.000Z",
  };
}

beforeEach(() => {
  runQuery.mockReset();
  resolveSourceGeneration.mockReset();
  runQuery.mockImplementation(async (_sql, options) => ({
    rows: [{ n: 1 }],
    schema: [{ name: "n", type: "INTEGER" }],
    bytesProcessed: 1024,
    ...(options?.sourceGeneration
      ? { sourceGeneration: options.sourceGeneration }
      : {}),
  }));
});

describe("events model rendering", () => {
  it("reads the model under the raw column names without re-deduplicating", () => {
    const rendered = renderFirstPartyAnalyticsBigQuerySql(
      scopedSql,
      [],
      table,
      {
        eventsModelTable: MODEL,
      },
    );

    expect(rendered).toContain(`FROM \`${MODEL}\``);
    expect(rendered).toContain("event_id AS id");
    expect(rendered).toContain("user_email AS user_id");
    expect(rendered).not.toContain("example-project.analytics.events");
    expect(rendered).not.toContain("QUALIFY");
    expect(rendered).not.toMatch(/public_key_id|\bcontext\b/);
    expect(rendered).toMatch(/\) AS analytics_events WHERE org_id = 'org'/);
  });

  it("keeps a source alias the scoped SQL already gave the events", () => {
    const rendered = renderFirstPartyAnalyticsBigQuerySql(
      "SELECT ev.event_name FROM analytics_events ev WHERE ev.org_id = 'org'",
      [],
      table,
      { eventsModelTable: MODEL },
    );

    expect(rendered).toMatch(/\) ev WHERE ev\.org_id = 'org'/);
    expect(rendered).not.toContain("AS analytics_events");
  });

  it("deduplicates the raw table when no model is given", () => {
    expect(
      renderFirstPartyAnalyticsBigQuerySql(scopedSql, [], table),
    ).toContain(
      "QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY received_at DESC) = 1",
    );
  });

  it("refuses to put a raw-only projection on the model", () => {
    expect(() =>
      renderFirstPartyAnalyticsBigQuerySql(scopedSql, [], table, {
        eventsModelTable: MODEL,
        scopedEventsSingleScan: true,
      }),
    ).toThrow("read the raw event table");
  });
});

describe("events model eligibility", () => {
  it.each([
    ["SELECT public_key_id FROM analytics_events", "reads_raw_only_columns"],
    ["SELECT `context` FROM analytics_events", "reads_raw_only_columns"],
    [
      "SELECT COUNT(*) FROM analytics_events WHERE event_name = 'http.response'",
      "reads_http_response",
    ],
    [
      "SELECT COUNT(*) FROM analytics_events WHERE event_name IN ('http.response')",
      "reads_http_response",
    ],
    [
      "SELECT COUNT(*) FROM analytics_events WHERE properties LIKE '%x%'",
      "reads_properties_as_text",
    ],
    [
      "SELECT * FROM analytics_events WHERE event_name = 'a'",
      "reads_all_columns",
    ],
    [
      "SELECT e.* FROM analytics_events e WHERE e.event_name = 'a'",
      "reads_all_columns",
    ],
    ["SELECT COUNT(*) FROM analytics_events", "http_response_not_excluded"],
    [
      "SELECT SUM(event_count) FROM analytics_event_daily_rollups WHERE event_name = 'a'",
      "reads_no_events",
    ],
    [
      "SELECT COUNT(*) FROM analytics_events WHERE event_name = r'http.response'",
      "http_response_not_excluded",
    ],
    [
      "SELECT COUNT(*) FROM analytics_events WHERE event_name != 'HTTP.RESPONSE'",
      "http_response_not_excluded",
    ],
    [
      "SELECT COUNT(*) FROM analytics_events WHERE event_name IN ('a', '''http.response''')",
      "http_response_not_excluded",
    ],
    [
      String.raw`SELECT COUNT(*) FROM analytics_events WHERE event_name = 'http\x2eresponse'`,
      "http_response_not_excluded",
    ],
    [
      "SELECT JSON_QUERY(properties, '$.a') FROM analytics_events WHERE event_name = 'a'",
      "reads_properties_as_text",
    ],
    [
      "SELECT event_name, COUNT(*) AS n FROM analytics_events GROUP BY 1",
      "http_response_not_excluded",
    ],
    [
      "SELECT COUNT(*) FROM analytics_events WHERE event_name != 'http.response' OR app = 'mail'",
      "http_response_not_excluded",
    ],
    [
      "SELECT COUNT(*) FROM analytics_events WHERE NOT (event_name = 'a')",
      "http_response_not_excluded",
    ],
    [
      "SELECT COUNT(*) FROM analytics_events WHERE IF(event_name = 'a', TRUE, TRUE)",
      "http_response_not_excluded",
    ],
    [
      "SELECT COUNTIF(event_name = 'a') FROM analytics_events WHERE app = 'mail'",
      "http_response_not_excluded",
    ],
    [
      "SELECT COUNT(*) FROM analytics_events a JOIN analytics_events b USING (session_id) WHERE a.event_name = 'x'",
      "http_response_not_excluded",
    ],
    [
      "SELECT COUNT(*) FROM (SELECT * EXCEPT (context) FROM analytics_events) WHERE event_name = 'a'",
      "reads_all_columns",
    ],
    [
      "SELECT n FROM (SELECT COUNT(*) AS n FROM analytics_events) WHERE n > 0 AND TRUE",
      "http_response_not_excluded",
    ],
  ])("keeps %s on the raw table", (sql, reason) => {
    expect(firstPartyEventsModelIneligibility(sql)).toBe(reason);
  });

  it.each([
    "SELECT COUNT(*) FROM analytics_events WHERE event_name != 'http.response'",
    "SELECT COUNT(*) FROM analytics_events e WHERE e.event_name <> 'http.response'",
    "SELECT JSON_VALUE(properties, '$.action') AS action FROM analytics_events WHERE event_name = 'chat_submit'",
    "SELECT COUNT(*) FROM analytics_events WHERE event_name = 'agent_run_terminal'",
    "SELECT COUNT(*) FROM analytics_events WHERE event_date >= DATE '2026-10-01' AND event_name IN ('a', 'b') AND user_id IS NOT NULL",
    "SELECT COUNT(*) FROM analytics_events e WHERE e.event_name = 'a' AND (app = 'mail' AND template = 'mail')",
    "WITH runs AS (SELECT session_id FROM analytics_events WHERE event_name = 'a') SELECT COUNT(*) FROM runs",
    "SELECT COUNT(*) FROM analytics_events a JOIN analytics_events b USING (session_id) WHERE a.event_name = 'x' AND b.event_name = 'y'",
  ])("lets %s read the model", (sql) => {
    expect(firstPartyEventsModelIneligibility(sql)).toBeNull();
  });

  it("plans the model only when it is configured and the SQL fits", () => {
    const sql =
      "SELECT event_name, COUNT(*) AS n FROM analytics_events WHERE event_name IN ('a', 'b') GROUP BY 1";

    expect(planFirstPartyEventsSource(sql, null)).toEqual({
      source: "raw",
      modelSkipped: "not_configured",
    });
    expect(planFirstPartyEventsSource(sql, MODEL)).toEqual({
      source: "model",
      table: MODEL,
    });
    expect(
      planFirstPartyEventsSource(sql, MODEL, { eventsSource: "raw" }),
    ).toEqual({ source: "raw", modelSkipped: "raw_requested" });
    expect(
      planFirstPartyEventsSource(sql, MODEL, {
        scopedEventsProjection: "onboarding_journey",
      }),
    ).toEqual({ source: "raw", modelSkipped: "raw_projection" });
    expect(
      planFirstPartyEventsSource(
        "SELECT COUNT(*) AS n FROM analytics_events WHERE event_name = 'click' AND properties::jsonb ->> 'action' = 'chat_submit'",
        MODEL,
      ),
    ).toEqual({ source: "model", table: MODEL });
  });
});

describe("events model execution", () => {
  it("reads the generation before the job and keys the job by it", async () => {
    resolveSourceGeneration.mockResolvedValue(okGeneration);

    const result = await queryFirstPartyAnalyticsInBigQuery(
      scopedSql,
      [],
      table,
      {
        eventsSource: { source: "model", table: MODEL },
        maxBytesBilled: 1_000,
      },
    );

    expect(resolveSourceGeneration).toHaveBeenCalledWith([MODEL], {
      signal: undefined,
    });
    expect(resolveSourceGeneration.mock.invocationCallOrder[0]!).toBeLessThan(
      runQuery.mock.invocationCallOrder[0]!,
    );
    const [sql, options] = runQuery.mock.calls[0]!;
    expect(sql).toContain(`FROM \`${MODEL}\``);
    expect(options).toMatchObject({
      maxBytesBilled: 1_000,
      sourceGeneration: okGeneration,
    });
    expect(result).toMatchObject({
      eventsSource: { source: "model", table: MODEL },
      sourceGeneration: okGeneration,
    });
  });

  it.each([
    ["not_found", "model_not_found"],
    ["access_denied", "model_access_denied"],
    ["invalid_table_id", "model_invalid_table_id"],
  ])(
    "falls back to the raw table when the model is %s",
    async (reason, modelSkipped) => {
      resolveSourceGeneration.mockResolvedValue(unavailable(reason));

      const result = await queryFirstPartyAnalyticsInBigQuery(
        scopedSql,
        [],
        table,
        { eventsSource: { source: "model", table: MODEL } },
      );

      const [sql, options] = runQuery.mock.calls[0]!;
      expect(sql).toContain("example-project.analytics.events");
      expect(sql).not.toContain(MODEL);
      expect(options).not.toHaveProperty("sourceGeneration");
      expect(result.eventsSource).toEqual({ source: "raw", modelSkipped });
      expect(result).not.toHaveProperty("sourceGeneration");
    },
  );

  it("still reads the model under an unknown generation when the lookup fails", async () => {
    const lookupFailed = unavailable("lookup_failed");
    resolveSourceGeneration.mockResolvedValue(lookupFailed);

    const result = await queryFirstPartyAnalyticsInBigQuery(
      scopedSql,
      [],
      table,
      {
        eventsSource: { source: "model", table: MODEL },
      },
    );

    const [sql, options] = runQuery.mock.calls[0]!;
    expect(sql).toContain(MODEL);
    expect(options).toMatchObject({ sourceGeneration: lookupFailed });
    expect(result).toMatchObject({
      eventsSource: { source: "model", table: MODEL },
      sourceGeneration: lookupFailed,
    });
  });

  it("looks up no generation for a raw read", async () => {
    const result = await queryFirstPartyAnalyticsInBigQuery(
      scopedSql,
      [],
      table,
      {
        eventsSource: { source: "raw", modelSkipped: "raw_requested" },
      },
    );

    expect(resolveSourceGeneration).not.toHaveBeenCalled();
    expect(result.eventsSource).toEqual({
      source: "raw",
      modelSkipped: "raw_requested",
    });
  });
});
