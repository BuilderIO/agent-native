# Sigma Computing Skill

## Overview

Sigma Computing is a cloud analytics platform with a spreadsheet-like UI for exploring warehouse data. This skill covers the Sigma MCP integration (`mcp__sigma__*` tools) that lets the agent browse workbooks, data models, lineage, elements, and export data — without writing any SQL directly against the warehouse.

**When to use Sigma MCP tools:**
- User asks about a specific Sigma workbook, report, or dashboard
- You need to find out which tables/columns back a Sigma chart before writing a BigQuery query
- You want to pull live data from a workbook element directly
- You need to understand data lineage from a workbook element back to its warehouse source

---

## Setup

### Credentials

| Env Var | Where to find |
|---|---|
| `SIGMA_CLIENT_ID` | Sigma Admin → Administration > APIs & Embed Secrets → Create New |
| `SIGMA_CLIENT_SECRET` | Same credential creation dialog (only shown once — save it immediately) |
| `SIGMA_API_BASE_URL` | Sigma Admin → Administration > Developer Access → API Base URL |

Common base URLs by cloud region:
- AWS US: `https://aws-api.sigmacomputing.com`
- AWS EU: `https://eu-api.sigmacomputing.com`
- GCP US: `https://gcp-api.sigmacomputing.com`

The MCP server is configured in `mcp.config.json` under the `sigma` key. After setting env vars, restart the analytics server and verify the connection:

```
GET /_agent-native/mcp/status  →  look for "sigma" in connectedServers
```

---

## Available MCP Tools

All tools are prefixed `mcp__sigma__`. Use these exact names when calling them.

### Workbook Discovery

| Tool | When to use |
|---|---|
| `mcp__sigma__get_workbooks` | List all workbooks in the org, or get a single workbook's full details by passing `workbook_id`. |
| `mcp__sigma__get_workbook_elements` | Get all elements (tables, charts, pivot tables, controls, text) in a workbook. Omit `element_id` to list all. |
| `mcp__sigma__get_workbook_lineage` | Get the full dependency graph for a workbook — shows connections, databases, schemas, tables it reads from. |
| `mcp__sigma__get_element_sql` | Get the compiled SQL that Sigma generates for a specific table, chart, or pivot element. **Invaluable for knowing what BigQuery SQL backs a chart.** |

### Data Models

| Tool | When to use |
|---|---|
| `mcp__sigma__get_data_models` | List all data models or get a single model's details by `data_model_id`. |
| `mcp__sigma__get_data_model_columns` | Get all columns across all elements in a data model (names, types, which element they belong to). |
| `mcp__sigma__get_data_connections` | List all data connections in the org (BigQuery, Snowflake, etc.). |

### Reports & Exports

| Tool | When to use |
|---|---|
| `mcp__sigma__get_reports` | List all scheduled reports, or get a single report's details. |
| `mcp__sigma__export_workbook` | Export workbook data as CSV, JSON, XLSX, PDF, or PNG. Returns a `queryId`. |
| `mcp__sigma__download_export` | Download the exported file using the `queryId` from `export_workbook`. |

### Administration

| Tool | When to use |
|---|---|
| `mcp__sigma__get_teams` | List teams or get a single team's members and user attributes. |
| `mcp__sigma__get_permission_grants` | List permission grants in the org. |

---

## Workflow: Finding the BigQuery Tables Behind a Sigma Chart

When a user mentions a Sigma workbook/chart and wants a dashboard panel that mirrors it:

```
1. mcp__sigma__get_workbooks         → find the workbook by name
2. mcp__sigma__get_workbook_elements → list elements; identify the chart/table
3. mcp__sigma__get_element_sql       → get the exact BigQuery SQL Sigma runs
4. Use that SQL (or adapt it) as the panel SQL in the analytics dashboard
5. Optionally: mcp__sigma__get_workbook_lineage → verify which tables are read
```

This is the most reliable way to match a Sigma chart exactly — use Sigma's own compiled SQL rather than guessing column names.

---

## Workflow: Browsing Data Models

When a user asks "what data is available in Sigma?" or wants to understand what's modeled:

```
1. mcp__sigma__get_data_connections   → see what warehouses are connected
2. mcp__sigma__get_data_models        → list data models
3. mcp__sigma__get_data_model_columns → get columns for a specific model
4. Use column names from step 3 in BigQuery SQL (the names match the warehouse)
```

---

## Common Gotchas

- **`export_workbook` is async** — it returns a `queryId`, not immediate data. Always call `download_export` with the `queryId` afterwards (poll if needed; the export may take a few seconds).
- **`get_element_sql` requires both `workbook_id` and `element_id`** — get the element list first with `get_workbook_elements`.
- **Column names in data model columns match the warehouse** — they're the same names you'd use in BigQuery SQL, so this is a reliable way to discover real column names without querying `INFORMATION_SCHEMA`.
- **Workbook lineage shows schemas and tables but not individual columns** — use `get_element_sql` for column-level detail.
- **Permissions**: The API credential must have admin access. Read-only credentials may not be able to list all workbooks in the org.

---

## Example: Pulling Data from a Sigma Workbook Element

```
1. mcp__sigma__get_workbooks → find "Revenue Dashboard" → workbook_id = "abc123"
2. mcp__sigma__get_workbook_elements workbook_id=abc123 → find "MRR Chart" → element_id = "elem456"
3. mcp__sigma__get_element_sql workbook_id=abc123 element_id=elem456
   → returns: SELECT DATE_TRUNC(date, MONTH) as month, SUM(arr) as mrr ...
4. Use that SQL directly in a BigQuery panel
```

---

## When to Update This Skill

Update this skill when you:
- Discover a new tool or flag in the Sigma MCP server
- Find a gotcha with auth, pagination, or export timing
- Learn which workbooks/data models are most important to this org
