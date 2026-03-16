import type { DateCadence } from "../product-kpis/types";

// ─── BigQuery table references ─────────────────────────────────────────
const REVENUE_FUNNEL = "`your-gcp-project-id.dbt_analytics.revenue_funnel`";
const HS_DEALS = "`your-gcp-project-id.dbt_mart.dim_hs_deals`";
const HS_CONTACTS = "`your-gcp-project-id.dbt_mart.dim_hs_contacts`";
const ARR_TRACKER = "`your-gcp-project-id.dbt_mart.dim_arr_revenue_tracker`";
const DAILY_ARR = "`your-gcp-project-id.dbt_analytics.daily_arr_by_subscriptions`";
const PRODUCT_SIGNUPS = "`your-gcp-project-id.dbt_analytics.product_signups`";
const ACTIVE_USERS = "`your-gcp-project-id.dbt_analytics.active_users`";

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

// ═══════════════════════════════════════════════════════════════════════
// TOFU & Pipeline
// ═══════════════════════════════════════════════════════════════════════

/** QLs over time from revenue_funnel (aggregates across all motions) */
export function qlsQuery(
  cadence: DateCadence,
  dateStart: string,
  dateEnd: string,
): string {
  const trunc = cadenceToTrunc(cadence);
  return `SELECT
  DATE_TRUNC(date, ${trunc}) AS period,
  SUM(IFNULL(num_qls, 0)) AS qls,
  SUM(IFNULL(num_sals, 0)) AS sals
FROM ${REVENUE_FUNNEL}
WHERE date BETWEEN '${dateStart}' AND '${dateEnd}'
GROUP BY period
ORDER BY period`;
}

/** S1s — contacts entering S1 stage, from dim_hs_contacts lifecycle dates */
export function s1sQuery(
  cadence: DateCadence,
  dateStart: string,
  dateEnd: string,
): string {
  const trunc = cadenceToTrunc(cadence);
  return `SELECT
  DATE_TRUNC(DATE(date_entered_s1), ${trunc}) AS period,
  COUNT(DISTINCT contact_id) AS s1s
FROM ${HS_CONTACTS}
WHERE DATE(date_entered_s1) BETWEEN '${dateStart}' AND '${dateEnd}'
GROUP BY period
ORDER BY period`;
}

/** S1s from Named (Target) Accounts — deals at S1+ stage with target_account_flag */
export function s1sNamedAccountsQuery(
  cadence: DateCadence,
  dateStart: string,
  dateEnd: string,
): string {
  const trunc = cadenceToTrunc(cadence);
  return `SELECT
  DATE_TRUNC(DATE(date_moved_from_s0), ${trunc}) AS period,
  COUNT(DISTINCT deal_id) AS s1s_named
FROM ${HS_DEALS}
WHERE target_account_flag = true
  AND stage_name LIKE 'S1%'
  AND DATE(date_moved_from_s0) BETWEEN '${dateStart}' AND '${dateEnd}'
GROUP BY period
ORDER BY period`;
}

// ═══════════════════════════════════════════════════════════════════════
// Sales Productivity
// ═══════════════════════════════════════════════════════════════════════

/** Landing ACV — average deal size for closed-won deals */
export function landingAcvQuery(
  cadence: DateCadence,
  dateStart: string,
  dateEnd: string,
): string {
  const trunc = cadenceToTrunc(cadence);
  return `SELECT
  DATE_TRUNC(DATE(close_date), ${trunc}) AS period,
  COUNT(*) AS won_deals,
  AVG(CAST(amount AS FLOAT64)) AS avg_acv,
  SUM(CAST(amount AS FLOAT64)) AS total_acv
FROM ${HS_DEALS}
WHERE is_closed_won = true
  AND DATE(close_date) BETWEEN '${dateStart}' AND '${dateEnd}'
GROUP BY period
ORDER BY period`;
}

/** POV Win Rate — % of deals that entered S2 POV and eventually closed won */
export function povWinRateQuery(
  cadence: DateCadence,
  dateStart: string,
  dateEnd: string,
): string {
  const trunc = cadenceToTrunc(cadence);
  return `SELECT
  DATE_TRUNC(DATE(s2_date_entered_pst), ${trunc}) AS period,
  COUNT(*) AS total_pov_deals,
  COUNT(CASE WHEN is_closed_won THEN 1 END) AS won_deals,
  SAFE_DIVIDE(
    COUNT(CASE WHEN is_closed_won THEN 1 END),
    COUNT(*)
  ) AS pov_win_rate
FROM ${HS_DEALS}
WHERE s2_date_entered_pst IS NOT NULL
  AND DATE(s2_date_entered_pst) BETWEEN '${dateStart}' AND '${dateEnd}'
GROUP BY period
ORDER BY period`;
}

/** Hired AE Capacity — distinct sales reps active on deals per period */
export function aeCapacityQuery(
  cadence: DateCadence,
  dateStart: string,
  dateEnd: string,
): string {
  const trunc = cadenceToTrunc(cadence);
  return `SELECT
  DATE_TRUNC(date_moved_from_s0, ${trunc}) AS period,
  COUNT(DISTINCT sales_rep_owner_name) AS ae_count
FROM ${HS_DEALS}
WHERE date_moved_from_s0 IS NOT NULL
  AND DATE(date_moved_from_s0) BETWEEN '${dateStart}' AND '${dateEnd}'
  AND sales_rep_owner_name IS NOT NULL
GROUP BY period
ORDER BY period`;
}

