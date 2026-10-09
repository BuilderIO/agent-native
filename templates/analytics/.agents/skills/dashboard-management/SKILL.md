---
name: dashboard-management
description: >-
  Create, lay out, organize, or share Analytics dashboards and panels: sources, placement, folders, verification. Use to create a dashboard or to move, reorder, or lay out panels; a small edit of one existing panel needs no skill.
---

# Dashboard Management

Dashboards are the canonical SQL-backed Analytics resources. New dashboards, saved analyses, reports, and bespoke extensions are represented as dashboard artifacts—not as separate user-facing Analytics objects. Legacy analysis tables and actions remain available only for compatibility.

## Storage

Current storage:

| Table              | Purpose                                      |
| ------------------ | -------------------------------------------- |
| `dashboards`       | Explorer and SQL dashboard records           |
| `dashboard_folders` | Personal and shared SQL dashboard folders  |
| `dashboard_views`  | Saved filter presets per dashboard           |
| `dashboard_shares` | Standard framework share grants              |
| `dashboard_folder_shares` | Standard folder share grants          |
| `dashboard_revisions` | Bounded dashboard history snapshots       |
| `analyses`         | Saved ad-hoc analysis records                |
| `analysis_revisions` | Bounded analysis history snapshots        |
| `analysis_shares`  | Standard framework share grants for analyses |

Legacy settings keys such as `u:<email>:dashboard-*`, `u:<email>:sql-dashboard-*`, `o:<orgId>:sql-dashboard-*`, and `adhoc-analysis-*` are still read as a fallback and copied into SQL on access. Do not create new dashboard settings rows.

## Dashboard folders

Dashboard folders are SQL-backed, access-scoped containers for organizing SQL
dashboards from `/dashboards`:

- `personal` folders are private to their owner.
- `shared` folders are organization-visible and require an active organization.
- Use `list-dashboard-folders`, `create-dashboard-folder`, and
  `set-dashboard-folder` for folder reads and membership changes.
- A folder never expands dashboard access. A personal folder can contain only
  an owned private dashboard; a shared folder can contain only an org-visible
  dashboard. Use the normal dashboard sharing actions separately.

For organization-wide consolidation, use `migrate-analytics-artifacts` first
with `dryRun: true`. The write requires an organization owner/admin and the
exact confirmation token `MIGRATE_ANALYTICS_ARTIFACTS`. It materializes
organization-scoped legacy settings, creates dashboard blocks for saved
analyses and standalone extensions, archives exact duplicates, copies shares,
and removes legacy settings keys only after SQL rows are materialized. Source
rows remain recoverable. Private member-only rows are intentionally outside
this organization-scoped operation.

Use `mutate-dashboard` for existing dashboard edits. It resolves the current
user/org context, validates the resulting config, writes the SQL-backed record,
syncs collab, and returns a compact result with a `verified` flag. Use
`update-dashboard` for new full-config saves, UI full-config saves, or explicitly requested low-level
JSON-pointer edits.

Every meaningful dashboard save snapshots the previous state into
`dashboard_revisions`. Use `list-dashboard-revisions` to inspect available undo
points and `restore-dashboard-revision` to restore one; restore snapshots the
current state first, then syncs open dashboard editors.

Saved analyses follow the same undo model with `analysis_revisions`,
`list-analysis-revisions`, and `restore-analysis-revision`.

Never use `db-patch`, raw SQL, or settings-key edits to create or modify a
dashboard config. Those bypass the dashboard action's access checks, SQL
validation, collab sync, and verification. If a dashboard action fails
because the argument shape was wrong, fix that action's arguments and retry
once — do not switch to db-patch or raw SQL.

### GitHub folder sync

A linked folder mirrors its SQL dashboards to `<path>/<dashboardId>.json` in a
GitHub repo. Read `docs/dashboard-github-folder-sync.md` before changing or
explaining it.

- Run `preview-dashboard-folder-github-sync` before any sync. It writes nothing.
- `apply-dashboard-folder-github-sync` pulls from GitHub. It writes only the
  panels, order, and settings that changed on the GitHub side.
- `export-dashboard-folder-to-github` opens one PR with the app's changes. It
  refuses while an earlier export PR is still open.
- `configure-dashboard-folder-github-sync` links or unlinks a folder. It stores
  no credentials.
