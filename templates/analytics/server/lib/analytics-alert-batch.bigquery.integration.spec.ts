import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./first-party-analytics.js", async (original) => ({
  ...(await original<typeof import("./first-party-analytics.js")>()),
  queryFirstPartyAnalytics: mocks.query,
}));

import {
  buildBigQueryAlertQuery,
  buildBigQueryAnalyticsAlertBatchQuery,
  evaluateAnalyticsAlertRuleRows,
  evaluateBigQueryAnalyticsAlertBatch,
  type AnalyticsAlertRule,
} from "./analytics-alerts.js";
import { renderFirstPartyAnalyticsBigQuerySql } from "./first-party-analytics-backend.js";
import { scopedAnalyticsSql } from "./first-party-analytics.js";

it("matches three individual alert evaluations with one narrow aggregate query", async () => {
  if (!process.env.BIGQUERY_EMULATOR_URL)
    throw new Error(
      "BIGQUERY_EMULATOR_URL is required for the dedicated emulator proof",
    );
  const endpoint = new URL(process.env.BIGQUERY_EMULATOR_URL);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname))
    throw new Error("This test only writes to a loopback emulator");
  const table = {
    projectId: "example-project",
    datasetId: "analytics",
    tableId: `batch_events_${process.pid}`,
    fullyQualified: `example-project.analytics.batch_events_${process.pid}`,
  };
  const raw = `\`${table.fullyQualified}\``;
  const measurementTable =
    process.env.BIGQUERY_MEASUREMENT_TABLE ||
    "example-project.analytics.first_party_analytics_events_raw";
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/.test(measurementTable))
    throw new Error("BIGQUERY_MEASUREMENT_TABLE must be project.dataset.table");
  async function query(sql: string) {
    const response = await fetch(
      new URL("/bigquery/v2/projects/example-project/queries", endpoint),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: sql,
          useLegacySql: false,
          timeoutMs: 60000,
          maxResults: 10000,
        }),
      },
    );
    const body = await response.json();
    if (
      !response.ok ||
      body.error ||
      body.errors?.length ||
      body.jobComplete !== true ||
      body.pageToken
    )
      throw new Error(`Incomplete emulator query: ${JSON.stringify(body)}`);
    const wireRows = body.rows ?? [];
    if (Number(body.totalRows ?? 0) !== wireRows.length)
      throw new Error("Emulator result was truncated");
    const schema: Array<{ name: string; type: string }> =
      body.schema?.fields ?? [];
    const rows: Record<string, unknown>[] = wireRows.map(
      (row: { f: Array<{ v: unknown }> }) =>
        Object.fromEntries(
          schema.map((field, index) => {
            let value = row.f[index].v;
            if (value !== null && field.type === "TIMESTAMP") {
              value = new Date(
                typeof value === "string" && /^\d+(\.\d+)?$/.test(value)
                  ? Number(value) * 1000
                  : String(value),
              ).toISOString();
            }
            return [field.name, value];
          }),
        ),
    );
    return { rows, schema };
  }
  const scope = { userEmail: "synthetic@example.test", orgId: "synthetic-org" };
  const now = new Date("2026-10-09T00:05:00.000Z");
  function render(sql: string) {
    const scoped = scopedAnalyticsSql(sql, scope, "2026-10-09");
    return renderFirstPartyAnalyticsBigQuerySql(scoped.sql, scoped.args, table);
  }
  const rules: AnalyticsAlertRule[] = [
    {
      id: "terminal",
      eventName: "agent_run_terminal",
      windowMinutes: 10,
      filters: [
        { field: "properties.status", value: "errored" },
        { field: "properties.deployment_environment", value: "beta" },
      ],
    },
    {
      id: "stuck",
      eventName: "agent_chat_stuck_detected",
      windowMinutes: 10,
      filters: [],
    },
    {
      id: "5xx",
      eventName: "http.response",
      windowMinutes: 5,
      filters: [{ field: "properties.status_class", value: "5xx" }],
    },
  ].map((rule) => ({
    ...rule,
    name: rule.id,
    description: "",
    thresholdMode: rule.id === "stuck" ? "distinct_count" : "event_count",
    distinctBy: rule.id === "stuck" ? "properties.runId" : null,
    threshold: 5,
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
    ownerEmail: scope.userEmail,
    orgId: scope.orgId,
  }));
  await query(
    `CREATE TABLE ${raw} (id STRING, event_name STRING, event_date DATE, timestamp TIMESTAMP, received_at TIMESTAMP, org_id STRING, owner_email STRING, user_id STRING, properties STRING, context STRING, app STRING, template STRING, user_key STRING, session_id STRING, path STRING)`,
  );
  try {
    const receipts: string[] = [];
    let logical = 0;
    for (const time of [
      "2026-10-08 23:54:00+00",
      "2026-10-08 23:57:00+00",
      "2026-10-09 00:02:00+00",
    ]) {
      for (const rule of rules) {
        for (let index = 0; index < 8; index++) {
          const id = `event-${String(logical++).padStart(3, "0")}`;
          for (const receipt of [0, 1]) {
            const properties = JSON.stringify({
              status_class: receipt ? "5xx" : "2xx",
              status: receipt ? "errored" : "completed",
              deployment_environment: receipt ? "beta" : "production",
              runId: receipt
                ? [
                    null,
                    "",
                    "run-a",
                    "run-a",
                    42,
                    "42",
                    { nested: "run" },
                    "outsider",
                  ][index]
                : `old-${index}`,
            });
            receipts.push(
              `('${id}', '${rule.eventName}', DATE '${time.slice(0, 10)}', TIMESTAMP '${time}', TIMESTAMP '${time.replace(":00+00", `:0${receipt}+00`)}', ${index === 7 ? "'other-org'" : "'synthetic-org'"}, 'synthetic@example.test', 'person@example.org', '${properties}', '{"unused":"payload"}', ${receipt ? "'analytics'" : "'chat'"}, 'analytics', 'user-${index}', 'session-${index}', '/chat')`,
            );
          }
        }
      }
    }
    await query(`INSERT INTO ${raw} VALUES ${receipts.join(",")}`);
    const output = path.resolve("../../.tmp/bq-cost-b");
    await mkdir(output, { recursive: true });
    async function emit(name: string, sql: string) {
      let production = sql;
      for (const [from, to] of [
        [raw, `\`${measurementTable}\``],
        ["'synthetic-org'", "@alert_org"],
        ["'synthetic@example.test'", "@alert_owner"],
        ["DATE '2026-10-09'", "DATE(TIMESTAMP(@window_end))"],
        ["TIMESTAMP('2026-10-09T00:05:00.000Z')", "TIMESTAMP(@window_end)"],
        ["TIMESTAMP ( '2026-10-09T00:05:00.000Z' )", "TIMESTAMP(@window_end)"],
        [
          "TIMESTAMP('2026-10-08T23:55:00.000Z')",
          "TIMESTAMP_SUB(TIMESTAMP(@window_end), INTERVAL 10 MINUTE)",
        ],
        [
          "TIMESTAMP ( '2026-10-08T23:55:00.000Z' )",
          "TIMESTAMP_SUB(TIMESTAMP(@window_end), INTERVAL 10 MINUTE)",
        ],
        [
          "TIMESTAMP('2026-10-09T00:00:00.000Z')",
          "TIMESTAMP_SUB(TIMESTAMP(@window_end), INTERVAL 5 MINUTE)",
        ],
        [
          "TIMESTAMP ( '2026-10-09T00:00:00.000Z' )",
          "TIMESTAMP_SUB(TIMESTAMP(@window_end), INTERVAL 5 MINUTE)",
        ],
      ])
        production = production.split(from).join(to);
      await writeFile(
        path.join(output, `${name}.sql`),
        `SELECT * FROM (${production}) AS first_party_analytics_query LIMIT 5000`,
      );
    }
    const expected = new Map();
    for (const rule of rules) {
      const start = new Date(
        now.getTime() - rule.windowMinutes * 60000,
      ).toISOString();
      const sql = render(
        buildBigQueryAlertQuery(rule, start, now.toISOString()),
      );
      const result = await query(sql);
      const events = result.rows.map((row) => ({
        id: String(row.id),
        eventName: String(row.event_name),
        timestamp: String(row.timestamp),
        properties: String(row.properties),
        app: row.app as string | null,
        template: row.template as string | null,
        userKey: row.user_key as string | null,
        sessionId: row.session_id as string | null,
        path: row.path as string | null,
      }));
      const evaluation = evaluateAnalyticsAlertRuleRows(rule, events);
      expected.set(rule.id, evaluation);
      if (rule.id === "stuck") expect(evaluation.observedValue).toBe(3);
      expect(result.rows.length).toBe(rule.id === "5xx" ? 7 : 14);
      await emit(`before-${rule.id}`, sql);
    }
    const batchSql = buildBigQueryAnalyticsAlertBatchQuery(rules, now);
    expect(batchSql).not.toContain("SELECT *");
    expect(batchSql).not.toContain("context");
    const renderedBatch = render(batchSql);
    expect(renderedBatch).toContain("AND (event_name IN");
    mocks.query.mockImplementation(async (sql: string) => {
      const result = await query(render(sql));
      await writeFile(
        path.join(output, "aggregate.json"),
        JSON.stringify(result.rows),
      );
      return result;
    });
    const actual = await evaluateBigQueryAnalyticsAlertBatch(rules, now);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    for (const rule of rules)
      expect(actual.get(rule.id)).toEqual({
        evaluation: expected.get(rule.id),
      });
    await emit("after-batch", renderedBatch);
  } finally {
    mocks.query.mockReset();
    await query(`DROP TABLE ${raw}`);
  }
}, 120000);
