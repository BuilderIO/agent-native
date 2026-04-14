import {
  getDbExec,
  isPostgres,
  getDialect,
  retrySqliteBusy,
} from "./client.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

/**
 * Rewrite SQLite-specific SQL to Postgres-compatible equivalents.
 * Handles: datetime('now') → CURRENT_TIMESTAMP, AUTOINCREMENT → GENERATED, etc.
 */
function adaptSqlForPostgres(sql: string): string {
  return sql
    .replace(/datetime\s*\(\s*'now'\s*\)/gi, "CURRENT_TIMESTAMP")
    .replace(/\bAUTOINCREMENT\b/gi, "")
    .replace(/\bINTEGER\b/gi, "BIGINT");
}

/**
 * Strip Postgres-only syntax that SQLite doesn't support.
 * Handles: ALTER TABLE ... ADD COLUMN IF NOT EXISTS → ADD COLUMN
 */
function adaptSqlForSqlite(sql: string): string {
  return sql.replace(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/gi, "ADD COLUMN");
}

/**
 * Split a multi-statement SQL blob into individual statements.
 *
 * libsql's `execute(sql)` only runs the first statement in a multi-statement
 * string. This splitter is intentionally simple: it respects single-quoted
 * string literals (with `''` escaping) and `--` line comments, and splits on
 * top-level `;`. It does NOT attempt to parse `$$`-quoted Postgres function
 * bodies — migrations that define functions/triggers with `;` inside bodies
 * should pass a single-statement migration per entry instead.
 */
function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  let inSingle = false;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (!inSingle && ch === "-" && next === "-") {
      // Skip to end of line
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "'") {
      buf += ch;
      if (inSingle && next === "'") {
        buf += next;
        i += 2;
        continue;
      }
      inSingle = !inSingle;
      i++;
      continue;
    }
    if (ch === ";" && !inSingle) {
      const trimmed = buf.trim();
      if (trimmed) out.push(trimmed);
      buf = "";
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

export interface RunMigrationsOptions {
  /**
   * Name of the migrations bookkeeping table. Defaults to `_migrations` for
   * template-owned migrations. Core feature plugins (e.g. the org module) pass
   * their own table name to keep their version space separate from templates.
   */
  table?: string;
}

export function runMigrations(
  migrations: Array<{ version: number; sql: string }>,
  options: RunMigrationsOptions = {},
): NitroPluginDef {
  const table = options.table ?? "_migrations";
  return async () => {
    try {
      // Check for Cloudflare D1 binding (only if DATABASE_URL not set)
      const d1 = getDialect() === "d1" ? globalThis.__cf_env?.DB : null;
      if (d1) {
        await d1
          .prepare(
            `CREATE TABLE IF NOT EXISTS ${table} (version INTEGER PRIMARY KEY)`,
          )
          .run();
        const firstRow = await d1
          .prepare(`SELECT MAX(version) as v FROM ${table}`)
          .first<{ v?: number }>();
        const current = (firstRow?.v as number) ?? 0;

        for (const m of migrations.filter((m) => m.version > current)) {
          try {
            const statements = splitSqlStatements(m.sql);
            await d1.batch([
              ...statements.map((s: string) => d1.prepare(s)),
              d1
                .prepare(`INSERT OR IGNORE INTO ${table} VALUES (?)`)
                .bind(m.version),
            ]);
            console.log(
              `[db] Applied migration v${m.version} (${statements.length} statement${statements.length === 1 ? "" : "s"})`,
            );
          } catch (err) {
            console.error(
              `[db] Migration v${m.version} FAILED:`,
              (err as Error).message,
              "\nSQL:",
              m.sql,
            );
            throw err;
          }
        }
        return;
      }

      // Generic path — works for libsql and Postgres
      const exec = getDbExec();
      const pg = isPostgres();

      // Retry initial table creation — SQLITE_BUSY_RECOVERY can occur on HMR
      // restarts when WAL files from the previous process haven't been released yet.
      await retrySqliteBusy(
        () =>
          exec.execute(
            `CREATE TABLE IF NOT EXISTS ${table} (version INTEGER PRIMARY KEY)`,
          ),
        { maxAttempts: 6, baseDelayMs: 1000, rethrow: true },
      );

      const { rows } = await exec.execute(
        `SELECT MAX(version) as v FROM ${table}`,
      );
      const current = (rows[0]?.v as number) ?? 0;

      const insertSql = pg
        ? `INSERT INTO ${table} VALUES (?) ON CONFLICT DO NOTHING`
        : `INSERT OR IGNORE INTO ${table} VALUES (?)`;

      const pending = migrations.filter((m) => m.version > current);
      if (pending.length > 0) {
        console.log(
          `[db] Applying ${pending.length} migration(s) on ${pg ? "Postgres" : "SQLite/libsql"}…`,
        );
      }

      for (const m of pending) {
        const sql = pg ? adaptSqlForPostgres(m.sql) : adaptSqlForSqlite(m.sql);
        const statements = splitSqlStatements(sql);
        let currentStmt = "";
        try {
          for (const stmt of statements) {
            currentStmt = stmt;
            await exec.execute(stmt);
          }
          await exec.execute({ sql: insertSql, args: [m.version] });
          console.log(
            `[db] Applied migration v${m.version} (${statements.length} statement${statements.length === 1 ? "" : "s"})`,
          );
        } catch (err) {
          console.error(
            `[db] Migration v${m.version} FAILED:`,
            (err as Error).message,
            "\nStatement:",
            currentStmt,
          );
          throw err;
        }
      }
    } catch (err) {
      console.error("[db] Migration failed:", (err as Error).message);
      // In Node.js, hard-fail so dev catches errors immediately. On web
      // runtimes (Cloudflare Workers, Netlify Functions) we keep the
      // process alive — the app will return 500s for routes that depend
      // on the missing tables, but at least other routes still work.
      if (
        typeof globalThis.process?.exit === "function" &&
        !globalThis.navigator
      ) {
        process.exit(1);
      }
    }
  };
}
