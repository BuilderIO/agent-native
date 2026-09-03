# Uptime monitoring

Uptime monitoring lets you create **monitors** — synthetic HTTP checks that ping
a URL on a schedule and alert you (or others) when something is wrong:

- the URL is **unreachable** or **times out**,
- it returns a **non-expected status** (e.g. a `5xx` when you expect `2xx`),
- it is **too slow** (a latency budget you set), or
- its response body is **missing expected text** or **contains forbidden text**.

It reuses the same notification pipeline as the analytics alert rules, so alerts
land in the in-app inbox and can also fan out to email, Slack, and webhooks.

The feature lives under **Monitoring → Uptime** (`/monitoring?view=uptime`). A
selected monitor is reflected in the URL as `?view=uptime&monitor=<id>` so links
are shareable and the agent can deep-link a monitor.

## How a check works

Each check runs on the server (`server/lib/uptime-monitors.ts`):

1. Run SSRF setup (dispatcher + DNS private-address check) **outside** the
   request timeout budget. The connect-time dispatcher is built once and reused
   across checks (HTTP keep-alive), so latency reflects the real request round
   trip instead of a fresh DNS + TCP + TLS handshake on every probe.
2. Fetch the monitor's `url` with the configured `method`, headers, and body,
   through that SSRF-safe path, with an `AbortController` timeout that covers
   only the HTTP request (headers / redirect chain).
3. Measure latency from the HTTP response headers. If a body assertion is
   configured, read up to **512 KB** of the response body (skipped for `HEAD`)
   with a bounded body-read timer after clearing the request abort timer, so a
   slow body cannot be mislabeled as a request timeout or hang indefinitely.
4. Evaluate the **status matcher** and every **assertion**.
5. Classify the result:
   - `up` — status matches and all assertions pass.
   - `degraded` — status matches but only a `max_latency_ms` assertion fails
     (the endpoint responded, just too slowly). Alerts at `warning` severity.
   - `down` — the status does not match, a content/header assertion fails, or
     the request errored/timed out. Alerts at the monitor's configured severity.
   - `error` — a configuration/SSRF problem prevented the check from running.
6. Persist a compact diagnostics payload on the check row with safe runtime
   context, phase timings, response headers such as `x-nf-request-id`, and the
   error kind. Diagnostics intentionally exclude request headers, request bodies,
   response bodies, secrets, and large payloads.

### Status matcher

`expectedStatus` accepts one of three shapes (stored as JSON):

```jsonc
{ "mode": "class", "classes": ["2xx", "3xx"] } // any 2xx or 3xx
{ "mode": "list",  "codes": [200, 204] }        // exact codes
{ "mode": "range", "min": 200, "max": 299 }     // inclusive range
```

### Assertions

`assertions` is a JSON array. All assertions must pass for a check to be `up`.

| type              | meaning                                          | fields            |
| ----------------- | ------------------------------------------------ | ----------------- |
| `body_contains`   | response body must contain the text              | `value`           |
| `body_absent`     | response body must NOT contain the text          | `value`           |
| `header_contains` | a response header must contain the text          | `header`, `value` |
| `header_equals`   | a response header must equal the text            | `header`, `value` |
| `max_latency_ms`  | response must arrive within N ms (else degraded) | `value` (number)  |

## Alerting and recovery

`evaluateAndNotifyMonitor` manages incidents like the analytics alert engine:

- On a transition **into confirmed failure**, it opens a `monitor_incidents` row
  (one per continuous failure streak) and calls `notifyWithDelivery` with a
  clear title and body plus safe inbox metadata
  `{ kind: "uptime_monitor", monitorId, url, statusCode, latencyMs, failedAssertions, emailRecipients }`.
  The `inbox` channel is the in-app bell; `email` uses the monitor's
  `emailRecipients`; `slack` / `webhook` use the monitor's optional
  delivery-only `slackWebhookUrl` / `webhookUrl` (falling back to workspace
  `NOTIFICATIONS_SLACK_WEBHOOK_URL` / `NOTIFICATIONS_WEBHOOK_URL` when unset).
- Transient no-response failures, such as network errors or timeouts, and
  transient latency degradations must fail twice in a row before opening an
  incident or alerting. Set
  `UPTIME_MONITOR_TRANSIENT_FAILURE_CONFIRMATION_CHECKS=1` to alert on the first
  transient failure, or a higher value (max 10) for stricter confirmation.
- While an incident is open it will not re-alert. After an incident resolves,
  `cooldownMinutes` suppresses a fresh "down" alert for that window to prevent
  flapping. Incidents opened during that quiet window do not send recovery
  emails either, so one flaky target cannot produce "recovered" noise for an
  alert that was intentionally suppressed.
- On **recovery**, it resolves the open incident and sends an informational
  "recovered" notification (with downtime duration) only when the incident sent
  an initial down/degraded notification.

A `lastStatus === "running"` claim guard (with a staleness timeout) ensures that
concurrent sweeps never double-run the same monitor.

## Security (SSRF)

