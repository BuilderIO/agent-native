# Analytics — Agent Guide

Analytics owns sources, queries, charts, and dashboards. Dashboards are
canonical; legacy analyses remain readable.

## Skills

Read the relevant skill before deeper work:

- `data-querying` for source inspection, SQL generation, result handling, and
  `/chart` embeds; `bigquery`, `hubspot`, `gong`, `prometheus` for provider
  specifics.
- `account-health` for named customer health, QBR, renewal, contract usage,
  identity, and product adoption.
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

1. **Search existing work first.** Use `search-analytics-query-catalog` for
   metrics and `search-dashboard-references` for dashboard adaptation. Read a
   match with `get-sql-dashboard` or `get-explorer-dashboard` by `kind`; it is
   context, not source data. Adapt its SQL to the requested window and filters,
   run once, and stop. Prefer current `certified` results over starred ones;
   edits stale certification.
2. **One bounded call.** List/filter/count/cohort questions take one SQL query
   or server-side `run-code` script, never per-item fan-out.
3. **Escalate on a miss.** Make one discovery pass with `list-data-dictionary`,
   `search-bigquery-schema`, or `data-source-status`, then query. Skip unasked
   breakdowns.
4. **Answer in chat.** Return a short table, chart, or export, not just a path;
   for >50 rows, state the total and top rows.
6. **Chunk only reading.** For 30+ qualitative items a query cannot answer,
   group 5-10. See `adhoc-analysis`.

State confidence, never a dead end: cite the dashboard or query used (note
certified ones); label figures "Unverified" when no live query ran.

## Core Rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Sibling apps delegate product usage, app events, signups, conversions, and
  other metrics over A2A in natural language, never SQL. Analytics owns schema,
  source selection, and tools; shaped reads are stable contracts.
- Delegation: choose defaults; label partial.
- Never invent data or source semantics; include source, window, filters, sample
  size, join method, and caveats.
- Use actions for data and sharing; don't bypass ownable-resource access checks
  with raw SQL.
- Provider actions are bounded shortcuts, not limits. For broad or
  absence-sensitive Gong work, stage raw API data and use `query-staged-dataset`
  or a Data Program; see `provider-api`, `data-programs`, and `gong` for secure
  provider and hosted-endpoint boundaries.
- Create dashboards, panels, or saved artifacts only when explicitly asked;
  suggest and wait otherwise. Scope them to the question, avoid decorative
  metrics, and never modify existing dashboards without a directive.
- For named account/deal deep dives, call `account-deep-dive` first.
- For named account health, read `account-health` before querying.
- When the user challenges coverage or asks why records are missing, rerun from
  the source cohort and include the updated answer directly — never claim a
  revision you didn't produce.
- Never cite the public `demo` source as real analytics evidence unless asked.
- Store large payloads in file/blob storage, never SQL or app state. Persist
  only URLs, ids, or handles.
- Never hardcode API keys, tokens, webhook URLs, secrets, private Builder data,
  or customer data. Use secrets/OAuth and obvious placeholders in examples.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver.
- External MCP callers: use cataloged direct actions for bounded reads and
  allowlisted mutations. Use `ask_app` for interpretation, source selection,
  multi-step work, unavailable actions, or unsupported writes.
- Reports/alerts use SQL actions; cap at five recipients.

## Actions

| Action | Use |
| --- | --- |
| `search-analytics-query-catalog` | Search saved metric examples first. |
| `search-dashboard-references` | Find dashboards to replicate. |
| `get-sql-dashboard` | Read the dashboard and exact panel SQL. |
| `certify-dashboard` | Admin-only approval of its current version. |
| `list-session-recordings` | Filter scoped replays by date, app, duration, error signals, visitor type, or email domain. `paginated: true` returns sorted pages, total, and app counts; the default returns the legacy array. |
| DB | `list-db-admin-connections`, `list-connected-database-tables`, `db-admin-federated-read`: registry, schema, bounded joins. |

## Application State

- `navigation` exposes the current dashboard, analysis, source, chart, and
  selection. `navigate` moves the user between supported Analytics surfaces,
  `"sessions"`, `"monitoring"`, and `"agents"`. Use `view-screen` when the
  active context is unclear.
- Clicking a panel stages it as a chat context chip and writes `selected-object`
  with `type="dashboard-panel"`. Read `dashboard-management` for the
  `/dashboards` overview and folder actions.

## Shared UI

Before building common workspace or agent UI, read `agent-native-toolkit`; read
`customizing-agent-native` before adapting shared UI.
