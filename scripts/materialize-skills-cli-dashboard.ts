#!/usr/bin/env node
/**
 * Materialize the "Skills CLI Funnel" dashboard as a live SQL-backed dashboard
 * in the production Analytics app for the Builder.io org. Idempotent: updates
 * the existing row if present, inserts otherwise. The config is stored inline
 * (self-contained) so it renders on the currently-deployed app without waiting
 * for the catalog code to ship.
 *
 *   pnpm exec tsx scripts/materialize-skills-cli-dashboard.ts          # report
 *   pnpm exec tsx scripts/materialize-skills-cli-dashboard.ts --write  # apply
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DASHBOARD_ID = "skills-cli-funnel";
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
  const parsed = parseEnv(
    fs.readFileSync(path.resolve("templates", "analytics", ".env"), "utf8"),
  );
  const url =
    parsed.ANALYTICS_DATABASE_URL?.trim() || parsed.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL not set in templates/analytics/.env");
  return url;
}

function toPostgresParams(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

async function connect(databaseUrl: string): Promise<Db> {
  const { Pool } = await importWorkspacePackage<{
    Pool: new (o: { connectionString: string }) => {
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

async function main(): Promise<void> {
  const config = JSON.parse(
    fs.readFileSync(
      path.resolve(
        "templates",
        "analytics",
        "seeds",
        "dashboards",
        `${DASHBOARD_ID}.json`,
      ),
      "utf8",
    ),
  );
  const title = String(config.name || "Skills CLI Funnel");
  const configJson = JSON.stringify(config);

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
      `SELECT id FROM dashboards WHERE id = ? LIMIT 1`,
      [DASHBOARD_ID],
    );
    const now = new Date().toISOString();

    if (!write) {
      console.log(
        `Dry run. Would ${existing.rows[0] ? "update" : "insert"} dashboard "${title}" (${DASHBOARD_ID}) for org=${orgId ?? "personal"}, visibility=org. Pass --write to apply.`,
      );
      return;
    }

    if (existing.rows[0]) {
      await db.execute(
        `UPDATE dashboards SET kind = 'sql', title = ?, config = ?, updated_at = ?, archived_at = NULL, hidden_at = NULL WHERE id = ?`,
        [title, configJson, now, DASHBOARD_ID],
      );
      console.log(`Updated dashboard "${title}" (${DASHBOARD_ID}).`);
    } else {
      await db.execute(
        `INSERT INTO dashboards (id, kind, title, config, created_at, updated_at, owner_email, org_id, visibility)
         VALUES (?, 'sql', ?, ?, ?, ?, ?, ?, 'org')`,
        [DASHBOARD_ID, title, configJson, now, now, OWNER_EMAIL, orgId],
      );
      console.log(
        `Created dashboard "${title}" (${DASHBOARD_ID}) owned by ${OWNER_EMAIL}, org=${orgId ?? "personal"}, visibility=org.`,
      );
    }
  } finally {
    await db.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
