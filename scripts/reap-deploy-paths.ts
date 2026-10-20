#!/usr/bin/env tsx
/**
 * Drops the Postgres databases the deploy-path check leaked: ones it created
 * that are old enough that no run can still be using them. The check cleans up
 * after itself on every exit, so this only matters when a runner was killed or
 * a cleanup failed, which is exactly when nothing else will. Host projects are
 * created once and reused, never one per run, so there is nothing to sweep on a
 * host.
 *
 *   pnpm exec tsx scripts/reap-deploy-paths.ts [--dry-run]
 *     [--max-age-minutes 120]
 *
 * A name is reaped only if it matches the pattern the check generates, so a
 * real database can never be selected. A listing that fails fails the run: an
 * unreadable server is not an empty one.
 */
import { parseArgs } from "node:util";

import { dropDatabase, withSql } from "./qa-deploy-paths-cloud";
import {
  redactSecrets,
  secretsInUrl,
  selectReapable,
} from "./qa-deploy-paths-lib";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "max-age-minutes": { type: "string", default: "120" },
    "dry-run": { type: "boolean", default: false },
    "admin-database-url": { type: "string" },
  },
});

const maxAgeMinutes = Number(values["max-age-minutes"]);
const dryRun = values["dry-run"] === true;
const adminUrl =
  values["admin-database-url"] ?? process.env.DEPLOY_CHECK_DATABASE_URL;

if (!Number.isFinite(maxAgeMinutes) || maxAgeMinutes < 10) {
  // Under ten minutes a reaper could delete under a run that is still going.
  console.error("--max-age-minutes must be a number of at least 10.");
  process.exit(2);
}
if (!adminUrl) {
  console.error(
    "No database server to sweep. Pass --admin-database-url (or set DEPLOY_CHECK_DATABASE_URL).",
  );
  process.exit(2);
}

const serverUrl: string = adminUrl;
const secrets = secretsInUrl(serverUrl);
const say = (message: string) =>
  console.log(redactSecrets(`[reap-deploy-paths] ${message}`, secrets));

const now = Date.now();
const minAgeSeconds = maxAgeMinutes * 60;
const reaped: string[] = [];
const failures: string[] = [];

function fail(label: string, error: unknown): void {
  failures.push(
    redactSecrets(
      `${label}: ${error instanceof Error ? error.message : String(error)}`,
      secrets,
    ),
  );
}

async function sweepDatabases(url: string): Promise<void> {
  const rows = await withSql(
    url,
    (sql) =>
      sql`select datname from pg_database where datname like 'an\\_deploy\\_ci\\_%'`,
  );
  const names = rows.map((row) => String(row.datname));
  const reapable = selectReapable(names, now, minAgeSeconds);
  say(
    `database: ${names.length} named like a deploy check, ${reapable.length} older than ${maxAgeMinutes} minutes.`,
  );
  for (const name of reapable) {
    if (dryRun) {
      say(`would drop database ${name}`);
      continue;
    }
    try {
      await dropDatabase(url, name);
      reaped.push(name);
      say(`dropped database ${name}`);
    } catch (error) {
      fail(`database ${name}`, error);
    }
  }
}

async function run(): Promise<void> {
  try {
    await sweepDatabases(serverUrl);
  } catch (error) {
    fail("database sweep", error);
  }
  say(
    `${dryRun ? "dry run: nothing dropped" : `dropped ${reaped.length}`}; ${failures.length} failure(s).`,
  );
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(failures.length > 0 ? 1 : 0);
}

void run();