- A unit changed on both sides is a conflict. It is reported and not applied.
  Do not resolve it by overwriting either side without asking the user.
- Explorer dashboards, sharing, and deletions never sync. A synced dashboard
  cannot be permanently deleted; archive it or unlink its folder first.

## Valid Panel Sources

`panel.source` is a backend selector, not a table name. It must be one of:

| Source        | Query shape                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| `bigquery`    | Literal warehouse SQL. Table names belong inside the SQL string.                                         |
| `ga4`         | JSON descriptor for the Google Analytics Data API.                                                       |
| `amplitude`   | JSON descriptor for an Amplitude query.                                                                  |
| `first-party` | Read-only SQL over this template's `analytics_events` table, usually via `query-agent-native-analytics`. |

Do not use `app-db` as a dashboard source. For first-party events collected through `/track`, use `source: "first-party"` or the `query-agent-native-analytics` action rather than raw internal `db-query`.

AI-generated first-party panels are dashboard-time-bound by default. Set
`config.timeScope` to `"dashboard"` and include the matching dashboard time
filter in the SQL. The allowed values are:

- `dashboard`: use the dashboard-selected time range; the default for ordinary metrics.
- `fixed-window`: use an explicit bounded window independent of the dashboard filter.
- `cohort-history`: use the bounded history of an explicitly defined cohort.
- `all-time`: scan all available history; use only when the user requests it and
  put `all-time`, `lifetime`, or `historical` in the title or description.

`{{timeRange}}` requires an explicit matching `filters` entry with
`id: "timeRange"` and `type: "select"`. `{{<id>Start}}` and `{{<id>End}}`
require a matching `filters` entry with that id and `type: "date-range"`.
Do not rely on undeclared time variables. Server validation rejects unbound
first-party SQL, so declare the filter or choose an explicit non-dashboard
scope before saving.

**A bound anywhere in the SQL is not the same as every CTE having its own
bound.** If a panel has multiple top-level CTEs (`WITH a AS (...), b AS
(...)`) and more than one of them reads `analytics_events`, EVERY one of
those CTEs needs its own `{{timeRange}}`/`{{<id>Start}}`/`{{<id>End}}`
reference or literal date bound — not just the final `SELECT` or one sibling
CTE. A CTE that computes something like "this user's first-ever active day"
by scanning `analytics_events` with no bound at all will full-table-scan on
every render even though the panel *looks* time-bound overall (root cause of
a 2026-07-25 production incident: several dashboards had exactly this shape).
Server validation checks each top-level CTE independently now, so this fails
at save time — but write it right the first time: bound every CTE, or use
`config.timeScope: "cohort-history"` only for a CTE that is genuinely
defining a cohort (e.g. a first-seen date), never as a way to skip bounding
an ordinary activity scan.

## Creating A Dashboard

When the user asks for a dashboard:

