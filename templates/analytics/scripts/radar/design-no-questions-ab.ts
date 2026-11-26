import {
  RadarQueryError,
  resolveRadarBigQueryEventsTable,
  resolveRadarFirstPartyBackend,
  resolveRadarOrganizationId,
  runBigQuery,
  runPostgresQuery,
} from "./query.ts";
import { buildFirstTouchEventsCte } from "./sql.ts";
import { bigQueryFirstTouchEventsCte } from "./warehouse-sql.ts";

export const DESIGN_NO_QUESTIONS_EXPERIMENT_ID = "design_no_questions";
export const DESIGN_NO_QUESTIONS_VARIANTS = [
  "control",
  "no_questions",
] as const;
const DEFAULT_START = "2026-10-27";
const BASELINE_READY_RATE = 0.596;
const TARGET_READY_RATE = BASELINE_READY_RATE + 0.1;

export interface DesignNoQuestionsArm {
  variant: (typeof DESIGN_NO_QUESTIONS_VARIANTS)[number];
  exposed: number;
  promptJoined: number;
  mature24h: number;
  ready24h: {
    users: number;
    rate: number | null;
    ci95: [number, number] | null;
  };
  firstTurnReady24h: {
    users: number;
    denominator: number;
    rate: number | null;
  };
  timeToReady24hMs: { users: number; p50: number | null; p90: number | null };
  postReadyFollowUp24h: {
    users: number;
    denominator: number;
    rate: number | null;
  };
  completedExport24h: {
    users: number;
    denominator: number;
    rate: number | null;
  };
  mature1to7d: number;
  return1to7d: { users: number; denominator: number; rate: number | null };
}

export interface DesignNoQuestionsReadout {
  experiment: typeof DESIGN_NO_QUESTIONS_EXPERIMENT_ID;
  startDate: string;
  endDate: string;
  dataCutoff: string;
  primaryBaseline: number;
  targetLift: number;
  sampleNeededPerArm: number;
  sampleNeededTotal: number;
  signupAssignmentFailures: number;
  arms: DesignNoQuestionsArm[];
  generatedAt: string;
}

