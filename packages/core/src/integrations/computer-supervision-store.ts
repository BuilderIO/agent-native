import type { DbExec } from "../db/client.js";
import {
  getDbExec,
  intType,
  isPostgres,
  retryOnDdlRace,
} from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";
import {
  assertValidComputerCommandEnvelope,
  ComputerSupervisionError,
  computerOperationRequiresApproval,
} from "./computer-supervision.js";
import { getRemoteDeviceForOwner } from "./remote-devices-store.js";
import { serializeBoundedRemoteJson } from "./remote-json-safety.js";
import type {
  ComputerApprovalScope,
  ComputerCommandEnvelope,
  ComputerOperationClass,
} from "./remote-types.js";

export type ComputerApprovalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "consumed"
  | "expired";

export interface ComputerApprovalRecord {
  id: string;
  ownerEmail: string;
  orgId: string | null;
  deviceId: string;
  taskId: string;
  runId: string;
  operationClass: ComputerOperationClass;
  scope: ComputerApprovalScope;
  actionHash: string;
  status: ComputerApprovalStatus;
  decisionResult: Record<string, unknown> | null;
  decidedBy: string | null;
  decidedAt: number | null;
  expiresAt: number;
  consumedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

let _initPromise: Promise<void> | undefined;

export async function ensureComputerApprovalStore(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const createSql = `CREATE TABLE IF NOT EXISTS integration_computer_approvals (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  org_id TEXT,
  device_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  operation_class TEXT NOT NULL,
  approval_scope TEXT NOT NULL,
  action_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  decision_result_json TEXT,
  decided_by TEXT,
  decided_at ${intType()},
  expires_at ${intType()} NOT NULL,
  consumed_at ${intType()},
  created_at ${intType()} NOT NULL,
  updated_at ${intType()} NOT NULL
)`;
      if (isPostgres()) {
        await ensureTableExists("integration_computer_approvals", createSql);
        await ensureIndexExists(
          "idx_computer_approvals_owner",
          `CREATE INDEX IF NOT EXISTS idx_computer_approvals_owner ON integration_computer_approvals(owner_email, org_id, updated_at)`,
        );
        await ensureIndexExists(
          "idx_computer_approvals_binding",
          `CREATE INDEX IF NOT EXISTS idx_computer_approvals_binding ON integration_computer_approvals(device_id, task_id, run_id, action_hash)`,
        );
        return;
      }
      const client = getDbExec();
      await retryOnDdlRace(() => client.execute(createSql));
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_computer_approvals_owner ON integration_computer_approvals(owner_email, org_id, updated_at)`,
        ),
      );
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_computer_approvals_binding ON integration_computer_approvals(device_id, task_id, run_id, action_hash)`,
        ),
      );
    })().catch((error) => {
      _initPromise = undefined;
      throw error;
    });
  }
  return _initPromise;
}

