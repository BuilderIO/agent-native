---
name: prometheus
description: >-
  Query Prometheus-compatible metrics endpoints (self-hosted, Grafana Cloud Prom, AMP, etc.)
  via the prometheus action and as a dashboard panel source.
---

# Prometheus

Direct integration with the Prometheus HTTP API. Works against any Prometheus-compatible endpoint: self-hosted Prometheus, Grafana Cloud, Amazon Managed Prometheus, Thanos, Cortex, Mimir.

## Credentials

| Env Var                   | Required | Notes                                                                                       |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `PROMETHEUS_URL`          | yes      | Base URL, no trailing slash, e.g. `https://prometheus.example.com`.                         |
| `PROMETHEUS_USERNAME`     | no       | Basic auth username. Grafana Cloud uses the stack instance ID here.                         |
| `PROMETHEUS_PASSWORD`     | no       | Basic auth password / API token. Must be paired with `PROMETHEUS_USERNAME`.                 |
| `PROMETHEUS_BEARER_TOKEN` | no       | Bearer token. Used only when no full `USERNAME` + `PASSWORD` pair is set.                   |

Auth selection is deterministic: full basic-auth pair wins → bearer token → no `Authorization` header. Partial basic (username XOR password) is treated as no basic.

## Agent usage — `pnpm action prometheus`

| Mode           | Args                                                                       | Purpose                                    |
| -------------- | -------------------------------------------------------------------------- | ------------------------------------------ |
| `query`        | `--query <promql> [--time <RFC3339>]`                                       | Instant query (default).                   |
| `query_range`  | `--query <promql> --start <RFC3339> --end <RFC3339> [--step 30s]`           | Range query for time series.               |
| `labels`       |                                                                            | List all label names.                      |
| `label_values` | `--label <name>`                                                            | Values for one label (good for discovery). |
| `series`       | `--match '["up{job=\"api\"}"]'`                                             | Series matching one or more matchers.      |
| `metadata`     | `[--metric <name>]`                                                         | Metric metadata (type, help text, unit).   |
| `alerts`       |                                                                            | Currently firing alerts.                   |

Step is auto-calculated when omitted (~250 points across the range, clamped to a 15s minimum). When the user asks "what metrics are available", start with `labels`, then `label_values --label=__name__`.

## Dashboard panels

Prometheus is a valid panel `source`. The `sql` field is still a string in the
dashboard config; put the serialized JSON descriptor in that string, not a
parsed object.

```json
"{\"promql\":\"rate(http_requests_total{job=\\\"api\\\"}[5m])\",\"mode\":\"range\",\"range\":\"1h\",\"step\":\"30s\"}"
```

Defaults: `mode=range`, `range=1h`, `step=auto`. Use `mode=instant` only for `metric` / `callout` chart types.

The dispatcher returns one row per (timestamp, series) with shape `{timestamp, series, value}`. Set panel `config` so charts render correctly:

```json
{
  "xKey": "timestamp",
  "yKey": "value"
}
```

When a query fans out into many series, the `series` column will hold a `metric_name{k1="v1",k2="v2"}` label per row — that's the natural grouping for a line chart with multiple series.

## Node Exporter dashboard

A pre-built Node Exporter dashboard is bundled at `seeds/dashboards/node-exporter.json`. It **auto-creates** the first time `PROMETHEUS_URL` is saved — users see it in the sidebar immediately after finishing the Prometheus walkthrough, no prompting needed.

The dashboard has 11 panels on a 3-column grid with a time-range filter (15 min / 1 h / 6 h / 24 h):

| Panel | PromQL |
| ----- | ------ |
| CPU Usage % | `100 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100` |
| Memory Used % | `(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100` |
| Load Average (1m) | `node_load1` |
| CPU Usage % Over Time | same as above, range query |
| Memory Used (GB) | `(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / 1073741824` |
| Load Average Trend | `node_load1` range query |
| Disk Read (MB/s) | `sum(rate(node_disk_read_bytes_total[5m])) / 1048576` |
| Disk Write (MB/s) | `sum(rate(node_disk_written_bytes_total[5m])) / 1048576` |
| Uptime | `(time() - node_boot_time_seconds) / 86400` |
| Network Receive (MB/s) | `sum(rate(node_network_receive_bytes_total[5m])) / 1048576` |
| Network Transmit (MB/s) | `sum(rate(node_network_transmit_bytes_total[5m])) / 1048576` |

### Local setup via Homebrew (macOS)

```bash
brew install node_exporter prometheus
brew services start node_exporter   # metrics at http://localhost:9100/metrics
```

Edit `/opt/homebrew/etc/prometheus.yml`:

```yaml
global:
  scrape_interval: 1s

scrape_configs:
  - job_name: node
    static_configs:
      - targets: ['localhost:9100']
```

```bash
brew services restart prometheus    # Prometheus UI at http://localhost:9090
```

Paste `http://localhost:9090` as the Prometheus URL in Data Sources → the Node Exporter dashboard will appear automatically.

## Gotchas

- **Range queries return matrices**; instant queries return vectors. Both flatten to `{timestamp, series, value}` rows so charts work uniformly.
- **No query-result caching.** Metadata endpoints (`labels`, `label_values`, `metadata`) are cached for 10 minutes; `query` / `query_range` are never cached because they're time-sensitive.
- **Cardinality matters.** A wide-fanout PromQL produces many series and a busy chart. Reduce cardinality with explicit label matchers or aggregation (e.g. `sum by (job)(rate(...))`) before saving the panel.
- **HTTP 200 with `status: "error"`** is treated as a failure. The error message from the Prometheus response is surfaced verbatim.
- **No `db-query` for this.** Prometheus is its own backend. Do not try to read app DB tables to answer Prometheus questions.
