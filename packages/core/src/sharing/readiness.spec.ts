import { sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";

import { resetAppConfigForTests } from "../app-config/index.js";
import { closeDbExec, getDbExec } from "../db/client.js";
import { createGetDb } from "../db/create-get-db.js";
import { registerShareableResource } from "./registry.js";

vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  // Exercise hosted-replay with a real local SQL engine, without authorizing a
  // deployed server to use local storage.
  isProductionServerlessFunctionRuntime: () => true,
}));

afterEach(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
  resetAppConfigForTests();
});

it("makes the first registered group-sharing query wait for its missing table", async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory");
  vi.stubEnv("AGENT_NATIVE_RELEASE_MIGRATIONS", "0");
  resetAppConfigForTests();
  await closeDbExec();
  const getDb = createGetDb({});
  registerShareableResource({
    type: "qa-readiness-resource",
    resourceTable: {},
    sharesTable: {},
    displayName: "QA resource",
    supportsGroupShares: true,
    getDb,
  });
  const before = await getDbExec().execute({
    sql: "SELECT to_regclass('public.workspace_user_groups') AS relation",
  });
  expect(before.rows).toEqual([{ relation: null }]);
  const rows = await getDb().execute(
    sql`SELECT id FROM public.workspace_user_groups`,
  );
  expect(rows.rows).toEqual([]);
});
