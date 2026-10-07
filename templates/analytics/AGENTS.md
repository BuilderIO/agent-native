# Analytics — Agent Guide

Analytics owns sources, queries, charts, and dashboards. Dashboards are
canonical; legacy analyses remain readable.

## Skills

Read the relevant skill before deeper work:

- `dashboard-management` for any dashboard or panel edit, layout, folders, and
  sharing; `custom-blocks` for extension panels.
- `data-querying` for source inspection, SQL, result handling, and `/chart`
  embeds; `bigquery`, `hubspot`, `gong`, `prometheus` for providers.
- `account-health` for named customer health, QBR, renewal, contract usage, and
  product adoption.
- `incident-investigation` for a named user's session, error, stuck run, replay
  evidence, and session list filters.
- `cross-source-analysis` for questions spanning sources (identity stitching).
- `adhoc-analysis` for one-off answers; `analysis-workspace` for large work and
  CSV/XLSX exports.
- `provider-api` and `data-programs` for the escape hatch and durable,
  refreshable data sources.
- `creative-context` for governed contexts and dashboard revisions;
  `admin-surfaces` for `/agents` fleet flags, usage audit, and connected DBs.

## What To Do First

| Request | Do this |
|---|---|
| Edit a panel on the open dashboard | `get-sql-dashboard` with `panelIds`, then `mutate-dashboard`, then read its verification result |
| Metric or data question | Adapt a preloaded reference if one fits, else one `search-analytics-query-catalog`; run one bounded query |
| Build or clone a new dashboard from another | `search-dashboard-references`, then inspect results with `get-sql-dashboard` or `get-explorer-dashboard` by `kind` |
| Named account or deal deep dive | `account-deep-dive` first; read `account-health` for account health |

A reference is context, not live data. Prefer a current `certified` dashboard (an
edit voids certification) and cite what you adapted.

**A dashboard edit is done only when `mutate-dashboard` returns `verified: true`.**
On `verified: false`, an error, or the user saying a change is not visible, call
`inspect-dashboard-panel` before saying anything about the chart. "Applied N
ops", a raw `bigquery` result, or a missing warning banner is not proof. Never
claim a visible change you have not verified.

## Answering Data Questions

1. **One bounded call.** List, filter, count, and cohort questions are one SQL
   statement or one server-side `run-code` script; never page or fan out per
   item. Run it once and answer.
2. **Escalate on a miss.** If the catalog has no usable result, make one
   discovery pass (`list-data-dictionary`, `search-bigquery-schema`,
   `data-source-status`), then query; don't add unasked breakdowns.
3. **Answer in chat.** Give a concise, grounded answer; return a table only when
   the user asks to see query rows, and for >50 rows state the total and top
   rows.
4. **Chunk only reading.** For 30+ qualitative items a query cannot answer,
   group 5-10. See `adhoc-analysis`.

State confidence, never a dead end: cite the dashboard or query used; label a
figure "Unverified" when no live query ran this turn.

## Core Rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Sibling apps delegate product usage, app events, signups, conversions, and
  other metrics over A2A in natural language, never SQL. Analytics owns schema,
  source selection, and tools; shaped reads are stable contracts. For delegated
  asks, choose defaults and label partial answers.
- Never invent data or source semantics; include source, window, filters, sample
  size, join method, and caveats.
- Use actions for data and sharing; never bypass access checks with raw SQL.
- Provider actions are bounded shortcuts, not limits. For broad or
  absence-sensitive Gong work, stage raw API data and use `query-staged-dataset`
  or a Data Program; see `provider-api`, `data-programs`, `gong`.
- Create dashboards, panels, or saved analyses only when explicitly asked;
  otherwise suggest one and wait. Never add sidebar items or modify an existing
  dashboard without a directive; an explicit edit request is that directive.
- When the user challenges coverage or asks why records are missing, rerun from
  the source cohort and give the updated answer; never claim a revision you
  didn't produce.
- Never cite the public `demo` source as real analytics evidence unless asked.
- Store large payloads in file/blob storage, never SQL or app state; persist
  only URLs, ids, or handles.
- Never hardcode keys, tokens, webhook URLs, secrets, or private Builder or
  customer data; use secrets/OAuth and placeholders.
- For external integrations, inspect the workspace/provider connection catalog
  first; reuse its scoped resolver.
- External MCP callers: use cataloged direct actions for bounded reads and
  allowlisted mutations. Use `ask_app` for interpretation, source selection,
  multi-step work, or unsupported writes.
- Reports/alerts use SQL actions; cap at five recipients.

## Application State

- `navigation` exposes the current dashboard, analysis, source, chart, and
  selection; `navigate` moves the user between Analytics surfaces. Use
  `view-screen` when the active context is unclear.
- Clicking a panel stages it as a chat context chip and writes `selected-object`
  with `type="dashboard-panel"`; its panel id is what `get-sql-dashboard`
  `panelIds` takes.

## Shared UI

Before building common workspace or agent UI, read `agent-native-toolkit`; read
`customizing-agent-native` before adapting shared UI.
