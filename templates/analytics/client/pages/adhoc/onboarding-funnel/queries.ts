/**
 * BigQuery SQL queries for onboarding funnel analysis
 */

export function getFunnelOverviewQuery(
  dateStart: string,
  dateEnd: string,
): string {
  return `
WITH user_events AS (
  SELECT
    user_id,
    event_type,
    event_time,
    JSON_VALUE(event_properties, '$.spaceKind') as space_kind,
    JSON_VALUE(user_properties, '$.plan') as plan
  FROM
    \`builder-3b0a2.amplitude.EVENTS_182198\`
  WHERE
    event_time >= TIMESTAMP('${dateStart}')
    AND event_time <= TIMESTAMP_ADD(TIMESTAMP('${dateEnd}'), INTERVAL 1 DAY)
    AND user_id IS NOT NULL
    AND event_type IN (
      'submit signup form',
      'account signup',
      'onboarding shown',
      'onboarding: step impression',
      'onboarding: click next button',
      'onboarding: space kind',
      'complete onboarding'
    )
),
user_funnel AS (
  SELECT
    user_id,
    MAX(CASE WHEN event_type = 'submit signup form' THEN event_time END) as submit_signup_time,
    MAX(CASE WHEN event_type = 'account signup' THEN event_time END) as account_signup_time,
    MAX(CASE WHEN event_type = 'onboarding shown' THEN event_time END) as onboarding_shown_time,
    MAX(CASE WHEN event_type = 'onboarding: step impression' THEN event_time END) as step_impression_time,
    MAX(CASE WHEN event_type = 'onboarding: click next button' THEN event_time END) as click_next_time,
    MAX(CASE WHEN event_type = 'onboarding: space kind' THEN event_time END) as space_kind_time,
    MAX(CASE WHEN event_type = 'complete onboarding' THEN event_time END) as complete_time,
    ANY_VALUE(space_kind) as space_kind,
    ANY_VALUE(plan) as plan
  FROM user_events
  GROUP BY user_id
)
SELECT
  'Submit Signup Form' as step,
  1 as step_order,
  COUNT(DISTINCT CASE WHEN submit_signup_time IS NOT NULL THEN user_id END) as users
FROM user_funnel
UNION ALL
SELECT
  'Account Signup' as step,
  2 as step_order,
  COUNT(DISTINCT CASE WHEN account_signup_time IS NOT NULL THEN user_id END) as users
FROM user_funnel
UNION ALL
SELECT
  'Onboarding Shown' as step,
  3 as step_order,
  COUNT(DISTINCT CASE WHEN onboarding_shown_time IS NOT NULL THEN user_id END) as users
FROM user_funnel
UNION ALL
SELECT
  'Step Impression' as step,
  4 as step_order,
  COUNT(DISTINCT CASE WHEN step_impression_time IS NOT NULL THEN user_id END) as users
FROM user_funnel
UNION ALL
SELECT
  'Click Next Button' as step,
  5 as step_order,
  COUNT(DISTINCT CASE WHEN click_next_time IS NOT NULL THEN user_id END) as users
FROM user_funnel
UNION ALL
SELECT
  'Space Kind Selected' as step,
  6 as step_order,
  COUNT(DISTINCT CASE WHEN space_kind_time IS NOT NULL THEN user_id END) as users
FROM user_funnel
UNION ALL
SELECT
  'Onboarding Complete' as step,
  7 as step_order,
  COUNT(DISTINCT CASE WHEN complete_time IS NOT NULL THEN user_id END) as users
FROM user_funnel
ORDER BY step_order
  `;
}

