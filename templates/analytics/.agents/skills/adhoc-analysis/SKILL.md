---
name: adhoc-analysis
description: >-
  How to conduct ad-hoc analyses: gather data from multiple sources, synthesize
  findings, and save durable results as dashboard artifacts that anyone can re-run.
---

# Ad-Hoc Analysis

Ad-hoc analyses are deep-dive investigations that cross-reference multiple data sources and produce a written report with findings. The durable user-facing result is a dashboard. Answer in chat first unless the user explicitly asks to save the result, create a reusable artifact, or re-run/update an existing saved analysis.

## When to Use

Use the ad-hoc analysis workflow when:

- The user asks a complex question that requires data from multiple sources
- The investigation involves cross-referencing (e.g., CRM deals matched against call recordings)
- The user explicitly asks for an "analysis" or "deep dive"

Save a reusable dashboard artifact when:

- The user explicitly asks to save, create, publish, or re-run a saved analysis
- The user is already viewing or re-running an existing saved analysis
- The output needs a durable artifact because it includes generated chart images or a reusable refresh workflow

For one-off questions and exploratory deep dives, query the data and answer in chat. Do not create a dashboard or call the legacy `save-analysis` action just because the user said "analysis" or "deep dive".

If the user asks for an analysis output that needs a bespoke interactive
surface, custom visualization, multi-step workflow, or UI that cannot be
faithfully represented by native dashboard panels, create an extension and
immediately embed it in the dashboard as one or more `chartType: "extension"`
panels with `config.extensionId`. Never leave the extension as a standalone
Analytics result or direct the user to an Extensions page.

## Workflow

### Step 1: Understand the Question (catalog-first, clarify-first)

Orient before gathering data. Consult the injected `<data-dictionary>` and data-source status first to see which sources are configured and which one owns each fact, then settle scope:

- What is being analyzed? (deals, users, campaigns, errors, etc.)
- What time range?
- What data sources are relevant? (map each fact to the one source that owns it)
- What output does the user expect? (summary, ranking, comparison, trend)

If the metric definition, date range, or grain is ambiguous and a wrong guess would change the numbers, use the `ask-question` clarifying tool (multiple-choice) before gathering data. Ask at most once per turn, and skip it when the dictionary or the user already answered.

### Step 2: Gather Data from Multiple Sources

Use the available actions to pull data. Read the relevant `.agents/skills/<provider>/SKILL.md` before querying each source.

**Common data source combinations:**

| Analysis type           | Data sources                                                     |
| ----------------------- | ---------------------------------------------------------------- |
| Deal/account deep dive  | `account-deep-dive` bundle, then targeted HubSpot/Gong follow-up |
| Sales pipeline analysis | HubSpot deals + Gong calls + Slack mentions                      |
| Customer health check   | HubSpot deals + Pylon support tickets + BigQuery usage events    |
| Content performance     | BigQuery pageviews + GA4 + SEO keywords + HubSpot signups        |
| Engineering velocity    | GitHub PRs + Jira tickets + BigQuery deploy events               |
| Churn investigation     | Stripe billing + HubSpot deals + Pylon tickets + BigQuery usage  |

**Tips for data gathering:**

- Start with the primary source (e.g., HubSpot for deals), then enrich with secondary sources
- For named deal/account deep dives, call `account-deep-dive` first with the
  account, company, domain, deal, or opportunity name. It returns HubSpot deals,
  associated companies/contacts/tickets/notes/emails, Gong call detail, compact
  transcript excerpts, coverage counts, and gaps. Use targeted `hubspot-records`
  or `gong-calls` follow-ups only when that bundle leaves a specific gap.
- Structure named deal/account reports like Fusion Analytics: executive summary,
  company/deal overview, key contacts and roles, dated timeline, Gong evidence
  with call dates/titles, current state, risks/blockers, recommended next steps,
  and methodology/gaps. Do not answer from an all-deals dump or Gong metadata
  alone.
- Use action filters such as `query`, `properties`, `objectType`, `company`, and
  `limit` to narrow results before cross-referencing
