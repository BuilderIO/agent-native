import crypto from "crypto";

import {
  currentExecutionFence,
  withFencedExecutionWrite,
} from "../agent/execution-fence.js";
import { getDbExec } from "../db/client.js";
import {
  ensureTableExists,
  ensureColumnExists,
  ensureIndexExists,
} from "../db/ddl-guard.js";
import { sql, type SqlFragment } from "../db/sql.js";
import { defineStore } from "../db/store-registry.js";
import { assertA2APersistablePayload } from "./persistence-safety.js";
import {
  a2aApprovalMachine,
  a2aTaskMachine,
  approvalSql,
  approvalTarget,
  taskIn,
  taskSql,
  taskTarget,
  type A2AApprovalStatus,
} from "./task-lifecycle.js";
import type { Task, Message, TaskState, Artifact } from "./types.js";

export const MAX_A2A_IDEMPOTENCY_KEY_CHARS = 128;
const A2A_IDEMPOTENCY_INDEX = "idx_a2a_tasks_owner_scope_idempotency";
const A2A_ORG_IDEMPOTENCY_INDEX = "idx_a2a_tasks_org_scope_idempotency";
const A2A_RECOVERY_INDEX = "idx_a2a_tasks_recovery_created";
export const A2A_PERSONAL_OWNER_SCOPE = "__personal__";
export const A2A_ORG_ID_OWNER_SCOPE_PREFIX = "__a2a_org_id__:";
const MAX_TASK_LIST_PAGE_SIZE = 100;

export function a2aTaskLeaseThreadId(taskId: string): string {
  return `a2a-task:${taskId}`;
}

export const A2A_TASK_CLAIM_LOST_ERROR_CODE = "a2a_task_claim_lost";

/**
 * An `updateTask` write that tasks/cancel beat. The stored task stays
 * canceled; `task` is that row, so the caller can answer with it.
 */
export class A2ATaskCanceledError extends Error {
  readonly code = "a2a_task_canceled";
  readonly task: Task;

  constructor(task: Task) {
    super(`A2A task ${task.id} was canceled`);
    this.name = "A2ATaskCanceledError";
    this.task = task;
  }
}

export interface A2ATaskListCursor {
  createdAt: number;
  id: string;
}

export const a2aTasksStore = defineStore({
  id: "a2a_tasks",
  migrations: [
    {
      name: "baseline",
      run: async () => {
        const createSql = `
          CREATE TABLE IF NOT EXISTS a2a_tasks (
            id TEXT PRIMARY KEY,
            context_id TEXT,
            status_state TEXT NOT NULL DEFAULT 'submitted',
            status_message TEXT,
            status_timestamp TEXT NOT NULL,
            history TEXT NOT NULL DEFAULT '[]',
            artifacts TEXT NOT NULL DEFAULT '[]',
            metadata TEXT,
            owner_email TEXT,
            owner_scope TEXT NOT NULL DEFAULT '',
            idempotency_key TEXT,
            created_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL
          )
        `;
        const createIdempotencyIndexSql =
          `CREATE UNIQUE INDEX IF NOT EXISTS ${A2A_IDEMPOTENCY_INDEX} ` +
          `ON a2a_tasks(owner_email, owner_scope, idempotency_key)`;
        const createOrgIdempotencyIndexSql =
          `CREATE UNIQUE INDEX IF NOT EXISTS ${A2A_ORG_IDEMPOTENCY_INDEX} ` +
          "ON a2a_tasks(owner_scope, idempotency_key) " +
          "WHERE owner_email IS NULL AND idempotency_key IS NOT NULL";
        const createRecoveryIndexSql =
          `CREATE INDEX IF NOT EXISTS ${A2A_RECOVERY_INDEX} ` +
          "ON a2a_tasks(created_at) " +
          "WHERE status_state IN ('submitted', 'working', 'processing')";
        const createApprovalsSql = `
          CREATE TABLE IF NOT EXISTS a2a_approvals (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL UNIQUE,
            owner_email TEXT NOT NULL,
            org_id TEXT,
            tool_name TEXT NOT NULL,
            tool_input TEXT NOT NULL,
            approval_key TEXT NOT NULL,
            call_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            result TEXT,
            expires_at BIGINT NOT NULL,
            created_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL
          )
        `;

        await ensureTableExists("a2a_tasks", createSql);
        await ensureColumnExists(
          "a2a_tasks",
          "owner_email",
          `ALTER TABLE a2a_tasks ADD COLUMN IF NOT EXISTS owner_email TEXT`,
        );
        await ensureColumnExists(
          "a2a_tasks",
          "owner_scope",
          `ALTER TABLE a2a_tasks ADD COLUMN IF NOT EXISTS owner_scope TEXT NOT NULL DEFAULT ''`,
        );
        await ensureColumnExists(
          "a2a_tasks",
          "idempotency_key",
          `ALTER TABLE a2a_tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT`,
        );
        await ensureIndexExists(
          A2A_IDEMPOTENCY_INDEX,
          createIdempotencyIndexSql,
        );
        await ensureIndexExists(
          A2A_ORG_IDEMPOTENCY_INDEX,
          createOrgIdempotencyIndexSql,
        );
        await ensureIndexExists(A2A_RECOVERY_INDEX, createRecoveryIndexSql);
        await ensureTableExists("a2a_approvals", createApprovalsSql);
      },
    },
  ],
});

