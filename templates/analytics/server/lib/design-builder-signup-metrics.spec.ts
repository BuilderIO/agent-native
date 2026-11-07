import { createRequire } from "node:module";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertFirstPartyAnalyticsBigQuerySql,
  renderFirstPartyAnalyticsBigQueryRequestSql,
} from "./first-party-analytics-backend.js";
import {
  validateFirstPartyAnalyticsSql,
  scopedAnalyticsSql,
} from "./first-party-analytics.js";
import { buildPanel } from "./first-party-metric-catalog.js";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
type Database = Awaited<ReturnType<typeof PGlite.create>>;
const KEYS = [
  "design-builder-signup-ab",
  "design-builder-signup-outcomes",
  "design-builder-signup-tracking-health",
] as const;
const EXPERIMENT = "design_builder_signup_v1";
let db: Database;
let nextId = 0;
let now: number;

function panel(key: string) {
  const value = buildPanel(key);
  if (!value) throw new Error(`Metric missing: ${key}`);
  return value;
}
function sql(key: string) {
  return panel(key).sql.replace(
    /{{\s*([A-Za-z0-9_]+)\s*}}/g,
    (_match, key: string) =>
      ({
        timeRange: "30d",
        emailFilter: "all",
        appFilter: "design",
        timeRangeStart: new Date(now - 30 * 86400000)
          .toISOString()
          .slice(0, 10),
        timeRangeEnd: new Date(now).toISOString().slice(0, 10),
      })[key] ?? "",
  );
}
async function event(
  name: string,
  hoursAgo: number,
  assignment?: string,
  variant = "automatic",
  user?: string,
  extra: Record<string, unknown> = {},
  hostname = "design.agent-native.com",
) {
  const at = new Date(now - hoursAgo * 3600000).toISOString();
  const properties = {
    ...(assignment
      ? {
          experiment_id: EXPERIMENT,
          experiment_variant: variant,
          assignment_id: assignment,
        }
      : {}),
    ...(user ? { auth_user_id: user } : {}),
    ...extra,
  };
  await db.query(
    "INSERT INTO analytics_events (id,event_name,timestamp,event_date,app,template,properties,user_id,hostname) VALUES ($1,$2,$3,$4,'design','design',$5,$6,$7)",
    [
      `event-${nextId++}`,
      name,
      at,
      at.slice(0, 10),
      JSON.stringify(properties),
      user ?? null,
      hostname,
    ],
  );
}

beforeEach(async () => {
  now = Date.now();
  nextId = 0;
  db = await PGlite.create("memory://");
  await db.query(
    `CREATE TABLE analytics_events (id text, event_name text, timestamp text, event_date text, app text, template text, properties text, user_id text, user_key text, anonymous_id text, hostname text, received_at text)`,
  );
});
afterEach(async () => {
  await db.close();
});

