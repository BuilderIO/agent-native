#!/usr/bin/env node
// TEMP read-only inspection of the brain DB for the product-narrative extension
// and the Builder.io org. Never prints the connection string.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const coreRequire = createRequire(path.resolve("packages/core/package.json"));

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
      (quote === '"' || quote === "'") &&
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

async function importWorkspacePackage<T>(specifier: string): Promise<T> {
  try {
    return (await import(specifier)) as T;
  } catch {
    const resolved = coreRequire.resolve(specifier);
    return (await import(pathToFileURL(resolved).href)) as T;
  }
}

function loadBrainUrl(): string {
  const envPath = path.resolve("templates", "brain", ".env");
  const localPath = path.resolve("templates", "brain", ".env.local");
  const parsed = {
    ...(fs.existsSync(envPath)
      ? parseEnv(fs.readFileSync(envPath, "utf8"))
      : {}),
    ...(fs.existsSync(localPath)
      ? parseEnv(fs.readFileSync(localPath, "utf8"))
      : {}),
  };
  const url = parsed.BRAIN_DATABASE_URL?.trim() || parsed.DATABASE_URL?.trim();
  if (!url) throw new Error("no DATABASE_URL for brain");
  return url;
}

function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function connect(url: string) {
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    if (/\.neon\.tech([:/?]|$)/.test(url)) {
      const { Pool } = await importWorkspacePackage<any>(
        "@neondatabase/serverless",
      );
      const pool = new Pool({ connectionString: url });
      return {
        host: "neon",
        async q(sql: string, args: any[] = []) {
          const r = await pool.query(toPg(sql), args);
          return r.rows as any[];
        },
        close: () => pool.end(),
      };
    }
    const { default: postgres } = await importWorkspacePackage<any>("postgres");
    const client = postgres(url, { onnotice: () => {}, connect_timeout: 10 });
    return {
      host: "pg",
      async q(sql: string, args: any[] = []) {
        const r = await client.unsafe(toPg(sql), args);
        return Array.from(r) as any[];
      },
      close: () => client.end(),
    };
  }
  const { createClient } = await importWorkspacePackage<any>("@libsql/client");
  const client = createClient({ url });
  return {
    host: "sqlite",
    async q(sql: string, args: any[] = []) {
      const r = await client.execute({ sql, args });
      return r.rows as any[];
    },
    close: async () => client.close?.(),
  };
}

const TARGET_ID = "33c97d4d-8d07-4230-b8d8-d3dfabf9c141";

async function main() {
  const db = await connect(loadBrainUrl());
  try {
    console.log("DB dialect/host:", db.host);

    console.log("\n=== organizations ===");
    const orgs = await db.q(
      `SELECT id, name, allowed_domain, created_by FROM organizations ORDER BY created_at ASC`,
    );
    for (const o of orgs) {
      console.log(JSON.stringify(o));
    }

    console.log("\n=== Builder.io org (allowed_domain) ===");
    const builderOrg = await db.q(
      `SELECT id, name, allowed_domain FROM organizations WHERE LOWER(COALESCE(allowed_domain,'')) = ? ORDER BY created_at ASC`,
      ["builder.io"],
    );
    console.log(JSON.stringify(builderOrg));

    console.log("\n=== org_members ===");
    const members = await db.q(
      `SELECT org_id, email, role FROM org_members ORDER BY org_id`,
    );
    for (const m of members) console.log(JSON.stringify(m));

    console.log("\n=== target extension row (by id) ===");
    const byId = await db.q(
      `SELECT id, name, owner_email, org_id, visibility, created_at, updated_at, hidden_at FROM tools WHERE id = ?`,
      [TARGET_ID],
    );
    console.log(
      byId.length
        ? JSON.stringify(byId, null, 2)
        : "(no row with that id — likely deleted)",
    );

    console.log("\n=== extensions matching 'narrative' ===");
    const byName = await db.q(
      `SELECT id, name, owner_email, org_id, visibility, created_at, updated_at, hidden_at FROM tools WHERE LOWER(name) LIKE ? ORDER BY created_at DESC`,
      ["%narrative%"],
    );
    console.log(byName.length ? JSON.stringify(byName, null, 2) : "(none)");

    console.log("\n=== all extensions (recent 25) ===");
    const recent = await db.q(
      `SELECT id, name, owner_email, org_id, visibility, created_at FROM tools ORDER BY created_at DESC LIMIT 25`,
    );
    for (const r of recent) console.log(JSON.stringify(r));
  } finally {
    await db.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error("FAILED:", e?.message || e);
  process.exit(1);
});