1. Start from the preloaded `<resource scope="analytics-catalog">` references (catalog-first), else one `search-analytics-query-catalog`. If a relevant entry exists, use its `table`, `columns`, `queryTemplate`, and gotchas verbatim.
2. If a metric definition, date range, or grain is ambiguous and the choice would change the panel's numbers, use the `ask-question` clarifying tool once before building. Skip it when the dictionary or the user already settled it.
3. If a metric is not documented, do not guess column names and do not ask the user for them. Find the table and columns with `search-bigquery-schema` (or the provider's own schema action), then propose a dictionary entry with `save-data-dictionary-entry`.
4. Build a complete `SqlDashboardConfig` with `name` and `panels`. Optionally set top-level `columns` (1–6, default 2) to control how many grid columns the panels before any section use.
5. Every panel needs `id`, `title`, `source`, `chartType`, `width`, and `sql`. `width` is the number of grid columns the panel spans (1..6, clamped to the active section's column count). Section panels skip `source` and `sql` and may set their own `columns` (1–6) to override the dashboard default for the panels following the section. Extension panels (`chartType: "extension"`) also skip `source` and `sql`; use `config.extensionId` for ordinary author-selected shared embeds. Use `config.extensionSlotId` only when the user explicitly asks for a personal/per-viewer slot (see "Embedding An Extension As A Panel").
6. Persist with `update-dashboard` (load it with `tool-search` — it is not on the
   initial tool surface), not raw SQL or settings writes. For a large first-party
   dashboard, load `compose-dashboard` the same way in one `tool-search` call.
7. Navigate to it with `pnpm action navigate --view=adhoc --dashboardId=<id>`.

An explicit dashboard request authorizes the complete non-destructive build in
the same turn. After querying or scaffolding, continue through extension-data
seeding/refresh, dashboard save/embed, and navigation; do not ask whether to
proceed or leave an empty Custom Block shell. Ask only when metric scope/grain
is materially ambiguous, the change is destructive, or it has an external side
effect such as sending email or outreach.

Layout is always **1 column when the available content width is below the `md` threshold** (panels stack), then expands to the configured column count at/above it. The grid uses a container query, so it also stacks when the agent sidebar narrows the content pane — not only at narrow viewports. So picking 3 or 4 columns is fine — the renderer keeps narrow layouts readable automatically.

```bash
pnpm action update-dashboard --dashboardId weekly-metrics --config '<full json>'
pnpm action navigate --view=adhoc --dashboardId=weekly-metrics
```

The save path dry-runs BigQuery panels before persisting. If validation returns a provider error, fix the query and retry. Never work around validation by writing directly to a table.

### Replicating Or Adapting Another Dashboard

When the user asks to replicate, clone, or adapt an existing dashboard into a new
one, call `search-dashboard-references` with focused terms first. It searches
accessible active saved dashboards (ids, names, descriptions, serialized config),
including legacy ones. Inspect each result with `get-sql-dashboard` when `kind`
is `sql`, or `get-explorer-dashboard` when it is `explorer`. A result is a
reference, not proof its source is authoritative for the new request: check the
provider and scope the user asked for before copying its source semantics, and do
not route a replication request to first-party Analytics by default. This applies
to a new dashboard, not to editing the dashboard that is already open.

## Dual-Axis Charts

`line`, `area`, and `bar` panels can plot series against two y-axes. Reach for
this whenever series share an x-axis but not a unit — a count next to a rate, or
revenue next to a conversion percent. On a single axis the smaller series
flattens into the baseline and reads as "no data."

```json
{
  "id": "signups-vs-conversion",
  "title": "Signups vs conversion rate",
  "source": "first-party",
  "chartType": "line",
  "width": 1,
  "sql": "SELECT day, signups, conversion_rate FROM ...",
  "config": {
    "timeScope": "dashboard",
    "xKey": "day",
    "yKeys": ["signups", "conversion_rate"],
    "yFormatter": "number",
    "rightYKeys": ["conversion_rate"],
    "rightYFormatter": "percent"
  }
}
```

- `rightYKeys` names series from `yKeys`; everything unnamed stays on the left.
- `rightYFormatter` defaults to `yFormatter` when omitted.
- Each axis is labelled with its series names (up to two per side), and tooltip
  values use the formatter of the axis the series belongs to.
- At least one series must remain on the left. If `rightYKeys` names every
  series, or names a column the query never returned, the panel falls back to a
  single axis and shows a config warning rather than dropping the series.
- Scheduled email reports render the same two scales, so a dual-axis panel is
  safe to put on a subscribed dashboard.

## Reusable Native Dashboard Patterns

The recent extension-backed dashboards in Builder Analytics cluster into a few
repeatable compositions. Prefer these native panels, with a real SQL or Data
Program result behind each one, when creating a replacement or a new dashboard:

| Pattern | Native composition |
| --- | --- |
| Customer ROI / value realization | `metric` KPI cards, `line` or `area` trends, `table` detail, and `callout` or `section` panels for the business narrative |
| Account engagement / outreach | `metric` coverage and adoption cards, a daily `line` trend, `heatmap` or `table` segmentation, and `callout` alerts |
| GTM pipeline / cross-sell | `funnel` for ordered stages, `metric` totals, `bar` or `line` trends, and a `table` for account-level follow-up |
| Win/loss analysis | `section` groups with `metric`, `table`, `bar`, `callout`, and trend panels; use a Data Program for provider joins and evidence rows |

Funnel panels use `config.xKey` for the stage label and `config.yKey` for a
non-negative count or value. The renderer preserves the SQL row order, shows
each stage's share of the first stage, and shows the change from the previous
stage. Keep the intended stage order in SQL with `ORDER BY`.

When a dashboard is being migrated from an extension, create a new v2 copy,
bind its panels to the real provider schema or Data Programs, and compare it
with the original before retiring the extension-backed version. Do not invent
customer-specific SQL, provider joins, cached rows, or extension ids in a
catalog template. Existing dashboards remain readable while the native
replacement is validated. Bespoke interaction flows, arbitrary layouts, and
visualizations outside these contracts may remain Custom Blocks.

The source tree ships four provider-free v2 manifests in
`server/lib/native-v2-dashboards.ts`: Customer ROI, Account Engagement,
Cross-sell, and Win / Loss. They intentionally contain no customer names,
provider ids, SQL, cached rows, or guessed joins. After deployment, an
organization owner or admin provisions them with `ensure-native-v2-dashboards`
by supplying one real Data Program per binding key. The action validates the
stored program output contract, shares the programs with the organization,
creates deterministic `native-*-v2-*` dashboard copies, and preserves the
extension-backed originals and any existing v2 edits. Do not add these to the
root demo bootstrap or silently auto-bind them to guessed provider schemas.

## Custom Blocks

A Custom Block is a sandboxed extension embedded as a `chartType: "extension"`
panel (`config.extensionId`). It is the exception, not the default: native panels
and Data Programs come first, and dual-axis charts are native (`config.rightYKeys`).
Read `custom-blocks` before creating, embedding, cloning, or repairing one.

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
      "config": { "timeScope": "dashboard" },
      "sql": "SELECT COUNT(*) AS value FROM analytics_events WHERE event_name = 'click' AND event_date >= '{{dateStart}}' AND event_date < '{{dateEnd}}'",
    },
    {
      "id": "kpi-signups",
      "title": "Signups",
      "source": "first-party",
      "chartType": "metric",
      "width": 1,
      "config": { "timeScope": "dashboard" },
      "sql": "SELECT COUNT(*) AS value FROM analytics_events WHERE event_name = 'signup' AND event_date >= '{{dateStart}}' AND event_date < '{{dateEnd}}'",
    },
    {
      "id": "kpi-active",
      "title": "Active users",
      "source": "first-party",
      "chartType": "metric",
      "width": 1,
      "config": { "timeScope": "dashboard" },
      "sql": "SELECT COUNT(DISTINCT user_id) AS value FROM analytics_events WHERE event_date >= '{{dateStart}}' AND event_date < '{{dateEnd}}'",
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
      "config": { "timeScope": "dashboard" },
      "sql": "SELECT event_date AS date, COUNT(*) AS value FROM analytics_events WHERE event_date >= '{{dateStart}}' AND event_date < '{{dateEnd}}' GROUP BY 1 ORDER BY 1",
    },
  ],
}
```

## Filters And Variables

`filters[]` defines dashboard-wide controls. Filter values are available in panel SQL through `{{var}}` interpolation. Date ranges emit `{{<id>Start}}` and `{{<id>End}}`.

For dashboard-time-bound first-party SQL, use `config.timeScope: "dashboard"`
and a predicate that consumes the declared filter, such as
`event_date >= '{{dateStart}}' AND event_date < '{{dateEnd}}'`. A
`{{timeRange}}` token must have a matching select filter and SQL branches for
its options; date variables must have a matching date-range filter. The server
rejects unbound first-party SQL during dashboard validation.

**Filter ids must be unique.** Two filters with the same `id` collide on the same URL param, so changing one visibly updates the other in the UI. The dashboard save endpoint rejects duplicates with a 400.

**Use `type: "date-range"` for paired start/end dates.** Don't add two `type: "date"` filters labeled "Start" and "End" — even with distinct ids, that ships the wrong UX. A single date-range filter renders as the "from … to …" pair and exposes both halves to SQL via `{{<id>Start}}` / `{{<id>End}}`.

Use `variables` for shared constants such as table refs or project IDs. Identifier-like variables can be used bare (`FROM {{EVENTS}}`); string values should be inside SQL string literals (`'{{author}}'`).

Use conditional blocks for optional filters:

```sql
{{?country}}AND country = '{{country}}'{{/country}}
```

**Use `type: "multi-select"` for a pick list where several options can apply at once.** Give it `options` like a `select`. Its value is the selected option values joined by commas. Interpolate it as `IN ({{<id>:list}})`, which expands to one quoted literal per selected value, and wrap the clause in a conditional so an empty selection drops the filter:

```sql
{{?plan}}AND plan IN ({{plan:list}}){{/plan}}
```

An unwrapped `{{<id>:list}}` with no selection fails the query on purpose. Option values must not contain commas.

Filters auto-apply on change — there is no Apply button. Each filter change writes to the URL and re-runs the affected panels. Other filters are preserved (the URL update is functional, not destructive). If you see a filter "reset" itself when another filter changes, look for a duplicate `id` first.

## Modifying A Dashboard

For existing dashboard edits, default to `mutate-dashboard`. It gives the
agent a typed mutation API without exposing arbitrary JavaScript execution.
Pass structured `operations` for normal agent calls; keep the legacy `code`
form for short layout/config edits only. Large SQL payloads belong in the
server-side first-party metric catalog, not in a prompt argument.
The server parses only documented `dashboard.*` method calls, applies the
resulting operations in memory, validates the final dashboard config, writes
SQL once, syncs collab, and returns a compact result with a `verified` flag.

Arguments must be JSON-compatible literals, so quote object keys. Variables,
imports, loops, functions, templates, network, filesystem, DB access, and
calling other actions from the script are not available.

The complete typed API (`dashboard.*`, panel selections, `PanelPatch`,
`PanelInput`, `PanelFilter`) is returned by `mutate-dashboard` called with only
`returnTypes: true`. Subjects: `dashboard.set`, `setFilterDefault`, `panel`,
`panels`, `panelsMatching`, `section`, `insertPanel`. Selection methods:
`moveToTop`, `moveToBottom`, `moveBefore`, `moveAfter`, `moveToIndex`,
`moveNextTo`, `moveToRow`, `remove`, `set`, `setTitle`, `setSql`, `setWidth`,
`setConfig`, `setConfigPath`, `duplicate`. Inserted and duplicated panels take
one chained placement: `atTop`, `atBottom`, `before`, `after`, `atIndex`,
`nextTo`, `atRow`, `atRowStart`, `atRowEnd`. Panel `config` holds renderer
options (`xKey`, `yKey`, `columns`, formatters); `sql`, `chartType`, `source`,
`title`, and `width` are panel fields set with `setSql` or `set`.

Examples:

```ts
dashboard.panels(["dau-over-time", "wau-over-time"]).moveToTop();
dashboard
  .panel("recurring-users-by-template")
  .duplicate("recurring-users-by-template-bar", {
    title: "Recurring Signed-In Users by Template (Bar)",
    chartType: "bar",
  })
  .nextTo("recurring-users-by-template");
