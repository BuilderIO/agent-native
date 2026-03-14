/**
 * BigQuery SQL queries for traffic to signup conversion analysis
 */

export function getOverallTrendQuery(months: number = 6): string {
  return `
WITH visitor_cohorts AS (
  SELECT
    DATE_TRUNC(DATE(created_date), WEEK) AS visit_week,
    visitor_id
  FROM \`builder-3b0a2.dbt_staging_bigquery.all_pageviews\`
  WHERE DATE(created_date) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL ${months} MONTH) AND CURRENT_DATE()
    AND created_date <= CURRENT_TIMESTAMP()
    AND visitor_id IS NOT NULL
  GROUP BY visit_week, visitor_id
),
signup_cohorts AS (
  SELECT
    DATE_TRUNC(DATE(user_create_d), WEEK) AS signup_week,
    user_id
  FROM \`builder-3b0a2.dbt_analytics.product_signups\`
  WHERE DATE(user_create_d) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL ${months} MONTH) AND CURRENT_DATE()
    AND user_create_d <= CURRENT_TIMESTAMP()
  GROUP BY signup_week, user_id
),
cohorted_conversion AS (
  SELECT
    v.visit_week AS week,
    COUNT(DISTINCT v.visitor_id) AS unique_visitors,
    COUNT(DISTINCT s.user_id) AS total_signups,
    SAFE_DIVIDE(COUNT(DISTINCT s.user_id), COUNT(DISTINCT v.visitor_id)) AS conversion_rate
  FROM visitor_cohorts v
  LEFT JOIN signup_cohorts s
    ON v.visitor_id = s.user_id
    AND v.visit_week = s.signup_week
  GROUP BY v.visit_week
)
SELECT
  week,
  unique_visitors,
  total_signups,
  ROUND(conversion_rate * 100, 2) AS conversion_rate_pct,
  LAG(conversion_rate) OVER (ORDER BY week) AS prev_week_conversion,
  ROUND((conversion_rate - LAG(conversion_rate) OVER (ORDER BY week)) * 100, 2) AS wow_change_pct
FROM cohorted_conversion
ORDER BY week DESC
  `;
}

export function getSourceBreakdownQuery(weeksRecent: number = 4, weeksBaseline: number = 4): string {
  return `
WITH visitors_by_source AS (
  SELECT
    DATE_TRUNC(DATE(created_date), WEEK) AS week,
    COALESCE(first_touch_channel, 'Unknown') AS channel,
    COUNT(DISTINCT visitor_id) AS unique_visitors
  FROM \`builder-3b0a2.dbt_staging_bigquery.all_pageviews\`
  WHERE DATE(created_date) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent + weeksBaseline} WEEK) AND CURRENT_DATE()
    AND created_date <= CURRENT_TIMESTAMP()
  GROUP BY week, channel
),
signups_by_source AS (
  SELECT
    DATE_TRUNC(DATE(user_create_d), WEEK) AS week,
    COALESCE(channel, 'Unknown') AS channel,
    COUNT(DISTINCT user_id) AS total_signups
  FROM \`builder-3b0a2.dbt_analytics.product_signups\`
  WHERE DATE(user_create_d) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent + weeksBaseline} WEEK) AND CURRENT_DATE()
    AND user_create_d <= CURRENT_TIMESTAMP()
  GROUP BY week, channel
),
combined AS (
  SELECT
    v.week,
    v.channel,
    v.unique_visitors,
    IFNULL(s.total_signups, 0) AS total_signups,
    SAFE_DIVIDE(IFNULL(s.total_signups, 0), v.unique_visitors) AS conversion_rate
  FROM visitors_by_source v
  LEFT JOIN signups_by_source s 
    ON v.week = s.week AND v.channel = s.channel
),
recent_vs_baseline AS (
  SELECT
    channel,
    SUM(CASE WHEN week >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent} WEEK), WEEK) 
        THEN unique_visitors ELSE 0 END) AS recent_visitors,
    SUM(CASE WHEN week >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent} WEEK), WEEK) 
        THEN total_signups ELSE 0 END) AS recent_signups,
    SAFE_DIVIDE(
      SUM(CASE WHEN week >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent} WEEK), WEEK) 
          THEN total_signups ELSE 0 END),
      SUM(CASE WHEN week >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent} WEEK), WEEK) 
          THEN unique_visitors ELSE 0 END)
    ) AS recent_conversion_rate,
    SUM(CASE 
        WHEN week >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent + weeksBaseline} WEEK), WEEK)
        AND week < DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent} WEEK), WEEK)
        THEN unique_visitors ELSE 0 END) AS baseline_visitors,
    SUM(CASE 
        WHEN week >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent + weeksBaseline} WEEK), WEEK)
        AND week < DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent} WEEK), WEEK)
        THEN total_signups ELSE 0 END) AS baseline_signups,
    SAFE_DIVIDE(
      SUM(CASE 
          WHEN week >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent + weeksBaseline} WEEK), WEEK)
          AND week < DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent} WEEK), WEEK)
          THEN total_signups ELSE 0 END),
      SUM(CASE 
          WHEN week >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent + weeksBaseline} WEEK), WEEK)
          AND week < DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent} WEEK), WEEK)
          THEN unique_visitors ELSE 0 END)
    ) AS baseline_conversion_rate
  FROM combined
  GROUP BY channel
)
SELECT
  channel,
  recent_visitors,
  recent_signups,
  ROUND(recent_conversion_rate * 100, 2) AS recent_conv_rate_pct,
  baseline_visitors,
  baseline_signups,
  ROUND(baseline_conversion_rate * 100, 2) AS baseline_conv_rate_pct,
  ROUND((recent_conversion_rate - baseline_conversion_rate) * 100, 2) AS conv_rate_change_pct,
  ROUND(SAFE_DIVIDE(
    recent_conversion_rate - baseline_conversion_rate,
    baseline_conversion_rate
  ) * 100, 1) AS pct_change
FROM recent_vs_baseline
WHERE recent_visitors > 100 OR baseline_visitors > 100
ORDER BY recent_visitors DESC
  `;
}

