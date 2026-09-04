-- Query Set 6: Data Quality Check
-- Purpose: Verify tracking is working correctly and identify data quality issues
-- Expected output: Metrics on NULL values, tracking completeness, anomalies

-- Check 1: Visitor ID and Session tracking completeness
WITH tracking_quality AS (
  SELECT
    DATE_TRUNC(DATE(created_date), WEEK) AS week,
    COUNT(*) AS total_pageviews,
    COUNT(DISTINCT visitor_id) AS unique_visitors,
    
    -- NULL checks
    COUNTIF(visitor_id IS NULL) AS null_visitor_id,
    COUNTIF(session_id IS NULL) AS null_session_id,
    COUNTIF(page_type IS NULL) AS null_page_type,
    
    -- Calculate NULL percentages
    ROUND(SAFE_DIVIDE(COUNTIF(visitor_id IS NULL), COUNT(*)) * 100, 2) AS null_visitor_pct,
    ROUND(SAFE_DIVIDE(COUNTIF(session_id IS NULL), COUNT(*)) * 100, 2) AS null_session_pct,
    ROUND(SAFE_DIVIDE(COUNTIF(page_type IS NULL), COUNT(*)) * 100, 2) AS null_page_type_pct
    
  FROM `@project.analytics.pageviews`
  WHERE DATE(created_date) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH) AND CURRENT_DATE()
    AND created_date <= CURRENT_TIMESTAMP()
  GROUP BY week
)
SELECT
  week,
  total_pageviews,
  unique_visitors,
  null_visitor_id,
  null_visitor_pct,
  null_session_id,
  null_session_pct,
  null_page_type,
  null_page_type_pct,
  -- Flag weeks with data quality issues
  CASE 
    WHEN null_visitor_pct > 5 OR null_session_pct > 5 THEN '⚠️ High NULL rate'
    ELSE '✓ OK'
  END AS quality_flag
FROM tracking_quality
ORDER BY week DESC;

-- Check 2: UTM parameter coverage over time
WITH utm_coverage AS (
  SELECT
    DATE_TRUNC(DATE(created_date), WEEK) AS week,
    COUNT(DISTINCT visitor_id) AS total_visitors,
    
    -- UTM parameter coverage
    COUNT(DISTINCT CASE WHEN initial_utm_source IS NOT NULL THEN visitor_id END) AS visitors_with_utm_source,
    COUNT(DISTINCT CASE WHEN initial_utm_medium IS NOT NULL THEN visitor_id END) AS visitors_with_utm_medium,
    COUNT(DISTINCT CASE WHEN initial_utm_campaign IS NOT NULL THEN visitor_id END) AS visitors_with_utm_campaign,
    COUNT(DISTINCT CASE WHEN first_touch_channel IS NOT NULL THEN visitor_id END) AS visitors_with_channel,
    
    -- Calculate coverage percentages
    ROUND(SAFE_DIVIDE(
      COUNT(DISTINCT CASE WHEN initial_utm_source IS NOT NULL THEN visitor_id END),
      COUNT(DISTINCT visitor_id)
    ) * 100, 1) AS utm_source_coverage_pct,
    ROUND(SAFE_DIVIDE(
      COUNT(DISTINCT CASE WHEN first_touch_channel IS NOT NULL THEN visitor_id END),
      COUNT(DISTINCT visitor_id)
    ) * 100, 1) AS channel_coverage_pct
    
  FROM `@project.analytics.pageviews`
  WHERE DATE(created_date) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH) AND CURRENT_DATE()
    AND created_date <= CURRENT_TIMESTAMP()
  GROUP BY week
)
SELECT
  week,
  total_visitors,
  visitors_with_utm_source,
  utm_source_coverage_pct,
  visitors_with_channel,
  channel_coverage_pct,
  -- Flag weeks with declining attribution coverage
  CASE 
    WHEN channel_coverage_pct < 80 THEN '⚠️ Low coverage'
    ELSE '✓ OK'
  END AS attribution_quality_flag
FROM utm_coverage
ORDER BY week DESC;

