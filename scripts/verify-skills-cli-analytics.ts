#!/usr/bin/env node
/**
 * Read-only check that skills-CLI funnel events are landing in the production
 * first-party analytics_events table. Prints per-event counts and a few recent
 * rows. Does not write anything.
 *
 *   pnpm exec tsx scripts/verify-skills-cli-analytics.ts
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const coreRequire = createRequire(path.resolve("packages/core/package.json"));

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

async function main(): Promise<void> {
  const databaseUrl = loadDatabaseUrl();
  const { Pool } = await importWorkspacePackage<{
    Pool: new (o: { connectionString: string }) => {
      query(sql: string): Promise<{ rows: any[] }>;
      end(): Promise<void>;
    };
  }>("@neondatabase/serverless");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const counts = await pool.query(
      `SELECT event_name, COUNT(*) AS count
       FROM analytics_events
       WHERE event_name LIKE 'skills_cli%'
       GROUP BY event_name
       ORDER BY count DESC`,
    );
    console.log("skills_cli events by name:");
    if (counts.rows.length === 0) {
      console.log("  (none yet)");
    } else {
      for (const r of counts.rows) {
        console.log(`  ${String(r.count).padStart(4)}  ${r.event_name}`);
      }
    }

    const recent = await pool.query(
      `SELECT event_name,
              (properties::jsonb ->> 'cli') AS cli,
              (properties::jsonb ->> 'platform') AS platform,
              session_id,
              timestamp
       FROM analytics_events
       WHERE event_name LIKE 'skills_cli%'
       ORDER BY received_at DESC
       LIMIT 8`,
    );
    console.log("\nmost recent rows:");
    for (const r of recent.rows) {
      console.log(
        `  ${r.timestamp}  cli=${r.cli}  ${r.event_name}  (session ${String(
          r.session_id,
        ).slice(0, 8)})`,
      );
    }

    // Confirm the live dashboard row exists and that its panels actually run
    // against real data (catches any SQL that the validator passed but Postgres
    // rejects). We execute each panel's SQL exactly as stored.
    const dash = await pool.query(
      `SELECT title, kind, visibility, org_id, config
       FROM dashboards WHERE id = 'skills-cli-funnel' LIMIT 1`,
    );
    if (dash.rows.length === 0) {
      console.log("\ndashboard: (not materialized)");
    } else {
      const row = dash.rows[0] as any;
      const config = JSON.parse(row.config);
      console.log(
        `\ndashboard: "${row.title}" kind=${row.kind} visibility=${row.visibility} org=${row.org_id} panels=${config.panels.length}`,
      );
      let ok = 0;
      const failures: string[] = [];
      for (const panel of config.panels) {
        try {
          await pool.query(panel.sql);
          ok += 1;
        } catch (err) {
          failures.push(
            `${panel.title}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      console.log(
        `  panels that execute cleanly: ${ok}/${config.panels.length}`,
      );
      for (const f of failures) console.log(`  FAILED ${f}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
