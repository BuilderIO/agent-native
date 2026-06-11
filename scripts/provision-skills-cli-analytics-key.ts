#!/usr/bin/env node
/**
 * Provision (idempotently) the first-party analytics public write key that the
 * skills CLIs embed to report their install funnel.
 *
 * Reads templates/analytics/.env for the production analytics DATABASE_URL,
 * resolves the Builder.io org, and ensures a single "Skills CLI" public key row
 * exists in analytics_public_keys. The key value is PUBLIC and write-only
 * (same class as a PostHog public key or GA measurement id) — it is printed so
 * it can be baked into the CLI default, and it can be revoked from the
 * Analytics settings UI at any time.
 *
 * Usage:
 *   pnpm exec tsx scripts/provision-skills-cli-analytics-key.ts          # report
 *   pnpm exec tsx scripts/provision-skills-cli-analytics-key.ts --write  # create if missing
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const KEY_NAME = "Skills CLI";
const ORG_DOMAIN = "builder.io";
const OWNER_EMAIL = "steve@builder.io";
const coreRequire = createRequire(path.resolve("packages/core/package.json"));

const argv = process.argv.slice(2);
const write = argv.includes("--write");

interface Db {
  execute(
    sql: string,
    args?: unknown[],
  ): Promise<{ rows: any[]; rowsAffected: number }>;
  close(): Promise<void>;
}

async function importWorkspacePackage<T>(specifier: string): Promise<T> {
  try {
    return (await import(specifier)) as T;
  } catch {
    const resolved = coreRequire.resolve(specifier);
    return (await import(pathToFileURL(resolved).href)) as T;
  }
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
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    result[key] = value;
  }
  return result;
}

function loadDatabaseUrl(): string {
  const envPath = path.resolve("templates", "analytics", ".env");
  if (!fs.existsSync(envPath)) {
    throw new Error(`missing ${path.relative(process.cwd(), envPath)}`);
  }
  const parsed = parseEnv(fs.readFileSync(envPath, "utf8"));
  const url =
    parsed.ANALYTICS_DATABASE_URL?.trim() || parsed.DATABASE_URL?.trim();
  if (!url)
    throw new Error("DATABASE_URL is not set in templates/analytics/.env");
  return url;
}

function toPostgresParams(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

async function connect(databaseUrl: string): Promise<Db> {
  if (/\.neon\.tech([:/?]|$)/.test(databaseUrl)) {
    const { Pool } = await importWorkspacePackage<{
      Pool: new (opts: { connectionString: string }) => {
        query(
          sql: string,
          args: any[],
        ): Promise<{ rows: any[]; rowCount?: number | null }>;
        end(): Promise<void>;
      };
    }>("@neondatabase/serverless");
    const pool = new Pool({ connectionString: databaseUrl });
    return {
      async execute(sql, args = []) {
        const result = await pool.query(toPostgresParams(sql), args as any[]);
        return { rows: result.rows, rowsAffected: result.rowCount ?? 0 };
      },
      close: () => pool.end(),
    };
  }
  const { default: postgres } = await importWorkspacePackage<{ default: any }>(
    "postgres",
  );
  const client = postgres(databaseUrl, { onnotice: () => {}, max: 1 });
  return {
    async execute(sql, args = []) {
      const result = await client.unsafe(toPostgresParams(sql), args as any[]);
      return { rows: Array.from(result), rowsAffected: result.count ?? 0 };
    },
    close: () => client.end(),
  };
}

function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString("hex");
}

async function main(): Promise<void> {
  const db = await connect(loadDatabaseUrl());
  try {
    const org = await db.execute(
      `SELECT id FROM organizations WHERE LOWER(COALESCE(allowed_domain, '')) = ? ORDER BY created_at ASC LIMIT 1`,
      [ORG_DOMAIN],
    );
    const orgId: string | null = org.rows[0]?.id
      ? String(org.rows[0].id)
      : null;

    const existing = await db.execute(
      `SELECT id, public_key, public_key_prefix, revoked_at
       FROM analytics_public_keys
       WHERE name = ? AND revoked_at IS NULL
       ORDER BY created_at ASC
       LIMIT 1`,
      [KEY_NAME],
    );

    if (existing.rows[0]) {
      const row = existing.rows[0];
      console.log(
        `Existing "${KEY_NAME}" key present: ${row.public_key_prefix}… (org=${orgId ?? "personal"})`,
      );
      console.log(`PUBLIC_KEY=${row.public_key}`);
      return;
    }

    const publicKey = `anpk_${randomHex(24)}`;
    const prefix = publicKey.slice(0, 13);
    const id = `apk_${randomHex(12)}`;
    const createdAt = new Date().toISOString();

    if (!write) {
      console.log(
        `Dry run. Would create "${KEY_NAME}" key (org=${orgId ?? "personal"}). Pass --write to apply.`,
      );
      return;
    }

    await db.execute(
      `INSERT INTO analytics_public_keys
         (id, name, public_key, public_key_prefix, created_at, owner_email, org_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, KEY_NAME, publicKey, prefix, createdAt, OWNER_EMAIL, orgId],
    );

    console.log(
      `Created "${KEY_NAME}" key ${prefix}… owned by ${OWNER_EMAIL} (org=${orgId ?? "personal"}).`,
    );
    console.log(`PUBLIC_KEY=${publicKey}`);
  } finally {
    await db.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
