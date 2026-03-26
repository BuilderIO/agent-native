import { getDbExec, getDialect, isPostgres } from "./client.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export function runMigrations(
  migrations: Array<{ version: number; sql: string }>,
): NitroPluginDef {
  return async () => {
    try {
      // Check for Cloudflare D1 binding
      const d1 = (globalThis as any).__cf_env?.DB;
      if (d1) {
        // Use D1 directly for migrations
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

      // Generic path — works for libsql, Postgres, and any DbExec backend
      const exec = getDbExec();

      const createTable = isPostgres()
        ? `CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY)`
        : `CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY)`;
      await exec.execute(createTable);

      const { rows } = await exec.execute(
        `SELECT MAX(version) as v FROM _migrations`,
      );
      const current = (rows[0]?.v as number) ?? 0;

      const insertSql = isPostgres()
        ? `INSERT INTO _migrations VALUES (?) ON CONFLICT DO NOTHING`
        : `INSERT OR IGNORE INTO _migrations VALUES (?)`;

      for (const m of migrations.filter((m) => m.version > current)) {
        await exec.execute(m.sql);
        await exec.execute({ sql: insertSql, args: [m.version] });
      }
    } catch (err) {
      console.error("[db] Migration failed:", err);
      // Don't exit on edge runtimes — process.exit kills the Worker
      if (
        typeof globalThis.process?.exit === "function" &&
        !globalThis.navigator
      ) {
        process.exit(1);
      }
    }
  };
}
