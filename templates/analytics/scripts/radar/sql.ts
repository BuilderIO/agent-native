import { radarEventLabelSql } from "./event-labels.ts";

const APPS = ["design", "slides", "clips"] as const;
export const CAMPAIGN_APPS = [
  "analytics",
  "assets",
  "brain",
  "calendar",
  "chat",
  "clips",
  "content",
  "design",
  "dispatch",
  "docs",
  "forms",
  "mail",
  "plan",
  "slides",
  "www",
  "other",
] as const;

export interface FirstTouchSqlParams {
  startDate?: string;
  endDate?: string;
  orgId?: string;
  includeAllApps?: boolean;
}

export function identityExclusionSql(input: {
  emailExpression: string;
  identityExpression: string;
  hostnameExpression: string;
}): string {
  const email = `lower(coalesce(${input.emailExpression}, ''))`;
  const identity = `lower(coalesce(${input.identityExpression}, ''))`;
  const hostname = `lower(coalesce(${input.hostnameExpression}, ''))`;
  const excludedAddress = (expression: string) =>
    `(${[
      `${expression} LIKE '%@builder.io'`,
      `${expression} LIKE '%@%.builder.io'`,
      `${expression} LIKE '%@agent-native.com'`,
      `${expression} LIKE '%@%.agent-native.com'`,
      `${expression} LIKE '%@mailosaur.net'`,
      `${expression} LIKE '%@%.mailosaur.net'`,
      `${expression} LIKE '%@yopmail'`,
      `${expression} LIKE '%@yopmail.%'`,
      `${expression} LIKE '%@%.yopmail.%'`,
      `${expression} LIKE '%@emalupe.com'`,
      `${expression} LIKE '%@%.emalupe.com'`,
      `${expression} LIKE '%@westcast-systems.com'`,
      `${expression} LIKE '%@%.westcast-systems.com'`,
      `${expression} LIKE 'svc-%@service.%'`,
      `${expression} IN ('dev@local.test', 'local' || '@localhost')`,
      `${expression} LIKE '%@test.local'`,
      `${expression} LIKE '%@agent-native.test'`,
      `${expression} LIKE '%qa%@example.com'`,
      `position('+autoz' in ${expression}) > 0`,
    ].join(" OR ")})`;

  return [
    `NOT ${excludedAddress(email)}`,
    `NOT ${excludedAddress(identity)}`,
    `position('__organization__:' in ${identity}) <> 1`,
    `${hostname} NOT LIKE 'beta.%'`,
    `${hostname} NOT IN ('localhost', '127.0.0.1', '::1')`,
  ].join("\n  AND ");
}

export function referralSourceSql(expression: string): string {
  return `replace(coalesce(${expression}, ''), '${String.fromCharCode(0x200b)}', '')`;
}

export function normalizedAppSql(input: {
  templateExpression: string;
  appExpression: string;
  propertiesExpression?: string;
}): string {
  const properties = input.propertiesExpression;
  const propertyTemplate = properties
    ? `nullif(${properties}::jsonb ->> 'templateId', ''),
    nullif(${properties}::jsonb ->> 'agent_native_template', ''),
    nullif(${properties}::jsonb ->> 'agentNativeTemplate', ''),`
    : "";
  const propertyApp = properties
    ? `nullif(${properties}::jsonb ->> 'agent_native_app', ''),
    nullif(${properties}::jsonb ->> 'agentNativeApp', ''),`
    : "";
  const raw = `lower(coalesce(
    nullif(${input.templateExpression}, ''),
    ${propertyTemplate}
    nullif(${input.appExpression}, ''),
    ${propertyApp}
    'unknown'
  ))`;
  return `CASE
    WHEN ${raw} = 'beta-design' OR ${raw} LIKE 'beta-design-%' THEN 'design'
    WHEN ${raw} = 'beta-slides' OR ${raw} LIKE 'beta-slides-%' THEN 'slides'
    WHEN ${raw} = 'beta-clips' OR ${raw} LIKE 'beta-clips-%' THEN 'clips'
    ELSE regexp_replace(${raw}, '^beta-', '')
  END`;
}

function campaignAppSql(expression: string): string {
  const app = `lower(${expression})`;
  const knownApps = CAMPAIGN_APPS.filter((name) => name !== "other");
  return `CASE
    WHEN ${app} = 'plans' THEN 'plan'
    WHEN ${app} IN (${knownApps.map((name) => `'${name}'`).join(", ")}) THEN ${app}
    ELSE 'other'
  END`;
}

