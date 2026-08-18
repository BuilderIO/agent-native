import { createHash, randomUUID } from "node:crypto";

import { getDbExec, isPostgres, retryOnDdlRace } from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";
import {
  AGENT_TOOL_APPROVAL_INDEX_SQL,
  AGENT_TOOL_APPROVAL_LOGICAL_INDEX_SQL,
  AGENT_TOOL_APPROVAL_RECOVERY_INDEX_SQL,
  AGENT_TOOL_APPROVAL_TABLE_SQL,
} from "./tool-approval-migrations.js";

// 15 minutes was too short in practice: a user who steps away mid-approval
// (switching tabs to update their client, checking something else) comes back
// to a silently expired grant with no visible error — clicking Approve just
// does nothing, because `consumeAgentToolApproval`'s `expires_at > ?` no
// longer matches. An hour gives real human latency room while still bounding
// how long a stale grant can be replayed.
const APPROVAL_TTL_MS = 60 * 60_000;
const APPROVAL_CLEANUP_AGE_MS = 24 * 60 * 60_000;

let initPromise: Promise<void> | undefined;

async function ensureAgentToolApprovalTable(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const createSql =
        AGENT_TOOL_APPROVAL_TABLE_SQL[isPostgres() ? "postgres" : "sqlite"];
      if (isPostgres()) {
        await ensureTableExists("agent_tool_approvals", createSql);
        await ensureIndexExists(
          "idx_agent_tool_approvals_binding",
          AGENT_TOOL_APPROVAL_INDEX_SQL,
        );
        await ensureIndexExists(
          "idx_agent_tool_approvals_logical",
          AGENT_TOOL_APPROVAL_LOGICAL_INDEX_SQL,
        );
        await ensureIndexExists(
          "idx_agent_tool_approvals_recovery",
          AGENT_TOOL_APPROVAL_RECOVERY_INDEX_SQL,
        );
        return;
      }
      const client = getDbExec();
      await retryOnDdlRace(() => client.execute(createSql));
      await retryOnDdlRace(() => client.execute(AGENT_TOOL_APPROVAL_INDEX_SQL));
      await retryOnDdlRace(() =>
        client.execute(AGENT_TOOL_APPROVAL_LOGICAL_INDEX_SQL),
      );
      await retryOnDdlRace(() =>
        client.execute(AGENT_TOOL_APPROVAL_RECOVERY_INDEX_SQL),
      );
    })().catch((error) => {
      initPromise = undefined;
      throw error;
    });
  }
  return initPromise;
}

export interface AgentToolApprovalBinding {
  ownerEmail: string;
  orgId?: string | null;
  threadId?: string | null;
  turnId?: string | null;
  toolName: string;
  callId: string;
  approvalKey: string;
  expiresAt?: number;
}

export function hashAgentToolApprovalKey(approvalKey: string): string {
  return createHash("sha256").update(approvalKey).digest("hex");
}

/**
 * Recover the durable scope for an approval continuation when a transport
 * drops the original turn id. A single pending logical turn is safe to
 * recover; multiple turns are deliberately ambiguous and stay unmatched.
 */
export async function resolveAgentToolApprovalTurnId(binding: {
  ownerEmail: string;
  orgId?: string | null;
  threadId?: string | null;
  requestedTurnId?: string | null;
  approvalKeys: readonly string[];
}): Promise<string | null> {
  const approvalKeys = [...new Set(binding.approvalKeys)].slice(0, 200);
  if (!binding.threadId || approvalKeys.length === 0) return null;

  await ensureAgentToolApprovalTable();
  const now = Date.now();
  const hashes = approvalKeys.map(hashAgentToolApprovalKey);
  const placeholders = hashes.map(() => "?").join(", ");
  const result = await getDbExec().execute({
    sql: `SELECT turn_id FROM agent_tool_approvals
      WHERE owner_email = ?
        AND ((org_id IS NULL AND CAST(? AS TEXT) IS NULL) OR org_id = ?)
        AND ((thread_id IS NULL AND CAST(? AS TEXT) IS NULL) OR thread_id = ?)
        AND approval_key_hash IN (${placeholders})
        AND status = 'pending'
        AND expires_at > ?
        AND turn_id IS NOT NULL`,
    args: [
      binding.ownerEmail,
      binding.orgId ?? null,
      binding.orgId ?? null,
      binding.threadId,
      binding.threadId,
      ...hashes,
      now,
    ],
  });

  const turnIds = new Set(
    (result.rows ?? [])
      .map((row) => {
        const value = (row as { turn_id?: unknown }).turn_id;
        return typeof value === "string" && value.trim() ? value.trim() : null;
      })
      .filter((turnId): turnId is string => turnId !== null),
  );
  const requestedTurnId = binding.requestedTurnId?.trim();
  if (requestedTurnId && turnIds.has(requestedTurnId)) return requestedTurnId;
  return turnIds.size === 1 ? [...turnIds][0]! : null;
}

