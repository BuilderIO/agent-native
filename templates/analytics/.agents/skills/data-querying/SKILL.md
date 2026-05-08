---
name: data-querying
description: >-
  General guidance on querying data sources, using existing scripts vs ad-hoc
  queries, filtering patterns, and generating charts for the analytics app.
---

# Data Querying

The analytics app connects to multiple data sources. This skill covers general patterns for querying data effectively.

## Approach

1. **Read the relevant provider skill first** — check `.agents/skills/<provider>/SKILL.md` for table names, column mappings, auth, and gotchas
2. **Use existing actions or connected provider MCP tools** — call the provider action/tool with structured arguments, then filter or aggregate the returned records in your answer
3. **Write ad-hoc scripts** — if no existing script covers the question, create one in `actions/`
4. **Present data in chat** — don't just say "check the dashboard" — actually query, get the data, and present it

For events recorded by the analytics template itself via its `/track` endpoint, use `pnpm action query-agent-native-analytics --sql "SELECT ... FROM analytics_events ..."`. This includes pageviews, site/app traffic, template usage, app usage, and event counts collected by this analytics app. Pageviews and traffic can also live in GA4, BigQuery/warehouse tables, Mixpanel, PostHog, Amplitude, or another configured provider, so choose the source from the user's wording, connected-source status, existing dashboards, data dictionary, and user/org resources. Ask one concise clarification if multiple configured sources are plausible. Do not use `db-query` for data-source analysis; `db-query` is only for internal app tables and will confuse analytics questions. The shipped `agent-native-templates-first-party` SQL dashboard is the template engagement dashboard for the first-party collector source.

Example pageviews query for a local calendar day:

```sql
SELECT COUNT(*) AS pageviews
FROM analytics_events
WHERE event_name = 'pageview'
  AND timestamp >= '<start-utc>'
  AND timestamp < '<end-utc>'
```

Convert the user's requested local date/timezone to UTC before querying. For
example, May 1, 2026 in America/New_York is `2026-05-01T04:00:00Z`
through `2026-05-02T04:00:00Z`.

## Showing Charts In Chat

For an in-chat answer, **emit a live `/chart` embed** — never `generate-chart`. The embed mounts a live `SqlChart` that re-queries when its source changes, and it doesn't choke on rigid JSON params the way the PNG action does. Full shape in `AGENTS.md` ("Inline Charts in Chat" section). Reach for `generate-chart` only when you're building a `save-analysis` artifact whose markdown will render outside the app.

If `generate-chart` returns an error in any chat-answering flow, the recovery is to switch to the live embed, not to retry with reformatted params.

## Script Patterns

### Reusing Existing Actions

```bash
# GitHub PRs
pnpm action github-prs --org=<org> --query="is:open label:bug"

# Jira tickets
pnpm action jira-search --jql="summary ~ SSO" --fields=key,summary,status

# HubSpot deals
pnpm action hubspot-deals --properties=dealname,amount,dealstage

# HubSpot contacts or companies
pnpm action hubspot-records --objectType=companies --query=builder.io --properties=name,domain,lifecyclestage
```

### Writing Ad-Hoc Scripts

When no existing script covers the question:

1. Create a new script in `actions/` that imports the relevant server lib
2. Run it via `pnpm action <name>`
3. For one-off queries, you can delete the script after
4. For reusable queries, keep the script

```ts
// scripts/my-query.ts
import { runQuery } from "../server/lib/bigquery.js";
import { output } from "./helpers.js";

export default async function main(args: string[]) {
  const results = await runQuery("SELECT ...");
  output(results);
}
```

## Cross-Referencing Sources

For complete answers, combine data from multiple sources:

- **BigQuery** for analytics events, signups, pageviews
- **First-party Analytics** (`query-agent-native-analytics`) for events collected through `/track`
- **HubSpot** for CRM data — `hubspot-records` for contacts/companies/tickets/general lookup; `hubspot-deals` and `hubspot-metrics` for pipeline and revenue analysis
- **Jira** for engineering metrics — tickets, sprints
- **GitHub** for code metrics — PRs, reviews
- **Sentry** for error rates and trends
- **Grafana** for infrastructure metrics

## Important Notes

- Always query real data — never guess or approximate
- Data-source status, data-dictionary reads, dashboard dry-runs, `update-dashboard`, `generate-chart`, and `save-analysis` are not data queries. For analyses and dashboards, run at least one provider query action and preserve the result evidence in the final answer or `resultData`.
- Use action arguments such as `query`, `objectType`, `properties`, `owner`, `limit`, or provider-specific filters to narrow output; if an action returns a broad batch, filter it in your analysis and cite the records used
- Update the relevant `.agents/skills/<provider>/SKILL.md` when you discover new patterns
- For BigQuery queries, check `.agents/skills/bigquery/SKILL.md` for table schemas first
