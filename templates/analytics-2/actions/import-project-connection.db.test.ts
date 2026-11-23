import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import { eq } from "@agent-native/core/db/schema";
import {
  ORG_MIGRATIONS,
  appMemberRoles,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, expect, it } from "vitest";

import { getDb, schema } from "../server/db/index.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import {
  createProject,
  getProjectDocument,
} from "../server/model/projects-store.js";
import { SAMPLE_DATA_SOURCE_ID } from "../shared/sample-data-contract.js";
import getProject from "./get-project.js";
import importConnection from "./import-project-connection.js";

const dir = mkdtempSync(join(tmpdir(), "import-connection-"));
const previous = process.env.DATABASE_URL;
const owner = "import-owner@example.test";
const orgId = `import-${randomUUID()}`;
const scope = { ownerEmail: owner, orgId };
const context = {
  caller: "frontend" as const,
  userEmail: owner,
  orgId,
  appId: "analytics-2",
};
const actor = <T>(fn: () => T) =>
  runWithRequestContext(
    {
      userEmail: owner,
      orgId,
      authUserId: owner,
      userName: "Test",
      isSyntheticTraffic: true,
    },
    fn,
  );

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(dir, "db")}`;
  await runMigrations([...ORG_MIGRATIONS], { table: "import_org_migrations" })(
    null,
  );
  await ensureAnalyticsDatabase();
  await getDb().insert(organizations).values({
    id: orgId,
    name: "Test",
    createdBy: owner,
    createdAt: Date.now(),
  });
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId,
    email: owner,
    role: "owner",
    joinedAt: Date.now(),
  });
  await getDb().insert(appMemberRoles).values({
    id: randomUUID(),
    orgId,
    email: owner,
    appId: "analytics-2",
    role: "owner",
    updatedBy: owner,
    updatedAt: Date.now(),
  });
});
afterAll(async () => {
  await closeDbExec();
  if (previous === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previous;
  rmSync(dir, { recursive: true, force: true });
});

it("links a connection to the project without adding a cell, repeats safely, and returns it from get-project", async () => {
  const project = await createProject({ ...scope, title: "Linked" });
  const before = await getProjectDocument(scope, project.id);
  const input = { projectId: project.id, connectionId: SAMPLE_DATA_SOURCE_ID };

  const first = await actor(() => importConnection.run(input, context));
  const again = await actor(() => importConnection.run(input, context));
  expect(first).toEqual({
    projectId: project.id,
    connectionId: SAMPLE_DATA_SOURCE_ID,
  });
  expect(again).toEqual(first);

  const rows = await getDb()
    .select()
    .from(schema.projectConnectionLinks)
    .where(eq(schema.projectConnectionLinks.projectId, project.id));
  expect(rows.map((row) => row.connectionId)).toEqual([SAMPLE_DATA_SOURCE_ID]);
  expect((await getProjectDocument(scope, project.id))?.cells).toEqual(
    before?.cells,
  );

  const read = await actor(() =>
    getProject.run({ projectId: project.id }, context),
  );
  expect(read.importedConnectionIds).toEqual([SAMPLE_DATA_SOURCE_ID]);
});

it("rejects a connection the workspace cannot use and links nothing", async () => {
  const project = await createProject({ ...scope, title: "Rejected" });
  await expect(
    actor(() =>
      importConnection.run(
        { projectId: project.id, connectionId: "unavailable-connection" },
        context,
      ),
    ),
  ).rejects.toThrow();
  const rows = await getDb()
    .select()
    .from(schema.projectConnectionLinks)
    .where(eq(schema.projectConnectionLinks.projectId, project.id));
  expect(rows).toEqual([]);
});
