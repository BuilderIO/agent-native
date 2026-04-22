/**
 * Central database client abstraction.
 *
 * Detects the database backend from the environment (D1, Postgres, or SQLite/libsql)
 * and returns a unified `DbExec` interface that all core stores use.
 *
 * Imports for postgres and @libsql/client are lazy (dynamic import) so this
 * module can be loaded in any runtime (Node.js, Cloudflare Workers, edge)
 * without failing on missing native deps.
 */
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Dialect = "sqlite" | "postgres" | "d1";

export interface DbExec {
  execute(
    sql: string | { sql: string; args: any[] },
  ): Promise<{ rows: any[]; rowsAffected: number }>;
}

// ---------------------------------------------------------------------------
// Per-app DATABASE_URL resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the database URL for the current app.
 *
 * Checks for `<APP_NAME>_DATABASE_URL` first (e.g. `MAIL_DATABASE_URL`),
 * then falls back to `DATABASE_URL`. This allows multiple apps to run in the
 * same process group (e.g. `dev:all` or builder.io) with separate databases.
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
  return process.env.DATABASE_URL || fallback;
}

/** Same per-app resolution for DATABASE_AUTH_TOKEN (used by Turso/libsql). */
export function getDatabaseAuthToken(): string | undefined {
  const appName = process.env.APP_NAME?.toUpperCase().replace(/-/g, "_");
  if (appName) {
    const prefixed = process.env[`${appName}_DATABASE_AUTH_TOKEN`];
    if (prefixed) return prefixed;
  }
  return process.env.DATABASE_AUTH_TOKEN;
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
 * with code 23505 on `pg_type_typname_nsp_index` or similar. The table does
 * end up created by the winner, so rerunning the same `IF NOT EXISTS`
 * statement is a safe no-op.
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
  if (e?.code !== "23505") return false;
  const constraint = String(e?.constraint_name ?? e?.constraint ?? "");
  const detail = String(e?.detail ?? "");
  return (
    constraint.startsWith("pg_type") ||
    constraint.startsWith("pg_class") ||
    detail.includes("pg_type") ||
    detail.includes("pg_class")
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
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
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
  if (getDialect() !== "sqlite") return false;
  const url = getDatabaseUrl();
  return url === "" || url.startsWith("file:");
}

/** Returns BIGINT for Postgres (64-bit), INTEGER for SQLite (already 64-bit). */
export function intType(): string {
  return isPostgres() ? "BIGINT" : "INTEGER";
}

// ---------------------------------------------------------------------------
// Parameter conversion: ? -> $1, $2, $3
// ---------------------------------------------------------------------------

function sqliteToPostgresParams(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
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
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "CONNECTION_CLOSED",
]);

