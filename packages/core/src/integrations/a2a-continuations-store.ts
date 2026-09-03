import type { A2AArtifactIdentity } from "../a2a/artifact-response.js";
import {
  getDbExec,
  isPostgres,
  intType,
  retryOnDdlRace,
} from "../db/client.js";
import {
  ensureTableExists,
  ensureColumnExists,
  ensureIndexExists,
} from "../db/ddl-guard.js";
import { isDuplicateColumnError } from "../db/migrations.js";
import type { IncomingMessage, PlatformRunProgressRef } from "./types.js";

let _initPromise: Promise<void> | undefined;
const PROCESSING_STUCK_AFTER_MS = 5 * 60 * 1000;
const PROCESSING_NEXT_CHECK_STALE_AFTER_MS = 60 * 1000;
const TERMINAL_HISTORY_FINALIZATION_LEASE_MS = 60 * 1000;
const MAX_VERIFIED_ARTIFACT_CHECKPOINT_CHARS = 16_000;
const MAX_TERMINAL_HISTORY_PAYLOAD_CHARS = 64_000;

// Build the CREATE SQL lazily (not at module scope) so intType() runs at
// RUNTIME, not import time — a module-scope call breaks any consumer whose
// db/client mock doesn't stub intType (e.g. db-admin specs).
function buildCreateSql(): string {
  return `
  CREATE TABLE IF NOT EXISTS integration_a2a_continuations (
    id TEXT PRIMARY KEY,
    integration_task_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    external_thread_id TEXT NOT NULL,
    incoming_payload TEXT NOT NULL,
    placeholder_ref TEXT,
    progress_ref TEXT,
    progress_ref_claimed ${intType()} NOT NULL DEFAULT 0,
    owner_email TEXT NOT NULL,
    org_id TEXT,
    agent_name TEXT NOT NULL,
    agent_url TEXT NOT NULL,
    dedupe_key TEXT,
    a2a_task_id TEXT NOT NULL,
    a2a_auth_token TEXT,
    verified_artifact_checkpoint TEXT,
    terminal_delivery_kind TEXT,
    terminal_delivery_confirmed_at ${intType()},
    terminal_history_payload TEXT,
    status TEXT NOT NULL,
    attempts ${intType()} NOT NULL DEFAULT 0,
    next_check_at ${intType()} NOT NULL,
    error_message TEXT,
    created_at ${intType()} NOT NULL,
    updated_at ${intType()} NOT NULL,
    completed_at ${intType()}
  )
`;
}