export function buildFirstTouchEventsCte(
  params: FirstTouchSqlParams = {},
): string {
  const startDate = params.startDate ?? "$1";
  const endDate = params.endDate ?? "$2";
  const orgId = params.orgId ?? "$3";
  const normalizedApp = normalizedAppSql({
    templateExpression: "e.template",
    appExpression: "e.app",
    propertiesExpression: "e.properties",
  });
  const app = params.includeAllApps
    ? campaignAppSql(normalizedApp)
    : normalizedApp;
  const email = `coalesce(
    CASE WHEN nullif(e.user_id, '') LIKE '%@%.%' THEN lower(trim(e.user_id)) END,
    CASE WHEN nullif(e.properties::jsonb ->> 'user_email', '') LIKE '%@%.%'
      THEN lower(trim(e.properties::jsonb ->> 'user_email')) END,
    CASE WHEN nullif(e.properties::jsonb ->> 'userEmail', '') LIKE '%@%.%'
      THEN lower(trim(e.properties::jsonb ->> 'userEmail')) END,
    CASE WHEN nullif(e.properties::jsonb ->> 'email', '') LIKE '%@%.%'
      THEN lower(trim(e.properties::jsonb ->> 'email')) END,
    CASE WHEN nullif(e.properties::jsonb ->> 'test_identity_email', '') LIKE '%@%.%'
      THEN lower(trim(e.properties::jsonb ->> 'test_identity_email')) END,
    CASE WHEN nullif(e.context::jsonb -> 'traits' ->> 'email', '') LIKE '%@%.%'
      THEN lower(trim(e.context::jsonb -> 'traits' ->> 'email')) END,
    CASE WHEN nullif(e.user_key, '') LIKE '%@%.%' THEN lower(trim(e.user_key)) END
  )`;
  const identity = `coalesce(
    nullif(e.properties::jsonb ->> 'auth_user_id', ''),
    nullif(e.user_key, ''),
    nullif(e.user_id, ''),
    nullif(e.anonymous_id, '')
  )`;
  const filters = identityExclusionSql({
    emailExpression: email,
    identityExpression: identity,
    hostnameExpression: "e.hostname",
  });
  const appFilter = params.includeAllApps
    ? `lower(${app}) <> 'unknown'`
    : `lower(${app}) IN (${APPS.map((name) => `'${name}'`).join(", ")})`;

  return `WITH base_events AS (
  SELECT
    e.id,
    e.event_name,
    e.event_date,
    e.timestamp::timestamptz AS happened_at,
    e.session_id,
    e.url,
    ${identity} AS person_key,
    ${email} AS identity_email,
    ${app} AS app,
    ${referralSourceSql("e.properties::jsonb ->> 'referral_source'")} AS referral_source,
    e.properties::jsonb AS properties
  FROM analytics_events e
  WHERE e.event_date >= ${startDate}
    AND e.event_date <= ${endDate}
    AND e.org_id = ${orgId}
    AND ${appFilter}
    AND ${filters}
)
`;
}

export function firstTouchApps(): readonly string[] {
  return APPS;
}

export const FIRST_TOUCH_EVENT_NAMES = [
  "signup",
  "pageview",
  "onboarding_started",
  "onboarding_completed",
  "onboarding_app_entered",
  "app_entered",
  "integration_setup_exposed",
  "builder_connect_started",
  "builder connect started",
  "builder_connect_succeeded",
  "builder connect succeeded",
  "builder_connect_failed",
  "builder connect failed",
  "generation_started",
  "generation_failed",
  "generation_completed",
  "new_deck_prompt",
  "empty_output_retry",
  "deck_created",
  "design_prompt_submitted",
  "design_ready_viewed",
  "design_output_created",
  "recording_started",
  "recording_ready",
  "clips_local_recording_saved",
  "session_replay_upload_rejected",
  "action.response",
] as const;

export const FIRST_TOUCH_OUTPUT_EVENTS = {
  slides: "deck_created",
  design: "design_ready_viewed",
  clips: "recording_ready",
} as const;

