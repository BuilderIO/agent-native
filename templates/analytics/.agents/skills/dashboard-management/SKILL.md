---
name: dashboard-management
description: >-
  How dashboards are stored, created, and modified. Covers the settings key
  pattern, layout model, and config structure for analytics dashboards.
---

# Dashboard Management

Dashboards are the primary UI for visualizing data. Each dashboard is a configurable layout of data widgets stored as a settings entry.

## Storage

Dashboards are stored in the SQL settings table using the key pattern `dashboard-{id}`.

```ts
import { readSetting, writeSetting } from "@agent-native/core/settings";

// Read a dashboard config
const config = await readSetting("dashboard-my-dashboard");

// Write/update a dashboard config
await writeSetting("dashboard-my-dashboard", {
  id: "my-dashboard",
  title: "Weekly Metrics",
  description: "Key metrics updated weekly",
  widgets: [ ... ],
});
```

## Dashboard Config Shape

```json
{
  "id": "weekly-metrics",
  "title": "Weekly Metrics",
  "description": "Key metrics updated weekly",
  "widgets": [
    {
      "id": "signups-chart",
      "type": "chart",
      "title": "Weekly Signups",
      "config": {
        "query": "...",
        "chartType": "line"
      },
      "position": { "x": 0, "y": 0, "w": 6, "h": 4 }
    }
  ]
}
```

## Other Settings Keys

| Key Pattern        | Contents                           |
| ------------------ | ---------------------------------- |
| `dashboard-{id}`   | Dashboard configuration and layout |
| `config-{id}`      | Explorer/tool configuration        |
| `analytics-theme`  | Theme settings (colors, dark mode) |

## Creating a Dashboard

The typical flow when the user asks for a new dashboard:

1. Determine what data to show (ask clarifying questions if needed)
2. Write the dashboard config to settings: `writeSetting("dashboard-{id}", config)`
3. Navigate the user to it: `pnpm action navigate --view=adhoc --dashboardId={id}`

The UI picks up the new dashboard via SSE events on settings changes.

## Modifying a Dashboard

1. Read the current config: `readSetting("dashboard-{id}")`
2. Modify the widgets, title, or layout
3. Write back: `writeSetting("dashboard-{id}", updatedConfig)`

The UI updates automatically via SSE.

## Listing Dashboards

Dashboard configs can be discovered by querying settings with the `dashboard-` prefix. The overview page shows all configured dashboards.

## Important Notes

- Dashboard IDs should be URL-safe (lowercase, hyphens, no spaces)
- Widget positions use a grid system — `x`, `y` for placement, `w`, `h` for size
- The UI dynamically renders widgets based on the `type` field
- Always use `writeSetting` / `readSetting` — never write dashboard configs to files

## SQL Dashboards (`sql-dashboard-{id}`)

The newer, generic dashboard system. Each dashboard is a list of `SqlPanel`s rendered against BigQuery or the app DB. **Use this for any new dashboard.** Source of truth: `app/pages/adhoc/sql-dashboard/types.ts`.

Storage key: `sql-dashboard-{id}`. CRUD endpoints: `GET/POST/DELETE /api/sql-dashboards/{id}`.

### Config shape

```jsonc
{
  "name": "DevRel Leaderboard",
  "description": "Blog signups by author",
  "filters": [
    { "id": "date", "type": "date-range", "label": "Date Range", "default": "2026-01-01" },
    { "id": "cadence", "type": "select", "label": "Cadence", "default": "WEEK",
      "options": [
        { "value": "WEEK", "label": "Weekly" },
        { "value": "MONTH", "label": "Monthly" }
      ] },
    { "id": "recent", "type": "toggle-date", "label": "Recent only", "default": "30d" }
  ],
  "variables": {
    "FIRST_PV": "`my-project.dataset.first_pageviews`"
  },
  "panels": [
    {
      "id": "ts",
      "title": "Signups by Author",
      "source": "bigquery",
      "chartType": "stacked-area",
      "width": 2,
      "sql": "SELECT DATE_TRUNC(DATE(v.created_date), {{cadence}}) AS date, v.author, COUNT(*) AS value FROM {{FIRST_PV}} v WHERE v.created_date BETWEEN TIMESTAMP('{{dateStart}}') AND TIMESTAMP('{{dateEnd}}') {{?recent}}AND v.pub_date >= '{{recent}}'{{/recent}} GROUP BY 1, 2 ORDER BY 1",
      "config": {
        "pivot": { "xKey": "date", "seriesKey": "author", "valueKey": "value" }
      }
    },
    {
      "id": "summary",
      "title": "Author Leaderboard",
      "source": "bigquery",
      "chartType": "table",
      "width": 2,
      "sql": "SELECT v.author, COUNT(*) AS signups, SAFE_DIVIDE(SUM(s), COUNT(*)) AS rate FROM {{FIRST_PV}} v WHERE v.created_date BETWEEN TIMESTAMP('{{dateStart}}') AND TIMESTAMP('{{dateEnd}}') GROUP BY v.author ORDER BY signups DESC",
      "config": {
        "sortable": true,
        "columns": [
          { "key": "author", "label": "Author" },
          { "key": "signups", "format": "number" },
          { "key": "rate", "label": "Rate", "format": "percent" }
        ]
      }
    }
  ]
}
```