export async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const createSql = buildCreateSql();
      if (isPostgres()) {
        // PG guard: probe via information_schema, only issue DDL if missing, bounded lock_timeout
        await ensureTableExists("integration_a2a_continuations", createSql);
        await ensureIndexExists(
          "idx_a2a_continuations_status_next",
          `CREATE INDEX IF NOT EXISTS idx_a2a_continuations_status_next ON integration_a2a_continuations(status, next_check_at)`,
        );
        await ensureIndexExists(
          "idx_a2a_continuations_integration_task",
          `CREATE INDEX IF NOT EXISTS idx_a2a_continuations_integration_task ON integration_a2a_continuations(integration_task_id)`,
        );
        await ensureIndexExists(
          "idx_a2a_continuations_remote_task",
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_a2a_continuations_remote_task ON integration_a2a_continuations(integration_task_id, agent_url, a2a_task_id)`,
        );
        await ensureColumnExists(
          "integration_a2a_continuations",
          "a2a_auth_token",
          `ALTER TABLE integration_a2a_continuations ADD COLUMN IF NOT EXISTS a2a_auth_token TEXT`,
        );
        await ensureColumnExists(
          "integration_a2a_continuations",
          "dedupe_key",
          `ALTER TABLE integration_a2a_continuations ADD COLUMN IF NOT EXISTS dedupe_key TEXT`,
        );
        await ensureColumnExists(
          "integration_a2a_continuations",
          "progress_ref",
          `ALTER TABLE integration_a2a_continuations ADD COLUMN IF NOT EXISTS progress_ref TEXT`,
        );
        await ensureColumnExists(
          "integration_a2a_continuations",
          "progress_ref_claimed",
          `ALTER TABLE integration_a2a_continuations ADD COLUMN IF NOT EXISTS progress_ref_claimed ${intType()} NOT NULL DEFAULT 0`,
        );
        await ensureColumnExists(
          "integration_a2a_continuations",
          "verified_artifact_checkpoint",
          `ALTER TABLE integration_a2a_continuations ADD COLUMN IF NOT EXISTS verified_artifact_checkpoint TEXT`,
        );
        await ensureColumnExists(
          "integration_a2a_continuations",
          "terminal_delivery_kind",
          `ALTER TABLE integration_a2a_continuations ADD COLUMN IF NOT EXISTS terminal_delivery_kind TEXT`,
        );
        await ensureColumnExists(
          "integration_a2a_continuations",
          "terminal_delivery_confirmed_at",
          `ALTER TABLE integration_a2a_continuations ADD COLUMN IF NOT EXISTS terminal_delivery_confirmed_at ${intType()}`,
        );
        await ensureColumnExists(
          "integration_a2a_continuations",
          "terminal_history_payload",
          `ALTER TABLE integration_a2a_continuations ADD COLUMN IF NOT EXISTS terminal_history_payload TEXT`,
        );
        await backfillLegacyCompletedDeliveries(client);
        await backfillProgressRefOwners(client);
        await ensureIndexExists(
          "idx_a2a_continuations_dedupe_key",
          `CREATE INDEX IF NOT EXISTS idx_a2a_continuations_dedupe_key ON integration_a2a_continuations(integration_task_id, agent_url, dedupe_key)`,
        );
        await ensureIndexExists(
          "idx_a2a_continuations_one_progress_owner",
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_a2a_continuations_one_progress_owner ON integration_a2a_continuations(integration_task_id) WHERE progress_ref_claimed = 1`,
        );
        return;
      }
      // SQLite (local dev): keep existing behavior
      await retryOnDdlRace(() => client.execute(createSql));
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_a2a_continuations_status_next ON integration_a2a_continuations(status, next_check_at)`,
        ),
      );
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_a2a_continuations_integration_task ON integration_a2a_continuations(integration_task_id)`,
        ),
      );
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_a2a_continuations_remote_task ON integration_a2a_continuations(integration_task_id, agent_url, a2a_task_id)`,
        ),
      );
      await addColumnIfMissing("a2a_auth_token", "TEXT");
      await addColumnIfMissing("dedupe_key", "TEXT");
      await addColumnIfMissing("progress_ref", "TEXT");
      await addColumnIfMissing(
        "progress_ref_claimed",
        `${intType()} NOT NULL DEFAULT 0`,
      );
      await addColumnIfMissing("verified_artifact_checkpoint", "TEXT");
      await addColumnIfMissing("terminal_delivery_kind", "TEXT");
      await addColumnIfMissing("terminal_delivery_confirmed_at", intType());
      await addColumnIfMissing("terminal_history_payload", "TEXT");
      await backfillLegacyCompletedDeliveries(client);
      await backfillProgressRefOwners(client);
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_a2a_continuations_dedupe_key ON integration_a2a_continuations(integration_task_id, agent_url, dedupe_key)`,
        ),
      );
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_a2a_continuations_one_progress_owner ON integration_a2a_continuations(integration_task_id) WHERE progress_ref_claimed = 1`,
        ),
      );
    })().catch((err) => {
      // Retry init on the next call after a failed startup.
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

export async function ensureA2AContinuationsTable(): Promise<void> {
  await ensureTable();
}

async function addColumnIfMissing(name: string, definition: string) {
  try {
    await retryOnDdlRace(() =>
      getDbExec().execute(
        `ALTER TABLE integration_a2a_continuations ADD COLUMN ${name} ${definition}`,
      ),
    );
  } catch (err) {
    if (isDuplicateColumnError(err)) return;
    throw err;
  }
}

async function backfillProgressRefOwners(
  client: ReturnType<typeof getDbExec>,
): Promise<void> {
  await client.execute(`
    UPDATE integration_a2a_continuations AS candidate
    SET progress_ref_claimed = 1
    WHERE candidate.progress_ref IS NOT NULL
      AND candidate.status NOT IN ('completed', 'failed')
      AND candidate.progress_ref_claimed = 0
      AND NOT EXISTS (
        SELECT 1
        FROM integration_a2a_continuations AS owner
        WHERE owner.integration_task_id = candidate.integration_task_id
          AND owner.progress_ref_claimed = 1
      )
      AND candidate.id = (
        SELECT selected.id
        FROM integration_a2a_continuations AS selected
        WHERE selected.integration_task_id = candidate.integration_task_id
          AND selected.progress_ref IS NOT NULL
          AND selected.status NOT IN ('completed', 'failed')
        ORDER BY selected.created_at ASC, selected.id ASC
        LIMIT 1
      )
  `);
}

async function backfillLegacyCompletedDeliveries(
  client: ReturnType<typeof getDbExec>,
): Promise<void> {
  await client.execute(`
    UPDATE integration_a2a_continuations
    SET terminal_delivery_kind = 'success',
        terminal_delivery_confirmed_at = COALESCE(completed_at, updated_at)
    WHERE status = 'completed'
      AND terminal_delivery_confirmed_at IS NULL
  `);
}

export type A2AContinuationStatus =
  | "pending"
  | "processing"
  | "delivering"
  | "completed"
  | "failed";

export type A2ATerminalDeliveryKind = "success" | "failure";

export interface A2ATerminalHistoryPayload {
  text: string;
  deliveredAt: string;
  messageRefs: string[];
  artifacts: A2AArtifactIdentity[];
}

export type A2AContinuationTaskOutcome =
  | "active"
  | "terminal-delivered"
  | "terminal-without-delivery"
  | "missing";

export interface A2AContinuation {
  id: string;
  integrationTaskId: string;
  platform: string;
  externalThreadId: string;
  incoming: IncomingMessage;
  placeholderRef: string | null;
  progressRef: PlatformRunProgressRef | null;
  progressRefClaimed: boolean;
  ownerEmail: string;
  orgId: string | null;
  agentName: string;
  agentUrl: string;
  dedupeKey: string | null;
  a2aTaskId: string;
  a2aAuthToken: string | null;
  verifiedArtifactCheckpoint: string | null;
  terminalDeliveryKind: A2ATerminalDeliveryKind | null;
  terminalDeliveryConfirmedAt: number | null;
  terminalHistoryPayload: A2ATerminalHistoryPayload | null;
  status: A2AContinuationStatus;
  attempts: number;
  nextCheckAt: number;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

const MAX_PROGRESS_REF_KIND_CHARS = 128;
const MAX_PROGRESS_REF_STREAM_TS_CHARS = 256;

/**
 * Keep only the tiny, adapter-owned continuation reference. Invalid rows are
 * treated as unavailable rather than throwing during a retry sweep.
 */
function parseProgressRef(value: unknown): PlatformRunProgressRef | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const { kind, streamTs } = parsed as Record<string, unknown>;
    if (
      typeof kind !== "string" ||
      typeof streamTs !== "string" ||
      kind.length === 0 ||
      streamTs.length === 0 ||
      kind.length > MAX_PROGRESS_REF_KIND_CHARS ||
      streamTs.length > MAX_PROGRESS_REF_STREAM_TS_CHARS
    ) {
      return null;
    }
    return { kind, streamTs };
  } catch {
    return null;
  }
}

function serializeProgressRef(value: unknown): string | null {
  const parsed = parseProgressRef(
    typeof value === "string" ? value : JSON.stringify(value),
  );
  return parsed ? JSON.stringify(parsed) : null;
}

function rowToContinuation(row: Record<string, unknown>): A2AContinuation {
  return {
    id: row.id as string,
    integrationTaskId: row.integration_task_id as string,
    platform: row.platform as string,
    externalThreadId: row.external_thread_id as string,
    incoming: JSON.parse(row.incoming_payload as string) as IncomingMessage,
    placeholderRef: (row.placeholder_ref as string | null) ?? null,
    progressRef: parseProgressRef(row.progress_ref),
    progressRefClaimed: Number(row.progress_ref_claimed ?? 0) === 1,
    ownerEmail: row.owner_email as string,
    orgId: (row.org_id as string | null) ?? null,
    agentName: row.agent_name as string,
    agentUrl: row.agent_url as string,
    dedupeKey: (row.dedupe_key as string | null) ?? null,
    a2aTaskId: row.a2a_task_id as string,
    a2aAuthToken: (row.a2a_auth_token as string | null) ?? null,
    verifiedArtifactCheckpoint:
      (row.verified_artifact_checkpoint as string | null) ?? null,
    terminalDeliveryKind:
      row.terminal_delivery_kind === "success" ||
      row.terminal_delivery_kind === "failure"
        ? row.terminal_delivery_kind
        : null,
    terminalDeliveryConfirmedAt:
      row.terminal_delivery_confirmed_at == null
        ? null
        : Number(row.terminal_delivery_confirmed_at),
    terminalHistoryPayload: parseTerminalHistoryPayload(
      row.terminal_history_payload,
    ),
    status: row.status as A2AContinuationStatus,
    attempts: Number(row.attempts ?? 0),
    nextCheckAt: Number(row.next_check_at ?? 0),
    errorMessage: (row.error_message as string | null) ?? null,
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
    completedAt:
      row.completed_at == null ? null : Number(row.completed_at as number),
  };
}

function parseTerminalHistoryPayload(
  value: unknown,
): A2ATerminalHistoryPayload | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<A2ATerminalHistoryPayload>;
    if (
      typeof parsed.text !== "string" ||
      typeof parsed.deliveredAt !== "string" ||
      !Array.isArray(parsed.messageRefs) ||
      !parsed.messageRefs.every((ref) => typeof ref === "string") ||
      !Array.isArray(parsed.artifacts)
    ) {
      return null;
    }
    return {
      text: parsed.text,
      deliveredAt: parsed.deliveredAt,
      messageRefs: parsed.messageRefs,
      artifacts: parsed.artifacts.filter(
        (artifact): artifact is A2AArtifactIdentity =>
          !!artifact &&
          typeof artifact === "object" &&
          !Array.isArray(artifact) &&
          typeof (artifact as { id?: unknown }).id === "string" &&
          typeof (artifact as { resourceType?: unknown }).resourceType ===
            "string" &&
          typeof (artifact as { sourceAction?: unknown }).sourceAction ===
            "string",
      ),
    };
  } catch {
    return null;
  }
}

export async function insertA2AContinuation(input: {
  integrationTaskId: string;
  platform: string;
  externalThreadId: string;
  incoming: IncomingMessage;
  placeholderRef?: string | null;
  progressRef?: PlatformRunProgressRef | null;
  ownerEmail: string;
  orgId?: string | null;
  agentName: string;
  agentUrl: string;
  dedupeKey?: string | null;
  a2aTaskId: string;
  a2aAuthToken?: string | null;
}): Promise<A2AContinuation> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const id = `a2a-cont-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = JSON.stringify(input.incoming);
  const progressRef = serializeProgressRef(input.progressRef);

  try {
    await client.execute({
      sql: `INSERT INTO integration_a2a_continuations
        (id, integration_task_id, platform, external_thread_id, incoming_payload,
         placeholder_ref, progress_ref, progress_ref_claimed, owner_email, org_id, agent_name, agent_url, dedupe_key, a2a_task_id, a2a_auth_token,
         status, attempts, next_check_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.integrationTaskId,
        input.platform,
        input.externalThreadId,
        payload,
        input.placeholderRef ?? null,
        null,
        0,
        input.ownerEmail,
        input.orgId ?? null,
        input.agentName,
        input.agentUrl,
        input.dedupeKey ?? null,
        input.a2aTaskId,
        input.a2aAuthToken ?? null,
        "pending",
        0,
        now,
        now,
        now,
      ],
    });
  } catch (err: any) {
    if (!isDuplicateContinuationError(err)) throw err;
    const existing = await findA2AContinuation(
      input.integrationTaskId,
      input.agentUrl,
      input.a2aTaskId,
    );
    if (existing) {
      // A retry can reach this row after the original invocation created it
      // without a resumable progress surface (or with one that has gone
      // stale). Keep the most recent valid adapter reference for active work,
      // but never resurrect short-lived delivery state after a terminal row
      // has deliberately scrubbed it.
      if (
        progressRef &&
        existing.status !== "completed" &&
        existing.status !== "failed"
      ) {
        if (existing.progressRefClaimed) {
          if (JSON.stringify(existing.progressRef) !== progressRef) {
            await client.execute({
              sql: `UPDATE integration_a2a_continuations
                    SET progress_ref = ?, updated_at = ?
                    WHERE id = ? AND status NOT IN ('completed', 'failed')
                      AND progress_ref_claimed = 1
                      AND (progress_ref IS NULL OR progress_ref <> ?)`,
              args: [progressRef, now, existing.id, progressRef],
            });
          }
        } else {
          await claimA2AContinuationProgressRef(existing.id, progressRef);
        }
        return (await getA2AContinuation(existing.id)) ?? existing;
      }
      return existing;
    }
    throw err;
  }

  if (progressRef) {
    await claimA2AContinuationProgressRef(id, progressRef);
  }
  return (await getA2AContinuation(id))!;
}

/**
 * A native platform stream has one terminal completion. Claim it for a single
 * downstream continuation, and retain the ownership marker after terminal
 * cleanup scrubs the short-lived stream reference. The partial unique index
 * makes concurrent downstream inserts safe across processes.
 */
async function claimA2AContinuationProgressRef(
  id: string,
  progressRef: string,
): Promise<void> {
  try {
    await getDbExec().execute({
      sql: `UPDATE integration_a2a_continuations
            SET progress_ref = ?, progress_ref_claimed = 1
            WHERE id = ? AND progress_ref_claimed = 0`,
      args: [progressRef, id],
    });
  } catch (err) {
    // A sibling continuation already owns this stream and will finalize it.
    // This continuation still delivers through the normal response path.
    if (isDuplicateContinuationError(err)) return;
    throw err;
  }
}

export async function getA2AContinuationForIntegrationTask(
  integrationTaskId: string,
): Promise<A2AContinuation | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM integration_a2a_continuations
          WHERE integration_task_id = ?
          ORDER BY created_at ASC
          LIMIT 1`,
    args: [integrationTaskId],
  });
  return rows[0] ? rowToContinuation(rows[0] as Record<string, unknown>) : null;
}

