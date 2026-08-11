/**
 * SQL persistence for the framework audit log.
 *
 * Follows the same raw-SQL, provider-agnostic pattern as observability/store.ts
 * and usage/store.ts — framework tables use `getDbExec()` + `intType()` rather
 * than Drizzle ORM (which is for template-level schemas). One append-only table
 * `agent_audit_log`; reads are scoped to the caller's identity in SQL (no
 * shares table — audit rows are never individually shared).
 */
import { getDbExec, intType, isPostgres, type DbExec } from "../db/client.js";
import {
  ensureColumnExists,
  ensureTableExists,
  ensureIndexExists,
  pgColumnExists,
  pgIndexExists,
  pgTableExists,
} from "../db/ddl-guard.js";
import type {
  AuditEvent,
  AuditQueryFilters,
  AuditVisibility,
} from "./types.js";

let _initPromise: Promise<void> | undefined;

const APPEND_ORDER_TABLE = "agent_audit_append_order";
const APPEND_ORDER_TRIGGER = "agent_audit_assign_append_order";
const APPEND_ORDER_UNIQUE_INDEX = "idx_audit_append_order_unique";
const APPEND_ORDER_QUERY_INDEX = "idx_audit_created_append_order";

async function postgresAppendOrderReady(client: DbExec): Promise<boolean> {
  const probes = await Promise.all([
    pgColumnExists("agent_audit_log", "append_order", client),
    pgTableExists(APPEND_ORDER_TABLE, client, true),
    pgIndexExists(APPEND_ORDER_UNIQUE_INDEX, client, true),
    pgIndexExists(APPEND_ORDER_QUERY_INDEX, client, true),
  ]);
  if (probes.some((value) => value === undefined)) {
    throw new Error(
      "Could not probe the audit append-order schema; refusing to issue DDL",
    );
  }
  if (probes.some((value) => value !== true)) return false;

  const metadata = await client.execute(`
    SELECT
      EXISTS (
        SELECT 1
          FROM pg_trigger
         WHERE tgname = '${APPEND_ORDER_TRIGGER}'
           AND tgrelid = 'agent_audit_log'::regclass
           AND NOT tgisinternal
           AND tgenabled <> 'D'
      ) AS trigger_ready,
      EXISTS (
        SELECT 1
          FROM pg_attribute
         WHERE attrelid = 'agent_audit_log'::regclass
           AND attname = 'append_order'
           AND attnotnull
           AND NOT attisdropped
      ) AS column_not_null
  `);
  const allocator = await client.execute(
    `SELECT value FROM ${APPEND_ORDER_TABLE} WHERE id = 1`,
  );
  const state = metadata.rows[0];
  return (
    state?.trigger_ready === true &&
    state?.column_not_null === true &&
    allocator.rows.length === 1
  );
}

