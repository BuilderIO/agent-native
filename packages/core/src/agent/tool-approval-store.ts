import { createHash, randomUUID } from "node:crypto";

import { getDbExec, isPostgres, retryOnDdlRace } from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";
import {
  AGENT_TOOL_APPROVAL_INDEX_SQL,
  AGENT_TOOL_APPROVAL_TABLE_SQL,
} from "./tool-approval-migrations.js";

const APPROVAL_TTL_MS = 15 * 60_000;
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
        return;
      }
      const client = getDbExec();
      await retryOnDdlRace(() => client.execute(createSql));
      await retryOnDdlRace(() => client.execute(AGENT_TOOL_APPROVAL_INDEX_SQL));
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
 * Atomically consume the server-created approval for one exact tool call.
 * Client history and approval keys are only lookup input; the pending row is
 * the authorization boundary and cannot be manufactured by the client.
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
          AND tool_name = ?
          AND call_id = ?
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
      binding.toolName,
      binding.callId,
      hashAgentToolApprovalKey(binding.approvalKey),
      now,
    ],
  });
  return result.rowsAffected === 1;
}
