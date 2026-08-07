/**
 * Central database client abstraction.
 *
 * Detects the database backend from the environment (D1, Postgres, or SQLite/libsql)
 * and returns a unified `DbExec` interface that all core stores use.
 *
 * Imports for postgres, better-sqlite3, and @libsql/client/web are lazy
 * (dynamic import) so this module can be loaded in any runtime (Node.js,
 * Cloudflare Workers, edge) without failing on missing native deps.
 */
import path from "path";

import {
  beginDatabaseOperation,
  recordDatabaseRetry,
} from "./request-telemetry.js";

const recyclingPostgresPools = new WeakSet<object>();
const loggedNeonPools = new WeakSet<object>();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Dialect = "sqlite" | "postgres" | "d1";

export interface DbExecQuery {
  sql: string;
  args?: unknown[];
  /**
   * Client-side wall-clock budget for this statement. Use only for idempotent
   * reads unless the caller can safely tolerate a late write completing.
   */
  timeoutMs?: number;
  /** Maximum connection-level attempts for this statement, including the first. */
  maxAttempts?: number;
}

export type DbExecStatement = string | DbExecQuery;

export interface DbExec {
  execute(sql: DbExecStatement): Promise<{
    rows: any[];
    rowsAffected: number;
  }>;
  transaction?<T>(fn: (tx: DbExec) => Promise<T>): Promise<T>;
  atomicBatch?(
    statements: readonly DbExecStatement[],
  ): Promise<Array<{ rows: any[]; rowsAffected: number }>>;
  /**
   * Release the underlying connection/pool held by this exec.
   * Only non-singleton execs created via `createDbExec()` (e.g. the migration
   * direct-endpoint exec) should call this. The global singleton exec (`getDbExec`)
   * is managed by `closeDbExec()` instead.
   */
  close?(): Promise<void>;
}

export interface DbExecConfig {
  url?: string;
  authToken?: string;
  d1Binding?: any;
}

/** Read the request-scoped Cloudflare binding without requiring every
 * consuming app's TypeScript program to include core's ambient Worker globals. */
export function getCloudflareD1Binding(): unknown {
  const runtime = globalThis as typeof globalThis & {
    __cf_env?: { DB?: unknown };
    __env__?: { DB?: unknown };
  };
  return runtime.__cf_env?.DB ?? runtime.__env__?.DB;
}

// ---------------------------------------------------------------------------
// Per-app DATABASE_URL resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the database URL for the current app.
 *
 * Checks for `<APP_NAME>_DATABASE_URL` first (e.g. `MAIL_DATABASE_URL`),
 * then falls back to `DATABASE_URL`, then Netlify's managed database env. This
 * allows multiple apps to run in the same process group (e.g. eager repo dev or
 * builder.io) with separate databases while still using the persistent Netlify
 * runtime database when `DATABASE_URL` was only exported for the build command.
 *
 * Set `APP_NAME=mail` in the child process env and
 * `MAIL_DATABASE_URL=postgres://...` in the shared env.
 */
export function getDatabaseUrl(fallback = ""): string {
  const appName = process.env.APP_NAME?.toUpperCase().replace(/-/g, "_");
  if (appName) {
    const prefixed = process.env[`${appName}_DATABASE_URL`];
    if (prefixed) return prefixed;
  }
  return (
    process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL || fallback
  );
}

/** Same per-app resolution for DATABASE_AUTH_TOKEN (used by Turso/libsql). */
export function getDatabaseAuthToken(): string | undefined {
  const appName = process.env.APP_NAME?.toUpperCase().replace(/-/g, "_");
  if (appName) {
    const prefixed = process.env[`${appName}_DATABASE_AUTH_TOKEN`];
    if (prefixed) return prefixed;
  }
  return (
    process.env.DATABASE_AUTH_TOKEN || process.env.NETLIFY_DATABASE_AUTH_TOKEN
  );
}

function getAppEnvPrefix(): string | undefined {
  return process.env.APP_NAME?.toUpperCase().replace(/-/g, "_") || undefined;
}

/**
 * Database URL to use for migrations — identical to DATABASE_URL but with the
 * Neon connection-pooler suffix stripped. Neon's PgBouncer runs in transaction
 * mode, which resets session-level ownership after each statement and causes
 * `ALTER TABLE … ADD COLUMN` to fail with "must be owner of table <x>" even
 * when the connecting role owns it. The direct endpoint bypasses PgBouncer so
 * DDL honours the role's actual ownership.
 *
 * Non-Neon URLs and already-direct Neon URLs are returned unchanged.
 */
export function getMigrationDatabaseUrl(): string {
  const appName = getAppEnvPrefix();
  const appUnpooled = appName
    ? process.env[`${appName}_DATABASE_URL_UNPOOLED`]
    : undefined;
  const url =
    appUnpooled ||
    process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
    process.env.DATABASE_URL_UNPOOLED ||
    getDatabaseUrl();
  // Neon pooler hostname: ep-<id>-pooler.<region>.<cloud>.neon.tech
  // Direct hostname:      ep-<id>.<region>.<cloud>.neon.tech
  // The region between `-pooler.` and `.neon.tech` can contain multiple
  // dot-separated labels (e.g. `c-7.us-east-1.aws`), so the matched segment
  // must allow dots — `[a-z0-9.-]+` — not just a single label. Anchoring on the
  // stable `.neon.tech` suffix keeps this from touching non-Neon hosts.
  return url.replace(/-pooler(\.[a-z0-9.-]+\.neon\.tech)/, "$1");
}

export function isLocalSqliteUrl(url: string): boolean {
  return url === "" || url.startsWith("file:") || !url.includes("://");
}

export function isPgliteUrl(url: string): boolean {
  return url.toLowerCase().startsWith("pglite:");
}

export function pgliteDataDirFromUrl(url: string): string {
  const raw = url.slice("pglite:".length);
  const dataDir = raw.startsWith("//") ? raw.slice(2) : raw;
  if (!dataDir || dataDir === "/") return "./data/pglite";
  if (
    dataDir === "memory" ||
    dataDir === "/memory" ||
    dataDir === ":memory:" ||
    dataDir === "/:memory:" ||
    dataDir === "memory://"
  ) {
    return "memory://";
  }
  return dataDir;
}

export function pgliteRuntimeDataDir(dataDir: string): string {
  if (dataDir === "memory://") return dataDir;
  if (!isServerlessRuntime() || path.isAbsolute(dataDir)) return dataDir;

  const safeParts = dataDir
    .split(/[\\/]+/)
    .filter((part) => part && part !== "." && part !== "..");
  const safeRelative =
    safeParts.length > 0
      ? path.join(...safeParts)
      : path.join("data", "pglite");
  return path.join("/tmp", safeRelative);
}

async function preparePgliteDataDir(dataDir: string): Promise<string> {
  const runtimeDataDir = pgliteRuntimeDataDir(dataDir);
  if (runtimeDataDir === "memory://") return runtimeDataDir;

  try {
    const fs = await import("fs");
    fs.mkdirSync(runtimeDataDir, { recursive: true });
  } catch {
    // Edge runtimes may not expose fs. PGlite will surface any real open error.
  }
  return runtimeDataDir;
}

async function importOptionalModule(specifier: string): Promise<any> {
  return import(/* @vite-ignore */ specifier);
}

function isMissingPackageError(err: unknown, packageName: string): boolean {
  const anyErr = err as any;
  const message = String(anyErr?.message ?? anyErr ?? "");
  return (
    (anyErr?.code === "ERR_MODULE_NOT_FOUND" &&
      message.includes(packageName)) ||
    message.includes(`Cannot find package '${packageName}'`) ||
    message.includes(`Cannot find module '${packageName}'`)
  );
}

export async function loadPglitePackage(): Promise<{ PGlite: any }> {
  const packageName = "@electric-sql/pglite";
  try {
    return (await importOptionalModule(packageName)) as { PGlite: any };
  } catch (err) {
    if (isMissingPackageError(err, packageName)) {
      throw new Error(
        "PGlite database support requires the optional @electric-sql/pglite package. " +
          "Install it with `pnpm add @electric-sql/pglite@^0.5.3`, then set " +
          "`DATABASE_URL=pglite:./data/pglite`.",
      );
    }
    throw err;
  }
}

export async function loadPgliteDrizzle(): Promise<{
  PGlite: any;
  drizzle: any;
}> {
  const drizzlePackage = "drizzle-orm/pglite";
  const { PGlite } = await loadPglitePackage();
  const drizzleMod = await importOptionalModule(drizzlePackage);
  return {
    PGlite,
    drizzle: drizzleMod.drizzle,
  };
}

const _pgliteClients = new Map<string, Promise<any>>();

export async function getPgliteClient(url: string): Promise<any> {
  const dataDir = await preparePgliteDataDir(pgliteDataDirFromUrl(url));
  let ready = _pgliteClients.get(dataDir);
  if (!ready) {
    ready = loadPglitePackage().then(({ PGlite }) => PGlite.create(dataDir));
    _pgliteClients.set(dataDir, ready);
  }
  return ready;
}