Because monitors fetch user-supplied URLs from the server, `runMonitorCheck`
guards against SSRF:

- Only `http:` / `https:` URLs are allowed.
- Requests to loopback, link-local, private RFC1918 ranges, and cloud metadata
  IPs are blocked — both by a literal pre-flight check and by DNS resolution of
  the resolved host (including across redirects). Blocked hosts classify as
  `error`, never a successful check.
- Redirects are followed manually (max 5 hops) and each hop is re-validated; when
  `followRedirects` is off, a `3xx` is returned as-is.
- The response body read is capped at 512 KB before text assertions run.

To monitor internal/private hosts in development or a self-hosted deployment,
set `UPTIME_MONITOR_ALLOW_PRIVATE_HOSTS=1` (off by default).

## Background job

The sweep is registered by `server/plugins/uptime-monitor-jobs.ts` for
long-lived runtimes. Netlify builds emit a scheduled trigger plus background
worker from `scripts/emit-netlify-dashboard-report-cron.ts`; the route
`/api/uptime-monitors/run` is callable by that generated worker or by an
external cron with `UPTIME_MONITORS_CRON_SECRET`. Both paths run
`runDueMonitorsOnce()` (`server/jobs/uptime-monitors.ts`), which selects enabled
monitors whose interval has elapsed, checks them, records results, opens/resolves
incidents, and prunes old check results.

Production serverless function runtimes skip the in-process interval scheduler
even when `UPTIME_MONITOR_JOBS=1`, because the function may freeze or time out
mid-sweep. Use the generated scheduled/background worker or an external cron
calling `/api/uptime-monitors/run` for production serverless checks.

Environment flags (mirrors the analytics alert job):

| flag                                                   | effect                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `UPTIME_MONITOR_JOBS`                                  | `1` enables the in-process cron; `0` disables it.                                                |
| `RUN_BACKGROUND_JOBS`                                  | fallback flag when `UPTIME_MONITOR_JOBS` is unset.                                               |
| (production)                                           | on by default unless a flag is `0` or a platform scheduler owns it.                              |
| `UPTIME_MONITOR_INTERVAL_MS`                           | wake interval for the sweep (default 30s, min 10s).                                              |
| `UPTIME_MONITOR_SWEEP_LIMIT`                           | max monitors processed per sweep (default 100).                                                  |
| `UPTIME_MONITOR_RESULT_RETENTION_DAYS`                 | how long check results are kept (default 30).                                                    |
| `UPTIME_MONITOR_ALLOW_PRIVATE_HOSTS`                   | allow probing private/internal hosts.                                                            |
| `UPTIME_MONITOR_TRANSIENT_FAILURE_CONFIRMATION_CHECKS` | consecutive timeout/network/slow-response failures required before alerting (default 2, max 10). |
| `UPTIME_MONITORS_CRON_SECRET`                          | bearer token for external cron callers of `/api/uptime-monitors/run`.                            |

The monitor tables (`monitors`, `monitor_check_results`, `monitor_incidents`)
are created by the app migration list in `server/plugins/db.ts`, which runs at
boot regardless of whether the cron is enabled — so the actions and UI always
have their schema.

## Managing monitors from the agent

Every operation is an owner-scoped action, so the agent can create and triage
monitors from chat exactly like the UI:

| action              | method | what it does                                                                                                                                                                                     |
| ------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `save-monitor`      | POST   | create or update a monitor (name, url, method, interval, timeout, expected status, assertions, redirects, severity, channels, email recipients, optional Slack/webhook URLs, cooldown, enabled). |
| `list-monitors`     | GET    | list monitors with latest status, latency, and 24h/7d uptime %.                                                                                                                                  |
| `get-monitor`       | GET    | one monitor plus its recent check results and incidents.                                                                                                                                         |
| `delete-monitor`    | POST   | delete a monitor and its results + incidents.                                                                                                                                                    |
| `run-monitor-check` | POST   | run one check now, record it, and open/resolve incidents.                                                                                                                                        |

Example prompts:

- "Monitor https://example.com every 5 minutes and email me if it returns a 5xx
  or the page stops containing 'Sign in'."
- "Which monitors are down right now?" (→ `list-monitors`)
- "Run a check on the marketing site now." (→ `run-monitor-check`)

## Data model

All three tables carry `ownableColumns()` (`owner_email` / `org_id` /
`visibility`) and every read/write is scoped by owner + org.

- **`monitors`** — configuration plus mutable status fields (`last_status`,
  `last_checked_at`, `last_success_at`, `last_error`, `last_latency_ms`,
  `last_status_code`, `consecutive_failures`).
- **`monitor_check_results`** — one row per probe (`ok`, `status`, `status_code`,
  `latency_ms`, `error`, `failed_assertions`, `diagnostics`), indexed on
  `(monitor_id, checked_at)`; pruned by the sweep so it stays bounded.
- **`monitor_incidents`** — one row per failure streak (`started_at`,
  `resolved_at` null = ongoing, `cause`, `severity`, `notification_id`,
  `checks_failed`).
