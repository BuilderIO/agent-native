import { afterEach, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { resetAppConfigForTests } from "../app-config/index.js";
import { withDbExec, type DbExec } from "../db/client.js";
import { ensureWorkspaceUserGroupsTable } from "./groups.js";

afterEach(() => {
  vi.unstubAllEnvs();
  resetAppConfigForTests();
});

it("provisions group-sharing dependencies on a fresh hosted database without release migrations", async () => {
  const database = await createTestPglite();
  const exec: DbExec = {
    async execute(input) {
      if (typeof input === "string") {
        await database.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      const result = await database.query(input.sql, input.args);
      return { rows: result.rows, rowsAffected: result.affectedRows ?? 0 };
    },
  };
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NETLIFY", "true");
  vi.stubEnv("AGENT_NATIVE_RELEASE_MIGRATIONS", "0");
  resetAppConfigForTests();
  try {
    await withDbExec(exec, () => ensureWorkspaceUserGroupsTable());
    await expect(
      database.query("SELECT id FROM public.workspace_user_groups"),
    ).resolves.toMatchObject({ rows: [] });
    await database.exec(
      "INSERT INTO public.workspace_user_groups (id, org_id, name) VALUES ('qa-group', 'qa-org', ' QA Group ')",
    );
    expect(
      (
        await database.query(
          "SELECT normalized_name FROM public.workspace_user_groups",
        )
      ).rows,
    ).toEqual([{ normalized_name: "qa group" }]);
  } finally {
    await database.close();
  }
});