export async function hasActiveA2AContinuationsForIntegrationTask(
  integrationTaskId: string,
): Promise<boolean> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT 1 AS active FROM integration_a2a_continuations
          WHERE integration_task_id = ?
            AND status IN ('pending', 'processing', 'delivering')
          LIMIT 1`,
    args: [integrationTaskId],
  });
  return rows.length > 0;
}

export async function getA2AContinuationTaskOutcome(
  integrationTaskId: string,
): Promise<A2AContinuationTaskOutcome> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT status, terminal_delivery_confirmed_at
          FROM integration_a2a_continuations
          WHERE integration_task_id = ?`,
    args: [integrationTaskId],
  });
  if (rows.length === 0) return "missing";
  if (
    rows.some((row) =>
      ["pending", "processing", "delivering"].includes(String(row.status)),
    )
  ) {
    return "active";
  }
  return rows.every((row) => row.terminal_delivery_confirmed_at != null)
    ? "terminal-delivered"
    : "terminal-without-delivery";
}

export async function hasPendingConfirmedA2ADeliveryForIntegrationTask(
  integrationTaskId: string,
): Promise<boolean> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT 1 AS confirmed FROM integration_a2a_continuations
          WHERE integration_task_id = ?
            AND status IN ('pending', 'processing', 'delivering')
            AND terminal_delivery_confirmed_at IS NOT NULL
          LIMIT 1`,
    args: [integrationTaskId],
  });
  return rows.length > 0;
}

export async function hasOnlyLegacyFailedA2AContinuationsForIntegrationTask(
  integrationTaskId: string,
): Promise<boolean> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT status, terminal_delivery_kind,
                 terminal_delivery_confirmed_at, terminal_history_payload
          FROM integration_a2a_continuations
          WHERE integration_task_id = ?`,
    args: [integrationTaskId],
  });
  return (
    rows.length > 0 &&
    rows.every(
      (row) =>
        String(row.status) === "failed" &&
        row.terminal_delivery_kind == null &&
        row.terminal_delivery_confirmed_at == null &&
        row.terminal_history_payload == null,
    )
  );
}