export function getLandingPageQuery(weeksRecent: number = 4, weeksBaseline: number = 4): string {
  return `
WITH first_pageviews AS (
  SELECT
    visitor_id,
    DATE_TRUNC(DATE(created_date), WEEK) AS week,
    COALESCE(page_type, 'Unknown') AS landing_page_type
  FROM (
    SELECT
      visitor_id,
      created_date,
      page_type,
      ROW_NUMBER() OVER (PARTITION BY visitor_id ORDER BY created_date ASC) AS rn
    FROM \`builder-3b0a2.dbt_staging_bigquery.all_pageviews\`
    WHERE DATE(created_date) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent + weeksBaseline} WEEK) AND CURRENT_DATE()
      AND created_date <= CURRENT_TIMESTAMP()
  )
  WHERE rn = 1
),
visitors_by_landing AS (
  SELECT
    week,
    landing_page_type,
    COUNT(DISTINCT visitor_id) AS unique_visitors
  FROM first_pageviews
  GROUP BY week, landing_page_type
),
signups_by_landing AS (
  SELECT
    DATE_TRUNC(DATE(s.user_create_d), WEEK) AS week,
    fp.landing_page_type,
    COUNT(DISTINCT s.user_id) AS total_signups
  FROM \`builder-3b0a2.dbt_analytics.product_signups\` s
  INNER JOIN first_pageviews fp ON s.user_id = fp.visitor_id
  WHERE DATE(s.user_create_d) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent + weeksBaseline} WEEK) AND CURRENT_DATE()
    AND s.user_create_d <= CURRENT_TIMESTAMP()
  GROUP BY week, landing_page_type
),
combined AS (
  SELECT
    v.week,
    v.landing_page_type,
    v.unique_visitors,
    IFNULL(s.total_signups, 0) AS total_signups,
    SAFE_DIVIDE(IFNULL(s.total_signups, 0), v.unique_visitors) AS conversion_rate
  FROM visitors_by_landing v
  LEFT JOIN signups_by_landing s 
    ON v.week = s.week AND v.landing_page_type = s.landing_page_type
),
recent_vs_baseline AS (
  SELECT
    landing_page_type,
    SUM(CASE WHEN week >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent} WEEK), WEEK) 
        THEN unique_visitors ELSE 0 END) AS recent_visitors,
    SUM(CASE WHEN week >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent} WEEK), WEEK) 
        THEN total_signups ELSE 0 END) AS recent_signups,
    SAFE_DIVIDE(
      SUM(CASE WHEN week >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent} WEEK), WEEK) 
          THEN total_signups ELSE 0 END),
      SUM(CASE WHEN week >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent} WEEK), WEEK) 
          THEN unique_visitors ELSE 0 END)
    ) AS recent_conversion_rate,
    SUM(CASE 
        WHEN week >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent + weeksBaseline} WEEK), WEEK)
        AND week < DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent} WEEK), WEEK)
        THEN unique_visitors ELSE 0 END) AS baseline_visitors,
    SUM(CASE 
        WHEN week >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent + weeksBaseline} WEEK), WEEK)
        AND week < DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent} WEEK), WEEK)
        THEN total_signups ELSE 0 END) AS baseline_signups,
    SAFE_DIVIDE(
      SUM(CASE 
          WHEN week >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent + weeksBaseline} WEEK), WEEK)
          AND week < DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent} WEEK), WEEK)
          THEN total_signups ELSE 0 END),
      SUM(CASE 
          WHEN week >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent + weeksBaseline} WEEK), WEEK)
          AND week < DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent} WEEK), WEEK)
          THEN unique_visitors ELSE 0 END)
    ) AS baseline_conversion_rate
  FROM combined
  GROUP BY landing_page_type
)
SELECT
  landing_page_type,
  recent_visitors,
  recent_signups,
  ROUND(recent_conversion_rate * 100, 2) AS recent_conv_rate_pct,
  baseline_visitors,
  baseline_signups,
  ROUND(baseline_conversion_rate * 100, 2) AS baseline_conv_rate_pct,
  ROUND((recent_conversion_rate - baseline_conversion_rate) * 100, 2) AS conv_rate_change_pct,
  ROUND(SAFE_DIVIDE(
    recent_conversion_rate - baseline_conversion_rate,
    baseline_conversion_rate
  ) * 100, 1) AS pct_change,
  ROUND(SAFE_DIVIDE(
    recent_visitors,
    SUM(recent_visitors) OVER ()
  ) * 100, 1) AS recent_traffic_share_pct
FROM recent_vs_baseline
WHERE recent_visitors > 50 OR baseline_visitors > 50
ORDER BY recent_visitors DESC
  `;
}

