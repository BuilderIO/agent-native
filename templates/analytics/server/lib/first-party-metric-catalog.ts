/**
 * First-party metric catalog — a keyed registry of reusable, already-validated
 * first-party analytics panels.
 *
 * Why this exists: authoring a large multi-panel dashboard forces the agent to
 * stream one giant `update-dashboard` argument (SQL + chart config for every
 * panel) inside the ~40s hosted run budget. That big tool-call can't be resumed
 * mid-stream and is all-or-nothing on validation, so the agent thrashes. This
 * catalog moves panel authoring server-side: the agent names the metrics it
 * wants and the server expands each one into a full, correct panel from SQL that
 * already ships (and is exercised) in the
 * `agent-native-templates-first-party` seed. See `compose-dashboard.ts`.
 *
 * The SQL here is copied verbatim from
 * `seeds/dashboards/agent-native-templates-first-party.json` — do NOT re-invent
 * it. Windowed metrics swap the `interval 'N days'` literal for the requested
 * window via `buildSql(window)`.
 *
 * Distinct from the `<data-dictionary>` (the user/org-scoped catalog of business
 * metric definitions the agent consults before writing ad-hoc SQL). That is a
 * settings-backed knowledge layer for free-form querying; this is a code-level
 * registry of canned, validated panels for one-call dashboard composition. They
 * complement each other.
 */

export type MetricWindow = "30d" | "90d" | "all";

export interface FirstPartyMetric {
  /** Stable catalog key, also used as the default panel id. */
  key: string;
  title: string;
  chartType: string;
  source: "first-party";
  /** Default grid columns this panel spans (1..6). */
  width: number;
  /**
   * Build the panel SQL for an optional window. Windowed metrics substitute the
   * `interval 'N days'` literal; non-windowed metrics ignore the argument and
   * return their fixed SQL.
   */
  buildSql: (window?: MetricWindow) => string;
  /** Whether `buildSql` actually varies with `window`. */
  windowed: boolean;
  /** Panel `config` block (chart keys, formatters, description). */
  config: Record<string, unknown>;
}

export interface FirstPartyDashboardFilter {
  id: string;
  type: "select";
  label: string;
  default: string;
  options: Array<{ value: string; label: string }>;
}

const WINDOW_DAYS: Record<Exclude<MetricWindow, "all">, number> = {
  "30d": 30,
  "90d": 90,
};

/**
 * Apply a window to SQL that contains `interval 'N days'` clauses.
 *
 * - "30d" / "90d": replace every `interval '<n> days'` with the requested days.
 * - "all": strip the entire `AND timestamp::timestamptz >= now() - interval 'N days'`
 *   clause so the metric covers all time. (Only the standard
 *   `>= now() - interval` window clause is removed; any other interval usage is
 *   left intact.)
 */
function applyWindow(sql: string, window: MetricWindow): string {
  if (window === "all") {
    return sql
      .replace(
        /\s+AND\s+timestamp::timestamptz\s*>=\s*now\(\)\s*-\s*interval\s*'\d+\s*days?'/gi,
        "",
      )
      .replace(
        /\s+WHERE\s+timestamp::timestamptz\s*>=\s*now\(\)\s*-\s*interval\s*'\d+\s*days?'\s+AND\s+/gi,
        " WHERE ",
      );
  }
  const days = WINDOW_DAYS[window];
  return sql.replace(/interval\s*'\d+\s*days?'/gi, `interval '${days} days'`);
}

/**
 * Helper for windowed metrics: keep the canonical SQL (with its default window
 * baked in) and only rewrite when a different window is requested.
 */
function windowed(sql: string): (window?: MetricWindow) => string {
  return (window) => (window ? applyWindow(sql, window) : sql);
}

/** Helper for fixed (non-windowed) metrics. */
function fixed(sql: string): (window?: MetricWindow) => string {
  return () => sql;
}

const TEMPLATE_EXPR =
  "COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(properties::jsonb ->> 'agent_native_template', ''), NULLIF(properties::jsonb ->> 'agentNativeTemplate', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), NULLIF(properties::jsonb ->> 'agentNativeApp', ''), 'unknown')";
const KNOWN_TEMPLATE_FILTER = `${TEMPLATE_EXPR} <> 'unknown'`;
const LOCAL_EVENT_DATE_SQL = "substr(timestamp, 1, 10)";

function daysAgoSql(days: number): string {
  const unit = days === 1 ? "day" : "days";
  return `to_char(CURRENT_DATE - INTERVAL '${days} ${unit}', 'YYYY-MM-DD')`;
}

function dashboardTimeRangeFilter(dateExpr = LOCAL_EVENT_DATE_SQL): string {
  return `('{{timeRange}}' IN ('', 'all') OR ('{{timeRange}}' = '7d' AND ${dateExpr} >= ${daysAgoSql(7)}) OR ('{{timeRange}}' = '30d' AND ${dateExpr} >= ${daysAgoSql(30)}) OR ('{{timeRange}}' = '90d' AND ${dateExpr} >= ${daysAgoSql(90)}) OR ('{{timeRange}}' = '180d' AND ${dateExpr} >= ${daysAgoSql(180)}) OR ('{{timeRange}}' = '365d' AND ${dateExpr} >= ${daysAgoSql(365)}))`;
}

function dashboardLookbackTimeRangeFilter(
  dateExpr = LOCAL_EVENT_DATE_SQL,
  lookbackDays = 0,
): string {
  return `('{{timeRange}}' IN ('', 'all') OR ('{{timeRange}}' = '7d' AND ${dateExpr} >= ${daysAgoSql(7 + lookbackDays)}) OR ('{{timeRange}}' = '30d' AND ${dateExpr} >= ${daysAgoSql(30 + lookbackDays)}) OR ('{{timeRange}}' = '90d' AND ${dateExpr} >= ${daysAgoSql(90 + lookbackDays)}) OR ('{{timeRange}}' = '180d' AND ${dateExpr} >= ${daysAgoSql(180 + lookbackDays)}) OR ('{{timeRange}}' = '365d' AND ${dateExpr} >= ${daysAgoSql(365 + lookbackDays)}))`;
}

