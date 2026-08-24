import { getDbExec, intType, isPostgres } from "../../db/client.js";
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../../db/ddl-guard.js";

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
  resolvedApprovalIds?: string[];
  ownerEmail?: string | null;
  orgId?: string | null;
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
  resolvedApprovalIds?: string[];
  ownerEmail?: string | null;
  orgId?: string | null;
  stoppedAt?: number | null;
  /** Internal optimistic-concurrency token used by updateAgentHarnessSession. */
  expectedGeneration?: number;
  /** Snapshot used by updateAgentHarnessSession so merge and CAS share a read. */
  existingSession?: StoredAgentHarnessSession | null;
}

let initPromise: Promise<void> | undefined;

export async function ensureAgentHarnessSessionTables(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const client = getDbExec();
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
          resolved_approval_ids TEXT,
          owner_email TEXT,
          org_id TEXT,
          generation ${intType()} NOT NULL DEFAULT 0,
          created_at ${intType()} NOT NULL,
          updated_at ${intType()} NOT NULL,
          stopped_at ${intType()}
        )
      `;

      if (isPostgres()) {
        // PG-guard: probe information_schema / pg_indexes before issuing DDL to
        // avoid ACCESS EXCLUSIVE lock contention in fresh background-worker processes.
        await ensureTableExists("agent_harness_sessions", createSql);
        for (const col of [
          "run_id",
          "provider_session_id",
          "resume_state",
          "workspace_ref",
          "pending_approval",
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
          `ALTER TABLE agent_harness_sessions ADD COLUMN IF NOT EXISTS stopped_at ${intType()}`,
        );
        await ensureColumnExists(
          "agent_harness_sessions",
          "generation",
          `ALTER TABLE agent_harness_sessions ADD COLUMN IF NOT EXISTS generation ${intType()} NOT NULL DEFAULT 0`,
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
        return;
      }
      try {
        await client.execute(
          `ALTER TABLE agent_harness_sessions ADD COLUMN generation ${intType()} NOT NULL DEFAULT 0`,
        );
      } catch (error) {
        if (!isDuplicateColumnError(error)) throw error;
      }

      // SQLite (local dev): no lock problem — keep the original behaviour.
      await client.execute(createSql);
      for (const col of [
        "run_id",
        "provider_session_id",
        "resume_state",
        "workspace_ref",
        "pending_approval",
        "resolved_approval_ids",
        "owner_email",
        "org_id",
      ] as const) {
        try {
          await client.execute(
            `ALTER TABLE agent_harness_sessions ADD COLUMN ${col} TEXT`,
          );
        } catch {
          // Column already exists.
        }
      }
      try {
        await client.execute(
          `ALTER TABLE agent_harness_sessions ADD COLUMN stopped_at ${intType()}`,
        );
      } catch {
        // Column already exists.
      }
      try {
        await client.execute(
          `CREATE INDEX IF NOT EXISTS idx_agent_harness_sessions_thread ON agent_harness_sessions(thread_id, updated_at)`,
        );
      } catch {
        // Index already exists.
      }
      try {
        await client.execute(
          `CREATE INDEX IF NOT EXISTS idx_agent_harness_sessions_status ON agent_harness_sessions(status, updated_at)`,
        );
      } catch {
        // Index already exists.
      }
      try {
        await client.execute(
          `CREATE INDEX IF NOT EXISTS idx_agent_harness_sessions_owner ON agent_harness_sessions(owner_email, updated_at)`,
        );
      } catch {
        // Index already exists.
      }
    })().catch((err) => {
      initPromise = undefined;
      throw err;
    });
  }
  return initPromise;
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
    resolvedApprovalIds:
      input.resolvedApprovalIds ?? existing?.resolvedApprovalIds ?? [],
    ownerEmail: input.ownerEmail ?? existing?.ownerEmail ?? null,
    orgId: input.orgId ?? existing?.orgId ?? null,
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
    serializeJson(record.resolvedApprovalIds),
    record.ownerEmail ?? null,
    record.orgId ?? null,
    record.generation,
    record.createdAt,
    record.updatedAt,
    record.stoppedAt ?? null,
  ];
  if (!existing) {
    const inserted = await client.execute({
      sql: `INSERT INTO agent_harness_sessions (
              id, harness_name, thread_id, run_id, provider_session_id, status,
              resume_state, workspace_ref, pending_approval, resolved_approval_ids,
              owner_email, org_id, generation, created_at, updated_at, stopped_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            resolved_approval_ids = ?, owner_email = ?, org_id = ?, generation = ?,
            updated_at = ?, stopped_at = ?
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
      serializeJson(record.resolvedApprovalIds),
      record.ownerEmail ?? null,
      record.orgId ?? null,
      record.generation,
      record.updatedAt,
      record.stoppedAt ?? null,
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
  const existing = await getAgentHarnessSession(id);
  if (!existing) return null;
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
    resolvedApprovalIds:
      patch.resolvedApprovalIds ?? existing.resolvedApprovalIds,
    ownerEmail: patch.ownerEmail ?? existing.ownerEmail ?? null,
    orgId: patch.orgId ?? existing.orgId ?? null,
    stoppedAt: patch.stoppedAt ?? existing.stoppedAt ?? null,
    expectedGeneration: existing.generation,
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
  return updateAgentHarnessSession(id, {
    status,
    stoppedAt: Date.now(),
    pendingApproval: null,
  });
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
    resolvedApprovalIds: stringArray(record.resolved_approval_ids),
    ownerEmail: stringOrNull(record.owner_email),
    orgId: stringOrNull(record.org_id),
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

function isDuplicateColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message = (error as { message?: unknown }).message;
  return (
    typeof message === "string" &&
    /duplicate column name|column .* already exists/i.test(message)
  );
}
