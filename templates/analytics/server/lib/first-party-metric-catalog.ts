export type MetricWindow = "30d" | "90d" | "all";

export const FIRST_PARTY_DASHBOARD_ID = "agent-native-templates-first-party";

export interface FirstPartyMetric {
  key: string;
  title: string;
  chartType: string;
  source: "first-party";
  width: number;
  buildSql: (window?: MetricWindow) => string;
  windowed: boolean;
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

function applyWindow(sql: string, window: MetricWindow): string {
  if (window === "all") {
    return sql
      .replace(
        /\s+AND\s+substr\s*\(\s*timestamp\s*,\s*1\s*,\s*10\s*\)\s*>=\s*to_char\s*\(\s*CURRENT_DATE\s*-\s*INTERVAL\s*'\d+\s*days?'\s*,\s*'YYYY-MM-DD'\s*\)/gi,
        "",
      )
      .replace(
        /\s+WHERE\s+substr\s*\(\s*timestamp\s*,\s*1\s*,\s*10\s*\)\s*>=\s*to_char\s*\(\s*CURRENT_DATE\s*-\s*INTERVAL\s*'\d+\s*days?'\s*,\s*'YYYY-MM-DD'\s*\)\s+AND\s+/gi,
        " WHERE ",
      )
      .replace(
        /\s+AND\s+event_date\s*>=\s*to_char\s*\(\s*CURRENT_DATE\s*-\s*INTERVAL\s*'\d+\s*days?'\s*,\s*'YYYY-MM-DD'\s*\)/gi,
        "",
      )
      .replace(
        /\s+WHERE\s+event_date\s*>=\s*to_char\s*\(\s*CURRENT_DATE\s*-\s*INTERVAL\s*'\d+\s*days?'\s*,\s*'YYYY-MM-DD'\s*\)\s+AND\s+/gi,
        " WHERE ",
      )
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

function windowed(sql: string): (window?: MetricWindow) => string {
  return (window) => (window ? applyWindow(sql, window) : sql);
}

function fixed(sql: string): (window?: MetricWindow) => string {
  return () => sql;
}

const TEMPLATE_EXPR =
  "COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(properties::jsonb ->> 'agent_native_template', ''), NULLIF(properties::jsonb ->> 'agentNativeTemplate', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), NULLIF(properties::jsonb ->> 'agentNativeApp', ''), 'unknown')";
export const FIRST_PARTY_TEMPLATE_NAMES = [
  "analytics",
  "assets",
  "brain",
  "calendar",
  "chat",
  "clips",
  "content",
  "design",
  "dispatch",
  "forms",
  "mail",
  "plan",
  "slides",
] as const;
export const FIRST_PARTY_TEMPLATE_SCOPED_METRIC_KEYS = [
  "total-signups",
  "signups-over-time",
  "signups-by-template",
  "total-template-clicks",
  "total-demo-clicks",
  "total-cli-copies",
  "template-interest-over-time",
  "clicks-by-template",
  "demo-clicks-over-time",
  "cli-copies-by-template",
  "cli-copies-over-time",
  "pageviews-over-time",
  "sessions-by-app",
  "repeat-users",
  "recurring-users-by-template",
  "recurring-users-by-template-bar",
  "retention-over-time",
  "one-day-retention-by-template",
  "seven-day-retention-by-template",
  "dau-over-time",
  "wau-over-time",
  "activation-funnel",
  "signup-method-conversion",
  "onboarding-step-dropoff",
  "onboarding-setup-choice",
  "sharing-actions-by-app",
] as const;
const FIRST_PARTY_TEMPLATE_SQL_LIST = FIRST_PARTY_TEMPLATE_NAMES.map(
  (name) => `'${name}'`,
).join(", ");
export function firstPartyTemplateFilter(
  templateExpression = TEMPLATE_EXPR,
): string {
  return `lower(${templateExpression}) IN (${FIRST_PARTY_TEMPLATE_SQL_LIST})`;
}
const FIRST_PARTY_TEMPLATE_FILTER = firstPartyTemplateFilter();
const KNOWN_TEMPLATE_FILTER = `${TEMPLATE_EXPR} <> 'unknown'`;
const PRODUCT_ACTIVITY_TEMPLATE_FILTER = `lower(${TEMPLATE_EXPR}) <> 'docs'`;
const MARKETING_SITE_TEMPLATE_FILTER = `lower(${TEMPLATE_EXPR}) <> 'www'`;
const KNOWN_PRODUCT_ACTIVITY_TEMPLATE_FILTER = `${KNOWN_TEMPLATE_FILTER} AND ${PRODUCT_ACTIVITY_TEMPLATE_FILTER}`;
const FIRST_PARTY_PRODUCT_ACTIVITY_TEMPLATE_FILTER = `${PRODUCT_ACTIVITY_TEMPLATE_FILTER} AND ${FIRST_PARTY_TEMPLATE_FILTER}`;
const FIRST_PARTY_KNOWN_PRODUCT_ACTIVITY_TEMPLATE_FILTER = `${KNOWN_PRODUCT_ACTIVITY_TEMPLATE_FILTER} AND ${FIRST_PARTY_TEMPLATE_FILTER}`;
const EVENT_DATE_SQL = "event_date";
const EVENT_DATE_FILTER_SQL = EVENT_DATE_SQL;
const USER_KEY_SQL = "NULLIF(user_key, '')";
const RETENTION_ROLLING_DAYS = 7;
const RETENTION_MIN_COHORT_SIZE = 5;
const PER_TEMPLATE_RETENTION_MIN_COHORT_SIZE = 20;
const OBSERVED_ACTIVITY_LOOKBACK_DAYS = 365;
const RETENTION_SPINE_DAYS_SQL =
  "(CASE '{{timeRange}}' WHEN '7d' THEN 7 WHEN '30d' THEN 30 WHEN '90d' THEN 90 WHEN '180d' THEN 180 WHEN '365d' THEN 365 ELSE 365 END)";

function daysAgoSql(days: number): string {
  const unit = days === 1 ? "day" : "days";
  return `to_char(CURRENT_DATE - INTERVAL '${days} ${unit}', 'YYYY-MM-DD')`;
}

function todaySql(): string {
  return "to_char(CURRENT_DATE, 'YYYY-MM-DD')";
}

function windowStartFilter(days: number): string {
  return `${EVENT_DATE_SQL} >= ${daysAgoSql(days)}`;
}

function rollingWindowStartSql(
  anchorExpr = "a.date",
  rollingDays = RETENTION_ROLLING_DAYS,
): string {
  return `to_char(${anchorExpr}::date - INTERVAL '${rollingDays - 1} days', 'YYYY-MM-DD')`;
}

function dashboardTimeRangeFilter(dateExpr = EVENT_DATE_FILTER_SQL): string {
  return `(${dateExpr} <= ${todaySql()} AND ('{{timeRange}}' IN ('', 'all') OR ('{{timeRange}}' = '7d' AND ${dateExpr} >= ${daysAgoSql(7)}) OR ('{{timeRange}}' = '30d' AND ${dateExpr} >= ${daysAgoSql(30)}) OR ('{{timeRange}}' = '90d' AND ${dateExpr} >= ${daysAgoSql(90)}) OR ('{{timeRange}}' = '180d' AND ${dateExpr} >= ${daysAgoSql(180)}) OR ('{{timeRange}}' = '365d' AND ${dateExpr} >= ${daysAgoSql(365)})))`;
}

function dashboardLookbackTimeRangeFilter(
  dateExpr = EVENT_DATE_FILTER_SQL,
  lookbackDays = 0,
): string {
  return `(${dateExpr} <= ${todaySql()} AND ('{{timeRange}}' IN ('', 'all') OR ('{{timeRange}}' = '7d' AND ${dateExpr} >= ${daysAgoSql(7 + lookbackDays)}) OR ('{{timeRange}}' = '30d' AND ${dateExpr} >= ${daysAgoSql(30 + lookbackDays)}) OR ('{{timeRange}}' = '90d' AND ${dateExpr} >= ${daysAgoSql(90 + lookbackDays)}) OR ('{{timeRange}}' = '180d' AND ${dateExpr} >= ${daysAgoSql(180 + lookbackDays)}) OR ('{{timeRange}}' = '365d' AND ${dateExpr} >= ${daysAgoSql(365 + lookbackDays)})))`;
}

const DASHBOARD_TIME_RANGE_FILTER = dashboardTimeRangeFilter();
const DASHBOARD_EVENT_DATE_RANGE_FILTER =
  dashboardTimeRangeFilter("event_date");
const DASHBOARD_WAU_BASE_RANGE_FILTER = dashboardLookbackTimeRangeFilter(
  EVENT_DATE_FILTER_SQL,
  6,
);
const DASHBOARD_EMAIL_FILTER =
  "('{{emailFilter}}' IN ('', 'all') OR ('{{emailFilter}}' = 'exclude_builder' AND lower(coalesce(user_id, '')) NOT LIKE '%@builder.io') OR ('{{emailFilter}}' = 'only_builder' AND lower(coalesce(user_id, '')) LIKE '%@builder.io'))";
const DASHBOARD_APP_FILTER = `('{{appFilter}}' IN ('', 'all') OR lower(${TEMPLATE_EXPR}) = lower('{{appFilter}}'))`;
const SESSION_STATUS_FILTER = `event_name = 'session status' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${DASHBOARD_APP_FILTER}`;
const SIGNED_IN_ACTIVITY_KEY_SQL = USER_KEY_SQL;
const SESSION_STATUS_EVENT_FILTER =
  "event_name IN ('session status', 'session_status')";
const LEGACY_SIGNED_IN_ACTIVITY_FILTER = `event_name = 'session status' AND signed_in = 'true' AND ${SIGNED_IN_ACTIVITY_KEY_SQL} IS NOT NULL`;
const SIGNED_IN_ACTIVITY_FILTER = `((${SESSION_STATUS_EVENT_FILTER} AND signed_in = 'true') OR (event_name = 'app_entered' AND NULLIF(user_id, '') IS NOT NULL)) AND ${SIGNED_IN_ACTIVITY_KEY_SQL} IS NOT NULL`;
const LEGACY_SIGNED_IN_PRODUCT_ACTIVITY_FILTER = `${LEGACY_SIGNED_IN_ACTIVITY_FILTER} AND ${PRODUCT_ACTIVITY_TEMPLATE_FILTER}`;
const SIGNED_IN_PRODUCT_ACTIVITY_FILTER = `${SIGNED_IN_ACTIVITY_FILTER} AND ${PRODUCT_ACTIVITY_TEMPLATE_FILTER}`;
const REPLAY_RECORDING_DATE_SQL = "substr(started_at, 1, 10)";
const REPLAY_TIME_RANGE_FILTER = dashboardTimeRangeFilter(
  REPLAY_RECORDING_DATE_SQL,
);
const REPLAY_VISITOR_EMAIL_SQL =
  "COALESCE(NULLIF(CASE WHEN lower(coalesce(user_id, '')) LIKE '%@%' THEN user_id ELSE '' END, ''), NULLIF(CASE WHEN lower(coalesce(user_key, '')) LIKE '%@%' THEN user_key ELSE '' END, ''))";
const REPLAY_EMAIL_FILTER = `('{{emailFilter}}' IN ('', 'all') OR ('{{emailFilter}}' = 'exclude_builder' AND lower(coalesce(${REPLAY_VISITOR_EMAIL_SQL}, '')) NOT LIKE '%@builder.io') OR ('{{emailFilter}}' = 'only_builder' AND lower(coalesce(${REPLAY_VISITOR_EMAIL_SQL}, '')) LIKE '%@builder.io'))`;
const REPLAY_APP_FILTER = `('{{appFilter}}' IN ('', 'all') OR lower(COALESCE(NULLIF(app, ''), NULLIF(template, ''), 'unknown')) = lower('{{appFilter}}'))`;
const REPLAY_RECORDING_FILTER = `chunk_count > 0 AND event_count > 0 AND ${REPLAY_VISITOR_EMAIL_SQL} IS NOT NULL AND ${REPLAY_TIME_RANGE_FILTER} AND ${REPLAY_EMAIL_FILTER} AND ${REPLAY_APP_FILTER}`;
const REPLAY_SESSIONS_SQL = `SELECT COUNT(*) AS count FROM session_recordings WHERE ${REPLAY_RECORDING_FILTER}`;
const REPLAY_CHUNKS_OVER_TIME_SQL = `SELECT ${REPLAY_RECORDING_DATE_SQL} AS date, SUM(chunk_count) AS count FROM session_recordings WHERE ${REPLAY_RECORDING_FILTER} GROUP BY ${REPLAY_RECORDING_DATE_SQL} ORDER BY date`;
const RECENT_REPLAY_SESSIONS_SQL = `SELECT id AS recording_id, session_id, COALESCE(NULLIF(app, ''), NULLIF(template, ''), 'unknown') AS app, ${REPLAY_VISITOR_EMAIL_SQL} AS visitor, chunk_count AS chunks, event_count AS events, started_at, COALESCE(ended_at, last_ingested_at, started_at) AS last_seen, '/sessions/' || id AS href FROM session_recordings WHERE ${REPLAY_RECORDING_FILTER} ORDER BY last_seen DESC LIMIT 25`;
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
    default: "exclude_builder",
    options: [
      { value: "all", label: "All users" },
      { value: "exclude_builder", label: "Exclude @builder.io" },
      { value: "only_builder", label: "Only @builder.io" },
    ],
  },
  {
    id: "appFilter",
    type: "select",
    label: "App",
    default: "all",
    options: [
      { value: "all", label: "All Agent-Native apps" },
      ...FIRST_PARTY_TEMPLATE_NAMES.map((value) => ({
        value,
        label: value[0].toUpperCase() + value.slice(1),
      })),
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
  return (
    sql.includes("{{timeRange}}") ||
    sql.includes("{{emailFilter}}") ||
    sql.includes("{{appFilter}}")
  );
}

export function scopeFirstPartyPanelSql(sql: string): string {
  if (sql.includes("{{appFilter}}")) return sql;
  return sql
    .replace(
      /(\bFROM\s+analytics_events(?:\s+AS\s+\w+)?\s+WHERE\s+)/gi,
      `$1${DASHBOARD_APP_FILTER} AND `,
    )
    .replace(
      /(\bFROM\s+session_recordings\s+WHERE\s+)/gi,
      `$1${REPLAY_APP_FILTER} AND `,
    );
}

const TOTAL_SIGNUPS_SQL = `SELECT COUNT(*) AS signups FROM analytics_events WHERE event_name = 'signup' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${FIRST_PARTY_TEMPLATE_FILTER}`;
const LEGACY_SEED_SIGNUPS_TIME_RANGE_FILTER = `('{{timeRange}}' IN ('', 'all') OR ('{{timeRange}}' = '7d' AND ${EVENT_DATE_SQL} >= ${daysAgoSql(7)}) OR ('{{timeRange}}' = '30d' AND ${EVENT_DATE_SQL} >= ${daysAgoSql(30)}) OR ('{{timeRange}}' = '90d' AND ${EVENT_DATE_SQL} >= ${daysAgoSql(90)}) OR ('{{timeRange}}' = '180d' AND ${EVENT_DATE_SQL} >= ${daysAgoSql(180)}) OR ('{{timeRange}}' = '365d' AND ${EVENT_DATE_SQL} >= ${daysAgoSql(365)}))`;
export const LEGACY_SEED_SIGNUPS_OVER_TIME_SQL = `WITH offsets AS (SELECT (ROW_NUMBER() OVER (ORDER BY ${EVENT_DATE_SQL}) - 1)::int AS n FROM analytics_events LIMIT 800), signup_events AS (SELECT ${EVENT_DATE_SQL} AS date, ${TEMPLATE_EXPR} AS template FROM analytics_events WHERE event_name = 'signup' AND ${LEGACY_SEED_SIGNUPS_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER}), bounds AS (SELECT MIN(date::date) AS start_date, MAX(date::date) AS end_date FROM signup_events), dates AS (SELECT to_char(bounds.start_date + offsets.n, 'YYYY-MM-DD') AS date FROM bounds CROSS JOIN offsets WHERE bounds.start_date IS NOT NULL AND bounds.start_date + offsets.n <= bounds.end_date), templates AS (SELECT DISTINCT template FROM signup_events), daily AS (SELECT date, template, COUNT(*) AS count FROM signup_events GROUP BY date, template) SELECT dates.date, templates.template, COALESCE(daily.count, 0) AS count FROM dates CROSS JOIN templates LEFT JOIN daily ON daily.date = dates.date AND daily.template = templates.template ORDER BY dates.date, templates.template`;
export const LEGACY_SIGNUPS_OVER_TIME_SQL = `WITH offsets AS (SELECT (ROW_NUMBER() OVER (ORDER BY ${EVENT_DATE_SQL}) - 1)::int AS n FROM analytics_events LIMIT 800), signup_events AS (SELECT ${EVENT_DATE_SQL} AS date, ${TEMPLATE_EXPR} AS template FROM analytics_events WHERE event_name = 'signup' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER}), bounds AS (SELECT MIN(date::date) AS start_date, MAX(date::date) AS end_date FROM signup_events), dates AS (SELECT to_char(bounds.start_date + offsets.n, 'YYYY-MM-DD') AS date FROM bounds CROSS JOIN offsets WHERE bounds.start_date IS NOT NULL AND bounds.start_date + offsets.n <= bounds.end_date), templates AS (SELECT DISTINCT template FROM signup_events), daily AS (SELECT date, template, COUNT(*) AS count FROM signup_events GROUP BY date, template) SELECT dates.date, templates.template, COALESCE(daily.count, 0) AS count FROM dates CROSS JOIN templates LEFT JOIN daily ON daily.date = dates.date AND daily.template = templates.template ORDER BY dates.date, templates.template`;
export const SIGNUPS_OVER_TIME_SQL = `WITH digits AS (SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9), offsets AS (SELECT ones.n + tens.n * 10 + hundreds.n * 100 AS n FROM digits ones CROSS JOIN digits tens CROSS JOIN digits hundreds WHERE hundreds.n < 8), signup_events AS (SELECT ${EVENT_DATE_SQL} AS date, ${TEMPLATE_EXPR} AS template FROM analytics_events WHERE event_name = 'signup' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${FIRST_PARTY_TEMPLATE_FILTER}), bounds AS (SELECT MIN(date::date) AS start_date, MAX(date::date) AS end_date FROM signup_events), dates AS (SELECT to_char(bounds.start_date + offsets.n, 'YYYY-MM-DD') AS date FROM bounds CROSS JOIN offsets WHERE bounds.start_date IS NOT NULL AND bounds.start_date + offsets.n <= bounds.end_date), templates AS (SELECT DISTINCT template FROM signup_events), daily AS (SELECT date, template, COUNT(*) AS count FROM signup_events GROUP BY date, template) SELECT dates.date, templates.template, COALESCE(daily.count, 0) AS count FROM dates CROSS JOIN templates LEFT JOIN daily ON daily.date = dates.date AND daily.template = templates.template ORDER BY dates.date, templates.template`;
export const LEGACY_RETENTION_OVER_TIME_SQL = `WITH base AS (SELECT ${SIGNED_IN_ACTIVITY_KEY_SQL} AS user_key, ${EVENT_DATE_SQL} AS event_date, user_id FROM analytics_events WHERE ${LEGACY_SIGNED_IN_PRODUCT_ACTIVITY_FILTER} AND ${DASHBOARD_EMAIL_FILTER}), first_seen AS (SELECT user_key, MIN(event_date) AS cohort_date FROM base GROUP BY user_key), anchor_dates AS (SELECT DISTINCT cohort_date AS date FROM first_seen WHERE cohort_date <= ${daysAgoSql(14)} AND ${dashboardTimeRangeFilter("cohort_date")}), cohort_windows AS (SELECT a.date, f.user_key, f.cohort_date FROM anchor_dates a JOIN first_seen f ON f.cohort_date >= ${rollingWindowStartSql()} AND f.cohort_date <= a.date), cohort_sizes AS (SELECT date, COUNT(DISTINCT user_key) AS users FROM cohort_windows GROUP BY date), periods AS (SELECT '1-7d return' AS period UNION ALL SELECT '7-14d return' AS period), retained AS (SELECT cw.date, '1-7d return' AS period, COUNT(DISTINCT cw.user_key) AS retained FROM cohort_windows cw JOIN base b ON b.user_key = cw.user_key AND b.event_date > cw.cohort_date AND b.event_date <= to_char(cw.cohort_date::date + INTERVAL '7 days', 'YYYY-MM-DD') GROUP BY cw.date UNION ALL SELECT cw.date, '7-14d return' AS period, COUNT(DISTINCT cw.user_key) AS retained FROM cohort_windows cw JOIN base b ON b.user_key = cw.user_key AND b.event_date >= to_char(cw.cohort_date::date + INTERVAL '7 days', 'YYYY-MM-DD') AND b.event_date <= to_char(cw.cohort_date::date + INTERVAL '14 days', 'YYYY-MM-DD') GROUP BY cw.date) SELECT cs.date, p.period, COALESCE(r.retained, 0) AS retained_users, cs.users AS cohort_users, COALESCE(r.retained::float / NULLIF(cs.users, 0), 0) AS rate FROM cohort_sizes cs CROSS JOIN periods p LEFT JOIN retained r ON r.date = cs.date AND r.period = p.period WHERE cs.users >= ${RETENTION_MIN_COHORT_SIZE} ORDER BY cs.date, p.period`;
export const LEGACY_ONE_DAY_RETENTION_BY_TEMPLATE_SQL = `WITH base AS (SELECT ${SIGNED_IN_ACTIVITY_KEY_SQL} AS user_key, ${TEMPLATE_EXPR} AS template, ${EVENT_DATE_SQL} AS event_date, user_id FROM analytics_events WHERE ${LEGACY_SIGNED_IN_ACTIVITY_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${KNOWN_PRODUCT_ACTIVITY_TEMPLATE_FILTER}), ranked_first_seen AS (SELECT user_key, template, event_date AS cohort_date, ROW_NUMBER() OVER (PARTITION BY user_key ORDER BY event_date, template) AS rn FROM base), first_seen AS (SELECT user_key, template, cohort_date FROM ranked_first_seen WHERE rn = 1), cohorts AS (SELECT user_key, template, cohort_date FROM first_seen WHERE cohort_date <= ${daysAgoSql(7)} AND ${dashboardTimeRangeFilter("cohort_date")}), cohort_sizes AS (SELECT template, COUNT(DISTINCT user_key) AS users FROM cohorts GROUP BY template), retained AS (SELECT c.template, COUNT(DISTINCT c.user_key) AS retained FROM cohorts c JOIN base b ON b.user_key = c.user_key AND b.event_date > c.cohort_date AND b.event_date <= to_char(c.cohort_date::date + INTERVAL '7 days', 'YYYY-MM-DD') GROUP BY c.template) SELECT cs.template, COALESCE(r.retained, 0) AS retained_users, cs.users AS cohort_users, COALESCE(r.retained::float / NULLIF(cs.users, 0), 0) AS rate FROM cohort_sizes cs LEFT JOIN retained r ON r.template = cs.template WHERE cs.users >= ${PER_TEMPLATE_RETENTION_MIN_COHORT_SIZE} ORDER BY rate DESC, cs.users DESC, cs.template`;
export const LEGACY_SEVEN_DAY_RETENTION_BY_TEMPLATE_SQL = `WITH base AS (SELECT ${SIGNED_IN_ACTIVITY_KEY_SQL} AS user_key, ${TEMPLATE_EXPR} AS template, ${EVENT_DATE_SQL} AS event_date, user_id FROM analytics_events WHERE ${LEGACY_SIGNED_IN_ACTIVITY_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${KNOWN_PRODUCT_ACTIVITY_TEMPLATE_FILTER}), ranked_first_seen AS (SELECT user_key, template, event_date AS cohort_date, ROW_NUMBER() OVER (PARTITION BY user_key ORDER BY event_date, template) AS rn FROM base), first_seen AS (SELECT user_key, template, cohort_date FROM ranked_first_seen WHERE rn = 1), cohorts AS (SELECT user_key, template, cohort_date FROM first_seen WHERE cohort_date <= ${daysAgoSql(14)} AND ${dashboardTimeRangeFilter("cohort_date")}), cohort_sizes AS (SELECT template, COUNT(DISTINCT user_key) AS users FROM cohorts GROUP BY template), retained AS (SELECT c.template, COUNT(DISTINCT c.user_key) AS retained FROM cohorts c JOIN base b ON b.user_key = c.user_key AND b.event_date >= to_char(c.cohort_date::date + INTERVAL '7 days', 'YYYY-MM-DD') AND b.event_date <= to_char(c.cohort_date::date + INTERVAL '14 days', 'YYYY-MM-DD') GROUP BY c.template) SELECT cs.template, COALESCE(r.retained, 0) AS retained_users, cs.users AS cohort_users, COALESCE(r.retained::float / NULLIF(cs.users, 0), 0) AS rate FROM cohort_sizes cs LEFT JOIN retained r ON r.template = cs.template WHERE cs.users >= ${PER_TEMPLATE_RETENTION_MIN_COHORT_SIZE} ORDER BY rate DESC, cs.users DESC, cs.template`;
export const LEGACY_V0_RETENTION_OVER_TIME_SQL =
  LEGACY_RETENTION_OVER_TIME_SQL.replace(
    "cohort_date <= to_char(CURRENT_DATE, 'YYYY-MM-DD') AND ",
    "",
  )
    .replace("AND (('{{timeRange}}", "AND ('{{timeRange}}")
    .replace(
      "CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD'))))",
      "CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD')))",
    );
export const LEGACY_V0_SEVEN_DAY_RETENTION_BY_TEMPLATE_SQL =
  LEGACY_SEVEN_DAY_RETENTION_BY_TEMPLATE_SQL.replace(
    "cohort_date <= to_char(CURRENT_DATE, 'YYYY-MM-DD') AND ",
    "",
  )
    .replace("AND (('{{timeRange}}", "AND ('{{timeRange}}")
    .replace(
      "CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD'))))",
      "CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD')))",
    );
export const LEGACY_V0_ONE_DAY_RETENTION_BY_TEMPLATE_SQL =
  LEGACY_ONE_DAY_RETENTION_BY_TEMPLATE_SQL.replace(
    "cohort_date <= to_char(CURRENT_DATE, 'YYYY-MM-DD') AND ",
    "",
  )
    .replace("AND (('{{timeRange}}", "AND ('{{timeRange}}")
    .replace(
      "CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD'))))",
      "CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD')))",
    );
const SIGNUPS_BY_TEMPLATE_SQL = `SELECT ${TEMPLATE_EXPR} AS template, COUNT(*) AS count FROM analytics_events WHERE event_name = 'signup' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${FIRST_PARTY_TEMPLATE_FILTER} GROUP BY ${TEMPLATE_EXPR} ORDER BY count DESC`;
export const LEGACY_RECURRING_USERS_BY_TEMPLATE_SQL = `WITH all_users AS (SELECT ${SIGNED_IN_ACTIVITY_KEY_SQL} AS user_key, ${EVENT_DATE_SQL}, user_id, ${TEMPLATE_EXPR} AS template FROM analytics_events WHERE ${LEGACY_SIGNED_IN_PRODUCT_ACTIVITY_FILTER} AND ${DASHBOARD_EMAIL_FILTER}), first_seen AS (SELECT user_key, MIN(event_date) AS first_date FROM all_users GROUP BY user_key) SELECT a.event_date AS date, a.template AS template, COUNT(DISTINCT a.user_key) AS users FROM all_users a JOIN first_seen f ON f.user_key = a.user_key WHERE a.event_date <> f.first_date AND a.template <> 'unknown' AND ${dashboardTimeRangeFilter("a.event_date")} GROUP BY 1, 2 ORDER BY date, template`;
export const LEGACY_RECURRING_USERS_BY_TEMPLATE_WEEKLY_SQL = `WITH all_users AS (SELECT ${SIGNED_IN_ACTIVITY_KEY_SQL} AS user_key, ${EVENT_DATE_SQL}, user_id, ${TEMPLATE_EXPR} AS template FROM analytics_events WHERE ${LEGACY_SIGNED_IN_PRODUCT_ACTIVITY_FILTER} AND ${DASHBOARD_EMAIL_FILTER}), first_seen AS (SELECT user_key, MIN(event_date) AS first_date FROM all_users GROUP BY user_key) SELECT to_char(date_trunc('week', a.event_date::date), 'YYYY-MM-DD') AS date, a.template AS template, COUNT(DISTINCT a.user_key) AS users FROM all_users a JOIN first_seen f ON f.user_key = a.user_key WHERE a.event_date <> f.first_date AND a.template <> 'unknown' AND ${dashboardTimeRangeFilter("a.event_date")} GROUP BY 1, 2 ORDER BY date, template`;
const OBSERVED_ACTIVITY_LOOKBACK_FILTER = `${EVENT_DATE_SQL} >= ${daysAgoSql(OBSERVED_ACTIVITY_LOOKBACK_DAYS)}`;
const RETENTION_OVER_TIME_LOOKBACK_FILTER = `${EVENT_DATE_SQL} >= ${daysAgoSql(OBSERVED_ACTIVITY_LOOKBACK_DAYS + RETENTION_ROLLING_DAYS - 1)}`;
export const INTERMEDIATE_RECURRING_USERS_BY_TEMPLATE_SQL =
  LEGACY_RECURRING_USERS_BY_TEMPLATE_SQL.replace(
    `${DASHBOARD_EMAIL_FILTER}), first_seen`,
    `${DASHBOARD_EMAIL_FILTER} AND ${OBSERVED_ACTIVITY_LOOKBACK_FILTER}), first_seen`,
  );
export const INTERMEDIATE_RECURRING_USERS_BY_TEMPLATE_WEEKLY_SQL =
  LEGACY_RECURRING_USERS_BY_TEMPLATE_WEEKLY_SQL.replace(
    `${DASHBOARD_EMAIL_FILTER}), first_seen`,
    `${DASHBOARD_EMAIL_FILTER} AND ${OBSERVED_ACTIVITY_LOOKBACK_FILTER}), first_seen`,
  );
export const DEPLOYED_RECURRING_USERS_BY_TEMPLATE_SQL =
  LEGACY_RECURRING_USERS_BY_TEMPLATE_SQL.replace(
    "a.event_date <= to_char(CURRENT_DATE, 'YYYY-MM-DD') AND ",
    "",
  )
    .replace("AND (('{{timeRange}}", "AND ('{{timeRange}}")
    .replace(
      "CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD'))))",
      "CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD')))",
    );
export const PRE_MARKETING_SITE_RETENTION_OVER_TIME_SQL =
  LEGACY_RETENTION_OVER_TIME_SQL.replace(
    `${DASHBOARD_EMAIL_FILTER}), first_seen`,
    `${DASHBOARD_EMAIL_FILTER} AND ${OBSERVED_ACTIVITY_LOOKBACK_FILTER}), first_seen`,
  );
export const PRE_FULL_SPINE_RETENTION_OVER_TIME_SQL =
  PRE_MARKETING_SITE_RETENTION_OVER_TIME_SQL.replace(
    PRODUCT_ACTIVITY_TEMPLATE_FILTER,
    `${FIRST_PARTY_PRODUCT_ACTIVITY_TEMPLATE_FILTER} AND ${MARKETING_SITE_TEMPLATE_FILTER}`,
  );
const RETENTION_OVER_TIME_SQL = `WITH base AS (SELECT ${SIGNED_IN_ACTIVITY_KEY_SQL} AS user_key, ${EVENT_DATE_SQL} AS event_date, user_id FROM analytics_events WHERE ${SIGNED_IN_ACTIVITY_FILTER} AND ${FIRST_PARTY_PRODUCT_ACTIVITY_TEMPLATE_FILTER} AND ${MARKETING_SITE_TEMPLATE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${RETENTION_OVER_TIME_LOOKBACK_FILTER}), first_seen AS (SELECT user_key, MIN(event_date) AS cohort_date FROM base GROUP BY user_key), digits AS (SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9), offsets AS (SELECT ones.n + tens.n * 10 + hundreds.n * 100 AS n FROM digits ones CROSS JOIN digits tens CROSS JOIN digits hundreds WHERE hundreds.n < 8), anchor_dates AS (SELECT to_char(CURRENT_DATE - o.n, 'YYYY-MM-DD') AS date FROM offsets o WHERE o.n <= ${RETENTION_SPINE_DAYS_SQL}), cohort_windows AS (SELECT a.date, f.user_key, f.cohort_date FROM anchor_dates a JOIN first_seen f ON f.cohort_date >= ${rollingWindowStartSql()} AND f.cohort_date <= a.date), cohort_sizes AS (SELECT date, COUNT(DISTINCT user_key) AS users FROM cohort_windows GROUP BY date), periods AS (SELECT '1-7d return' AS period, ${daysAgoSql(7)} AS mature_through UNION ALL SELECT '7-14d return' AS period, ${daysAgoSql(14)} AS mature_through), retained AS (SELECT cw.date, '1-7d return' AS period, COUNT(DISTINCT cw.user_key) AS retained FROM cohort_windows cw JOIN base b ON b.user_key = cw.user_key AND b.event_date > cw.cohort_date AND b.event_date <= to_char(cw.cohort_date::date + INTERVAL '7 days', 'YYYY-MM-DD') GROUP BY cw.date UNION ALL SELECT cw.date, '7-14d return' AS period, COUNT(DISTINCT cw.user_key) AS retained FROM cohort_windows cw JOIN base b ON b.user_key = cw.user_key AND b.event_date >= to_char(cw.cohort_date::date + INTERVAL '7 days', 'YYYY-MM-DD') AND b.event_date <= to_char(cw.cohort_date::date + INTERVAL '14 days', 'YYYY-MM-DD') GROUP BY cw.date) SELECT a.date, p.period, CASE WHEN a.date <= p.mature_through AND cs.users >= ${RETENTION_MIN_COHORT_SIZE} THEN COALESCE(r.retained, 0) ELSE NULL END AS retained_users, COALESCE(cs.users, 0) AS cohort_users, CASE WHEN a.date <= p.mature_through AND cs.users >= ${RETENTION_MIN_COHORT_SIZE} THEN COALESCE(r.retained, 0)::float / NULLIF(cs.users, 0) ELSE NULL END AS rate FROM anchor_dates a CROSS JOIN periods p LEFT JOIN cohort_sizes cs ON cs.date = a.date LEFT JOIN retained r ON r.date = a.date AND r.period = p.period ORDER BY a.date, p.period`;
export const PRE_MARKETING_SITE_ONE_DAY_RETENTION_BY_TEMPLATE_SQL =
  LEGACY_ONE_DAY_RETENTION_BY_TEMPLATE_SQL.replace(
    `${KNOWN_PRODUCT_ACTIVITY_TEMPLATE_FILTER}), ranked_first_seen`,
    `${KNOWN_PRODUCT_ACTIVITY_TEMPLATE_FILTER} AND ${OBSERVED_ACTIVITY_LOOKBACK_FILTER}), ranked_first_seen`,
  );
export const MATERIALIZED_ONE_DAY_RETENTION_BY_TEMPLATE_SQL =
  PRE_MARKETING_SITE_ONE_DAY_RETENTION_BY_TEMPLATE_SQL.replace(
    KNOWN_PRODUCT_ACTIVITY_TEMPLATE_FILTER,
    `${KNOWN_PRODUCT_ACTIVITY_TEMPLATE_FILTER} AND ${MARKETING_SITE_TEMPLATE_FILTER}`,
  );
const ONE_DAY_RETENTION_BY_TEMPLATE_SQL = `WITH base AS (SELECT ${SIGNED_IN_ACTIVITY_KEY_SQL} AS user_key, ${TEMPLATE_EXPR} AS template, ${EVENT_DATE_SQL} AS event_date FROM analytics_events WHERE ${SIGNED_IN_ACTIVITY_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${FIRST_PARTY_KNOWN_PRODUCT_ACTIVITY_TEMPLATE_FILTER} AND ${MARKETING_SITE_TEMPLATE_FILTER} AND ${OBSERVED_ACTIVITY_LOOKBACK_FILTER} GROUP BY 1, 2, 3), observed AS (SELECT user_key, event_date, FIRST_VALUE(template) OVER (PARTITION BY user_key ORDER BY event_date, template) AS starting_template, MIN(event_date) OVER (PARTITION BY user_key ORDER BY event_date, template) AS cohort_date FROM base), cohorts AS (SELECT user_key, starting_template AS template, cohort_date, MAX(CASE WHEN event_date > cohort_date AND event_date <= to_char(cohort_date::date + INTERVAL '7 days', 'YYYY-MM-DD') THEN 1 ELSE 0 END) AS retained FROM observed WHERE cohort_date <= ${daysAgoSql(7)} AND ${dashboardTimeRangeFilter("cohort_date")} GROUP BY user_key, starting_template, cohort_date) SELECT template, SUM(retained) AS retained_users, COUNT(*) AS cohort_users, SUM(retained)::float / NULLIF(COUNT(*), 0) AS rate FROM cohorts GROUP BY template HAVING COUNT(*) >= ${PER_TEMPLATE_RETENTION_MIN_COHORT_SIZE} ORDER BY rate DESC, cohort_users DESC, template`;
export const PRE_MARKETING_SITE_SEVEN_DAY_RETENTION_BY_TEMPLATE_SQL =
  LEGACY_SEVEN_DAY_RETENTION_BY_TEMPLATE_SQL.replace(
    `${KNOWN_PRODUCT_ACTIVITY_TEMPLATE_FILTER}), ranked_first_seen`,
    `${KNOWN_PRODUCT_ACTIVITY_TEMPLATE_FILTER} AND ${OBSERVED_ACTIVITY_LOOKBACK_FILTER}), ranked_first_seen`,
  );
const SEVEN_DAY_RETENTION_BY_TEMPLATE_SQL =
  PRE_MARKETING_SITE_SEVEN_DAY_RETENTION_BY_TEMPLATE_SQL.replace(
    LEGACY_SIGNED_IN_ACTIVITY_FILTER,
    SIGNED_IN_ACTIVITY_FILTER,
  ).replace(
    KNOWN_PRODUCT_ACTIVITY_TEMPLATE_FILTER,
    `${FIRST_PARTY_KNOWN_PRODUCT_ACTIVITY_TEMPLATE_FILTER} AND ${MARKETING_SITE_TEMPLATE_FILTER}`,
  );
export const PRE_MARKETING_SITE_RECURRING_USERS_BY_TEMPLATE_SQL = `WITH first_seen AS (SELECT ${SIGNED_IN_ACTIVITY_KEY_SQL} AS user_key, MIN(${EVENT_DATE_SQL}) AS first_date FROM analytics_events WHERE ${LEGACY_SIGNED_IN_PRODUCT_ACTIVITY_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${OBSERVED_ACTIVITY_LOOKBACK_FILTER} GROUP BY 1), activity AS (SELECT ${SIGNED_IN_ACTIVITY_KEY_SQL} AS user_key, ${EVENT_DATE_SQL} AS event_date, ${TEMPLATE_EXPR} AS template FROM analytics_events WHERE ${LEGACY_SIGNED_IN_PRODUCT_ACTIVITY_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${OBSERVED_ACTIVITY_LOOKBACK_FILTER} AND ${DASHBOARD_TIME_RANGE_FILTER}) SELECT a.event_date AS date, a.template AS template, COUNT(DISTINCT a.user_key) AS users FROM activity a JOIN first_seen f ON f.user_key = a.user_key WHERE a.event_date <> f.first_date AND a.template <> 'unknown' GROUP BY 1, 2 ORDER BY date, template`;
export const DOUBLE_SCAN_RECURRING_USERS_BY_TEMPLATE_SQL =
  PRE_MARKETING_SITE_RECURRING_USERS_BY_TEMPLATE_SQL.replace(
    PRODUCT_ACTIVITY_TEMPLATE_FILTER,
    `${PRODUCT_ACTIVITY_TEMPLATE_FILTER} AND ${MARKETING_SITE_TEMPLATE_FILTER}`,
  );
const RECURRING_USERS_BY_TEMPLATE_SQL = `WITH activity AS (SELECT ${SIGNED_IN_ACTIVITY_KEY_SQL} AS user_key, ${EVENT_DATE_SQL} AS event_date, ${TEMPLATE_EXPR} AS template, MIN(${EVENT_DATE_SQL}) OVER (PARTITION BY ${SIGNED_IN_ACTIVITY_KEY_SQL}) AS first_date FROM analytics_events WHERE ${SIGNED_IN_ACTIVITY_FILTER} AND ${FIRST_PARTY_PRODUCT_ACTIVITY_TEMPLATE_FILTER} AND ${MARKETING_SITE_TEMPLATE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${OBSERVED_ACTIVITY_LOOKBACK_FILTER}) SELECT event_date AS date, template, COUNT(DISTINCT user_key) AS users FROM activity WHERE event_date <> first_date AND template <> 'unknown' AND ${DASHBOARD_TIME_RANGE_FILTER} GROUP BY 1, 2 ORDER BY date, template`;
export const PRE_MARKETING_SITE_RECURRING_USERS_BY_TEMPLATE_WEEKLY_SQL = `WITH first_seen AS (SELECT ${SIGNED_IN_ACTIVITY_KEY_SQL} AS user_key, MIN(${EVENT_DATE_SQL}) AS first_date FROM analytics_events WHERE ${LEGACY_SIGNED_IN_PRODUCT_ACTIVITY_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${OBSERVED_ACTIVITY_LOOKBACK_FILTER} GROUP BY 1), activity AS (SELECT ${SIGNED_IN_ACTIVITY_KEY_SQL} AS user_key, ${EVENT_DATE_SQL} AS event_date, ${TEMPLATE_EXPR} AS template FROM analytics_events WHERE ${LEGACY_SIGNED_IN_PRODUCT_ACTIVITY_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${OBSERVED_ACTIVITY_LOOKBACK_FILTER} AND ${DASHBOARD_TIME_RANGE_FILTER}) SELECT to_char(date_trunc('week', a.event_date::date), 'YYYY-MM-DD') AS date, a.template AS template, COUNT(DISTINCT a.user_key) AS users FROM activity a JOIN first_seen f ON f.user_key = a.user_key WHERE a.event_date <> f.first_date AND a.template <> 'unknown' GROUP BY 1, 2 ORDER BY date, template`;
export const DOUBLE_SCAN_RECURRING_USERS_BY_TEMPLATE_WEEKLY_SQL =
  PRE_MARKETING_SITE_RECURRING_USERS_BY_TEMPLATE_WEEKLY_SQL.replace(
    PRODUCT_ACTIVITY_TEMPLATE_FILTER,
    `${PRODUCT_ACTIVITY_TEMPLATE_FILTER} AND ${MARKETING_SITE_TEMPLATE_FILTER}`,
  );
const RECURRING_USERS_BY_TEMPLATE_WEEKLY_SQL = `WITH activity AS (SELECT ${SIGNED_IN_ACTIVITY_KEY_SQL} AS user_key, ${EVENT_DATE_SQL} AS event_date, ${TEMPLATE_EXPR} AS template, MIN(${EVENT_DATE_SQL}) OVER (PARTITION BY ${SIGNED_IN_ACTIVITY_KEY_SQL}) AS first_date FROM analytics_events WHERE ${SIGNED_IN_ACTIVITY_FILTER} AND ${FIRST_PARTY_PRODUCT_ACTIVITY_TEMPLATE_FILTER} AND ${MARKETING_SITE_TEMPLATE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${OBSERVED_ACTIVITY_LOOKBACK_FILTER}) SELECT to_char(date_trunc('week', event_date::date), 'YYYY-MM-DD') AS date, template, COUNT(DISTINCT user_key) AS users FROM activity WHERE event_date <> first_date AND template <> 'unknown' AND ${DASHBOARD_TIME_RANGE_FILTER} GROUP BY 1, 2 ORDER BY date, template`;
const LEGACY_RECURRING_USERS_DESCRIPTION =
  "Daily signed-in visitors who are NOT on their all-time first active day (Recurring only), stacked by inferred template/app used that day. Docs traffic and unknown template are excluded.";
const LEGACY_RECURRING_USERS_WEEKLY_DESCRIPTION =
  "Weekly distinct signed-in visitors who are NOT on their all-time first active day (Recurring only), stacked by inferred template/app used that week. Weeks start Monday; docs traffic and unknown template are excluded.";
const LEGACY_ONE_DAY_RETENTION_BY_TEMPLATE_DESCRIPTION =
  "Selected-range signed-in cohorts by the browser identity's first non-docs app/template. Counts returns to any non-docs app within 1-7 days. Templates with fewer than 20 mature cohort identities are hidden.";
const LEGACY_SEVEN_DAY_RETENTION_BY_TEMPLATE_DESCRIPTION =
  "Selected-range signed-in cohorts by the browser identity's first non-docs app/template. Counts returns to any non-docs app within 7-14 days. Templates with fewer than 20 mature cohort identities are hidden.";
const RECURRING_USERS_DESCRIPTION =
  "Daily signed-in visitors who are not on their first active day observed in the previous 365 days, stacked by inferred template/app used that day. Docs traffic and unknown template are excluded.";
const RECURRING_USERS_WEEKLY_DESCRIPTION =
  "Weekly distinct signed-in visitors who are not on their first active day observed in the previous 365 days, stacked by inferred template/app used that week. Weeks start Monday; docs traffic and unknown template are excluded.";
export const LEGACY_RETENTION_OVER_TIME_DESCRIPTION =
  "Trailing 7-day first-seen signed-in app session cohorts, keyed by browser identity. Counts returns within 1-7d and 7-14d windows. Docs traffic is excluded; windows under 5 identities are hidden.";
export const PRE_FULL_SPINE_RETENTION_OVER_TIME_DESCRIPTION =
  "Trailing 7-day cohorts whose first signed-in app session was observed in the previous 365 days, keyed by browser identity. Counts returns within 1-7d and 7-14d windows. Docs traffic is excluded; windows under 5 identities are hidden.";
const RETENTION_OVER_TIME_DESCRIPTION =
  "Trailing 7-day cohort return rates. A point appears once its return window has fully elapsed (7 days for 1-7d, 14 days for 7-14d), so the newest days are blank rather than zero.";
const ONE_DAY_RETENTION_BY_TEMPLATE_DESCRIPTION =
  "Selected-range signed-in cohorts by the browser identity's first non-docs app/template observed in the previous 365 days. Counts returns to any non-docs app within 1-7 days. Templates with fewer than 20 mature cohort identities are hidden.";
const SEVEN_DAY_RETENTION_BY_TEMPLATE_DESCRIPTION =
  "Selected-range signed-in cohorts by the browser identity's first non-docs app/template observed in the previous 365 days. Counts returns to any non-docs app within 7-14 days. Templates with fewer than 20 mature cohort identities are hidden.";

export type ExactFirstPartyPanelReplacement = {
  id: string;
  legacySql: readonly string[];
  sql: string;
  legacyDescription?: string | readonly string[];
  description?: string;
};
type FirstPartyPanelReplacement = Omit<ExactFirstPartyPanelReplacement, "id">;

export function repairFirstPartyObservedRetentionPanels(
  config: Record<string, unknown>,
  additionalReplacements: readonly ExactFirstPartyPanelReplacement[] = [],
): { config: Record<string, unknown>; changed: boolean } {
  if (!Array.isArray(config.panels)) return { config, changed: false };

  const replacements = new Map<string, FirstPartyPanelReplacement>([
    [
      "retention-over-time",
      {
        legacySql: [
          LEGACY_RETENTION_OVER_TIME_SQL,
          LEGACY_V0_RETENTION_OVER_TIME_SQL,
          PRE_MARKETING_SITE_RETENTION_OVER_TIME_SQL,
          PRE_FULL_SPINE_RETENTION_OVER_TIME_SQL,
        ],
        sql: RETENTION_OVER_TIME_SQL,
        legacyDescription: [
          LEGACY_RETENTION_OVER_TIME_DESCRIPTION,
          PRE_FULL_SPINE_RETENTION_OVER_TIME_DESCRIPTION,
        ],
        description: RETENTION_OVER_TIME_DESCRIPTION,
      },
    ],
    [
      "one-day-retention-by-template",
      {
        legacySql: [
          LEGACY_ONE_DAY_RETENTION_BY_TEMPLATE_SQL,
          LEGACY_V0_ONE_DAY_RETENTION_BY_TEMPLATE_SQL,
          PRE_MARKETING_SITE_ONE_DAY_RETENTION_BY_TEMPLATE_SQL,
          MATERIALIZED_ONE_DAY_RETENTION_BY_TEMPLATE_SQL,
        ],
        sql: ONE_DAY_RETENTION_BY_TEMPLATE_SQL,
        legacyDescription: LEGACY_ONE_DAY_RETENTION_BY_TEMPLATE_DESCRIPTION,
        description: ONE_DAY_RETENTION_BY_TEMPLATE_DESCRIPTION,
      },
    ],
    [
      "seven-day-retention-by-template",
      {
        legacySql: [
          LEGACY_SEVEN_DAY_RETENTION_BY_TEMPLATE_SQL,
          LEGACY_V0_SEVEN_DAY_RETENTION_BY_TEMPLATE_SQL,
          PRE_MARKETING_SITE_SEVEN_DAY_RETENTION_BY_TEMPLATE_SQL,
        ],
        sql: SEVEN_DAY_RETENTION_BY_TEMPLATE_SQL,
        legacyDescription: LEGACY_SEVEN_DAY_RETENTION_BY_TEMPLATE_DESCRIPTION,
        description: SEVEN_DAY_RETENTION_BY_TEMPLATE_DESCRIPTION,
      },
    ],
    [
      "recurring-users-by-template",
      {
        legacySql: [
          LEGACY_RECURRING_USERS_BY_TEMPLATE_SQL,
          INTERMEDIATE_RECURRING_USERS_BY_TEMPLATE_SQL,
          DEPLOYED_RECURRING_USERS_BY_TEMPLATE_SQL,
          PRE_MARKETING_SITE_RECURRING_USERS_BY_TEMPLATE_SQL,
          DOUBLE_SCAN_RECURRING_USERS_BY_TEMPLATE_SQL,
        ],
        sql: RECURRING_USERS_BY_TEMPLATE_SQL,
        legacyDescription: LEGACY_RECURRING_USERS_DESCRIPTION,
        description: RECURRING_USERS_DESCRIPTION,
      },
    ],
    [
      "recurring-users-by-template-bar",
      {
        legacySql: [
          LEGACY_RECURRING_USERS_BY_TEMPLATE_WEEKLY_SQL,
          INTERMEDIATE_RECURRING_USERS_BY_TEMPLATE_WEEKLY_SQL,
          PRE_MARKETING_SITE_RECURRING_USERS_BY_TEMPLATE_WEEKLY_SQL,
          DOUBLE_SCAN_RECURRING_USERS_BY_TEMPLATE_WEEKLY_SQL,
        ],
        sql: RECURRING_USERS_BY_TEMPLATE_WEEKLY_SQL,
        legacyDescription: LEGACY_RECURRING_USERS_WEEKLY_DESCRIPTION,
        description: RECURRING_USERS_WEEKLY_DESCRIPTION,
      },
    ],
    [
      "dau-over-time",
      {
        legacySql: [
          LEGACY_DAU_BY_TEMPLATE_SQL,
          PRE_MARKETING_SITE_DAU_BY_TEMPLATE_SQL,
        ],
        sql: DAU_BY_TEMPLATE_SQL,
      },
    ],
    [
      "wau-over-time",
      {
        legacySql: [
          LEGACY_WAU_BY_TEMPLATE_SQL,
          PRE_MARKETING_SITE_WAU_BY_TEMPLATE_SQL,
          DAU_BY_TEMPLATE_SQL,
        ],
        sql: WAU_BY_TEMPLATE_SQL,
      },
    ],
    [
      "repeat-users",
      {
        legacySql: [PRE_MARKETING_SITE_REPEAT_USERS_SQL],
        sql: REPEAT_USERS_SQL,
      },
    ],
  ]);
  for (const replacement of additionalReplacements) {
    const existing = replacements.get(replacement.id);
    replacements.set(
      replacement.id,
      existing
        ? {
            ...existing,
            ...replacement,
            legacySql: Array.from(
              new Set([...existing.legacySql, ...replacement.legacySql]),
            ),
          }
        : replacement,
    );
  }
  for (const [id, replacement] of replacements) {
    replacements.set(id, {
      ...replacement,
      legacySql: Array.from(
        new Set(
          replacement.legacySql.flatMap((sql) => [
            sql,
            scopeFirstPartyPanelSql(sql),
          ]),
        ),
      ),
    });
  }
  let changed = false;
  const panels = config.panels.map((rawPanel) => {
    if (!rawPanel || typeof rawPanel !== "object") return rawPanel;
    const panel = rawPanel as Record<string, unknown>;
    const replacement =
      typeof panel.id === "string" ? replacements.get(panel.id) : undefined;
    if (
      !replacement ||
      typeof panel.sql !== "string" ||
      !replacement.legacySql.includes(panel.sql)
    ) {
      return rawPanel;
    }

    changed = true;
    const panelConfig =
      panel.config && typeof panel.config === "object"
        ? (panel.config as Record<string, unknown>)
        : null;
    return {
      ...panel,
      sql: scopeFirstPartyPanelSql(replacement.sql),
      ...(panelConfig
        ? {
            config: {
              ...panelConfig,
              ...(replacement.legacyDescription !== undefined &&
              replacement.description !== undefined &&
              typeof panelConfig.description === "string" &&
              (typeof replacement.legacyDescription === "string"
                ? [replacement.legacyDescription]
                : replacement.legacyDescription
              ).includes(panelConfig.description)
                ? { description: replacement.description }
                : {}),
            },
          }
        : {}),
    };
  });
  return changed
    ? { config: { ...config, panels }, changed }
    : { config, changed };
}
export const LEGACY_DAU_BY_TEMPLATE_SQL = `SELECT ${EVENT_DATE_SQL} AS date, ${TEMPLATE_EXPR} AS template, COUNT(DISTINCT ${SIGNED_IN_ACTIVITY_KEY_SQL}) AS visitors FROM analytics_events WHERE ${LEGACY_SIGNED_IN_ACTIVITY_FILTER} AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${KNOWN_PRODUCT_ACTIVITY_TEMPLATE_FILTER} GROUP BY ${EVENT_DATE_SQL}, ${TEMPLATE_EXPR} ORDER BY date, template`;
export const PRE_MARKETING_SITE_DAU_BY_TEMPLATE_SQL = `SELECT ${EVENT_DATE_SQL} AS date, ${TEMPLATE_EXPR} AS template, COUNT(DISTINCT user_key) AS visitors FROM analytics_events WHERE ${LEGACY_SIGNED_IN_ACTIVITY_FILTER} AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${KNOWN_PRODUCT_ACTIVITY_TEMPLATE_FILTER} GROUP BY ${EVENT_DATE_SQL}, ${TEMPLATE_EXPR} ORDER BY date, template`;
export const DAU_BY_TEMPLATE_SQL =
  PRE_MARKETING_SITE_DAU_BY_TEMPLATE_SQL.replace(
    LEGACY_SIGNED_IN_ACTIVITY_FILTER,
    SIGNED_IN_ACTIVITY_FILTER,
  ).replace(
    ` AND ${KNOWN_PRODUCT_ACTIVITY_TEMPLATE_FILTER} GROUP BY`,
    ` AND ${FIRST_PARTY_KNOWN_PRODUCT_ACTIVITY_TEMPLATE_FILTER} AND ${MARKETING_SITE_TEMPLATE_FILTER} GROUP BY`,
  );
export const LEGACY_WAU_BY_TEMPLATE_SQL = `WITH base AS (SELECT ${SIGNED_IN_ACTIVITY_KEY_SQL} AS visitor_key, ${TEMPLATE_EXPR} AS template, ${EVENT_DATE_SQL} AS event_date, user_id FROM analytics_events WHERE ${LEGACY_SIGNED_IN_ACTIVITY_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${KNOWN_PRODUCT_ACTIVITY_TEMPLATE_FILTER} AND ${DASHBOARD_WAU_BASE_RANGE_FILTER}), days AS (SELECT DISTINCT event_date AS date FROM base WHERE ${DASHBOARD_EVENT_DATE_RANGE_FILTER}) SELECT d.date, b.template, COUNT(DISTINCT b.visitor_key) AS visitors FROM days d JOIN base b ON b.event_date >= to_char(d.date::date - INTERVAL '6 days', 'YYYY-MM-DD') AND b.event_date <= d.date GROUP BY d.date, b.template ORDER BY d.date, b.template`;
export const PRE_MARKETING_SITE_WAU_BY_TEMPLATE_SQL = `WITH base AS (SELECT user_key AS visitor_key, ${TEMPLATE_EXPR} AS template, ${EVENT_DATE_SQL} AS event_date, user_id FROM analytics_events WHERE ${LEGACY_SIGNED_IN_ACTIVITY_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${KNOWN_PRODUCT_ACTIVITY_TEMPLATE_FILTER} AND ${DASHBOARD_WAU_BASE_RANGE_FILTER}), days AS (SELECT DISTINCT event_date AS date FROM base WHERE ${DASHBOARD_EVENT_DATE_RANGE_FILTER}) SELECT d.date, b.template, COUNT(DISTINCT b.visitor_key) AS visitors FROM days d JOIN base b ON b.event_date >= to_char(d.date::date - INTERVAL '6 days', 'YYYY-MM-DD') AND b.event_date <= d.date GROUP BY d.date, b.template ORDER BY d.date, b.template`;
const WAU_BY_TEMPLATE_SQL = PRE_MARKETING_SITE_WAU_BY_TEMPLATE_SQL.replace(
  LEGACY_SIGNED_IN_ACTIVITY_FILTER,
  SIGNED_IN_ACTIVITY_FILTER,
).replace(
  ` AND ${KNOWN_PRODUCT_ACTIVITY_TEMPLATE_FILTER} AND ${DASHBOARD_WAU_BASE_RANGE_FILTER}`,
  ` AND ${FIRST_PARTY_KNOWN_PRODUCT_ACTIVITY_TEMPLATE_FILTER} AND ${MARKETING_SITE_TEMPLATE_FILTER} AND ${DASHBOARD_WAU_BASE_RANGE_FILTER}`,
);
const PRE_MARKETING_SITE_REPEAT_USERS_SQL = `WITH user_days AS (SELECT ${SIGNED_IN_ACTIVITY_KEY_SQL} AS user_key, COUNT(DISTINCT ${EVENT_DATE_SQL}) AS active_days FROM analytics_events WHERE ${LEGACY_SIGNED_IN_PRODUCT_ACTIVITY_FILTER} AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} GROUP BY ${SIGNED_IN_ACTIVITY_KEY_SQL}) SELECT COUNT(*) AS count FROM user_days WHERE active_days >= 2`;
const REPEAT_USERS_SQL = `WITH user_days AS (SELECT ${SIGNED_IN_ACTIVITY_KEY_SQL} AS user_key, COUNT(DISTINCT ${EVENT_DATE_SQL}) AS active_days FROM analytics_events WHERE ${SIGNED_IN_PRODUCT_ACTIVITY_FILTER} AND ${FIRST_PARTY_PRODUCT_ACTIVITY_TEMPLATE_FILTER} AND ${MARKETING_SITE_TEMPLATE_FILTER} AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} GROUP BY ${SIGNED_IN_ACTIVITY_KEY_SQL}) SELECT COUNT(*) AS count FROM user_days WHERE active_days >= 2`;

const FUNNEL_EMAIL_FILTER =
  "('{{emailFilter}}' IN ('', 'all') OR ('{{emailFilter}}' = 'exclude_builder' AND lower(coalesce(funnel_user_email, '')) NOT LIKE '%@builder.io') OR ('{{emailFilter}}' = 'only_builder' AND lower(coalesce(funnel_user_email, '')) LIKE '%@builder.io'))";
const FUNNEL_SCOPE_FILTER = `${DASHBOARD_TIME_RANGE_FILTER} AND ${FUNNEL_EMAIL_FILTER} AND ${DASHBOARD_APP_FILTER} AND ${FIRST_PARTY_TEMPLATE_FILTER}`;
const FUNNEL_EVENTS_CTE = `WITH signup_identity AS (
  SELECT NULLIF(anonymous_id, '') AS anonymous_id,
    MIN(NULLIF(user_id, '')) AS signup_user_id
  FROM analytics_events
  WHERE event_name = 'signup'
    AND ${DASHBOARD_TIME_RANGE_FILTER}
    AND ${DASHBOARD_EMAIL_FILTER}
    AND ${DASHBOARD_APP_FILTER}
    AND ${FIRST_PARTY_TEMPLATE_FILTER}
    AND NULLIF(anonymous_id, '') IS NOT NULL
    AND NULLIF(user_id, '') IS NOT NULL
  GROUP BY NULLIF(anonymous_id, '')
), raw_funnel_events AS (
  SELECT e.*,
    COALESCE(si.signup_user_id, NULLIF(e.user_id, ''), NULLIF(e.anonymous_id, '')) AS funnel_user_key,
    COALESCE(si.signup_user_id, NULLIF(e.user_id, '')) AS funnel_user_email
  FROM analytics_events e
  LEFT JOIN signup_identity si ON si.anonymous_id = NULLIF(e.anonymous_id, '')
  WHERE ${DASHBOARD_TIME_RANGE_FILTER}
    AND ${DASHBOARD_APP_FILTER}
    AND ${FIRST_PARTY_TEMPLATE_FILTER}
), funnel_events AS (
  SELECT e.*
  FROM raw_funnel_events e
  WHERE ${FUNNEL_SCOPE_FILTER}
), signup_cohort AS (
  SELECT funnel_user_key, MIN(timestamp::timestamptz) AS signup_at
  FROM funnel_events
  WHERE event_name = 'signup'
    AND funnel_user_key IS NOT NULL
    AND ${FUNNEL_SCOPE_FILTER}
  GROUP BY funnel_user_key
), cohort_events AS (
  SELECT e.*, c.signup_at
  FROM funnel_events e
  JOIN signup_cohort c ON c.funnel_user_key = e.funnel_user_key
)`;
const ONBOARDING_EVENTS_CTE = `WITH auth_identity_bridge AS (
  SELECT linked_email, MIN(auth_user_id) AS auth_user_id
  FROM (
    SELECT lower(COALESCE(
      CASE WHEN NULLIF(e.user_key, '') LIKE '%@%.%' THEN e.user_key END,
      CASE WHEN NULLIF(e.user_id, '') LIKE '%@%.%' THEN e.user_id END
    )) AS linked_email,
    NULLIF(e.properties::jsonb ->> 'auth_user_id', '') AS auth_user_id
    FROM analytics_events e
    WHERE ${DASHBOARD_TIME_RANGE_FILTER}
      AND ${DASHBOARD_APP_FILTER}
      AND ${FIRST_PARTY_TEMPLATE_FILTER}
  ) AS identities
  WHERE linked_email IS NOT NULL
    AND auth_user_id IS NOT NULL
  GROUP BY linked_email
  HAVING COUNT(DISTINCT auth_user_id) = 1
), scoped_onboarding_events AS (
  SELECT e.*,
    COALESCE(
      NULLIF(e.properties::jsonb ->> 'auth_user_id', ''),
      auth_identity_bridge.auth_user_id,
      NULLIF(e.user_key, ''),
      NULLIF(e.user_id, ''),
      NULLIF(e.anonymous_id, '')
    ) AS funnel_user_key,
    COALESCE(
      CASE WHEN NULLIF(e.user_id, '') LIKE '%@%.%' THEN e.user_id END,
      CASE WHEN NULLIF(e.user_key, '') LIKE '%@%.%' THEN e.user_key END,
      CASE WHEN NULLIF(e.properties::jsonb ->> 'auth_user_id', '') LIKE '%@%.%' THEN e.properties::jsonb ->> 'auth_user_id' END
    ) AS funnel_user_email
  FROM analytics_events e
  LEFT JOIN auth_identity_bridge ON auth_identity_bridge.linked_email = lower(COALESCE(
    CASE WHEN NULLIF(e.user_key, '') LIKE '%@%.%' THEN e.user_key END,
    CASE WHEN NULLIF(e.user_id, '') LIKE '%@%.%' THEN e.user_id END
  ))
  WHERE ${DASHBOARD_TIME_RANGE_FILTER}
    AND ${DASHBOARD_APP_FILTER}
    AND ${FIRST_PARTY_TEMPLATE_FILTER}
), onboarding_events AS (
  SELECT * FROM scoped_onboarding_events
  WHERE ${FUNNEL_EMAIL_FILTER}
    AND lower(coalesce(funnel_user_email, '')) NOT LIKE '%+autoz%'
)`;
const SIGNIFICANT_ACTION_FILTER = `((event_name IN ('action_completed', 'core_action_completed') AND COALESCE(properties::jsonb ->> 'success', 'true') = 'true') OR event_name = 'app.first_action' OR (event_name = 'action.response' AND COALESCE(properties::jsonb ->> 'success', '') = 'true' AND COALESCE(upper(properties::jsonb ->> 'method'), '') <> 'GET'))`;
const ACTION_RESPONSE_WEIGHT_SQL = `CASE WHEN NULLIF(properties::jsonb ->> 'sample_weight', '') IS NOT NULL THEN (properties::jsonb ->> 'sample_weight')::numeric WHEN COALESCE(properties::jsonb ->> 'success', '') = 'true' AND COALESCE((properties::jsonb ->> 'duration_ms')::numeric, 1000) < 1000 AND COALESCE((properties::jsonb ->> 'status_code')::int, 200) < 400 AND NULLIF(properties::jsonb ->> 'framework_ready_wait_ms', '') IS NULL AND NULLIF(properties::jsonb ->> 'startup_db_operation_wall_ms', '') IS NULL THEN 10 ELSE 1 END`;
const ACTION_RESPONSE_OUTCOME_CLASS_SQL = `CASE WHEN COALESCE(properties::jsonb ->> 'outcome', '') = 'cancelled' THEN 'cancelled' WHEN COALESCE(properties::jsonb ->> 'outcome', '') = 'timeout' AND COALESCE(properties::jsonb ->> 'page_hidden', '') = 'true' THEN 'suspended' WHEN COALESCE(properties::jsonb ->> 'success', '') = 'true' THEN 'success' ELSE 'failure' END`;
const ACTION_RESPONSE_CALL_TYPE_SQL = `CASE WHEN COALESCE(upper(properties::jsonb ->> 'method'), '') = 'GET' THEN 'read' ELSE 'mutation' END`;
const ACTION_RESPONSE_AUTH_STATE_SQL = `CASE WHEN NULLIF(user_id, '') IS NOT NULL THEN 'signed_in' ELSE 'anonymous' END`;
const ACTION_RESPONSE_DEPLOYMENT_ENV_SQL = `CASE WHEN hostname LIKE 'beta.%' THEN 'beta' WHEN NULLIF(hostname, '') IS NOT NULL THEN 'prod' ELSE 'unknown' END`;
const ACTION_RESPONSE_EVENT_FILTER = `event_name = 'action.response' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${DASHBOARD_APP_FILTER} AND ${FIRST_PARTY_TEMPLATE_FILTER}`;
const ACTIVATION_FUNNEL_SQL = `${FUNNEL_EVENTS_CTE}, funnel_users AS (
  SELECT DISTINCT funnel_user_key
  FROM funnel_events
  WHERE funnel_user_key IS NOT NULL
), page_stage AS (
  SELECT u.funnel_user_key, c.signup_at, page.page_at
  FROM funnel_users u
  LEFT JOIN signup_cohort c ON c.funnel_user_key = u.funnel_user_key
  LEFT JOIN LATERAL (
    SELECT MIN(e.timestamp::timestamptz) AS page_at
    FROM funnel_events e
    WHERE e.funnel_user_key = u.funnel_user_key
      AND e.event_name = 'auth.signup_viewed'
      AND ${FUNNEL_SCOPE_FILTER}
  ) page ON true
), cta_stage AS (
  SELECT p.*, cta.cta_at
  FROM page_stage p
  LEFT JOIN LATERAL (
    SELECT MIN(e.timestamp::timestamptz) AS cta_at
    FROM funnel_events e
    WHERE e.funnel_user_key = p.funnel_user_key
      AND p.page_at IS NOT NULL
      AND e.event_name = 'auth.signup_clicked'
      AND e.timestamp::timestamptz >= p.page_at
      AND ${FUNNEL_SCOPE_FILTER}
  ) cta ON true
), signup_stage AS (
  SELECT cta_stage.*,
    CASE WHEN cta_at IS NOT NULL AND signup_at >= cta_at THEN signup_at END AS signed_up_at
  FROM cta_stage
), onboarding_start_stage AS (
  SELECT s.*, started.started_at
  FROM signup_stage s
  LEFT JOIN LATERAL (
    SELECT MIN(e.timestamp::timestamptz) AS started_at
    FROM cohort_events e
    WHERE e.funnel_user_key = s.funnel_user_key
      AND s.signed_up_at IS NOT NULL
      AND e.event_name = 'onboarding_started'
      AND e.timestamp::timestamptz >= s.signed_up_at
      AND ${FUNNEL_SCOPE_FILTER}
  ) started ON true
), step_stage AS (
  SELECT s.*, step.step_at
  FROM onboarding_start_stage s
  LEFT JOIN LATERAL (
    SELECT MIN(e.timestamp::timestamptz) AS step_at
    FROM cohort_events e
    WHERE e.funnel_user_key = s.funnel_user_key
      AND s.started_at IS NOT NULL
      AND e.event_name = 'onboarding_step_viewed'
      AND e.timestamp::timestamptz >= s.started_at
      AND ${FUNNEL_SCOPE_FILTER}
  ) step ON true
), completion_stage AS (
  SELECT s.*, completed.completed_at
  FROM step_stage s
  LEFT JOIN LATERAL (
    SELECT MIN(e.timestamp::timestamptz) AS completed_at
    FROM cohort_events e
    WHERE e.funnel_user_key = s.funnel_user_key
      AND s.step_at IS NOT NULL
      AND e.event_name = 'onboarding_completed'
      AND e.timestamp::timestamptz >= s.started_at
      AND ${FUNNEL_SCOPE_FILTER}
  ) completed ON true
), entry_stage AS (
  SELECT s.*, entered.entered_at
  FROM completion_stage s
  LEFT JOIN LATERAL (
    SELECT MIN(e.timestamp::timestamptz) AS entered_at
    FROM cohort_events e
    WHERE e.funnel_user_key = s.funnel_user_key
      AND s.completed_at IS NOT NULL
      AND (e.event_name IN ('app_entered', 'onboarding_app_entered') OR (e.event_name = 'session status' AND e.signed_in = 'true'))
      AND e.timestamp::timestamptz >= s.completed_at
      AND ${FUNNEL_SCOPE_FILTER}
  ) entered ON true
), action_stage AS (
  SELECT s.*, action.action_at
  FROM entry_stage s
  LEFT JOIN LATERAL (
    SELECT MIN(e.timestamp::timestamptz) AS action_at
    FROM cohort_events e
    WHERE e.funnel_user_key = s.funnel_user_key
      AND s.entered_at IS NOT NULL
      AND ${SIGNIFICANT_ACTION_FILTER}
      AND e.timestamp::timestamptz >= s.entered_at
      AND ${FUNNEL_SCOPE_FILTER}
  ) action ON true
) SELECT 1 AS stage_order, 'Signup page viewed' AS stage, COUNT(*) FILTER (WHERE page_at IS NOT NULL) AS users FROM action_stage UNION ALL SELECT 2, 'Signup CTA clicked', COUNT(*) FILTER (WHERE cta_at IS NOT NULL) FROM action_stage UNION ALL SELECT 3, 'Signed up', COUNT(*) FILTER (WHERE signed_up_at IS NOT NULL) FROM action_stage UNION ALL SELECT 4, 'Onboarding started', COUNT(*) FILTER (WHERE started_at IS NOT NULL) FROM action_stage UNION ALL SELECT 5, 'Onboarding step reached', COUNT(*) FILTER (WHERE step_at IS NOT NULL) FROM action_stage UNION ALL SELECT 6, 'Onboarding completed', COUNT(*) FILTER (WHERE completed_at IS NOT NULL) FROM action_stage UNION ALL SELECT 7, 'Entered app', COUNT(*) FILTER (WHERE entered_at IS NOT NULL) FROM action_stage UNION ALL SELECT 8, 'First significant action', COUNT(*) FILTER (WHERE action_at IS NOT NULL) FROM action_stage ORDER BY stage_order`;
const SIGNUP_METHOD_CONVERSION_SQL = `${FUNNEL_EVENTS_CTE}, clicks AS (SELECT COALESCE(NULLIF(properties::jsonb ->> 'method', ''), 'unknown') AS method, COUNT(DISTINCT funnel_user_key) AS clicks FROM funnel_events WHERE event_name = 'auth.signup_clicked' AND ${FUNNEL_SCOPE_FILTER} GROUP BY 1), signups AS (SELECT COALESCE(NULLIF(properties::jsonb ->> 'signup_method', ''), CASE WHEN lower(properties::jsonb ->> 'auth_provider') = 'google' THEN 'google' ELSE 'unknown' END) AS method, COUNT(DISTINCT funnel_user_key) AS signups FROM funnel_events WHERE event_name = 'signup' AND ${FUNNEL_SCOPE_FILTER} GROUP BY 1), methods AS (SELECT method FROM clicks UNION SELECT method FROM signups) SELECT methods.method, COALESCE(clicks.clicks, 0) AS clicks, COALESCE(signups.signups, 0) AS signups, COALESCE(signups.signups::float / NULLIF(clicks.clicks, 0), 0) AS conversion_rate FROM methods LEFT JOIN clicks ON clicks.method = methods.method LEFT JOIN signups ON signups.method = methods.method ORDER BY clicks DESC NULLS LAST, methods.method`;
const ONBOARDING_STEP_DROPOFF_SQL = `${ONBOARDING_EVENTS_CTE}, viewers AS (
  SELECT DISTINCT funnel_user_key,
    COALESCE(NULLIF(properties::jsonb ->> 'flow', ''), 'unknown') AS flow,
    COALESCE(NULLIF(properties::jsonb ->> 'step_id', ''), 'unknown') AS step_id,
    COALESCE(NULLIF(properties::jsonb ->> 'step_index', ''), '999') AS step_index
  FROM onboarding_events
  WHERE event_name = 'onboarding_step_viewed'
    AND funnel_user_key IS NOT NULL
), views AS (
  SELECT flow, step_id, step_index, COUNT(DISTINCT funnel_user_key) AS users_reached
  FROM viewers
  GROUP BY flow, step_id, step_index
), user_outcomes AS (
  SELECT viewers.funnel_user_key, viewers.flow, viewers.step_id, viewers.step_index,
    MAX(CASE WHEN events.event_name = 'onboarding_step_completed' THEN 1 ELSE 0 END) AS completed,
    MAX(CASE WHEN events.event_name = 'onboarding_step_skipped' THEN 1 ELSE 0 END) AS skipped
  FROM viewers
  LEFT JOIN onboarding_events AS events
    ON events.funnel_user_key = viewers.funnel_user_key
    AND events.event_name IN ('onboarding_step_completed', 'onboarding_step_skipped')
    AND COALESCE(NULLIF(events.properties::jsonb ->> 'flow', ''), 'unknown') = viewers.flow
    AND COALESCE(NULLIF(events.properties::jsonb ->> 'step_id', ''), 'unknown') = viewers.step_id
  GROUP BY viewers.funnel_user_key, viewers.flow, viewers.step_id, viewers.step_index
), outcomes AS (
  SELECT flow, step_id, step_index,
    SUM(completed) AS users_completed,
    SUM(skipped) AS users_skipped,
    SUM(CASE WHEN completed = 1 OR skipped = 1 THEN 1 ELSE 0 END) AS users_with_outcome
  FROM user_outcomes
  GROUP BY flow, step_id, step_index
)
SELECT views.flow, views.step_id, views.step_index, views.users_reached,
  COALESCE(outcomes.users_completed, 0) AS users_completed,
  COALESCE(outcomes.users_skipped, 0) AS users_skipped,
  views.users_reached - COALESCE(outcomes.users_with_outcome, 0) AS users_no_recorded_outcome,
  COALESCE(outcomes.users_completed::float / NULLIF(views.users_reached, 0), 0) AS completion_rate
FROM views
LEFT JOIN outcomes ON outcomes.flow = views.flow AND outcomes.step_id = views.step_id AND outcomes.step_index = views.step_index
ORDER BY views.step_index, views.flow, views.step_id`;
const ONBOARDING_SETUP_CHOICE_SQL = `${ONBOARDING_EVENTS_CTE}, choice_viewers AS (
  SELECT DISTINCT funnel_user_key
  FROM onboarding_events
  WHERE event_name = 'onboarding_step_viewed'
    AND COALESCE(NULLIF(properties::jsonb ->> 'flow', ''), '') = 'first_run'
    AND COALESCE(NULLIF(properties::jsonb ->> 'step_id', ''), '') = 'choice'
    AND funnel_user_key IS NOT NULL
), choices AS (
  SELECT funnel_user_key,
    COALESCE(NULLIF(properties::jsonb ->> 'method_id', ''), 'unknown') AS method_id,
    NULLIF(properties::jsonb ->> 'onboarding_attempt_id', '') AS attempt_id,
    timestamp::timestamptz AS clicked_at,
    id
  FROM onboarding_events
  WHERE event_name = 'onboarding_method_clicked'
    AND COALESCE(NULLIF(properties::jsonb ->> 'flow', ''), '') = 'first_run'
    AND COALESCE(NULLIF(properties::jsonb ->> 'step_id', ''), '') = 'choice'
    AND funnel_user_key IS NOT NULL
), ranked_choices AS (
  SELECT choices.*,
    ROW_NUMBER() OVER (PARTITION BY funnel_user_key ORDER BY clicked_at, id) AS choice_number
  FROM choices
  JOIN choice_viewers USING (funnel_user_key)
), first_choice_summary AS (
  SELECT method_id, COUNT(DISTINCT funnel_user_key) AS first_choice_users
  FROM ranked_choices
  WHERE choice_number = 1
  GROUP BY method_id
), selection_summary AS (
  SELECT method_id,
    COUNT(DISTINCT funnel_user_key) AS selected_users,
    COUNT(*) AS method_clicks,
    COUNT(DISTINCT attempt_id) AS selection_attempts
  FROM choices
  GROUP BY method_id
), starts AS (
  SELECT funnel_user_key,
    COALESCE(NULLIF(properties::jsonb ->> 'method_id', ''), 'unknown') AS method_id,
    NULLIF(properties::jsonb ->> 'onboarding_attempt_id', '') AS attempt_id
  FROM onboarding_events
  WHERE event_name = 'onboarding_method_started'
    AND COALESCE(NULLIF(properties::jsonb ->> 'flow', ''), '') = 'first_run'
    AND COALESCE(NULLIF(properties::jsonb ->> 'step_id', ''), '') = 'choice'
    AND funnel_user_key IS NOT NULL
), method_outcomes AS (
  SELECT funnel_user_key,
    COALESCE(NULLIF(properties::jsonb ->> 'method_id', ''), 'unknown') AS method_id,
    NULLIF(properties::jsonb ->> 'onboarding_attempt_id', '') AS attempt_id,
    COALESCE(NULLIF(properties::jsonb ->> 'outcome', ''), 'unknown') AS outcome
  FROM onboarding_events
  WHERE event_name = 'onboarding_method_outcome'
    AND COALESCE(NULLIF(properties::jsonb ->> 'flow', ''), '') = 'first_run'
    AND COALESCE(NULLIF(properties::jsonb ->> 'step_id', ''), '') = 'choice'
    AND funnel_user_key IS NOT NULL
), attempts AS (
  SELECT starts.funnel_user_key, starts.method_id, starts.attempt_id,
    MAX(CASE WHEN method_outcomes.outcome IN ('connected', 'already_connected') THEN 1 ELSE 0 END) AS connected,
    MAX(CASE WHEN method_outcomes.outcome = 'failed' THEN 1 ELSE 0 END) AS failed,
    MAX(CASE WHEN method_outcomes.outcome = 'handoff_failed' THEN 1 ELSE 0 END) AS handoff_failed,
    MAX(CASE WHEN method_outcomes.outcome = 'settings_opened' THEN 1 ELSE 0 END) AS settings_opened,
    MAX(CASE WHEN method_outcomes.outcome IS NOT NULL THEN 1 ELSE 0 END) AS has_outcome
  FROM starts
  LEFT JOIN method_outcomes
    ON method_outcomes.funnel_user_key = starts.funnel_user_key
    AND method_outcomes.method_id = starts.method_id
    AND method_outcomes.attempt_id = starts.attempt_id
  GROUP BY starts.funnel_user_key, starts.method_id, starts.attempt_id
), attempt_summary AS (
  SELECT method_id,
    COUNT(DISTINCT CASE WHEN connected = 1 THEN attempt_id END) AS connection_success_attempts,
    COUNT(DISTINCT CASE WHEN failed = 1 THEN attempt_id END) AS connection_failure_attempts,
    COUNT(DISTINCT CASE WHEN handoff_failed = 1 THEN attempt_id END) AS handoff_failure_attempts,
    COUNT(DISTINCT CASE WHEN connected = 1 THEN funnel_user_key END) AS connection_success_users,
    COUNT(DISTINCT CASE WHEN failed = 1 THEN funnel_user_key END) AS connection_failure_users,
    COUNT(DISTINCT CASE WHEN connected = 0 AND failed = 0 AND has_outcome = 0 THEN attempt_id END) AS connection_no_outcome_attempts,
    COUNT(DISTINCT CASE WHEN settings_opened = 1 THEN attempt_id END) AS settings_handoff_attempts
  FROM attempts
  GROUP BY method_id
), method_list AS (
  SELECT 'builder_create_account' AS method_id, 'Create Builder.io account' AS method_label
  UNION ALL SELECT 'builder_sign_in', 'Sign in with Builder.io account'
  UNION ALL SELECT 'custom_keys', 'Configure custom keys'
)
SELECT method_list.method_id, method_list.method_label,
  (SELECT COUNT(DISTINCT funnel_user_key) FROM choice_viewers) AS choice_screen_viewers,
  COALESCE(first_choice_summary.first_choice_users, 0) AS first_choice_users,
  COALESCE(first_choice_summary.first_choice_users::float / NULLIF((SELECT COUNT(DISTINCT funnel_user_key) FROM choice_viewers), 0), 0) AS first_choice_rate,
  COALESCE(selection_summary.selected_users, 0) AS selected_users,
  COALESCE(selection_summary.method_clicks, 0) AS method_clicks,
  COALESCE(selection_summary.selection_attempts, 0) AS selection_attempts,
  COALESCE(attempt_summary.connection_success_attempts, 0) AS connection_success_attempts,
  COALESCE(attempt_summary.connection_failure_attempts, 0) AS connection_failure_attempts,
  COALESCE(attempt_summary.handoff_failure_attempts, 0) AS handoff_failure_attempts,
  COALESCE(attempt_summary.connection_success_users, 0) AS connection_success_users,
  COALESCE(attempt_summary.connection_failure_users, 0) AS connection_failure_users,
  COALESCE(attempt_summary.connection_no_outcome_attempts, 0) AS connection_no_outcome_attempts,
  COALESCE(attempt_summary.settings_handoff_attempts, 0) AS settings_handoff_attempts,
  attempt_summary.connection_success_attempts::float / NULLIF(attempt_summary.connection_success_attempts + attempt_summary.connection_failure_attempts, 0) AS connection_success_rate
FROM method_list
LEFT JOIN first_choice_summary ON first_choice_summary.method_id = method_list.method_id
LEFT JOIN selection_summary ON selection_summary.method_id = method_list.method_id
LEFT JOIN attempt_summary ON attempt_summary.method_id = method_list.method_id
ORDER BY method_list.method_id`;
const SHARING_ACTIONS_BY_APP_SQL = `${FUNNEL_EVENTS_CTE} SELECT ${TEMPLATE_EXPR} AS app, event_name AS action, COUNT(*) AS events, COUNT(DISTINCT funnel_user_key) AS users FROM funnel_events WHERE event_name IN ('share_view', 'share_cta_click', 'share_invite_sent', 'share_visibility_change', 'share_link_copied') AND ${FUNNEL_SCOPE_FILTER} AND ${FIRST_PARTY_TEMPLATE_FILTER} GROUP BY 1, 2 ORDER BY app, events DESC`;

const ACTION_SUCCESS_RATE_OVER_TIME_SQL = `WITH action_events AS (SELECT ${EVENT_DATE_SQL} AS date, ${TEMPLATE_EXPR} AS app, ${ACTION_RESPONSE_DEPLOYMENT_ENV_SQL} AS deployment_env, session_id, ${ACTION_RESPONSE_OUTCOME_CLASS_SQL} AS outcome_class, ${ACTION_RESPONSE_WEIGHT_SQL} AS weight FROM analytics_events WHERE ${ACTION_RESPONSE_EVENT_FILTER}), grid AS (SELECT d.date, s.app, s.deployment_env FROM (SELECT DISTINCT date FROM action_events) d CROSS JOIN (SELECT DISTINCT app, deployment_env FROM action_events) s), agg AS (SELECT date, app, deployment_env, SUM(CASE WHEN outcome_class = 'success' THEN weight ELSE 0 END) AS success_weight, SUM(CASE WHEN outcome_class = 'failure' THEN weight ELSE 0 END) AS failure_weight, SUM(CASE WHEN outcome_class = 'cancelled' THEN weight ELSE 0 END) AS cancelled_weight, SUM(CASE WHEN outcome_class = 'suspended' THEN weight ELSE 0 END) AS suspended_weight, COUNT(DISTINCT session_id) AS sessions, COUNT(DISTINCT CASE WHEN outcome_class = 'failure' THEN session_id END) AS failure_sessions FROM action_events GROUP BY date, app, deployment_env) SELECT g.date, g.app, g.deployment_env, g.app || ' / ' || g.deployment_env AS series, COALESCE(a.success_weight, 0) AS success_weight, COALESCE(a.failure_weight, 0) AS failure_weight, COALESCE(a.cancelled_weight, 0) AS cancelled_weight, COALESCE(a.suspended_weight, 0) AS suspended_weight, CASE WHEN a.date IS NULL THEN NULL ELSE COALESCE(a.success_weight, 0)::float / NULLIF(COALESCE(a.success_weight, 0) + COALESCE(a.failure_weight, 0), 0) END AS rate, COALESCE(a.sessions, 0) AS sessions, CASE WHEN a.date IS NULL THEN NULL ELSE COALESCE(a.failure_sessions, 0)::float / NULLIF(a.sessions, 0) END AS session_failure_share FROM grid g LEFT JOIN agg a ON a.date = g.date AND a.app = g.app AND a.deployment_env = g.deployment_env ORDER BY g.date, g.app, g.deployment_env`;
const ACTION_RELIABILITY_BY_ACTION_SQL = `WITH action_events AS (SELECT ${TEMPLATE_EXPR} AS app, COALESCE(NULLIF(properties::jsonb ->> 'action', ''), 'unknown') AS action, ${ACTION_RESPONSE_CALL_TYPE_SQL} AS call_type, ${ACTION_RESPONSE_AUTH_STATE_SQL} AS auth_state, ${ACTION_RESPONSE_DEPLOYMENT_ENV_SQL} AS deployment_env, ${ACTION_RESPONSE_OUTCOME_CLASS_SQL} AS outcome_class, ${ACTION_RESPONSE_WEIGHT_SQL} AS weight, NULLIF(properties::jsonb ->> 'duration_ms', '')::numeric AS duration_ms, NULLIF(properties::jsonb ->> 'page_hidden', '') AS page_hidden FROM analytics_events WHERE ${ACTION_RESPONSE_EVENT_FILTER}), rates AS (SELECT app, action, call_type, auth_state, deployment_env, COUNT(*) AS raw_n, SUM(CASE WHEN outcome_class = 'success' THEN weight ELSE 0 END) AS success_weight, SUM(CASE WHEN outcome_class = 'failure' THEN weight ELSE 0 END) AS failure_weight, SUM(CASE WHEN outcome_class = 'cancelled' THEN weight ELSE 0 END) AS cancelled_weight, SUM(CASE WHEN outcome_class = 'suspended' THEN weight ELSE 0 END) AS suspended_weight FROM action_events GROUP BY app, action, call_type, auth_state, deployment_env), duration_buckets AS (SELECT app, action, call_type, auth_state, deployment_env, (FLOOR(duration_ms / 25) * 25) AS bucket_ms, SUM(weight) AS bucket_weight FROM action_events WHERE outcome_class = 'success' AND duration_ms IS NOT NULL AND COALESCE(page_hidden, '') <> 'true' GROUP BY app, action, call_type, auth_state, deployment_env, (FLOOR(duration_ms / 25) * 25)), duration_cumulative AS (SELECT *, SUM(bucket_weight) OVER (PARTITION BY app, action, call_type, auth_state, deployment_env ORDER BY bucket_ms) AS cumulative_weight, SUM(bucket_weight) OVER (PARTITION BY app, action, call_type, auth_state, deployment_env) AS total_success_weight FROM duration_buckets), quantiles AS (SELECT app, action, call_type, auth_state, deployment_env, MIN(CASE WHEN cumulative_weight >= total_success_weight * 0.5 THEN bucket_ms END) AS p50_ms, MIN(CASE WHEN cumulative_weight >= total_success_weight * 0.9 THEN bucket_ms END) AS p90_ms FROM duration_cumulative GROUP BY app, action, call_type, auth_state, deployment_env) SELECT r.app, r.action, r.call_type, r.auth_state, r.deployment_env, r.raw_n, r.success_weight, r.failure_weight, r.cancelled_weight, r.suspended_weight, COALESCE(r.success_weight, 0)::float / NULLIF(COALESCE(r.success_weight, 0) + COALESCE(r.failure_weight, 0), 0) AS success_rate, q.p50_ms, q.p90_ms FROM rates r LEFT JOIN quantiles q ON q.app = r.app AND q.action = r.action AND q.call_type = r.call_type AND q.auth_state = r.auth_state AND q.deployment_env = r.deployment_env WHERE COALESCE(r.success_weight, 0) + COALESCE(r.failure_weight, 0) > 0 ORDER BY (COALESCE(r.success_weight, 0) + COALESCE(r.failure_weight, 0)) DESC, r.app, r.action LIMIT 200`;
const ACTION_LATENCY_OVER_TIME_SQL = `WITH action_events AS (SELECT ${EVENT_DATE_SQL} AS date, ${TEMPLATE_EXPR} AS app, ${ACTION_RESPONSE_DEPLOYMENT_ENV_SQL} AS deployment_env, ${ACTION_RESPONSE_OUTCOME_CLASS_SQL} AS outcome_class, ${ACTION_RESPONSE_WEIGHT_SQL} AS weight, NULLIF(properties::jsonb ->> 'duration_ms', '')::numeric AS duration_ms, NULLIF(properties::jsonb ->> 'page_hidden', '') AS page_hidden FROM analytics_events WHERE ${ACTION_RESPONSE_EVENT_FILTER}), grid AS (SELECT d.date, s.app, s.deployment_env FROM (SELECT DISTINCT date FROM action_events) d CROSS JOIN (SELECT DISTINCT app, deployment_env FROM action_events) s), duration_buckets AS (SELECT date, app, deployment_env, (FLOOR(duration_ms / 25) * 25) AS bucket_ms, SUM(weight) AS bucket_weight FROM action_events WHERE outcome_class = 'success' AND duration_ms IS NOT NULL AND COALESCE(page_hidden, '') <> 'true' GROUP BY date, app, deployment_env, (FLOOR(duration_ms / 25) * 25)), duration_cumulative AS (SELECT *, SUM(bucket_weight) OVER (PARTITION BY date, app, deployment_env ORDER BY bucket_ms) AS cumulative_weight, SUM(bucket_weight) OVER (PARTITION BY date, app, deployment_env) AS total_weight FROM duration_buckets), quantiles AS (SELECT date, app, deployment_env, MIN(CASE WHEN cumulative_weight >= total_weight * 0.5 THEN bucket_ms END) AS p50_ms, MIN(CASE WHEN cumulative_weight >= total_weight * 0.9 THEN bucket_ms END) AS p90_ms FROM duration_cumulative GROUP BY date, app, deployment_env) SELECT g.date, g.app, g.deployment_env, g.app || ' / ' || g.deployment_env AS series, q.p50_ms, q.p90_ms FROM grid g LEFT JOIN quantiles q ON q.date = g.date AND q.app = g.app AND q.deployment_env = g.deployment_env ORDER BY g.date, g.app, g.deployment_env`;

const ENTRIES: FirstPartyMetric[] = [
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

  {
    key: "sessions-by-app",
    title: "Sessions by Agent-Native App",
    chartType: "bar",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(
      `SELECT COALESCE(NULLIF(app, ''), 'unknown') AS app, COUNT(*) AS count FROM analytics_events WHERE ${SESSION_STATUS_FILTER} AND ${FIRST_PARTY_TEMPLATE_FILTER} GROUP BY COALESCE(NULLIF(app, ''), 'unknown') ORDER BY count DESC LIMIT 20`,
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
      `SELECT ${EVENT_DATE_SQL} AS date, COUNT(*) AS count FROM analytics_events WHERE ${SESSION_STATUS_FILTER} GROUP BY ${EVENT_DATE_SQL} ORDER BY date`,
    ),
    config: { xKey: "date", yKey: "count", color: "#10b981" },
  },
  {
    key: "replay-sessions",
    title: "Replay Sessions",
    chartType: "metric",
    source: "first-party",
    width: 1,
    windowed: false,
    buildSql: fixed(REPLAY_SESSIONS_SQL),
    config: {
      yKey: "count",
      yFormatter: "number",
      description: "Distinct sessions with recorded replay chunks.",
    },
  },
  {
    key: "replay-chunks-over-time",
    title: "Replay Chunks Over Time",
    chartType: "area",
    source: "first-party",
    width: 1,
    windowed: false,
    buildSql: fixed(REPLAY_CHUNKS_OVER_TIME_SQL),
    config: {
      xKey: "date",
      yKey: "count",
      yFormatter: "number",
      color: "#6366f1",
      description: "Replay chunk events captured per day.",
    },
  },
  {
    key: "recent-replay-sessions",
    title: "Recent Replay Sessions",
    chartType: "table",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(RECENT_REPLAY_SESSIONS_SQL),
    config: {
      description:
        "Recent first-party sessions with replay chunks. Session links open the local replay viewer.",
      sortable: true,
      limit: 25,
      columns: [
        {
          key: "session_id",
          label: "Session",
          format: "link",
          linkKey: "href",
        },
        { key: "app", label: "App" },
        { key: "visitor", label: "Visitor" },
        { key: "chunks", label: "Chunks", format: "number" },
        { key: "last_seen", label: "Last seen", format: "date" },
        { key: "href", hidden: true },
      ],
    },
  },
  {
    key: "signed-in-vs-anon",
    title: "Signed-In vs Anonymous Sessions",
    chartType: "bar",
    source: "first-party",
    width: 1,
    windowed: false,
    buildSql: fixed(
      `SELECT COALESCE(NULLIF(signed_in, ''), 'unknown') AS signed_in, COUNT(*) AS count FROM analytics_events WHERE ${SESSION_STATUS_FILTER} GROUP BY COALESCE(NULLIF(signed_in, ''), 'unknown') ORDER BY signed_in`,
    ),
    config: {
      xKey: "signed_in",
      yKey: "count",
      color: "#f59e0b",
      description:
        "true = signed in, false = anonymous. Best proxy for total signups per period (still includes returning users).",
    },
  },

  {
    key: "action-success-rate-over-time",
    title: "Action Success Rate Over Time",
    chartType: "line",
    source: "first-party",
    width: 3,
    windowed: false,
    buildSql: fixed(ACTION_SUCCESS_RATE_OVER_TIME_SQL),
    config: {
      xKey: "date",
      yKey: "rate",
      yFormatter: "percent",
      pivot: {
        xKey: "date",
        seriesKey: "series",
        valueKey: "rate",
      },
      description:
        "Daily weighted action.response success rate by app / deployment_env (beta.* vs prod hostname, kept separate since beta is mostly internal/QA traffic): sample_weight-expanded success / (success + failure). Cancelled (outcome='cancelled', a superseded/unmounted call) and suspended (a hidden-tab timeout with no real server wait) are excluded from both sides, not counted as success. Also carries sessions (distinct session_id count) and session_failure_share (share of sessions with >=1 failure), since a rate can look stable while failures concentrate in a few sessions. A day with no traffic for a series is blank, not zero.",
    },
  },
  {
    key: "action-reliability-by-action",
    title: "Action Reliability & Latency by Action",
    chartType: "table",
    source: "first-party",
    width: 3,
    windowed: false,
    buildSql: fixed(ACTION_RELIABILITY_BY_ACTION_SQL),
    config: {
      description:
        "Weighted action.response reliability and latency, broken out by app, action, read (GET) vs mutation, auth_state (user_id present), and deployment environment (beta.* vs prod hostname). p50/p90 are a sample_weight-bucketed cumulative quantile over successful, foreground-tab calls only (page_hidden excluded), not a raw percentile_cont. raw_n is the unweighted row count in that group -- treat a rate from a small raw_n as high-variance. Suspended (a hidden-tab timeout with no real server wait) is excluded from success_rate the same way cancelled is.",
      sortable: true,
      limit: 200,
      columns: [
        { key: "app", label: "App" },
        { key: "action", label: "Action" },
        { key: "call_type", label: "Type" },
        { key: "auth_state", label: "Auth" },
        { key: "deployment_env", label: "Env" },
        { key: "raw_n", label: "Rows", format: "number" },
        { key: "success_rate", label: "Success rate", format: "percent" },
        { key: "cancelled_weight", label: "Cancelled", format: "number" },
        { key: "suspended_weight", label: "Suspended", format: "number" },
        { key: "p50_ms", label: "p50 (ms)", format: "number" },
        { key: "p90_ms", label: "p90 (ms)", format: "number" },
      ],
    },
  },
  {
    key: "action-latency-p50-over-time",
    title: "Action Latency p50 Over Time",
    chartType: "line",
    source: "first-party",
    width: 3,
    windowed: false,
    buildSql: fixed(ACTION_LATENCY_OVER_TIME_SQL),
    config: {
      xKey: "date",
      yKey: "p50_ms",
      yFormatter: "number",
      pivot: {
        xKey: "date",
        seriesKey: "series",
        valueKey: "p50_ms",
      },
      description:
        "Daily weighted p50 action.response latency (ms) by app / deployment_env. Same sample_weight-bucketed cumulative quantile as action-reliability-by-action, over successful, foreground-tab calls only (page_hidden excluded). A day with no successful calls for a series is blank, not zero. See action-latency-p90-over-time for the tail.",
    },
  },
  {
    key: "action-latency-p90-over-time",
    title: "Action Latency p90 Over Time",
    chartType: "line",
    source: "first-party",
    width: 3,
    windowed: false,
    buildSql: fixed(ACTION_LATENCY_OVER_TIME_SQL),
    config: {
      xKey: "date",
      yKey: "p90_ms",
      yFormatter: "number",
      pivot: {
        xKey: "date",
        seriesKey: "series",
        valueKey: "p90_ms",
      },
      description:
        "Daily weighted p90 action.response latency (ms) by app / deployment_env -- same population as action-latency-p50-over-time, but the tail where a backgrounded-tab or slow-network trend shows up before it moves p50.",
    },
  },

  {
    key: "total-template-clicks",
    title: "Template Clicks",
    chartType: "metric",
    source: "first-party",
    width: 1,
    windowed: false,
    buildSql: fixed(
      `SELECT COUNT(*) AS count FROM analytics_events WHERE event_name = 'click template' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${FIRST_PARTY_TEMPLATE_FILTER}`,
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
      `SELECT COUNT(*) AS count FROM analytics_events WHERE event_name = 'click try demo' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${FIRST_PARTY_TEMPLATE_FILTER}`,
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
      `SELECT COUNT(*) AS count FROM analytics_events WHERE event_name = 'copy cli command' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${FIRST_PARTY_TEMPLATE_FILTER}`,
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
      `SELECT ${EVENT_DATE_SQL} AS date, COALESCE(NULLIF(template, ''), 'unknown') AS template, COUNT(*) AS count FROM analytics_events WHERE event_name = 'click template' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${FIRST_PARTY_TEMPLATE_FILTER} GROUP BY ${EVENT_DATE_SQL}, COALESCE(NULLIF(template, ''), 'unknown') ORDER BY date, template`,
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
      `SELECT ${EVENT_DATE_SQL} AS date, COALESCE(NULLIF(template, ''), 'unknown') AS template, COUNT(*) AS count FROM analytics_events WHERE event_name = 'click template' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${FIRST_PARTY_TEMPLATE_FILTER} GROUP BY ${EVENT_DATE_SQL}, COALESCE(NULLIF(template, ''), 'unknown') ORDER BY date, template`,
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
    key: "demo-clicks-over-time",
    title: "Try-Demo Clicks Over Time",
    chartType: "area",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(
      `SELECT ${EVENT_DATE_SQL} AS date, COALESCE(NULLIF(template, ''), 'unknown') AS template, COUNT(*) AS count FROM analytics_events WHERE event_name = 'click try demo' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${FIRST_PARTY_TEMPLATE_FILTER} GROUP BY ${EVENT_DATE_SQL}, COALESCE(NULLIF(template, ''), 'unknown') ORDER BY date, template`,
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
      `SELECT ${EVENT_DATE_SQL} AS date, COALESCE(NULLIF(template, ''), 'unknown') AS template, COUNT(*) AS count FROM analytics_events WHERE event_name = 'copy cli command' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${FIRST_PARTY_TEMPLATE_FILTER} GROUP BY ${EVENT_DATE_SQL}, COALESCE(NULLIF(template, ''), 'unknown') ORDER BY date, template`,
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
      `SELECT ${EVENT_DATE_SQL} AS date, COALESCE(NULLIF(template, ''), 'unknown') AS template, COUNT(*) AS count FROM analytics_events WHERE event_name = 'copy cli command' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${FIRST_PARTY_TEMPLATE_FILTER} GROUP BY ${EVENT_DATE_SQL}, COALESCE(NULLIF(template, ''), 'unknown') ORDER BY date, template`,
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
    key: "pageviews-over-time",
    title: "Pageviews Over Time",
    chartType: "area",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(
      `SELECT ${EVENT_DATE_SQL} AS date, COALESCE(NULLIF(template, ''), NULLIF(app, ''), 'unknown') AS template, COUNT(*) AS count FROM analytics_events WHERE event_name = 'pageview' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND ${FIRST_PARTY_TEMPLATE_FILTER} GROUP BY ${EVENT_DATE_SQL}, COALESCE(NULLIF(template, ''), NULLIF(app, ''), 'unknown') ORDER BY date, template`,
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
      `WITH pageviews AS (SELECT COALESCE(CASE WHEN NULLIF(hostname, '') IS NOT NULL THEN 'https://' || hostname || COALESCE(NULLIF(path, ''), '/') END, NULLIF(url, ''), NULLIF(path, ''), 'unknown') AS url, CASE WHEN NULLIF(hostname, '') IS NOT NULL THEN 'https://' || hostname || COALESCE(NULLIF(path, ''), '/') WHEN lower(COALESCE(NULLIF(url, ''), '')) LIKE 'http://%' OR lower(COALESCE(NULLIF(url, ''), '')) LIKE 'https://%' THEN url WHEN NULLIF(path, '') IS NOT NULL AND substr(path, 1, 1) = '/' AND substr(path, 1, 2) != '//' THEN path ELSE '' END AS href, COUNT(*) AS views, COUNT(DISTINCT ${USER_KEY_SQL}) AS users, MAX(${EVENT_DATE_SQL}) AS last_seen FROM analytics_events WHERE event_name = 'pageview' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} GROUP BY 1, 2) SELECT url, views, users, last_seen, href FROM pageviews ORDER BY views DESC LIMIT 25`,
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
      `WITH raw_referrers AS (SELECT COALESCE(NULLIF(referrer, ''), NULLIF(properties::jsonb ->> 'referrer', ''), NULLIF(properties::jsonb ->> 'landing_referrer', '')) AS raw_referrer, NULLIF(hostname, '') AS page_host, ${USER_KEY_SQL} AS user_key FROM analytics_events WHERE event_name = 'pageview' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER}), referrer_domains AS (SELECT lower(CASE WHEN lower(raw_referrer) LIKE 'http://%' OR lower(raw_referrer) LIKE 'https://%' THEN split_part(split_part(split_part(raw_referrer, '://', 2), '/', 1), chr(63), 1) WHEN raw_referrer LIKE '//%' THEN split_part(split_part(substr(raw_referrer, 3), '/', 1), chr(63), 1) ELSE split_part(split_part(raw_referrer, '/', 1), chr(63), 1) END) AS referrer_domain, lower(page_host) AS page_host, user_key FROM raw_referrers WHERE raw_referrer IS NOT NULL) SELECT referrer_domain, COUNT(*) AS visits, COUNT(DISTINCT user_key) AS users FROM referrer_domains WHERE referrer_domain <> '' AND (page_host IS NULL OR referrer_domain <> page_host) GROUP BY referrer_domain ORDER BY visits DESC LIMIT 20`,
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
      `WITH clip_events AS (SELECT COALESCE(NULLIF(properties::jsonb ->> 'recording_id', ''), NULLIF(path, ''), NULLIF(url, ''), 'unknown') AS clip_key, CASE WHEN lower(COALESCE(NULLIF(url, ''), '')) LIKE 'http://%' OR lower(COALESCE(NULLIF(url, ''), '')) LIKE 'https://%' THEN url WHEN NULLIF(hostname, '') IS NOT NULL THEN 'https://' || hostname || COALESCE(NULLIF(path, ''), '/') WHEN NULLIF(path, '') LIKE '/%' THEN 'https://clips.agent-native.com' || path ELSE '' END AS href, ${USER_KEY_SQL} AS user_key, ${EVENT_DATE_SQL} AS event_date FROM analytics_events WHERE event_name = 'share_view' AND ${DASHBOARD_TIME_RANGE_FILTER} AND ${DASHBOARD_EMAIL_FILTER} AND COALESCE(NULLIF(properties::jsonb ->> 'surface', ''), 'clip') = 'clip'), clip_views AS (SELECT clip_key, COALESCE(MAX(NULLIF(href, '')), clip_key) AS href, COUNT(*) AS views, COUNT(DISTINCT user_key) AS users, MAX(event_date) AS last_seen FROM clip_events GROUP BY clip_key) SELECT CASE WHEN lower(COALESCE(href, '')) LIKE 'http://%' OR lower(COALESCE(href, '')) LIKE 'https://%' THEN href ELSE clip_key END AS clip, views, users, last_seen, href FROM clip_views ORDER BY views DESC LIMIT 25`,
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
    title: "Repeat Signed-In Visitors",
    chartType: "metric",
    source: "first-party",
    width: 1,
    windowed: false,
    buildSql: fixed(REPEAT_USERS_SQL),
    config: {
      yKey: "count",
      yFormatter: "number",
      description:
        "Signed-in browser identities with non-docs app session activity on at least two days in the selected time range.",
    },
  },
  {
    key: "recurring-users-by-template",
    title: "Recurring Signed-In Users by Template",
    chartType: "area",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(RECURRING_USERS_BY_TEMPLATE_SQL),
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
      description: RECURRING_USERS_DESCRIPTION,
    },
  },
  {
    key: "recurring-users-by-template-bar",
    title: "Recurring Signed-In Users by Template (Bar)",
    chartType: "bar",
    source: "first-party",
    width: 1,
    windowed: false,
    buildSql: fixed(RECURRING_USERS_BY_TEMPLATE_WEEKLY_SQL),
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
      description: RECURRING_USERS_WEEKLY_DESCRIPTION,
    },
  },
  {
    key: "retention-over-time",
    title: "7d Rolling Signed-In Return Rate",
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
      description: RETENTION_OVER_TIME_DESCRIPTION,
    },
  },
  {
    key: "one-day-retention-by-template",
    title: "1-7d Signed-In Return by Starting Template",
    chartType: "bar",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(ONE_DAY_RETENTION_BY_TEMPLATE_SQL),
    config: {
      xKey: "template",
      yKey: "rate",
      yFormatter: "percent",
      columns: [
        { key: "template", label: "Starting template" },
        { key: "rate", label: "Return rate", format: "percent" },
        { key: "retained_users", label: "Returned", format: "number" },
        { key: "cohort_users", label: "Cohort", format: "number" },
      ],
      description: ONE_DAY_RETENTION_BY_TEMPLATE_DESCRIPTION,
    },
  },
  {
    key: "seven-day-retention-by-template",
    title: "7-14d Signed-In Return by Starting Template",
    chartType: "bar",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(SEVEN_DAY_RETENTION_BY_TEMPLATE_SQL),
    config: {
      xKey: "template",
      yKey: "rate",
      yFormatter: "percent",
      columns: [
        { key: "template", label: "Starting template" },
        { key: "rate", label: "Return rate", format: "percent" },
        { key: "retained_users", label: "Returned", format: "number" },
        { key: "cohort_users", label: "Cohort", format: "number" },
      ],
      description: SEVEN_DAY_RETENTION_BY_TEMPLATE_DESCRIPTION,
    },
  },
  {
    key: "dau-over-time",
    title: "Signed-In Daily Active Visitors by Template",
    chartType: "area",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(DAU_BY_TEMPLATE_SQL),
    config: {
      xKey: "date",
      yKey: "visitors",
      yFormatter: "number",
      pivot: {
        xKey: "date",
        seriesKey: "template",
        valueKey: "visitors",
      },
      stacked: true,
      description:
        "Distinct signed-in activity identities per day from session-status or identified app-entry telemetry, stacked by inferred template/app. Docs traffic is excluded. This is signed-in activity, not true account-level DAU.",
    },
  },
  {
    key: "wau-over-time",
    title: "Signed-In Weekly Active Visitors by Template",
    chartType: "area",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(WAU_BY_TEMPLATE_SQL),
    config: {
      xKey: "date",
      yKey: "visitors",
      yFormatter: "number",
      pivot: {
        xKey: "date",
        seriesKey: "template",
        valueKey: "visitors",
      },
      stacked: true,
      description:
        "Trailing 7-day distinct signed-in activity identities for each active date from session-status or identified app-entry telemetry, stacked by inferred template/app. Docs traffic is excluded. This is signed-in activity, not true account-level WAU.",
    },
  },

  {
    key: "referred-signups-30d",
    title: "Referred Signups (30d)",
    chartType: "metric",
    source: "first-party",
    width: 1,
    windowed: true,
    buildSql: windowed(
      `SELECT COUNT(*) AS count FROM analytics_events WHERE event_name = 'signup' AND ${windowStartFilter(30)} AND properties::jsonb ->> 'referral_source' IS NOT NULL AND properties::jsonb ->> 'referral_source' <> '' AND properties::jsonb ->> 'referral_source' <> 'direct'`,
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
      `SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE 1.0 * COUNT(*) FILTER (WHERE properties::jsonb ->> 'referral_source' IS NOT NULL AND properties::jsonb ->> 'referral_source' <> '' AND properties::jsonb ->> 'referral_source' <> 'direct') / COUNT(*) END AS rate FROM analytics_events WHERE event_name = 'signup' AND ${windowStartFilter(30)}`,
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
      `SELECT COUNT(*) AS count FROM analytics_events WHERE event_name = 'signup' AND ${windowStartFilter(30)} AND properties::jsonb ->> 'referral_source' = 'clip_share'`,
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
      `SELECT COALESCE(NULLIF(properties::jsonb ->> 'referral_source', ''), 'direct') AS referral_source, COUNT(*) AS count FROM analytics_events WHERE event_name = 'signup' AND ${windowStartFilter(90)} GROUP BY COALESCE(NULLIF(properties::jsonb ->> 'referral_source', ''), 'direct') ORDER BY count DESC LIMIT 20`,
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
    key: "signup-entry-pages-90d",
    title: "Signup Entry Pages (90d)",
    chartType: "table",
    source: "first-party",
    width: 1,
    windowed: true,
    buildSql: windowed(
      `WITH signups AS (SELECT id AS signup_id, anonymous_id, timestamp::timestamptz AS signup_at FROM analytics_events WHERE event_name = 'signup' AND ${windowStartFilter(90)} AND anonymous_id IS NOT NULL AND anonymous_id <> ''), ranked_pageviews AS (SELECT signups.signup_id, COALESCE(NULLIF(pageviews.path, ''), '(unknown)') AS entry_path, ROW_NUMBER() OVER (PARTITION BY signups.signup_id ORDER BY pageviews.timestamp::timestamptz ASC, pageviews.id ASC) AS position FROM signups JOIN analytics_events AS pageviews ON pageviews.event_name = 'pageview' AND pageviews.anonymous_id = signups.anonymous_id AND pageviews.timestamp::timestamptz >= signups.signup_at - INTERVAL '400 days' AND pageviews.timestamp::timestamptz < signups.signup_at) SELECT entry_path, COUNT(*) AS signups FROM ranked_pageviews WHERE position = 1 GROUP BY entry_path ORDER BY signups DESC LIMIT 20`,
    ),
    config: {
      timeScope: "cohort-history",
      description:
        "First tracked pageview from the 400 days before each signup in the window, joined through the browser anonymous id. Signups without a browser identity are intentionally excluded.",
      sortable: true,
      limit: 20,
      columns: [
        { key: "entry_path", label: "First pageview" },
        { key: "signups", label: "Signups", format: "number" },
      ],
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
      `SELECT ${EVENT_DATE_SQL} AS date, COUNT(*) AS count FROM analytics_events WHERE event_name = 'signup' AND ${windowStartFilter(90)} AND properties::jsonb ->> 'referral_source' IS NOT NULL AND properties::jsonb ->> 'referral_source' <> '' AND properties::jsonb ->> 'referral_source' <> 'direct' GROUP BY ${EVENT_DATE_SQL} ORDER BY date`,
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
      `SELECT properties::jsonb ->> 'referrer_user' AS referrer_user, COUNT(*) AS signups FROM analytics_events WHERE event_name = 'signup' AND ${windowStartFilter(90)} AND properties::jsonb ->> 'referrer_user' IS NOT NULL AND properties::jsonb ->> 'referrer_user' <> '' GROUP BY properties::jsonb ->> 'referrer_user' ORDER BY signups DESC LIMIT 20`,
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
      `SELECT 'Share views' AS stage, COUNT(*) AS count FROM analytics_events WHERE event_name = 'share_view' AND ${windowStartFilter(30)} UNION ALL SELECT 'CTA clicks' AS stage, COUNT(*) AS count FROM analytics_events WHERE event_name = 'share_cta_click' AND ${windowStartFilter(30)} UNION ALL SELECT 'Clip-share signups' AS stage, COUNT(*) AS count FROM analytics_events WHERE event_name = 'signup' AND ${windowStartFilter(30)} AND properties::jsonb ->> 'referral_source' = 'clip_share'`,
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
    key: "activation-funnel",
    title: "Agent-Native Activation Funnel",
    chartType: "bar",
    source: "first-party",
    width: 3,
    windowed: false,
    buildSql: fixed(ACTIVATION_FUNNEL_SQL),
    config: {
      xKey: "stage",
      yKey: "users",
      yFormatter: "number",
      color: "var(--brand-purple)",
      description:
        "Distinct visitors through the Agent-Native funnel: signup page, signup CTA, signup, onboarding, app entry, and first significant action. Anonymous pre-signup events are joined to their signup identity when available. Use the App and Email filters to isolate a product or cohort.",
    },
  },
  {
    key: "signup-method-conversion",
    title: "Signup Method Usage & Conversion",
    chartType: "table",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(SIGNUP_METHOD_CONVERSION_SQL),
    config: {
      description:
        "Distinct signup CTA users, completed signups, and signup conversion by Google, magic link, password, or unknown method.",
      columns: [
        { key: "method", label: "Method" },
        { key: "clicks", label: "CTA users", format: "number" },
        { key: "signups", label: "Signups", format: "number" },
        { key: "conversion_rate", label: "Conversion", format: "percent" },
      ],
    },
  },
  {
    key: "onboarding-step-dropoff",
    title: "Onboarding Step Drop-off",
    chartType: "table",
    source: "first-party",
    width: 2,
    windowed: false,
    buildSql: fixed(ONBOARDING_STEP_DROPOFF_SQL),
    config: {
      xKey: "step_id",
      description:
        "Distinct people who viewed, completed, skipped, or had no recorded outcome for each first-run or checklist step. Completion and skip counts can overlap if a person retries; no outcome means neither event was recorded. This is per-step reach, not a sequential funnel. +autoz identities are excluded.",
      columns: [
        { key: "step_index", label: "Order" },
        { key: "flow", label: "Flow" },
        { key: "step_id", label: "Step" },
        { key: "users_reached", label: "Reached", format: "number" },
        { key: "users_completed", label: "Completed", format: "number" },
        { key: "users_skipped", label: "Skipped", format: "number" },
        {
          key: "users_no_recorded_outcome",
          label: "No outcome",
          format: "number",
        },
        { key: "completion_rate", label: "Completion", format: "percent" },
      ],
    },
  },
  {
    key: "onboarding-setup-choice",
    title: "First-run Setup Choices",
    chartType: "table",
    source: "first-party",
    width: 3,
    windowed: false,
    buildSql: fixed(ONBOARDING_SETUP_CHOICE_SQL),
    config: {
      description:
        "Choice-screen viewers, first selected setup path, repeat selections, and linked Builder connection outcomes. Rates use choice-screen viewers or resolved Builder outcomes as their denominator; started attempts with no outcome are unknown or abandoned, not assumed failures. Handoff failures are reported separately from Builder connection failures. A successful Builder outcome confirms credentials connected, not that a new external account was created. Account-exists is counted as a failed create-account attempt. +autoz identities are excluded.",
      columns: [
        { key: "method_label", label: "Setup choice" },
        {
          key: "choice_screen_viewers",
          label: "Choice viewers",
          format: "number",
        },
        {
          key: "first_choice_users",
          label: "First choice users",
          format: "number",
        },
        {
          key: "first_choice_rate",
          label: "First choice rate",
          format: "percent",
        },
        { key: "selected_users", label: "Ever selected", format: "number" },
        { key: "method_clicks", label: "Selections", format: "number" },
        {
          key: "connection_success_users",
          label: "Connected users",
          format: "number",
        },
        {
          key: "connection_failure_users",
          label: "Failed users",
          format: "number",
        },
        {
          key: "connection_success_attempts",
          label: "Connected attempts",
          format: "number",
        },
        {
          key: "connection_failure_attempts",
          label: "Failed attempts",
          format: "number",
        },
        {
          key: "handoff_failure_attempts",
          label: "Handoff failures",
          format: "number",
        },
        {
          key: "connection_no_outcome_attempts",
          label: "No outcome",
          format: "number",
        },
        {
          key: "connection_success_rate",
          label: "Resolved success rate",
          format: "percent",
        },
        {
          key: "settings_handoff_attempts",
          label: "Settings handoffs",
          format: "number",
        },
      ],
    },
  },
  {
    key: "sharing-actions-by-app",
    title: "Sharing Actions by App",
    chartType: "table",
    source: "first-party",
    width: 3,
    windowed: false,
    buildSql: fixed(SHARING_ACTIONS_BY_APP_SQL),
    config: {
      description:
        "Sharing views, CTA clicks, invitations, public visibility changes, and copied links by Agent-Native app. Counts users as well as events.",
      columns: [
        { key: "app", label: "App" },
        { key: "action", label: "Action" },
        { key: "events", label: "Events", format: "number" },
        { key: "users", label: "Users", format: "number" },
      ],
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
      `SELECT COALESCE(COUNT(*) FILTER (WHERE recent.auth_user_id IN (SELECT properties::jsonb ->> 'referrer_user' FROM analytics_events WHERE event_name = 'signup' AND properties::jsonb ->> 'referrer_user' IS NOT NULL AND properties::jsonb ->> 'referrer_user' <> ''))::float / NULLIF(COUNT(*), 0), 0) AS rate FROM (SELECT DISTINCT properties::jsonb ->> 'auth_user_id' AS auth_user_id FROM analytics_events WHERE event_name = 'signup' AND ${windowStartFilter(90)} AND properties::jsonb ->> 'auth_user_id' IS NOT NULL AND properties::jsonb ->> 'auth_user_id' <> '') AS recent`,
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
      `SELECT COALESCE(COUNT(*) FILTER (WHERE properties::jsonb ->> 'referrer_user' IS NOT NULL AND properties::jsonb ->> 'referrer_user' <> '')::float / NULLIF(COUNT(DISTINCT properties::jsonb ->> 'auth_user_id'), 0), 0) AS k FROM analytics_events WHERE event_name = 'signup' AND ${windowStartFilter(90)}`,
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
      `SELECT COUNT(DISTINCT properties::jsonb ->> 'referrer_user') AS count FROM analytics_events WHERE event_name = 'signup' AND ${windowStartFilter(90)} AND properties::jsonb ->> 'referrer_user' IS NOT NULL AND properties::jsonb ->> 'referrer_user' <> ''`,
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

export function listMetricKeys(): string[] {
  return ENTRIES.map((entry) => entry.key);
}

export function listMetrics(): FirstPartyMetric[] {
  return [...ENTRIES];
}

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
  id?: string;
  title?: string;
  chartType?: string;
  width?: number;
  window?: MetricWindow;
}

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
  const title =
    overrides.title?.trim() ||
    (window === "all"
      ? metric.title.replace(/\(\d+d\)$/i, "(all-time)")
      : metric.title);
  const config = { ...metric.config };
  if (metric.windowed) {
    if (window === "all") {
      config.timeScope = "all-time";
      const description =
        typeof config.description === "string" ? config.description.trim() : "";
      config.description = `${description ? `${description} ` : ""}This panel is explicitly configured for an all-time window.`;
    } else if (config.timeScope === undefined) {
      config.timeScope = "fixed-window";
    }
  }
  const sql = scopeFirstPartyPanelSql(metric.buildSql(window));
  return {
    id: overrides.id?.trim() || metric.key,
    title,
    chartType: overrides.chartType?.trim() || metric.chartType,
    source: "first-party",
    width,
    sql,
    config,
  };
}
