---
name: data-querying
description: >-
  General guidance on querying data sources, using existing scripts vs ad-hoc
  queries, filtering patterns, and generating charts for the analytics app.
---

# Data Querying

The analytics app connects to multiple data sources. This skill covers general patterns for querying data effectively.

## Approach

1. **Read the relevant provider skill first** — check `.builder/skills/<provider>/SKILL.md` for table names, column mappings, auth, and gotchas
2. **Use existing scripts** — run `pnpm action <name> --arg=value` with `--grep` and `--fields` for filtering
3. **Write ad-hoc scripts** — if no existing script covers the question, create one in `actions/`
4. **Present data in chat** — don't just say "check the dashboard" — actually query, get the data, and present it

For events recorded by the analytics template itself via `analytics.agent-native.com/track`, use `pnpm action query-agent-native-analytics --sql "SELECT ... FROM analytics_events ..."`. Do not use `db-query` for first-party analytics questions; `db-query` is only for internal app tables and will confuse data-source analysis. The shipped `agent-native-templates-first-party` SQL dashboard is the template engagement dashboard for this source.

## Built-in Filtering

All scripts that use `output()` support universal flags:

```bash
# Case-insensitive search across all values
pnpm action hubspot-deals --grep="enterprise"

# Pick specific fields from results
pnpm action hubspot-deals --fields=dealname,amount,stageLabel

# Combine both
pnpm action seo-top-keywords --grep=remix --fields=keyword,rank_absolute,etv
```

## Generating Charts

Use the `generate-chart` script to create inline charts for chat responses. See `.builder/skills/charts/SKILL.md` for chart types, styling options, and examples.

## Script Patterns

### Reusing Existing Scripts

```bash
# GitHub PRs
pnpm action github-prs --org=YourOrg --query="is:open label:bug"

# Jira tickets
pnpm action jira-search --jql="summary ~ SSO" --fields=key,summary,status

# HubSpot deals
pnpm action hubspot-deals --fields=dealname,amount,stageLabel

# SEO keywords
pnpm action seo-top-keywords --grep=remix --fields=keyword,rank_absolute,etv
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
- **HubSpot** for CRM data — deals, contacts, revenue
- **Jira** for engineering metrics — tickets, sprints
- **GitHub** for code metrics — PRs, reviews
- **Sentry** for error rates and trends
- **Grafana** for infrastructure metrics

## Important Notes

- Always query real data — never guess or approximate
- Use `--grep` and `--fields` to narrow output, don't pipe through grep
- Update the relevant `.builder/skills/<provider>/SKILL.md` when you discover new patterns
- For BigQuery queries, check `.builder/skills/bigquery/SKILL.md` for table schemas first
