import { createHash } from "node:crypto";

import {
  getDatabaseUrl,
  getDialect,
  getDbExec,
  type DbExec,
  type Dialect,
} from "./client.js";

export interface DatabaseRuntimeFingerprint {
  configured: boolean;
  source: string;
  dialect: Dialect;
  urlHash?: string;
  protocol?: string;
  host?: string;
  database?: string;
  appName?: string;
  authTokenConfigured: boolean;
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
  dialect: Dialect;
  missingTables: string[];
  missingColumns: Array<{ table: string; column: string }>;
  error?: string;
}

const DEFAULT_REQUIRED_SCHEMA: RequiredSchemaTable[] = [
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
];

function envValue(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value || undefined;
}

function appEnvPrefix(): string | undefined {
  return envValue("APP_NAME")?.toUpperCase().replace(/-/g, "_");
}

function databaseUrlSource(): string {
  const appName = appEnvPrefix();
  if (appName && envValue(`${appName}_DATABASE_URL`)) {
    return `${appName}_DATABASE_URL`;
  }
  if (envValue("DATABASE_URL")) return "DATABASE_URL";
  if (envValue("NETLIFY_DATABASE_URL")) return "NETLIFY_DATABASE_URL";
  return "default";
}

function databaseAuthTokenConfigured(): boolean {
  const appName = appEnvPrefix();
  return Boolean(
    (appName && envValue(`${appName}_DATABASE_AUTH_TOKEN`)) ||
    envValue("DATABASE_AUTH_TOKEN") ||
    envValue("NETLIFY_DATABASE_AUTH_TOKEN"),
  );
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
  if (url.startsWith("file:")) {
    return { protocol: "file", database: url.slice("file:".length) };
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    return { protocol: "sqlite", database: url };
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
  const url = getDatabaseUrl();
  const parsed = parseDatabaseUrl(url);
  return {
    configured: Boolean(url),
    source: databaseUrlSource(),
    dialect: getDialect(),
    urlHash: shortHash(url),
    appName: envValue("APP_NAME"),
    authTokenConfigured: databaseAuthTokenConfigured(),
    netlifyDatabaseUrlConfigured: Boolean(envValue("NETLIFY_DATABASE_URL")),
    ...parsed,
  };
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

async function sqliteTableColumns(
  exec: DbExec,
  table: string,
): Promise<Set<string> | null> {
  assertSafeIdentifier(table);
  const exists = await exec.execute({
    sql: `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
    args: [table],
  });
  if (!exists.rows.length) return null;
  const result = await exec.execute(`PRAGMA table_info(${table})`);
  return new Set(result.rows.map((row) => String(row.name)));
}

async function tableColumns(
  exec: DbExec,
  dialect: Dialect,
  table: string,
): Promise<Set<string> | null> {
  return dialect === "postgres"
    ? postgresTableColumns(exec, table)
    : sqliteTableColumns(exec, table);
}

export async function runDatabaseSchemaHealthCheck(
  options: {
    exec?: DbExec;
    dialect?: Dialect;
    required?: RequiredSchemaTable[];
  } = {},
): Promise<DatabaseSchemaHealthResult> {
  const dialect = options.dialect ?? getDialect();
  const exec = options.exec ?? getDbExec();
  const required = options.required ?? DEFAULT_REQUIRED_SCHEMA;
  const missingTables: string[] = [];
  const missingColumns: Array<{ table: string; column: string }> = [];

  try {
    for (const requirement of required) {
      const columns = await tableColumns(exec, dialect, requirement.table);
      if (!columns) {
        missingTables.push(requirement.table);
        continue;
      }
      for (const column of requirement.columns) {
        if (!columns.has(column)) {
          missingColumns.push({ table: requirement.table, column });
        }
      }
    }
  } catch (err) {
    return {
      ok: false,
      checked: false,
      dialect,
      missingTables,
      missingColumns,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return {
    ok: missingTables.length === 0 && missingColumns.length === 0,
    checked: true,
    dialect,
    missingTables,
    missingColumns,
  };
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
    `db_dialect: ${db.dialect}`,
    db.protocol ? `db_protocol: ${db.protocol}` : "",
    db.host ? `db_host: ${db.host}` : "",
    db.database ? `db_database: ${db.database}` : "",
    db.urlHash ? `db_url_hash: ${db.urlHash}` : "",
    db.neon?.endpointId ? `db_neon_endpoint: ${db.neon.endpointId}` : "",
    db.neon ? `db_neon_pooled: ${db.neon.pooled}` : "",
    db.neon?.projectHost ? `db_neon_project_host: ${db.neon.projectHost}` : "",
    `db_auth_token_configured: ${db.authTokenConfigured}`,
    `netlify_database_url_configured: ${db.netlifyDatabaseUrlConfigured}`,
  ]
    .filter(Boolean)
    .join("\n");
}
