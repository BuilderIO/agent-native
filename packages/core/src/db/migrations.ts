import { createClient } from "@libsql/client";
import fs from "fs";
import path from "path";

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

      // Fall back to libsql
      const url = process.env.DATABASE_URL || "file:./data/app.db";

      if (url.startsWith("file:")) {
        try {
          fs.mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
        } catch {
          // Edge runtime — no filesystem
        }
      }

      const client = createClient({
        url,
        authToken: process.env.DATABASE_AUTH_TOKEN,
      });

      await client.execute(
        `CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY)`,
      );
      const { rows } = await client.execute(
        `SELECT MAX(version) as v FROM _migrations`,
      );
      const current = (rows[0]?.v as number) ?? 0;

      for (const m of migrations.filter((m) => m.version > current)) {
        await client.batch([
          { sql: m.sql, args: [] },
          {
            sql: `INSERT OR IGNORE INTO _migrations VALUES (?)`,
            args: [m.version],
          },
        ]);
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