const POSTGRES_AB_BODY_SQL = `exposure_rows AS (
  SELECT person_key,
    properties ->> 'experiment_variant' AS variant,
    nullif(properties ->> 'turn_id', '') AS exposed_turn_id,
    happened_at AS exposed_at,
    row_number() OVER (PARTITION BY person_key ORDER BY happened_at, id) AS exposure_number
  FROM base_events
  WHERE app = 'design' AND event_name = 'agent_experiment_exposed'
    AND properties ->> 'experiment_id' = 'design_no_questions'
    AND properties ->> 'experiment_variant' IN ('control', 'no_questions')
    AND properties ->> 'telemetry_origin' = 'server'
    AND person_key IS NOT NULL
    AND event_date BETWEEN $1 AND $2
    AND happened_at <= $4::timestamptz
),
exposures AS (
  SELECT person_key, variant, exposed_at, exposed_turn_id
  FROM exposure_rows WHERE exposure_number = 1
),
assignment_failures AS (
  SELECT count(DISTINCT person_key)::int AS signup_assignment_failures
  FROM base_events
  WHERE app = 'design' AND event_name = 'agent_experiment_assignment_failed'
    AND properties ->> 'experiment_id' = 'design_no_questions'
    AND properties ->> 'failure_stage' = 'signup'
    AND properties ->> 'telemetry_origin' = 'server'
    AND event_date BETWEEN $1 AND $2
    AND happened_at <= $4::timestamptz
),
prompts AS (
  SELECT e.id, e.person_key, e.happened_at,
    nullif(e.properties ->> 'turn_id', '') AS turn_id,
    (string_to_array(e.properties ->> 'experiment_variants', ','))[
      assignment.assignment_index
    ] AS variant
  FROM base_events e
  CROSS JOIN LATERAL unnest(
    string_to_array(e.properties ->> 'experiment_ids', ',')
  ) WITH ORDINALITY AS assignment(experiment_id, assignment_index)
  WHERE e.app = 'design' AND e.event_name = '$ai_generation'
    AND e.properties ->> 'telemetry_origin' = 'server'
    AND assignment.experiment_id = 'design_no_questions'
    AND (string_to_array(e.properties ->> 'experiment_variants', ','))[
      assignment.assignment_index
    ] IN ('control', 'no_questions')
    AND e.person_key IS NOT NULL
    AND e.happened_at <= $4::timestamptz
),
cohort AS (
  SELECT x.person_key, x.variant, x.exposed_at, x.exposed_turn_id,
    min(p.happened_at) AS first_prompt_at
  FROM exposures x
  LEFT JOIN prompts p ON p.person_key = x.person_key
    AND p.variant = x.variant AND p.turn_id = x.exposed_turn_id
  GROUP BY x.person_key, x.variant, x.exposed_at, x.exposed_turn_id
),
anchors AS (
  SELECT *, coalesce(first_prompt_at, exposed_at) AS anchor_at,
    (coalesce(first_prompt_at, exposed_at) + interval '24 hours' <= $4::timestamptz) AS mature_24h,
    (coalesce(first_prompt_at, exposed_at) + interval '8 days' <= $4::timestamptz) AS mature_1to7d
  FROM cohort
),
ready_events AS (
  SELECT a.person_key, a.exposed_turn_id, e.id, e.happened_at,
    e.properties ->> 'output_id' AS output_id,
    nullif(e.properties ->> 'turn_id', '') AS turn_id
  FROM anchors a
  JOIN base_events e ON e.person_key = a.person_key
    AND e.app = 'design' AND e.event_name = 'design_ready_viewed'
    AND e.happened_at >= a.anchor_at
    AND e.happened_at < a.anchor_at + interval '24 hours'
    AND e.happened_at <= $4::timestamptz
    AND e.properties ->> 'telemetry_origin' = 'client'
    AND e.properties ->> 'is_owner' = 'true'
    AND CASE
      WHEN (e.properties ->> 'screen_count') ~ '^[0-9]{1,9}$'
        THEN (e.properties ->> 'screen_count')::int > 0
      ELSE false
    END
    AND nullif(e.properties ->> 'output_id', '') IS NOT NULL
),
ready AS (
  SELECT person_key,
    min(happened_at) AS ready_at,
    (array_agg(output_id ORDER BY happened_at, id))[1] AS output_id,
    (array_agg(turn_id ORDER BY happened_at, id))[1] AS ready_turn_id,
    bool_or(
      turn_id IS NOT NULL AND exposed_turn_id IS NOT NULL
        AND turn_id = exposed_turn_id
    ) AS first_turn_ready
  FROM ready_events
  GROUP BY person_key
),
ready_outputs AS (
  SELECT DISTINCT person_key, output_id
  FROM ready_events
),
post_ready_follow_ups AS (
  SELECT a.person_key, min(p.happened_at) AS follow_up_prompt_at
  FROM anchors a
  JOIN ready r ON r.person_key = a.person_key
  JOIN prompts p ON p.person_key = a.person_key
    AND p.variant = a.variant
    AND p.happened_at > r.ready_at
    AND p.happened_at < a.anchor_at + interval '24 hours'
    AND p.happened_at <= $4::timestamptz
    AND p.turn_id IS NOT NULL
    AND a.exposed_turn_id IS NOT NULL
    AND p.turn_id <> a.exposed_turn_id
    AND r.ready_turn_id IS NOT NULL
    AND p.turn_id <> r.ready_turn_id
  GROUP BY a.person_key
),
exports AS (
  SELECT a.person_key, min(e.happened_at) AS exported_at
  FROM anchors a
  JOIN ready_outputs r ON r.person_key = a.person_key
  JOIN base_events e ON e.person_key = a.person_key
    AND e.app = 'design' AND e.event_name = 'design_exported'
    AND e.happened_at >= a.anchor_at
    AND e.happened_at < a.anchor_at + interval '24 hours'
    AND e.happened_at <= $4::timestamptz
    AND e.properties ->> 'telemetry_origin' = 'server'
    AND e.properties ->> 'output_id' = r.output_id
    AND e.properties ->> 'status' = 'completed'
    AND e.properties ->> 'render_location' = 'server'
    AND e.properties ->> 'caller' = 'frontend'
  GROUP BY a.person_key
),
returns AS (
  SELECT a.person_key, min(e.happened_at) AS returned_at
  FROM anchors a
  JOIN base_events e ON e.person_key = a.person_key
    AND e.app = 'design' AND e.event_name IN ('pageview', 'app_entered')
    AND e.happened_at >= a.anchor_at + interval '24 hours'
    AND e.happened_at < a.anchor_at + interval '8 days'
    AND e.happened_at <= $4::timestamptz
  GROUP BY a.person_key
),
per_user AS (
  SELECT a.*, r.ready_at,
    coalesce(r.first_turn_ready, false) AS first_turn_ready,
    f.follow_up_prompt_at, x.exported_at, v.returned_at,
    CASE WHEN r.ready_at IS NULL THEN NULL
      ELSE extract(epoch FROM (r.ready_at - a.anchor_at)) * 1000 END AS time_to_ready_ms
  FROM anchors a
  LEFT JOIN ready r USING (person_key)
  LEFT JOIN post_ready_follow_ups f USING (person_key)
  LEFT JOIN exports x USING (person_key)
  LEFT JOIN returns v USING (person_key)
),
summary AS (
  SELECT variant,
    count(*)::int AS exposed,
    count(*) FILTER (WHERE first_prompt_at IS NOT NULL)::int AS prompt_joined,
    count(*) FILTER (WHERE mature_24h)::int AS mature_24h,
    count(*) FILTER (WHERE mature_24h AND ready_at IS NOT NULL)::int AS ready_24h,
    count(*) FILTER (WHERE mature_24h AND first_turn_ready)::int AS first_turn_ready_24h,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY time_to_ready_ms)
      FILTER (WHERE mature_24h AND ready_at IS NOT NULL) AS time_p50_ms,
    percentile_cont(0.9) WITHIN GROUP (ORDER BY time_to_ready_ms)
      FILTER (WHERE mature_24h AND ready_at IS NOT NULL) AS time_p90_ms,
    count(*) FILTER (WHERE mature_24h AND follow_up_prompt_at IS NOT NULL)::int AS post_ready_follow_up_24h,
    count(*) FILTER (WHERE mature_24h AND exported_at IS NOT NULL)::int AS completed_export_24h,
    count(*) FILTER (WHERE mature_1to7d)::int AS mature_1to7d,
    count(*) FILTER (WHERE mature_1to7d AND returned_at IS NOT NULL)::int AS return_1to7d
  FROM per_user GROUP BY variant
),
variants AS (
  SELECT unnest(ARRAY['control', 'no_questions']::text[]) AS variant
)
SELECT v.variant,
  coalesce(s.exposed, 0) AS exposed,
  coalesce(s.prompt_joined, 0) AS prompt_joined,
  coalesce(s.mature_24h, 0) AS mature_24h,
  coalesce(s.ready_24h, 0) AS ready_24h,
  coalesce(s.first_turn_ready_24h, 0) AS first_turn_ready_24h,
  s.time_p50_ms,
  s.time_p90_ms,
  coalesce(s.post_ready_follow_up_24h, 0) AS post_ready_follow_up_24h,
  coalesce(s.completed_export_24h, 0) AS completed_export_24h,
  coalesce(s.mature_1to7d, 0) AS mature_1to7d,
  coalesce(s.return_1to7d, 0) AS return_1to7d,
  f.signup_assignment_failures
FROM variants v
LEFT JOIN summary s USING (variant)
CROSS JOIN assignment_failures f
ORDER BY v.variant`;

