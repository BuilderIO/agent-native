#!/usr/bin/env node
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const coreRequire = createRequire(path.resolve("packages/core/package.json"));

type Dialect = "sqlite" | "postgres";

interface Db {
  dialect: Dialect;
  execute(
    sql: string,
    args?: unknown[],
  ): Promise<{ rows: any[]; rowsAffected: number }>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

interface AppEnv {
  app: string;
  databaseUrl: string;
  databaseAuthToken?: string;
}

interface DbTarget {
  apps: string[];
  databaseUrl: string;
  databaseAuthToken?: string;
}

interface Counts {
  total: number;
  nonPrivate: number;
  orgVisible: number;
  publicVisible: number;
  shareRows: number;
  orgShareRows: number;
  userShareRows: number;
}

const argv = process.argv.slice(2);
const write = argv.includes("--write");
const appFilter = flagValue("--apps")
  ?.split(",")
  .map((app) => app.trim())
  .filter(Boolean);
const templates = readTemplateMetadata();

if (argv.includes("--help")) {
  printHelp();
  process.exit(0);
}

const targetApps = templates.filter((template) => {
  if (!template.prodUrl) return false;
  if (appFilter?.length) return appFilter.includes(template.name);
  return true;
});

const missing: string[] = [];
const targetsByDb = new Map<string, DbTarget>();

for (const template of targetApps) {
  const env = loadAppEnv(template.name);
  if (!env) {
    missing.push(template.name);
    continue;
  }

  const key = `${env.databaseUrl}\0${env.databaseAuthToken ?? ""}`;
  const existing = targetsByDb.get(key);
  if (existing) {
    existing.apps.push(env.app);
  } else {
    targetsByDb.set(key, {
      apps: [env.app],
      databaseUrl: env.databaseUrl,
      databaseAuthToken: env.databaseAuthToken,
    });
  }
}

const targets = [...targetsByDb.values()];
console.log(
  write
    ? "Making existing extensions private in production databases..."
    : "Dry run. Pass --write to make existing extensions private.",
);
console.log(
  `Targets: ${targets.length} database(s), ${targets.reduce(
    (sum, target) => sum + target.apps.length,
    0,
  )} app alias(es).`,
);
if (missing.length) {
  console.log(
    `Skipping prod template(s) without DATABASE_URL in templates/<app>/.env: ${missing.join(
      ", ",
    )}`,
  );
}

const failures: Array<{ apps: string[]; error: unknown }> = [];
let totalChangedVisibility = 0;
let totalDeletedShares = 0;

for (const target of targets) {
  let db: Db | null = null;
  const label = target.apps.join(", ");
  try {
    db = await connect(target.databaseUrl, target.databaseAuthToken);
    const toolsExists = await tableExists(db, "tools");
    if (!toolsExists) {
      console.log(`${label}: skipped - tools table does not exist`);
      continue;
    }

    const sharesExists = await tableExists(db, "tool_shares");
    const before = await readCounts(db, sharesExists);
    if (!write) {
      printCounts(label, before, target.databaseUrl);
      continue;
    }

    const result = await db.transaction(async (tx) => {
      const visibility = await tx.execute(
        `UPDATE tools
         SET visibility = 'private'
         WHERE visibility <> 'private' OR visibility IS NULL`,
      );
      const shares = sharesExists
        ? await tx.execute(
            `DELETE FROM tool_shares
             WHERE resource_id IN (SELECT id FROM tools)`,
          )
        : { rows: [], rowsAffected: 0 };
      return {
        visibilityRows: visibility.rowsAffected,
        shareRows: shares.rowsAffected,
      };
    });

    totalChangedVisibility += result.visibilityRows;
    totalDeletedShares += result.shareRows;

    const after = await readCounts(db, sharesExists);
    const verified = after.nonPrivate === 0 && after.shareRows === 0;
    console.log(
      `${label}: set private ${result.visibilityRows}, deleted share rows ${result.shareRows}, verified=${verified ? "yes" : "no"} (${maskDatabaseUrl(
        target.databaseUrl,
      )})`,
    );
    if (!verified) {
      throw new Error(
        `verification failed: ${after.nonPrivate} non-private extension(s), ${after.shareRows} share row(s) remain`,
      );
    }
  } catch (error) {
    failures.push({ apps: target.apps, error });
    console.error(`${label}: failed - ${formatError(error)}`);
  } finally {
    await db?.close().catch(() => {});
  }
}

if (write) {
  console.log(
    `Done. Updated ${totalChangedVisibility} extension visibility value(s) and deleted ${totalDeletedShares} extension share row(s).`,
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length} database target(s) failed.`);
  process.exitCode = 1;
}

function printHelp(): void {
  console.log(`Usage: pnpm exec tsx scripts/private-existing-extensions.ts [--write] [--apps mail,slides]

Sets all existing extension rows in production template databases to private
and removes explicit extension share grants, so only each extension creator can
see their extension.

The script reads production database URLs from templates/<app>/.env, with an
app-specific process env fallback such as ISSUES_DATABASE_URL for one-off
deploy-provider lookups. It dedupes shared databases and runs as a dry run
unless --write is passed. Secret values are never printed.`);
}

function flagValue(name: string): string | null {
  const eq = argv.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const index = argv.indexOf(name);
  if (index === -1) return null;
  const next = argv[index + 1];
  return next && !next.startsWith("-") ? next : null;
}

function loadAppEnv(app: string): AppEnv | null {
  const envPath = path.resolve("templates", app, ".env");
  if (!fs.existsSync(envPath)) return null;

  const parsed = parseEnv(fs.readFileSync(envPath, "utf8"));
  const appKey = app.toUpperCase().replace(/-/g, "_");
  const databaseUrl =
    parsed[`${appKey}_DATABASE_URL`]?.trim() ||
    parsed.DATABASE_URL?.trim() ||
    process.env[`${appKey}_DATABASE_URL`]?.trim();
  if (!databaseUrl) return null;

  const databaseAuthToken =
    parsed[`${appKey}_DATABASE_AUTH_TOKEN`]?.trim() ||
    parsed.DATABASE_AUTH_TOKEN?.trim() ||
    process.env[`${appKey}_DATABASE_AUTH_TOKEN`]?.trim();

  return {
    app,
    databaseUrl,
    databaseAuthToken: databaseAuthToken || undefined,
  };
}

function parseEnv(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trim();

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = line.slice(eq + 1).trim();
    const quote = value[0];
    if (
      (quote === `"` || quote === `'`) &&
      value.length >= 2 &&
      value[value.length - 1] === quote
    ) {
      value = value.slice(1, -1);
      if (quote === `"`) {
        value = value
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t")
          .replace(/\\"/g, `"`)
          .replace(/\\\\/g, "\\");
      }
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    result[key] = value;
  }
  return result;
}

function readTemplateMetadata(): Array<{ name: string; prodUrl?: string }> {
  const sourcePath = path.resolve("packages/shared-app-config/templates.ts");
  const source = fs.readFileSync(sourcePath, "utf8");
  const entries = source.match(/\{[\s\S]*?\n  \}/g) ?? [];
  const templates: Array<{ name: string; prodUrl?: string }> = [];

  for (const entry of entries) {
    const name = entry.match(/\bname:\s*"([^"]+)"/)?.[1];
    if (!name) continue;
    const prodUrl = entry.match(/\bprodUrl:\s*"([^"]+)"/)?.[1];
    templates.push({ name, prodUrl });
  }

  return templates;
}

async function importWorkspacePackage<T>(specifier: string): Promise<T> {
  try {
    return (await import(specifier)) as T;
  } catch {
    const resolved = coreRequire.resolve(specifier);
    return (await import(pathToFileURL(resolved).href)) as T;
  }
}

async function connect(
  databaseUrl: string,
  databaseAuthToken: string | undefined,
): Promise<Db> {
  if (
    databaseUrl.startsWith("postgres://") ||
    databaseUrl.startsWith("postgresql://")
  ) {
    const { default: postgres } = await importWorkspacePackage<{
      default: any;
    }>("postgres");
    const client = postgres(databaseUrl, {
      onnotice: () => {},
      idle_timeout: 20,
      max_lifetime: 60 * 30,
      connect_timeout: 10,
      prepare: false,
    });

    const makeDb = (runner: any): Db => ({
      dialect: "postgres",
      async execute(sql, args = []) {
        const result = await runner.unsafe(
          toPostgresParams(sql),
          args as any[],
        );
        return {
          rows: Array.from(result),
          rowsAffected: result.count ?? 0,
        };
      },
      transaction: (fn) => runner.begin((tx: any) => fn(makeDb(tx))),
      close: () => client.end(),
    });

    return makeDb(client);
  }

  const { createClient } = await importWorkspacePackage<{ createClient: any }>(
    "@libsql/client",
  );
  const client = createClient({
    url: databaseUrl,
    authToken: databaseAuthToken,
  });

  const db: Db = {
    dialect: "sqlite",
    async execute(sql, args = []) {
      const result = await client.execute({ sql, args: args as any[] });
      return {
        rows: result.rows as any[],
        rowsAffected: result.rowsAffected,
      };
    },
    async transaction(fn) {
      await db.execute("BEGIN");
      try {
        const result = await fn(db);
        await db.execute("COMMIT");
        return result;
      } catch (error) {
        await db.execute("ROLLBACK").catch(() => {});
        throw error;
      }
    },
    close: async () => {
      await (client as { close?: () => void }).close?.();
    },
  };
  return db;
}

function toPostgresParams(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

async function tableExists(db: Db, table: string): Promise<boolean> {
  if (db.dialect === "postgres") {
    const result = await db.execute(`SELECT to_regclass(?) AS table_name`, [
      `public.${table}`,
    ]);
    return Boolean(result.rows[0]?.table_name);
  }

  const result = await db.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
    [table],
  );
  return result.rows.length > 0;
}

async function readCounts(db: Db, sharesExists: boolean): Promise<Counts> {
  const extensionCounts = await db.execute(`SELECT
    COUNT(*) AS total,
    COALESCE(SUM(CASE WHEN visibility <> 'private' OR visibility IS NULL THEN 1 ELSE 0 END), 0) AS non_private,
    COALESCE(SUM(CASE WHEN visibility = 'org' THEN 1 ELSE 0 END), 0) AS org_visible,
    COALESCE(SUM(CASE WHEN visibility = 'public' THEN 1 ELSE 0 END), 0) AS public_visible
    FROM tools`);
  const row = extensionCounts.rows[0] ?? {};

  let shareRows = 0;
  let orgShareRows = 0;
  let userShareRows = 0;
  if (sharesExists) {
    const shareCounts = await db.execute(`SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN principal_type = 'org' THEN 1 ELSE 0 END), 0) AS org_shares,
      COALESCE(SUM(CASE WHEN principal_type = 'user' THEN 1 ELSE 0 END), 0) AS user_shares
      FROM tool_shares
      WHERE resource_id IN (SELECT id FROM tools)`);
    const shareRow = shareCounts.rows[0] ?? {};
    shareRows = toNumber(shareRow.total);
    orgShareRows = toNumber(shareRow.org_shares);
    userShareRows = toNumber(shareRow.user_shares);
  }

  return {
    total: toNumber(row.total),
    nonPrivate: toNumber(row.non_private),
    orgVisible: toNumber(row.org_visible),
    publicVisible: toNumber(row.public_visible),
    shareRows,
    orgShareRows,
    userShareRows,
  };
}

function printCounts(label: string, counts: Counts, databaseUrl: string): void {
  console.log(
    `${label}: total ${counts.total}, non-private ${counts.nonPrivate} (org ${counts.orgVisible}, public ${counts.publicVisible}), share rows ${counts.shareRows} (org ${counts.orgShareRows}, user ${counts.userShareRows}) (${maskDatabaseUrl(
      databaseUrl,
    )})`,
  );
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function maskDatabaseUrl(databaseUrl: string): string {
  try {
    const parsed = new URL(databaseUrl);
    const database = parsed.pathname.replace(/^\//, "") || "(default)";
    return `${parsed.protocol}//${parsed.hostname}/${database}`;
  } catch {
    return databaseUrl.startsWith("file:") ? "file:..." : "(unparseable URL)";
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
