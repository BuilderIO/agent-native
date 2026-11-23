import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec, getDbExec, runMigrations } from "@agent-native/core/db";
import { eq } from "@agent-native/core/db/schema";
import {
  ORG_MIGRATIONS,
  organizations,
  orgMembers,
  orgInvitations,
} from "@agent-native/core/org";
import {
  getRunTurnRef,
  runWithRequestContext,
} from "@agent-native/core/server";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { registerChatThreadsShareable } from "../../../packages/core/dist/chat-threads/store.js";
import { getDb, schema } from "../server/db/index.js";
import {
  ANALYTICS_CONTROL_IDS,
  evaluateDraftRunPermission,
} from "../server/lib/analytics-capabilities.js";
import { requireManageableProject } from "../server/lib/project-action-access.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { seedLegacyPublishedProject } from "../server/model/legacy-published-fixture.test-support.js";
import { getReadableProjectRow } from "../server/model/project-access.js";
import { createProject } from "../server/model/projects-store.js";
import addProjectCell from "./add-project-cell.js";
import createNotebookThread from "./create-notebook-thread.js";
import getNotebookPendingChanges from "./get-notebook-pending-changes.js";
import getProject from "./get-project.js";
import saveProjectCell from "./save-project-cell.js";

const dir = mkdtempSync(join(tmpdir(), "invite-project-"));
const previous = process.env.DATABASE_URL;
const orgA = `invite-a-${randomUUID()}`,
  orgB = `invite-b-${randomUUID()}`;
const owner = "invite-owner@example.test",
  viewer = "invite-viewer@example.test";
const context = {
  caller: "frontend" as const,
  userEmail: viewer,
  orgId: orgB,
  appId: "analytics-2",
};
const read = (projectId: string, version?: string) =>
  runWithRequestContext(
    {
      userEmail: viewer,
      orgId: orgB,
      authUserId: viewer,
      userName: viewer,
      isSyntheticTraffic: true,
    },
    () => getProject.run({ projectId, version }, context),
  );
let projectId: string;
let project: Awaited<ReturnType<typeof createProject>>;

