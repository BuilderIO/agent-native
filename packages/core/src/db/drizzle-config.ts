import { defineConfig, type Config } from "drizzle-kit";

export interface CreateDrizzleConfigOptions {
  /** Path to the Drizzle schema file. Defaults to `./server/db/schema.ts`. */
  schema?: string;
  /** Output directory for generated migrations. Defaults to `./server/db/migrations`. */
  out?: string;
  /**
   * Connection URL for drizzle-kit, taking precedence over the app's
   * environment variables. Pass the direct endpoint when the pooled URL is
   * not permitted to run DDL.
   */
  url?: string;
}

export type DrizzleKitDialect = "postgresql";

function isDrizzlePushInvocation(): boolean {
  const argv = process.argv.map((a) => a.toLowerCase());
  const joined = argv.join(" ");
  if (/\bdrizzle-kit\b/.test(joined) && /\bpush\b/.test(joined)) return true;
  const lifecycleScript = (
    process.env.npm_lifecycle_script ||
    process.env.npm_lifecycle_event ||
    ""
  ).toLowerCase();
  return /\bdrizzle-kit\s+push\b/.test(lifecycleScript);
}

function isNeonUrl(url: string): boolean {
  return /(?:^|\.)neon\.tech(?:[/:?]|$)/i.test(url);
}

function pgliteDataDirFromUrl(url: string): string {
  const raw = url.slice("pglite:".length);
  const dataDir = raw.startsWith("//") ? raw.slice(2) : raw;
  if (!dataDir || dataDir === "/") return "./data/pglite";
  if (
    dataDir === "memory" ||
    dataDir === "/memory" ||
    dataDir === ":memory:" ||
    dataDir === "/:memory:" ||
    dataDir === "memory://"
  ) {
    return "memory://";
  }
  return dataDir;
}

/** Create the Postgres drizzle-kit config used by every template. */
export function createDrizzleConfig(
  opts: CreateDrizzleConfigOptions = {},
): Config {
  const {
    schema = "./server/db/schema.ts",
    out = "./server/db/migrations",
  } = opts;
  const appName = process.env.APP_NAME?.toUpperCase().replace(/-/g, "_");
  const explicitUrl = opts.url?.trim();
  const url =
    explicitUrl ||
    (appName && process.env[`${appName}_DATABASE_URL`]) ||
    process.env.DATABASE_URL ||
    "pglite:./data/pglite";

  if (
    !url.toLowerCase().startsWith("pglite:") &&
    !/^postgres(?:ql)?:\/\//i.test(url)
  ) {
    throw new Error(
      "createDrizzleConfig: DATABASE_URL must be a PostgreSQL URL or a pglite: URL.",
    );
  }

  if (
    isNeonUrl(url) &&
    isDrizzlePushInvocation() &&
    process.env.ALLOW_DRIZZLE_PUSH_ON_NEON !== "1"
  ) {
    throw new Error(
      [
        "Refusing to run `drizzle-kit push` against a Neon database.",
        "Use `runMigrations()` in `server/plugins/db.ts` instead.",
        "Detected database host: " +
          (() => {
            try {
              return new URL(url).host;
            } catch {
              return "(unparseable)";
            }
          })(),
      ].join("\n"),
    );
  }

  const isPglite = url.toLowerCase().startsWith("pglite:");
  return defineConfig({
    schema,
    out,
    dialect: "postgresql",
    ...(isPglite ? { driver: "pglite" as const } : {}),
    dbCredentials: isPglite
      ? { url: pgliteDataDirFromUrl(url) }
      : { url },
  });
}
