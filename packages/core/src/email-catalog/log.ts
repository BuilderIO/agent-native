/**
 * Durable send log for transactional emails.
 *
 * Written by `sendEmail` on every attempt, successful or not. Read by Dispatch
 * to report per-email send counts and last-sent without depending on the
 * provider's activity retention window.
 */

import { randomUUID } from "node:crypto";

import { getDbExec, isPostgres } from "../db/client.js";
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../db/ddl-guard.js";
import { getRequestOrgId } from "../server/request-context.js";

let _initPromise: Promise<void> | undefined;

const ADDITIVE_TEXT_COLUMNS = ["request_payload", "response_body"] as const;

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
      const client = getDbExec();
      // Generic INTEGER maps to BIGINT on Postgres, which millisecond
      // timestamps need.
      const createSql = isPostgres()
        ? EMAIL_LOG_CREATE_SQL.replace(/\bINTEGER\b/g, "BIGINT")
        : EMAIL_LOG_CREATE_SQL;
      if (isPostgres()) {
        await ensureTableExists("email_log", createSql);
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
        return;
      }

      await client.execute(createSql);
      const addColumn = async (column: string, type: string) => {
        try {
          await client.execute(
            `ALTER TABLE email_log ADD COLUMN ${column} ${type}`,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (!/already exists|duplicate column name/i.test(message)) {
            throw error;
          }
          console.info(
            `[agent-native:email] email_log.${column} already exists during local bootstrap`,
          );
        }
      };
      await addColumn("org_id", "TEXT");
      await addColumn("request_payload", "TEXT");
      await addColumn("response_status", "INTEGER");
      await addColumn("response_body", "TEXT");
      await client.execute(EMAIL_LOG_TEMPLATE_INDEX_SQL);
      await client.execute(EMAIL_LOG_ORG_APP_INDEX_SQL);
      await client.execute(EMAIL_LOG_ORG_STATUS_INDEX_SQL);
      await client.execute(EMAIL_LOG_ORG_PROVIDER_INDEX_SQL);
    })().catch((error) => {
      // Don't memoize a failed bootstrap — the next send should retry rather
      // than log nothing forever.
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
  /** Set when the call never reached the provider (threw before/without an HTTP response). */
  error?: string;
  provider: string;
  /** Exact outbound JSON body sent to the provider, credential- and attachment-body-free. */
  requestPayload?: string;
  /** Raw HTTP status code from the provider, when a response was received. */
  responseStatus?: number;
  /** Raw HTTP response body text from the provider, when a response was received. */
  responseBody?: string;
}

/**
 * Append one send record.
 *
 * Callers treat logging as best-effort: a logging failure must not turn a
 * delivered email into a thrown send. The failure is surfaced on the console
 * rather than swallowed, so a persistently broken log is visible instead of
 * quietly producing an empty activity view.
 */
export async function recordEmailSend(
  args: RecordEmailSendArgs,
): Promise<void> {
  try {
    await ensureTable();
    const orgId = args.orgId ?? getRequestOrgId() ?? null;
    await getDbExec().execute({
      sql: `INSERT INTO email_log
        (id, org_id, template_id, app, recipient, sender, subject, status, error, provider, request_payload, response_status, response_body, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

/**
 * Per-template send counts and last-sent, for sends at or after `since`.
 * Templates with no rows are absent from the result — callers distinguish
 * "never sent" from "sent zero times in window" by that absence.
 */
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
  /** Substring match against the recipient address. */
  to?: string;
  /** Substring match against the resolved sender address. */
  from?: string;
  status?: "sent" | "failed";
  provider?: string;
  /** Only sends at or after this Unix epoch (ms). */
  sinceMs?: number;
  /** Only sends at or before this Unix epoch (ms). */
  untilMs?: number;
  limit?: number;
  offset?: number;
}

const LOG_COLUMNS =
  "id, template_id, app, recipient, sender, subject, status, error, provider, " +
  "request_payload, response_status, response_body, created_at";

/**
 * Most recent sends for one app, newest first, combinably filtered — modeled
 * on `queryAuditEvents` so this admin-facing query builds the same way every
 * other filterable log in the framework does.
 */
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
  if (options.status) push("status = ?", options.status);
  if (options.provider) push("provider = ?", options.provider);
  if (options.to) push("recipient LIKE ?", `%${options.to}%`);
  if (options.from) push("sender LIKE ?", `%${options.from}%`);
  if (typeof options.sinceMs === "number") {
    push("created_at >= ?", Math.floor(options.sinceMs));
  }
  if (typeof options.untilMs === "number") {
    push("created_at <= ?", Math.floor(options.untilMs));
  }

  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const offset = Math.max(0, Math.floor(options.offset ?? 0));

  const { rows } = await getDbExec().execute({
    // `id DESC` breaks ties on `created_at` (millisecond resolution, so
    // concurrent/bulk sends can share a timestamp) — without it, tied rows
    // can sort differently across page requests and the Send log UI would
    // skip or duplicate entries when paging.
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
    responseBody:
      row.response_body == null ? null : String(row.response_body),
    createdAt: Number(row.created_at),
  }));
}

/** Provider category that is safe to query for one organization only. */
export function getScopedEmailProviderCategory(
  templateId: string,
  orgId: string,
): string {
  return `${templateId}::org::${encodeURIComponent(orgId)}`;
}