- For HubSpot deal cohorts, use `hubspot-deals` structured filters (`product`,
  `pipeline`, `closedStatus`, `closedDateFrom`, `closedDateTo`) for the cohort
  definition. Do not use `query` when the user names a specific HubSpot field
  such as `products`.
- When any first-class provider action is too narrow, use
  `provider-api-catalog` / `provider-api-docs` and then `provider-api-request`
  against the provider's real HTTP API. Do not weaken the analysis just because
  the convenience action is missing an argument.
- When stitching identities across sources, follow `cross-source-analysis`: match on BOTH a stable id AND email (ids can be reassigned), de-duplicate, and record match quality. Email/company-name/domain matches alone are low-confidence — flag them as caveats, not headline numbers.
- If a data source is not configured, mention what's missing and work with what's available — never invent rows to fill a gap.

### Step 3: Analyze and Synthesize

Don't just dump raw data. Synthesize findings:

- Identify patterns, trends, and outliers
- Calculate key metrics (totals, averages, rates, distributions)
- Rank or categorize items when useful
- Call out surprises or actionable insights
- Compare against benchmarks or prior periods when possible
- Only report figures you actually retrieved from a source — never present a number you did not query. Attribute each figure to its source and time window.
- Make the evidence trail explicit enough to audit: source(s), time window,
  filters, sample size or row count, join/match method, caveats/gaps, and
  recommended next action when useful.

### Step 4: Generate Charts (when useful)

When the analysis benefits from a visual — trends over time, distributions, comparisons between categories — call `generate-chart` before formatting the report. The action returns a `url` you embed directly in the markdown.

```
generate-chart
  --title "Closed-lost deals by month"
  --type bar
  --labels '["Jan","Feb","Mar"]'
  --data '[18, 22, 14]'
```

Embed the returned URL in `resultMarkdown` using standard markdown image syntax:

```markdown
![Closed-lost deals by month](/api/media/closed-lost-deals-by-month-1234567890.png?v=1234567890)
```

You can include multiple charts in one analysis. Reach for a chart when it communicates the finding faster than a table — don't force visuals on every analysis.

Include the re-generation step in your saved `instructions` so re-runs produce fresh charts.

### Step 5: Format Results as Markdown

Structure the report clearly:

```markdown
## Key Findings

- **Finding 1**: Specific insight with supporting numbers
- **Finding 2**: Another insight
- **Finding 3**: Actionable recommendation

## Summary Metrics

| Metric               | Value   |
| -------------------- | ------- |
| Total deals analyzed | 54      |
| Average deal size    | $42,300 |
| Win rate             | 23%     |

## Detailed Analysis

### Category 1

[Detailed breakdown with tables, lists, etc.]

### Category 2

[More detail...]

## Methodology

Data sources: HubSpot (deals, contacts), Gong (calls), Slack (mentions)
Time range: Jan 1 – Mar 31, 2026
Filters: S1+ pipeline, closed-lost only
```

### Step 6: Save the Dashboard Artifact (only when requested)

Call `update-dashboard` with a complete dashboard config when the user asks for a saved/re-runnable analysis or this turn is creating a durable report. If the requested report needs bespoke UI, create the extension first and include its id in an extension panel.

```
update-dashboard
  --dashboardId "closed-lost-q1-2026"
  --config '{"name":"Q1 2026 Closed-Lost Analysis","panels":[{"id":"findings","title":"Findings","source":"first-party","chartType":"table","width":2,"sql":"...","config":{"description":"Evidence-backed report for the requested cohort."}}]}'
```

The dashboard config must preserve compact evidence from the real data-source action results you used: row samples, aggregate metrics, match decisions, call/message IDs, short transcript/message excerpts, coded themes, sentiment labels, and explicit provider errors for any gaps. Do not include full Gong transcripts, full tool outputs, or raw provider payload dumps. If you cannot query a source, do not save guessed dashboard content; report the unavailable/error result instead.

