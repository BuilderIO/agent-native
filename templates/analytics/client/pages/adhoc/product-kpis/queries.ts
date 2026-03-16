import type { DateCadence } from "./types";

const PRODUCT_SIGNUPS = "`your-gcp-project-id.dbt_analytics.product_signups`";
const ACTIVE_USERS = "`your-gcp-project-id.dbt_analytics.active_users`";
const DAILY_ARR =
  "`your-gcp-project-id.dbt_analytics.daily_arr_by_subscriptions`";
const RETENTION =
  "`your-gcp-project-id.dbt_mart.fact_account_active_retention`";

function cadenceToTrunc(cadence: DateCadence): string {
  switch (cadence) {
    case "Daily":
      return "DAY";
    case "Weekly":
      return "WEEK";
    case "Monthly":
      return "MONTH";
    case "Quarterly":
      return "QUARTER";
  }
}

// ─── Signup → Paid Conversion ──────────────────────────────────────────

export function signupToPaidQuery(
  cadence: DateCadence,
  dateStart: string,
  dateEnd: string,
): string {
  const trunc = cadenceToTrunc(cadence);
  return `SELECT
  DATE_TRUNC(DATE(user_create_d), ${trunc}) AS period,
  COUNT(DISTINCT user_id) AS total_signups,
  COUNT(DISTINCT CASE
    WHEN top_subscription NOT IN ('free', '') AND top_subscription IS NOT NULL
    THEN user_id END) AS paid_signups,
  SAFE_DIVIDE(
    COUNT(DISTINCT CASE
      WHEN top_subscription NOT IN ('free', '') AND top_subscription IS NOT NULL
      THEN user_id END),
    COUNT(DISTINCT user_id)
  ) AS conversion_rate
FROM ${PRODUCT_SIGNUPS}
WHERE DATE(user_create_d) BETWEEN '${dateStart}' AND '${dateEnd}'
  AND DATE(user_create_d) < '2027-01-01'
GROUP BY period
ORDER BY period`;
}

export function signupToPaidByPlanQuery(
  cadence: DateCadence,
  dateStart: string,
  dateEnd: string,
): string {
  const trunc = cadenceToTrunc(cadence);
  return `SELECT
  DATE_TRUNC(DATE(user_create_d), ${trunc}) AS period,
  IFNULL(top_subscription, 'none') AS plan,
  COUNT(DISTINCT user_id) AS users
FROM ${PRODUCT_SIGNUPS}
WHERE DATE(user_create_d) BETWEEN '${dateStart}' AND '${dateEnd}'
  AND DATE(user_create_d) < '2027-01-01'
  AND top_subscription IS NOT NULL
  AND top_subscription != ''
GROUP BY period, plan
ORDER BY period`;
}

// ─── Weekly Active Users ───────────────────────────────────────────────

export function wauQuery(
  cadence: DateCadence,
  dateStart: string,
  dateEnd: string,
): string {
  const trunc = cadenceToTrunc(cadence);
  return `SELECT
  DATE_TRUNC(DATE(event_date), ${trunc}) AS period,
  COUNT(DISTINCT active_user) AS active_users
FROM ${ACTIVE_USERS}
WHERE DATE(event_date) BETWEEN '${dateStart}' AND '${dateEnd}'
  AND DATE(event_date) < '2027-01-01'
GROUP BY period
ORDER BY period`;
}

export function wauByEventTypeQuery(
  cadence: DateCadence,
  dateStart: string,
  dateEnd: string,
): string {
  const trunc = cadenceToTrunc(cadence);
  return `SELECT
  DATE_TRUNC(DATE(event_date), ${trunc}) AS period,
  event_type,
  COUNT(DISTINCT active_user) AS active_users
FROM ${ACTIVE_USERS}
WHERE DATE(event_date) BETWEEN '${dateStart}' AND '${dateEnd}'
  AND DATE(event_date) < '2027-01-01'
GROUP BY period, event_type
ORDER BY period`;
}

// ─── Average Revenue Per Account (ARPA) ────────────────────────────────

