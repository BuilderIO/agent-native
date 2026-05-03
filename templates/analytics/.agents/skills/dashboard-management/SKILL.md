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
3. Build a complete `SqlDashboardConfig` with `name` and `panels`.
4. Every panel needs `id`, `title`, `source`, `chartType`, `width`, and `sql`.
5. Persist with `update-dashboard`, not raw SQL or settings writes.
6. Navigate to it with `pnpm action navigate --view=adhoc --dashboardId=<id>`.

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

Use `variables` for shared constants such as table refs or project IDs. Identifier-like variables can be used bare (`FROM {{EVENTS}}`); string values should be inside SQL string literals (`'{{author}}'`).

Use conditional blocks for optional filters:

```sql
{{?country}}AND country = '{{country}}'{{/country}}
```

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
