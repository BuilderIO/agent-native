# Analytics — Agent Guide

Analytics is an agent-native BI workspace. The agent manages data sources,
queries, dashboards, charts, analyses, and connected warehouse integrations
through actions and SQL-backed state.

Keep this file essential. Querying, dashboard, warehouse, and implementation
details live in `.agents/skills/`.

## Core Rules

- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Data integrity comes first. Do not invent numbers, dimensions, filters, or
  source semantics. State uncertainty and inspect the source when needed.
- Catalog-first: before querying, consult known data sources (data-source
  status) and the injected `<data-dictionary>` to learn what exists and which
  table/columns/join paths to use. Don't fan out blind queries when the catalog
  already answers where a fact lives.
- Clarify-first for ambiguous ad-hoc work: when the metric definition, date
  range, or grain is ambiguous and a wrong guess would change the numbers, use
  the `ask-question` clarifying tool (multiple-choice) before computing. Ask at
  most once per turn, and never when the dictionary or the user already settled
  it.
- Verify before claiming: only present numbers you actually retrieved from a
  source. Never report a value you did not query.
- Every analytical answer should include enough audit context for the user to
  trust it: source(s), time window, filters, sample size or row count,
  join/match method when relevant, and caveats/gaps.
- Use actions for data sources, queries, charts, dashboards, analyses, and
  sharing. Do not bypass app access checks with raw SQL for ownable resources.
- In dev, call actions with `pnpm action <name>`; in production, call native
  tools. The action schema is authoritative.
- Prefer app query actions and provider readers over hand-written ad hoc SQL
  unless the user explicitly asks for low-level inspection.
- Provider actions are shortcuts, not limits. When a canned action cannot
  express the endpoint, filters, request body, pagination, or API version the
  user needs, call `provider-api-catalog` / `provider-api-docs`, then
  `provider-api-request` against the provider's real HTTP API. The generic
  request action uses the shared `@agent-native/core/provider-api` runtime,
  injects configured credentials, blocks private/internal URLs, and redacts
  secrets.
- For named account/deal deep dives, call `account-deep-dive` first. It bundles
  HubSpot deal/account/contact activity with Gong call detail and compact
  transcript evidence so the final report can match Fusion-style depth.
- For HubSpot deal cohorts, use structured `hubspot-deals` filters for the
  cohort definition: `product` for the `products` field, `pipeline` for deal
  pipeline, `closedStatus` for won/lost/open, and `closedDateFrom` /
  `closedDateTo` for close-date windows. `query` is full-text search across
  deals and is not valid proof that a specific property matched.
- For BigQuery, Prometheus, or other external providers, use the provider skill
  and existing credential/integration flow.
- For questions that span multiple sources, follow `cross-source-analysis`:
  stitch identities on BOTH a stable id AND email, de-duplicate, and cite
  per-source provenance.
- When the user challenges coverage or asks why records are missing, rerun or
  revise from the source cohort and provide the updated answer directly. Do not
  say a revised analysis exists unless you include it or save it.
- Dashboards and charts should be useful, explainable, and scoped to the user's
  question. Avoid decorative metrics.
- For shipped dashboard templates, call `list-dashboard-templates` first, then
  `install-dashboard-template` with the selected `templateId`. Do not recreate a
  catalog template by hand unless the user asks for a custom variant.
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
- `navigate` moves the user to the relevant analytics view, including
  `view="catalog"` for the template catalog.
- Use `view-screen` when the active dashboard/chart context is unclear.

## Dashboard Template Catalog

- `list-dashboard-templates` lists source-controlled dashboard templates with
  `id`, category, data sources, panel count, and installed dashboard IDs.
- `install-dashboard-template` installs a catalog template into normal
  SQL-backed dashboards. Required: `templateId`. Optional: `dashboardId`,
  `name`, `overwrite`, and `forceNew`.
- Node Exporter ships as `node-exporter-essentials` for the default compact
  Prometheus host-health board, `node-exporter-macos` for Darwin/Homebrew
  node_exporter scrapes, and `node-exporter-full` for the Linux-focused Grafana
  1860 revision 45 full dashboard converted into native Analytics panels.

## Skills

Read the relevant skill before deeper work:

- `data-querying` for source inspection, SQL/query generation, and result
  handling.
- `cross-source-analysis` for questions that span multiple data sources
  (identity stitching, de-duplication, consolidated provenance).
- `hubspot` for CRM deals, companies, contacts, tickets, owners, and account
  context.
- `gong` for call metadata, transcript excerpts, objections, risks, and next
  steps.
- `actions` for the shared provider API pattern when a first-class action is too
  narrow for arbitrary authenticated provider HTTP calls and API docs lookup.
- `dashboard-management` for dashboard/chart creation and layout.
- `adhoc-analysis` for one-off analytical answers.
- `bigquery` and `prometheus` for provider-specific behavior.
- `storing-data`, `real-time-sync`, `security`, `actions`, and
  `frontend-design` for framework work.