export async function closePgliteClients(): Promise<void> {
  const clients = await Promise.allSettled(_pgliteClients.values());
  _pgliteClients.clear();
  for (const result of clients) {
    if (result.status === "fulfilled") {
      await result.value.close().catch(() => {});
    }
  }
}

export async function closePgliteClient(url: string): Promise<void> {
  const dataDir = pgliteRuntimeDataDir(pgliteDataDirFromUrl(url));
  const ready = _pgliteClients.get(dataDir);
  _pgliteClients.delete(dataDir);
  if (!ready) return;

  const result = await Promise.resolve(ready).then(
    (client) => ({ status: "fulfilled" as const, client }),
    () => ({ status: "rejected" as const }),
  );
  if (result.status === "fulfilled") {
    await result.client.close().catch(() => {});
  }
}

export async function prepareLocalSqliteUrl(url: string): Promise<string> {
  if (!url.startsWith("file:")) return url;

  // On serverless runtimes (Netlify / Vercel / AWS Lambda / CF Pages) the
  // working directory is read-only. Detect this and redirect local SQLite to
  // /tmp which IS writable (ephemeral per invocation, but the server stays
  // alive for the request). Shares the canonical isServerlessRuntime() check.
  const isServerless = isServerlessRuntime();
  try {
    const fs = await import("fs");
    if (isServerless && url === "file:./data/app.db") {
      fs.mkdirSync("/tmp/data", { recursive: true });
      return "file:///tmp/data/app.db";
    }
    fs.mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
  } catch {
    // Edge runtime — no filesystem.
  }
  return url;
}

export function sqliteFilenameFromUrl(url: string): string {
  if (url.startsWith("file://")) {
    return decodeURIComponent(new URL(url).pathname);
  }
  if (url.startsWith("file:")) {
    return url.slice("file:".length) || ":memory:";
  }
  return url || "./data/app.db";
}

// ---------------------------------------------------------------------------
// Safe JSON column parsing
// ---------------------------------------------------------------------------

/**
 * Parse a JSON-serialized column value defensively. A malformed row — from a
 * hand-edit, dirty migration, or a misbehaving agent that wrote raw SQL —
 * must not break an entire list endpoint. Callers supply a fallback for the
 * malformed path; null/undefined values also fall back.
 */
export function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// SQLite retry helper
// ---------------------------------------------------------------------------

/**
 * Retry an async operation when it fails with SQLITE_BUSY.
 * Used during WAL initialization and migrations where a stale WAL from a
 * previous crash or HMR restart can briefly lock the database.
 */
export function isSqliteBusyError(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const message =
    typeof candidate?.message === "string"
      ? candidate.message
      : String(error ?? "");
  return (
    code === "SQLITE_BUSY" ||
    code.startsWith("SQLITE_BUSY_") ||
    /database is locked|SQLITE_BUSY/i.test(message)
  );
}

export async function retrySqliteBusy<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; baseDelayMs?: number; rethrow?: boolean } = {},
): Promise<T> {
  const { maxAttempts = 5, baseDelayMs = 500, rethrow = false } = opts;
  let last: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (isSqliteBusyError(e) && attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, baseDelayMs * (attempt + 1)));
      } else {
        break;
      }
    }
  }
  if (rethrow) throw last;
  return undefined as unknown as T; // caller handles undefined (e.g. PRAGMA setup)
}

/**
 * Retry a DDL statement (CREATE TABLE, CREATE INDEX) once when it fails due
 * to a Postgres pg_catalog race.
 *
 * Postgres's `IF NOT EXISTS` check is NOT atomic with the `pg_type` /
 * `pg_class` catalog insert. When multiple processes boot concurrently and
 * issue the same CREATE, both can pass the existence check and one fails
 * with code 23505 on `pg_type_typname_nsp_index`, 42710 from `TypeCreate`,
 * or similar. The table does end up created by the winner, so rerunning the
 * same `IF NOT EXISTS` statement is a safe no-op.
 */
export async function retryOnDdlRace<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    if (!isPgCatalogRace(e)) throw e;
    return await fn();
  }
}

function isPgCatalogRace(e: any): boolean {
  const msg = String(e?.message ?? "");
  if (e?.code === "42P07") return true;
  if (e?.code === "42710") {
    const routine = String(e?.routine ?? "");
    return routine === "TypeCreate" || /type .* already exists/i.test(msg);
  }
  if (e?.code !== "23505") return false;
  const constraint = String(e?.constraint_name ?? e?.constraint ?? "");
  const detail = String(e?.detail ?? "");
  return (
    constraint.startsWith("pg_type") ||
    constraint.startsWith("pg_class") ||
    detail.includes("pg_type") ||
    detail.includes("pg_class") ||
    /relation .* already exists/i.test(msg)
  );
}

/**
 * True when `e` is a UNIQUE / PRIMARY KEY constraint violation from any
 * supported driver (Postgres 23505, SQLite SQLITE_CONSTRAINT_PRIMARYKEY /
 * _UNIQUE, D1). Used by stores that accept caller-provided ids and want to
 * surface a clean "already exists" error instead of the raw SQL text.
 */
export function isUniqueViolation(e: any): boolean {
  if (e?.code === "23505") return true;
  const code = String(e?.code ?? "");
  if (
    code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
    code === "SQLITE_CONSTRAINT_UNIQUE"
  ) {
    return true;
  }
  const msg = String(e?.message ?? "").toLowerCase();
  return (
    msg.includes("unique constraint") ||
    msg.includes("primary key constraint") ||
    msg.includes("duplicate key")
  );
}

// ---------------------------------------------------------------------------
// Dialect detection
// ---------------------------------------------------------------------------

let _dialect: Dialect | undefined;

export function getDialect(): Dialect {
  if (_dialect !== undefined) return _dialect;

  // DATABASE_URL takes priority over D1 when set.
  const url = getDatabaseUrl();
  if (
    url.startsWith("postgres://") ||
    url.startsWith("postgresql://") ||
    isPgliteUrl(url)
  ) {
    _dialect = "postgres";
    return _dialect;
  }
  if (url && !url.startsWith("file:")) {
    // Remote libsql (e.g. Turso)
    _dialect = "sqlite";
    return _dialect;
  }

  const d1 = getCloudflareD1Binding();
  if (d1) {
    _dialect = "d1";
    return _dialect;
  }

  // Don't cache the fallthrough — on CF Workers, env bindings (__cf_env/__env__)
  // aren't
  // available at import time. If we cache "sqlite" here, D1 will never be
  // detected once the bindings are set in the fetch handler.
  return "sqlite";
}

export function isPostgres(): boolean {
  return getDialect() === "postgres";
}

function dialectForConfig(config: DbExecConfig): Dialect {
  const url = config.url ?? "";
  if (
    url.startsWith("postgres://") ||
    url.startsWith("postgresql://") ||
    isPgliteUrl(url)
  ) {
    return "postgres";
  }
  if (url && !url.startsWith("file:")) {
    return "sqlite";
  }
  if (config.d1Binding) {
    return "d1";
  }
  return "sqlite";
}

/**
 * Returns true when the database is a local-only SQLite file (or unset, which
 * defaults to a local SQLite file). Returns false for Postgres, remote libsql
 * (Turso), and D1 — any backend that could be shared across developers.
 *
 * Used to gate local@localhost mode: that mode uses a single shared virtual
 * user with no per-machine scoping, so on any shared database two developers
 * would read and write each other's settings, oauth tokens, and app state.
 */
export function isLocalDatabase(): boolean {
  if (isPgliteUrl(getDatabaseUrl())) return true;
  if (getDialect() !== "sqlite") return false;
  const url = getDatabaseUrl();
  return url === "" || url.startsWith("file:");
}

/** Returns BIGINT for Postgres (64-bit), INTEGER for SQLite (already 64-bit). */
export function intType(): string {
  return isPostgres() ? "BIGINT" : "INTEGER";
}

// `widenIntColumnsToBigInt` lives in `./widen-columns.js` (it depends only on
// `isPostgres`/`getDbExec` from here) so stores can import it without every
// `vi.mock("./client.js")` test having to stub the export.

// ---------------------------------------------------------------------------
// Parameter conversion: ? -> $1, $2, $3
// ---------------------------------------------------------------------------

