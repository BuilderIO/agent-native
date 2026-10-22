import { redactArgsToJson } from "../audit/redact.js";
import { getDbExec } from "../db/client.js";
import { ensureTableExists } from "../db/ddl-guard.js";
import { defineStore } from "../db/store-registry.js";

export const mcpApprovalsStore = defineStore({
  id: "mcp_approvals",
  migrations: [
    {
      name: "baseline",
      run: async () => {
        const createSql = `
          CREATE TABLE IF NOT EXISTS mcp_action_approvals (
            nonce TEXT PRIMARY KEY,
            caller_key TEXT NOT NULL,
            action_name TEXT NOT NULL,
            arguments_hash TEXT NOT NULL,
            expires_at BIGINT NOT NULL,
            consumed_at BIGINT
          )
        `;
        await ensureTableExists("mcp_action_approvals", createSql);
      },
    },
    {
      name: "review-page-columns",
      sql: [
        "ALTER TABLE mcp_action_approvals ADD COLUMN IF NOT EXISTS owner_email TEXT",
        "ALTER TABLE mcp_action_approvals ADD COLUMN IF NOT EXISTS org_id TEXT",
        "ALTER TABLE mcp_action_approvals ADD COLUMN IF NOT EXISTS app_id TEXT",
        "ALTER TABLE mcp_action_approvals ADD COLUMN IF NOT EXISTS call_arguments TEXT",
        "ALTER TABLE mcp_action_approvals ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'",
        "ALTER TABLE mcp_action_approvals ADD COLUMN IF NOT EXISTS prompt_answered_at BIGINT",
        "ALTER TABLE mcp_action_approvals ADD COLUMN IF NOT EXISTS approver_email TEXT",
        "ALTER TABLE mcp_action_approvals ADD COLUMN IF NOT EXISTS approved_at BIGINT",
        "ALTER TABLE mcp_action_approvals ADD COLUMN IF NOT EXISTS denied_at BIGINT",
        "ALTER TABLE mcp_action_approvals ADD COLUMN IF NOT EXISTS created_at BIGINT",
        "ALTER TABLE mcp_action_approvals ADD COLUMN IF NOT EXISTS run_status TEXT",
        "ALTER TABLE mcp_action_approvals ADD COLUMN IF NOT EXISTS run_settled_at BIGINT",
        "ALTER TABLE mcp_action_approvals ADD COLUMN IF NOT EXISTS oauth_client_id TEXT",
        "ALTER TABLE mcp_action_approvals ADD COLUMN IF NOT EXISTS retry_safe BOOLEAN NOT NULL DEFAULT FALSE",
        "CREATE INDEX IF NOT EXISTS idx_mcp_action_approvals_call ON mcp_action_approvals (caller_key, action_name, arguments_hash)",
      ],
    },
  ],
});

export function ensureApprovalTable(): Promise<void> {
  return mcpApprovalsStore.ready();
}

/**
 * The app a grant belongs to. Apps can share a database and an origin, and
 * have actions with the same name, so only the app that asked uses a grant.
 */
export function mcpApprovalAppId(config: {
  appId?: string;
  name: string;
}): string {
  return config.appId ?? config.name;
}

/** The identity of one exact call, as a grant binds it. */
export interface McpApprovalCall {
  appId: string;
  callerKey: string;
  actionName: string;
  argumentsHash: string;
}

/** What a grant binds: one caller, one action, one exact call, until it expires. */
export interface McpApprovalGrant extends McpApprovalCall {
  nonce: string;
  expiresAt: number;
}

/**
 * A grant as it is created: the call it binds, who asked for it, and the
 * arguments the review page renders. The page renders nothing else the caller
 * sent. The arguments are stored redacted, as the audit log stores them.
 */
export interface NewMcpApprovalGrant extends McpApprovalGrant {
  ownerEmail: string;
  orgId: string | null;
  /** From `storedApprovalArguments`; null when they could not be stored. */
  argumentsJson: string | null;
  /** The OAuth client whose connection made the call, if it used one. */
  oauthClientId: string | undefined;
  /** The action declares that running this exact call again can't duplicate it. */
  retrySafe: boolean;
}

/**
 * `pending` until someone answers; every other status is final. A client's
 * approve answers and uses the grant at once, while a review page approval
 * waits for the identical call to come back and use it. `denied` is a
 * person's explicit no, on the page or in the client's form. `declined` is a
 * client that declined or cancelled its prompt, which may have been the
 * client itself, so the caller gets a new grant to review on the page.
 */
export type McpApprovalStatus = "pending" | "approved" | "denied" | "declined";

