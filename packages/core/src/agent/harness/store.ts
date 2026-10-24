import { redactArgsToValue } from "../../audit/redact.js";
import { getDbExec, type DbExec } from "../../db/client.js";
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../../db/ddl-guard.js";
import { defineStore } from "../../db/store-registry.js";
import { fromMigrationEntries } from "../../db/versioned-store-migrations.js";
import type { AgentChatEvent } from "../types.js";
import {
  AGENT_HARNESS_SESSION_MIGRATIONS,
  AGENT_HARNESS_SESSION_MIGRATIONS_TABLE,
} from "./migrations.js";

const LEGACY_FOLLOW_UP_CLAIM_GRACE_MS = 15 * 60 * 1_000;
const DATABASE_NOW_MS_SQL =
  "CAST(FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000) AS BIGINT)";

export type AgentHarnessSessionStatus =
  | "running"
  | "idle"
  | "stopped"
  | "errored"
  | "destroyed";

export class AgentHarnessSessionConflictError extends Error {
  constructor(sessionId: string) {
    super(
      `Harness session ${sessionId} changed concurrently; retry the operation.`,
    );
    this.name = "AgentHarnessSessionConflictError";
  }
}

export function isAgentHarnessSessionConflictError(
  error: unknown,
): error is AgentHarnessSessionConflictError {
  return (
    error instanceof AgentHarnessSessionConflictError ||
    (error instanceof Error &&
      error.name === "AgentHarnessSessionConflictError")
  );
}

export interface StoredAgentHarnessSession {
  id: string;
  harnessName: string;
  threadId: string;
  runId?: string | null;
  providerSessionId?: string | null;
  status: AgentHarnessSessionStatus;
  resumeState?: unknown;
  workspaceRef?: string | null;
  pendingApproval?: unknown;
  approvalResolutionId?: string | null;
  expiryCleanupId?: string | null;
  resolvedApprovalIds?: string[];
  ownerEmail?: string | null;
  orgId?: string | null;
  followUpClaimId?: string | null;
  followUpId?: string | null;
  followUpPrompt?: string | null;
  followUpMetadata?: unknown;
  followUpClaimExpiresAt?: number | null;
  followUpDeadlineAt?: number | null;
  followUpDispatchedAt?: number | null;
  followUpOutcome?: "completed" | "not_dispatched" | "unknown" | null;
  generation: number;
  createdAt: number;
  updatedAt: number;
  stoppedAt?: number | null;
}

export interface SaveAgentHarnessSessionInput {
  id: string;
  harnessName: string;
  threadId: string;
  runId?: string | null;
  providerSessionId?: string | null;
  status?: AgentHarnessSessionStatus;
  resumeState?: unknown;
  workspaceRef?: string | null;
  pendingApproval?: unknown;
  approvalResolutionId?: string | null;
  expiryCleanupId?: string | null;
  resolvedApprovalIds?: string[];
  ownerEmail?: string | null;
  orgId?: string | null;
  followUpClaimId?: string | null;
  followUpId?: string | null;
  followUpPrompt?: string | null;
  followUpMetadata?: unknown;
  followUpClaimExpiresAt?: number | null;
  followUpDeadlineAt?: number | null;
  followUpDispatchedAt?: number | null;
  followUpOutcome?: "completed" | "not_dispatched" | "unknown" | null;
  stoppedAt?: number | null;
  expectedGeneration?: number;
  expectedStatus?: AgentHarnessSessionStatus;
  expectedFollowUpClaimId?: string;
  requiresActiveFollowUpClaim?: boolean;
  expectedApprovalResolutionId?: string | null;
  expectedExpiryCleanupId?: string | null;
  requiresNoApprovalResolution?: boolean;
  existingSession?: StoredAgentHarnessSession | null;
}

export interface AgentHarnessSessionGenerationFence {
  expectedApprovalResolutionId?: string | null;
  requiresNoApprovalResolution?: boolean;
}

export interface AgentHarnessFollowUpIntent {
  followUpId: string;
  prompt: string;
  metadata?: Record<string, unknown>;
  claimExpiresAt: number;
  deadlineAt: number;
}

export interface StoredAgentHarnessSessionEvent {
  operationId: string;
  seq: number;
  eventAt: number;
  event: AgentChatEvent;
}