export function buildEventStatsSql(): string {
  return `${buildFirstTouchEventsCte({ startDate: "$1", endDate: "$2", orgId: "$3" })},
new_signups AS (
  SELECT person_key, min(happened_at) AS signup_at
  FROM base_events
  WHERE event_name = 'signup' AND person_key IS NOT NULL
  GROUP BY person_key
),
event_stats AS (
  SELECT
    date_trunc($4, happened_at) AS period_start,
    app,
    event_name,
    count(*)::int AS events,
    count(DISTINCT person_key)::int AS users,
    count(DISTINCT session_id)::int AS sessions,
    count(*) FILTER (WHERE event_name IN ('generation_started', 'design_prompt_submitted')
      AND EXISTS (SELECT 1 FROM new_signups n WHERE n.person_key = base_events.person_key
        AND happened_at >= n.signup_at AND happened_at < n.signup_at + interval '7 days'))::int AS new_user_run_events,
    count(*) FILTER (WHERE event_name IN ('generation_started', 'design_prompt_submitted')
      AND EXISTS (SELECT 1 FROM new_signups n WHERE n.person_key = base_events.person_key
        AND happened_at >= n.signup_at AND happened_at < n.signup_at + interval '7 days')
      AND (lower(coalesce(properties ->> 'llm_connection_source', '')) = 'env'
        OR nullif(properties ->> 'llm_connection_env_var', '') IS NOT NULL))::int AS new_user_env_events,
    count(*) FILTER (WHERE event_name IN ('generation_started', 'design_prompt_submitted')
      AND EXISTS (SELECT 1 FROM new_signups n WHERE n.person_key = base_events.person_key
        AND happened_at >= n.signup_at AND happened_at < n.signup_at + interval '7 days')
      AND (properties ? 'llm_connection_source' OR properties ? 'llm_connection_env_var'))::int AS new_user_source_events,
    count(*) FILTER (WHERE event_name IN ('generation_started', 'design_prompt_submitted')
      AND EXISTS (SELECT 1 FROM new_signups n WHERE n.person_key = base_events.person_key
        AND happened_at >= n.signup_at AND happened_at < n.signup_at + interval '7 days')
      AND lower(coalesce(properties ->> 'llm_connection', '')) = 'none')::int AS new_user_no_connection_events,
    count(*) FILTER (WHERE event_name IN ('generation_started', 'generation_failed', 'design_prompt_submitted')
      AND (lower(coalesce(properties ->> 'llm_connection_source', '')) = 'env'
        OR nullif(properties ->> 'llm_connection_env_var', '') IS NOT NULL))::int AS env_source_events,
    count(*) FILTER (WHERE event_name IN ('generation_started', 'generation_failed', 'design_prompt_submitted')
      AND (properties ? 'llm_connection_source' OR properties ? 'llm_connection_env_var'))::int AS source_property_events,
    count(*) FILTER (WHERE event_name IN ('generation_started', 'design_prompt_submitted')
      AND lower(coalesce(properties ->> 'llm_connection', '')) = 'none')::int AS no_connection_events,
    count(*) FILTER (WHERE event_name = 'integration_setup_exposed'
      AND lower(coalesce(properties ->> 'flow', '')) = 'chat_setup')::int AS chat_setup_exposures,
    count(*) FILTER (WHERE event_name = 'generation_started'
      AND lower(coalesce(properties ->> 'source', properties ->> 'flow', '')) = 'empty_output_retry')::int AS empty_output_retry_starts,
    count(*) FILTER (WHERE event_name = 'generation_started'
      AND lower(coalesce(properties ->> 'source', properties ->> 'flow', '')) = 'new_deck_prompt')::int AS new_deck_prompt_starts,
    array_agg(DISTINCT nullif(replace(coalesce(properties ->> 'utm_campaign', ''), '${String.fromCharCode(0x200b)}', ''), ''))
      FILTER (WHERE event_name = 'signup' AND nullif(properties ->> 'utm_campaign', '') IS NOT NULL) AS signup_campaigns,
    sum(CASE
      WHEN nullif(properties ->> 'sample_weight', '') IS NOT NULL
        THEN (properties ->> 'sample_weight')::numeric
      WHEN coalesce(properties ->> 'success', '') = 'true'
        AND coalesce((properties ->> 'duration_ms')::numeric, 1000) < 1000
        AND coalesce((properties ->> 'status_code')::int, 200) < 400
        AND nullif(properties ->> 'framework_ready_wait_ms', '') IS NULL
        AND nullif(properties ->> 'startup_db_operation_wall_ms', '') IS NULL
        THEN 10 ELSE 1 END
    ) FILTER (WHERE event_name = 'action.response'
      AND coalesce(properties ->> 'outcome', '') NOT IN ('cancelled', 'suspended')
      AND NOT (coalesce(properties ->> 'outcome', '') = 'timeout'
        AND properties ->> 'page_hidden' = 'true')) AS action_weight,
    sum(CASE
      WHEN nullif(properties ->> 'sample_weight', '') IS NOT NULL
        THEN (properties ->> 'sample_weight')::numeric
      WHEN coalesce(properties ->> 'success', '') = 'true'
        AND coalesce((properties ->> 'duration_ms')::numeric, 1000) < 1000
        AND coalesce((properties ->> 'status_code')::int, 200) < 400
        AND nullif(properties ->> 'framework_ready_wait_ms', '') IS NULL
        AND nullif(properties ->> 'startup_db_operation_wall_ms', '') IS NULL
        THEN 10 ELSE 1 END
    ) FILTER (WHERE event_name = 'action.response'
      AND coalesce(properties ->> 'outcome', '') NOT IN ('cancelled', 'suspended')
      AND NOT (coalesce(properties ->> 'outcome', '') = 'timeout'
        AND properties ->> 'page_hidden' = 'true')
      AND coalesce(properties ->> 'success', '') = 'true') AS action_success_weight
  FROM base_events
  GROUP BY 1, 2, 3
)
SELECT * FROM event_stats ORDER BY period_start, app, event_name`;
}

