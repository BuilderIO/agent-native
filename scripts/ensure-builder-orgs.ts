#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_APPS = [
  "mail",
  "calendar",
  "content",
  "slides",
  "videos",
  "clips",
  "analytics",
  "dispatch",
  "forms",
  "design",
];

const ORG_NAME = "Builder.io";
const ORG_DOMAIN = "builder.io";
const OWNER_EMAIL = "steve@builder.io";
const ORG_ID_BASE = "builder_io";
const coreRequire = createRequire(path.resolve("packages/core/package.json"));

type Dialect = "sqlite" | "postgres";

interface Db {
  dialect: Dialect;
  execute(
    sql: string,
    args?: unknown[],
  ): Promise<{ rows: any[]; rowsAffected: number }>;
  close(): Promise<void>;
}

interface AppEnv {
  app: string;
  envPath: string;
  databaseUrl: string;
  databaseAuthToken?: string;
}

interface EnsureResult {
  app: string;
  orgId: string;
  orgCreated: boolean;
  orgNameUpdated: boolean;
  a2aSecretCreated: boolean;
  memberCreated: boolean;
  memberPromoted: boolean;
  betterAuthOrgCreated: boolean;
  betterAuthMemberCreated: boolean;
  betterAuthMemberPromoted: boolean;
  betterAuthUserMissing: boolean;
  clipsSettingsCreated: boolean;
  activeOrgSet: boolean;
}

const argv = process.argv.slice(2);
const write = argv.includes("--write");
const apps =
  flagValue("--apps")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? DEFAULT_APPS;

if (argv.includes("--help")) {
  printHelp();
  process.exit(0);
}

console.log(
  write
    ? "Applying Builder.io org seed to production template databases..."
    : "Dry run. Pass --write to apply Builder.io org seed.",
);

const failures: Array<{ app: string; error: unknown }> = [];

for (const app of apps) {
  let db: Db | null = null;
  try {
    const env = loadAppEnv(app);
    db = await connect(env.databaseUrl, env.databaseAuthToken);
    if (write) {
      await ensureFrameworkOrgTables(db);
      await ensureBetterAuthOrgTables(db);
      if (app === "clips") await ensureClipsOrgSettingsTable(db);
    }
    const result = await ensureBuilderOrg(db, app, write);
    printResult(result, write);
  } catch (error) {
    failures.push({ app, error });
    console.error(`${app}: failed - ${formatError(error)}`);
  } finally {
    await db?.close().catch(() => {});
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} app(s) failed.`);
  process.exitCode = 1;
}

function printHelp(): void {
  console.log(`Usage: pnpm exec tsx scripts/ensure-builder-orgs.ts [--write] [--apps mail,slides]

Creates or verifies the standard Builder.io organization in core app production
databases from each app's templates/<app>/.env:

  - organizations.name = "Builder.io"
  - organizations.allowed_domain = "builder.io"
  - org_members includes steve@builder.io as owner
  - settings u:steve@builder.io:active-org-id points at that org

Without --write, the script only reports what it would do.`);
}

function flagValue(name: string): string | null {
  const eq = argv.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const index = argv.indexOf(name);
  if (index === -1) return null;
  const next = argv[index + 1];
  return next && !next.startsWith("-") ? next : null;
}

function loadAppEnv(app: string): AppEnv {
  const envPath = path.resolve("templates", app, ".env");
  if (!fs.existsSync(envPath)) {
    throw new Error(`missing ${path.relative(process.cwd(), envPath)}`);
  }

  const parsed = parseEnv(fs.readFileSync(envPath, "utf8"));
  const appKey = app.toUpperCase().replace(/-/g, "_");
  const databaseUrl =
    parsed[`${appKey}_DATABASE_URL`]?.trim() || parsed.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set in .env");
  }

  const databaseAuthToken =
    parsed[`${appKey}_DATABASE_AUTH_TOKEN`]?.trim() ||
    parsed.DATABASE_AUTH_TOKEN?.trim();

  return {
    app,
    envPath,
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
        dialect: "postgres",
        async execute(sql, args = []) {
          const result = await pool.query(toPostgresParams(sql), args as any[]);
          return {
            rows: result.rows,
            rowsAffected: result.rowCount ?? 0,
          };
        },
        close: () => pool.end(),
      };
    }

    const { default: postgres } = await importWorkspacePackage<{
      default: any;
    }>("postgres");
    const client = postgres(databaseUrl, {
      onnotice: () => {},
      idle_timeout: 240,
      max_lifetime: 60 * 30,
      connect_timeout: 10,
      ...(databaseUrl.includes("supabase") ? { prepare: false } : {}),
    });
    return {
      dialect: "postgres",
      async execute(sql, args = []) {
        const result = await client.unsafe(
          toPostgresParams(sql),
          args as any[],
        );
        return {
          rows: Array.from(result),
          rowsAffected: result.count ?? 0,
        };
      },
      close: () => client.end(),
    };
  }

  const { createClient } = await importWorkspacePackage<{ createClient: any }>(
    "@libsql/client",
  );
  const client = createClient({
    url: databaseUrl,
    authToken: databaseAuthToken,
  });
  return {
    dialect: "sqlite",
    async execute(sql, args = []) {
      const result = await client.execute({ sql, args: args as any[] });
      return {
        rows: result.rows as any[],
        rowsAffected: result.rowsAffected,
      };
    },
    close: async () => {
      await (client as { close?: () => void }).close?.();
    },
  };
}

function toPostgresParams(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

async function ensureFrameworkOrgTables(db: Db): Promise<void> {
  const intType = db.dialect === "postgres" ? "BIGINT" : "INTEGER";

  await db.execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at ${intType} NOT NULL
  )`);
  await ensureColumn(db, "organizations", "allowed_domain", "TEXT");
  await ensureColumn(db, "organizations", "a2a_secret", "TEXT");

  await db.execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    joined_at ${intType} NOT NULL,
    UNIQUE(org_id, email)
  )`);

  await db.execute(`CREATE TABLE IF NOT EXISTS org_invitations (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    email TEXT NOT NULL,
    invited_by TEXT NOT NULL,
    created_at ${intType} NOT NULL,
    status TEXT NOT NULL
  )`);

  await db.execute(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at ${intType} NOT NULL
  )`);
}

