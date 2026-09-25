# query-metrics API

The `query-metrics` API allows querying BigQuery analytics data via validated SQL.

## Endpoint

```
POST https://your-api-host.example.com/api/v1/query-metrics?apiKey=<publicApiKey>
```

## Authentication

**Option A: Private Key (API access)**

```
Authorization: Bearer bpk-...
```

- The private key must correspond to the `apiKey` in the query string
- Org must have the `analyticsAPI` subscription feature

**Option B: Firebase Auth (web app)**

- Authenticated via Firebase session cookie
- User must belong to the organization matching `apiKey`

**Option C: Superuser (admin access)**

- Firebase authenticated user who is in the `superusers` Firestore collection
- Bypasses `analyticsAPI` feature requirement
- Can optionally skip owner_id filtering (admin mode)

## Request

### Query Parameters

| Param        | Required | Description                           |
| ------------ | -------- | ------------------------------------- |
| `apiKey`     | Yes      | Organization public API key           |
| `useMatView` | No       | Use materialized view (`events_mv`)   |
| `compress`   | No       | Return pako-compressed results        |
| `table`      | No       | `app_events` to query analytics table |

### Body

```json
{
  "query": "SELECT COUNT(*) FROM @events WHERE TYPE = \"impression\""
}
```

Or pass `query` as a query parameter.

## Table Placeholders

| Placeholder   | Resolves To                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------- |
| `@events`     | `<project_id>.metrics.events`                                                                |
| `@app_events` | Configured application events table; defaults to `<project_id>.analytics.events_partitioned` |

## SQL Validation

The API parses and validates all SQL before execution:

1. **SELECT only** — CREATE, INSERT, UPDATE, DELETE, DROP are rejected
2. **Table restriction** — Only allowed table references are permitted
3. **Owner scoping** — `OWNER_ID = <apiKey>` is auto-injected into every SELECT WHERE clause
   - For `@app_events`: `organizationId = <apiKey>` is injected instead
   - Superusers with `skipOwnerFilter` bypass this injection
4. **Single statement** — Only one SQL statement per request
5. **Node whitelist** — Only allowed SQL AST node types/variants are permitted

## Response

```json
{
  "results": [
    [
      { "day": "2024-01-15T00:00:00Z", "count": 1234 },
      { "day": "2024-01-14T00:00:00Z", "count": 1156 }
    ]
  ],
  "status": 200
}
```

Results are in `results[0]` — an array of row objects.

## Error Responses

| Status | Meaning                               |
| ------ | ------------------------------------- |
| 400    | Invalid SQL or missing query          |
| 401    | Invalid private key                   |
| 403    | Org doesn't have analyticsAPI feature |
| 500    | BigQuery execution error              |

## Usage from Dashboard

The analytics dashboard proxies requests through its own server:

```
POST /api/query
Body: { query, apiKey, privateKey, table? }
```

The server proxy forwards to the query-metrics API endpoint with proper auth headers.
