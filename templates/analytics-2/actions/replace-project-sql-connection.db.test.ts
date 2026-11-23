import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
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
import {
  readProjectOutputs,
  writeCellOutput,
} from "../server/model/runs-store.js";
import { SAMPLE_DATA_SOURCE_ID } from "../shared/sample-data-contract.js";
import replace from "./replace-project-sql-connection.js";

const dir = mkdtempSync(join(tmpdir(), "replace-connection-"));
const previous = process.env.DATABASE_URL;
const owner = "replace-owner@example.test";
const orgId = `replace-${randomUUID()}`;
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
  await runMigrations([...ORG_MIGRATIONS], { table: "replace_org_migrations" })(
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

it("switches 57 SQL cells atomically, rejects a stale revision, and keeps their old outputs as stale behind a new generation", async () => {
  const cells = Array.from({ length: 57 }, (_, i) => ({
    kind: "sql" as const,
    label: `Panel ${i}`,
    hidden: true,
    gridX: null,
    gridY: null,
    gridWidth: null,
    gridHeight: null,
    source: `select ${i}`,
    dataConnectionId: "old-connection",
    databaseSchema: null,
    resultVariable: `v${i}`,
    outputResult: true,
  }));
  const project = await createProject({ ...scope, title: "Batch", cells });
  const before = await getProjectDocument(scope, project.id);
  if (!before) throw new Error("missing project");
  const expected = before.cells.map((c) => ({
    cellId: c.id,
    updatedAt: c.updatedAt,
  }));
  await getDb()
    .insert(schema.cellOutputs)
    .values(
      before.cells.map((c) => ({
        cellId: c.id,
        projectId: project.id,
        sourceConnectionId: "old-connection",
        connectionProvenanceRecorded: true,
        status: "complete" as const,
        output: null,
        ranAt: new Date().toISOString(),
      })),
    );
  await getDb()
    .insert(schema.cellOutputGenerations)
    .values(
      before.cells.map((c) => ({
        cellId: c.id,
        projectId: project.id,
        generation: "old-generation",
      })),
    );
  const input = {
    projectId: project.id,
    fromConnectionId: "old-connection",
    toConnectionId: SAMPLE_DATA_SOURCE_ID,
    expectedCells: expected,
  };
  await expect(
    actor(() =>
      replace.run({ ...input, expectedCells: expected.slice(1) }, context),
    ),
  ).rejects.toThrow();
  await expect(
    actor(() =>
      replace.run(
        { ...input, toConnectionId: "unavailable-connection" },
        context,
      ),
    ),
  ).rejects.toThrow();
  await expect(
    actor(() =>
      replace.run(
        {
          ...input,
          expectedCells: expected.map((c, i) =>
            i === 56 ? { ...c, updatedAt: "2000-01-01T00:00:00.000Z" } : c,
          ),
        },
        context,
      ),
    ),
  ).rejects.toThrow();
  expect((await getProjectDocument(scope, project.id))?.cells).toEqual(
    before.cells,
  );
  expect(Object.keys(await readProjectOutputs(scope, project.id))).toHaveLength(
    57,
  );
  const result = await actor(() => replace.run(input, context));
  expect(result.updatedCount).toBe(57);
  const after = await getProjectDocument(scope, project.id);
  expect(after?.cells.map((c) => c.contents)).toEqual(
    before.cells.map((c) => ({
      ...c.contents,
      dataConnectionId: SAMPLE_DATA_SOURCE_ID,
      connectionSelectedAt: expect.any(String),
    })),
  );
  const stale = Object.values(await readProjectOutputs(scope, project.id));
  expect(stale).toHaveLength(57);
  expect(
    stale.every((row) => row.sourceConnectionId === "old-connection"),
  ).toBe(true);
  const generations = await getDb().select().from(schema.cellOutputGenerations);
  expect(generations).toHaveLength(57);
  expect(generations.every((row) => row.generation !== "old-generation")).toBe(
    true,
  );
  const firstCell = expected.at(0);
  if (!firstCell) throw new Error("missing test cell");
  await expect(
    writeCellOutput({
      ...scope,
      projectId: project.id,
      cellId: firstCell.cellId,
      generation: "old-generation",
      sourceConnectionId: "old-connection",
      runId: null,
      status: "complete",
      output: null,
    }),
  ).rejects.toThrow("A newer run or cleared output owns this cell.");
  expect(Object.values(await readProjectOutputs(scope, project.id))).toEqual(
    stale,
  );
});