export function getSimpleFunnelQuery(weeksRecent: number = 4, weeksBaseline: number = 4): string {
  return `
WITH time_periods AS (
  SELECT
    'Recent (Last ${weeksRecent} Weeks)' AS period,
    DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent} WEEK) AS start_date,
    CURRENT_DATE() AS end_date
  UNION ALL
  SELECT
    'Baseline (Weeks ${weeksRecent + 1}-${weeksRecent + weeksBaseline} Ago)' AS period,
    DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent + weeksBaseline} WEEK) AS start_date,
    DATE_SUB(CURRENT_DATE(), INTERVAL ${weeksRecent} WEEK) AS end_date
),
simple_funnel AS (
  SELECT
    tp.period,
    COUNT(DISTINCT pv.visitor_id) AS total_visitors,
    COUNT(DISTINCT CASE WHEN pv.page_type = 'signup' THEN pv.visitor_id END) AS visited_signup_page,
    COUNT(DISTINCT CASE WHEN pv.page_type IN ('signup', 'pricing') THEN pv.visitor_id END) AS visited_intent_page,
    COUNT(DISTINCT ps.user_id) AS completed_signups
  FROM time_periods tp
  CROSS JOIN \`builder-3b0a2.dbt_staging_bigquery.all_pageviews\` pv
  LEFT JOIN \`builder-3b0a2.dbt_analytics.product_signups\` ps
    ON pv.visitor_id = ps.user_id
    AND DATE(ps.user_create_d) BETWEEN tp.start_date AND tp.end_date
  WHERE DATE(pv.created_date) BETWEEN tp.start_date AND tp.end_date
    AND pv.created_date <= CURRENT_TIMESTAMP()
  GROUP BY tp.period
)
SELECT
  period,
  total_visitors,
  visited_intent_page,
  ROUND(SAFE_DIVIDE(visited_intent_page, total_visitors) * 100, 1) AS intent_page_visit_rate,
  visited_signup_page,
  ROUND(SAFE_DIVIDE(visited_signup_page, total_visitors) * 100, 1) AS signup_page_visit_rate,
  completed_signups,
  ROUND(SAFE_DIVIDE(completed_signups, visited_signup_page) * 100, 1) AS signup_completion_rate,
  ROUND(SAFE_DIVIDE(completed_signups, total_visitors) * 100, 2) AS overall_conversion_rate
FROM simple_funnel
ORDER BY 
  CASE period 
    WHEN 'Recent (Last ${weeksRecent} Weeks)' THEN 1 
    ELSE 2 
  END
  `;
}

export function getDataQualityQuery(months: number = 6): string {
  return `
WITH tracking_quality AS (
  SELECT
    DATE_TRUNC(DATE(created_date), WEEK) AS week,
    COUNT(*) AS total_pageviews,
    COUNT(DISTINCT visitor_id) AS unique_visitors,
    COUNTIF(visitor_id IS NULL) AS null_visitor_id,
    COUNTIF(session_id IS NULL) AS null_session_id,
    COUNTIF(first_touch_channel IS NULL) AS null_channel,
    ROUND(SAFE_DIVIDE(COUNTIF(visitor_id IS NULL), COUNT(*)) * 100, 2) AS null_visitor_pct,
    ROUND(SAFE_DIVIDE(COUNTIF(session_id IS NULL), COUNT(*)) * 100, 2) AS null_session_pct,
    ROUND(SAFE_DIVIDE(COUNTIF(first_touch_channel IS NULL), COUNT(*)) * 100, 2) AS null_channel_pct
  FROM \`builder-3b0a2.dbt_staging_bigquery.all_pageviews\`
  WHERE DATE(created_date) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL ${months} MONTH) AND CURRENT_DATE()
    AND created_date <= CURRENT_TIMESTAMP()
  GROUP BY week
)
SELECT
  week,
  total_pageviews,
  unique_visitors,
  null_visitor_pct,
  null_session_pct,
  null_channel_pct,
  CASE 
    WHEN null_visitor_pct > 5 OR null_session_pct > 5 THEN 'Warning'
    ELSE 'OK'
  END AS quality_flag
FROM tracking_quality
ORDER BY week DESC
LIMIT 12
  `;
}
