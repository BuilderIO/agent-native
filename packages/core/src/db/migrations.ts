import { createClient } from "@libsql/client";
import fs from "fs";
import path from "path";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export function runMigrations(
  migrations: Array<{ version: number; sql: string }>,
): NitroPluginDef {
  return async () => {
    try {
      const url = process.env.DATABASE_URL || "file:./data/app.db";
      const client = createClient({
        url,
        authToken: process.env.DATABASE_AUTH_TOKEN,
      });

      if (url.startsWith("file:")) {
        fs.mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
      }

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
      process.exit(1);
    }
  };
}
