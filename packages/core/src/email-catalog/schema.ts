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
  /** Provider error text when status is "failed". */
  error: text("error"),
  /** "resend" | "sendgrid" | "dev". */
  provider: text("provider").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const EMAIL_LOG_CREATE_SQL = `CREATE TABLE IF NOT EXISTS email_log (
  id TEXT PRIMARY KEY,
  template_id TEXT,
  app TEXT,
  recipient TEXT NOT NULL,
  sender TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  provider TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`;

export const EMAIL_LOG_TEMPLATE_INDEX_SQL = `CREATE INDEX IF NOT EXISTS email_log_template_created_idx
  ON email_log (template_id, created_at)`;
