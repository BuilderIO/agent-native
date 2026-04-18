---
title: "Analytics Template"
description: "AI-native analytics dashboards — connect data sources, prompt for charts, build reusable SQL dashboards and ad-hoc analyses."
---

# Analytics Template

An open-source analytics app where the agent writes the SQL, builds the dashboards, and maintains the metric catalog. Replaces Amplitude, Mixpanel, and Looker for teams that want to own the code and the data.

## Overview {#overview}

The Analytics template is a dashboard app built on `@agent-native/core`. You ask a data question in chat, the agent queries the underlying source (BigQuery, GA4, the app database), and the answer appears as a chart, a table, or a saved dashboard panel. The agent sees the same screen the user sees and edits the same dashboards the user edits.

Three primary surfaces:

- **SQL Dashboards** — reusable panels with filters, saved views, and parametric SQL.
- **Ad-hoc Analyses** — long-form investigations that pull from multiple sources and save re-run instructions.
- **Data Dictionary** — a canonical catalog of metrics, tables, columns, and SQL recipes that the agent consults before writing any SQL.

## Quick start {#quick-start}

Create a new Analytics app from the CLI:

```bash
npx @agent-native/cli create analytics
```

Or try the hosted demo: [analytics.agent-native.com](https://analytics.agent-native.com).

Local dev:

```bash
cd my-analytics-app
pnpm install
pnpm dev
```

The app runs at `http://localhost:3000`. Sign in with Google, then open the **Data Sources** page to connect BigQuery, HubSpot, Jira, and the rest.

## Key features {#key-features}

### Natural-language chart generation

Ask the agent in plain English. It picks the right data source, writes the SQL, validates it against the warehouse, and renders the chart inline in chat or as a saved panel. Chart types: `line`, `area`, `bar`, `metric`, `table`, `pie`.

### Reusable SQL dashboards

Dashboards are a named config with an array of panels. Each panel has an `id`, `title`, `sql`, `source` (`bigquery` / `app-db` / `ga4`), `chartType`, and `width` (1 or 2 columns). See the full shape in `templates/analytics/app/pages/adhoc/sql-dashboard/types.ts`.

Dashboards support:

- **Parametric SQL** — declare `variables` and `filters` at the dashboard level; panels reference them with `{{var}}` interpolation.
- **Saved views** — per-dashboard filter presets stored in the `dashboard_views` table.
- **Resizable panels** — 1- or 2-column width per panel; the grid fills the rest.
- **Sharing** — private by default, share with users or orgs (`viewer` / `editor` / `admin`).

### Ad-hoc analyses

Long-form investigations that cross-reference sources. An analysis saves the original question, step-by-step re-run instructions, the data sources it touched, and the full findings in Markdown. Anyone with access can re-run it against fresh data.

Stored in the `analyses` table (see `templates/analytics/server/db/schema.ts`).

### Living data dictionary

The dictionary is the canonical catalog of metrics used by the org — metric name, definition, table, columns, SQL template, known gotchas, owner, and data lag. The agent reads it before writing any SQL, so it uses the real warehouse column names (`hs_is_closed`, not guessed `is_closed`) and knows about caveats like "excludes internal emails".

The dictionary is seeded by asking the agent to import definitions from an existing source (dbt descriptions, a Notion page, a team wiki).

### SQL query explorer

Direct SQL against BigQuery or the app DB from the **Ad-hoc** view. Useful for iterating on a query before saving it as a dashboard panel.

### Multiple data connectors

Built-in actions for common sources:

| Category      | Actions                                                                  |
| ------------- | ------------------------------------------------------------------------ |
| Warehouse     | `bigquery`, `bigquery-table-info`, `ga4-report`                          |
| Product       | `mixpanel-events`, `amplitude-events`, `posthog-events`                  |
| CRM & Revenue | `hubspot-deals`, `hubspot-metrics`, `hubspot-pipelines`, `apollo-search` |
| Engineering   | `github-prs`, `jira-search`, `jira-analytics`                            |
| Support       | `pylon-issues`, `gong-calls`                                             |
| Community     | `commonroom-members`, `twitter-tweets`                                   |
| Content & SEO | `seo-top-keywords`, `seo-page-keywords`, `seo-blog-pages`                |

Full list lives in `templates/analytics/actions/`. New sources are added by dropping a new action file — the agent picks them up automatically.

### Organizations and sharing

Multi-org deployments are wired up by default via `@agent-native/core/org`. Dashboards and analyses are scoped to the active org. The `/team` route manages members and invitations. See `templates/analytics/app/routes/team.tsx`.

Sharing uses the framework's `share-resource` primitive. Coarse visibility is `private` / `org` / `public`; fine-grained grants are per-principal with `viewer` / `editor` / `admin` roles.

## Working with the agent {#working-with-the-agent}

The agent always knows what you're looking at. The current screen state is injected into every message as a `<current-screen>` block — it contains the active view, the open dashboard or analysis, and any selected filters.

Useful prompts:

- "Build a dashboard showing weekly active users for the past 6 months."
- "What percent of signups last month converted to paid?"
- "Add a chart comparing revenue by plan to this dashboard."
- "Reorder the panels on this dashboard so the MRR metric comes first."
- "Analyze our closed-lost deals from Q1 and save the analysis."
- "Re-run the churn analysis with this month's data."
- "Document this metric in the data dictionary."

The agent's system prompt gets an injected `<data-dictionary>` block with the approved metric entries for the active org. When you ask for a dashboard, the agent consults the dictionary first and uses the documented `table` / `columns` / `queryTemplate` verbatim — it does not guess column names.

### Context it has automatically

- **Current view** — `overview`, `adhoc` (with `dashboardId`), `analyses` (with `analysisId`), `data-dictionary`, `data-sources`, or `settings`.
- **Active org** — scopes all queries and writes.
- **Approved dictionary entries** — for the active workspace.

### Dashboard edits

The agent uses the `update-dashboard` action to edit dashboards. It supports two modes:

- `ops` — JSON-Pointer patches for surgical edits (move a panel, replace one SQL string, remove a filter).
- `config` — full replacement of the dashboard config.

Every BigQuery panel's SQL is dry-run against the warehouse before the dashboard saves. If a column is wrong, the save is rejected with the BigQuery error — the agent fixes the SQL and retries instead of persisting broken panels.

## Connecting data sources {#connecting-data-sources}

Open the **Data Sources** page (`/data-sources`) to connect providers. Each source exposes an env-key list, a walkthrough, and a **Test Connection** button. The page calls `/api/credential-status`, `/api/credentials`, and `/api/test-connection`.

Credentials are stored via the framework's settings/env layer — no secrets in git. Production requires:

| Variable                                 | Purpose                       |
| ---------------------------------------- | ----------------------------- |
| `DATABASE_URL`                           | Neon Postgres URL             |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | Auth                          |
| `GOOGLE_CLIENT_ID` / `_SECRET`           | Google sign-in (OAuth 2.0)    |
| `BIGQUERY_PROJECT_ID`                    | BigQuery project              |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON`    | BigQuery service-account JSON |
| `ANTHROPIC_API_KEY`                      | Agent chat                    |

Provider-specific keys (HubSpot, Jira, Gong, Pylon, etc.) are documented in each source's walkthrough on the Data Sources page. If you add a new action that needs an API key, it appears as a new source on that page via the template's onboarding registration.

Note: the BigQuery OAuth credential for Google sign-in is a **separate** credential from the BigQuery service account JSON. Create the sign-in client at GCP Console → APIs & Services → Credentials → OAuth client ID.

## Data model {#data-model}

Core tables (see `templates/analytics/server/db/schema.ts`):

- **`dashboards`** — both Explorer and SQL dashboards. `kind` is `"explorer"` or `"sql"`; `config` is a JSON blob matching `SqlDashboardConfig`.
- **`dashboard_shares`** — per-resource share grants (principal, role).
- **`dashboard_views`** — saved filter presets per dashboard.
- **`analyses`** — ad-hoc investigations with `question`, `instructions`, `dataSources`, `resultMarkdown`, and optional `resultData`.
- **`analysis_shares`** — per-resource share grants for analyses.
- **`bigquery_cache`** — query result cache keyed by SQL hash with bytes-processed accounting.

Plus the org tables (`organizations`, `org_members`, `org_invitations`) provided by `@agent-native/core/org`.

The data dictionary lives in the framework's `settings` table under scoped keys; see the `list-data-dictionary` and `save-data-dictionary-entry` actions for the full shape.

## Customizing it {#customizing-it}

The Analytics template is meant to be forked and extended. Everything lives in `templates/analytics/`:

- **`AGENTS.md`** — the agent's top-level guide. Documents views, actions, and workflows.
- **`actions/`** — every agent-callable operation. Add a new file to add a new action. Notable ones:
  - `update-dashboard.ts` — dashboard edits (ops + full-replace)
  - `save-analysis.ts` / `list-analyses.ts` — ad-hoc analyses
  - `save-data-dictionary-entry.ts` / `list-data-dictionary.ts` — dictionary
  - `bigquery.ts` — raw BigQuery execution
  - `view-screen.ts` / `navigate.ts` — context awareness
- **`app/routes/`** — file-based routes. Each route is a thin wrapper around a page in `app/pages/`.
- **`app/pages/adhoc/sql-dashboard/`** — the SQL dashboard renderer, panel editor, filter bar, saved views.
- **`app/pages/analyses/`** — analyses list and detail view.
- **`app/pages/DataSources.tsx`** — the data-source onboarding UI.
- **`app/pages/DataDictionary.tsx`** — the dictionary browser and editor.
- **`.agents/skills/`** — pattern guides the agent reads on demand:
  - `dashboard-management` — storage, scope resolution, dashboard config shape
  - `data-querying` — which script to reach for, filtering patterns
  - `adhoc-analysis` — workflow for cross-source investigations
  - `data-querying`, `real-time-sync`, `frontend-design`, `storing-data`, `self-modifying-code`
- **`.builder/skills/<provider>/SKILL.md`** — provider-specific gotchas (BigQuery, HubSpot, Jira, GA4, etc.). Read before querying; update when you learn something new.
- **`server/db/schema.ts`** — Drizzle schema for dashboards, shares, views, analyses, BigQuery cache.
- **`server/lib/dashboards-store.ts`** — dashboard read/write with scope resolution and legacy KV migration.
- **`server/lib/bigquery.ts`** — BigQuery client, dry-run validator, cache logic.

To add a new data source, drop a script in `actions/` that calls the provider and returns results via the `output()` helper. It becomes available to the agent immediately and can be used inside dashboard panels (if you expose the result via a server handler).

To add a new chart type, extend the `ChartType` union in `app/pages/adhoc/sql-dashboard/types.ts`, handle it in `SqlChartCard.tsx`, and the agent can use it in any panel.

For the broader pattern on extending templates, see the [adding-a-feature skill](/docs/skills-guide) and [actions](/docs/actions).