/**
 * How the run a used grant allowed went. `failed` wrote nothing; `unknown`
 * failed after it may have written, which a person must know before they
 * approve the same call again.
 */
export type McpApprovalRunStatus =
  | "running"
  | "completed"
  | "failed"
  | "unknown";

export interface McpApprovalRecord extends McpApprovalGrant {
  ownerEmail: string | null;
  orgId: string | null;
  /**
   * The redacted arguments as JSON while the grant can still be approved or
   * used; null once it is final or expired, or when none were stored.
   */
  argumentsJson: string | null;
  oauthClientId: string | null;
  retrySafe: boolean;
  status: McpApprovalStatus;
  /** Who decided on the review page; null when the MCP client answered. */
  approverEmail: string | null;
  approvedAt: number | null;
  deniedAt: number | null;
  createdAt: number | null;
  consumedAt: number | null;
  runStatus: McpApprovalRunStatus | null;
  runSettledAt: number | null;
}

const RECORD_COLUMNS = `nonce, caller_key, action_name, arguments_hash, expires_at, consumed_at, owner_email, org_id, app_id, call_arguments, oauth_client_id, retry_safe, status, approver_email, approved_at, denied_at, created_at, run_status, run_settled_at`;

// Wide enough to review a long message body; past it the stored copy is
// truncated, which the review page shows.
const STORED_ARGUMENT_LIMITS = { maxJson: 64_000, maxString: 8_000 };

/** The call's arguments as a grant stores them: redacted, and capped. */
export function storedApprovalArguments(args: unknown): string | null {
  return redactArgsToJson(args ?? {}, STORED_ARGUMENT_LIMITS);
}

export function normalizeApprovalEmail(email: string): string {
  return email.trim().toLowerCase();
}

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function stringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

// Every read matches `app_id`, so a row read here always has one.
function recordFromRow(row: Record<string, unknown>): McpApprovalRecord {
  const status = String(row.status ?? "pending");
  const runStatus = stringOrNull(row.run_status);
  const expiresAt = Number(row.expires_at);
  const consumedAt = numberOrNull(row.consumed_at);
  const live =
    (status === "pending" || status === "approved") &&
    consumedAt === null &&
    expiresAt >= Date.now();
  return {
    nonce: String(row.nonce),
    appId: String(row.app_id),
    callerKey: String(row.caller_key),
    actionName: String(row.action_name),
    argumentsHash: String(row.arguments_hash),
    expiresAt,
    consumedAt,
    ownerEmail: stringOrNull(row.owner_email),
    orgId: stringOrNull(row.org_id),
    argumentsJson: live ? stringOrNull(row.call_arguments) : null,
    oauthClientId: stringOrNull(row.oauth_client_id),
    retrySafe: row.retry_safe === true,
    status:
      status === "approved" || status === "denied" || status === "declined"
        ? status
        : "pending",
    approverEmail: stringOrNull(row.approver_email),
    approvedAt: numberOrNull(row.approved_at),
    deniedAt: numberOrNull(row.denied_at),
    createdAt: numberOrNull(row.created_at),
    runStatus:
      runStatus === "running" ||
      runStatus === "completed" ||
      runStatus === "failed" ||
      runStatus === "unknown"
        ? runStatus
        : null,
    runSettledAt: numberOrNull(row.run_settled_at),
  };
}

