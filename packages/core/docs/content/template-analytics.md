---
title: "Analytics"
description: "Ask analytics questions in plain English, get charts and dashboards back. An open-source replacement for Amplitude, Mixpanel, and Looker."
---

# Analytics

Ask analytics questions in plain English, get charts and dashboards back. The agent connects to BigQuery, GA4, Amplitude, the built-in first-party event collector, HubSpot, Jira, and a dozen other sources, writes the query for you, validates it, and renders the answer as a chart, table, or saved dashboard panel.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:14px;padding:18px;min-height:500px;box-sizing:border-box'><h1 style='margin:0'>Agent-Native Templates</h1><p class='wf-muted' style='margin:0'>Adoption and engagement across the last 12 weeks.</p><div style='display:grid;grid-template-columns:repeat(3,1fr);gap:12px'><div class='wf-card'><small class='wf-muted'>Weekly active users</small><br/><strong>24,318</strong><br/><span class='wf-pill accent'>+12.4%</span></div><div class='wf-card'><small class='wf-muted'>New signups</small><br/><strong>1,842</strong><br/><span class='wf-pill accent'>+8.7%</span></div><div class='wf-card'><small class='wf-muted'>Revenue MRR</small><br/><strong>$48,210</strong><br/><span class='wf-pill accent'>+21.3%</span></div></div><div style='display:grid;grid-template-columns:1fr 1fr;gap:12px;flex:1'><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><strong>Weekly active users</strong><div style='flex:1;display:flex;align-items:end;gap:8px'><div style='height:38%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:44%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:58%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:74%;flex:1;background:var(--wf-accent-soft)'></div></div></div><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><strong>Revenue over time</strong><div style='flex:1;display:flex;align-items:end;gap:8px'><div style='height:32%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:48%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:63%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:80%;flex:1;background:var(--wf-accent-soft)'></div></div></div></div><div class='wf-card'><strong>Signups by source</strong><br/><small class='wf-muted'>Lower chart begins below the main charts.</small></div></div>"
}
```

It's an open-source replacement for Amplitude, Mixpanel, and Looker — for teams that want to own the code, the queries, and the data.

```an-diagram title="Question to chart" summary="The agent consults the data dictionary, writes SQL, validates it against the warehouse, then renders a chart or saves a panel."
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-node\">Plain-English<br>question</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Agent</span><small class=\"diagram-muted\">reads data dictionary</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Writes SQL</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill ok\">Dry-run validate</div><small class=\"diagram-muted\">BigQuery / source</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">Chart, table, or<br>saved panel</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:6px;align-items:center}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## What you can do with it

