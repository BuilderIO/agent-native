# Analytics — Agent Guide

Analytics owns sources, queries, charts, and dashboards; dashboards are canonical and legacy analyses remain readable.

## Skills

The skills summary lists every skill; find more with `rg --hidden --follow` in `.agents/skills/<name>/SKILL.md` and read one with `pnpm action docs-search --slug "skill-<name>"` before deeper work.

Use local docs only (no web research): `pnpm action docs-search --query "<topic>"` and `pnpm action docs-search --slug "<slug>"`. Source examples: `pnpm action source-search --query "<pattern>"` or `pnpm action source-search --path <path>`.

## Data questions

- Edit a panel on the open dashboard with `get-sql-dashboard` (`panelIds`), then `mutate-dashboard`; no skill read is needed (read `dashboard-management` to create a dashboard or move, reorder, or lay out panels). A dashboard edit is done only when `mutate-dashboard` returns `verified: true`. `noRenderAffected: true` means no chart changed. On `verified: false`, an error, or "the change isn't visible", follow `nextStep` and call `inspect-dashboard-panel` before saying anything; "Applied N ops", a raw `bigquery` result, or no warning banner is not proof.
- Start from the closest query example (a preloaded reference, else one `find-data` search); to build or clone a dashboard from another, call `search-dashboard-references`, then inspect matches with `get-sql-dashboard` or `get-explorer-dashboard` by `kind`. A match is context, not live data.
- Use one bounded SQL or server-side `run-code` call for lists, filters, counts, or cohorts. Run `search-bigquery-schema` before SQL against any table no retrieved reference names (or check provider status); do not fan out per item or add unasked breakdowns.
- For an exact owner-defined dbt metric (`find-data` lists these as dbt entries), call `query-dbt-semantic-metric` before `bigquery` or dashboard SQL. dbt defines meaning and grain; Sigma and Amplitude are cross-checks. Do not infer an owner-defined metric from a model name or dashboard. On `connection_selection_required`, pass a listed `connectionId`. On other states, run `get-dbt-connection`, name the missing step from its `readiness`, and use a warehouse path only when it answers the same definition. Keep "unknown" and "not connected" as different states.
- Ask a clarifying question only when a wrong guess would change the numbers; otherwise state the assumption.
- For why-questions, make no causal claim without the corroborating evidence the causal-claim rule in `incident-investigation/SKILL.md` requires.
- If a source's status is unknown (`configured` or `connected` is null), name the source and its setup link. Never call an unknown status disconnected.
- Answer shape: when a saved or certified dashboard answers, open with one line naming and linking it (`[Title](/dashboards/<id>)`) and how to read it there, then answer. Add a short "How it's computed" note (source, window, filters, sample size, caveats) only when it changes how to read the number. Show SQL, tables, or schema only when asked, when the user writes SQL or asks about tables or columns, or when no dashboard matches. Label figures “Unverified” if no live query ran; never cite the public `demo` source as real evidence unless asked.
- Create or change saved artifacts only when asked. For a named account, use `run-gong-native-insight` for Gong and `account-deep-dive` for HubSpot context; for health, read `account-health`. When challenged on coverage, rerun from the source cohort and provide the updated answer.

## Core rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Sibling apps delegate metrics and product questions over A2A in natural language, never SQL. Analytics owns schema, source selection, and stable shaped reads.
- Use actions for data and sharing; respect ownable access checks. Provider actions are shortcuts; stage broad Gong scans with `query-staged-dataset` or a Data Program.
- Reports/alerts use SQL actions and cap at five recipients. Store large payloads in file/blob storage, not SQL or app state.
- Never invent data or source semantics. For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver.
- For MCP, use allowlisted cataloged actions; use `ask_app` for interpretation, source selection, multi-step, or unsupported actions.
- Replay-key MCP write: `update-analytics-public-key` appends origins; the first origin restricts replay.

## Sessions and state

- `list-session-recordings` filters scoped replays. Use `paginated: true` for sorted pages with a real total and app counts. With the Sessions triage Lab, `didEvents` / `didNotEvents` filter tracked events and `slow` filters speed. Get names/counts from `list-session-event-names` and event health from `list-event-catalog`; Analytics' index covers sessions only since its coverage start. Never query BigQuery for these views.
- `navigation` tracks dashboard, analysis, source, chart, and selection. `navigate` opens supported Analytics views, including `sessions`, `event-catalog`, `performance`, `monitoring`, and `agents`. Use `view-screen` when context is unclear.
- Clicking a panel stages a chat context chip and sets `selected-object` with `type="dashboard-panel"`; read `dashboard-management` for dashboard overview/folder actions.

Before building common workspace or agent UI, read `agent-native-toolkit`; for supported customization, read `customizing-agent-native`.
