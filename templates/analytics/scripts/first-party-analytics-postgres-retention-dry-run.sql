-- FIRST-PARTY ANALYTICS POSTGRES RETENTION PREVIEW - READ ONLY
--
-- This file intentionally contains no INSERT, UPDATE, DELETE, TRUNCATE, or DDL.
-- It reports only rows in the explicitly resolved Builder.io organization and
-- the exact 60-day window that was copied to BigQuery by the migration.
--
-- The candidate set excludes http.response because that event class was
-- intentionally omitted from the BigQuery backfill. Rows older than the
-- lookback window and legacy owner-only rows are reported separately and are
-- never included in the candidate count. Session replay, exception issues,
-- public-key metadata, rollups, alerts, and pressure data are reported as
-- preserved SQL rows; they are not deletion candidates.
-- The organization and owner values below are intentionally fake safe
-- defaults. Supply scoped values in a local copy or SQL-client parameters;
-- never commit real organization IDs or employee addresses here.

WITH params AS (
  SELECT
    'org-example'::text AS org_id,
    'owner@example.com'::text AS owner_email,
    '2026-06-10T18:50:43.370Z'::text AS lookback_start,
    '2026-08-09T19:11:44.834Z'::text AS cutoff,
    'http.response'::text AS excluded_event_name
),
org_window AS (
  SELECT e.id, e.event_name, e.received_at
  FROM analytics_events AS e
  CROSS JOIN params AS p
  WHERE e.org_id = p.org_id
    AND e.received_at >= p.lookback_start
    AND e.received_at < p.cutoff
),
org_older AS (
  SELECT e.received_at
  FROM analytics_events AS e
  CROSS JOIN params AS p
  WHERE e.org_id = p.org_id
    AND e.received_at < p.lookback_start
),
legacy_window AS (
  SELECT e.received_at
  FROM analytics_events AS e
  CROSS JOIN params AS p
  WHERE e.org_id IS NULL
    AND e.owner_email = p.owner_email
    AND e.received_at >= p.lookback_start
    AND e.received_at < p.cutoff
),
candidate AS (
  SELECT w.id, w.event_name, w.received_at
  FROM org_window AS w
  CROSS JOIN params AS p
  WHERE w.event_name IS DISTINCT FROM p.excluded_event_name
),
metrics AS (
  SELECT
    'events'::text AS section,
    'candidate_non_http_response'::text AS metric,
    COUNT(*) AS row_count,
    MIN(received_at) AS first_seen,
    MAX(received_at) AS last_seen,
    'Only rows in the copied 60-day org window; not a delete.'::text AS notes
  FROM candidate

  UNION ALL
  SELECT
    'events',
    'excluded_http_response',
    COUNT(*),
    MIN(received_at),
    MAX(received_at),
    'Excluded from BigQuery backfill; do not delete without a separate decision.'
  FROM org_window AS w
  CROSS JOIN params AS p
  WHERE w.event_name = p.excluded_event_name

  UNION ALL
  SELECT
    'events',
    'older_than_lookback',
    COUNT(*),
    MIN(received_at),
    MAX(received_at),
    'Not copied by the 60-day migration; not a delete candidate.'
  FROM org_older

  UNION ALL
  SELECT
    'events',
    'legacy_owner_only_in_window',
    COUNT(*),
    MIN(received_at),
    MAX(received_at),
    'org_id IS NULL branch; migration checkpoint copied zero legacy rows.'
  FROM legacy_window

  UNION ALL
  SELECT
    'event_names',
    event_name,
    COUNT(*),
    MIN(received_at),
    MAX(received_at),
    'Candidate rows grouped by event name.'
  FROM candidate
  GROUP BY event_name

  UNION ALL
  SELECT
    'preserved_sql',
    'analytics_event_daily_rollups',
    COUNT(*),
    NULL,
    NULL,
    'Preserved derived event counts.'
  FROM analytics_event_daily_rollups AS r
  CROSS JOIN params AS p
  WHERE r.org_id = p.org_id

  UNION ALL
  SELECT
    'preserved_sql',
    'analytics_user_days',
    COUNT(*),
    NULL,
    NULL,
    'Preserved active-user/retention rows.'
  FROM analytics_user_days AS u
  CROSS JOIN params AS p
  WHERE u.org_id = p.org_id

  UNION ALL
  SELECT
    'preserved_sql',
    'analytics_event_volume_usage',
    COUNT(*),
    NULL,
    NULL,
    'Preserved volume-cap state.'
  FROM analytics_event_volume_usage AS v
  CROSS JOIN params AS p
  WHERE v.org_id = p.org_id

  UNION ALL
  SELECT
    'preserved_sql',
    'analytics_query_pressure_daily',
    COUNT(*),
    NULL,
    NULL,
    'Preserved query-pressure diagnostics.'
  FROM analytics_query_pressure_daily AS q
  CROSS JOIN params AS p
  WHERE q.org_id = p.org_id

  UNION ALL
  SELECT
    'preserved_sql',
    'analytics_alert_rules',
    COUNT(*),
    NULL,
    NULL,
    'Preserved alert definitions.'
  FROM analytics_alert_rules AS a
  CROSS JOIN params AS p
  WHERE a.org_id = p.org_id

  UNION ALL
  SELECT
    'preserved_sql',
    'analytics_alert_incidents',
    COUNT(*),
    NULL,
    NULL,
    'Preserved alert history.'
  FROM analytics_alert_incidents AS i
  CROSS JOIN params AS p
  WHERE i.org_id = p.org_id

  UNION ALL
  SELECT
    'preserved_sql',
    'session_recordings',
    COUNT(*),
    MIN(started_at),
    MAX(COALESCE(ended_at, started_at)),
    'Session replay summaries; never delete with event rows.'
  FROM session_recordings AS s
  CROSS JOIN params AS p
  WHERE s.org_id = p.org_id

  UNION ALL
  SELECT
    'preserved_sql',
    'session_replay_chunks',
    COUNT(*),
    MIN(created_at),
    MAX(created_at),
    'Session replay payload references; never delete with event rows.'
  FROM session_replay_chunks AS c
  CROSS JOIN params AS p
  WHERE c.org_id = p.org_id

  UNION ALL
  SELECT
    'preserved_sql',
    'session_replay_ingests',
    COUNT(*),
    MIN(created_at),
    MAX(created_at),
    'Session replay ingest audit rows; never delete with event rows.'
  FROM session_replay_ingests AS g
  CROSS JOIN params AS p
  WHERE g.org_id = p.org_id

  UNION ALL
  SELECT
    'preserved_sql',
    'error_issues',
    COUNT(*),
    MIN(first_seen_at),
    MAX(last_seen_at),
    'Grouped exception issues; preserved separately from analytics_events.'
  FROM error_issues AS x
  CROSS JOIN params AS p
  WHERE x.org_id = p.org_id

  UNION ALL
  SELECT
    'preserved_sql',
    'error_events',
    COUNT(*),
    MIN(occurred_at),
    MAX(occurred_at),
    'Exception occurrences; preserved separately from analytics_events.'
  FROM error_events AS x
  CROSS JOIN params AS p
  WHERE x.org_id = p.org_id

  UNION ALL
  SELECT
    'preserved_sql',
    'analytics_public_keys',
    COUNT(*),
    MIN(created_at),
    MAX(created_at),
    'Public-key metadata; preserved separately from analytics_events.'
  FROM analytics_public_keys AS k
  CROSS JOIN params AS p
  WHERE k.org_id = p.org_id
)
SELECT section, metric, row_count, first_seen, last_seen, notes
FROM metrics
ORDER BY
  CASE section
    WHEN 'events' THEN 1
    WHEN 'event_names' THEN 2
    ELSE 3
  END,
  row_count DESC,
  metric;
