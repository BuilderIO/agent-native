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

const recyclingPostgresPools = new WeakSet<object>();
const loggedNeonPools = new WeakSet<object>();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Dialect = "sqlite" | "postgres" | "d1";

export interface DbExec {
  execute(
    sql: string | { sql: string; args?: unknown[] },
  ): Promise<{ rows: any[]; rowsAffected: number }>;
  transaction?<T>(fn: (tx: DbExec) => Promise<T>): Promise<T>;
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
  const url = getDatabaseUrl();
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

async function importOptionalModule(specifier: string): Promise<any> {
  return import(specifier);
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
  const dataDir = pgliteDataDirFromUrl(url);
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
  const dataDir = pgliteDataDirFromUrl(url);
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
export async function retrySqliteBusy<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; baseDelayMs?: number; rethrow?: boolean } = {},
): Promise<T> {
  const { maxAttempts = 5, baseDelayMs = 500, rethrow = false } = opts;
  let last: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      last = e;
      const msg = String(e?.message || e);
      if (msg.includes("SQLITE_BUSY") && attempt < maxAttempts - 1) {
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

  const d1 = globalThis.__cf_env?.DB;
  if (d1) {
    _dialect = "d1";
    return _dialect;
  }

  // Don't cache the fallthrough — on CF Workers, env bindings (__cf_env) aren't
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
      if (ch === "\\" && next) {
        out += next;
        i += 2;
        continue;
      }
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

function sqlAndArgs(sql: string | { sql: string; args?: unknown[] }): {
  rawSql: string;
  args: unknown[];
} {
  return typeof sql === "string"
    ? { rawSql: sql, args: [] }
    : { rawSql: sql.sql, args: sql.args || [] };
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
  return /ECONNRESET|ETIMEDOUT|EPIPE|connection.*(closed|ended|terminated)|socket hang up|websocket/i.test(
    msg,
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
      complete(value);
    };
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(err);
    };

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void (async () => {
        await runCleanup();
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
 * postgres.js pool options tuned per runtime. A serverless instance handles
 * one request at a time, so a tiny pool is enough — but we cap at 2 (not 1)
 * so a single slow query or open transaction can't serialize every other
 * query in the same request. Total connections stay bounded to ≈ 2×
 * concurrent-instance count instead of 10×. idle_timeout is shortened on
 * serverless so a thawed-but-idle instance releases its connections quickly.
 * Long-lived Node servers keep the normal pool for throughput.
 */
export function pgPoolOptions(url: string): Record<string, unknown> {
  const serverless = isServerlessRuntime();
  return {
    onnotice: () => {},
    max: serverless ? 2 : 10,
    idle_timeout: serverless ? 20 : 240,
    max_lifetime: 60 * 30,
    connect_timeout: 10,
    // Supabase's connection pooler (Transaction mode) requires prepare:false.
    // Only disable for Supabase URLs to avoid degrading other deployments.
    ...(url.includes("supabase") ? { prepare: false } : {}),
  };
}

/**
 * Connection cap for the @neondatabase/serverless `Pool`. Same instance
 * accumulation risk as postgres.js — a small pool (2) is enough on serverless
 * and keeps total connections bounded while still letting a second query
 * proceed when one connection is busy.
 */
export function neonPoolMax(): number {
  return isServerlessRuntime() ? 2 : 10;
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

export function attachNeonPoolErrorLogger(
  pool: unknown,
  label = "db/neon",
): void {
  if (!pool || typeof pool !== "object") return;
  if (loggedNeonPools.has(pool)) return;
  const withEvents = pool as {
    on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  };
  if (typeof withEvents.on !== "function") return;

  loggedNeonPools.add(pool);
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
let _pgPool: any;
let _neonPool: any;
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
      transaction: explicitTransaction(execute),
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
      const { Pool } = await import("@neondatabase/serverless");
      const pool = new Pool({ connectionString: url, max: neonPoolMax() });
      attachNeonPoolErrorLogger(pool);
      if (trackSingletonResources) _neonPool = pool;
      async function queryNeonClient(
        client: any,
        sql: Parameters<DbExec["execute"]>[0],
      ) {
        const { rawSql, args } = sqlAndArgs(sql);
        const pgSql = sqliteToPostgresParams(rawSql);
        const result = await withDbTimeout(
          "query",
          () =>
            client.query(pgSql, args as any[]) as Promise<{
              rows: unknown[];
              rowCount?: number;
            }>,
          dbOpTimeoutMs(),
        );
        return {
          rows: result.rows,
          rowsAffected: result.rowCount ?? 0,
        };
      }
      return {
        async execute(sql) {
          const result = await retryOnConnectionError<{
            rows: unknown[];
            rowsAffected: number;
          }>(async () => {
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

            try {
              const result = await queryNeonClient(client, sql);
              releaseClient();
              return result;
            } catch (err) {
              releaseClient(isConnectionError(err) ? true : undefined);
              throw err;
            }
          });
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
              execute: (sql) => queryNeonClient(client, sql),
            };
            try {
              await queryNeonClient(client, "BEGIN");
              const result = await fn(tx);
              await queryNeonClient(client, "COMMIT");
              releaseClient();
              return result;
            } catch (err) {
              await queryNeonClient(client, "ROLLBACK").catch(() => {});
              releaseClient(isConnectionError(err) ? true : undefined);
              throw err;
            }
          }, 1);
        },
        async close() {
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
            const pgSql = sqliteToPostgresParams(rawSql);
            const result = await withDbTimeout<
              ArrayLike<unknown> & { count?: number }
            >(
              "query",
              () =>
                conn.unsafe(pgSql, args as any[]) as Promise<
                  ArrayLike<unknown> & { count?: number }
                >,
              dbOpTimeoutMs(),
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
                  const pgSql = sqliteToPostgresParams(rawSql);
                  const result = await withDbTimeout<
                    ArrayLike<unknown> & { count?: number }
                  >(
                    "query",
                    () =>
                      txSql.unsafe(pgSql, args as any[]) as Promise<
                        ArrayLike<unknown> & { count?: number }
                      >,
                    dbOpTimeoutMs(),
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
      let pool = createPool();
      if (trackSingletonResources) _pgPool = pool;
      const recyclePool = (timedOutPool: PostgresPool) => {
        if (pool === timedOutPool) {
          pool = createPool();
          if (trackSingletonResources) _pgPool = pool;
        }
        disposePostgresPoolEventually(timedOutPool, "timed-out pooled query");
      };

      return {
        async execute(sql) {
          const { rawSql, args } = sqlAndArgs(sql);
          const pgSql = sqliteToPostgresParams(rawSql);
          const result = await retryOnConnectionError<
            ArrayLike<unknown> & { count?: number }
          >(() => {
            const queryPool = pool;
            const query = queryPool.unsafe(pgSql, args as any[]);
            return withDbTimeout(
              "query",
              () => query,
              dbOpTimeoutMs(),
              () => recyclePool(queryPool),
            );
          });
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
                const pgSql = sqliteToPostgresParams(rawSql);
                const result = await withDbTimeout<
                  ArrayLike<unknown> & { count?: number }
                >(
                  "query",
                  () =>
                    txSql.unsafe(pgSql, args as any[]) as Promise<
                      ArrayLike<unknown> & { count?: number }
                    >,
                  dbOpTimeoutMs(),
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
    sqlite.pragma("journal_mode = WAL");
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
  return createDbExecInternal(config, false);
}

async function initClient(): Promise<void> {
  if (_exec) return;

  const dialect = getDialect();
  const url = getDatabaseUrl("file:./data/app.db");
  _exec = await createDbExecInternal(
    {
      url,
      authToken: getDatabaseAuthToken(),
      d1Binding: dialect === "d1" ? globalThis.__cf_env?.DB : undefined,
    },
    true,
  );
}

/**
 * Get the singleton database client. Returns a `DbExec` whose first
 * `execute()` call lazily initializes the underlying driver.
 */
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

  // Return a proxy that lazy-inits on first call
  const proxy: DbExec = {
    async execute(sql) {
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
        execute: (s) => _exec!.execute(sanitize(s)),
        transaction: _exec!.transaction
          ? (fn) =>
              _exec!.transaction!((tx) =>
                fn({
                  execute: (s) => tx.execute(sanitize(s)),
                  transaction: tx.transaction,
                }),
              )
          : undefined,
      };
      Object.assign(proxy, wrapper);
      return _exec!.execute(sanitize(sql));
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
        execute: (s) => _exec!.execute(sanitize(s)),
        transaction: _exec!.transaction
          ? (innerFn) =>
              _exec!.transaction!((tx) =>
                innerFn({
                  execute: (s) => tx.execute(sanitize(s)),
                  transaction: tx.transaction,
                }),
              )
          : undefined,
      };
      Object.assign(proxy, wrapper);
      if (_exec!.transaction) {
        return _exec!.transaction((tx) =>
          fn({
            execute: (s) => tx.execute(sanitize(s)),
            transaction: tx.transaction,
          }),
        );
      }
      return explicitTransaction(wrapper.execute)(fn);
    },
  };
  return proxy;
}

/** Close the database connection (for scripts that need cleanup). */
export async function closeDbExec(): Promise<void> {
  if (_pgPool) {
    await _pgPool.end();
    _pgPool = undefined;
  }
  if (_neonPool) {
    await _neonPool.end();
    _neonPool = undefined;
  }
  if (_sqlite) {
    _sqlite.close();
    _sqlite = undefined;
  }
  await closePgliteClients();
  _exec = undefined;
  _initPromise = undefined;
}
