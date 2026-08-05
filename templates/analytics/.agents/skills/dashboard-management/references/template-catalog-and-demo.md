# Template Catalog And Demo Dashboards

## Listing And Installing Templates

- `list-dashboard-templates` lists source-controlled dashboard templates with
  `id`, category, data sources, panel count, and installed dashboard IDs.
- `install-dashboard-template` installs a catalog template into normal
  SQL-backed dashboards. Required: `templateId`. Optional: `dashboardId`,
  `name`, `overwrite`, `forceNew`, and `mergePanels` (see "Reliable Bulk
  Edits" in the main skill for the `mergePanels` append behavior).

## Canonical Agent Native Dashboard

Keep the canonical Agent Native dashboard (`agent-native-templates-first-party`)
focused: it includes one explicit feedback-sentiment-by-model chart and one
optional inferred-message-sentiment chart, not the broader LLM cost, token,
latency, or error suite.

- Explicit feedback uses content-free `$ai_feedback` events with `sentiment`
  (`positive` or `negative`) and model in `$ai_model` or `model`.
- Inferred sentiment uses `$ai_sentiment` events with `method = 'llm'` and
  `sentiment` (`positive`, `neutral`, or `negative`).

Keep these panels in the canonical dashboard and do not recreate a separately
installable observability template.

## Node Exporter Templates

Node Exporter ships as `node-exporter-macos` (Darwin/Homebrew `node_exporter`
scrapes) and `node-exporter-full` (the Linux-focused Grafana 1860 revision 45
dashboard converted into native Analytics panels, plus Prometheus
Observability Demo app metrics — `demo_http_*`, `demo_chaos_mode`, synthetic
CPU/disk/memory workload metrics). See the `prometheus` skill for the full
panel/field breakdown and local Homebrew setup.

Keep the first-open `App / Overview` tab light: it should show the Request
Latency highlight plus current app state, while Traffic, Latency, and
Workload details stay split across their own `App / *` tabs.

## Demo Dashboard

- `ensure-demo-dashboards` installs one private per-user demo on first app
  open: `demo-node-exporter`. The Analytics root route calls this before
  honoring local last-opened state; when the action creates the demo, the
  user should land directly on the Node Exporter demo's `App / Overview` tab
  without visiting the template catalog or data-source setup.
- The demo dashboard is generated from the same `node-exporter-full` seed as
  the catalog template. Its Prometheus panels keep the same PromQL
  descriptors and use `source: "demo"` so queries route to the demo
  Prometheus endpoint instead of the user's `PROMETHEUS_*` credential slot.
- The demo Prometheus endpoint defaults to the public read-only
  `https://prometheus.agent-native.foo`, so cloud and local MPX installs work
  without user setup. Deployments can override it with
  `ANALYTICS_DEMO_PROMETHEUS_URL` and optional
  `ANALYTICS_DEMO_PROMETHEUS_USERNAME`, `ANALYTICS_DEMO_PROMETHEUS_PASSWORD`,
  or `ANALYTICS_DEMO_PROMETHEUS_BEARER_TOKEN`. Do not put credential values
  in source, docs, fixtures, tests, prompts, or dashboard seeds.
- Demo dashboards are ordinary SQL dashboard rows, so rename, share, archive,
  and delete flows apply. Deleted demo IDs are tombstoned in SQL settings and
  are not recreated unless the user explicitly asks to reset demos.
- Use `ensure-demo-dashboards --reset=true` only when the user asks to
  restore a deleted or changed demo dashboard.
