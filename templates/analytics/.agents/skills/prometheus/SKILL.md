---
name: prometheus
description: >-
  Query Prometheus-compatible metrics endpoints (self-hosted, Grafana Cloud Prom, AMP, etc.)
  via the prometheus action and as a dashboard panel source.
---

# Prometheus

Direct integration with the Prometheus HTTP API. Works against any Prometheus-compatible endpoint: self-hosted Prometheus, Grafana Cloud, Amazon Managed Prometheus, Thanos, Cortex, Mimir.

## Credentials

| Env Var                   | Required | Notes                                                                       |
| ------------------------- | -------- | --------------------------------------------------------------------------- |
| `PROMETHEUS_URL`          | yes      | Base URL, no trailing slash, e.g. `https://prometheus.example.com`.         |
| `PROMETHEUS_USERNAME`     | no       | Basic auth username. Grafana Cloud uses the stack instance ID here.         |
| `PROMETHEUS_PASSWORD`     | no       | Basic auth password / API token. Must be paired with `PROMETHEUS_USERNAME`. |
| `PROMETHEUS_BEARER_TOKEN` | no       | Bearer token. Used only when no full `USERNAME` + `PASSWORD` pair is set.   |

Auth selection is deterministic: full basic-auth pair wins → bearer token → no `Authorization` header. Partial basic (username XOR password) is treated as no basic.

## Agent usage — `pnpm action prometheus`

| Mode           | Args                                                              | Purpose                                    |
| -------------- | ----------------------------------------------------------------- | ------------------------------------------ |
| `query`        | `--query <promql> [--time <RFC3339>]`                             | Instant query (default).                   |
| `query_range`  | `--query <promql> --start <RFC3339> --end <RFC3339> [--step 30s]` | Range query for time series.               |
| `labels`       |                                                                   | List all label names.                      |
| `label_values` | `--label <name>`                                                  | Values for one label (good for discovery). |
| `series`       | `--match '["up{job=\"api\"}"]'`                                   | Series matching one or more matchers.      |
| `metadata`     | `[--metric <name>]`                                               | Metric metadata (type, help text, unit).   |
| `alerts`       |                                                                   | Currently firing alerts.                   |

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

## Node Exporter dashboards

Node Exporter dashboards are installed from the dashboard catalog:

```bash
pnpm action list-dashboard-templates
pnpm action install-dashboard-template --templateId=node-exporter-macos
pnpm action install-dashboard-template --templateId=node-exporter-full
```

`node-exporter-macos` is the comprehensive Darwin/Homebrew dashboard for macOS scrapes; it covers CPU, load, macOS memory fields, swap, APFS filesystems, disk IO, network devices, battery/power, scrape health, exporter process stats, Go runtime stats, and a metric-family coverage table. `node-exporter-full` is converted from Grafana dashboard 1860 revision 45 and lives at `seeds/dashboards/node-exporter-full.json`; it contains 124 Prometheus query panels, 16 section dividers, and native tabs for Overview, CPU & Memory, System, Storage, Network, and Exporter. The Full dashboard is Linux-focused because Grafana 1860 expects Linux collectors such as `node_memory_MemAvailable_bytes`, pressure stall information, `node_sockstat_*`, `node_netstat_*`, `node_timex_*`, `node_systemd_*`, and `node_hwmon_*`; Homebrew/macOS node_exporter omits many of those, so empty panels on macOS are expected. The templates use `job`, `instance`, and `range` filters; set `instance` to the Prometheus `instance` label from `node_uname_info`.

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
      - targets: ["localhost:9100"]
```

```bash
brew services restart prometheus    # Prometheus UI at http://localhost:9090
```

Paste `http://localhost:9090` as the Prometheus URL in Data Sources, then install the desired Node Exporter dashboard from Catalog.

## Gotchas

- **Range queries return matrices**; instant queries return vectors. Both flatten to `{timestamp, series, value}` rows so charts work uniformly.
- **No query-result caching.** Metadata endpoints (`labels`, `label_values`, `metadata`) are cached for 10 minutes; `query` / `query_range` are never cached because they're time-sensitive.
- **Cardinality matters.** A wide-fanout PromQL produces many series and a busy chart. Reduce cardinality with explicit label matchers or aggregation (e.g. `sum by (job)(rate(...))`) before saving the panel.
- **HTTP 200 with `status: "error"`** is treated as a failure. The error message from the Prometheus response is surfaced verbatim.
- **No `db-query` for this.** Prometheus is its own backend. Do not try to read app DB tables to answer Prometheus questions.
