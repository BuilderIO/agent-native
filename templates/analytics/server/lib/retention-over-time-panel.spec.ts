import { createRequire } from "node:module";

import { afterEach, describe, expect, it } from "vitest";

import { buildPanel } from "./first-party-metric-catalog";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

/**
 * `{{timeRange}}`/`{{emailFilter}}`/`{{appFilter}}` are substituted textually
 * before the panel SQL reaches Postgres (see `dashboard-catalog.spec.ts`'s
 * identical helper) — empty strings resolve every "IN ('', 'all')" branch to
 * the unfiltered default.
 */
function interpolate(sql: string, values: Record<string, string>): string {
  return sql.replace(
    /{{\s*([A-Za-z0-9_]+)\s*}}/g,
    (_match, key: string) => values[key] ?? "",
  );
}

async function createAnalyticsEventsTable(client: PGliteClient) {
  await client.query(`
    CREATE TABLE analytics_events (
      id text PRIMARY KEY,
      event_name text NOT NULL,
      user_id text,
      user_key text,
      timestamp text NOT NULL,
      event_date text,
      app text,
      template text,
      signed_in text,
      properties text NOT NULL DEFAULT '{}'
    )
  `);
}

let nextRowId = 0;
async function seedFirstSeenEvent(
  client: PGliteClient,
  userKey: string,
  date: string,
) {
  await client.query(
    `INSERT INTO analytics_events (id, event_name, user_id, user_key, timestamp, event_date, template, signed_in)
     VALUES ($1, 'session status', $2, $3, $4, $4, 'chat', 'true')`,
    [`row-${nextRowId++}`, `${userKey}@example.com`, userKey, date],
  );
}

/** `n` days before `isoDate`, computed on the date string (no local-tz drift). */
function offsetDate(isoDate: string, n: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const ms = Date.UTC(year, month - 1, day) - n * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

describe("retention-over-time panel SQL", () => {
  let client: PGliteClient;

  afterEach(async () => {
    await client?.close();
  });

  it("emits a full date spine with independently maturing 1-7d/7-14d rates instead of zero-filling immature days", async () => {
    client = await PGlite.create("memory://");
    await createAnalyticsEventsTable(client);

    const today = (
      (await client.query(
        "SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today",
      )) as { rows: Array<{ today: string }> }
    ).rows[0]!.today;
    const yesterday = offsetDate(today, 1);
    const cohortADate = offsetDate(today, 20);
    const cohortAReturnDay3 = offsetDate(cohortADate, -3); // 1-7d window
    const cohortAReturnDay10 = offsetDate(cohortADate, -10); // 7-14d window
    const cohortBDate = offsetDate(today, 10);

    // Cohort A: 5 users first seen 20 days ago. 3 return within the 1-7d
    // window (day 3), 2 return within the 7-14d window (day 10).
    for (const userKey of ["a1", "a2", "a3", "a4", "a5"]) {
      await seedFirstSeenEvent(client, userKey, cohortADate);
    }
    for (const userKey of ["a1", "a2", "a3"]) {
      await seedFirstSeenEvent(client, userKey, cohortAReturnDay3);
    }
    for (const userKey of ["a4", "a5"]) {
      await seedFirstSeenEvent(client, userKey, cohortAReturnDay10);
    }

    // Cohort B: 5 users first seen 10 days ago (no returns) — exercises the
    // 1-7d-matured/7-14d-not-yet-matured boundary on its own anchor date,
    // which cohort A's rolling window never reaches.
    for (const userKey of ["b1", "b2", "b3", "b4", "b5"]) {
      await seedFirstSeenEvent(client, userKey, cohortBDate);
    }

    const panel = buildPanel("retention-over-time")!;
    const sql = interpolate(panel.sql, {
      timeRange: "",
      emailFilter: "",
      appFilter: "",
    });
    type RetentionRow = {
      date: string;
      period: string;
      retained_users: number | null;
      cohort_users: number;
      rate: number | null;
    };
    const rows = ((await client.query(sql)) as { rows: RetentionRow[] }).rows;

    function row(date: string, period: string) {
      const match = rows.find(
        (r: RetentionRow) => r.date === date && r.period === period,
      );
      expect(match, `expected a row for ${date} / ${period}`).toBeDefined();
      return match!;
    }

    for (const date of [today, yesterday]) {
      expect(row(date, "1-7d return").rate).toBeNull();
      expect(row(date, "7-14d return").rate).toBeNull();
    }

    expect(row(cohortADate, "1-7d return").rate).not.toBeNull();
    expect(row(cohortADate, "1-7d return").cohort_users).toBe(5);
    expect(row(cohortADate, "7-14d return").rate).not.toBeNull();
    expect(row(cohortADate, "7-14d return").cohort_users).toBe(5);

    expect(row(cohortBDate, "1-7d return").rate).not.toBeNull();
    expect(row(cohortBDate, "7-14d return").rate).toBeNull();
  });

  it("sizes a bounded spine to the same calendar days as the shared time-range filter", async () => {
    client = await PGlite.create("memory://");
    await createAnalyticsEventsTable(client);

    const today = (
      (await client.query(
        "SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today",
      )) as { rows: Array<{ today: string }> }
    ).rows[0]!.today;

    const panel = buildPanel("retention-over-time")!;
    const sql = interpolate(panel.sql, {
      timeRange: "7d",
      emailFilter: "",
      appFilter: "",
    });
    const rows = (
      (await client.query(sql)) as { rows: Array<{ date: string }> }
    ).rows;
    const dates = [...new Set(rows.map((r) => r.date))].sort();

    // `dashboardTimeRangeFilter` admits `event_date >= CURRENT_DATE - 7 days`
    // through today: eight calendar days, oldest one inclusive.
    expect(dates).toEqual(
      Array.from({ length: 8 }, (_, n) => offsetDate(today, 7 - n)),
    );
  });
});
