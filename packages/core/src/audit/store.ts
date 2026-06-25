/**
 * SQL persistence for the framework audit log.
 *
 * Follows the same raw-SQL, provider-agnostic pattern as observability/store.ts
 * and usage/store.ts — framework tables use `getDbExec()` + `intType()` rather
 * than Drizzle ORM (which is for template-level schemas). One append-only table
 * `agent_audit_log`; reads are scoped to the caller's identity in SQL (no
 * shares table — audit rows are never individually shared).
 */
import { getDbExec, intType, isPostgres } from "../db/client.js";
import { ensureTableExists, ensureIndexExists } from "../db/ddl-guard.js";
import type {
  AuditEvent,
  AuditQueryFilters,
  AuditVisibility,
} from "./types.js";

let _initPromise: Promise<void> | undefined;

export async function ensureAuditTables(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const createSql = `
        CREATE TABLE IF NOT EXISTS agent_audit_log (
          id TEXT PRIMARY KEY,
          created_at ${intType()} NOT NULL,
          action TEXT NOT NULL,
          caller TEXT NOT NULL,
          actor_kind TEXT NOT NULL,
          actor_email TEXT,
          org_id TEXT,
          thread_id TEXT,
          turn_id TEXT,
          target_type TEXT,
          target_id TEXT,
          status TEXT NOT NULL DEFAULT 'success',
          summary TEXT,
          input TEXT,
          error_code TEXT,
          owner_email TEXT,
          visibility TEXT NOT NULL DEFAULT 'private'
        )
      `;

      if (isPostgres()) {
        // PG-guard: probe information_schema / pg_indexes before issuing DDL to
        // avoid ACCESS EXCLUSIVE lock contention in fresh background-worker processes.
        await ensureTableExists("agent_audit_log", createSql);
        await ensureIndexExists(
          "idx_audit_owner",
          `CREATE INDEX IF NOT EXISTS idx_audit_owner ON agent_audit_log (owner_email, created_at)`,
        );
        await ensureIndexExists(
          "idx_audit_org",
          `CREATE INDEX IF NOT EXISTS idx_audit_org ON agent_audit_log (org_id, created_at)`,
        );
        await ensureIndexExists(
          "idx_audit_target",
          `CREATE INDEX IF NOT EXISTS idx_audit_target ON agent_audit_log (target_type, target_id, created_at)`,
        );
        await ensureIndexExists(
          "idx_audit_turn",
          `CREATE INDEX IF NOT EXISTS idx_audit_turn ON agent_audit_log (turn_id)`,
        );
        await ensureIndexExists(
          "idx_audit_actor",
          `CREATE INDEX IF NOT EXISTS idx_audit_actor ON agent_audit_log (actor_email, created_at)`,
        );
        await ensureIndexExists(
          "idx_audit_created",
          `CREATE INDEX IF NOT EXISTS idx_audit_created ON agent_audit_log (created_at)`,
        );
        return;
      }

      // SQLite (local dev): no lock problem — keep the original behaviour.
      await client.execute(createSql);
      const indexes = [
        `CREATE INDEX IF NOT EXISTS idx_audit_owner ON agent_audit_log (owner_email, created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_audit_org ON agent_audit_log (org_id, created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_audit_target ON agent_audit_log (target_type, target_id, created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_audit_turn ON agent_audit_log (turn_id)`,
        `CREATE INDEX IF NOT EXISTS idx_audit_actor ON agent_audit_log (actor_email, created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_audit_created ON agent_audit_log (created_at)`,
      ];
      for (const sql of indexes) {
        try {
          await client.execute(sql);
        } catch {
          // Index creation is best-effort; a racing boot may have created it.
        }
      }
    })().catch((err) => {
      // Allow a later call to retry if the first init failed.
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

export async function insertAuditEvent(event: AuditEvent): Promise<void> {
  await ensureAuditTables();
  const client = getDbExec();
  await client.execute({
    sql: `INSERT INTO agent_audit_log
      (id, created_at, action, caller, actor_kind, actor_email, org_id,
       thread_id, turn_id, target_type, target_id, status, summary, input,
       error_code, owner_email, visibility)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      event.id,
      event.createdAt,
      event.action,
      event.caller,
      event.actorKind,
      event.actorEmail,
      event.orgId,
      event.threadId,
      event.turnId,
      event.targetType,
      event.targetId,
      event.status,
      event.summary,
      event.input,
      event.errorCode,
      event.ownerEmail,
      event.visibility,
    ],
  });
}

function mapRow(row: any): AuditEvent {
  return {
    id: String(row.id),
    createdAt: Number(row.created_at),
    action: String(row.action),
    caller: String(row.caller),
    actorKind: row.actor_kind,
    actorEmail: row.actor_email ?? null,
    orgId: row.org_id ?? null,
    threadId: row.thread_id ?? null,
    turnId: row.turn_id ?? null,
    targetType: row.target_type ?? null,
    targetId: row.target_id ?? null,
    status: row.status,
    summary: row.summary ?? null,
    input: row.input ?? null,
    errorCode: row.error_code ?? null,
    ownerEmail: row.owner_email ?? null,
    visibility: (row.visibility ?? "private") as AuditVisibility,
  };
}

export interface AuditReadScope {
  userEmail?: string;
  orgId?: string | null;
}

/**
 * Build the access-scoping WHERE fragment + args. A caller sees audit rows they
 * own, plus org-visible rows in their org. With no identity, nothing matches —
 * the audit log never leaks cross-tenant. Mirrors the core ownership clause of
 * `accessFilter` (minus shares, which audit rows don't have).
 */
function scopeClause(scope: AuditReadScope): { sql: string; args: any[] } {
  const clauses: string[] = [];
  const args: any[] = [];
  if (scope.userEmail) {
    if (scope.orgId) {
      // Constrain the owner's rows to the active org — plus legacy/solo rows
      // that predate org-scoping (org_id IS NULL) — mirroring sharing's
      // `ownerScopeFilter`, so switching orgs doesn't surface another org's
      // trail.
      clauses.push("(owner_email = ? AND (org_id = ? OR org_id IS NULL))");
      args.push(scope.userEmail, scope.orgId);
    } else {
      clauses.push("owner_email = ?");
      args.push(scope.userEmail);
    }
  }
  if (scope.orgId) {
    clauses.push("(visibility = 'org' AND org_id = ?)");
    args.push(scope.orgId);
  }
  if (clauses.length === 0) return { sql: "1=0", args };
  return { sql: `(${clauses.join(" OR ")})`, args };
}

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

// Columns returned by the list surface — deliberately EXCLUDES `input` so a
// timeline query never streams every event's (redacted) request body in bulk.
// Fetch the full payload one event at a time via `getAuditEventById`.
const LIST_COLUMNS =
  "id, created_at, action, caller, actor_kind, actor_email, org_id, " +
  "thread_id, turn_id, target_type, target_id, status, summary, " +
  "error_code, owner_email, visibility";

export async function queryAuditEvents(
  scope: AuditReadScope,
  filters: AuditQueryFilters = {},
): Promise<AuditEvent[]> {
  await ensureAuditTables();
  if (!scope.userEmail && !scope.orgId) return [];
  const client = getDbExec();

  const scoped = scopeClause(scope);
  const where: string[] = [scoped.sql];
  const args: any[] = [...scoped.args];

  const push = (clause: string, value: any) => {
    where.push(clause);
    args.push(value);
  };
  if (filters.targetType) push("target_type = ?", filters.targetType);
  if (filters.targetId) push("target_id = ?", filters.targetId);
  if (filters.actorKind) push("actor_kind = ?", filters.actorKind);
  if (filters.actorEmail) push("actor_email = ?", filters.actorEmail);
  if (filters.status) push("status = ?", filters.status);
  if (filters.threadId) push("thread_id = ?", filters.threadId);
  if (filters.turnId) push("turn_id = ?", filters.turnId);
  if (filters.action) push("action = ?", filters.action);
  if (typeof filters.sinceMs === "number") {
    push("created_at >= ?", Math.floor(filters.sinceMs));
  }

  const limit = Math.min(
    Math.max(1, Math.floor(filters.limit ?? DEFAULT_LIMIT)),
    MAX_LIMIT,
  );

  const result = await client.execute({
    sql: `SELECT ${LIST_COLUMNS} FROM agent_audit_log
          WHERE ${where.join(" AND ")}
          ORDER BY created_at DESC
          LIMIT ?`,
    args: [...args, limit],
  });
  return (result.rows ?? []).map(mapRow);
}

export async function getAuditEventById(
  id: string,
  scope: AuditReadScope,
): Promise<AuditEvent | null> {
  await ensureAuditTables();
  if (!scope.userEmail && !scope.orgId) return null;
  const client = getDbExec();
  const scoped = scopeClause(scope);
  const result = await client.execute({
    sql: `SELECT * FROM agent_audit_log WHERE id = ? AND ${scoped.sql} LIMIT 1`,
    args: [id, ...scoped.args],
  });
  const row = (result.rows ?? [])[0];
  return row ? mapRow(row) : null;
}

/** Purge audit rows older than `cutoffMs`. Returns the deleted row count. */
export async function deleteOldAuditEvents(cutoffMs: number): Promise<number> {
  await ensureAuditTables();
  const client = getDbExec();
  const result = await client.execute({
    sql: `DELETE FROM agent_audit_log WHERE created_at < ?`,
    args: [Math.floor(cutoffMs)],
  });
  return Number(result.rowsAffected ?? 0);
}

/** Test-only: reset the cached init promise so a fresh DB re-creates tables. */
export function __resetAuditInitForTests(): void {
  _initPromise = undefined;
}
