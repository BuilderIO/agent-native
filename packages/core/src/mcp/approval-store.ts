import { getDbExec, intType, isPostgres } from "../db/client.js";
import { ensureTableExists } from "../db/ddl-guard.js";

let initPromise: Promise<void> | undefined;

export async function ensureApprovalTable(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const createSql = `
        CREATE TABLE IF NOT EXISTS mcp_action_approvals (
          nonce TEXT PRIMARY KEY,
          caller_key TEXT NOT NULL,
          action_name TEXT NOT NULL,
          arguments_hash TEXT NOT NULL,
          expires_at ${intType()} NOT NULL,
          consumed_at ${intType()}
        )
      `;
      if (isPostgres()) {
        await ensureTableExists("mcp_action_approvals", createSql);
      } else {
        await getDbExec().execute(createSql);
      }
    })().catch((error) => {
      initPromise = undefined;
      throw error;
    });
  }
  return initPromise;
}

export interface McpApprovalGrant {
  nonce: string;
  callerKey: string;
  actionName: string;
  argumentsHash: string;
  expiresAt: number;
}

export async function createMcpApprovalGrant(
  grant: McpApprovalGrant,
): Promise<void> {
  await ensureApprovalTable();
  const client = getDbExec();
  await client.execute({
    sql: `INSERT INTO mcp_action_approvals (nonce, caller_key, action_name, arguments_hash, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?, NULL)`,
    args: [
      grant.nonce,
      grant.callerKey,
      grant.actionName,
      grant.argumentsHash,
      grant.expiresAt,
    ],
  });

  // This is storage hygiene only. A failed cleanup must never turn a failed
  // grant insert/consume into success, and expired rows remain unusable because
  // consumeMcpApprovalGrant checks expires_at in the atomic update below.
  try {
    await client.execute({
      sql: `DELETE FROM mcp_action_approvals WHERE expires_at < ?`,
      args: [Date.now() - 24 * 60 * 60_000],
    });
  } catch (error) {
    console.warn("[mcp] Could not clean expired action approval grants", error);
  }
}

/**
 * Atomically consume an exact grant. The UPDATE predicate is the security
 * boundary: only one hosted instance can move a matching, unexpired row from
 * pending to consumed, so an accepted response is at-most-once even when the
 * same signed requestState is replayed concurrently.
 */
export async function consumeMcpApprovalGrant(
  grant: McpApprovalGrant,
): Promise<boolean> {
  await ensureApprovalTable();
  const now = Date.now();
  const result = await getDbExec().execute({
    sql: `UPDATE mcp_action_approvals
      SET consumed_at = ?
      WHERE nonce = ?
        AND caller_key = ?
        AND action_name = ?
        AND arguments_hash = ?
        AND consumed_at IS NULL
        AND expires_at >= ?`,
    args: [
      now,
      grant.nonce,
      grant.callerKey,
      grant.actionName,
      grant.argumentsHash,
      now,
    ],
  });
  return result.rowsAffected === 1;
}