export async function createMcpApprovalGrant(
  grant: NewMcpApprovalGrant,
): Promise<void> {
  await ensureApprovalTable();
  const client = getDbExec();
  const now = Date.now();
  await client.execute({
    sql: `INSERT INTO mcp_action_approvals (nonce, caller_key, action_name, arguments_hash, expires_at, consumed_at, owner_email, org_id, app_id, call_arguments, oauth_client_id, retry_safe, status, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    args: [
      grant.nonce,
      grant.callerKey,
      grant.actionName,
      grant.argumentsHash,
      grant.expiresAt,
      normalizeApprovalEmail(grant.ownerEmail),
      grant.orgId,
      grant.appId,
      grant.argumentsJson,
      grant.oauthClientId ?? null,
      grant.retrySafe,
      now,
    ],
  });
}

// Far past the prior-run window; a row this old is deleted.
const GRANT_RETENTION_MS = 24 * 60 * 60_000;

/**
 * Clears the stored arguments of every grant that can no longer be approved
 * or used, and deletes grants a day past their expiry. Runs on the recurring
 * sweep, so it doesn't wait for a new grant; a failure throws for the sweep
 * to report.
 */
export async function pruneMcpApprovalGrants(now = Date.now()): Promise<void> {
  await ensureApprovalTable();
  const client = getDbExec();
  await client.execute({
    sql: `UPDATE mcp_action_approvals SET call_arguments = NULL
      WHERE call_arguments IS NOT NULL
        AND (expires_at < ? OR consumed_at IS NOT NULL OR status IN ('denied', 'declined'))`,
    args: [now],
  });
  await client.execute({
    sql: `DELETE FROM mcp_action_approvals WHERE expires_at < ?`,
    args: [now - GRANT_RETENTION_MS],
  });
}

/**
 * The client approved the grant it was asked about: approves and uses it in
 * one step. Refused once the client has answered, the grant is used or
 * ended, or it expired.
 */
export async function consumeMcpApprovalGrant(
  grant: McpApprovalGrant,
): Promise<boolean> {
  await ensureApprovalTable();
  const now = Date.now();
  const result = await getDbExec().execute({
    sql: `UPDATE mcp_action_approvals
      SET consumed_at = ?,
        prompt_answered_at = ?,
        status = 'approved',
        approved_at = COALESCE(approved_at, ?),
        run_status = 'running',
        call_arguments = NULL
      WHERE nonce = ?
        AND app_id = ?
        AND caller_key = ?
        AND action_name = ?
        AND arguments_hash = ?
        AND consumed_at IS NULL
        AND prompt_answered_at IS NULL
        AND status IN ('pending', 'approved')
        AND expires_at >= ?`,
    args: [
      now,
      now,
      now,
      grant.nonce,
      grant.appId,
      grant.callerKey,
      grant.actionName,
      grant.argumentsHash,
      now,
    ],
  });
  return result.rowsAffected === 1;
}

/**
 * The client answered its prompt without approving it. `opened` is a URL
 * prompt the person accepted, so the grant waits for the review page;
 * `declined` and `denied` end it. The client cannot answer a grant twice:
 * false when it already had, or the grant is used, decided or expired.
 */
export async function answerMcpApprovalPrompt(
  grant: McpApprovalGrant,
  answer: "opened" | "declined" | "denied",
): Promise<boolean> {
  await ensureApprovalTable();
  const now = Date.now();
  const status =
    answer === "denied"
      ? `, status = 'denied', denied_at = ?, call_arguments = NULL`
      : answer === "declined"
        ? `, status = 'declined', call_arguments = NULL`
        : "";
  const result = await getDbExec().execute({
    sql: `UPDATE mcp_action_approvals
      SET prompt_answered_at = ?${status}
      WHERE nonce = ?
        AND app_id = ?
        AND caller_key = ?
        AND action_name = ?
        AND arguments_hash = ?
        AND status = 'pending'
        AND consumed_at IS NULL
        AND prompt_answered_at IS NULL
        AND expires_at >= ?`,
    args: [
      now,
      ...(answer === "denied" ? [now] : []),
      grant.nonce,
      grant.appId,
      grant.callerKey,
      grant.actionName,
      grant.argumentsHash,
      now,
    ],
  });
  return result.rowsAffected === 1;
}

/**
 * Uses a grant a person approved on the review page for this exact call, if
 * there is one (`nonce`, when given): once, by this caller, before it
 * expires.
 */
export async function consumeReviewedMcpApprovalGrant(
  call: McpApprovalCall,
  nonce?: string,
): Promise<McpApprovalRecord | null> {
  await ensureApprovalTable();
  const client = getDbExec();
  const now = Date.now();
  const { rows } = await client.execute({
    sql: `SELECT ${RECORD_COLUMNS} FROM mcp_action_approvals
      WHERE app_id = ?
        AND caller_key = ?
        AND action_name = ?
        AND arguments_hash = ?
        AND status = 'approved'
        AND consumed_at IS NULL
        AND expires_at >= ?${nonce === undefined ? "" : " AND nonce = ?"}
      ORDER BY approved_at ASC
      LIMIT 5`,
    args: [
      call.appId,
      call.callerKey,
      call.actionName,
      call.argumentsHash,
      now,
      ...(nonce === undefined ? [] : [nonce]),
    ],
  });
  for (const row of rows as Record<string, unknown>[]) {
    const record = recordFromRow(row);
    const result = await client.execute({
      sql: `UPDATE mcp_action_approvals
        SET consumed_at = ?, run_status = 'running', call_arguments = NULL
        WHERE nonce = ?
          AND status = 'approved'
          AND consumed_at IS NULL
          AND expires_at >= ?`,
      args: [now, record.nonce, now],
    });
    if (result.rowsAffected === 1) {
      return {
        ...record,
        consumedAt: now,
        runStatus: "running",
        argumentsJson: null,
      };
    }
  }
  return null;
}

/** Records how the run a used grant allowed ended. */
export async function recordMcpApprovalRun(
  nonce: string,
  status: "completed" | "failed" | "unknown",
): Promise<void> {
  await ensureApprovalTable();
  await getDbExec().execute({
    sql: `UPDATE mcp_action_approvals
      SET run_status = ?, run_settled_at = ?
      WHERE nonce = ? AND run_status = 'running'`,
    args: [status, Date.now(), nonce],
  });
}

/**
 * The latest grant this exact call used since `since` whose run may have
 * done something: it completed, it is still running, or its outcome is
 * unknown.
 */
export async function findRecentMcpApprovalRun(
  call: McpApprovalCall,
  since: number,
): Promise<McpApprovalRecord | null> {
  await ensureApprovalTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT ${RECORD_COLUMNS} FROM mcp_action_approvals
      WHERE app_id = ?
        AND caller_key = ?
        AND action_name = ?
        AND arguments_hash = ?
        AND consumed_at >= ?
        AND run_status IN ('running', 'completed', 'unknown')
      ORDER BY consumed_at DESC
      LIMIT 1`,
    args: [
      call.appId,
      call.callerKey,
      call.actionName,
      call.argumentsHash,
      since,
    ],
  });
  const row = (rows as Record<string, unknown>[])[0];
  return row ? recordFromRow(row) : null;
}

