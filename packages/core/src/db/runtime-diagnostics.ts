import { createHash } from "node:crypto";

import { isTruthyRuntimeValue } from "../shared/runtime-config.js";
import {
  getDbExec,
  getRuntimeDatabaseUrl,
  getRuntimeDatabaseSource,
  isLocalDatabase,
  type DbExec,
} from "./client.js";

export interface DatabaseRuntimeFingerprint {
  configured: boolean;
  source: string;
  urlHash?: string;
  fingerprint?: string;
  protocol?: string;
  host?: string;
  database?: string;
  appName?: string;
  netlifyDatabaseUrlConfigured: boolean;
  neon?: {
    endpointId?: string;
    pooled: boolean;
    projectHost?: string;
  };
}

export interface RuntimeDebugFingerprint {
  app: string;
  environment: string;
  deployContext?: string;
  deployId?: string;
  commitRef?: string;
  branch?: string;
  siteName?: string;
  database: DatabaseRuntimeFingerprint;
}

export interface RequiredSchemaTable {
  table: string;
  columns: string[];
}

export interface DatabaseSchemaHealthResult {
  ok: boolean;
  checked: boolean;
  missingTables: string[];
  missingColumns: Array<{ table: string; column: string }>;
  /**
   * The migration-ledger half of a schema read (D210): every ledger table the
   * database actually has, with its row count and newest version, plus two
   * whole-database facts a publish must not ship past. Absent unless the schema
   * read was asked for, and `checked: false` is a failed read, never an empty
   * pass — the rule this file already applies to required tables.
   */
  migrations?: MigrationSchemaClause;
  error?: string;
}

export interface MigrationLedgerRow {
  table: string;
  rows: number;
  maxVersion: number | null;
}

export interface MigrationSchemaClause {
  checked: boolean;
  ledgers: MigrationLedgerRow[];
  invalidIndexes: number | null;
  waitingLocks: number | null;
  readAt: string;
  error?: string;
}

export const DEFAULT_REQUIRED_SCHEMA: RequiredSchemaTable[] = [
  {
    table: "agent_runs",
    columns: [
      "id",
      "thread_id",
      "status",
      "started_at",
      "completed_at",
      "heartbeat_at",
      "last_progress_at",
      "turn_id",
      "error_code",
      "error_detail",
      "terminal_reason",
      "dispatch_mode",
      "diag_stage",
      "worker_stage",
    ],
  },
  {
    table: "agent_run_events",
    columns: ["run_id", "seq", "event_at", "event_data"],
  },
  {
    table: "agent_tool_ledger",
    columns: ["thread_id", "tool_key", "result_summary", "completed_at"],
  },
  {
    table: "chat_threads",
    columns: [
      "id",
      "owner_email",
      "title",
      "preview",
      "thread_data",
      "message_count",
      "created_at",
      "updated_at",
      "scope_type",
      "scope_id",
      "scope_label",
      "pinned_at",
      "archived_at",
    ],
  },
  {
    table: "settings",
    columns: ["key", "value", "updated_at"],
  },
  {
    table: "application_state",
    columns: ["session_id", "key", "value", "updated_at"],
  },
  {
    table: "integration_remote_devices",
    columns: [
      "id",
      "owner_email",
      "label",
      "device_token_hash",
      "status",
      "created_at",
      "updated_at",
    ],
  },
];

function envValue(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value || undefined;
}

export const BETTER_AUTH_REQUIRED_SCHEMA: RequiredSchemaTable[] = [
  { table: "user", columns: ["id", "email", "name", "email_verified"] },
  { table: "session", columns: ["id", "user_id", "token", "expires_at"] },
  {
    table: "account",
    columns: ["id", "user_id", "provider_id", "account_id"],
  },
  {
    table: "verification",
    columns: ["id", "identifier", "value", "expires_at"],
  },
  {
    table: "jwks",
    columns: ["id", "public_key", "private_key", "alg", "crv"],
  },
];

function isAuthDisabled(): boolean {
  return isTruthyRuntimeValue(envValue("AUTH_DISABLED"));
}

export function getRequiredSchema(
  authEnabled: boolean = !isAuthDisabled(),
): RequiredSchemaTable[] {
  return authEnabled
    ? [...DEFAULT_REQUIRED_SCHEMA, ...BETTER_AUTH_REQUIRED_SCHEMA]
    : DEFAULT_REQUIRED_SCHEMA;
}

