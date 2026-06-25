---
name: form-responses
description: >-
  How to view, export, and analyze form responses. Use when the user asks
  about submitted data, wants to export responses, or needs response analytics.
---

# Form Responses

## Viewing Responses

Use `list-responses` to see submissions for a specific form:

```bash
pnpm action list-responses --form <form-id> [--limit 50]
```

This shows each response with field labels and values, ordered by submission date (newest first).

For chart/table analytics, prefer `response-insights`:

```bash
# All recent accessible forms
pnpm action response-insights

# One form
pnpm action response-insights --formId <form-id> --days 30 --limit 300
```

`response-insights` returns an explicit first-party widget payload:

- `widget: "data-insights"`
- `chartSeries` for submissions by day
- `table` for recent response rows
- `summary` with total, sampled, and truncation details

Native chat renderers should use that contract for first-party tables/charts.
MCP Apps/iframe rendering is only a fallback for external hosts.

For form setup/configuration previews, use `preview-form`:

```bash
pnpm action preview-form --formId <form-id>
```

It returns a native inline summary/table with the form fields, response count,
status, visibility, and an "Open editor" action.

## Exporting Responses

Use `export-responses` to export to CSV or JSON:

```bash
# CSV export (default)
pnpm action export-responses --form <form-id> --output data/export.csv

# JSON export
pnpm action export-responses --form <form-id> --output data/export.json --format json
```

The CSV includes headers derived from field labels. Array values (multiselect) are joined with semicolons.

## Response Data Structure

Each response is stored in the `responses` SQL table:

| Column           | Type | Description                          |
| ---------------- | ---- | ------------------------------------ |
| `id`             | text | Unique response ID                   |
| `formId`         | text | Foreign key to the form              |
| `data`           | text | JSON string of field ID -> value map |
| `submittedAt`    | text | ISO timestamp                        |
| `ip`             | text | Submitter IP when available          |
| `submitterEmail` | text | Submitter email hint when known      |
| `pageUrl`        | text | Page the respondent was on, if sent  |
| `clientSurface`  | text | App surface: web, electron, or tauri |

`submitterEmail` may come from the logged-in Forms session or from trusted
feedback clients that pass the logged-in user email as submission metadata.

`pageUrl` and `clientSurface` are hidden pass-through fields: trusted embeds
(e.g. the framework FeedbackButton) forward the URL of the page the respondent
was on and the runtime shell they were in (`web`, `electron`, or `tauri`) as
submission metadata, so owners can see which screen and which app feedback came
from. Both are null for direct fills that send no context, and `clientSurface`
is allowlisted server-side (unknown values are dropped). The responses table
surfaces them as "Page" and "Source" columns when any response carries them.

The `data` JSON maps field IDs to values:

```json
{
  "name": "Alice Smith",
  "email": "alice@example.com",
  "rating": 5,
  "interests": ["design", "development"]
}
```

## Analyzing Responses

To analyze responses, the workflow is:

1. `list-forms` to find the form ID
2. `preview-form --formId <id>` when the question is about setup or fields
3. `response-insights --formId <id>` for counts, daily submissions, and table data
4. Use `list-responses --formId <id>` only when exact row-level inspection is needed
5. Report whether the answer is exact or sampled, including row counts and truncation

## Common Tasks

| User request           | What to do                                                                   |
| ---------------------- | ---------------------------------------------------------------------------- |
| "@Form setup?"         | `preview-form --formId <id>` and answer from the returned fields/settings    |
| "How many responses?"  | `response-insights --formId <id>` and report `summary.responses`             |
| "Export to CSV"        | `export-responses --form <id> --output data/export.csv`                      |
| "Submissions by day"   | `response-insights --formId <id> --days 30`                                  |
| "Summarize feedback"   | `response-insights`, then `list-responses` if more detail is needed          |
| "Average rating"       | `list-responses`, compute from rating fields and state the sampled row count |
| "Who submitted today?" | `list-responses`, filter by submittedAt                                      |

## Related Skills

- **form-building** — Understanding the form structure and field types
- **actions** — All response operations go through actions
