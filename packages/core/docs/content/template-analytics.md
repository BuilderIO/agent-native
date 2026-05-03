---
title: "Analytics"
description: "Ask analytics questions in plain English, get charts and dashboards back. An open-source replacement for Amplitude, Mixpanel, and Looker."
---

# Analytics

Ask analytics questions in plain English, get charts and dashboards back. The agent connects to BigQuery, GA4, Amplitude, the built-in first-party event collector, HubSpot, Jira, and a dozen other sources, writes the query for you, validates it, and renders the answer as a chart, table, or saved dashboard panel.

It's an open-source replacement for Amplitude, Mixpanel, and Looker — for teams that want to own the code, the queries, and the data.

## What you can do with it

- **Ask data questions in plain English.** "What percent of signups last month converted to paid?" or "Show me weekly active users for the past 6 months." The agent picks the right source, writes the SQL, and renders the chart.
- **Build reusable SQL dashboards** with filters, saved views, and parametric queries.
- **Run ad-hoc analyses** that cross-reference multiple data sources — saved as re-runnable investigations with the original question, instructions, and findings.
- **Maintain a living data dictionary** of metrics, tables, and SQL recipes so the agent uses the right column names every time (no more guessed `is_closed` when it's actually `hs_is_closed`).
- **Share dashboards** with your team — private by default, shareable per-user or per-org with viewer / editor / admin roles.
- **Connect to many sources** out of the box: BigQuery, GA4, Mixpanel, Amplitude, PostHog, HubSpot, Jira, Apollo, Pylon, Gong, Common Room, Twitter, plus app-specific SEO sources.

## Getting started

Live demo: [analytics.agent-native.com](https://analytics.agent-native.com).

When you first open the app:

1. Sign in with Google.
2. Open the **Data Sources** page from the sidebar.
3. Each source has a walkthrough — connect the ones you need (start with one, like BigQuery, GA4, Amplitude, or first-party tracking).
4. Open a new chat with the agent and ask a question: "How many signups did we get last week?"

The first question is enough to confirm the connection works. From there, ask the agent to "save this as a dashboard" or "build a 4-panel overview dashboard for our key metrics."

### Useful prompts

- "Build a dashboard showing weekly active users for the past 6 months."
- "What percent of signups last month converted to paid?"
- "Add a chart comparing revenue by plan to this dashboard."
- "Reorder the panels on this dashboard so the MRR metric comes first."
- "Analyze our closed-lost deals from Q1 and save the analysis."
- "Re-run the churn analysis with this month's data."
- "Document this metric in the data dictionary."

The agent always knows what you're looking at — current dashboard, filters, view — so you can say "this dashboard" or "that panel" without being explicit.

## Three things to know

The app has three primary surfaces you'll spend time in:

- **SQL Dashboards** — reusable panels with filters and saved views. Best for metrics you check regularly.
- **Ad-hoc Analyses** — long-form investigations that pull from multiple sources, with re-run instructions saved alongside. Best for one-off questions you might want to revisit.
- **Data Dictionary** — the canonical catalog of metrics, tables, columns, and SQL recipes. The agent consults it before writing any SQL, so it uses real warehouse column names and knows about caveats like "excludes internal emails".

The dictionary is seeded by asking the agent: "import our dbt definitions" or "pull the metrics from our Notion handbook" and it does the work.

## For developers

The rest of this doc is for anyone forking the Analytics template or extending it.

### Quick start

Create a new Analytics app from the CLI:

```bash
pnpm dlx @agent-native/core create my-analytics --template analytics --standalone
```

Local dev:

```bash
cd my-analytics-app
pnpm install
pnpm dev
```

The CLI prints the local dev URL. Sign in with Google, then open the **Data Sources** page to connect BigQuery, GA4, first-party tracking, HubSpot, Jira, and the rest.

### Key features (technical)

**Natural-language chart generation.** Ask the agent in plain English. It picks the right data source, writes the SQL, validates it against the warehouse, and renders the chart inline in chat or as a saved panel. Chart types: `line`, `area`, `bar`, `metric`, `table`, `pie`.

**Reusable SQL dashboards.** Dashboards are a named config with an array of panels. Each panel has an `id`, `title`, `sql`, `source` (`bigquery` / `ga4` / `amplitude` / `first-party`), `chartType`, and `width` (1 or 2 columns). See the full shape in `templates/analytics/app/pages/adhoc/sql-dashboard/types.ts`.

Dashboards support:

- **Parametric SQL** — declare `variables` and `filters` at the dashboard level; panels reference them with `{{var}}` interpolation.
- **Saved views** — per-dashboard filter presets stored in the `dashboard_views` table.
- **Resizable panels** — 1- or 2-column width per panel; the grid fills the rest.
- **Sharing** — private by default, share with users or orgs (`viewer` / `editor` / `admin`).

**Ad-hoc analyses.** Long-form investigations that cross-reference sources. An analysis saves the original question, step-by-step re-run instructions, the data sources it touched, and the full findings in Markdown. Anyone with access can re-run it against fresh data. Stored in the `analyses` table (see `templates/analytics/server/db/schema.ts`).

**Living data dictionary.** Canonical catalog of metrics — metric name, definition, table, columns, SQL template, known gotchas, owner, and data lag. The agent reads it before writing any SQL, so it uses the real warehouse column names (`hs_is_closed`, not guessed `is_closed`) and knows about caveats like "excludes internal emails". Seeded by asking the agent to import definitions from an existing source (dbt descriptions, a Notion page, a team wiki).

**SQL query explorer.** Direct queries against BigQuery and supported analytics backends from the **Ad-hoc** view. Useful for iterating before saving a dashboard panel.

**First-party analytics collector.** Hosted apps can send product and template events to `/track` with a public write key. Query those events through `query-agent-native-analytics` or dashboard panels with `source: "first-party"`.

**Multiple data connectors.** Built-in actions for common sources:

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

**Organizations and sharing.** Multi-org deployments are wired up by default via `@agent-native/core/org`. Dashboards and analyses are scoped to the active org. The `/team` route manages members and invitations. See `templates/analytics/app/routes/team.tsx`. Sharing uses the framework's `share-resource` primitive. Coarse visibility is `private` / `org` / `public`; fine-grained grants are per-principal with `viewer` / `editor` / `admin` roles.

### Working with the agent

The agent always knows what you're looking at. The current screen state is injected into every message as a `<current-screen>` block — it contains the active view, the open dashboard or analysis, and any selected filters.

The agent's system prompt gets an injected `<data-dictionary>` block with the approved metric entries for the active org. When you ask for a dashboard, the agent consults the dictionary first and uses the documented `table` / `columns` / `queryTemplate` verbatim — it does not guess column names.

**Context it has automatically:**

- **Current view** — `overview`, `adhoc` (with `dashboardId`), `analyses` (with `analysisId`), `data-dictionary`, `data-sources`, or `settings`.
- **Active org** — scopes all queries and writes.
- **Approved dictionary entries** — for the active workspace.

**Dashboard edits.** The agent uses the `update-dashboard` action to edit dashboards. It supports two modes:

- `ops` — JSON-Pointer patches for surgical edits (move a panel, replace one SQL string, remove a filter).
- `config` — full replacement of the dashboard config.

Every BigQuery panel's SQL is dry-run against the warehouse before the dashboard saves. If a column is wrong, the save is rejected with the BigQuery error — the agent fixes the SQL and retries instead of persisting broken panels.

### Connecting data sources

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

### Data model

Core tables (see `templates/analytics/server/db/schema.ts`):

- **`dashboards`** — both Explorer and SQL dashboards. `kind` is `"explorer"` or `"sql"`; `config` is a JSON blob matching `SqlDashboardConfig`.
- **`dashboard_shares`** — per-resource share grants (principal, role).
- **`dashboard_views`** — saved filter presets per dashboard.
- **`analyses`** — ad-hoc investigations with `question`, `instructions`, `dataSources`, `resultMarkdown`, and optional `resultData`.
- **`analysis_shares`** — per-resource share grants for analyses.
- **`bigquery_cache`** — query result cache keyed by SQL hash with bytes-processed accounting.

Plus the org tables (`organizations`, `org_members`, `org_invitations`) provided by `@agent-native/core/org`.

The data dictionary lives in the framework's `settings` table under scoped keys; see the `list-data-dictionary` and `save-data-dictionary-entry` actions for the full shape.

### Customizing it

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