export const agentHarnessSessionsStore = defineStore({
  id: "agent_harness_sessions",
  migrations: [
    {
      name: "baseline",
      run: async () => {
        const createSql = `
        CREATE TABLE IF NOT EXISTS agent_harness_sessions (
          id TEXT PRIMARY KEY,
          harness_name TEXT NOT NULL,
          thread_id TEXT NOT NULL,
          run_id TEXT,
          provider_session_id TEXT,
          status TEXT NOT NULL DEFAULT 'idle',
          resume_state TEXT,
          workspace_ref TEXT,
          pending_approval TEXT,
          approval_resolution_id TEXT,
          expiry_cleanup_id TEXT,
          resolved_approval_ids TEXT,
          owner_email TEXT,
          org_id TEXT,
          generation BIGINT NOT NULL DEFAULT 0,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          stopped_at BIGINT
        )
      `;

        await ensureTableExists("agent_harness_sessions", createSql);
        for (const col of [
          "run_id",
          "provider_session_id",
          "resume_state",
          "workspace_ref",
          "pending_approval",
          "approval_resolution_id",
          "expiry_cleanup_id",
          "resolved_approval_ids",
          "owner_email",
          "org_id",
        ] as const) {
          await ensureColumnExists(
            "agent_harness_sessions",
            col,
            `ALTER TABLE agent_harness_sessions ADD COLUMN IF NOT EXISTS ${col} TEXT`,
          );
        }
        await ensureColumnExists(
          "agent_harness_sessions",
          "stopped_at",
          `ALTER TABLE agent_harness_sessions ADD COLUMN IF NOT EXISTS stopped_at BIGINT`,
        );
        await ensureColumnExists(
          "agent_harness_sessions",
          "generation",
          `ALTER TABLE agent_harness_sessions ADD COLUMN IF NOT EXISTS generation BIGINT NOT NULL DEFAULT 0`,
        );
        await ensureIndexExists(
          "idx_agent_harness_sessions_thread",
          `CREATE INDEX IF NOT EXISTS idx_agent_harness_sessions_thread ON agent_harness_sessions(thread_id, updated_at)`,
        );
        await ensureIndexExists(
          "idx_agent_harness_sessions_status",
          `CREATE INDEX IF NOT EXISTS idx_agent_harness_sessions_status ON agent_harness_sessions(status, updated_at)`,
        );
        await ensureIndexExists(
          "idx_agent_harness_sessions_owner",
          `CREATE INDEX IF NOT EXISTS idx_agent_harness_sessions_owner ON agent_harness_sessions(owner_email, updated_at)`,
        );
      },
    },
    ...fromMigrationEntries(
      AGENT_HARNESS_SESSION_MIGRATIONS_TABLE,
      AGENT_HARNESS_SESSION_MIGRATIONS,
    ),
    {
      name: "agent-harness-sessions-follow-up-claim-id",
      sql: "ALTER TABLE agent_harness_sessions ADD COLUMN IF NOT EXISTS follow_up_claim_id TEXT",
    },
    {
      name: "agent-harness-follow-up-recovery",
      run: async () => {
        for (const [column, type] of [
          ["follow_up_id", "TEXT"],
          ["follow_up_prompt", "TEXT"],
          ["follow_up_metadata", "TEXT"],
          ["follow_up_claim_expires_at", "BIGINT"],
          ["follow_up_deadline_at", "BIGINT"],
          ["follow_up_dispatched_at", "BIGINT"],
          ["follow_up_outcome", "TEXT"],
        ] as const) {
          await ensureColumnExists(
            "agent_harness_sessions",
            column,
            `ALTER TABLE agent_harness_sessions ADD COLUMN IF NOT EXISTS ${column} ${type}`,
          );
        }
        await ensureTableExists(
          "agent_harness_session_events",
          `CREATE TABLE IF NOT EXISTS agent_harness_session_events (
            session_id TEXT NOT NULL,
            operation_id TEXT NOT NULL,
            seq BIGINT NOT NULL,
            event_at BIGINT NOT NULL,
            event_data TEXT NOT NULL,
            PRIMARY KEY (session_id, seq)
          )`,
        );
        await ensureIndexExists(
          "idx_agent_harness_session_events_session",
          `CREATE INDEX IF NOT EXISTS idx_agent_harness_session_events_session
           ON agent_harness_session_events(session_id, seq)`,
        );
        await ensureIndexExists(
          "idx_agent_harness_follow_up_recovery",
          `CREATE INDEX IF NOT EXISTS idx_agent_harness_follow_up_recovery
           ON agent_harness_sessions(follow_up_claim_expires_at)
           WHERE follow_up_claim_id IS NOT NULL`,
        );
      },
    },
  ],
});

export function ensureAgentHarnessSessionTables(): Promise<void> {
  return agentHarnessSessionsStore.ready();
}

