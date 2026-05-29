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

**Follow-up: GitHub sources** — already in context as `sources[]`, cite them as `[1][2]`

---

### 3. Data freshness / pipeline / dependency questions
> "How fresh is dim_accounts?", "Where does MRR come from?", "What depends on fct_revenue?"

**Primary: dbt MCP**
1. Get model freshness / last run info
2. Get upstream or downstream dependencies

---

### 4. Broad / exploratory questions
> "What tables track churn?", "How is expansion revenue defined?"

**Primary: dbt MCP** to search for relevant models, then GitHub sources already in context.
**If results are sparse:** also search Sigma for related workbooks.

---

## Hard Constraints — READ FIRST

**DO NOT build, create, or modify any dashboards, analyses, SQL panels, or other resources.**
The Knowledge tab is read-only. Your only job is to research and answer the question.
If the user asks you to build something, explain what would be needed but do NOT create it.
All writes (dashboards, queries, panels) must be initiated from the main chat, not from the Knowledge tab.

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
