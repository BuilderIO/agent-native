import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  arbitraryFromJsonSchema,
  checkActionProperties,
} from "@agent-native/core/action-properties";
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
import { putUserSetting } from "@agent-native/core/settings";
import {
  ensureWorkspaceConnectionsTable,
  upsertWorkspaceConnection,
} from "@agent-native/core/workspace-connections";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { registerChatThreadsShareable } from "../../../packages/core/dist/chat-threads/store.js";
import { ADDABLE_CELL_KINDS } from "../app/lib/model/cell-types.js";
import type {
  CellContents,
  CellDraft,
  ProjectDocument,
} from "../app/lib/model/contracts.js";
import { getDb, schema } from "../server/db/index.js";
import { insertCellRows, updateCell } from "../server/model/cells-store.js";
import {
  createComponent,
  readComponent,
} from "../server/model/components-store.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { seedLegacyPublishedProject } from "../server/model/legacy-published-fixture.test-support.js";
import {
  createProject,
  getProjectDocument,
  getProjectRow,
  getReadableProjectDocument,
  projectCells,
  updateProject as updateProjectRow,
  readableProjectVersion,
} from "../server/model/projects-store.js";
import { recordRun } from "../server/model/runs-store.js";
import { createStatus } from "../server/model/statuses-store.js";
import addProjectCell from "./add-project-cell.js";
import archiveProject from "./archive-project.js";
import createNotebookThread from "./create-notebook-thread.js";
import createProjectAction from "./create-project.js";
import decideNotebookPendingChanges from "./decide-notebook-pending-changes.js";
import deleteProjectCell from "./delete-project-cell.js";
import duplicateProjectCell from "./duplicate-project-cell.js";
import duplicateProjectAction from "./duplicate-project.js";
import favoriteProject from "./favorite-project.js";
import getNotebookPendingChanges from "./get-notebook-pending-changes.js";
import getProject from "./get-project.js";
import importProject from "./import-project.js";
import runProjectCell from "./run-project-cell.js";
import saveProjectCell from "./save-project-cell.js";
import transferProjectOwner from "./transfer-project-owner.js";
import updateProject from "./update-project.js";

const round = mkdtempSync(join(tmpdir(), "project-actions-"));
const previousDatabase = process.env.DATABASE_URL;
const orgA = `qa-project-a-${randomUUID()}`;
const orgB = `qa-project-b-${randomUUID()}`;
const owner = "project-owner@example.test";
const other = "project-other@example.test";
const viewer = "project-viewer@example.test";
const stranger = "project-stranger@example.test";
const appId = "analytics-2";

const scopeA = { ownerEmail: owner, orgId: orgA };
const scopeB = { ownerEmail: owner, orgId: orgB };
const otherScopeA = { ownerEmail: other, orgId: orgA };

function asActor<T>(email: string, orgId: string, call: () => T) {
  return runWithRequestContext(
    {
      userEmail: email,
      orgId,
      authUserId: email,
      userName: "QA test account",
      isSyntheticTraffic: true,
    },
    call,
  );
}

const actionContext = (email = owner, orgId = orgA) => ({
  caller: "frontend" as const,
  userEmail: email,
  orgId,
  appId,
});

/** A one-value arbitrary, so generated property-check inputs hit a real row. */
const constant = (value: unknown) => arbitraryFromJsonSchema({ const: value });

const baseCell = {
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
} as const;

function sqlCell(
  id: string,
  source: string,
  resultVariable: string,
  dataConnectionId: string | null = null,
): CellDraft {
  return {
    ...baseCell,
    id,
    kind: "sql",
    source,
    dataConnectionId,
    databaseSchema: null,
    resultVariable,
    outputResult: true,
  };
}

function codeCell(id: string, source: string): CellDraft {
  return {
    ...baseCell,
    id,
    kind: "code",
    language: "python",
    source,
    resultVariable: null,
    outputResult: true,
  };
}

function sqlContents(
  cell: { contents: CellContents },
  source: string,
): CellContents {
  if (cell.contents.kind !== "sql") {
    throw new Error("The fixture cell is not SQL.");
  }
  return { ...cell.contents, source };
}

let notebook: ProjectDocument;
let notebookSqlA = "";
let notebookSqlB = "";
let notebookCode = "";
let _otherOrgProject: ProjectDocument;
let otherOwnerProject: ProjectDocument;
let viewerProject: ProjectDocument;
let sharedConnectionId = "";
let otherPersonalConnectionId = "";

beforeAll(async () => {
  registerChatThreadsShareable();
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_project_actions_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await ensureWorkspaceConnectionsTable();

  for (const id of [orgA, orgB]) {
    await getDb().insert(organizations).values({
      id,
      name: "QA project workspace",
      createdBy: owner,
      createdAt: Date.now(),
    });
  }
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
        email: owner,
        role: "owner",
        joinedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId: orgA,
        email: other,
        role: "member",
        joinedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId: orgA,
        email: viewer,
        role: "member",
        joinedAt: Date.now(),
      },
    ]);
  await getDb().insert(appMemberRoles).values({
    id: randomUUID(),
    orgId: orgA,
    email: viewer,
    appId,
    role: "viewer",
    updatedBy: owner,
    updatedAt: Date.now(),
  });

  // A workspace connection granted to the app, plus another member's personal
  // connection which the current account must never be able to select.
  sharedConnectionId = (
    await asActor(owner, orgA, () =>
      upsertWorkspaceConnection({
        provider: "bigquery",
        label: "QA shared warehouse",
      }),
    )
  ).id;
  otherPersonalConnectionId = (
    await asActor(other, orgA, () =>
      upsertWorkspaceConnection({
        provider: "bigquery",
        label: "QA other personal warehouse",
        config: { workspaceConnectionScope: "user" },
      }),
    )
  ).id;

  notebook = await createProject({
    ...scopeA,
    title: "QA notebook",
    cells: [
      sqlCell("cel_qa_a", "select 1 as one", "orders"),
      sqlCell("cel_qa_b", "select 2 as two", "customers", sharedConnectionId),
      codeCell("cel_qa_code", "print('qa')"),
    ],
  });
  notebookSqlA = notebook.cells[0]!.id;
  notebookSqlB = notebook.cells[1]!.id;
  notebookCode = notebook.cells[2]!.id;

  _otherOrgProject = await createProject({
    ...scopeB,
    title: "QA notebook in the other workspace",
    cells: [sqlCell("cel_qa_b_1", "select 3 as three", "third")],
  });
  otherOwnerProject = await createProject({
    ...otherScopeA,
    title: "QA notebook owned by another member",
    cells: [sqlCell("cel_qa_other_1", "select 4 as four", "fourth")],
  });
  viewerProject = await createProject({
    ownerEmail: viewer,
    orgId: orgA,
    title: "QA viewer notebook",
    cells: [sqlCell("cel_qa_viewer_1", "select 5 as five", "fifth")],
  });
});

afterAll(async () => {
  await closeDbExec();
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  const owned = resolve(round);
  if (
    owned !== resolve(tmpdir()) &&
    owned !== resolve(process.cwd()) &&
    owned.startsWith(resolve(tmpdir()) + "/project-actions-")
  ) {
    rmSync(owned, { recursive: true, force: true });
  } else {
    throw new Error("Refused cleanup outside this test round");
  }
});