export async function saveAgentHarnessSession(
  input: SaveAgentHarnessSessionInput,
): Promise<StoredAgentHarnessSession> {
  await ensureAgentHarnessSessionTables();
  const now = Date.now();
  const existing =
    input.existingSession === undefined
      ? await getAgentHarnessSession(input.id)
      : input.existingSession;
  const record: StoredAgentHarnessSession = {
    id: input.id,
    harnessName: input.harnessName,
    threadId: input.threadId,
    runId: input.runId ?? null,
    providerSessionId: input.providerSessionId ?? null,
    status: input.status ?? existing?.status ?? "idle",
    resumeState:
      input.resumeState !== undefined
        ? input.resumeState
        : existing?.resumeState,
    workspaceRef: input.workspaceRef ?? existing?.workspaceRef ?? null,
    pendingApproval:
      input.pendingApproval !== undefined
        ? input.pendingApproval
        : existing?.pendingApproval,
    approvalResolutionId:
      input.approvalResolutionId !== undefined
        ? input.approvalResolutionId
        : (existing?.approvalResolutionId ?? null),
    expiryCleanupId:
      input.expiryCleanupId !== undefined
        ? input.expiryCleanupId
        : (existing?.expiryCleanupId ?? null),
    resolvedApprovalIds:
      input.resolvedApprovalIds ?? existing?.resolvedApprovalIds ?? [],
    ownerEmail: input.ownerEmail ?? existing?.ownerEmail ?? null,
    orgId: input.orgId ?? existing?.orgId ?? null,
    followUpClaimId:
      input.followUpClaimId !== undefined
        ? input.followUpClaimId
        : (existing?.followUpClaimId ?? null),
    followUpId:
      input.followUpId !== undefined
        ? input.followUpId
        : (existing?.followUpId ?? null),
    followUpPrompt:
      input.followUpPrompt !== undefined
        ? input.followUpPrompt
        : (existing?.followUpPrompt ?? null),
    followUpMetadata:
      input.followUpMetadata !== undefined
        ? input.followUpMetadata
        : existing?.followUpMetadata,
    followUpClaimExpiresAt:
      input.followUpClaimExpiresAt !== undefined
        ? input.followUpClaimExpiresAt
        : (existing?.followUpClaimExpiresAt ?? null),
    followUpDeadlineAt:
      input.followUpDeadlineAt !== undefined
        ? input.followUpDeadlineAt
        : (existing?.followUpDeadlineAt ?? null),
    followUpDispatchedAt:
      input.followUpDispatchedAt !== undefined
        ? input.followUpDispatchedAt
        : (existing?.followUpDispatchedAt ?? null),
    followUpOutcome:
      input.followUpOutcome !== undefined
        ? input.followUpOutcome
        : (existing?.followUpOutcome ?? null),
    generation: (input.expectedGeneration ?? existing?.generation ?? 0) + 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    stoppedAt: input.stoppedAt ?? existing?.stoppedAt ?? null,
  };
  const client = getDbExec();
  const values = [
    record.id,
    record.harnessName,
    record.threadId,
    record.runId ?? null,
    record.providerSessionId ?? null,
    record.status,
    serializeJson(record.resumeState),
    record.workspaceRef ?? null,
    serializeJson(record.pendingApproval),
    record.approvalResolutionId ?? null,
    record.expiryCleanupId ?? null,
    serializeJson(record.resolvedApprovalIds),
    record.ownerEmail ?? null,
    record.orgId ?? null,
    record.generation,
    record.createdAt,
    record.updatedAt,
    record.stoppedAt ?? null,
    record.followUpClaimId ?? null,
    record.followUpId ?? null,
    record.followUpPrompt ?? null,
    serializeJson(record.followUpMetadata),
    record.followUpClaimExpiresAt ?? null,
    record.followUpDeadlineAt ?? null,
    record.followUpDispatchedAt ?? null,
    record.followUpOutcome ?? null,
  ];
  if (!existing) {
    const inserted = await client.execute({
      sql: `INSERT INTO agent_harness_sessions (
              id, harness_name, thread_id, run_id, provider_session_id, status,
              resume_state, workspace_ref, pending_approval, approval_resolution_id,
              expiry_cleanup_id, resolved_approval_ids,
              owner_email, org_id, generation, created_at, updated_at, stopped_at,
              follow_up_claim_id, follow_up_id, follow_up_prompt,
              follow_up_metadata, follow_up_claim_expires_at,
              follow_up_deadline_at, follow_up_dispatched_at, follow_up_outcome
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING`,
      args: values,
    });
    if (inserted.rowsAffected === 1) return record;
    const current = await getAgentHarnessSession(input.id);
    if (!current) throw new Error("Harness session insert did not persist.");
    return saveAgentHarnessSession({
      ...input,
      expectedGeneration: undefined,
      existingSession: undefined,
    });
  }

  const expectedGeneration = input.expectedGeneration ?? existing.generation;
  const conditions = ["id = ?", "generation = ?"];
  const conditionArgs: unknown[] = [record.id, expectedGeneration];
  if (input.expectedStatus !== undefined) {
    conditions.push("status = ?");
    conditionArgs.push(input.expectedStatus);
  }
  if (input.expectedFollowUpClaimId !== undefined) {
    conditions.push("follow_up_claim_id = ?");
    conditionArgs.push(input.expectedFollowUpClaimId);
  }
  if (input.requiresActiveFollowUpClaim) {
    conditions.push(`follow_up_claim_expires_at > ${DATABASE_NOW_MS_SQL}`);
    conditions.push(`follow_up_deadline_at > ${DATABASE_NOW_MS_SQL}`);
  }
  if (
    input.requiresNoApprovalResolution ||
    input.expectedApprovalResolutionId === null
  ) {
    conditions.push("approval_resolution_id IS NULL");
  } else if (input.expectedApprovalResolutionId !== undefined) {
    conditions.push("approval_resolution_id = ?");
    conditionArgs.push(input.expectedApprovalResolutionId);
  }
  if (
    input.expectedExpiryCleanupId !== undefined &&
    input.expectedExpiryCleanupId !== null
  ) {
    conditions.push("expiry_cleanup_id = ?");
    conditionArgs.push(input.expectedExpiryCleanupId);
  } else {
    conditions.push("expiry_cleanup_id IS NULL");
  }
  const updated = await client.execute({
    sql: `UPDATE agent_harness_sessions SET
            harness_name = ?, thread_id = ?, run_id = ?, provider_session_id = ?,
            status = ?, resume_state = ?, workspace_ref = ?, pending_approval = ?,
            approval_resolution_id = ?, expiry_cleanup_id = ?, resolved_approval_ids = ?, owner_email = ?,
            org_id = ?, generation = ?,
            updated_at = ?, stopped_at = ?, follow_up_claim_id = ?,
            follow_up_id = ?, follow_up_prompt = ?, follow_up_metadata = ?,
            follow_up_claim_expires_at = ?, follow_up_deadline_at = ?,
            follow_up_dispatched_at = ?, follow_up_outcome = ?
          WHERE ${conditions.join(" AND ")}`,
    args: [
      record.harnessName,
      record.threadId,
      record.runId ?? null,
      record.providerSessionId ?? null,
      record.status,
      serializeJson(record.resumeState),
      record.workspaceRef ?? null,
      serializeJson(record.pendingApproval),
      record.approvalResolutionId ?? null,
      record.expiryCleanupId ?? null,
      serializeJson(record.resolvedApprovalIds),
      record.ownerEmail ?? null,
      record.orgId ?? null,
      record.generation,
      record.updatedAt,
      record.stoppedAt ?? null,
      record.followUpClaimId ?? null,
      record.followUpId ?? null,
      record.followUpPrompt ?? null,
      serializeJson(record.followUpMetadata),
      record.followUpClaimExpiresAt ?? null,
      record.followUpDeadlineAt ?? null,
      record.followUpDispatchedAt ?? null,
      record.followUpOutcome ?? null,
      ...conditionArgs,
    ],
  });
  if (updated.rowsAffected !== 1) {
    throw new AgentHarnessSessionConflictError(record.id);
  }
  return record;
}

export async function updateAgentHarnessSession(
  id: string,
  patch: Partial<Omit<SaveAgentHarnessSessionInput, "id">>,
): Promise<StoredAgentHarnessSession | null> {
  return updateAgentHarnessSessionWithStatus(id, patch);
}

export async function updateAgentHarnessSessionIfStatus(
  id: string,
  expectedStatus: AgentHarnessSessionStatus,
  patch: Partial<Omit<SaveAgentHarnessSessionInput, "id">>,
): Promise<StoredAgentHarnessSession | null> {
  return updateAgentHarnessSessionWithStatus(id, patch, expectedStatus);
}

export async function updateAgentHarnessSessionAtGeneration(
  id: string,
  expectedStatus: AgentHarnessSessionStatus,
  expectedGeneration: number,
  patch: Partial<Omit<SaveAgentHarnessSessionInput, "id">>,
  expectedFollowUpClaimId?: string,
  fence: boolean | AgentHarnessSessionGenerationFence = false,
): Promise<StoredAgentHarnessSession | null> {
  return updateAgentHarnessSessionWithStatus(
    id,
    patch,
    expectedStatus,
    expectedGeneration,
    expectedFollowUpClaimId,
    fence,
  );
}

