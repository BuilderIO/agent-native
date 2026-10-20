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

/**
 * `runMigrations` bookkeeping for lists folded into stores. Older databases
 * keep these tables (nothing is dropped); fresh ones never create them.
 */
const RETIRED_BOOKKEEPING =
  /: _(?!an_store_)[a-z_]+_migrations(?:_named)?(?:[ .]|$)/;

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
  return out
    .filter((entry) => !KNOWN_DRIFT.includes(entry))
    .filter((entry) => !RETIRED_BOOKKEEPING.test(entry))
    .sort();
}

describe("local boot against a database an older release created", () => {
  it("imports the boot-time lists' history instead of re-running them", async () => {
    await closeDbExec();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-upgrade-"));
    dirs.push(dir);
    const url = `pglite:${dir}`;
    process.env.DATABASE_URL = url;
    const client = await getPgliteClient(url);
    await client.exec(
      fs.readFileSync(
        path.join(import.meta.dirname, "__fixtures__", FIXTURES[0]),
        "utf8",
      ),
    );

    const [
      { orgStore },
      { contextXrayStore },
      { observationalMemoryStore },
      { betterAuthStore, BETTER_AUTH_MIGRATIONS },
    ] = await Promise.all([
      import("../org/schema-store.js"),
      import("../agent/context-xray/schema-store.js"),
      import("../agent/observational-memory/store.js"),
      import("./better-auth-migrations.js"),
    ]);
    // Better Auth first, as the auth plugin boots it; its v4 expires every
    // signing key, so it must import here, never run.
    await betterAuthStore.ready();
    await orgStore.ready();
    await contextXrayStore.ready();
    await observationalMemoryStore.ready();

    const { rows } = await getDbExec().execute(
      `SELECT store_id, count(*) FILTER (WHERE source = 'legacy')::int AS legacy,
              count(*) FILTER (WHERE source = 'step')::int AS step
         FROM _an_store_migrations
        WHERE store_id IN ('better_auth', 'org', 'context_xray')
        GROUP BY store_id ORDER BY store_id`,
    );
    expect(rows).toEqual([
      {
        store_id: "better_auth",
        legacy: BETTER_AUTH_MIGRATIONS.length,
        step: 0,
      },
      { store_id: "context_xray", legacy: 3, step: 0 },
      { store_id: "org", legacy: 34, step: 0 },
    ]);
  }, 300_000);
});

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
      // Entries the old database applied through versioned lists are imported
      // into the ledger, not run again.
      const { rows } = await getDbExec().execute(
        "SELECT count(*)::int AS n FROM _an_store_migrations WHERE source = 'legacy'",
      );
      expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(112);
    },
    300_000,
  );
});
