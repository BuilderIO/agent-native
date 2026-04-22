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
 * Detect whether the current process was invoked as `drizzle-kit push`.
 *
 * drizzle-kit launches its subcommands as separate CLI args, so `push` shows
 * up as an argv entry. We also check `npm_lifecycle_event` / `npm_lifecycle_script`
 * so a script like `"db:push": "drizzle-kit push"` is recognised even when the
 * subcommand is baked into the npm script rather than passed explicitly.
 */
function isDrizzlePushInvocation(): boolean {
  const argv = process.argv.map((a) => a.toLowerCase());
  const joined = argv.join(" ");
  if (/\bdrizzle-kit\b/.test(joined) && /\bpush\b/.test(joined)) return true;
  // When run via `drizzle-kit push`, argv[1] is the drizzle-kit bin and
  // argv[2] is "push". Also handle `pnpm exec drizzle-kit push` where the
  // launcher strips the bin name.
  if (argv.some((a) => a.endsWith("/drizzle-kit") || a === "drizzle-kit")) {
    if (argv.includes("push")) return true;
  }
  const lifecycleScript = (
    process.env.npm_lifecycle_script ||
    process.env.npm_lifecycle_event ||
    ""
  ).toLowerCase();
  if (/\bdrizzle-kit\s+push\b/.test(lifecycleScript)) return true;
  return false;
}

/** A Neon database URL — we refuse to let drizzle-kit push touch these. */
function isNeonUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes("neon.tech") || lower.includes(".neon.tech");
}

/**
 * Create a dialect-detecting drizzle-kit config.
 *
 * Inspects `process.env.DATABASE_URL` and picks the right `dialect` +
 * `dbCredentials` for Postgres (Neon/Supabase), Turso/libsql, or local SQLite.
 * Falls back to `file:./data/app.db` when `DATABASE_URL` is unset so local dev
 * keeps working.
 *
 * Additionally refuses to run when invoked via `drizzle-kit push` against a
 * Neon DATABASE_URL — that invocation pattern dropped framework tables in
 * production on 2026-04-21 (see PR #252). Set `ALLOW_DRIZZLE_PUSH_ON_NEON=1`
 * to override (never do this in CI).
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

  // ---------------------------------------------------------------------
  // Runtime refusal: block `drizzle-kit push` against a Neon database.
  //
  // On 2026-04-21, a `drizzle-kit push --force` call was wired into every
  // template's netlify.toml build. Each template's schema only defines
  // its domain tables, so push dropped framework tables (user, session,
  // account, organization, application_state, settings) in production.
  //
  // CI has a separate grep-based guard (scripts/guard-no-drizzle-push.mjs)
  // that catches these before merge. This is the last-line runtime defense.
  // Set `ALLOW_DRIZZLE_PUSH_ON_NEON=1` to override (never do this in CI).
  // ---------------------------------------------------------------------
  if (
    envUrl &&
    isNeonUrl(envUrl) &&
    isDrizzlePushInvocation() &&
    process.env.ALLOW_DRIZZLE_PUSH_ON_NEON !== "1"
  ) {
    throw new Error(
      [
        "Refusing to run `drizzle-kit push` against a Neon database.",
        "",
        "Template schemas only define domain tables — running push against",
        "a shared Neon DB will drop framework tables (user, session,",
        "account, organization, application_state, settings) because they",
        "are not in the template's schema.ts.",
        "",
        "Use `runMigrations()` in `server/plugins/db.ts` instead (additive",
        "SQL only). See CLAUDE.md / AGENTS.md 'No breaking database",
        "changes' rule and scripts/guard-no-drizzle-push.mjs.",
        "",
        "Detected DATABASE_URL host: " +
          (() => {
            try {
              return new URL(envUrl).host;
            } catch {
              return "(unparseable)";
            }
          })(),
      ].join("\n"),
    );
  }

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
