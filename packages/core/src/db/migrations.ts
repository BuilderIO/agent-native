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

const IF_NOT_EXISTS_ADD_COLUMN_RE = /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/i;

/**
 * Strip Postgres-only syntax that SQLite doesn't support.
 * Handles: ALTER TABLE ... ADD COLUMN IF NOT EXISTS → ADD COLUMN
 *
 * Note: SQLite does not have a native equivalent, so the idempotent
 * semantic is emulated at the executor level by swallowing the
 * "duplicate column name" error for statements that originally carried
 * the clause. See `hadIfNotExists` tracking in the run loop.
 */
function adaptSqlForSqlite(sql: string): string {
  return sql.replace(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/gi, "ADD COLUMN");
}

function isDuplicateColumnError(err: unknown): boolean {
  const msg = (err as Error | undefined)?.message ?? "";
  return /duplicate column name/i.test(msg);
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

/**
 * A single migration entry.
 *
 * `sql` can be a string (runs on every dialect) or an object with dialect
 * keys for dialect-gated SQL. Useful when Postgres needs an ALTER that
 * SQLite can't parse.
 *
 *   { version: 14, sql: { postgres: "ALTER TABLE …" } }  // no-op on sqlite
 *   { version: 15, sql: { sqlite: "…", postgres: "…" } } // both dialects
 */
export type MigrationSql = string | { postgres?: string; sqlite?: string };

export interface MigrationEntry {
  version: number;
  sql: MigrationSql;
}

function resolveMigrationSql(sql: MigrationSql, pg: boolean): string | null {
  if (typeof sql === "string") return sql;
  const raw = pg ? sql.postgres : sql.sqlite;
  return raw ?? null;
}

export function runMigrations(
  migrations: Array<MigrationEntry>,
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
            // D1 is SQLite-compatible
            const raw = resolveMigrationSql(m.sql, false);
            if (raw == null) {
              await d1
                .prepare(`INSERT OR IGNORE INTO ${table} VALUES (?)`)
                .bind(m.version)
                .run();
              continue;
            }
            const originalStatements = splitSqlStatements(raw);
            const statements = originalStatements.map((orig) => ({
              sql: adaptSqlForSqlite(orig),
              hadIfNotExists: IF_NOT_EXISTS_ADD_COLUMN_RE.test(orig),
            }));
            const hasIfNotExists = statements.some((s) => s.hadIfNotExists);
            if (hasIfNotExists) {
              // Per-statement path: we need to swallow "duplicate column"
              // errors for statements that originally carried
              // `ADD COLUMN IF NOT EXISTS`, which a batch() can't express.
              // Loses atomicity, but the idempotent-ADD-COLUMN semantic
              // means a partial re-run resolves cleanly on retry.
              for (const { sql: stmt, hadIfNotExists } of statements) {
                try {
                  await d1.prepare(stmt).run();
                } catch (err) {
                  if (hadIfNotExists && isDuplicateColumnError(err)) continue;
                  throw err;
                }
              }
              await d1
                .prepare(`INSERT OR IGNORE INTO ${table} VALUES (?)`)
                .bind(m.version)
                .run();
            } else {
              // Atomic batch: all statements + version-row insert land in
              // the same transaction. A failing statement rolls the whole
              // migration back, so we never record a half-applied version.
              await d1.batch([
                ...statements.map((s) => d1.prepare(s.sql)),
                d1
                  .prepare(`INSERT OR IGNORE INTO ${table} VALUES (?)`)
                  .bind(m.version),
              ]);
            }
            console.log(
              `[db] Applied migration v${m.version} (${statements.length} statement${statements.length === 1 ? "" : "s"})`,
            );
          } catch (err) {
            console.error(
              `[db] Migration v${m.version} FAILED:`,
              (err as Error).message,
              "\nSQL:",
              JSON.stringify(m.sql),
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
        const raw = resolveMigrationSql(m.sql, pg);
        if (raw == null) {
          // Dialect-gated migration with no SQL for this dialect; still mark
          // as applied so we don't retry forever.
          await exec.execute({ sql: insertSql, args: [m.version] });
          continue;
        }
        // Split BEFORE adapting so we can remember which original statements
        // carried `ADD COLUMN IF NOT EXISTS` — SQLite drops the clause, so we
        // emulate the idempotent semantic by swallowing duplicate-column
        // errors only for those statements.
        const originalStatements = splitSqlStatements(raw);
        const statements = originalStatements.map((orig) => ({
          sql: pg ? adaptSqlForPostgres(orig) : adaptSqlForSqlite(orig),
          hadIfNotExists: IF_NOT_EXISTS_ADD_COLUMN_RE.test(orig),
        }));
        let currentStmt = "";
        try {
          for (const { sql: stmt, hadIfNotExists } of statements) {
            currentStmt = stmt;
            try {
              await exec.execute(stmt);
            } catch (err) {
              if (!pg && hadIfNotExists && isDuplicateColumnError(err)) {
                // IF NOT EXISTS semantic: column already present, skip.
                continue;
              }
              throw err;
            }
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
      // In local dev, hard-fail so the developer catches errors immediately.
      // On serverless runtimes (Netlify Functions, Vercel, CF Workers) we
      // keep the process alive — the app will return 500s for routes that
      // depend on the missing tables, but at least other routes still work.
      // Note: Node.js 21+ defines globalThis.navigator, so we check for
      // serverless env vars instead of navigator presence.
      const isServerless =
        !!globalThis.process?.env?.NETLIFY ||
        !!globalThis.process?.env?.AWS_LAMBDA_FUNCTION_NAME ||
        !!globalThis.process?.env?.VERCEL ||
        "__cf_env" in globalThis;
      if (typeof globalThis.process?.exit === "function" && !isServerless) {
        process.exit(1);
      }
    }
  };
}
