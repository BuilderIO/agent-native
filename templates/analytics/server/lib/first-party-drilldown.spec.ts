import { createRequire } from "node:module";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildPanel,
  getFirstPartyDrilldown,
} from "./first-party-metric-catalog.js";

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

const FILTERS = {
  timeRange: "",
  emailFilter: "exclude_builder",
  appFilter: "",
};

describe("first-party panel drilldowns", () => {
  let client: PGliteClient | undefined;
  let day = "";
  let nextId = 0;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  async function setup() {
    client = await PGlite.create("memory://");
    day = (
      (await client!.query(
        "SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today",
      )) as { rows: Array<{ today: string }> }
    ).rows[0]!.today;
    await client!.query(`CREATE TABLE analytics_events (
      id text PRIMARY KEY, event_name text NOT NULL, user_id text, anonymous_id text,
      user_key text, session_id text, timestamp text NOT NULL, event_date text,
      app text, template text, hostname text, signed_in text,
      properties text NOT NULL DEFAULT '{}', org_id text DEFAULT 'org-1', owner_email text
    )`);
  }

  async function insert(
    eventName: string,
    visitor: string,
    template: string,
    properties: Record<string, unknown> = {},
  ) {
    await client!.query(
      `INSERT INTO analytics_events
        (id, event_name, user_id, anonymous_id, user_key, timestamp, event_date, app, template, hostname, properties)
       VALUES ($1, $2, $3, $4, $3, $5, $6, $7, $7, 'x.agent-native.com', $8)`,
      [
        `e-${nextId++}`,
        eventName,
        `${visitor}@example.com`,
        `anon-${visitor}`,
        `${day}T12:00:00.000Z`,
        day,
        template,
        JSON.stringify({ auth_user_id: `auth-${visitor}`, ...properties }),
      ],
    );
  }

  async function run(sql: string, extra: Record<string, string> = {}) {
    return (await client!.query(
      interpolate(sql, { ...FILTERS, ...extra }),
    )) as {
      rows: Array<Record<string, unknown>>;
    };
  }

  it("lists exactly the visitors each funnel stage counts", async () => {
    await setup();
    for (const visitor of ["a", "b", "c"]) {
      await insert("auth.signup_viewed", visitor, "clips");
    }
    for (const visitor of ["a", "b"]) {
      await insert("auth.signup_clicked", visitor, "clips", {
        method: "google",
      });
      await insert("signup", visitor, "clips");
    }
    await insert("onboarding_started", "a", "clips");

    const stages = (await run(buildPanel("activation-funnel")!.sql)).rows;
    const funnelPanel = buildPanel("activation-funnel")!;
    const drilldown = getFirstPartyDrilldown(
      funnelPanel.id,
      funnelPanel.source,
      funnelPanel.sql,
    )!;
    for (const { stage, users } of stages as Array<{
      stage: string;
      users: number;
    }>) {
      const rows = (await run(drilldown.sql, { drillX: stage })).rows;
      expect(rows, stage).toHaveLength(Number(users));
    }
    const signedUp = (await run(drilldown.sql, { drillX: "Signed up" })).rows;
    expect(signedUp.map((row) => row.visitor).sort()).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  }, 20_000);

  it("lists the signup events behind each bar and day", async () => {
    await setup();
    await insert("signup", "a", "clips");
    await insert("signup", "b", "clips");
    await insert("signup", "c", "mail");

    const byTemplate = (await run(buildPanel("signups-by-template")!.sql))
      .rows as Array<{ template: string; count: number }>;
    const byTemplatePanel = buildPanel("signups-by-template")!;
    const templateDrill = getFirstPartyDrilldown(
      byTemplatePanel.id,
      byTemplatePanel.source,
      byTemplatePanel.sql,
    )!;
    for (const { template, count } of byTemplate) {
      const rows = (await run(templateDrill.sql, { drillX: template })).rows;
      expect(rows, template).toHaveLength(Number(count));
      expect(Number(rows[0]?.total_matching)).toBe(Number(count));
    }

    const dayPanel = buildPanel("signups-over-time")!;
    const dayDrill = getFirstPartyDrilldown(
      dayPanel.id,
      dayPanel.source,
      dayPanel.sql,
    )!;
    expect((await run(dayDrill.sql, { drillX: day })).rows).toHaveLength(3);
    expect(
      (await run(dayDrill.sql, { drillX: day, drillSeries: "mail" })).rows,
    ).toHaveLength(1);
  }, 20_000);

  it("has no drilldown for panels without one", () => {
    const totalSignupsPanel = buildPanel("total-signups")!;
    expect(getFirstPartyDrilldown("constructor", "first-party", "")).toBeNull();
    expect(
      getFirstPartyDrilldown(
        totalSignupsPanel.id,
        totalSignupsPanel.source,
        totalSignupsPanel.sql,
      ),
    ).toBeNull();
  });

  it("only enables drilldowns for the supported source and catalog SQL", () => {
    const panel = buildPanel("signups-over-time")!;

    expect(getFirstPartyDrilldown(panel.id, "bigquery", panel.sql)).toBeNull();
    expect(
      getFirstPartyDrilldown(panel.id, panel.source, `${panel.sql} LIMIT 10`),
    ).toBeNull();
  });
});
