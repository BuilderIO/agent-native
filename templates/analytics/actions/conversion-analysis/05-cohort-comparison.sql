-- Query Set 5: Cohort Comparison
-- Purpose: Compare behavior of recent cohorts vs baseline cohorts across multiple dimensions
-- Expected output: Side-by-side comparison of key metrics for recent vs baseline periods

WITH cohort_definitions AS (
  SELECT
    'Recent (Last 8 Weeks)' AS cohort,
    DATE_SUB(CURRENT_DATE(), INTERVAL 8 WEEK) AS start_date,
    CURRENT_DATE() AS end_date
  UNION ALL
  SELECT
    'Baseline (Weeks 9-16 Ago)' AS cohort,
    DATE_SUB(CURRENT_DATE(), INTERVAL 16 WEEK) AS start_date,
    DATE_SUB(CURRENT_DATE(), INTERVAL 8 WEEK) AS end_date
),
cohort_metrics AS (
  SELECT
    cd.cohort,
    -- Overall metrics
    COUNT(DISTINCT pv.visitor_id) AS total_visitors,
    COUNT(DISTINCT ps.user_id) AS total_signups,
    SAFE_DIVIDE(COUNT(DISTINCT ps.user_id), COUNT(DISTINCT pv.visitor_id)) AS conversion_rate,
    
    -- Traffic source distribution
    ROUND(SAFE_DIVIDE(
      COUNT(DISTINCT CASE WHEN pv.first_touch_channel = 'Organic' THEN pv.visitor_id END),
      COUNT(DISTINCT pv.visitor_id)
    ) * 100, 1) AS organic_pct,
    ROUND(SAFE_DIVIDE(
      COUNT(DISTINCT CASE WHEN pv.first_touch_channel = 'Paid' THEN pv.visitor_id END),
      COUNT(DISTINCT pv.visitor_id)
    ) * 100, 1) AS paid_pct,
    ROUND(SAFE_DIVIDE(
      COUNT(DISTINCT CASE WHEN pv.first_touch_channel = 'Direct' THEN pv.visitor_id END),
      COUNT(DISTINCT pv.visitor_id)
    ) * 100, 1) AS direct_pct,
    
    -- Landing page distribution
    ROUND(SAFE_DIVIDE(
      COUNT(DISTINCT CASE WHEN fp.landing_page_type = 'homepage' THEN pv.visitor_id END),
      COUNT(DISTINCT pv.visitor_id)
    ) * 100, 1) AS homepage_landing_pct,
    ROUND(SAFE_DIVIDE(
      COUNT(DISTINCT CASE WHEN fp.landing_page_type = 'pricing' THEN pv.visitor_id END),
      COUNT(DISTINCT pv.visitor_id)
    ) * 100, 1) AS pricing_landing_pct,
    ROUND(SAFE_DIVIDE(
      COUNT(DISTINCT CASE WHEN fp.landing_page_type = 'blog' THEN pv.visitor_id END),
      COUNT(DISTINCT pv.visitor_id)
    ) * 100, 1) AS blog_landing_pct,
    
    -- Engagement metrics
    ROUND(AVG(session_pageviews.pageviews_per_session), 1) AS avg_pageviews_per_session,
    COUNT(DISTINCT CASE WHEN pv.page_type = 'signup' THEN pv.visitor_id END) AS visited_signup_page,
    ROUND(SAFE_DIVIDE(
      COUNT(DISTINCT CASE WHEN pv.page_type = 'signup' THEN pv.visitor_id END),
      COUNT(DISTINCT pv.visitor_id)
    ) * 100, 1) AS signup_page_visit_rate,
    
    -- ICP signups (if available)
    COUNT(DISTINCT CASE WHEN ps.icp_flag = 'ICP' THEN ps.user_id END) AS icp_signups,
    ROUND(SAFE_DIVIDE(
      COUNT(DISTINCT CASE WHEN ps.icp_flag = 'ICP' THEN ps.user_id END),
      COUNT(DISTINCT ps.user_id)
    ) * 100, 1) AS icp_signup_pct
    
  FROM cohort_definitions cd
  CROSS JOIN `your-gcp-project-id.dbt_staging_bigquery.all_pageviews` pv
  LEFT JOIN `your-gcp-project-id.dbt_analytics.product_signups` ps
    ON pv.visitor_id = ps.user_id
    AND DATE(ps.user_create_d) BETWEEN cd.start_date AND cd.end_date
  LEFT JOIN (
    -- First pageview per visitor for landing page analysis
    SELECT
      visitor_id,
      page_type AS landing_page_type
    FROM (
      SELECT
        visitor_id,
        page_type,
        ROW_NUMBER() OVER (PARTITION BY visitor_id ORDER BY created_date ASC) AS rn
      FROM `your-gcp-project-id.dbt_staging_bigquery.all_pageviews`
    )
    WHERE rn = 1
  ) fp ON pv.visitor_id = fp.visitor_id
  LEFT JOIN (
    -- Session-level pageview counts
    SELECT
      visitor_id,
      session_id,
      COUNT(*) AS pageviews_per_session
    FROM `your-gcp-project-id.dbt_staging_bigquery.all_pageviews`
    GROUP BY visitor_id, session_id
  ) session_pageviews ON pv.visitor_id = session_pageviews.visitor_id
  WHERE DATE(pv.created_date) BETWEEN cd.start_date AND cd.end_date
    AND pv.created_date <= CURRENT_TIMESTAMP()
  GROUP BY cd.cohort
)
SELECT
  cohort,
  total_visitors,
  total_signups,
  ROUND(conversion_rate * 100, 2) AS conversion_rate_pct,
  organic_pct,
  paid_pct,
  direct_pct,
  homepage_landing_pct,
  pricing_landing_pct,
  blog_landing_pct,
  avg_pageviews_per_session,
  visited_signup_page,
  signup_page_visit_rate,
  icp_signups,
  icp_signup_pct