// raw-sql-ok: composes the shared static first-touch CTE helper with static query SQL; all runtime values stay bound as $1-$4.
const POSTGRES_AB_SQL = [
  buildFirstTouchEventsCte({
    startDate: "$1",
    endDate: "to_char($4::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')",
    orgId: "$3",
    includeAllApps: true,
  }),
  POSTGRES_AB_BODY_SQL,
].join(",\n");

const BIGQUERY_AB_BODY_SQL = `exposure_rows AS (
  SELECT person_key,
    json_value(properties, '$.experiment_variant') AS variant,
    nullif(json_value(properties, '$.turn_id'), '') AS exposed_turn_id,
    happened_at AS exposed_at,
    row_number() OVER (PARTITION BY person_key ORDER BY happened_at, id) AS exposure_number
  FROM base_events
  WHERE app = 'design' AND event_name = 'agent_experiment_exposed'
    AND json_value(properties, '$.experiment_id') = 'design_no_questions'
    AND json_value(properties, '$.experiment_variant') IN ('control', 'no_questions')
    AND json_value(properties, '$.telemetry_origin') = 'server'
    AND person_key IS NOT NULL
    AND event_date BETWEEN @start_date AND @end_date
    AND happened_at <= @as_of
),
exposures AS (
  SELECT person_key, variant, exposed_at, exposed_turn_id
  FROM exposure_rows WHERE exposure_number = 1
),
assignment_failures AS (
  SELECT count(DISTINCT person_key) AS signup_assignment_failures
  FROM base_events
  WHERE app = 'design' AND event_name = 'agent_experiment_assignment_failed'
    AND json_value(properties, '$.experiment_id') = 'design_no_questions'
    AND json_value(properties, '$.failure_stage') = 'signup'
    AND json_value(properties, '$.telemetry_origin') = 'server'
    AND event_date BETWEEN @start_date AND @end_date
    AND happened_at <= @as_of
),
prompts AS (
  SELECT e.id, e.person_key, e.happened_at,
    nullif(json_value(e.properties, '$.turn_id'), '') AS turn_id,
    SPLIT(json_value(e.properties, '$.experiment_variants'), ',')[
      SAFE_OFFSET(assignment_index)
    ] AS variant
  FROM base_events e
  CROSS JOIN UNNEST(SPLIT(json_value(e.properties, '$.experiment_ids'), ','))
    AS experiment_id WITH OFFSET AS assignment_index
  WHERE e.app = 'design' AND e.event_name = '$ai_generation'
    AND json_value(e.properties, '$.telemetry_origin') = 'server'
    AND experiment_id = 'design_no_questions'
    AND SPLIT(json_value(e.properties, '$.experiment_variants'), ',')[
      SAFE_OFFSET(assignment_index)
    ] IN ('control', 'no_questions')
    AND e.person_key IS NOT NULL
    AND e.happened_at <= @as_of
),
cohort AS (
  SELECT x.person_key, x.variant, x.exposed_at, x.exposed_turn_id,
    min(p.happened_at) AS first_prompt_at
  FROM exposures x
  LEFT JOIN prompts p ON p.person_key = x.person_key AND p.variant = x.variant
    AND p.turn_id = x.exposed_turn_id
  GROUP BY x.person_key, x.variant, x.exposed_at, x.exposed_turn_id
),
anchors AS (
  SELECT *, coalesce(first_prompt_at, exposed_at) AS anchor_at,
    timestamp_add(coalesce(first_prompt_at, exposed_at), INTERVAL 24 HOUR) <= @as_of AS mature_24h,
    timestamp_add(coalesce(first_prompt_at, exposed_at), INTERVAL 8 DAY) <= @as_of AS mature_1to7d
  FROM cohort
),
ready_events AS (
  SELECT a.person_key, a.exposed_turn_id, e.id, e.happened_at,
    json_value(e.properties, '$.output_id') AS output_id,
    nullif(json_value(e.properties, '$.turn_id'), '') AS turn_id
  FROM anchors a
  JOIN base_events e ON e.person_key = a.person_key
    AND e.app = 'design' AND e.event_name = 'design_ready_viewed'
    AND e.happened_at >= a.anchor_at
    AND e.happened_at < timestamp_add(a.anchor_at, INTERVAL 24 HOUR)
    AND e.happened_at <= @as_of
    AND json_value(e.properties, '$.telemetry_origin') = 'client'
    AND json_value(e.properties, '$.is_owner') = 'true'
    AND safe_cast(json_value(e.properties, '$.screen_count') AS INT64) > 0
    AND nullif(json_value(e.properties, '$.output_id'), '') IS NOT NULL
),
ready AS (
  SELECT person_key,
    first_ready.happened_at AS ready_at,
    first_ready.output_id AS output_id,
    first_ready.turn_id AS ready_turn_id,
    first_turn_ready
  FROM (
    SELECT person_key,
      ARRAY_AGG(STRUCT(
        happened_at AS happened_at,
        id AS id,
        output_id AS output_id,
        turn_id AS turn_id
      ) ORDER BY happened_at, id LIMIT 1)[SAFE_OFFSET(0)] AS first_ready,
      logical_or(
        turn_id IS NOT NULL AND exposed_turn_id IS NOT NULL
          AND turn_id = exposed_turn_id
      ) AS first_turn_ready
    FROM ready_events
    GROUP BY person_key
  )
),
ready_outputs AS (
  SELECT DISTINCT person_key, output_id
  FROM ready_events
),
post_ready_follow_ups AS (
  SELECT a.person_key, min(p.happened_at) AS follow_up_prompt_at
  FROM anchors a
  JOIN ready r ON r.person_key = a.person_key
  JOIN prompts p ON p.person_key = a.person_key
    AND p.variant = a.variant
    AND p.happened_at > r.ready_at
    AND p.happened_at < timestamp_add(a.anchor_at, INTERVAL 24 HOUR)
    AND p.happened_at <= @as_of
    AND p.turn_id IS NOT NULL
    AND a.exposed_turn_id IS NOT NULL
    AND p.turn_id <> a.exposed_turn_id
    AND r.ready_turn_id IS NOT NULL
    AND p.turn_id <> r.ready_turn_id
  GROUP BY a.person_key
),
exports AS (
  SELECT a.person_key, min(e.happened_at) AS exported_at
  FROM anchors a
  JOIN ready_outputs r ON r.person_key = a.person_key
  JOIN base_events e ON e.person_key = a.person_key
    AND e.app = 'design' AND e.event_name = 'design_exported'
    AND e.happened_at >= a.anchor_at
    AND e.happened_at < timestamp_add(a.anchor_at, INTERVAL 24 HOUR)
    AND e.happened_at <= @as_of
    AND json_value(e.properties, '$.telemetry_origin') = 'server'
    AND json_value(e.properties, '$.output_id') = r.output_id
    AND json_value(e.properties, '$.status') = 'completed'
    AND json_value(e.properties, '$.render_location') = 'server'
    AND json_value(e.properties, '$.caller') = 'frontend'
  GROUP BY a.person_key
),
returns AS (
  SELECT a.person_key, min(e.happened_at) AS returned_at
  FROM anchors a
  JOIN base_events e ON e.person_key = a.person_key
    AND e.app = 'design' AND e.event_name IN ('pageview', 'app_entered')
    AND e.happened_at >= timestamp_add(a.anchor_at, INTERVAL 24 HOUR)
    AND e.happened_at < timestamp_add(a.anchor_at, INTERVAL 8 DAY)
    AND e.happened_at <= @as_of
  GROUP BY a.person_key
),
per_user AS (
  SELECT a.*, r.ready_at,
    coalesce(r.first_turn_ready, false) AS first_turn_ready,
    f.follow_up_prompt_at, x.exported_at, v.returned_at,
    if(r.ready_at IS NULL, NULL, timestamp_diff(r.ready_at, a.anchor_at, MILLISECOND)) AS time_to_ready_ms
  FROM anchors a
  LEFT JOIN ready r USING (person_key)
  LEFT JOIN post_ready_follow_ups f USING (person_key)
  LEFT JOIN exports x USING (person_key)
  LEFT JOIN returns v USING (person_key)
),
summary AS (
  SELECT variant,
    count(*) AS exposed,
    countif(first_prompt_at IS NOT NULL) AS prompt_joined,
    countif(mature_24h) AS mature_24h,
    countif(mature_24h AND ready_at IS NOT NULL) AS ready_24h,
    countif(mature_24h AND first_turn_ready) AS first_turn_ready_24h,
    approx_quantiles(if(mature_24h AND ready_at IS NOT NULL, time_to_ready_ms, NULL), 100)[SAFE_OFFSET(50)] AS time_p50_ms,
    approx_quantiles(if(mature_24h AND ready_at IS NOT NULL, time_to_ready_ms, NULL), 100)[SAFE_OFFSET(90)] AS time_p90_ms,
    countif(mature_24h AND follow_up_prompt_at IS NOT NULL) AS post_ready_follow_up_24h,
    countif(mature_24h AND exported_at IS NOT NULL) AS completed_export_24h,
    countif(mature_1to7d) AS mature_1to7d,
    countif(mature_1to7d AND returned_at IS NOT NULL) AS return_1to7d
  FROM per_user GROUP BY variant
),
variants AS (
  SELECT 'control' AS variant UNION ALL SELECT 'no_questions'
)
SELECT variants.variant,
  coalesce(summary.exposed, 0) AS exposed,
  coalesce(summary.prompt_joined, 0) AS prompt_joined,
  coalesce(summary.mature_24h, 0) AS mature_24h,
  coalesce(summary.ready_24h, 0) AS ready_24h,
  coalesce(summary.first_turn_ready_24h, 0) AS first_turn_ready_24h,
  summary.time_p50_ms,
  summary.time_p90_ms,
  coalesce(summary.post_ready_follow_up_24h, 0) AS post_ready_follow_up_24h,
  coalesce(summary.completed_export_24h, 0) AS completed_export_24h,
  coalesce(summary.mature_1to7d, 0) AS mature_1to7d,
  coalesce(summary.return_1to7d, 0) AS return_1to7d,
  assignment_failures.signup_assignment_failures
FROM variants
LEFT JOIN summary USING (variant)
CROSS JOIN assignment_failures
ORDER BY variants.variant`;

