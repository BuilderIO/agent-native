import { defineConfig, type Config } from "drizzle-kit";

export interface CreateDrizzleConfigOptions {
  /** Path to the Drizzle schema file. Defaults to `./server/db/schema.ts`. */
  schema?: string;
  /** Output directory for generated migrations. Defaults to `./server/db/migrations`. */
  out?: string;
  /**
   * Local SQLite file path used when `DATABASE_URL` is unset or points at SQLite.
   * Defaults to `./data/app.db`.
   */
  sqliteFile?: string;
}

/**
 * Create a dialect-detecting drizzle-kit config.
 *
 * Inspects `process.env.DATABASE_URL` and picks the right `dialect` +
 * `dbCredentials` for Postgres (Neon/Supabase), Turso/libsql, or local SQLite.
 * Falls back to `file:./data/app.db` when `DATABASE_URL` is unset so local dev
 * keeps working.
 *
 * Usage:
 * ```ts
 * import { createDrizzleConfig } from "@agent-native/core/db/drizzle-config";
 * export default createDrizzleConfig();
 * ```
 */
export function createDrizzleConfig(
  opts: CreateDrizzleConfigOptions = {},
): Config {
  const {
    schema = "./server/db/schema.ts",
    out = "./server/db/migrations",
    sqliteFile = "./data/app.db",
  } = opts;

  const url = process.env.DATABASE_URL || `file:${sqliteFile}`;
  const isPostgres =
    url.startsWith("postgres://") || url.startsWith("postgresql://");
  const isTurso = url.startsWith("libsql://") || url.startsWith("https://");

  return defineConfig({
    schema,
    out,
    dialect: isPostgres ? "postgresql" : isTurso ? "turso" : "sqlite",
    dbCredentials: isPostgres
      ? { url }
      : isTurso
        ? { url, authToken: process.env.DATABASE_AUTH_TOKEN! }
        : { url: sqliteFile },
  });
}