export async function updateAgentHarnessSessionIfFollowUpClaim(
  id: string,
  claimId: string,
  patch:
    | Partial<Omit<SaveAgentHarnessSessionInput, "id">>
    | ((
        existing: StoredAgentHarnessSession,
      ) =>
        | Partial<Omit<SaveAgentHarnessSessionInput, "id">>
        | Promise<Partial<Omit<SaveAgentHarnessSessionInput, "id">>>),
  options: {
    expectedApprovalResolutionId?: string | null;
    allowCurrentApprovalResolution?: boolean;
    requiresNoApprovalResolution?: boolean;
  } = {},
): Promise<StoredAgentHarnessSession | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existing = await getAgentHarnessSession(id);
    const expectedApprovalResolutionId = options.allowCurrentApprovalResolution
      ? (existing?.approvalResolutionId ?? null)
      : (options.expectedApprovalResolutionId ?? null);
    if (
      !existing ||
      existing.status !== "running" ||
      existing.followUpClaimId !== claimId ||
      existing.followUpClaimExpiresAt == null ||
      existing.followUpClaimExpiresAt <= Date.now() ||
      existing.followUpDeadlineAt == null ||
      existing.followUpDeadlineAt <= Date.now() ||
      (options.requiresNoApprovalResolution && existing.approvalResolutionId) ||
      existing.approvalResolutionId !== expectedApprovalResolutionId
    ) {
      return null;
    }
    const update = typeof patch === "function" ? await patch(existing) : patch;
    try {
      return await saveAgentHarnessSession({
        id,
        harnessName: update.harnessName ?? existing.harnessName,
        threadId: update.threadId ?? existing.threadId,
        runId: update.runId ?? existing.runId ?? null,
        providerSessionId:
          update.providerSessionId ?? existing.providerSessionId ?? null,
        status: update.status ?? existing.status,
        resumeState:
          update.resumeState !== undefined
            ? update.resumeState
            : existing.resumeState,
        workspaceRef: update.workspaceRef ?? existing.workspaceRef ?? null,
        pendingApproval:
          update.pendingApproval !== undefined
            ? update.pendingApproval
            : existing.pendingApproval,
        approvalResolutionId:
          update.approvalResolutionId !== undefined
            ? update.approvalResolutionId
            : existing.approvalResolutionId,
        expiryCleanupId:
          update.expiryCleanupId !== undefined
            ? update.expiryCleanupId
            : existing.expiryCleanupId,
        resolvedApprovalIds:
          update.resolvedApprovalIds ?? existing.resolvedApprovalIds,
        ownerEmail: update.ownerEmail ?? existing.ownerEmail ?? null,
        orgId: update.orgId ?? existing.orgId ?? null,
        followUpClaimId:
          update.followUpClaimId !== undefined
            ? update.followUpClaimId
            : existing.followUpClaimId,
        followUpId:
          update.followUpId !== undefined
            ? update.followUpId
            : existing.followUpId,
        followUpPrompt:
          update.followUpPrompt !== undefined
            ? update.followUpPrompt
            : existing.followUpPrompt,
        followUpMetadata:
          update.followUpMetadata !== undefined
            ? update.followUpMetadata
            : existing.followUpMetadata,
        followUpClaimExpiresAt:
          update.followUpClaimExpiresAt !== undefined
            ? update.followUpClaimExpiresAt
            : existing.followUpClaimExpiresAt,
        followUpDeadlineAt:
          update.followUpDeadlineAt !== undefined
            ? update.followUpDeadlineAt
            : existing.followUpDeadlineAt,
        followUpDispatchedAt:
          update.followUpDispatchedAt !== undefined
            ? update.followUpDispatchedAt
            : existing.followUpDispatchedAt,
        followUpOutcome:
          update.followUpOutcome !== undefined
            ? update.followUpOutcome
            : existing.followUpOutcome,
        stoppedAt: update.stoppedAt ?? existing.stoppedAt ?? null,
        expectedGeneration: existing.generation,
        expectedStatus: "running",
        expectedFollowUpClaimId: claimId,
        requiresActiveFollowUpClaim: true,
        expectedApprovalResolutionId,
        expectedExpiryCleanupId: null,
        requiresNoApprovalResolution: options.requiresNoApprovalResolution,
        existingSession: existing,
      });
    } catch (error) {
      if (!isAgentHarnessSessionConflictError(error) || attempt === 2) {
        throw error;
      }
    }
  }
  throw new AgentHarnessSessionConflictError(id);
}

export async function claimAgentHarnessSessionFollowUp(
  id: string,
  expectedGeneration: number,
  claimId: string,
  intent: AgentHarnessFollowUpIntent,
): Promise<StoredAgentHarnessSession | null> {
  await ensureAgentHarnessSessionTables();
  const client = getDbExec();
  if (!client.transaction) {
    throw new Error(
      "Agent harness follow-up admission requires a transaction.",
    );
  }
  const now = Date.now();
  const claimed = await client.transaction(async (tx) => {
    const { rows } = await tx.execute({
      sql: `UPDATE agent_harness_sessions
            SET status = 'running', follow_up_claim_id = ?, follow_up_id = ?,
                follow_up_prompt = ?, follow_up_metadata = ?,
                follow_up_claim_expires_at = ?, follow_up_deadline_at = ?,
                follow_up_dispatched_at = NULL, follow_up_outcome = NULL,
                generation = generation + 1, updated_at = ?
            WHERE id = ? AND generation = ? AND status = 'idle'
              AND pending_approval IS NULL
              AND expiry_cleanup_id IS NULL
            RETURNING *`,
      args: [
        claimId,
        intent.followUpId,
        intent.prompt,
        serializeJson(redactArgsToValue(intent.metadata)),
        intent.claimExpiresAt,
        intent.deadlineAt,
        now,
        id,
        expectedGeneration,
      ],
    });
    const session = rowToHarnessSession(rows[0]);
    if (!session) return null;
    await appendAgentHarnessSessionEventInTransaction(tx, {
      sessionId: id,
      operationId: followUpOperationId(intent.followUpId),
      eventAt: now,
      event: { type: "text", text: intent.prompt },
    });
    return session;
  });
  if (claimed) return claimed;

  const current = await getAgentHarnessSession(id);
  return current?.status === "running" && current.followUpClaimId === claimId
    ? current
    : null;
}

export async function markAgentHarnessSessionFollowUpDispatched(
  id: string,
  expectedGeneration: number,
  claimId: string,
  now = Date.now(),
): Promise<StoredAgentHarnessSession | null> {
  await ensureAgentHarnessSessionTables();
  const { rows } = await getDbExec().execute({
    sql: `UPDATE agent_harness_sessions
          SET follow_up_dispatched_at = ?, generation = generation + 1,
              updated_at = ?
          WHERE id = ? AND status = 'running' AND follow_up_claim_id = ?
            AND generation = ? AND follow_up_dispatched_at IS NULL
            AND follow_up_deadline_at > ?
            AND follow_up_claim_expires_at > ${DATABASE_NOW_MS_SQL}
            AND follow_up_deadline_at > ${DATABASE_NOW_MS_SQL}
            AND expiry_cleanup_id IS NULL
          RETURNING *`,
    args: [now, now, id, claimId, expectedGeneration, now],
  });
  return rowToHarnessSession(rows[0]);
}

