/**
 * Uptime monitoring schema — OWNED BY THE UPTIME MONITORING FEATURE.
 *
 * Everything exported here is re-exported from ./schema.ts via `export *`, so
 * these tables join the app's Drizzle schema namespace and are reachable as
 * `schema.<table>` throughout the server. Keep all schema changes additive
 * (never drop/rename/retype existing columns) per the storing-data rules.
 *
 * Physical table creation + indexes are applied by the isolated migration list
 * in server/plugins/uptime-monitor-jobs.ts (`uptime_monitor_migrations`), NOT
 * by drizzle-kit. These Drizzle definitions must stay in lockstep with that
 * DDL (snake_case column names, dialect-agnostic types).
 *
 * All three tables carry `ownableColumns()` (owner_email / org_id / visibility)
 * and every read/write in server/lib/uptime-monitors.ts is scoped by
 * owner_email + org_id, mirroring the analytics-alerts engine.
 */
import {
  integer,
  now,
  ownableColumns,
  table,
  text,
} from "@agent-native/core/db/schema";

/**
 * A single uptime check ("monitor"). Pings `url` on `intervalSeconds` and
 * evaluates the response against a status matcher + a list of assertions.
 */
export const monitors = table("monitors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  /** HTTP method used for the probe. */
  method: text("method", {
    enum: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
    .notNull()
    .default("GET"),
  /** Extra request headers as a JSON object (`Record<string,string>`). */
  requestHeaders: text("request_headers").notNull().default("{}"),
  /** Optional request body (POST/PUT/PATCH). */
  requestBody: text("request_body"),
  intervalSeconds: integer("interval_seconds").notNull().default(300),
  timeoutMs: integer("timeout_ms").notNull().default(10000),
  /**
   * Status matcher as JSON. One of:
   *   { "mode": "class", "classes": ["2xx","3xx"] }
   *   { "mode": "list",  "codes": [200,204] }
   *   { "mode": "range", "min": 200, "max": 299 }
   */
  expectedStatus: text("expected_status")
    .notNull()
    .default('{"mode":"class","classes":["2xx"]}'),
  /**
   * JSON array of assertions. Each entry:
   *   { "type": "body_contains" | "body_absent" | "header_contains" |
   *             "header_equals" | "max_latency_ms",
   *     "value": string | number, "header"?: string }
   */
  assertions: text("assertions").notNull().default("[]"),
  followRedirects: integer("follow_redirects", { mode: "boolean" })
    .notNull()
    .default(true),
  /** Alert severity when the monitor fails. */
  severity: text("severity", { enum: ["warning", "critical"] })
    .notNull()
    .default("critical"),
  /** Notification channels as JSON (e.g. ["inbox","email","slack","webhook"]). */
  channels: text("channels").notNull().default('["inbox"]'),
  /** Email recipients as JSON array of addresses. */
  emailRecipients: text("email_recipients").notNull().default("[]"),
  /** Optional per-monitor Slack incoming webhook URL (overrides workspace env). */
  slackWebhookUrl: text("slack_webhook_url"),
  /** Optional per-monitor generic webhook URL (overrides workspace env). */
  webhookUrl: text("webhook_url"),
  /** Minutes to suppress repeat alerts while an incident is ongoing. */
  cooldownMinutes: integer("cooldown_minutes").notNull().default(15),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),

  // ---- Mutable status fields (updated by the runner) ----
  /** up | down | degraded | error | unknown | running */
  lastStatus: text("last_status"),
  lastCheckedAt: text("last_checked_at"),
  lastSuccessAt: text("last_success_at"),
  lastError: text("last_error"),
  lastLatencyMs: integer("last_latency_ms"),
  lastStatusCode: integer("last_status_code"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),

  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

/**
 * Historical probe results. Bounded retention is enforced by the sweep job
 * (server/jobs/uptime-monitors.ts) so this table cannot grow unbounded.
 */
export const monitorCheckResults = table("monitor_check_results", {
  id: text("id").primaryKey(),
  monitorId: text("monitor_id").notNull(),
  checkedAt: text("checked_at").notNull(),
  ok: integer("ok", { mode: "boolean" }).notNull(),
  /** Classification for this probe: up | down | degraded | error. */
  status: text("status").notNull().default("up"),
  statusCode: integer("status_code"),
  latencyMs: integer("latency_ms"),
  error: text("error"),
  /** JSON array of human-readable assertion failures. */
  failedAssertions: text("failed_assertions").notNull().default("[]"),
  createdAt: text("created_at").notNull().default(now()),
  ...ownableColumns(),
});

/**
 * One incident per continuous failure streak. `resolvedAt` null = ongoing.
 * Mirrors analyticsAlertIncidents.
 */
export const monitorIncidents = table("monitor_incidents", {
  id: text("id").primaryKey(),
  monitorId: text("monitor_id").notNull(),
  startedAt: text("started_at").notNull(),
  resolvedAt: text("resolved_at"),
  /** down | degraded — the classification at incident open. */
  status: text("status").notNull().default("down"),
  severity: text("severity").notNull().default("critical"),
  /** Short summary of what failed (status code / failed assertions). */
  cause: text("cause").notNull().default(""),
  lastError: text("last_error"),
  notificationId: text("notification_id"),
  checksFailed: integer("checks_failed").notNull().default(1),
  createdAt: text("created_at").notNull().default(now()),
  ...ownableColumns(),
});

/**
 * Owner-authored public status page. A status page bundles a set of the owner's
 * monitors under a public `slug` (`/status/<slug>`) and renders their SAFE
 * aggregate health (status, uptime %s, colored timelines) to anyone with the
 * link — but only when `published` is true. The public read
 * (server/lib/status-pages.ts `getPublicStatusPage`) strictly filters to
 * published pages and the page owner's included monitors, and never leaks
 * monitor URLs/headers/assertions/alert config unless a per-monitor "show URL"
 * opt-in is set.
 *
 * `monitors` is a JSON array of
 *   { monitorId: string; order: number; displayName?: string | null;
 *     showUrl?: boolean }
 * kept additive so page layout can grow without a join table migration.
 */
export const statusPages = table("status_pages", {
  id: text("id").primaryKey(),
  /** Public, globally-unique URL slug (`/status/<slug>`). */
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  /** Only published pages are readable by the unauthenticated public route. */
  published: integer("published", { mode: "boolean" }).notNull().default(false),
  // ---- Layout options ----
  showUptimeBars: integer("show_uptime_bars", { mode: "boolean" })
    .notNull()
    .default(true),
  showOverallUptime: integer("show_overall_uptime", { mode: "boolean" })
    .notNull()
    .default(true),
  showResponseTime: integer("show_response_time", { mode: "boolean" })
    .notNull()
    .default(false),
  density: text("density", { enum: ["comfortable", "compact"] })
    .notNull()
    .default("comfortable"),
  alignment: text("alignment", { enum: ["left", "center"] })
    .notNull()
    .default("left"),
  /** JSON array of included monitors with order + optional display overrides. */
  monitors: text("monitors").notNull().default("[]"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});
