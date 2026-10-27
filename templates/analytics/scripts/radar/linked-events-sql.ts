const EVENT_STATS_SELECT =
  "SELECT * FROM event_stats ORDER BY period_start, app, event_name";

type Dialect = "postgres" | "bigquery";
type Bucket = "DAY" | "HOUR";

function countDistinct(
  dialect: Dialect,
  expression: string,
  condition: string,
): string {
  return dialect === "postgres"
    ? `count(DISTINCT ${expression}) FILTER (WHERE ${condition})::int`
    : `count(DISTINCT IF(${condition}, ${expression}, NULL))`;
}

function countMatching(dialect: Dialect, condition: string): string {
  return dialect === "postgres"
    ? `count(*) FILTER (WHERE ${condition})::int`
    : `countif(${condition})`;
}

function minWhen(dialect: Dialect, condition: string): string {
  return dialect === "postgres"
    ? `min(happened_at) FILTER (WHERE ${condition})`
    : `min(IF(${condition}, happened_at, NULL))`;
}

function linkedMetricCtes(dialect: Dialect, bucket: Bucket): string {
  const periodStart =
    dialect === "postgres"
      ? "date_trunc($4, happened_at, 'UTC')"
      : `timestamp_trunc(happened_at, ${bucket}, 'UTC')`;
  const generationAttemptId =
    dialect === "postgres"
      ? "nullif(properties ->> 'generation_attempt_id', '')"
      : "nullif(json_value(properties, '$.generation_attempt_id'), '')";
  const outputId =
    dialect === "postgres"
      ? "nullif(properties ->> 'output_id', '')"
      : "nullif(json_value(properties, '$.output_id'), '')";
  const recordingAttemptId =
    dialect === "postgres"
      ? "nullif(properties ->> 'recording_attempt_id', '')"
      : "nullif(json_value(properties, '$.recording_attempt_id'), '')";
  const generationEvents = "'generation_started', 'generation_failed'";
  const designEvents = "'design_prompt_submitted', 'design_ready_viewed'";
  const clipsEvents = "'recording_started', 'recording_ready'";

  return `, linked_events AS (
  SELECT ${periodStart} AS period_start, app, event_name, person_key, happened_at,
    ${generationAttemptId} AS generation_attempt_id,
    ${outputId} AS output_id,
    ${recordingAttemptId} AS recording_attempt_id
  FROM base_events
  WHERE event_name IN (${generationEvents}, ${designEvents}, ${clipsEvents})
),
slides_attempts AS (
  SELECT period_start, person_key, generation_attempt_id,
    ${minWhen(dialect, "event_name = 'generation_started'")} AS started_at
  FROM linked_events
  WHERE app = 'slides' AND event_name = 'generation_started'
    AND person_key IS NOT NULL AND generation_attempt_id IS NOT NULL
  GROUP BY period_start, person_key, generation_attempt_id
),
slides_linked_metrics AS (
  SELECT s.period_start,
    ${countDistinct(dialect, "s.person_key", "true")} AS started_users,
    ${countDistinct(
      dialect,
      "s.person_key",
      `EXISTS (
      SELECT 1 FROM linked_events f
      WHERE f.period_start = s.period_start AND f.app = 'slides'
        AND f.event_name = 'generation_failed'
        AND f.person_key = s.person_key
        AND f.generation_attempt_id = s.generation_attempt_id
        AND f.happened_at > s.started_at
    )`,
    )} AS failed_started_users
  FROM slides_attempts s
  GROUP BY s.period_start
),
slides_unlinked_metrics AS (
  SELECT period_start,
    ${countMatching(dialect, "person_key IS NULL OR generation_attempt_id IS NULL")} AS unlinked_events
  FROM linked_events
  WHERE app = 'slides' AND event_name IN (${generationEvents})
  GROUP BY period_start
),
design_prompts AS (
  SELECT period_start, person_key, output_id, min(happened_at) AS prompt_at
  FROM linked_events
  WHERE app = 'design' AND event_name = 'design_prompt_submitted'
    AND person_key IS NOT NULL AND output_id IS NOT NULL
  GROUP BY period_start, person_key, output_id
),
design_linked_metrics AS (
  SELECT p.period_start,
    ${countDistinct(
      dialect,
      "p.person_key",
      `EXISTS (
      SELECT 1 FROM linked_events o
      WHERE o.period_start = p.period_start AND o.app = 'design'
        AND o.event_name = 'design_ready_viewed'
        AND o.person_key = p.person_key AND o.output_id = p.output_id
        AND o.happened_at > p.prompt_at
    )`,
    )} AS prompt_output_users
  FROM design_prompts p
  GROUP BY p.period_start
),
design_unlinked_metrics AS (
  SELECT period_start,
    ${countMatching(dialect, "person_key IS NULL OR output_id IS NULL")} AS unlinked_events
  FROM linked_events
  WHERE app = 'design' AND event_name IN (${designEvents})
  GROUP BY period_start
),
clips_attempts AS (
  SELECT period_start, recording_attempt_id,
    ${minWhen(dialect, "event_name = 'recording_started'")} AS started_at
  FROM linked_events
  WHERE app = 'clips' AND event_name = 'recording_started'
    AND recording_attempt_id IS NOT NULL
  GROUP BY period_start, recording_attempt_id
),
clips_linked_metrics AS (
  SELECT s.period_start,
    ${countDistinct(dialect, "s.recording_attempt_id", "true")} AS started_attempts,
    ${countDistinct(
      dialect,
      "s.recording_attempt_id",
      `EXISTS (
      SELECT 1 FROM linked_events r
      WHERE r.period_start = s.period_start AND r.app = 'clips'
        AND r.event_name = 'recording_ready'
        AND r.recording_attempt_id = s.recording_attempt_id
        AND r.happened_at > s.started_at
    )`,
    )} AS ready_attempts
  FROM clips_attempts s
  GROUP BY s.period_start
),
clips_unlinked_metrics AS (
  SELECT period_start,
    ${countMatching(dialect, "recording_attempt_id IS NULL")} AS unlinked_events
  FROM linked_events
  WHERE app = 'clips' AND event_name IN (${clipsEvents})
  GROUP BY period_start
)`;
}

