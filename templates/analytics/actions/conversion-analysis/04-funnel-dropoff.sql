WITH time_periods AS (
  SELECT
    'Recent (Last 4 Weeks)' AS period,
    DATE_SUB(CURRENT_DATE(), INTERVAL 4 WEEK) AS start_date,
    CURRENT_DATE() AS end_date
  UNION ALL
  SELECT
    'Baseline (Weeks 5-8 Ago)' AS period,
    DATE_SUB(CURRENT_DATE(), INTERVAL 8 WEEK) AS start_date,
    DATE_SUB(CURRENT_DATE(), INTERVAL 4 WEEK) AS end_date
),
funnel_data AS (
  SELECT
    tp.period,

    COUNT(DISTINCT pv.visitor_id) AS stage1_unique_visitors,


    COUNT(DISTINCT CASE
      WHEN pv.page_type IN ('signup', 'pricing') THEN pv.visitor_id
    END) AS stage2_visited_signup_pricing,


    COUNT(DISTINCT CASE
      WHEN ae.event_type = 'submit signup form' THEN ae.user_id
    END) AS stage3_submitted_form,


    COUNT(DISTINCT CASE
      WHEN ae.event_type = 'account signup' THEN ae.user_id
    END) AS stage4_account_created,


    COUNT(DISTINCT ps.user_id) AS stage5_completed_signup

  FROM time_periods tp
  CROSS JOIN `@project.analytics.pageviews` pv
  LEFT JOIN `@project.product_events.events` ae
    ON pv.visitor_id = ae.user_id
    AND DATE(ae.event_time) BETWEEN tp.start_date AND tp.end_date
  LEFT JOIN `@project.analytics.signups` ps
    ON pv.visitor_id = ps.user_id
    AND DATE(ps.user_create_d) BETWEEN tp.start_date AND tp.end_date
  WHERE DATE(pv.created_date) BETWEEN tp.start_date AND tp.end_date
    AND pv.created_date <= CURRENT_TIMESTAMP()
  GROUP BY tp.period
)
SELECT
  period,

  stage1_unique_visitors,
  '100.0%' AS stage1_conversion_pct,


  stage2_visited_signup_pricing,
  ROUND(SAFE_DIVIDE(stage2_visited_signup_pricing, stage1_unique_visitors) * 100, 1) AS stage2_conversion_pct,
  ROUND(SAFE_DIVIDE(stage1_unique_visitors - stage2_visited_signup_pricing, stage1_unique_visitors) * 100, 1) AS stage2_dropoff_pct,


  stage3_submitted_form,
  ROUND(SAFE_DIVIDE(stage3_submitted_form, stage2_visited_signup_pricing) * 100, 1) AS stage3_conversion_pct,
  ROUND(SAFE_DIVIDE(stage2_visited_signup_pricing - stage3_submitted_form, stage2_visited_signup_pricing) * 100, 1) AS stage3_dropoff_pct,


  stage4_account_created,
  ROUND(SAFE_DIVIDE(stage4_account_created, stage3_submitted_form) * 100, 1) AS stage4_conversion_pct,
  ROUND(SAFE_DIVIDE(stage3_submitted_form - stage4_account_created, stage3_submitted_form) * 100, 1) AS stage4_dropoff_pct,


  stage5_completed_signup,
  ROUND(SAFE_DIVIDE(stage5_completed_signup, stage4_account_created) * 100, 1) AS stage5_conversion_pct,
  ROUND(SAFE_DIVIDE(stage4_account_created - stage5_completed_signup, stage4_account_created) * 100, 1) AS stage5_dropoff_pct,


  ROUND(SAFE_DIVIDE(stage5_completed_signup, stage1_unique_visitors) * 100, 2) AS overall_conversion_pct

FROM funnel_data
ORDER BY
  CASE period
    WHEN 'Recent (Last 4 Weeks)' THEN 1
    WHEN 'Baseline (Weeks 5-8 Ago)' THEN 2
  END;

WITH time_periods AS (
  SELECT
    'Recent (Last 4 Weeks)' AS period,
    DATE_SUB(CURRENT_DATE(), INTERVAL 4 WEEK) AS start_date,
    CURRENT_DATE() AS end_date
  UNION ALL
  SELECT
    'Baseline (Weeks 5-8 Ago)' AS period,
    DATE_SUB(CURRENT_DATE(), INTERVAL 8 WEEK) AS start_date,
    DATE_SUB(CURRENT_DATE(), INTERVAL 4 WEEK) AS end_date
),
simple_funnel AS (
  SELECT
    tp.period,
    COUNT(DISTINCT pv.visitor_id) AS total_visitors,
    COUNT(DISTINCT CASE WHEN pv.page_type = 'signup' THEN pv.visitor_id END) AS visited_signup_page,
    COUNT(DISTINCT ps.user_id) AS completed_signups
  FROM time_periods tp
  CROSS JOIN `@project.analytics.pageviews` pv
  LEFT JOIN `@project.analytics.signups` ps
    ON pv.visitor_id = ps.user_id
    AND DATE(ps.user_create_d) BETWEEN tp.start_date AND tp.end_date
  WHERE DATE(pv.created_date) BETWEEN tp.start_date AND tp.end_date
    AND pv.created_date <= CURRENT_TIMESTAMP()
  GROUP BY tp.period
)
SELECT
  period,
  total_visitors,
  visited_signup_page,
  ROUND(SAFE_DIVIDE(visited_signup_page, total_visitors) * 100, 1) AS signup_page_visit_rate,
  completed_signups,
  ROUND(SAFE_DIVIDE(completed_signups, visited_signup_page) * 100, 1) AS signup_completion_rate,
  ROUND(SAFE_DIVIDE(completed_signups, total_visitors) * 100, 2) AS overall_conversion_rate
FROM simple_funnel
ORDER BY
  CASE period
    WHEN 'Recent (Last 4 Weeks)' THEN 1
    WHEN 'Baseline (Weeks 5-8 Ago)' THEN 2
  END;