export function buildFunnelDailySql(): string {
  return `${buildFirstTouchEventsCte({ startDate: "$1", endDate: "$2", orgId: "$3" })},
signup_cohort AS (
  SELECT person_key, app, event_date AS signup_date, min(happened_at) AS signup_at,
    max(coalesce(properties::jsonb ->> 'first_touch_path', '')) AS first_touch_path
  FROM base_events
  WHERE event_name = 'signup' AND person_key IS NOT NULL
  GROUP BY person_key, app, event_date
  HAVING min(happened_at) + interval '24 hours' <= $4::timestamptz
),
funnel_events AS (
  SELECT person_key, app, event_name, happened_at
  FROM base_events
  WHERE event_name IN (
    'onboarding_completed', 'app_entered', 'onboarding_app_entered',
    'generation_started', 'deck_created', 'design_prompt_submitted',
    'design_ready_viewed', 'recording_started', 'recording_ready',
    'agent_connected', '$mcp_tool_call', 'design_created'
  )
),
stages AS (
  SELECT c.person_key, c.app, c.signup_date, c.signup_at, c.first_touch_path,
    min(e.happened_at) FILTER (WHERE e.event_name = 'onboarding_completed'
      AND e.happened_at >= c.signup_at
      AND e.happened_at < c.signup_at + interval '24 hours') AS completed_at
  FROM signup_cohort c
  LEFT JOIN funnel_events e ON e.person_key = c.person_key AND e.app = c.app
  GROUP BY c.person_key, c.app, c.signup_date, c.signup_at, c.first_touch_path
),
entered_stages AS (
  SELECT s.*,
    min(e.happened_at) FILTER (WHERE e.event_name = 'onboarding_app_entered'
      AND e.happened_at >= s.completed_at
      AND e.happened_at < s.signup_at + interval '24 hours') AS entered_at
  FROM stages s
  LEFT JOIN funnel_events e ON e.person_key = s.person_key AND e.app = s.app
  GROUP BY s.person_key, s.app, s.signup_date, s.signup_at, s.first_touch_path, s.completed_at
),
prompt_stages AS (
  SELECT s.*,
    min(e.happened_at) FILTER (WHERE
      (s.app = 'slides' AND e.event_name = 'generation_started') OR
      (s.app = 'design' AND e.event_name = 'design_prompt_submitted') OR
      (s.app = 'clips' AND e.event_name = 'recording_started')
    ) AS prompt_at
  FROM entered_stages s
  LEFT JOIN funnel_events e ON e.person_key = s.person_key AND e.app = s.app
    AND e.happened_at >= s.entered_at
    AND e.happened_at < s.signup_at + interval '24 hours'
  GROUP BY s.person_key, s.app, s.signup_date, s.signup_at,
    s.first_touch_path, s.completed_at, s.entered_at
),
output_stages AS (
  SELECT s.*,
    min(e.happened_at) FILTER (WHERE
      (s.app = 'slides' AND e.event_name = 'deck_created') OR
      (s.app = 'design' AND e.event_name = 'design_ready_viewed') OR
      (s.app = 'clips' AND e.event_name = 'recording_ready')
    ) AS output_at
  FROM prompt_stages s
  LEFT JOIN funnel_events e ON e.person_key = s.person_key AND e.app = s.app
    AND e.happened_at >= s.prompt_at
    AND e.happened_at < s.signup_at + interval '24 hours'
  GROUP BY s.person_key, s.app, s.signup_date, s.signup_at,
    s.first_touch_path, s.completed_at, s.entered_at, s.prompt_at
),
clips_activation AS (
  SELECT o.person_key, o.signup_date,
    bool_or(e.event_name = 'recording_ready'
      AND e.happened_at >= o.signup_at
      AND e.happened_at < o.signup_at + interval '24 hours') AS activated
  FROM output_stages o
  LEFT JOIN funnel_events e ON e.person_key = o.person_key AND e.app = 'clips'
  WHERE o.app = 'clips'
  GROUP BY o.person_key, o.signup_date
),
design_mcp_connected AS (
  SELECT c.person_key, c.signup_date, c.signup_at,
    min(e.happened_at) FILTER (WHERE e.event_name = 'agent_connected') AS connected_at
  FROM signup_cohort c
  LEFT JOIN base_events e ON e.person_key = c.person_key
    AND e.app = 'design' AND e.happened_at >= c.signup_at
    AND e.event_name = 'agent_connected'
  WHERE c.app = 'design' AND c.first_touch_path LIKE '/mcp/oauth%'
  GROUP BY c.person_key, c.signup_date, c.signup_at
),
design_mcp_called AS (
  SELECT c.person_key, c.signup_date, c.signup_at, c.connected_at,
    min(e.happened_at) FILTER (WHERE e.event_name = '$mcp_tool_call') AS first_tool_call_at
  FROM design_mcp_connected c
  LEFT JOIN base_events e ON e.person_key = c.person_key
    AND e.app = 'design' AND e.happened_at >= c.connected_at
    AND e.event_name = '$mcp_tool_call'
  GROUP BY c.person_key, c.signup_date, c.signup_at, c.connected_at
),
design_mcp_created AS (
  SELECT c.person_key, c.signup_date, c.connected_at, c.first_tool_call_at,
    bool_or(e.event_name = 'design_created') AS design_created
  FROM design_mcp_called c
  LEFT JOIN base_events e ON e.person_key = c.person_key
    AND e.app = 'design' AND e.happened_at >= c.first_tool_call_at
    AND e.event_name = 'design_created'
  GROUP BY c.person_key, c.signup_date, c.connected_at, c.first_tool_call_at
),
design_mcp_daily AS (
  SELECT signup_date, count(*)::int AS signups,
    count(*) FILTER (WHERE connected_at IS NOT NULL)::int AS connected,
    count(*) FILTER (WHERE first_tool_call_at IS NOT NULL)::int AS first_tool_call,
    count(*) FILTER (WHERE design_created)::int AS design_created
  FROM design_mcp_created
  GROUP BY signup_date
)
SELECT o.signup_date, o.app,
  CASE WHEN o.app = 'design' THEN 'design_web' ELSE 'first_touch' END AS journey_type,
  count(*)::int AS signups,
  count(*) FILTER (WHERE o.completed_at IS NOT NULL)::int AS completed,
  count(*) FILTER (WHERE o.entered_at IS NOT NULL)::int AS entered,
  count(*) FILTER (WHERE o.prompt_at IS NOT NULL)::int AS prompted,
  count(*) FILTER (WHERE o.output_at IS NOT NULL)::int AS output,
  percentile_cont(0.9) WITHIN GROUP (
    ORDER BY extract(epoch FROM o.output_at - o.prompt_at)
  ) FILTER (WHERE o.prompt_at IS NOT NULL AND o.output_at IS NOT NULL) AS prompt_output_p90_seconds,
  count(*) FILTER (WHERE o.app = 'clips' AND coalesce(c.activated, false))::int AS clips_activated_24h
FROM output_stages o
LEFT JOIN clips_activation c ON c.person_key = o.person_key AND c.signup_date = o.signup_date
WHERE o.app <> 'design' OR o.first_touch_path NOT LIKE '/mcp/oauth%'
GROUP BY o.signup_date, o.app
UNION ALL
SELECT signup_date, 'design_mcp' AS app, 'design_mcp' AS journey_type,
  sum(signups)::int AS signups, sum(connected)::int AS completed,
  sum(first_tool_call)::int AS entered, 0::int AS prompted,
  sum(design_created)::int AS output, null::numeric AS prompt_output_p90_seconds,
  0::int AS clips_activated_24h
FROM design_mcp_daily
GROUP BY signup_date
ORDER BY signup_date, app`;
}