FROM cohort_metrics
ORDER BY 
  CASE cohort 
    WHEN 'Recent (Last 8 Weeks)' THEN 1 
    WHEN 'Baseline (Weeks 9-16 Ago)' THEN 2 
  END;

-- Additional analysis: Day of week and time of day patterns
WITH cohort_definitions AS (
  SELECT
    'Recent (Last 8 Weeks)' AS cohort,
    DATE_SUB(CURRENT_DATE(), INTERVAL 8 WEEK) AS start_date,
    CURRENT_DATE() AS end_date
  UNION ALL
  SELECT
    'Baseline (Weeks 9-16 Ago)' AS cohort,
    DATE_SUB(CURRENT_DATE(), INTERVAL 16 WEEK) AS start_date,
    DATE_SUB(CURRENT_DATE(), INTERVAL 8 WEEK) AS end_date
),
temporal_patterns AS (
  SELECT
    cd.cohort,
    FORMAT_DATE('%A', DATE(pv.created_date)) AS day_of_week,
    COUNT(DISTINCT pv.visitor_id) AS visitors,
    COUNT(DISTINCT ps.user_id) AS signups,
    SAFE_DIVIDE(COUNT(DISTINCT ps.user_id), COUNT(DISTINCT pv.visitor_id)) AS conversion_rate
  FROM cohort_definitions cd
  CROSS JOIN `your-gcp-project-id.dbt_staging_bigquery.all_pageviews` pv
  LEFT JOIN `your-gcp-project-id.dbt_analytics.product_signups` ps
    ON pv.visitor_id = ps.user_id
    AND DATE(ps.user_create_d) BETWEEN cd.start_date AND cd.end_date
  WHERE DATE(pv.created_date) BETWEEN cd.start_date AND cd.end_date
    AND pv.created_date <= CURRENT_TIMESTAMP()
  GROUP BY cd.cohort, day_of_week
)
SELECT
  cohort,
  day_of_week,
  visitors,
  signups,
  ROUND(conversion_rate * 100, 2) AS conversion_rate_pct
FROM temporal_patterns
ORDER BY 
  CASE cohort 
    WHEN 'Recent (Last 8 Weeks)' THEN 1 
    WHEN 'Baseline (Weeks 9-16 Ago)' THEN 2 
  END,
  CASE day_of_week
    WHEN 'Monday' THEN 1
    WHEN 'Tuesday' THEN 2
    WHEN 'Wednesday' THEN 3
    WHEN 'Thursday' THEN 4
    WHEN 'Friday' THEN 5
    WHEN 'Saturday' THEN 6
    WHEN 'Sunday' THEN 7
  END;

-- Interpretation Guide:
-- 1. Compare conversion_rate_pct between Recent and Baseline cohorts
-- 2. Check if traffic source mix has changed (organic_pct, paid_pct, direct_pct)
-- 3. See if landing page distribution has shifted (more blog, less pricing?)
-- 4. Check engagement metrics: avg_pageviews_per_session, signup_page_visit_rate
-- 5. Temporal patterns: has conversion changed on specific days of week?
-- 6. ICP quality: is the decline due to lower quality signups?