- **Ask data questions in plain English.** "What percent of signups last month converted to paid?" or "Show me weekly active users for the past 6 months." The agent picks the right source, writes the SQL, and renders the chart.
- **Build reusable SQL dashboards** with filters, saved views, and parametric queries.
- **Run ad-hoc analyses** that cross-reference multiple data sources — saved as re-runnable investigations with the original question, instructions, and findings.
- **Maintain a living data dictionary** of metrics, tables, and SQL recipes so the agent uses the right column names every time (no more guessed `is_closed` when it's actually `hs_is_closed`).
- **Share dashboards** with your team — private by default, shareable per-user or per-org with viewer / editor / admin roles.
- **Connect to many sources** out of the box: BigQuery, GA4, Mixpanel, Amplitude, PostHog, HubSpot, Jira, Apollo, Pylon, Gong, Common Room, Twitter, plus app-specific SEO sources.
- **Reuse workspace integrations** when a workspace has already connected and
  granted a provider to Analytics. The shared integration stores provider
  identity and credential refs; Analytics keeps app-specific source selection,
  data dictionary entries, dashboard SQL, and analysis history.

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
npx @agent-native/core@latest create my-analytics --standalone --template analytics
```

Local dev:

```bash
cd my-analytics
pnpm install
pnpm dev
```

The Analytics template's dev script pins `DATABASE_URL` to the local SQLite
file at `./data/app.db`, so a production `DATABASE_URL` in `.env` will not be
used during local development. To intentionally point local dev at another
database, run `ANALYTICS_DATABASE_URL=<your dev database url> pnpm dev`.

The CLI prints the local dev URL. Sign in with Google, then open the **Data Sources** page to connect BigQuery, GA4, first-party tracking, HubSpot, Jira, and the rest.

### Key features

**Ask questions, get charts.** The agent picks a data source, writes and validates SQL, then renders a chart, table, metric, or saved panel.

**Dashboards and investigations.** Reusable dashboards keep SQL panels, filters, saved views, and sharing; ad-hoc analyses save longer findings with re-run instructions.

**Living data dictionary.** Metric definitions, owners, source tables, and known caveats give the agent the real warehouse vocabulary before it writes queries.

**Broad connector surface.** BigQuery, GA4, product analytics, CRM, support, community, GitHub/Jira, SEO, and first-party `/track` events all come through actions the agent can call.

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

Open the **Data Sources** page (`/data-sources`) to connect providers. Each
source exposes an env-key list, a walkthrough, and a **Test Connection** button.
When Analytics is running in a workspace, `data-source-status` also reports
granted reusable workspace connections for `appId=analytics` so the agent can
ask for an app grant instead of another copy of the same provider key.
For reusable providers such as Slack, HubSpot, Notion, and GitHub, the Data
Sources UI shows the shared integration state directly: ready via workspace,
needs grant, needs credentials, or local credentials.

Reusable workspace integrations are the runtime direction for shared providers:
the framework stores provider identity, account metadata, credential refs, and
per-app grants once; Analytics stores data-source interpretation, source of
truth choices, metric definitions, dashboards, and analyses.

Credentials are stored via the framework's settings/env layer — no secrets in git. Production requires:

| Variable                                 | Purpose                                                 |
| ---------------------------------------- | ------------------------------------------------------- |
| `DATABASE_URL`                           | Persistent SQL connection URL                           |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | Auth                                                    |
| `GOOGLE_SIGN_IN_CLIENT_ID` / `_SECRET`   | Preferred Google sign-in client (OAuth 2.0)             |
| `GOOGLE_CLIENT_ID` / `_SECRET`           | Legacy sign-in fallback / Google API integration client |
| `BIGQUERY_PROJECT_ID`                    | BigQuery project                                        |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON`    | BigQuery service-account JSON                           |
| `ANTHROPIC_API_KEY`                      | Agent chat                                              |

Provider-specific keys (HubSpot, Jira, Gong, Pylon, etc.) are documented in each source's walkthrough on the Data Sources page. If you add a new action that needs an API key, it appears as a new source on that page via the template's onboarding registration.

Note: the BigQuery OAuth credential for Google sign-in is a **separate**
credential from the BigQuery service account JSON. Create the sign-in client at
GCP Console → APIs & Services → Credentials → OAuth client ID, and prefer the
`GOOGLE_SIGN_IN_CLIENT_ID` / `GOOGLE_SIGN_IN_CLIENT_SECRET` env names so this
low-scope login client stays separate from Google API integration clients.

### Data model

Core tables (see `templates/analytics/server/db/schema.ts`):

```an-schema title="Analytics data model" summary="Dashboards and analyses are the resources; views, shares, and a query cache hang off them. Org tables come from @agent-native/core/org."
{
  "entities": [
    {
      "id": "dashboards",
      "name": "dashboards",
      "note": "Explorer and SQL dashboards",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "kind", "type": "text", "note": "\"explorer\" or \"sql\"" },
        { "name": "config", "type": "text", "note": "JSON matching SqlDashboardConfig" }
      ]
    },
    {
      "id": "dashboard_views",
      "name": "dashboard_views",
      "note": "Saved filter presets per dashboard",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "dashboard_id", "type": "text", "fk": "dashboards.id" }
      ]
    },
    {
      "id": "analyses",
      "name": "analyses",
      "note": "Re-runnable ad-hoc investigations",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "question", "type": "text" },
        { "name": "instructions", "type": "text", "note": "Re-run steps" },
        { "name": "dataSources", "type": "text", "note": "Sources touched" },
        { "name": "resultMarkdown", "type": "text" },
        { "name": "resultData", "type": "text", "nullable": true }
      ]
    },
    {
      "id": "bigquery_cache",
      "name": "bigquery_cache",
      "note": "Result cache keyed by SQL hash",
      "fields": [
        { "name": "sql_hash", "type": "text", "pk": true },
        { "name": "bytes_processed", "type": "integer" }
      ]
    }
  ],
  "relations": [
    { "from": "dashboards", "to": "dashboard_views", "kind": "1-n", "label": "saved views" }
  ]
}
```

Plus per-resource share tables (`dashboard_shares`, `analysis_shares`) and the org tables (`organizations`, `org_members`, `org_invitations`) provided by `@agent-native/core/org`. The data dictionary lives in the framework's `settings` table under scoped keys.

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

For the broader pattern on extending templates, see the [Skills guide](/docs/skills-guide) and [Actions](/docs/actions).
