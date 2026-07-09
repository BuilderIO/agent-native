# Analytics — Agent Guide

Analytics is an agent-native BI workspace. The agent manages data sources,
queries, dashboards, charts, analyses, and connected warehouse integrations
through actions and SQL-backed state.

Keep this file essential. Querying, dashboard, warehouse, and implementation
details live in `.agents/skills/`.

## Core Rules

- Store large file/blob payloads in configured file/blob storage, not SQL: no
  base64, `data:` URLs, images, video/audio, PDFs, ZIPs, screenshots,
  thumbnails, or replay chunks in app tables, `application_state`, `settings`,
  or `resources`; persist URLs, ids, or handles instead.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Data integrity comes first. Do not invent numbers, dimensions, filters, or
  source semantics. State uncertainty and inspect the source when needed.
- Catalog-first: before querying, consult known data sources (data-source
  status) and the injected `<data-dictionary>` to learn what exists and which
  table/columns/join paths to use. Don't fan out blind queries when the catalog
  already answers where a fact lives.
- Clarify-first for ambiguous ad-hoc work: when the metric definition, date
  range, or grain is ambiguous and a wrong guess would change the numbers, use
  the `ask-question` clarifying tool (multiple-choice) before computing. Ask at
  most once per turn, and never when the dictionary or the user already settled
  it.
- Verify before claiming: only present numbers you actually retrieved from a
  source. Never report a value you did not query.
- The built-in Node Exporter demo dashboard uses the `demo` source. It queries
  the built-in public demo Prometheus endpoint by default, not the user's
  Prometheus credential slot. Treat it as demo-environment data: do not use it
  for `REAL_DATA_REQUIRED`, saved analyses, or real user analytics answers
  unless the user explicitly asks to inspect the demo dashboard.
- Every analytical answer should include enough audit context for the user to
  trust it: source(s), time window, filters, sample size or row count,
  join/match method when relevant, and caveats/gaps.
- Use actions for data sources, queries, charts, dashboards, analyses, and
  sharing. Do not bypass app access checks with raw SQL for ownable resources.
- In dev, call actions with `pnpm action <name>`; in production, call native
  tools. The action schema is authoritative.
- Prefer app query actions and provider readers over hand-written ad hoc SQL
  unless the user explicitly asks for low-level inspection.
- Provider actions are shortcuts, not limits. When a canned action cannot
  express the endpoint, filters, request body, pagination, or API version the
  user needs, call `provider-api-catalog` / `provider-api-docs`, then
  `provider-api-request` against the provider's real HTTP API. The generic
  request action uses the shared `@agent-native/core/provider-api` runtime,
  injects configured credentials, blocks private/internal URLs, and redacts
  secrets.
- For questions about tracking events or instrumentation in GitHub-hosted code,
  use `github-repo-files` before raw provider requests: check
  `data-source-status` for GitHub, `operation="search"` likely event names/calls
  with `includeTextMatches=true`, then `operation="read"` the relevant files.
  Report the repo, ref/default branch, queries used, files read, and any
  truncation or GitHub incomplete-results flags so absence claims are auditable.
- For named account/deal deep dives, call `account-deep-dive` first. It bundles
  HubSpot deal/account/contact activity with Gong call detail and compact
  transcript evidence so the final report can match Fusion-style depth.
- For HubSpot deal cohorts, prefer structured `hubspot-deals` filters
  (`product`, `pipeline`, `closedStatus`, `closedDateFrom`/`closedDateTo`) for
  the common case. `query` is full-text search and is not proof a specific
  property matched. When a cohort needs an arbitrary property filter, an
  IN-search, or a join against another provider, use the generic
  provider-access pattern below instead of asking for a new action.
- For BigQuery, Prometheus, or other external providers, use the provider skill
  and existing credential/integration flow.
- For questions that span multiple sources, follow `cross-source-analysis`:
  stitch identities on BOTH a stable id AND email, de-duplicate, and cite
  per-source provenance.
- When the user challenges coverage or asks why records are missing, rerun or
  revise from the source cohort and provide the updated answer directly. Do not
  say a revised analysis exists unless you include it or save it.
- Dashboards and charts should be useful, explainable, and scoped to the user's
  question. Avoid decorative metrics.
- For shipped dashboard templates, call `list-dashboard-templates` first, then
  `install-dashboard-template` with the selected `templateId`. Do not recreate a
  catalog template by hand unless the user asks for a custom variant.