// raw-sql-ok: composes the shared BigQuery first-touch CTE helper (validated eventsTableRange) with static query SQL; all runtime values stay bound parameters.
const BIGQUERY_AB_SQL = (eventsTableRange: string) =>
  [
    bigQueryFirstTouchEventsCte(eventsTableRange, {
      endDateParam: "DATE(@as_of)",
      includeAllApps: true,
    }),
    BIGQUERY_AB_BODY_SQL,
  ].join(",\n");

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function parseAsOfTimestamp(value: string): Date | undefined {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/i.test(
      value,
    ) ||
    !isCalendarDate(value.slice(0, 10))
  )
    return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function wilsonInterval(
  successes: number,
  total: number,
): [number, number] | null {
  if (total <= 0) return null;
  const z = 1.959963984540054;
  const rate = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (rate + (z * z) / (2 * total)) / denominator;
  const margin =
    (z * Math.sqrt((rate * (1 - rate) + (z * z) / (4 * total)) / total)) /
    denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

export function sampleNeededPerArmForTenPointLift(
  baseline = BASELINE_READY_RATE,
  target = TARGET_READY_RATE,
): number {
  const alphaQuantile = 1.959963984540054;
  const powerQuantile = 0.8416212335729143;
  const average = (baseline + target) / 2;
  const numerator =
    alphaQuantile * Math.sqrt(2 * average * (1 - average)) +
    powerQuantile *
      Math.sqrt(baseline * (1 - baseline) + target * (1 - target));
  return Math.ceil((numerator * numerator) / (target - baseline) ** 2);
}

export function buildPostgresDesignNoQuestionsAbSql(): string {
  return POSTGRES_AB_SQL;
}

export function buildBigQueryDesignNoQuestionsAbSql(
  eventsTableRange: string,
): string {
  return BIGQUERY_AB_SQL(eventsTableRange);
}

export interface DesignNoQuestionsReadoutOptions {
  startDate?: string;
  endDate?: string;
  asOf?: string;
}

function number(row: Record<string, unknown>, key: string): number {
  const result = Number(row[key] ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function nullableNumber(
  row: Record<string, unknown>,
  key: string,
): number | null {
  if (row[key] === null || row[key] === undefined) return null;
  const result = Number(row[key]);
  return Number.isFinite(result) ? result : null;
}

function armFromRow(
  variant: DesignNoQuestionsArm["variant"],
  row: Record<string, unknown> = {},
): DesignNoQuestionsArm {
  const exposed = number(row, "exposed");
  const mature24h = number(row, "mature_24h");
  const readyUsers = number(row, "ready_24h");
  const firstTurnReadyUsers = number(row, "first_turn_ready_24h");
  const followUpUsers = number(row, "post_ready_follow_up_24h");
  const exportUsers = number(row, "completed_export_24h");
  const mature1to7d = number(row, "mature_1to7d");
  const returnUsers = number(row, "return_1to7d");
  return {
    variant,
    exposed,
    promptJoined: number(row, "prompt_joined"),
    mature24h,
    ready24h: {
      users: readyUsers,
      rate: mature24h > 0 ? readyUsers / mature24h : null,
      ci95: wilsonInterval(readyUsers, mature24h),
    },
    firstTurnReady24h: {
      users: firstTurnReadyUsers,
      denominator: mature24h,
      rate: mature24h > 0 ? firstTurnReadyUsers / mature24h : null,
    },
    timeToReady24hMs: {
      users: readyUsers,
      p50: nullableNumber(row, "time_p50_ms"),
      p90: nullableNumber(row, "time_p90_ms"),
    },
    postReadyFollowUp24h: {
      users: followUpUsers,
      denominator: mature24h,
      rate: mature24h > 0 ? followUpUsers / mature24h : null,
    },
    completedExport24h: {
      users: exportUsers,
      denominator: mature24h,
      rate: mature24h > 0 ? exportUsers / mature24h : null,
    },
    mature1to7d,
    return1to7d: {
      users: returnUsers,
      denominator: mature1to7d,
      rate: mature1to7d > 0 ? returnUsers / mature1to7d : null,
    },
  };
}

export async function runDesignNoQuestionsReadout(
  options: DesignNoQuestionsReadoutOptions = {},
): Promise<DesignNoQuestionsReadout> {
  const startDate = options.startDate ?? DEFAULT_START;
  const endDate = options.endDate ?? new Date().toISOString().slice(0, 10);
  if (
    !isCalendarDate(startDate) ||
    !isCalendarDate(endDate) ||
    startDate > endDate
  ) {
    throw new RadarQueryError(
      "A valid ordered --start and --end date is required.",
      2,
    );
  }
  const requestedCutoff = options.asOf
    ? parseAsOfTimestamp(options.asOf)
    : new Date();
  if (!requestedCutoff) {
    throw new RadarQueryError(
      "--as-of must be an ISO timestamp with a valid date and explicit UTC offset.",
      2,
    );
  }
  const cutoffDate = new Date(Math.min(requestedCutoff.getTime(), Date.now()));
  if (cutoffDate < new Date(`${startDate}T00:00:00.000Z`)) {
    throw new RadarQueryError(
      "The A/B data cutoff must be on or after --start.",
      2,
    );
  }
  const dataCutoff = cutoffDate.toISOString();
  const orgId = await resolveRadarOrganizationId();
  const backend = await resolveRadarFirstPartyBackend();
  const result =
    backend.sink === "bigquery"
      ? await runBigQuery(
          buildBigQueryDesignNoQuestionsAbSql(
            await resolveRadarBigQueryEventsTable(),
          ),
          {
            params: [
              { name: "start_date", type: "DATE", value: startDate },
              { name: "end_date", type: "DATE", value: endDate },
              { name: "org_id", type: "STRING", value: orgId },
              { name: "as_of", type: "TIMESTAMP", value: dataCutoff },
            ],
            fresh: true,
            cache: false,
          },
        )
      : await runPostgresQuery(
          buildPostgresDesignNoQuestionsAbSql(),
          [startDate, endDate, orgId, dataCutoff],
          { fresh: true, cache: false },
        );

  if (
    result.rows.some(
      (row) => !DESIGN_NO_QUESTIONS_VARIANTS.includes(row.variant as never),
    )
  ) {
    throw new RadarQueryError(
      "A/B readout returned an unconfigured experiment variant; output was suppressed.",
      1,
    );
  }
  const byVariant = new Map(
    result.rows.map((row) => [String(row.variant), row]),
  );
  const arms = DESIGN_NO_QUESTIONS_VARIANTS.map((variant) =>
    armFromRow(variant, byVariant.get(variant)),
  );
  const sampleNeededPerArm = sampleNeededPerArmForTenPointLift();
  return {
    experiment: DESIGN_NO_QUESTIONS_EXPERIMENT_ID,
    startDate,
    endDate,
    dataCutoff,
    primaryBaseline: BASELINE_READY_RATE,
    targetLift: 0.1,
    sampleNeededPerArm,
    sampleNeededTotal: sampleNeededPerArm * 2,
    signupAssignmentFailures: number(
      result.rows[0] ?? {},
      "signup_assignment_failures",
    ),
    arms,
    generatedAt: new Date().toISOString(),
  };
}

function rate(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function latency(value: number | null): string {
  return value === null ? "n/a" : `${(value / 60_000).toFixed(1)} min`;
}

export function formatDesignNoQuestionsReadout(
  result: DesignNoQuestionsReadout,
): string {
  const lines = [
    `# A/B readout: ${result.experiment}`,
    "",
    `Window: ${result.startDate} through ${result.endDate} (inclusive); data cutoff ${result.dataCutoff}.`,
    `Primary metric baseline used for power: ${(result.primaryBaseline * 100).toFixed(1)}%; target lift: +${(result.targetLift * 100).toFixed(0)} points; sample needed: ${result.sampleNeededPerArm} per arm (${result.sampleNeededTotal} total), two-sided 5% significance and 80% power.`,
    `Signup assignment failures with no arm: ${result.signupAssignmentFailures}.`,
    "",
    "| Variant | Exposed | Server prompt trace | 24h mature | Client-observed Design ready within 24h | Time to design p50 / p90 | Post-ready follow-up prompt within 24h | Completed UI export within 24h | Mature 1–7d | 1–7d return |",
    "| --- | ---: | ---: | ---: | --- | --- | --- | --- | ---: | --- |",
  ];
  for (const arm of result.arms) {
    lines.push(
      `| ${arm.variant} | ${arm.exposed} | ${arm.promptJoined} | ${arm.mature24h} | ${arm.ready24h.users}/${arm.mature24h} (${rate(arm.ready24h.rate)}) | ${latency(arm.timeToReady24hMs.p50)} / ${latency(arm.timeToReady24hMs.p90)} | ${arm.postReadyFollowUp24h.users}/${arm.postReadyFollowUp24h.denominator} (${rate(arm.postReadyFollowUp24h.rate)}) | ${arm.completedExport24h.users}/${arm.completedExport24h.denominator} (${rate(arm.completedExport24h.rate)}) | ${arm.mature1to7d} | ${arm.return1to7d.users}/${arm.return1to7d.denominator} (${rate(arm.return1to7d.rate)}) |`,
    );
  }
  const firstTurnDiagnostic = result.arms
    .map(
      (arm) =>
        `${arm.variant} ${arm.firstTurnReady24h.users}/${arm.firstTurnReady24h.denominator} (${rate(arm.firstTurnReady24h.rate)})`,
    )
    .join(", ");
  lines.push(
    "",
    `First-turn ready diagnostic (exposed turn only, not primary): ${firstTurnDiagnostic}.`,
    "",
    "Design-ready is client-observed at the user level across any turn within 24 hours of the anchor: the Design editor emits it after an owner view loads a saved design with at least one screen (for in-editor runs, after the server confirms that turn's output receipt). It is not server-verified proof of a human view. Counting across subsequent turns avoids penalizing control users whose intake-question answers start a new turn. Time to design measures anchor to the user's first qualifying ready event within 24 hours. Post-ready follow-up prompts count 24h-mature users with a turn-identified first ready event and a server-traced generation on a distinct later turn strictly after that ready event (excluding the exposed turn, the ready-producing turn, and ready events without a turn ID, so intake-question answers and ambiguous same-turn continuations are not counted as follow-ups). Completed UI exports use server-origin frontend export events within 24 hours matching any qualifying ready output ID for that user. Time starts at the first server-traced generation in the exposed turn, falling back to the server exposure timestamp when a trace is missing. Signup assignment failures are reported separately and are not assigned to either arm. The return rate uses only users with a full 8-day observation window.",
  );
  return lines.join("\n");
}
