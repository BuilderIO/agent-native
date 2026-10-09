import { getRequestContext } from "@agent-native/core/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  backend: vi.fn(),
  notify: vi.fn(),
  patches: vi.fn(),
  incident: vi.fn(),
}));
vi.mock("./first-party-analytics.js", async (original) => ({
  ...(await original<typeof import("./first-party-analytics.js")>()),
  queryFirstPartyAnalytics: mocks.query,
}));
vi.mock("./first-party-analytics-backend.js", async (original) => ({
  ...(await original<typeof import("./first-party-analytics-backend.js")>()),
  getFirstPartyAnalyticsBackend: mocks.backend,
}));
vi.mock("@agent-native/core/notifications", () => ({
  notifyWithDelivery: mocks.notify,
}));
vi.mock("../db/index.js", async (original) => ({
  ...(await original<typeof import("../db/index.js")>()),
  getDb: () => ({
    update: () => ({
      set: (patch: unknown) => ({ where: () => mocks.patches(patch) }),
    }),
    insert: () => ({ values: mocks.incident }),
  }),
}));

import {
  buildBigQueryAnalyticsAlertBatchQuery,
  evaluateAndNotifyAnalyticsAlertRule,
  evaluateAnalyticsAlertRuleRows,
  evaluateBigQueryAnalyticsAlertBatch,
  isBigQueryAnalyticsAlertBatchEligible,
  type AnalyticsAlertRule,
} from "./analytics-alerts.js";
import { renderFirstPartyAnalyticsBigQuerySql } from "./first-party-analytics-backend.js";
import { scopedAnalyticsSql } from "./first-party-analytics.js";

const now = new Date("2026-10-09T00:05:00.000Z");
function rule(patch: Partial<AnalyticsAlertRule> = {}): AnalyticsAlertRule {
  return {
    id: "terminal",
    name: "Terminal failures",
    description: "",
    eventName: "agent_run_terminal",
    filters: [
      { field: "properties.status", value: "errored" },
      { field: "hostname", op: "contains", value: "beta." },
    ],
    thresholdMode: "event_count",
    distinctBy: null,
    threshold: 2,
    windowMinutes: 10,
    cooldownMinutes: 30,
    severity: "critical",
    channels: ["inbox"],
    emailRecipients: [],
    slackWebhookUrl: null,
    webhookUrl: null,
    enabled: true,
    lastEvaluatedAt: null,
    lastTriggeredAt: null,
    lastStatus: null,
    lastError: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ownerEmail: "owner@example.test",
    orgId: "org",
    ...patch,
  };
}
function sample(patch: Record<string, unknown> = {}) {
  return {
    id: "b",
    eventName: "agent_run_terminal",
    timestamp: "2026-10-09T00:04:00.000Z",
    app: "chat",
    template: "chat",
    userKey: "user",
    sessionId: "session",
    path: "/chat",
    ...patch,
  };
}
function queryRow(row: Record<string, unknown>) {
  mocks.query.mockResolvedValue({ rows: [row], schema: [] });
}
async function evaluation(row: Record<string, unknown>) {
  queryRow(row);
  return (await evaluateBigQueryAnalyticsAlertBatch([rule()], now)).get(
    "terminal",
  )!;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.notify.mockResolvedValue({
    deliveredChannels: ["inbox"],
    notification: { id: "notification" },
  });
});

