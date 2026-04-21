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
  // URI schemes are case-insensitive per RFC 3986; normalize before matching.
  const scheme = url.toLowerCase();
  const isPostgres =
    scheme.startsWith("postgres://") || scheme.startsWith("postgresql://");
  // Only `libsql://` matches Turso. Plain `https://` is too broad — Turso's
  // HTTP endpoint is reachable via libsql:// in drizzle-kit, and a generic
  // https:// URL is far more likely to be a custom Postgres endpoint.
  const isTurso = scheme.startsWith("libsql://");

  if (isTurso && !envAuthToken) {
    throw new Error(
      "createDrizzleConfig: DATABASE_URL is a libsql:// URL but DATABASE_AUTH_TOKEN " +
        "is not set. Set DATABASE_AUTH_TOKEN (or <APP_NAME>_DATABASE_AUTH_TOKEN) so " +
        "drizzle-kit can authenticate against Turso.",
    );
  }

  // For SQLite, drizzle-kit wants a filesystem path, not a URL. Strip the
  // `file:` scheme if the user passed one via DATABASE_URL, else fall back
  // to the explicit sqliteFile option.
  const sqlitePath = scheme.startsWith("file:")
    ? url.slice("file:".length)
    : sqliteFile;

  return defineConfig({
    schema,
    out,
    dialect: isPostgres ? "postgresql" : isTurso ? "turso" : "sqlite",
    dbCredentials: isPostgres
      ? { url }
      : isTurso
        ? { url, authToken: envAuthToken as string }
        : { url: sqlitePath },
  });
}
