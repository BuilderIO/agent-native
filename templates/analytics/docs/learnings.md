# Learnings & Findings

Accumulated knowledge from building and debugging this project. Reference this to avoid repeating past mistakes.

<!-- last updated: 2026-03-06 -->

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

### Cloud Run spike incident (example)

**Root cause**: An upstream LLM provider had a latency degradation at ~14:39 UTC. A webhook handler that calls the LLM to generate content saw latency spike from ~4s to 50s+. Webhook requests held connections open, Cloud Run scaled to ~100 instances to handle the backlog, and the webhook source's retry logic amplified the load to ~20 req/s (195x baseline), causing 500s.

**Cascade**: LLM slowdown → connection pileup → Cloud Run autoscaling → webhook retry flood → outage.

**Mitigation**: Add timeout + fallback model for webhook tasks so they return quickly rather than holding open connections.

**Lesson**: The initial investigation incorrectly focused on infrastructure config instead of querying actual Prometheus metrics, which would have immediately shown the LLM latency spike as the trigger.

## Customer Data

### Globex Inc

**HubSpot presence:**

- 3 companies: Globex Inc, Globex Services, Globex Digital
- 517 contacts across all companies
- 439 user accounts (via dim_hs_contacts mapping)
- 138 distinct root_organization_id values

**Product adoption (last 90 days):**

- 1 active user: jsmith@globex.com
- 3 total messages, all on 2025-12-10
- 0.2% adoption rate (1 of 439 users)

**Sales opportunity:**

- Massive expansion potential: 438 users who haven't tried the product
- Low engagement suggests lack of awareness or onboarding gaps

**Reusable script:** `globex-product-users.ts`

### Acme Corp

**IDs:**

- HubSpot deal ID: `12345678901`
- Company ID: `9876543210`
- Org IDs: `aaaabbbb11112222`, `ccccdddd33334444`, `eeeeffff55556666`, `gggghhhh77778888`

**Deal:**

- Deal name: "Acme Corp - New Deal - Enterprise"
- Amount: $100K
- Stage: S2 - POV Scoping (entered Jan 23, 2026)
- Target close: March 31, 2026
- Pipeline: Enterprise New Business

**Use case: Design-to-Code (Figma → Vue.js)**

- Core pain: long feedback loops between design and engineering
- Tech stack: Figma for design, **Vue.js** for frontend, **brownfield** applications
- Goal: shorten sprint cycles with clean, production-ready code output from Figma designs

**Key stakeholders:**

- **Dana** — VP/head of the group, executive sponsor
- **Priya** — reports to Dana, involved in POC oversight
- **Omar Khan** (omar.khan@acmecorp.com) — engineer running point on the POC
- **Miguel** — gave Omar initial briefing
- SE: **Nathan Novak** (nnovak@example.com)

**Product usage (as of Mar 6, 2026):**

- 700 messages in last 90 days
- ~27 active days, peak day Feb 14 (89 messages)
- Ramped from 1–2 msgs/day (Dec) to 40–89 msgs/day (Jan–Feb)
- 5 engineers have started using it
- Last activity: Feb 23 — ~11 day gap as of Mar 6

**Reusable scripts:** `acme-product-messages.ts`, `acme-users-daily.ts`

## DevRel Team

| Name       | Twitter Handle |
| ---------- | -------------- |
| Jane Doe   | @janedoe       |
| Alex Chen  | @alexchen_dev  |
| Sam Patel  | @sampateldev   |
| Taylor Kim | @taylorkimdev  |

Defined in `app/pages/adhoc/devrel-leaderboard/TwitterSection.tsx` as `DEVREL_TWITTER_USERS`.

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
- For customer lookups, use CTEs with JOINs to `dim_hs_contacts`
- **Scripts are for CLI/agent use only**

See `app/pages/adhoc/acme/queries.ts` and `app/pages/adhoc/globex/queries.ts` as reference implementations.

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

**Always match on BOTH user_id AND email** when joining HubSpot contacts (`dim_hs_contacts`) with user data (`signups`, `product_signups`, etc.):

```sql
ON signups.user_id = dim_hs_contacts.builder_user_id
AND signups.email = dim_hs_contacts.email
```

**Why both?** User IDs can be reassigned or have sync issues between HubSpot and BigQuery. Matching on both user_id and email ensures accurate contact-to-user mapping and prevents false matches.

## Reusable Scripts

| Script                      | Description                                                        |
| --------------------------- | ------------------------------------------------------------------ |
| `acme-product-messages.ts`  | HubSpot → BigQuery → Amplitude pipeline for Acme Corp (`--days=N`) |
| `acme-users-daily.ts`       | Daily per-user breakdown for Acme Corp orgs                        |
| `initech-users-daily.ts`    | HubSpot → BigQuery → Amplitude pipeline for Initech (`--days=N`)   |
| `initech-chart.ts`          | Stacked bar chart of Initech product messages by user              |
| `product-users-by-tier.ts`  | Daily unique product users by plan tier                            |
| `product-users-by-email.ts` | Top product users by message count                                 |
| `globex-product-users.ts`   | HubSpot → BigQuery → Amplitude for Globex Inc                      |