export function sqliteToPostgresParams(sql: string): string {
  let out = "";
  let param = 0;
  let i = 0;
  let mode:
    | "normal"
    | "single"
    | "double"
    | "line-comment"
    | "block-comment"
    | "dollar" = "normal";
  let dollarTag = "";

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (mode === "line-comment") {
      out += ch;
      i++;
      if (ch === "\n") mode = "normal";
      continue;
    }

    if (mode === "block-comment") {
      out += ch;
      if (ch === "*" && next === "/") {
        out += next;
        i += 2;
        mode = "normal";
        continue;
      }
      i++;
      continue;
    }

    if (mode === "single") {
      out += ch;
      if (ch === "'" && next === "'") {
        out += next;
        i += 2;
        continue;
      }
      if (ch === "'") mode = "normal";
      i++;
      continue;
    }

    if (mode === "double") {
      out += ch;
      if (ch === '"' && next === '"') {
        out += next;
        i += 2;
        continue;
      }
      if (ch === '"') mode = "normal";
      i++;
      continue;
    }

    if (mode === "dollar") {
      if (dollarTag && sql.startsWith(dollarTag, i)) {
        out += dollarTag;
        i += dollarTag.length;
        mode = "normal";
        dollarTag = "";
        continue;
      }
      out += ch;
      i++;
      continue;
    }

    if (ch === "-" && next === "-") {
      out += ch + next;
      i += 2;
      mode = "line-comment";
      continue;
    }
    if (ch === "/" && next === "*") {
      out += ch + next;
      i += 2;
      mode = "block-comment";
      continue;
    }
    if (ch === "'") {
      out += ch;
      i++;
      mode = "single";
      continue;
    }
    if (ch === '"') {
      out += ch;
      i++;
      mode = "double";
      continue;
    }
    if (ch === "$") {
      const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (match) {
        dollarTag = match[0];
        out += dollarTag;
        i += dollarTag.length;
        mode = "dollar";
        continue;
      }
    }
    if (ch === "?") {
      out += `$${++param}`;
      i++;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

function sqlAndArgs(sql: DbExecStatement): {
  rawSql: string;
  args: unknown[];
} {
  return typeof sql === "string"
    ? { rawSql: sql, args: [] }
    : { rawSql: sql.sql, args: sql.args || [] };
}

const POSTGRES_STATEMENT_TIMEOUT_HEADROOM_MS = 250;
const POSTGRES_STATEMENT_TIMEOUT_RESET_MS = 5_000;
const POSTGRES_MAX_INT = 2_147_483_647;

function hasExplicitDbTimeout(statement: DbExecStatement): boolean {
  if (typeof statement === "string") return false;
  const timeoutMs = Number(statement.timeoutMs);
  return Number.isFinite(timeoutMs) && timeoutMs > 0;
}

function postgresStatementTimeoutMs(clientTimeoutMs: number): number {
  const safeTimeoutMs = Math.max(
    1,
    Math.min(POSTGRES_MAX_INT, Math.floor(clientTimeoutMs)),
  );
  const headroomMs = Math.min(
    POSTGRES_STATEMENT_TIMEOUT_HEADROOM_MS,
    Math.max(1, Math.floor(safeTimeoutMs * 0.1)),
  );
  return Math.max(1, safeTimeoutMs - headroomMs);
}

export function dbExecQueryBudget(statement: DbExecStatement): {
  timeoutMs: number;
  maxAttempts: number;
} {
  if (typeof statement === "string") {
    return { timeoutMs: dbOpTimeoutMs(), maxAttempts: 3 };
  }
  const timeoutMs = Number(statement.timeoutMs);
  const maxAttempts = Number(statement.maxAttempts);
  return {
    timeoutMs:
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? Math.floor(timeoutMs)
        : dbOpTimeoutMs(),
    maxAttempts:
      Number.isFinite(maxAttempts) && maxAttempts > 0
        ? Math.floor(maxAttempts)
        : 3,
  };
}

function explicitTransaction(
  execute: DbExec["execute"],
  begin = "BEGIN",
): NonNullable<DbExec["transaction"]> {
  return async (fn) => {
    await execute(begin);
    try {
      const result = await fn({ execute });
      await execute("COMMIT");
      return result;
    } catch (err) {
      await execute("ROLLBACK").catch(() => {});
      throw err;
    }
  };
}

// ---------------------------------------------------------------------------
// Connection error retry (ECONNRESET, etc.)
// ---------------------------------------------------------------------------

/** Error codes that indicate a dead/stale connection we can safely retry. */
const CONNECTION_ERROR_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EMAXCONN",
  "53300",
  "CONNECT_TIMEOUT",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "CONNECTION_CLOSED",
]);

export function isConnectionError(err: any): boolean {
  if (!err) return false;
  const code = err.code || err.cause?.code;
  if (code && CONNECTION_ERROR_CODES.has(code)) return true;
  // Neon serverless WS driver: errors from the underlying undici WebSocket
  // closing mid-query come through as TypeError or ErrorEvent without a code.
  const name = err.name || err.cause?.name || "";
  if (name === "ErrorEvent") return true;
  const stack = String(err.stack || err.cause?.stack || "");
  if (
    /WebSocket\.#onSocketClose|failWebsocketConnection|onSocketClose/.test(
      stack,
    )
  ) {
    return true;
  }
  const msg = String(err.message || err.cause?.message || "");
  return /ECONNRESET|ETIMEDOUT|EPIPE|EMAXCONN|too many connections|max client connections|remaining connection slots|connection.*(closed|ended|terminated)|socket hang up|websocket/i.test(
    msg,
  );
}

/**
 * Classify database failures that should temporarily shed request load.
 * Statement timeouts are not included in isConnectionError() because retrying
 * every timed-out mutation would not be safe, but request handlers can still
 * return a retryable service-unavailable response for them.
 */
export function isTransientDatabaseError(err: unknown): boolean {
  const error = err as {
    code?: unknown;
    name?: unknown;
    message?: unknown;
    stack?: unknown;
    cause?: {
      code?: unknown;
      name?: unknown;
      message?: unknown;
      stack?: unknown;
    };
  };
  const code = String(error?.code ?? error?.cause?.code ?? "");
  if (
    code === "ECHECKOUTTIMEOUT" ||
    // Shed load during a connect cooldown is transient by construction — the
    // endpoint refused, we chose not to re-ask yet. Surfaces as 503, not 500.
    code === "DB_CONNECT_COOLDOWN" ||
    code === "EMAXCONN" ||
    code === "53300" ||
    code === "57014" ||
    /^08/.test(code) ||
    /^57P0[123]$/.test(code)
  ) {
    return true;
  }

  const message = [error?.message, error?.cause?.message]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  if (
    /\bstatement timeout\b|\bdb (?:query|connect) timed out\b/i.test(message)
  ) {
    return true;
  }

  const databaseSurface = [
    error?.name,
    error?.cause?.name,
    error?.stack,
    error?.cause?.stack,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return (
    isConnectionError(error) &&
    /@neondatabase|@libsql|\bpostgres(?:ql)?\b|\bpg-pool\b|drizzle-orm|\/db\/client\.[cm]?[jt]s/i.test(
      databaseSurface,
    )
  );
}

export async function retryOnConnectionError<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isConnectionError(e) || attempt === maxAttempts - 1) throw e;
      recordDatabaseRetry();
      await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
    }
  }
  throw last;
}

// ---------------------------------------------------------------------------
// Per-op timeout — converts a silent serverless hang into a retryable error
// ---------------------------------------------------------------------------

/**
 * Max wall time for a single DB op (init or query) before we treat it as a
 * dead connection. A frozen→thawed serverless instance can leave the Neon
 * WebSocket (or a postgres.js socket) hung mid-flight: the promise neither
 * settles nor errors, so retryOnConnectionError() — which only retries thrown
 * errors — can't help and the request hangs until the platform kills the
 * function (~30s on Netlify). For authenticated requests that run a session
 * lookup on every navigation this surfaces as "the site won't load". Bounding
 * each op well under the platform function limit turns the silent hang into a
 * CONNECT_TIMEOUT that the existing retry and reject-reset paths already
 * handle. Override with DB_OP_TIMEOUT_MS.
 */
