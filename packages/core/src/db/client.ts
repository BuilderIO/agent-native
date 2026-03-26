/**
 * Central database client abstraction.
 *
 * Detects the database backend from the environment (D1, Postgres, or SQLite/libsql)
 * and returns a unified `DbExec` interface that all core stores use.
 */
import fs from "fs";
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
// Dialect detection
// ---------------------------------------------------------------------------

let _dialect: Dialect | undefined;

export function getDialect(): Dialect {
  if (_dialect !== undefined) return _dialect;

  const d1 = (globalThis as any).__cf_env?.DB;
  if (d1) {
    _dialect = "d1";
    return _dialect;
  }

  const url = process.env.DATABASE_URL || "";
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    _dialect = "postgres";
  } else {
    _dialect = "sqlite";
  }
  return _dialect;
}

export function isPostgres(): boolean {
  return getDialect() === "postgres";
}

// ---------------------------------------------------------------------------
// Parameter conversion: ? -> $1, $2, $3
// ---------------------------------------------------------------------------

function sqliteToPostgresParams(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// ---------------------------------------------------------------------------
// Singleton client
// ---------------------------------------------------------------------------

let _exec: DbExec | undefined;
let _pgPool: any; // postgres() pool for cleanup

export function getDbExec(): DbExec {
  if (_exec) return _exec;

  const dialect = getDialect();

  // Cloudflare D1
  if (dialect === "d1") {
    const d1 = (globalThis as any).__cf_env?.DB;
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
    return _exec;
  }

  const url = process.env.DATABASE_URL || "file:./data/app.db";

  // Postgres
  if (dialect === "postgres") {
    // Dynamic require to avoid bundling postgres when not needed
    const postgres = require("postgres") as any;
    _pgPool = postgres(url);
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
    return _exec;
  }

  // SQLite / libsql (default)
  if (url.startsWith("file:")) {
    try {
      fs.mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
    } catch {
      // Edge runtime — no filesystem
    }
  }

  const { createClient } =
    require("@libsql/client") as typeof import("@libsql/client");
  const client = createClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });

  _exec = {
    async execute(sql) {
      if (typeof sql === "string") {
        const r = await client.execute(sql);
        return {
          rows: r.rows as any[],
          rowsAffected: r.rowsAffected,
        };
      }
      const r = await client.execute({ sql: sql.sql, args: sql.args as any[] });
      return {
        rows: r.rows as any[],
        rowsAffected: r.rowsAffected,
      };
    },
  };
  return _exec;
}

/** Close the database connection (for scripts that need cleanup). */
export async function closeDbExec(): Promise<void> {
  if (_pgPool) {
    await _pgPool.end();
    _pgPool = undefined;
  }
  _exec = undefined;
}
