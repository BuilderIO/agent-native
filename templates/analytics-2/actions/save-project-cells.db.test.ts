import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec, getDbExec, runMigrations } from "@agent-native/core/db";
import { eq } from "@agent-native/core/db/schema";
import {
  ORG_MIGRATIONS,
  appMemberRoles,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import {
  getRunTurnRef,
  runWithRequestContext,
} from "@agent-native/core/server";
import { afterAll, beforeAll, expect, it } from "vitest";

import { registerChatThreadsShareable } from "../../../packages/core/dist/chat-threads/store.js";
import type { ProjectDocument } from "../app/lib/model/contracts.js";
import { getDb, schema } from "../server/db/index.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { seedLegacyPublishedProject } from "../server/model/legacy-published-fixture.test-support.js";
import {
  createProject,
  getProjectDocument,
} from "../server/model/projects-store.js";
import {
  readProjectOutputs,
  writeCellOutput,
} from "../server/model/runs-store.js";
import { SAMPLE_DATA_SOURCE_ID } from "../shared/sample-data-contract.js";
import createNotebookThread from "./create-notebook-thread.js";
import decideNotebookPendingChanges from "./decide-notebook-pending-changes.js";
import getNotebookPendingChanges from "./get-notebook-pending-changes.js";
import saveBatch from "./save-project-cells.js";

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

async function toolContext(project: ProjectDocument) {
  const head = project.draftHead;
  if (!head) throw new Error("Expected an accepted draft head");
  const { threadId } = await actor(() =>
    createNotebookThread.run(
      { projectId: project.id, head, opId: randomUUID() },
      context,
    ),
  );
  const runId = randomUUID();
  const turnId = randomUUID();
  await getRunTurnRef(runId);
  await getDbExec().execute({
    sql: "INSERT INTO agent_runs (id, thread_id, status, started_at, turn_id) VALUES (?, ?, 'completed', ?, ?)",
    args: [runId, threadId, Date.now(), turnId],
  });
  return {
    ...context,
    caller: "tool" as const,
    threadId,
    runId,
    turnId,
    toolCallId: randomUUID(),
  };
}

beforeAll(async () => {
  registerChatThreadsShareable();
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

it("report A2-ATOMIC-CELL-SAVES: saves the observed set or leaves every cell and output unchanged", async () => {
  const project = await createProject({
    ...scope,
    title: "Batch",
    cells: Array.from({ length: 3 }, (_, i) => ({
      kind: "sql" as const,
      label: `Panel ${i}`,
      hidden: true,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      source: `select ${i}`,
      dataConnectionId: SAMPLE_DATA_SOURCE_ID,
      databaseSchema: null,
      resultVariable: `v${i}`,
      outputResult: true,
    })),
  });
  const before = await getProjectDocument(scope, project.id);
  if (!before) throw new Error("missing project");
  const edits = before.cells.slice(0, 2).map((cell, i) => ({
    cellId: cell.id,
    expectedUpdatedAt: cell.updatedAt,
    contents: { ...cell.contents, source: `select ${i + 10}` },
  }));
  const first = before.cells.at(0);
  if (!first) throw new Error("missing cell");
  await getDb().insert(schema.cellOutputs).values({
    cellId: first.id,
    projectId: project.id,
    sourceConnectionId: SAMPLE_DATA_SOURCE_ID,
    connectionProvenanceRecorded: true,
    status: "complete",
    output: null,
    ranAt: new Date().toISOString(),
  });
  await getDb().insert(schema.cellOutputGenerations).values({
    cellId: first.id,
    projectId: project.id,
    generation: "old-generation",
  });
  await expect(
    actor(() =>
      saveBatch.run(
        {
          projectId: project.id,
          cells: edits.map((edit, i) =>
            i === 1
              ? { ...edit, expectedUpdatedAt: "2000-01-01T00:00:00.000Z" }
              : edit,
          ),
        },
        context,
      ),
    ),
  ).rejects.toThrow();
  expect((await getProjectDocument(scope, project.id))?.cells).toEqual(
    before.cells,
  );
  expect(Object.keys(await readProjectOutputs(scope, project.id))).toEqual([
    first.id,
  ]);
  const result = await actor(() =>
    saveBatch.run({ projectId: project.id, cells: edits }, context),
  );
  expect(result.updatedCount).toBe(2);
  const after = await getProjectDocument(scope, project.id);
  expect(
    result.cells.map(({ cellId, updatedAt }) => ({ cellId, updatedAt })),
  ).toEqual(
    after?.cells
      .slice(0, 2)
      .map((c) => ({ cellId: c.id, updatedAt: c.updatedAt })),
  );
  expect(after?.cells.map((c) => c.contents)).toEqual(
    before.cells.map((c, i) => (i < 2 ? edits[i]?.contents : c.contents)),
  );
  expect(
    after?.cells
      .slice(0, 2)
      .every((c, i) => c.updatedAt > (before.cells[i]?.updatedAt ?? "")),
  ).toBe(true);
  expect(Object.keys(await readProjectOutputs(scope, project.id))).toEqual([
    first.id,
  ]);
  const fences = await getDb()
    .select()
    .from(schema.cellOutputGenerations)
    .where(eq(schema.cellOutputGenerations.cellId, first.id));
  expect(fences).toHaveLength(1);
  expect(fences[0]?.generation).not.toBe("old-generation");
  await expect(
    writeCellOutput({
      ...scope,
      projectId: project.id,
      cellId: first.id,
      generation: "old-generation",
      sourceConnectionId: SAMPLE_DATA_SOURCE_ID,
      runId: null,
      status: "complete",
      output: null,
    }),
  ).rejects.toThrow("A newer run or cleared output owns this cell.");
});

it("stages agent edits for review and rejects foreign projects and invalid late cells", async () => {
  const project = await createProject({
    ...scope,
    title: "Review batch",
    cells: Array.from({ length: 2 }, (_, i) => ({
      kind: "sql" as const,
      label: `Panel ${i}`,
      hidden: true,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      source: `select ${i}`,
      dataConnectionId: SAMPLE_DATA_SOURCE_ID,
      databaseSchema: null,
      resultVariable: `v${i}`,
      outputResult: true,
    })),
  });
  const before = await getProjectDocument(scope, project.id);
  if (!before) throw new Error("missing project");
  const edits = before.cells.map((cell, i) => ({
    cellId: cell.id,
    expectedUpdatedAt: cell.updatedAt,
    contents: { ...cell.contents, source: `select ${i + 20}` },
  }));
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId,
    email: "foreign@example.test",
    role: "owner",
    joinedAt: Date.now(),
  });
  await getDb().insert(appMemberRoles).values({
    id: randomUUID(),
    orgId,
    email: "foreign@example.test",
    appId: "analytics-2",
    role: "owner",
    updatedBy: owner,
    updatedAt: Date.now(),
  });
  const foreignActor = <T>(fn: () => T) =>
    runWithRequestContext(
      {
        userEmail: "foreign@example.test",
        orgId,
        authUserId: "foreign@example.test",
        userName: "Foreign",
        isSyntheticTraffic: true,
      },
      fn,
    );
  await expect(
    foreignActor(() =>
      saveBatch.run(
        { projectId: project.id, cells: edits },
        { ...context, userEmail: "foreign@example.test" },
      ),
    ),
  ).rejects.toThrow();
  const otherOrg = `other-${randomUUID()}`;
  await getDb().insert(organizations).values({
    id: otherOrg,
    name: "Other",
    createdBy: owner,
    createdAt: Date.now(),
  });
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId: otherOrg,
    email: owner,
    role: "owner",
    joinedAt: Date.now(),
  });
  await getDb().insert(appMemberRoles).values({
    id: randomUUID(),
    orgId: otherOrg,
    email: owner,
    appId: "analytics-2",
    role: "owner",
    updatedBy: owner,
    updatedAt: Date.now(),
  });
  await expect(
    runWithRequestContext(
      {
        userEmail: owner,
        orgId: otherOrg,
        authUserId: owner,
        userName: "Test",
        isSyntheticTraffic: true,
      },
      () =>
        saveBatch.run(
          { projectId: project.id, cells: edits },
          { ...context, orgId: otherOrg },
        ),
    ),
  ).rejects.toThrow();
  await expect(
    actor(() =>
      saveBatch.run(
        {
          projectId: project.id,
          cells: edits.map((edit, i) =>
            i === 1 ? { ...edit, cellId: "foreign-cell" } : edit,
          ),
        },
        context,
      ),
    ),
  ).rejects.toThrow();
  const foreignProject = await createProject({
    ...scope,
    title: "Other project",
    cells: [
      {
        kind: "sql",
        label: "Other",
        hidden: true,
        gridX: null,
        gridY: null,
        gridWidth: null,
        gridHeight: null,
        source: "select 99",
        dataConnectionId: SAMPLE_DATA_SOURCE_ID,
        databaseSchema: null,
        resultVariable: "other",
        outputResult: true,
      },
    ],
  });
  const foreignCell = foreignProject.cells.at(0);
  const firstEdit = edits.at(0);
  if (!foreignCell || !firstEdit) throw new Error("missing fixture");
  await expect(
    actor(() =>
      saveBatch.run(
        {
          projectId: project.id,
          cells: [
            firstEdit,
            {
              cellId: foreignCell.id,
              expectedUpdatedAt: foreignCell.updatedAt,
              contents: foreignCell.contents,
            },
          ],
        },
        context,
      ),
    ),
  ).rejects.toThrow();
  await expect(
    actor(() =>
      saveBatch.run(
        {
          projectId: project.id,
          cells: edits.map((edit, i) =>
            i === 1 && edit.contents.kind === "sql"
              ? {
                  ...edit,
                  contents: {
                    ...edit.contents,
                    dataConnectionId: "unavailable-connection",
                  },
                }
              : edit,
          ),
        },
        context,
      ),
    ),
  ).rejects.toThrow();
  expect((await getProjectDocument(scope, project.id))?.cells).toEqual(
    before.cells,
  );
  const tool = await toolContext(before);
  const result = await actor(() =>
    saveBatch.run({ projectId: project.id, cells: edits }, tool),
  );
  expect(result.cells.map((c) => c.editStatus)).toEqual([
    "pending_review",
    "pending_review",
  ]);
  expect(result.proposalIds?.length).toBeGreaterThan(0);
  expect((await getProjectDocument(scope, project.id))?.cells).toEqual(
    before.cells,
  );
  const key = { projectId: project.id, threadId: tool.threadId };
  const pending = await actor(() =>
    getNotebookPendingChanges.run(key, context),
  );
  expect(
    pending.changes.flatMap((change) =>
      (change.after?.cells ?? []).map(({ contents }) =>
        contents.kind === "sql" ? contents.source : null,
      ),
    ),
  ).toEqual(["select 20", "select 21"]);
  await actor(() =>
    decideNotebookPendingChanges.run(
      {
        ...key,
        opId: randomUUID(),
        expectedOverlayRevision: pending.overlayRevision,
        observedHead: pending.acceptedHead,
        selection: {
          kind: "all",
          reviewedSetDigest: pending.reviewedSetDigest,
        },
        decision: "confirm",
      },
      context,
    ),
  );
  const stored = await getProjectDocument(scope, project.id);
  expect(
    stored?.cells.map((c) =>
      c.contents.kind === "sql" ? c.contents.source : null,
    ),
  ).toEqual(["select 20", "select 21"]);
});

