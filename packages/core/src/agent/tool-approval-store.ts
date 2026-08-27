import { createHash, randomUUID } from "node:crypto";

import {
  getDbExec,
  getDialect,
  isPostgres,
  retryOnDdlRace,
  type DbExec,
  type DbExecQuery,
} from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";
import {
  AGENT_TOOL_APPROVAL_INDEX_SQL,
  AGENT_TOOL_APPROVAL_LOGICAL_INDEX_SQL,
  AGENT_TOOL_APPROVAL_POLICY_INDEX_SQL,
  AGENT_TOOL_APPROVAL_POLICY_TABLE_SQL,
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

let initPromise: Promise<void> | undefined;
let policyInitPromise: Promise<void> | undefined;

export async function ensureAgentToolApprovalTable(): Promise<void> {
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

export async function ensureAgentToolApprovalPolicyTable(): Promise<void> {
  if (!policyInitPromise) {
    policyInitPromise = (async () => {
      const createSql =
        AGENT_TOOL_APPROVAL_POLICY_TABLE_SQL[
          isPostgres() ? "postgres" : "sqlite"
        ];
      if (isPostgres()) {
        await ensureTableExists("agent_tool_approval_policies", createSql);
        await ensureIndexExists(
          "idx_agent_tool_approval_policies_scope",
          AGENT_TOOL_APPROVAL_POLICY_INDEX_SQL,
        );
        return;
      }
      const client = getDbExec();
      await retryOnDdlRace(() => client.execute(createSql));
      await retryOnDdlRace(() =>
        client.execute(AGENT_TOOL_APPROVAL_POLICY_INDEX_SQL),
      );
    })().catch((error) => {
      policyInitPromise = undefined;
      throw error;
    });
  }
  return policyInitPromise;
}

export interface AgentToolApprovalBinding {
  approvalId?: string;
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

export interface AgentToolApprovalPolicyBinding {
  ownerEmail: string;
  orgId?: string | null;
  toolName: string;
}

function normalizeApprovalPolicyBinding(
  binding: AgentToolApprovalPolicyBinding,
): AgentToolApprovalPolicyBinding {
  const ownerEmail = binding.ownerEmail.trim().toLowerCase();
  const toolName = binding.toolName.trim();
  if (!ownerEmail) throw new Error("Approval policy owner is required.");
  if (!toolName) throw new Error("Approval policy tool name is required.");
  return {
    ownerEmail,
    orgId: binding.orgId?.trim() || null,
    toolName,
  };
}

function approvalPolicyId(binding: AgentToolApprovalPolicyBinding): string {
  return `agent-tool-approval-policy-${createHash("sha256")
    .update(
      `${binding.ownerEmail}\u0000${binding.orgId ?? ""}\u0000${binding.toolName}`,
    )
    .digest("hex")}`;
}

export async function setAgentToolApprovalPolicy(input: {
  binding: AgentToolApprovalPolicyBinding;
  enabled: boolean;
}): Promise<void> {
  const binding = normalizeApprovalPolicyBinding(input.binding);
  await ensureAgentToolApprovalPolicyTable();
  await writeAgentToolApprovalPolicy(getDbExec(), binding, input.enabled);
}

async function writeAgentToolApprovalPolicy(
  client: Pick<DbExec, "execute">,
  binding: AgentToolApprovalPolicyBinding,
  enabled: boolean,
): Promise<void> {
  await client.execute(agentToolApprovalPolicyStatement(binding, enabled));
}

function agentToolApprovalPolicyStatement(
  binding: AgentToolApprovalPolicyBinding,
  enabled: boolean,
): DbExecQuery {
  const normalized = normalizeApprovalPolicyBinding(binding);
  const now = Date.now();
  const id = approvalPolicyId(normalized);
  return {
    sql: `INSERT INTO agent_tool_approval_policies
      (id, owner_email, org_id, tool_name, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        enabled = excluded.enabled,
        updated_at = excluded.updated_at`,
    args: [
      id,
      normalized.ownerEmail,
      normalized.orgId,
      normalized.toolName,
      enabled,
      now,
      now,
    ],
  };
}

export async function isAgentToolAlwaysAllowed(
  input: AgentToolApprovalPolicyBinding,
): Promise<boolean> {
  const binding = normalizeApprovalPolicyBinding(input);
  await ensureAgentToolApprovalPolicyTable();
  const result = await getDbExec().execute({
    sql: `SELECT 1 FROM agent_tool_approval_policies
      WHERE owner_email = ?
        AND ((org_id IS NULL AND CAST(? AS TEXT) IS NULL) OR org_id = ?)
        AND tool_name = ?
        AND enabled = TRUE
      LIMIT 1`,
    args: [binding.ownerEmail, binding.orgId, binding.orgId, binding.toolName],
  });
  return (result.rows ?? []).length > 0;
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
  approvalId?: string | null;
}): Promise<string | null> {
  const approvalKeys = [...new Set(binding.approvalKeys)].slice(0, 200);
  if (!binding.threadId || approvalKeys.length === 0) return null;

  await ensureAgentToolApprovalTable();
  const now = Date.now();
  const hashes = approvalKeys.map(hashAgentToolApprovalKey);
  const placeholders = hashes.map(() => "?").join(", ");
  if (binding.approvalId) {
    const exact = await getDbExec().execute({
      sql: `SELECT turn_id FROM agent_tool_approvals
        WHERE id = ?
          AND owner_email = ?
          AND ((org_id IS NULL AND CAST(? AS TEXT) IS NULL) OR org_id = ?)
          AND thread_id = ?
          AND approval_key_hash IN (${placeholders})
          AND turn_id IS NOT NULL
        LIMIT 1`,
      args: [
        binding.approvalId,
        binding.ownerEmail,
        binding.orgId ?? null,
        binding.orgId ?? null,
        binding.threadId,
        ...hashes,
      ],
    });
    const exactTurnId = (exact.rows ?? [])[0]?.turn_id;
    return typeof exactTurnId === "string" && exactTurnId.trim()
      ? exactTurnId.trim()
      : null;
  }
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

/**
 * Creates the durable pending-approval row and returns its id as the "ask"
 * identity for this specific gate hit. Every call is a fresh row (a fresh
 * id), including a second gate hit for the same `approvalKey` after a prior
 * grant failed to be consumed — so the id doubles as the signal the client
 * needs to tell "this approval_required is the one I already approved,
 * re-rendered" apart from "this is a NEW ask for the same tool call". See
 * `ApprovalAffordance` in client/chat/tool-call-display.tsx.
 */
export async function createAgentToolApproval(
  binding: AgentToolApprovalBinding,
): Promise<string> {
  await ensureAgentToolApprovalTable();
  const now = Date.now();
  const expiresAt = binding.expiresAt ?? now + APPROVAL_TTL_MS;
  const id = `agent-tool-approval-${randomUUID()}`;
  await getDbExec().execute({
    sql: `INSERT INTO agent_tool_approvals
      (id, owner_email, org_id, thread_id, turn_id, tool_name, call_id,
       approval_key_hash, status, expires_at, consumed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, ?, ?)`,
    args: [
      id,
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

  return id;
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
): Promise<boolean | "denied" | "consumed"> {
  await ensureAgentToolApprovalTable();
  const now = Date.now();
  if (binding.approvalId && binding.threadId) {
    const scope = {
      approvalId: binding.approvalId,
      ownerEmail: binding.ownerEmail,
      orgId: binding.orgId,
      threadId: binding.threadId,
    };
    let approval = await readAgentToolApproval(scope);
    if (
      !approval ||
      approval.turn_id !== (binding.turnId ?? null) ||
      approval.tool_name !== binding.toolName ||
      approval.approval_key_hash !==
        hashAgentToolApprovalKey(binding.approvalKey)
    ) {
      return false;
    }
    const decision = storedApprovalDecision(approval, now);
    if (decision === "consumed" || decision === "denied") return decision;
    if (decision !== "approved") return false;

    const exact = await getDbExec().execute({
      sql: `UPDATE agent_tool_approvals
        SET status = 'consumed', consumed_at = ?, updated_at = ?
        WHERE id = ? AND status IN ('approved', 'always_allowed')
          AND expires_at > ?`,
      args: [now, now, binding.approvalId, now],
    });
    if (exact.rowsAffected === 1) return true;
    approval = await readAgentToolApproval(scope);
    return storedApprovalDecision(approval, now) === "consumed"
      ? "consumed"
      : false;
  }
  const result = await getDbExec().execute({
    sql: `UPDATE agent_tool_approvals
      SET status = 'consumed', consumed_at = ?, updated_at = ?
      WHERE id = (
        SELECT candidate.id FROM agent_tool_approvals AS candidate
        WHERE candidate.owner_email = ?
          AND ((candidate.org_id IS NULL AND CAST(? AS TEXT) IS NULL) OR candidate.org_id = ?)
          AND ((candidate.thread_id IS NULL AND CAST(? AS TEXT) IS NULL) OR candidate.thread_id = ?)
          AND ((candidate.turn_id IS NULL AND CAST(? AS TEXT) IS NULL) OR candidate.turn_id = ?)
          AND candidate.tool_name = ?
          AND candidate.approval_key_hash = ?
          AND candidate.status = 'pending'
          AND candidate.expires_at > ?
          AND NOT EXISTS (
            SELECT 1 FROM agent_tool_approvals denied
            WHERE denied.owner_email = candidate.owner_email
              AND ((denied.org_id IS NULL AND candidate.org_id IS NULL)
                OR denied.org_id = candidate.org_id)
              AND ((denied.thread_id IS NULL AND candidate.thread_id IS NULL)
                OR denied.thread_id = candidate.thread_id)
              AND ((denied.turn_id IS NULL AND candidate.turn_id IS NULL)
                OR denied.turn_id = candidate.turn_id)
              AND denied.tool_name = candidate.tool_name
              AND denied.approval_key_hash = candidate.approval_key_hash
              AND denied.status = 'denied'
          )
        ORDER BY candidate.created_at DESC
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
  if (result.rowsAffected === 1) return true;

  const denied = await getDbExec().execute({
    sql: `SELECT status FROM agent_tool_approvals
      WHERE owner_email = ?
        AND ((org_id IS NULL AND CAST(? AS TEXT) IS NULL) OR org_id = ?)
        AND ((thread_id IS NULL AND CAST(? AS TEXT) IS NULL) OR thread_id = ?)
        AND ((turn_id IS NULL AND CAST(? AS TEXT) IS NULL) OR turn_id = ?)
        AND tool_name = ?
        AND approval_key_hash = ?
        AND status = 'denied'
      LIMIT 1`,
    args: [
      binding.ownerEmail,
      binding.orgId ?? null,
      binding.orgId ?? null,
      binding.threadId ?? null,
      binding.threadId ?? null,
      binding.turnId ?? null,
      binding.turnId ?? null,
      binding.toolName,
      hashAgentToolApprovalKey(binding.approvalKey),
    ],
  });
  return (denied.rows ?? []).length > 0 ? "denied" : false;
}

export type AgentToolApprovalResolution = "approved" | "denied";
export type AgentToolApprovalDecision =
  | AgentToolApprovalResolution
  | "consumed";

interface AgentToolApprovalThreadScope {
  ownerEmail: string;
  orgId?: string | null;
  threadId: string;
}

function agentToolApprovalThreadScopeWhere(
  input: AgentToolApprovalThreadScope,
): { sql: string; args: unknown[] } {
  return input.orgId == null
    ? {
        sql: "owner_email = ? AND org_id IS NULL AND thread_id = ?",
        args: [input.ownerEmail, input.threadId],
      }
    : {
        sql: "owner_email = ? AND org_id = ? AND thread_id = ?",
        args: [input.ownerEmail, input.orgId, input.threadId],
      };
}

type StoredAgentToolApproval = {
  turn_id: string | null;
  tool_name: string;
  approval_key_hash: string;
  status: string;
  expires_at: number;
};

async function readAgentToolApproval(
  input: AgentToolApprovalThreadScope & { approvalId: string },
  client: Pick<DbExec, "execute"> = getDbExec(),
): Promise<StoredAgentToolApproval | undefined> {
  const result = await client.execute({
    sql: `SELECT turn_id, tool_name, approval_key_hash, status, expires_at
      FROM agent_tool_approvals
      WHERE id = ? AND owner_email = ?
        AND ((org_id IS NULL AND CAST(? AS TEXT) IS NULL) OR org_id = ?)
        AND thread_id = ? LIMIT 1`,
    args: [
      input.approvalId,
      input.ownerEmail,
      input.orgId ?? null,
      input.orgId ?? null,
      input.threadId,
    ],
  });
  return (result.rows ?? [])[0] as StoredAgentToolApproval | undefined;
}

function storedApprovalDecision(
  approval: StoredAgentToolApproval | undefined,
  now = Date.now(),
): AgentToolApprovalDecision | null {
  if (!approval) return null;
  if (
    approval.expires_at <= now &&
    approval.status !== "consumed" &&
    approval.status !== "denied"
  ) {
    return "denied";
  }
  if (approval.status === "consumed") return "consumed";
  if (approval.status === "approved" || approval.status === "always_allowed") {
    return "approved";
  }
  if (approval.status === "denied") {
    return "denied";
  }
  return null;
}

export async function approveAgentToolApproval(
  input: AgentToolApprovalThreadScope & { approvalId: string },
): Promise<AgentToolApprovalDecision | null> {
  await ensureAgentToolApprovalTable();
  const now = Date.now();
  const result = await getDbExec().execute({
    sql: `UPDATE agent_tool_approvals
      SET status = 'approved', updated_at = ?
      WHERE id = ? AND owner_email = ?
        AND ((org_id IS NULL AND CAST(? AS TEXT) IS NULL) OR org_id = ?)
        AND thread_id = ?
        AND status = 'pending'
        AND expires_at > ?`,
    args: [
      now,
      input.approvalId,
      input.ownerEmail,
      input.orgId ?? null,
      input.orgId ?? null,
      input.threadId,
      now,
    ],
  });
  if (result.rowsAffected === 1) return "approved";
  return storedApprovalDecision(await readAgentToolApproval(input), now);
}

export async function alwaysAllowAgentToolApproval(input: {
  approval: AgentToolApprovalThreadScope & { approvalId: string };
  policy: AgentToolApprovalPolicyBinding;
}): Promise<AgentToolApprovalDecision | null> {
  await ensureAgentToolApprovalTable();
  await ensureAgentToolApprovalPolicyTable();
  const client = getDbExec();
  const now = Date.now();
  const approve: DbExecQuery = {
    sql: `UPDATE agent_tool_approvals
      SET status = 'always_allowed', updated_at = ?
      WHERE id = ? AND owner_email = ?
        AND ((org_id IS NULL AND CAST(? AS TEXT) IS NULL) OR org_id = ?)
        AND thread_id = ?
        AND tool_name = ?
        AND status = 'pending'
        AND expires_at > ?`,
    args: [
      now,
      input.approval.approvalId,
      input.approval.ownerEmail,
      input.approval.orgId ?? null,
      input.approval.orgId ?? null,
      input.approval.threadId,
      input.policy.toolName,
      now,
    ],
  };

  if (getDialect() !== "d1") {
    if (!client.transaction) {
      throw new Error("Always Allow requires transaction support.");
    }
    return client.transaction(async (tx) => {
      const claimed = await tx.execute(approve);
      if (claimed.rowsAffected === 1) {
        await writeAgentToolApprovalPolicy(tx, input.policy, true);
        return "approved";
      }
      const approval = await readAgentToolApproval(input.approval, tx);
      const decision = storedApprovalDecision(approval, now);
      if (decision === "denied") return decision;
      if (approval?.tool_name !== input.policy.toolName) return null;
      if (decision === "approved" || decision === "consumed") {
        await writeAgentToolApprovalPolicy(tx, input.policy, true);
      }
      return decision;
    });
  }
  if (!client.atomicBatch) {
    throw new Error("Always Allow requires atomic database support.");
  }

  const normalizedPolicy = normalizeApprovalPolicyBinding(input.policy);
  const policy = agentToolApprovalPolicyStatement(normalizedPolicy, true);
  policy.sql = policy.sql.replace(
    "VALUES (?, ?, ?, ?, ?, ?, ?)",
    `SELECT ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM agent_tool_approvals
        WHERE id = ? AND owner_email = ?
          AND ((org_id IS NULL AND CAST(? AS TEXT) IS NULL) OR org_id = ?)
          AND thread_id = ? AND tool_name = ?
          AND status IN ('approved', 'always_allowed', 'consumed')
          AND (status = 'consumed' OR expires_at > ?)
      )`,
  );
  policy.args = [
    ...(policy.args ?? []),
    input.approval.approvalId,
    input.approval.ownerEmail,
    input.approval.orgId ?? null,
    input.approval.orgId ?? null,
    input.approval.threadId,
    normalizedPolicy.toolName,
    now,
  ];
  await client.atomicBatch([approve, policy]);
  return storedApprovalDecision(
    await readAgentToolApproval(input.approval, client),
    now,
  );
}

export async function denyAgentToolApproval(
  input: AgentToolApprovalThreadScope & { approvalId: string },
): Promise<AgentToolApprovalResolution | null> {
  await ensureAgentToolApprovalTable();
  const client = getDbExec();
  const logical = await readAgentToolApproval(input);
  if (!logical) return null;
  if (logical.status === "consumed") return "approved";
  if (logical.status === "approved" || logical.status === "always_allowed") {
    return "approved";
  }
  if (logical.status === "denied") return "denied";
  if (logical.status === "pending" && logical.expires_at <= Date.now()) {
    return "denied";
  }
  if (logical.status !== "pending") return null;

  const logicalArgs = [
    input.approvalId,
    input.ownerEmail,
    input.orgId ?? null,
    input.orgId ?? null,
    input.threadId,
    logical.turn_id,
    logical.turn_id,
    logical.tool_name,
    logical.approval_key_hash,
  ];
  await client.execute({
    sql: `UPDATE agent_tool_approvals
      SET status = 'denied', updated_at = ?
      WHERE id = ? AND owner_email = ?
        AND ((org_id IS NULL AND CAST(? AS TEXT) IS NULL) OR org_id = ?)
        AND thread_id = ?
        AND ((turn_id IS NULL AND CAST(? AS TEXT) IS NULL) OR turn_id = ?)
        AND tool_name = ? AND approval_key_hash = ?
        AND status = 'pending'`,
    args: [Date.now(), ...logicalArgs],
  });
  const resolution = await client.execute({
    sql: `SELECT status FROM agent_tool_approvals
      WHERE id = ? AND owner_email = ?
        AND ((org_id IS NULL AND CAST(? AS TEXT) IS NULL) OR org_id = ?)
        AND thread_id = ?
        AND status IN ('approved', 'always_allowed', 'consumed', 'denied')
      LIMIT 1`,
    args: [
      input.approvalId,
      input.ownerEmail,
      input.orgId ?? null,
      input.orgId ?? null,
      input.threadId,
    ],
  });
  const status = (resolution.rows ?? [])[0]?.status;
  return status === "approved" ||
    status === "always_allowed" ||
    status === "consumed"
    ? "approved"
    : status === "denied"
      ? status
      : null;
}

export async function listAgentToolApprovalResolutions(
  input: AgentToolApprovalThreadScope,
): Promise<Record<string, AgentToolApprovalResolution>> {
  await ensureAgentToolApprovalTable();
  const scope = agentToolApprovalThreadScopeWhere(input);
  const result = await getDbExec().execute({
    sql: `SELECT id, status, expires_at FROM agent_tool_approvals
      WHERE ${scope.sql}
        AND status IN ('pending', 'approved', 'always_allowed', 'consumed', 'denied')`,
    args: scope.args,
  });
  const resolutions: Record<string, AgentToolApprovalResolution> = {};
  const now = Date.now();
  for (const row of result.rows ?? []) {
    const { id, status, expires_at } = row as {
      id?: unknown;
      status?: unknown;
      expires_at?: unknown;
    };
    if (typeof id !== "string") continue;
    if (status === "consumed") {
      resolutions[id] = "approved";
    }
    if (
      status === "denied" ||
      (status !== "consumed" && Number(expires_at) <= now)
    ) {
      resolutions[id] = "denied";
    }
  }
  return resolutions;
}

export async function deleteAgentToolApprovalsForThread(
  input: AgentToolApprovalThreadScope,
): Promise<number> {
  await ensureAgentToolApprovalTable();
  const scope = agentToolApprovalThreadScopeWhere(input);
  const result = await getDbExec().execute({
    sql: `DELETE FROM agent_tool_approvals WHERE ${scope.sql}`,
    args: scope.args,
  });
  return result.rowsAffected;
}
