import { createRequire } from "node:module";

import { afterEach, describe, expect, it } from "vitest";

import { interpolateDashboardPanelSql } from "../../app/pages/adhoc/sql-dashboard/interpolate";
import { buildPanel } from "./first-party-metric-catalog";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

async function createAnalyticsEventsTable(client: PGliteClient) {
  await client.query(`
    CREATE TABLE analytics_events (
      id text PRIMARY KEY,
      event_name text NOT NULL,
      event_date text NOT NULL,
      user_id text,
      app text,
      template text,
      properties jsonb NOT NULL DEFAULT '{}'
    )
  `);
}

function offsetDate(isoDate: string, n: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + n))
    .toISOString()
    .slice(0, 10);
}

async function today(client: PGliteClient): Promise<string> {
  const result = (await client.query(
    "SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today",
  )) as { rows: Array<{ today: string }> };
  return result.rows[0]!.today;
}

async function seedSignup(client: PGliteClient, id: string, date: string) {
  await client.query(
    "INSERT INTO analytics_events (id, event_name, event_date, app, template) VALUES ($1, 'signup', $2, 'analytics', 'analytics')",
    [id, date],
  );
}

describe("signups-over-time panel SQL", () => {
  let client: PGliteClient;

  afterEach(async () => {
    await client?.close();
  });

  it("fills custom range endpoints and days without signups", async () => {
    client = await PGlite.create("memory://");
    await createAnalyticsEventsTable(client);
    const start = offsetDate(await today(client), -20);
    const end = offsetDate(start, 6);
    await seedSignup(client, "signup-1", offsetDate(start, 1));
    await seedSignup(client, "signup-2", offsetDate(start, 4));

    const panel = buildPanel("signups-over-time")!;
    const sql = interpolateDashboardPanelSql(
      panel.sql,
      {
        timeRange: "custom",
        timeRangeStart: start,
        timeRangeEnd: end,
        emailFilter: "",
        appFilter: "",
      },
      panel,
    );
    const rows = (
      (await client.query(sql)) as {
        rows: Array<{ date: string; template: string; count: number }>;
      }
    ).rows;

    expect(rows.map((row) => row.date)).toEqual(
      Array.from({ length: 7 }, (_, n) => offsetDate(start, n)),
    );
    expect(rows.map((row) => Number(row.count))).toEqual([0, 1, 0, 0, 1, 0, 0]);
    expect(new Set(rows.map((row) => row.template))).toEqual(
      new Set(["analytics"]),
    );
  });

  it("returns zero rows for a custom range with no signup events", async () => {
    client = await PGlite.create("memory://");
    await createAnalyticsEventsTable(client);
    const start = offsetDate(await today(client), -20);
    const end = offsetDate(start, 2);

    const panel = buildPanel("signups-over-time")!;
    const sql = interpolateDashboardPanelSql(
      panel.sql,
      {
        timeRange: "custom",
        timeRangeStart: start,
        timeRangeEnd: end,
        emailFilter: "",
        appFilter: "",
      },
      panel,
    );
    const rows = (
      (await client.query(sql)) as {
        rows: Array<{ date: string; template: string; count: number }>;
      }
    ).rows;

    expect(rows).toEqual([
      { date: start, template: "unknown", count: 0 },
      { date: offsetDate(start, 1), template: "unknown", count: 0 },
      { date: end, template: "unknown", count: 0 },
    ]);
  });
});
