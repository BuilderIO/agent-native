import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { closeDbExec, getDbExec, getPgliteClient } from "../db/client.js";
import { withMigrationRuntime } from "../db/migration-runtime.js";
import {
  schemaFingerprint,
  type SchemaFingerprint,
} from "../db/schema-catalog.js";
import { runFrameworkReleaseMigrations } from "./release-migrations.js";

/**
 * Every database created by an older release must converge to the schema a
 * fresh database gets. A migration edited after it shipped, or a column added
 * only to a CREATE TABLE, passes every other check and silently never reaches
 * existing databases; this is the check that sees it.
 *
 * The fixture is what `origin/main` produced before the store registry
 * (`scripts/dump-release-schema.ts --core <old checkout>`). Add a newer fixture
 * beside it when a release line becomes the support floor; keep the old ones.
 */
const FIXTURES = ["release-schema-main-2026-10-15.sql"];

/**
 * Drift that exists in both directions independently of this check, each with
 * the reason it is tolerated. Remove an entry when its fixing migration lands.
 */
const KNOWN_DRIFT: string[] = [];

const previousUrl = process.env.DATABASE_URL;
const dirs: string[] = [];

async function release(prepare?: (url: string) => Promise<void>) {
  await closeDbExec();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-upgrade-"));
  dirs.push(dir);
  const url = `pglite:${dir}`;
  process.env.DATABASE_URL = url;
  if (prepare) await prepare(url);
  await withMigrationRuntime(() => runFrameworkReleaseMigrations(null));
  return schemaFingerprint(getDbExec());
}

function drift(a: SchemaFingerprint, b: SchemaFingerprint): string[] {
  const out: string[] = [];
  for (const key of ["tables", "columns", "indexes", "constraints"] as const) {
    const left = new Set(a[key]);
    const right = new Set(b[key]);
    for (const item of left)
      if (!right.has(item)) out.push(`fresh only: ${item}`);
    for (const item of right)
      if (!left.has(item)) out.push(`upgraded only: ${item}`);
  }
  return out.filter((entry) => !KNOWN_DRIFT.includes(entry)).sort();
}

afterAll(async () => {
  await closeDbExec();
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe("release schema upgrade convergence", () => {
  it.each(FIXTURES)(
    "a database created by %s upgrades to the fresh schema",
    async (fixture) => {
      const fresh = await release();
      const sql = fs.readFileSync(
        path.join(import.meta.dirname, "__fixtures__", fixture),
        "utf8",
      );
      const upgraded = await release(async (url) => {
        const client = await getPgliteClient(url);
        await client.exec(sql);
      });

      expect(drift(fresh, upgraded)).toEqual([]);
    },
    300_000,
  );
});
