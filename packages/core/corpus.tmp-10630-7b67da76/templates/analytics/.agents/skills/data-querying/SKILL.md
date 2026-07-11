---
name: data-querying
description: >-
  General guidance on querying data sources, using existing scripts vs ad-hoc
  queries, filtering patterns, and generating charts for the analytics app.
---

# Data Querying

The analytics app connects to multiple data sources. This skill covers general patterns for querying data effectively.

## Approach

0. **Orient catalog-first** — before querying, consult what already exists: the injected `<data-dictionary>` and data-source status tell you which sources are configured and which table/columns/join paths to use. Use them to pick the one source that owns the fact instead of fanning out blind queries.
1. **Read the relevant provider skill first** — check `.agents/skills/<provider>/SKILL.md` for table names, column mappings, auth, and gotchas. For BigQuery, read `.agents/skills/bigquery/SKILL.md` and use `search-bigquery-schema` before guessing table or column names.
2. **Clarify if ambiguous** — if the metric definition, date range, or grain is unclear and a wrong guess would change the numbers, use the `ask-question` clarifying tool (multiple-choice) before querying. Ask at most once per turn; skip it when the dictionary or the user already answered.
3. **Use existing actions or connected provider MCP tools** — call the provider action/tool with structured arguments, then filter or aggregate the returned records in your answer
4. **Write ad-hoc scripts** — if no existing script covers the question, create one in `actions/`
5. **Present data in chat** — don't just say "check the dashboard" — actually query, get the data, and present it. Only present numbers you actually retrieved; never report a value you did not query.

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
# Jira tickets
pnpm action jira-search --jql="summary ~ SSO" --fields=key,summary,status

# HubSpot deals
pnpm action hubspot-deals --query="The Knot" --limit=10 --properties=dealname,amount,dealstage

# HubSpot + Gong account/deal deep dive
pnpm action account-deep-dive --query="The Knot" --days=180 --gongLimit=10 --transcriptLimit=5

# HubSpot contacts or companies
pnpm action hubspot-records --objectType=companies --query=builder.io --properties=name,domain,lifecyclestage

# Gong call content for a customer deep dive
pnpm action gong-calls --company="The Knot" --days=180 --includeTranscripts=true --transcriptLimit=5
```

The first-class actions above are convenience shortcuts for the common cases, not
the limit of what you can do. Many providers (GitHub, Amplitude, PostHog,
Mixpanel, Apollo, Common Room, Twitter/X, Notion, Pylon, GA4, plus any
endpoint/filter a shortcut can't express) have **no bespoke action** — reach
them through the shared provider API escape-hatch pattern:
`provider-api-catalog` / `provider-api-docs` to learn the endpoint, then
`provider-api-request` (or `providerFetch` inside `run-code`) against the
provider's real HTTP API. For broad/corpus-wide questions ("how many", "which",
"any/none across all …") prefer this raw-API + `run-code` path from the first
step — fetch the full cohort with `fetchAllPages`/`saveToFile` and
grep/aggregate locally — rather than stretching a capped shortcut action.

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

For answers that span multiple sources, follow the `cross-source-analysis` skill: plan which source owns each fact, fetch per source, stitch identities on BOTH a stable id AND email (ids can be reassigned), de-duplicate, and cite per-source provenance.

For complete answers, combine data from multiple sources:

- **BigQuery** for analytics events, signups, pageviews
- **First-party Analytics** (`query-agent-native-analytics`) for events collected through `/track`
- **HubSpot** for CRM data — `hubspot-records` for contacts/companies/tickets/general lookup; `hubspot-deals` and `hubspot-metrics` for pipeline and revenue analysis
- **Gong** for sales-call evidence — use `gong-calls` with `includeTranscripts=true` for deep dives, objections, risks, or next steps
- **Jira** for engineering metrics — tickets, sprints
- **GitHub** for code metrics — PRs, reviews
- **Sentry** for error rates and trends
- **Grafana** for infrastructure metrics

## After Completing an Analysis — Capture New Knowledge

When you complete an analysis and discover:

- A new confirmed metric definition or how a field is actually calculated
- A provider gotcha (wrong column name, API quirk, unexpected behavior)
- A schema discovery (table exists but wasn't in the dictionary, a column name differs)
- An identity-stitching rule (how to match users across two specific sources)

Capture it immediately using `save-memory` or by writing to `LEARNINGS.md` via
the `resources` tool:

```
resources(action: "read", path: "LEARNINGS.md")  -- read first to merge
resources(action: "write", path: "LEARNINGS.md", content: "<updated content>")
```

Keep each entry short and actionable: what to do, what not to do, and why.
This is the learnings flywheel — discoveries persist across sessions and improve
future analyses.

## Important Notes

- Always query real data — never guess or approximate. Only present numbers you actually retrieved; do not claim a figure you did not query.
- Answer questions directly in chat with tables, inline charts, and findings. Never deflect to "check the dashboard" — actually run the query and present the answer.
- Before finalizing an analytics answer, make the evidence trail explicit enough
  to audit: source(s), time window, filters, sample size or row count, join or
  match method, caveats/gaps, and what action to take next when useful.
- Data-source status, data-dictionary reads, dashboard dry-runs, `update-dashboard`, `generate-chart`, and `save-analysis` are not data queries. For analyses and dashboards, run at least one provider query action and preserve the result evidence in the final answer or `resultData`.
- Use action arguments such as `query`, `objectType`, `properties`, `owner`, `limit`, or provider-specific filters to narrow output; if an action returns a broad batch, filter it in your analysis and cite the records used.
- Update the relevant `.agents/skills/<provider>/SKILL.md` when you discover new patterns.
- For BigQuery queries, check `.agents/skills/bigquery/SKILL.md` first; if the data dictionary does not contain the exact table/columns, call `search-bigquery-schema`.