export function isConnectionError(err: any): boolean {
  if (!err) return false;
  const code = err.code || err.cause?.code;
  if (code && CONNECTION_ERROR_CODES.has(code)) return true;
  const msg = String(err.message || err.cause?.message || "");
  return /ECONNRESET|ETIMEDOUT|EPIPE|connection.*(closed|ended|terminated)/i.test(
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
// Singleton client — lazy-initialized on first execute() call
// ---------------------------------------------------------------------------

let _exec: DbExec | undefined;
let _pgPool: any;
let _neonPool: any;
let _initPromise: Promise<void> | undefined;

async function initClient(): Promise<void> {
  if (_exec) return;

  const dialect = getDialect();

  // Cloudflare D1
  if (dialect === "d1") {
    const d1 = globalThis.__cf_env?.DB;
    _exec = {
      async execute(sql) {
        if (typeof sql === "string") {
          const r = await d1.prepare(sql).all();
          return {
            rows: r.results || [],
            rowsAffected: r.meta?.changes ?? 0,
          };
        }
        const r = await d1
          .prepare(sql.sql)
          .bind(...sql.args)
          .all();
        return { rows: r.results || [], rowsAffected: r.meta?.changes ?? 0 };
      },
    };
    return;
  }

  const url = getDatabaseUrl("file:./data/app.db");

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
      _neonPool = new Pool({ connectionString: url });
      const pool = _neonPool;
      _exec = {
        async execute(sql) {
          const rawSql = typeof sql === "string" ? sql : sql.sql;
          const args = typeof sql === "string" ? [] : sql.args || [];
          const pgSql = sqliteToPostgresParams(rawSql);
          const result = await retryOnConnectionError<{
            rows: unknown[];
            rowCount?: number;
          }>(() => pool.query(pgSql, args as any[]));
          return {
            rows: result.rows,
            rowsAffected: result.rowCount ?? 0,
          };
        },
      };
      return;
    }

    const { default: postgres } = await import("postgres");
    const isWorkers =
      "__cf_env" in globalThis ||
      (typeof navigator !== "undefined" &&
        navigator.userAgent === "Cloudflare-Workers");

    if (isWorkers) {
      // Workers: fresh connection per query — I/O can't be shared across requests
      _exec = {
        async execute(sql) {
          const conn = postgres(url, {
            max: 1,
            idle_timeout: 0,
            onnotice: () => {},
          });
          try {
            const rawSql = typeof sql === "string" ? sql : sql.sql;
            const args = typeof sql === "string" ? [] : sql.args || [];
            const pgSql = sqliteToPostgresParams(rawSql);
            const result = await conn.unsafe(pgSql, args as any[]);
            return {
              rows: Array.from(result),
              rowsAffected: result.count ?? 0,
            };
          } finally {
            await conn.end();
          }
        },
      };
    } else {
      // Node.js: reuse connection pool.
      // idle_timeout:240 closes idle connections before Neon's ~5min server-side
      // timeout, avoiding ECONNRESET when the server hangs up on us.
      _pgPool = postgres(url, {
        onnotice: () => {},
        idle_timeout: 240,
        max_lifetime: 60 * 30,
        connect_timeout: 10,
        // Supabase's connection pooler (Transaction mode) requires prepare: false.
        // Only disable for Supabase URLs to avoid degrading other Postgres deployments.
        ...(url.includes("supabase") ? { prepare: false } : {}),
      });
      const pool = _pgPool;

      _exec = {
        async execute(sql) {
          const rawSql = typeof sql === "string" ? sql : sql.sql;
          const args = typeof sql === "string" ? [] : sql.args || [];
          const pgSql = sqliteToPostgresParams(rawSql);
          const result = await retryOnConnectionError<
            ArrayLike<unknown> & { count?: number }
          >(() => pool.unsafe(pgSql, args as any[]));
          return {
            rows: Array.from(result),
            rowsAffected: result.count ?? 0,
          };
        },
      };
    }
    return;
  }

  // SQLite / libsql (default)
  if (url.startsWith("file:")) {
    try {
      const fs = await import("fs");
      fs.mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
    } catch {
      // Edge runtime — no filesystem
    }
  }

  const { createClient } = await import("@libsql/client");
  const client = createClient({
    url,
    authToken: getDatabaseAuthToken(),
  });

  // Enable WAL mode and set busy timeout for local SQLite.
  // Retries handle SQLITE_BUSY_RECOVERY (stale WAL from a previous crash/HMR restart).
  if (url.startsWith("file:") || url.endsWith(".db")) {
    await retrySqliteBusy(async () => {
      await client.execute("PRAGMA busy_timeout = 10000");
      await client.execute("PRAGMA journal_mode = WAL");
    });
  }

  _exec = {
    async execute(sql) {
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
    },
  };
}

/**
 * Get the singleton database client. Returns a `DbExec` whose first
 * `execute()` call lazily initializes the underlying driver.
 */
export function getDbExec(): DbExec {
  if (_exec) return _exec;

  // Sanitize args: replace undefined with null (libsql rejects undefined)
  function sanitize(
    sql: string | { sql: string; args: any[] },
  ): string | { sql: string; args: any[] } {
    if (typeof sql === "object" && sql.args) {
      return { ...sql, args: sql.args.map((a: any) => a ?? null) };
    }
    return sql;
  }

  // Return a proxy that lazy-inits on first call
  const proxy: DbExec = {
    async execute(sql) {
      if (!_initPromise) _initPromise = initClient();
      await _initPromise;
      // After init, swap to a sanitizing wrapper around the real client
      const wrapper: DbExec = {
        execute: (s) => _exec!.execute(sanitize(s)),
      };
      Object.assign(proxy, wrapper);
      return _exec!.execute(sanitize(sql));
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
  _exec = undefined;
  _initPromise = undefined;
}
