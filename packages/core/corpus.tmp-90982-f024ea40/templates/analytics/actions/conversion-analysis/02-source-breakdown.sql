-- Query Set 2: Traffic Source Breakdown
-- Purpose: Compare conversion rates by UTM source/channel to identify which sources are driving decline
-- Expected output: Conversion rate by traffic channel, volume changes, contribution to overall decline

WITH visitors_by_source AS (
  SELECT
    DATE_TRUNC(DATE(created_date), WEEK) AS week,
    COALESCE(first_touch_channel, 'Unknown') AS channel,
    COUNT(DISTINCT visitor_id) AS unique_visitors
  FROM `@project.analytics.pageviews`
  WHERE DATE(created_date) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH) AND CURRENT_DATE()
    AND created_date <= CURRENT_TIMESTAMP()
  GROUP BY week, channel
),
signups_by_source AS (
  SELECT
    DATE_TRUNC(DATE(user_create_d), WEEK) AS week,
    COALESCE(channel, 'Unknown') AS channel,
    COUNT(DISTINCT user_id) AS total_signups
  FROM `@project.analytics.signups`
  WHERE DATE(user_create_d) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH) AND CURRENT_DATE()
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
    -- Recent 4 weeks
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
    -- Previous 4 weeks (weeks 5-8 ago)
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
  -- Absolute change in conversion rate
  ROUND((recent_conversion_rate - baseline_conversion_rate) * 100, 2) AS conv_rate_change_pct,
  -- Percentage change
  ROUND(SAFE_DIVIDE(
    recent_conversion_rate - baseline_conversion_rate,
    baseline_conversion_rate
  ) * 100, 1) AS pct_change,
  -- Traffic volume change
  ROUND(SAFE_DIVIDE(
    recent_visitors - baseline_visitors,
    baseline_visitors
  ) * 100, 1) AS traffic_volume_change_pct
FROM recent_vs_baseline
WHERE recent_visitors > 100 OR baseline_visitors > 100  -- Filter out very low volume channels
ORDER BY recent_visitors DESC;

-- Interpretation Guide:
-- 1. Focus on channels with high recent_visitors (these drive overall conversion)
-- 2. Negative conv_rate_change_pct shows which channels are declining
-- 3. Check traffic_volume_change_pct to see if traffic mix is shifting
-- 4. A channel with declining conversion AND increasing volume is a red flag
