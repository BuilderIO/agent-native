# Knowledge Q&A — Agent Skill

## When This Activates

The user asked a question in the Knowledge Assistant. The app has already:

1. Created a session in `ask_sessions` with `status = 'generating'`
2. Run a GitHub code search and stored initial sources
3. Called `sendToAgentChat` with the question + context JSON

## Context Format

```json
{
  "sessionId": "<uuid>",
  "question": "...",
  "sources": [...],
  "instruction": "..."
}
```

## Tool Priority by Question Type

> **Universal rule: Always check Sigma MCP as a secondary source for every question.**
> Business data often exists in Sigma workbooks (dashboards, sheets) that is not in dbt models. A customer list, a contract field, an opt-in flag — these may live in a Sigma sheet long before they appear in a dbt model. Always run a Sigma search after your primary source, and surface relevant workbooks/sheets even if the question doesn't mention "dashboard".

### 1. Dashboard / workbook / chart / visualization questions

> "What does the Revenue Dashboard show?", "Where is ARR tracked in Sigma?", "Which dashboards use fct_orders?"

**Primary: Sigma MCP**

1. `mcp__sigma__begin_session` — always required first
2. `mcp__sigma__search` — find relevant workbooks/datasets by keyword
3. `mcp__sigma__describe` — inspect schema if you need column details
4. `mcp__sigma__query` — run SQL against a Sigma data source if needed

**Follow-up: dbt MCP** — if the answer requires understanding the underlying dbt model feeding the dashboard.

---

### 2. Model / metric / column definition questions

> "What fields does dim_contracts have?", "How is ARR calculated?", "What does fct_subscriptions contain?"

**Primary: dbt MCP**

1. Get model description and columns for the named model
2. Check metric definitions if it's a business metric

**Secondary: Sigma MCP** — search for workbooks that surface this metric or model's data. A Sigma sheet may expose fields, filters, or business context that dbt alone doesn't capture. Include any relevant Sigma workbooks in your answer.

---

### 3. Data freshness / pipeline / dependency questions

> "How fresh is dim_accounts?", "Where does MRR come from?", "What depends on fct_revenue?"

**Primary: dbt MCP**

1. Get model freshness / last run info
2. Get upstream or downstream dependencies

**Secondary: Sigma MCP** — search for workbooks that depend on or visualize this model.

---

### 4. Broad / exploratory questions

> "What tables track churn?", "Is there a way to see which customers opted in to case studies?", "How is expansion revenue defined?"

**Primary: dbt MCP** to search for relevant models, then GitHub sources already in context.
**Secondary: Sigma MCP** — search with the key business terms from the question (e.g. "case study", "opt-in", "contract", "churn"). Sigma workbooks often surface business data that has no corresponding dbt model yet. Cite any relevant workbooks/sheets you find.

---

## Dashboard Sources — Critical Distinction

There are two completely different sets of dashboards:

- **App dashboards** — SQL panel dashboards built inside this analytics app (listed in the sidebar, stored in the app's own database). These are NOT the dashboards the user is asking about when they ask "is there a dashboard for X?".
- **Sigma workbooks** — the actual BI/analytics dashboards in the organization's Sigma Computing instance (e.g. "Enterprise Contract Terms and Details", "Revenue Dashboard"). **These are the dashboards users refer to when asking about business dashboards.**

**Never use `list-dashboards`, the app's SQL dashboard list, or any internal app action to answer "is there a dashboard for X?" questions.** Always use Sigma MCP to search for business dashboards. The app's own dashboards are a development artifact; Sigma is the business BI source of truth.

---

## Hard Constraints — READ FIRST

**DO NOT build, create, or modify any dashboards, analyses, SQL panels, or other resources.**
The Knowledge tab is read-only. Your only job is to research and answer the question.
If the user asks you to build something, explain what would be needed but do NOT create it.
All writes (dashboards, queries, panels) must be initiated from the main chat, not from the Knowledge tab.

**If the user asks for live data, trends, comparisons, or analysis** (e.g. "show me ARR over time", "why did signups drop?", "compare segments"), do not attempt to query live sources here. Instead respond: "For live data analysis, use the main chat — Knowledge is for understanding what exists in the data model." Then call `store-answer` with that message as the answer.

---

## Synthesizing the Answer

- Write a clear markdown answer — use headers, bullets, and code blocks where helpful
- Cite sources inline: `[1]`, `[2]` etc. (GitHub sources are 1-indexed from the `sources` array in context; dbt/Sigma sources get the next numbers)
- Be factual and specific — name actual table/column names, not generalities

## Calling store-answer

Always call `store-answer` when done:

```
store-answer({
  sessionId: "<id from context>",
  answer: "<your markdown answer>",
  additionalSources: [
    { type: "dbt", title: "dim_contracts", excerpt: "contract_type, arr_amount..." },
    { type: "other", title: "Revenue Dashboard (Sigma)", url: "...", excerpt: "..." }
  ]
})
```

**Never create dashboards or run write operations from Knowledge sessions.**

**Call `store-answer` even on error** — use `status: "error"` and explain what failed in the `answer` field. The UI shows a skeleton until you call it.