async function ensurePostgresAppendOrder(client: DbExec): Promise<void> {
  if (await postgresAppendOrderReady(client)) return;
  if (!client.transaction) {
    throw new Error(
      "PostgreSQL audit append-order initialization requires a database transaction",
    );
  }

  await client.transaction(async (tx) => {
    await tx.execute("SET LOCAL lock_timeout = '3s'");
    await tx.execute("SET LOCAL idle_in_transaction_session_timeout = '30s'");
    // The lock closes the add-column -> trigger window for rolling old writers.
    await tx.execute("LOCK TABLE agent_audit_log IN SHARE ROW EXCLUSIVE MODE");

    await ensureTableExists(
      APPEND_ORDER_TABLE,
      `CREATE TABLE IF NOT EXISTS ${APPEND_ORDER_TABLE} (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        value BIGINT NOT NULL
      )`,
      { injectedClient: tx, dialectIsPostgres: true },
    );
    await ensureColumnExists(
      "agent_audit_log",
      "append_order",
      "ALTER TABLE agent_audit_log ADD COLUMN IF NOT EXISTS append_order BIGINT",
      { injectedClient: tx },
    );

    await tx.execute(`
      CREATE OR REPLACE FUNCTION agent_audit_allocate_append_order()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $audit_append_order$
      DECLARE
        allocated BIGINT;
      BEGIN
        UPDATE ${APPEND_ORDER_TABLE}
           SET value = value + 1
         WHERE id = 1
         RETURNING value INTO allocated;
        IF allocated IS NULL THEN
          RAISE EXCEPTION 'audit append-order allocator is not initialized';
        END IF;
        NEW.append_order := allocated;
        RETURN NEW;
      END;
      $audit_append_order$
    `);
    await tx.execute(`
      CREATE OR REPLACE TRIGGER ${APPEND_ORDER_TRIGGER}
      BEFORE INSERT ON agent_audit_log
      FOR EACH ROW
      EXECUTE FUNCTION agent_audit_allocate_append_order()
    `);

    // PostgreSQL cannot recover true append order for historical ties. This
    // migration rank is stable and database-owned; the live guarantee starts
    // with rows inserted after this transaction commits.
    await tx.execute(`
      WITH base AS (
        SELECT COALESCE(MAX(append_order), 0) AS value
          FROM agent_audit_log
      ), ranked AS (
        SELECT agent_audit_log.ctid AS row_id,
               base.value + ROW_NUMBER() OVER (
                 ORDER BY agent_audit_log.created_at, agent_audit_log.ctid
               ) AS value
          FROM agent_audit_log
          CROSS JOIN base
         WHERE append_order IS NULL
      )
      UPDATE agent_audit_log AS audit
         SET append_order = ranked.value
        FROM ranked
       WHERE audit.ctid = ranked.row_id
    `);
    await tx.execute(`
      INSERT INTO ${APPEND_ORDER_TABLE} (id, value)
      SELECT 1, COALESCE(MAX(append_order), 0) FROM agent_audit_log
      ON CONFLICT (id) DO UPDATE
        SET value = GREATEST(${APPEND_ORDER_TABLE}.value, excluded.value)
    `);
    await tx.execute(
      "ALTER TABLE agent_audit_log ALTER COLUMN append_order SET NOT NULL",
    );
    await ensureIndexExists(
      APPEND_ORDER_UNIQUE_INDEX,
      `CREATE UNIQUE INDEX IF NOT EXISTS ${APPEND_ORDER_UNIQUE_INDEX} ON agent_audit_log (append_order)`,
      { injectedClient: tx, dialectIsPostgres: true },
    );
    await ensureIndexExists(
      APPEND_ORDER_QUERY_INDEX,
      `CREATE INDEX IF NOT EXISTS ${APPEND_ORDER_QUERY_INDEX} ON agent_audit_log (created_at DESC, append_order DESC)`,
      { injectedClient: tx, dialectIsPostgres: true },
    );
  });
}

async function ensureSqliteAppendOrder(client: DbExec): Promise<void> {
  const initialize = async (tx: DbExec) => {
    await tx.execute(`CREATE TABLE IF NOT EXISTS ${APPEND_ORDER_TABLE} (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      value INTEGER NOT NULL
    )`);
    const columns = await tx.execute({
      sql: "PRAGMA table_info(agent_audit_log)",
    });
    if (!columns.rows.some((row) => row.name === "append_order")) {
      await tx.execute(
        "ALTER TABLE agent_audit_log ADD COLUMN append_order INTEGER",
      );
    }

    // A rowid-ranked backfill preserves SQLite's database-owned legacy order.
    await tx.execute(`
      WITH base AS (
        SELECT COALESCE(MAX(append_order), 0) AS value
          FROM agent_audit_log
      ), ranked AS MATERIALIZED (
        SELECT rowid AS row_id,
               base.value + ROW_NUMBER() OVER (ORDER BY rowid) AS value
          FROM agent_audit_log
          CROSS JOIN base
         WHERE append_order IS NULL
      )
      UPDATE agent_audit_log
         SET append_order = (
           SELECT ranked.value FROM ranked WHERE ranked.row_id = agent_audit_log.rowid
         )
       WHERE append_order IS NULL
    `);
    await tx.execute(`
      INSERT INTO ${APPEND_ORDER_TABLE} (id, value)
      VALUES (1, (SELECT COALESCE(MAX(append_order), 0) FROM agent_audit_log))
      ON CONFLICT (id) DO UPDATE
        SET value = MAX(${APPEND_ORDER_TABLE}.value, excluded.value)
    `);
    await tx.execute(`
      CREATE TRIGGER IF NOT EXISTS ${APPEND_ORDER_TRIGGER}
      AFTER INSERT ON agent_audit_log
      FOR EACH ROW WHEN NEW.append_order IS NULL
      BEGIN
        UPDATE ${APPEND_ORDER_TABLE} SET value = value + 1 WHERE id = 1;
        SELECT CASE WHEN changes() = 0
          THEN RAISE(ABORT, 'audit append-order allocator is not initialized') END;
        UPDATE agent_audit_log
           SET append_order = (SELECT value FROM ${APPEND_ORDER_TABLE} WHERE id = 1)
         WHERE rowid = NEW.rowid;
      END
    `);
    await tx.execute(
      `CREATE UNIQUE INDEX IF NOT EXISTS ${APPEND_ORDER_UNIQUE_INDEX} ON agent_audit_log (append_order)`,
    );
    await tx.execute(
      `CREATE INDEX IF NOT EXISTS ${APPEND_ORDER_QUERY_INDEX} ON agent_audit_log (created_at DESC, append_order DESC)`,
    );
  };

  if (client.transaction) {
    await client.transaction(initialize);
  } else {
    await initialize(client);
  }
}