export async function renewAgentHarnessSessionFollowUpClaim(
  id: string,
  claimId: string,
  now: number,
  leaseExpiresAt: number,
): Promise<boolean> {
  await ensureAgentHarnessSessionTables();
  const { rowsAffected } = await getDbExec().execute({
    sql: `UPDATE agent_harness_sessions
          SET follow_up_claim_expires_at = ?
          WHERE id = ? AND status = 'running' AND follow_up_claim_id = ?
            AND follow_up_deadline_at > ?
            AND follow_up_claim_expires_at > ${DATABASE_NOW_MS_SQL}
            AND follow_up_deadline_at > ${DATABASE_NOW_MS_SQL}
            AND follow_up_claim_expires_at < follow_up_deadline_at
            AND ? > ?
            AND ? <= follow_up_deadline_at
            AND expiry_cleanup_id IS NULL`,
    args: [
      leaseExpiresAt,
      id,
      claimId,
      now,
      leaseExpiresAt,
      now,
      leaseExpiresAt,
    ],
  });
  return rowsAffected === 1;
}

export async function persistAgentHarnessFollowUpEvent(
  sessionId: string,
  followUpId: string,
  claimId: string,
  event: AgentChatEvent,
  eventAt = Date.now(),
): Promise<void> {
  await ensureAgentHarnessSessionTables();
  const client = getDbExec();
  if (!client.transaction) {
    throw new Error("Agent harness transcript writes require a transaction.");
  }
  await client.transaction(async (tx) => {
    const { rows } = await tx.execute({
      sql: `SELECT follow_up_id FROM agent_harness_sessions
            WHERE id = ? AND status = 'running' AND follow_up_claim_id = ?
              AND follow_up_claim_expires_at > ${DATABASE_NOW_MS_SQL}
              AND follow_up_deadline_at > ${DATABASE_NOW_MS_SQL}
            FOR UPDATE`,
      args: [sessionId, claimId],
    });
    const active = rows[0] as { follow_up_id?: string } | undefined;
    if (active?.follow_up_id !== followUpId) {
      throw new AgentHarnessSessionConflictError(sessionId);
    }
    await appendAgentHarnessSessionEventInTransaction(tx, {
      sessionId,
      operationId: followUpOperationId(followUpId),
      eventAt,
      event,
    });
  });
}

export async function persistAgentHarnessApprovalEvent(
  sessionId: string,
  approvalId: string,
  event: AgentChatEvent,
  eventAt = Date.now(),
): Promise<void> {
  await ensureAgentHarnessSessionTables();
  const client = getDbExec();
  if (!client.transaction) {
    throw new Error("Agent harness transcript writes require a transaction.");
  }
  await client.transaction(async (tx) => {
    const { rows } = await tx.execute({
      sql: `SELECT id FROM agent_harness_sessions
            WHERE id = ? AND approval_resolution_id = ?
              AND status NOT IN ('stopped', 'errored', 'destroyed')
              AND expiry_cleanup_id IS NULL
            FOR UPDATE`,
      args: [sessionId, approvalId],
    });
    if (rows.length !== 1) {
      throw new AgentHarnessSessionConflictError(sessionId);
    }
    await appendAgentHarnessSessionEventInTransaction(tx, {
      sessionId,
      operationId: approvalOperationId(approvalId),
      eventAt,
      event,
    });
  });
}

export async function listAgentHarnessSessionEvents(
  sessionId: string,
): Promise<StoredAgentHarnessSessionEvent[]> {
  await ensureAgentHarnessSessionTables();
  const { rows } = await getDbExec().execute({
    sql: `SELECT operation_id, seq, event_at, event_data
          FROM agent_harness_session_events
          WHERE session_id = ? ORDER BY seq`,
    args: [sessionId],
  });
  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    const eventData = String(record.event_data);
    let event: AgentChatEvent;
    try {
      event = JSON.parse(eventData) as AgentChatEvent;
    } catch (error) {
      throw new Error(
        `Could not parse persisted AgentHarness follow-up event for session ${sessionId}.`,
        { cause: error },
      );
    }
    return {
      operationId: String(record.operation_id),
      seq: numberValue(record.seq),
      eventAt: numberValue(record.event_at),
      event,
    };
  });
}

export async function reconcileExpiredAgentHarnessFollowUp(
  sessionId: string,
  claimId: string,
  expectedGeneration: number,
  now: number,
): Promise<StoredAgentHarnessSession | null> {
  await ensureAgentHarnessSessionTables();
  const client = getDbExec();
  if (!client.transaction) {
    throw new Error("Agent harness follow-up recovery requires a transaction.");
  }
  return client.transaction(async (tx) => {
    const { rows } = await tx.execute({
      sql: `SELECT * FROM agent_harness_sessions
            WHERE id = ? AND status = 'running' AND follow_up_claim_id = ?
              AND generation = ?
              AND (
                (COALESCE(follow_up_claim_expires_at, updated_at + ?) <= ?
                  AND COALESCE(follow_up_claim_expires_at, updated_at + ?) <= ${DATABASE_NOW_MS_SQL})
                OR (follow_up_deadline_at <= ?
                  AND follow_up_deadline_at <= ${DATABASE_NOW_MS_SQL})
              )
            FOR UPDATE`,
      args: [
        sessionId,
        claimId,
        expectedGeneration,
        LEGACY_FOLLOW_UP_CLAIM_GRACE_MS,
        now,
        LEGACY_FOLLOW_UP_CLAIM_GRACE_MS,
        now,
      ],
    });
    const current = rowToHarnessSession(rows[0]);
    if (!current) return null;

    const followUpId = current.followUpId ?? `recovered:${claimId}`;
    const notDispatched =
      current.followUpId != null &&
      current.followUpPrompt != null &&
      current.followUpDispatchedAt == null;
    const event: AgentChatEvent = {
      type: "error",
      error: notDispatched
        ? "The follow-up stopped before it was sent to the harness. No harness action was started; you can submit it again."
        : "The follow-up outcome is unknown because its worker stopped after dispatch. Check for completed effects before submitting it again.",
      errorCode: notDispatched
        ? "harness_follow_up_not_dispatched"
        : "harness_follow_up_outcome_unknown",
    };
    await appendAgentHarnessSessionEventInTransaction(tx, {
      sessionId,
      operationId: followUpOperationId(followUpId),
      eventAt: now,
      event,
    });
    const { rows: updatedRows } = await tx.execute({
      sql: `UPDATE agent_harness_sessions
            SET status = 'idle', follow_up_claim_id = NULL,
                follow_up_claim_expires_at = NULL, follow_up_deadline_at = NULL,
                follow_up_id = ?,
                follow_up_outcome = ?, generation = generation + 1,
                updated_at = ?
            WHERE id = ? AND status = 'running' AND follow_up_claim_id = ?
              AND generation = ?
            RETURNING *`,
      args: [
        followUpId,
        notDispatched ? "not_dispatched" : "unknown",
        now,
        sessionId,
        claimId,
        expectedGeneration,
      ],
    });
    return rowToHarnessSession(updatedRows[0]);
  });
}

