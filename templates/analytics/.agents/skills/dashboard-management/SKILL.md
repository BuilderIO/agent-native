---
name: dashboard-management
description: >-
  How analytics dashboards are stored, created, and modified. Covers SQL dashboard tables,
  legacy settings migration, valid panel sources, layout shape, and safe update patterns.
---

# Dashboard Management

Dashboards are SQL-backed resources. New dashboards and analyses live in the template tables, not in settings KV rows.

## Storage

Current storage:

| Table              | Purpose                                      |
| ------------------ | -------------------------------------------- |
| `dashboards`       | Explorer and SQL dashboard records           |
| `dashboard_views`  | Saved filter presets per dashboard           |
| `dashboard_shares` | Standard framework share grants              |
| `analyses`         | Saved ad-hoc analysis records                |
| `analysis_shares`  | Standard framework share grants for analyses |

Legacy settings keys such as `u:<email>:dashboard-*`, `u:<email>:sql-dashboard-*`, `o:<orgId>:sql-dashboard-*`, and `adhoc-analysis-*` are still read as a fallback and copied into SQL on access. Do not create new dashboard settings rows.

Use `update-dashboard` for dashboard edits. It resolves the current user/org context, validates the config, applies JSON-pointer operations when provided, writes the SQL-backed record, and preserves sharing semantics.

## Valid Panel Sources

`panel.source` is a backend selector, not a table name. It must be one of:

| Source        | Query shape                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| `bigquery`    | Literal warehouse SQL. Table names belong inside the SQL string.                                         |
| `ga4`         | JSON descriptor for the Google Analytics Data API.                                                       |
| `amplitude`   | JSON descriptor for an Amplitude query.                                                                  |
| `first-party` | Read-only SQL over this template's `analytics_events` table, usually via `query-agent-native-analytics`. |

Do not use `app-db` as a dashboard source. For first-party events collected through `/track`, use `source: "first-party"` or the `query-agent-native-analytics` action rather than raw internal `db-query`.

## Creating A Dashboard

When the user asks for a dashboard:

1. Read the injected `<data-dictionary>` block first (catalog-first). If relevant entries exist, use their `table`, `columns`, `queryTemplate`, and gotchas verbatim.
2. If a metric definition, date range, or grain is ambiguous and the choice would change the panel's numbers, use the `ask-question` clarifying tool once before building. Skip it when the dictionary or the user already settled it.
3. If a metric is not documented, do not guess column names. Ask for the table/columns or introspect the provider schema, then propose a dictionary entry with `save-data-dictionary-entry`.
4. Build a complete `SqlDashboardConfig` with `name` and `panels`. Optionally set top-level `columns` (1–6, default 2) to control how many grid columns the panels before any section use.
5. Every panel needs `id`, `title`, `source`, `chartType`, `width`, and `sql`. `width` is the number of grid columns the panel spans (1..6, clamped to the active section's column count). Section panels skip `source` and `sql` and may set their own `columns` (1–6) to override the dashboard default for the panels following the section.
6. Persist with `update-dashboard`, not raw SQL or settings writes.
7. Navigate to it with `pnpm action navigate --view=adhoc --dashboardId=<id>`.

Layout is always **1 column when the available content width is below the `md` threshold** (panels stack), then expands to the configured column count at/above it. The grid uses a container query, so it also stacks when the agent sidebar narrows the content pane — not only at narrow viewports. So picking 3 or 4 columns is fine — the renderer keeps narrow layouts readable automatically.

```bash
pnpm action update-dashboard --dashboardId weekly-metrics --config '<full json>'
pnpm action navigate --view=adhoc --dashboardId=weekly-metrics
```

The save path dry-runs BigQuery panels before persisting. If validation returns a provider error, fix the query and retry. Never work around validation by writing directly to a table.

## When To Use An Extension Instead

Native Analytics dashboards are JSON configs rendered by the built-in dashboard
components. Use `update-dashboard` only when the request fits that model:
standard panels, supported chart types, filters, variables, sections, and grid
layout.

If the user asks for a dashboard or analytical surface that needs bespoke UI or
code beyond the dashboard JSON/component model, create an extension instead.
Examples include custom interaction flows, non-standard visualizations, complex
multi-step workflows, highly custom layouts, custom client-side state, or a
dashboard-like app that needs behavior the built-in renderer cannot express. In
production mode, call `create-extension` automatically and then tell the user
that the request needed a bespoke surface, so you built it as an extension
rather than forcing it into a native dashboard config.

## Config Shape

```jsonc
{
  "name": "Weekly Metrics",
  "description": "Core product and acquisition metrics",
  // Default grid columns for panels before any section. 1–6, default 2.
  // The grid is always 1 column on small screens and expands at `md:`.
  "columns": 3,
  "filters": [
    {
      "id": "date",
      "type": "date-range",
      "label": "Date Range",
      "default": "30d",
    },
  ],
  "variables": {
    "EVENTS": "`my_project.analytics.events`",
  },
  "panels": [
    // 3 metric cards sit side-by-side at md+ thanks to the dashboard's "columns": 3.
    {
      "id": "kpi-clicks",
      "title": "Clicks",
      "source": "first-party",
      "chartType": "metric",
      "width": 1,
      "sql": "SELECT COUNT(*) AS value FROM analytics_events WHERE event_name = 'click'",
    },
    {
      "id": "kpi-signups",
      "title": "Signups",
      "source": "first-party",
      "chartType": "metric",
      "width": 1,
      "sql": "SELECT COUNT(*) AS value FROM analytics_events WHERE event_name = 'signup'",
    },
    {
      "id": "kpi-active",
      "title": "Active users",
      "source": "first-party",
      "chartType": "metric",
      "width": 1,
      "sql": "SELECT COUNT(DISTINCT user_id) AS value FROM analytics_events",
    },
    // Section header switches the grid to 2 columns for the panels below it.
    {
      "id": "trends",
      "title": "Trends",
      "chartType": "section",
      "width": 1,
      "columns": 2,
    },
    {
      "id": "events",
      "title": "Events",
      "source": "first-party",
      "chartType": "line",
      "width": 2,
      "sql": "SELECT DATE(timestamp) AS date, COUNT(*) AS value FROM analytics_events WHERE timestamp >= '{{dateStart}}' AND timestamp < '{{dateEnd}}' GROUP BY 1 ORDER BY 1",
    },
  ],
}
```

## Filters And Variables

`filters[]` defines dashboard-wide controls. Filter values are available in panel SQL through `{{var}}` interpolation. Date ranges emit `{{<id>Start}}` and `{{<id>End}}`.

**Filter ids must be unique.** Two filters with the same `id` collide on the same URL param, so changing one visibly updates the other in the UI. The dashboard save endpoint rejects duplicates with a 400.

**Use `type: "date-range"` for paired start/end dates.** Don't add two `type: "date"` filters labeled "Start" and "End" — even with distinct ids, that ships the wrong UX. A single date-range filter renders as the "from … to …" pair and exposes both halves to SQL via `{{<id>Start}}` / `{{<id>End}}`.

Use `variables` for shared constants such as table refs or project IDs. Identifier-like variables can be used bare (`FROM {{EVENTS}}`); string values should be inside SQL string literals (`'{{author}}'`).

Use conditional blocks for optional filters:

```sql
{{?country}}AND country = '{{country}}'{{/country}}
```

Filters auto-apply on change — there is no Apply button. Each filter change writes to the URL and re-runs the affected panels. Other filters are preserved (the URL update is functional, not destructive). If you see a filter "reset" itself when another filter changes, look for a duplicate `id` first.

## Modifying A Dashboard

Preferred patterns:

```bash
# JSON-pointer style patch
pnpm action update-dashboard --dashboardId weekly-metrics \
  --ops '[{"op":"replace","path":"/panels/0/title","value":"Events by Day"}]'

# Full config replacement
pnpm action update-dashboard --dashboardId weekly-metrics --config '<full json>'
```

After a mutation, navigate to the dashboard if the user is elsewhere. The app syncs through the framework's polling/query invalidation path.

## Building Large First-Party Dashboards (compose-dashboard)

For a **first-party analytics** dashboard, prefer `compose-dashboard` over hand-authoring a big `update-dashboard` config. You name the metrics; the SERVER expands each into a full, validated panel (SQL + chart config) from the shipped metric catalog and saves them in ONE atomic call. This avoids the failure mode where the agent must stream a giant multi-panel `update-dashboard` argument inside the ~40s budget — that big tool-call can't be resumed mid-stream and is all-or-nothing on validation, so the agent thrashes (repeated update-dashboard + tool-search, never landing).

- **Never hand-author large first-party configs panel-by-panel.** Call `compose-dashboard` with the metric keys instead.
- Unknown metric keys are skipped and reported in `unknownMetrics` (not fatal). Each panel's SQL is validated independently — valid panels save, invalid ones are reported in `invalidMetrics`.
- By default (no `overwrite`), composing into an existing dashboard APPENDS the new panels and skips ids already present. `overwrite: true` replaces the whole config.
- Each metric accepts an optional per-metric `window` of `'30d' | '90d' | 'all'` (only affects windowed virality/time metrics) and `title` / `chartType` / `width` overrides.
- Returns `{ dashboardId, panelCount, createdMetrics, unknownMetrics, invalidMetrics, skippedExistingIds }` — report `panelCount` as proof-of-done.

Available metric keys: `total-signups`, `signups-over-time`, `signups-by-template`, `sessions-by-app`, `sessions-over-time`, `signed-in-vs-anon`, `total-template-clicks`, `total-demo-clicks`, `total-cli-copies`, `template-interest-over-time`, `clicks-by-template`, `demo-clicks-by-template`, `cli-copies-by-template`, `cli-copies-over-time`, `pageviews-over-time`, `top-referrer-domains`, `referred-signups-30d`, `viral-signup-share-30d`, `clip-share-signups-30d`, `signups-by-referral-source`, `referred-signups-over-time`, `top-referrers`, `share-funnel-30d`, `viral-participation-rate-90d`, `viral-coefficient-90d`, `activated-referrers-90d`.

```bash
# Build a large first-party dashboard in ONE call (server generates the panels)
pnpm action compose-dashboard --dashboardId first-party-overview --title "First-Party Overview" \
  --metrics '["total-signups","signups-over-time","signups-by-template","sessions-by-app","viral-coefficient-90d","top-referrers","share-funnel-30d"]'
```

## Reliable Bulk Edits

This is the dashboard-specific application of the framework-wide `reliable-mutations` skill — read that for the general rule (one atomic write, verify end state, report proof-of-done).

Hosted agent runs have a **~40s budget**. Many sequential `update-dashboard` calls (one per panel, plus schema-discovery calls) will blow that budget and leave the dashboard in a partial state — earlier inserts looked like they succeeded (✓), but nothing actually persisted. Avoid this:

- **For a large first-party dashboard, use `compose-dashboard`** (see the section above): name the metrics, the server generates the panels in one call. Do not hand-author the big config.
- **Batch ALL changes into ONE `update-dashboard` call.** A single `update-dashboard` is atomic: it applies every op to an in-memory config, validates all panel SQL, then upserts once. Never loop the action.
  - To add N panels, pass N ops in one call: `ops: [{op:"insert", path:"/panels/-", value:<panel>}, … ]` (`/panels/-` appends to the end).
  - The `ops` format needs no discovery: each op is `{ op, path, from?, value? }`, `op ∈ set | replace | remove | insert | move | move-before`, and `path` is a JSON Pointer (e.g. `/panels/3`, `/panels/3/title`, `/name`).
- **To add a shipped template's panels, prefer `install-dashboard-template` with `mergePanels: true`** and the existing `dashboardId`. It appends only the template panels whose id is not already present (preserving existing panels and order) in one atomic save — you don't author each panel yourself.
- **Always verify the returned proof-of-done and report it.** `update-dashboard` returns `panelCount`, `appliedOps`, and a `summary` string; `install-dashboard-template --mergePanels` returns `addedPanelIds`, `skippedExistingIds`, and `panelCount`. Tell the user the resulting panel count instead of assuming success.

```bash
# Add several panels in ONE atomic call (never one call per panel)
pnpm action update-dashboard --dashboardId weekly-metrics \
  --ops '[{"op":"insert","path":"/panels/-","value":{"id":"p1","title":"A","source":"first-party","chartType":"metric","width":1,"sql":"SELECT COUNT(*) AS value FROM analytics_events"}},
          {"op":"insert","path":"/panels/-","value":{"id":"p2","title":"B","source":"first-party","chartType":"metric","width":1,"sql":"SELECT COUNT(DISTINCT user_id) AS value FROM analytics_events"}}]'

# Append a template's panels to an existing dashboard in one call
pnpm action install-dashboard-template --templateId skills-cli-funnel --dashboardId weekly-metrics --mergePanels true
```

## Archiving vs deleting

Dashboards have a soft-delete state. The default user-facing destructive action is **Archive** (recoverable). Hard delete still exists, but lives behind a "Delete permanently" confirm in both the page header and the sidebar dropdown — and in the agent surface, behind the older `delete-dashboard` action. Archived rows stay in the `dashboards` table with `archived_at` set, are hidden from the default sidebar list, and remain accessible by id (so deep links in chat history keep working) until explicitly purged.

```bash
# Archive
pnpm action archive-dashboard --id weekly-metrics
# Restore
pnpm action archive-dashboard --id weekly-metrics --archived false
```

Default the agent to archive when the user says "delete" / "remove" / "get rid of" a dashboard. Reach for hard delete only when the user explicitly says "permanently", "for good", or similar. List queries default to active rows only — use `?archived=1` on `/api/sql-dashboards` (or the `archived: 'all' | 'archived' | 'active'` option on `listDashboards`) to see archived rows.

## Sharing

Dashboards are private by default. Use the framework sharing actions:

```bash
pnpm action share-resource --resourceType dashboard --resourceId weekly-metrics --principalType org --principalId <org-id> --role viewer
pnpm action set-resource-visibility --resourceType dashboard --resourceId weekly-metrics --visibility org
```

Writes require editor access; deletes require admin access. Owners always satisfy access checks.

## Important Rules

- Never fabricate data or create a dashboard from guessed schema. A panel's SQL must hit a real source; do not present figures you did not actually query.
- Never write dashboard configs into the settings table.
- Never set `panel.source` to a table name or unsupported backend.
- Use `first-party` for `/track` data and `query-agent-native-analytics` for ad-hoc first-party event questions.
- Use `update-dashboard` for creates and edits.