const DASHBOARD_TIME_RANGE_FILTER = dashboardTimeRangeFilter();
const DASHBOARD_EVENT_DATE_RANGE_FILTER =
  dashboardTimeRangeFilter("event_date");
const DASHBOARD_WAU_BASE_RANGE_FILTER = dashboardLookbackTimeRangeFilter(
  LOCAL_EVENT_DATE_SQL,
  6,
);
const DASHBOARD_EMAIL_FILTER =
  "('{{emailFilter}}' IN ('', 'all') OR ('{{emailFilter}}' = 'exclude_builder' AND lower(coalesce(user_id, '')) NOT LIKE '%@builder.io') OR ('{{emailFilter}}' = 'only_builder' AND lower(coalesce(user_id, '')) LIKE '%@builder.io'))";
export const FIRST_PARTY_DASHBOARD_FILTERS: FirstPartyDashboardFilter[] = [
  {
    id: "timeRange",
    type: "select",
    label: "Time range",
    default: "90d",
    options: [
      { value: "7d", label: "Last 7 days" },
      { value: "30d", label: "Last 30 days" },
      { value: "90d", label: "Last 90 days" },
      { value: "180d", label: "Last 180 days" },
      { value: "365d", label: "Last 365 days" },
      { value: "all", label: "All time" },
    ],
  },
  {
    id: "emailFilter",
    type: "select",
    label: "Email filter",
    default: "all",
    options: [
      { value: "all", label: "All users" },
      { value: "exclude_builder", label: "Exclude @builder.io" },
      { value: "only_builder", label: "Only @builder.io" },
    ],
  },
];

export function buildFirstPartyDashboardFilters(): FirstPartyDashboardFilter[] {
  return FIRST_PARTY_DASHBOARD_FILTERS.map((filter) => ({
    ...filter,
    options: filter.options.map((option) => ({ ...option })),
  }));
}

export function usesFirstPartyDashboardFilters(sql: string): boolean {
  return sql.includes("{{timeRange}}") || sql.includes("{{emailFilter}}");
}

