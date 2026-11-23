import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { registerChatThreadsShareable } from "../../../packages/core/dist/chat-threads/store.js";
import type {
  CellContents,
  ProjectDocument,
} from "../app/lib/model/contracts.js";
import { getDb, schema } from "../server/db/index.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { seedLegacyPublishedProject } from "../server/model/legacy-published-fixture.test-support.js";
import { createProject } from "../server/model/projects-store.js";
import { recordRun } from "../server/model/runs-store.js";
import addProjectCell from "./add-project-cell.js";
import createNotebookThread from "./create-notebook-thread.js";
import deleteProjectCell from "./delete-project-cell.js";
import getNotebookPendingChanges from "./get-notebook-pending-changes.js";
import getProject from "./get-project.js";
import publishProjectAction from "./publish-project.js";
import restoreProjectVersion from "./restore-project-version.js";
import saveProjectCell from "./save-project-cell.js";
import updateProject from "./update-project.js";

const round = mkdtempSync(join(tmpdir(), "get-project-shared-viewer-"));
const previousDatabase = process.env.DATABASE_URL;
const orgA = `qa-shared-viewer-a-${randomUUID()}`;
const orgB = `qa-shared-viewer-b-${randomUUID()}`;
const owner = "shared-owner@example.test";
const viewer = "shared-viewer@example.test";
const commenter = "shared-commenter@example.test";
const orgMember = "shared-org-member@example.test";
const stranger = "shared-stranger@example.test";
const foreign = "shared-foreign@example.test";
const appId = "analytics-2";
const scopeA = { ownerEmail: owner, orgId: orgA };

const asActor = <T>(email: string, orgId: string, call: () => T) =>
  runWithRequestContext(
    {
      userEmail: email,
      orgId,
      authUserId: email,
      userName: "QA test account",
      isSyntheticTraffic: true,
    },
    call,
  );
const context = (email: string, orgId = orgA) => ({
  caller: "frontend" as const,
  userEmail: email,
  orgId,
  appId,
});
const read = (
  email: string,
  projectId: string,
  extra: { version?: string; surface?: "app"; viewId?: string } = {},
  orgId = orgA,
) =>
  asActor(email, orgId, () =>
    getProject.run({ projectId, ...extra }, context(email, orgId)),
  );

const sqlCell = (id: string, source: string, resultVariable: string) =>
  ({
    label: null,
    hidden: false,
    gridX: null,
    gridY: null,
    gridWidth: null,
    gridHeight: null,
    id,
    kind: "sql",
    source,
    dataConnectionId: null,
    databaseSchema: null,
    resultVariable,
    outputResult: true,
  }) as const;

const sqlContents = (
  cell: { contents: CellContents },
  source: string,
): CellContents => {
  if (cell.contents.kind !== "sql") throw new Error("Not a SQL cell.");
  return { ...cell.contents, source };
};

const share = async (
  projectId: string,
  principalType: "user" | "org",
  principalId: string,
  role: "viewer" | "commenter",
) => {
  await getDb()
    .insert(schema.projectShares)
    .values({
      id: `shr_${randomUUID()}`,
      resourceId: projectId,
      principalType,
      principalId,
      role,
      createdBy: owner,
      createdAt: new Date().toISOString(),
    });
};

const freshProject = async (title: string): Promise<ProjectDocument> =>
  createProject({
    ...scopeA,
    title,
    cells: [sqlCell(`cel_${randomUUID()}`, "select 1", "one")],
  });

beforeAll(async () => {
  registerChatThreadsShareable();
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_shared_viewer_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  for (const id of [orgA, orgB]) {
    await getDb().insert(organizations).values({
      id,
      name: "QA shared viewer workspace",
      createdBy: owner,
      createdAt: Date.now(),
    });
  }
  const member = (orgId: string, email: string, role: "owner" | "member") => ({
    id: randomUUID(),
    orgId,
    email,
    role,
    joinedAt: Date.now(),
  });
  await getDb()
    .insert(orgMembers)
    .values([
      member(orgA, owner, "owner"),
      member(orgA, viewer, "member"),
      member(orgA, commenter, "member"),
      member(orgA, orgMember, "member"),
      member(orgA, stranger, "member"),
      member(orgB, foreign, "owner"),
      member(orgB, viewer, "member"),
    ]);
  await getDb()
    .insert(appMemberRoles)
    .values(
      [viewer, commenter, orgMember, stranger].map((email) => ({
        id: randomUUID(),
        orgId: orgA,
        email,
        appId,
        role: "editor",
        updatedBy: owner,
        updatedAt: Date.now(),
      })),
    );
}, 60_000);

afterAll(async () => {
  await closeDbExec();
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  const owned = resolve(round);
  if (owned.startsWith(resolve(tmpdir()))) {
    rmSync(owned, { recursive: true, force: true });
  }
});

