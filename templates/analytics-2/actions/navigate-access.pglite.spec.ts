import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import { ORG_MIGRATIONS } from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";

const write = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/application-state", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/application-state")
  >()),
  writeAppStateForCurrentTab: write,
}));
import { getDb } from "../server/db/index.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { createProject } from "../server/model/projects-store.js";
import navigate from "./navigate.js";

let directory: string | undefined;
afterEach(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
  if (directory) await rm(directory, { recursive: true, force: true });
});

it("only queues navigation to a project readable in the current workspace", async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "analytics-navigation-"));
  vi.stubEnv("DATABASE_URL", `pglite:${path.join(directory, "db")}`);
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  await closeDbExec();
  await runMigrations(ORG_MIGRATIONS, { table: "test_org_migrations" })(
    undefined,
  );
  await ensureAnalyticsDatabase();
  await getDb().execute(
    sql`INSERT INTO organizations (id,name,created_by,created_at) VALUES ('org-1','Workspace','owner@example.test',1)`,
  );
  await getDb().execute(
    sql`INSERT INTO org_members (id,org_id,email,role,joined_at) VALUES ('owner','org-1','owner@example.test','owner',1), ('viewer','org-1','viewer@example.test','member',1)`,
  );
  const owner = <T>(fn: () => Promise<T>) =>
    runWithRequestContext(
      { userEmail: "owner@example.test", orgId: "org-1" },
      fn,
    );
  const viewer = <T>(fn: () => Promise<T>) =>
    runWithRequestContext(
      { userEmail: "viewer@example.test", orgId: "org-1" },
      fn,
    );
  await owner(() =>
    createProject({
      ownerEmail: "owner@example.test",
      orgId: "org-1",
      projectId: "private-project",
      title: "Private",
    }),
  );
  await expect(
    viewer(() =>
      navigate.run(
        { path: "/home/../project/private-project/latest/" },
        {} as never,
      ),
    ),
  ).rejects.toMatchObject({ errorCode: "project_not_found" });
  expect(write).not.toHaveBeenCalled();
  await owner(() =>
    navigate.run({ projectId: "private-project" }, {} as never),
  );
  expect(write).toHaveBeenCalledWith(
    "navigate",
    expect.objectContaining({ path: "/project/private-project/latest" }),
  );
});
