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
// Singleton client — lazy-initialized on first execute() call
// ---------------------------------------------------------------------------

let _exec: DbExec | undefined;
let _pgPool: any;
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
      // Node.js: reuse connection pool
      _pgPool = postgres(url, {
        onnotice: () => {},
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
          const result = await pool.unsafe(pgSql, args as any[]);
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

  // Enable WAL mode for local SQLite to prevent SQLITE_BUSY errors
  // when multiple processes access the same database concurrently
  if (url.startsWith("file:") || url.endsWith(".db")) {
    try {
      await client.execute("PRAGMA journal_mode = WAL");
      await client.execute("PRAGMA busy_timeout = 5000");
    } catch {}
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
  _exec = undefined;
  _initPromise = undefined;
}