export async function failA2AContinuationsForIntegrationTask(
  integrationTaskId: string,
  errorMessage: string,
): Promise<void> {
  await ensureTable();
  const now = Date.now();
  await getDbExec().execute({
    sql: `UPDATE integration_a2a_continuations
          SET status = 'failed', error_message = ?, updated_at = ?, completed_at = ?,
              verified_artifact_checkpoint = NULL
          WHERE integration_task_id = ?
            AND status IN ('pending', 'processing', 'delivering')
            AND terminal_delivery_confirmed_at IS NULL`,
    args: [errorMessage.slice(0, 2000), now, now, integrationTaskId],
  });
}

export async function getA2AContinuationsForIntegrationTaskAgent(
  integrationTaskId: string,
  agentUrl: string,
  dedupeKey?: string | null,
): Promise<A2AContinuation[]> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute(
    dedupeKey
      ? {
          sql: `SELECT * FROM integration_a2a_continuations
                WHERE integration_task_id = ? AND agent_url = ? AND dedupe_key = ?
                ORDER BY created_at ASC`,
          args: [integrationTaskId, agentUrl, dedupeKey],
        }
      : {
          sql: `SELECT * FROM integration_a2a_continuations
                WHERE integration_task_id = ? AND agent_url = ?
                ORDER BY created_at ASC`,
          args: [integrationTaskId, agentUrl],
        },
  );
  return rows.map((row) => rowToContinuation(row as Record<string, unknown>));
}

