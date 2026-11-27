import path from "node:path";

import { inject } from "vitest";

const poolId = process.env.VITEST_POOL_ID;
if (!process.env.DATABASE_URL && poolId) {
  const dataDir = path.join(inject("pgliteRoot"), `slot-${poolId}`);
  process.env.DATABASE_URL = `pglite:${dataDir}`; // guard:allow-env-mutation — Vitest setup runs once per test process, before any test code
}
