import { randomUUID } from "node:crypto";

import { getDbExec } from "../db/client.js";
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../db/ddl-guard.js";
import { widenIntColumnsToBigInt } from "../db/widen-columns.js";
import { getRequestOrgId } from "../server/request-context.js";

let _initPromise: Promise<void> | undefined;

const ADDITIVE_TEXT_COLUMNS = [
  "request_payload",
  "response_body",
  "html_body",
  "text_body",
] as const;

export async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const {
        EMAIL_LOG_CREATE_SQL,
        EMAIL_LOG_ORG_APP_INDEX_SQL,
        EMAIL_LOG_TEMPLATE_INDEX_SQL,
        EMAIL_LOG_ORG_STATUS_INDEX_SQL,
        EMAIL_LOG_ORG_PROVIDER_INDEX_SQL,
      } = await import("./schema.js");
      const createSql = EMAIL_LOG_CREATE_SQL.replace(/\bINTEGER\b/g, "BIGINT");
      await ensureTableExists("email_log", createSql);
      await widenIntColumnsToBigInt("email_log", ["created_at"]);
      await ensureColumnExists(
        "email_log",
        "org_id",
        "ALTER TABLE email_log ADD COLUMN IF NOT EXISTS org_id TEXT",
      );
      for (const column of ADDITIVE_TEXT_COLUMNS) {
        await ensureColumnExists(
          "email_log",
          column,
          `ALTER TABLE email_log ADD COLUMN IF NOT EXISTS ${column} TEXT`,
        );
      }
      await ensureColumnExists(
        "email_log",
        "response_status",
        "ALTER TABLE email_log ADD COLUMN IF NOT EXISTS response_status BIGINT",
      );
      await ensureIndexExists(
        "email_log_template_created_idx",
        EMAIL_LOG_TEMPLATE_INDEX_SQL,
      );
      await ensureIndexExists(
        "email_log_org_app_created_idx",
        EMAIL_LOG_ORG_APP_INDEX_SQL,
      );
      await ensureIndexExists(
        "email_log_org_status_created_idx",
        EMAIL_LOG_ORG_STATUS_INDEX_SQL,
      );
      await ensureIndexExists(
        "email_log_org_provider_created_idx",
        EMAIL_LOG_ORG_PROVIDER_INDEX_SQL,
      );
    })().catch((error) => {
      _initPromise = undefined;
      throw error;
    });
  }
  return _initPromise;
}

export interface RecordEmailSendArgs {
  orgId?: string | null;
  templateId?: string;
  app?: string;
  recipient: string;
  sender: string;
  subject: string;
  status: "sent" | "failed";
  error?: string;
  provider: string;
  requestPayload?: string;
  responseStatus?: number;
  responseBody?: string;
  htmlBody?: string;
  textBody?: string;
}

