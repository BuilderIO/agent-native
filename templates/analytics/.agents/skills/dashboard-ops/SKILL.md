---
name: dashboard-ops
description: >-
  Deployment and runtime internals for dashboard email reports and analytics
  alert rules: server-side SVG/PNG report rendering, serverless timing
  budgets, cron wiring, and notification delivery env vars. Use when
  configuring, deploying, or debugging report/alert delivery infrastructure —
  not when just creating a report subscription or alert rule via the action
  surface.
scope: dev
---

# Dashboard Reports & Alerts Ops

Dashboard email reports (`dashboard-report-subscriptions` actions) and
analytics alert rules (`analytics-alert-rules` actions) are SQL-backed action
surfaces. This skill covers the deployment/runtime machinery behind them —
the agent chatting with an end user does not need this; it only needs the
action names and the user-facing constraints already in `AGENTS.md`.

## Dashboard Email Report Rendering

- Scheduled reports render entirely server-side. They do not use a headless
  browser, Chromium pack download, or the old `reportScreenshot=1` embed-session
  screenshot URL; interactive dashboard screenshot capture remains separate.
- Each panel's query runs through the same source dispatcher the UI uses
  (`runDashboardPanelQuery`), inside the subscription owner's request
  context, so per-source access scoping (BigQuery/Gong/HubSpot credentials,
  org scoping) is preserved exactly as if the owner loaded the dashboard.
- Chart panels are drawn as SVG and rasterized to PNG with `@resvg/resvg-js`,
  then embedded in the email as `cid:` attachments. Fonts come from
  `resolveOgFontFiles()` — **resvg has no system fonts in a Lambda runtime,
  so chart text silently renders blank (not an error) unless those bundled
  font files are passed to it.** Never drop that font wiring when touching
  chart rendering.
- Non-chart panels (`section`, `metric`, `callout`, `table`, `heatmap`) render
  as real email HTML, not images. `extension` panels cannot be rendered for
  email at all and instead link out to the live dashboard.
- A panel that fails to query renders a visible error card in its place and
  marks the whole run `degraded`; a degraded report is never sent or recorded
  as if it were complete. If every panel fails, nothing is sent and the
  subscription errors out instead of emailing an empty report.
- Subscriptions are capped at five distinct recipients
  (`MAX_DASHBOARD_REPORT_RECIPIENTS`) — recommend a mailing-list address for
  larger audiences.
- The ten-minute retry delay is an eligibility floor, not a guarantee; the
  `*/15` sweep runs the retry on its first tick after that floor.
- The serverless delivery deadline (`SERVERLESS_REPORT_DELIVERY_BUDGET_MS` in
  `server/jobs/dashboard-report.ts`) reserves 220 seconds of the
  `dashboard-report-sweep-background` function's 300-second `netlify.toml`
  timeout for rendering and delivery, leaving the remainder for cleanup.
- Netlify processes one subscription per background invocation so every report
  gets a fresh delivery deadline and first-party queries cannot contend with
  another report. When due work remains, the worker queues another background
  invocation immediately and drains the batch sequentially. Long-lived
  (non-Netlify) runtimes default to a limit of 5, overridable with
  `DASHBOARD_REPORT_SWEEP_LIMIT`.

### Env Vars

- `DASHBOARD_REPORT_BASE_URL` — overrides the dashboard link URL in emails; if
  unset, falls back to `getAppProductionUrl()` (the `APP_URL` /
  `WORKSPACE_OAUTH_ORIGIN` / `BETTER_AUTH_URL` chain).
- `RESEND_API_KEY` or `SENDGRID_API_KEY` plus `EMAIL_FROM` — required to send
  the report email at all.
- `DASHBOARD_REPORTS_CRON_SECRET` — bearer token external cron callers must
  send to `POST /api/dashboard-reports/run`.
- `DASHBOARD_REPORT_SWEEP_LIMIT` — overrides the per-tick sweep size on
  non-Netlify runtimes (see above).

## Cron Wiring

- Netlify builds emit a scheduled trigger plus a background worker from
  `scripts/emit-netlify-dashboard-report-cron.ts`, using a per-deploy internal
  token and disabling the in-process interval scheduler on Netlify to avoid
  duplicate sends.
- External cron callers can sweep due reports by POSTing
  `/api/dashboard-reports/run` with
  `Authorization: Bearer $DASHBOARD_REPORTS_CRON_SECRET`.
- The same `scripts/emit-netlify-dashboard-report-cron.ts` script also emits
  the alert-rule cron trigger plus background worker, running every five
  minutes on Netlify. Long-lived runtimes use the in-process scheduler unless
  `ANALYTICS_ALERT_JOBS=0` is set.
- External cron callers can run due alerts by POSTing
  `/api/analytics-alerts/run` with
  `Authorization: Bearer $ANALYTICS_ALERTS_CRON_SECRET`.

## Alert Notification Delivery

Alert notifications use the shared notification channel registry
(`channels` can include `inbox`, `email`, `slack`, `webhook`, or any custom
registered channel):

- Slack/webhook delivery prefers per-rule `metadata.delivery.slackWebhookUrl`
  / `metadata.delivery.webhookUrl` (uptime monitors store these on the
  monitor row), then falls back to `NOTIFICATIONS_SLACK_WEBHOOK_URL` /
  `NOTIFICATIONS_WEBHOOK_URL`. Optional `NOTIFICATIONS_SLACK_WEBHOOK_AUTH`
  configures Slack auth.
- Email delivery needs `RESEND_API_KEY` or `SENDGRID_API_KEY` plus
  `EMAIL_FROM`. Per-rule `emailRecipients` fall back to
  `NOTIFICATIONS_EMAIL_RECIPIENTS`. Saving explicit `emailRecipients` also
  remembers them as the current user's defaults for the next alert rule
  created in Settings.

Users can also view and manage report subscriptions and alert rules in
Settings; that UI uses the same action surface as the agent, so no separate
implementation is needed there.

## Related Skills

- **dashboard-management** — the dashboard artifact model these features
  attach to.
- **integration-webhooks** (root) — the general queue-and-processor pattern
  for outbound webhook delivery.
