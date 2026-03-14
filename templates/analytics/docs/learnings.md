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
2. **Check upstream dependencies** — many incidents are caused by provider-side degradation (Vertex AI, external APIs, etc.), not our own code.
3. **Trace the request flow** — identify which endpoints are involved, what external calls they make, and where connections can pile up.
4. **Look for cascade patterns** — upstream slowdown → connection pileup → autoscaling spike → retry flood → outage.
5. **Check Grafana dashboards** — the Fusion Engineering dashboard (`/adhoc/fusion-eng`) has LLM latency by model, request rates, error rates, and instance metrics.
6. **Only analyze code/config after you have data** — deployment templates, autoscaling settings, and concurrency config are useful context but should not be the primary investigation method.

### Cloud Run spike incident (March 3, 2026)

**Root cause**: Vertex AI `gemini-3-1-pro` had a provider-side latency degradation at ~14:39 UTC. The `pr-description` task (Bitbucket webhook handler) calls Gemini to generate PR descriptions. When Gemini latency spiked from ~4s to 50s+, webhook requests held connections open, Cloud Run scaled to ~100 instances to handle the backlog, and Bitbucket's retry logic amplified the load to ~20 req/s (195x baseline), causing 500s.

**Cascade**: Gemini slowdown → connection pileup → Cloud Run autoscaling → Bitbucket retry flood → outage.

**Mitigation**: Add timeout + fallback model for `pr-description` tasks so webhooks return quickly rather than holding open connections.

**Lesson**: The initial investigation incorrectly focused on infrastructure config instead of querying actual Prometheus metrics, which would have immediately shown the Gemini latency spike as the trigger.

## Customer Data

### Deloitte

**HubSpot presence:**

- 3 companies: Deloitte, Deloitte - Service Desk, Deloitte Digital
- 517 contacts across all companies
- 439 Builder user accounts (via dim_hs_contacts mapping)
- 138 distinct root_organization_id values

**Fusion adoption (last 90 days):**

- 1 active user: sayarra@deloitte.com
- 3 total messages, all on 2025-12-10
- 0.2% adoption rate (1 of 439 users)

**Sales opportunity:**

- Massive expansion potential: 438 users who haven't tried Fusion
- Low engagement suggests lack of awareness or onboarding gaps

**Reusable script:** `deloitte-fusion-users.ts`

### Macy's

**IDs:**

- HubSpot deal ID: `39349139546`
- Company ID: `2895882939`
- Org IDs: `9060c246119d414a97029d535e99b322`, `05d13a2470824298aeacdabc2a3ace1c`, `42edb541a73f4cb6ba52c70092534a64`, `ceb199b063d34a47ad2b03c9d1e019df`

**Deal:**

- Deal name: "Macy's - New Deal - Fusion"
- Amount: $100K
- Stage: S2 - POV Scoping (entered Jan 23, 2026)
- Target close: March 31, 2026
- Pipeline: Enterprise New Business

**Use case: Design-to-Code (Figma → Vue.js)**

- Core pain: long feedback loops between design and engineering
- Tech stack: Figma for design, **Vue.js** for frontend, **brownfield** applications
- Goal: shorten sprint cycles with clean, production-ready code output from Figma designs

**Key stakeholders:**

- **Dina** — VP/head of the group, executive sponsor. Previously at Walmart
- **Prabh** — reports to Dina, involved in POC oversight
- **Omar Qazi** (omar.qazi@macys.com) — engineer running point on the POC
- **Miguel** — gave Omar initial briefing
- Builder SE: **Nick Nestle** (nnestle@builder.io)

**Fusion usage (as of Mar 6, 2026):**

- 700 messages in last 90 days
- ~27 active days, peak day Feb 14 (89 messages)
- Ramped from 1–2 msgs/day (Dec) to 40–89 msgs/day (Jan–Feb)
- 5 Macy's engineers have started using it
- Last activity: Feb 23 — ~11 day gap as of Mar 6

**Reusable scripts:** `macys-fusion-messages.ts`, `macys-users-daily.ts`

## DevRel Team

| Name             | Twitter Handle   |
| ---------------- | ---------------- |
| Steve Sewell     | @Steve8708       |
| Alice Moore      | @tempoimmaterial |
| Vishwas Gopinath | @CodevolutionWeb |
| Matt Abrams      | @zuchka\_        |

Defined in `client/pages/adhoc/devrel-leaderboard/TwitterSection.tsx` as `DEVREL_TWITTER_USERS`.

## User Preferences

- **Filter out @builder.io emails** when showing customer-specific activity. Builder SEs are not the customer's users.
- **Charts in chat should be minimal** — short title only, no subtitle. Stats go in surrounding chat text. See `.builder/skills/charts/SKILL.md` for full styling guide.
- **Stacked bars by user email** are preferred for per-customer breakdowns.
- **Inline charts in chat are preferred** — query data directly and render charts inline as images. Give direct answers with data, tables, and charts.
- **Direct responses** — query data and present findings directly in chat with markdown tables + inline chart images.
- **Use markdown links** — always use `[text](url)` when URLs are available. For Jira: `[ENG-1234](https://builderio.atlassian.net/browse/ENG-1234)`.
- **Always use skeleton loaders** — never show "Loading..." text. Use `<Skeleton>` components or `bg-muted animate-pulse` blocks.

## Dashboard Data Fetching Pattern (CRITICAL)

**NEVER use scripts for dashboard UI data.** Use `useMetricsQuery(queryKey, sql)` with direct BigQuery SQL:

- Define SQL in `queries.ts` alongside the dashboard
- Queries go through authenticated `/api/query` endpoint
- For customer lookups, use CTEs with JOINs to `dim_hs_contacts`
- **Scripts are for CLI/agent use only**

See `client/pages/adhoc/macys/queries.ts` and `client/pages/adhoc/deloitte/queries.ts` as reference implementations.

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

| Script                     | Description                                                     |
| -------------------------- | --------------------------------------------------------------- |
| `macys-fusion-messages.ts` | HubSpot → BigQuery → Amplitude pipeline for Macy's (`--days=N`) |
| `macys-users-daily.ts`     | Daily per-user breakdown for Macy's orgs                        |
| `kpmg-users-daily.ts`      | HubSpot → BigQuery → Amplitude pipeline for KPMG (`--days=N`)   |
| `kpmg-chart.ts`            | Stacked bar chart of KPMG fusion messages by user               |
| `fusion-users-by-tier.ts`  | Daily unique Fusion users by plan tier                          |
| `fusion-users-by-email.ts` | Top Fusion users by message count                               |
| `deloitte-fusion-users.ts` | HubSpot → BigQuery → Amplitude for Deloitte                     |