export function ensureTable(): Promise<void> {
  return a2aTasksStore.ready();
}

export interface A2AApprovalRecord {
  id: string;
  taskId: string;
  ownerEmail: string;
  orgId: string | null;
  tool: string;
  input: unknown;
  approvalKey: string;
  callId: string;
  status: A2AApprovalStatus;
  result: string | null;
  expiresAt: number;
}

async function withDbTransaction<T>(
  client: ReturnType<typeof getDbExec>,
  fn: (tx: ReturnType<typeof getDbExec>) => Promise<T>,
): Promise<T> {
  if (client.transaction) return client.transaction(fn);
  await client.execute("BEGIN");
  try {
    const result = await fn(client);
    await client.execute("COMMIT");
    return result;
  } catch (error) {
    await client.execute("ROLLBACK").catch(() => {});
    throw error;
  }
}

function approvalFromRow(row: any): A2AApprovalRecord {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    ownerEmail: String(row.owner_email),
    orgId: row.org_id ? String(row.org_id) : null,
    tool: String(row.tool_name),
    input: JSON.parse(String(row.tool_input)),
    approvalKey: String(row.approval_key),
    callId: String(row.call_id),
    status: a2aApprovalMachine.parseState(row.status),
    result: row.result ? String(row.result) : null,
    expiresAt: Number(row.expires_at),
  };
}

export async function createA2AApproval(input: {
  taskId: string;
  ownerEmail: string;
  orgId?: string | null;
  tool: string;
  toolInput: unknown;
  approvalKey: string;
  callId: string;
  ttlMs?: number;
}): Promise<A2AApprovalRecord> {
  assertA2APersistablePayload(input.toolInput, "A2A approval input");
  await ensureTable();
  const id = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + (input.ttlMs ?? 15 * 60_000);
  await withFencedExecutionWrite(
    (tx) =>
      tx.execute(
        sql`INSERT INTO a2a_approvals (id, task_id, owner_email, org_id, tool_name, tool_input, approval_key, call_id, status, expires_at, created_at, updated_at) VALUES (${sql.value(id)}, ${sql.value(input.taskId)}, ${sql.value(input.ownerEmail)}, ${sql.value(input.orgId ?? null)}, ${sql.value(input.tool)}, ${sql.value(JSON.stringify(input.toolInput ?? {}))}, ${sql.value(input.approvalKey)}, ${sql.value(input.callId)}, ${approvalSql(a2aApprovalMachine.initial)}, ${sql.value(expiresAt)}, ${sql.value(now)}, ${sql.value(now)})`,
      ),
    { threadId: a2aTaskLeaseThreadId(input.taskId), turnId: input.taskId },
  );
  return {
    id,
    taskId: input.taskId,
    ownerEmail: input.ownerEmail,
    orgId: input.orgId ?? null,
    tool: input.tool,
    input: input.toolInput ?? {},
    approvalKey: input.approvalKey,
    callId: input.callId,
    status: a2aApprovalMachine.initial,
    result: null,
    expiresAt,
  };
}

