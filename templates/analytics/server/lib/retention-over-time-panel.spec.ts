import { createRequire } from "node:module";

import { afterEach, describe, expect, it } from "vitest";

import { interpolateDashboardPanelSql } from "../../app/pages/adhoc/sql-dashboard/interpolate";
import { buildPanel } from "./first-party-metric-catalog";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

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
  template = "chat",
  authUserId: string | null = userKey,
) {
  const rowId = `row-${nextRowId++}`;
  await client.query(
    `INSERT INTO analytics_events (id, event_name, user_id, user_key, timestamp, event_date, template, properties)
     VALUES ($1, 'run_started', $2, $3, $4, $4, $5, $6)`,
    [
      rowId,
      `${userKey}@example.com`,
      userKey,
      date,
      template,
      JSON.stringify({
        thread_id: `thread-${rowId}`,
        attempt_id: `attempt-${rowId}`,
        ...(authUserId ? { auth_user_id: authUserId } : {}),
      }),
    ],
  );
}

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
    const cohortAReturnDay3 = offsetDate(cohortADate, -3);
    const cohortAReturnDay10 = offsetDate(cohortADate, -10);
    const cohortBDate = offsetDate(today, 10);

    for (const userKey of ["a1", "a2", "a3", "a4", "a5"]) {
      await seedFirstSeenEvent(client, userKey, cohortADate);
    }
    for (const userKey of ["a1", "a2", "a3"]) {
      await seedFirstSeenEvent(client, userKey, cohortAReturnDay3);
    }
    for (const userKey of ["a4", "a5"]) {
      await seedFirstSeenEvent(client, userKey, cohortAReturnDay10);
    }

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

  it("scopes both current activity and prior cohort history to the selected App", async () => {
    client = await PGlite.create("memory://");
    await createAnalyticsEventsTable(client);
    const today = (
      (await client.query(
        "SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today",
      )) as { rows: Array<{ today: string }> }
    ).rows[0]!.today;
    const cohortDate = offsetDate(today, 20);
    const returnDate = offsetDate(today, 17);
    const priorDate = offsetDate(today, 40);

    for (let index = 0; index < 5; index++) {
      await seedFirstSeenEvent(client, `chat-${index}`, cohortDate);
      await seedFirstSeenEvent(client, `chat-${index}`, priorDate, "mail");
      await seedFirstSeenEvent(client, `mail-${index}`, cohortDate, "mail");
      await seedFirstSeenEvent(client, `mail-${index}`, returnDate, "mail");
      if (index < 3) {
        await seedFirstSeenEvent(client, `chat-${index}`, returnDate);
      }
    }

    const sql = interpolate(buildPanel("retention-over-time")!.sql, {
      timeRange: "custom",
      timeRangeStart: cohortDate,
      timeRangeEnd: returnDate,
      emailFilter: "all",
      appFilter: "chat",
    });
    const rows = (
      (await client.query(sql)) as {
        rows: Array<{
          date: string;
          period: string;
          cohort_users: number;
          retained_users: number;
          rate: number;
        }>;
      }
    ).rows;
    expect(
      rows.find(
        (row) => row.date === cohortDate && row.period === "1-7d return",
      ),
    ).toMatchObject({ cohort_users: 5, retained_users: 3, rate: 0.6 });
  });

  it("counts server-started chats, ignores passive sessions, and joins changed emails by auth identity", async () => {
    client = await PGlite.create("memory://");
    await createAnalyticsEventsTable(client);
    const today = (
      (await client.query(
        "SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today",
      )) as { rows: Array<{ today: string }> }
    ).rows[0]!.today;
    const cohortDate = offsetDate(today, 20);
    const returnDate = offsetDate(cohortDate, -3);

    for (let index = 0; index < 5; index++) {
      await seedFirstSeenEvent(
        client,
        `user-${index}`,
        cohortDate,
        "chat",
        `auth-${index}`,
      );
    }
    await seedFirstSeenEvent(
      client,
      "changed-email",
      returnDate,
      "chat",
      "auth-0",
    );
    await client.query(
      `INSERT INTO analytics_events (id, event_name, user_id, user_key, timestamp, event_date, template, signed_in)
       VALUES ('passive-session', 'session status', 'passive@example.com', 'passive', $1, $1, 'chat', 'true')`,
      [cohortDate],
    );

    const sql = interpolate(buildPanel("retention-over-time")!.sql, {
      timeRange: "",
      emailFilter: "",
      appFilter: "",
    });
    const rows = (
      (await client.query(sql)) as {
        rows: Array<{
          date: string;
          period: string;
          cohort_users: number;
          retained_users: number | null;
          rate: number | null;
        }>;
      }
    ).rows;
    expect(
      rows.find(
        (row) => row.date === cohortDate && row.period === "1-7d return",
      ),
    ).toMatchObject({ cohort_users: 5, retained_users: 1, rate: 0.2 });
  });

  it("requires auth_user_id and uses it as the cohort key", async () => {
    client = await PGlite.create("memory://");
    await createAnalyticsEventsTable(client);
    const today = (
      (await client.query(
        "SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today",
      )) as { rows: Array<{ today: string }> }
    ).rows[0]!.today;
    const cohortDate = offsetDate(today, 20);
    const returnDate = offsetDate(cohortDate, -3);

    for (let index = 0; index < 5; index++) {
      await seedFirstSeenEvent(
        client,
        `session-${index}`,
        cohortDate,
        "chat",
        `auth-${index}`,
      );
      await seedFirstSeenEvent(
        client,
        `changed-session-${index}`,
        returnDate,
        "chat",
        `auth-${index}`,
      );
      await seedFirstSeenEvent(
        client,
        `anonymous-${index}`,
        cohortDate,
        "chat",
        null,
      );
    }

    const sql = interpolate(buildPanel("retention-over-time")!.sql, {
      timeRange: "",
      emailFilter: "",
      appFilter: "",
    });
    const rows = (
      (await client.query(sql)) as {
        rows: Array<{
          date: string;
          period: string;
          cohort_users: number;
          retained_users: number | null;
          rate: number | null;
        }>;
      }
    ).rows;

    expect(
      rows.find(
        (row) => row.date === cohortDate && row.period === "1-7d return",
      ),
    ).toMatchObject({ cohort_users: 5, retained_users: 5, rate: 1 });
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

    expect(dates).toEqual(
      Array.from({ length: 8 }, (_, n) => offsetDate(today, 7 - n)),
    );
  });

  it("keeps preset cohorts' first-seen history beyond the selected spine", async () => {
    client = await PGlite.create("memory://");
    await createAnalyticsEventsTable(client);

    const today = (
      (await client.query(
        "SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today",
      )) as { rows: Array<{ today: string }> }
    ).rows[0]!.today;
    const firstSeen = offsetDate(today, 50);
    const returnDate = offsetDate(today, 20);
    for (const userKey of ["p1", "p2", "p3", "p4", "p5"]) {
      await seedFirstSeenEvent(client, userKey, firstSeen);
      await seedFirstSeenEvent(client, userKey, returnDate);
    }

    const panel = buildPanel("retention-over-time")!;
    const sql = interpolate(panel.sql, {
      timeRange: "30d",
      emailFilter: "",
      appFilter: "",
    });
    const rows = (
      (await client.query(sql)) as {
        rows: Array<{ date: string; period: string; cohort_users: number }>;
      }
    ).rows;
    const row = rows.find(
      (candidate) =>
        candidate.date === returnDate && candidate.period === "1-7d return",
    );

    expect(row?.cohort_users).toBe(0);
  });

  it("keeps the oldest 365d anchor's trailing cohort inside the base lookback", async () => {
    client = await PGlite.create("memory://");
    await createAnalyticsEventsTable(client);

    const today = (
      (await client.query(
        "SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today",
      )) as { rows: Array<{ today: string }> }
    ).rows[0]!.today;
    const oldestAnchor = offsetDate(today, 365);
    const cohortDate = offsetDate(today, 368);
    for (const userKey of ["o1", "o2", "o3", "o4", "o5"]) {
      await seedFirstSeenEvent(client, userKey, cohortDate);
      await seedFirstSeenEvent(client, userKey, oldestAnchor);
    }

    const panel = buildPanel("retention-over-time")!;
    const sql = interpolate(panel.sql, {
      timeRange: "365d",
      emailFilter: "",
      appFilter: "",
    });
    const rows = (
      (await client.query(sql)) as {
        rows: Array<{
          date: string;
          period: string;
          cohort_users: number;
          rate: number | null;
        }>;
      }
    ).rows;
    const row = rows.find(
      (r) => r.date === oldestAnchor && r.period === "1-7d return",
    );
    expect(row?.cohort_users).toBe(5);
    expect(row?.rate).toBe(1);
  });

  it("runs custom historical dates across the full range and return windows", async () => {
    client = await PGlite.create("memory://");
    await createAnalyticsEventsTable(client);

    const today = (
      (await client.query(
        "SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today",
      )) as { rows: Array<{ today: string }> }
    ).rows[0]!.today;
    const start = offsetDate(today, 1_000);
    const end = offsetDate(today, 995);
    const returnDay3 = offsetDate(start, -3);
    const returnDay10 = offsetDate(start, -10);

    for (const userKey of ["c1", "c2", "c3", "c4", "c5"]) {
      await seedFirstSeenEvent(client, userKey, start);
    }
    for (const userKey of ["c1", "c2", "c3"]) {
      await seedFirstSeenEvent(client, userKey, returnDay3);
    }
    for (const userKey of ["c4", "c5"]) {
      await seedFirstSeenEvent(client, userKey, returnDay10);
    }
    for (const userKey of ["r1", "r2", "r3", "r4", "r5"]) {
      await seedFirstSeenEvent(client, userKey, offsetDate(start, 100));
      await seedFirstSeenEvent(client, userKey, start);
    }

    const panel = buildPanel("retention-over-time")!;
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
    expect(sql).not.toContain("__unsupported_custom_date_range__");

    type RetentionRow = {
      date: string;
      period: string;
      retained_users: number | null;
      cohort_users: number;
      rate: number | null;
    };
    const rows = ((await client.query(sql)) as { rows: RetentionRow[] }).rows;
    expect([...new Set(rows.map((row) => row.date))].sort()).toEqual(
      Array.from({ length: 6 }, (_, n) => offsetDate(start, -n)),
    );

    const startWeek = rows.find(
      (row) => row.date === start && row.period === "1-7d return",
    );
    const startFortnight = rows.find(
      (row) => row.date === start && row.period === "7-14d return",
    );
    expect(startWeek?.cohort_users).toBe(5);
    expect(startWeek?.rate).toBe(0.6);
    expect(startFortnight?.cohort_users).toBe(5);
    expect(startFortnight?.rate).toBe(0.4);
  });

  it("bounds wide custom source scans to the capped spine and its lookbacks", async () => {
    client = await PGlite.create("memory://");
    await createAnalyticsEventsTable(client);

    const today = (
      (await client.query(
        "SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today",
      )) as { rows: Array<{ today: string }> }
    ).rows[0]!.today;
    const start = offsetDate(today, 5_000);
    const spineStart = offsetDate(today, 3_659);
    const outsideHistory = offsetDate(spineStart, 500);
    const returnDay3 = offsetDate(spineStart, -3);
    const returnDay10 = offsetDate(spineStart, -10);

    for (const userKey of ["w1", "w2", "w3", "w4", "w5"]) {
      await seedFirstSeenEvent(client, userKey, outsideHistory);
      await seedFirstSeenEvent(client, userKey, spineStart);
    }
    for (const userKey of ["w1", "w2", "w3"]) {
      await seedFirstSeenEvent(client, userKey, returnDay3);
    }
    for (const userKey of ["w4", "w5"]) {
      await seedFirstSeenEvent(client, userKey, returnDay10);
    }

    const panel = buildPanel("retention-over-time")!;
    const sql = interpolate(panel.sql, {
      timeRange: "custom",
      timeRangeStart: start,
      timeRangeEnd: today,
      emailFilter: "",
      appFilter: "",
    });

    type RetentionRow = {
      date: string;
      period: string;
      cohort_users: number;
      rate: number | null;
    };
    const rows = ((await client.query(sql)) as { rows: RetentionRow[] }).rows;
    const dates = [...new Set(rows.map((row) => row.date))].sort();
    expect(dates).toHaveLength(3_660);
    expect(dates[0]).toBe(spineStart);
    expect(dates[dates.length - 1]).toBe(today);
    const firstDay = (period: string) =>
      rows.find((row) => row.date === spineStart && row.period === period);

    expect(firstDay("1-7d return")?.cohort_users).toBe(5);
    expect(firstDay("1-7d return")?.rate).toBe(0.6);
    expect(firstDay("7-14d return")?.cohort_users).toBe(5);
    expect(firstDay("7-14d return")?.rate).toBe(0.4);
  });
});
