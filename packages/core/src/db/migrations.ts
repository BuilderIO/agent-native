import { getDbExec, isPostgres } from "./client.js";

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

export function runMigrations(
  migrations: Array<{ version: number; sql: string }>,
): NitroPluginDef {
  return async () => {
    try {
      // Check for Cloudflare D1 binding
      const d1 = (globalThis as any).__cf_env?.DB;
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
          await d1.batch([
            d1.prepare(m.sql),
            d1
              .prepare(`INSERT OR IGNORE INTO _migrations VALUES (?)`)
              .bind(m.version),
          ]);
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

      for (const m of migrations.filter((m) => m.version > current)) {
        const sql = pg ? adaptSqlForPostgres(m.sql) : m.sql;
        await exec.execute(sql);
        await exec.execute({ sql: insertSql, args: [m.version] });
      }
    } catch (err) {
      console.error("[db] Migration failed:", err);
      if (
        typeof globalThis.process?.exit === "function" &&
        !globalThis.navigator
      ) {
        process.exit(1);
      }
    }
  };
}
