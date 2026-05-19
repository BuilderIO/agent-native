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
  "sources": [
    {
      "type": "github",
      "title": "path/to/file.sql",
      "repo": "org/repo",
      "url": "...",
      "excerpt": "..."
    }
  ],
  "instruction": "..."
}
```

## Your Steps

1. **Parse the context** — extract `sessionId` and `sources`
2. **Run ONE focused dbt MCP lookup** for the model/metric in the question
3. **Synthesize a markdown answer** with `[1][2]` citations referencing the sources list
4. **Call `store-answer`** with the answer and any `additionalSources` from dbt

## dbt MCP — One Targeted Call

| Question type              | dbt MCP call                                    |
| -------------------------- | ----------------------------------------------- |
| "What is X?" / definition  | Get model X description and columns             |
| "How is X tracked?"        | Find the model/metric capturing X               |
| "How fresh is X?"          | Get model X freshness/last run info             |
| "Where is X used?"         | Get downstream dependencies of model X          |

## store-answer Example

```
store-answer({
  sessionId: "abc-123",
  answer: "The `dim_contracts` model [1] has a `contract_type` field...",
  additionalSources: [{ type: "dbt", title: "dim_contracts", excerpt: "..." }]
})
```

## Important

- **Always call `store-answer`** — the UI shows a skeleton until you do
- If you encounter an error, still call `store-answer` with `status: "error"` and explain what happened in the answer field
- Keep the answer focused and factual — cite GitHub sources as `[1]`, `[2]` etc. (1-indexed from the sources array), and dbt sources as additional numbered entries
- One dbt MCP call only — don't over-query
