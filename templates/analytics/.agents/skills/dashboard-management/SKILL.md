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

| Source        | Query shape                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `bigquery`    | Literal warehouse SQL. Table names belong inside the SQL string.                                |
| `ga4`         | JSON descriptor for the Google Analytics Data API.                                               |
| `amplitude`   | JSON descriptor for an Amplitude query.                                                          |
| `first-party` | Read-only SQL over this template's `analytics_events` table, usually via `query-agent-native-analytics`. |

Do not use `app-db` as a dashboard source. For first-party events collected through `/track`, use `source: "first-party"` or the `query-agent-native-analytics` action rather than raw internal `db-query`.

## Creating A Dashboard

When the user asks for a dashboard:

1. Read the injected `<data-dictionary>` block first. If relevant entries exist, use their `table`, `columns`, `queryTemplate`, and gotchas verbatim.
2. If a metric is not documented, do not guess column names. Ask for the table/columns or introspect the provider schema, then propose a dictionary entry with `save-data-dictionary-entry`.
3. Build a complete `SqlDashboardConfig` with `name` and `panels`. Optionally set top-level `columns` (1–6, default 2) to control how many grid columns the panels before any section use.
4. Every panel needs `id`, `title`, `source`, `chartType`, `width`, and `sql`. `width` is the number of grid columns the panel spans (1..6, clamped to the active section's column count). Section panels skip `source` and `sql` and may set their own `columns` (1–6) to override the dashboard default for the panels following the section.
5. Persist with `update-dashboard`, not raw SQL or settings writes.
6. Navigate to it with `pnpm action navigate --view=adhoc --dashboardId=<id>`.

Layout is always **1 column on screens narrower than `md`** (panels stack), then expands to the configured column count from `md` and up. So picking 3 or 4 columns is fine — the renderer keeps mobile/narrow layouts readable automatically.

```bash
pnpm action update-dashboard --dashboardId weekly-metrics --config '<full json>'
pnpm action navigate --view=adhoc --dashboardId=weekly-metrics
```

The save path dry-runs BigQuery panels before persisting. If validation returns a provider error, fix the query and retry. Never work around validation by writing directly to a table.

## Config Shape

```jsonc
{
  "name": "Weekly Metrics",
  "description": "Core product and acquisition metrics",
  "filters": [
    { "id": "date", "type": "date-range", "label": "Date Range", "default": "30d" }
  ],
  "variables": {
    "EVENTS": "`my_project.analytics.events`"
  },
  "panels": [
    {
      "id": "events",
      "title": "Events",
      "source": "first-party",
      "chartType": "line",
      "width": 2,
      "sql": "SELECT DATE(timestamp) AS date, COUNT(*) AS value FROM analytics_events WHERE timestamp >= '{{dateStart}}' AND timestamp < '{{dateEnd}}' GROUP BY 1 ORDER BY 1"
    }
  ]
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

- Never fabricate data or create a dashboard from guessed schema.
- Never write dashboard configs into the settings table.
- Never set `panel.source` to a table name or unsupported backend.
- Use `first-party` for `/track` data and `query-agent-native-analytics` for ad-hoc first-party event questions.
- Use `update-dashboard` for creates and edits.
