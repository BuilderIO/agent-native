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

/**
 * Grouped error issues. A stable `fingerprint` (error type + top meaningful
 * stack frame, or message when there's no usable stack) collapses many
 * occurrences into one triageable issue.
 */
export const errorIssues = table(
  "error_issues",
  {
    id: text("id").primaryKey(),
    /** Stable grouping key; unique per owner scope. */
    fingerprint: text("fingerprint").notNull(),
    /** Error class/name, e.g. "TypeError" or "Error" (or "Message"). */
    type: text("type").notNull().default("Error"),
    /** Human-readable issue title (type + first line of the message). */
    title: text("title").notNull(),
    /** Best-effort culprit — the top in-app frame ("fn (file:line)"). */
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
    /** Lifetime occurrence count (monotonic; not affected by retention). */
    eventCount: integer("event_count").notNull().default(0),
    /** Approximate distinct users, recomputed over retained occurrences. */
    usersAffected: integer("users_affected").notNull().default(0),
    /** id of a representative occurrence for the detail view. */
    sampleEventId: text("sample_event_id"),
    /** Most recent linked session_recordings.id (sr_...), if any. */
    lastSessionRecordingId: text("last_session_recording_id"),
    /** Optional triage owner (email). */
    assignee: text("assignee"),
    /** Denormalized product dimensions for filtering/display. */
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

/**
 * Individual error occurrences (events). Owner-scoped like analytics_events.
 * Always read behind an issue whose access the caller already resolved through
 * `accessFilter`, and additionally filtered by owner scope for defense in
 * depth. Pruned to a bounded retention per issue at ingest time.
 */
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
    /** Normalized stack frames as JSON (ParsedStackFrame[]). */
    stack: text("stack").notNull().default("[]"),
    /** Bounded raw stack string kept for display fidelity. */
    rawStack: text("raw_stack"),
    handled: integer("handled", { mode: "boolean" }).notNull().default(true),
    url: text("url"),
    userId: text("user_id"),
    anonymousId: text("anonymous_id"),
    userKey: text("user_key"),
    sessionId: text("session_id"),
    /** Client replay id (localStorage) reported by the SDK. */
    clientRecordingId: text("client_recording_id"),
    /** Resolved session_recordings.id (sr_...) when a replay exists. */
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