-- Check 3: Signup event tracking vs product_signups table
WITH signup_comparison AS (
  SELECT
    DATE_TRUNC(DATE(user_create_d), WEEK) AS week,
    COUNT(DISTINCT user_id) AS signups_in_product_table
  FROM `@project.analytics.signups`
  WHERE DATE(user_create_d) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH) AND CURRENT_DATE()
    AND user_create_d <= CURRENT_TIMESTAMP()
  GROUP BY week
),
amplitude_signups AS (
  SELECT
    DATE_TRUNC(DATE(event_time), WEEK) AS week,
    COUNT(DISTINCT user_id) AS signups_in_amplitude
  FROM `@project.product_events.events`
  WHERE event_type = 'account signup'
    AND DATE(event_time) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH) AND CURRENT_DATE()
    AND event_time <= CURRENT_TIMESTAMP()
  GROUP BY week
)
SELECT
  COALESCE(sc.week, ae.week) AS week,
  IFNULL(sc.signups_in_product_table, 0) AS signups_product_table,
  IFNULL(ae.signups_in_amplitude, 0) AS signups_amplitude_events,
  -- Calculate discrepancy
  IFNULL(sc.signups_in_product_table, 0) - IFNULL(ae.signups_in_amplitude, 0) AS discrepancy,
  ROUND(ABS(SAFE_DIVIDE(
    IFNULL(sc.signups_in_product_table, 0) - IFNULL(ae.signups_in_amplitude, 0),
    IFNULL(sc.signups_in_product_table, 1)
  )) * 100, 1) AS discrepancy_pct,
  -- Flag significant discrepancies
  CASE 
    WHEN ABS(IFNULL(sc.signups_in_product_table, 0) - IFNULL(ae.signups_in_amplitude, 0)) > 10 
      THEN '⚠️ Significant mismatch'
    ELSE '✓ OK'
  END AS tracking_consistency_flag
FROM signup_comparison sc
FULL OUTER JOIN amplitude_signups ae ON sc.week = ae.week
ORDER BY week DESC;

-- Check 4: Traffic volume anomalies
WITH weekly_traffic AS (
  SELECT
    DATE_TRUNC(DATE(created_date), WEEK) AS week,
    COUNT(DISTINCT visitor_id) AS unique_visitors,
    COUNT(*) AS total_pageviews
  FROM `@project.analytics.pageviews`
  WHERE DATE(created_date) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH) AND CURRENT_DATE()
    AND created_date <= CURRENT_TIMESTAMP()
  GROUP BY week
),
traffic_stats AS (
  SELECT
    week,
    unique_visitors,
    total_pageviews,
    AVG(unique_visitors) OVER (ORDER BY week ROWS BETWEEN 3 PRECEDING AND 1 PRECEDING) AS avg_visitors_4week,
    STDDEV(unique_visitors) OVER (ORDER BY week ROWS BETWEEN 3 PRECEDING AND 1 PRECEDING) AS stddev_visitors_4week
  FROM weekly_traffic
)
SELECT
  week,
  unique_visitors,
  total_pageviews,
  ROUND(avg_visitors_4week, 0) AS expected_visitors_4week_avg,
  -- Calculate z-score (how many standard deviations from mean)
  ROUND(SAFE_DIVIDE(
    unique_visitors - avg_visitors_4week,
    NULLIF(stddev_visitors_4week, 0)
  ), 2) AS z_score,
  -- Flag anomalies
  CASE 
    WHEN ABS(SAFE_DIVIDE(unique_visitors - avg_visitors_4week, NULLIF(stddev_visitors_4week, 0))) > 2 
      THEN '⚠️ Anomaly detected'
    ELSE '✓ Normal'
  END AS anomaly_flag
FROM traffic_stats
WHERE avg_visitors_4week IS NOT NULL
ORDER BY week DESC;

-- Check 5: Verify visitor → user_id mapping for signups
WITH signup_attribution_check AS (
  SELECT
    DATE_TRUNC(DATE(ps.user_create_d), WEEK) AS week,
    COUNT(DISTINCT ps.user_id) AS total_signups,
    
    -- How many signups have matching visitor_id in pageviews?
    COUNT(DISTINCT CASE 
      WHEN pv.visitor_id IS NOT NULL THEN ps.user_id 
    END) AS signups_with_pageview_match,
    
    -- Calculate matching percentage
    ROUND(SAFE_DIVIDE(
      COUNT(DISTINCT CASE WHEN pv.visitor_id IS NOT NULL THEN ps.user_id END),
      COUNT(DISTINCT ps.user_id)
    ) * 100, 1) AS match_rate_pct
    
  FROM `@project.analytics.signups` ps
  LEFT JOIN `@project.analytics.pageviews` pv
    ON ps.user_id = pv.visitor_id
    AND DATE(pv.created_date) <= DATE(ps.user_create_d)  -- Pageview before or on signup date
  WHERE DATE(ps.user_create_d) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH) AND CURRENT_DATE()
    AND ps.user_create_d <= CURRENT_TIMESTAMP()
  GROUP BY week
)
SELECT
  week,
  total_signups,
  signups_with_pageview_match,
  match_rate_pct,
  -- Flag weeks with low matching
  CASE 
    WHEN match_rate_pct < 85 THEN '⚠️ Low match rate'
    ELSE '✓ Good'
  END AS attribution_quality
FROM signup_attribution_check
ORDER BY week DESC;

-- Interpretation Guide:
-- 1. Check NULL percentages: High NULL rates indicate tracking issues
-- 2. UTM coverage: Declining coverage suggests attribution data loss
-- 3. Event tracking consistency: Mismatches between product_signups and Amplitude events
-- 4. Traffic anomalies: Sudden spikes or drops that might skew conversion calculations
-- 5. Attribution matching: Low match rates mean we're losing attribution data for signups
-- 
-- If data quality issues are found, conversion decline might be measurement error, not actual decline