export function getTimeToCompleteQuery(
  dateStart: string,
  dateEnd: string,
): string {
  return `
WITH user_events AS (
  SELECT
    user_id,
    event_type,
    event_time
  FROM
    \`builder-3b0a2.amplitude.EVENTS_182198\`
  WHERE
    event_time >= TIMESTAMP('${dateStart}')
    AND event_time <= TIMESTAMP_ADD(TIMESTAMP('${dateEnd}'), INTERVAL 1 DAY)
    AND user_id IS NOT NULL
    AND event_type IN ('account signup', 'complete onboarding')
),
user_completion AS (
  SELECT
    user_id,
    MIN(CASE WHEN event_type = 'account signup' THEN event_time END) as signup_time,
    MIN(CASE WHEN event_type = 'complete onboarding' THEN event_time END) as complete_time
  FROM user_events
  GROUP BY user_id
  HAVING signup_time IS NOT NULL AND complete_time IS NOT NULL
)
SELECT
  CASE
    WHEN TIMESTAMP_DIFF(complete_time, signup_time, MINUTE) < 5 THEN '< 5 min'
    WHEN TIMESTAMP_DIFF(complete_time, signup_time, MINUTE) < 15 THEN '5-15 min'
    WHEN TIMESTAMP_DIFF(complete_time, signup_time, MINUTE) < 30 THEN '15-30 min'
    WHEN TIMESTAMP_DIFF(complete_time, signup_time, MINUTE) < 60 THEN '30-60 min'
    WHEN TIMESTAMP_DIFF(complete_time, signup_time, HOUR) < 24 THEN '1-24 hours'
    ELSE '> 24 hours'
  END as time_bucket,
  COUNT(*) as user_count,
  ROUND(AVG(TIMESTAMP_DIFF(complete_time, signup_time, MINUTE)), 1) as avg_minutes
FROM user_completion
GROUP BY time_bucket
ORDER BY 
  CASE time_bucket
    WHEN '< 5 min' THEN 1
    WHEN '5-15 min' THEN 2
    WHEN '15-30 min' THEN 3
    WHEN '30-60 min' THEN 4
    WHEN '1-24 hours' THEN 5
    WHEN '> 24 hours' THEN 6
  END
  `;
}

export function getCohortAnalysisQuery(
  dateStart: string,
  dateEnd: string,
  dimension: "week" | "space_kind" | "plan",
): string {
  const dimensionSelect =
    dimension === "week"
      ? `FORMAT_TIMESTAMP('%Y-W%V', signup_time) as cohort`
      : dimension === "space_kind"
        ? `COALESCE(space_kind, 'Unknown') as cohort`
        : `COALESCE(plan, 'Unknown') as cohort`;

  return `
WITH user_events AS (
  SELECT
    user_id,
    event_type,
    event_time,
    JSON_VALUE(event_properties, '$.spaceKind') as space_kind,
    JSON_VALUE(user_properties, '$.plan') as plan
  FROM
    \`builder-3b0a2.amplitude.EVENTS_182198\`
  WHERE
    event_time >= TIMESTAMP('${dateStart}')
    AND event_time <= TIMESTAMP_ADD(TIMESTAMP('${dateEnd}'), INTERVAL 1 DAY)
    AND user_id IS NOT NULL
    AND event_type IN (
      'account signup',
      'onboarding shown',
      'onboarding: step impression',
      'complete onboarding'
    )
),
user_funnel AS (
  SELECT
    user_id,
    MIN(CASE WHEN event_type = 'account signup' THEN event_time END) as signup_time,
    MAX(CASE WHEN event_type = 'onboarding shown' THEN 1 ELSE 0 END) as saw_onboarding,
    MAX(CASE WHEN event_type = 'onboarding: step impression' THEN 1 ELSE 0 END) as saw_steps,
    MAX(CASE WHEN event_type = 'complete onboarding' THEN 1 ELSE 0 END) as completed,
    ANY_VALUE(space_kind) as space_kind,
    ANY_VALUE(plan) as plan
  FROM user_events
  GROUP BY user_id
  HAVING signup_time IS NOT NULL
)
SELECT
  ${dimensionSelect},
  COUNT(DISTINCT user_id) as total_signups,
  SUM(saw_onboarding) as onboarding_shown,
  SUM(saw_steps) as viewed_steps,
  SUM(completed) as completed_onboarding,
  ROUND(100.0 * SUM(saw_onboarding) / COUNT(DISTINCT user_id), 1) as pct_shown,
  ROUND(100.0 * SUM(saw_steps) / COUNT(DISTINCT user_id), 1) as pct_steps,
  ROUND(100.0 * SUM(completed) / COUNT(DISTINCT user_id), 1) as pct_completed
FROM user_funnel
GROUP BY cohort
ORDER BY cohort DESC
LIMIT 20
  `;
}

