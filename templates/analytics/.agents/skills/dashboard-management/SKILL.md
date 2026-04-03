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
3. Navigate the user to it: `pnpm script navigate --view=adhoc --dashboardId={id}`

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