/** Adds linked daily conversions to the existing aggregate query without another warehouse read. */
export function addLinkedEventMetricsSql(
  eventStatsSql: string,
  dialect: Dialect,
  bucket: Bucket,
): string {
  const selectIndex = eventStatsSql.lastIndexOf(EVENT_STATS_SELECT);
  if (
    selectIndex < 0 ||
    eventStatsSql.slice(selectIndex + EVENT_STATS_SELECT.length).trim()
  ) {
    throw new Error("Event stats SQL has an unsupported final SELECT.");
  }

  const linkedCtes = linkedMetricCtes(dialect, bucket);
  const joinTimestamp = "event_stats.period_start";
  const countCast = dialect === "postgres" ? "::int" : "";
  const linkedSelect = `SELECT event_stats.*,
  slides_linked_metrics.started_users AS linked_slides_started_users,
  slides_linked_metrics.failed_started_users AS linked_slides_failed_started_users,
  coalesce(slides_unlinked_metrics.unlinked_events, 0)${countCast} AS linked_slides_unlinked_events,
  design_linked_metrics.prompt_output_users AS linked_design_prompt_output_users,
  coalesce(design_unlinked_metrics.unlinked_events, 0)${countCast} AS linked_design_unlinked_events,
  clips_linked_metrics.started_attempts AS linked_clips_started_attempts,
  clips_linked_metrics.ready_attempts AS linked_clips_ready_attempts,
  coalesce(clips_unlinked_metrics.unlinked_events, 0)${countCast} AS linked_clips_unlinked_events
FROM event_stats
LEFT JOIN slides_linked_metrics ON slides_linked_metrics.period_start = ${joinTimestamp}
  AND event_stats.app = 'slides'
LEFT JOIN slides_unlinked_metrics ON slides_unlinked_metrics.period_start = ${joinTimestamp}
  AND event_stats.app = 'slides'
LEFT JOIN design_linked_metrics ON design_linked_metrics.period_start = ${joinTimestamp}
  AND event_stats.app = 'design'
LEFT JOIN design_unlinked_metrics ON design_unlinked_metrics.period_start = ${joinTimestamp}
  AND event_stats.app = 'design'
LEFT JOIN clips_linked_metrics ON clips_linked_metrics.period_start = ${joinTimestamp}
  AND event_stats.app = 'clips'
LEFT JOIN clips_unlinked_metrics ON clips_unlinked_metrics.period_start = ${joinTimestamp}
  AND event_stats.app = 'clips'
ORDER BY event_stats.period_start, event_stats.app, event_stats.event_name`;

  return `${eventStatsSql.slice(0, selectIndex)}${linkedCtes}\n${linkedSelect}`;
}