describe("project action authority", () => {
  it("does not authorize an ambient deploy identity without request context", async () => {
    const previous = process.env.AGENT_USER_EMAIL;
    process.env.AGENT_USER_EMAIL = owner;
    try {
      await expect(
        getProject.run({ projectId: notebook.id }, actionContext()),
      ).rejects.toThrow("Sign in");
    } finally {
      if (previous === undefined) delete process.env.AGENT_USER_EMAIL;
      else process.env.AGENT_USER_EMAIL = previous;
    }
  });

  it("answers not-found for a project in another organisation or another account", async () => {
    await expect(
      asActor(owner, orgB, () =>
        getProject.run({ projectId: notebook.id }, actionContext(owner, orgB)),
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "project_not_found",
    });
    await expect(
      asActor(other, orgA, () =>
        getProject.run({ projectId: notebook.id }, actionContext(other, orgA)),
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "project_not_found",
    });
    await expect(
      asActor(stranger, orgA, () =>
        getProject.run(
          { projectId: notebook.id },
          actionContext(stranger, orgA),
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await getProjectDocument(scopeB, notebook.id)).toBeNull();
  });

  it("refuses every write from another organisation or another member", async () => {
    const crossOrg = actionContext(owner, orgB);
    const crossOwner = actionContext(other, orgA);
    await expect(
      asActor(owner, orgB, () =>
        updateProject.run(
          { projectId: notebook.id, title: "QA cross org" },
          crossOrg,
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "project_not_found",
    });
    await expect(
      asActor(owner, orgB, () =>
        addProjectCell.run({ projectId: notebook.id, kind: "sql" }, crossOrg),
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "project_not_found",
    });
    await expect(
      asActor(owner, orgB, () =>
        deleteProjectCell.run(
          { projectId: notebook.id, cellId: notebookSqlA },
          crossOrg,
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "project_not_found",
    });
    await expect(
      asActor(other, orgA, () =>
        updateProject.run(
          { projectId: notebook.id, title: "QA cross owner" },
          crossOwner,
        ),
      ),
    ).rejects.toThrow();
    await expect(
      asActor(other, orgA, () =>
        saveProjectCell.run(
          {
            projectId: notebook.id,
            cellId: notebookSqlA,
            contents: sqlContents(notebook.cells[0]!, "select 10 as ten"),
          },
          crossOwner,
        ),
      ),
    ).rejects.toThrow();
    // The other member's own project is untouched by the refused calls.
    expect(
      (await getProjectDocument(otherScopeA, otherOwnerProject.id))?.cells[0]
        ?.contents,
    ).toMatchObject({ source: "select 4 as four" });
  });

  it("lets a workspace Viewer add and save cells in their own project", async () => {
    const result = await asActor(viewer, orgA, () =>
      getProject.run({ projectId: viewerProject.id }, actionContext(viewer)),
    );
    expect(result.canEdit).toBe(true);
    const projectId = viewerProject.id;
    const call = <T>(run: () => T) => asActor(viewer, orgA, run);
    const ctx = actionContext(viewer);
    const added = await call(() =>
      addProjectCell.run({ projectId, kind: "sql" }, ctx),
    );
    const cell = added.project.cells.find(
      (item) => item.id !== viewerProject.cells[0]?.id,
    );
    if (!cell) throw new Error("Added cell missing");
    const saved = await call(() =>
      saveProjectCell.run(
        {
          projectId,
          cellId: cell.id,
          contents: sqlContents(cell, "select 42"),
        },
        ctx,
      ),
    );
    expect(
      saved.project.cells.find((item) => item.id === cell.id)?.contents,
    ).toMatchObject({ source: "select 42" });
  });

  it("lets a workspace Viewer favorite an owned project", async () => {
    const result = await asActor(viewer, orgA, () =>
      favoriteProject.run(
        { projectId: viewerProject.id, favorited: true },
        actionContext(viewer),
      ),
    );
    expect(result.project.favorited).toBe(true);
  });

  it("lets a workspace Viewer archive an owned project", async () => {
    const result = await asActor(viewer, orgA, () =>
      archiveProject.run(
        { projectId: viewerProject.id },
        actionContext(viewer),
      ),
    );
    expect(result.project.archivedAt).toEqual(expect.any(String));
  });

  it("requires project creation permission to duplicate an owned project", async () => {
    await expect(
      asActor(viewer, orgA, () =>
        duplicateProjectAction.run(
          { projectId: viewerProject.id },
          actionContext(viewer),
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining("create-project"),
    });
  });
});

describe("get-project", () => {
  it("rechecks connection result access on reload without hiding unrelated cell outputs", async () => {
    const connection = await asActor(owner, orgA, () =>
      upsertWorkspaceConnection({
        provider: "bigquery",
        label: "QA restricted results",
        allowedUsers: [owner],
        config: { viewAccessGroupIds: [] },
      }),
    );
    const project = await createProject({
      ...otherScopeA,
      title: "QA result permissions",
      cells: [
        sqlCell(
          "cel_qa_restricted_output",
          "select 7",
          "restricted_result",
          connection.id,
        ),
        codeCell("cel_qa_unrelated_output", "print('visible')"),
      ],
    });
    const sql = project.cells[0]!;
    const code = project.cells[1]!;
    await getDb()
      .insert(appMemberRoles)
      .values({
        id: randomUUID(),
        orgId: orgA,
        appId,
        email: other,
        role: "editor",
        updatedBy: owner,
        updatedAt: Date.now(),
      })
      .onConflictDoNothing();
    const sqlOutput = {
      type: "table" as const,
      columns: [{ name: "private_value", type: "number" as const }],
      rows: [[7]],
      rowCount: 1,
      truncated: false,
    };
    await recordRun({
      ...otherScopeA,
      projectId: project.id,
      cellId: sql.id,
      status: "complete",
      output: sqlOutput,
    });
    await recordRun({
      ...otherScopeA,
      projectId: project.id,
      cellId: code.id,
      status: "complete",
      output: { type: "text", text: "visible" },
    });
    const read = () =>
      asActor(other, orgA, () =>
        getProject.run({ projectId: project.id }, actionContext(other)),
      );
    const queryRequestId = randomUUID();
    await getDb()
      .insert(schema.cellOutputGenerations)
      .values({
        projectId: project.id,
        cellId: sql.id,
        generation: queryRequestId,
      })
      .onConflictDoUpdate({
        target: schema.cellOutputGenerations.cellId,
        set: { generation: queryRequestId },
      });
    await asActor(other, orgA, () =>
      putUserSetting(
        other,
        `analytics-2:query:${orgA}:${project.id}:${sql.id}`,
        {
          requestId: queryRequestId,
          operation: randomUUID(),
          busy: false,
          connectionId: connection.id,
          sourceHash: createHash("sha256").update("select 7").digest("hex"),
          startedAt: new Date().toISOString(),
          status: "complete",
          job: { projectId: "qa-project", jobId: "qa-job" },
          pageToken: "private-next-page",
          totalRows: "99999",
        },
      ),
    );
    const denied = await read();
    expect(denied.queryStates[sql.id]).toBeUndefined();
    expect(denied.outputs[sql.id]?.output).toEqual({
      type: "error",
      message:
        "You do not have access to view results from this data connection.",
      detail: null,
    });
    expect(denied.outputs[code.id]?.output).toEqual({
      type: "text",
      text: "visible",
    });
    await asActor(owner, orgA, () =>
      upsertWorkspaceConnection({
        id: connection.id,
        provider: "bigquery",
        label: connection.label,
        config: { viewAccessGroupIds: ["workspace"] },
      }),
    );
    const allowed = await read();
    expect(allowed.outputs[sql.id]?.output).toEqual(sqlOutput);
    expect(allowed.queryStates[sql.id]?.totalRows).toBe("99999");
    await asActor(owner, orgA, () =>
      upsertWorkspaceConnection({
        id: connection.id,
        provider: "bigquery",
        label: connection.label,
        config: { viewAccessGroupIds: [] },
      }),
    );
    expect((await read()).outputs[sql.id]?.output?.type).toBe("error");
    expect((await read()).queryStates[sql.id]).toBeUndefined();
    await asActor(other, orgA, () =>
      saveProjectCell.run(
        {
          projectId: project.id,
          cellId: sql.id,
          contents: {
            ...sql.contents,
            kind: "sql",
            source: "select 7",
            dataConnectionId: null,
            databaseSchema: null,
            resultVariable: "restricted_result",
            outputResult: true,
          },
        },
        actionContext(other),
      ),
    );
    expect((await read()).outputs[sql.id]?.output?.type).toBe("error");
    await asActor(other, orgA, () =>
      saveProjectCell.run(
        {
          projectId: project.id,
          cellId: sql.id,
          contents: {
            ...sql.contents,
            kind: "sql",
            source: "select 7",
            dataConnectionId: sharedConnectionId,
            databaseSchema: null,
            resultVariable: "restricted_result",
            outputResult: true,
          },
        },
        actionContext(other),
      ),
    );
    expect((await read()).outputs[sql.id]?.output?.type).toBe("error");
    await getDb()
      .update(schema.cellOutputs)
      .set({ sourceConnectionId: null, connectionProvenanceRecorded: false })
      .where(eq(schema.cellOutputs.cellId, sql.id));
    expect((await read()).outputs[sql.id]?.output).toEqual({
      type: "error",
      message: "Run this cell again to verify access to its results.",
      detail: null,
    });
  });
  it("returns the working document and each cell's shown output", async () => {
    const output = {
      type: "table" as const,
      columns: [{ name: "one", type: "number" as const }],
      rows: [[1]],
      rowCount: 1,
      truncated: false,
    };
    await recordRun({
      ...scopeA,
      projectId: notebook.id,
      cellId: notebookSqlA,
      status: "complete",
      output,
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:01.000Z",
      durationMs: 1000,
    });
    const result = await asActor(owner, orgA, () =>
      getProject.run({ projectId: notebook.id }, actionContext()),
    );
    expect(result.project.id).toBe(notebook.id);
    expect(result.project.workingVersionId).toBe(notebook.workingVersionId);
    expect(result.project.cells.map((cell) => cell.id)).toEqual([
      notebookSqlA,
      notebookSqlB,
      notebookCode,
    ]);
    expect(result.outputs[notebookSqlA]).toMatchObject({
      cellId: notebookSqlA,
      status: "complete",
      output,
    });
    expect(result.outputs[notebookSqlB]).toBeUndefined();
  });

  it("reads the requested published version without replacing the working document", async () => {
    const created = await createProject({
      ...scopeA,
      title: "QA versioned project",
      cells: [codeCell("cel_qa_versioned", "print('published')")],
    });
    const publishedVersionId = (
      await seedLegacyPublishedProject(scopeA, created.id)
    ).publishedVersionId;
    if (publishedVersionId === null)
      throw new Error("Published project has no published version.");
    const cell = created.cells[0];
    if (!cell || cell.contents.kind !== "code")
      throw new Error("Code cell missing");
    await asActor(owner, orgA, () =>
      saveProjectCell.run(
        {
          projectId: created.id,
          cellId: cell.id,
          expectedUpdatedAt: cell.updatedAt,
          contents: { ...cell.contents, source: "print('working')" },
        },
        actionContext(),
      ),
    );

    const read = (version?: string) =>
      asActor(owner, orgA, () =>
        getProject.run(
          {
            projectId: created.id,
            ...(version === undefined ? {} : { version }),
          },
          actionContext(),
        ),
      );
    const working = await read();
    const selected = await read(publishedVersionId);
    const latest = await read("latest");

    expect(working.project.cells[0]?.contents).toMatchObject({
      source: "print('working')",
    });
    expect(selected.project.cells[0]?.contents).toMatchObject({
      source: "print('published')",
    });
    expect(latest.project.cells[0]?.contents).toMatchObject({
      source: "print('published')",
    });
    await expect(read("ver_not_published")).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "project_version_not_found",
    });
  });

  it("forks a legacy published working version once and preserves cell revisions for concurrent saves", async () => {
    const created = await createProject({
      ...scopeA,
      title: "QA legacy published alias",
      cells: [
        codeCell("cel_qa_legacy_one", "print('one published')"),
        codeCell("cel_qa_legacy_two", "print('two published')"),
        codeCell("cel_qa_legacy_untouched", "print('untouched')"),
      ],
    });
    const published = await seedLegacyPublishedProject(scopeA, created.id);
    const versionId = published.publishedVersionId;
    if (!versionId) throw new Error("Published version missing");
    await getDb()
      .update(schema.projects)
      .set({ workingVersionId: versionId })
      .where(eq(schema.projects.id, created.id));
    const legacy = await getProjectDocument(scopeA, created.id);
    if (!legacy) throw new Error("Legacy project missing");
    const beforeVersions = await getDb()
      .select()
      .from(schema.projectVersions)
      .where(eq(schema.projectVersions.projectId, created.id));
    const results = await Promise.all(
      legacy.cells.slice(0, 2).map((cell, index) => {
        if (cell.contents.kind !== "code") throw new Error("Code cell missing");
        const contents = {
          ...cell.contents,
          source: `print('draft ${index}')`,
        };
        return asActor(owner, orgA, () =>
          saveProjectCell.run(
            {
              projectId: created.id,
              cellId: cell.id,
              contents,
              expectedUpdatedAt: cell.updatedAt,
            },
            actionContext(),
          ),
        );
      }),
    );
    const draftIds = new Set(
      results.map((result) => result.project.workingVersionId),
    );
    expect(draftIds.size).toBe(1);
    expect(draftIds.has(versionId)).toBe(false);
    const afterVersions = await getDb()
      .select()
      .from(schema.projectVersions)
      .where(eq(schema.projectVersions.projectId, created.id));
    expect(afterVersions).toHaveLength(beforeVersions.length + 1);
    const current = await getProjectDocument(scopeA, created.id);
    expect(current?.cells.map((cell) => cell.id)).toEqual(
      legacy.cells.map((cell) => cell.id),
    );
    expect(
      current?.cells
        .slice(0, 2)
        .map((cell) => cell.contents.kind === "code" && cell.contents.source),
    ).toEqual(["print('draft 0')", "print('draft 1')"]);
    expect(current?.cells[2]?.updatedAt).toBe(legacy.cells[2]?.updatedAt);
    expect(current?.cells[2]?.createdAt).toBe(legacy.cells[2]?.createdAt);
    const snapshot = await getProjectDocument(scopeA, created.id, versionId);
    expect(snapshot?.cells).toEqual(legacy.cells);
    const untouched = current?.cells[2];
    if (!current || !untouched || untouched.contents.kind !== "code")
      throw new Error("Draft code cell missing");
    const updated = await updateCell({
      ...scopeA,
      projectId: created.id,
      versionId: current.workingVersionId,
      cellId: untouched.id,
      contents: { ...untouched.contents, source: "print('draft readback')" },
      expectedUpdatedAt: untouched.updatedAt,
    });
    expect(updated).toMatchObject({
      versionId: current.workingVersionId,
      contents: { source: "print('draft readback')" },
    });
    const cell = legacy.cells[0];
    if (!cell || cell.contents.kind !== "code")
      throw new Error("Code cell missing");
    await expect(
      asActor(owner, orgA, () =>
        saveProjectCell.run(
          {
            projectId: created.id,
            cellId: cell.id,
            contents: { ...cell.contents, source: "print('stale')" },
            expectedUpdatedAt: cell.updatedAt,
          },
          actionContext(),
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "cell_changed_elsewhere",
    });
  });

  it("rejects a blank project id before the handler", async () => {
    await expect(
      getProject.run({ projectId: "" }, actionContext()),
    ).rejects.toThrow();
  });
});

describe("update-project", () => {
  it("renames, trims and falls back to the source default for an empty name", async () => {
    const renamed = await asActor(owner, orgA, () =>
      updateProject.run(
        { projectId: notebook.id, title: "  QA renamed notebook  " },
        actionContext(),
      ),
    );
    expect(renamed.project.title).toBe("QA renamed notebook");
    expect((await getProjectDocument(scopeA, notebook.id))?.title).toBe(
      "QA renamed notebook",
    );

    const empty = await asActor(owner, orgA, () =>
      updateProject.run({ projectId: notebook.id, title: "" }, actionContext()),
    );
    expect(empty.project.title).toBe("Untitled project");
  });

  it("accepts the source maximum and rejects one character past it", async () => {
    const accepted = "a".repeat(500);
    const result = await asActor(owner, orgA, () =>
      updateProject.run(
        { projectId: notebook.id, title: accepted },
        actionContext(),
      ),
    );
    expect(result.project.title).toBe(accepted);
    await expect(
      asActor(owner, orgA, () =>
        updateProject.run(
          { projectId: notebook.id, title: "a".repeat(501) },
          actionContext(),
        ),
      ),
    ).rejects.toThrow();
    expect((await getProjectDocument(scopeA, notebook.id))?.title).toBe(
      accepted,
    );
  });

  it("rejects null bytes in title and description at schema validation", () => {
    expect(
      updateProject.schema.safeParse({
        projectId: "proj-1",
        title: "bad\u0000title",
      }).success,
    ).toBe(false);
    expect(
      updateProject.schema.safeParse({
        projectId: "proj-1",
        description: "bad\u0000desc",
      }).success,
    ).toBe(false);
  });
});

describe("save-project-cell", () => {
  it.each(["tool", "mcp", "webmcp", "a2a"] as const)(
    "rejects SQL edits from an unbound %s action caller",
    async (caller) => {
      const project = await createProject({
        ...scopeA,
        title: `Review SQL ${caller}`,
        cells: [sqlCell(`cel_${randomUUID()}`, "select 1", "base")],
      });
      const cell = project.cells.at(0);
      if (!cell) throw new Error("Missing review fixture cell");
      await expect(
        asActor(owner, orgA, () =>
          saveProjectCell.run(
            {
              projectId: project.id,
              cellId: cell.id,
              contents: sqlContents(cell, "select 2"),
              expectedUpdatedAt: cell.updatedAt,
            },
            { ...actionContext(), caller },
          ),
        ),
      ).rejects.toMatchObject({
        statusCode: 403,
        errorCode: "review_context_required",
      });
      const stored = await asActor(owner, orgA, () =>
        getProject.run({ projectId: project.id }, actionContext()),
      );
      expect(stored.project.cells[0]?.contents).toEqual(cell.contents);
    },
  );
  it.each(["mcp", "webmcp", "a2a"] as const)(
    "tells a thread-less %s caller to build a new query with create-project starter cells",
    async (caller) => {
      const created = await asActor(owner, orgA, () =>
        createProjectAction.run(
          { requestId: randomUUID(), title: `Orders by month ${caller}` },
          { ...actionContext(), caller },
        ),
      );
      const rejection = await asActor(owner, orgA, () =>
        addProjectCell.run(
          { projectId: created.projectId, kind: "sql", source: "select 1" },
          { ...actionContext(), caller },
        ),
      ).then(
        () => null,
        (error: unknown) => error,
      );
      expect(rejection).toMatchObject({
        statusCode: 403,
        errorCode: "review_context_required",
      });
      expect((rejection as Error).message).toContain("create-project");
      expect((rejection as Error).message).toContain("starter");
    },
  );

  it("creates a query and its chart in one create-project call from a thread-less caller", async () => {
    const created = await asActor(owner, orgA, () =>
      createProjectAction.run(
        {
          requestId: randomUUID(),
          title: "Orders by month starter",
          starter: {
            kind: "cells",
            cells: [
              {
                ...baseCell,
                kind: "sql",
                source: "select 1 as month, 2 as orders",
                dataConnectionId: "builtin-sample-data",
                databaseSchema: null,
                resultVariable: "orders_by_month",
                outputResult: true,
              },
              {
                ...baseCell,
                kind: "chart",
                dataframe: "orders_by_month",
                chartSpec: {
                  version: 3,
                  revision: 0,
                  mark: "bar",
                  stacked: true,
                  xField: "month",
                  xTimeUnit: "month",
                  yField: "orders",
                  seriesField: null,
                  title: null,
                },
              },
            ],
          },
        },
        { ...actionContext(), caller: "webmcp" },
      ),
    );
    const stored = await asActor(owner, orgA, () =>
      getProject.run({ projectId: created.projectId }, actionContext()),
    );
    expect(stored.project.cells.map((cell) => cell.contents.kind)).toEqual(
      expect.arrayContaining(["sql", "chart"]),
    );
  });

  it.each(["editor", "viewer"] as const)(
    "A2-SHARED-EDITOR-STORAGE: %s save/run/rename and destructive denial",
    async (role) => {
      const email = role === "editor" ? other : viewer;
      const project = await createProject({
        ...scopeA,
        title: "Shared notebook",
        cells: [
          sqlCell(
            `cel_${randomUUID()}`,
            "select * from orders limit 1",
            "shared_rows",
            "builtin-sample-data",
          ),
        ],
      });
      await getDb()
        .insert(schema.projectShares)
        .values({
          id: `shr_${randomUUID()}`,
          resourceId: project.id,
          principalType: "user",
          principalId: email,
          role,
          createdBy: owner,
          createdAt: new Date().toISOString(),
        });
      const cell = project.cells[0]!;
      const call = <T>(fn: () => T) => asActor(email, orgA, fn);
      const before = await call(() =>
        getProject.run({ projectId: project.id }, actionContext(email)),
      );
      expect(before.canEdit).toBe(role === "editor");
      const save = () =>
        call(() =>
          saveProjectCell.run(
            {
              projectId: project.id,
              cellId: cell.id,
              contents: sqlContents(cell, "select * from orders limit 2"),
            },
            actionContext(email),
          ),
        );
      const rename = () =>
        call(() =>
          updateProject.run(
            {
              projectId: project.id,
              title: "Shared renamed",
            },
            actionContext(email),
          ),
        );
      const run = () =>
        call(() =>
          runProjectCell.run(
            {
              projectId: project.id,
              cellId: cell.id,
            },
            actionContext(email),
          ),
        );
      if (role === "viewer") {
        for (const operation of [save, rename, run])
          await expect(operation()).rejects.toThrow();
      } else {
        await save();
        await rename();
        expect(await run()).toMatchObject({
          status: "complete",
          output: { type: "table", rowCount: 2 },
        });
        const read = await call(() =>
          getProject.run({ projectId: project.id }, actionContext(email)),
        );
        expect(read.project.title).toBe("Shared renamed");
        expect(read.project.cells[0]?.contents).toMatchObject({
          source: "select * from orders limit 2",
        });
        expect(read.outputs[cell.id]).toMatchObject({ status: "complete" });
      }
      await expect(
        call(() =>
          transferProjectOwner.run(
            { projectId: project.id, ownerEmail: owner },
            actionContext(email),
          ),
        ),
      ).rejects.toThrow();
      const stored = await getProjectDocument(scopeA, project.id);
      expect(stored?.ownerEmail).toBe(owner);
      if (role === "viewer") {
        expect(stored?.title).toBe("Shared notebook");
        expect(stored?.cells[0]?.contents).toMatchObject({
          source: "select * from orders limit 1",
        });
      }
    },
  );

  it("report 1794948257.991429: stages agent SQL edits until review and protects concurrent edits", async () => {
    const project = await createProject({
      ...scopeA,
      title: "Review SQL",
      cells: [sqlCell("cel_qa_review", "select 1", "base")],
    });
    const first = project.cells.at(0);
    if (!first) throw new Error("Missing review fixture cell");
    await expect(
      getReadableProjectDocument(
        { ownerEmail: stranger, orgId: orgA },
        project.id,
      ),
    ).resolves.toBeNull();
    await expect(
      getReadableProjectDocument(
        { ownerEmail: viewer, orgId: orgB },
        project.id,
      ),
    ).resolves.toBeNull();
    const projectRow = await getProjectRow(scopeA, project.id);
    if (!projectRow) throw new Error("Missing review project");
    await expect(
      readableProjectVersion({ ownerEmail: stranger, orgId: orgA }, projectRow),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      readableProjectVersion(
        { ownerEmail: viewer, orgId: orgB },
        projectRow,
        "latest",
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    await getDb()
      .insert(schema.projectShares)
      .values({
        id: `shr_${randomUUID()}`,
        resourceId: project.id,
        principalType: "user",
        principalId: viewer,
        role: "viewer",
        createdBy: owner,
        createdAt: new Date().toISOString(),
      });
    await getDb()
      .insert(schema.projectShares)
      .values({
        id: `shr_${randomUUID()}`,
        resourceId: project.id,
        principalType: "user",
        principalId: other,
        role: "editor",
        createdBy: owner,
        createdAt: new Date().toISOString(),
      });
    const editorRead = await asActor(other, orgA, () =>
      getProject.run({ projectId: project.id }, actionContext(other)),
    );
    expect(editorRead.canEdit).toBe(true);
    const unpublishedViewerRead = await asActor(viewer, orgA, () =>
      getProject.run({ projectId: project.id }, actionContext(viewer)),
    );
    expect(unpublishedViewerRead.canEdit).toBe(false);
    expect(unpublishedViewerRead.project.cells.at(0)?.contents).toMatchObject({
      source: "select 1",
    });
    await expect(
      asActor(viewer, orgA, () =>
        saveProjectCell.run(
          {
            projectId: project.id,
            cellId: first.id,
            contents: sqlContents(first, "select 9"),
          },
          actionContext(viewer),
        ),
      ),
    ).rejects.toThrow();
    const onlyCell = (document: ProjectDocument) => {
      const cell = document.cells.at(0);
      if (!cell) throw new Error("Missing review cell");
      return cell;
    };
    const head = project.draftHead;
    if (!head) throw new Error("Missing accepted draft head");
    const binding = await asActor(owner, orgA, () =>
      createNotebookThread.run(
        { projectId: project.id, head, opId: randomUUID() },
        actionContext(),
      ),
    );
    const { threadId } = binding;
    const runId = randomUUID();
    const turnId = randomUUID();
    await getRunTurnRef(runId);
    await getDbExec().execute({
      sql: "INSERT INTO agent_runs (id, thread_id, status, started_at, turn_id) VALUES (?, ?, 'completed', ?, ?)",
      args: [runId, threadId, Date.now(), turnId],
    });
    const tool = {
      ...actionContext(),
      caller: "tool" as const,
      threadId,
      runId,
      turnId,
    };
    const propose = (cell: typeof first, source: string) =>
      asActor(owner, orgA, () =>
        saveProjectCell.run(
          {
            projectId: project.id,
            cellId: cell.id,
            contents: sqlContents(cell, source),
            expectedUpdatedAt: cell.updatedAt,
          },
          { ...tool, toolCallId: randomUUID() },
        ),
      );
    const key = { projectId: project.id, threadId };
    const pendingChanges = () =>
      asActor(owner, orgA, () =>
        getNotebookPendingChanges.run(key, actionContext()),
      );
    const proposed = await propose(first, "select 2");
    expect(proposed.editStatus).toBe("pending_review");
    const current = onlyCell(proposed.project);
    expect(current.contents).toEqual(first.contents);
    const reloaded = await asActor(owner, orgA, () =>
      getProject.run({ projectId: project.id }, actionContext()),
    );
    expect(onlyCell(reloaded.project).contents).toEqual(current.contents);
    const pending = await pendingChanges();
    expect(pending.changes).toEqual([
      expect.objectContaining({
        id: proposed.proposalIds?.[0],
        cellId: current.id,
        after: expect.objectContaining({
          cells: [
            expect.objectContaining({
              contents: expect.objectContaining({ source: "select 2" }),
            }),
          ],
        }),
      }),
    ]);
    const component = await createComponent(scopeA, {
      projectId: project.id,
      name: `review-${randomUUID()}`,
      cellIds: [current.id],
    });
    const captured = await readComponent(scopeA, component.id);
    expect(captured?.cells[0]?.contents).toMatchObject({ source: "select 1" });
    expect(captured?.cells[0]?.contents.pendingEdit).toBeUndefined();
    await recordRun({
      ...scopeA,
      projectId: project.id,
      cellId: current.id,
      status: "complete",
      output: { type: "text", text: "published output" },
    });
    await seedLegacyPublishedProject(scopeA, project.id);
    const published = await asActor(owner, orgA, () =>
      getProject.run(
        { projectId: project.id, version: "latest" },
        actionContext(),
      ),
    );
    const publishedCell = onlyCell(published.project);
    expect(publishedCell.contents).toMatchObject({ source: "select 1" });
    expect(
      publishedCell.contents.kind === "sql" &&
        publishedCell.contents.pendingEdit,
    ).toBeUndefined();
    const duplicated = await asActor(owner, orgA, () =>
      duplicateProjectAction.run({ projectId: project.id }, actionContext()),
    );
    const copied = onlyCell(duplicated.project);
    expect(copied.contents).toMatchObject({ source: "select 1" });
    expect(
      copied.contents.kind === "sql" && copied.contents.pendingEdit,
    ).toBeUndefined();
    const duplicatedCell = await asActor(owner, orgA, () =>
      duplicateProjectCell.run(
        { projectId: project.id, cellId: current.id },
        actionContext(),
      ),
    );
    const copiedCell = duplicatedCell.project.cells.find(
      (cell) => cell.id !== current.id,
    );
    if (!copiedCell) throw new Error("Duplicate cell missing");
    expect(copiedCell.contents).toMatchObject({ source: "select 1" });
    expect(
      copiedCell.contents.kind === "sql" && copiedCell.contents.pendingEdit,
    ).toBeUndefined();
    await recordRun({
      ...scopeA,
      projectId: project.id,
      cellId: current.id,
      status: "complete",
      output: { type: "text", text: "private draft output" },
    });
    const viewerDocument = await asActor(viewer, orgA, () =>
      getProject.run({ projectId: project.id }, actionContext(viewer)),
    );
    expect(viewerDocument.canEdit).toBe(false);
    expect(viewerDocument.project.cells).toHaveLength(1);
    expect(viewerDocument.outputs[current.id]?.output).toEqual({
      type: "text",
      text: "published output",
    });
    expect(viewerDocument.queryStates).toEqual({});
    const viewerCell = onlyCell(viewerDocument.project);
    expect(viewerCell.contents).toMatchObject({ source: "select 1" });
    expect(
      viewerCell.contents.kind === "sql" && viewerCell.contents.pendingEdit,
    ).toBeUndefined();
    const review = (
      read: Awaited<ReturnType<typeof pendingChanges>>,
      decision: "confirm" | "undo",
    ) =>
      asActor(owner, orgA, () =>
        decideNotebookPendingChanges.run(
          {
            ...key,
            opId: randomUUID(),
            expectedOverlayRevision: read.overlayRevision,
            observedHead: read.acceptedHead,
            selection: {
              kind: "all",
              reviewedSetDigest: read.reviewedSetDigest,
            },
            decision,
          },
          actionContext(),
        ),
      );
    await review(pending, "undo");
    const undone = await pendingChanges();
    expect(undone.changes).toContainEqual(
      expect.objectContaining({
        id: proposed.proposalIds?.[0],
        status: "undone",
      }),
    );
    await propose(current, "select 3");
    const awaiting = await pendingChanges();
    const changed = await asActor(owner, orgA, () =>
      saveProjectCell.run(
        {
          projectId: project.id,
          cellId: current.id,
          contents: sqlContents(current, "select 4"),
          expectedUpdatedAt: current.updatedAt,
        },
        actionContext(),
      ),
    );
    const revised = onlyCell(changed.project);
    await expect(review(awaiting, "confirm")).rejects.toMatchObject({
      errorCode: "proposal_base_changed",
    });
    await review(await pendingChanges(), "undo");
    await propose(revised, "select 5");
    const accepted = await review(await pendingChanges(), "confirm");
    expect(accepted.checkpointId).not.toBeNull();
    const acceptedDocument = await asActor(owner, orgA, () =>
      getProject.run({ projectId: project.id }, actionContext()),
    );
    const acceptedCell = onlyCell(acceptedDocument.project);
    expect(acceptedCell.contents).toMatchObject({ source: "select 5" });
    expect(
      acceptedCell.contents.kind === "sql" && acceptedCell.contents.pendingEdit,
    ).toBeUndefined();
  });
  it("refuses a save based on an older cell revision", async () => {
    await expect(
      asActor(owner, orgA, () =>
        saveProjectCell.run(
          {
            projectId: notebook.id,
            cellId: notebookSqlA,
            contents: sqlContents(notebook.cells[0]!, "select 99"),
            expectedUpdatedAt: "stale-revision",
          },
          actionContext(),
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "cell_changed_elsewhere",
    });
  });

  it("persists a dirty SQL cell exactly and reads it back from the store", async () => {
    const dirty = "select\n  1 as one,\n  2 as two   -- keep my spacing\n";
    const saved = await asActor(owner, orgA, () =>
      saveProjectCell.run(
        {
          projectId: notebook.id,
          cellId: notebookSqlA,
          contents: sqlContents(notebook.cells[0]!, dirty),
        },
        actionContext(),
      ),
    );
    const savedCell = saved.project.cells.find(
      (cell) => cell.id === notebookSqlA,
    );
    expect(savedCell?.contents).toMatchObject({ kind: "sql", source: dirty });

    const reloaded = await asActor(owner, orgA, () =>
      getProject.run({ projectId: notebook.id }, actionContext()),
    );
    expect(
      reloaded.project.cells.find((cell) => cell.id === notebookSqlA)?.contents,
    ).toMatchObject({ source: dirty });

    // Read the same row through the store, not only the action's return value.
    const storedCell = (await projectCells(scopeA, notebook.id)).find(
      (cell) => cell.id === notebookSqlA,
    );
    expect(storedCell?.contents).toMatchObject({ source: dirty });
  });

  it("refuses an id mismatch and a kind change", async () => {
    await expect(
      asActor(owner, orgA, () =>
        saveProjectCell.run(
          {
            projectId: notebook.id,
            cellId: notebookSqlA,
            contents: {
              ...sqlContents(notebook.cells[0]!, "select 1"),
              id: notebookSqlB,
            },
          },
          actionContext(),
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 400, errorCode: "cell_id_mismatch" });

    await expect(
      asActor(owner, orgA, () =>
        saveProjectCell.run(
          {
            projectId: notebook.id,
            cellId: notebookSqlA,
            contents: {
              ...baseCell,
              id: notebookSqlA,
              order: notebook.cells[0]!.contents.order,
              kind: "code",
              language: "python",
              source: "print('changed kind')",
              resultVariable: null,
              outputResult: true,
            },
          },
          actionContext(),
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 400, errorCode: "cell_kind_change" });

    // A cell from another project is not reachable through this project.
    await expect(
      asActor(owner, orgA, () =>
        saveProjectCell.run(
          {
            projectId: notebook.id,
            cellId: "cel_qa_missing",
            contents: {
              ...sqlContents(notebook.cells[0]!, "select 1"),
              id: "cel_qa_missing",
            },
          },
          actionContext(),
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 404, errorCode: "cell_not_found" });
  });

  it("accepts only a connection the data surface grants this workspace", async () => {
    const granted = await asActor(owner, orgA, () =>
      saveProjectCell.run(
        {
          projectId: notebook.id,
          cellId: notebookSqlA,
          contents: {
            ...sqlContents(notebook.cells[0]!, "select 1 as one"),
            dataConnectionId: sharedConnectionId,
          },
        },
        actionContext(),
      ),
    );
    expect(
      granted.project.cells.find((cell) => cell.id === notebookSqlA)?.contents,
    ).toMatchObject({ dataConnectionId: sharedConnectionId });

    for (const connectionId of [otherPersonalConnectionId, "con_qa_missing"]) {
      await expect(
        asActor(owner, orgA, () =>
          saveProjectCell.run(
            {
              projectId: notebook.id,
              cellId: notebookSqlA,
              contents: {
                ...sqlContents(notebook.cells[0]!, "select 2 as two"),
                dataConnectionId: connectionId,
              },
            },
            actionContext(),
          ),
        ),
      ).rejects.toThrow();
    }

    await expect(
      asActor(owner, orgA, () =>
        saveProjectCell.run(
          {
            projectId: notebook.id,
            cellId: notebookSqlA,
            contents: {
              ...sqlContents(notebook.cells[0]!, "select 3 as three"),
              dataConnectionId: "   ",
            },
          },
          actionContext(),
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "data_connection_invalid",
    });
  });
});

describe("add-project-cell", () => {
  it("adds a SQL cell after the requested neighbour with source defaults", async () => {
    const result = await asActor(owner, orgA, () =>
      addProjectCell.run(
        { projectId: notebook.id, kind: "sql", afterCellId: notebookSqlA },
        actionContext(),
      ),
    );
    expect(result.project.cells.map((cell) => cell.id).slice(0, 3)).toEqual([
      notebookSqlA,
      result.project.cells[1]!.id,
      notebookSqlB,
    ]);
    const added = result.project.cells[1]!;
    expect(added.id).not.toBe(notebookSqlA);
    expect(added.contents).toMatchObject({
      kind: "sql",
      source: "",
      resultVariable: "dataframe",
      outputResult: true,
      label: null,
      databaseSchema: null,
      // Inherited from the most recently created SQL cell that still resolves.
      dataConnectionId: sharedConnectionId,
    });
  });

  it("rejects creating an unsupported map cell", async () => {
    const before = await getProjectDocument(scopeA, notebook.id);
    await expect(
      asActor(owner, orgA, () =>
        addProjectCell.run(
          { projectId: notebook.id, kind: "map" },
          actionContext(),
        ),
      ),
    ).rejects.toThrow(/Invalid action parameters.*kind/);
    expect((await getProjectDocument(scopeA, notebook.id))?.cells).toEqual(
      before?.cells,
    );
  });

  it("restores an imported code cell after deletion", async () => {
    const context = actionContext();
    const { project } = await asActor(owner, orgA, () =>
      importProject.run(
        {
          title: "QA restore code cell",
          cells: [{ kind: "code", source: "print('hello')" }],
        },
        context,
      ),
    );
    const cell = project.cells.at(0);
    if (!cell) throw new Error("Imported code cell missing");
    await asActor(owner, orgA, () =>
      deleteProjectCell.run(
        { projectId: project.id, cellId: cell.id },
        context,
      ),
    );
    const restored = await asActor(owner, orgA, () =>
      addProjectCell.run(
        { projectId: project.id, kind: "code", restore: cell.contents },
        context,
      ),
    );
    expect(restored.project.cells).toMatchObject([
      { id: cell.id, contents: cell.contents },
    ]);
  });

  it("answers not-found for an unknown neighbour and keeps the notebook unchanged", async () => {
    const before = await getProjectDocument(scopeA, notebook.id);
    await expect(
      asActor(owner, orgA, () =>
        addProjectCell.run(
          {
            projectId: notebook.id,
            kind: "sql",
            afterCellId: "cel_qa_missing",
          },
          actionContext(),
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 404, errorCode: "cell_not_found" });
    expect((await getProjectDocument(scopeA, notebook.id))?.cells.length).toBe(
      before?.cells.length,
    );
  });
});

describe("delete-project-cell", () => {
  it("removes a cell in the working version and preserves the remaining order", async () => {
    const before = await asActor(owner, orgA, () =>
      getProject.run({ projectId: notebook.id }, actionContext()),
    );
    const remaining = before.project.cells
      .filter((cell) => cell.id !== notebookSqlB)
      .map((cell) => cell.id);
    const result = await asActor(owner, orgA, () =>
      deleteProjectCell.run(
        { projectId: notebook.id, cellId: notebookSqlB },
        actionContext(),
      ),
    );
    expect(result.project.cells.map((cell) => cell.id)).toEqual(remaining);
    expect(
      (await getProjectDocument(scopeA, notebook.id))?.cells.some(
        (cell) => cell.id === notebookSqlB,
      ),
    ).toBe(false);
  });

  it("fails 404 for a cell that is not there instead of reporting a fake success", async () => {
    await expect(
      asActor(owner, orgA, () =>
        deleteProjectCell.run(
          { projectId: notebook.id, cellId: notebookSqlB },
          actionContext(),
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 404, errorCode: "cell_not_found" });
    await expect(
      asActor(owner, orgA, () =>
        deleteProjectCell.run(
          { projectId: notebook.id, cellId: "cel_qa_missing" },
          actionContext(),
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 404, errorCode: "cell_not_found" });
  });

  it("does not delete a cell that only exists in an older version", async () => {
    const published = await seedLegacyPublishedProject(scopeA, notebook.id);
    const oldVersionId = published.publishedVersionId;
    if (!oldVersionId) throw new Error("Published version missing");
    expect(published.workingVersionId).not.toBe(oldVersionId);
    const staleId = "cel_qa_stale";
    await insertCellRows({
      scope: scopeA,
      projectId: notebook.id,
      versionId: oldVersionId,
      cells: [sqlCell(staleId, "select 7 as seven", "stale")],
    });
    expect(
      (await projectCells(scopeA, notebook.id, oldVersionId)).some(
        (cell) => cell.id === staleId,
      ),
    ).toBe(true);
    await expect(
      asActor(owner, orgA, () =>
        deleteProjectCell.run(
          { projectId: notebook.id, cellId: staleId },
          actionContext(),
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 404, errorCode: "cell_not_found" });
    expect(
      (await projectCells(scopeA, notebook.id, oldVersionId)).some(
        (cell) => cell.id === staleId,
      ),
    ).toBe(true);
  });
});

describe("action input/output contracts over real writes and reads", () => {
  it("holds for every project action", async () => {
    const readProject = await createProject({
      ...scopeA,
      title: "QA property read",
      cells: [sqlCell("cel_qa_prop_read", "select 1 as one", "prop_read")],
    });
    const writeProject = await createProject({
      ...scopeA,
      title: "QA property write",
      cells: [sqlCell("cel_qa_prop_write", "select 2 as two", "prop_write")],
    });
    const addProject = await createProject({
      ...scopeA,
      title: "QA property add",
      cells: [sqlCell("cel_qa_prop_add", "select 3 as three", "prop_add")],
    });
    const deleteProject = await createProject({
      ...scopeA,
      title: "QA property delete",
      cells: [
        sqlCell("cel_qa_prop_delete_a", "select 4 as four", "prop_delete"),
        sqlCell("cel_qa_prop_delete_b", "select 5 as five", "prop_delete_b"),
      ],
    });
    const writeCell = writeProject.cells.at(0);
    const addAnchor = addProject.cells.at(0);
    const deleteCell = deleteProject.cells.at(1);
    if (!writeCell || !addAnchor || !deleteCell)
      throw new Error("Missing action property test fixture cells");
    const writeContents: CellContents = sqlContents(
      writeCell,
      "select 20 as twenty",
    );
    const restoreContents: CellContents = {
      ...baseCell,
      id: "cel_qa_prop_restore",
      order: addAnchor.contents.order,
      kind: "text",
      text: "Restored note",
    };

    await asActor(owner, orgA, async () => {
      await checkActionProperties(getProject, {
        context: actionContext(),
        runs: 6,
        seed: 11,
        overrides: { "/projectId": constant(readProject.id) },
      });
      await checkActionProperties(updateProject, {
        context: actionContext(),
        runs: 6,
        seed: 13,
        overrides: { "/projectId": constant(writeProject.id) },
      });
      await checkActionProperties(addProjectCell, {
        context: actionContext(),
        runs: 6,
        seed: 17,
        overrides: {
          "/projectId": constant(addProject.id),
          "/afterCellId": constant(addAnchor.id),
          "/kind": arbitraryFromJsonSchema({ enum: ADDABLE_CELL_KINDS }),
          "/dataframe": constant("prop_add"),
          "/restore": constant(restoreContents),
        },
      });
      await checkActionProperties(saveProjectCell, {
        context: actionContext(),
        runs: 5,
        seed: 19,
        overrides: {
          "/projectId": constant(writeProject.id),
          "/cellId": constant(writeCell.id),
          "/contents": constant(writeContents),
        },
      });
      await checkActionProperties(deleteProjectCell, {
        context: actionContext(),
        runs: 4,
        seed: 23,
        overrides: {
          "/projectId": constant(deleteProject.id),
          "/cellId": constant(deleteCell.id),
        },
      });
    });
  });
});

describe("import-project", () => {
  it("creates the project and preserves the notebook cell order and payloads", async () => {
    const result = await asActor(owner, orgA, () =>
      importProject.run(
        {
          title: "QA imported notebook",
          cells: [
            { kind: "markdown", markdown: "# Heading" },
            { kind: "code", source: "print('hello')" },
            { kind: "markdown", markdown: "Done." },
          ],
        },
        actionContext(),
      ),
    );

    expect(result.project.title).toBe("QA imported notebook");
    expect(result.project.cells).toHaveLength(3);
    expect(result.project.cells.map((cell) => cell.contents.kind)).toEqual([
      "markdown",
      "code",
      "markdown",
    ]);
    expect(result.project.cells[0]!.contents).toMatchObject({
      kind: "markdown",
      markdown: "# Heading",
    });
    expect(result.project.cells[1]!.contents).toMatchObject({
      kind: "code",
      source: "print('hello')",
      language: "python",
      outputResult: true,
    });

    const stored = await getProjectDocument(scopeA, result.project.id);
    expect(stored?.cells.map((cell) => cell.contents.kind)).toEqual([
      "markdown",
      "code",
      "markdown",
    ]);
  });

  it("refuses a member without create-project permission", async () => {
    await expect(
      asActor(viewer, orgA, () =>
        importProject.run(
          {
            title: "QA forbidden import",
            cells: [{ kind: "code", source: "print(1)" }],
          },
          actionContext(viewer, orgA),
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("transfer-project-owner", () => {
  it("moves the project to another member and removes the old owner's access", async () => {
    const project = await createProject({
      ...scopeA,
      title: "QA transfer owner",
      cells: [sqlCell("cel_qa_transfer", "select 1 as one", "transfer")],
    });

    const result = await asActor(owner, orgA, () =>
      transferProjectOwner.run(
        { projectId: project.id, ownerEmail: other },
        actionContext(),
      ),
    );
    expect(result.id).toBe(project.id);
    expect(await getProjectDocument(scopeA, project.id)).toBeNull();
    expect(await getProjectDocument(otherScopeA, project.id)).not.toBeNull();
  });

  it("refuses a target outside the workspace", async () => {
    const project = await createProject({
      ...scopeA,
      title: "QA transfer cross org",
      cells: [sqlCell("cel_qa_transfer_x", "select 1 as one", "transfer_x")],
    });
    await expect(
      asActor(owner, orgA, () =>
        transferProjectOwner.run(
          { projectId: project.id, ownerEmail: stranger },
          actionContext(),
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "owner_not_member",
    });
  });
});

describe("update-project status", () => {
  it("sets a workspace status and refuses another workspace's status", async () => {
    const project = await createProject({
      ...scopeA,
      title: "QA status project",
      cells: [sqlCell("cel_qa_status", "select 1 as one", "status")],
    });
    const status = await createStatus({
      ...scopeA,
      name: `QA review ${randomUUID()}`,
      description: "",
      color: null,
    });
    const updated = await asActor(owner, orgA, () =>
      updateProject.run(
        { projectId: project.id, statusId: status.id },
        actionContext(),
      ),
    );
    expect(updated.project.statusId).toBe(status.id);

    const otherStatus = await createStatus({
      ...scopeB,
      name: `QA other ${randomUUID()}`,
      description: "",
      color: null,
    });
    await expect(
      asActor(owner, orgA, () =>
        updateProject.run(
          { projectId: project.id, statusId: otherStatus.id },
          actionContext(),
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "project_status_not_found",
    });
  });

  it("lets only managers apply an endorsed status, and leaves open statuses to editors", async () => {
    const editor = `status-editor-${randomUUID()}@example.test`;
    const manager = `status-manager-${randomUUID()}@example.test`;
    for (const [email, role] of [
      [editor, "editor"],
      [manager, "manager"],
    ] as const) {
      await getDb().insert(orgMembers).values({
        id: randomUUID(),
        orgId: orgA,
        email,
        role: "member",
        joinedAt: Date.now(),
      });
      await getDb().insert(appMemberRoles).values({
        id: randomUUID(),
        orgId: orgA,
        email,
        appId,
        role,
        updatedBy: owner,
        updatedAt: Date.now(),
      });
    }
    const endorsed = await createStatus({
      ...scopeA,
      name: `QA endorsed ${randomUUID()}`.slice(0, 30),
      description: "",
      color: null,
      endorsed: true,
    });
    const open = await createStatus({
      ...scopeA,
      name: `QA open ${randomUUID()}`.slice(0, 30),
      description: "",
      color: null,
    });
    const editorProject = await createProject({
      ...scopeA,
      ownerEmail: editor,
      title: "QA editor status project",
      cells: [sqlCell("cel_qa_endorse_e", "select 1 as one", "endorse_e")],
    });
    const managerProject = await createProject({
      ...scopeA,
      ownerEmail: manager,
      title: "QA manager status project",
      cells: [sqlCell("cel_qa_endorse_m", "select 1 as one", "endorse_m")],
    });

    await expect(
      asActor(editor, orgA, () =>
        updateProject.run(
          { projectId: editorProject.id, statusId: endorsed.id },
          actionContext(editor),
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: "project_status_endorsed_manager_required",
    });
    const refused = await asActor(editor, orgA, () =>
      getProject.run({ projectId: editorProject.id }, actionContext(editor)),
    );
    expect(refused.project.statusId).not.toBe(endorsed.id);

    const opened = await asActor(editor, orgA, () =>
      updateProject.run(
        { projectId: editorProject.id, statusId: open.id },
        actionContext(editor),
      ),
    );
    expect(opened.project.statusId).toBe(open.id);

    const applied = await asActor(manager, orgA, () =>
      updateProject.run(
        { projectId: managerProject.id, statusId: endorsed.id },
        actionContext(manager),
      ),
    );
    expect(applied.project.statusId).toBe(endorsed.id);

    // A manager endorsed this project; the editor can still save around it.
    await updateProjectRow({
      ...scopeA,
      ownerEmail: editor,
      projectId: editorProject.id,
      statusId: endorsed.id,
    });
    const kept = await asActor(editor, orgA, () =>
      updateProject.run(
        {
          projectId: editorProject.id,
          title: "QA renamed",
          statusId: endorsed.id,
        },
        actionContext(editor),
      ),
    );
    expect(kept.project.title).toBe("QA renamed");
    expect(kept.project.statusId).toBe(endorsed.id);
    const cleared = await asActor(editor, orgA, () =>
      updateProject.run(
        { projectId: editorProject.id, statusId: null },
        actionContext(editor),
      ),
    );
    expect(cleared.project.statusId).toBeNull();
  });
});
