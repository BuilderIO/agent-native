import { getDbExec, isPostgres, type DbExec } from "../../db/client.js";
import { ensureTableExists } from "../../db/ddl-guard.js";
import type { Visibility } from "../../sharing/schema.js";
import type {
  ResourceSuggestion,
  SuggestionDecision,
  SuggestionStatus,
} from "./types.js";

let initialized: Promise<void> | undefined;
export function __resetSuggestionTablesForTests(): void {
  initialized = undefined;
}
const newId = () => globalThis.crypto.randomUUID();
const encode = (value: unknown) =>
  value == null ? null : JSON.stringify(value);
const decode = <T>(value: unknown) =>
  typeof value === "string" ? (JSON.parse(value) as T) : ((value as T) ?? null);

export async function ensureSuggestionTables(
  client = getDbExec(),
): Promise<void> {
  if (client !== getDbExec()) return;
  if (!initialized)
    initialized = (async () => {
      const ddl = [
        `CREATE TABLE IF NOT EXISTS agent_review_suggestions (id TEXT PRIMARY KEY, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, adapter_kind TEXT NOT NULL, adapter_version INTEGER NOT NULL, thread_id TEXT NOT NULL, author_email TEXT, actor_kind TEXT NOT NULL, base_revision TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', summary TEXT NOT NULL, owner_email TEXT, org_id TEXT, visibility TEXT NOT NULL DEFAULT 'private', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, metadata_json TEXT)`,
        `CREATE TABLE IF NOT EXISTS agent_review_suggestion_operations (id TEXT PRIMARY KEY, suggestion_id TEXT NOT NULL, ordinal INTEGER NOT NULL, operation_kind TEXT NOT NULL, target_id TEXT, before_json TEXT, after_json TEXT, anchor_json TEXT, dependencies_json TEXT, schema_version INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS agent_review_suggestion_decisions (id TEXT PRIMARY KEY, suggestion_id TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, reviewer TEXT, decision TEXT NOT NULL, observed_base TEXT, outcome TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS agent_review_suggestion_creations (idempotency_key TEXT PRIMARY KEY, suggestion_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL)`,
      ];
      for (const sql of ddl) {
        const name = sql.match(/agent_review_[a-z_]+/)![0];
        if (isPostgres()) await ensureTableExists(name, sql);
        else await client.execute(sql);
      }
      await client.execute(
        "CREATE INDEX IF NOT EXISTS idx_review_suggestions_resource ON agent_review_suggestions (resource_type, resource_id, created_at)",
      );
      await client.execute(
        "CREATE INDEX IF NOT EXISTS idx_review_suggestion_operations ON agent_review_suggestion_operations (suggestion_id, ordinal)",
      );
    })();
  await initialized;
}

export async function getSuggestionByCreationKey(
  client: DbExec,
  idempotencyKey: string,
): Promise<ResourceSuggestion | null> {
  const row = (
    await client.execute({
      sql: "SELECT suggestion_id FROM agent_review_suggestion_creations WHERE idempotency_key = ?",
      args: [idempotencyKey],
    })
  ).rows[0];
  return row ? getSuggestion(String(row.suggestion_id), client) : null;
}

export async function recordSuggestionCreation(
  client: DbExec,
  idempotencyKey: string,
  suggestionId: string,
): Promise<void> {
  await client.execute({
    sql: "INSERT INTO agent_review_suggestion_creations (idempotency_key,suggestion_id,created_at) VALUES (?,?,?)",
    args: [idempotencyKey, suggestionId, new Date().toISOString()],
  });
}

export async function insertSuggestion(
  input: Omit<ResourceSuggestion, "id" | "createdAt" | "updatedAt">,
  client = getDbExec(),
): Promise<ResourceSuggestion> {
  await ensureSuggestionTables(client);
  const suggestionId = `suggestion-${newId()}`;
  const now = new Date().toISOString();
  await client.execute({
    sql: "INSERT INTO agent_review_suggestions (id,resource_type,resource_id,adapter_kind,adapter_version,thread_id,author_email,actor_kind,base_revision,status,summary,owner_email,org_id,visibility,created_at,updated_at,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    args: [
      suggestionId,
      input.resourceType,
      input.resourceId,
      input.adapterKind,
      input.adapterVersion,
      input.threadId,
      input.authorEmail,
      input.actorKind,
      input.baseRevision,
      input.status,
      input.summary,
      input.ownerEmail,
      input.orgId,
      input.visibility,
      now,
      now,
      encode(input.metadata),
    ],
  });
  for (const operation of input.operations)
    await client.execute({
      sql: "INSERT INTO agent_review_suggestion_operations (id,suggestion_id,ordinal,operation_kind,target_id,before_json,after_json,anchor_json,dependencies_json,schema_version) VALUES (?,?,?,?,?,?,?,?,?,?)",
      args: [
        `${suggestionId}-${operation.ordinal}`,
        suggestionId,
        operation.ordinal,
        operation.kind,
        operation.targetId ?? null,
        encode(operation.before),
        encode(operation.after),
        encode(operation.anchor),
        encode(operation.dependencies),
        operation.schemaVersion,
      ],
    });
  return { ...input, id: suggestionId, createdAt: now, updatedAt: now };
}

