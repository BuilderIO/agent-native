import { createRequire } from "node:module";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { TrafficEnvironment } from "../../shared/traffic-environment";
import {
  scopedAnalyticsSql,
  validateFirstPartyAnalyticsSql,
} from "./first-party-analytics";
import { renderFirstPartyAnalyticsBigQuerySql } from "./first-party-analytics-backend";
import { readTrafficCounts, trafficCountsSql } from "./traffic-environment";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");

const scope = { userEmail: "owner@example.com", orgId: "org-1" };
const today = "2026-11-04";
const bigQueryTable = {
  projectId: "example-project",
  datasetId: "analytics",
  tableId: "events",
  fullyQualified: "example-project.analytics.events",
};

const EVENT_COLUMNS =
  "id, event_name, user_id, user_key, anonymous_id, timestamp, event_date, received_at, hostname, app, template, properties, owner_email, org_id";

describe("first-party reads filtered by traffic", () => {
  let client: Awaited<ReturnType<typeof PGlite.create>>;

  async function seedEvent(
    id: string,
    event: {
      host?: string;
      environment?: string;
      date?: string;
      user?: string;
      org?: string;
    },
  ) {
    await client.query(
      `INSERT INTO analytics_events (${EVENT_COLUMNS}) VALUES ($1, 'page_view', $2, NULL, NULL, $3, $4, $3, $5, 'slides', '', $6, 'owner@example.com', $7)`,
      [
        id,
        event.user ?? "person@example.com",
        `${event.date ?? today}T00:00:00.000Z`,
        event.date ?? today,
        event.host ?? null,
        JSON.stringify(
          event.environment
            ? { deployment_environment: event.environment }
            : {},
        ),
        event.org ?? "org-1",
      ],
    );
  }

  beforeAll(async () => {
    client = await PGlite.create();
    await client.exec(`
      CREATE TABLE analytics_events (
        id text, event_name text, user_id text, user_key text, anonymous_id text,
        timestamp text, event_date text, received_at text, hostname text,
        app text, template text, properties text, owner_email text, org_id text
      );
      CREATE TABLE analytics_event_daily_rollups (
        id text, tenant_key text, owner_email text, org_id text, event_date text,
        event_name text, app text, template text, event_count integer
      );
      CREATE TABLE analytics_user_days (
        id text, tenant_key text, owner_email text, org_id text, event_date text,
        user_key text
      );
    `);
    await seedEvent("production", { host: "slides.agent-native.com" });
    await seedEvent("beta", { host: "beta.slides.agent-native.com" });
    await seedEvent("preview", { host: "preview-1--an.netlify.app" });
    await seedEvent("no-host", {});
    await seedEvent("no-host-marked-beta", { environment: "beta" });
    await seedEvent("no-host-marked-production", {
      environment: "production",
    });
    await seedEvent("host-beats-marker", {
      host: "slides.agent-native.com",
      environment: "beta",
    });
    await seedEvent("old-production", {
      host: "slides.agent-native.com",
      date: "2020-01-01",
    });
    await seedEvent("other-org", {
      host: "slides.agent-native.com",
      org: "org-2",
    });
    // Differs from anything the seeded events could add up to.
    await client.query(
      "INSERT INTO analytics_event_daily_rollups VALUES ('r', 'org:org-1', 'owner@example.com', 'org-1', $1, 'page_view', 'slides', '', 1000)",
      [today],
    );
    await client.query(
      "INSERT INTO analytics_user_days VALUES ('u', 'org:org-1', 'owner@example.com', 'org-1', $1, 'rollup-user')",
      [today],
    );
  });

  afterAll(async () => {
    await client.close();
  });

  async function run(
    sql: string,
    trafficEnvironment?: TrafficEnvironment,
  ): Promise<Array<Record<string, unknown>>> {
    const scoped = scopedAnalyticsSql(sql, scope, today, {
      trafficEnvironment,
    });
    const result = await client.query(scoped.sql, scoped.args);
    return result.rows as Array<Record<string, unknown>>;
  }

  const eventIds = async (trafficEnvironment?: TrafficEnvironment) =>
    (
      await run(
        "SELECT id FROM analytics_events ORDER BY id",
        trafficEnvironment,
      )
    ).map((row) => row.id);

  it("reads every event in scope with no filter", async () => {
    expect(await eventIds()).toEqual([
      "beta",
      "host-beats-marker",
      "no-host",
      "no-host-marked-beta",
      "no-host-marked-production",
      "old-production",
      "preview",
      "production",
    ]);
  });

  it("counts an event with no host as production unless it says otherwise", async () => {
    expect(await eventIds("production")).toEqual([
      "host-beats-marker",
      "no-host",
      "no-host-marked-production",
      "old-production",
      "production",
    ]);
    expect(await eventIds("beta")).toEqual([
      "beta",
      "no-host-marked-beta",
      "preview",
    ]);
  });

  it("rebuilds daily rollups from raw events under a filter", async () => {
    const sql =
      "SELECT event_name, app, SUM(event_count) AS events FROM analytics_event_daily_rollups WHERE event_date >= '2026-01-01' GROUP BY event_name, app";

    const count = async (environment?: TrafficEnvironment) =>
      (await run(sql, environment)).map((row) => Number(row.events));

    expect(await count()).toEqual([1000]);
    expect(await count("production")).toEqual([4]);
    expect(await count("beta")).toEqual([3]);
  });

  it("rebuilds user days from raw events under a filter", async () => {
    const sql =
      "SELECT DISTINCT user_key FROM analytics_user_days WHERE event_date >= '2026-01-01'";

    expect(await run(sql)).toEqual([{ user_key: "rollup-user" }]);
    expect(await run(sql, "production")).toEqual([
      { user_key: "person@example.com" },
    ]);
  });

  it("keeps a rollup rebuilt from events to the query's dates", () => {
    const scoped = scopedAnalyticsSql(
      "SELECT SUM(event_count) AS events FROM analytics_event_daily_rollups WHERE event_date >= '2026-01-01'",
      scope,
      today,
      { trafficEnvironment: "production" },
    );

    expect(scoped.sql).toMatch(
      /FROM analytics_events WHERE .*event_date >= '2026-01-01'/,
    );
    expect(scoped.sql).not.toMatch(
      /FROM analytics_event_daily_rollups WHERE t/,
    );
  });

  it("filters recordings by host and leaves content tables alone", () => {
    const recordings = scopedAnalyticsSql(
      "SELECT id FROM session_recordings",
      scope,
      today,
      { trafficEnvironment: "beta" },
    );
    expect(recordings.sql).toContain("lower(nullif(hostname, ''))");
    expect(recordings.sql).not.toContain("deployment_environment");

    const content = "SELECT id FROM analytics_content_items";
    expect(
      scopedAnalyticsSql(content, scope, today, {
        trafficEnvironment: "beta",
      }).sql,
    ).toBe(scopedAnalyticsSql(content, scope, today).sql);
  });

  it("counts each kind of traffic through the query policy", async () => {
    const counts = trafficCountsSql("2026-01-01");

    expect(() => validateFirstPartyAnalyticsSql(counts)).not.toThrow();
    expect(readTrafficCounts(await run(counts))).toEqual({
      production: 4,
      beta: 3,
      unknown: 1,
    });
  });

  it("adds no condition when no filter is chosen", () => {
    const sql = "SELECT id FROM analytics_events";
    expect(scopedAnalyticsSql(sql, scope, today).sql).not.toContain("hostname");
  });

  describe("rendered for BigQuery", () => {
    const render = (
      sql: string,
      options?: Parameters<typeof renderFirstPartyAnalyticsBigQuerySql>[3],
    ) => {
      const scoped = scopedAnalyticsSql(sql, scope, today, {
        trafficEnvironment: "production",
      });
      return renderFirstPartyAnalyticsBigQuerySql(
        scoped.sql,
        scoped.args,
        bigQueryTable,
        options,
      );
    };

    it("reads the property with BigQuery's JSON function, before deduplicating", () => {
      const rendered = render("SELECT id FROM analytics_events");

      const condition = rendered.indexOf(
        `JSON_VALUE(properties, '$."deployment_environment"')`,
      );
      expect(condition).toBeGreaterThan(0);
      expect(condition).toBeLessThan(rendered.indexOf("QUALIFY ROW_NUMBER()"));
      expect(rendered).not.toContain("::jsonb");
      expect(rendered).not.toContain("~*");
    });

    it("rebuilds a rollup from the raw table, deduplicated before it's counted", () => {
      const rendered = render(
        "SELECT SUM(event_count) AS events FROM analytics_event_daily_rollups WHERE event_date >= '2026-01-01'",
      );

      expect(rendered).not.toMatch(/FROM\s+\S*daily_rollups/);
      expect(rendered).toContain("example-project.analytics.events");
      expect(rendered.indexOf("QUALIFY ROW_NUMBER()")).toBeLessThan(
        rendered.indexOf("AS traffic_events"),
      );
    });

    it("can answer the traffic counts from the events model", () => {
      const counts = scopedAnalyticsSql(
        trafficCountsSql("2026-01-01"),
        scope,
        today,
      );

      const rendered = renderFirstPartyAnalyticsBigQuerySql(
        counts.sql,
        counts.args,
        bigQueryTable,
        { eventsModelTable: "example-project.analytics.events_model" },
      );

      expect(rendered).toContain("page_hostname AS hostname");
      expect(rendered).not.toContain("::jsonb");
    });

    it("works on the events model, whose hostname has another name", () => {
      const rendered = render(
        "SELECT id FROM analytics_events WHERE event_name = 'page_view'",
        { eventsModelTable: "example-project.analytics.events_model" },
      );

      expect(rendered).toContain("page_hostname AS hostname");
      expect(rendered).toContain(
        `JSON_VALUE(properties, '$."deployment_environment"')`,
      );
    });
  });
});