async function ensureBetterAuthOrgTables(db: Db): Promise<void> {
  if (db.dialect === "postgres") {
    await db.execute(`CREATE TABLE IF NOT EXISTS "user" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      image TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS "organization" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      logo TEXT,
      metadata TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS "member" (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`);
    return;
  }

  await db.execute(`CREATE TABLE IF NOT EXISTS "user" (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS "organization" (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    logo TEXT,
    metadata TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS "member" (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
}

async function ensureClipsOrgSettingsTable(db: Db): Promise<void> {
  await db.execute(`CREATE TABLE IF NOT EXISTS organization_settings (
    organization_id TEXT PRIMARY KEY,
    brand_color TEXT NOT NULL DEFAULT '#18181B',
    brand_logo_url TEXT,
    default_visibility TEXT NOT NULL DEFAULT 'private',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

async function ensureColumn(
  db: Db,
  table: string,
  column: string,
  type: string,
): Promise<void> {
  if (db.dialect === "postgres") {
    await db.execute(
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`,
    );
    return;
  }

  const info = await db.execute(`PRAGMA table_info(${table})`);
  const exists = info.rows.some((row) => String(row.name) === column);
  if (!exists) {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

async function ensureBuilderOrg(
  db: Db,
  app: string,
  shouldWrite: boolean,
): Promise<EnsureResult> {
  const existing = await db.execute(
    `SELECT id, name, a2a_secret
     FROM organizations
     WHERE LOWER(COALESCE(allowed_domain, '')) = ?
     ORDER BY created_at ASC
     LIMIT 1`,
    [ORG_DOMAIN],
  );

  const now = Date.now();
  let orgId: string;
  let orgCreated = false;
  let orgNameUpdated = false;
  let a2aSecretCreated = false;

  if (existing.rows[0]) {
    const row = existing.rows[0];
    orgId = String(row.id);
    orgNameUpdated = String(row.name) !== ORG_NAME;
    a2aSecretCreated = !String(row.a2a_secret ?? "");

    if (shouldWrite && (orgNameUpdated || a2aSecretCreated)) {
      await db.execute(
        `UPDATE organizations
         SET name = ?,
             a2a_secret = COALESCE(NULLIF(a2a_secret, ''), ?)
         WHERE id = ?`,
        [ORG_NAME, randomSecret(), orgId],
      );
    }
  } else {
    orgCreated = true;
    orgId = shouldWrite
      ? ((await findBetterAuthBuilderOrgId(db)) ?? (await availableOrgId(db)))
      : ORG_ID_BASE;

    if (shouldWrite) {
      await db.execute(
        `INSERT INTO organizations
           (id, name, created_by, created_at, allowed_domain, a2a_secret)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [orgId, ORG_NAME, OWNER_EMAIL, now, ORG_DOMAIN, randomSecret()],
      );
      a2aSecretCreated = true;
    }
  }

  const membership = await db.execute(
    `SELECT role
     FROM org_members
     WHERE org_id = ? AND LOWER(email) = ?
     LIMIT 1`,
    [orgId, OWNER_EMAIL],
  );

  const memberCreated = membership.rows.length === 0;
  const memberPromoted =
    !memberCreated && String(membership.rows[0].role) !== "owner";

  if (shouldWrite) {
    if (memberCreated) {
      await db.execute(
        `INSERT INTO org_members (id, org_id, email, role, joined_at)
         VALUES (?, ?, ?, 'owner', ?)`,
        [randomId(), orgId, OWNER_EMAIL, now],
      );
    } else if (memberPromoted) {
      await db.execute(
        `UPDATE org_members
         SET role = 'owner'
         WHERE org_id = ? AND LOWER(email) = ?`,
        [orgId, OWNER_EMAIL],
      );
    }

    await upsertSetting(db, `u:${OWNER_EMAIL}:active-org-id`, { orgId }, now);
  }

  const betterAuth = await ensureBetterAuthOrg(db, orgId, shouldWrite);
  const clipsSettingsCreated =
    app === "clips"
      ? await ensureClipsOrgSettings(db, orgId, shouldWrite)
      : false;

  return {
    app,
    orgId,
    orgCreated,
    orgNameUpdated,
    a2aSecretCreated,
    memberCreated,
    memberPromoted,
    betterAuthOrgCreated: betterAuth.orgCreated,
    betterAuthMemberCreated: betterAuth.memberCreated,
    betterAuthMemberPromoted: betterAuth.memberPromoted,
    betterAuthUserMissing: betterAuth.userMissing,
    clipsSettingsCreated,
    activeOrgSet: shouldWrite,
  };
}

async function findBetterAuthBuilderOrgId(db: Db): Promise<string | null> {
  try {
    const existing = await db.execute(
      `SELECT id FROM "organization" WHERE slug = ? LIMIT 1`,
      [ORG_ID_BASE.replace("_", "-")],
    );
    return existing.rows[0]?.id ? String(existing.rows[0].id) : null;
  } catch {
    return null;
  }
}

async function ensureBetterAuthOrg(
  db: Db,
  orgId: string,
  shouldWrite: boolean,
): Promise<{
  orgCreated: boolean;
  memberCreated: boolean;
  memberPromoted: boolean;
  userMissing: boolean;
}> {
  let orgCreated = false;
  let memberCreated = false;
  let memberPromoted = false;
  let userMissing = false;
  const now = Date.now();

  try {
    const org = await db.execute(
      `SELECT id, name FROM "organization" WHERE id = ? LIMIT 1`,
      [orgId],
    );
    orgCreated = org.rows.length === 0;

    if (shouldWrite) {
      if (orgCreated) {
        const slug = await availableBetterAuthSlug(db, orgId);
        if (db.dialect === "postgres") {
          await db.execute(
            `INSERT INTO "organization"
               (id, name, slug, created_at, updated_at)
             VALUES (?, ?, ?, NOW(), NOW())`,
            [orgId, ORG_NAME, slug],
          );
        } else {
          await db.execute(
            `INSERT INTO "organization"
               (id, name, slug, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`,
            [orgId, ORG_NAME, slug, now, now],
          );
        }
      } else if (String(org.rows[0].name) !== ORG_NAME) {
        await db.execute(`UPDATE "organization" SET name = ? WHERE id = ?`, [
          ORG_NAME,
          orgId,
        ]);
      }
    }

    const user = await db.execute(
      `SELECT id FROM "user" WHERE LOWER(email) = ? LIMIT 1`,
      [OWNER_EMAIL],
    );
    const userId = user.rows[0]?.id ? String(user.rows[0].id) : null;
    if (!userId) {
      userMissing = true;
      return { orgCreated, memberCreated, memberPromoted, userMissing };
    }

    const member = await db.execute(
      `SELECT role
       FROM "member"
       WHERE organization_id = ? AND user_id = ?
       LIMIT 1`,
      [orgId, userId],
    );
    memberCreated = member.rows.length === 0;
    const existingRole = String(member.rows[0]?.role ?? "");
    memberPromoted =
      !memberCreated && existingRole !== "admin" && existingRole !== "owner";

    if (shouldWrite) {
      if (memberCreated) {
        if (db.dialect === "postgres") {
          await db.execute(
            `INSERT INTO "member"
               (id, organization_id, user_id, role, created_at, updated_at)
             VALUES (?, ?, ?, 'admin', NOW(), NOW())`,
            [randomId(), orgId, userId],
          );
        } else {
          await db.execute(
            `INSERT INTO "member"
               (id, organization_id, user_id, role, created_at, updated_at)
             VALUES (?, ?, ?, 'admin', ?, ?)`,
            [randomId(), orgId, userId, now, now],
          );
        }
      } else if (memberPromoted) {
        if (db.dialect === "postgres") {
          await db.execute(
            `UPDATE "member"
             SET role = 'admin', updated_at = NOW()
             WHERE organization_id = ? AND user_id = ?`,
            [orgId, userId],
          );
        } else {
          await db.execute(
            `UPDATE "member"
             SET role = 'admin', updated_at = ?
             WHERE organization_id = ? AND user_id = ?`,
            [now, orgId, userId],
          );
        }
      }
    }
  } catch (error) {
    throw new Error(`better-auth org sync failed: ${formatError(error)}`);
  }

  return { orgCreated, memberCreated, memberPromoted, userMissing };
}

async function availableBetterAuthSlug(db: Db, orgId: string): Promise<string> {
  const base = ORG_ID_BASE.replace("_", "-");
  const existing = await db.execute(
    `SELECT id FROM "organization" WHERE slug = ? LIMIT 1`,
    [base],
  );
  if (existing.rows.length === 0 || String(existing.rows[0].id) === orgId) {
    return base;
  }
  return `${base}-${orgId.slice(0, 8).toLowerCase()}`;
}

async function ensureClipsOrgSettings(
  db: Db,
  orgId: string,
  shouldWrite: boolean,
): Promise<boolean> {
  const existing = await db.execute(
    `SELECT 1
     FROM organization_settings
     WHERE organization_id = ?
     LIMIT 1`,
    [orgId],
  );
  const created = existing.rows.length === 0;
  if (shouldWrite && created) {
    const nowIso = new Date().toISOString();
    if (db.dialect === "postgres") {
      await db.execute(
        `INSERT INTO organization_settings
           (organization_id, brand_color, default_visibility, created_at, updated_at)
         VALUES (?, '#18181B', 'private', ?, ?)
         ON CONFLICT (organization_id) DO NOTHING`,
        [orgId, nowIso, nowIso],
      );
    } else {
      await db.execute(
        `INSERT OR IGNORE INTO organization_settings
           (organization_id, brand_color, default_visibility, created_at, updated_at)
         VALUES (?, '#18181B', 'private', ?, ?)`,
        [orgId, nowIso, nowIso],
      );
    }
  }
  return created;
}

async function availableOrgId(db: Db): Promise<string> {
  const candidates = [
    ORG_ID_BASE,
    `${ORG_ID_BASE}_1`,
    `${ORG_ID_BASE}_2`,
    `${ORG_ID_BASE}_3`,
  ];

  for (const candidate of candidates) {
    const existing = await db.execute(
      `SELECT 1 FROM organizations WHERE id = ? LIMIT 1`,
      [candidate],
    );
    if (existing.rows.length === 0) return candidate;
  }

  return `${ORG_ID_BASE}_${randomId().slice(0, 8)}`;
}

async function upsertSetting(
  db: Db,
  key: string,
  value: Record<string, unknown>,
  updatedAt: number,
): Promise<void> {
  if (db.dialect === "postgres") {
    await db.execute(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [key, JSON.stringify(value), updatedAt],
    );
    return;
  }

  await db.execute(
    `INSERT OR REPLACE INTO settings (key, value, updated_at)
     VALUES (?, ?, ?)`,
    [key, JSON.stringify(value), updatedAt],
  );
}

function randomId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function randomSecret(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function printResult(result: EnsureResult, didWrite: boolean): void {
  const changes = [
    result.orgCreated
      ? "org created"
      : result.orgNameUpdated
        ? "org renamed"
        : "org present",
    result.a2aSecretCreated ? "a2a secret set" : null,
    result.memberCreated
      ? `${OWNER_EMAIL} added as owner`
      : result.memberPromoted
        ? `${OWNER_EMAIL} promoted to owner`
        : `${OWNER_EMAIL} already owner`,
    result.betterAuthOrgCreated ? "better-auth org created" : null,
    result.betterAuthUserMissing
      ? "better-auth user missing"
      : result.betterAuthMemberCreated
        ? "better-auth member added"
        : result.betterAuthMemberPromoted
          ? "better-auth member promoted"
          : "better-auth member present",
    result.clipsSettingsCreated ? "clips settings seeded" : null,
    result.activeOrgSet ? "active org set" : null,
  ].filter(Boolean);

  console.log(
    `${result.app}: ${didWrite ? "ok" : "would update"} (${result.orgId}) - ${changes.join(", ")}`,
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