const TOTAL_SIGNUPS_SQL = `SELECT COUNT(*) AS signups FROM analytics_events WHERE event_name = 'signup' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER}`;
const SIGNUPS_OVER_TIME_SQL = `WITH offsets AS (SELECT (ROW_NUMBER() OVER (ORDER BY timestamp) - 1)::int AS n FROM analytics_events LIMIT 800), signup_events AS (SELECT substr(timestamp, 1, 10) AS date, ${TEMPLATE_EXPR} AS template FROM analytics_events WHERE event_name = 'signup' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER}), bounds AS (SELECT MIN(date::date) AS start_date, MAX(date::date) AS end_date FROM signup_events), dates AS (SELECT to_char(bounds.start_date + offsets.n, 'YYYY-MM-DD') AS date FROM bounds CROSS JOIN offsets WHERE bounds.start_date IS NOT NULL AND bounds.start_date + offsets.n <= bounds.end_date), templates AS (SELECT DISTINCT template FROM signup_events), daily AS (SELECT date, template, COUNT(*) AS count FROM signup_events GROUP BY date, template) SELECT dates.date, templates.template, COALESCE(daily.count, 0) AS count FROM dates CROSS JOIN templates LEFT JOIN daily ON daily.date = dates.date AND daily.template = templates.template ORDER BY dates.date, templates.template`;
const RETENTION_OVER_TIME_SQL = `WITH base AS (SELECT COALESCE(NULLIF(user_id, ''), NULLIF(anonymous_id, '')) AS user_key, substr(timestamp, 1, 10) AS event_date, user_id FROM analytics_events WHERE COALESCE(NULLIF(user_id, ''), NULLIF(anonymous_id, '')) IS NOT NULL AND ${DASHBOARD_EMAIL_FILTER}), first_seen AS (SELECT user_key, MIN(event_date) AS cohort_date FROM base GROUP BY user_key), cohorts AS (SELECT user_key, cohort_date FROM first_seen WHERE cohort_date <= ${daysAgoSql(7)} AND ${dashboardTimeRangeFilter("cohort_date")}), cohort_sizes AS (SELECT cohort_date AS date, COUNT(DISTINCT user_key) AS users FROM cohorts GROUP BY cohort_date), periods AS (SELECT '1d retention' AS period UNION ALL SELECT '7d retention' AS period), retained AS (SELECT c.cohort_date AS date, '1d retention' AS period, COUNT(DISTINCT c.user_key) AS retained FROM cohorts c JOIN base b ON b.user_key = c.user_key AND b.event_date = to_char(c.cohort_date::date + INTERVAL '1 day', 'YYYY-MM-DD') GROUP BY c.cohort_date UNION ALL SELECT c.cohort_date AS date, '7d retention' AS period, COUNT(DISTINCT c.user_key) AS retained FROM cohorts c JOIN base b ON b.user_key = c.user_key AND b.event_date = to_char(c.cohort_date::date + INTERVAL '7 days', 'YYYY-MM-DD') GROUP BY c.cohort_date) SELECT cs.date, p.period, COALESCE(r.retained::float / NULLIF(cs.users, 0), 0) AS rate FROM cohort_sizes cs CROSS JOIN periods p LEFT JOIN retained r ON r.date = cs.date AND r.period = p.period ORDER BY cs.date, p.period`;
const ONE_DAY_RETENTION_BY_TEMPLATE_SQL = `WITH base AS (SELECT COALESCE(NULLIF(user_id, ''), NULLIF(anonymous_id, '')) AS user_key, ${TEMPLATE_EXPR} AS template, substr(timestamp, 1, 10) AS event_date, user_id FROM analytics_events WHERE COALESCE(NULLIF(user_id, ''), NULLIF(anonymous_id, '')) IS NOT NULL AND ${DASHBOARD_EMAIL_FILTER} AND ${KNOWN_TEMPLATE_FILTER}), first_seen AS (SELECT user_key, template, MIN(event_date) AS cohort_date FROM base GROUP BY user_key, template), cohorts AS (SELECT user_key, template, cohort_date FROM first_seen WHERE cohort_date <= ${daysAgoSql(1)} AND ${dashboardTimeRangeFilter("cohort_date")}), cohort_sizes AS (SELECT cohort_date AS date, template, COUNT(DISTINCT user_key) AS users FROM cohorts GROUP BY cohort_date, template), retained AS (SELECT c.cohort_date AS date, c.template, COUNT(DISTINCT c.user_key) AS retained FROM cohorts c JOIN base b ON b.user_key = c.user_key AND b.template = c.template AND b.event_date = to_char(c.cohort_date::date + INTERVAL '1 day', 'YYYY-MM-DD') GROUP BY c.cohort_date, c.template) SELECT cs.date, cs.template, COALESCE(r.retained::float / NULLIF(cs.users, 0), 0) AS rate FROM cohort_sizes cs LEFT JOIN retained r ON r.date = cs.date AND r.template = cs.template ORDER BY cs.date, cs.template`;
const SEVEN_DAY_RETENTION_BY_TEMPLATE_SQL = `WITH base AS (SELECT COALESCE(NULLIF(user_id, ''), NULLIF(anonymous_id, '')) AS user_key, ${TEMPLATE_EXPR} AS template, substr(timestamp, 1, 10) AS event_date, user_id FROM analytics_events WHERE COALESCE(NULLIF(user_id, ''), NULLIF(anonymous_id, '')) IS NOT NULL AND ${DASHBOARD_EMAIL_FILTER} AND ${KNOWN_TEMPLATE_FILTER}), first_seen AS (SELECT user_key, template, MIN(event_date) AS cohort_date FROM base GROUP BY user_key, template), cohorts AS (SELECT user_key, template, cohort_date FROM first_seen WHERE cohort_date <= ${daysAgoSql(7)} AND ${dashboardTimeRangeFilter("cohort_date")}), cohort_sizes AS (SELECT cohort_date AS date, template, COUNT(DISTINCT user_key) AS users FROM cohorts GROUP BY cohort_date, template), retained AS (SELECT c.cohort_date AS date, c.template, COUNT(DISTINCT c.user_key) AS retained FROM cohorts c JOIN base b ON b.user_key = c.user_key AND b.template = c.template AND b.event_date = to_char(c.cohort_date::date + INTERVAL '7 days', 'YYYY-MM-DD') GROUP BY c.cohort_date, c.template) SELECT cs.date, cs.template, COALESCE(r.retained::float / NULLIF(cs.users, 0), 0) AS rate FROM cohort_sizes cs LEFT JOIN retained r ON r.date = cs.date AND r.template = cs.template ORDER BY cs.date, cs.template`;
const SIGNUPS_BY_TEMPLATE_SQL = `SELECT ${TEMPLATE_EXPR} AS template, COUNT(*) AS count FROM analytics_events WHERE event_name = 'signup' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} GROUP BY ${TEMPLATE_EXPR} ORDER BY count DESC`;
const DAU_BY_TEMPLATE_SQL = `SELECT substr(timestamp, 1, 10) AS date, ${TEMPLATE_EXPR} AS template, COUNT(DISTINCT COALESCE(NULLIF(user_id, ''), NULLIF(anonymous_id, ''))) AS users FROM analytics_events WHERE COALESCE(NULLIF(user_id, ''), NULLIF(anonymous_id, '')) IS NOT NULL AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${KNOWN_TEMPLATE_FILTER} GROUP BY substr(timestamp, 1, 10), ${TEMPLATE_EXPR} ORDER BY date, template`;
const WAU_BY_TEMPLATE_SQL = `WITH base AS (SELECT COALESCE(NULLIF(user_id, ''), NULLIF(anonymous_id, '')) AS user_key, ${TEMPLATE_EXPR} AS template, substr(timestamp, 1, 10) AS event_date, user_id FROM analytics_events WHERE COALESCE(NULLIF(user_id, ''), NULLIF(anonymous_id, '')) IS NOT NULL AND ${DASHBOARD_EMAIL_FILTER} AND ${KNOWN_TEMPLATE_FILTER} AND ${DASHBOARD_WAU_BASE_RANGE_FILTER}), days AS (SELECT DISTINCT event_date AS date FROM base WHERE ${DASHBOARD_EVENT_DATE_RANGE_FILTER}) SELECT d.date, b.template, COUNT(DISTINCT b.user_key) AS users FROM days d JOIN base b ON b.event_date >= to_char(d.date::date - INTERVAL '6 days', 'YYYY-MM-DD') AND b.event_date <= d.date GROUP BY d.date, b.template ORDER BY d.date, b.template`;

/**
 * Catalog entries. Order here is the default panel order when a caller passes
 * metrics; callers can reorder by listing keys in the order they want.
 */