function recorderIdentityFilters(alias: string): string {
  return identityExclusionSql({
    emailExpression: `coalesce(
      CASE WHEN nullif(${alias}.user_id, '') LIKE '%@%.%' THEN ${alias}.user_id END,
      CASE WHEN nullif(${alias}.user_key, '') LIKE '%@%.%' THEN ${alias}.user_key END
    )`,
    identityExpression: `coalesce(nullif(${alias}.user_key, ''), nullif(${alias}.user_id, ''), nullif(${alias}.anonymous_id, ''))`,
    hostnameExpression: `${alias}.hostname`,
  });
}

function recorderAppSql(alias: string): string {
  return normalizedAppSql({
    templateExpression: `${alias}.template`,
    appExpression: `${alias}.app`,
  });
}

export function buildTroubleSql(): string {
  const app = recorderAppSql("r");
  return `WITH recordings AS (
  SELECT r.session_id, ${app} AS app
  FROM session_recordings r
  WHERE r.org_id = $3
    AND r.started_at::timestamptz >= $1::date
    AND r.started_at::timestamptz < ($2::date + interval '1 day')
    AND ${recorderIdentityFilters("r")}
    AND lower(${app}) IN ('design', 'slides', 'clips')
), denominator AS (
  SELECT app, count(DISTINCT session_id)::int AS sessions
  FROM recordings GROUP BY app
), pair_counts AS (
  SELECT r.app, t.label AS action, coalesce(t.status, 'unknown') AS status,
    count(DISTINCT r.session_id)::int AS sessions_with_pair
  FROM recordings r
  JOIN analytics_session_trouble t ON t.session_id = r.session_id AND t.org_id = $3
  WHERE t.last_at::timestamptz >= $1::date
    AND t.last_at::timestamptz < ($2::date + interval '1 day')
  GROUP BY r.app, t.label, t.status
)
SELECT d.app, p.action, p.status,
  coalesce(p.sessions_with_pair, 0)::int AS sessions_with_pair,
  d.sessions AS sessions
FROM denominator d
LEFT JOIN pair_counts p ON p.app = d.app
ORDER BY d.app, sessions_with_pair DESC`;
}

export function buildUploadRejectionSql(): string {
  const app = recorderAppSql("r");
  return `${buildFirstTouchEventsCte({ startDate: "$1", endDate: "$2", orgId: "$3" })},
recorders AS (
  SELECT ${app} AS app, count(DISTINCT r.session_id)::int AS recorders
  FROM session_recordings r
  WHERE r.org_id = $3
    AND r.started_at::timestamptz >= $1::date
    AND r.started_at::timestamptz < ($2::date + interval '1 day')
    AND ${recorderIdentityFilters("r")}
    AND lower(${app}) IN ('design', 'slides', 'clips')
  GROUP BY ${app}
),
rejected AS (
  SELECT app,
    lower(coalesce(properties ->> 'failure_reason', 'unknown')) AS reason,
    lower(coalesce(properties ->> 'status', properties ->> 'status_code', 'unknown')) AS status,
    count(DISTINCT session_id)::int AS rejected_recorders
  FROM base_events
  WHERE event_name = 'session_replay_upload_rejected'
  GROUP BY app, reason, status
)
SELECT r.app, x.reason, x.status,
  coalesce(x.rejected_recorders, 0)::int AS rejected_recorders, r.recorders
FROM recorders r
LEFT JOIN rejected x ON r.app = x.app
ORDER BY r.app, rejected_recorders DESC`;
}

export function buildUploadRecorderCountsSql(): string {
  const app = recorderAppSql("r");
  return `SELECT ${app} AS app, count(DISTINCT r.session_id)::int AS recorders
FROM session_recordings r
WHERE r.org_id = $3
  AND r.started_at::timestamptz >= $1::date
  AND r.started_at::timestamptz < ($2::date + interval '1 day')
  AND ${recorderIdentityFilters("r")}
  AND lower(${app}) IN ('design', 'slides', 'clips')
GROUP BY ${app}`;
}

