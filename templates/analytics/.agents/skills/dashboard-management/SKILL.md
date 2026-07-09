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
| `dashboard_revisions` | Bounded dashboard history snapshots       |
| `analyses`         | Saved ad-hoc analysis records                |
| `analysis_revisions` | Bounded analysis history snapshots        |
| `analysis_shares`  | Standard framework share grants for analyses |

Legacy settings keys such as `u:<email>:dashboard-*`, `u:<email>:sql-dashboard-*`, `o:<orgId>:sql-dashboard-*`, and `adhoc-analysis-*` are still read as a fallback and copied into SQL on access. Do not create new dashboard settings rows.

Use `mutate-dashboard` for existing dashboard edits. It resolves the current
user/org context, validates the resulting config, writes the SQL-backed record,
syncs collab, and returns compact proof. Use `update-dashboard` for new
full-config saves, UI full-config saves, or explicitly requested low-level
JSON-pointer edits.

Every meaningful dashboard save snapshots the previous state into
`dashboard_revisions`. Use `list-dashboard-revisions` to inspect available undo
points and `restore-dashboard-revision` to restore one; restore snapshots the
current state first, then syncs open dashboard editors.

Saved analyses follow the same undo model with `analysis_revisions`,
`list-analysis-revisions`, and `restore-analysis-revision`.

