---
name: grafana
description: >
  Query Grafana dashboards and Prometheus metrics for service health, LLM latency, and infrastructure monitoring.
  Use this skill when the user asks about service health, monitoring, alerts, or performance metrics.
---

# Grafana Integration

## Connection

- **Base URL**: `https://builderio.grafana.net`
- **Auth**: `Authorization: Bearer $GRAFANA_API_TOKEN` (service account token)
- **Env vars**: `GRAFANA_API_TOKEN`
- **Caching**: 10-minute cache for metadata; query results are NOT cached (time-sensitive)
- **Key datasource**: Prometheus UID `grafanacloud-prom`

## Server Lib & API Routes

- **File**: `server/lib/grafana.ts`

### Exported Functions

| Function                                      | Description                             |
| --------------------------------------------- | --------------------------------------- |
| `listDashboards(query?)`                      | Search dashboards by query              |
| `getDashboard(uid)`                           | Full dashboard JSON with panels         |
| `getDatasources()`                            | List all datasources                    |
| `getAlertRules()`                             | All alert rules (flattened from groups) |
| `getAlertInstances()`                         | Currently firing alert instances        |
| `queryDatasource(uid, queries[], from?, to?)` | Proxy to Grafana's `/api/ds/query`      |

### API Routes

| Route                                | Description                               |
| ------------------------------------ | ----------------------------------------- |
| `GET /api/grafana/dashboards`        | Search dashboards                         |
| `GET /api/grafana/dashboard?uid=...` | Full dashboard JSON                       |
| `GET /api/grafana/datasources`       | List datasources                          |
| `GET /api/grafana/alerts`            | Alert rules and firing instances          |
| `POST /api/grafana/query`            | Query datasource (Prometheus, Loki, etc.) |

### Dashboard

- `/adhoc/engineering` — Engineering dashboard (mirrors a Grafana dashboard by UID)

## Grafana Response Frame Format

```
{ results: { [refId]: { frames: [{ schema: { fields }, data: { values } }] } } }
```

- `values[0]` = timestamps (epoch ms), `values[1+]` = metric values
- Series labels from `schema.fields[i].labels` (e.g. `{ model: "claude-3.5" }`)
- Transform to Recharts: `{ time: number, [seriesName]: number }[]`

## Template Variables

- `$CodegenMode` → default `quality-v4`
- `$AIModel` → regex pattern, default `.*` (all)
- `$environment` → `cloud` or `cloud-v2`, default `cloud`
- Variables interpolated via string replace before querying

## Key Prometheus Metrics

- **Codegen**: `vcpcodegen_completion_total`, `vcpcodegen_completion_latency_bucket`, `vcpcodegen_feedback_total`, `vcpcodegen_error_total`
- **LLM**: `llm_completion_cost_total`, `llm_input_tokens_total`, `llm_output_tokens_total`, `llm_latency_bucket`, `llm_failures_total`, `llm_completions_total`
- **Projects**: `projects_proposed_config_total`, `projects_status_total`, `projects_remote_machine_*`, `projects_start_duration_bucket`
- **API/Runtime**: `api_request_total`, `with_span_duration_bucket`, `memory_heap_usage_percent_bucket`
- **Fly.io**: `fly_endpoint_total`, `fly_machine_*`
- **GitHub**: `builderbot_pr_created_total`, `builderbot_pr_closed_total`

## Key Patterns & Gotchas

- `queryDatasource` constructs body with datasource UID in each query target; timestamps as string ms
- `getAlertRules` flattens nested rule groups from unified alerting API
- `getAlertInstances` handles both array and wrapped object response shapes
- POST helper caches by default (fine for idempotent endpoints) but `queryDatasource` skips cache
- Heatmap panels render as multi-series line/area (Recharts has no native heatmap; PromQL `histogram_quantile()` computes quantiles)

## Incident Investigation Pattern

For production issues, query Grafana/Prometheus FIRST:

1. LLM latency by model (`llm_latency_bucket`)
2. Request rates (`api_request_total`)
3. Error rates (`llm_failures_total`)
4. Instance counts (via Cloud Monitoring)

Then check Sentry for application errors, Cloud Logging for raw logs.
