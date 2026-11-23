import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { closeDbExec, getDbExec, sql } from "@agent-native/core/db";
import { afterAll, expect, it, vi } from "vitest";

import { ensureAnalyticsDatabase } from "./database.js";
import { clearCategoryAssignments } from "./project-categories.js";

let dir: string | undefined;
afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
  if (dir) await rm(dir, { recursive: true, force: true });
});
it("clears only the scoped category assignments when the Drizzle handle starts cold", async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "analytics-categories-"));
  vi.stubEnv("DATABASE_URL", `pglite:${path.join(dir, "db")}`);
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  await closeDbExec();
  await ensureAnalyticsDatabase();
  const db = getDbExec();
  for (const [id, owner] of [
    ["mine", "me@example.test"],
    ["theirs", "other@example.test"],
  ]) {
    await db.execute(
      sql`INSERT INTO analytics2_projects (id, owner_email, org_id, working_version_id, created_at, updated_at) VALUES (${sql.value(id)}, ${sql.value(owner)}, 'org', ${sql.value(id)}, 'now', 'now')`,
    );
    await db.execute(
      sql`INSERT INTO analytics2_project_categories (project_id, category_id, added_at) VALUES (${sql.value(id)}, 'category', 'now')`,
    );
  }
  await clearCategoryAssignments(
    { ownerEmail: "me@example.test", orgId: "org" },
    "category",
  );
  const result = await db.execute(
    sql`SELECT project_id FROM analytics2_project_categories ORDER BY project_id`,
  );
  expect(result.rows).toEqual([{ project_id: "theirs" }]);
});
