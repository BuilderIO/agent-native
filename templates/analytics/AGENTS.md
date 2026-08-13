# Analytics — Agent Guide

Analytics is an agent-native BI workspace for sources, queries, dashboards,
charts, and warehouse integrations; dashboards are canonical and legacy
analyses remain readable.

## Skills

Read the relevant skill before deeper work:

- `data-querying` for source inspection, SQL generation, result handling, and
  `/chart` embeds; `bigquery`, `hubspot`, `gong`, `prometheus` for provider
  specifics.
- `cross-source-analysis` for questions spanning sources (identity stitching,
  de-duplication).
- `dashboard-management` for dashboard/panel storage, layout, extensions,
  mutation and sharing.
- `adhoc-analysis` and `analysis-workspace` for one-off answers and large
  multi-source work.
- `provider-api` and `data-programs` for the escape hatch and durable,
  refreshable data sources.
- `creative-context` for governed contexts and immutable dashboard revisions.
- `admin-surfaces` for the `/agents` fleet flags, usage audit, and connected DBs.

## How To Answer A Data Question

1. **Search existing work first.** For a metric question, call
   `search-analytics-query-catalog`; for dashboard replication or adaptation,
   call `search-dashboard-references` first. Inspect each returned reference
   with `get-sql-dashboard` or `get-explorer-dashboard` by its `kind`; a match
   is context, not authoritative source data. Then adapt the closest saved SQL
   to the requested filters/window, run it once, and stop.
2. **One bounded call.** List/filter/count/cohort questions are one SQL statement
   or one server-side `run-code` script; never page or fan out per item.
3. **Escalate on a miss.** If the catalog has no usable result, make one discovery
   pass (`list-data-dictionary`, `search-bigquery-schema`, `data-source-status`),
   then query; don't cross-check or add unasked breakdowns.
4. **Answer in chat.** Return a short table or inline chart, not only a
   dashboard pointer; for >50 rows, state the total and top rows.
5. **Deliver exports in chat.** See `analysis-workspace`; don't return only a path.
6. **Chunk only reading.** Group 5-10 only for 30+ qualitative items when a query
   cannot answer; don't chunk queryable questions. See `adhoc-analysis`.

## Core Rules

- A sibling app sends natural-language or shaped input over A2A, never SQL; this
  app owns schema, source selection, and tools. Prefer natural-language
  delegation; shaped reads are stable contracts.
- Analytics owns first-party product usage, app/template events, agent-native
  signups, conversions, and other curated product metrics. Answer sibling-app
  delegations with the built-in source and query catalog; sibling agents should
  send a natural-language question, never SQL.
- For open-ended delegated requests, choose a safe default and label partial.
- Data integrity first. Never invent numbers, dimensions, filters, or source
  semantics; present only retrieved values with source, window, filters,
  row-count/sample-size, join method, and caveats.
- Use actions for sources, queries, charts, dashboards, and sharing. Don't bypass
  access checks with raw SQL for ownable resources.
- Provider actions are bounded shortcuts, not limits. For broad or
  absence-sensitive Gong work, stage raw API data and use `query-staged-dataset`
  or a Data Program; see `provider-api`, `data-programs`, and `gong` for secure
  provider and hosted-endpoint boundaries.
- Create dashboards, panels, or saved artifacts only when explicitly asked;
  suggest and wait otherwise. Scope them to the question, avoid decorative
  metrics, and never modify existing dashboards without a directive.
- For named account/deal deep dives, call `account-deep-dive` first.
- When the user challenges coverage or asks why records are missing, rerun from
  the source cohort and include the updated answer directly — never claim a
  revision you didn't produce.
- The `demo` source (Node Exporter) is demo data against a public endpoint.
  Never cite it as real analytics evidence unless the user asks about the demo
  dashboard.
- Store large payloads in file/blob storage, never SQL or app state. Persist
  only URLs, ids, or handles.
- Never hardcode API keys, tokens, webhook URLs, secrets, private Builder data,
  or customer data. Use secrets/OAuth and obvious placeholders in examples.
- External MCP callers default to `ask_app` for interpretation, source choice,
  analysis, or multi-step work. Direct reads require exact, complete input;
  writes stay `ask_app`-only.
- Dashboard reports and alert rules use their SQL-backed action surfaces; reports
  cap at five recipients.

## Application State

- `navigation` exposes the current dashboard, analysis, source, chart, and
  selection. `navigate` moves the user between supported Analytics surfaces,
  `"sessions"`, `"monitoring"`, and `"agents"`. Use `view-screen` when the
  active context is unclear.
- Clicking a panel stages it as a chat context chip and writes `selected-object`
  with `type="dashboard-panel"`. Read `dashboard-management` for the
  `/dashboards` overview and folder actions.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read
`customizing-agent-native` before adapting shared UI.