export async function listExpiredAgentHarnessFollowUps(
  now: number,
  limit = 50,
): Promise<StoredAgentHarnessSession[]> {
  await ensureAgentHarnessSessionTables();
  const boundedLimit = Math.max(1, Math.min(200, limit));
  const { rows } = await getDbExec().execute({
    sql: `SELECT * FROM agent_harness_sessions
          WHERE status = 'running' AND follow_up_claim_id IS NOT NULL
            AND (
              (COALESCE(follow_up_claim_expires_at, updated_at + ?) <= ?
                AND COALESCE(follow_up_claim_expires_at, updated_at + ?) <= ${DATABASE_NOW_MS_SQL})
              OR (follow_up_deadline_at <= ?
                AND follow_up_deadline_at <= ${DATABASE_NOW_MS_SQL})
            )
          ORDER BY follow_up_claim_expires_at, updated_at
          LIMIT ?`,
    args: [
      LEGACY_FOLLOW_UP_CLAIM_GRACE_MS,
      now,
      LEGACY_FOLLOW_UP_CLAIM_GRACE_MS,
      now,
      boundedLimit,
    ],
  });
  return rows.map(rowToHarnessSession).filter(isStoredSession);
}

async function appendAgentHarnessSessionEventInTransaction(
  tx: DbExec,
  input: {
    sessionId: string;
    operationId: string;
    eventAt: number;
    event: AgentChatEvent;
  },
): Promise<void> {
  const redactedEvent = redactArgsToValue(input.event);
  const safeEvent =
    input.event.type === "error" &&
    typeof input.event.errorCode === "string" &&
    /^[a-z][a-z0-9_:-]{0,100}$/i.test(input.event.errorCode) &&
    redactedEvent != null &&
    typeof redactedEvent === "object" &&
    !Array.isArray(redactedEvent)
      ? { ...redactedEvent, errorCode: input.event.errorCode }
      : redactedEvent;
  const eventData = JSON.stringify(safeEvent);
  if (!eventData) {
    throw new Error("Agent harness follow-up event could not be serialized.");
  }
  const { rows } = await tx.execute({
    sql: `SELECT COALESCE(MAX(seq), -1) + 1 AS seq
          FROM agent_harness_session_events
          WHERE session_id = ?`,
    args: [input.sessionId],
  });
  const seq = numberValue(
    (rows[0] as { seq?: number | string } | undefined)?.seq,
  );
  await tx.execute({
    sql: `INSERT INTO agent_harness_session_events
            (session_id, operation_id, seq, event_at, event_data)
          VALUES (?, ?, ?, ?, ?)`,
    args: [input.sessionId, input.operationId, seq, input.eventAt, eventData],
  });
}

function followUpOperationId(followUpId: string): string {
  return `follow-up:${followUpId}`;
}

function approvalOperationId(approvalId: string): string {
  return `approval:${approvalId}`;
}

export async function startAgentHarnessSessionFollowUpDispatch<T>(
  id: string,
  expectedGeneration: number,
  claimId: string,
  start: () => T,
): Promise<{ session: StoredAgentHarnessSession; started: T } | null> {
  await ensureAgentHarnessSessionTables();
  const client = getDbExec();
  if (!client.transaction) {
    throw new Error(
      "Agent harness follow-up dispatch requires database transactions.",
    );
  }
  return client.transaction(async (tx) => {
    const { rows } = await tx.execute({
      sql: `UPDATE agent_harness_sessions
            SET generation = generation + 1, updated_at = ?
            WHERE id = ? AND status = 'running' AND follow_up_claim_id = ?
              AND generation = ?
              AND follow_up_claim_expires_at > ${DATABASE_NOW_MS_SQL}
              AND follow_up_deadline_at > ${DATABASE_NOW_MS_SQL}
              AND follow_up_deadline_at > ?
              AND expiry_cleanup_id IS NULL
            RETURNING *`,
      args: [Date.now(), id, claimId, expectedGeneration, Date.now()],
    });
    const session = rowToHarnessSession(rows[0]);
    if (!session) return null;

    // The UPDATE holds this row lock until the first provider request is invoked.
    const started = start();
    return { session, started };
  });
}

export async function startAgentHarnessSessionApprovalDispatch<T>(
  id: string,
  expectedStatus: AgentHarnessSessionStatus,
  expectedGeneration: number,
  approvalId: string,
  start: () => T,
): Promise<{ session: StoredAgentHarnessSession; started: T } | null> {
  await ensureAgentHarnessSessionTables();
  const client = getDbExec();
  if (!client.transaction) {
    throw new Error(
      "Agent harness approval dispatch requires database transactions.",
    );
  }
  return client.transaction(async (tx) => {
    const { rows } = await tx.execute({
      sql: `UPDATE agent_harness_sessions
            SET generation = generation + 1, updated_at = ?
            WHERE id = ? AND status = ? AND approval_resolution_id = ?
              AND generation = ?
              AND expiry_cleanup_id IS NULL
            RETURNING *`,
      args: [Date.now(), id, expectedStatus, approvalId, expectedGeneration],
    });
    const session = rowToHarnessSession(rows[0]);
    if (!session) return null;

    const started = start();
    return { session, started };
  });
}