dashboard.setFilterDefault("emailFilter", "exclude_builder");
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
    config: { timeScope: "dashboard" },
    // Assumes filters includes { id: "date", type: "date-range", default: "30d" }.
    sql: "SELECT COUNT(*) AS value FROM analytics_events WHERE event_date >= '{{dateStart}}' AND event_date < '{{dateEnd}}'",
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

`get-sql-dashboard` is compact by default: per-panel summaries (ids, titles,
chart types, sources, `bindings` — the config keys that name result columns —
`sqlChars`, `sqlHash`, `configKeys`), layout groups, `layout.panelOrder`,
`layout.firstPanelIds`, and a `revision`. Pass `panelIds: ["panel-id"]` to get the
full SQL and config of just those panels in `panelDetails`; ids that do not exist
come back in `missingPanelIds`. `includeConfig: true` returns every panel's SQL
and config, but past ~12k characters it returns the compact summaries with
`truncated: true` and `omittedPanelIds` instead, so name the panels you need with
`panelIds`.

After a mutation, navigate to the dashboard if the user is elsewhere. The app syncs through the framework's polling/query invalidation path.

### Reordering Panels

For simple "move this chart/section" requests, prefer `mutate-dashboard` with
structured operations. The short script form is also supported for one compact
move:

```json
{
  "dashboardId": "weekly-metrics",
  "code": "dashboard.panels([\"dau-over-time\",\"wau-over-time\"]).moveToTop();"
}
```

