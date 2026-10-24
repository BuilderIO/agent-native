import { getDbExec } from "../../db/client.js";
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../../db/ddl-guard.js";
import { defineStore } from "../../db/store-registry.js";
import { fromMigrationEntries } from "../../db/versioned-store-migrations.js";
import {
  AGENT_HARNESS_SESSION_MIGRATIONS,
  AGENT_HARNESS_SESSION_MIGRATIONS_TABLE,
} from "./migrations.js";

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
  resolvedApprovalIds?: string[];
  ownerEmail?: string | null;
  orgId?: string | null;
  followUpClaimId?: string | null;
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
  resolvedApprovalIds?: string[];
  ownerEmail?: string | null;
  orgId?: string | null;
  followUpClaimId?: string | null;
  stoppedAt?: number | null;
  expectedGeneration?: number;
  existingSession?: StoredAgentHarnessSession | null;
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
    resolvedApprovalIds:
      input.resolvedApprovalIds ?? existing?.resolvedApprovalIds ?? [],
    ownerEmail: input.ownerEmail ?? existing?.ownerEmail ?? null,
    orgId: input.orgId ?? existing?.orgId ?? null,
    followUpClaimId:
      input.followUpClaimId !== undefined
        ? input.followUpClaimId
        : (existing?.followUpClaimId ?? null),
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
    serializeJson(record.resolvedApprovalIds),
    record.ownerEmail ?? null,
    record.orgId ?? null,
    record.generation,
    record.createdAt,
    record.updatedAt,
    record.stoppedAt ?? null,
    record.followUpClaimId ?? null,
  ];
  if (!existing) {
    const inserted = await client.execute({
      sql: `INSERT INTO agent_harness_sessions (
              id, harness_name, thread_id, run_id, provider_session_id, status,
              resume_state, workspace_ref, pending_approval, approval_resolution_id,
              resolved_approval_ids,
              owner_email, org_id, generation, created_at, updated_at, stopped_at,
              follow_up_claim_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  const updated = await client.execute({
    sql: `UPDATE agent_harness_sessions SET
            harness_name = ?, thread_id = ?, run_id = ?, provider_session_id = ?,
            status = ?, resume_state = ?, workspace_ref = ?, pending_approval = ?,
            approval_resolution_id = ?, resolved_approval_ids = ?, owner_email = ?,
            org_id = ?, generation = ?,
            updated_at = ?, stopped_at = ?, follow_up_claim_id = ?
          WHERE id = ? AND generation = ?`,
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
      serializeJson(record.resolvedApprovalIds),
      record.ownerEmail ?? null,
      record.orgId ?? null,
      record.generation,
      record.updatedAt,
      record.stoppedAt ?? null,
      record.followUpClaimId ?? null,
      record.id,
      expectedGeneration,
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
): Promise<StoredAgentHarnessSession | null> {
  return updateAgentHarnessSessionWithStatus(
    id,
    patch,
    expectedStatus,
    expectedGeneration,
    expectedFollowUpClaimId,
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
): Promise<StoredAgentHarnessSession | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existing = await getAgentHarnessSession(id);
    if (
      !existing ||
      existing.status !== "running" ||
      existing.followUpClaimId !== claimId
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
        resolvedApprovalIds:
          update.resolvedApprovalIds ?? existing.resolvedApprovalIds,
        ownerEmail: update.ownerEmail ?? existing.ownerEmail ?? null,
        orgId: update.orgId ?? existing.orgId ?? null,
        followUpClaimId:
          update.followUpClaimId !== undefined
            ? update.followUpClaimId
            : existing.followUpClaimId,
        stoppedAt: update.stoppedAt ?? existing.stoppedAt ?? null,
        expectedGeneration: existing.generation,
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
): Promise<StoredAgentHarnessSession | null> {
  await ensureAgentHarnessSessionTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `UPDATE agent_harness_sessions
          SET status = 'running', follow_up_claim_id = ?,
              generation = generation + 1, updated_at = ?
          WHERE id = ? AND generation = ? AND status = 'idle'
            AND pending_approval IS NULL
          RETURNING *`,
    args: [claimId, Date.now(), id, expectedGeneration],
  });
  const claimed = rowToHarnessSession(rows[0]);
  if (claimed) return claimed;

  const current = await getAgentHarnessSession(id);
  return current?.status === "running" && current.followUpClaimId === claimId
    ? current
    : null;
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
            RETURNING *`,
      args: [Date.now(), id, claimId, expectedGeneration],
    });
    const session = rowToHarnessSession(rows[0]);
    if (!session) return null;

    // The UPDATE holds this row lock until the first provider request is invoked.
    const started = start();
    return { session, started };
  });
}

async function updateAgentHarnessSessionWithStatus(
  id: string,
  patch: Partial<Omit<SaveAgentHarnessSessionInput, "id">>,
  expectedStatus?: AgentHarnessSessionStatus,
  expectedGeneration?: number,
  expectedFollowUpClaimId?: string,
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
              follow_up_claim_id = NULL, generation = generation + 1,
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
              follow_up_claim_id = NULL, generation = generation + 1,
              updated_at = ?
          WHERE id = ? AND status = ? AND generation = ?
            AND follow_up_claim_id IS NULL
            AND approval_resolution_id IS NULL
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
    resolvedApprovalIds: stringArray(record.resolved_approval_ids),
    ownerEmail: stringOrNull(record.owner_email),
    orgId: stringOrNull(record.org_id),
    followUpClaimId: stringOrNull(record.follow_up_claim_id),
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