function isDuplicateContinuationError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === "23505") return true;
  const msg = String(e.message ?? "").toLowerCase();
  return (
    msg.includes("unique") ||
    msg.includes("duplicate entry") ||
    msg.includes("duplicate key")
  );
}

async function findA2AContinuation(
  integrationTaskId: string,
  agentUrl: string,
  a2aTaskId: string,
): Promise<A2AContinuation | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM integration_a2a_continuations
          WHERE integration_task_id = ? AND agent_url = ? AND a2a_task_id = ?
          LIMIT 1`,
    args: [integrationTaskId, agentUrl, a2aTaskId],
  });
  return rows[0] ? rowToContinuation(rows[0] as Record<string, unknown>) : null;
}

export async function getA2AContinuation(
  id: string,
): Promise<A2AContinuation | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM integration_a2a_continuations WHERE id = ? LIMIT 1`,
    args: [id],
  });
  return rows[0] ? rowToContinuation(rows[0] as Record<string, unknown>) : null;
}

export async function claimA2AContinuation(
  id: string,
): Promise<A2AContinuation | null> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const processingCutoff = now - PROCESSING_STUCK_AFTER_MS;
  const staleNextCheckCutoff = now - PROCESSING_NEXT_CHECK_STALE_AFTER_MS;
  const result = await client.execute({
    sql: isPostgres()
      ? `UPDATE integration_a2a_continuations
           SET status = ?, attempts = attempts + 1, updated_at = ?
         WHERE id = ?
           AND (
             status = 'pending'
             OR (
               status = 'processing'
               AND (updated_at <= ? OR next_check_at <= ?)
             )
           )
         RETURNING *`
      : `UPDATE integration_a2a_continuations
           SET status = ?, attempts = attempts + 1, updated_at = ?
         WHERE id = ?
           AND (
             status = 'pending'
             OR (
               status = 'processing'
               AND (updated_at <= ? OR next_check_at <= ?)
             )
           )`,
    args: ["processing", now, id, processingCutoff, staleNextCheckCutoff],
  });
  const rows = result.rows ?? [];
  if (isPostgres()) {
    return rows[0]
      ? rowToContinuation(rows[0] as Record<string, unknown>)
      : null;
  }
  const affected = (result as any)?.rowsAffected ?? (result as any)?.rowCount;
  if (affected === 0) return null;
  const fetched = await getA2AContinuation(id);
  if (!fetched || fetched.status !== "processing") return null;
  return fetched;
}

