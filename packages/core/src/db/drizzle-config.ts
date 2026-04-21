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

  // Mirror getDatabaseUrl / getDatabaseAuthToken from @agent-native/core (db/client)
  // without importing — drizzle-kit configs should stay side-effect-free.
  const appName = process.env.APP_NAME?.toUpperCase().replace(/-/g, "_");
  const envUrl =
    (appName && process.env[`${appName}_DATABASE_URL`]) ||
    process.env.DATABASE_URL ||
    "";
  const envAuthToken =
    (appName && process.env[`${appName}_DATABASE_AUTH_TOKEN`]) ||
    process.env.DATABASE_AUTH_TOKEN;

  const url = envUrl || `file:${sqliteFile}`;
  const isPostgres =
    url.startsWith("postgres://") || url.startsWith("postgresql://");
  const isTurso = url.startsWith("libsql://") || url.startsWith("https://");

  // For SQLite, drizzle-kit wants a filesystem path, not a URL. Strip the
  // `file:` scheme if the user passed one via DATABASE_URL, else fall back
  // to the explicit sqliteFile option.
  const sqlitePath = envUrl.startsWith("file:")
    ? envUrl.slice("file:".length)
    : sqliteFile;

  return defineConfig({
    schema,
    out,
    dialect: isPostgres ? "postgresql" : isTurso ? "turso" : "sqlite",
    dbCredentials: isPostgres
      ? { url }
      : isTurso
        ? { url, authToken: envAuthToken! }
        : { url: sqlitePath },
  });
}