export function getDropoffAnalysisQuery(
  dateStart: string,
  dateEnd: string,
): string {
  return `
WITH user_events AS (
  SELECT
    user_id,
    event_type,
    event_time
  FROM
    \`builder-3b0a2.amplitude.EVENTS_182198\`
  WHERE
    event_time >= TIMESTAMP('${dateStart}')
    AND event_time <= TIMESTAMP_ADD(TIMESTAMP('${dateEnd}'), INTERVAL 1 DAY)
    AND user_id IS NOT NULL
    AND event_type IN (
      'account signup',
      'onboarding shown',
      'onboarding: step impression',
      'onboarding: click next button',
      'onboarding: space kind',
      'complete onboarding'
    )
),
user_progression AS (
  SELECT
    user_id,
    MAX(CASE WHEN event_type = 'account signup' THEN 1 ELSE 0 END) as reached_signup,
    MAX(CASE WHEN event_type = 'onboarding shown' THEN 1 ELSE 0 END) as reached_shown,
    MAX(CASE WHEN event_type = 'onboarding: step impression' THEN 1 ELSE 0 END) as reached_steps,
    MAX(CASE WHEN event_type = 'onboarding: click next button' THEN 1 ELSE 0 END) as reached_next,
    MAX(CASE WHEN event_type = 'onboarding: space kind' THEN 1 ELSE 0 END) as reached_kind,
    MAX(CASE WHEN event_type = 'complete onboarding' THEN 1 ELSE 0 END) as reached_complete
  FROM user_events
  GROUP BY user_id
)
SELECT
  SUM(reached_signup) as signup_count,
  SUM(CASE WHEN reached_signup = 1 AND reached_shown = 0 THEN 1 ELSE 0 END) as dropoff_after_signup,
  SUM(CASE WHEN reached_shown = 1 AND reached_steps = 0 THEN 1 ELSE 0 END) as dropoff_after_shown,
  SUM(CASE WHEN reached_steps = 1 AND reached_next = 0 THEN 1 ELSE 0 END) as dropoff_after_steps,
  SUM(CASE WHEN reached_next = 1 AND reached_kind = 0 THEN 1 ELSE 0 END) as dropoff_after_next,
  SUM(CASE WHEN reached_kind = 1 AND reached_complete = 0 THEN 1 ELSE 0 END) as dropoff_after_kind
FROM user_progression
  `;
}

export function getDailyFunnelQuery(
  dateStart: string,
  dateEnd: string,
): string {
  return `
WITH user_events AS (
  SELECT
    user_id,
    DATE(event_time) as event_date,
    event_type
  FROM
    \`builder-3b0a2.amplitude.EVENTS_182198\`
  WHERE
    event_time >= TIMESTAMP('${dateStart}')
    AND event_time <= TIMESTAMP_ADD(TIMESTAMP('${dateEnd}'), INTERVAL 1 DAY)
    AND user_id IS NOT NULL
    AND event_type IN ('account signup', 'onboarding shown', 'complete onboarding')
),
daily_metrics AS (
  SELECT
    event_date,
    COUNT(DISTINCT CASE WHEN event_type = 'account signup' THEN user_id END) as signups,
    COUNT(DISTINCT CASE WHEN event_type = 'onboarding shown' THEN user_id END) as onboarding_shown,
    COUNT(DISTINCT CASE WHEN event_type = 'complete onboarding' THEN user_id END) as completed
  FROM user_events
  GROUP BY event_date
)
SELECT
  event_date,
  signups,
  onboarding_shown,
  completed,
  ROUND(100.0 * onboarding_shown / NULLIF(signups, 0), 1) as pct_shown,
  ROUND(100.0 * completed / NULLIF(signups, 0), 1) as pct_completed
FROM daily_metrics
ORDER BY event_date DESC
  `;
}
