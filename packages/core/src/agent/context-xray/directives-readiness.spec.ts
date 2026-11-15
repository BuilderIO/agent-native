import { afterEach, expect, it, vi } from "vitest";

import { resetAppConfigForTests } from "../../app-config/index.js";
import { closeDbExec, getDbExec } from "../../db/client.js";
import { listObservationalMemory } from "../observational-memory/store.js";
import { loadContextDirectives } from "./directives-store.js";

afterEach(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
  resetAppConfigForTests();
});

it("initializes optional memory stores at first use on a fresh database without plugin boot", async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory");
  resetAppConfigForTests();
  await closeDbExec();
  const before = await getDbExec().execute({
    sql: "SELECT to_regclass('public.context_directives') AS relation",
  });
  expect(before.rows).toEqual([{ relation: null }]);
  expect(
    await loadContextDirectives("qa-thread", { ownerEmail: "qa@example.com" }),
  ).toEqual(new Map());
  expect(
    await listObservationalMemory({
      threadId: "qa-thread",
      ownerEmail: "qa@example.com",
    }),
  ).toEqual([]);
});