### Filters

`filters[]` defines dashboard-wide controls. The filter bar renders them above the panel grid and writes values to the URL (`?f_<id>=...`). Each filter id becomes a `{{var}}` available in every panel's SQL.

| Type          | Notes                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------- |
| `date`        | Single date picker. Emits `{{<id>}}` as `YYYY-MM-DD`.                                       |
| `date-range`  | Two date pickers. Emits `{{<id>Start}}` and `{{<id>End}}`.                                  |
| `select`      | Dropdown. Provide `options: [{ value, label }]`. Use for cadence, metric type, etc.        |
| `toggle`      | On/off button. Emits `"true"` or `""`. Pair with `{{?<id>}}` blocks for conditional SQL.   |
| `toggle-date` | Toggle button + revealed date picker. When on, defaults to `default` (`"30d"` = 30d ago).  |
| `text`        | Free text input.                                                                            |

`default` shorthand for date filters: `"30d"` = 30 days ago, `"today"` = today, anything else is a literal.

### Variables

`variables` is a static dict merged into the filter vars (filter values win on conflict). Use it for table refs, project IDs, or any constant you don't want hardcoded across multiple panel SQLs:

```json
"variables": { "PROJECT": "my-bq-project", "BLOG": "`my.dataset.blog_pageviews`" }
```

Then reference as `{{PROJECT}}` and `{{BLOG}}` in panel SQL.

### SQL interpolation

Panel SQL is interpolated client-side before execution:

- `{{name}}` → replaced with the variable value (single quotes auto-escaped). Renders empty if missing.
- `{{?name}}...{{/name}}` → conditional block; only emitted when `name` is truthy. Wrap optional WHERE clauses in this so empty filters don't break SQL.

**Always put string-typed variables inside SQL string literals**: `TIMESTAMP('{{dateStart}}')`, `'{{author}}'`. Identifier-typed variables (cadence values like `WEEK`, table refs) go bare: `DATE_TRUNC(date, {{cadence}})`, `FROM {{FIRST_PV}}`.

### Chart types

| chartType       | Notes                                                                                |
| --------------- | ------------------------------------------------------------------------------------ |
| `line` / `area` | Single or multi-series time series.                                                  |
| `bar`           | Vertical bars.                                                                        |
| `stacked-bar`   | Bars stacked per x value. Pairs with `pivot` for long-form data.                     |
| `stacked-area`  | Stacked area chart. Pairs with `pivot` for long-form data.                           |
| `metric`        | Big number from the first row, first numeric column.                                  |
| `table`         | Sortable table. Configure columns + formats via `config.columns`.                     |
| `pie`           | Single-series pie. Uses first row column as label, first numeric as value.            |

### Pivot (long → wide)

When your SQL returns long-form rows like `{ date, series, value }` instead of one column per series, set `config.pivot` and the renderer pivots client-side. This avoids needing `CASE WHEN` per author/category in SQL:

```json
"pivot": { "xKey": "date", "seriesKey": "author", "valueKey": "value" }
```

The discovered series become the y-keys for the chart automatically.

### Table column config

```jsonc
"config": {
  "sortable": true,        // default; click headers to sort, three-state
  "limit": 500,            // cap rendered rows; footer shows X of N
  "columns": [
    { "key": "author", "label": "Author" },
    { "key": "url", "label": "Article", "format": "link", "linkKey": "full_url" },
    { "key": "pub_date", "format": "date" },
    { "key": "signups", "format": "number" },
    { "key": "rate", "format": "percent" },   // multiplies 0..1 values by 100
    { "key": "arr", "format": "currency" },
    { "key": "internal_id", "hidden": true }
  ]
}
```

Numeric formats render right-aligned with tabular nums. `link` opens in a new tab; `linkKey` lets the cell text and href come from different columns.

### Provisioning a SQL dashboard

Use the settings API via a short node script — never `curl`:

```bash
node -e "
const { putSetting } = require('@agent-native/core/settings');
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('devrel-config.json', 'utf8'));
putSetting('sql-dashboard-devrel-leaderboard', config).then(() => console.log('saved'));
"
```

Then navigate the user: `pnpm action navigate --view=adhoc --dashboardId=devrel-leaderboard`.
