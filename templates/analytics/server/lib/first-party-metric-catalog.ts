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

/**
 * Catalog entries. Order here is the default panel order when a caller passes
 * metrics; callers can reorder by listing keys in the order they want.
 */
const ENTRIES: FirstPartyMetric[] = [
  // --- Signups -------------------------------------------------------------
  {
    key: "total-signups",
    title: "Signups",
    chartType: "metric",
    source: "first-party",
    width: 1,
    windowed: false,
    buildSql: fixed(
      "SELECT COUNT(*) AS count FROM analytics_events WHERE event_name = 'signup'",
    ),
    config: {
      yKey: "count",
      yFormatter: "number",
      description:
        "Better Auth user creation events from all Agent Native templates",
    },
  },
  {
    key: "signups-over-time",
    title: "Signups Over Time",
    chartType: "area",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(
      "SELECT substr(timestamp, 1, 10) AS date, COUNT(*) AS count FROM analytics_events WHERE event_name = 'signup' GROUP BY substr(timestamp, 1, 10) ORDER BY date",
    ),
    config: {
      xKey: "date",
      yKey: "count",
      color: "#8b5cf6",
      description: "Daily signup events across all Agent Native templates",
    },
  },
  {
    key: "signups-by-template",
    title: "Signups by Template",
    chartType: "bar",
    source: "first-party",
    width: 1,
    windowed: false,
    buildSql: fixed(
      "SELECT COALESCE(NULLIF(template, ''), NULLIF(app, ''), 'unknown') AS template, COUNT(*) AS count FROM analytics_events WHERE event_name = 'signup' GROUP BY COALESCE(NULLIF(template, ''), NULLIF(app, ''), 'unknown') ORDER BY count DESC LIMIT 20",
    ),
    config: {
      xKey: "template",
      yKey: "count",
      color: "#8b5cf6",
      description: "Signup events grouped by inferred template/app",
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
      "SELECT COUNT(*) AS count FROM analytics_events WHERE event_name = 'click template'",
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
      "SELECT COUNT(*) AS count FROM analytics_events WHERE event_name = 'click try demo'",
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
      "SELECT COUNT(*) AS count FROM analytics_events WHERE event_name = 'copy cli command'",
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
      "SELECT substr(timestamp, 1, 10) AS date, COUNT(*) AS count FROM analytics_events WHERE event_name = 'click template' GROUP BY substr(timestamp, 1, 10) ORDER BY date",
    ),
    config: { xKey: "date", yKey: "count", color: "var(--brand-blue)" },
  },
  {
    key: "clicks-by-template",
    title: "Clicks by Template",
    chartType: "bar",
    source: "first-party",
    width: 1,
    windowed: false,
    buildSql: fixed(
      "SELECT COALESCE(NULLIF(template, ''), 'unknown') AS template, COUNT(*) AS count FROM analytics_events WHERE event_name = 'click template' GROUP BY COALESCE(NULLIF(template, ''), 'unknown') ORDER BY count DESC LIMIT 20",
    ),
    config: { xKey: "template", yKey: "count", color: "var(--brand-blue)" },
  },
  {
    key: "demo-clicks-by-template",
    title: "Try-Demo Clicks by Template",
    chartType: "bar",
    source: "first-party",
    width: 1,
    windowed: false,
    buildSql: fixed(
      "SELECT COALESCE(NULLIF(template, ''), 'unknown') AS template, COUNT(*) AS count FROM analytics_events WHERE event_name = 'click try demo' GROUP BY COALESCE(NULLIF(template, ''), 'unknown') ORDER BY count DESC LIMIT 20",
    ),
    config: { xKey: "template", yKey: "count", color: "var(--brand-teal)" },
  },
  {
    key: "cli-copies-by-template",
    title: "CLI Copies by Template",
    chartType: "bar",
    source: "first-party",
    width: 1,
    windowed: false,
    buildSql: fixed(
      "SELECT COALESCE(NULLIF(template, ''), 'unknown') AS template, COUNT(*) AS count FROM analytics_events WHERE event_name = 'copy cli command' GROUP BY COALESCE(NULLIF(template, ''), 'unknown') ORDER BY count DESC LIMIT 20",
    ),
    config: { xKey: "template", yKey: "count", color: "#06b6d4" },
  },
  {
    key: "cli-copies-over-time",
    title: "CLI Copies Over Time",
    chartType: "area",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(
      "SELECT substr(timestamp, 1, 10) AS date, COUNT(*) AS count FROM analytics_events WHERE event_name = 'copy cli command' GROUP BY substr(timestamp, 1, 10) ORDER BY date",
    ),
    config: { xKey: "date", yKey: "count", color: "#06b6d4" },
  },

  // --- Activity / pageviews ------------------------------------------------
  {
    key: "pageviews-over-time",
    title: "Pageviews Over Time",
    chartType: "area",
    source: "first-party",
    width: 2,
    windowed: false,
    // First-party tracking has no distinct `pageview` event; total tracked
    // events per day is the honest activity/pageviews proxy over analytics_events.
    buildSql: fixed(
      "SELECT substr(timestamp, 1, 10) AS date, COUNT(*) AS count FROM analytics_events GROUP BY substr(timestamp, 1, 10) ORDER BY date",
    ),
    config: {
      xKey: "date",
      yKey: "count",
      color: "var(--brand-blue)",
      description:
        "Total first-party tracked events per day (activity proxy — there is no distinct pageview event in /track data).",
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