**Critical: Write good dashboard definitions.** The dashboard description/config is what the agent uses on re-run. Be specific:

- Which actions to call with which parameters
- What filters to apply
- How to match records across sources
- What metrics to calculate
- What structure the output should have
- End with "Update dashboard with id='...'"

### Step 7: Navigate to the Result

After saving, navigate the user to see the saved dashboard:

```
navigate --view=adhoc --dashboardId=closed-lost-q1-2026
```

## Re-Running an Analysis

When a user clicks "Re-run" on a saved analysis, the agent receives:

- The original question
- The saved instructions (step-by-step)
- The analysis ID to update

Follow the instructions to gather fresh data, then call `update-dashboard` with the same `dashboardId` to update the panels/report. Existing legacy analysis deep links remain readable, but new durable results must be written to dashboards.

If the user challenges the coverage of a chat answer or saved analysis ("why
aren't you pulling more deals?", "where is the updated response?"), rerun the
source query or revise from the corrected cohort and include the updated
deliverable in the response. Do not summarize that a revision exists without
showing it or saving it.

## Actions Reference

| Action            | Purpose                                                          |
| ----------------- | ---------------------------------------------------------------- |
| `update-dashboard` | Save or update the dashboard artifact and its panels             |
| `get-sql-dashboard` | Retrieve a dashboard by ID                                      |
| `list-sql-dashboards` | List dashboard artifacts                                       |
| `navigate`        | Navigate to a dashboard: `--view=adhoc --dashboardId=<id>`       |

## Storage

Dashboard artifacts are stored in SQL and respect the normal dashboard access model. Legacy analyses remain in their existing SQL tables for compatibility and should not be used for new artifacts.

API endpoints (for UI consumption):

- `GET /api/sql-dashboards` — list dashboard artifacts
- `GET /api/sql-dashboards/{id}` — get one

## Best Practices

1. **Use descriptive IDs** — `closed-lost-q1-2026` not `analysis-1`
2. **Include methodology** — mention data sources, time ranges, and filters in the report
3. **Write self-contained instructions** — another agent (or the same agent in a new session) should be able to re-run from the instructions alone
4. **Include structured data** — pass compact `resultData` with metrics, rows, IDs, short excerpts, and coded themes so the UI can render richer views in the future
5. **Keep reports scannable** — lead with key findings, put details below
6. **Note data gaps** — if a source was unavailable or matching was imperfect, say so
7. **Suggest next steps** — end with actionable recommendations when appropriate
8. **Answer in chat — never deflect** — present tables, inline charts, and findings directly. Do not say "check the dashboard" or redirect elsewhere.

## Large Fan-Out Analyses (30+ Accounts, Deals, or Calls)

For batch analyses spanning many items, chunk the work instead of trying to
hold everything in one pass:

1. **Define the cohort** — fetch the full list of items (accounts, deals, calls)
   from the primary source (HubSpot, BigQuery, etc.).
2. **Chunk and persist** — process 5-10 items per iteration. For each chunk,
   write a short per-item findings note (key signals, gaps, theme tags) as an
   intermediate result to the dashboard definition or agent scratch.
3. **Synthesize** — after all chunks are complete, read the intermediate notes
   back in and produce the final cross-item synthesis (patterns, rankings,
   themes, recommendations).

This is the same pattern as a batch document analysis: fetch → process chunk →
write intermediate → synthesize. The chunking keeps context manageable and each
iteration independent.

## After Completing an Analysis — Record Discoveries

After completing a significant analysis, update `LEARNINGS.md` (via the
`resources` tool) or `save-memory` with newly confirmed:

- Metric definitions (how a metric is actually calculated in this dataset)
- Provider gotchas discovered during the analysis
- Schema discoveries (table names, column names, join patterns that worked)
- Identity-stitching rules confirmed across sources

```
resources(action: "read", path: "LEARNINGS.md")
resources(action: "write", path: "LEARNINGS.md", content: "<updated>")
```

Keep entries short and actionable. This is the learning flywheel — the next
analysis benefits from what this one confirmed.
