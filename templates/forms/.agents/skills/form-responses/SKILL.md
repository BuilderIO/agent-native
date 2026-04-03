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
pnpm script list-responses --form <form-id> [--limit 50]
```

This shows each response with field labels and values, ordered by submission date (newest first).

## Exporting Responses

Use `export-responses` to export to CSV or JSON:

```bash
# CSV export (default)
pnpm script export-responses --form <form-id> --output data/export.csv

# JSON export
pnpm script export-responses --form <form-id> --output data/export.json --format json
```

The CSV includes headers derived from field labels. Array values (multiselect) are joined with semicolons.

## Response Data Structure

Each response is stored in the `responses` SQL table:

| Column       | Type   | Description                          |
| ------------ | ------ | ------------------------------------ |
| `id`         | text   | Unique response ID                   |
| `formId`     | text   | Foreign key to the form              |
| `data`       | text   | JSON string of field ID -> value map |
| `submittedAt`| text   | ISO timestamp                        |

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
2. `list-responses --form <id>` to get the data
3. Analyze patterns, calculate statistics, identify trends
4. Report findings to the user

For advanced queries, use the core `db-query` script:

```bash
pnpm script db-query --sql "SELECT data FROM responses WHERE formId = '<id>'"
```

## Common Tasks

| User request             | What to do                                    |
| ------------------------ | --------------------------------------------- |
| "How many responses?"    | `list-responses --form <id> --limit 1` (shows total count) |
| "Export to CSV"          | `export-responses --form <id> --output data/export.csv` |
| "Summarize feedback"     | `list-responses`, then analyze the data       |
| "Average rating"         | `list-responses`, compute from rating fields  |
| "Who submitted today?"   | `list-responses`, filter by submittedAt       |

## Related Skills

- **form-building** — Understanding the form structure and field types
- **scripts** — All response operations go through scripts