export async function recordEmailSend(
  args: RecordEmailSendArgs,
): Promise<void> {
  try {
    await ensureTable();
    const orgId = args.orgId ?? getRequestOrgId() ?? null;
    await getDbExec().execute({
      sql: `INSERT INTO email_log
        (id, org_id, template_id, app, recipient, sender, subject, status, error, provider, request_payload, response_status, response_body, html_body, text_body, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        randomUUID(),
        orgId,
        args.templateId ?? null,
        args.app ?? null,
        args.recipient,
        args.sender,
        args.subject,
        args.status,
        args.error ?? null,
        args.provider,
        args.requestPayload ?? null,
        args.responseStatus ?? null,
        args.responseBody ?? null,
        args.htmlBody ?? null,
        args.textBody ?? null,
        Date.now(),
      ],
    });
  } catch (error) {
    console.error("[agent-native:email] failed to record send", error);
  }
}

export interface EmailSendStats {
  templateId: string;
  sent: number;
  failed: number;
  lastSentAt: number | null;
}

export async function getEmailSendStats(
  since: number,
  app: string,
  orgId: string,
): Promise<EmailSendStats[]> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT template_id,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        MAX(CASE WHEN status = 'sent' THEN created_at END) AS last_sent_at
      FROM email_log
      WHERE org_id = ? AND app = ? AND template_id IS NOT NULL AND created_at >= ?
      GROUP BY template_id`,
    args: [orgId, app, since],
  });
  return rows.map((row: any) => ({
    templateId: String(row.template_id),
    sent: Number(row.sent ?? 0),
    failed: Number(row.failed ?? 0),
    lastSentAt: row.last_sent_at == null ? null : Number(row.last_sent_at),
  }));
}

export interface EmailLogEntry {
  id: string;
  templateId: string | null;
  app: string | null;
  recipient: string;
  sender: string;
  subject: string;
  status: string;
  error: string | null;
  provider: string;
  requestPayload: string | null;
  responseStatus: number | null;
  responseBody: string | null;
  createdAt: number;
}

export interface ListEmailLogFilters {
  orgId: string;
  app: string;
  templateId?: string;
  excludeTemplateIds?: string[];
  to?: string;
  excludeTo?: string;
  from?: string;
  excludeFrom?: string;
  status?: "sent" | "failed";
  provider?: string;
  sinceMs?: number;
  untilMs?: number;
  limit?: number;
  offset?: number;
}

const LOG_COLUMNS =
  "id, template_id, app, recipient, sender, subject, status, error, provider, " +
  "request_payload, response_status, response_body, created_at";

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export async function listEmailLog(
  options: ListEmailLogFilters,
): Promise<EmailLogEntry[]> {
  await ensureTable();
  const where: string[] = ["org_id = ?", "app = ?"];
  const args: unknown[] = [options.orgId, options.app];
  const push = (clause: string, value: unknown) => {
    where.push(clause);
    args.push(value);
  };
  if (options.templateId) push("template_id = ?", options.templateId);
  if (options.excludeTemplateIds?.length) {
    where.push(
      `(template_id IS NULL OR template_id NOT IN (${options.excludeTemplateIds.map(() => "?").join(", ")}))`,
    );
    args.push(...options.excludeTemplateIds);
  }
  if (options.status) push("status = ?", options.status);
  if (options.provider) push("provider = ?", options.provider);
  if (options.to) {
    push("recipient LIKE ? ESCAPE '\\'", `%${escapeLikePattern(options.to)}%`);
  }
  if (options.excludeTo) {
    push(
      "recipient NOT LIKE ? ESCAPE '\\'",
      `%${escapeLikePattern(options.excludeTo)}%`,
    );
  }
  if (options.from) {
    push("sender LIKE ? ESCAPE '\\'", `%${escapeLikePattern(options.from)}%`);
  }
  if (options.excludeFrom) {
    push(
      "sender NOT LIKE ? ESCAPE '\\'",
      `%${escapeLikePattern(options.excludeFrom)}%`,
    );
  }
  if (typeof options.sinceMs === "number") {
    push("created_at >= ?", Math.floor(options.sinceMs));
  }
  if (typeof options.untilMs === "number") {
    push("created_at <= ?", Math.floor(options.untilMs));
  }

  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const offset = Math.max(0, Math.floor(options.offset ?? 0));

  const { rows } = await getDbExec().execute({
    sql: `SELECT ${LOG_COLUMNS} FROM email_log
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?`,
    args: [...args, limit, offset],
  });
  return rows.map((row: any) => ({
    id: String(row.id),
    templateId: row.template_id == null ? null : String(row.template_id),
    app: row.app == null ? null : String(row.app),
    recipient: String(row.recipient),
    sender: String(row.sender),
    subject: String(row.subject),
    status: String(row.status),
    error: row.error == null ? null : String(row.error),
    provider: String(row.provider),
    requestPayload:
      row.request_payload == null ? null : String(row.request_payload),
    responseStatus:
      row.response_status == null ? null : Number(row.response_status),
    responseBody: row.response_body == null ? null : String(row.response_body),
    createdAt: Number(row.created_at),
  }));
}

export interface EmailLogEntryBody {
  htmlBody: string | null;
  textBody: string | null;
}

/**
 * Fetch the redacted-at-write body for one send-log row, scoped to the same
 * org/app the list view is scoped to so a guessed `id` from another
 * organization or app can't be used to read a body cross-tenant. Returns
 * `null` when the row doesn't exist or isn't visible in that scope — distinct
 * from a row that exists but never had a body recorded (both `htmlBody` and
 * `textBody` `null` on the returned object).
 */
export async function getEmailLogEntryBody(options: {
  orgId: string;
  app: string;
  id: string;
}): Promise<EmailLogEntryBody | null> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT html_body, text_body FROM email_log
      WHERE id = ? AND org_id = ? AND app = ?`,
    args: [options.id, options.orgId, options.app],
  });
  const row = rows[0] as { html_body: unknown; text_body: unknown } | undefined;
  if (!row) return null;
  return {
    htmlBody: row.html_body == null ? null : String(row.html_body),
    textBody: row.text_body == null ? null : String(row.text_body),
  };
}

export function getScopedEmailProviderCategory(
  templateId: string,
  orgId: string,
): string {
  return `${templateId}::org::${encodeURIComponent(orgId)}`;
}
