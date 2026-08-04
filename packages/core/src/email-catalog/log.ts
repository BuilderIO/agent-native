/**
 * Durable send log for transactional emails.
 *
 * Written by `sendEmail` on every attempt, successful or not. Read by Dispatch
 * to report per-email send counts and last-sent without depending on the
 * provider's activity retention window.
 */

import { randomUUID } from "node:crypto";

import { getDbExec, isPostgres } from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";

import {
  EMAIL_LOG_CREATE_SQL,
  EMAIL_LOG_TEMPLATE_INDEX_SQL,
} from "./schema.js";

let _initPromise: Promise<void> | undefined;

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      // Generic INTEGER maps to BIGINT on Postgres, which millisecond
      // timestamps need.
      const createSql = isPostgres()
        ? EMAIL_LOG_CREATE_SQL.replace(/\bINTEGER\b/g, "BIGINT")
        : EMAIL_LOG_CREATE_SQL;
      await ensureTableExists("email_log", createSql);
      await ensureIndexExists(
        "email_log_template_created_idx",
        EMAIL_LOG_TEMPLATE_INDEX_SQL,
      );
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
  templateId?: string;
  app?: string;
  recipient: string;
  sender: string;
  subject: string;
  status: "sent" | "failed";
  error?: string;
  provider: string;
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
    await getDbExec().execute({
      sql: `INSERT INTO email_log
        (id, template_id, app, recipient, sender, subject, status, error, provider, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        randomUUID(),
        args.templateId ?? null,
        args.app ?? null,
        args.recipient,
        args.sender,
        args.subject,
        args.status,
        args.error ?? null,
        args.provider,
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
): Promise<EmailSendStats[]> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT template_id,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        MAX(CASE WHEN status = 'sent' THEN created_at END) AS last_sent_at
      FROM email_log
      WHERE template_id IS NOT NULL AND created_at >= ?
      GROUP BY template_id`,
    args: [since],
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
  createdAt: number;
}

/** Most recent sends, newest first, optionally filtered to one template. */
export async function listEmailLog(options?: {
  templateId?: string;
  limit?: number;
}): Promise<EmailLogEntry[]> {
  await ensureTable();
  const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500);
  const where = options?.templateId ? `WHERE template_id = ?` : "";
  const args = options?.templateId ? [options.templateId, limit] : [limit];
  const { rows } = await getDbExec().execute({
    sql: `SELECT id, template_id, app, recipient, sender, subject, status, error, provider, created_at
      FROM email_log ${where} ORDER BY created_at DESC LIMIT ?`,
    args,
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
    createdAt: Number(row.created_at),
  }));
}