export function buildErrorIssuesSql(): string {
  const app = normalizedAppSql({
    templateExpression: "template",
    appExpression: "app",
  });
  return `SELECT ${app} AS app, id, users_affected, created_at
FROM error_issues
WHERE org_id = $1
  AND test_identity_only = false
  AND users_affected >= 5
  AND created_at::timestamptz >= $2::timestamptz
  AND created_at::timestamptz < $3::timestamptz
  AND lower(${app}) IN ('design', 'slides', 'clips')
ORDER BY users_affected DESC, created_at DESC`;
}

export function buildCampaignFollowupSql(): string {
  return `${buildFirstTouchEventsCte({ startDate: "$2", endDate: "$3", orgId: "$4", includeAllApps: true })},
recipients AS (
  SELECT lower(trim(email)) AS email, sent_at::timestamptz AS sent_at,
    lower(coalesce(nullif(app, ''), 'unknown')) AS recipient_app
  FROM jsonb_to_recordset($1::jsonb) AS sent(email text, sent_at text, app text)
),
recipient_totals AS (
  SELECT recipient_app, count(DISTINCT email)::int AS recipients
  FROM recipients GROUP BY recipient_app
),
activity AS (
  SELECT r.email, r.recipient_app, e.app AS activity_app, e.event_name,
    CASE WHEN e.happened_at >= r.sent_at THEN 'after_send' ELSE 'prior_7_days' END AS period,
    (e.event_name = 'pageview' AND (
      lower(replace(coalesce(e.properties ->> 'utm_campaign', ''), '${String.fromCharCode(0x200b)}', '')) = 'outage_recovery_20261026'
      OR concat_ws('&', e.properties ->> 'search', e.url, e.properties ->> 'url') ~*
        '(^|[?&#])utm_campaign=outage_recovery_20261026([&#]|$)'
    )) AS campaign_landing
  FROM recipients r
  JOIN base_events e ON lower(trim(e.identity_email)) = r.email
    AND e.happened_at >= r.sent_at - interval '7 days'
    AND e.happened_at <= now()
),
measurements AS (
  SELECT period, recipient_app, activity_app, email, measure.metric
  FROM activity
  CROSS JOIN LATERAL (VALUES
    ('any_visit', event_name = 'pageview'),
    ('campaign_landing', campaign_landing),
    ('builder_connect_succeeded', event_name IN ('builder_connect_succeeded', 'builder connect succeeded')),
    ('first_output',
      (activity_app = 'slides' AND event_name = 'deck_created') OR
      (activity_app = 'design' AND event_name = 'design_ready_viewed') OR
      (activity_app = 'clips' AND event_name = 'recording_ready'))
  ) AS measure(metric, matched)
  WHERE measure.matched
),
activity_apps AS (
  SELECT DISTINCT activity_app
  FROM (
    SELECT app AS activity_app FROM base_events
    UNION ALL SELECT recipient_app AS activity_app FROM recipients
    UNION ALL SELECT unnest(ARRAY[${CAMPAIGN_APPS.map((name) => `'${name}'`).join(", ")}]::text[])
  ) apps
),
periods AS (
  SELECT unnest(ARRAY['after_send', 'prior_7_days']::text[]) AS period
),
metrics AS (
  SELECT unnest(ARRAY['any_visit', 'campaign_landing', 'builder_connect_succeeded', 'first_output']::text[]) AS metric
),
counts AS (
  SELECT period, recipient_app, activity_app, metric,
    count(DISTINCT email)::int AS recipients_with_activity
  FROM measurements GROUP BY period, recipient_app, activity_app, metric
)
SELECT p.period, t.recipient_app, a.activity_app, m.metric, t.recipients,
  coalesce(c.recipients_with_activity, 0)::int AS recipients_with_activity
FROM recipient_totals t
CROSS JOIN activity_apps a
CROSS JOIN periods p
CROSS JOIN metrics m
LEFT JOIN counts c ON c.period = p.period AND c.recipient_app = t.recipient_app
  AND c.activity_app = a.activity_app AND c.metric = m.metric
ORDER BY t.recipient_app, p.period, a.activity_app, m.metric`;
}

