---
name: learn
description: >
  Extract key learnings from the current chat thread and save them to docs/learnings.md.
  Use this skill when the user types "/learn" or asks to save learnings from the conversation.
---

# Learn Skill

## When to Use

- User types `/learn` in chat
- User asks to "save this as a learning", "remember this", or "add this to learnings"
- User corrects you and you want to persist that correction for future sessions

## How It Works

1. Review the full conversation thread
2. Identify corrections, preferences, data mappings, workflow insights, and gotchas
3. Save each learning via `POST /api/learn`
4. Confirm what was saved

## API Endpoint

### `POST /api/learn`

Appends a structured entry to `docs/learnings.md`.

**Structured entry** (preferred for individual learnings):

```json
{
  "category": "User Preferences",
  "insight": "Always filter out internal team emails when showing customer-specific activity",
  "source": "User correction during customer dashboard session"
}
```

**Raw markdown** (for complex multi-line entries):

```json
{
  "rawMarkdown": "### Customer Data\n\n**Acme Corp** org ID: `abc123`. Primary contact: jane@acme.com."
}
```

### `GET /api/learn`

Returns the current contents of `docs/learnings.md` as `{ content: string }`.

## Valid Categories

Use one of the existing section headers from `docs/learnings.md`:

- `Agent Behavior Rules`
- `Customer Data`
- `User Preferences`
- `UI Patterns`
- `Dashboard Data Fetching Pattern`
- `Reusable Scripts`
- `Cross-Referencing Customers Across Services`

Use `Other` if none fit — the learning will be appended at the end of the file.

## What to Extract

When reviewing a thread, focus on:

| Signal                   | Example                                                     |
| ------------------------ | ----------------------------------------------------------- |
| **User corrections**     | "No, that metric should use `signup` not `sign_up`"         |
| **Data source mappings** | "Acme Corp org IDs are X, Y, Z"                             |
| **Query patterns**       | "Always join on `dim_hs_contacts` for customer lookups"     |
| **Preferences**          | "I prefer stacked bar charts for per-user breakdowns"       |
| **Gotchas**              | "The `data` column is JSON — use `JSON_VALUE()` to extract" |
| **Workflow insights**    | "Check Grafana before looking at code for incidents"        |

**Skip** obvious or trivial observations. Each learning should be actionable — what to do, what not to do, and why.

## Example Flow

User types `/learn`. Agent responds:

1. Scan the thread for corrections and insights
2. For each learning found, call `POST /api/learn`:
   ```
   POST /api/learn
   { "category": "Customer Data", "insight": "Acme Corp org ID is `abc123`", "source": "Thread with Steve" }
   ```
3. Summarize what was saved:
   > Saved 3 learnings to `docs/learnings.md`:
   >
   > - **Customer Data**: Acme Corp org ID is `abc123`
   > - **User Preferences**: Use dark theme for all exported charts
   > - **Agent Behavior Rules**: Always check Sentry before investigating code for error spikes

## Gotchas

- Always read `docs/learnings.md` first to avoid duplicating existing entries
- Keep insights concise — one actionable point per entry
- Use the structured format (category + insight + source) for most entries; raw markdown only for complex multi-line content
- The `source` field is optional but helpful for traceability