- Agent LLM observability is collected through the same first-party tracking
  API as product analytics. Core emits PostHog-compatible `$ai_generation`
  events when emitting apps are configured with `AGENT_NATIVE_ANALYTICS_PUBLIC_KEY`
  and `AGENT_NATIVE_ANALYTICS_ENDPOINT` (or the default hosted endpoint). Query
  these with `query-agent-native-analytics` using `event_name = '$ai_generation'`;
  useful JSON properties include `$ai_trace_id` / `run_id`, `$ai_session_id` /
  `thread_id`, `$ai_model` / `model`, `$ai_provider` / `provider`,
  `$ai_input_tokens`, `$ai_output_tokens`, `cache_read_tokens`,
  `cache_write_tokens`, `cost_cents_x100`, `$ai_total_cost_usd`, `duration_ms`
  / `$ai_latency`, `status`, `tool_calls`, `successful_tools`, `failed_tools`,
  and `$ai_error` / `error_message`. Do not expect prompts, tool args, or model
  responses in these tracked events by default.
- `/agents` is the Analytics home for admin surfaces. The default Monitoring
  view embeds the shared observability dashboard for traces, conversations,
  evals, experiments, and feedback. `/agents?view=dashboards` shows the
  admin-only dashboard usage audit; call `list-dashboard-usage-stats` when
  admins ask about dashboard created/modified dates, owners, last tracked
  modifier, views, engagements, saved views, or cleanup candidates. The
  Advanced menu opens `/agents?view=database`, where organization owners/admins
  can connect other agent-native app databases and use the shared database admin
  tool for table browsing, row editing, and SQL inspection. This database
  surface is for connected target app databases, not broad access to all
  Analytics data. Keep future admin additions inside this route instead of
  adding many top-level sidebar tabs.
- For dashboard edits, default to `mutate-dashboard` with its typed
  `dashboard.*` script API. It supports id-based panel moves, title/SQL/config
  edits, inserts, duplication, removal, and dashboard field patches in one
  atomic save. The main payload is a string, so it avoids native-array
  serialization traps. The script is constrained: only documented dashboard
  method calls with JSON-compatible arguments are parsed; variables, imports,
  loops, functions, network, filesystem, and DB access are not available.
- Dashboard saves keep bounded history in SQL. Use
  `list-dashboard-revisions` to inspect undo points and
  `restore-dashboard-revision` to restore one instead of hand-editing history
  rows.
- Saved analyses also keep bounded history. Use `list-analysis-revisions` and
  `restore-analysis-revision` for rollback after a re-run updates the saved
  findings.
- Do not count shifting `/panels/<index>` values for ordinary dashboard edit
  requests. Use low-level JSON-pointer edits only when explicitly requested.
- `get-sql-dashboard` is compact by default for agents. Use its `panels`
  summaries and `layout.panelOrder` / `layout.firstPanelIds` for orientation and
  proof. Pass `includeConfig: true` only when full panel SQL/config is needed.
- Native dashboards and saved analyses are constrained artifacts. If a requested
  dashboard, analysis surface, visualization, interaction model, custom layout,
  or bespoke workflow cannot be done faithfully with the built-in dashboard JSON
  config/components or saved-analysis markdown/chart format, automatically build
  it as an extension instead and tell the user why.
- Use framework sharing and access helpers for dashboards, analyses, and saved
  resources.
- Dashboard email reports live in SQL via the
  `dashboard-report-subscriptions` actions. They send daily snapshots scoped to
  the exact user/org context that created the subscription with saved URL
  filters; do not hand-wire custom email routes around that action surface.
  Report PNGs are Playwright captures of the real dashboard route in
  `reportScreenshot=1` mode, authenticated by a short-lived embed-session token
  and embedded inline in email with a CID image. Netlify builds emit a scheduled
  trigger plus a background worker from
  `scripts/emit-netlify-dashboard-report-cron.ts`, using a per-deploy internal
  token and disabling the in-process interval scheduler on Netlify to avoid
  duplicate sends. External cron callers can still sweep due reports by POSTing
  `/api/dashboard-reports/run` with
  `Authorization: Bearer $DASHBOARD_REPORTS_CRON_SECRET`. PNG rendering uses
  local Chrome in development and `playwright-core` plus
  `@sparticuz/chromium-min` in serverless runtimes; set
  `DASHBOARD_REPORT_CHROMIUM_PACK_URL` only when overriding the default
  Chromium pack location.