Do not do index arithmetic with `/panels/<index>` unless the user specifically
asks for a low-level JSON-pointer edit. Use `moveBefore`, `moveAfter`,
`moveToTop`, `moveToBottom`, or `moveToIndex` against panel ids instead.

For visible placement requests like "second row" or "next to return rates", use
row-aware placement: `dashboard.insertPanel({...}).nextTo("retention-over-time")`,
`.atRow(2)`, or `dashboard.panel("panel-a").moveNextTo("panel-b")`. These keep
panels in the intended rendered row and rebalance that row when needed. In
`operations`, `movePanels`, `insertPanel`, and `duplicatePanel` take the same
placement as fields: `position`, `index`, `beforePanelId`, `afterPanelId`,
`nextToPanelId` (same visible row, after that panel), or `rowNumber` (1-based
visible row) with `rowPosition` `start` or `end` (default `end`).

`get-sql-dashboard` returns `layout.panelOrder`, `layout.firstPanelIds`, and
row/group summaries. Use `layout.groups[].rows[].rowNumber/panelIds` to read
where panels sit instead of counting positions from memory. Layout says nothing
about whether a chart renders: the `mutate-dashboard` verification result and
`inspect-dashboard-panel` are the proof.

### Existing Dashboard Edits

When the user asks to change an existing panel on the open dashboard:

1. Read only that panel: `get-sql-dashboard` with `panelIds: ["<panel-id>"]`.
   The compact `bindings` of every panel show which result columns its chart is
   bound to. The open dashboard and selected panel are in `<current-screen>`.
2. Call `mutate-dashboard` once with every change in `operations`. Use panel
   ids, not shifted array indexes. The short `code` form is only for compact
   layout/config edits; do not stream a large multi-panel SQL script.
3. Read the verification result before saying anything about the chart.
   `verified` is always `true` or `false`. `verified: true` means every panel
   the edit touched renders; with `noRenderAffected: true` the edit changed no
   chart (a title, width, or move), nothing needed to run, and it is done.
   `verified: false` means the edit saved but a panel is not confirmed: each
   `unverified[]` entry says why and `nextStep` says what to call. On
   `verified: false`, an error, or the user saying the change is not visible,
   call `inspect-dashboard-panel` for that panel, fix what it reports, and
   verify again. Never describe a visible change you have not verified.
   `update-dashboard`, `compose-dashboard`, and `restore-dashboard-revision`
   return the same fields. Editing a dashboard you can only view fails with
   `dashboard_forbidden` before any SQL runs.

For SQL-only panel edits, use `dashboard.panel("id").setSql("...")`. If the
metric semantics changed, also update the visible definition with
`setConfigPath("description", "...")` or `set({ "description": "..." })`. If
the title, source, chart type, width, or config shape changes together, put them
in the same `set({...})` call.

### Reading Panel State

- "No data" means the panel's resolved SQL returned zero rows: dashboard
  filters or `{{timeRange}}` bounds, a stale `config.pivot`, or a rewritten query
  that no longer returns the columns the config names.
- A banner reading "Ignored missing result columns" means `config` names a
  column (`xKey`, `yKey`, `yKeys`, `rightYKeys`, `barKeys`, or a table
  `columns[].key`) the query does not return. A missing banner is not proof the
  chart shows what you intended.
- Only columns listed in `config.yKeys` (or `yKey`) are plotted; an extra SQL
  column the config does not name never appears.
- `config.pivot` (`{ xKey, seriesKey, valueKey }`) reshapes long-format rows into
  one series per `seriesKey` value and drops every other column. If the query now
  returns wide-format rows, remove `pivot` or the panel shows "No data".
- Config keys the renderer does not honor are ignored. `mutate-dashboard`
  rejects them on the panels you change and lists the honored keys; read that
  error instead of retrying the same key.

### Rolling Averages And Trend Lines

There is no native rolling or moving-average option. Add a window-function column
to the panel SQL, for example
`AVG(value) OVER (ORDER BY week ROWS BETWEEN 3 PRECEDING AND CURRENT ROW) AS value_4wk_avg`,
and list it in `config.yKeys`. For bars plus a line, use `chartType: "combo"`
with `config.barKeys` naming the bar series; the other `yKeys` draw as lines.
With `config.pivot` set, extra columns are dropped, so remove `pivot` or emit the
average as an extra series row.

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

## Demo Dashboards

`ensure-demo-dashboards` auto-installs a per-user demo on first app open.

## Building Large First-Party Dashboards (compose-dashboard)