it("forks a legacy published working version only for a successful batch", async () => {
  const project = await createProject({
    ...scope,
    title: "Legacy",
    cells: [
      {
        kind: "sql",
        label: "Panel",
        hidden: true,
        gridX: null,
        gridY: null,
        gridWidth: null,
        gridHeight: null,
        source: "select 1",
        dataConnectionId: SAMPLE_DATA_SOURCE_ID,
        databaseSchema: null,
        resultVariable: "v",
        outputResult: true,
      },
    ],
  });
  const published = await seedLegacyPublishedProject(scope, project.id);
  if (!published.publishedVersionId)
    throw new Error("missing published version");
  await getDb()
    .update(schema.projects)
    .set({ workingVersionId: published.publishedVersionId })
    .where(eq(schema.projects.id, project.id));
  const before = await getProjectDocument(scope, project.id);
  const cell = before?.cells[0];
  if (!before || !cell || cell.contents.kind !== "sql")
    throw new Error("missing cell");
  const edit = {
    cellId: cell.id,
    expectedUpdatedAt: cell.updatedAt,
    contents: { ...cell.contents, source: "select 2" },
  };
  await expect(
    actor(() =>
      saveBatch.run(
        {
          projectId: project.id,
          cells: [{ ...edit, expectedUpdatedAt: "stale" }],
        },
        context,
      ),
    ),
  ).rejects.toThrow();
  expect((await getProjectDocument(scope, project.id))?.workingVersionId).toBe(
    published.publishedVersionId,
  );
  await actor(() =>
    saveBatch.run({ projectId: project.id, cells: [edit] }, context),
  );
  const after = await getProjectDocument(scope, project.id);
  expect(after?.workingVersionId).not.toBe(published.publishedVersionId);
  expect(after?.cells[0]?.contents).toMatchObject({ source: "select 2" });
});