export function arpaQuery(
  cadence: DateCadence,
  dateStart: string,
  dateEnd: string,
  planFilter: string,
): string {
  const trunc = cadenceToTrunc(cadence);
  const planClause =
    planFilter === "all"
      ? ""
      : planFilter === "self-serve"
        ? "AND LOWER(plan) = 'self service'"
        : `AND LOWER(plan) = '${planFilter.toLowerCase()}'`;

  return `SELECT
  DATE_TRUNC(date, ${trunc}) AS period,
  SAFE_DIVIDE(SUM(arr), COUNT(DISTINCT subscription_id)) AS arpa,
  SUM(arr) AS total_arr,
  COUNT(DISTINCT subscription_id) AS active_subs
FROM ${DAILY_ARR}
WHERE date BETWEEN '${dateStart}' AND '${dateEnd}'
  AND date < '2027-01-01'
  AND arr > 0
  ${planClause}
GROUP BY period
ORDER BY period`;
}

// ─── 30-Day Retention ──────────────────────────────────────────────────

export function retentionCohortQuery(minCohortDate: string): string {
  return `SELECT
  first_publish_week,
  weeks_since_first_publish,
  active_accounts
FROM ${RETENTION}
WHERE first_publish_week >= '${minCohortDate}'
ORDER BY first_publish_week, weeks_since_first_publish`;
}

// Simplified retention: week-0 vs week-4 retention rate by cohort
// Note: fact_account_active_retention only has data from 2023-01-01 to 2023-12-17
export function retentionSummaryQuery(
  _dateStart: string,
  _dateEnd: string,
): string {
  return `WITH cohorts AS (
  SELECT
    first_publish_week,
    MAX(CASE WHEN weeks_since_first_publish = 0 THEN active_accounts END) AS week0,
    MAX(CASE WHEN weeks_since_first_publish = 4 THEN active_accounts END) AS week4,
    MAX(CASE WHEN weeks_since_first_publish = 8 THEN active_accounts END) AS week8,
    MAX(CASE WHEN weeks_since_first_publish = 12 THEN active_accounts END) AS week12
  FROM ${RETENTION}
  GROUP BY first_publish_week
)
SELECT
  first_publish_week AS period,
  week0 AS initial_accounts,
  SAFE_DIVIDE(week4, week0) AS retention_4w,
  SAFE_DIVIDE(week8, week0) AS retention_8w,
  SAFE_DIVIDE(week12, week0) AS retention_12w
FROM cohorts
WHERE week0 > 0
ORDER BY period`;
}

// Signup-based retention using product_signups + active_users
// Excludes cohorts less than 30 days old since they haven't had enough time
// to show meaningful retention.
export function signupRetentionQuery(
  cadence: DateCadence,
  dateStart: string,
  dateEnd: string,
): string {
  const trunc = cadenceToTrunc(cadence);
  return `WITH signup_cohort AS (
  SELECT
    DATE_TRUNC(DATE(user_create_d), ${trunc}) AS cohort,
    user_id
  FROM ${PRODUCT_SIGNUPS}
  WHERE DATE(user_create_d) BETWEEN '${dateStart}' AND '${dateEnd}'
    AND DATE(user_create_d) < '2027-01-01'
    AND DATE(user_create_d) < DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
),
active AS (
  SELECT
    DATE_TRUNC(DATE(event_date), ${trunc}) AS active_period,
    active_user
  FROM ${ACTIVE_USERS}
  WHERE DATE(event_date) BETWEEN '${dateStart}' AND DATE_ADD('${dateEnd}', INTERVAL 90 DAY)
    AND DATE(event_date) < '2027-01-01'
)
SELECT
  sc.cohort AS period,
  COUNT(DISTINCT sc.user_id) AS cohort_size,
  COUNT(DISTINCT CASE
    WHEN a.active_period > sc.cohort
    THEN sc.user_id END) AS returned_users,
  SAFE_DIVIDE(
    COUNT(DISTINCT CASE WHEN a.active_period > sc.cohort THEN sc.user_id END),
    COUNT(DISTINCT sc.user_id)
  ) AS retention_rate
FROM signup_cohort sc
LEFT JOIN active a ON sc.user_id = a.active_user
GROUP BY period
ORDER BY period`;
}