beforeAll(async () => {
  registerChatThreadsShareable();
  process.env.DATABASE_URL = `pglite:${join(dir, "db")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "invite_project_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  for (const id of [orgA, orgB])
    await getDb().insert(organizations).values({
      id,
      name: "Workspace",
      createdBy: owner,
      createdAt: Date.now(),
    });
  await getDb()
    .insert(orgMembers)
    .values([
      {
        id: randomUUID(),
        orgId: orgA,
        email: owner,
        role: "owner",
        joinedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId: orgB,
        email: viewer,
        role: "owner",
        joinedAt: Date.now(),
      },
    ]);
  project = await createProject({
    ownerEmail: owner,
    orgId: orgA,
    title: "Invited project",
    cells: [
      {
        id: `cel_${randomUUID()}`,
        kind: "sql",
        source: "select 1",
        label: null,
        hidden: false,
        gridX: null,
        gridY: null,
        gridWidth: null,
        gridHeight: null,
        dataConnectionId: null,
        databaseSchema: null,
        resultVariable: "one",
        outputResult: true,
      },
    ],
  });
  projectId = project.id;
}, 60_000);
beforeEach(async () => {
  await getDb().delete(orgInvitations);
  await getDb().delete(schema.projectShares);
});
afterAll(async () => {
  await closeDbExec();
  if (previous === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previous;
  rmSync(dir, { recursive: true, force: true });
});

it("report A2-PENDING-INVITE-DOCUMENT-404-1121: opens a directly shared project for its pending invitee without granting edits", async () => {
  const cell = project.cells[0];
  if (!cell || cell.contents.kind !== "sql" || !project.draftHead)
    throw new Error("Expected a SQL draft");
  const head = project.draftHead;
  const contents = cell.contents;
  const ownerContext = { ...context, userEmail: owner, orgId: orgA };
  const asOwner = <T>(call: () => T) =>
    runWithRequestContext(
      { userEmail: owner, orgId: orgA, authUserId: owner },
      call,
    );
  const { threadId } = await asOwner(() =>
    createNotebookThread.run(
      { projectId, head, opId: randomUUID() },
      ownerContext,
    ),
  );
  const runId = randomUUID();
  const turnId = randomUUID();
  await getRunTurnRef(runId);
  await getDbExec().execute({
    sql: "INSERT INTO agent_runs (id, thread_id, status, started_at, turn_id) VALUES (?, ?, 'completed', ?, ?)",
    args: [runId, threadId, Date.now(), turnId],
  });
  await asOwner(() =>
    saveProjectCell.run(
      {
        projectId,
        cellId: cell.id,
        contents: { ...contents, source: "select 2" },
        expectedUpdatedAt: cell.updatedAt,
      },
      {
        ...ownerContext,
        caller: "tool",
        threadId,
        runId,
        turnId,
        toolCallId: randomUUID(),
      },
    ),
  );
  const staged = await asOwner(() =>
    getNotebookPendingChanges.run({ projectId, threadId }, ownerContext),
  );
  expect(staged.changes).toHaveLength(1);
  await getDb().insert(orgInvitations).values({
    id: randomUUID(),
    orgId: orgA,
    email: viewer,
    invitedBy: owner,
    createdAt: Date.now(),
    status: "pending",
  });
  await getDb().insert(schema.projectShares).values({
    id: randomUUID(),
    resourceId: projectId,
    principalType: "user",
    principalId: viewer,
    role: "viewer",
    createdBy: owner,
    createdAt: new Date().toISOString(),
  });
  const result = await read(projectId);
  expect(result.project.id).toBe(projectId);
  expect(result.project.cells[0]?.contents).toMatchObject({
    source: "select 1",
  });
  expect(result.project.cells[0]?.contents).not.toHaveProperty("pendingEdit");
  expect(result.canEdit).toBe(false);
  expect(result.queryStates).toEqual({});
});

it("denies a direct grant without an invitation and an invitation without a grant", async () => {
  await getDb().insert(schema.projectShares).values({
    id: randomUUID(),
    resourceId: projectId,
    principalType: "user",
    principalId: viewer,
    role: "viewer",
    createdBy: owner,
    createdAt: new Date().toISOString(),
  });
  await expect(read(projectId)).rejects.toThrow();
  await getDb().insert(orgInvitations).values({
    id: randomUUID(),
    orgId: orgA,
    email: viewer,
    invitedBy: owner,
    createdAt: Date.now(),
    status: "pending",
  });
  await getDb()
    .delete(schema.projectShares)
    .where(eq(schema.projectShares.resourceId, projectId));
  await expect(read(projectId)).rejects.toThrow();
});

it("keeps a pending editor read-only even when they administer their active workspace", async () => {
  await getDb().insert(orgInvitations).values({
    id: randomUUID(),
    orgId: orgA,
    email: viewer,
    invitedBy: owner,
    createdAt: Date.now(),
    status: "pending",
  });
  await getDb().insert(schema.projectShares).values({
    id: randomUUID(),
    resourceId: projectId,
    principalType: "user",
    principalId: viewer,
    role: "editor",
    createdBy: owner,
    createdAt: new Date().toISOString(),
  });
  const result = await read(projectId);
  expect(result.canEdit).toBe(false);
  expect(result.queryStates).toEqual({});
  await expect(
    runWithRequestContext(
      { userEmail: viewer, orgId: orgB, authUserId: viewer },
      () =>
        addProjectCell.run(
          { projectId, kind: "sql", source: "select 2" },
          context,
        ),
    ),
  ).rejects.toThrow();
  const decision = await runWithRequestContext(
    { userEmail: viewer, orgId: orgB, authUserId: viewer },
    () =>
      evaluateDraftRunPermission(ANALYTICS_CONTROL_IDS.runDraftSql, {
        kind: "project",
        workspaceId: orgB,
        projectId,
      }),
  );
  expect(decision.status).not.toBe("allowed");
  await getDb()
    .update(schema.projectShares)
    .set({ role: "admin" })
    .where(eq(schema.projectShares.resourceId, projectId));
  await expect(read(projectId)).resolves.toMatchObject({ canEdit: false });
  await expect(
    runWithRequestContext(
      { userEmail: viewer, orgId: orgB, authUserId: viewer },
      () => requireManageableProject(projectId),
    ),
  ).rejects.toMatchObject({ errorCode: "project_not_found" });
});

it("reads the published snapshot for a pending viewer", async () => {
  await seedLegacyPublishedProject(
    { ownerEmail: owner, orgId: orgA },
    projectId,
  );
  await getDb().insert(orgInvitations).values({
    id: randomUUID(),
    orgId: orgA,
    email: viewer,
    invitedBy: owner,
    createdAt: Date.now(),
    status: "pending",
  });
  await getDb().insert(schema.projectShares).values({
    id: randomUUID(),
    resourceId: projectId,
    principalType: "user",
    principalId: viewer,
    role: "viewer",
    createdBy: owner,
    createdAt: new Date().toISOString(),
  });
  const result = await read(projectId, "latest");
  expect(result.project.cells[0]?.contents).toMatchObject({
    source: "select 1",
  });
  expect(result.canEdit).toBe(false);
});

it("report A2-PROJECT-OWNER-CROSS-ORG-READ-1121: does not treat ownership in another workspace as a pending invitation", async () => {
  await expect(
    getReadableProjectRow({ ownerEmail: owner, orgId: orgB }, projectId),
  ).resolves.toBeNull();
});
