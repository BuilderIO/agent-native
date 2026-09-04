/**
 * Drizzle schema for the transactional email send log.
 *
 * One row per `sendEmail` attempt, written by the transport itself so every
 * send is recorded regardless of which app or code path triggered it. This is
 * the durable record of "did we send it": the provider's own activity feed ages
 * out (SendGrid keeps 3 days without the extended-retention add-on), so send
 * counts and last-sent must not depend on it.
 *
 * Engagement (opens, clicks, bounces) is deliberately NOT stored here. Only the
 * provider knows it, and mirroring it would go stale the moment a recipient
 * opens an old message. Dispatch reads engagement live from the provider and
 * joins on `template_id`.
 */

import { table, text, integer } from "../db/schema.js";

export const emailLog = table("email_log", {
  id: text("id").primaryKey(),
  /** Organization that owns the send. Legacy rows without this are unreadable. */
  orgId: text("org_id"),
  /** Registered transactional email id, e.g. "calendar.booking-confirmed". */
  templateId: text("template_id"),
  /** App slug that sent it. */
  app: text("app"),
  /** Recipient address. */
  recipient: text("recipient").notNull(),
  /** Resolved From address, after app-sender branding is applied. */
  sender: text("sender").notNull(),
  subject: text("subject").notNull(),
  /** "sent" once the provider accepted it, or "failed". Never optimistic. */
  status: text("status", { enum: ["sent", "failed"] }).notNull(),
  /**
   * Error text when the call never reached the provider or threw before/
   * outside getting an HTTP response (network error, timeout/abort, credential
   * resolution failure). Distinct from `responseStatus`/`responseBody`, which
   * capture a provider response the request DID reach, so "we never reached
   * the provider" and "the provider rejected it" stay visibly different.
   */
  error: text("error"),
  /** "resend" | "sendgrid" | "dev". */
  provider: text("provider").notNull(),
  /**
   * Exact outbound JSON body sent to the provider, minus the Authorization
   * header (the only secret in the request) and any attachment `content`
   * bytes (large, no diagnostic value for "who did this go to").
   */
  requestPayload: text("request_payload"),
  /** Raw HTTP status code from the provider, when a response was received. */
  responseStatus: integer("response_status"),
  /** Raw HTTP response body text from the provider, when a response was received. */
  responseBody: text("response_body"),
  createdAt: integer("created_at").notNull(),
});

export const EMAIL_LOG_CREATE_SQL = `CREATE TABLE IF NOT EXISTS email_log (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  template_id TEXT,
  app TEXT,
  recipient TEXT NOT NULL,
  sender TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  provider TEXT NOT NULL,
  request_payload TEXT,
  response_status INTEGER,
  response_body TEXT,
  created_at INTEGER NOT NULL
)`;

export const EMAIL_LOG_TEMPLATE_INDEX_SQL = `CREATE INDEX IF NOT EXISTS email_log_template_created_idx
  ON email_log (template_id, created_at)`;

export const EMAIL_LOG_ORG_APP_INDEX_SQL = `CREATE INDEX IF NOT EXISTS email_log_org_app_created_idx
  ON email_log (org_id, app, created_at)`;

export const EMAIL_LOG_ORG_STATUS_INDEX_SQL = `CREATE INDEX IF NOT EXISTS email_log_org_status_created_idx
  ON email_log (org_id, status, created_at)`;

export const EMAIL_LOG_ORG_PROVIDER_INDEX_SQL = `CREATE INDEX IF NOT EXISTS email_log_org_provider_created_idx
  ON email_log (org_id, provider, created_at)`;