- Analytics alert rules live in SQL via the `analytics-alert-rules` actions.
  Use `save-analytics-alert-rule`, `list-analytics-alert-rules`,
  `delete-analytics-alert-rule`, and `run-analytics-alerts`; do not hardcode
  one-off alert checks in product code. Rules are generic over first-party
  analytics events: set `eventName` for an exact event name, then filter on
  columns like `event_name`, `app`, `template`, `user_key`, `session_id`,
  `path`, or nested JSON fields like `properties.stage` and
  `context.referrer`. `thresholdMode: "event_count"` counts matching events;
  `thresholdMode: "distinct_count"` counts unique values from `distinctBy`.
  Alert notifications use the shared notification channel registry, so
  `channels` can include `inbox`, `email`, `slack`, `webhook`, or any custom
  registered channel. Slack/webhook prefer delivery-only
  `metadata.delivery.slackWebhookUrl` / `metadata.delivery.webhookUrl` (uptime
  monitors store these on the monitor row), then fall back to
  `NOTIFICATIONS_SLACK_WEBHOOK_URL` / `NOTIFICATIONS_WEBHOOK_URL`. Configure
  optional `NOTIFICATIONS_SLACK_WEBHOOK_AUTH`; configure email with existing
  `RESEND_API_KEY` or `SENDGRID_API_KEY` plus `EMAIL_FROM`, and pass per-rule
  `emailRecipients` or the fallback `NOTIFICATIONS_EMAIL_RECIPIENTS`. Saving
  explicit `emailRecipients` also remembers them as the current user's defaults
  for the next alert rule created in Settings.
  Netlify builds emit an alert cron trigger plus background worker from
  `scripts/emit-netlify-dashboard-report-cron.ts` every five minutes; long-lived
  runtimes use the in-process scheduler unless `ANALYTICS_ALERT_JOBS=0` is set.
  External cron callers can POST `/api/analytics-alerts/run` with
  `Authorization: Bearer $ANALYTICS_ALERTS_CRON_SECRET`.
  Users can view and manage these rules in Settings under the Alerts card, which
  uses the same action surface as the agent.

## Application State

- `navigation` exposes current dashboard, analysis, source, chart, and selected
  context.
- Clicking a dashboard chart, table, or extension stages that panel as a chat
  context chip and writes `selected-object` with `type="dashboard-panel"`.
  Use its dashboard and panel ids to scope inspection and edits to that panel.
- `navigate` moves the user to the relevant analytics view, including
  `view="catalog"` for the template catalog, `view="sessions"` for session
  replay, `view="monitoring"` with `monitoringView="uptime|errors"` (plus the
  `monitorId`, `statusPageId`, or `errorIssueId` deep links) for uptime checks,
  public status pages, or error triage, and `view="agents"` with
  `agentsView="dashboards|database"` plus optional `dbAdminConnectionId` for
  dashboard usage or connected app database admin.
- Use `view-screen` when the active dashboard/chart context is unclear.

## Session Replay

- `/sessions` lists scoped, signed-in first-party session recordings with an
  email-backed visitor identity and playable replay events. Filters live in the
  URL (`range`, `app`, `q`) and are mirrored through application state so the
  agent sees the same list the user sees.
- `/sessions/:recordingId` loads summary/timeline data through
  `get-session-replay-summary` and fetches rrweb payloads only through scoped
  chunk routes. Do not expose storage/provider URLs, raw chunk table access, or
  unscoped replay blobs in UI, actions, dashboards, docs, or prompts.
- The session detail page can mint a temporary `Copy for agent` link through
  `create-session-replay-agent-link`. That URL carries an `agent_access` token
  scoped to one recording for two hours; SSR embeds an agent discovery payload
  and the JSON APIs expose only summary/timeline metadata plus bounded event
  reads.
- Use `@agent-native/core/server` and `@agent-native/core/shared` agent-access
  helpers for scoped token mint/verify and bot-visible URL construction. Keep
  replay chunk/blob authorization, diagnostics payloads, and the session detail
  UI in Analytics.
