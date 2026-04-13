---
name: adhoc-analysis
description: >-
  How to conduct ad-hoc analyses: gather data from multiple sources, synthesize
  findings, save reusable analysis artifacts that anyone can re-run for fresh results.
---

# Ad-Hoc Analysis

Ad-hoc analyses are deep-dive investigations that cross-reference multiple data sources, produce a written report with findings, and save a reusable artifact so anyone on the team can re-run the analysis with up-to-date data at any time.

## When to Use

Use the ad-hoc analysis workflow when:

- The user asks a complex question that requires data from multiple sources
- The investigation involves cross-referencing (e.g., CRM deals matched against call recordings)
- The results are worth saving for future reference or periodic refresh
- The user explicitly asks for an "analysis" or "deep dive"

For simple one-off questions (e.g., "how many signups last week?"), just query the data and answer in chat — no need to save an analysis.

## Workflow

### Step 1: Understand the Question

Clarify the scope before gathering data:
- What is being analyzed? (deals, users, campaigns, errors, etc.)
- What time range?
- What data sources are relevant?
- What output does the user expect? (summary, ranking, comparison, trend)

### Step 2: Gather Data from Multiple Sources

Use the available actions to pull data. Read the relevant `.builder/skills/<provider>/SKILL.md` before querying each source.

**Common data source combinations:**

| Analysis type | Data sources |
|---|---|
| Sales pipeline analysis | HubSpot deals + Gong calls + Slack mentions |
| Customer health check | HubSpot deals + Pylon support tickets + BigQuery usage events |
| Content performance | BigQuery pageviews + GA4 + SEO keywords + HubSpot signups |
| Engineering velocity | GitHub PRs + Jira tickets + BigQuery deploy events |
| Churn investigation | Stripe billing + HubSpot deals + Pylon tickets + BigQuery usage |

**Tips for data gathering:**
- Start with the primary source (e.g., HubSpot for deals), then enrich with secondary sources
- Use `--grep` and `--fields` to narrow results before cross-referencing
- Match records across sources by email, company name, or domain
- When matching is fuzzy (e.g., company names), note the match quality in findings
- If a data source is not configured, mention what's missing and work with what's available

### Step 3: Analyze and Synthesize

Don't just dump raw data. Synthesize findings:
- Identify patterns, trends, and outliers
- Calculate key metrics (totals, averages, rates, distributions)
- Rank or categorize items when useful
- Call out surprises or actionable insights
- Compare against benchmarks or prior periods when possible

### Step 4: Format Results as Markdown

Structure the report clearly:

```markdown
## Key Findings

- **Finding 1**: Specific insight with supporting numbers
- **Finding 2**: Another insight
- **Finding 3**: Actionable recommendation

## Summary Metrics

| Metric | Value |
|---|---|
| Total deals analyzed | 54 |
| Average deal size | $42,300 |
| Win rate | 23% |

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

### Step 5: Save the Analysis

Call `save-analysis` with all required fields:

```
save-analysis
  --id "closed-lost-q1-2026"
  --name "Q1 2026 Closed-Lost Analysis"
  --description "Deep dive into 54 Fusion deals closed-lost in Q1, cross-referenced with Gong calls and Slack activity"
  --question "Why are we losing deals in Q1? Cross-reference with Gong calls and Slack."
  --dataSources '["hubspot", "gong", "slack"]'
  --instructions "1. Fetch closed-lost S1+ deals from HubSpot (pipeline: Fusion, close date: Q1 2026)
2. For each deal, fetch associated contacts and their emails
3. Search Gong calls matching those contact emails (lookback: 6 months before close date)
4. For top 15 deals by amount, search Slack for '{company name} fusion'
5. Calculate: total deals, avg deal size, win rate, Gong coverage rate
6. Break down by: lost reason, stage reached, deal size tier
7. Highlight deals with no Gong coverage (blind spots)
8. Save results with save-analysis using id='closed-lost-q1-2026'"
  --resultMarkdown "[the full markdown report]"
  --resultData '{"deals": [...], "metrics": {...}}'
```

**Critical: Write good instructions.** The `instructions` field is what gets sent to the agent on re-run. Be specific:
- Which actions to call with which parameters
- What filters to apply
- How to match records across sources
- What metrics to calculate
- What structure the output should have
- End with "Save results with save-analysis using id='...'"

### Step 6: Navigate to the Result

After saving, navigate the user to see the saved analysis:

```
navigate --view=analyses --analysisId=closed-lost-q1-2026
```

## Re-Running an Analysis

When a user clicks "Re-run" on a saved analysis, the agent receives:
- The original question
- The saved instructions (step-by-step)
- The analysis ID to update

Follow the instructions to gather fresh data, then call `save-analysis` with the same `id` to update the results. The `createdAt` timestamp is preserved; `updatedAt` is refreshed.

## Actions Reference

| Action | Purpose |
|---|---|
| `save-analysis` | Save or update an analysis (id, name, instructions, results) |
| `get-analysis` | Retrieve a saved analysis by ID |
| `list-analyses` | List all saved analyses (id, name, description, timestamps) |
| `delete-analysis` | Delete a saved analysis |
| `navigate` | Navigate to analyses view: `--view=analyses [--analysisId=<id>]` |

## Storage

Analyses are stored in the SQL settings table with key prefix `adhoc-analysis-{id}`. They respect org/user scoping — org-scoped analyses are visible to all org members.

API endpoints (for UI consumption):
- `GET /api/analyses` — list all
- `GET /api/analyses/{id}` — get one
- `DELETE /api/analyses/{id}` — delete one

## Best Practices

1. **Use descriptive IDs** — `closed-lost-q1-2026` not `analysis-1`
2. **Include methodology** — mention data sources, time ranges, and filters in the report
3. **Write self-contained instructions** — another agent (or the same agent in a new session) should be able to re-run from the instructions alone
4. **Include structured data** — pass `resultData` with raw metrics/rows so the UI can render richer views in the future
5. **Keep reports scannable** — lead with key findings, put details below
6. **Note data gaps** — if a source was unavailable or matching was imperfect, say so
7. **Suggest next steps** — end with actionable recommendations when appropriate