export async function getA2AApprovalForOwner(
  id: string,
  ownerEmail: string,
  orgId?: string | null,
): Promise<A2AApprovalRecord | null> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT * FROM a2a_approvals WHERE id = ? AND owner_email = ? AND (org_id IS NULL OR org_id = ?)`,
    args: [id, ownerEmail, orgId ?? null],
  });
  return rows[0] ? approvalFromRow(rows[0]) : null;
}

export async function claimA2AApproval(
  id: string,
  ownerEmail: string,
  orgId?: string | null,
): Promise<A2AApprovalRecord | null> {
  await ensureTable();
  const current = await getA2AApprovalForOwner(id, ownerEmail, orgId);
  if (!current) return null;
  if (current.status === "pending" && current.expiresAt <= Date.now()) {
    return null;
  }
  const taskId = current.taskId;
  assertA2AApprovalFence(taskId);
  const now = Date.now();
  class ClaimRejected extends Error {}
  try {
    return await withFencedExecutionWrite(
      async (tx) => {
        const approvalUpdate = await tx.execute(
          sql`UPDATE a2a_approvals SET status = ${approvalTarget("claim")}, updated_at = ${sql.value(now)} WHERE id = ${sql.value(id)} AND owner_email = ${sql.value(ownerEmail)} AND ((status = ${approvalSql("pending")} AND expires_at > ${sql.value(now)}) OR status = ${approvalSql("processing")}) AND (org_id IS NULL OR org_id = ${sql.value(orgId ?? null)})`,
        );
        if (getAffectedRowCount(approvalUpdate) === 0)
          throw new ClaimRejected();
        const { rows } = await tx.execute(
          sql`SELECT * FROM a2a_approvals WHERE id = ${sql.value(id)} AND owner_email = ${sql.value(ownerEmail)} AND status = ${approvalSql("processing")}`,
        );
        if (!rows[0]) throw new ClaimRejected();
        const approval = approvalFromRow(rows[0]);
        const timestamp = new Date(now).toISOString();
        const runningMessage: Message = {
          role: "agent",
          parts: [{ type: "text", text: "Approved action is running." }],
        };
        const taskUpdate = await tx.execute(
          sql`UPDATE a2a_tasks SET status_state = ${taskTarget("resumeAfterApproval")}, status_message = ${sql.value(JSON.stringify(runningMessage))}, status_timestamp = ${sql.value(timestamp)}, updated_at = ${sql.value(now)} WHERE id = ${sql.value(approval.taskId)} AND owner_email = ${sql.value(ownerEmail)} AND status_state IN ${taskIn("resumeAfterApproval")}`,
        );
        if (getAffectedRowCount(taskUpdate) === 0) throw new ClaimRejected();
        return approval;
      },
      { threadId: a2aTaskLeaseThreadId(taskId), turnId: taskId },
    );
  } catch (error) {
    if (error instanceof ClaimRejected) return null;
    throw error;
  }
}

export async function settleA2AApproval(
  id: string,
  status: "completed" | "failed",
  resultText: string,
): Promise<void> {
  let settledStatus = status;
  let settledText = resultText;
  try {
    assertA2APersistablePayload(resultText, "A2A approval result");
  } catch {
    settledStatus = "failed";
    settledText =
      "The approved action result could not be safely stored. Verify its outcome before retrying.";
  }
  await ensureTable();
  const client = getDbExec();
  const { rows: approvalRows } = await client.execute(
    sql`SELECT task_id FROM a2a_approvals WHERE id = ${sql.value(id)} AND status = ${approvalSql("processing")}`,
  );
  if (!approvalRows[0]) throw new Error("Approval is not processing");
  const taskId = String((approvalRows[0] as any).task_id);
  assertA2AApprovalFence(taskId);
  const now = Date.now();
  const message: Message = {
    role: "agent",
    parts: [{ type: "text", text: settledText }],
  };
  await withFencedExecutionWrite(
    async (tx) => {
      const { rows } = await tx.execute(
        sql`SELECT task_id FROM a2a_approvals WHERE id = ${sql.value(id)} AND status = ${approvalSql("processing")}`,
      );
      if (!rows[0]) throw new Error("Approval is not processing");
      const taskId = String((rows[0] as any).task_id);
      const { rows: taskRows } = await tx.execute(
        sql`SELECT history FROM a2a_tasks WHERE id = ${sql.value(taskId)} AND status_state = ${taskSql("working")}`,
      );
      if (!taskRows[0]) {
        throw new Error("Approval task is no longer awaiting settlement");
      }
      const history = JSON.parse(String((taskRows[0] as any).history));
      history.push(message);
      assertA2APersistablePayload(history, "A2A task history");
      const timestamp = new Date(now).toISOString();
      const taskUpdate = await tx.execute(
        sql`UPDATE a2a_tasks SET status_state = ${sql.value(settledStatus)}, status_message = ${sql.value(JSON.stringify(message))}, status_timestamp = ${sql.value(timestamp)}, history = ${sql.value(JSON.stringify(history))}, updated_at = ${sql.value(now)} WHERE id = ${sql.value(taskId)} AND status_state = ${taskSql("working")}`,
      );
      if (getAffectedRowCount(taskUpdate) === 0) {
        throw new Error("Approval task settlement lost its state claim");
      }
      const approvalUpdate = await tx.execute(
        sql`UPDATE a2a_approvals SET status = ${sql.value(settledStatus)}, result = ${sql.value(settledText)}, updated_at = ${sql.value(now)} WHERE id = ${sql.value(id)} AND status = ${approvalSql("processing")}`,
      );
      if (getAffectedRowCount(approvalUpdate) === 0) {
        throw new Error("Approval settlement lost its state claim");
      }
    },
    { threadId: a2aTaskLeaseThreadId(taskId), turnId: taskId },
  );
}

function assertA2AApprovalFence(taskId: string): void {
  const fence = currentExecutionFence();
  if (
    !fence ||
    fence.threadId !== a2aTaskLeaseThreadId(taskId) ||
    fence.turnId !== taskId
  ) {
    throw new Error(
      "A2A approval transitions require the task execution fence",
    );
  }
}

export async function pauseProcessingA2ATask(
  id: string,
  message: Message,
): Promise<Task | null> {
  assertA2APersistablePayload(message, "A2A task status message");
  await ensureTable();
  return withFencedExecutionWrite(
    async (tx) => {
      const { rows } = await tx.execute(
        sql`SELECT * FROM a2a_tasks WHERE id = ${sql.value(id)} AND status_state = ${taskSql("processing")}`,
      );
      if (!rows[0]) return null;
      const task = taskFromRow(rows[0]);
      task.history?.push(message);
      assertA2APersistablePayload(task.history, "A2A task history");
      const now = Date.now();
      const timestamp = new Date(now).toISOString();
      const result = await tx.execute(
        sql`UPDATE a2a_tasks SET status_state = ${taskTarget("requireInput")}, status_message = ${sql.value(JSON.stringify(message))}, status_timestamp = ${sql.value(timestamp)}, history = ${sql.value(JSON.stringify(task.history ?? []))}, updated_at = ${sql.value(now)} WHERE id = ${sql.value(id)} AND status_state = ${taskSql("processing")}`,
      );
      if (getAffectedRowCount(result) === 0) return null;
      task.status = { state: "input-required", message, timestamp };
      return task;
    },
    { threadId: a2aTaskLeaseThreadId(id), turnId: id },
  );
}

function taskFromRow(row: any): Task & {
  ownerEmail?: string | null;
  ownerScope?: string | null;
} {
  return {
    id: row.id as string,
    contextId: (row.context_id as string) || undefined,
    status: {
      state: a2aTaskMachine.parseState(row.status_state),
      message: row.status_message
        ? JSON.parse(row.status_message as string)
        : undefined,
      timestamp: row.status_timestamp as string,
    },
    history: JSON.parse(row.history as string),
    artifacts: JSON.parse(row.artifacts as string),
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    ownerEmail: (row.owner_email as string | null) ?? null,
    ownerScope: (row.owner_scope as string | null) ?? null,
  };
}

function getAffectedRowCount(result: unknown): number | undefined {
  const resultRecord = result as
    | {
        rowsAffected?: number;
        rowCount?: number;
        count?: number;
      }
    | undefined;
  return (
    resultRecord?.rowsAffected ?? resultRecord?.rowCount ?? resultRecord?.count
  );
}

export async function createTask(
  message: Message,
  contextId?: string,
  metadata?: Record<string, unknown>,
  ownerEmail?: string | null,
  ownerScope?: string | null,
): Promise<Task> {
  assertA2APersistablePayload(message, "A2A task message");
  assertA2APersistablePayload(metadata, "A2A task metadata");
  await ensureTable();
  const client = getDbExec();
  const id = crypto.randomUUID();
  const now = Date.now();
  const timestamp = new Date().toISOString();

  const task: Task = {
    id,
    contextId,
    status: { state: a2aTaskMachine.initial, timestamp },
    history: [message],
    artifacts: [],
    metadata,
  };

  await client.execute({
    sql: `INSERT INTO a2a_tasks (id, context_id, status_state, status_timestamp, history, artifacts, metadata, owner_email, owner_scope, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      contextId ?? null,
      a2aTaskMachine.initial,
      timestamp,
      JSON.stringify([message]),
      "[]",
      metadata ? JSON.stringify(metadata) : null,
      ownerEmail ?? null,
      ownerScope ?? "",
      null,
      now,
      now,
    ],
  });

  return task;
}