export async function createAgentToolApproval(
  binding: AgentToolApprovalBinding,
): Promise<void> {
  await ensureAgentToolApprovalTable();
  const now = Date.now();
  const expiresAt = binding.expiresAt ?? now + APPROVAL_TTL_MS;
  await getDbExec().execute({
    sql: `INSERT INTO agent_tool_approvals
      (id, owner_email, org_id, thread_id, turn_id, tool_name, call_id,
       approval_key_hash, status, expires_at, consumed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, ?, ?)`,
    args: [
      `agent-tool-approval-${randomUUID()}`,
      binding.ownerEmail,
      binding.orgId ?? null,
      binding.threadId ?? null,
      binding.turnId ?? null,
      binding.toolName,
      binding.callId,
      hashAgentToolApprovalKey(binding.approvalKey),
      expiresAt,
      now,
      now,
    ],
  });

  // Cleanup is hygiene only. Expired rows remain unusable because consume uses
  // an atomic status and expiry predicate, so cleanup failures must not affect
  // the approval that was just recorded.
  try {
    await getDbExec().execute({
      sql: `DELETE FROM agent_tool_approvals
        WHERE expires_at < ? AND status <> 'pending'`,
      args: [now - APPROVAL_CLEANUP_AGE_MS],
    });
  } catch (error) {
    console.warn(
      "[agent] Could not clean expired tool approval records",
      error,
    );
  }
}

/**
 * Atomically consume the server-created approval for one logical tool call.
 * The model's call id is transport metadata and can change when Dispatch
 * reconstructs a paused turn, so it is deliberately not part of authorization.
 * The pending row remains the boundary: client history and approval keys alone
 * cannot manufacture a grant.
 */
export async function consumeAgentToolApproval(
  binding: AgentToolApprovalBinding,
): Promise<boolean> {
  await ensureAgentToolApprovalTable();
  const now = Date.now();
  const result = await getDbExec().execute({
    sql: `UPDATE agent_tool_approvals
      SET status = 'consumed', consumed_at = ?, updated_at = ?
      WHERE id = (
        SELECT id FROM agent_tool_approvals
        WHERE owner_email = ?
          AND ((org_id IS NULL AND CAST(? AS TEXT) IS NULL) OR org_id = ?)
          AND ((thread_id IS NULL AND CAST(? AS TEXT) IS NULL) OR thread_id = ?)
          AND ((turn_id IS NULL AND CAST(? AS TEXT) IS NULL) OR turn_id = ?)
          AND tool_name = ?
          AND approval_key_hash = ?
          AND status = 'pending'
          AND expires_at > ?
        ORDER BY created_at DESC
        LIMIT 1
      )
      AND status = 'pending'`,
    args: [
      now,
      now,
      binding.ownerEmail,
      binding.orgId ?? null,
      binding.orgId ?? null,
      binding.threadId ?? null,
      binding.threadId ?? null,
      binding.turnId ?? null,
      binding.turnId ?? null,
      binding.toolName,
      hashAgentToolApprovalKey(binding.approvalKey),
      now,
    ],
  });
  return result.rowsAffected === 1;
}
