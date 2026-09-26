

WITH first_pageviews AS (
  SELECT
    visitor_id,
    DATE_TRUNC(DATE(created_date), WEEK) AS week,
    COALESCE(page_type, 'Unknown') AS landing_page_type,
    COALESCE(sub_page_type, 'N/A') AS landing_sub_page_type
  FROM (
    SELECT
      visitor_id,
      created_date,
      page_type,
      sub_page_type,
      ROW_NUMBER() OVER (PARTITION BY visitor_id ORDER BY created_date ASC) AS rn
    FROM `@project.analytics.pageviews`
    WHERE DATE(created_date) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH) AND CURRENT_DATE()
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
  FROM `@project.analytics.signups` s
  INNER JOIN first_pageviews fp ON s.user_id = fp.visitor_id
  WHERE DATE(s.user_create_d) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH) AND CURRENT_DATE()
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

    SUM(CASE WHEN week >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 4 WEEK), WEEK)
        THEN unique_visitors ELSE 0 END) AS recent_visitors,
    SUM(CASE WHEN week >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 4 WEEK), WEEK)
        THEN total_signups ELSE 0 END) AS recent_signups,
    SAFE_DIVIDE(
      SUM(CASE WHEN week >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 4 WEEK), WEEK)
          THEN total_signups ELSE 0 END),
      SUM(CASE WHEN week >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 4 WEEK), WEEK)
          THEN unique_visitors ELSE 0 END)
    ) AS recent_conversion_rate,

    SUM(CASE
        WHEN week >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 8 WEEK), WEEK)
        AND week < DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 4 WEEK), WEEK)
        THEN unique_visitors ELSE 0 END) AS baseline_visitors,
    SUM(CASE
        WHEN week >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 8 WEEK), WEEK)
        AND week < DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 4 WEEK), WEEK)
        THEN total_signups ELSE 0 END) AS baseline_signups,
    SAFE_DIVIDE(
      SUM(CASE
          WHEN week >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 8 WEEK), WEEK)
          AND week < DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 4 WEEK), WEEK)
          THEN total_signups ELSE 0 END),
      SUM(CASE
          WHEN week >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 8 WEEK), WEEK)
          AND week < DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 4 WEEK), WEEK)
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
    recent_visitors - baseline_visitors,
    baseline_visitors
  ) * 100, 1) AS traffic_volume_change_pct,

  ROUND(SAFE_DIVIDE(
    recent_visitors,
    SUM(recent_visitors) OVER ()
  ) * 100, 1) AS recent_traffic_share_pct
FROM recent_vs_baseline
WHERE recent_visitors > 50 OR baseline_visitors > 50
ORDER BY recent_visitors DESC;