export async function startAgentHarnessSessionExpiryCleanup<T>(
  id: string,
  expectedStatus: AgentHarnessSessionStatus,
  expectedGeneration: number,
  cleanupId: string,
  start: () => T,
): Promise<{ session: StoredAgentHarnessSession; started: T } | null> {
  await ensureAgentHarnessSessionTables();
  const client = getDbExec();
  if (!client.transaction) {
    throw new Error(
      "Agent harness expiry cleanup requires database transactions.",
    );
  }
  return client.transaction(async (tx) => {
    const { rows } = await tx.execute({
      sql: `UPDATE agent_harness_sessions
            SET expiry_cleanup_id = ?, generation = generation + 1, updated_at = ?
            WHERE id = ? AND status = ? AND generation = ?
              AND follow_up_claim_id IS NULL
              AND approval_resolution_id IS NULL
              AND expiry_cleanup_id IS NULL
            RETURNING *`,
      args: [cleanupId, Date.now(), id, expectedStatus, expectedGeneration],
    });
    const session = rowToHarnessSession(rows[0]);
    if (!session) return null;

    const started = start();
    return { session, started };
  });
}

export async function finishAgentHarnessSessionExpiryCleanup(
  id: string,
  cleanupId: string,
  expectedGeneration: number,
): Promise<StoredAgentHarnessSession | null> {
  await ensureAgentHarnessSessionTables();
  const now = Date.now();
  const { rows } = await getDbExec().execute({
    sql: `UPDATE agent_harness_sessions
          SET expiry_cleanup_id = NULL, generation = generation + 1,
              updated_at = ?
          WHERE id = ? AND expiry_cleanup_id = ? AND generation = ?
          RETURNING *`,
    args: [now, id, cleanupId, expectedGeneration],
  });
  const finished = rowToHarnessSession(rows[0]);
  if (finished) return finished;
  const current = await getAgentHarnessSession(id);
  return current?.expiryCleanupId == null ? current : null;
}

async function updateAgentHarnessSessionWithStatus(
  id: string,
  patch: Partial<Omit<SaveAgentHarnessSessionInput, "id">>,
  expectedStatus?: AgentHarnessSessionStatus,
  expectedGeneration?: number,
  expectedFollowUpClaimId?: string,
  fence: boolean | AgentHarnessSessionGenerationFence = false,
): Promise<StoredAgentHarnessSession | null> {
  const existing = await getAgentHarnessSession(id);
  if (!existing) return null;
  if (expectedStatus !== undefined && existing.status !== expectedStatus) {
    return null;
  }
  if (
    expectedGeneration !== undefined &&
    existing.generation !== expectedGeneration
  ) {
    throw new AgentHarnessSessionConflictError(id);
  }
  if (
    expectedFollowUpClaimId !== undefined &&
    existing.followUpClaimId !== expectedFollowUpClaimId
  ) {
    return null;
  }
  const requiresNoApprovalResolution =
    typeof fence === "boolean" ? fence : fence.requiresNoApprovalResolution;
  const expectedApprovalResolutionId =
    typeof fence === "boolean" ? undefined : fence.expectedApprovalResolutionId;
  if (requiresNoApprovalResolution && existing.approvalResolutionId) {
    return null;
  }
  return saveAgentHarnessSession({
    id,
    harnessName: patch.harnessName ?? existing.harnessName,
    threadId: patch.threadId ?? existing.threadId,
    runId: patch.runId ?? existing.runId ?? null,
    providerSessionId:
      patch.providerSessionId ?? existing.providerSessionId ?? null,
    status: patch.status ?? existing.status,
    resumeState:
      patch.resumeState !== undefined
        ? patch.resumeState
        : existing.resumeState,
    workspaceRef: patch.workspaceRef ?? existing.workspaceRef ?? null,
    pendingApproval:
      patch.pendingApproval !== undefined
        ? patch.pendingApproval
        : existing.pendingApproval,
    approvalResolutionId:
      patch.approvalResolutionId !== undefined
        ? patch.approvalResolutionId
        : existing.approvalResolutionId,
    expiryCleanupId:
      patch.expiryCleanupId !== undefined
        ? patch.expiryCleanupId
        : existing.expiryCleanupId,
    resolvedApprovalIds:
      patch.resolvedApprovalIds ?? existing.resolvedApprovalIds,
    ownerEmail: patch.ownerEmail ?? existing.ownerEmail ?? null,
    orgId: patch.orgId ?? existing.orgId ?? null,
    followUpClaimId:
      patch.followUpClaimId !== undefined
        ? patch.followUpClaimId
        : (existing.followUpClaimId ?? null),
    stoppedAt: patch.stoppedAt ?? existing.stoppedAt ?? null,
    expectedGeneration: expectedGeneration ?? existing.generation,
    expectedStatus,
    expectedFollowUpClaimId,
    expectedApprovalResolutionId,
    requiresNoApprovalResolution,
    existingSession: existing,
  });
}

export async function getAgentHarnessSession(
  id: string,
): Promise<StoredAgentHarnessSession | null> {
  await ensureAgentHarnessSessionTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM agent_harness_sessions WHERE id = ?`,
    args: [id],
  });
  return rowToHarnessSession(rows[0]);
}

export async function getLatestAgentHarnessSessionForThread(
  threadId: string,
  harnessName?: string,
): Promise<StoredAgentHarnessSession | null> {
  await ensureAgentHarnessSessionTables();
  const client = getDbExec();
  const { rows } = harnessName
    ? await client.execute({
        sql: `SELECT * FROM agent_harness_sessions
              WHERE thread_id = ? AND harness_name = ? AND status != 'destroyed'
              ORDER BY updated_at DESC LIMIT 1`,
        args: [threadId, harnessName],
      })
    : await client.execute({
        sql: `SELECT * FROM agent_harness_sessions
              WHERE thread_id = ? AND status != 'destroyed'
              ORDER BY updated_at DESC LIMIT 1`,
        args: [threadId],
      });
  return rowToHarnessSession(rows[0]);
}

export async function getAgentHarnessSessionByRunId(
  runId: string,
): Promise<StoredAgentHarnessSession | null> {
  await ensureAgentHarnessSessionTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM agent_harness_sessions
          WHERE run_id = ?
          ORDER BY updated_at DESC LIMIT 1`,
    args: [runId],
  });
  return rowToHarnessSession(rows[0]);
}