export async function claimDueA2AContinuations(
  limit = 5,
): Promise<A2AContinuation[]> {
  const ids = await recoverDueA2AContinuationIds(limit);
  const claimed: A2AContinuation[] = [];
  for (const id of ids) {
    const continuation = await claimA2AContinuation(id);
    if (continuation) claimed.push(continuation);
  }
  return claimed;
}

/**
 * Makes stale leases eligible again and returns a bounded set of due ids.
 *
 * This intentionally does not claim anything. Durable schedulers use it only
 * to wake the normal processor, whose atomic claim remains the sole progress
 * and delivery owner under overlapping scheduler/self-dispatch executions.
 */
export async function recoverDueA2AContinuationIds(
  limit = 5,
  integrationTaskIds?: string[],
  confirmedDeliveryOnly = false,
): Promise<string[]> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const processingCutoff = now - PROCESSING_STUCK_AFTER_MS;
  const staleNextCheckCutoff = now - PROCESSING_NEXT_CHECK_STALE_AFTER_MS;
  if (integrationTaskIds && integrationTaskIds.length === 0) return [];
  const taskFilter = integrationTaskIds?.length
    ? ` AND integration_task_id IN (${integrationTaskIds.map(() => "?").join(", ")})`
    : "";
  const taskArgs = integrationTaskIds ?? [];
  const receiptFilter = confirmedDeliveryOnly
    ? " AND terminal_delivery_confirmed_at IS NOT NULL"
    : "";
  // The two lease resets below and the due SELECT all only ever touch rows in
  // these three statuses, so one probe short-circuits all three. Without it the
  // 60s retry job pays two blind UPDATE round trips per app forever on a queue
  // that has been empty since boot.
  const live = await client.execute({
    sql: `SELECT id FROM integration_a2a_continuations
          WHERE status IN ('pending', 'processing', 'delivering')${taskFilter}${receiptFilter}
          LIMIT 1`,
    args: [...taskArgs],
  });
  if ((live.rows?.length ?? 0) === 0) return [];
  // If a processor dies after a provider receipt, retry history-only custody
  // as soon as its short follow-up deadline passes. A pre-receipt delivery
  // claim retains the longer stale cutoff before an at-least-once resend.
  await client.execute({
    sql: `UPDATE integration_a2a_continuations
          SET status = ?, next_check_at = ?, updated_at = ?
          WHERE status = 'delivering'
            AND ((terminal_delivery_confirmed_at IS NOT NULL AND next_check_at <= ?)
              OR updated_at <= ?)${taskFilter}${receiptFilter}`,
    args: ["pending", now, now, now, now - 5 * 60 * 1000, ...taskArgs],
  });
  await client.execute({
    sql: `UPDATE integration_a2a_continuations
          SET status = ?, next_check_at = ?, updated_at = ?
          WHERE status = 'processing'
            AND (updated_at <= ? OR next_check_at <= ?)${taskFilter}${receiptFilter}`,
    args: [
      "pending",
      now,
      now,
      processingCutoff,
      staleNextCheckCutoff,
      ...taskArgs,
    ],
  });
  const { rows } = await client.execute({
    sql: `SELECT id FROM integration_a2a_continuations
          WHERE status = 'pending' AND next_check_at <= ?${taskFilter}${receiptFilter}
          ORDER BY next_check_at ASC
          LIMIT ?`,
    args: [now, ...taskArgs, limit],
  });
  return rows.map((row) => row.id as string);
}

export async function listRecoverableA2AIntegrationTaskIds(
  limit = 50,
): Promise<string[]> {
  const tasks = await listRecoverableA2AIntegrationTasks(limit);
  return tasks.map((task) => task.id);
}