export function buildTriageSql(): string {
  const recordingApp = recorderAppSql("r");
  return `${buildFirstTouchEventsCte({ startDate: "$1", endDate: "$2", orgId: "$3" })},
signup_sessions AS (
  SELECT session_id, app, min(happened_at) AS signup_at
  FROM base_events
  WHERE event_name = 'signup' AND nullif(session_id, '') IS NOT NULL
    AND happened_at >= $4::timestamptz AND happened_at < $5::timestamptz
  GROUP BY session_id, app
),
replay_sessions AS (
  SELECT r.id AS recording_id, r.session_id, ${recordingApp} AS app,
    row_number() OVER (PARTITION BY r.session_id ORDER BY r.started_at::timestamptz, r.id) AS recording_number
  FROM session_recordings r
  JOIN signup_sessions s ON s.session_id = r.session_id AND s.app = ${recordingApp}
  WHERE r.org_id = $3
    AND ${recorderIdentityFilters("r")}
),
session_events AS (
  SELECT s.session_id, s.app, s.signup_at, e.event_name,
    min(e.happened_at) AS first_at, count(*)::int AS event_count
  FROM signup_sessions s
  JOIN base_events e ON e.session_id = s.session_id AND e.app = s.app
    AND e.happened_at >= s.signup_at AND e.happened_at < $5::timestamptz
  GROUP BY s.session_id, s.app, s.signup_at, e.event_name
),
session_summary AS (
  SELECT s.session_id, s.app, s.signup_at,
    bool_or(e.event_name IN ('generation_started', 'design_prompt_submitted')) AS prompted,
    bool_or(e.event_name = 'recording_started') AS recording_started,
    bool_or(e.event_name IN ('deck_created', 'design_ready_viewed', 'recording_ready')) AS output_ready,
    bool_or(e.event_name = 'onboarding_abandoned') AS onboarding_abandoned,
    string_agg(
      format('%s +%ss x%s', ${radarEventLabelSql("e.event_name")},
        greatest(0, round(extract(epoch FROM e.first_at - s.signup_at))::int), e.event_count),
      ' | ' ORDER BY e.first_at
    ) FILTER (WHERE e.event_name NOT IN ('pageview') AND e.event_count > 0) AS timeline
  FROM signup_sessions s
  JOIN session_events e ON e.session_id = s.session_id
  GROUP BY s.session_id, s.app, s.signup_at
),
trouble_labels AS (
  SELECT t.session_id,
    string_agg(DISTINCT concat_ws(':', t.label, nullif(t.status, '')), ', ' ORDER BY concat_ws(':', t.label, nullif(t.status, ''))) AS labels
  FROM analytics_session_trouble t
  WHERE t.org_id = $3
    AND t.session_id IN (SELECT session_id FROM signup_sessions)
  GROUP BY t.session_id
),
friction AS (
  SELECT f.session_id, max(f.dead_clicks + f.error_toasts + f.retry_loops + f.error_then_leave + f.stalled_requests) AS signals
  FROM session_recording_friction f
  WHERE f.org_id = $3
    AND f.session_id IN (SELECT session_id FROM signup_sessions)
  GROUP BY f.session_id
),
indexed_timeline AS (
  SELECT limited.session_id,
    string_agg(
      format('%s +%ss x%d', ${radarEventLabelSql("limited.event_name")},
        greatest(0, round(extract(epoch FROM limited.first_at::timestamptz - limited.signup_at))::int), limited.event_count),
      ' | ' ORDER BY limited.first_at::timestamptz
    ) AS timeline
  FROM (
    SELECT s.session_id, s.signup_at, i.event_name, i.event_count, i.first_at,
      row_number() OVER (PARTITION BY s.session_id ORDER BY i.first_at::timestamptz) AS event_number
    FROM signup_sessions s
    JOIN analytics_session_events i ON i.session_id = s.session_id
      AND i.org_id = $3 AND i.app = s.app
      AND i.last_at::timestamptz >= s.signup_at
      AND i.first_at::timestamptz < $5::timestamptz
  ) limited
  WHERE limited.event_number <= 18
  GROUP BY limited.session_id
),
performance AS (
  SELECT p.session_id,
    max(p.max_ttfb_ms)::int AS max_ttfb_ms,
    max(p.max_lcp_ms)::int AS max_lcp_ms,
    max(p.max_inp_ms)::int AS max_inp_ms,
    max(p.slow_requests)::int AS slow_requests
  FROM analytics_session_performance p
  WHERE p.org_id = $3
    AND p.session_id IN (SELECT session_id FROM signup_sessions)
  GROUP BY p.session_id
)
SELECT s.session_id, r.recording_id, s.app,
  CASE
    WHEN s.prompted AND NOT s.output_ready THEN 'prompted_no_output'
    WHEN s.recording_started AND NOT s.output_ready THEN 'recording_started_no_ready_clip'
    WHEN s.onboarding_abandoned THEN 'onboarding_abandoned'
    WHEN s.output_ready THEN 'output_ready'
    ELSE 'no_prompt_or_output'
  END AS outcome,
  coalesce(t.labels, '') AS trouble_labels,
  coalesce(f.signals, 0)::int AS friction_signals,
  concat_ws(', ',
    CASE WHEN p.max_ttfb_ms IS NOT NULL THEN 'max TTFB ' || p.max_ttfb_ms || 'ms' END,
    CASE WHEN p.max_lcp_ms IS NOT NULL THEN 'max LCP ' || p.max_lcp_ms || 'ms' END,
    CASE WHEN p.max_inp_ms IS NOT NULL THEN 'max INP ' || p.max_inp_ms || 'ms' END,
    CASE WHEN p.slow_requests > 0 THEN p.slow_requests || ' slow requests' END
  ) AS performance_summary,
  coalesce(i.timeline, s.timeline, '') AS timeline
FROM session_summary s
LEFT JOIN replay_sessions r ON r.session_id = s.session_id AND r.app = s.app
  AND r.recording_number = 1
LEFT JOIN trouble_labels t ON t.session_id = s.session_id
LEFT JOIN friction f ON f.session_id = s.session_id
LEFT JOIN indexed_timeline i ON i.session_id = s.session_id
LEFT JOIN performance p ON p.session_id = s.session_id
ORDER BY CASE
    WHEN s.prompted AND NOT s.output_ready THEN 1
    WHEN s.recording_started AND NOT s.output_ready THEN 2
    WHEN s.onboarding_abandoned THEN 3
    WHEN s.output_ready THEN 8
    ELSE 9
  END,
  s.signup_at DESC
LIMIT 30`;
}