export async function createComputerApprovalRequest(input: {
  ownerEmail: string;
  orgId?: string | null;
  deviceId: string;
  envelope: ComputerCommandEnvelope;
}): Promise<ComputerApprovalRecord> {
  const device = await getRemoteDeviceForOwner({
    id: input.deviceId,
    ownerEmail: input.ownerEmail,
    orgId: input.orgId,
  });
  if (!device || device.status !== "active") {
    throw new ComputerSupervisionError(
      "approval-mismatch",
      "Computer device does not belong to this owner and organization",
    );
  }
  await ensureComputerApprovalStore();
  const envelope = await assertValidComputerCommandEnvelope(input.envelope);
  const now = Date.now();
  const id = `computer-approval-${now}-${randomHex(8)}`;
  await getDbExec().execute({
    sql: `INSERT INTO integration_computer_approvals
      (id, owner_email, org_id, device_id, task_id, run_id, operation_class,
       approval_scope, action_hash, status, decision_result_json, decided_by,
       decided_at, expires_at, consumed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.ownerEmail,
      input.orgId ?? null,
      input.deviceId,
      envelope.taskId,
      envelope.runId,
      envelope.operationClass,
      envelope.approval.scope,
      envelope.approval.actionHash,
      "pending",
      null,
      null,
      null,
      envelope.leaseExpiresAt,
      null,
      now,
      now,
    ],
  });
  const approval = await getComputerApprovalForOwner({
    id,
    ownerEmail: input.ownerEmail,
    orgId: input.orgId,
  });
  if (!approval) throw new Error("computer approval insert failed");
  return approval;
}

export async function decideComputerApproval(input: {
  id: string;
  ownerEmail: string;
  orgId?: string | null;
  actionHash: string;
  decision: "approved" | "denied";
  decidedBy: string;
  result?: Record<string, unknown> | null;
}): Promise<ComputerApprovalRecord | null> {
  await ensureComputerApprovalStore();
  const now = Date.now();
  const resultJson = serializeDecisionResult(input.result);
  const result = await getDbExec().execute({
    sql: `UPDATE integration_computer_approvals
          SET status = ?, decision_result_json = ?, decided_by = ?,
              decided_at = ?, updated_at = ?
          WHERE id = ? AND owner_email = ?
            AND ((org_id IS NULL AND ? IS NULL) OR org_id = ?)
            AND action_hash = ? AND status = 'pending' AND expires_at > ?`,
    args: [
      input.decision,
      resultJson,
      input.decidedBy.slice(0, 240),
      now,
      now,
      input.id,
      input.ownerEmail,
      input.orgId ?? null,
      input.orgId ?? null,
      input.actionHash,
      now,
    ],
  });
  if (affectedRows(result) === 0) return null;
  return getComputerApprovalForOwner(input);
}

export async function getComputerApprovalForOwner(input: {
  id: string;
  ownerEmail: string;
  orgId?: string | null;
}): Promise<ComputerApprovalRecord | null> {
  await ensureComputerApprovalStore();
  const { rows } = await getDbExec().execute({
    sql: `SELECT * FROM integration_computer_approvals
          WHERE id = ? AND owner_email = ?
            AND ((org_id IS NULL AND ? IS NULL) OR org_id = ?)
          LIMIT 1`,
    args: [
      input.id,
      input.ownerEmail,
      input.orgId ?? null,
      input.orgId ?? null,
    ],
  });
  return rows[0] ? rowToApproval(rows[0] as Record<string, unknown>) : null;
}

export async function listComputerApprovalsForOwner(input: {
  ownerEmail: string;
  orgId?: string | null;
  deviceId?: string;
  taskId?: string;
  runId?: string;
  status?: ComputerApprovalStatus;
  limit?: number;
}): Promise<ComputerApprovalRecord[]> {
  await ensureComputerApprovalStore();
  const clauses = [
    "owner_email = ?",
    "((org_id IS NULL AND ? IS NULL) OR org_id = ?)",
  ];
  const args: Array<string | number | null> = [
    input.ownerEmail,
    input.orgId ?? null,
    input.orgId ?? null,
  ];
  if (input.deviceId) {
    clauses.push("device_id = ?");
    args.push(input.deviceId);
  }
  if (input.taskId) {
    clauses.push("task_id = ?");
    args.push(input.taskId);
  }
  if (input.runId) {
    clauses.push("run_id = ?");
    args.push(input.runId);
  }
  if (input.status) {
    clauses.push("status = ?");
    args.push(input.status);
  }
  args.push(Math.max(1, Math.min(input.limit ?? 100, 250)));
  const { rows } = await getDbExec().execute({
    sql: `SELECT * FROM integration_computer_approvals
          WHERE ${clauses.join(" AND ")}
          ORDER BY updated_at DESC
          LIMIT ?`,
    args,
  });
  return rows.map((row) => rowToApproval(row as Record<string, unknown>));
}

/**
 * Authorizes an operation immediately before it is enqueued. Callers should
 * pass their transaction handle so one-shot approval consumption and command
 * insertion commit atomically.
 */
export async function authorizeComputerOperation(
  input: {
    ownerEmail: string;
    orgId?: string | null;
    deviceId: string;
    envelope: ComputerCommandEnvelope;
    now?: number;
  },
  client: DbExec = getDbExec(),
): Promise<void> {
  const now = input.now ?? Date.now();
  if (input.envelope.leaseExpiresAt <= now) {
    throw new ComputerSupervisionError(
      "expired-lease",
      "Computer operation lease has expired",
    );
  }
  if (!computerOperationRequiresApproval(input.envelope.operationClass)) return;
  const approvalId = input.envelope.approval.id;
  if (!approvalId) {
    throw new ComputerSupervisionError(
      "approval-required",
      "Computer control requires an approved action binding",
    );
  }
  const { rows } = await client.execute({
    sql: `SELECT * FROM integration_computer_approvals
          WHERE id = ? AND owner_email = ?
            AND ((org_id IS NULL AND ? IS NULL) OR org_id = ?)
            AND device_id = ? AND task_id = ? AND run_id = ?
          LIMIT 1`,
    args: [
      approvalId,
      input.ownerEmail,
      input.orgId ?? null,
      input.orgId ?? null,
      input.deviceId,
      input.envelope.taskId,
      input.envelope.runId,
    ],
  });
  if (!rows[0]) {
    throw new ComputerSupervisionError(
      "approval-mismatch",
      "Computer approval does not belong to this owner, device, task, and run",
    );
  }
  const approval = rowToApproval(rows[0] as Record<string, unknown>);
  if (
    approval.actionHash !== input.envelope.approval.actionHash ||
    approval.operationClass !== input.envelope.operationClass ||
    approval.scope !== input.envelope.approval.scope
  ) {
    throw new ComputerSupervisionError(
      "approval-mismatch",
      "Computer approval does not match the requested action",
    );
  }
  if (approval.expiresAt <= now) {
    await client.execute({
      sql: `UPDATE integration_computer_approvals
            SET status = 'expired', updated_at = ?
            WHERE id = ? AND status IN ('pending', 'approved')`,
      args: [now, approval.id],
    });
    throw new ComputerSupervisionError(
      "approval-denied",
      "Computer approval has expired",
    );
  }
  if (approval.status !== "approved") {
    throw new ComputerSupervisionError(
      approval.status === "consumed" ? "replay" : "approval-denied",
      approval.status === "consumed"
        ? "One-shot computer approval has already been consumed"
        : "Computer action is not approved",
    );
  }
  if (approval.scope !== "once") return;
  const result = await client.execute({
    sql: `UPDATE integration_computer_approvals
          SET status = 'consumed', consumed_at = ?, updated_at = ?
          WHERE id = ? AND status = 'approved'`,
    args: [now, now, approval.id],
  });
  if (affectedRows(result) === 0) {
    throw new ComputerSupervisionError(
      "replay",
      "One-shot computer approval has already been consumed",
    );
  }
}

function rowToApproval(row: Record<string, unknown>): ComputerApprovalRecord {
  return {
    id: String(row.id),
    ownerEmail: String(row.owner_email),
    orgId: row.org_id == null ? null : String(row.org_id),
    deviceId: String(row.device_id),
    taskId: String(row.task_id),
    runId: String(row.run_id),
    operationClass: row.operation_class as ComputerOperationClass,
    scope: row.approval_scope as ComputerApprovalScope,
    actionHash: String(row.action_hash),
    status: row.status as ComputerApprovalStatus,
    decisionResult: parseRecord(row.decision_result_json),
    decidedBy: row.decided_by == null ? null : String(row.decided_by),
    decidedAt: row.decided_at == null ? null : Number(row.decided_at),
    expiresAt: Number(row.expires_at),
    consumedAt: row.consumed_at == null ? null : Number(row.consumed_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function serializeDecisionResult(
  result: Record<string, unknown> | null | undefined,
): string | null {
  if (!result) return null;
  return serializeBoundedRemoteJson(result, {
    label: "Computer approval result",
    maxBytes: 8_192,
  });
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function affectedRows(result: {
  rowsAffected?: number;
  rows?: unknown[];
}): number {
  return (
    result.rowsAffected ??
    Number((result as { rowCount?: unknown }).rowCount ?? 0)
  );
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