Never use `db-patch`, raw SQL, or settings-key edits to create or modify a
dashboard config. Those bypass the dashboard action's access checks, SQL
validation, collab sync, and proof-of-done return. If a dashboard action fails
because the argument shape was wrong, fix that action's arguments and retry
once — do not switch to db-patch or raw SQL.

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
5. Every panel needs `id`, `title`, `source`, `chartType`, `width`, and `sql`. `width` is the number of grid columns the panel spans (1..6, clamped to the active section's column count). Section panels skip `source` and `sql` and may set their own `columns` (1–6) to override the dashboard default for the panels following the section. Extension panels (`chartType: "extension"`) also skip `source` and `sql`; instead they require `config.extensionId` (see "Embedding An Extension As A Panel").
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
components. Use native dashboard actions only when the request fits that model:
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

## Embedding An Extension As A Panel

Use `chartType: "extension"` to embed an existing extension as a dashboard
panel. This is different from the section above: there you replace the whole
dashboard with an extension; here you drop a single extension widget into one
panel slot alongside normal SQL charts. The panel renders the extension's
sandboxed iframe instead of running a query, so it skips `source` and `sql` and
instead requires `config.extensionId` (the id of an extension that already
exists — create it first with `create-extension`). Validation rejects an
extension panel without a non-empty `config.extensionId`.

```jsonc
{
  "id": "pipeline-widget",
  "title": "Pipeline Widget",
  "chartType": "extension",
  "width": 3,
  "config": { "extensionId": "<existing-extension-id>" },
}
```

Notes:

- The panel renders full-bleed (no card chrome/title) and does not receive the
  dashboard's filters/variables/date range — it's a standalone widget for now.
- Access is scoped per viewer: embedding does NOT grant access to the extension
  (same model as ExtensionSlots). If you share a dashboard more broadly than the
  embedded extension, viewers without access to that extension see an
  "extension unavailable" message instead of the content. Share the extension to
  the same audience as the dashboard so all viewers can see it.

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

For existing dashboard edits, default to `mutate-dashboard`. It gives the
agent a small typed script API without exposing arbitrary JavaScript execution.
The main action payload is a string, so it avoids native-array serialization
traps in tool calls while still giving the agent a code-like editing surface.
The server parses only documented `dashboard.*` method calls, applies the
resulting operations in memory, validates the final dashboard config, writes
SQL once, syncs collab, and returns compact proof.

Arguments must be JSON-compatible literals, so quote object keys. Variables,
imports, loops, functions, templates, network, filesystem, DB access, and
calling other actions from the script are not available.

```ts
type DashboardMutationApi = {
  dashboard: {
    set(patch: DashboardPatch): void;
    panel(id: string): PanelSelection;
    section(id: string): SectionSelection;
    panels(ids: string[]): PanelSelection;
    panelsMatching(filter: PanelFilter): PanelSelection;
    insertPanel(panel: PanelInput): InsertedPanel;
  };
};

type DashboardPatch = {
  name?: string;
  description?: string;
  columns?: number;
  filters?: unknown[];
  variables?: Record<string, string>;
};

type PanelPatch = {
  title?: string;
  sql?: string;
  source?:
    | "bigquery"
    | "ga4"
    | "amplitude"
    | "first-party"
    | "demo"
    | "prometheus";
  chartType?:
    | "line"
    | "area"
    | "bar"
    | "metric"
    | "table"
    | "pie"
    | "section"
    | "heatmap"
    | "callout"
    | "extension";
  width?: number;
  columns?: number;
  tab?: string;
  config?: Record<string, unknown>;
  description?: string;
};

type PanelInput = PanelPatch & {
  id: string;
  title: string;
  chartType: NonNullable<PanelPatch["chartType"]>;
  source?: PanelPatch["source"]; // required for non-section / non-extension panels
  sql?: string; // required for non-section / non-extension panels
  // For chartType "extension": config.extensionId is required (the extension to embed).
};

type PanelFilter = {
  id?: string;
  ids?: string[];
  idIncludes?: string;
  title?: string;
  titleIncludes?: string;
  chartType?: PanelPatch["chartType"];
  source?: PanelPatch["source"];
  tab?: string;
  isSection?: boolean;
};

type PanelSelection = {
  moveToTop(): void;
  moveToBottom(): void;
  moveBefore(panelId: string): void;
  moveAfter(panelId: string): void;
  moveToIndex(index: number): void;
  remove(): void;
  set(patch: PanelPatch): void;
  setTitle(title: string): void;
  setSql(sql: string): void;
  setWidth(width: number): void;
  setConfig(patch: Record<string, unknown>): void;
  setConfigPath(path: string, value: unknown): void;
  duplicate(newPanelId: string, patch?: PanelPatch): void;
};

type SectionSelection = PanelSelection & {
  append(panelIds: string[]): void;
};

type InsertedPanel = {
  atTop(): void;
  atBottom(): void;
  before(panelId: string): void;
  after(panelId: string): void;
  atIndex(index: number): void;
};
```

Examples:

```ts
dashboard.panels(["dau-over-time", "wau-over-time"]).moveToTop();
dashboard.panel("top-referrers").setTitle("Top Referrers by Domain");
dashboard.panel("retention").set({
  width: 2,
  config: { description: "Updated definition." },
});
dashboard.panelsMatching({ source: "first-party" }).setWidth(2);
dashboard
  .panelsMatching({ titleIncludes: "Revenue" })
  .setConfigPath("yAxis.format", "currency");
dashboard.panelsMatching({ titleIncludes: "Signed-In" }).moveToTop();
dashboard
  .section("retention-activity-section")
  .append(["repeat-users", "retention-over-time"]);
dashboard
  .insertPanel({
    id: "new-kpi",
    title: "New KPI",
    source: "first-party",
    chartType: "metric",
    width: 1,
    sql: "SELECT COUNT(*) AS value FROM analytics_events",
  })
  .atTop();
```

Native tool call:

```json
{
  "dashboardId": "weekly-metrics",
  "code": "dashboard.panels([\"dau-over-time\",\"wau-over-time\"]).moveToTop();"
}
```

Use `update-dashboard` only for new full-config saves, UI full-config saves, or
when the user specifically requests low-level JSON-pointer edits.

`get-sql-dashboard` is compact by default. It returns panel summaries, ids,
titles, chart types, sources, layout groups, `layout.panelOrder`, and
`layout.firstPanelIds` without embedding every panel's full SQL. Use that
compact result to find panel ids and verify order. Pass `includeConfig: true`
only when you need full panel SQL/config for a detailed edit.

After a mutation, navigate to the dashboard if the user is elsewhere. The app syncs through the framework's polling/query invalidation path.

### Reordering Panels

For simple "move this chart/section" requests, prefer `mutate-dashboard` with a
string script:

```json
{
  "dashboardId": "weekly-metrics",
  "code": "dashboard.panels([\"dau-over-time\",\"wau-over-time\"]).moveToTop();"
}
```

Do not do index arithmetic with `/panels/<index>` unless the user specifically
asks for a low-level JSON-pointer edit. Use `moveBefore`, `moveAfter`,
`moveToTop`, `moveToBottom`, or `moveToIndex` against panel ids instead.

`get-sql-dashboard` returns `layout.panelOrder`, `layout.firstPanelIds`, and
row/group summaries. Use those fields for orientation and verification instead
of re-reading stale screenshots or counting positions from memory.

### Existing Dashboard Edits

When the user asks to change existing panels:

1. Read the current dashboard with `get-sql-dashboard` compact mode unless full
   SQL/config is required.
2. Call `mutate-dashboard` once with every change in one script. Use
   `panel(...)`, `panels([...])`, or `panelsMatching({...})` selectors by id or
   metadata; do not compute shifted array indexes.
3. Verify the returned `panelCount`, `appliedOps`, `firstPanelIds`, and
   `summary`. If possible, read the affected panels back and confirm the exact
   fields changed.

For SQL-only panel edits, use `dashboard.panel("id").setSql("...")`. If the
metric semantics changed, also update the visible definition with
`setConfigPath("description", "...")` or `set({ "description": "..." })`. If
the title, source, chart type, width, or config shape changes together, put them
in the same `set({...})` call.

### First-Party User Metrics

For first-party `/track` events, be precise about identity:

| Metric intent                                | Identity expression                                                                                                                                                                |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account users, DAU, WAU, retention, cohorts  | `NULLIF(user_id, '')` plus `NULLIF(user_id, '') IS NOT NULL`, but only on events that actually represent the activity being measured                                               |
| Signed-in visitor activity                   | `event_name = 'session status' AND signed_in = 'true'` keyed by `COALESCE(NULLIF(user_id, ''), NULLIF(anonymous_id, ''))`, labeled as signed-in visitors rather than account users |
| Public traffic, visitors, clip/share viewers | `COALESCE(NULLIF(user_id, ''), NULLIF(anonymous_id, ''))`                                                                                                                          |

Do not call anonymous visitors "users" in dashboard labels or descriptions.
When a user asks for DAU, WAU, retention, repeat users, or account cohorts,
exclude logged-out traffic unless they explicitly ask for visitor metrics. If
the active/session events do not include account identity, do not substitute
signup or identify events and call that DAU/WAU. Either update instrumentation to
send account identity on active events, or label the dashboard metric as
signed-in visitor activity.

For template/app activity metrics, exclude `docs` from DAU, WAU, retention, and
repeat-user panels. A docs event may carry `signed_in = true` from shared auth
state or tracker context, but docs traffic is not app usage and should not appear
as an app/template series. Use a minimum cohort-size threshold for retention
rates so one or two identities cannot create misleading 100% or 0% spikes.

## Building Large First-Party Dashboards (compose-dashboard)

For a **first-party analytics** dashboard, prefer `compose-dashboard` over hand-authoring a big `update-dashboard` config. You name the metrics; the SERVER expands each into a full, validated panel (SQL + chart config) from the shipped metric catalog and saves them in ONE atomic call. This avoids the failure mode where the agent must stream a giant multi-panel `update-dashboard` argument inside the ~40s budget — that big tool-call can't be resumed mid-stream and is all-or-nothing on validation, so the agent thrashes (repeated update-dashboard + tool-search, never landing).

- **Never hand-author large first-party configs panel-by-panel.** Call `compose-dashboard` with the metric keys instead.
- Unknown metric keys are skipped and reported in `unknownMetrics` (not fatal). Each panel's SQL is validated independently — valid panels save, invalid ones are reported in `invalidMetrics`.
- By default (no `overwrite`), composing into an existing dashboard APPENDS the new panels and skips ids already present. `overwrite: true` replaces the whole config.
- Each metric accepts an optional per-metric `window` of `'30d' | '90d' | 'all'` (only affects windowed virality/time metrics) and `title` / `chartType` / `width` overrides.
- Returns `{ dashboardId, panelCount, createdMetrics, unknownMetrics, invalidMetrics, skippedExistingIds }` — report `panelCount` as proof-of-done.

Available metric keys: `total-signups`, `signups-over-time`, `signups-by-template`, `sessions-by-app`, `sessions-over-time`, `replay-sessions`, `replay-chunks-over-time`, `recent-replay-sessions`, `signed-in-vs-anon`, `total-template-clicks`, `total-demo-clicks`, `total-cli-copies`, `template-interest-over-time`, `clicks-by-template`, `demo-clicks-by-template`, `cli-copies-by-template`, `cli-copies-over-time`, `pageviews-over-time`, `top-referrer-domains`, `referred-signups-30d`, `viral-signup-share-30d`, `clip-share-signups-30d`, `signups-by-referral-source`, `referred-signups-over-time`, `top-referrers`, `share-funnel-30d`, `viral-participation-rate-90d`, `viral-coefficient-90d`, `activated-referrers-90d`.

```bash
# Build a large first-party dashboard in ONE call (server generates the panels)
pnpm action compose-dashboard --dashboardId first-party-overview --title "First-Party Overview" \
  --metrics '["total-signups","signups-over-time","signups-by-template","sessions-by-app","viral-coefficient-90d","top-referrers","share-funnel-30d"]'
```

## Reliable Bulk Edits

This is the dashboard-specific application of the framework-wide `reliable-mutations` skill — read that for the general rule (one atomic write, verify end state, report proof-of-done).

Hosted agent runs have a **~40s budget**. Many sequential `update-dashboard` calls (one per panel, plus schema-discovery calls) will blow that budget and leave the dashboard in a partial state — earlier inserts looked like they succeeded (✓), but nothing actually persisted. Avoid this:

- **For a large first-party dashboard, use `compose-dashboard`** (see the section above): name the metrics, the server generates the panels in one call. Do not hand-author the big config.
- **Batch ALL edits into ONE `mutate-dashboard` call.** One script can move,
  insert, remove, duplicate, and update many panels. Never loop dashboard edit
  actions panel-by-panel.
  - To bulk edit existing panels, use selectors:
    `dashboard.panelsMatching({"source":"first-party"}).setWidth(2);`
  - To make nested config edits, use
    `setConfigPath("yAxis.format", "percent")` instead of resending/clobbering
    the whole nested object.
- **To add a shipped template's panels, prefer `install-dashboard-template` with `mergePanels: true`** and the existing `dashboardId`. It appends only the template panels whose id is not already present (preserving existing panels and order) in one atomic save — you don't author each panel yourself.
- **Always verify the returned proof-of-done and report it.**
  `mutate-dashboard` returns `panelCount`, `appliedOps`, `panelOrder`,
  `firstPanelIds`, `changedPanelIds`, `commandLog`, and a `summary` string.
  `install-dashboard-template --mergePanels` returns `addedPanelIds`,
  `skippedExistingIds`, and `panelCount`. Tell the user the resulting panel
  count instead of assuming success.

```bash
# Add or edit several panels in ONE atomic call (never one call per panel)
pnpm action mutate-dashboard --dashboardId weekly-metrics \
  --code 'dashboard.panelsMatching({"source":"first-party"}).setWidth(2);'

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

If a dashboard embeds an extension panel (`chartType: "extension"`), sharing the
dashboard does not share the extension. Share the referenced extension to the
same audience (`share-resource --resourceType extension ...`) so all dashboard
viewers can see the embedded content; otherwise they get an "extension
unavailable" placeholder.

## Important Rules

- Never fabricate data or create a dashboard from guessed schema. A panel's SQL must hit a real source; do not present figures you did not actually query.
- Never write dashboard configs into the settings table.
- Never use `db-patch` as a fallback for dashboard config edits. Use
  `mutate-dashboard` for existing edits, or `update-dashboard` for new/full
  config saves, and fix the action arguments.
- Never set `panel.source` to a table name or unsupported backend.
- Use `first-party` for `/track` data and `query-agent-native-analytics` for ad-hoc first-party event questions.
- Use `update-dashboard` for new dashboard config saves and full config
  replacements. Use `mutate-dashboard` for existing dashboard edits.
