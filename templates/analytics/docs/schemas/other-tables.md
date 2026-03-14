# Other BigQuery Tables

## metrics.lines_of_code

Tracks code generation metrics.

**Full path**: `<project_id>.metrics.lines_of_code`

Used for tracking Fusion/AI code generation volume. Not currently accessible via query-metrics API.

## metrics.nps

NPS (Net Promoter Score) survey responses.

**Full path**: `<project_id>.metrics.nps`

Contains NPS survey data from in-app surveys. Not currently accessible via query-metrics API.

## metrics.events_mv

Materialized view of `metrics.events` for faster queries.

**Full path**: `<project_id>.metrics.events_mv`

Accessed via `?useMatView=true` query parameter on the query-metrics API. Same schema as `metrics.events` but pre-aggregated for performance.