export function dbOpTimeoutMs(): number {
  const raw = Number(process.env.DB_OP_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return isServerlessRuntime() ? 8_000 : 30_000;
}

/**
 * Timeout error tagged with a recognized connection-error code so
 * isConnectionError() / retryOnConnectionError() treat a hung op as a
 * retryable dead connection, and upstream reject-reset guards (e.g. the
 * cached session-table init promise) clear their poisoned state.
 */
class DbTimeoutError extends Error {
  code = "CONNECT_TIMEOUT";
  constructor(op: string, ms: number) {
    super(`DB ${op} timed out after ${ms}ms (connection terminated)`);
    this.name = "DbTimeoutError";
  }
}

/**
 * Race a DB op against {@link dbOpTimeoutMs}. Callers that own a cancellable
 * query or pooled client should pass onTimeout so the losing operation does
 * not keep occupying a scarce connection slot after the request has recovered.
 */
export async function withDbTimeout<T>(
  op: string,
  run: () => Promise<T>,
  ms = dbOpTimeoutMs(),
  onTimeout?: () => void | Promise<void>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  const finishTelemetry = beginDatabaseOperation(
    op === "connect" ? "connect" : "query",
  );

  const runCleanup = async () => {
    if (!onTimeout) return;
    try {
      await onTimeout();
    } catch (err) {
      console.warn(
        `[db] timeout cleanup for ${op} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  };

  return await new Promise<T>((resolve, reject) => {
    const finish = (
      complete: (value: T | PromiseLike<T>) => void,
      value: T | PromiseLike<T>,
    ) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      finishTelemetry("success");
      complete(value);
    };
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      finishTelemetry("error");
      reject(err);
    };

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void (async () => {
        await runCleanup();
        finishTelemetry("timeout");
        reject(new DbTimeoutError(op, ms));
      })();
    }, ms);

    let promise: Promise<T>;
    try {
      promise = run();
    } catch (err) {
      fail(err);
      return;
    }
    promise.then((value) => finish(resolve, value), fail);
  });
}

// ---------------------------------------------------------------------------
// Serverless-aware Postgres pool options
// ---------------------------------------------------------------------------

/**
 * True on serverless function runtimes (Netlify / Vercel / AWS Lambda /
 * Cloudflare Pages Functions) where every concurrent request can spin up its
 * own frozen process. Connections cannot be shared across instances, so each
 * instance must keep its pool tiny — otherwise dozens of warm instances each
 * holding postgres.js's default 10-connection pool blow past Neon/Postgres'
 * connection cap and every `/_agent-native/*` route 500s with "Max client
 * connections reached".
 */
export function isServerlessRuntime(): boolean {
  return (
    !!process.env.NETLIFY ||
    !!process.env.VERCEL ||
    !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
    !!process.env.LAMBDA_TASK_ROOT ||
    !!process.env.CF_PAGES
  );
}

/**
 * True for production serverless execution contexts. Netlify also exposes
 * `NETLIFY=true` in its build environment, so build-time code that owns
 * migrations must use `withMigrationRuntime()` explicitly.
 */
export function isProductionServerlessFunctionRuntime(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NODE_ENV !== "production" || env.NETLIFY_LOCAL === "true") {
    return false;
  }

  return Boolean(
    env.NETLIFY === "true" ||
    env.NETLIFY_FUNCTION_NAME ||
    env.AWS_LAMBDA_FUNCTION_NAME ||
    env.AWS_LAMBDA_FUNCTION_VERSION ||
    env.LAMBDA_TASK_ROOT ||
    env.AWS_EXECUTION_ENV?.startsWith("AWS_Lambda") === true ||
    env.VERCEL_FUNCTION_ID ||
    env.VERCEL_REGION ||
    env.VERCEL === "1",
  );
}

const SCHEMA_MUTATION_STATEMENT =
  /^\s*(?:CREATE|ALTER|DROP|TRUNCATE|COMMENT|REINDEX|GRANT|REVOKE)\b/i;

function rawSql(statement: DbExecStatement): string {
  return typeof statement === "string" ? statement : statement.sql;
}

/** True for statements that change database schema or database privileges. */
export function isSchemaMutationStatement(statement: DbExecStatement): boolean {
  return SCHEMA_MUTATION_STATEMENT.test(rawSql(statement));
}

/**
 * Request functions must never be able to prepare or mutate schema. Throwing
 * here makes an unconverted ensureTable path fail loudly instead of silently
 * reporting success against a missing table. The release migration wrapper
 * is the only supported production opt-in.
 */
export function assertSchemaMutationAllowed(statement: DbExecStatement): void {
  const migrationRuntime =
    (
      globalThis as typeof globalThis & {
        __AGENT_NATIVE_MIGRATION_RUNTIME__?: boolean;
      }
    ).__AGENT_NATIVE_MIGRATION_RUNTIME__ === true;
  if (
    isProductionServerlessFunctionRuntime() &&
    !migrationRuntime &&
    isSchemaMutationStatement(statement)
  ) {
    throw new Error(
      "Schema mutation attempted in a production serverless request. Run migrations in the release job instead.",
    );
  }
}

/**
 * postgres.js pool options tuned per runtime. idle_timeout is shortened on
 * serverless so a thawed-but-idle instance releases its connections quickly.
 * Long-lived Node servers keep the larger pool for throughput.
 *
 * The cap assumes {@link sharedDbPool}: one pool per URL for the whole
 * process, not one per consumer. See {@link neonPoolMax} for why the cap must
 * leave room for concurrency.
 */
/**
 * Identifies the connection in `pg_stat_activity.application_name`.
 *
 * Without it every backend reports `pgbouncer` and a runaway query is
 * anonymous. A 58 MB `SELECT id, config FROM dashboards` ran 20-wide against
 * production and could not be traced to a caller: it appears nowhere in the
 * repo or any built bundle, and `pg_stat_statements` is not installed. This is
 * the cheapest thing that would have named it.
 */
function poolApplicationName(): string {
  const site =
    process.env.SITE_NAME ??
    process.env.NETLIFY_SITE_NAME ??
    process.env.AGENT_NATIVE_APP_NAME ??
    "app";
  return `agent-native:${site}`.slice(0, 63);
}

export function pgPoolOptions(url: string): Record<string, unknown> {
  const serverless = isServerlessRuntime();
  return {
    onnotice: () => {},
    connection: { application_name: poolApplicationName() },
    max: serverless ? serverlessPoolMax() : 20,
    idle_timeout: serverless ? 20 : 240,
    max_lifetime: 60 * 30,
    connect_timeout: 10,
    ...(serverless
      ? {
          connection: {
            application_name: poolApplicationName(),
            idle_in_transaction_session_timeout: 30_000,
          },
        }
      : {}),
    // Supabase's connection pooler (Transaction mode) requires prepare:false.
    // Only disable for Supabase URLs to avoid degrading other deployments.
    ...(url.includes("supabase") ? { prepare: false } : {}),
  };
}

/**
 * Shared options for every Neon serverless pool. The startup parameter is
 * applied by Postgres before the first transaction, so a killed function
 * cannot return a connection that remains idle in transaction indefinitely.
 */
export function neonPoolOptions(): {
  max: number;
  idle_in_transaction_session_timeout?: number;
} {
  return {
    max: neonPoolMax(),
    ...(isServerlessRuntime()
      ? { idle_in_transaction_session_timeout: 30_000 }
      : {}),
  };
}

/**
 * Connection cap for the @neondatabase/serverless `Pool`.
 *
 * TRAP: this number is the ceiling on how many statements one request can have
 * in flight at once. It used to be 1 on serverless, which made every
 * `Promise.all([...reads])` in a request serialize behind the single slot —
 * against a remote endpoint that is ~83ms of pure wait per query, so ten
 * "concurrent" reads took ~880ms instead of ~86ms. The cap was 1 only because
 * every consumer built its OWN pool (the DbExec singleton, Better Auth, and one
 * per `createGetDb()` schema module), so the real per-instance connection count
 * was that number multiplied by ~6. {@link sharedDbPool} collapses those into
 * one pool per URL, so the same aggregate budget buys in-request concurrency.
 * Keep pools shared if you raise this.
 */
export function neonPoolMax(): number {
  if (!isServerlessRuntime()) return 20;
  return serverlessPoolMax();
}

function serverlessPoolMax(): number {
  // Scheduled Analytics workers run independently and may overlap across
  // invocations. They process work sequentially, so one connection prevents
  // a slow sweep from multiplying Neon connections while foreground requests
  // retain two slots for their concurrent reads.
  if (isLowConnectionBackgroundRuntime()) return 1;
  // Netlify can run several background workers concurrently. Keep their four
  // slots: the agent pre-send setup fires ~6 concurrent DB reads, and two
  // connections previously froze the worker before it could claim. Foreground
  // requests use two slots instead, leaving more headroom across warm
  // instances where the user-facing routes are the pressure source.
  if (isBackgroundFunctionPoolContext()) return 4;
  return 2;
}

function isLowConnectionBackgroundRuntime(): boolean {
  return (
    (globalThis as Record<string, unknown>)
      .__AGENT_NATIVE_LOW_CONNECTION_BACKGROUND_RUNTIME__ === true
  );
}

/**
 * Inline mirror of `isInBackgroundFunctionRuntime()`
 * (agent/durable-background.ts), replicated here to avoid a `db` → `agent`
 * import cycle. Keep the signals in sync with that function.
 */
export function isBackgroundFunctionPoolContext(): boolean {
  if (
    (globalThis as Record<string, unknown>)
      .__AGENT_NATIVE_BACKGROUND_RUNTIME__ === true
  ) {
    return true;
  }
  // NOTE: we deliberately do NOT trust `__AGENT_NATIVE_BACKGROUND_RUNTIME_EXPECTED__`
  // here. That flag is set from the dispatch MARKER (which URL the foreground
  // targeted), not from proof the request actually LANDED on a background
  // function. A worker dispatched toward `-background` but routed onto the ~60s
  // synchronous function would otherwise take the 8-connection background pool
  // while running as one of MANY warm sync-function instances — multiplying
  // Neon connections and exhausting the pooled endpoint ("connection
  // terminated" / statement timeouts / failed heartbeat writes → stale runs).
  // The genuine `-background` function sets `__AGENT_NATIVE_BACKGROUND_RUNTIME__`
  // as its first cold-start statement, so a real background worker still gets
  // the larger pool via the check above. Mirrors the same proof-of-landing
  // tightening applied to `shouldUseBackgroundFunctionTimeoutForWorker`.
  const lambdaName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (
    typeof lambdaName === "string" &&
    lambdaName.toLowerCase().endsWith("-background")
  ) {
    return true;
  }
  const forced = process.env.AGENT_CHAT_FORCE_BACKGROUND_RUNTIME;
  if (forced != null) {
    const v = forced.trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes" || v === "on";
  }
  return false;
}

/**
 * Render any rejection reason as a readable message. The Neon serverless
 * driver surfaces WebSocket failures as raw DOM-style ErrorEvent objects (not
 * Error instances), which stringify uselessly as "[object ErrorEvent]" — pull
 * the message off the event (or its nested `.error`) instead so logs carry
 * actual context.
 */
export function describeDbError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const evt = err as {
      message?: unknown;
      error?: { message?: unknown };
      type?: unknown;
    };
    const msg = evt.message ?? evt.error?.message;
    if (typeof msg === "string" && msg) return msg;
    if (evt.type === "error") {
      return "WebSocket ErrorEvent (connection failed; no message attached)";
    }
  }
  return String(err);
}

/**
 * How long one endpoint stops ATTEMPTING to connect after an attempt failed.
 * Jittered so concurrent function instances do not re-probe in lockstep.
 */
function connectCooldownMs(): number {
  const raw = Number(process.env.DB_CONNECT_COOLDOWN_MS);
  const base = Number.isFinite(raw) && raw > 0 ? raw : 2_000;
  return Math.round(base * (0.5 + Math.random()));
}

/**
 * Thrown INSTEAD of attempting, while an endpoint is in cooldown.
 *
 * The refused attempt's error is described in the message and deliberately NOT
 * attached as `cause`: isConnectionError() walks `cause.code`/`cause.message`,
 * so a cause would reclassify this as retryable and retryOnConnectionError
 * would drive the storm straight back.
 */
export class DbConnectCooldownError extends Error {
  code = "DB_CONNECT_COOLDOWN";
  constructor(remainingMs: number, refusedBy: string) {
    super(
      `Database is refusing connection attempts; not attempting again for ${remainingMs}ms. Last failure: ${refusedBy}`,
    );
    this.name = "DbConnectCooldownError";
  }
}

const connectCooldowns = new Map<
  string,
  { until: number; refusedBy: string }
>();

/**
 * Neon rejects a connection ATTEMPT, not a connection: "Failed to acquire
 * permit to connect to the database. Too many database connection attempts are
 * currently ongoing." A failed acquire leaves the pool with zero idle clients,
 * so the next execute() calls connect() again — and retryOnConnectionError
 * backs off only 100ms. The process answers a refusal by manufacturing the next
 * attempt, which is what keeps the refusal true. Production sat in this loop
 * until the compute was restarted by hand.
 *
 * Hold a short cooldown per endpoint so a refused attempt cannot produce the
 * next one. Checking out an ALREADY-IDLE client is not an attempt and passes
 * through, so a cooldown degrades throughput instead of taking the process
 * offline.
 */
function gateNeonConnect(
  pool: Record<string, any>,
  url: string,
  label: string,
): void {
  const connect = pool.connect;
  if (typeof connect !== "function") return;
  const gated = function gatedConnect(this: unknown, ...args: unknown[]) {
    const idle = typeof pool.idleCount === "number" ? pool.idleCount : 0;
    const gate = connectCooldowns.get(url);
    if (idle === 0 && gate && Date.now() < gate.until) {
      return Promise.reject(
        new DbConnectCooldownError(gate.until - Date.now(), gate.refusedBy),
      );
    }
    return Promise.resolve(connect.apply(this, args)).then(
      (client: unknown) => {
        connectCooldowns.delete(url);
        return client;
      },
      (err: unknown) => {
        const refusedBy = describeDbError(err);
        const ms = connectCooldownMs();
        // One line per cooldown window, not per shed request.
        if (!gate || Date.now() >= gate.until) {
          console.warn(
            `[${label}] connection attempt refused; pausing attempts ${ms}ms:`,
            refusedBy,
          );
        }
        connectCooldowns.set(url, { until: Date.now() + ms, refusedBy });
        throw err;
      },
    );
  };
  // Carry the wrapped function's own properties onto the wrapper. A pool's
  // `connect` may be instrumented — metrics, tracing, a test spy — and
  // replacing it with a bare closure would silently drop that instrumentation
  // along with any assertions built on it.
  Object.assign(gated, connect);
  pool.connect = gated;
}

export function guardNeonPool(
  pool: unknown,
  url: string,
  label = "db/neon",
): void {
  if (!pool || typeof pool !== "object") return;
  if (loggedNeonPools.has(pool)) return;
  const withEvents = pool as {
    on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  };
  if (typeof withEvents.on !== "function") return;

  loggedNeonPools.add(pool);
  gateNeonConnect(pool as Record<string, any>, url, label);
  withEvents.on("error", (err: unknown) => {
    console.warn(
      `[${label}] pool error (will reconnect on next query):`,
      describeDbError(err),
    );
  });

  // Attach a persistent 'error' listener to EVERY client for its whole lifetime.
  //
  // @neondatabase/serverless mirrors pg-pool, which only keeps its own idle
  // error listener on a client while that client is idle — it REMOVES the
  // listener the moment the client is checked out. So when a checked-out
  // client's WebSocket drops mid-flight (Lambda freeze/thaw, Neon "terminating
  // connection due to administrator command", an idle socket the pooler closed),
  // the client emits 'error' with no listener. Node turns an unhandled 'error'
  // EventEmitter event into an uncaught exception, which crashes the whole
  // serverless function. This was by far the single highest-volume production
  // crash (Sentry "Unhandled error. ()", mechanism auto.node.onuncaughtexception,
  // culprit neondatabase__serverless). pg routes the failure to the in-flight
  // query independently, so this listener only needs to keep the emit from going
  // unhandled — the dropped client is discarded and the next query reconnects.
  withEvents.on("connect", (client: unknown) => {
    if (!client || typeof client !== "object") return;
    const clientEvents = client as {
      on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
    };
    if (typeof clientEvents.on !== "function") return;
    clientEvents.on("error", (err: unknown) => {
      console.warn(
        `[${label}] client connection error (connection discarded, next query reconnects):`,
        describeDbError(err),
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Shared connection pools
// ---------------------------------------------------------------------------

interface ClosablePool {
  end(): Promise<unknown>;
}

const _sharedDbPools = new Map<string, ClosablePool>();
const _sharedDbPoolCloseHooks = new Set<() => void>();
const _sharedDbPoolReplacementHooks = new Map<string, Set<() => void>>();

/**
 * One connection pool per (driver, URL) for the whole process.
 *
 * Opening a connection to a remote database costs a full TCP + TLS + auth
 * round-trip chain (~300-800ms measured against Neon in-region), and it used
 * to be paid once per CONSUMER: the `getDbExec` singleton, Better Auth, and one
 * more for every `createGetDb()` schema module (four in core alone, plus each
 * app's). Their `max` values also multiplied against the provider's connection
 * cap, which forced each pool down to a size too small to run a request's reads
 * concurrently.
 *
 * TRAP: only consumers that live as long as the process may share. Anything
 * handed a `close()` — `createDbExec()`, the migration exec on the direct
 * endpoint — must keep a private pool, or closing it takes the whole process's
 * database access down with it.
 */
export function sharedDbPool<T extends ClosablePool>(
  driver: string,
  url: string,
  create: () => T,
): T {
  const key = `${driver} ${url}`;
  const existing = _sharedDbPools.get(key);
  if (existing) return existing as T;
  const created = create();
  _sharedDbPools.set(key, created);
  return created;
}

/**
 * Swap the pool registered for a key, for the postgres.js recycle path that
 * replaces a pool whose query timed out. Without this the registry would keep
 * handing out the discarded pool.
 */
export function replaceSharedDbPool<T extends ClosablePool>(
  driver: string,
  url: string,
  previous: T,
  next: T,
): void {
  const key = `${driver} ${url}`;
  if (_sharedDbPools.get(key) !== previous) return;
  _sharedDbPools.set(key, next);
  for (const hook of _sharedDbPoolReplacementHooks.get(key) ?? []) {
    try {
      hook();
    } catch {
      // A consumer's reset must not block the replacement from being used.
    }
  }
}

/**
 * Run `hook` when one shared pool is replaced, so derived consumers rebuild
 * their handles instead of continuing to use the timed-out pool.
 */
export function onSharedDbPoolReplaced(
  driver: string,
  url: string,
  hook: () => void,
): void {
  const key = `${driver}${String.fromCharCode(0)}${url}`;
  const hooks = _sharedDbPoolReplacementHooks.get(key) ?? new Set();
  hooks.add(hook);
  _sharedDbPoolReplacementHooks.set(key, hooks);
}

/**
 * Run `hook` when the shared pools are closed, so consumers holding a derived
 * handle (a Drizzle instance bound to the pool, the Better Auth adapter) drop
 * it instead of issuing queries on a closed pool.
 */
export function onSharedDbPoolsClosed(hook: () => void): void {
  _sharedDbPoolCloseHooks.add(hook);
}

export async function closeSharedDbPools(): Promise<void> {
  const pools = [..._sharedDbPools.values()];
  _sharedDbPools.clear();
  for (const hook of _sharedDbPoolCloseHooks) {
    try {
      hook();
    } catch {
      // A consumer's reset must not block the rest from being released.
    }
  }
  await Promise.all(
    pools.map((pool) =>
      Promise.resolve(pool.end()).catch(() => {
        // Already closed (process exiting, provider hung up) — nothing to do.
      }),
    ),
  );
}

function disposePostgresPoolEventually(
  pool: { end: () => Promise<unknown> },
  label: string,
): void {
  if (!pool || typeof pool !== "object") return;
  if (recyclingPostgresPools.has(pool)) return;
  recyclingPostgresPools.add(pool);
  void pool.end().catch((err: unknown) => {
    console.warn(
      `[db/postgres] ${label} cleanup failed:`,
      err instanceof Error ? err.message : err,
    );
  });
}

// ---------------------------------------------------------------------------
// Singleton client — lazy-initialized on first execute() call
// ---------------------------------------------------------------------------

let _exec: DbExec | undefined;
let _sqlite: any;
let _initPromise: Promise<void> | undefined;

async function executePglite(
  client: {
    query: (
      sql: string,
      args?: any[],
    ) => Promise<{ rows?: any[]; affectedRows?: number; rowCount?: number }>;
  },
  sql: Parameters<DbExec["execute"]>[0],
): ReturnType<DbExec["execute"]> {
  const { rawSql, args } = sqlAndArgs(sql);
  const pgSql = sqliteToPostgresParams(rawSql);
  const result = await client.query(pgSql, args as any[]);
  return {
    rows: Array.from(result.rows ?? []),
    rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
  };
}

async function createDbExecInternal(
  config: DbExecConfig = {},
  trackSingletonResources = false,
): Promise<DbExec> {
  const dialect = dialectForConfig(config);

  // Cloudflare D1
  if (dialect === "d1") {
    const d1 = config.d1Binding;
    const execute: DbExec["execute"] = async (sql) => {
      if (typeof sql === "string") {
        const r = await d1.prepare(sql).all();
        return {
          rows: r.results || [],
          rowsAffected: r.meta?.changes ?? 0,
        };
      }
      const r = await d1
        .prepare(sql.sql)
        .bind(...(sql.args ?? []))
        .all();
      return { rows: r.results || [], rowsAffected: r.meta?.changes ?? 0 };
    };
    return {
      execute,
      async atomicBatch(statements) {
        const prepared = statements.map((statement) => {
          if (typeof statement === "string") return d1.prepare(statement);
          return d1.prepare(statement.sql).bind(...(statement.args ?? []));
        });
        const results = await d1.batch(prepared);
        return results.map((result: any) => ({
          rows: result.results || [],
          rowsAffected: result.meta?.changes ?? 0,
        }));
      },
    };
  }

  let url = config.url || "file:./data/app.db";

  if (isPgliteUrl(url)) {
    const client = await getPgliteClient(url);
    return {
      execute: (sql) => executePglite(client, sql),
      async transaction<T>(fn: (tx: DbExec) => Promise<T>): Promise<T> {
        return client.transaction((tx: any) =>
          fn({
            execute: (sql) => executePglite(tx, sql),
          }),
        );
      },
      async close() {
        await closePgliteClient(url);
      },
    };
  }

  // Postgres — uses postgres.js. Works on Node.js natively and on Cloudflare
  // Workers with the nodejs_compat compatibility flag (provides net/tls polyfills).
  // On Workers, connections can't be shared across requests, so we create a
  // fresh connection per query (max:1) to avoid the "I/O on behalf of a
  // different request" error.
  if (dialect === "postgres") {
    const { isNeonUrl } = await import("./create-get-db.js");

    // Neon over @neondatabase/serverless (WebSocket upgrade on port 443).
    // postgres-js uses a raw TCP socket on 5432 that frequently fails on
    // serverless runtimes (Netlify Functions, Vercel, CF Workers) when
    // Neon's pooler is cold — every request after an idle period times out
    // with CONNECT_TIMEOUT. The serverless Pool handles wake-up transparently
    // and keeps the same `pg`-compatible query(...) interface we need here.
    if (isNeonUrl(url)) {
      const { Pool, neon } = await import("@neondatabase/serverless");
      // A frozen/thawed background function can retain half-dead WebSocket
      // connections, so its direct executions use stateless Neon HTTP instead.
      // The foreground and transaction surface keep the WebSocket pool.
      const bgHttp = isBackgroundFunctionPoolContext();
      const makePool = () =>
        new Pool({ connectionString: url, ...neonPoolOptions() });
      // The singleton exec shares the process pool; `createDbExec()` callers own
      // a `close()` and so must not be handed it.
      const pool = trackSingletonResources
        ? sharedDbPool("neon", url, makePool)
        : makePool();
      guardNeonPool(pool, url);
      const httpSql = bgHttp ? neon(url, { fullResults: true }) : null;
      async function queryNeonClient(
        client: any,
        sql: Parameters<DbExec["execute"]>[0],
        timeoutOverrideMs?: number,
      ) {
        const { rawSql, args } = sqlAndArgs(sql);
        const { timeoutMs } = dbExecQueryBudget(sql);
        const pgSql = sqliteToPostgresParams(rawSql);
        const result = await withDbTimeout(
          "query",
          () =>
            client.query(pgSql, args as any[]) as Promise<{
              rows: unknown[];
              rowCount?: number;
            }>,
          timeoutOverrideMs ?? timeoutMs,
        );
        return {
          rows: result.rows,
          rowsAffected: result.rowCount ?? 0,
        };
      }
      async function queryNeonClientWithStatementTimeout(
        client: any,
        sql: Parameters<DbExec["execute"]>[0],
        remainingMs: () => number,
        markClientForDiscard: () => void,
      ) {
        const statementTimeoutMs = postgresStatementTimeoutMs(remainingMs());
        await queryNeonClient(
          client,
          `SET statement_timeout = ${statementTimeoutMs}`,
          remainingMs(),
        );
        try {
          return await queryNeonClient(client, sql, remainingMs());
        } finally {
          try {
            await queryNeonClient(
              client,
              "RESET statement_timeout",
              Math.max(remainingMs(), POSTGRES_STATEMENT_TIMEOUT_RESET_MS),
            );
          } catch (err) {
            markClientForDiscard();
            console.warn(
              "[db/neon] statement timeout reset failed; discarding connection:",
              err instanceof Error ? err.message : err,
            );
          }
        }
      }
      async function queryNeonHttp(sql: Parameters<DbExec["execute"]>[0]) {
        if (!httpSql) {
          throw new Error("Neon HTTP query used outside a background function");
        }
        const { rawSql, args } = sqlAndArgs(sql);
        const { timeoutMs } = dbExecQueryBudget(sql);
        const pgSql = sqliteToPostgresParams(rawSql);
        const controller = new AbortController();
        const run = async () => {
          if (!hasExplicitDbTimeout(sql)) {
            return httpSql.query(pgSql, args as any[], {
              fetchOptions: { signal: controller.signal },
            });
          }
          const statementDeadlineMs =
            Date.now() + postgresStatementTimeoutMs(timeoutMs);
          const results = await httpSql.transaction(
            [
              httpSql.query(
                `SELECT set_config(
                  'statement_timeout',
                  GREATEST(
                    1,
                    $1::bigint -
                      FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint
                  )::text,
                  true
                )`,
                [statementDeadlineMs],
              ),
              httpSql.query(pgSql, args as any[]),
            ],
            { fetchOptions: { signal: controller.signal } },
          );
          return results[1];
        };
        const result = await withDbTimeout("query", run, timeoutMs, () =>
          controller.abort(),
        );
        return {
          rows: result.rows,
          rowsAffected: result.rowCount ?? 0,
        };
      }
      return {
        async execute(sql) {
          const { timeoutMs, maxAttempts } = dbExecQueryBudget(sql);
          if (bgHttp) {
            // HTTP-per-query path: no pool.connect() and no persistent socket
            // to survive a background-function freeze. Explicitly budgeted
            // statements run with SET LOCAL inside the same HTTP transaction,
            // so the server cancels the SQL before the fetch deadline without
            // leaking session state into Neon's pooled backends.
            return retryOnConnectionError<{
              rows: unknown[];
              rowsAffected: number;
            }>(() => queryNeonHttp(sql), maxAttempts);
          }
          const result = await retryOnConnectionError<{
            rows: unknown[];
            rowsAffected: number;
          }>(async () => {
            const attemptStartedAt = Date.now();
            const remainingAttemptMs = () =>
              Math.max(1, timeoutMs - (Date.now() - attemptStartedAt));
            // Bound the pooled-connection ACQUIRE, not just the query below.
            // Neon's pooler can stall on `connect()` when cold or exhausted,
            // and that happens BEFORE `client.query`, so the query-level
            // timeout never fires — the request hangs until the platform kills
            // the function (~"the site won't load" for authenticated users,
            // whose every request runs a session/org lookup). Time the acquire
            // out into a retryable CONNECT_TIMEOUT that retryOnConnectionError
            // already handles, and release the connection if it resolves after
            // we've given up so the scarce pool slot isn't leaked.
            let acquireTimedOut = false;
            const client = await withDbTimeout(
              "connect",
              () =>
                pool.connect().then((c) => {
                  if (acquireTimedOut) c.release();
                  return c;
                }),
              remainingAttemptMs(),
              () => {
                acquireTimedOut = true;
              },
            );
            let released = false;
            const releaseClient = (err?: Error | boolean) => {
              if (released) return;
              released = true;
              client.release(err);
            };
            let discardClient = false;

            try {
              const result = hasExplicitDbTimeout(sql)
                ? await queryNeonClientWithStatementTimeout(
                    client,
                    sql,
                    remainingAttemptMs,
                    () => {
                      discardClient = true;
                    },
                  )
                : await queryNeonClient(client, sql, remainingAttemptMs());
              releaseClient(discardClient ? true : undefined);
              return result;
            } catch (err) {
              releaseClient(
                discardClient || isConnectionError(err) ? true : undefined,
              );
              throw err;
            }
          }, maxAttempts);
          return {
            rows: result.rows,
            rowsAffected: result.rowsAffected,
          };
        },
        async transaction<T>(fn: (tx: DbExec) => Promise<T>): Promise<T> {
          return retryOnConnectionError(async () => {
            let acquireTimedOut = false;
            const client = await withDbTimeout(
              "connect",
              () =>
                pool.connect().then((c) => {
                  if (acquireTimedOut) c.release();
                  return c;
                }),
              dbOpTimeoutMs(),
              () => {
                acquireTimedOut = true;
              },
            );
            let released = false;
            const releaseClient = (err?: Error | boolean) => {
              if (released) return;
              released = true;
              client.release(err);
            };
            const tx: DbExec = {
              execute: async (sql) => {
                if (!hasExplicitDbTimeout(sql)) {
                  return queryNeonClient(client, sql);
                }
                const { timeoutMs } = dbExecQueryBudget(sql);
                const startedAt = Date.now();
                const remainingMs = () =>
                  Math.max(1, timeoutMs - (Date.now() - startedAt));
                const statementTimeoutMs =
                  postgresStatementTimeoutMs(remainingMs());
                await queryNeonClient(
                  client,
                  `SET LOCAL statement_timeout = ${statementTimeoutMs}`,
                  remainingMs(),
                );
                return queryNeonClient(client, sql, remainingMs());
              },
            };
            try {
              await queryNeonClient(client, "BEGIN");
              const result = await fn(tx);
              await queryNeonClient(client, "COMMIT");
              releaseClient();
              return result;
            } catch (err) {
              let rollbackFailed = false;
              try {
                await queryNeonClient(client, "ROLLBACK");
              } catch {
                rollbackFailed = true;
              }
              // A failed rollback can leave the backend inside the transaction.
              // Do not return that client to PgBouncer as if it were clean.
              releaseClient(
                isConnectionError(err) || rollbackFailed ? true : undefined,
              );
              throw err;
            }
          }, 1);
        },
        async close() {
          if (trackSingletonResources) return closeSharedDbPools();
          await pool.end();
        },
      };
    }

    const { default: postgres } = await import("postgres");
    const isWorkers =
      "__cf_env" in globalThis ||
      (typeof navigator !== "undefined" &&
        navigator.userAgent === "Cloudflare-Workers");

    if (isWorkers) {
      // Workers: fresh connection per query — I/O can't be shared across requests
      return {
        async execute(sql) {
          const conn = postgres(url, {
            max: 1,
            idle_timeout: 0,
            onnotice: () => {},
          });
          let timedOut = false;
          try {
            const rawSql = typeof sql === "string" ? sql : sql.sql;
            const args = typeof sql === "string" ? [] : sql.args || [];
            const { timeoutMs } = dbExecQueryBudget(sql);
            const pgSql = sqliteToPostgresParams(rawSql);
            const result = await withDbTimeout<
              ArrayLike<unknown> & { count?: number }
            >(
              "query",
              () =>
                conn.unsafe(pgSql, args as any[]) as Promise<
                  ArrayLike<unknown> & { count?: number }
                >,
              timeoutMs,
              () => {
                timedOut = true;
                disposePostgresPoolEventually(conn, "timed-out worker query");
              },
            );
            return {
              rows: Array.from(result),
              rowsAffected: result.count ?? 0,
            };
          } finally {
            if (!timedOut) {
              await conn.end().catch((err: unknown) => {
                console.warn(
                  "[db/postgres] worker query cleanup failed:",
                  err instanceof Error ? err.message : err,
                );
              });
            }
          }
        },
        async transaction<T>(fn: (tx: DbExec) => Promise<T>): Promise<T> {
          const conn = postgres(url, {
            max: 1,
            idle_timeout: 0,
            onnotice: () => {},
          });
          try {
            const result = await conn.begin(async (txSql: any) => {
              const tx: DbExec = {
                async execute(sql) {
                  const { rawSql, args } = sqlAndArgs(sql);
                  const { timeoutMs } = dbExecQueryBudget(sql);
                  const pgSql = sqliteToPostgresParams(rawSql);
                  const result = await withDbTimeout<
                    ArrayLike<unknown> & { count?: number }
                  >(
                    "query",
                    () =>
                      txSql.unsafe(pgSql, args as any[]) as Promise<
                        ArrayLike<unknown> & { count?: number }
                      >,
                    timeoutMs,
                  );
                  return {
                    rows: Array.from(result),
                    rowsAffected: result.count ?? 0,
                  };
                },
              };
              return fn(tx);
            });
            return result as T;
          } finally {
            await conn.end().catch((err: unknown) => {
              console.warn(
                "[db/postgres] worker transaction cleanup failed:",
                err instanceof Error ? err.message : err,
              );
            });
          }
        },
      };
    } else {
      // Node.js: reuse connection pool. pgPoolOptions caps the pool to a
      // small size on serverless (Netlify/Vercel/Lambda/CF) so concurrent
      // frozen instances don't exhaust Neon/Postgres' connection limit;
      // idle_timeout also closes idle connections before Neon's ~5min
      // server-side timeout, avoiding ECONNRESET when the server hangs up.
      const createPool = () => postgres(url, pgPoolOptions(url));
      type PostgresPool = ReturnType<typeof createPool>;
      // Same rule as the Neon path: the singleton exec shares the process pool,
      // `createDbExec()` callers own a `close()` and get a private one.
      let pool = trackSingletonResources
        ? sharedDbPool("postgres-js", url, createPool)
        : createPool();
      const recyclePool = (timedOutPool: PostgresPool) => {
        if (pool === timedOutPool) {
          pool = createPool();
          if (trackSingletonResources) {
            replaceSharedDbPool("postgres-js", url, timedOutPool, pool);
          }
        }
        disposePostgresPoolEventually(timedOutPool, "timed-out pooled query");
      };

      return {
        async execute(sql) {
          const { rawSql, args } = sqlAndArgs(sql);
          const { timeoutMs, maxAttempts } = dbExecQueryBudget(sql);
          const pgSql = sqliteToPostgresParams(rawSql);
          const result = await retryOnConnectionError<
            ArrayLike<unknown> & { count?: number }
          >(() => {
            const queryPool = pool;
            const query = queryPool.unsafe(pgSql, args as any[]);
            return withDbTimeout(
              "query",
              () => query,
              timeoutMs,
              () => recyclePool(queryPool),
            );
          }, maxAttempts);
          return {
            rows: Array.from(result),
            rowsAffected: result.count ?? 0,
          };
        },
        async transaction<T>(fn: (tx: DbExec) => Promise<T>): Promise<T> {
          const result = await pool.begin(async (txSql: any) => {
            const tx: DbExec = {
              async execute(sql) {
                const { rawSql, args } = sqlAndArgs(sql);
                const { timeoutMs } = dbExecQueryBudget(sql);
                const pgSql = sqliteToPostgresParams(rawSql);
                const result = await withDbTimeout<
                  ArrayLike<unknown> & { count?: number }
                >(
                  "query",
                  () =>
                    txSql.unsafe(pgSql, args as any[]) as Promise<
                      ArrayLike<unknown> & { count?: number }
                    >,
                  timeoutMs,
                );
                return {
                  rows: Array.from(result),
                  rowsAffected: result.count ?? 0,
                };
              },
            };
            return fn(tx);
          });
          return result as T;
        },
        async close() {
          if (trackSingletonResources) return closeSharedDbPools();
          await pool.end();
        },
      };
    }
  }

  // SQLite / libsql (default). Local file databases use better-sqlite3 so
  // serverless bundles do not need libsql's platform-specific native package.
  if (isLocalSqliteUrl(url)) {
    url = await prepareLocalSqliteUrl(
      url.startsWith("file:") ? url : `file:${url}`,
    );
    const { default: Database } = await import("better-sqlite3");
    const sqlite = new Database(sqliteFilenameFromUrl(url));
    sqlite.pragma("busy_timeout = 10000");
    try {
      // Vite can start a replacement Nitro runtime while the previous instance
      // is still releasing app.db. The 10s busy_timeout can expire during that
      // handoff, so retry the idempotent WAL negotiation before declaring the
      // whole auth/database bootstrap failed.
      await retrySqliteBusy(async () => sqlite.pragma("journal_mode = WAL"), {
        rethrow: true,
      });
    } catch (error) {
      sqlite.close();
      throw error;
    }
    if (trackSingletonResources) _sqlite = sqlite;
    const execute: DbExec["execute"] = async (sql) => {
      const { rawSql, args } = sqlAndArgs(sql);
      const stmt = sqlite.prepare(rawSql);
      if (stmt.reader) {
        return {
          rows: stmt.all(...args),
          rowsAffected: 0,
        };
      }
      const result = stmt.run(...args);
      return {
        rows: [],
        rowsAffected: result.changes ?? 0,
      };
    };

    return {
      execute,
      transaction: explicitTransaction(execute, "BEGIN IMMEDIATE"),
      async close() {
        sqlite.close();
      },
    };
  }

  const { createClient } = await import("@libsql/client/web");
  const client = createClient({
    url,
    authToken: config.authToken,
  });
  const execute: DbExec["execute"] = async (sql) => {
    if (typeof sql === "string") {
      const r = await client.execute(sql);
      return {
        rows: r.rows as any[],
        rowsAffected: r.rowsAffected,
      };
    }
    const r = await client.execute({
      sql: sql.sql,
      args: sql.args as any[],
    });
    return {
      rows: r.rows as any[],
      rowsAffected: r.rowsAffected,
    };
  };

  return {
    execute,
    transaction: explicitTransaction(execute),
    async close() {
      client.close();
    },
  };
}

export async function createDbExec(config: DbExecConfig = {}): Promise<DbExec> {
  const exec = await createDbExecInternal(config, false);
  return guardSchemaMutations(exec);
}

function guardSchemaMutations(exec: DbExec): DbExec {
  const guarded: DbExec = {
    async execute(statement) {
      assertSchemaMutationAllowed(statement);
      return exec.execute(statement);
    },
  };
  if (exec.atomicBatch) {
    guarded.atomicBatch = async (statements) => {
      for (const statement of statements) {
        assertSchemaMutationAllowed(statement);
      }
      return exec.atomicBatch!(statements);
    };
  }
  if (exec.transaction) {
    guarded.transaction = (fn) =>
      exec.transaction!((tx) =>
        fn({
          ...tx,
          execute: async (statement) => {
            assertSchemaMutationAllowed(statement);
            return tx.execute(statement);
          },
        }),
      );
  }
  if (exec.close) guarded.close = () => exec.close!();
  return guarded;
}

async function initClient(): Promise<void> {
  if (_exec) return;

  const dialect = getDialect();
  const url = getDatabaseUrl("file:./data/app.db");
  _exec = await createDbExecInternal(
    {
      url,
      authToken: getDatabaseAuthToken(),
      d1Binding: dialect === "d1" ? getCloudflareD1Binding() : undefined,
    },
    true,
  );
}

/**
 * Get the singleton database client. Returns a `DbExec` whose first
 * `execute()` call lazily initializes the underlying driver.
 */
/**
 * Point a missing-table failure at the cause instead of the symptom.
 *
 * The driver reports `no such table: x` / `relation "x" does not exist` from
 * whichever query happened to touch it first, so the stack lands in an action
 * and reads as a bug in that action. The actual cause is almost always that no
 * migration ever created the table — a template with no `server/plugins/db.ts`
 * creates none, and core's own tables self-heal, so app tables are the only
 * ones that fail this way. Appends rather than replaces: `isDuplicateColumnError`
 * and friends match substrings of the driver's original text.
 */
export function annotateMissingTable(err: unknown, sql: unknown): unknown {
  if (!(err instanceof Error)) return err;
  const match =
    /no such table:?\s*["'`]?([\w.]+)/i.exec(err.message) ??
    /relation\s+["'`]?([\w.]+)["'`]?\s+does not exist/i.exec(err.message);
  if (!match) return err;
  if (err.message.includes("server/plugins/db.ts")) return err;
  const statement =
    typeof sql === "string" ? sql : (sql as { sql?: string })?.sql;
  err.message =
    `${err.message}\n` +
    `  [agent-native] Table "${match[1]}" does not exist. App tables are created by migrations in ` +
    `server/plugins/db.ts — check that the plugin exists and declares a migration for this table, ` +
    `then restart the dev server so it runs.` +
    (statement ? `\n  Statement: ${statement.slice(0, 200)}` : "");
  return err;
}

export function getDbExec(): DbExec {
  if (_exec) return _exec;

  // Sanitize args: replace undefined with null (libsql rejects undefined)
  function sanitize(
    sql: string | { sql: string; args?: unknown[] },
  ): string | { sql: string; args?: unknown[] } {
    if (typeof sql === "object" && sql.args) {
      return { ...sql, args: sql.args.map((a) => a ?? null) };
    }
    return sql;
  }

  async function execAnnotated(
    s: string | { sql: string; args?: unknown[] },
  ): ReturnType<DbExec["execute"]> {
    assertSchemaMutationAllowed(s);
    try {
      return await _exec!.execute(sanitize(s));
    } catch (err) {
      throw annotateMissingTable(err, s);
    }
  }

  // Return a proxy that lazy-inits on first call
  const proxy: DbExec = {
    async execute(sql) {
      assertSchemaMutationAllowed(sql);
      if (!_initPromise) _initPromise = initClient();
      try {
        await _initPromise;
      } catch (err) {
        // A failed/hung init must not poison the singleton for the life of
        // the process — drop it so the next call retries a fresh connection
        // instead of re-awaiting a permanently rejected/pending promise.
        _initPromise = undefined;
        _exec = undefined;
        throw err;
      }
      // After init, swap to a sanitizing wrapper around the real client
      const wrapper: DbExec = {
        execute: (s) => execAnnotated(s),
        atomicBatch: _exec!.atomicBatch
          ? async (statements) => {
              for (const statement of statements) {
                assertSchemaMutationAllowed(statement);
              }
              return _exec!.atomicBatch!(statements.map((s) => sanitize(s)));
            }
          : undefined,
        transaction: _exec!.transaction
          ? (fn) =>
              _exec!.transaction!((tx) =>
                fn({
                  execute: (s) => {
                    assertSchemaMutationAllowed(s);
                    return tx.execute(sanitize(s));
                  },
                  transaction: tx.transaction,
                }),
              )
          : undefined,
      };
      Object.assign(proxy, wrapper);
      return execAnnotated(sql);
    },
    async transaction(fn) {
      if (!_initPromise) _initPromise = initClient();
      try {
        await _initPromise;
      } catch (err) {
        _initPromise = undefined;
        _exec = undefined;
        throw err;
      }
      const wrapper: DbExec = {
        execute: (s) => execAnnotated(s),
        atomicBatch: _exec!.atomicBatch
          ? async (statements) => {
              for (const statement of statements) {
                assertSchemaMutationAllowed(statement);
              }
              return _exec!.atomicBatch!(statements.map((s) => sanitize(s)));
            }
          : undefined,
        transaction: _exec!.transaction
          ? (innerFn) =>
              _exec!.transaction!((tx) =>
                innerFn({
                  execute: (s) => {
                    assertSchemaMutationAllowed(s);
                    return tx.execute(sanitize(s));
                  },
                  transaction: tx.transaction,
                }),
              )
          : undefined,
      };
      Object.assign(proxy, wrapper);
      if (_exec!.transaction) {
        return _exec!.transaction((tx) =>
          fn({
            execute: (s) => {
              assertSchemaMutationAllowed(s);
              return tx.execute(sanitize(s));
            },
            transaction: tx.transaction,
          }),
        );
      }
      if (_exec!.atomicBatch) {
        throw new Error(
          "This database supports atomic batches, not interactive transactions.",
        );
      }
      return explicitTransaction(wrapper.execute)(fn);
    },
    async atomicBatch(statements) {
      for (const statement of statements) {
        assertSchemaMutationAllowed(statement);
      }
      if (!_initPromise) _initPromise = initClient();
      try {
        await _initPromise;
      } catch (err) {
        _initPromise = undefined;
        _exec = undefined;
        throw err;
      }
      if (!_exec!.atomicBatch) {
        throw new Error("This database does not support atomic batches.");
      }
      const batch = async (items: typeof statements) => {
        for (const item of items) {
          assertSchemaMutationAllowed(item);
        }
        return _exec!.atomicBatch!(items.map((item) => sanitize(item)));
      };
      Object.assign(proxy, { atomicBatch: batch });
      return batch(statements);
    },
  };
  return proxy;
}

/** Close the database connection (for scripts that need cleanup). */
export async function closeDbExec(): Promise<void> {
  // Both Postgres pools live in the shared registry, which also notifies the
  // Drizzle / Better Auth consumers bound to them.
  await closeSharedDbPools();
  if (_sqlite) {
    _sqlite.close();
    _sqlite = undefined;
  }
  await closePgliteClients();
  _exec = undefined;
  _initPromise = undefined;
}
