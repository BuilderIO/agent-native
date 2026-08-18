import {
  getDbExec,
  intType,
  isPostgres,
  type DbExec,
  type DbExecStatement,
} from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";

let initPromise: Promise<void> | undefined;

const MAX_PROGRESS_REF_CHARS = 1_024;
const MAX_CHECKPOINT_CHARS = 8_192;
const MAX_ERROR_MESSAGE_CHARS = 2_000;
const MAX_DUE_LIST_LIMIT = 100;
const A2A_WAITING_CHECKPOINT = '{"waitingForA2A":true}';

export type IntegrationCampaignStatus =
  | "pending"
  | "processing"
  | "waiting"
  | "completed"
  | "failed";

export interface IntegrationCampaign {
  id: string;
  integrationTaskId: string;
  threadId: string;
  turnId: string;
  status: IntegrationCampaignStatus;
  chunkCount: number;
  currentRunId: string | null;
  leaseToken: string | null;
  leaseExpiresAt: number | null;
  nextRunAt: number;
  progressRef: string | null;
  checkpoint: string | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export type ClaimIntegrationCampaignResult =
  | { kind: "claimed"; campaign: IntegrationCampaign }
  | { kind: "not-due" }
  | { kind: "chunk-limit"; campaign: IntegrationCampaign };

function buildCreateSql(): string {
  return `CREATE TABLE IF NOT EXISTS integration_campaigns (
    id TEXT PRIMARY KEY,
    integration_task_id TEXT NOT NULL UNIQUE,
    thread_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    status TEXT NOT NULL,
    chunk_count ${intType()} NOT NULL DEFAULT 0,
    current_run_id TEXT,
    lease_token TEXT,
    lease_expires_at ${intType()},
    next_run_at ${intType()} NOT NULL,
    progress_ref TEXT,
    checkpoint TEXT,
    error_message TEXT,
    created_at ${intType()} NOT NULL,
    updated_at ${intType()} NOT NULL,
    completed_at ${intType()}
  )`;
}

async function ensureTable(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const createSql = buildCreateSql();
      if (isPostgres()) {
        await ensureTableExists("integration_campaigns", createSql);
        await ensureIndexExists(
          "idx_integration_campaigns_due",
          "CREATE INDEX IF NOT EXISTS idx_integration_campaigns_due ON integration_campaigns(status, next_run_at)",
        );
        await ensureIndexExists(
          "idx_integration_campaigns_lease",
          "CREATE INDEX IF NOT EXISTS idx_integration_campaigns_lease ON integration_campaigns(status, lease_expires_at)",
        );
        return;
      }

      const client = getDbExec();
      await client.execute(createSql);
      await client.execute(
        "CREATE INDEX IF NOT EXISTS idx_integration_campaigns_due ON integration_campaigns(status, next_run_at)",
      );
      await client.execute(
        "CREATE INDEX IF NOT EXISTS idx_integration_campaigns_lease ON integration_campaigns(status, lease_expires_at)",
      );
    })().catch((error) => {
      initPromise = undefined;
      throw error;
    });
  }
  return initPromise;
}

export async function ensureIntegrationCampaignsTable(): Promise<void> {
  await ensureTable();
}

function boundedOpaqueValue(
  value: string | null | undefined,
  maxLength: number,
  name: string,
): string | null {
  if (value == null) return null;
  if (value.length > maxLength) {
    throw new Error(`${name} exceeds ${maxLength} characters`);
  }
  return value;
}

function rowToCampaign(row: Record<string, unknown>): IntegrationCampaign {
  return {
    id: String(row.id),
    integrationTaskId: String(row.integration_task_id),
    threadId: String(row.thread_id),
    turnId: String(row.turn_id),
    status: row.status as IntegrationCampaignStatus,
    chunkCount: Number(row.chunk_count ?? 0),
    currentRunId: (row.current_run_id as string | null) ?? null,
    leaseToken: (row.lease_token as string | null) ?? null,
    leaseExpiresAt:
      row.lease_expires_at == null ? null : Number(row.lease_expires_at),
    nextRunAt: Number(row.next_run_at ?? 0),
    progressRef: (row.progress_ref as string | null) ?? null,
    checkpoint: (row.checkpoint as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
    completedAt: row.completed_at == null ? null : Number(row.completed_at),
  };
}

function isDuplicateCampaignError(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string } | null;
  if (!candidate) return false;
  if (candidate.code === "23505") return true;
  const message = String(candidate.message ?? "").toLowerCase();
  return (
    message.includes("unique") ||
    message.includes("duplicate entry") ||
    message.includes("duplicate key")
  );
}