// ═══════════════════════════════════════════════════════════════════════
// Expansion
// ═══════════════════════════════════════════════════════════════════════

/** Expansion Pipeline — sum of deal amounts in Enterprise: Expansion pipeline */
export function expansionPipelineQuery(
  cadence: DateCadence,
  dateStart: string,
  dateEnd: string,
): string {
  const trunc = cadenceToTrunc(cadence);
  return `SELECT
  DATE_TRUNC(DATE(createdate), ${trunc}) AS period,
  COUNT(*) AS expansion_deals,
  SUM(CAST(amount AS FLOAT64)) AS expansion_pipeline
FROM ${HS_DEALS}
WHERE pipeline_name IN ('Enterprise: Expansion', 'Self-Serve: Expansion')
  AND DATE(createdate) BETWEEN '${dateStart}' AND '${dateEnd}'
  AND NOT is_deal_closed
GROUP BY period
ORDER BY period`;
}

/** 90-day NDR — net dollar retention using ARR tracker events (enterprise) */
export function ndrQuery(
  cadence: DateCadence,
  dateStart: string,
  dateEnd: string,
): string {
  const trunc = cadenceToTrunc(cadence);
  return `SELECT
  DATE_TRUNC(DATE(event_date), ${trunc}) AS period,
  SUM(CASE WHEN arr_change > 0 THEN arr_change ELSE 0 END) AS expansion_arr,
  SUM(CASE WHEN arr_change < 0 THEN arr_change ELSE 0 END) AS contraction_arr,
  SUM(arr_change) AS net_arr_change,
  SAFE_DIVIDE(
    SUM(CASE WHEN arr_change >= 0 THEN current_arr ELSE current_arr - arr_change END),
    SUM(CASE WHEN arr_change >= 0 THEN current_arr - arr_change ELSE current_arr END)
  ) AS ndr
FROM ${ARR_TRACKER}
WHERE DATE(event_date) BETWEEN '${dateStart}' AND '${dateEnd}'
  AND plan = 'Enterprise'
GROUP BY period
ORDER BY period`;
}

/** Contracted Seat Utilization — active users / contracted seats per enterprise org.
 *  Uses subscription seat count vs active user count. */
export function seatUtilizationQuery(
  cadence: DateCadence,
  dateStart: string,
  dateEnd: string,
): string {
  const trunc = cadenceToTrunc(cadence);
  return `SELECT
  DATE_TRUNC(date, ${trunc}) AS period,
  COUNT(DISTINCT subscription_id) AS active_subscriptions,
  SUM(arr) AS total_arr
FROM ${DAILY_ARR}
WHERE date BETWEEN '${dateStart}' AND '${dateEnd}'
  AND LOWER(plan) = 'enterprise'
  AND arr > 0
GROUP BY period
ORDER BY period`;
}

// ═══════════════════════════════════════════════════════════════════════
// Self-Serve (reuse from product-kpis via inline queries)
// ═══════════════════════════════════════════════════════════════════════

export function selfServeConversionQuery(
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

export function selfServeRetentionQuery(
  cadence: DateCadence,
  dateStart: string,
  dateEnd: string,
): string {
  const trunc = cadenceToTrunc(cadence);
  return `WITH signup_cohort AS (
  SELECT DATE_TRUNC(DATE(user_create_d), ${trunc}) AS cohort, user_id
  FROM ${PRODUCT_SIGNUPS}
  WHERE DATE(user_create_d) BETWEEN '${dateStart}' AND '${dateEnd}'
    AND DATE(user_create_d) < '2027-01-01'
    AND DATE(user_create_d) < DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
),
active AS (
  SELECT DATE_TRUNC(DATE(event_date), ${trunc}) AS active_period, active_user
  FROM ${ACTIVE_USERS}
  WHERE DATE(event_date) BETWEEN '${dateStart}' AND DATE_ADD('${dateEnd}', INTERVAL 90 DAY)
    AND DATE(event_date) < '2027-01-01'
)
SELECT
  sc.cohort AS period,
  COUNT(DISTINCT sc.user_id) AS cohort_size,
  SAFE_DIVIDE(
    COUNT(DISTINCT CASE WHEN a.active_period > sc.cohort THEN sc.user_id END),
    COUNT(DISTINCT sc.user_id)
  ) AS retention_rate
FROM signup_cohort sc
LEFT JOIN active a ON sc.user_id = a.active_user
GROUP BY period
ORDER BY period`;
}

export function selfServeWauQuery(
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

export function selfServeArpaQuery(
  cadence: DateCadence,
  dateStart: string,
  dateEnd: string,
): string {
  const trunc = cadenceToTrunc(cadence);
  return `SELECT
  DATE_TRUNC(date, ${trunc}) AS period,
  SAFE_DIVIDE(SUM(arr), COUNT(DISTINCT subscription_id)) AS arpa,
  SUM(arr) AS total_arr,
  COUNT(DISTINCT subscription_id) AS active_subs
FROM ${DAILY_ARR}
WHERE date BETWEEN '${dateStart}' AND '${dateEnd}'
  AND date < '2027-01-01'
  AND arr > 0
  AND LOWER(plan) = 'self service'
GROUP BY period
ORDER BY period`;
}
