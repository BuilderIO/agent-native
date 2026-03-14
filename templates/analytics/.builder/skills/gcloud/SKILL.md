---
name: gcloud
description: >
  Monitor Google Cloud Run services and Cloud Functions health, metrics, and logs.
  Use this skill when the user asks about service health, request counts, latencies, or cloud infrastructure.
---

# Google Cloud Integration

## Connection

- **Project**: `builder-3b0a2` (hard-coded)
- **Service account**: `fusion-analytics@builder-3b0a2.iam.gserviceaccount.com`
- **Auth**: `GOOGLE_APPLICATION_CREDENTIALS_JSON` env var (JSON credentials string) — no ADC fallback
- **IAM roles**: `monitoring.viewer`, `run.viewer`, `cloudfunctions.viewer`, `logging.viewer`
- **Caching**: 5-minute in-memory cache, max 120 entries

## Server Lib & API Routes

- **File**: `server/lib/gcloud.ts`

### Exported Functions

| Function                                                                    | Description                        |
| --------------------------------------------------------------------------- | ---------------------------------- |
| `listCloudRunServices()`                                                    | List all Cloud Run services        |
| `listCloudFunctions()`                                                      | List all Cloud Functions           |
| `queryMetrics(filter, period, aligner?, reducer?, groupBy?)`                | Query Cloud Monitoring time series |
| `getServiceMetrics(serviceType, serviceName, metric, period, extraFilter?)` | Convenience metric query           |
| `listLogEntries(filter, pageSize?)`                                         | Read Cloud Logging entries         |

### API Routes

| Route                      | Description             |
| -------------------------- | ----------------------- |
| `GET /api/gcloud/services` | List Cloud Run services |
| `GET /api/gcloud/metrics`  | Query metrics           |
| `GET /api/gcloud/logs`     | Read log entries        |

### Dashboard

- `/adhoc/gcloud` — Google Cloud Health dashboard

## Google Cloud APIs Used

- Cloud Run Admin API v2: `/v2/projects/{project}/locations/-/services`
- Cloud Functions API v2: `/v2/projects/{project}/locations/-/functions`
- Cloud Monitoring API v3: `/v3/projects/{project}/timeSeries`
- Cloud Logging API v2: `/v2/entries:list`

## Key Metrics

- **Cloud Run**: `run.googleapis.com/request_count`, `request_latencies`, `container/instance_count`, `container/cpu/utilization`
- **Cloud Functions**: `cloudfunctions.googleapis.com/function/execution_count`, `execution_times`, `active_instances`

## Key Patterns & Gotchas

- **Scale**: 78 Cloud Run services, 237+ Cloud Functions — UI uses searchable dropdown
- **Alignment periods**: 1h→60s, 6h→300s, 24h→600s, 7d→3600s
- `getServiceMetrics` auto-selects aligner/reducer based on metric name (latency→percentile, request_count→ALIGN_DELTA, memory→ALIGN_MEAN)
- `queryMetrics` maps point values from `doubleValue`, `int64Value`, or distribution mean
- `listLogEntries` uses POST payload; returns entries reversed
- PROJECT_ID is hard-coded — different projects require code changes
