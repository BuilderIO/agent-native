/**
 * Error capture schema — OWNED BY THE ERROR CAPTURE FEATURE.
 *
 * Everything exported here is re-exported from ./schema.ts via `export *`, so
 * these tables join the app's Drizzle schema namespace and are reachable as
 * `schema.<table>` throughout the server. Keep all schema changes additive
 * (never drop/rename/retype existing columns) per the storing-data rules.
 *
 * Two tables, Sentry-style:
 *  - `error_issues`  — the grouped issue (one row per fingerprint per owner
 *     scope). Ownable + shareable so an org-scoped analytics key surfaces its
 *     issues to the whole org via `accessFilter`, mirroring session_recordings.
 *  - `error_events`  — individual occurrences. High-volume, owner-scoped like
 *     `analytics_events` (plain owner columns, not `ownableColumns()`), always
 *     read behind an issue the caller already has access to, and pruned to a
 *     bounded retention per issue so occurrences can't grow unbounded.
 */
import {
  createSharesTable,
  index,
  integer,
  now,
  ownableColumns,
  table,
  text,
  uniqueIndex,
} from "@agent-native/core/db/schema";
import { boolean } from "drizzle-orm/pg-core";

export const errorIssues = table(
  "error_issues",
  {
    id: text("id").primaryKey(),
    fingerprint: text("fingerprint").notNull(),
    type: text("type").notNull().default("Error"),
    title: text("title").notNull(),
    culprit: text("culprit"),
    level: text("level", {
      enum: ["fatal", "error", "warning", "info", "debug"],
    })
      .notNull()
      .default("error"),
    status: text("status", {
      enum: ["unresolved", "resolved", "ignored"],
    })
      .notNull()
      .default("unresolved"),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    eventCount: integer("event_count").notNull().default(0),
    usersAffected: integer("users_affected").notNull().default(0),
    sampleEventId: text("sample_event_id"),
    lastSessionRecordingId: text("last_session_recording_id"),
    assignee: text("assignee"),
    app: text("app"),
    template: text("template"),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
    ...ownableColumns(),
  },
  (issue) => ({
    scopeFingerprintUnique: uniqueIndex(
      "error_issues_scope_fingerprint_idx",
    ).on(issue.ownerEmail, issue.orgId, issue.fingerprint),
    scopeLastSeenIdx: index("error_issues_scope_last_seen_idx").on(
      issue.ownerEmail,
      issue.orgId,
      issue.lastSeenAt,
    ),
    scopeStatusIdx: index("error_issues_scope_status_idx").on(
      issue.orgId,
      issue.ownerEmail,
      issue.status,
      issue.lastSeenAt,
    ),
  }),
);

export const errorIssueShares = createSharesTable("error_issue_shares");

export const errorEvents = table(
  "error_events",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    type: text("type").notNull().default("Error"),
    message: text("message").notNull().default(""),
    culprit: text("culprit"),
    level: text("level", {
      enum: ["fatal", "error", "warning", "info", "debug"],
    })
      .notNull()
      .default("error"),
    stack: text("stack").notNull().default("[]"),
    rawStack: text("raw_stack"),
    handled: boolean("handled").notNull().default(true),
    url: text("url"),
    userId: text("user_id"),
    anonymousId: text("anonymous_id"),
    userKey: text("user_key"),
    sessionId: text("session_id"),
    clientRecordingId: text("client_recording_id"),
    sessionRecordingId: text("session_recording_id"),
    release: text("release"),
    environment: text("environment"),
    tags: text("tags").notNull().default("{}"),
    extra: text("extra").notNull().default("{}"),
    breadcrumbs: text("breadcrumbs").notNull().default("[]"),
    occurredAt: text("occurred_at").notNull(),
    createdAt: text("created_at").notNull().default(now()),
    ownerEmail: text("owner_email").notNull().default("local@localhost"),
    orgId: text("org_id"),
  },
  (event) => ({
    issueOccurredIdx: index("error_events_issue_occurred_idx").on(
      event.issueId,
      event.occurredAt,
    ),
    scopeOccurredIdx: index("error_events_scope_occurred_idx").on(
      event.ownerEmail,
      event.orgId,
      event.occurredAt,
    ),
  }),
);
