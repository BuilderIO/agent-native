
import { table, text, bigint } from "../db/schema.js";

export const emailLog = table("email_log", {
  id: text("id").primaryKey(),
  orgId: text("org_id"),
  templateId: text("template_id"),
  app: text("app"),
  recipient: text("recipient").notNull(),
  sender: text("sender").notNull(),
  subject: text("subject").notNull(),
  status: text("status", { enum: ["sent", "failed"] }).notNull(),
  /**
   * Error text when the call never reached the provider or threw before/
   * outside getting an HTTP response (network error, timeout/abort, credential
   * resolution failure). Distinct from `responseStatus`/`responseBody`, which
   * capture a provider response the request DID reach, so "we never reached
   * the provider" and "the provider rejected it" stay visibly different.
   */
  error: text("error"),
  provider: text("provider").notNull(),
  /**
   * Exact outbound JSON body sent to the provider, minus the Authorization
   * header (the only secret in the request) and any attachment `content`
   * bytes (large, no diagnostic value for "who did this go to").
   */
  requestPayload: text("request_payload"),
  responseStatus: bigint("response_status", { mode: "number" }),
  responseBody: text("response_body"),
  htmlBody: text("html_body"),
  textBody: text("text_body"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
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
  html_body TEXT,
  text_body TEXT,
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
