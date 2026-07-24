---
name: dashboard-ops
description: >-
  Deployment and runtime internals for dashboard email reports and analytics
  alert rules: Playwright/Chromium capture, serverless timing budgets, cron
  wiring, and notification delivery env vars. Use when configuring, deploying,
  or debugging report/alert delivery infrastructure — not when just creating a
  report subscription or alert rule via the action surface.
scope: dev
---

# Dashboard Reports & Alerts Ops

Dashboard email reports (`dashboard-report-subscriptions` actions) and
analytics alert rules (`analytics-alert-rules` actions) are SQL-backed action
surfaces. This skill covers the deployment/runtime machinery behind them —
the agent chatting with an end user does not need this; it only needs the
action names and the user-facing constraints already in `AGENTS.md`.

## Dashboard Email Report Capture

- Report PNGs are Playwright captures of the real dashboard route in
  `reportScreenshot=1` mode, authenticated by a short-lived embed-session
  token, and embedded inline in the email as ordered CID images.
- Complete dashboards are captured sequentially in four-panel windows matching
  the browser's four-query concurrency limit. Every window must match the
  panel ids snapshotted at the start; a failed or mismatched window
  invalidates the entire image set so the scheduler retries instead of
  sending a partial report.
- Capture is capped at 10 windows and 14 MiB of raw PNG data. Subscriptions
  are capped at five distinct recipients — recommend a mailing-list address
  for larger audiences.
- The serverless capture deadline reserves 90 seconds of the 300-second
  worker budget for cleanup and delivery.
- The ten-minute retry delay is an eligibility floor, not a guarantee; the
  `*/15` sweep runs the retry on its first tick after that floor.
- PNG rendering uses local Chrome in development and `playwright-core` plus
  `@sparticuz/chromium-min` in serverless runtimes. Set
  `DASHBOARD_REPORT_CHROMIUM_PACK_URL` only when overriding the default
  Chromium pack location.

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
