---
name: monitoring
description: >-
  Implementation map for the Monitoring tab (uptime checks, public status
  pages, error triage): component/server file locations, schema, jobs, and
  scheduler wiring. Use when building or debugging Monitoring UI, uptime
  checks, status pages, or error capture/grouping — not when just calling the
  monitoring actions from chat.
scope: dev
---

# Monitoring Implementation Map

`/monitoring` is a thin shell (`app/routes/monitoring._index.tsx` →
`app/pages/monitoring/MonitoringPage.tsx`) hosting two independently-owned
panels selected by `?view=uptime|errors` (defaults to uptime). `navigation`
mirrors it as `view="monitoring"` with `monitoringView` (plus
`monitorId`/`errorIssueId` when a row is open); each panel also writes richer
selection to the `monitoring` application-state key.

## Uptime

- UI: `app/pages/monitoring/UptimePanel.tsx`, `app/pages/monitoring/uptime/**`.
- Server: `server/lib/uptime-monitors.ts` (checks/alerting), sweep job
  `server/jobs/uptime-monitors.ts`, scheduler
  `server/plugins/uptime-monitor-jobs.ts`, schema
  `server/db/schema-monitoring.ts`.
- Actions: `list-monitors`, `get-monitor`, `save-monitor`, `run-monitor-check`,
  `delete-monitor`.
- Production serverless/Netlify-style runtimes skip the in-process interval
  scheduler and rely on the generated scheduled/background worker or external
  cron instead.
- Deep links: list `?view=uptime`, detail `?view=uptime&monitor=<id>`, create
  `?view=uptime&monitor=new`, edit `?view=uptime&monitor=<id>&edit=1`.
- See `docs/uptime-monitoring.md`.

## Status Pages

- UI: `app/pages/monitoring/uptime/status-pages/**`, a config sub-view under
  Uptime that bundles chosen monitors under a public `/status/<slug>` page.
- Server: owner-scoped CRUD and the sanitized public projection live in
  `server/lib/status-pages.ts` over `server/db/schema-monitoring.ts`.
- Actions: `list-status-pages`, `get-status-page`, `save-status-page`,
  `delete-status-page`, `add-status-page-monitor`,
  `remove-status-page-monitor`, `reorder-status-page-monitors`, plus the
  unauthenticated `get-public-status-page`.
- Deep links: index `?view=uptime&statuspage=list`, create
  `?view=uptime&statuspage=new`, edit `?view=uptime&statuspage=<id>`.

## Errors

- UI: `app/pages/monitoring/ErrorsPanel.tsx`, `app/pages/monitoring/errors/**`
  — Sentry-style exception triage grouped into issues by fingerprint.
- Server: ingest/grouping in `server/lib/error-capture.ts` over
  `server/db/schema-errors.ts`.
- Actions: `list-error-issues`, `get-error-issue`, `resolve-error-issue`,
  `capture-test-error`, `match-error-issues`.
- Browser capture uses the SDK from `@agent-native/core/client`
  (`captureException` / `captureMessage` / `addErrorBreadcrumb`),
  auto-enabled by `configureTracking` and transported through the first-party
  analytics ingest as a `$exception` event.
- Deep link: `?view=errors&issue=<id>`. Issue detail includes recent
  frequency, parsed/raw stack traces, source code snippets when available,
  breadcrumbs, tags, occurrence history, and session replay links.
- See `docs/error-capture.md`.

## Session Replay ↔ Errors

A recording's devtools Console error lines link to the grouped issue at
`/monitoring?view=errors&issue=<id>`, resolved by `match-error-issues` (exact
fingerprint match, no heuristics); issues link back to the originating
recording at `/sessions/<recordingId>`.

## Related Skills

- **session-replay** — replay storage, capture, and the Dev Tools panel this
  feature links to.
