import { createRequire } from "node:module";

import { afterEach, describe, expect, it } from "vitest";

import { assertFirstPartyAnalyticsBigQuerySql } from "./first-party-analytics-backend.js";
import { validateFirstPartyAnalyticsSql } from "./first-party-analytics.js";
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
      session_id text,
      timestamp text NOT NULL,
      event_date text,
      app text,
      template text,
      hostname text,
      properties text NOT NULL DEFAULT '{}'
    )
  `);
}

let nextRowId = 0;
async function seedActionResponse(
  client: PGliteClient,
  opts: {
    date: string;
    app: string;
    userId?: string;
    hostname?: string;
    properties: Record<string, unknown>;
  },
) {
  await client.query(
    `INSERT INTO analytics_events (id, event_name, user_id, timestamp, event_date, app, hostname, properties)
     VALUES ($1, 'action.response', $2, $3, $3, $4, $5, $6)`,
    [
      `row-${nextRowId++}`,
      opts.userId ?? null,
      opts.date,
      opts.app,
      opts.hostname ?? null,
      JSON.stringify(opts.properties),
    ],
  );
}

const FILTERS = { timeRange: "", emailFilter: "", appFilter: "" };

describe("action reliability & latency catalog metrics", () => {
  let client: PGliteClient;

  afterEach(async () => {
    await client?.close();
  });

  const ACTION_RELIABILITY_CATALOG_KEYS = [
    "action-success-rate-over-time",
    "action-reliability-by-action",
    "action-latency-p50-over-time",
    "action-latency-p90-over-time",
  ];

  it("passes the dashboard SQL validator (no jsonb `?` operator, single SELECT)", () => {
    for (const key of ACTION_RELIABILITY_CATALOG_KEYS) {
      const panel = buildPanel(key)!;
      expect(() => validateFirstPartyAnalyticsSql(panel.sql)).not.toThrow();
      expect(panel.sql).not.toContain("?");
    }
  });

  // The org holding every action.response row today runs the BigQuery sink,
  // so this metric is unusable there unless it also survives BigQuery
  // translation -- `FILTER (WHERE ...)` and `DISTINCT ON` are PostgreSQL-only
  // and throw during translation (first-party-analytics-backend.ts).
  it("translates to BigQuery SQL without FILTER (WHERE ...) or DISTINCT ON", () => {
    for (const key of ACTION_RELIABILITY_CATALOG_KEYS) {
      const panel = buildPanel(key)!;
      expect(() =>
        assertFirstPartyAnalyticsBigQuerySql(panel.sql),
      ).not.toThrow();
    }
  });

  it("excludes cancelled from both sides of the weighted success rate", async () => {
    client = await PGlite.create("memory://");
    await createAnalyticsEventsTable(client);
    const today = (
      (await client.query(
        "SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today",
      )) as { rows: Array<{ today: string }> }
    ).rows[0]!.today;

    await seedActionResponse(client, {
      date: today,
      app: "slides",
      properties: {
        action: "get-deck",
        method: "GET",
        success: true,
        outcome: "success",
        duration_ms: 400,
        status_code: 200,
        sample_weight: 1,
      },
    });
    await seedActionResponse(client, {
      date: today,
      app: "slides",
      properties: {
        action: "get-deck",
        method: "GET",
        success: false,
        outcome: "timeout",
        sample_weight: 1,
      },
    });
    // A superseded/unmounted fetch: success=false but outcome='cancelled' —
    // must land in neither the success nor the failure bucket.
    await seedActionResponse(client, {
      date: today,
      app: "slides",
      properties: {
        action: "get-deck",
        method: "GET",
        success: false,
        outcome: "cancelled",
        sample_weight: 1,
      },
    });

    const panel = buildPanel("action-success-rate-over-time")!;
    const sql = interpolate(panel.sql, FILTERS);
    type Row = {
      date: string;
      app: string;
      success_weight: string | null;
      failure_weight: string | null;
      cancelled_weight: string | null;
      rate: number | null;
    };
    const rows = ((await client.query(sql)) as { rows: Row[] }).rows;
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Number(row.success_weight)).toBe(1);
    expect(Number(row.failure_weight)).toBe(1);
    expect(Number(row.cancelled_weight)).toBe(1);
    // 1 success / (1 success + 1 failure) — the cancelled row moves neither.
    expect(row.rate).toBeCloseTo(0.5);
  });

  it("reports a 0 rate, not NULL, for an app-day with only failures", async () => {
    client = await PGlite.create("memory://");
    await createAnalyticsEventsTable(client);
    const today = (
      (await client.query(
        "SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today",
      )) as { rows: Array<{ today: string }> }
    ).rows[0]!.today;

    // No success rows at all for this app-day: a plain
    // `SUM(...) FILTER (WHERE outcome_class = 'success')` (or an unguarded
    // `SUM(CASE WHEN ...)`) returns NULL here, which renders identically to
    // "no traffic" -- the exact incident this chart exists to surface.
    await seedActionResponse(client, {
      date: today,
      app: "design",
      properties: {
        action: "save-design",
        method: "POST",
        success: false,
        outcome: "http-error",
        sample_weight: 1,
      },
    });

    const panel = buildPanel("action-success-rate-over-time")!;
    const sql = interpolate(panel.sql, FILTERS);
    type Row = {
      success_weight: string | null;
      failure_weight: string | null;
      rate: number | null;
    };
    const rows = ((await client.query(sql)) as { rows: Row[] }).rows;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.success_weight)).toBe(0);
    expect(Number(rows[0]!.failure_weight)).toBe(1);
    expect(rows[0]!.rate).toBe(0);
  });

  it("counts distinct sessions and the share with at least one failure", async () => {
    client = await PGlite.create("memory://");
    await createAnalyticsEventsTable(client);
    const today = (
      (await client.query(
        "SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today",
      )) as { rows: Array<{ today: string }> }
    ).rows[0]!.today;

    // Session A: one success. Session B: one success, then one failure -- a
    // failure anywhere in the session marks it, even though most of its
    // calls succeeded.
    for (const [sessionId, outcome] of [
      ["session-a", "success"],
      ["session-b", "success"],
      ["session-b", "failure"],
    ] as const) {
      await client.query(
        `INSERT INTO analytics_events (id, event_name, session_id, timestamp, event_date, app, properties)
         VALUES ($1, 'action.response', $2, $3, $3, 'mail', $4)`,
        [
          `row-${nextRowId++}`,
          sessionId,
          today,
          JSON.stringify({
            action: "list-threads",
            method: "GET",
            success: outcome === "success",
            outcome: outcome === "success" ? "success" : "http-error",
            sample_weight: 1,
          }),
        ],
      );
    }

    const panel = buildPanel("action-success-rate-over-time")!;
    const sql = interpolate(panel.sql, FILTERS);
    type Row = { sessions: string; session_failure_share: number };
    const rows = ((await client.query(sql)) as { rows: Row[] }).rows;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.sessions)).toBe(2);
    expect(rows[0]!.session_failure_share).toBeCloseTo(0.5);
  });

  it("infers the pre-sample_weight fast-success weight and leaves explicit weights alone", async () => {
    client = await PGlite.create("memory://");
    await createAnalyticsEventsTable(client);
    const today = (
      (await client.query(
        "SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today",
      )) as { rows: Array<{ today: string }> }
    ).rows[0]!.today;

    // Legacy row (no sample_weight key at all): fast, successful, under 400 —
    // this is the 10%-sampled shape, so its inferred weight is 10.
    await seedActionResponse(client, {
      date: today,
      app: "clips",
      properties: {
        action: "list-recordings",
        method: "GET",
        success: true,
        outcome: "success",
        duration_ms: 150,
        status_code: 200,
      },
    });
    // Legacy row, but slow (>=1000ms) — always-tracked, so weight is 1.
    await seedActionResponse(client, {
      date: today,
      app: "clips",
      properties: {
        action: "slow-op",
        method: "GET",
        success: true,
        outcome: "success",
        duration_ms: 1500,
        status_code: 200,
      },
    });
    // Legacy row, fast and successful, but a startup response — always
    // tracked at weight 1 regardless of duration.
    await seedActionResponse(client, {
      date: today,
      app: "clips",
      properties: {
        action: "startup-op",
        method: "GET",
        success: true,
        outcome: "success",
        duration_ms: 150,
        status_code: 200,
        framework_ready_wait_ms: 900,
      },
    });
    // Legacy failure — always weight 1, even though it's fast.
    await seedActionResponse(client, {
      date: today,
      app: "clips",
      properties: {
        action: "fails-fast",
        method: "GET",
        success: false,
        outcome: "http-error",
        duration_ms: 50,
        status_code: 500,
      },
    });
    // Explicit sample_weight always wins, even when the row's own shape would
    // infer weight 1 (duration well over 1000ms).
    await seedActionResponse(client, {
      date: today,
      app: "clips",
      properties: {
        action: "explicit-weight-op",
        method: "GET",
        success: true,
        outcome: "success",
        duration_ms: 5000,
        status_code: 200,
        sample_weight: 10,
      },
    });

    const panel = buildPanel("action-reliability-by-action")!;
    const sql = interpolate(panel.sql, FILTERS);
    type Row = {
      action: string;
      success_weight: string | null;
      failure_weight: string | null;
    };
    const rows = ((await client.query(sql)) as { rows: Row[] }).rows;
    const byAction = new Map(rows.map((r) => [r.action, r]));
    expect(Number(byAction.get("list-recordings")!.success_weight)).toBe(10);
    expect(Number(byAction.get("slow-op")!.success_weight)).toBe(1);
    expect(Number(byAction.get("startup-op")!.success_weight)).toBe(1);
    expect(Number(byAction.get("fails-fast")!.failure_weight)).toBe(1);
    expect(Number(byAction.get("explicit-weight-op")!.success_weight)).toBe(10);
  });

  it("dimensions by read vs mutation, auth_state, and deployment_env", async () => {
    client = await PGlite.create("memory://");
    await createAnalyticsEventsTable(client);
    const today = (
      (await client.query(
        "SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today",
      )) as { rows: Array<{ today: string }> }
    ).rows[0]!.today;

    await seedActionResponse(client, {
      date: today,
      app: "design",
      hostname: "beta.design.agent-native.com",
      properties: {
        action: "read-local-file",
        method: "GET",
        success: true,
        outcome: "success",
        duration_ms: 100,
        status_code: 200,
        sample_weight: 1,
      },
    });
    await seedActionResponse(client, {
      date: today,
      app: "design",
      userId: "steve@example.com",
      hostname: "design.agent-native.com",
      properties: {
        action: "save-design",
        method: "POST",
        success: true,
        outcome: "success",
        duration_ms: 100,
        status_code: 200,
        sample_weight: 1,
      },
    });

    const panel = buildPanel("action-reliability-by-action")!;
    const sql = interpolate(panel.sql, FILTERS);
    type Row = {
      action: string;
      call_type: string;
      auth_state: string;
      deployment_env: string;
    };
    const rows = ((await client.query(sql)) as { rows: Row[] }).rows;
    const byAction = new Map(rows.map((r) => [r.action, r]));

    const read = byAction.get("read-local-file")!;
    expect(read.call_type).toBe("read");
    expect(read.auth_state).toBe("anonymous");
    expect(read.deployment_env).toBe("beta");

    const mutation = byAction.get("save-design")!;
    expect(mutation.call_type).toBe("mutation");
    expect(mutation.auth_state).toBe("signed_in");
    expect(mutation.deployment_env).toBe("prod");
  });

  it("computes a sample_weight-bucketed cumulative p50/p90 over successful calls only", async () => {
    client = await PGlite.create("memory://");
    await createAnalyticsEventsTable(client);
    const today = (
      (await client.query(
        "SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today",
      )) as { rows: Array<{ today: string }> }
    ).rows[0]!.today;

    // 10 equally-weighted successful calls at 100..1000ms (25ms buckets keep
    // every value on its own bucket boundary): the 5th-ranked value (500ms)
    // is where cumulative weight first reaches 50%, the 9th (900ms) where it
    // first reaches 90%.
    for (let i = 1; i <= 10; i++) {
      await seedActionResponse(client, {
        date: today,
        app: "mail",
        properties: {
          action: "list-threads",
          method: "GET",
          success: true,
          outcome: "success",
          duration_ms: i * 100,
          status_code: 200,
          sample_weight: 1,
        },
      });
    }
    // A cancelled and a failed call in the same group must not enter the
    // latency population at all (no duration_ms recorded for cancelled here,
    // and a failure is never a "successful call").
    await seedActionResponse(client, {
      date: today,
      app: "mail",
      properties: {
        action: "list-threads",
        method: "GET",
        success: false,
        outcome: "http-error",
        duration_ms: 9999,
        status_code: 500,
        sample_weight: 1,
      },
    });

    const panel = buildPanel("action-reliability-by-action")!;
    const sql = interpolate(panel.sql, FILTERS);
    type Row = { action: string; p50_ms: string | null; p90_ms: string | null };
    const rows = ((await client.query(sql)) as { rows: Row[] }).rows;
    const row = rows.find((r) => r.action === "list-threads")!;
    expect(Number(row.p50_ms)).toBe(500);
    expect(Number(row.p90_ms)).toBe(900);
  });

  it("classifies a hidden-tab timeout as suspended, excluded from the rate like cancelled -- but a visible timeout still counts as a failure", async () => {
    client = await PGlite.create("memory://");
    await createAnalyticsEventsTable(client);
    const today = (
      (await client.query(
        "SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today",
      )) as { rows: Array<{ today: string }> }
    ).rows[0]!.today;

    await seedActionResponse(client, {
      date: today,
      app: "clips",
      properties: {
        action: "list-recordings",
        method: "GET",
        success: true,
        outcome: "success",
        duration_ms: 400,
        status_code: 200,
        sample_weight: 1,
      },
    });
    // A tab that was hidden for the whole attempt: the timer fired late from
    // browser throttling, not because anything actually hung 60s+.
    await seedActionResponse(client, {
      date: today,
      app: "clips",
      properties: {
        action: "list-recordings",
        method: "GET",
        success: false,
        outcome: "timeout",
        page_hidden: "true",
        sample_weight: 1,
      },
    });
    // Same outcome, foreground tab: a real timeout, still a failure.
    await seedActionResponse(client, {
      date: today,
      app: "clips",
      properties: {
        action: "list-recordings",
        method: "GET",
        success: false,
        outcome: "timeout",
        page_hidden: "false",
        sample_weight: 1,
      },
    });

    const panel = buildPanel("action-success-rate-over-time")!;
    const sql = interpolate(panel.sql, FILTERS);
    type Row = {
      success_weight: string | null;
      failure_weight: string | null;
      suspended_weight: string | null;
      rate: number | null;
    };
    const rows = ((await client.query(sql)) as { rows: Row[] }).rows;
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Number(row.success_weight)).toBe(1);
    expect(Number(row.failure_weight)).toBe(1);
    expect(Number(row.suspended_weight)).toBe(1);
    // 1 success / (1 success + 1 failure) -- the suspended row moves neither.
    expect(row.rate).toBeCloseTo(0.5);
  });

  it("splits action-success-rate-over-time by deployment_env instead of mixing beta into production", async () => {
    client = await PGlite.create("memory://");
    await createAnalyticsEventsTable(client);
    const today = (
      (await client.query(
        "SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today",
      )) as { rows: Array<{ today: string }> }
    ).rows[0]!.today;

    // Beta: mostly-QA traffic failing.
    await seedActionResponse(client, {
      date: today,
      app: "design",
      hostname: "beta.design.agent-native.com",
      properties: {
        action: "save-design",
        method: "POST",
        success: false,
        outcome: "http-error",
        sample_weight: 1,
      },
    });
    // Prod: healthy.
    await seedActionResponse(client, {
      date: today,
      app: "design",
      hostname: "design.agent-native.com",
      properties: {
        action: "save-design",
        method: "POST",
        success: true,
        outcome: "success",
        duration_ms: 200,
        status_code: 200,
        sample_weight: 1,
      },
    });

    const panel = buildPanel("action-success-rate-over-time")!;
    const sql = interpolate(panel.sql, FILTERS);
    type Row = {
      app: string;
      deployment_env: string;
      series: string;
      rate: number | null;
    };
    const rows = ((await client.query(sql)) as { rows: Row[] }).rows;
    expect(rows).toHaveLength(2);
    const byEnv = new Map(rows.map((r) => [r.deployment_env, r]));
    expect(byEnv.get("beta")!.series).toBe("design / beta");
    expect(byEnv.get("beta")!.rate).toBe(0);
    expect(byEnv.get("prod")!.series).toBe("design / prod");
    expect(byEnv.get("prod")!.rate).toBe(1);
  });

  it("computes action-latency-{p50,p90}-over-time per date/app/deployment_env, excluding page_hidden rows", async () => {
    client = await PGlite.create("memory://");
    await createAnalyticsEventsTable(client);
    const today = (
      (await client.query(
        "SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today",
      )) as { rows: Array<{ today: string }> }
    ).rows[0]!.today;

    // Same 10-value distribution as the by-action quantile test: 5th-ranked
    // (500ms) is the first bucket to reach 50% cumulative weight, 9th
    // (900ms) the first to reach 90%.
    for (let i = 1; i <= 10; i++) {
      await seedActionResponse(client, {
        date: today,
        app: "mail",
        hostname: "mail.agent-native.com",
        properties: {
          action: "list-threads",
          method: "GET",
          success: true,
          outcome: "success",
          duration_ms: i * 100,
          status_code: 200,
          sample_weight: 1,
        },
      });
    }
    // A successful call from a hidden tab with an inflated duration must not
    // shift the quantile -- its wall-clock time reflects timer throttling,
    // not real latency.
    await seedActionResponse(client, {
      date: today,
      app: "mail",
      hostname: "mail.agent-native.com",
      properties: {
        action: "list-threads",
        method: "GET",
        success: true,
        outcome: "success",
        duration_ms: 120_000,
        page_hidden: "true",
        status_code: 200,
        sample_weight: 1,
      },
    });

    // p50 and p90 are two catalog entries sharing the same SQL (a pivoted
    // chart can only draw one value column per panel -- see SqlChart.tsx) --
    // both must return the same row shape, with both quantiles present, and
    // each panel's own pivot.valueKey must point at its own column so p90
    // actually reaches the chart instead of being dropped like the p50-only
    // panel this replaced.
    for (const [key, valueKey] of [
      ["action-latency-p50-over-time", "p50_ms"],
      ["action-latency-p90-over-time", "p90_ms"],
    ] as const) {
      const panel = buildPanel(key)!;
      expect(panel.config?.pivot).toMatchObject({ valueKey });
      const sql = interpolate(panel.sql, FILTERS);
      type Row = {
        app: string;
        deployment_env: string;
        series: string;
        p50_ms: string | null;
        p90_ms: string | null;
      };
      const rows = ((await client.query(sql)) as { rows: Row[] }).rows;
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.series).toBe("mail / prod");
      expect(Number(row.p50_ms)).toBe(500);
      expect(Number(row.p90_ms)).toBe(900);
    }
  });

  it("leaves a no-traffic day/series blank (NULL) instead of a fabricated 0% or 0ms", async () => {
    client = await PGlite.create("memory://");
    await createAnalyticsEventsTable(client);
    const rows = (
      (await client.query(
        "SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today, to_char(CURRENT_DATE - INTERVAL '1 day', 'YYYY-MM-DD') AS yesterday",
      )) as { rows: Array<{ today: string; yesterday: string }> }
    ).rows[0]!;
    const { today, yesterday } = rows;

    // "clips" only has traffic yesterday; "design" only has traffic today.
    // Without a dense date x series grid, `GROUP BY date, app` never emits a
    // "clips" row for today (or a "design" row for yesterday) at all -- and
    // the chart's pivot zero-fills any missing (date, series) cell, drawing
    // a false 0% outage / 0ms response on the day each app had no traffic,
    // not "no data yet".
    await seedActionResponse(client, {
      date: yesterday,
      app: "clips",
      hostname: "clips.agent-native.com",
      properties: {
        action: "list-recordings",
        method: "GET",
        success: true,
        outcome: "success",
        duration_ms: 200,
        status_code: 200,
        sample_weight: 1,
      },
    });
    await seedActionResponse(client, {
      date: today,
      app: "design",
      hostname: "design.agent-native.com",
      properties: {
        action: "save-design",
        method: "POST",
        success: true,
        outcome: "success",
        duration_ms: 200,
        status_code: 200,
        sample_weight: 1,
      },
    });

    const ratePanel = buildPanel("action-success-rate-over-time")!;
    type RateRow = {
      date: string;
      app: string;
      rate: number | null;
    };
    const rateRows = (
      (await client.query(interpolate(ratePanel.sql, FILTERS))) as {
        rows: RateRow[];
      }
    ).rows;
    const clipsToday = rateRows.find(
      (r) => r.app === "clips" && r.date === today,
    );
    expect(clipsToday).toBeDefined();
    expect(clipsToday!.rate).toBeNull();
    const designYesterday = rateRows.find(
      (r) => r.app === "design" && r.date === yesterday,
    );
    expect(designYesterday).toBeDefined();
    expect(designYesterday!.rate).toBeNull();

    const latencyPanel = buildPanel("action-latency-p50-over-time")!;
    type LatencyRow = { date: string; app: string; p50_ms: string | null };
    const latencyRows = (
      (await client.query(interpolate(latencyPanel.sql, FILTERS))) as {
        rows: LatencyRow[];
      }
    ).rows;
    const clipsTodayLatency = latencyRows.find(
      (r) => r.app === "clips" && r.date === today,
    );
    expect(clipsTodayLatency).toBeDefined();
    expect(clipsTodayLatency!.p50_ms).toBeNull();
  });
});
