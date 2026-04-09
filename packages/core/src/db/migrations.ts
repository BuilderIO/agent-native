import { getDbExec, isPostgres, getDialect } from "./client.js";

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

export function runMigrations(
  migrations: Array<{ version: number; sql: string }>,
): NitroPluginDef {
  return async () => {
    try {
      // Check for Cloudflare D1 binding (only if DATABASE_URL not set)
      const d1 =
        getDialect() === "d1" ? (globalThis as any).__cf_env?.DB : null;
      if (d1) {
        await d1
          .prepare(
            `CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY)`,
          )
          .run();
        const { results } = await d1
          .prepare(`SELECT MAX(version) as v FROM _migrations`)
          .first();
        const current = (results?.v as number) ?? 0;

        for (const m of migrations.filter((m) => m.version > current)) {
          try {
            await d1.batch([
              d1.prepare(m.sql),
              d1
                .prepare(`INSERT OR IGNORE INTO _migrations VALUES (?)`)
                .bind(m.version),
            ]);
            console.log(`[db] Applied migration v${m.version}`);
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

      await exec.execute(
        `CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY)`,
      );

      const { rows } = await exec.execute(
        `SELECT MAX(version) as v FROM _migrations`,
      );
      const current = (rows[0]?.v as number) ?? 0;

      const insertSql = pg
        ? `INSERT INTO _migrations VALUES (?) ON CONFLICT DO NOTHING`
        : `INSERT OR IGNORE INTO _migrations VALUES (?)`;

      const pending = migrations.filter((m) => m.version > current);
      if (pending.length > 0) {
        console.log(
          `[db] Applying ${pending.length} migration(s) on ${pg ? "Postgres" : "SQLite/libsql"}…`,
        );
      }

      for (const m of pending) {
        const sql = pg ? adaptSqlForPostgres(m.sql) : adaptSqlForSqlite(m.sql);
        try {
          await exec.execute(sql);
          await exec.execute({ sql: insertSql, args: [m.version] });
          console.log(`[db] Applied migration v${m.version}`);
        } catch (err) {
          console.error(
            `[db] Migration v${m.version} FAILED:`,
            (err as Error).message,
            "\nSQL:",
            sql,
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