export async function getIntegrationCampaign(
  id: string,
): Promise<IntegrationCampaign | null> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: "SELECT * FROM integration_campaigns WHERE id = ? LIMIT 1",
    args: [id],
  });
  return rows[0] ? rowToCampaign(rows[0] as Record<string, unknown>) : null;
}

export async function getIntegrationCampaignForTask(
  integrationTaskId: string,
): Promise<IntegrationCampaign | null> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: "SELECT * FROM integration_campaigns WHERE integration_task_id = ? LIMIT 1",
    args: [integrationTaskId],
  });
  return rows[0] ? rowToCampaign(rows[0] as Record<string, unknown>) : null;
}

export async function createIntegrationCampaign(input: {
  integrationTaskId: string;
  threadId: string;
  turnId: string;
  progressRef?: string | null;
  checkpoint?: string | null;
  nextRunAt?: number;
}): Promise<IntegrationCampaign> {
  await ensureTable();
  const now = Date.now();
  const id = `integration-campaign-${now}-${Math.random().toString(36).slice(2, 10)}`;
  const progressRef = boundedOpaqueValue(
    input.progressRef,
    MAX_PROGRESS_REF_CHARS,
    "progressRef",
  );
  const checkpoint = boundedOpaqueValue(
    input.checkpoint,
    MAX_CHECKPOINT_CHARS,
    "checkpoint",
  );

  try {
    await getDbExec().execute({
      sql: `INSERT INTO integration_campaigns
        (id, integration_task_id, thread_id, turn_id, status, chunk_count,
         next_run_at, progress_ref, checkpoint, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.integrationTaskId,
        input.threadId,
        input.turnId,
        "pending",
        0,
        input.nextRunAt ?? now,
        progressRef,
        checkpoint,
        now,
        now,
      ],
    });
  } catch (error) {
    if (!isDuplicateCampaignError(error)) throw error;
    const existing = await getIntegrationCampaignForTask(
      input.integrationTaskId,
    );
    if (existing) return existing;
    throw error;
  }

  const campaign = await getIntegrationCampaign(id);
  if (!campaign) throw new Error("Created integration campaign was not found");
  return campaign;
}

function affectedRows(result: unknown): number {
  const value = result as { rowsAffected?: number; rowCount?: number };
  return Number(value.rowsAffected ?? value.rowCount ?? 0);
}

export async function claimIntegrationCampaign(
  id: string,
  input: {
    runId: string;
    leaseToken: string;
    leaseDurationMs: number;
    maxChunks: number;
  },
): Promise<ClaimIntegrationCampaignResult> {
  await ensureTable();
  if (!Number.isFinite(input.leaseDurationMs) || input.leaseDurationMs <= 0) {
    throw new Error("leaseDurationMs must be positive");
  }
  if (!Number.isInteger(input.maxChunks) || input.maxChunks <= 0) {
    throw new Error("maxChunks must be a positive integer");
  }

  const now = Date.now();
  const leaseExpiresAt = now + input.leaseDurationMs;
  const dueClause = `(status IN ('pending', 'waiting') AND next_run_at <= ?)
    OR (status = 'processing' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)`;
  const result = await getDbExec().execute({
    sql: isPostgres()
      ? `UPDATE integration_campaigns
           SET status = ?, chunk_count = CASE WHEN status = 'waiting' OR checkpoint = ? THEN chunk_count ELSE chunk_count + 1 END, current_run_id = ?,
               lease_token = ?, lease_expires_at = ?, updated_at = ?, error_message = NULL
           WHERE id = ? AND (status = 'waiting' OR checkpoint = ? OR chunk_count < ?) AND (${dueClause})
           RETURNING *`
      : `UPDATE integration_campaigns
           SET status = ?, chunk_count = CASE WHEN status = 'waiting' OR checkpoint = ? THEN chunk_count ELSE chunk_count + 1 END, current_run_id = ?,
               lease_token = ?, lease_expires_at = ?, updated_at = ?, error_message = NULL
           WHERE id = ? AND (status = 'waiting' OR checkpoint = ? OR chunk_count < ?) AND (${dueClause})`,
    args: [
      "processing",
      A2A_WAITING_CHECKPOINT,
      input.runId,
      input.leaseToken,
      leaseExpiresAt,
      now,
      id,
      A2A_WAITING_CHECKPOINT,
      input.maxChunks,
      now,
      now,
    ],
  });
  if (isPostgres()) {
    const row = result.rows?.[0];
    if (row)
      return {
        kind: "claimed",
        campaign: rowToCampaign(row as Record<string, unknown>),
      };
  } else if (affectedRows(result) > 0) {
    const campaign = await getIntegrationCampaign(id);
    if (
      campaign &&
      campaign.status === "processing" &&
      campaign.currentRunId === input.runId &&
      campaign.leaseToken === input.leaseToken
    ) {
      return { kind: "claimed", campaign };
    }
    return { kind: "not-due" };
  }

  const campaign = await getIntegrationCampaign(id);
  const waitingForA2A = campaign?.checkpoint === A2A_WAITING_CHECKPOINT;
  const exhaustedAndRecoverable =
    campaign &&
    campaign.chunkCount >= input.maxChunks &&
    !waitingForA2A &&
    (campaign.status === "pending" ||
      (campaign.status === "processing" &&
        (campaign.leaseExpiresAt == null || campaign.leaseExpiresAt <= now)));
  if (exhaustedAndRecoverable) {
    return { kind: "chunk-limit", campaign };
  }
  return { kind: "not-due" };
}

export async function claimIntegrationCampaignDeliveryForTask(
  integrationTaskId: string,
  input: { runId: string; leaseToken: string; leaseDurationMs: number },
): Promise<IntegrationCampaign | null> {
  await ensureTable();
  if (!Number.isFinite(input.leaseDurationMs) || input.leaseDurationMs <= 0) {
    throw new Error("leaseDurationMs must be positive");
  }
  const now = Date.now();
  const result = await getDbExec().execute({
    sql: isPostgres()
      ? `UPDATE integration_campaigns
           SET status = 'processing', current_run_id = ?, lease_token = ?,
               lease_expires_at = ?, updated_at = ?
           WHERE integration_task_id = ?
             AND (status IN ('pending', 'waiting') OR
                  (status = 'processing' AND
                   (lease_expires_at IS NULL OR lease_expires_at <= ?)))
           RETURNING *`
      : `UPDATE integration_campaigns
           SET status = 'processing', current_run_id = ?, lease_token = ?,
               lease_expires_at = ?, updated_at = ?
           WHERE integration_task_id = ?
             AND (status IN ('pending', 'waiting') OR
                  (status = 'processing' AND
                   (lease_expires_at IS NULL OR lease_expires_at <= ?)))`,
    args: [
      input.runId,
      input.leaseToken,
      now + input.leaseDurationMs,
      now,
      integrationTaskId,
      now,
    ],
  });
  if (isPostgres()) {
    const row = result.rows?.[0];
    return row ? rowToCampaign(row as Record<string, unknown>) : null;
  }
  if (affectedRows(result) === 0) return null;
  const campaign = await getIntegrationCampaignForTask(integrationTaskId);
  return campaign?.currentRunId === input.runId &&
    campaign.leaseToken === input.leaseToken
    ? campaign
    : null;
}

function leaseWhere(): string {
  return "id = ? AND status = 'processing' AND current_run_id = ? AND lease_token = ?";
}

export async function heartbeatIntegrationCampaign(
  id: string,
  input: { runId: string; leaseToken: string; leaseDurationMs: number },
): Promise<boolean> {
  await ensureTable();
  if (!Number.isFinite(input.leaseDurationMs) || input.leaseDurationMs <= 0) {
    throw new Error("leaseDurationMs must be positive");
  }
  const now = Date.now();
  const result = await getDbExec().execute({
    sql: `UPDATE integration_campaigns
          SET lease_expires_at = ?, updated_at = ?
          WHERE ${leaseWhere()}`,
    args: [now + input.leaseDurationMs, now, id, input.runId, input.leaseToken],
  });
  return affectedRows(result) > 0;
}

export async function scheduleNextIntegrationCampaign(
  id: string,
  input: {
    runId: string;
    leaseToken: string;
    nextRunAt: number;
    progressRef?: string | null;
    checkpoint?: string | null;
  },
): Promise<boolean> {
  await ensureTable();
  const now = Date.now();
  const progressRef = boundedOpaqueValue(
    input.progressRef,
    MAX_PROGRESS_REF_CHARS,
    "progressRef",
  );
  const checkpoint = boundedOpaqueValue(
    input.checkpoint,
    MAX_CHECKPOINT_CHARS,
    "checkpoint",
  );
  const result = await getDbExec().execute({
    sql: `UPDATE integration_campaigns
          SET status = ?, current_run_id = NULL, lease_token = NULL, lease_expires_at = NULL,
              next_run_at = ?, progress_ref = COALESCE(?, progress_ref),
              checkpoint = COALESCE(?, checkpoint), updated_at = ?
          WHERE ${leaseWhere()}`,
    args: [
      "pending",
      input.nextRunAt,
      progressRef,
      checkpoint,
      now,
      id,
      input.runId,
      input.leaseToken,
    ],
  });
  return affectedRows(result) > 0;
}

export async function waitForA2AIntegrationCampaign(
  id: string,
  input: {
    runId: string;
    leaseToken: string;
    nextRunAt: number;
    progressRef?: string | null;
  },
): Promise<boolean> {
  await ensureTable();
  const now = Date.now();
  const progressRef = boundedOpaqueValue(
    input.progressRef,
    MAX_PROGRESS_REF_CHARS,
    "progressRef",
  );
  const result = await getDbExec().execute({
    sql: `UPDATE integration_campaigns
          SET status = 'waiting', current_run_id = NULL, lease_token = NULL,
              lease_expires_at = NULL, next_run_at = ?,
              progress_ref = COALESCE(?, progress_ref),
              checkpoint = ?, updated_at = ?
          WHERE ${leaseWhere()}`,
    args: [
      input.nextRunAt,
      progressRef,
      A2A_WAITING_CHECKPOINT,
      now,
      id,
      input.runId,
      input.leaseToken,
    ],
  });
  return affectedRows(result) > 0;
}

async function finishIntegrationCampaign(
  id: string,
  input: {
    runId: string;
    leaseToken: string;
    status: "completed" | "failed";
    errorMessage?: string;
  },
): Promise<boolean> {
  await ensureTable();
  const now = Date.now();
  const errorMessage = boundedOpaqueValue(
    input.errorMessage,
    MAX_ERROR_MESSAGE_CHARS,
    "errorMessage",
  );
  const result = await getDbExec().execute({
    sql: `UPDATE integration_campaigns
          SET status = ?, current_run_id = NULL, lease_token = NULL, lease_expires_at = NULL,
              progress_ref = NULL, checkpoint = NULL, error_message = ?,
              updated_at = ?, completed_at = ?
          WHERE ${leaseWhere()}`,
    args: [
      input.status,
      errorMessage,
      now,
      now,
      id,
      input.runId,
      input.leaseToken,
    ],
  });
  return affectedRows(result) > 0;
}

export async function completeIntegrationCampaign(
  id: string,
  input: { runId: string; leaseToken: string },
): Promise<boolean> {
  return finishIntegrationCampaign(id, { ...input, status: "completed" });
}

export async function completeIntegrationCampaignTask(
  id: string,
  input: {
    integrationTaskId: string;
    runId: string;
    leaseToken: string;
  },
): Promise<boolean> {
  await ensureTable();
  const now = Date.now();
  const previousWriteGuard = isPostgres() ? "" : "AND changes() = 1";
  const statements: DbExecStatement[] = [
    {
      sql: `UPDATE integration_campaigns
            SET status = 'completed', current_run_id = NULL,
                lease_token = NULL, lease_expires_at = NULL,
                progress_ref = NULL, checkpoint = NULL, error_message = NULL,
                updated_at = ?, completed_at = ?
            WHERE id = ? AND integration_task_id = ?
              AND status = 'processing'
              AND current_run_id = ? AND lease_token = ?`,
      args: [
        now,
        now,
        id,
        input.integrationTaskId,
        input.runId,
        input.leaseToken,
      ],
    },
    {
      sql: `UPDATE integration_pending_tasks
            SET status = 'completed', payload = '{}', error_message = NULL,
                updated_at = ?, completed_at = ?
            WHERE id = ? AND status = 'processing'
              ${previousWriteGuard}
              AND EXISTS (
                SELECT 1 FROM integration_campaigns
                WHERE id = ? AND integration_task_id = ?
                  AND status = 'completed' AND updated_at = ?
                  AND completed_at = ?
              )`,
      args: [
        now,
        now,
        input.integrationTaskId,
        id,
        input.integrationTaskId,
        now,
        now,
      ],
    },
  ];
  const db = getDbExec();
  if (db.atomicBatch) {
    const results = await db.atomicBatch(statements);
    return (
      results.length === statements.length &&
      results.every((result) => affectedRows(result) > 0)
    );
  }
  if (db.transaction) {
    return await db.transaction(async (tx) => {
      const campaignResult = await tx.execute(statements[0]!);
      if (affectedRows(campaignResult) === 0) return false;
      const taskResult = await tx.execute(statements[1]!);
      if (affectedRows(taskResult) === 0) {
        throw new Error("Campaign completion transition lost its task custody");
      }
      return true;
    });
  }
  throw new Error("Database does not support atomic campaign completion");
}

export async function failIntegrationCampaign(
  id: string,
  input: { runId: string; leaseToken: string; errorMessage: string },
): Promise<boolean> {
  return finishIntegrationCampaign(id, { ...input, status: "failed" });
}

export async function failExhaustedIntegrationCampaign(
  id: string,
  input: { maxChunks: number; errorMessage: string },
): Promise<boolean> {
  await ensureTable();
  const now = Date.now();
  const errorMessage = boundedOpaqueValue(
    input.errorMessage,
    MAX_ERROR_MESSAGE_CHARS,
    "errorMessage",
  );
  const result = await getDbExec().execute({
    sql: `UPDATE integration_campaigns
          SET status = 'failed', current_run_id = NULL, lease_token = NULL,
              lease_expires_at = NULL, progress_ref = NULL, checkpoint = NULL,
              error_message = ?, updated_at = ?, completed_at = ?
          WHERE id = ? AND chunk_count >= ?
            AND (checkpoint IS NULL OR checkpoint <> ?)
            AND (status = 'pending' OR
                 (status = 'processing' AND
                  (lease_expires_at IS NULL OR lease_expires_at <= ?)))`,
    args: [
      errorMessage,
      now,
      now,
      id,
      input.maxChunks,
      A2A_WAITING_CHECKPOINT,
      now,
    ],
  });
  return affectedRows(result) > 0;
}

export async function terminalizeIntegrationCampaignForTask(
  integrationTaskId: string,
  input: { status: "completed" | "failed"; errorMessage?: string },
): Promise<boolean> {
  await ensureTable();
  const now = Date.now();
  const errorMessage = boundedOpaqueValue(
    input.errorMessage,
    MAX_ERROR_MESSAGE_CHARS,
    "errorMessage",
  );
  const result = await getDbExec().execute({
    sql: `UPDATE integration_campaigns
          SET status = ?, current_run_id = NULL, lease_token = NULL,
              lease_expires_at = NULL, progress_ref = NULL, checkpoint = NULL,
              error_message = ?, updated_at = ?, completed_at = ?
          WHERE integration_task_id = ?
            AND status IN ('pending', 'processing', 'waiting')`,
    args: [input.status, errorMessage, now, now, integrationTaskId],
  });
  return affectedRows(result) > 0;
}

export async function failIntegrationCampaignTaskDeliveryContainment(
  integrationTaskId: string,
  errorMessage: string,
): Promise<boolean> {
  await ensureTable();
  const now = Date.now();
  const boundedError =
    boundedOpaqueValue(errorMessage, MAX_ERROR_MESSAGE_CHARS, "errorMessage") ??
    "Delivery transition failed";
  const statements: DbExecStatement[] = [
    {
      sql: `UPDATE integration_campaigns
            SET status = 'failed', current_run_id = NULL,
                lease_token = NULL, lease_expires_at = NULL,
                progress_ref = NULL, checkpoint = NULL, error_message = ?,
                updated_at = ?, completed_at = ?
            WHERE integration_task_id = ?
              AND status IN ('pending', 'processing', 'waiting')`,
      args: [boundedError, now, now, integrationTaskId],
    },
    {
      sql: `UPDATE integration_pending_tasks
            SET status = 'failed', payload = '{}', error_message = ?,
                updated_at = ?, completed_at = ?
            WHERE id = ? AND status = 'processing'
              AND NOT EXISTS (
                SELECT 1 FROM integration_campaigns
                WHERE integration_task_id = ?
                  AND status IN ('pending', 'processing', 'waiting')
              )`,
      args: [boundedError, now, now, integrationTaskId, integrationTaskId],
    },
  ];
  const db = getDbExec();
  if (db.atomicBatch) {
    const results = await db.atomicBatch(statements);
    return (
      results.length === statements.length && affectedRows(results[1]!) > 0
    );
  }
  if (db.transaction) {
    return await db.transaction(async (tx) => {
      await tx.execute(statements[0]!);
      const taskResult = await tx.execute(statements[1]!);
      return affectedRows(taskResult) > 0;
    });
  }
  throw new Error("Database does not support atomic delivery containment");
}

function disabledCampaignAndTaskStatements(
  integrationTaskId: string,
  errorMessage: string,
): DbExecStatement[] {
  const now = Date.now();
  return [
    {
      sql: `UPDATE integration_campaigns
          SET status = 'failed', current_run_id = NULL, lease_token = NULL,
              lease_expires_at = NULL, progress_ref = NULL, checkpoint = NULL,
              error_message = ?, updated_at = ?, completed_at = ?
          WHERE integration_task_id = ?
            AND status IN ('pending', 'processing', 'waiting')`,
      args: [errorMessage, now, now, integrationTaskId],
    },
    {
      sql: `UPDATE integration_pending_tasks
          SET status = 'failed', payload = '{}', external_event_key = NULL,
              error_message = ?, updated_at = ?, completed_at = ?
          WHERE id = ? AND status = 'processing'`,
      args: [errorMessage, now, now, integrationTaskId],
    },
  ];
}

async function executeStatementsWithDb(
  db: DbExec,
  statements: readonly DbExecStatement[],
): Promise<void> {
  for (const statement of statements) await db.execute(statement);
}

/**
 * Fail closed when a durable campaign's rollout scope is removed. Both rows
 * transition in one transaction so the per-thread processing lock cannot be
 * stranded while the campaign is no longer recoverable.
 */
export async function failDisabledIntegrationCampaignTask(
  integrationTaskId: string,
  errorMessage = "Durable integration campaign was disabled for this scope",
): Promise<void> {
  await ensureTable();
  const boundedError =
    boundedOpaqueValue(errorMessage, MAX_ERROR_MESSAGE_CHARS, "errorMessage") ??
    "Durable integration campaign was disabled";
  const db = getDbExec();
  const statements = disabledCampaignAndTaskStatements(
    integrationTaskId,
    boundedError,
  );
  if (db.atomicBatch) {
    await db.atomicBatch(statements);
    return;
  }
  if (db.transaction) {
    await db.transaction((tx) => executeStatementsWithDb(tx, statements));
    return;
  }
  throw new Error("Database does not support atomic campaign cancellation");
}

export async function transitionIntegrationCampaignTaskToDeliveryRetry(
  integrationTaskId: string,
  input: {
    payload: string;
    errorMessage: string;
    campaignStatus: "completed" | "failed";
    campaignId: string;
    runId: string;
    leaseToken: string;
  },
): Promise<boolean> {
  await ensureTable();
  const now = Date.now();
  const errorMessage =
    boundedOpaqueValue(
      input.errorMessage,
      MAX_ERROR_MESSAGE_CHARS,
      "errorMessage",
    ) ?? "Integration response delivery needs retry";
  const previousWriteGuard = isPostgres() ? "" : "AND changes() = 1";
  const statements: DbExecStatement[] = [
    {
      sql: `UPDATE integration_campaigns
            SET status = ?, current_run_id = NULL, lease_token = NULL,
                lease_expires_at = NULL, progress_ref = NULL, checkpoint = NULL,
                error_message = ?, updated_at = ?, completed_at = ?
            WHERE id = ? AND integration_task_id = ?
              AND status = 'processing'
              AND current_run_id = ? AND lease_token = ?`,
      args: [
        input.campaignStatus,
        input.campaignStatus === "failed" ? errorMessage : null,
        now,
        now,
        input.campaignId,
        integrationTaskId,
        input.runId,
        input.leaseToken,
      ],
    },
    {
      sql: `UPDATE integration_pending_tasks
            SET status = 'pending', payload = ?, error_message = ?, updated_at = ?
            WHERE id = ? AND status = 'processing'
              ${previousWriteGuard}
              AND EXISTS (
                SELECT 1 FROM integration_campaigns
                WHERE id = ? AND integration_task_id = ?
                  AND status = ? AND updated_at = ? AND completed_at = ?
                  AND current_run_id IS NULL AND lease_token IS NULL
              )`,
      args: [
        input.payload,
        errorMessage,
        now,
        integrationTaskId,
        input.campaignId,
        integrationTaskId,
        input.campaignStatus,
        now,
        now,
      ],
    },
  ];
  const db = getDbExec();
  if (db.atomicBatch) {
    const results = await db.atomicBatch(statements);
    return (
      results.length === statements.length &&
      results.every((result) => affectedRows(result) > 0)
    );
  }
  if (db.transaction) {
    return await db.transaction(async (tx) => {
      const campaignResult = await tx.execute(statements[0]!);
      if (affectedRows(campaignResult) === 0) return false;
      const taskResult = await tx.execute(statements[1]!);
      if (affectedRows(taskResult) === 0) {
        throw new Error(
          "Campaign delivery retry lease transition lost its race",
        );
      }
      return true;
    });
  }
  throw new Error("Database does not support atomic campaign delivery retry");
}

export async function transitionIntegrationCampaignTaskToA2AReceiptRetry(
  integrationTaskId: string,
  input: {
    payload: string;
    errorMessage: string;
    campaignId: string;
    runId: string;
    leaseToken: string;
    nextRunAt: number;
  },
): Promise<boolean> {
  await ensureTable();
  const now = Date.now();
  const errorMessage =
    boundedOpaqueValue(
      input.errorMessage,
      MAX_ERROR_MESSAGE_CHARS,
      "errorMessage",
    ) ?? "A2A partial response history needs retry";
  const previousWriteGuard = isPostgres() ? "" : "AND changes() = 1";
  const statements: DbExecStatement[] = [
    {
      sql: `UPDATE integration_campaigns
            SET status = 'waiting', current_run_id = NULL, lease_token = NULL,
                lease_expires_at = NULL, next_run_at = ?, checkpoint = ?,
                error_message = NULL, updated_at = ?
            WHERE id = ? AND integration_task_id = ?
              AND status = 'processing'
              AND current_run_id = ? AND lease_token = ?`,
      args: [
        input.nextRunAt,
        A2A_WAITING_CHECKPOINT,
        now,
        input.campaignId,
        integrationTaskId,
        input.runId,
        input.leaseToken,
      ],
    },
    {
      sql: `UPDATE integration_pending_tasks
            SET payload = ?, error_message = ?, updated_at = ?
            WHERE id = ? AND status = 'processing'
              ${previousWriteGuard}
              AND EXISTS (
                SELECT 1 FROM integration_campaigns
                WHERE id = ? AND integration_task_id = ?
                  AND status = 'waiting' AND checkpoint = ?
                  AND updated_at = ? AND current_run_id IS NULL
                  AND lease_token IS NULL
              )`,
      args: [
        input.payload,
        errorMessage,
        now,
        integrationTaskId,
        input.campaignId,
        integrationTaskId,
        A2A_WAITING_CHECKPOINT,
        now,
      ],
    },
  ];
  const db = getDbExec();
  if (db.atomicBatch) {
    const results = await db.atomicBatch(statements);
    return (
      results.length === statements.length &&
      results.every((result) => affectedRows(result) > 0)
    );
  }
  if (db.transaction) {
    return await db.transaction(async (tx) => {
      const campaignResult = await tx.execute(statements[0]!);
      if (affectedRows(campaignResult) === 0) return false;
      const taskResult = await tx.execute(statements[1]!);
      if (affectedRows(taskResult) === 0) {
        throw new Error("A2A receipt custody transition lost its race");
      }
      return true;
    });
  }
  throw new Error("Database does not support atomic A2A receipt custody");
}

export async function refreshIntegrationCampaignTaskA2AReceiptRetry(
  integrationTaskId: string,
  input: { payload: string; errorMessage: string },
): Promise<boolean> {
  await ensureTable();
  const result = await getDbExec().execute({
    sql: `UPDATE integration_pending_tasks
          SET payload = ?, error_message = ?, updated_at = ?
          WHERE id = ? AND status = 'processing'
            AND EXISTS (
              SELECT 1 FROM integration_campaigns
              WHERE integration_task_id = ? AND status = 'waiting'
                AND checkpoint = ?
            )`,
    args: [
      input.payload,
      input.errorMessage.slice(0, MAX_ERROR_MESSAGE_CHARS),
      Date.now(),
      integrationTaskId,
      integrationTaskId,
      A2A_WAITING_CHECKPOINT,
    ],
  });
  return affectedRows(result) > 0;
}

export async function completeIntegrationCampaignTaskAfterA2A(
  integrationTaskId: string,
): Promise<boolean> {
  await ensureTable();
  const now = Date.now();
  const previousWriteGuard = isPostgres() ? "" : "AND changes() = 1";
  const statements: DbExecStatement[] = [
    {
      sql: `UPDATE integration_campaigns
            SET status = 'completed', current_run_id = NULL,
                lease_token = NULL, lease_expires_at = NULL,
                progress_ref = NULL, checkpoint = NULL, error_message = NULL,
                updated_at = ?, completed_at = ?
            WHERE integration_task_id = ? AND status = 'waiting'
              AND checkpoint = ?`,
      args: [now, now, integrationTaskId, A2A_WAITING_CHECKPOINT],
    },
    {
      sql: `UPDATE integration_pending_tasks
            SET status = 'completed', payload = '{}', error_message = NULL,
                updated_at = ?, completed_at = ?
            WHERE id = ? AND status = 'processing'
              ${previousWriteGuard}
              AND EXISTS (
                SELECT 1 FROM integration_campaigns
                WHERE integration_task_id = ? AND status = 'completed'
                  AND updated_at = ? AND completed_at = ?
              )`,
      args: [now, now, integrationTaskId, integrationTaskId, now, now],
    },
  ];
  const db = getDbExec();
  if (db.atomicBatch) {
    const results = await db.atomicBatch(statements);
    return (
      results.length === statements.length &&
      results.every((result) => affectedRows(result) > 0)
    );
  }
  if (db.transaction) {
    return await db.transaction(async (tx) => {
      const campaignResult = await tx.execute(statements[0]!);
      if (affectedRows(campaignResult) === 0) return false;
      const taskResult = await tx.execute(statements[1]!);
      if (affectedRows(taskResult) === 0) {
        throw new Error("A2A parent completion transition lost its race");
      }
      return true;
    });
  }
  throw new Error("Database does not support atomic A2A parent completion");
}

export async function listDueIntegrationCampaignIds(
  limit = 25,
): Promise<string[]> {
  await ensureTable();
  const boundedLimit = Math.max(
    1,
    Math.min(Math.floor(limit), MAX_DUE_LIST_LIMIT),
  );
  const now = Date.now();
  const { rows } = await getDbExec().execute({
    sql: `SELECT id FROM integration_campaigns
          WHERE (status IN ('pending', 'waiting') AND next_run_at <= ?)
             OR (status = 'processing' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
          ORDER BY next_run_at ASC, id ASC
          LIMIT ?`,
    args: [now, now, boundedLimit],
  });
  return rows.map((row) => String((row as Record<string, unknown>).id));
}

export async function hasActiveIntegrationCampaign(
  integrationTaskId: string,
): Promise<boolean> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT 1 AS active FROM integration_campaigns
          WHERE integration_task_id = ? AND status IN ('pending', 'processing', 'waiting')
          LIMIT 1`,
    args: [integrationTaskId],
  });
  return rows.length > 0;
}