const ENTRIES: FirstPartyMetric[] = [
  // --- Signups -------------------------------------------------------------
  {
    key: "total-signups",
    title: "Total Signups",
    chartType: "metric",
    source: "first-party",
    width: 1,
    windowed: false,
    buildSql: fixed(TOTAL_SIGNUPS_SQL),
    config: {
      yKey: "signups",
      yFormatter: "number",
      description: "Total signup events in the selected time range.",
    },
  },
  {
    key: "signups-over-time",
    title: "Signups Over Time",
    chartType: "area",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(SIGNUPS_OVER_TIME_SQL),
    config: {
      xKey: "date",
      yKey: "count",
      yFormatter: "number",
      pivot: {
        xKey: "date",
        seriesKey: "template",
        valueKey: "count",
      },
      stacked: true,
      description: "Daily signup events stacked by inferred template/app.",
    },
  },
  {
    key: "signups-by-template",
    title: "Signups by Template",
    chartType: "bar",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(SIGNUPS_BY_TEMPLATE_SQL),
    config: {
      xKey: "template",
      yKey: "count",
      yFormatter: "number",
      color: "var(--brand-purple)",
      description: "Signup events grouped by inferred template/app.",
    },
  },

  // --- Sessions ------------------------------------------------------------
  {
    key: "sessions-by-app",
    title: "Sessions by Agent-Native App",
    chartType: "bar",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(
      "SELECT COALESCE(NULLIF(app, ''), 'unknown') AS app, COUNT(*) AS count FROM analytics_events WHERE event_name = 'session status' GROUP BY COALESCE(NULLIF(app, ''), 'unknown') ORDER BY count DESC LIMIT 20",
    ),
    config: {
      xKey: "app",
      yKey: "count",
      color: "#10b981",
      description:
        "Per-template-site session activity (mail, calendar, slides, ...). Each tab fires session status once.",
    },
  },
  {
    key: "sessions-over-time",
    title: "Sessions Over Time",
    chartType: "area",
    source: "first-party",
    width: 1,
    windowed: false,
    buildSql: fixed(
      "SELECT substr(timestamp, 1, 10) AS date, COUNT(*) AS count FROM analytics_events WHERE event_name = 'session status' GROUP BY substr(timestamp, 1, 10) ORDER BY date",
    ),
    config: { xKey: "date", yKey: "count", color: "#10b981" },
  },
  {
    key: "signed-in-vs-anon",
    title: "Signed-In vs Anonymous Sessions",
    chartType: "bar",
    source: "first-party",
    width: 1,
    windowed: false,
    buildSql: fixed(
      "SELECT COALESCE(NULLIF(signed_in, ''), 'unknown') AS signed_in, COUNT(*) AS count FROM analytics_events WHERE event_name = 'session status' GROUP BY COALESCE(NULLIF(signed_in, ''), 'unknown') ORDER BY signed_in",
    ),
    config: {
      xKey: "signed_in",
      yKey: "count",
      color: "#f59e0b",
      description:
        "true = signed in, false = anonymous. Best proxy for total signups per period (still includes returning users).",
    },
  },

  // --- Template / demo / CLI engagement ------------------------------------
  {
    key: "total-template-clicks",
    title: "Template Clicks",
    chartType: "metric",
    source: "first-party",
    width: 1,
    windowed: false,
    buildSql: fixed(
      `SELECT COUNT(*) AS count FROM analytics_events WHERE event_name = 'click template' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER}`,
    ),
    config: {
      yKey: "count",
      yFormatter: "number",
      description: "First-party events",
    },
  },
  {
    key: "total-demo-clicks",
    title: "Demo Clicks",
    chartType: "metric",
    source: "first-party",
    width: 1,
    windowed: false,
    buildSql: fixed(
      `SELECT COUNT(*) AS count FROM analytics_events WHERE event_name = 'click try demo' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER}`,
    ),
    config: {
      yKey: "count",
      yFormatter: "number",
      description: "First-party events",
    },
  },
  {
    key: "total-cli-copies",
    title: "CLI Copies",
    chartType: "metric",
    source: "first-party",
    width: 1,
    windowed: false,
    buildSql: fixed(
      `SELECT COUNT(*) AS count FROM analytics_events WHERE event_name = 'copy cli command' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER}`,
    ),
    config: {
      yKey: "count",
      yFormatter: "number",
      description: "First-party events",
    },
  },
  {
    key: "template-interest-over-time",
    title: "Template Interest Over Time",
    chartType: "area",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(
      `SELECT substr(timestamp, 1, 10) AS date, COALESCE(NULLIF(template, ''), 'unknown') AS template, COUNT(*) AS count FROM analytics_events WHERE event_name = 'click template' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} GROUP BY substr(timestamp, 1, 10), COALESCE(NULLIF(template, ''), 'unknown') ORDER BY date, template`,
    ),
    config: {
      xKey: "date",
      yKey: "count",
      yFormatter: "number",
      pivot: {
        xKey: "date",
        seriesKey: "template",
        valueKey: "count",
      },
      stacked: true,
    },
  },
  {
    key: "clicks-by-template",
    title: "Clicks by Template Over Time",
    chartType: "area",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(
      `SELECT substr(timestamp, 1, 10) AS date, COALESCE(NULLIF(template, ''), 'unknown') AS template, COUNT(*) AS count FROM analytics_events WHERE event_name = 'click template' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} GROUP BY substr(timestamp, 1, 10), COALESCE(NULLIF(template, ''), 'unknown') ORDER BY date, template`,
    ),
    config: {
      xKey: "date",
      yKey: "count",
      yFormatter: "number",
      pivot: {
        xKey: "date",
        seriesKey: "template",
        valueKey: "count",
      },
      stacked: true,
    },
  },
  {
    key: "demo-clicks-by-template",
    title: "Try-Demo Clicks Over Time",
    chartType: "area",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(
      `SELECT substr(timestamp, 1, 10) AS date, COALESCE(NULLIF(template, ''), 'unknown') AS template, COUNT(*) AS count FROM analytics_events WHERE event_name = 'click try demo' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} GROUP BY substr(timestamp, 1, 10), COALESCE(NULLIF(template, ''), 'unknown') ORDER BY date, template`,
    ),
    config: {
      xKey: "date",
      yKey: "count",
      yFormatter: "number",
      pivot: {
        xKey: "date",
        seriesKey: "template",
        valueKey: "count",
      },
      stacked: true,
    },
  },
  {
    key: "cli-copies-by-template",
    title: "CLI Copies by Template Over Time",
    chartType: "area",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(
      `SELECT substr(timestamp, 1, 10) AS date, COALESCE(NULLIF(template, ''), 'unknown') AS template, COUNT(*) AS count FROM analytics_events WHERE event_name = 'copy cli command' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} GROUP BY substr(timestamp, 1, 10), COALESCE(NULLIF(template, ''), 'unknown') ORDER BY date, template`,
    ),
    config: {
      xKey: "date",
      yKey: "count",
      yFormatter: "number",
      pivot: {
        xKey: "date",
        seriesKey: "template",
        valueKey: "count",
      },
      stacked: true,
    },
  },
  {
    key: "cli-copies-over-time",
    title: "CLI Copies Over Time",
    chartType: "area",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(
      `SELECT substr(timestamp, 1, 10) AS date, COALESCE(NULLIF(template, ''), 'unknown') AS template, COUNT(*) AS count FROM analytics_events WHERE event_name = 'copy cli command' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} GROUP BY substr(timestamp, 1, 10), COALESCE(NULLIF(template, ''), 'unknown') ORDER BY date, template`,
    ),
    config: {
      xKey: "date",
      yKey: "count",
      yFormatter: "number",
      pivot: {
        xKey: "date",
        seriesKey: "template",
        valueKey: "count",
      },
      stacked: true,
    },
  },

  // --- Activity / pageviews ------------------------------------------------
  {
    key: "pageviews-over-time",
    title: "Pageviews Over Time",
    chartType: "area",
    source: "first-party",
    width: 2,
    windowed: false,
    // Browser telemetry emits explicit `pageview` events with URL context, so
    // keep pageview panels scoped to that event instead of all tracked events.
    buildSql: fixed(
      `SELECT substr(timestamp, 1, 10) AS date, COALESCE(NULLIF(template, ''), NULLIF(app, ''), 'unknown') AS template, COUNT(*) AS count FROM analytics_events WHERE event_name = 'pageview' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} GROUP BY substr(timestamp, 1, 10), COALESCE(NULLIF(template, ''), NULLIF(app, ''), 'unknown') ORDER BY date, template`,
    ),
    config: {
      xKey: "date",
      yKey: "count",
      yFormatter: "number",
      pivot: {
        xKey: "date",
        seriesKey: "template",
        valueKey: "count",
      },
      stacked: true,
      description: "Pageview events per day stacked by inferred template/app.",
    },
  },
  {
    key: "top-visited-urls",
    title: "Top Visited URLs",
    chartType: "table",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(
      `WITH pageviews AS (SELECT COALESCE(CASE WHEN NULLIF(hostname, '') IS NOT NULL THEN 'https://' || hostname || COALESCE(NULLIF(path, ''), '/') END, NULLIF(url, ''), NULLIF(path, ''), 'unknown') AS url, CASE WHEN NULLIF(hostname, '') IS NOT NULL THEN 'https://' || hostname || COALESCE(NULLIF(path, ''), '/') WHEN lower(COALESCE(NULLIF(url, ''), '')) LIKE 'http://%' OR lower(COALESCE(NULLIF(url, ''), '')) LIKE 'https://%' THEN url WHEN NULLIF(path, '') IS NOT NULL AND substr(path, 1, 1) = '/' AND substr(path, 1, 2) != '//' THEN path ELSE '' END AS href, COUNT(*) AS views, COUNT(DISTINCT COALESCE(NULLIF(user_id, ''), NULLIF(anonymous_id, ''))) AS users, MAX(substr(timestamp, 1, 10)) AS last_seen FROM analytics_events WHERE event_name = 'pageview' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} GROUP BY 1, 2) SELECT url, views, users, last_seen, href FROM pageviews ORDER BY views DESC LIMIT 25`,
    ),
    config: {
      description:
        "Most-viewed URLs in the selected time range. Links open in a new tab.",
      sortable: true,
      limit: 25,
      columns: [
        { key: "url", label: "URL", format: "link", linkKey: "href" },
        { key: "views", label: "Views", format: "number" },
        { key: "users", label: "Users", format: "number" },
        { key: "last_seen", label: "Last seen", format: "date" },
        { key: "href", hidden: true },
      ],
    },
  },
  {
    key: "top-referrer-domains",
    title: "Top Referrer Domains",
    chartType: "table",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(
      `WITH raw_referrers AS (SELECT COALESCE(NULLIF(referrer, ''), NULLIF(properties::jsonb ->> 'referrer', ''), NULLIF(properties::jsonb ->> 'landing_referrer', '')) AS raw_referrer, NULLIF(hostname, '') AS page_host, COALESCE(NULLIF(user_id, ''), NULLIF(anonymous_id, '')) AS user_key FROM analytics_events WHERE event_name = 'pageview' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER}), referrer_domains AS (SELECT lower(CASE WHEN lower(raw_referrer) LIKE 'http://%' OR lower(raw_referrer) LIKE 'https://%' THEN split_part(split_part(split_part(raw_referrer, '://', 2), '/', 1), chr(63), 1) WHEN raw_referrer LIKE '//%' THEN split_part(split_part(substr(raw_referrer, 3), '/', 1), chr(63), 1) ELSE split_part(split_part(raw_referrer, '/', 1), chr(63), 1) END) AS referrer_domain, lower(page_host) AS page_host, user_key FROM raw_referrers WHERE raw_referrer IS NOT NULL) SELECT referrer_domain, COUNT(*) AS visits, COUNT(DISTINCT user_key) AS users FROM referrer_domains WHERE referrer_domain <> '' AND (page_host IS NULL OR referrer_domain <> page_host) GROUP BY referrer_domain ORDER BY visits DESC LIMIT 20`,
    ),
    config: {
      description:
        "External referrer domains seen on pageview events in the selected time range.",
      sortable: true,
      limit: 20,
      columns: [
        { key: "referrer_domain", label: "Referrer domain" },
        { key: "visits", label: "Visits", format: "number" },
        { key: "users", label: "Users", format: "number" },
      ],
    },
  },
  {
    key: "top-visited-clips",
    title: "Top Visited Clips",
    chartType: "table",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(
      `WITH clip_events AS (SELECT COALESCE(NULLIF(properties::jsonb ->> 'recording_id', ''), NULLIF(path, ''), NULLIF(url, ''), 'unknown') AS clip_key, CASE WHEN lower(COALESCE(NULLIF(url, ''), '')) LIKE 'http://%' OR lower(COALESCE(NULLIF(url, ''), '')) LIKE 'https://%' THEN url WHEN NULLIF(hostname, '') IS NOT NULL THEN 'https://' || hostname || COALESCE(NULLIF(path, ''), '/') WHEN NULLIF(path, '') LIKE '/%' THEN 'https://clips.agent-native.com' || path ELSE '' END AS href, user_id, anonymous_id, timestamp FROM analytics_events WHERE event_name = 'share_view' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND COALESCE(NULLIF(properties::jsonb ->> 'surface', ''), 'clip') = 'clip'), clip_views AS (SELECT clip_key, COALESCE(MAX(NULLIF(href, '')), clip_key) AS href, COUNT(*) AS views, COUNT(DISTINCT COALESCE(NULLIF(user_id, ''), NULLIF(anonymous_id, ''))) AS users, MAX(substr(timestamp, 1, 10)) AS last_seen FROM clip_events GROUP BY clip_key) SELECT CASE WHEN lower(COALESCE(href, '')) LIKE 'http://%' OR lower(COALESCE(href, '')) LIKE 'https://%' THEN href ELSE clip_key END AS clip, views, users, last_seen, href FROM clip_views ORDER BY views DESC LIMIT 25`,
    ),
    config: {
      description: "Most-viewed shared Clips pages in the selected time range.",
      sortable: true,
      limit: 25,
      columns: [
        { key: "clip", label: "Clip URL", format: "link", linkKey: "href" },
        { key: "views", label: "Views", format: "number" },
        { key: "users", label: "Users", format: "number" },
        { key: "last_seen", label: "Last seen", format: "date" },
        { key: "href", hidden: true },
      ],
    },
  },
  {
    key: "repeat-users",
    title: "Repeat Users",
    chartType: "metric",
    source: "first-party",
    width: 1,
    windowed: false,
    buildSql: fixed(
      `WITH user_days AS (SELECT COALESCE(NULLIF(user_id, ''), NULLIF(anonymous_id, '')) AS user_key, COUNT(DISTINCT substr(timestamp, 1, 10)) AS active_days FROM analytics_events WHERE COALESCE(NULLIF(user_id, ''), NULLIF(anonymous_id, '')) IS NOT NULL AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} GROUP BY COALESCE(NULLIF(user_id, ''), NULLIF(anonymous_id, ''))) SELECT COUNT(*) AS count FROM user_days WHERE active_days >= 2`,
    ),
    config: {
      yKey: "count",
      yFormatter: "number",
      description:
        "Distinct users with activity on at least two days in the selected time range. Uses user_id first, then anonymous_id.",
    },
  },
  {
    key: "retention-over-time",
    title: "1d / 7d Retention Over Time",
    chartType: "line",
    source: "first-party",
    width: 3,
    windowed: false,
    buildSql: fixed(RETENTION_OVER_TIME_SQL),
    config: {
      xKey: "date",
      yKey: "rate",
      yFormatter: "percent",
      pivot: {
        xKey: "date",
        seriesKey: "period",
        valueKey: "rate",
      },
      colors: ["#10b981", "#8b5cf6"],
      description:
        "First-seen daily cohorts in the selected range. Cohorts must be at least seven days old so both lines are mature.",
    },
  },
  {
    key: "one-day-retention-by-template",
    title: "1d Retention by Template",
    chartType: "line",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(ONE_DAY_RETENTION_BY_TEMPLATE_SQL),
    config: {
      xKey: "date",
      yKey: "rate",
      yFormatter: "percent",
      pivot: {
        xKey: "date",
        seriesKey: "template",
        valueKey: "rate",
      },
      description:
        "Per-template first-seen cohorts in the selected range, excluding unassigned telemetry. A user is retained when they return to the same template the next day.",
    },
  },
  {
    key: "seven-day-retention-by-template",
    title: "7d Retention by Template",
    chartType: "line",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(SEVEN_DAY_RETENTION_BY_TEMPLATE_SQL),
    config: {
      xKey: "date",
      yKey: "rate",
      yFormatter: "percent",
      pivot: {
        xKey: "date",
        seriesKey: "template",
        valueKey: "rate",
      },
      description:
        "Per-template first-seen cohorts in the selected range, excluding unassigned telemetry. A user is retained when they return to the same template seven days later.",
    },
  },
  {
    key: "dau-over-time",
    title: "DAU by Template",
    chartType: "area",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(DAU_BY_TEMPLATE_SQL),
    config: {
      xKey: "date",
      yKey: "users",
      yFormatter: "number",
      pivot: {
        xKey: "date",
        seriesKey: "template",
        valueKey: "users",
      },
      stacked: true,
      description:
        "Distinct active users per day in the selected time range, stacked by inferred template/app. Unassigned telemetry is excluded.",
    },
  },
  {
    key: "wau-over-time",
    title: "WAU by Template",
    chartType: "area",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(WAU_BY_TEMPLATE_SQL),
    config: {
      xKey: "date",
      yKey: "users",
      yFormatter: "number",
      pivot: {
        xKey: "date",
        seriesKey: "template",
        valueKey: "users",
      },
      stacked: true,
      description:
        "Trailing 7-day distinct active users for each active date in the selected time range, stacked by inferred template/app. Unassigned telemetry is excluded.",
    },
  },

  // --- Virality & referrals (windowed) ------------------------------------
  {
    key: "referred-signups-30d",
    title: "Referred Signups (30d)",
    chartType: "metric",
    source: "first-party",
    width: 1,
    windowed: true,
    buildSql: windowed(
      "SELECT COUNT(*) AS count FROM analytics_events WHERE event_name = 'signup' AND timestamp::timestamptz >= now() - interval '30 days' AND properties::jsonb ->> 'referral_source' IS NOT NULL AND properties::jsonb ->> 'referral_source' <> '' AND properties::jsonb ->> 'referral_source' <> 'direct'",
    ),
    config: {
      yKey: "count",
      yFormatter: "number",
      description:
        "Signups in the window with a non-direct referral_source (clip_share, plan_share, external).",
    },
  },
  {
    key: "viral-signup-share-30d",
    title: "Viral Signup Share (30d)",
    chartType: "metric",
    source: "first-party",
    width: 1,
    windowed: true,
    buildSql: windowed(
      "SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE 1.0 * COUNT(*) FILTER (WHERE properties::jsonb ->> 'referral_source' IS NOT NULL AND properties::jsonb ->> 'referral_source' <> '' AND properties::jsonb ->> 'referral_source' <> 'direct') / COUNT(*) END AS rate FROM analytics_events WHERE event_name = 'signup' AND timestamp::timestamptz >= now() - interval '30 days'",
    ),
    config: {
      yKey: "rate",
      yFormatter: "percent",
      description:
        "Headline virality number: referred signups divided by all signups over the window.",
    },
  },
  {
    key: "clip-share-signups-30d",
    title: "Clip-Share Signups (30d)",
    chartType: "metric",
    source: "first-party",
    width: 1,
    windowed: true,
    buildSql: windowed(
      "SELECT COUNT(*) AS count FROM analytics_events WHERE event_name = 'signup' AND timestamp::timestamptz >= now() - interval '30 days' AND properties::jsonb ->> 'referral_source' = 'clip_share'",
    ),
    config: {
      yKey: "count",
      yFormatter: "number",
      description: "Signups in the window attributed to a shared clip.",
    },
  },
  {
    key: "signups-by-referral-source",
    title: "Signups by Referral Source (90d)",
    chartType: "bar",
    source: "first-party",
    width: 1,
    windowed: true,
    buildSql: windowed(
      "SELECT COALESCE(NULLIF(properties::jsonb ->> 'referral_source', ''), 'direct') AS referral_source, COUNT(*) AS count FROM analytics_events WHERE event_name = 'signup' AND timestamp::timestamptz >= now() - interval '90 days' GROUP BY COALESCE(NULLIF(properties::jsonb ->> 'referral_source', ''), 'direct') ORDER BY count DESC LIMIT 20",
    ),
    config: {
      xKey: "referral_source",
      yKey: "count",
      color: "var(--brand-purple)",
      description:
        "Signups grouped by referral_source over the window. Null/empty sources are bucketed as direct.",
    },
  },
  {
    key: "referred-signups-over-time",
    title: "Referred Signups Over Time (90d)",
    chartType: "area",
    source: "first-party",
    width: 2,
    windowed: true,
    buildSql: windowed(
      "SELECT substr(timestamp, 1, 10) AS date, COUNT(*) AS count FROM analytics_events WHERE event_name = 'signup' AND timestamp::timestamptz >= now() - interval '90 days' AND properties::jsonb ->> 'referral_source' IS NOT NULL AND properties::jsonb ->> 'referral_source' <> '' AND properties::jsonb ->> 'referral_source' <> 'direct' GROUP BY substr(timestamp, 1, 10) ORDER BY date",
    ),
    config: {
      xKey: "date",
      yKey: "count",
      color: "var(--brand-purple)",
      description: "Daily referred (non-direct) signups over the window.",
    },
  },
  {
    key: "top-referrers",
    title: "Top Referrers (90d)",
    chartType: "table",
    source: "first-party",
    width: 1,
    windowed: true,
    buildSql: windowed(
      "SELECT properties::jsonb ->> 'referrer_user' AS referrer_user, COUNT(*) AS signups FROM analytics_events WHERE event_name = 'signup' AND timestamp::timestamptz >= now() - interval '90 days' AND properties::jsonb ->> 'referrer_user' IS NOT NULL AND properties::jsonb ->> 'referrer_user' <> '' GROUP BY properties::jsonb ->> 'referrer_user' ORDER BY signups DESC LIMIT 20",
    ),
    config: {
      description:
        "Users (by id) driving the most referred signups in the window.",
      columns: [
        { key: "referrer_user", label: "Referrer (user id)" },
        { key: "signups", label: "Signups", format: "number" },
      ],
    },
  },
  {
    key: "share-funnel-30d",
    title: "Share Funnel (30d)",
    chartType: "bar",
    source: "first-party",
    width: 2,
    windowed: true,
    buildSql: windowed(
      "SELECT 'Share views' AS stage, COUNT(*) AS count FROM analytics_events WHERE event_name = 'share_view' AND timestamp::timestamptz >= now() - interval '30 days' UNION ALL SELECT 'CTA clicks' AS stage, COUNT(*) AS count FROM analytics_events WHERE event_name = 'share_cta_click' AND timestamp::timestamptz >= now() - interval '30 days' UNION ALL SELECT 'Clip-share signups' AS stage, COUNT(*) AS count FROM analytics_events WHERE event_name = 'signup' AND timestamp::timestamptz >= now() - interval '30 days' AND properties::jsonb ->> 'referral_source' = 'clip_share'",
    ),
    config: {
      xKey: "stage",
      yKey: "count",
      color: "var(--brand-teal)",
      description:
        "View to click to signup funnel for shared surfaces over the window: share_view, share_cta_click, then clip_share signups.",
    },
  },
  {
    key: "viral-participation-rate-90d",
    title: "Viral Participation Rate (90d)",
    chartType: "metric",
    source: "first-party",
    width: 1,
    windowed: true,
    buildSql: windowed(
      "SELECT COALESCE(COUNT(*) FILTER (WHERE recent.auth_user_id IN (SELECT properties::jsonb ->> 'referrer_user' FROM analytics_events WHERE event_name = 'signup' AND properties::jsonb ->> 'referrer_user' IS NOT NULL AND properties::jsonb ->> 'referrer_user' <> ''))::float / NULLIF(COUNT(*), 0), 0) AS rate FROM (SELECT DISTINCT properties::jsonb ->> 'auth_user_id' AS auth_user_id FROM analytics_events WHERE event_name = 'signup' AND timestamp::timestamptz >= now() - interval '90 days' AND properties::jsonb ->> 'auth_user_id' IS NOT NULL AND properties::jsonb ->> 'auth_user_id' <> '') AS recent",
    ),
    config: {
      yKey: "rate",
      yFormatter: "percent",
      description:
        "Share of users who signed up in the window who have since referred at least one new signup (referrers counted across all time). New cohorts under-count: recent signups haven't had time to refer yet. Matches auth_user_id to referrer_user (both better-auth ids).",
    },
  },
  {
    key: "viral-coefficient-90d",
    title: "Viral Coefficient K (90d)",
    chartType: "metric",
    source: "first-party",
    width: 1,
    windowed: true,
    buildSql: windowed(
      "SELECT COALESCE(COUNT(*) FILTER (WHERE properties::jsonb ->> 'referrer_user' IS NOT NULL AND properties::jsonb ->> 'referrer_user' <> '')::float / NULLIF(COUNT(DISTINCT properties::jsonb ->> 'auth_user_id'), 0), 0) AS k FROM analytics_events WHERE event_name = 'signup' AND timestamp::timestamptz >= now() - interval '90 days'",
    ),
    config: {
      yKey: "k",
      yFormatter: "number",
      description:
        "Viral coefficient (K): referred signups divided by new users over the window. K >= 1 means each user brings on at least one more, i.e. self-sustaining growth.",
    },
  },
  {
    key: "activated-referrers-90d",
    title: "Activated Referrers (90d)",
    chartType: "metric",
    source: "first-party",
    width: 1,
    windowed: true,
    buildSql: windowed(
      "SELECT COUNT(DISTINCT properties::jsonb ->> 'referrer_user') AS count FROM analytics_events WHERE event_name = 'signup' AND timestamp::timestamptz >= now() - interval '90 days' AND properties::jsonb ->> 'referrer_user' IS NOT NULL AND properties::jsonb ->> 'referrer_user' <> ''",
    ),
    config: {
      yKey: "count",
      yFormatter: "number",
      description:
        "Distinct users who drove at least one referred signup in the window (distinct referrer_user on signups in the window).",
    },
  },
];