describe("BigQuery alert batch", () => {
  it("renders a single narrow CTE read with immutable bounds pushed before deduplication", () => {
    const rules = [
      rule(),
      rule({
        id: "stuck",
        eventName: "agent_chat_stuck_detected",
        filters: [],
        windowMinutes: 5,
      }),
      rule({
        id: "http",
        eventName: "http.response",
        filters: [{ field: "properties.status_class", value: "5xx" }],
        windowMinutes: 30,
      }),
    ];
    const query = buildBigQueryAnalyticsAlertBatchQuery(rules, now);
    expect(query).toContain(
      "SELECT id, event_name, timestamp, app, template, user_key, session_id, path, properties, hostname FROM analytics_events",
    );
    expect(query.match(/FROM candidates/g)).toHaveLength(1);
    expect(query).not.toContain("UNION");
    expect(query.match(/COUNTIF\(/g)).toHaveLength(3);
    expect(query).toContain("2026-10-08T23:35:00.000Z");
    expect(query).toContain("2026-10-08T23:55:00.000Z");
    expect(query).toContain("2026-10-09T00:00:00.000Z");
    expect(query).toContain(
      "IGNORE NULLS ORDER BY timestamp DESC, id DESC LIMIT 5",
    );
    expect(query).toContain(
      "CONCAT(FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%E3S', timestamp, 'UTC'), 'Z')",
    );
    const scoped = scopedAnalyticsSql(
      query,
      { userEmail: rules[0].ownerEmail, orgId: "org" },
      "2026-10-09",
    );
    const rendered = renderFirstPartyAnalyticsBigQuerySql(
      scoped.sql,
      scoped.args,
      {
        projectId: "example-project",
        datasetId: "analytics",
        tableId: "events",
        fullyQualified: "example-project.analytics.events",
      },
    );
    const dedup = rendered.indexOf("QUALIFY ROW_NUMBER()");
    const beforeDedup = rendered.slice(0, dedup);
    expect(dedup).toBeGreaterThan(0);
    expect(beforeDedup).toContain(
      "event_name IN ( 'agent_run_terminal' , 'agent_chat_stuck_detected' , 'http.response' )",
    );
    expect(beforeDedup).toContain("event_date >=");
    expect(beforeDedup).toContain("event_date <=");
    expect(beforeDedup).toContain("user_id");
    expect(beforeDedup).not.toContain("JSON_VALUE");
    expect(rendered).toContain("JSON_VALUE(properties");
  });

  it("executes once in the exact request and credential scope and preserves sample contents", async () => {
    queryRow({
      count_0: "2",
      samples_0: JSON.stringify([sample(), sample({ id: "a" })]),
    });
    mocks.query.mockImplementationOnce(async (_sql, scope) => {
      expect(scope).toEqual({ userEmail: "owner@example.test", orgId: "org" });
      expect(getRequestContext()).toMatchObject({
        userEmail: scope.userEmail,
        orgId: scope.orgId,
      });
      return {
        rows: [
          {
            count_0: "2",
            samples_0: JSON.stringify([sample(), sample({ id: "a" })]),
          },
        ],
        schema: [],
      };
    });
    const results = await evaluateBigQueryAnalyticsAlertBatch([rule()], now);
    expect(results.get("terminal")).toEqual({
      evaluation: {
        triggered: true,
        observedValue: 2,
        eventCount: 2,
        sampleEvents: [sample(), sample({ id: "a" })],
      },
    });
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it.each(["null", "[]"])(
    "accepts a complete zero aggregate with samples %s",
    async (samples) => {
      expect(await evaluation({ count_0: "0", samples_0: samples })).toEqual({
        evaluation: {
          triggered: false,
          observedValue: 0,
          eventCount: 0,
          sampleEvents: [],
        },
      });
    },
  );

  it.each([
    {},
    { count_0: null, samples_0: "null" },
    { count_0: "", samples_0: "[]" },
    { count_0: "NaN", samples_0: "[]" },
    { count_0: Infinity, samples_0: "[]" },
    { count_0: -1, samples_0: "[]" },
    { count_0: 1.5, samples_0: "[]" },
    { count_0: "9007199254740992", samples_0: "[]" },
    { count_0: 0 },
    { count_0: 0, samples_0: null },
    { count_0: 0, samples_0: "bad json" },
    { count_0: 0, samples_0: "{}" },
    { count_0: 1, samples_0: "null" },
    { count_0: 1, samples_0: "[]" },
    { count_0: 0, samples_0: JSON.stringify([sample()]) },
    { count_0: 6, samples_0: JSON.stringify([sample()]) },
  ])("rejects malformed or inconsistent aggregate %#", async (row) => {
    expect(await evaluation(row)).toHaveProperty("error");
  });

  it.each([
    {},
    sample({ app: undefined }),
    sample({ id: "" }),
    sample({ path: 42 }),
    sample({ timestamp: "invalid" }),
    sample({ timestamp: "2026-10-08T23:54:59.000Z" }),
    sample({ timestamp: "2026-10-09T00:05:01.000Z" }),
    sample({ eventName: "wrong" }),
  ])("rejects malformed or out-of-window sample %#", async (data) => {
    expect(
      await evaluation({ count_0: 1, samples_0: JSON.stringify([data]) }),
    ).toHaveProperty("error");
  });

  it("rejects duplicate and ascending samples", async () => {
    for (const samples of [
      [sample(), sample()],
      [sample(), sample({ id: "a", timestamp: now.toISOString() })],
    ]) {
      expect(
        await evaluation({ count_0: 2, samples_0: JSON.stringify(samples) }),
      ).toHaveProperty("error");
    }
  });

  it("preserves warehouse order when samples display the same millisecond", async () => {
    const result = await evaluation({
      count_0: 2,
      samples_0: JSON.stringify([
        sample({ id: "a", timestamp: "2026-10-09T00:04:00.123Z" }),
        sample({ id: "b", timestamp: "2026-10-09T00:04:00.123Z" }),
      ]),
    });
    expect(result).toHaveProperty("evaluation");
    if ("evaluation" in result) {
      expect(
        result.evaluation.sampleEvents.map((event) => event.timestamp),
      ).toEqual(["2026-10-09T00:04:00.123Z", "2026-10-09T00:04:00.123Z"]);
    }
  });

  it.each([
    { rows: [], schema: [] },
    { rows: [{}, {}], schema: [] },
    { rows: [{ count_0: 0, samples_0: "null" }], schema: [], truncated: true },
  ])("rejects incomplete transport %#", async (result) => {
    mocks.query.mockResolvedValue(result);
    await expect(
      evaluateBigQueryAnalyticsAlertBatch([rule()], now),
    ).rejects.toThrow("complete aggregate row");
  });

  it("isolates validation failures and enforces each rule's sample window", async () => {
    queryRow({
      count_0: 1,
      samples_0: JSON.stringify([
        sample({ timestamp: "2026-10-08T23:57:00.000Z" }),
      ]),
      count_1: 1,
      samples_1: JSON.stringify([
        sample({ timestamp: "2026-10-08T23:57:00.000Z" }),
      ]),
    });
    const results = await evaluateBigQueryAnalyticsAlertBatch(
      [rule(), rule({ id: "short", windowMinutes: 5 })],
      now,
    );
    expect(results.get("terminal")).toHaveProperty("evaluation");
    expect(results.get("short")).toHaveProperty("error");
  });

  it("refuses mixed credential scopes before executing", async () => {
    for (const other of [
      rule({ ownerEmail: "Owner@example.test" }),
      rule({ orgId: null }),
    ]) {
      await expect(
        evaluateBigQueryAnalyticsAlertBatch([rule(), other], now),
      ).rejects.toThrow("exact credential scope");
    }
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("preserves distinct JSON values, exclusions and primitive collisions", async () => {
    const values = [
      '"run-a"',
      '"run-a"',
      "42",
      '"42"',
      "null",
      '""',
      '{"x":1}',
      '{ "x": 1 }',
    ];
    const distinctRule = rule({
      thresholdMode: "distinct_count",
      distinctBy: "properties.runId",
      threshold: 4,
      filters: [],
    });
    const events = values.map((raw, index) => ({
      ...sample({ id: String(values.length - index) }),
      properties: JSON.stringify({ runId: JSON.parse(raw) }),
    }));
    queryRow({
      count_0: events.length,
      samples_0: JSON.stringify(
        events
          .slice(0, 5)
          .map(({ properties: _properties, ...event }) => event),
      ),
      distinct_0: JSON.stringify([...new Set(values)]),
    });
    expect(isBigQueryAnalyticsAlertBatchEligible(distinctRule)).toBe(true);
    expect(
      buildBigQueryAnalyticsAlertBatchQuery([distinctRule], now),
    ).toContain("JSON_QUERY(properties, '$.runId')");
    const result = await evaluateBigQueryAnalyticsAlertBatch(
      [distinctRule],
      now,
    );
    expect(result.get(distinctRule.id)).toEqual({
      evaluation: evaluateAnalyticsAlertRuleRows(distinctRule, events),
    });
    expect(result.get(distinctRule.id)).toMatchObject({
      evaluation: { eventCount: 8, observedValue: 3, triggered: false },
    });
  });

  it.each([undefined, "{}", "[123]", '["invalid JSON"]', '["null","null"]'])(
    "rejects malformed or incomplete distinct aggregate %s",
    async (distinct_0) => {
      const distinctRule = rule({
        thresholdMode: "distinct_count",
        distinctBy: "properties.runId",
      });
      queryRow({
        count_0: 1,
        samples_0: JSON.stringify([sample()]),
        distinct_0,
      });
      expect(
        (await evaluateBigQueryAnalyticsAlertBatch([distinctRule], now)).get(
          distinctRule.id,
        ),
      ).toHaveProperty("error");
    },
  );

  it("accepts no distinct inputs without confusing matched rows with observed values", async () => {
    const distinctRule = rule({
      thresholdMode: "distinct_count",
      distinctBy: "properties.runId",
    });
    queryRow({
      count_0: 1,
      samples_0: JSON.stringify([sample()]),
      distinct_0: "null",
    });
    expect(
      (await evaluateBigQueryAnalyticsAlertBatch([distinctRule], now)).get(
        distinctRule.id,
      ),
    ).toMatchObject({
      evaluation: { eventCount: 1, observedValue: 0, triggered: false },
    });
  });

  it.each([
    { thresholdMode: "distinct_count" as const },
    { eventName: null },
    { filters: [{ field: "properties.x", value: { x: 1 } }] },
    { filters: [{ field: "properties.x", value: null }] },
    {
      filters: [{ field: "properties.x", op: "in" as const, value: ["5xx"] }],
    },
    {
      filters: [{ field: "properties.x", op: "contains" as const, value: "x" }],
    },
    { filters: [{ field: "context.x", op: "exists" as const }] },
    {
      filters: [
        { field: "properties.x", op: "not_equals" as const, value: "x" },
      ],
    },
    { filters: [{ field: "path", op: "in" as const, value: [null, "x"] }] },
    { filters: [{ field: "path", op: "in" as const, value: "x" }] },
    { filters: [{ field: "unknown", value: "x" }] },
    { filters: [{ field: "path", op: "contains" as const, value: {} }] },
  ])("retains unsupported rule %# on the old path", (patch) => {
    expect(isBigQueryAnalyticsAlertBatchEligible(rule(patch))).toBe(false);
  });

  it("accepts primitive equality/IN and raw exists/not_equals/contains", () => {
    for (const filter of [
      { field: "properties.x", value: true },
      { field: "context.x", value: 500 },
      {
        field: "path",
        op: "in" as const,
        value: [true, 500, "errored"],
      },
      { field: "path", op: "in" as const, value: [] },
      { field: "path", op: "exists" as const, value: false },
      { field: "path", op: "not_equals" as const, value: "" },
      { field: "path", op: "contains" as const, value: "" },
    ]) {
      expect(
        isBigQueryAnalyticsAlertBatchEligible(rule({ filters: [filter] })),
      ).toBe(true);
      expect(() =>
        buildBigQueryAnalyticsAlertBatchQuery(
          [rule({ filters: [filter] })],
          now,
        ),
      ).not.toThrow();
    }
    const query = buildBigQueryAnalyticsAlertBatchQuery(
      [rule({ filters: [{ field: "path", op: "contains", value: "" }] })],
      now,
    );
    expect(query).toContain("path IS NOT NULL AND STRPOS");
    expect(
      evaluateAnalyticsAlertRuleRows(
        rule({ filters: [{ field: "path", op: "contains", value: "" }] }),
        [
          {
            id: "a",
            eventName: "test",
            timestamp: now.toISOString(),
            path: null,
          },
        ],
      ).eventCount,
    ).toBe(0);
  });

  it("uses precomputed results through status, cooldown and notification handling without another query", async () => {
    const precomputed = {
      triggered: true,
      observedValue: 2,
      eventCount: 2,
      sampleEvents: [sample(), sample({ id: "a" })],
    };
    expect(
      (await evaluateAndNotifyAnalyticsAlertRule(rule(), now, precomputed))
        .status,
    ).toBe("triggered");
    expect(mocks.incident).toHaveBeenCalledWith(
      expect.objectContaining({
        eventCount: 2,
        sampleEvents: JSON.stringify(precomputed.sampleEvents),
      }),
    );
    expect(mocks.notify.mock.calls[0][0].metadata).toMatchObject({
      windowStart: "2026-10-08T23:55:00.000Z",
      windowEnd: now.toISOString(),
      sampleEvents: precomputed.sampleEvents,
    });
    expect(
      (
        await evaluateAndNotifyAnalyticsAlertRule(
          rule({ lastTriggeredAt: now.toISOString() }),
          now,
          precomputed,
        )
      ).status,
    ).toBe("cooldown");
    expect(
      (
        await evaluateAndNotifyAnalyticsAlertRule(rule(), now, {
          ...precomputed,
          triggered: false,
        })
      ).status,
    ).toBe("ok");
    mocks.notify.mockResolvedValueOnce({ deliveredChannels: [] });
    expect(
      (await evaluateAndNotifyAnalyticsAlertRule(rule(), now, precomputed))
        .status,
    ).toBe("error");
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.backend).not.toHaveBeenCalled();
  });
});
