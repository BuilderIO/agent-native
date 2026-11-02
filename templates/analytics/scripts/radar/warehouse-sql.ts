import { radarEventLabelSql } from "./event-labels.ts";

const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const CAMPAIGN_APPS = [
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

export function bigQueryIdentityExclusionSql(input: {
  emailExpression: string;
  identityExpression: string;
  hostnameExpression: string;
}): string {
  const email = `lower(coalesce(${input.emailExpression}, ''))`;
  const identity = `lower(coalesce(${input.identityExpression}, ''))`;
  const hostname = `lower(coalesce(${input.hostnameExpression}, ''))`;
  const excludedAddress = (expression: string) =>
    `(${[
      `regexp_contains(${expression}, r'@(?:[^@.]+\\.)*builder\\.io$')`,
      `regexp_contains(${expression}, r'@(?:[^@.]+\\.)*agent-native\\.com$')`,
      `regexp_contains(${expression}, r'@(?:[^@.]+\\.)*mailosaur\\.net$')`,
      `${expression} LIKE '%@yopmail%'`,
      `${expression} LIKE '%@%.yopmail.%'`,
      `regexp_contains(${expression}, r'@(?:[^@.]+\\.)*emalupe\\.com$')`,
      `regexp_contains(${expression}, r'@(?:[^@.]+\\.)*westcast-systems\\.com$')`,
      `regexp_contains(${expression}, r'^svc-[^@]*@service\\.')`,
      `${expression} IN ('dev@local.test', 'local' || '@localhost')`,
      `${expression} LIKE '%@test.local'`,
      `${expression} LIKE '%@agent-native.test'`,
      `regexp_contains(${expression}, r'.*qa.*@example\\.com$')`,
      `strpos(${expression}, '+autoz') > 0`,
    ].join(" OR ")})`;
  return [
    `NOT ${excludedAddress(email)}`,
    `NOT ${excludedAddress(identity)}`,
    `NOT starts_with(${identity}, '__organization__:')`,
    `NOT starts_with(${hostname}, 'beta.')`,
    `${hostname} NOT IN ('localhost', '127.0.0.1', '::1')`,
  ].join("\n  AND ");
}

function normalizedAppSql(alias: string): string {
  const raw = `lower(coalesce(
    nullif(${alias}.template, ''),
    nullif(json_value(${alias}.properties, '$.templateId'), ''),
    nullif(json_value(${alias}.properties, '$.agent_native_template'), ''),
    nullif(json_value(${alias}.properties, '$.agentNativeTemplate'), ''),
    nullif(${alias}.app, ''),
    nullif(json_value(${alias}.properties, '$.agent_native_app'), ''),
    nullif(json_value(${alias}.properties, '$.agentNativeApp'), ''),
    'unknown'
  ))`;
  return `CASE
    WHEN ${raw} = 'beta-design' OR starts_with(${raw}, 'beta-design-') THEN 'design'
    WHEN ${raw} = 'beta-slides' OR starts_with(${raw}, 'beta-slides-') THEN 'slides'
    WHEN ${raw} = 'beta-clips' OR starts_with(${raw}, 'beta-clips-') THEN 'clips'
    ELSE regexp_replace(${raw}, r'^beta-', '')
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

export function bigQueryFirstTouchEventsCte(
  eventsTableRange: string,
  params: {
    startDateParam?: string;
    endDateParam?: string;
    orgIdParam?: string;
    includeAllApps?: boolean;
    eventNames?: readonly string[];
    columns?: {
      id?: boolean;
      eventDate?: boolean;
      sessionId?: boolean;
      url?: boolean;
      personKey?: boolean;
      identityEmail?: boolean;
      referralSource?: boolean;
      properties?: boolean;
    };
  } = {},
): string {
  const startDate = params.startDateParam ?? "@start_date";
  const endDate = params.endDateParam ?? "@end_date";
  const orgId = params.orgIdParam ?? "@org_id";
  const normalizedApp = normalizedAppSql("e");
  const app = params.includeAllApps
    ? campaignAppSql(normalizedApp)
    : normalizedApp;
  const identityEmail = `coalesce(
    if(strpos(coalesce(e.user_id, ''), '@') > 0, lower(trim(e.user_id)), null),
    if(strpos(coalesce(json_value(e.properties, '$.user_email'), ''), '@') > 0,
      lower(trim(json_value(e.properties, '$.user_email'))), null),
    if(strpos(coalesce(json_value(e.properties, '$.userEmail'), ''), '@') > 0,
      lower(trim(json_value(e.properties, '$.userEmail'))), null),
    if(strpos(coalesce(json_value(e.properties, '$.email'), ''), '@') > 0,
      lower(trim(json_value(e.properties, '$.email'))), null),
    if(strpos(coalesce(json_value(e.properties, '$.test_identity_email'), ''), '@') > 0,
      lower(trim(json_value(e.properties, '$.test_identity_email'))), null),
    if(strpos(coalesce(json_value(e.context, '$.traits.email'), ''), '@') > 0,
      lower(trim(json_value(e.context, '$.traits.email'))), null),
    if(strpos(coalesce(e.user_key, ''), '@') > 0, lower(trim(e.user_key)), null)
  )`;
  const identity = `coalesce(
    nullif(json_value(e.properties, '$.auth_user_id'), ''),
    nullif(e.user_key, ''),
    nullif(e.user_id, ''),
    nullif(e.anonymous_id, '')
  )`;
  const filters = bigQueryIdentityExclusionSql({
    emailExpression: identityEmail,
    identityExpression: identity,
    hostnameExpression: "e.hostname",
  });
  const appFilter = params.includeAllApps
    ? `lower(${app}) <> 'unknown'`
    : `lower(${app}) IN ('design', 'slides', 'clips')`;
  const eventNameFilter = params.eventNames?.length
    ? `AND e.event_name IN (${params.eventNames
        .map((eventName) => `'${eventName.split("'").join("''")}'`)
        .join(", ")})`
    : "";
  const columns = {
    id: params.columns?.id ?? true,
    eventDate: params.columns?.eventDate ?? true,
    sessionId: params.columns?.sessionId ?? true,
    url: params.columns?.url ?? true,
    personKey: params.columns?.personKey ?? true,
    identityEmail: params.columns?.identityEmail ?? true,
    referralSource: params.columns?.referralSource ?? true,
    properties: params.columns?.properties ?? true,
  };
  const selectedColumns = [
    ...(columns.id ? ["e.id"] : []),
    "e.event_name",
    ...(columns.eventDate ? ["e.event_date"] : []),
    "e.timestamp AS happened_at",
    ...(columns.sessionId ? ["e.session_id"] : []),
    ...(columns.url ? ["e.url"] : []),
    ...(columns.personKey ? [`${identity} AS person_key`] : []),
    ...(columns.identityEmail ? [`${identityEmail} AS identity_email`] : []),
    `${app} AS app`,
    ...(columns.referralSource
      ? [
          `replace(coalesce(json_value(e.properties, '$.referral_source'), ''), '${ZERO_WIDTH_SPACE}', '') AS referral_source`,
        ]
      : []),
    ...(columns.properties ? ["e.properties AS properties"] : []),
  ];
  return `WITH base_events AS (
  SELECT ${selectedColumns.join(",\n    ")}
  FROM ${eventsTableRange}(${startDate}, ${endDate}) AS e
  WHERE e.event_date >= ${startDate}
    AND e.event_date <= ${endDate}
    AND e.org_id = ${orgId}
    AND ${appFilter}
    ${eventNameFilter}
    AND ${filters}
)
`;
}

export function buildBigQueryEventStatsSql(
  eventsTableRange: string,
  bucket: "DAY" | "HOUR" | "BOTH",
  eventNames?: readonly string[],
): string {
  const eventBucketSql =
    bucket === "BOTH"
      ? `event_buckets AS (
  SELECT base_events.*,
    timestamp_trunc(happened_at, DAY, 'UTC') AS day_bucket,
    timestamp_trunc(happened_at, HOUR, 'UTC') AS hour_bucket
  FROM base_events
),`
      : `event_buckets AS (
  SELECT base_events.*,
    timestamp_trunc(happened_at, ${bucket}, 'UTC') AS period_start
  FROM base_events
),`;
  const eventStatsPeriodSql =
    bucket === "BOTH"
      ? `CASE WHEN GROUPING(hour_bucket) = 1 THEN day_bucket ELSE hour_bucket END AS period_start,
    IF(GROUPING(hour_bucket) = 1, 'daily', 'hourly') AS period_grain,`
      : "period_start,";
  const eventStatsGroupSql =
    bucket === "BOTH"
      ? "GROUP BY GROUPING SETS ((day_bucket, hour_bucket, app, event_name), (day_bucket, app, event_name))"
      : "GROUP BY period_start, app, event_name";

  return `${bigQueryFirstTouchEventsCte(eventsTableRange, {
    ...(eventNames ? { eventNames } : {}),
    columns: {
      id: false,
      eventDate: false,
      sessionId: true,
      url: false,
      personKey: true,
      identityEmail: false,
      referralSource: false,
      properties: true,
    },
  })},
new_signups AS (
  SELECT person_key, min(happened_at) AS signup_at
  FROM base_events
  WHERE event_name = 'signup' AND person_key IS NOT NULL
  GROUP BY person_key
),
${eventBucketSql}
event_stats AS (
  SELECT ${eventStatsPeriodSql}
    app, event_name,
    count(*) AS events,
    count(DISTINCT person_key) AS users,
    count(DISTINCT session_id) AS sessions,
    countif(event_name IN ('generation_started', 'design_prompt_submitted')
      AND EXISTS (SELECT 1 FROM new_signups n WHERE n.person_key = event_buckets.person_key
        AND happened_at >= n.signup_at AND happened_at < timestamp_add(n.signup_at, INTERVAL 7 DAY))) AS new_user_run_events,
    countif(event_name IN ('generation_started', 'design_prompt_submitted')
      AND EXISTS (SELECT 1 FROM new_signups n WHERE n.person_key = event_buckets.person_key
        AND happened_at >= n.signup_at AND happened_at < timestamp_add(n.signup_at, INTERVAL 7 DAY))
      AND (lower(coalesce(json_value(properties, '$.llm_connection_source'), '')) = 'env'
        OR nullif(json_value(properties, '$.llm_connection_env_var'), '') IS NOT NULL)) AS new_user_env_events,
    countif(event_name IN ('generation_started', 'design_prompt_submitted')
      AND EXISTS (SELECT 1 FROM new_signups n WHERE n.person_key = event_buckets.person_key
        AND happened_at >= n.signup_at AND happened_at < timestamp_add(n.signup_at, INTERVAL 7 DAY))
      AND (json_value(properties, '$.llm_connection_source') IS NOT NULL
        OR json_value(properties, '$.llm_connection_env_var') IS NOT NULL)) AS new_user_source_events,
    countif(event_name IN ('generation_started', 'design_prompt_submitted')
      AND EXISTS (SELECT 1 FROM new_signups n WHERE n.person_key = event_buckets.person_key
        AND happened_at >= n.signup_at AND happened_at < timestamp_add(n.signup_at, INTERVAL 7 DAY))
      AND lower(coalesce(json_value(properties, '$.llm_connection'), '')) = 'none') AS new_user_no_connection_events,
    countif(event_name IN ('generation_started', 'generation_failed', 'design_prompt_submitted')
      AND (lower(coalesce(json_value(properties, '$.llm_connection_source'), '')) = 'env'
        OR nullif(json_value(properties, '$.llm_connection_env_var'), '') IS NOT NULL)) AS env_source_events,
    countif(event_name IN ('generation_started', 'generation_failed', 'design_prompt_submitted')
      AND (json_value(properties, '$.llm_connection_source') IS NOT NULL
        OR json_value(properties, '$.llm_connection_env_var') IS NOT NULL)) AS source_property_events,
    countif(event_name IN ('generation_started', 'design_prompt_submitted')
      AND lower(coalesce(json_value(properties, '$.llm_connection'), '')) = 'none') AS no_connection_events,
    countif(event_name = 'integration_setup_exposed'
      AND lower(coalesce(json_value(properties, '$.flow'), '')) = 'chat_setup') AS chat_setup_exposures,
    countif(event_name = 'generation_started'
      AND lower(coalesce(json_value(properties, '$.source'), json_value(properties, '$.flow'), '')) = 'empty_output_retry') AS empty_output_retry_starts,
    countif(event_name = 'generation_started'
      AND lower(coalesce(json_value(properties, '$.source'), json_value(properties, '$.flow'), '')) = 'new_deck_prompt') AS new_deck_prompt_starts,
    array_agg(DISTINCT if(event_name = 'signup',
      nullif(replace(coalesce(json_value(properties, '$.utm_campaign'), ''), '${ZERO_WIDTH_SPACE}', ''), ''),
      null) IGNORE NULLS) AS signup_campaigns,
    sum(if(event_name = 'action.response'
      AND coalesce(json_value(properties, '$.outcome'), '') NOT IN ('cancelled', 'suspended')
      AND NOT (coalesce(json_value(properties, '$.outcome'), '') = 'timeout'
        AND json_value(properties, '$.page_hidden') = 'true'),
      coalesce(safe_cast(json_value(properties, '$.sample_weight') AS FLOAT64),
        if(json_value(properties, '$.success') = 'true'
          AND coalesce(safe_cast(json_value(properties, '$.duration_ms') AS FLOAT64), 1000) < 1000
          AND coalesce(safe_cast(json_value(properties, '$.status_code') AS INT64), 200) < 400
          AND json_value(properties, '$.framework_ready_wait_ms') IS NULL
          AND json_value(properties, '$.startup_db_operation_wall_ms') IS NULL,
          10, 1)), 0)) AS action_weight,
    sum(if(event_name = 'action.response'
      AND coalesce(json_value(properties, '$.outcome'), '') NOT IN ('cancelled', 'suspended')
      AND NOT (coalesce(json_value(properties, '$.outcome'), '') = 'timeout'
        AND json_value(properties, '$.page_hidden') = 'true')
      AND coalesce(json_value(properties, '$.success'), '') = 'true',
      coalesce(safe_cast(json_value(properties, '$.sample_weight') AS FLOAT64),
        if(coalesce(safe_cast(json_value(properties, '$.duration_ms') AS FLOAT64), 1000) < 1000
          AND coalesce(safe_cast(json_value(properties, '$.status_code') AS INT64), 200) < 400
          AND json_value(properties, '$.framework_ready_wait_ms') IS NULL
          AND json_value(properties, '$.startup_db_operation_wall_ms') IS NULL,
          10, 1)), 0)) AS action_success_weight
  FROM event_buckets
  ${eventStatsGroupSql}
)
SELECT * FROM event_stats ORDER BY period_start, app, event_name`;
}

export function buildBigQueryFunnelDailySql(eventsTableRange: string): string {
  return `${bigQueryFirstTouchEventsCte(eventsTableRange, {
    columns: {
      id: false,
      eventDate: true,
      sessionId: false,
      url: false,
      personKey: true,
      identityEmail: false,
      referralSource: false,
      properties: true,
    },
  })},
signup_cohort AS (
  SELECT person_key, app, event_date AS signup_date, min(happened_at) AS signup_at,
    max(coalesce(json_value(properties, '$.first_touch_path'), '')) AS first_touch_path
  FROM base_events
  WHERE event_name = 'signup' AND person_key IS NOT NULL
  GROUP BY person_key, app, signup_date
  HAVING DATE_ADD(event_date, INTERVAL 2 DAY) <= DATE(@cutoff, 'UTC')
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
    min(if(e.event_name = 'onboarding_completed'
      AND e.happened_at >= c.signup_at
      AND e.happened_at < timestamp_add(c.signup_at, INTERVAL 24 HOUR), e.happened_at, null)) AS completed_at
  FROM signup_cohort c
  LEFT JOIN funnel_events e ON e.person_key = c.person_key AND e.app = c.app
  GROUP BY c.person_key, c.app, c.signup_date, c.signup_at, c.first_touch_path
),
entered_stages AS (
  SELECT s.*,
    min(if(e.event_name IN ('app_entered', 'onboarding_app_entered')
      AND e.happened_at >= s.completed_at
      AND e.happened_at < timestamp_add(s.signup_at, INTERVAL 24 HOUR), e.happened_at, null)) AS entered_at
  FROM stages s
  LEFT JOIN funnel_events e ON e.person_key = s.person_key AND e.app = s.app
  GROUP BY s.person_key, s.app, s.signup_date, s.signup_at, s.first_touch_path, s.completed_at
),
prompt_stages AS (
  SELECT s.*,
    min(if(((s.app = 'slides' AND e.event_name = 'generation_started') OR
      (s.app = 'design' AND e.event_name = 'design_prompt_submitted') OR
      (s.app = 'clips' AND e.event_name = 'recording_started'))
      AND e.happened_at >= s.entered_at
      AND e.happened_at < timestamp_add(s.signup_at, INTERVAL 24 HOUR), e.happened_at, null)) AS prompt_at
  FROM entered_stages s
  LEFT JOIN funnel_events e ON e.person_key = s.person_key AND e.app = s.app
  GROUP BY s.person_key, s.app, s.signup_date, s.signup_at,
    s.first_touch_path, s.completed_at, s.entered_at
),
output_stages AS (
  SELECT s.*,
    min(if(((s.app = 'slides' AND e.event_name = 'deck_created') OR
      (s.app = 'design' AND e.event_name = 'design_ready_viewed') OR
      (s.app = 'clips' AND e.event_name = 'recording_ready'))
      AND e.happened_at >= s.prompt_at
      AND e.happened_at < timestamp_add(s.signup_at, INTERVAL 24 HOUR), e.happened_at, null)) AS output_at
  FROM prompt_stages s
  LEFT JOIN funnel_events e ON e.person_key = s.person_key AND e.app = s.app
  GROUP BY s.person_key, s.app, s.signup_date, s.signup_at,
    s.first_touch_path, s.completed_at, s.entered_at, s.prompt_at
),
clips_activation AS (
  SELECT o.person_key, o.signup_date,
    logical_or(e.event_name = 'recording_ready'
      AND e.happened_at >= o.signup_at
      AND e.happened_at < timestamp_add(o.signup_at, INTERVAL 24 HOUR)) AS activated
  FROM output_stages o
  LEFT JOIN funnel_events e ON e.person_key = o.person_key AND e.app = 'clips'
  WHERE o.app = 'clips'
  GROUP BY o.person_key, o.signup_date
),
design_mcp_connected AS (
  SELECT c.person_key, c.signup_date, c.signup_at,
    min(if(e.event_name = 'agent_connected', e.happened_at, null)) AS connected_at
  FROM signup_cohort c
  LEFT JOIN base_events e ON e.person_key = c.person_key
    AND e.app = 'design' AND e.happened_at >= c.signup_at
    AND e.happened_at < timestamp_add(c.signup_at, INTERVAL 24 HOUR)
    AND e.event_name = 'agent_connected'
  WHERE c.app = 'design' AND c.first_touch_path LIKE '/mcp/oauth%'
  GROUP BY c.person_key, c.signup_date, c.signup_at
),
design_mcp_called AS (
  SELECT c.person_key, c.signup_date, c.signup_at, c.connected_at,
    min(if(e.event_name = '$mcp_tool_call', e.happened_at, null)) AS first_tool_call_at
  FROM design_mcp_connected c
  LEFT JOIN base_events e ON e.person_key = c.person_key
    AND e.app = 'design' AND e.happened_at >= c.connected_at
    AND e.happened_at < timestamp_add(c.signup_at, INTERVAL 24 HOUR)
    AND e.event_name = '$mcp_tool_call'
  GROUP BY c.person_key, c.signup_date, c.signup_at, c.connected_at
),
design_mcp_created AS (
  SELECT c.person_key, c.signup_date, c.connected_at, c.first_tool_call_at,
    logical_or(e.event_name = 'design_created') AS design_created
  FROM design_mcp_called c
  LEFT JOIN base_events e ON e.person_key = c.person_key
    AND e.app = 'design' AND e.happened_at >= c.first_tool_call_at
    AND e.happened_at < timestamp_add(c.signup_at, INTERVAL 24 HOUR)
    AND e.event_name = 'design_created'
  GROUP BY c.person_key, c.signup_date, c.connected_at, c.first_tool_call_at
),
design_mcp_daily AS (
  SELECT signup_date, count(*) AS signups,
    countif(connected_at IS NOT NULL) AS connected,
    countif(first_tool_call_at IS NOT NULL) AS first_tool_call,
    countif(design_created) AS design_created
  FROM design_mcp_created
  GROUP BY signup_date
),
counts AS (
  SELECT o.signup_date, o.app,
    IF(o.app = 'design', 'design_web', 'first_touch') AS journey_type,
    count(*) AS signups,
    countif(o.completed_at IS NOT NULL) AS completed,
    countif(o.entered_at IS NOT NULL) AS entered,
    countif(o.prompt_at IS NOT NULL) AS prompted,
    countif(o.output_at IS NOT NULL) AS output,
    countif(o.app = 'clips' AND coalesce(a.activated, false)) AS clips_activated_24h
  FROM output_stages o
  LEFT JOIN clips_activation a ON a.person_key = o.person_key AND a.signup_date = o.signup_date
  WHERE o.app <> 'design' OR o.first_touch_path NOT LIKE '/mcp/oauth%'
  GROUP BY o.signup_date, o.app, journey_type
),
durations AS (
  SELECT signup_date, app,
    timestamp_diff(output_at, prompt_at, MILLISECOND) / 1000.0 AS seconds
  FROM output_stages
  WHERE output_at IS NOT NULL AND prompt_at IS NOT NULL
    AND (app <> 'design' OR first_touch_path NOT LIKE '/mcp/oauth%')
),
percentiles AS (
  SELECT DISTINCT signup_date, app,
    percentile_cont(seconds, 0.9) OVER (PARTITION BY signup_date, app) AS prompt_output_p90_seconds
  FROM durations
)
SELECT c.*, p.prompt_output_p90_seconds
FROM counts c
LEFT JOIN percentiles p USING (signup_date, app)
UNION ALL
SELECT signup_date, 'design_mcp' AS app, 'design_mcp' AS journey_type,
  signups, connected AS completed, first_tool_call AS entered,
  0 AS prompted, design_created AS output, 0 AS clips_activated_24h,
  CAST(NULL AS FLOAT64) AS prompt_output_p90_seconds
FROM design_mcp_daily
ORDER BY signup_date, app`;
}

export function buildBigQueryPromptOutputSloSql(
  eventsTableRange: string,
): string {
  return `${bigQueryFirstTouchEventsCte(eventsTableRange, {
    columns: {
      id: false,
      eventDate: false,
      sessionId: false,
      url: false,
      personKey: true,
      identityEmail: false,
      referralSource: false,
      properties: false,
    },
  })},
prompts AS (
  SELECT person_key, app, min(happened_at) AS prompt_at
  FROM base_events
  WHERE person_key IS NOT NULL AND event_name IN (
    'generation_started', 'design_prompt_submitted', 'recording_started'
  )
  GROUP BY person_key, app
),
outputs AS (
  SELECT person_key, app, happened_at
  FROM base_events
  WHERE event_name IN ('deck_created', 'design_ready_viewed', 'recording_ready')
),
durations AS (
  SELECT p.app,
    timestamp_diff(min(o.happened_at), p.prompt_at, MILLISECOND) / 1000.0 AS seconds
  FROM prompts p
  JOIN outputs o ON o.person_key = p.person_key AND o.app = p.app
    AND o.happened_at >= p.prompt_at
  GROUP BY p.person_key, p.app, p.prompt_at
),
counts AS (SELECT app, count(*) AS sample_size FROM durations GROUP BY app),
percentiles AS (
  SELECT DISTINCT app, percentile_cont(seconds, 0.9) OVER (PARTITION BY app) AS p90_seconds
  FROM durations
)
SELECT c.app, c.sample_size, p.p90_seconds
FROM counts c JOIN percentiles p USING (app)
ORDER BY c.app`;
}

export function buildBigQueryPromptOutputSloByDateSql(
  eventsTableRange: string,
): string {
  return `${bigQueryFirstTouchEventsCte(eventsTableRange, {
    startDateParam: "@source_start_date",
    endDateParam: "@source_end_date",
    columns: {
      id: false,
      eventDate: false,
      sessionId: false,
      url: false,
      personKey: true,
      identityEmail: false,
      referralSource: false,
      properties: false,
    },
  })},
target_dates AS (
  SELECT target_date
  FROM UNNEST(GENERATE_DATE_ARRAY(@target_start_date, @target_end_date)) AS target_date
),
prompts AS (
  SELECT person_key, app, happened_at AS prompt_at
  FROM base_events
  WHERE person_key IS NOT NULL AND event_name IN (
    'generation_started', 'design_prompt_submitted', 'recording_started'
  )
),
outputs AS (
  SELECT person_key, app, happened_at
  FROM base_events
  WHERE event_name IN ('deck_created', 'design_ready_viewed', 'recording_ready')
),
target_prompts AS (
  SELECT d.target_date, p.person_key, p.app, min(p.prompt_at) AS prompt_at
  FROM target_dates d
  JOIN prompts p ON DATE(p.prompt_at, 'UTC') BETWEEN DATE_SUB(d.target_date, INTERVAL 6 DAY) AND d.target_date
  GROUP BY d.target_date, p.person_key, p.app
),
durations AS (
  SELECT p.target_date, p.person_key, p.app,
    timestamp_diff(min(o.happened_at), p.prompt_at, MILLISECOND) / 1000.0 AS seconds
  FROM target_prompts p
  JOIN outputs o ON o.person_key = p.person_key AND o.app = p.app
    AND o.happened_at >= p.prompt_at
    AND DATE(o.happened_at, 'UTC') <= p.target_date
  GROUP BY p.target_date, p.person_key, p.app, p.prompt_at
),
counts AS (
  SELECT target_date, app, count(*) AS sample_size
  FROM durations GROUP BY target_date, app
),
percentiles AS (
  SELECT DISTINCT target_date, app,
    percentile_cont(seconds, 0.9) OVER (PARTITION BY target_date, app) AS p90_seconds
  FROM durations
)
SELECT c.target_date, c.app, c.sample_size, p.p90_seconds
FROM counts c JOIN percentiles p USING (target_date, app)
ORDER BY c.target_date, c.app`;
}

export function buildBigQueryCampaignFollowupSql(
  eventsTableRange: string,
  hmacFunction: string,
): string {
  const functionParts = hmacFunction.split(".");
  if (
    functionParts.length !== 3 ||
    !/^[A-Za-z0-9_-]+$/.test(functionParts[0] ?? "") ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(functionParts[1] ?? "") ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(functionParts[2] ?? "")
  ) {
    throw new Error("A project.dataset.function HMAC identifier is required.");
  }
  const hmacFunctionSql = `\`${functionParts.join(".")}\``;
  return `${bigQueryFirstTouchEventsCte(eventsTableRange, {
    startDateParam: "@start_date",
    endDateParam: "@end_date",
    orgIdParam: "@org_id",
    includeAllApps: true,
    eventNames: [
      "pageview",
      "builder_connect_succeeded",
      "builder connect succeeded",
      "deck_created",
      "design_ready_viewed",
      "recording_ready",
    ],
    columns: {
      id: false,
      eventDate: true,
      sessionId: false,
      url: true,
      personKey: false,
      identityEmail: true,
      referralSource: false,
      properties: true,
    },
  })},
recipients AS (
  SELECT lower(json_value(sent, '$.email_hash')) AS email_hash,
    timestamp(json_value(sent, '$.sent_at')) AS sent_at,
    lower(coalesce(nullif(json_value(sent, '$.app'), ''), 'unknown')) AS recipient_app
  FROM UNNEST(JSON_QUERY_ARRAY(@recipients_json)) AS sent
),
recipient_totals AS (
  SELECT recipient_app, count(DISTINCT email_hash) AS recipients
  FROM recipients GROUP BY recipient_app
),
activity AS (
  SELECT r.email_hash, r.recipient_app, e.app AS activity_app, e.event_name,
    CASE WHEN e.happened_at >= r.sent_at THEN 'after_send' ELSE 'prior_7_days' END AS period,
    (e.event_name = 'pageview' AND (
      lower(replace(coalesce(json_value(e.properties, '$.utm_campaign'), ''), '${ZERO_WIDTH_SPACE}', '')) = 'outage_recovery_20261026'
      OR regexp_contains(concat(
        coalesce(json_value(e.properties, '$.search'), ''), '&',
        coalesce(e.url, ''), '&',
        coalesce(json_value(e.properties, '$.url'), '')
      ), r'(?i)(^|[?&#])utm_campaign=outage_recovery_20261026([&#]|$)')
    )) AS campaign_landing
  FROM recipients r
  JOIN base_events e
    ON ${hmacFunctionSql}(lower(trim(e.identity_email))) = r.email_hash
    AND e.happened_at >= timestamp_sub(r.sent_at, INTERVAL 7 DAY)
    AND e.happened_at <= current_timestamp()
),
measurements AS (
  SELECT period, recipient_app, activity_app, email_hash, measure.metric
  FROM activity
  CROSS JOIN UNNEST([
    STRUCT('any_visit' AS metric, event_name = 'pageview' AS matched),
    STRUCT('campaign_landing' AS metric, campaign_landing AS matched),
    STRUCT('builder_connect_succeeded' AS metric,
      event_name IN ('builder_connect_succeeded', 'builder connect succeeded') AS matched),
    STRUCT('first_output' AS metric,
      (activity_app = 'slides' AND event_name = 'deck_created') OR
      (activity_app = 'design' AND event_name = 'design_ready_viewed') OR
      (activity_app = 'clips' AND event_name = 'recording_ready') AS matched)
  ]) AS measure
  WHERE measure.matched
),
activity_apps AS (
  SELECT DISTINCT activity_app FROM (
    SELECT app AS activity_app FROM base_events
    UNION ALL SELECT recipient_app AS activity_app FROM recipients
    UNION ALL SELECT app AS activity_app FROM UNNEST([
      ${CAMPAIGN_APPS.map((name) => `'${name}'`).join(", ")}
    ]) AS app
  )
),
periods AS (
  SELECT period FROM UNNEST(['after_send', 'prior_7_days']) AS period
),
metrics AS (
  SELECT metric FROM UNNEST([
    'any_visit', 'campaign_landing', 'builder_connect_succeeded', 'first_output'
  ]) AS metric
),
counts AS (
  SELECT period, recipient_app, activity_app, metric,
    count(DISTINCT email_hash) AS recipients_with_activity
  FROM measurements GROUP BY period, recipient_app, activity_app, metric
)
SELECT p.period, t.recipient_app, a.activity_app, m.metric, t.recipients,
  coalesce(c.recipients_with_activity, 0) AS recipients_with_activity
FROM recipient_totals t
CROSS JOIN activity_apps a
CROSS JOIN periods p
CROSS JOIN metrics m
LEFT JOIN counts c ON c.period = p.period AND c.recipient_app = t.recipient_app
  AND c.activity_app = a.activity_app AND c.metric = m.metric
ORDER BY t.recipient_app, p.period, a.activity_app, m.metric`;
}

export function buildBigQueryUploadRejectionSql(
  eventsTableRange: string,
): string {
  return `${bigQueryFirstTouchEventsCte(eventsTableRange, {
    includeAllApps: true,
    eventNames: ["session_replay_upload_rejected"],
    columns: {
      id: false,
      eventDate: true,
      sessionId: true,
      url: false,
      personKey: false,
      identityEmail: false,
      referralSource: false,
      properties: true,
    },
  })},
rejected AS (
  SELECT event_date, app,
    lower(coalesce(json_value(properties, '$.failure_reason'), 'unknown')) AS reason,
    lower(coalesce(json_value(properties, '$.status'), json_value(properties, '$.status_code'), 'unknown')) AS status,
    count(DISTINCT nullif(session_id, '')) AS rejected_recorders,
    countif(session_id IS NULL OR session_id = '') AS unidentified_rejections,
    ifnull(
      array_agg(DISTINCT nullif(session_id, '') IGNORE NULLS),
      ARRAY<STRING>[]
    ) AS rejected_session_ids
  FROM base_events
  WHERE event_name = 'session_replay_upload_rejected'
  GROUP BY event_date, app, reason, status
)
SELECT event_date, app, reason, status, rejected_recorders, unidentified_rejections,
  rejected_session_ids
FROM rejected
ORDER BY app, rejected_recorders DESC`;
}

export function buildBigQueryTriageEventsSql(eventsTableRange: string): string {
  return `${bigQueryFirstTouchEventsCte(eventsTableRange, {
    startDateParam: "@event_start_date",
    endDateParam: "@event_end_date",
    orgIdParam: "@org_id",
    columns: {
      id: false,
      eventDate: false,
      sessionId: true,
      url: false,
      personKey: false,
      identityEmail: false,
      referralSource: false,
      properties: false,
    },
  })},
signup_sessions AS (
  SELECT session_id, app, min(happened_at) AS signup_at
  FROM base_events
  WHERE event_name = 'signup' AND nullif(session_id, '') IS NOT NULL
    AND happened_at >= @window_start AND happened_at < @window_end
  GROUP BY session_id, app
),
session_events AS (
  SELECT s.session_id, s.app, s.signup_at, e.event_name,
    min(e.happened_at) AS first_at, count(*) AS event_count
  FROM signup_sessions s
  JOIN base_events e ON e.session_id = s.session_id AND e.app = s.app
    AND e.happened_at >= s.signup_at AND e.happened_at < @window_end
  GROUP BY s.session_id, s.app, s.signup_at, e.event_name
),
session_summary AS (
  SELECT s.session_id, s.app, s.signup_at,
    logical_or(e.event_name IN ('generation_started', 'design_prompt_submitted')) AS prompted,
    logical_or(e.event_name = 'recording_started') AS recording_started,
    logical_or(e.event_name IN ('deck_created', 'design_ready_viewed', 'recording_ready')) AS output_ready,
    logical_or(e.event_name = 'onboarding_abandoned') AS onboarding_abandoned,
    string_agg(if(e.event_name != 'pageview',
      format('%s +%ds x%d', ${radarEventLabelSql("e.event_name")},
        greatest(0, timestamp_diff(e.first_at, s.signup_at, SECOND)), e.event_count), null),
      ' | ' ORDER BY e.first_at LIMIT 18) AS timeline
  FROM signup_sessions s
  JOIN session_events e ON e.session_id = s.session_id
  GROUP BY s.session_id, s.app, s.signup_at
)
SELECT session_id, app, signup_at, prompted, recording_started, output_ready,
  onboarding_abandoned, coalesce(timeline, '') AS timeline
FROM session_summary
ORDER BY CASE
    WHEN prompted AND NOT output_ready THEN 1
    WHEN recording_started AND NOT output_ready THEN 2
    WHEN onboarding_abandoned THEN 3
    WHEN output_ready THEN 8
    ELSE 9
  END, signup_at DESC
LIMIT 500`;
}
