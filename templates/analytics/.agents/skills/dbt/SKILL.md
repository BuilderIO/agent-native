---
name: dbt
description: >-
  Governed dbt model, lineage, freshness, and Semantic Layer routing for analytics.
  Use when a question depends on dbt models, sources, metrics, or warehouse SQL.
scope: runtime
---

# dbt

dbt is authoritative for dbt model semantics, lineage, freshness, and governed metrics. Connected dbt MCP tools are dynamic: find them with `tool-search` when needed rather than assuming they are on the initial tool surface.

## Decision Order

1. Reuse a current certified query or dashboard when it already answers the request with the right definition, filters, grain, and time range.
2. Before guessing a dbt table, grain, join, meaning, freshness, or lineage, use dbt Discovery. Use the exact official tools that fit the question: `get_node_details` for model semantics and relation metadata, `get_lineage` for dependencies, `get_model_health` or `get_model_performance` for health and performance, and `get_all_sources` for declared sources and freshness context.
3. Before writing SQL, verify the physical BigQuery relation and columns with `search-bigquery-schema`. dbt metadata describes governed meaning; warehouse schema proves what can be queried now.
4. Run direct SQL with the existing `bigquery` action. Never use dbt `execute_sql` or `text_to_sql`.
5. If dbt metadata does not establish a grain or relationship, keep it unknown. Do not infer a join or silently turn uncertainty into a metric.

## Phase 2: MetricFlow / Semantic Layer

When Semantic Layer tools are available:

1. Call `list_metrics` to find the governed metric.
2. Inspect `get_dimensions` and `get_entities`; use `get_dimension_values` when a requested filter value needs validation.
3. Call `query_metrics` with the requested dimensions, filters, range, and time grain.
4. Call `get_metrics_compiled_sql` only when the user requests provenance or query validation. It is not a default preflight.

Report the metric name, dimensions, filters, date range and time grain, plus environment or freshness caveats. dbt calls use the shared workspace dbt identity, not a personal warehouse identity.

## Restricted Schemas

`dbt_dev` and `dbt_backup` are testing or archival schemas. Do not discover or query either schema unless the latest end-user request explicitly names it and asks to inspect or query it. Never infer permission from SQL that the agent generated.

## Freshness

A visible dbt health or freshness capability does not mean the data is fresh. Warn that data is stale only when returned dbt source/model metadata explicitly says it is beyond the expected refresh window, and include the observed timestamp or window when available. If freshness is unknown, do not claim freshness; mention that it could not be verified only when freshness materially affects the answer.

If MetricFlow cannot express the request, fall back to dbt metadata plus the `bigquery` action and label the result as ad hoc SQL. Missing Semantic Layer tools are a capability gap, not evidence that no metrics exist. Use Discovery metadata and BigQuery only when they can answer without inventing semantic definitions.

## Failure Semantics

A dbt connection or tool-list error means capability status is unreadable, not that dbt is disconnected or that no dbt models or metrics exist. Preserve the actual error, try dynamic tool discovery when appropriate, and do not replace a failed dbt lookup with guessed semantics.
