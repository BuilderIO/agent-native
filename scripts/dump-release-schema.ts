/**
 * Writes the schema a release step leaves on an empty database, as replayable
 * SQL with migration bookkeeping rows. Point `--core` at an older checkout's
 * `packages/core/src` to produce the upgrade fixture that
 * `release-schema.upgrade.spec.ts` replays and upgrades.
 *
 *   tsx scripts/dump-release-schema.ts --core ../old/packages/core/src --out <file>
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { dumpSchemaSql } from "../packages/core/src/db/schema-catalog.js";

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

const core = path.resolve(arg("core", "packages/core/src"));
const out = path.resolve(arg("out"));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-schema-"));
process.env.DATABASE_URL = `pglite:${dataDir}`;

const load = (rel: string) => import(pathToFileURL(path.join(core, rel)).href);
const { closeDbExec, getDbExec } = await load("db/client.ts");
const { withMigrationRuntime } = await load("db/migration-runtime.ts");
const { runFrameworkReleaseMigrations } = await load(
  "server/release-migrations.ts",
);

try {
  await withMigrationRuntime(() => runFrameworkReleaseMigrations(null));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, await dumpSchemaSql(getDbExec()), "utf8");
  console.log(`Wrote ${path.relative(process.cwd(), out)}`);
} finally {
  await closeDbExec();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