describe("Design Builder signup experiment metrics", () => {
  it("keeps person-linked milestones in the exposure environment", async () => {
    await event("auth.builder_signup_experiment_exposed", 72, "prod-person");
    await event(
      "builder_signup_experiment_enrolled",
      71,
      "prod-person",
      "automatic",
      "shared-person",
    );
    for (const hostname of ["beta.design.agent-native.com", ""]) {
      await event(
        "design_prompt_submitted",
        70,
        undefined,
        "automatic",
        "shared-person",
        {},
        hostname,
      );
      await event(
        "design_ready_viewed",
        69,
        undefined,
        "automatic",
        "shared-person",
        {},
        hostname,
      );
      await event(
        "pageview",
        40,
        undefined,
        "automatic",
        "shared-person",
        {},
        hostname,
      );
    }
    const result = await db.query(sql(KEYS[0]));
    const row = result.rows.find(
      (value: Record<string, unknown>) =>
        value.environment === "production" && value.variant === "automatic",
    );
    expect(row).toMatchObject({
      exposed_visitors: 1,
      signed_up_24h: 1,
      first_prompt_24h: 0,
      first_design_24h: 0,
      d1_return_rate: 0,
    });
    await event(
      "design_ready_viewed",
      68,
      undefined,
      "automatic",
      "shared-person",
    );
    const positive = await db.query(sql(KEYS[0]));
    expect(
      positive.rows.find(
        (value: Record<string, unknown>) =>
          value.environment === "production" && value.variant === "automatic",
      ).first_design_24h,
    ).toBe(1);
  });

  it("surfaces ambiguous historical outcome links using the enrollment eligibility rules", async () => {
    await event(
      "auth.builder_signup_experiment_exposed",
      48,
      "legacy-ambiguous",
    );
    for (const user of ["person-a", "person-b"]) {
      await event(
        "builder_signup_experiment_outcome",
        47,
        "legacy-ambiguous",
        "automatic",
        user,
        { status: "fallback", code: "account_exists" },
      );
    }
    const quality = (await db.query(sql(KEYS[2]))).rows;
    expect(quality).toContainEqual({
      metric:
        "Assignments linked to multiple people (excluded from signup milestones)",
      count: 1,
    });
  });

  it("does not mature historical cohorts beyond the selected observation window", async () => {
    const end = new Date(now - 5 * 86400000).toISOString().slice(0, 10);
    await event(
      "auth.builder_signup_experiment_exposed",
      9 * 24 + 1,
      "historical",
    );
    const query = sql("design-builder-signup-ab")
      .split(new Date(now).toISOString().slice(0, 10))
      .join(end);
    const result = await db.query(query);
    const row = result.rows.find(
      (value: Record<string, unknown>) =>
        value.environment === "production" && value.variant === "automatic",
    );
    expect(Number(row.exposed_visitors)).toBe(1);
    expect(Number(row.d7_eligible)).toBe(0);
    expect(row.d7_return_rate).toBeNull();
  });

  it("retains abandoners, deduplicates assignments and outcomes, and joins authenticated milestones in order", async () => {
    await event(
      "auth.builder_signup_experiment_exposed",
      240,
      "control-ready",
      "control",
    );
    await event(
      "auth.builder_signup_experiment_exposed",
      239.9,
      "control-ready",
      "control",
    );
    await event(
      "builder_signup_experiment_outcome",
      239,
      "control-ready",
      "control",
      "control-person",
      { status: "control" },
    );
    await event(
      "builder connect succeeded",
      238,
      undefined,
      "control",
      "control-person",
    );
    await event(
      "design_prompt_submitted",
      237,
      undefined,
      "control",
      "control-person",
    );
    await event(
      "design_ready_viewed",
      236,
      undefined,
      "control",
      "control-person",
    );
    await event(
      "auth.builder_signup_experiment_exposed",
      240,
      "control-abandoned",
      "control",
    );
    await event("auth.builder_signup_experiment_exposed", 240, "auto-ready");
    await event(
      "builder_signup_experiment_enrolled",
      239,
      "auto-ready",
      "automatic",
      "auto-person",
    );
    await event(
      "builder_signup_experiment_outcome",
      238,
      "auto-ready",
      "automatic",
      "auto-person",
      { status: "fallback", code: "activation_interrupted" },
    );
    await event(
      "builder_signup_experiment_outcome",
      237,
      "auto-ready",
      "automatic",
      "auto-person",
      { status: "connected" },
    );
    await event(
      "builder_signup_experiment_outcome",
      236,
      "auto-ready",
      "automatic",
      "auto-person",
      { status: "connected", replayed: true },
    );
    await event(
      "design_ready_viewed",
      241,
      undefined,
      "automatic",
      "auto-person",
    );
    await event(
      "design_prompt_submitted",
      235,
      undefined,
      "automatic",
      "auto-person",
    );
    await event(
      "design_ready_viewed",
      234,
      undefined,
      "automatic",
      "auto-person",
    );
    await event("pageview", 210, undefined, "automatic", "auto-person");
    await event("pageview", 60, undefined, "automatic", "auto-person");
    await event("auth.builder_signup_experiment_exposed", 6, "auto-recent");
    await event(
      "builder_signup_experiment_enrolled",
      5.9,
      "auto-recent",
      "automatic",
      "recent-person",
    );
    await event(
      "builder_signup_experiment_activation_started",
      5.8,
      "auto-recent",
      "automatic",
      "recent-person",
    );
    await event(
      "design_ready_viewed",
      5,
      undefined,
      "automatic",
      "recent-person",
    );
    await event(
      "auth.builder_signup_experiment_exposed",
      240,
      "auto-ambiguous",
    );
    await event(
      "builder_signup_experiment_enrolled",
      239,
      "auto-ambiguous",
      "automatic",
      "one-person",
    );
    await event(
      "builder_signup_experiment_enrolled",
      239,
      "auto-ambiguous",
      "automatic",
      "other-person",
    );
    await event(
      "design_ready_viewed",
      238,
      undefined,
      "automatic",
      "one-person",
    );
    await event(
      "builder_signup_experiment_unattributed",
      5,
      undefined,
      "automatic",
      "recent-person",
      { code: "assignment_missing" },
    );

    const { rows } = await db.query(sql(KEYS[0]));
    const automatic = rows.find(
      (row: Record<string, unknown>) =>
        row.variant === "automatic" && row.environment === "production",
    );
    const control = rows.find(
      (row: Record<string, unknown>) =>
        row.variant === "control" && row.environment === "production",
    );
    expect(control).toMatchObject({
      exposed_visitors: 2,
      signed_up_24h: 1,
      builder_connected_24h: 1,
      first_prompt_24h: 1,
      first_design_24h: 1,
      first_design_rate: 0.5,
    });
    expect(automatic).toMatchObject({
      exposed_visitors: 3,
      signed_up_24h: 2,
      builder_connected_24h: 1,
      first_prompt_24h: 1,
      first_design_24h: 2,
      mature_24h_visitors: 2,
      mature_first_design_rate: 0.5,
      d1_eligible: 2,
      d1_return_rate: 0.5,
      d7_eligible: 2,
      d7_return_rate: 0.5,
    });
    const outcomes = (await db.query(sql(KEYS[1]))).rows;
    expect(outcomes).toContainEqual({
      environment: "production",
      variant: "automatic",
      status: "connected",
      code: "connected",
      visitors: 1,
    });
    expect(outcomes).toContainEqual({
      environment: "production",
      variant: "automatic",
      status: "not_recorded",
      code: "not_recorded",
      visitors: 2,
    });
    const quality = (await db.query(sql(KEYS[2]))).rows;
    expect(quality).toContainEqual({
      metric:
        "Assignments linked to multiple people (excluded from signup milestones)",
      count: 1,
    });
    expect(quality).toContainEqual({
      metric: "Activation attempts without a recorded outcome",
      count: 1,
    });
    expect(quality).toContainEqual({
      metric: "Unattributed activation requests",
      count: 1,
    });
    for (const key of KEYS) {
      const p = panel(key);
      const result = await db.query(sql(key));
      expect(p.title.trim()).not.toBe("");
      const columns = p.config.columns as Array<{ key: string; label: string }>;
      for (const column of columns) {
        expect(column.label.trim()).not.toBe("");
        expect(result.rows[0]).toHaveProperty(column.key);
      }
    }
  });

  it("keeps beta traffic separate and removes known employees from both sides of the cohort join", async () => {
    await event(
      "auth.builder_signup_experiment_exposed",
      72,
      "employee",
      "control",
    );
    await event(
      "builder_signup_experiment_enrolled",
      71,
      "employee",
      "control",
      "member@builder.io",
    );
    await event(
      "design_ready_viewed",
      70,
      undefined,
      "control",
      "member@builder.io",
    );
    await event(
      "auth.builder_signup_experiment_exposed",
      70,
      "employee-later",
      "automatic",
    );
    await event(
      "builder_signup_experiment_enrolled",
      69,
      "employee-later",
      "automatic",
      "member@builder.io",
    );
    await event(
      "auth.builder_signup_experiment_exposed",
      72,
      "beta-visitor",
      "automatic",
      undefined,
      {},
      "beta.design.agent-native.com",
    );
    await event(
      "builder_signup_experiment_enrolled",
      71,
      "beta-visitor",
      "automatic",
      "beta-person",
      {},
      "beta.design.agent-native.com",
    );
    await event(
      "design_ready_viewed",
      70,
      undefined,
      "automatic",
      "beta-person",
      {},
      "beta.design.agent-native.com",
    );
    await event(
      "auth.builder_signup_experiment_exposed",
      72,
      "mixed-employees",
      "automatic",
    );
    await event(
      "builder_signup_experiment_enrolled",
      71,
      "mixed-employees",
      "automatic",
      "second@builder.io",
    );
    await event(
      "builder_signup_experiment_enrolled",
      70,
      "mixed-employees",
      "automatic",
      "external@example.com",
    );
    await event(
      "auth.builder_signup_experiment_exposed",
      72,
      "returning-employee",
      "automatic",
    );
    await event(
      "builder_signup_experiment_outcome",
      71,
      "returning-employee",
      "automatic",
      "returning@builder.io",
      { status: "fallback", code: "signup_attempt_unbound" },
    );
    const filtered = sql(KEYS[0]);
    const excludingEmployees = panel(KEYS[0]).sql.replace(
      /{{\s*([A-Za-z0-9_]+)\s*}}/g,
      (_match, key: string) =>
        ({
          timeRange: "30d",
          emailFilter: "exclude_builder",
          appFilter: "design",
          timeRangeStart: new Date(now - 30 * 86400000)
            .toISOString()
            .slice(0, 10),
          timeRangeEnd: new Date(now).toISOString().slice(0, 10),
        })[key] ?? "",
    );
    const allRows = (await db.query(filtered)).rows;
    expect(
      allRows.find(
        (row: Record<string, unknown>) =>
          row.environment === "production" && row.variant === "control",
      ),
    ).toMatchObject({ exposed_visitors: 1, first_design_24h: 1 });
    expect(
      allRows.find(
        (row: Record<string, unknown>) =>
          row.environment === "production" && row.variant === "automatic",
      ),
    ).toMatchObject({ exposed_visitors: 3, signed_up_24h: 0 });
    const rows = (await db.query(excludingEmployees)).rows;
    expect(
      rows.find(
        (row: Record<string, unknown>) =>
          row.environment === "production" && row.variant === "control",
      ),
    ).toMatchObject({ exposed_visitors: 0, first_design_24h: 0 });
    expect(
      rows.find(
        (row: Record<string, unknown>) =>
          row.environment === "beta" && row.variant === "automatic",
      ),
    ).toMatchObject({ exposed_visitors: 1, first_design_24h: 1 });
    expect(
      rows.find(
        (row: Record<string, unknown>) =>
          row.environment === "production" && row.variant === "automatic",
      ),
    ).toMatchObject({ exposed_visitors: 0, first_design_24h: 0 });
  });

  it("shows zero exposure with unknown rates rather than inventing conversions", async () => {
    const { rows } = await db.query(sql(KEYS[0]));
    expect(rows).toHaveLength(6);
    for (const row of rows)
      expect(row).toMatchObject({
        exposed_visitors: 0,
        signed_up_24h: 0,
        first_design_24h: 0,
        first_design_rate: null,
        mature_first_design_rate: null,
        d1_return_rate: null,
        d7_return_rate: null,
      });
    for (const row of (await db.query(sql(KEYS[1]))).rows)
      expect(row).toMatchObject({ status: "not_recorded", visitors: 0 });
    for (const row of (await db.query(sql(KEYS[2]))).rows)
      expect(row).toMatchObject({ count: 0 });
  });

  it.each(KEYS)(
    "validates the scoped %s panel for the first-party warehouse",
    async (key) => {
      const query = sql(key);
      expect(() => validateFirstPartyAnalyticsSql(query)).not.toThrow();
      expect(() => assertFirstPartyAnalyticsBigQuerySql(query)).not.toThrow();
      const scoped = scopedAnalyticsSql(query, {
        userEmail: "owner@example.test",
        orgId: "example-org",
      });
      const rendered = renderFirstPartyAnalyticsBigQueryRequestSql(
        scoped.sql,
        scoped.args,
        {
          projectId: "example-project",
          datasetId: "analytics",
          tableId: "events",
          fullyQualified: "example-project.analytics.events",
        },
      );
      const sources = rendered
        .split("`example-project.analytics.events`")
        .slice(1);
      expect(sources.length).toBeGreaterThan(0);
      for (const source of sources) {
        const beforeDeduplication = source.split("QUALIFY")[0];
        expect(beforeDeduplication).toMatch(/event_date\s*>=\s*DATE\s*'/);
        expect(beforeDeduplication).toContain("event_name IN");
      }
      expect(rendered).not.toContain("INTERVAL '");
    },
  );
});
