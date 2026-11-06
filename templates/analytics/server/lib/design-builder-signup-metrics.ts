// Bound immutable delivery fields before the shared latest-receipt deduplication;
// outer cohort filters cannot bound that warehouse scan.
export const DESIGN_BUILDER_SIGNUP_EVENT_SOURCE = `WITH builder_signup_source AS (
  SELECT e.id, e.event_name, e.timestamp, e.event_date, e.app, e.template,
    e.hostname, e.user_id, e.user_key, e.anonymous_id, e.properties
  FROM analytics_events e
  WHERE e.event_date >= '{{timeRangeStart}}' AND e.event_date <= '{{timeRangeEnd}}'
    AND e.event_name IN (
      'auth.builder_signup_experiment_exposed', 'builder_signup_experiment_enrolled',
      'builder_signup_experiment_outcome', 'builder_signup_experiment_activation_started',
      'builder_signup_experiment_activation_unavailable', 'builder_signup_experiment_unattributed',
      'auth.builder_signup_experiment_unavailable', 'design_prompt_submitted', 'design_ready_viewed',
      'builder connect succeeded', 'onboarding_method_outcome', 'pageview', 'app_entered', 'onboarding_app_entered'
    )
)`;

export function designBuilderSignupQueries(scopedEventsCte: string) {
  const cohort = `${scopedEventsCte}, design_events AS (
  SELECT * FROM onboarding_events
  WHERE lower(COALESCE(NULLIF(app, ''), NULLIF(template, ''), properties::jsonb ->> 'app', '')) = 'design'
), experiment_events AS (
  SELECT *, NULLIF(properties::jsonb ->> 'assignment_id', '') AS assignment_id,
    properties::jsonb ->> 'experiment_variant' AS variant,
    timestamp::timestamptz AS event_at
  FROM design_events
  WHERE properties::jsonb ->> 'experiment_id' = 'design_builder_signup_v1'
    AND properties::jsonb ->> 'experiment_variant' IN ('control', 'automatic')
), ranked_exposures AS (
  SELECT assignment_id, variant, event_at AS exposed_at,
    CASE WHEN lower(COALESCE(hostname, '')) LIKE 'beta.%' OR properties::jsonb ->> 'deployment_environment' = 'beta' THEN 'beta'
      WHEN lower(COALESCE(hostname, '')) = 'design.agent-native.com' OR properties::jsonb ->> 'deployment_environment' = 'production' THEN 'production'
      ELSE 'unknown' END AS environment,
    ROW_NUMBER() OVER (PARTITION BY assignment_id ORDER BY event_at, id) AS position
  FROM experiment_events
  WHERE event_name = 'auth.builder_signup_experiment_exposed' AND assignment_id IS NOT NULL
), raw_exposures AS (
  SELECT assignment_id, variant, exposed_at, environment FROM ranked_exposures WHERE position = 1
), signup_links AS (
  SELECT x.assignment_id, MIN(e.funnel_user_key) AS person_key, MIN(e.event_at) AS enrolled_at, MIN(e.funnel_user_email) AS person_email
  FROM raw_exposures x JOIN experiment_events e ON e.assignment_id = x.assignment_id
    AND e.variant = x.variant AND e.event_at >= x.exposed_at
  WHERE e.funnel_user_key IS NOT NULL
    AND (e.event_name = 'builder_signup_experiment_enrolled'
      OR (e.event_name = 'builder_signup_experiment_outcome'
        AND COALESCE(e.properties::jsonb ->> 'code', '') NOT IN ('signup_attempt_unbound', 'acceptance_missing', 'identity_ineligible', 'control')
        AND e.properties::jsonb ->> 'status' IN ('control', 'connected', 'fallback')))
  GROUP BY x.assignment_id HAVING COUNT(DISTINCT e.funnel_user_key) = 1
), ranked_links AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY person_key ORDER BY enrolled_at, assignment_id) AS person_assignment
  FROM signup_links
), linked_exposures AS (
  SELECT x.*, l.person_key, l.enrolled_at FROM raw_exposures x
  LEFT JOIN ranked_links l ON l.assignment_id = x.assignment_id AND l.person_assignment = 1
  WHERE ('{{emailFilter}}' IN ('', 'all')
    OR ('{{emailFilter}}' = 'exclude_builder' AND lower(COALESCE(l.person_email, '')) NOT LIKE '%@builder.io')
    OR ('{{emailFilter}}' = 'only_builder' AND lower(COALESCE(l.person_email, '')) LIKE '%@builder.io'))
), exposures AS (
  SELECT assignment_id, variant, exposed_at, environment FROM linked_exposures
), flags AS (
  SELECT x.assignment_id, x.variant, x.exposed_at, x.environment,
    CASE WHEN x.enrolled_at < x.exposed_at::timestamptz + INTERVAL '1 day' THEN 1 ELSE 0 END AS signed_up,
    MAX(CASE WHEN e.event_name = 'design_prompt_submitted' AND e.timestamp::timestamptz < x.exposed_at::timestamptz + INTERVAL '1 day' THEN 1 ELSE 0 END) AS prompted,
    MAX(CASE WHEN e.event_name = 'design_ready_viewed' AND e.timestamp::timestamptz < x.exposed_at::timestamptz + INTERVAL '1 day' THEN 1 ELSE 0 END) AS ready,
    MAX(CASE WHEN e.timestamp::timestamptz < x.exposed_at::timestamptz + INTERVAL '1 day'
      AND (e.event_name = 'builder connect succeeded'
        OR (e.event_name = 'onboarding_method_outcome' AND e.properties::jsonb ->> 'method_id' IN ('builder_create_account', 'builder_sign_in') AND e.properties::jsonb ->> 'outcome' IN ('connected', 'already_connected')))
      THEN 1 ELSE 0 END) AS builder_connected,
    MAX(CASE WHEN e.timestamp::timestamptz >= x.exposed_at::timestamptz + INTERVAL '1 day' AND e.timestamp::timestamptz < x.exposed_at::timestamptz + INTERVAL '2 days'
      AND e.event_name IN ('pageview', 'app_entered', 'onboarding_app_entered', 'design_prompt_submitted', 'design_ready_viewed') THEN 1 ELSE 0 END) AS d1_return,
    MAX(CASE WHEN e.timestamp::timestamptz >= x.exposed_at::timestamptz + INTERVAL '7 days' AND e.timestamp::timestamptz < x.exposed_at::timestamptz + INTERVAL '8 days'
      AND e.event_name IN ('pageview', 'app_entered', 'onboarding_app_entered', 'design_prompt_submitted', 'design_ready_viewed') THEN 1 ELSE 0 END) AS d7_return
  FROM linked_exposures x LEFT JOIN design_events e ON e.funnel_user_key = x.person_key
    AND e.timestamp::timestamptz >= x.enrolled_at AND e.timestamp::timestamptz < x.exposed_at::timestamptz + INTERVAL '8 days'
  GROUP BY x.assignment_id, x.variant, x.exposed_at, x.enrolled_at, x.environment
), automatic_connections AS (
  SELECT x.assignment_id FROM exposures x JOIN experiment_events e ON e.assignment_id = x.assignment_id AND e.variant = x.variant
  WHERE e.event_name = 'builder_signup_experiment_outcome' AND e.properties::jsonb ->> 'status' = 'connected'
    AND e.event_at >= x.exposed_at AND e.event_at < x.exposed_at::timestamptz + INTERVAL '1 day'
  GROUP BY x.assignment_id
), variants AS (
  SELECT lanes.environment, arms.variant FROM (SELECT 'production' AS environment UNION ALL SELECT 'beta' UNION ALL SELECT 'unknown') lanes
  CROSS JOIN (SELECT 'control' AS variant UNION ALL SELECT 'automatic') arms
)`;
  return {
    comparison: `${cohort}
SELECT v.environment, v.variant, COUNT(f.assignment_id) AS exposed_visitors,
  COALESCE(SUM(f.signed_up), 0) AS signed_up_24h,
  COUNT(CASE WHEN f.builder_connected = 1 OR a.assignment_id IS NOT NULL THEN 1 END) AS builder_connected_24h,
  COALESCE(SUM(f.prompted), 0) AS first_prompt_24h,
  COALESCE(SUM(f.ready), 0) AS first_design_24h,
  SUM(f.ready)::float / NULLIF(COUNT(f.assignment_id), 0) AS first_design_rate,
  COUNT(CASE WHEN f.exposed_at::timestamptz + INTERVAL '1 day' <= LEAST(CURRENT_TIMESTAMP, '{{timeRangeEnd}}'::date::timestamptz + INTERVAL '1 day') THEN 1 END) AS mature_24h_visitors,
  SUM(CASE WHEN f.exposed_at::timestamptz + INTERVAL '1 day' <= LEAST(CURRENT_TIMESTAMP, '{{timeRangeEnd}}'::date::timestamptz + INTERVAL '1 day') THEN f.ready END)::float / NULLIF(COUNT(CASE WHEN f.exposed_at::timestamptz + INTERVAL '1 day' <= LEAST(CURRENT_TIMESTAMP, '{{timeRangeEnd}}'::date::timestamptz + INTERVAL '1 day') THEN 1 END), 0) AS mature_first_design_rate,
  COUNT(CASE WHEN f.exposed_at::timestamptz + INTERVAL '2 days' <= LEAST(CURRENT_TIMESTAMP, '{{timeRangeEnd}}'::date::timestamptz + INTERVAL '1 day') THEN 1 END) AS d1_eligible,
  SUM(CASE WHEN f.exposed_at::timestamptz + INTERVAL '2 days' <= LEAST(CURRENT_TIMESTAMP, '{{timeRangeEnd}}'::date::timestamptz + INTERVAL '1 day') THEN f.d1_return END)::float / NULLIF(COUNT(CASE WHEN f.exposed_at::timestamptz + INTERVAL '2 days' <= LEAST(CURRENT_TIMESTAMP, '{{timeRangeEnd}}'::date::timestamptz + INTERVAL '1 day') THEN 1 END), 0) AS d1_return_rate,
  COUNT(CASE WHEN f.exposed_at::timestamptz + INTERVAL '8 days' <= LEAST(CURRENT_TIMESTAMP, '{{timeRangeEnd}}'::date::timestamptz + INTERVAL '1 day') THEN 1 END) AS d7_eligible,
  SUM(CASE WHEN f.exposed_at::timestamptz + INTERVAL '8 days' <= LEAST(CURRENT_TIMESTAMP, '{{timeRangeEnd}}'::date::timestamptz + INTERVAL '1 day') THEN f.d7_return END)::float / NULLIF(COUNT(CASE WHEN f.exposed_at::timestamptz + INTERVAL '8 days' <= LEAST(CURRENT_TIMESTAMP, '{{timeRangeEnd}}'::date::timestamptz + INTERVAL '1 day') THEN 1 END), 0) AS d7_return_rate
FROM variants v LEFT JOIN flags f ON f.variant = v.variant AND f.environment = v.environment
LEFT JOIN automatic_connections a ON a.assignment_id = f.assignment_id
GROUP BY v.environment, v.variant ORDER BY v.environment, v.variant`,
    outcomes: `${cohort}, ranked_outcomes AS (
  SELECT x.assignment_id, e.properties::jsonb ->> 'status' AS status,
    COALESCE(NULLIF(e.properties::jsonb ->> 'code', ''), e.properties::jsonb ->> 'status') AS code,
    ROW_NUMBER() OVER (PARTITION BY x.assignment_id ORDER BY e.event_at DESC, e.id DESC) AS position
  FROM exposures x JOIN experiment_events e ON e.assignment_id = x.assignment_id AND e.variant = x.variant
  WHERE e.event_name = 'builder_signup_experiment_outcome' AND e.event_at >= x.exposed_at
)
SELECT v.environment, v.variant, COALESCE(o.status, 'not_recorded') AS status,
  COALESCE(o.code, 'not_recorded') AS code, COUNT(x.assignment_id) AS visitors
FROM variants v LEFT JOIN exposures x ON x.environment = v.environment AND x.variant = v.variant
LEFT JOIN ranked_outcomes o ON o.assignment_id = x.assignment_id AND o.position = 1
GROUP BY v.environment, v.variant, o.status, o.code ORDER BY v.environment, v.variant, visitors DESC`,
    quality: `${cohort}
SELECT 'Exposed visitor assignments' AS metric, COUNT(*) AS count FROM exposures
UNION ALL SELECT 'Signed-up assignments linked to one person', COUNT(*) FROM linked_exposures WHERE person_key IS NOT NULL
UNION ALL SELECT 'Exposures without a signup link (includes abandonment)', COUNT(*) FROM linked_exposures WHERE person_key IS NULL
UNION ALL SELECT 'Assignments linked to multiple people (excluded from signup milestones)', COUNT(*)
  FROM (SELECT x.assignment_id FROM exposures x JOIN experiment_events e ON e.assignment_id = x.assignment_id AND e.variant = x.variant
    WHERE e.event_name = 'builder_signup_experiment_enrolled' AND e.event_at >= x.exposed_at
    GROUP BY x.assignment_id HAVING COUNT(DISTINCT e.funnel_user_key) > 1) ambiguous
UNION ALL SELECT 'Activation attempts without a recorded outcome', COUNT(DISTINCT s.assignment_id)
  FROM experiment_events s WHERE s.event_name = 'builder_signup_experiment_activation_started'
    AND NOT EXISTS (SELECT 1 FROM experiment_events o WHERE o.assignment_id = s.assignment_id AND o.variant = s.variant AND o.event_name = 'builder_signup_experiment_outcome' AND o.event_at >= s.event_at)
UNION ALL SELECT 'Unattributed activation requests', COUNT(*) FROM design_events WHERE event_name = 'builder_signup_experiment_unattributed'
UNION ALL SELECT 'Assignment or acceptance unavailable', COUNT(*) FROM design_events WHERE event_name = 'auth.builder_signup_experiment_unavailable'
UNION ALL SELECT 'Activation unavailable', COUNT(*) FROM design_events WHERE event_name = 'builder_signup_experiment_activation_unavailable'`,
  };
}