- Recordings also capture console logs and network request metadata (request
  bodies/headers never captured; response bodies captured only as bounded,
  redacted 5xx snippets; scrubbed URLs, truncated messages, per-session
  budgets); ingest derives `errorCount`/`networkErrorCount` and adds
  `console-error`/`network-error` timeline markers.
- The agent context includes a bounded `diagnostics` section (errors first) and
  advertises `GET /api/session-replay/agent-diagnostics.json` with
  `kind`/`level`/`limit` params (limit max 500) under the same `agent_access`
  token — the primary signal when debugging a user-reported issue. `offset` and
  `fromMs`/`toMs` page/window the same endpoint in strictly chronological order
  (with `hasMore`/`truncated` per kind) so an agent can enumerate every
  captured entry in a large session.
- The replay player has a Dev Tools panel with Console and Network tabs
  (filters, search, jump-to-seek, error badge); extend it rather than adding a
  separate replay debugging surface. See the `session-replay` skill.
- Dashboard rows that include `recording_id` should link to
  `/sessions/:recordingId`; rows that only include `session_id` can link to a
  filtered `/sessions` search.

## Monitoring

- `/monitoring` is the Monitoring tab (`app/routes/monitoring._index.tsx` →
  `app/pages/monitoring/MonitoringPage.tsx`), a thin shell hosting two
  independently-owned panels selected by `?view=uptime|errors` (defaults to
  uptime). `navigation` mirrors it as `view="monitoring"` with `monitoringView`
  (plus `monitorId`/`errorIssueId` when a row is open); each panel also writes
  richer selection to the `monitoring` application-state key.
- Uptime (`app/pages/monitoring/UptimePanel.tsx`,
  `app/pages/monitoring/uptime/**`) manages synthetic HTTP checks with
  alerting. Actions: `list-monitors`, `get-monitor`, `save-monitor`,
  `run-monitor-check`, `delete-monitor`. Checks/alerting run server-side in
  `server/lib/uptime-monitors.ts` (sweep job `server/jobs/uptime-monitors.ts`,
  scheduler `server/plugins/uptime-monitor-jobs.ts`) over
  `server/db/schema-monitoring.ts`. Production serverless/Netlify-style
  runtimes skip the in-process interval scheduler and rely on the generated
  scheduled/background worker or external cron instead. Deep links: list
  `?view=uptime`, detail `?view=uptime&monitor=<id>`, create
  `?view=uptime&monitor=new`, edit `?view=uptime&monitor=<id>&edit=1`. See
  `docs/uptime-monitoring.md`.
- Status pages (`app/pages/monitoring/uptime/status-pages/**`) are a config
  sub-view under Uptime that bundle chosen monitors under a public
  `/status/<slug>` page. Actions: `list-status-pages`, `get-status-page`,
  `save-status-page`, `delete-status-page`, `add-status-page-monitor`,
  `remove-status-page-monitor`, `reorder-status-page-monitors`, plus the
  unauthenticated `get-public-status-page`. Owner-scoped CRUD and the sanitized
  public projection live in `server/lib/status-pages.ts` over
  `server/db/schema-monitoring.ts`. Deep links: index
  `?view=uptime&statuspage=list`, create `?view=uptime&statuspage=new`, edit
  `?view=uptime&statuspage=<id>`.
- Errors (`app/pages/monitoring/ErrorsPanel.tsx`,
  `app/pages/monitoring/errors/**`) is Sentry-style exception triage grouped
  into issues by fingerprint. Actions: `list-error-issues`, `get-error-issue`,
  `resolve-error-issue`, `capture-test-error`, `match-error-issues`.
  Ingest/grouping lives in `server/lib/error-capture.ts` over
  `server/db/schema-errors.ts`. Browser capture uses the SDK from
  `@agent-native/core/client` (`captureException` / `captureMessage` /
  `addErrorBreadcrumb`), auto-enabled by `configureTracking` and transported
  through the first-party analytics ingest as a `$exception` event. Deep link:
  `?view=errors&issue=<id>`. Issue detail includes recent frequency,
  parsed/raw stack traces, source code snippets when available, breadcrumbs,
  tags, occurrence history, and session replay links. See
  `docs/error-capture.md`.
- Session replay ↔ Errors: a recording's devtools Console error lines link to
  the grouped issue at `/monitoring?view=errors&issue=<id>`, resolved by
  `match-error-issues` (exact fingerprint match, no heuristics); issues link
  back to the originating recording at `/sessions/<recordingId>`.