/** Who reads or decides a grant on the review page, and in which app. */
export interface McpApprovalReader {
  appId: string;
  email: string;
  orgId: string | null;
}

/** A grant as its owner may see it: same app, same user, same organization. */
export async function getMcpApprovalForOwner(
  nonce: string,
  reader: McpApprovalReader,
): Promise<McpApprovalRecord | null> {
  await ensureApprovalTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT ${RECORD_COLUMNS} FROM mcp_action_approvals
      WHERE nonce = ? AND app_id = ? AND owner_email = ? AND COALESCE(org_id, '') = ?`,
    args: [
      nonce,
      reader.appId,
      normalizeApprovalEmail(reader.email),
      reader.orgId ?? "",
    ],
  });
  const row = (rows as Record<string, unknown>[])[0];
  return row ? recordFromRow(row) : null;
}

/**
 * Whether the grant is the reader's own in this app, but from another of
 * their organizations, so the page can tell them to switch. Says nothing
 * about anyone else's grants.
 */
export async function isMcpApprovalInOtherOrganization(
  nonce: string,
  reader: McpApprovalReader,
): Promise<boolean> {
  await ensureApprovalTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT 1 FROM mcp_action_approvals
      WHERE nonce = ? AND app_id = ? AND owner_email = ? AND COALESCE(org_id, '') <> ?`,
    args: [
      nonce,
      reader.appId,
      normalizeApprovalEmail(reader.email),
      reader.orgId ?? "",
    ],
  });
  return rows.length > 0;
}

/**
 * The owner's decision on the review page. Only a pending, unused, unexpired
 * grant takes one, so a second decision, a replayed request, or a decision
 * after expiry changes nothing and returns false. Approving moves the expiry
 * to `approvedUntil`: how long the identical call has to come back and use it.
 */
export async function decideMcpApproval(
  nonce: string,
  reader: McpApprovalReader,
  decision: "approve" | "deny",
  approvedUntil: number,
): Promise<boolean> {
  await ensureApprovalTable();
  const now = Date.now();
  const owner = normalizeApprovalEmail(reader.email);
  const orgId = reader.orgId ?? "";
  const result = await getDbExec().execute({
    sql:
      decision === "approve"
        ? `UPDATE mcp_action_approvals
          SET status = 'approved', approver_email = ?, approved_at = ?, expires_at = ?
          WHERE nonce = ? AND app_id = ? AND owner_email = ? AND COALESCE(org_id, '') = ?
            AND status = 'pending' AND consumed_at IS NULL AND expires_at >= ?`
        : `UPDATE mcp_action_approvals
          SET status = 'denied', approver_email = ?, denied_at = ?, call_arguments = NULL
          WHERE nonce = ? AND app_id = ? AND owner_email = ? AND COALESCE(org_id, '') = ?
            AND status = 'pending' AND consumed_at IS NULL AND expires_at >= ?`,
    args:
      decision === "approve"
        ? [owner, now, approvedUntil, nonce, reader.appId, owner, orgId, now]
        : [owner, now, nonce, reader.appId, owner, orgId, now],
  });
  return result.rowsAffected === 1;
}