export async function createOrReuseTask(
  message: Message,
  contextId: string | undefined,
  metadata: Record<string, unknown> | undefined,
  ownerEmail: string | null,
  ownerScope: string | null,
  idempotencyKey: string | undefined,
): Promise<{ task: Task; reused: boolean }> {
  assertA2APersistablePayload(message, "A2A task message");
  assertA2APersistablePayload(metadata, "A2A task metadata");
  const normalizedOwner = ownerEmail?.trim().toLowerCase() || null;
  const normalizedScope =
    ownerScope?.trim().toLowerCase() ||
    (normalizedOwner ? A2A_PERSONAL_OWNER_SCOPE : null);
  if (!idempotencyKey || !normalizedScope) {
    return {
      task: await createTask(
        message,
        contextId,
        metadata,
        ownerEmail,
        ownerScope,
      ),
      reused: false,
    };
  }
  if (idempotencyKey.length > MAX_A2A_IDEMPOTENCY_KEY_CHARS) {
    throw new Error("A2A idempotency key is too long");
  }

  await ensureTable();
  const client = getDbExec();

  for (let attempt = 0; attempt < 2; attempt++) {
    const id = crypto.randomUUID();
    const now = Date.now();
    const timestamp = new Date().toISOString();
    await client.execute({
      sql: `INSERT INTO a2a_tasks (id, context_id, status_state, status_timestamp, history, artifacts, metadata, owner_email, owner_scope, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      args: [
        id,
        contextId ?? null,
        a2aTaskMachine.initial,
        timestamp,
        JSON.stringify([message]),
        "[]",
        metadata ? JSON.stringify(metadata) : null,
        normalizedOwner,
        normalizedScope,
        idempotencyKey,
        now,
        now,
      ],
    });

    const { rows } = await client.execute({
      sql: `SELECT * FROM a2a_tasks WHERE owner_email IS NOT DISTINCT FROM ? AND owner_scope = ? AND idempotency_key = ?`,
      args: [normalizedOwner, normalizedScope, idempotencyKey],
    });
    if (rows.length === 0) {
      throw new Error("A2A idempotent task insert could not be verified");
    }
    const task = taskFromRow(rows[0]);
    const reused = task.id !== id;
    if (
      reused &&
      (task.status.state === "failed" || task.status.state === "canceled")
    ) {
      await client.execute(
        sql`UPDATE a2a_tasks SET idempotency_key = NULL, updated_at = ${sql.value(Date.now())} WHERE id = ${sql.value(task.id)} AND idempotency_key = ${sql.value(idempotencyKey)} AND status_state IN (${taskSql("failed")}, ${taskSql("canceled")})`,
      );
      continue;
    }
    return { task, reused };
  }
  throw new Error("A2A terminal task idempotency key could not be released");
}

export interface A2ATaskOwnership {
  ownerEmail: string | null;
  ownerScope: string | null;
}

export interface A2ATaskAccessScope {
  ownerEmail: string;
  ownerScope: string | null;
}

function taskAccessPredicate(
  scope: A2ATaskAccessScope | undefined,
): SqlFragment {
  if (!scope) return sql``;
  return sql` AND LOWER(COALESCE(owner_email, '')) = LOWER(${sql.value(scope.ownerEmail)}) AND LOWER(COALESCE(owner_scope, '')) = LOWER(${sql.value(scope.ownerScope ?? "")})`;
}

export async function getTaskOwner(id: string): Promise<string | null> {
  return (await getTaskOwnership(id)).ownerEmail;
}

export async function getTaskOwnership(id: string): Promise<A2ATaskOwnership> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT owner_email, owner_scope FROM a2a_tasks WHERE id = ?`,
    args: [id],
  });
  if (rows.length === 0) return { ownerEmail: null, ownerScope: null };
  const ownerEmail = (rows[0] as any).owner_email;
  const ownerScope = (rows[0] as any).owner_scope;
  return {
    ownerEmail:
      typeof ownerEmail === "string" && ownerEmail ? ownerEmail : null,
    ownerScope:
      typeof ownerScope === "string" && ownerScope ? ownerScope : null,
  };
}

export async function claimA2ATaskForProcessing(
  id: string,
): Promise<Task | null> {
  await ensureTable();
  const now = Date.now();
  const timestamp = new Date().toISOString();

  return withFencedExecutionWrite(
    async (tx) => {
      const { rows } = await tx.execute(sql`UPDATE a2a_tasks
            SET status_state = ${taskTarget("claimForProcessing")},
                status_timestamp = ${sql.value(timestamp)},
                updated_at = ${sql.value(now)}
          WHERE id = ${sql.value(id)}
            AND status_state IN ${taskIn("claimForProcessing")}
          RETURNING *`);
      return rows.length > 0 ? taskFromRow(rows[0]) : null;
    },
    { threadId: a2aTaskLeaseThreadId(id), turnId: id },
  );
}

export async function getA2ATaskDispatchState(id: string): Promise<{
  id: string;
  statusState: string;
  metadata: Record<string, unknown> | undefined;
  updatedAt: number;
  createdAt: number;
} | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT id, status_state, metadata, created_at, updated_at FROM a2a_tasks WHERE id = ?`,
    args: [id],
  });
  const row = rows[0] as any;
  if (!row) return null;
  return {
    id: row.id as string,
    statusState: row.status_state as string,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    updatedAt: Number(row.updated_at ?? 0),
    createdAt: Number(row.created_at ?? 0),
  };
}

export async function touchQueuedA2ATaskDispatch(id: string): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const result = await client.execute(sql`UPDATE a2a_tasks
            SET updated_at = ${sql.value(now)}
          WHERE id = ${sql.value(id)}
            AND status_state IN ${taskIn("claimForProcessing")}`);
  const affected = getAffectedRowCount(result);
  return affected !== 0;
}

export async function touchProcessingA2ATask(id: string): Promise<boolean> {
  await ensureTable();
  const now = Date.now();
  const result = await withFencedExecutionWrite(
    (tx) =>
      tx.execute(sql`UPDATE a2a_tasks
            SET updated_at = ${sql.value(now)}
          WHERE id = ${sql.value(id)}
            AND status_state = ${taskSql("processing")}`),
    { threadId: a2aTaskLeaseThreadId(id), turnId: id },
  );
  const affected = getAffectedRowCount(result);
  return affected !== 0;
}

export async function resetStuckA2ATaskForRetry(
  id: string,
  processingCutoff: number,
): Promise<boolean> {
  await ensureTable();
  const now = Date.now();
  const timestamp = new Date().toISOString();
  const result = await withFencedExecutionWrite(
    (tx) =>
      tx.execute(sql`UPDATE a2a_tasks
            SET status_state = ${taskTarget("retryStuck")},
                status_timestamp = ${sql.value(timestamp)},
                updated_at = ${sql.value(now)}
          WHERE id = ${sql.value(id)}
            AND status_state = ${taskSql("processing")}
            AND updated_at <= ${sql.value(processingCutoff)}`),
    { threadId: a2aTaskLeaseThreadId(id), turnId: id },
  );
  const affected = getAffectedRowCount(result);
  return affected !== 0;
}

export async function failStuckA2ATask(
  id: string,
  processingCutoff: number,
  reason: string,
  createdAtCutoff?: number,
): Promise<boolean> {
  assertA2APersistablePayload(reason, "A2A task failure status");
  await ensureTable();
  const { ensureRunTables, lockTaskExecutionLease, revokeTaskExecutionLease } =
    await import("../agent/run-store.js");
  await ensureRunTables();
  const client = getDbExec();
  const now = Date.now();
  const timestamp = new Date().toISOString();
  const message: Message = {
    role: "agent",
    parts: [{ type: "text", text: reason }],
  };
  const ageCondition =
    createdAtCutoff !== undefined
      ? sql`AND (updated_at <= ${sql.value(processingCutoff)} OR created_at <= ${sql.value(createdAtCutoff)})`
      : sql`AND updated_at <= ${sql.value(processingCutoff)}`;
  return withDbTransaction(client, async (tx) => {
    const leaseThreadId = a2aTaskLeaseThreadId(id);
    await lockTaskExecutionLease(tx, leaseThreadId, id);
    const result = await tx.execute(sql`UPDATE a2a_tasks
              SET status_state = ${taskTarget("failStuckProcessing")},
                  status_message = ${sql.value(JSON.stringify(message))},
                  status_timestamp = ${sql.value(timestamp)},
                  updated_at = ${sql.value(now)}
            WHERE id = ${sql.value(id)}
              AND status_state = ${taskSql("processing")}
              ${ageCondition}`);
    const affected = getAffectedRowCount(result);
    if (affected === 1) {
      await revokeTaskExecutionLease(tx, leaseThreadId, id);
    }
    return affected !== 0;
  });
}

export async function failStuckQueuedA2ATask(
  id: string,
  createdAtCutoff: number,
  reason: string,
): Promise<boolean> {
  assertA2APersistablePayload(reason, "A2A task failure status");
  await ensureTable();
  const { ensureRunTables, lockTaskExecutionLease, revokeTaskExecutionLease } =
    await import("../agent/run-store.js");
  await ensureRunTables();
  const client = getDbExec();
  const now = Date.now();
  const timestamp = new Date().toISOString();
  const message: Message = {
    role: "agent",
    parts: [{ type: "text", text: reason }],
  };
  return withDbTransaction(client, async (tx) => {
    const leaseThreadId = a2aTaskLeaseThreadId(id);
    await lockTaskExecutionLease(tx, leaseThreadId, id);
    const result = await tx.execute(sql`UPDATE a2a_tasks
              SET status_state = ${taskTarget("failStuckQueued")},
                  status_message = ${sql.value(JSON.stringify(message))},
                  status_timestamp = ${sql.value(timestamp)},
                  updated_at = ${sql.value(now)}
            WHERE id = ${sql.value(id)}
              AND status_state IN ${taskIn("failStuckQueued")}
              AND created_at <= ${sql.value(createdAtCutoff)}`);
    const affected = getAffectedRowCount(result);
    if (affected === 1) {
      await revokeTaskExecutionLease(tx, leaseThreadId, id);
    }
    return affected !== 0;
  });
}

/** Fail an abandoned task and revoke any worker lease in the same transaction. */
export async function failStaleA2ATask(
  id: string,
  staleBefore: number,
  reason: string,
  errorCode: string,
): Promise<boolean> {
  assertA2APersistablePayload(reason, "A2A task failure status");
  await ensureTable();
  const { ensureRunTables, lockTaskExecutionLease, revokeTaskExecutionLease } =
    await import("../agent/run-store.js");
  await ensureRunTables();
  const client = getDbExec();
  const now = Date.now();
  const timestamp = new Date(now).toISOString();
  const message: Message = {
    role: "agent",
    parts: [{ type: "text", text: reason }],
    metadata: { errorCode },
  };
  return withDbTransaction(client, async (tx) => {
    const leaseThreadId = a2aTaskLeaseThreadId(id);
    await lockTaskExecutionLease(tx, leaseThreadId, id);
    const result = await tx.execute(sql`UPDATE a2a_tasks
              SET status_state = ${taskTarget("failStale")},
                  status_message = ${sql.value(JSON.stringify(message))},
                  status_timestamp = ${sql.value(timestamp)},
                  updated_at = ${sql.value(now)}
            WHERE id = ${sql.value(id)}
              AND status_state IN ${taskIn("failStale")}
              AND created_at < ${sql.value(staleBefore)}
              AND updated_at < ${sql.value(staleBefore)}`);
    const affected = getAffectedRowCount(result);
    if (affected === 1) {
      await revokeTaskExecutionLease(tx, leaseThreadId, id);
    }
    return affected !== 0;
  });
}

export async function getTask(
  id: string,
  accessScope?: A2ATaskAccessScope,
): Promise<Task | null> {
  await ensureTable();
  const client = getDbExec();
  const predicate = taskAccessPredicate(accessScope);
  const { rows } = await client.execute(
    sql`SELECT * FROM a2a_tasks WHERE id = ${sql.value(id)}${predicate}`,
  );
  if (rows.length === 0) return null;
  return taskFromRow(rows[0]);
}

export async function updateTask(
  id: string,
  update: {
    state?: TaskState;
    message?: Message;
    artifacts?: Artifact[];
  },
  accessScope?: A2ATaskAccessScope,
): Promise<Task | null> {
  assertA2APersistablePayload(update.message, "A2A task message");
  assertA2APersistablePayload(update.artifacts, "A2A task artifacts");
  await ensureTable();
  const predicate = taskAccessPredicate(accessScope);
  return withFencedExecutionWrite(
    async (tx) => {
      const { rows } = await tx.execute(
        sql`SELECT * FROM a2a_tasks WHERE id = ${sql.value(id)}${predicate}`,
      );
      if (rows.length === 0) return null;

      const task = taskFromRow(rows[0]);
      const now = Date.now();

      if (update.state) {
        task.status = {
          state: update.state,
          message: update.message ?? task.status.message,
          timestamp: new Date().toISOString(),
        };
      }

      if (update.message && task.history) {
        task.history.push(update.message);
      }

      if (update.artifacts) {
        task.artifacts = [...(task.artifacts ?? []), ...update.artifacts];
      }
      assertA2APersistablePayload(
        task.status.message,
        "A2A task status message",
      );
      assertA2APersistablePayload(task.history, "A2A task history");
      assertA2APersistablePayload(task.artifacts, "A2A task artifacts");

      const result = await tx.execute(
        sql`UPDATE a2a_tasks SET status_state = ${sql.value(task.status.state)}, status_message = ${sql.value(task.status.message ? JSON.stringify(task.status.message) : null)}, status_timestamp = ${sql.value(task.status.timestamp)}, history = ${sql.value(JSON.stringify(task.history))}, artifacts = ${sql.value(JSON.stringify(task.artifacts))}, updated_at = ${sql.value(now)} WHERE id = ${sql.value(id)}${predicate} AND status_state <> ${taskSql("canceled")}`,
      );
      if (getAffectedRowCount(result) === 1) return task;

      // Zero rows: the task is missing, outside the access scope, or canceled.
      // Only a canceled row is a cancel win; the others stay null.
      const { rows: current } = await tx.execute(
        sql`SELECT * FROM a2a_tasks WHERE id = ${sql.value(id)}${predicate}`,
      );
      if (current[0]) {
        const stored = taskFromRow(current[0]);
        if (stored.status.state === "canceled") {
          throw new A2ATaskCanceledError(stored);
        }
      }
      return null;
    },
    { threadId: a2aTaskLeaseThreadId(id), turnId: id },
  );
}

/**
 * `not_found` covers both a missing task and one the access scope does not
 * reach, so callers cannot tell them apart.
 */
export type A2ATaskCancelResult =
  | { status: "not_found" }
  | { status: "not_cancelable"; state: TaskState }
  | { status: "canceled"; task: Task };

/** Cancel a task and revoke its worker generation in the same transaction. */
export async function cancelA2ATask(
  id: string,
  accessScope?: A2ATaskAccessScope,
): Promise<A2ATaskCancelResult> {
  await ensureTable();
  const { ensureRunTables, lockTaskExecutionLease, revokeTaskExecutionLease } =
    await import("../agent/run-store.js");
  await ensureRunTables();
  const client = getDbExec();
  const predicate = taskAccessPredicate(accessScope);
  return withDbTransaction(client, async (tx): Promise<A2ATaskCancelResult> => {
    const leaseThreadId = a2aTaskLeaseThreadId(id);
    await lockTaskExecutionLease(tx, leaseThreadId, id);
    const { rows } = await tx.execute(
      sql`SELECT * FROM a2a_tasks WHERE id = ${sql.value(id)}${predicate} FOR UPDATE`,
    );
    if (!rows[0]) return { status: "not_found" };

    // The row lock from FOR UPDATE means the guarded UPDATE below sees this
    // same state, so a zero-row update always means "not cancelable".
    const current = taskFromRow(rows[0]);
    const timestamp = new Date().toISOString();
    const result = await tx.execute(sql`UPDATE a2a_tasks
            SET status_state = ${taskTarget("cancel")}, status_timestamp = ${sql.value(timestamp)}, updated_at = ${sql.value(Date.now())}
            WHERE id = ${sql.value(id)}${predicate}
              AND status_state IN ${taskIn("cancel")}`);
    if (getAffectedRowCount(result) !== 1) {
      return { status: "not_cancelable", state: current.status.state };
    }
    await revokeTaskExecutionLease(tx, leaseThreadId, id);
    const { message } = current.status;
    return {
      status: "canceled",
      task: {
        ...current,
        status: {
          state: "canceled",
          ...(message === undefined ? {} : { message }),
          timestamp,
        },
      },
    };
  });
}

/**
 * Persist the terminal result produced by the async processor, but only while
 * that processor still owns a task in `processing`. A tasks/get request may
 * fail an over-lifetime processor while its handler is still running; the
 * handler cannot be canceled reliably, so this compare-and-set is what keeps
 * its eventual completion (or error) from overwriting the timeout result.
 */
export async function settleProcessingA2ATask(
  id: string,
  update: {
    state: "completed" | "failed";
    message?: Message;
    artifacts?: Artifact[];
  },
): Promise<Task | null> {
  assertA2APersistablePayload(update.message, "A2A task result message");
  assertA2APersistablePayload(update.artifacts, "A2A task result artifacts");
  await ensureTable();
  return withFencedExecutionWrite(
    async (tx) => {
      const { rows } = await tx.execute({
        sql: `SELECT * FROM a2a_tasks WHERE id = ?`,
        args: [id],
      });
      if (rows.length === 0) return null;

      const task = taskFromRow(rows[0]);
      const now = Date.now();
      task.status = {
        state: update.state,
        message: update.message ?? task.status.message,
        timestamp: new Date().toISOString(),
      };
      if (update.message && task.history) {
        task.history.push(update.message);
      }
      if (update.artifacts) {
        task.artifacts = [...(task.artifacts ?? []), ...update.artifacts];
      }
      assertA2APersistablePayload(
        task.status.message,
        "A2A task status message",
      );
      assertA2APersistablePayload(task.history, "A2A task history");
      assertA2APersistablePayload(task.artifacts, "A2A task artifacts");

      const result = await tx.execute(sql`UPDATE a2a_tasks
            SET status_state = ${sql.value(task.status.state)},
                status_message = ${sql.value(task.status.message ? JSON.stringify(task.status.message) : null)},
                status_timestamp = ${sql.value(task.status.timestamp)},
                history = ${sql.value(JSON.stringify(task.history))},
                artifacts = ${sql.value(JSON.stringify(task.artifacts))},
                updated_at = ${sql.value(now)}
          WHERE id = ${sql.value(id)}
            AND status_state = ${taskSql("processing")}`);
      const affected = getAffectedRowCount(result);
      if (affected === 0) return null;
      return task;
    },
    { threadId: a2aTaskLeaseThreadId(id), turnId: id },
  );
}

export async function updateTaskStatusMessage(
  id: string,
  message: Message,
): Promise<void> {
  assertA2APersistablePayload(message, "A2A task status message");
  await ensureTable();
  const now = Date.now();
  const timestamp = new Date().toISOString();
  await withFencedExecutionWrite(
    (tx) =>
      tx.execute(sql`UPDATE a2a_tasks
            SET status_message = ${sql.value(JSON.stringify(message))},
                status_timestamp = ${sql.value(timestamp)},
                updated_at = ${sql.value(now)}
          WHERE id = ${sql.value(id)}
            AND status_state IN ${taskIn("failStale")}`),
    { threadId: a2aTaskLeaseThreadId(id), turnId: id },
  );
}

export async function listTasksPage(
  contextId?: string,
  options: { limit?: number; before?: A2ATaskListCursor } = {},
): Promise<{ tasks: Task[]; nextCursor: A2ATaskListCursor | null }> {
  await ensureTable();
  const client = getDbExec();
  const requestedLimit = options.limit ?? MAX_TASK_LIST_PAGE_SIZE;
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(MAX_TASK_LIST_PAGE_SIZE, Math.max(1, Math.floor(requestedLimit)))
    : MAX_TASK_LIST_PAGE_SIZE;
  const conditions: string[] = [];
  const args: unknown[] = [];
  if (contextId) {
    conditions.push("context_id = ?");
    args.push(contextId);
  }
  if (options.before) {
    conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
    args.push(
      options.before.createdAt,
      options.before.createdAt,
      options.before.id,
    );
  }
  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await client.execute({
    sql: `SELECT id, context_id, status_state, status_message, status_timestamp, history, artifacts, metadata, owner_email, owner_scope, created_at
      FROM a2a_tasks ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,
    args: [...args, limit + 1],
  });
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = pageRows.at(-1) as Record<string, unknown> | undefined;
  return {
    tasks: pageRows.map(taskFromRow),
    nextCursor:
      hasMore && lastRow
        ? { createdAt: Number(lastRow.created_at), id: String(lastRow.id) }
        : null,
  };
}

export async function listTasks(contextId?: string): Promise<Task[]> {
  const tasks: Task[] = [];
  let before: A2ATaskListCursor | undefined;
  while (true) {
    const page = await listTasksPage(contextId, { before });
    tasks.push(...page.tasks);
    if (!page.nextCursor) return tasks;
    before = page.nextCursor;
  }
}