export async function getSuggestion(
  suggestionId: string,
  client = getDbExec(),
): Promise<ResourceSuggestion | null> {
  await ensureSuggestionTables(client);
  const row = (
    await client.execute({
      sql: "SELECT * FROM agent_review_suggestions WHERE id = ?",
      args: [suggestionId],
    })
  ).rows[0];
  if (!row) return null;
  const rows = (
    await client.execute({
      sql: "SELECT * FROM agent_review_suggestion_operations WHERE suggestion_id = ? ORDER BY ordinal",
      args: [suggestionId],
    })
  ).rows;
  return {
    id: String(row.id),
    resourceType: String(row.resource_type),
    resourceId: String(row.resource_id),
    adapterKind: String(row.adapter_kind),
    adapterVersion: Number(row.adapter_version),
    threadId: String(row.thread_id),
    authorEmail: row.author_email as string | null,
    actorKind: row.actor_kind as ResourceSuggestion["actorKind"],
    baseRevision: String(row.base_revision),
    status: row.status as SuggestionStatus,
    summary: String(row.summary),
    ownerEmail: row.owner_email as string | null,
    orgId: row.org_id as string | null,
    visibility: row.visibility as Visibility,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    metadata: decode<Record<string, unknown>>(row.metadata_json),
    operations: rows.map((value) => ({
      id: String(value.id),
      ordinal: Number(value.ordinal),
      kind: String(value.operation_kind),
      targetId: value.target_id as string | null,
      before: decode(value.before_json),
      after: decode(value.after_json),
      anchor: decode(value.anchor_json),
      dependencies: decode(value.dependencies_json),
      schemaVersion: Number(value.schema_version),
    })),
  };
}

export async function listSuggestions(
  resourceType: string,
  resourceId: string,
  statuses?: readonly SuggestionStatus[],
  client = getDbExec(),
): Promise<ResourceSuggestion[]> {
  await ensureSuggestionTables(client);
  const args: unknown[] = [resourceType, resourceId];
  const filter = statuses?.length
    ? ` AND status IN (${statuses.map(() => "?").join(",")})`
    : "";
  args.push(...(statuses ?? []));
  const rows = (
    await client.execute({
      sql: `SELECT id FROM agent_review_suggestions WHERE resource_type = ? AND resource_id = ?${filter} ORDER BY created_at`,
      args,
    })
  ).rows;
  return (
    await Promise.all(rows.map((row) => getSuggestion(String(row.id), client)))
  ).filter((value): value is ResourceSuggestion => Boolean(value));
}

export interface SuggestionDecisionRecord {
  id: string;
  suggestionId: string;
  idempotencyKey: string;
  reviewer: string | null;
  decision: SuggestionDecision;
  observedBase: string;
  outcome: string;
  detail: string | null;
  createdAt: string;
}
export async function recordDecision(
  client: DbExec,
  input: Omit<SuggestionDecisionRecord, "id" | "createdAt">,
): Promise<{ record: SuggestionDecisionRecord; duplicate: boolean }> {
  const row = (
    await client.execute({
      sql: "SELECT * FROM agent_review_suggestion_decisions WHERE idempotency_key = ?",
      args: [input.idempotencyKey],
    })
  ).rows[0];
  if (row) {
    if (
      String(row.suggestion_id) !== input.suggestionId ||
      String(row.decision) !== input.decision
    )
      throw new Error(
        "Idempotency key was already used for a different decision",
      );
    return {
      duplicate: true,
      record: {
        id: String(row.id),
        suggestionId: String(row.suggestion_id),
        idempotencyKey: String(row.idempotency_key),
        reviewer: row.reviewer as string | null,
        decision: row.decision as SuggestionDecision,
        observedBase: String(row.observed_base),
        outcome: String(row.outcome),
        detail: row.detail as string | null,
        createdAt: String(row.created_at),
      },
    };
  }
  const record = {
    ...input,
    id: `decision-${newId()}`,
    createdAt: new Date().toISOString(),
  };
  await client.execute({
    sql: "INSERT INTO agent_review_suggestion_decisions (id,suggestion_id,idempotency_key,reviewer,decision,observed_base,outcome,detail,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    args: [
      record.id,
      record.suggestionId,
      record.idempotencyKey,
      record.reviewer,
      record.decision,
      record.observedBase,
      record.outcome,
      record.detail,
      record.createdAt,
    ],
  });
  return { duplicate: false, record };
}

export async function getDecision(
  client: DbExec,
  idempotencyKey: string,
): Promise<SuggestionDecisionRecord | null> {
  const row = (
    await client.execute({
      sql: "SELECT * FROM agent_review_suggestion_decisions WHERE idempotency_key = ?",
      args: [idempotencyKey],
    })
  ).rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    suggestionId: String(row.suggestion_id),
    idempotencyKey: String(row.idempotency_key),
    reviewer: row.reviewer as string | null,
    decision: row.decision as SuggestionDecision,
    observedBase: String(row.observed_base),
    outcome: String(row.outcome),
    detail: row.detail as string | null,
    createdAt: String(row.created_at),
  };
}
export async function updateSuggestionStatus(
  client: DbExec,
  suggestionId: string,
  status: SuggestionStatus,
): Promise<boolean> {
  const result = await client.execute({
    sql: "UPDATE agent_review_suggestions SET status = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
    args: [status, new Date().toISOString(), suggestionId],
  });
  return result.rowsAffected === 1;
}

export async function replaceSuggestionStatus(
  client: DbExec,
  suggestionId: string,
  from: SuggestionStatus,
  to: SuggestionStatus,
): Promise<boolean> {
  const result = await client.execute({
    sql: "UPDATE agent_review_suggestions SET status = ?, updated_at = ? WHERE id = ? AND status = ?",
    args: [to, new Date().toISOString(), suggestionId, from],
  });
  return result.rowsAffected === 1;
}