For a **first-party analytics** dashboard, prefer `compose-dashboard` over hand-authoring a big `update-dashboard` config. You name the metrics; the SERVER expands each into a full, validated panel (SQL + chart config) from the shipped metric catalog and saves them in ONE atomic call. This avoids the failure mode where the agent must stream a giant multi-panel `update-dashboard` argument inside the ~40s budget — that big tool-call can't be resumed mid-stream and is all-or-nothing on validation, so the agent thrashes (repeated update-dashboard + tool-search, never landing).

- **Never hand-author large first-party configs panel-by-panel.** Call `compose-dashboard` with the metric keys instead.
- Unknown metric keys are skipped and reported in `unknownMetrics` (not fatal). Each panel's SQL is validated independently — valid panels save, invalid ones are reported in `invalidMetrics`.
- By default (no `overwrite`), composing into an existing dashboard APPENDS the new panels and skips ids already present. `overwrite: true` replaces the whole config.
- Set `refreshExisting: true` when refreshing a catalog-backed dashboard. Matching metric panels are replaced in place, unrelated panels and layout order are preserved, and the server returns `refreshedExistingIds`.
- Each metric accepts an optional per-metric `window` of `'30d' | '90d' | 'all'` (only affects windowed virality/time metrics) and `title` / `chartType` / `width` overrides. Request `'all'` only when the user asks for all-time coverage, and describe it as full available history.
- Returns `{ saved, dashboardId, panelCount, createdMetrics, refreshedExistingIds, unknownMetrics, invalidMetrics, skippedExistingIds }` — report `saved: true`, `panelCount`, and any invalid/unknown metrics as proof-of-done.

Available metric keys: `total-signups`, `signups-over-time`, `signups-by-template`, `sessions-by-app`, `sessions-over-time`, `replay-sessions`, `replay-chunks-over-time`, `recent-replay-sessions`, `signed-in-vs-anon`, `total-template-clicks`, `total-demo-clicks`, `total-cli-copies`, `template-interest-over-time`, `clicks-by-template`, `demo-clicks-by-template`, `cli-copies-by-template`, `cli-copies-over-time`, `pageviews-over-time`, `top-referrer-domains`, `referred-signups-30d`, `viral-signup-share-30d`, `clip-share-signups-30d`, `signups-by-referral-source`, `referred-signups-over-time`, `top-referrers`, `share-funnel-30d`, `viral-participation-rate-90d`, `viral-coefficient-90d`, `activated-referrers-90d`.

```bash
# Build a large first-party dashboard in ONE call (server generates the panels)
pnpm action compose-dashboard --dashboardId first-party-overview --title "First-Party Overview" \
  --metrics '["total-signups","signups-over-time","signups-by-template","sessions-by-app","viral-coefficient-90d","top-referrers","share-funnel-30d"]'
```

## Reliable Bulk Edits

Hosted agent runs have a **~40s budget**. Many sequential `update-dashboard` calls (one per panel, plus schema-discovery calls) will blow that budget and leave the dashboard in a partial state — earlier inserts looked like they succeeded (✓), but nothing actually persisted. Avoid this:

- **For a large first-party dashboard, use `compose-dashboard`** (see the section above): name the metrics, the server generates the panels in one call. Do not hand-author the big config.
- **Batch ALL edits into ONE `mutate-dashboard` call.** Structured operations can move,
  insert, remove, duplicate, and update many panels. Never loop dashboard edit
  actions panel-by-panel.
  - To bulk edit existing panels, use selectors:
    `dashboard.panelsMatching({"source":"first-party"}).setWidth(2);`
  - To make nested config edits, use
    `setConfigPath("yAxis.format", "percent")` instead of resending/clobbering
    the whole nested object.
- **Read the verification result and report it.** `mutate-dashboard` returns
  `verified`, `panelCount`, `appliedOps`, `panelOrder`, `firstPanelIds`,
  `changedPanelIds`, `commandLog`, and a `summary` string. The tool's own echo is
  not proof the chart renders: only `verified: true` is (with
  `noRenderAffected: true` no chart changed). On `verified: false`, follow
  `nextStep` and call `inspect-dashboard-panel` for the changed panels.

```bash
# Add or edit several panels in ONE atomic call (never one call per panel)
pnpm action mutate-dashboard --dashboardId weekly-metrics \
  --code 'dashboard.panelsMatching({"source":"first-party"}).setWidth(2);'

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