const CATALOG: Map<string, FirstPartyMetric> = new Map(
  ENTRIES.map((entry) => [entry.key, entry]),
);

/** All metric keys, in catalog order. */
export function listMetricKeys(): string[] {
  return ENTRIES.map((entry) => entry.key);
}

/** All catalog entries, in catalog order. */
export function listMetrics(): FirstPartyMetric[] {
  return [...ENTRIES];
}

/** Look up a single metric by key. Returns undefined for unknown keys. */
export function getMetric(key: string): FirstPartyMetric | undefined {
  return CATALOG.get(key);
}

export interface ComposedPanel {
  id: string;
  title: string;
  chartType: string;
  source: "first-party";
  width: number;
  sql: string;
  config: Record<string, unknown>;
}

export interface ComposePanelOverrides {
  /** Panel id / metric key override (defaults to the metric key). */
  id?: string;
  title?: string;
  chartType?: string;
  width?: number;
  window?: MetricWindow;
}

/**
 * Expand a metric key into a full dashboard panel, applying optional overrides.
 * Returns null for unknown keys so callers can report them gracefully instead
 * of throwing.
 */
export function buildPanel(
  key: string,
  overrides: ComposePanelOverrides = {},
): ComposedPanel | null {
  const metric = CATALOG.get(key);
  if (!metric) return null;
  const window = overrides.window;
  const width =
    typeof overrides.width === "number" &&
    Number.isInteger(overrides.width) &&
    overrides.width >= 1 &&
    overrides.width <= 6
      ? overrides.width
      : metric.width;
  return {
    id: overrides.id?.trim() || metric.key,
    title: overrides.title?.trim() || metric.title,
    chartType: overrides.chartType?.trim() || metric.chartType,
    source: "first-party",
    width,
    sql: metric.buildSql(window),
    // Clone so callers can't mutate the shared catalog config object.
    config: { ...metric.config },
  };
}