export interface RecoverableA2AIntegrationTask {
  id: string;
  platform: string;
  externalThreadId: string;
  dispatchScope: string | null;
  status: string;
  hasPendingConfirmedDelivery: boolean;
}

/**
 * Read due continuation owners and their rollout scope in one query. Recovery
 * can filter the canary in memory without an N+1 pending-task lookup loop.
 */
export async function listRecoverableA2AIntegrationTasks(
  limit = 50,
): Promise<RecoverableA2AIntegrationTask[]> {
  await ensureTable();
  const now = Date.now();
  const { rows } = await getDbExec().execute({
    sql: `SELECT DISTINCT c.integration_task_id, t.platform,
                 t.external_thread_id, t.dispatch_scope, t.status,
                 EXISTS (
                   SELECT 1 FROM integration_a2a_continuations receipt
                   WHERE receipt.integration_task_id = c.integration_task_id
                     AND receipt.terminal_delivery_confirmed_at IS NOT NULL
                     AND receipt.status IN ('pending', 'processing', 'delivering')
                 ) AS has_pending_confirmed_delivery
          FROM integration_a2a_continuations c
          INNER JOIN integration_pending_tasks t
             ON t.id = c.integration_task_id
          WHERE t.status = 'processing'
            AND ((c.status = 'pending' AND c.next_check_at <= ?)
             OR (c.status = 'processing' AND
                 (c.updated_at <= ? OR c.next_check_at <= ?))
             OR (c.status = 'delivering' AND
                 ((c.terminal_delivery_confirmed_at IS NOT NULL AND c.next_check_at <= ?)
                   OR c.updated_at <= ?)))
          ORDER BY c.integration_task_id ASC
          LIMIT ?`,
    args: [
      now,
      now - PROCESSING_STUCK_AFTER_MS,
      now - PROCESSING_NEXT_CHECK_STALE_AFTER_MS,
      now,
      now - 5 * 60 * 1000,
      Math.max(1, Math.min(Math.floor(limit), 200)),
    ],
  });
  return rows.map((row) => ({
    id: String(row.integration_task_id),
    platform: String(row.platform),
    externalThreadId: String(row.external_thread_id),
    dispatchScope: (row.dispatch_scope as string | null) ?? null,
    status: String(row.status),
    hasPendingConfirmedDelivery:
      row.has_pending_confirmed_delivery === true ||
      Number(row.has_pending_confirmed_delivery ?? 0) === 1,
  }));
}

export async function claimA2AContinuationDelivery(
  id: string,
): Promise<A2AContinuation | null> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const result = await client.execute({
    sql: isPostgres()
      ? `UPDATE integration_a2a_continuations
           SET status = ?, updated_at = ?
         WHERE id = ? AND status = 'processing'
         RETURNING *`
      : `UPDATE integration_a2a_continuations
           SET status = ?, updated_at = ?
         WHERE id = ? AND status = 'processing'`,
    args: ["delivering", now, id],
  });
  const rows = result.rows ?? [];
  if (isPostgres()) {
    return rows[0]
      ? rowToContinuation(rows[0] as Record<string, unknown>)
      : null;
  }
  const affected = (result as any)?.rowsAffected ?? (result as any)?.rowCount;
  if (affected === 0) return null;
  const fetched = await getA2AContinuation(id);
  if (!fetched || fetched.status !== "delivering") return null;
  return fetched;
}

export async function rescheduleA2AContinuation(
  id: string,
  delayMs: number,
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  await client.execute({
    sql: `UPDATE integration_a2a_continuations
          SET status = ?, next_check_at = ?, updated_at = ?
          WHERE id = ? AND status IN ('processing', 'delivering')`,
    args: ["pending", now + delayMs, now, id],
  });
}

export async function retainA2AUnconfirmedDeliveryClaim(
  id: string,
): Promise<void> {
  await ensureTable();
  const now = Date.now();
  await getDbExec().execute({
    sql: `UPDATE integration_a2a_continuations
          SET next_check_at = ?, updated_at = ?
          WHERE id = ? AND status = 'delivering'
            AND terminal_delivery_confirmed_at IS NULL`,
    args: [now + PROCESSING_STUCK_AFTER_MS, now, id],
  });
}

export async function saveA2AVerifiedArtifactCheckpoint(
  id: string,
  checkpoint: string,
): Promise<string | null> {
  await ensureTable();
  const normalized = checkpoint.trim();
  if (!normalized) return null;
  if (normalized.length > MAX_VERIFIED_ARTIFACT_CHECKPOINT_CHARS) {
    throw new Error(
      `Verified artifact checkpoint exceeds ${MAX_VERIFIED_ARTIFACT_CHECKPOINT_CHARS} characters`,
    );
  }
  const now = Date.now();
  await getDbExec().execute({
    sql: `UPDATE integration_a2a_continuations
          SET verified_artifact_checkpoint = ?, updated_at = ?
          WHERE id = ? AND status IN ('pending', 'processing', 'delivering')`,
    args: [normalized, now, id],
  });
  const persisted = await getA2AContinuation(id);
  return persisted?.verifiedArtifactCheckpoint === normalized
    ? normalized
    : null;
}