## Dashboard Template Catalog

- To build or extend a LARGE first-party dashboard, prefer `compose-dashboard`:
  name the metrics and the server generates the validated SQL/config for every
  panel in ONE fast call. Do NOT hand-author big `update-dashboard` configs
  panel-by-panel or loop `update-dashboard` — streaming a giant multi-panel
  argument across timeout boundaries fails and thrashes. Unknown metric keys are
  skipped and reported; per-panel SQL validates independently; existing
  dashboards append by default (`overwrite: true` replaces). Report the returned
  `panelCount` as proof-of-done.
- `list-dashboard-templates` lists source-controlled dashboard templates with
  `id`, category, data sources, panel count, and installed dashboard IDs.
- `install-dashboard-template` installs a catalog template into normal
  SQL-backed dashboards. Required: `templateId`. Optional: `dashboardId`,
  `name`, `overwrite`, `forceNew`, and `mergePanels`.
- The LLM observability dashboard template is `agent-observability-llm`. Install
  it when the user wants model cost, token volume, latency, error rate, or top
  expensive agent-run visibility from first-party `$ai_generation` events.
- To add a template's panels to an existing dashboard, call
  `install-dashboard-template` with `mergePanels: true` and the existing
  `dashboardId`. It appends only the template panels whose id is not already
  present (preserving existing panels and order) in one atomic save and returns
  `{ addedPanelIds, skippedExistingIds, panelCount }`. Prefer this over looping
  `update-dashboard` to add many panels — sequential calls time out on the ~40s
  hosted run budget.
- Node Exporter ships as `node-exporter-macos` for Darwin/Homebrew
  `node_exporter` scrapes and `node-exporter-full` for the Linux-focused
  Grafana 1860 revision 45 full dashboard converted into native Analytics
  panels. `node-exporter-full` also includes Prometheus Observability Demo app
  metrics (`demo_http_*`, `demo_chaos_mode`, and synthetic CPU/disk/memory
  workload metrics). Keep the first-open `App / Overview` tab light: it should
  show the Request Latency highlight plus current app state, while Traffic,
  Latency, and Workload details stay split across their own `App / *` tabs.

## Demo Dashboard

- `ensure-demo-dashboards` installs one private per-user demo on first app
  open: `demo-node-exporter`. The Analytics root route calls this before
  honoring local last-opened state; when the action creates the demo, the user
  should land directly on the Node Exporter demo's `App / Overview` tab without
  visiting the template catalog or data-source setup.
- The demo dashboard is generated from the same `node-exporter-full` seed as
  the catalog template. Its Prometheus panels keep the same PromQL descriptors
  and use `source: "demo"` so queries route to the demo Prometheus endpoint
  instead of the user's `PROMETHEUS_*` credential slot.
- The demo Prometheus endpoint defaults to the public read-only
  `https://prometheus.agent-native.foo`, so cloud and local MPX installs work
  without user setup. Deployments can override it with
  `ANALYTICS_DEMO_PROMETHEUS_URL` and optional
  `ANALYTICS_DEMO_PROMETHEUS_USERNAME`,
  `ANALYTICS_DEMO_PROMETHEUS_PASSWORD`, or
  `ANALYTICS_DEMO_PROMETHEUS_BEARER_TOKEN`. Do not put credential values in
  source, docs, fixtures, tests, prompts, or dashboard seeds.
- Demo dashboards are ordinary SQL dashboard rows, so rename, share, archive,
  and delete flows apply. Deleted demo IDs are tombstoned in SQL settings and
  are not recreated unless the user explicitly asks to reset demos.
- Use `ensure-demo-dashboards --reset=true` only when the user asks to restore
  a deleted or changed demo dashboard.

## Deep Analysis Rules

**The analytics agent IS Claude with provider access** — the same 200K context
window, the same reasoning capability, plus direct access to BigQuery, Gong,
HubSpot, Pylon, Sentry, Grafana, etc. It can do everything a standalone AI
conversation can do, including reading large unstructured text and producing
long-form memo-style output.

**NEVER suggest the user move to a separate AI tool, project, or external service for:**

- Reasoning or synthesis over data fetched in this session
- Deep analysis across multiple accounts, calls, or data points
- Holding context and judgment across a complex multi-step investigation
- Generating written summaries, memos, findings, or recommendations

### Answer with Real Data