describe("an unpublished project shared with a direct viewer or commenter", () => {
  it("opens read-only for both roles, without staged edits or live query state", async () => {
    const project = await freshProject("QA unpublished shared");
    const cell = project.cells.at(0);
    if (!cell || cell.contents.kind !== "sql") throw new Error("Missing cell");
    await share(project.id, "user", viewer, "viewer");
    await share(project.id, "user", commenter, "commenter");
    const head = project.draftHead;
    if (!head) throw new Error("Missing accepted draft head");
    const { threadId } = await asActor(owner, orgA, () =>
      createNotebookThread.run(
        { projectId: project.id, head, opId: randomUUID() },
        context(owner),
      ),
    );
    const runId = randomUUID();
    const turnId = randomUUID();
    await getRunTurnRef(runId);
    await getDbExec().execute({
      sql: "INSERT INTO agent_runs (id, thread_id, status, started_at, turn_id) VALUES (?, ?, 'completed', ?, ?)",
      args: [runId, threadId, Date.now(), turnId],
    });
    await asActor(owner, orgA, () =>
      saveProjectCell.run(
        {
          projectId: project.id,
          cellId: cell.id,
          contents: sqlContents(cell, "select 2"),
          expectedUpdatedAt: cell.updatedAt,
        },
        {
          ...context(owner),
          caller: "tool",
          threadId,
          runId,
          turnId,
          toolCallId: randomUUID(),
        },
      ),
    );
    const staged = await asActor(owner, orgA, () =>
      getNotebookPendingChanges.run(
        { projectId: project.id, threadId },
        context(owner),
      ),
    );
    expect(staged.changes).toMatchObject([
      {
        cellId: cell.id,
        after: { cells: [{ contents: { source: "select 2" } }] },
      },
    ]); // oracle-change: Phase 1 stores staged SQL in a bound thread proposal instead of accepted cell contents.
    await recordRun({
      ...scopeA,
      projectId: project.id,
      cellId: cell.id,
      status: "complete",
      output: { type: "text", text: "draft output" },
    });

    for (const reader of [viewer, commenter]) {
      const result = await read(reader, project.id);
      expect(result.canEdit).toBe(false);
      expect(result.project.id).toBe(project.id);
      expect(result.project.publishedVersionId).toBeNull();
      const readCell = result.project.cells.at(0);
      expect(readCell?.contents).toMatchObject({ source: "select 1" });
      expect(
        readCell?.contents.kind === "sql" && readCell.contents.pendingEdit,
      ).toBeFalsy();
      expect(result.queryStates).toEqual({});
      expect(result.viewer).toEqual({ email: reader, orgId: orgA });
    }
  });

  it("keeps every write rejected", async () => {
    const project = await freshProject("QA unpublished shared writes");
    const cell = project.cells.at(0);
    if (!cell) throw new Error("Missing cell");
    await share(project.id, "user", viewer, "viewer");
    await expect(read(viewer, project.id)).resolves.toMatchObject({
      canEdit: false,
    });
    const as = (call: () => Promise<unknown>) =>
      expect(asActor(viewer, orgA, call)).rejects.toThrow();
    await as(() =>
      saveProjectCell.run(
        {
          projectId: project.id,
          cellId: cell.id,
          contents: sqlContents(cell, "select 9"),
        },
        context(viewer),
      ),
    );
    await as(() =>
      updateProject.run(
        { projectId: project.id, title: "Renamed by viewer" },
        context(viewer),
      ),
    );
    await as(() =>
      addProjectCell.run(
        { projectId: project.id, kind: "sql", source: "select 3" },
        context(viewer),
      ),
    );
    await as(() =>
      deleteProjectCell.run(
        { projectId: project.id, cellId: cell.id },
        context(viewer),
      ),
    );
    await as(() =>
      publishProjectAction.run({ projectId: project.id }, context(viewer)),
    );
    await as(() =>
      restoreProjectVersion.run(
        { projectId: project.id, versionId: project.workingVersionId },
        context(viewer),
      ),
    );
    const after = await read(owner, project.id);
    expect(after.project.title).toBe("QA unpublished shared writes");
    expect(after.project.cells).toHaveLength(1);
    expect(after.project.publishedVersionId).toBeNull();
  });

  it("still refuses a reader with no grant, a foreign workspace and an implicit org member", async () => {
    const project = await freshProject("QA unpublished no grant");
    await share(project.id, "user", viewer, "viewer");
    await share(project.id, "user", foreign, "viewer");
    await getDb()
      .update(schema.projects)
      .set({ visibility: "org" })
      .where(eq(schema.projects.id, project.id));
    await expect(read(stranger, project.id)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(read(orgMember, project.id)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(read(foreign, project.id, {}, orgB)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(read(viewer, project.id, {}, orgB)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(read(viewer, project.id)).resolves.toMatchObject({
      canEdit: false,
    });
  });

  it("does not turn an org-wide grant into working access", async () => {
    const project = await freshProject("QA unpublished org grant");
    await share(project.id, "org", orgA, "viewer");
    await expect(read(orgMember, project.id)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("still requires a published version for the published and app reads", async () => {
    const project = await freshProject("QA unpublished explicit versions");
    await share(project.id, "user", viewer, "viewer");
    const viewId = randomUUID();
    await expect(
      read(viewer, project.id, { version: "latest" }),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      read(viewer, project.id, { version: "latest", surface: "app", viewId }),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      read(viewer, project.id, { surface: "app" }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      read(viewer, project.id, { version: project.workingVersionId }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("keeps showing the published snapshot, not the draft, once published", async () => {
    const project = await freshProject("QA published then edited");
    const cell = project.cells.at(0);
    if (!cell) throw new Error("Missing cell");
    await share(project.id, "user", viewer, "viewer");
    await recordRun({
      ...scopeA,
      projectId: project.id,
      cellId: cell.id,
      status: "complete",
      output: { type: "text", text: "published output" },
    });
    await seedLegacyPublishedProject(scopeA, project.id);
    await asActor(owner, orgA, () =>
      saveProjectCell.run(
        {
          projectId: project.id,
          cellId: cell.id,
          contents: sqlContents(cell, "select 5"),
        },
        context(owner),
      ),
    );
    const result = await read(viewer, project.id);
    expect(result.project.cells.at(0)?.contents).toMatchObject({
      source: "select 1",
    });
    expect(result.queryStates).toEqual({});
  });
});