export async function recordA2ATerminalDeliveryReceipt(
  id: string,
  kind: A2ATerminalDeliveryKind,
  historyPayload: A2ATerminalHistoryPayload,
  errorMessage?: string,
): Promise<A2AContinuation> {
  await ensureTable();
  const serializedPayload = JSON.stringify(historyPayload);
  if (serializedPayload.length > MAX_TERMINAL_HISTORY_PAYLOAD_CHARS) {
    throw new Error(
      `Terminal A2A history payload exceeds ${MAX_TERMINAL_HISTORY_PAYLOAD_CHARS} characters`,
    );
  }
  const now = Date.now();
  await getDbExec().execute({
    sql: `UPDATE integration_a2a_continuations
          SET status = 'delivering', terminal_delivery_kind = ?,
              terminal_delivery_confirmed_at = COALESCE(terminal_delivery_confirmed_at, ?),
              terminal_history_payload = ?, next_check_at = ?, updated_at = ?,
              error_message = ?
          WHERE id = ?
            AND status IN ('processing', 'delivering')
            AND (terminal_delivery_confirmed_at IS NULL
              OR terminal_delivery_kind = ?)`,
    args: [
      kind,
      now,
      serializedPayload,
      now + TERMINAL_HISTORY_FINALIZATION_LEASE_MS,
      now,
      errorMessage?.slice(0, 2000) ?? null,
      id,
      kind,
    ],
  });
  const persisted = await getA2AContinuation(id);
  if (
    persisted?.status !== "delivering" ||
    persisted.terminalDeliveryKind !== kind ||
    persisted.terminalDeliveryConfirmedAt == null ||
    JSON.stringify(persisted.terminalHistoryPayload) !== serializedPayload
  ) {
    throw new Error("Terminal A2A delivery confirmation did not persist");
  }
  return persisted;
}

export async function finalizeA2ATerminalHistory(id: string): Promise<void> {
  await ensureTable();
  const continuation = await getA2AContinuation(id);
  if (
    continuation &&
    (continuation.status === "completed" || continuation.status === "failed") &&
    continuation.terminalDeliveryConfirmedAt != null &&
    continuation.terminalHistoryPayload == null
  ) {
    return;
  }
  if (
    !continuation?.terminalDeliveryKind ||
    continuation.terminalDeliveryConfirmedAt == null ||
    !continuation.terminalHistoryPayload
  ) {
    throw new Error("Terminal A2A history cannot finalize without a receipt");
  }
  const now = Date.now();
  const status =
    continuation.terminalDeliveryKind === "success" ? "completed" : "failed";
  await getDbExec().execute({
    sql: `UPDATE integration_a2a_continuations
          SET status = ?, updated_at = ?, completed_at = ?, incoming_payload = ?,
              a2a_auth_token = NULL, progress_ref = NULL,
              verified_artifact_checkpoint = NULL, terminal_history_payload = NULL
          WHERE id = ? AND status IN ('pending', 'processing', 'delivering')
            AND terminal_delivery_confirmed_at IS NOT NULL`,
    args: [status, now, now, "{}", id],
  });
  const persisted = await getA2AContinuation(id);
  if (
    persisted?.status !== status ||
    persisted.terminalHistoryPayload != null
  ) {
    throw new Error("Terminal A2A history finalization did not persist");
  }
}

export async function completeA2AContinuation(id: string): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  await client.execute({
    sql: `UPDATE integration_a2a_continuations
          SET status = ?, updated_at = ?, completed_at = ?,
              incoming_payload = ?, a2a_auth_token = NULL, progress_ref = NULL,
              verified_artifact_checkpoint = NULL,
              terminal_delivery_kind = COALESCE(terminal_delivery_kind, 'success'),
              terminal_delivery_confirmed_at = COALESCE(terminal_delivery_confirmed_at, ?),
              terminal_history_payload = NULL
          WHERE id = ? AND status IN ('processing', 'delivering', 'completed')`,
    args: ["completed", now, now, "{}", now, id],
  });
}

export async function failA2AContinuation(
  id: string,
  errorMessage: string,
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  await client.execute({
    sql: `UPDATE integration_a2a_continuations
          SET status = ?, updated_at = ?, error_message = ?,
              incoming_payload = ?, a2a_auth_token = NULL, progress_ref = NULL,
              verified_artifact_checkpoint = NULL
          WHERE id = ? AND status <> 'completed'`,
    args: ["failed", now, errorMessage.slice(0, 2000), "{}", id],
  });
}
