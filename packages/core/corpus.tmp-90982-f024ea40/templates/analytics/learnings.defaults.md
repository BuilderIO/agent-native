# Learnings

<!-- This file is your app's memory. The AI reads it at the start of every conversation and updates it when it learns something new. -->
<!-- Your personal learnings.md is gitignored so preferences and private info stay local. -->
<!-- This defaults file is what new checkouts start with. -->

The entries below are illustrative examples with fake names — replace them with
real discoveries as you analyze your own data. Keep this file tidy: revise,
consolidate, and remove outdated entries rather than appending forever.

## Metric Definitions

- **Active workspace** (example): a workspace with >= 3 distinct users firing
  `app_opened` in a rolling 28-day window. Confirmed with the data team on
  2026-01-15; use `dbt_analytics.active_workspaces_28d`, not a hand-rolled
  count over raw events.

## Schema Discoveries

- The deals table (`dbt_mart.dim_deals` in this example) stores the deal stage
  as `stage_name`, not `deal_stage` as the spec doc says, and `amount` is a
  STRING — `CAST(amount AS FLOAT64)` before arithmetic. Verified via
  `search-bigquery-schema` on 2026-01-20.

## Identity Stitching

- Joining product signups to CRM contacts requires BOTH the stable id AND a
  lowercased email match — join on `user_id` plus
  `LOWER(signups.email) = LOWER(contacts.email)`. An id-only join produced ~40
  phantom matches for Example Corp because ids get recycled after merges.

## Provider Gotchas

- HubSpot (example): filtering deals by "reached stage X in date window" must
  use the `hs_v2_date_entered_<stageId>` property via `provider-api-request`,
  not amount/keyword heuristics — heuristic cohorts diverged ~48% from
  stage-date cohorts. Get stage ids from `hubspot-pipelines` first.
- Warehouse event tables must always be date-bounded (for example
  `WHERE event_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)`); an
  unbounded scan of `example_events.pageviews` hit the byte limit and returned
  nothing usable.