function shortHash(value: string): string | undefined {
  if (!value) return undefined;
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function parseDatabaseUrl(url: string): Partial<DatabaseRuntimeFingerprint> {
  if (!url) return {};
  if (url.startsWith("pglite:")) {
    return { protocol: "pglite", database: url.slice("pglite:".length) };
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    return {};
  }

  try {
    const parsed = new URL(url);
    const host = parsed.hostname || undefined;
    const neonMatch = host?.match(/^(ep-[a-z0-9-]+?)(-pooler)?\.(.+)$/i);
    const isNeon = Boolean(host?.endsWith(".neon.tech") && neonMatch);
    return {
      protocol: parsed.protocol.replace(/:$/, ""),
      host,
      database: parsed.pathname.replace(/^\//, "") || undefined,
      ...(isNeon
        ? {
            neon: {
              endpointId: neonMatch?.[1],
              pooled: Boolean(neonMatch?.[2]),
              projectHost: neonMatch?.[3],
            },
          }
        : {}),
    };
  } catch {
    return {};
  }
}

export function getDatabaseRuntimeFingerprint(): DatabaseRuntimeFingerprint {
  const url = getRuntimeDatabaseUrl();
  const parsed = parseDatabaseUrl(url);
  return {
    configured: Boolean(url),
    source: getRuntimeDatabaseSource(),
    urlHash: shortHash(url),
    fingerprint: url
      ? `postgres:${parsed.database ?? ""}:${
          parsed.neon?.endpointId ??
          (parsed.host
            ? createHash("sha256").update(parsed.host).digest("hex").slice(0, 8)
            : "")
        }`
      : undefined,
    appName: envValue("APP_NAME"),
    netlifyDatabaseUrlConfigured: Boolean(
      envValue("NETLIFY_DATABASE_URL") ||
      envValue("NETLIFY_DATABASE_URL_UNPOOLED"),
    ),
    ...parsed,
  };
}

export function getEffectiveDatabaseEnvStatus(
  key: string,
): boolean | undefined {
  if (!/(?:^|_)DATABASE_URL(?:_UNPOOLED)?$/.test(key)) return undefined;

  const database = getDatabaseRuntimeFingerprint();
  if (!database.configured || isLocalDatabase()) return false;

  return database.source === key;
}

export function getRuntimeDebugFingerprint(): RuntimeDebugFingerprint {
  return {
    app: envValue("APP_NAME") ?? "unknown",
    environment: envValue("NODE_ENV") ?? "unknown",
    deployContext: envValue("CONTEXT") ?? envValue("VERCEL_ENV"),
    deployId: envValue("DEPLOY_ID") ?? envValue("VERCEL_DEPLOYMENT_ID"),
    commitRef:
      envValue("COMMIT_REF") ??
      envValue("NETLIFY_COMMIT_REF") ??
      envValue("VERCEL_GIT_COMMIT_SHA") ??
      envValue("GIT_COMMIT_SHA"),
    branch:
      envValue("BRANCH") ??
      envValue("HEAD") ??
      envValue("VERCEL_GIT_COMMIT_REF"),
    siteName: envValue("SITE_NAME") ?? envValue("NETLIFY_SITE_NAME"),
    database: getDatabaseRuntimeFingerprint(),
  };
}

function assertSafeIdentifier(value: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe schema identifier: ${value}`);
  }
}

async function postgresTableColumns(
  exec: DbExec,
  table: string,
): Promise<Set<string> | null> {
  const result = await exec.execute({
    sql: `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?`,
    args: [table],
  });
  if (!result.rows.length) return null;
  return new Set(result.rows.map((row) => String(row.column_name)));
}

async function tableColumns(
  exec: DbExec,
  table: string,
): Promise<Set<string> | null> {
  assertSafeIdentifier(table);
  return postgresTableColumns(exec, table);
}

const SCHEMA_HEALTH_MEMO_MS = 5_000;

// A migration ledger is a table with a `version` column whose name says so
// (`mail2_migrations`, `calendar_studio_migrations`, drizzle's
// `__drizzle_migrations`). Discovering them from information_schema rather than
// a hard-coded list is deliberate: the list differs per template, and a
// hard-coded one silently stops covering the next app that adds its own ledger —
// which is exactly the blind spot that let a publish ship ahead of its ledger.
const LEDGER_DISCOVERY_SQL = `select table_name from information_schema.columns
  where table_schema = 'public' and column_name = 'version'
    and (table_name like '%_migrations' or table_name like '%_migration' or table_name = 'schema_migrations')
  order by table_name`;
const INVALID_INDEXES_SQL = `select count(*)::int as n from pg_index where not indisvalid`;
// A migration takes an exclusive/advisory lock; a waiting lock means one is
// live. This is a whole-database read, so it is reported as a number, never
// as "no migration running" on its own.
const WAITING_LOCKS_SQL = `select count(*)::int as n from pg_locks where not granted`;

/**
 * Read the migration ledger(s) and two whole-database facts, read-only.
 *
 * Used by the publish step (D210): a publish to a DB-backed site must carry this
 * read on the target database AFTER the publish, and a read that cannot run is a
 * failed read (`checked: false` + `error`), never a pass. The table names come
 * from the database, are re-checked against an identifier pattern before being
 * quoted, and only `count(*)`/`max(version)` are selected — no row data leaves
 * the database.
 */
export async function readMigrationSchemaClause(
  exec: DbExec,
): Promise<MigrationSchemaClause> {
  const readAt = new Date().toISOString();
  const clause: MigrationSchemaClause = {
    checked: false,
    ledgers: [],
    invalidIndexes: null,
    waitingLocks: null,
    readAt,
  };
  try {
    const found = await exec.execute(LEDGER_DISCOVERY_SQL);
    const names = found.rows
      .map((row) => String((row as { table_name?: unknown }).table_name ?? ""))
      .filter((name) => /^[a-z0-9_]+$/i.test(name));
    for (const table of names) {
      // raw-sql-ok: ledger names come from the catalog and match /^[a-z0-9_]+$/
      const res = await exec.execute(
        `select count(*)::int as rows, max(version) as max_version from "${table}"`,
      );
      const row = (res.rows[0] ?? {}) as {
        rows?: unknown;
        max_version?: unknown;
      };
      clause.ledgers.push({
        table,
        rows: Number(row.rows ?? 0),
        maxVersion:
          row.max_version === null || row.max_version === undefined
            ? null
            : Number(row.max_version),
      });
    }
    const invalid = await exec.execute(INVALID_INDEXES_SQL);
    clause.invalidIndexes = Number(
      (invalid.rows[0] as { n?: unknown } | undefined)?.n ?? 0,
    );
    const locks = await exec.execute(WAITING_LOCKS_SQL);
    clause.waitingLocks = Number(
      (locks.rows[0] as { n?: unknown } | undefined)?.n ?? 0,
    );
    clause.checked = true;
  } catch (err) {
    // coercion-ok: an unreadable ledger is reported, never swallowed into
    // "nothing to see": a publish must not pass on a read that did not happen.
    return {
      ...clause,
      checked: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return clause;
}
let schemaHealthMemo: {
  at: number;
  result: DatabaseSchemaHealthResult;
} | null = null;

export async function runDatabaseSchemaHealthCheck(
  options: {
    exec?: DbExec;
    required?: RequiredSchemaTable[];
    /** D210: also read the migration ledgers and whole-database lock/index facts. */
    migrations?: boolean;
  } = {},
): Promise<DatabaseSchemaHealthResult> {
  const memoizable = !options.exec && !options.required;
  if (
    memoizable &&
    schemaHealthMemo &&
    Date.now() - schemaHealthMemo.at < SCHEMA_HEALTH_MEMO_MS
  ) {
    return schemaHealthMemo.result;
  }

  const exec = options.exec ?? getDbExec();
  const required = options.required ?? getRequiredSchema();
  const missingTables: string[] = [];
  const missingColumns: Array<{ table: string; column: string }> = [];

  try {
    const found = await Promise.all(
      required.map((requirement) => tableColumns(exec, requirement.table)),
    );
    required.forEach((requirement, index) => {
      const columns = found[index];
      if (!columns) {
        missingTables.push(requirement.table);
        return;
      }
      for (const column of requirement.columns) {
        if (!columns.has(column)) {
          missingColumns.push({ table: requirement.table, column });
        }
      }
    });
  } catch (err) {
    return {
      ok: false,
      checked: false,
      missingTables,
      missingColumns,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const result: DatabaseSchemaHealthResult = {
    ok: missingTables.length === 0 && missingColumns.length === 0,
    checked: true,
    missingTables,
    missingColumns,
  };
  // The ledger half is additive and only on request: it is 3+N read-only
  // queries, and the hot health path must not pay for them on every poll.
  if (options.migrations) {
    result.migrations = await readMigrationSchemaClause(exec);
  }
  if (memoizable && result.ok) schemaHealthMemo = { at: Date.now(), result };
  return result;
}

export function formatRuntimeDebugFingerprint(
  fingerprint: RuntimeDebugFingerprint = getRuntimeDebugFingerprint(),
): string {
  const db = fingerprint.database;
  return [
    `app: ${fingerprint.app}`,
    `environment: ${fingerprint.environment}`,
    fingerprint.deployContext
      ? `deploy_context: ${fingerprint.deployContext}`
      : "",
    fingerprint.deployId ? `deploy_id: ${fingerprint.deployId}` : "",
    fingerprint.commitRef ? `commit_ref: ${fingerprint.commitRef}` : "",
    fingerprint.branch ? `branch: ${fingerprint.branch}` : "",
    fingerprint.siteName ? `site_name: ${fingerprint.siteName}` : "",
    `db_configured: ${db.configured}`,
    `db_source: ${db.source}`,
    db.protocol ? `db_protocol: ${db.protocol}` : "",
    db.host ? `db_host: ${db.host}` : "",
    db.database ? `db_database: ${db.database}` : "",
    db.urlHash ? `db_url_hash: ${db.urlHash}` : "",
    db.neon?.endpointId ? `db_neon_endpoint: ${db.neon.endpointId}` : "",
    db.neon ? `db_neon_pooled: ${db.neon.pooled}` : "",
    db.neon?.projectHost ? `db_neon_project_host: ${db.neon.projectHost}` : "",
    `netlify_database_url_configured: ${db.netlifyDatabaseUrlConfigured}`,
  ]
    .filter(Boolean)
    .join("\n");
}
