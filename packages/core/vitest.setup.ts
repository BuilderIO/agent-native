import path from "node:path";

import { inject } from "vitest";

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
