#!/usr/bin/env tsx
/**
 * Deletes what the deploy-path check leaked: Netlify sites and Postgres
 * databases it created that are old enough that no run can still be using
 * them. The check cleans up after itself on every exit, so this only matters
 * when a runner was killed or a cleanup failed, which is exactly when nothing
 * else will.
 *
 *   pnpm exec tsx scripts/reap-deploy-paths.ts [--dry-run]
 *     [--max-age-minutes 120] [--only netlify|databases]
 *
 * A name is reaped only if it matches the pattern the check generates, so a
 * real site or database can never be selected. A listing that fails fails the
 * run: an unreadable account is not an empty one.
 */
import { parseArgs } from "node:util";

import {
  deleteNetlifySite,
  dropDatabase,
  listNetlifySites,
  withSql,
} from "./qa-deploy-paths-cloud";
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
    only: { type: "string" },
    "admin-database-url": { type: "string" },
  },
});

const maxAgeMinutes = Number(values["max-age-minutes"]);
const dryRun = values["dry-run"] === true;
const only = values.only;
const adminUrl =
  values["admin-database-url"] ?? process.env.DEPLOY_CHECK_DATABASE_URL;

if (!Number.isFinite(maxAgeMinutes) || maxAgeMinutes < 10) {
  // Under ten minutes a reaper could delete under a run that is still going.
  console.error("--max-age-minutes must be a number of at least 10.");
  process.exit(2);
}
if (only !== undefined && only !== "netlify" && only !== "databases") {
  console.error("--only must be netlify or databases.");
  process.exit(2);
}
if (only !== "netlify" && !adminUrl) {
  console.error(
    "No database server to sweep. Pass --admin-database-url (or set DEPLOY_CHECK_DATABASE_URL), or --only netlify to sweep sites alone.",
  );
  process.exit(2);
}

const secrets = adminUrl ? secretsInUrl(adminUrl) : [];
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

// Each sweep fails on its own: an outage on one side must not stop the other
// side from being swept.
async function sweep(kind: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    fail(`${kind} sweep`, error);
  }
}

function reapAll(
  kind: string,
  names: string[],
  remove: (name: string) => void | Promise<void>,
): Promise<void> {
  const reapable = selectReapable(names, now, minAgeSeconds);
  say(
    `${kind}: ${names.length} named like a deploy check, ${reapable.length} older than ${maxAgeMinutes} minutes.`,
  );
  return reapable.reduce(async (previous, name) => {
    await previous;
    if (dryRun) {
      say(`would delete ${kind} ${name}`);
      return;
    }
    try {
      await remove(name);
      reaped.push(`${kind} ${name}`);
      say(`deleted ${kind} ${name}`);
    } catch (error) {
      fail(`${kind} ${name}`, error);
    }
  }, Promise.resolve());
}

async function main(): Promise<void> {
  if (only !== "databases") {
    await sweep("site", () =>
      reapAll(
        "site",
        listNetlifySites("an-deploy-ci-").map((site) => site.name),
        deleteNetlifySite,
      ),
    );
  }
  if (only !== "netlify" && adminUrl) {
    await sweep("database", async () => {
      const rows = await withSql(
        adminUrl,
        (sql) =>
          sql`select datname from pg_database where datname like 'an\\_deploy\\_ci\\_%'`,
      );
      await reapAll(
        "database",
        rows.map((row) => String(row.datname)),
        (name) => dropDatabase(adminUrl, name),
      );
    });
  }
}

async function run(): Promise<void> {
  await main();
  say(
    `${dryRun ? "dry run: nothing deleted" : `deleted ${reaped.length}`}; ${failures.length} failure(s).`,
  );
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(failures.length > 0 ? 1 : 0);
}

void run();
