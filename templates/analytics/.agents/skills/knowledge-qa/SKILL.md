# Knowledge Q&A — Agent Skill

## When This Activates

The user asked a question in the Knowledge Assistant. The app has already:

1. Created a session in `ask_sessions` with `status = 'generating'`
2. Run a GitHub code search and stored initial sources
3. Called `sendToAgentChat` with the question + context JSON

## Speed Requirement

**Answer in under 30 seconds.** The user is watching a loading skeleton. Make ONE tool call max (dbt or Sigma), synthesize the answer immediately, then call `store-answer`. Do not chain lookups or browse multiple sources.

## Context Format

```json
{
  "sessionId": "<uuid>",
  "sources": [...],
  "question": "...",
  "instruction": "..."
}
```

## Decision Tree

**Does the question mention "dashboard", "workbook", "chart", "visualization", or "Sigma"?**

→ **YES** — use Sigma MCP:
  1. `mcp__sigma__begin_session` (required first)
  2. `mcp__sigma__search` with the key term from the question
  3. Call `store-answer` with what you found

→ **NO** — use dbt MCP (ONE call only):

| Question type             | dbt MCP call                              |
| ------------------------- | ----------------------------------------- |
| "What is X?" / definition | Get model X description and columns       |
| "How is X tracked?"       | Find the model/metric capturing X         |
| "How fresh is X?"         | Get model X freshness/last run info       |
| "Where is X used?"        | Get downstream dependencies of model X    |

## store-answer Example

```
store-answer({
  sessionId: "abc-123",
  answer: "The `dim_contracts` model [1] has the following fields:\n- `contract_id`...",
  additionalSources: [{ type: "dbt", title: "dim_contracts", excerpt: "..." }]
})
```

For Sigma sources use `type: "other"` and set `title` to the workbook/dataset name.

## Rules

- **Always call `store-answer`** — the UI shows a skeleton until you do
- **One external tool call only** — dbt OR Sigma, not both
- **Call `store-answer` even on error** — use `status: "error"` and explain what failed in the `answer` field
- Cite GitHub sources as `[1]`, `[2]` (1-indexed from the `sources` array in context); dbt/Sigma sources get the next numbers
- Keep answers focused: 2–4 paragraphs max