When the user asks a data question, **query real data first**, then present the
answer directly in chat with tables, inline charts, and findings. Never deflect
to "check the dashboard" — actually run the query, get the data, and present it.

### Incident / Metric Investigations

When investigating a production incident, metric anomaly, or performance issue:

1. **Query real metrics FIRST** — Prometheus/Grafana for service metrics, Sentry
   for errors, BigQuery for event trends. Real data tells you what happened.
2. **Check upstream dependencies** — many incidents are caused by provider-side
   degradation (LLM APIs, external services), not local code.
3. **Only analyze code/config after you have data** — code tells you what _could_
   happen; metrics tell you what _did_ happen.

### Batch / Large Fan-Out Analyses

For analyses spanning 30+ accounts, deals, or calls:

1. Define the cohort and chunk into groups of 5-10 items.
2. Process each chunk, writing per-item findings as intermediate notes.
3. Synthesize across all chunks in a final pass.

Do not try to hold 30+ full records in one context pass.

### Provider Access & Dashboard Data Programs

One generic pattern covers arbitrary provider access, cross-source joins,
corpus search, and turning any of that into a live dashboard panel — there is
no separate per-vendor workflow:

1. `provider-api-catalog` / `provider-api-docs` to confirm the endpoint,
   params, and auth (check `corpusRecipes` for broad body-text searches).
2. `provider-api-request` for a one-off call, or `run-code`'s `providerFetch` /
   `providerFetchAll` / `providerSearchAll` to fetch/join/filter/aggregate
   server-side so big intermediates never enter chat context (`stageAs` +
   `query-staged-dataset` for a large single-source pull).
3. `save-data-program` to persist that run-code script as a live dashboard
   panel feed: it dry-runs before saving, the panel binds with
   `source: "program"`, and refresh policy (ttl/manual/background) lives on
   the program — the agent does not re-run it per view.
4. Report coverage: source, filters, time window, row counts, joins,
   failed/aborted pages, truncation, and remaining gaps. Never turn sampled or
   truncated results into a confident "none found" or exhaustive conclusion.

See the `provider-api` and `data-programs` skills for the full API surface,
caching model, and a worked HubSpot x Pylon join example.

### Learnings Flywheel

After completing any significant analysis, record discoveries to `LEARNINGS.md`
via the `resources` tool (`action: "read"` then `action: "write"`). Capture:

- Confirmed metric definitions
- Provider gotchas discovered
- Schema discoveries (table/column names, join patterns that worked)
- Identity-stitching rules confirmed across sources

The `save-memory` tool works for personal-scope learnings; `LEARNINGS.md` is the
shared team knowledge layer.

## Skills

Read the relevant skill before deeper work:

- `data-querying` for source inspection, SQL/query generation, and result
  handling.
- `cross-source-analysis` for questions that span multiple data sources
  (identity stitching, de-duplication, consolidated provenance). Includes the
  default account deep-dive source order: CRM → support → community → calls →
  product usage → service health → tickets.
- `hubspot` for CRM deals, companies, contacts, tickets, owners, and account
  context. Includes stage-entry date fields and multi-dimensional loss analysis.
- `gong` for call metadata, transcript excerpts, objections, risks, and next
  steps. Includes the two-pass search algorithm and external-monologue pattern.
- `bigquery` for warehouse SQL, data-dictionary-first discipline, table priority
  order, and date-bounding rules.
- `prometheus` for metrics queries and incident investigation pattern.
- `actions` for the shared provider API pattern when a first-class action is too
  narrow for arbitrary authenticated provider HTTP calls and API docs lookup.
- `data-programs` for turning a run-code script into a stored, refreshable
  dashboard data source: the `emit(rows, schema)` contract, caching/refresh
  model, limits, and the Risk Meeting worked example.
- `dashboard-management` for dashboard/chart creation and layout.
- `adhoc-analysis` for one-off analytical answers and batch fan-out pattern.
- `analysis-workspace` for large-scale multi-source analyses: Resources-backed
  files, `scratch/` temporary staging, chunked batch processing with per-item
  memos, `run-code` aggregation, `saveToFile`/`fetchAllPages` for large API
  pulls, and multi-turn synthesis.
  Read this before any analysis spanning 30+ items or requiring data larger
  than one context window.
- `storing-data`, `real-time-sync`, `security`, `actions`, and
  `frontend-design` for framework work.