export function buildTriageMetadataSql(): string {
  const recordingApp = recorderAppSql("r");
  return `WITH signup_sessions AS (
  SELECT session_id, app, signup_at::timestamptz AS signup_at
  FROM jsonb_to_recordset($1::jsonb) AS s(session_id text, app text, signup_at text)
), replay_ranked AS (
  SELECT r.id AS recording_id, r.session_id, ${recordingApp} AS app,
    row_number() OVER (PARTITION BY r.session_id ORDER BY r.started_at::timestamptz, r.id) AS recording_number
  FROM session_recordings r
  JOIN signup_sessions s ON s.session_id = r.session_id AND s.app = ${recordingApp}
  WHERE r.org_id = $2 AND ${recorderIdentityFilters("r")}
), trouble_labels AS (
  SELECT t.session_id,
    string_agg(DISTINCT concat_ws(':', t.label, nullif(t.status, '')), ', ' ORDER BY concat_ws(':', t.label, nullif(t.status, ''))) AS labels
  FROM analytics_session_trouble t
  WHERE t.org_id = $2 AND t.session_id IN (SELECT session_id FROM signup_sessions)
  GROUP BY t.session_id
), friction AS (
  SELECT f.session_id,
    max(coalesce(f.dead_clicks, 0) + coalesce(f.error_toasts, 0) + coalesce(f.retry_loops, 0) + coalesce(f.error_then_leave, 0) + coalesce(f.stalled_requests, 0))::int AS signals
  FROM session_recording_friction f
  WHERE f.org_id = $2 AND f.session_id IN (SELECT session_id FROM signup_sessions)
  GROUP BY f.session_id
), limited_index AS (
  SELECT s.session_id, s.signup_at, i.event_name, i.event_count, i.first_at,
    row_number() OVER (PARTITION BY s.session_id ORDER BY i.first_at::timestamptz) AS event_number
  FROM signup_sessions s
  JOIN analytics_session_events i ON i.session_id = s.session_id AND i.org_id = $2 AND i.app = s.app
    AND i.last_at::timestamptz >= s.signup_at
    AND i.first_at::timestamptz < $3::timestamptz
), indexed_timeline AS (
  SELECT session_id,
    string_agg(format('%s +%ss x%s', ${radarEventLabelSql("event_name")},
      greatest(0, round(extract(epoch FROM first_at::timestamptz - signup_at))::int), event_count),
      ' | ' ORDER BY first_at::timestamptz) AS timeline
  FROM limited_index WHERE event_number <= 18
  GROUP BY session_id
), performance AS (
  SELECT p.session_id,
    max(p.max_ttfb_ms)::int AS max_ttfb_ms, max(p.max_lcp_ms)::int AS max_lcp_ms,
    max(p.max_inp_ms)::int AS max_inp_ms, max(p.slow_requests)::int AS slow_requests
  FROM analytics_session_performance p
  WHERE p.org_id = $2 AND p.session_id IN (SELECT session_id FROM signup_sessions)
  GROUP BY p.session_id
)
SELECT s.session_id, coalesce(r.recording_id, '') AS recording_id, s.app,
  coalesce(t.labels, '') AS trouble_labels, coalesce(f.signals, 0)::int AS friction_signals,
  concat_ws(', ',
    CASE WHEN p.max_ttfb_ms IS NOT NULL THEN 'max TTFB ' || p.max_ttfb_ms || 'ms' END,
    CASE WHEN p.max_lcp_ms IS NOT NULL THEN 'max LCP ' || p.max_lcp_ms || 'ms' END,
    CASE WHEN p.max_inp_ms IS NOT NULL THEN 'max INP ' || p.max_inp_ms || 'ms' END,
    CASE WHEN p.slow_requests > 0 THEN p.slow_requests || ' slow requests' END
  ) AS performance_summary,
  coalesce(i.timeline, '') AS indexed_timeline
FROM signup_sessions s
LEFT JOIN replay_ranked r ON r.session_id = s.session_id AND r.app = s.app AND r.recording_number = 1
LEFT JOIN trouble_labels t ON t.session_id = s.session_id
LEFT JOIN friction f ON f.session_id = s.session_id
LEFT JOIN indexed_timeline i ON i.session_id = s.session_id
LEFT JOIN performance p ON p.session_id = s.session_id`;
}

export function buildPromptOutputSloSql(): string {
  return `${buildFirstTouchEventsCte({ startDate: "$1", endDate: "$2", orgId: "$3" })},
prompts AS (
  SELECT person_key, app, min(happened_at) AS prompt_at
  FROM base_events
  WHERE person_key IS NOT NULL AND event_name IN (
    'generation_started', 'design_prompt_submitted', 'recording_started'
  )
  GROUP BY person_key, app
),
outputs AS (
  SELECT person_key, app, happened_at, event_name
  FROM base_events
  WHERE event_name IN ('deck_created', 'design_ready_viewed', 'recording_ready')
),
durations AS (
  SELECT p.app, extract(epoch FROM min(o.happened_at) - p.prompt_at) AS seconds
  FROM prompts p
  JOIN outputs o ON o.person_key = p.person_key AND o.app = p.app
    AND o.happened_at >= p.prompt_at
  GROUP BY p.person_key, p.app, p.prompt_at
)
SELECT app, count(*)::int AS sample_size,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY seconds) AS p90_seconds
FROM durations
GROUP BY app
ORDER BY app`;
}
