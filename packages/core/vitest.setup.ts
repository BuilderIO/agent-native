import path from "node:path";

import { afterAll, inject } from "vitest";

import { isolateUserHome } from "./vitest.isolated-home";

// No test may touch the developer's real home folder; see vitest.isolated-home.ts.
const isolatedHome = isolateUserHome();
afterAll(() => isolatedHome.restore());

// Node 25+ has a global localStorage getter that returns undefined without a
// --localstorage-file. Restore the DOM environment's storage for browser specs.
const domGlobal = globalThis as typeof globalThis & {
  jsdom?: { window: Pick<Window, "localStorage" | "sessionStorage"> };
};
for (const name of ["localStorage", "sessionStorage"] as const) {
  const current = (domGlobal as Partial<typeof domGlobal>)[name];
  if (typeof current?.clear === "function") continue;
  const storage =
    domGlobal.jsdom?.window[name] ??
    (typeof domGlobal.document !== "undefined" &&
    typeof domGlobal.Storage === "function"
      ? new domGlobal.Storage()
      : undefined);
  if (!storage) continue;
  Object.defineProperty(globalThis, name, {
    value: storage,
    configurable: true,
    writable: true,
  });
}

// Test files run in parallel worker processes. A file that opens the database
// without DATABASE_URL gets the ./data/pglite default, and that directory's
// process lock admits one process at a time, so parallel files collide on it.
// One directory per worker slot keeps what a single worker had: files that run
// in the same slot one after another reuse its already-migrated database.
const poolId = process.env.VITEST_POOL_ID;
if (!process.env.DATABASE_URL && poolId) {
  const dataDir = path.join(inject("pgliteRoot"), `slot-${poolId}`);
  process.env.DATABASE_URL = `pglite:${dataDir}`; // guard:allow-env-mutation — Vitest setup runs once per test process, before any test code
}