export async function ensureAuditTables(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const createSql = `
        CREATE TABLE IF NOT EXISTS agent_audit_log (
          id TEXT PRIMARY KEY,
          created_at ${intType()} NOT NULL,
          append_order ${intType()},
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
          ,run_id TEXT
          ,task_id TEXT
          ,parent_task_id TEXT
          ,source_kind TEXT
          ,source_platform TEXT
          ,source_id TEXT
          ,source_url TEXT
          ,network_protocol TEXT
          ,network_id TEXT
          ,network_peer TEXT
        )
      `;
      const lineageColumns = [
        "run_id",
        "task_id",
        "parent_task_id",
        "source_kind",
        "source_platform",
        "source_id",
        "source_url",
        "network_protocol",
        "network_id",
        "network_peer",
      ];

      if (isPostgres()) {
        // PG-guard: probe information_schema / pg_indexes before issuing DDL to
        // avoid ACCESS EXCLUSIVE lock contention in fresh background-worker processes.
        await ensureTableExists("agent_audit_log", createSql);
        for (const column of lineageColumns) {
          await ensureColumnExists(
            "agent_audit_log",
            column,
            `ALTER TABLE agent_audit_log ADD COLUMN IF NOT EXISTS ${column} TEXT`,
          );
        }
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
        await ensurePostgresAppendOrder(client);
        return;
      }

      // SQLite (local dev): no lock problem — keep the original behaviour.
      await client.execute(createSql);
      for (const column of lineageColumns) {
        try {
          await client.execute(
            `ALTER TABLE agent_audit_log ADD COLUMN ${column} TEXT`,
          );
        } catch {}
      }
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
      await ensureSqliteAppendOrder(client);
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
       error_code, owner_email, visibility, run_id, task_id, parent_task_id,
       source_kind, source_platform, source_id, source_url, network_protocol,
       network_id, network_peer)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      event.runId ?? null,
      event.taskId ?? null,
      event.parentTaskId ?? null,
      event.sourceKind ?? null,
      event.sourcePlatform ?? null,
      event.sourceId ?? null,
      event.sourceUrl ?? null,
      event.networkProtocol ?? null,
      event.networkId ?? null,
      event.networkPeer ?? null,
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
    runId: row.run_id ?? null,
    taskId: row.task_id ?? null,
    parentTaskId: row.parent_task_id ?? null,
    sourceKind: row.source_kind ?? null,
    sourcePlatform: row.source_platform ?? null,
    sourceId: row.source_id ?? null,
    sourceUrl: row.source_url ?? null,
    networkProtocol: row.network_protocol ?? null,
    networkId: row.network_id ?? null,
    networkPeer: row.network_peer ?? null,
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

// Exported so callers that must page past a single call (e.g.
// `export-audit-events`) can mirror the clamp instead of guessing it.
export const MAX_LIMIT = 500;
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
  if (filters.taskId) push("task_id = ?", filters.taskId);
  if (filters.runId) push("run_id = ?", filters.runId);
  if (filters.sourcePlatform)
    push("source_platform = ?", filters.sourcePlatform);
  if (typeof filters.sinceMs === "number") {
    push("created_at >= ?", Math.floor(filters.sinceMs));
  }

  const limit = Math.min(
    Math.max(1, Math.floor(filters.limit ?? DEFAULT_LIMIT)),
    MAX_LIMIT,
  );
  // 0-based, default-compatible: existing callers that never pass `offset`
  // keep selecting from the top of the ordered result set.
  const offset = Math.max(0, Math.floor(filters.offset ?? 0));

  const result = await client.execute({
    sql: `SELECT ${LIST_COLUMNS} FROM agent_audit_log
          WHERE ${where.join(" AND ")}
          ORDER BY created_at DESC, append_order DESC
          LIMIT ? OFFSET ?`,
    args: [...args, limit, offset],
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
