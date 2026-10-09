import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, it, vi } from "vitest";

const mode = vi.hoisted(() => ({ enabled: true }));
vi.mock("./first-party-analytics-pushdown.js", async (original) => {
  const actual =
    await original<typeof import("./first-party-analytics-pushdown.js")>();
  return {
    firstPartyEventPushdownPredicates: (
      ...args: Parameters<typeof actual.firstPartyEventPushdownPredicates>
    ) =>
      mode.enabled ? actual.firstPartyEventPushdownPredicates(...args) : [],
  };
});

import { buildBigQueryAlertQuery } from "./analytics-alerts.js";
import { renderFirstPartyAnalyticsBigQuerySql } from "./first-party-analytics-backend.js";
import { scopedAnalyticsSql } from "./first-party-analytics.js";

it("preserves alert and panel results on seeded duplicate receipts", async () => {
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
    tableId: `events_${process.pid}`,
    fullyQualified: `example-project.analytics.events_${process.pid}`,
  };
  const raw = `\`${table.fullyQualified}\``;
  async function query(sql: string): Promise<unknown[]> {
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
    ) {
      throw new Error(`Incomplete emulator query: ${JSON.stringify(body)}`);
    }
    const rows = body.rows ?? [];
    if (Number(body.totalRows ?? 0) !== rows.length)
      throw new Error("Emulator result was truncated");
    return rows.map((row: unknown) => JSON.stringify(row)).sort();
  }
  await query(
    `CREATE TABLE ${raw} (id STRING, event_name STRING, event_date DATE, timestamp TIMESTAMP, received_at TIMESTAMP, org_id STRING, owner_email STRING, user_id STRING, properties STRING, app STRING)`,
  );
  try {
    const receipts: string[] = [];
    let logical = 0;
    for (const day of ["2026-10-07", "2026-10-08", "2026-10-09"]) {
      for (const event of [
        "http.response",
        "agent_run_terminal",
        "agent_chat_stuck_detected",
        "app_entered",
      ]) {
        for (let index = 0; index < 8; index++) {
          const id = `event-${logical++}`;
          for (const receipt of [0, 1]) {
            const properties = JSON.stringify({
              status_class: receipt ? "5xx" : "2xx",
              status: receipt ? "errored" : "completed",
              deployment_environment: receipt ? "beta" : "production",
            });
            receipts.push(
              `('${id}', '${event}', DATE '${day}', TIMESTAMP '${day} 00:02:00+00', TIMESTAMP '${day} 00:02:0${receipt}+00', ${index === 7 ? "'other-org'" : "'synthetic-org'"}, 'synthetic@example.test', 'person@example.test', '${properties}', '${receipt ? "analytics" : "chat"}')`,
            );
          }
        }
      }
    }
    await query(`INSERT INTO ${raw} VALUES ${receipts.join(",")}`);
    const scope = {
      userEmail: "synthetic@example.test",
      orgId: "synthetic-org",
    };
    const end = "2026-10-09T00:05:00.000Z";
    const cases: Array<{ name: string; sql: string; expected: number }> = [
      ...[
        {
          name: "5xx",
          eventName: "http.response",
          filters: [{ field: "properties.status_class", value: "5xx" }],
        },
        {
          name: "terminal",
          eventName: "agent_run_terminal",
          filters: [
            { field: "properties.status", value: "errored" },
            { field: "properties.deployment_environment", value: "beta" },
          ],
        },
        { name: "stuck", eventName: "agent_chat_stuck_detected", filters: [] },
      ].map((rule) => ({
        name: rule.name,
        sql: buildBigQueryAlertQuery(
          { ...rule, ownerEmail: scope.userEmail, orgId: scope.orgId },
          "2026-10-08T23:55:00.000Z",
          end,
        ),
        expected: 7,
      })),
      {
        name: "panel",
        sql: "SELECT event_name, COUNT(*) AS count FROM analytics_events WHERE event_date BETWEEN DATE '2026-10-08' AND DATE '2026-10-09' AND event_name IN ('app_entered', 'http.response') GROUP BY event_name",
        expected: 2,
      },
      {
        name: "or",
        sql: "SELECT id FROM analytics_events WHERE event_name = 'http.response' OR app = 'analytics'",
        expected: 84,
      },
      {
        name: "mutable",
        sql: "SELECT id FROM analytics_events WHERE event_date >= DATE '2026-10-09' AND event_name = 'http.response' AND app = 'chat'",
        expected: 0,
      },
    ];
    const output = path.resolve("../../.tmp/bq-cost-a");
    await mkdir(output, { recursive: true });
    for (const test of cases) {
      const scoped = scopedAnalyticsSql(test.sql, scope, "2026-10-09", {
        includeTestIdentities: true,
      });
      mode.enabled = false;
      const before = renderFirstPartyAnalyticsBigQuerySql(
        scoped.sql,
        scoped.args,
        table,
      );
      mode.enabled = true;
      const after = renderFirstPartyAnalyticsBigQuerySql(
        scoped.sql,
        scoped.args,
        table,
      );
      if (["5xx", "terminal", "stuck", "panel"].includes(test.name))
        expect(after).not.toBe(before);
      const oldRows = await query(before);
      const newRows = await query(after);
      expect(oldRows.length, test.name).toBe(test.expected);
      expect(newRows, test.name).toEqual(oldRows);
      for (const [version, sql] of [
        ["before", before],
        ["after", after],
      ]) {
        let production = sql;
        for (const [from, to] of [
          [raw, "`builder-3b0a2.analytics.first_party_analytics_events_raw`"],
          ["'synthetic-org'", "@alert_org"],
          ["'synthetic@example.test'", "@alert_owner"],
          ["DATE '2026-10-09'", "DATE(TIMESTAMP(@window_end))"],
          ["'2026-10-08T23:55:00.000Z'", "@window_start"],
          ["'2026-10-09T00:05:00.000Z'", "@window_end"],
        ])
          production = production.split(from).join(to);
        await writeFile(
          path.join(output, `${version}-${test.name}.sql`),
          `SELECT * FROM (${production}) AS first_party_analytics_query LIMIT 5000`,
        );
      }
    }
    console.log(
      `Emulator equivalence: ${cases.length}/${cases.length} cases; ${receipts.length} receipts, ${logical} ids, including http.response and mutable payloads`,
    );
  } finally {
    mode.enabled = true;
    await query(`DROP TABLE ${raw}`);
  }
}, 120000);