export async function listAgentHarnessSessions(
  options: {
    status?: AgentHarnessSessionStatus;
    threadId?: string;
    ownerEmail?: string | null;
    orgId?: string | null;
    limit?: number;
  } = {},
): Promise<StoredAgentHarnessSession[]> {
  await ensureAgentHarnessSessionTables();
  const limit = Math.max(1, Math.min(200, options.limit ?? 50));
  const client = getDbExec();
  if (options.ownerEmail) {
    const { rows } = await client.execute({
      sql: `SELECT * FROM agent_harness_sessions
            WHERE owner_email = ?
            ORDER BY updated_at DESC LIMIT ?`,
      args: [options.ownerEmail, limit],
    });
    const sessions = rows.map(rowToHarnessSession).filter(isStoredSession);
    return sessions.filter(
      (session) =>
        (!options.threadId || session.threadId === options.threadId) &&
        (!options.status || session.status === options.status) &&
        (!options.orgId || session.orgId === options.orgId),
    );
  }
  if (options.threadId && options.status) {
    const { rows } = await client.execute({
      sql: `SELECT * FROM agent_harness_sessions
            WHERE thread_id = ? AND status = ?
            ORDER BY updated_at DESC LIMIT ?`,
      args: [options.threadId, options.status, limit],
    });
    return rows.map(rowToHarnessSession).filter(isStoredSession);
  }
  if (options.threadId) {
    const { rows } = await client.execute({
      sql: `SELECT * FROM agent_harness_sessions
            WHERE thread_id = ?
            ORDER BY updated_at DESC LIMIT ?`,
      args: [options.threadId, limit],
    });
    return rows.map(rowToHarnessSession).filter(isStoredSession);
  }
  if (options.status) {
    const { rows } = await client.execute({
      sql: `SELECT * FROM agent_harness_sessions
            WHERE status = ?
            ORDER BY updated_at DESC LIMIT ?`,
      args: [options.status, limit],
    });
    return rows.map(rowToHarnessSession).filter(isStoredSession);
  }
  const { rows } = await client.execute({
    sql: `SELECT * FROM agent_harness_sessions
          ORDER BY updated_at DESC LIMIT ?`,
    args: [limit],
  });
  return rows.map(rowToHarnessSession).filter(isStoredSession);
}

export async function markAgentHarnessSessionStopped(
  id: string,
  status: Extract<
    AgentHarnessSessionStatus,
    "stopped" | "destroyed" | "errored"
  >,
): Promise<StoredAgentHarnessSession | null> {
  await ensureAgentHarnessSessionTables();
  const stoppedAt = Date.now();
  const { rows } = await getDbExec().execute({
    sql: `UPDATE agent_harness_sessions
          SET status = ?, stopped_at = ?, pending_approval = NULL,
              follow_up_claim_id = NULL, approval_resolution_id = NULL,
              expiry_cleanup_id = NULL,
              generation = generation + 1,
              updated_at = ?
          WHERE id = ?
          RETURNING *`,
    args: [status, stoppedAt, stoppedAt, id],
  });
  return rowToHarnessSession(rows[0]);
}

export async function markAgentHarnessSessionStoppedIfUnclaimed(
  id: string,
  expectedStatus: AgentHarnessSessionStatus,
  expectedGeneration: number,
  status: Extract<
    AgentHarnessSessionStatus,
    "stopped" | "destroyed" | "errored"
  >,
): Promise<StoredAgentHarnessSession | null> {
  await ensureAgentHarnessSessionTables();
  const stoppedAt = Date.now();
  const { rows } = await getDbExec().execute({
    sql: `UPDATE agent_harness_sessions
          SET status = ?, stopped_at = ?, pending_approval = NULL,
              follow_up_claim_id = NULL, approval_resolution_id = NULL,
              expiry_cleanup_id = NULL,
              generation = generation + 1,
              updated_at = ?
          WHERE id = ? AND status = ? AND generation = ?
            AND follow_up_claim_id IS NULL
            AND expiry_cleanup_id IS NULL
          RETURNING *`,
    args: [
      status,
      stoppedAt,
      stoppedAt,
      id,
      expectedStatus,
      expectedGeneration,
    ],
  });
  return rowToHarnessSession(rows[0]);
}

function rowToHarnessSession(row: unknown): StoredAgentHarnessSession | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  return {
    id: String(record.id),
    harnessName: String(record.harness_name),
    threadId: String(record.thread_id),
    runId: stringOrNull(record.run_id),
    providerSessionId: stringOrNull(record.provider_session_id),
    status: normalizeStatus(record.status),
    resumeState: parseJson(record.resume_state),
    workspaceRef: stringOrNull(record.workspace_ref),
    pendingApproval: parseJson(record.pending_approval),
    approvalResolutionId: stringOrNull(record.approval_resolution_id),
    expiryCleanupId: stringOrNull(record.expiry_cleanup_id),
    resolvedApprovalIds: stringArray(record.resolved_approval_ids),
    ownerEmail: stringOrNull(record.owner_email),
    orgId: stringOrNull(record.org_id),
    followUpClaimId: stringOrNull(record.follow_up_claim_id),
    followUpId: stringOrNull(record.follow_up_id),
    followUpPrompt: stringOrNull(record.follow_up_prompt),
    followUpMetadata: parseJson(record.follow_up_metadata),
    followUpClaimExpiresAt: nullableNumber(record.follow_up_claim_expires_at),
    followUpDeadlineAt: nullableNumber(record.follow_up_deadline_at),
    followUpDispatchedAt: nullableNumber(record.follow_up_dispatched_at),
    followUpOutcome: normalizeFollowUpOutcome(record.follow_up_outcome),
    generation: numberValue(record.generation),
    createdAt: numberValue(record.created_at),
    updatedAt: numberValue(record.updated_at),
    stoppedAt:
      record.stopped_at === null || record.stopped_at === undefined
        ? null
        : numberValue(record.stopped_at),
  };
}

function isStoredSession(
  session: StoredAgentHarnessSession | null,
): session is StoredAgentHarnessSession {
  return Boolean(session);
}

function normalizeStatus(value: unknown): AgentHarnessSessionStatus {
  return value === "running" ||
    value === "idle" ||
    value === "stopped" ||
    value === "errored" ||
    value === "destroyed"
    ? value
    : "idle";
}

function serializeJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || !value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function stringArray(value: unknown): string[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : numberValue(value);
}

function normalizeFollowUpOutcome(
  value: unknown,
): StoredAgentHarnessSession["followUpOutcome"] {
  return value === "completed" ||
    value === "not_dispatched" ||
    value === "unknown"
    ? value
    : null;
}
