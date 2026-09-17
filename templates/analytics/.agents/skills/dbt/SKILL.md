---
name: dbt
description: >-
  Governed dbt metadata, lineage, and freshness routing for analytics.
  Use when a question depends on dbt models, sources, lineage, or model health.
scope: runtime
---

# dbt

dbt is authoritative for model metadata, lineage, and freshness. This integration is metadata-only. Connected dbt MCP tools are dynamic: find them with `tool-search` when needed rather than assuming they are on the initial tool surface.

## Decision Order

1. Before guessing a dbt table, grain, join, meaning, freshness, or lineage, use dbt Discovery. Use the exact official tools that fit the question: `get_node_details` for model semantics and relation metadata, `get_lineage` for dependencies, `get_model_health` or `get_model_performance` for health and performance, and `get_all_sources` for declared sources and freshness context.
2. Use dbt MCP only for metadata. Never use dbt `execute_sql` or `text_to_sql`; warehouse schema discovery and querying remain separate BigQuery operations.
3. If dbt metadata does not establish a grain or relationship, keep it unknown. Do not infer a join or silently turn uncertainty into a metric.

dbt calls use one organization-scoped dbt Cloud service-token identity, not each user's personal dbt Cloud account.

## Restricted Schemas

`dbt_dev`, `dbt_backup`, and schemas matching `dbt_cloud_pr_*` are development, testing, or archival schemas. Do not include them in metadata analysis or query them unless the latest end-user request explicitly names the schema and asks to inspect or query it. Never infer permission from SQL that the agent generated.

## Freshness

A visible dbt health or freshness capability does not mean the data is fresh. Warn that data is stale only when returned dbt source/model metadata explicitly says it is beyond the expected refresh window, and include the observed timestamp or window when available. If freshness is unknown, do not claim freshness; mention that it could not be verified only when freshness materially affects the answer.

Use dbt metadata only when it can answer without inventing definitions.

## Failure Semantics

A dbt connection or tool-list error means capability status is unreadable, not that dbt is disconnected or that no dbt models exist. Preserve the actual error, try dynamic tool discovery when appropriate, and do not replace a failed dbt lookup with guessed semantics.
