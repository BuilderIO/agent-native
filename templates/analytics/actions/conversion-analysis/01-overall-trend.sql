WITH visitors AS (
  SELECT
    DATE_TRUNC(DATE(created_date), WEEK) AS week,
    COUNT(DISTINCT visitor_id) AS unique_visitors
  FROM `@project.analytics.pageviews`
  WHERE DATE(created_date) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH) AND CURRENT_DATE()
    AND created_date <= CURRENT_TIMESTAMP()
  GROUP BY week
),
signups AS (
  SELECT
    DATE_TRUNC(DATE(user_create_d), WEEK) AS week,
    COUNT(DISTINCT user_id) AS total_signups
  FROM `@project.analytics.signups`
  WHERE DATE(user_create_d) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH) AND CURRENT_DATE()
    AND user_create_d <= CURRENT_TIMESTAMP()
  GROUP BY week
),
combined AS (
  SELECT
    v.week,
    v.unique_visitors,
    IFNULL(s.total_signups, 0) AS total_signups,
    SAFE_DIVIDE(IFNULL(s.total_signups, 0), v.unique_visitors) AS conversion_rate
  FROM visitors v
  LEFT JOIN signups s ON v.week = s.week
)
SELECT
  week,
  unique_visitors,
  total_signups,
  ROUND(conversion_rate * 100, 2) AS conversion_rate_pct,

  LAG(conversion_rate) OVER (ORDER BY week) AS prev_week_conversion,
  ROUND((conversion_rate - LAG(conversion_rate) OVER (ORDER BY week)) * 100, 2) AS wow_change_pct,

  ROUND(SAFE_DIVIDE(
    conversion_rate - LAG(conversion_rate) OVER (ORDER BY week),
    LAG(conversion_rate) OVER (ORDER BY week)
  ) * 100, 1) AS wow_pct_change
FROM combined
ORDER BY week DESC;
