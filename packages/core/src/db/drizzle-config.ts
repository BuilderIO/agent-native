import fs from "node:fs";

import { defineConfig, type Config } from "drizzle-kit";

import { getAppConfig } from "../app-config/index.js";
import {
  getIsolatedTestDatabaseUrl,
  isProcessAlive,
  pgliteProcessLockPath,
} from "./client.js";

export interface CreateDrizzleConfigOptions {
  schema?: string;
  out?: string;
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

function isPgliteExclusiveDrizzleInvocation(): boolean {
  const exclusive = new Set(["migrate", "push", "studio", "pull"]);
  const argv = process.argv.map((a) => a.toLowerCase());
  const bin = argv.findIndex((a) => /\bdrizzle-kit\b/.test(a));
  if (bin !== -1) {
    const subcommand = argv.slice(bin + 1).find((a) => !a.startsWith("-"));
    if (subcommand && exclusive.has(subcommand)) return true;
  }
  const lifecycleScript = (
    process.env.npm_lifecycle_script ||
    process.env.npm_lifecycle_event ||
    ""
  ).toLowerCase();
  return /\bdrizzle-kit\s+(?:migrate|push|studio|pull)\b/.test(lifecycleScript);
}

function assertPgliteNotOpenInAnotherProcess(dataDir: string): void {
  if (dataDir === "memory://") return;
  let owner: unknown;
  try {
    owner = JSON.parse(fs.readFileSync(pgliteProcessLockPath(dataDir), "utf8"));
  } catch {
    // coercion-ok: no readable lock file means no dev server is holding the
    // directory; PGlite's own lock check still reports a real conflict.
    return;
  }
  const pid = (owner as { pid?: unknown } | null)?.pid;
  if (typeof pid !== "number" || pid === process.pid || !isProcessAlive(pid)) {
    return;
  }
  throw new Error(
    `PGlite database directory "${dataDir}" is open in the running dev server (pid ${pid}). ` +
      "Running drizzle-kit against it from another process corrupts it. " +
      "Use `agent-native db-migrate` (the starter's `pnpm db:migrate`), which applies migrations through the dev server, or stop the dev server first.",
  );
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
    dataDir === "memory:" ||
    dataDir === "/memory" ||
    dataDir === "/memory:" ||
    dataDir === ":memory:" ||
    dataDir === "/:memory:" ||
    dataDir === "memory://"
  ) {
    return "memory://";
  }
  return dataDir;
}

export function createDrizzleConfig(
  opts: CreateDrizzleConfigOptions = {},
): Config {
  const { schema = "./server/db/schema.ts", out = "./server/db/migrations" } =
    opts;
  const app = getAppConfig().app;
  const appName = (app.workspaceId || app.name)
    ?.toUpperCase()
    .replace(/-/g, "_");
  const explicitUrl = opts.url?.trim();
  const url =
    explicitUrl ||
    getIsolatedTestDatabaseUrl() ||
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
  if (isPglite && isPgliteExclusiveDrizzleInvocation()) {
    assertPgliteNotOpenInAnotherProcess(pgliteDataDirFromUrl(url));
  }
  return defineConfig({
    schema,
    out,
    dialect: "postgresql",
    ...(isPglite ? { driver: "pglite" as const } : {}),
    dbCredentials: isPglite ? { url: pgliteDataDirFromUrl(url) } : { url },
  });
}
