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
 * DDL (snake_case column names and Postgres types).
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
import { boolean } from "drizzle-orm/pg-core";

export const monitors = table("monitors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  method: text("method", {
    enum: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
    .notNull()
    .default("GET"),
  requestHeaders: text("request_headers").notNull().default("{}"),
  requestBody: text("request_body"),
  intervalSeconds: integer("interval_seconds").notNull().default(300),
  timeoutMs: integer("timeout_ms").notNull().default(10000),
  expectedStatus: text("expected_status")
    .notNull()
    .default('{"mode":"class","classes":["2xx"]}'),
  assertions: text("assertions").notNull().default("[]"),
  followRedirects: boolean("follow_redirects").notNull().default(true),
  severity: text("severity", { enum: ["warning", "critical"] })
    .notNull()
    .default("critical"),
  channels: text("channels").notNull().default('["inbox"]'),
  emailRecipients: text("email_recipients").notNull().default("[]"),
  slackWebhookUrl: text("slack_webhook_url"),
  webhookUrl: text("webhook_url"),
  cooldownMinutes: integer("cooldown_minutes").notNull().default(15),
  enabled: boolean("enabled").notNull().default(true),

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

export const monitorCheckResults = table("monitor_check_results", {
  id: text("id").primaryKey(),
  monitorId: text("monitor_id").notNull(),
  checkedAt: text("checked_at").notNull(),
  ok: boolean("ok").notNull(),
  status: text("status").notNull().default("up"),
  statusCode: integer("status_code"),
  latencyMs: integer("latency_ms"),
  error: text("error"),
  failedAssertions: text("failed_assertions").notNull().default("[]"),
  diagnostics: text("diagnostics").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(now()),
  ...ownableColumns(),
});

export const monitorIncidents = table("monitor_incidents", {
  id: text("id").primaryKey(),
  monitorId: text("monitor_id").notNull(),
  startedAt: text("started_at").notNull(),
  resolvedAt: text("resolved_at"),
  status: text("status").notNull().default("down"),
  severity: text("severity").notNull().default("critical"),
  cause: text("cause").notNull().default(""),
  lastError: text("last_error"),
  notificationId: text("notification_id"),
  notificationDelivered: boolean("notification_delivered")
    .notNull()
    .default(false),
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
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  published: boolean("published").notNull().default(false),
  showUptimeBars: boolean("show_uptime_bars").notNull().default(true),
  showOverallUptime: boolean("show_overall_uptime").notNull().default(true),
  showResponseTime: boolean("show_response_time").notNull().default(false),
  density: text("density", { enum: ["comfortable", "compact"] })
    .notNull()
    .default("comfortable"),
  alignment: text("alignment", { enum: ["left", "center"] })
    .notNull()
    .default("left"),
  monitors: text("monitors").notNull().default("[]"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});
