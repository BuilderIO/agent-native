# Analytics — Agent Guide

Analytics is an agent-native BI workspace. The agent manages data sources,
queries, dashboards, charts, analyses, and connected warehouse integrations
through actions and SQL-backed state.

Keep this file essential. Querying, dashboard, warehouse, and implementation
details live in `.agents/skills/`.

## Core Rules

- Data integrity comes first. Do not invent numbers, dimensions, filters, or
  source semantics. State uncertainty and inspect the source when needed.
- Use actions for data sources, queries, charts, dashboards, analyses, and
  sharing. Do not bypass app access checks with raw SQL for ownable resources.
- In dev, call actions with `pnpm action <name>`; in production, call native
  tools. The action schema is authoritative.
- Prefer app query actions and provider readers over hand-written ad hoc SQL
  unless the user explicitly asks for low-level inspection.
- For BigQuery, Prometheus, or other external providers, use the provider skill
  and existing credential/integration flow.
- Dashboards and charts should be useful, explainable, and scoped to the user's
  question. Avoid decorative metrics.
- Native dashboards and saved analyses are constrained artifacts. If a requested
  dashboard, analysis surface, visualization, interaction model, custom layout,
  or bespoke workflow cannot be done faithfully with the built-in dashboard JSON
  config/components or saved-analysis markdown/chart format, automatically build
  it as an extension instead and tell the user why.
- Use framework sharing and access helpers for dashboards, analyses, and saved
  resources.

## Application State

- `navigation` exposes current dashboard, analysis, source, chart, and selected
  context.
- `navigate` moves the user to the relevant analytics view.
- Use `view-screen` when the active dashboard/chart context is unclear.

## Skills

Read the relevant skill before deeper work:

- `data-querying` for source inspection, SQL/query generation, and result
  handling.
- `dashboard-management` for dashboard/chart creation and layout.
- `adhoc-analysis` for one-off analytical answers.
- `bigquery` and `prometheus` for provider-specific behavior.
- `storing-data`, `real-time-sync`, `security`, `actions`, and
  `frontend-design` for framework work.
