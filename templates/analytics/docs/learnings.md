# Learnings & Findings

Accumulated knowledge from building and debugging this project. Reference this to avoid repeating past mistakes.

<!-- last updated: 2026-03-22 -->

> **Provider-specific knowledge** (BigQuery tables, API quirks, auth patterns, script usage) lives in `.builder/skills/<provider>/SKILL.md`.
> This file contains **generic patterns and cross-cutting learnings** that span multiple providers or aren't provider-specific.
> After completing work, **always update the relevant skill file or this file** with new discoveries.
> To improve a skill, edit the SKILL.md directly — skills should be continuously refined based on learnings and feedback.

## Agent Behavior Rules

### Questions and investigations: answer the question, don't build things

When the user asks a question — "investigate X", "look into Y", "help us understand Z", "what is causing W" — they want **an answer, not code**. Do NOT build dashboards, create new pages, write scripts, or modify files unless explicitly asked. Instead:

1. Query real metrics and logs using the tools available (Grafana, Cloud Monitoring, BigQuery, Sentry, etc.)
2. Analyze the data to identify root causes
3. Report findings directly in chat
4. Only build dashboards, scripts, or implement code changes **when explicitly requested**

**The default is: read-only research, then report back. Never create dashboards, pages, or new code unless the user asks for it.**

### Investigating incidents: query real data first, analyze code second

When investigating production issues (spikes, outages, errors, performance degradation):

1. **Query actual metrics FIRST** — use Grafana/Prometheus, Cloud Monitoring, Sentry, and Cloud Logging before looking at code. Real data tells you what happened; code only tells you what _could_ happen.
2. **Check upstream dependencies** — many incidents are caused by provider-side degradation (LLM APIs, external services, etc.), not our own code.
3. **Trace the request flow** — identify which endpoints are involved, what external calls they make, and where connections can pile up.
4. **Look for cascade patterns** — upstream slowdown → connection pileup → autoscaling spike → retry flood → outage.
5. **Check Grafana dashboards** — the engineering dashboard has LLM latency by model, request rates, error rates, and instance metrics.
6. **Only analyze code/config after you have data** — deployment templates, autoscaling settings, and concurrency config are useful context but should not be the primary investigation method.

## User Preferences

- **Filter out internal team emails** when showing customer-specific activity. Internal SEs are not the customer's users.
- **Charts in chat should be minimal** — short title only, no subtitle. Stats go in surrounding chat text. See `.builder/skills/charts/SKILL.md` for full styling guide.
- **Stacked bars by user email** are preferred for per-customer breakdowns.
- **Inline charts in chat are preferred** — query data directly and render charts inline as images. Give direct answers with data, tables, and charts.
- **Direct responses** — query data and present findings directly in chat with markdown tables + inline chart images.
- **Use markdown links** — always use `[text](url)` when URLs are available. For Jira: `[ENG-1234](https://yourorg.atlassian.net/browse/ENG-1234)`.
- **Always use skeleton loaders** — never show "Loading..." text. Use `<Skeleton>` components or `bg-muted animate-pulse` blocks.

## Dashboard Data Fetching Pattern (CRITICAL)

**NEVER use scripts for dashboard UI data.** Use `useMetricsQuery(queryKey, sql)` with direct BigQuery SQL:

- Define SQL in `queries.ts` alongside the dashboard
- Queries go through authenticated `/api/query` endpoint
- For customer lookups, use CTEs with JOINs to contact tables
- **Scripts are for CLI/agent use only**

## UI Patterns

### Charts with many series values

When "View By" selects a dimension with many distinct values, the Recharts Legend overwhelms the chart. Solutions:

- Cap displayed series to top N by value, bucket the rest as "Other"
- Hide default Legend, use compact scrollable legend
- Show legend on hover/tooltip only

### Recharts stacked charts

- Use `stackId="1"` on all Area/Bar elements for stacking
- `pivotData` in DynamicChart.tsx transforms flat BigQuery rows to wide format Recharts expects

## Cross-Referencing Customers Across Services

1. **HubSpot** → company name/domain → identifies the customer
2. **Pylon** → search by account name → support ticket history
3. **Common Room** → search by email → community engagement
4. **Gong** → search by company name → sales call history and transcripts
5. **Apollo** → enrich by email/domain → contact details, titles, org info
6. **BigQuery** → Amplitude events → product usage data
7. **Grafana** → dashboards & alerts → service health
8. **Jira** → search by project/JQL → ticket analytics

### Joining Contacts and Users (CRITICAL)

**Always match on BOTH user_id AND email** when joining contact tables with user data:

```sql
ON signups.user_id = contacts.user_id
AND signups.email = contacts.email
```

**Why both?** User IDs can be reassigned or have sync issues between CRM and BigQuery. Matching on both user_id and email ensures accurate contact-to-user mapping and prevents false matches.
