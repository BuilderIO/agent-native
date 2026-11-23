import {
  closeDbExec,
  runMigrations,
  type MigrationEntry,
} from "@agent-native/core/db";
import { and, eq } from "@agent-native/core/db/schema";
import {
  ORG_MIGRATIONS,
  appMemberRoles,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import {
  revokeWorkspaceConnectionGrant,
  upsertWorkspaceConnection,
  upsertWorkspaceConnectionGrant,
  upsertWorkspaceUserGroup,
} from "@agent-native/core/workspace-connections";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import getCapabilities from "../../actions/get-analytics-capabilities.js";
import getNotebookExecution from "../../actions/get-notebook-execution.js";
import getNotebookRunDiagnostics from "../../actions/get-notebook-run-diagnostics.js";
import getProject from "../../actions/get-project.js";
import listProjects from "../../actions/list-projects.js";
import runProjectCell from "../../actions/run-project-cell.js";
import startNotebookRun from "../../actions/start-notebook-run.js";
import type { CellDraft } from "../../app/lib/model/contracts.js";
import {
  type CapabilityDecision,
  type CapabilityScopeRef,
  type ControlId,
  capabilityScopeRefSchema,
  controlIdSchema,
} from "../../shared/capabilities.js";
import { runRequestSchema } from "../../shared/notebook-execution.js";
import { SAMPLE_DATA_SOURCE_ID } from "../../shared/sample-data-contract.js";
import { getDb, schema } from "../db/index.js";
import { ensureAnalyticsDatabase } from "../model/database.js";
import { seedLegacyPublishedProject } from "../model/legacy-published-fixture.test-support.js";
import { sweepNotebookRuns } from "../model/notebook-execution/service.js";
import { createProject } from "../model/projects-store.js";
import {
  ANALYTICS_CONTROL_IDS as ids,
  requireCapability,
} from "./analytics-capabilities.js";

const orgId = "capability-workspace";
const otherOrgId = "capability-other-workspace";
const appId = "analytics-2";
const owner = "owner@example.test";
const unrelated = "unrelated@example.test";
const editor = "editor@example.test";
const admin = "admin@example.test";
const viewer = "viewer@example.test";
const projectId = "capability-project";
const cellId = "sample-sql";

const workspace = capabilityScopeRefSchema.parse({
  kind: "workspace",
  workspaceId: orgId,
});
const draft = capabilityScopeRefSchema.parse({
  kind: "cell",
  workspaceId: orgId,
  projectId,
  cellId,
});
const release = capabilityScopeRefSchema.parse({
  kind: "release",
  workspaceId: orgId,
  projectId,
  releaseId: "latest",
});

function actionContext(userEmail: string, activeOrg = orgId) {
  return { caller: "frontend" as const, appId, userEmail, orgId: activeOrg };
}

function asActor<T>(userEmail: string, run: () => T, activeOrg = orgId) {
  return runWithRequestContext({ userEmail, orgId: activeOrg }, run);
}

function projectWithSql(id: string, connectionId = SAMPLE_DATA_SOURCE_ID) {
  const cell: CellDraft = {
    id: cellId,
    kind: "sql",
    label: null,
    hidden: false,
    gridX: null,
    gridY: null,
    gridWidth: null,
    gridHeight: null,
    source: "select product_id from products limit 2",
    dataConnectionId: connectionId,
    databaseSchema: null,
    resultVariable: null,
    outputResult: true,
  };
  return createProject({
    ownerEmail: owner,
    orgId,
    projectId: id,
    title: "Capability proof",
    cells: [cell],
  });
}

async function grantViewer(id: string) {
  await getDb()
    .insert(schema.projectShares)
    .values({
      id: `grant-${id}`,
      resourceId: id,
      principalType: "user",
      principalId: viewer,
      role: "viewer",
      createdBy: owner,
      createdAt: new Date().toISOString(),
    });
}

async function projectDecision(
  email: string,
  controlId: ControlId,
  scope: CapabilityScopeRef,
  activeOrg = orgId,
) {
  const { decisions } = await asActor(
    email,
    () =>
      getCapabilities.run(
        { scope, controlIds: [controlId] },
        { caller: "frontend", appId, userEmail: email, orgId: activeOrg },
      ),
    activeOrg,
  );
  expect(decisions).toHaveLength(1);
  return decisions[0];
}

type Refusal = Exclude<CapabilityDecision, { status: "allowed" }>;
type Expected = { status: "allowed" } | Pick<Refusal, "status" | "reason">;

async function assertDecision(
  email: string,
  controlId: ControlId,
  scope: CapabilityScopeRef,
  expected: Expected,
  activeOrg = orgId,
) {
  const check = asActor(
    email,
    () => requireCapability(controlId, scope),
    activeOrg,
  );
  if (expected.status === "allowed") {
    const decision = await check;
    expect(decision).toMatchObject({ controlId, scope, status: "allowed" });
    await expect(
      projectDecision(email, controlId, scope, activeOrg),
    ).resolves.toEqual(decision);
  } else {
    await expect(check).rejects.toMatchObject({ errorCode: expected.reason });
    await expect(
      projectDecision(email, controlId, scope, activeOrg),
    ).resolves.toEqual({ controlId, scope, ...expected });
  }
}

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  await closeDbExec();
  const migrations = ORG_MIGRATIONS.map(
    ({ name, ...entry }): MigrationEntry =>
      name === undefined ? entry : { ...entry, name },
  );
  await runMigrations(migrations, { table: "test_org_migrations" })(undefined);
  await ensureAnalyticsDatabase();
  await getDb()
    .insert(organizations)
    .values(
      [orgId, otherOrgId].map((id) => ({
        id,
        name: id,
        createdAt: 1,
        createdBy: admin,
      })),
    );
  await getDb()
    .insert(orgMembers)
    .values([
      ...[owner, unrelated, editor, admin, viewer].map((email) => ({
        id: email,
        orgId,
        email,
        role: email === admin ? "admin" : "member",
        joinedAt: 1,
      })),
      {
        id: "other-owner-membership",
        orgId: otherOrgId,
        email: owner,
        role: "member",
        joinedAt: 1,
      },
    ]);
  await getDb().insert(appMemberRoles).values({
    id: "capability-editor-role",
    orgId,
    appId,
    email: editor,
    role: "editor",
    updatedBy: admin,
    updatedAt: 1,
  });
  await projectWithSql(projectId);
  await seedLegacyPublishedProject({ ownerEmail: owner, orgId }, projectId);
  await grantViewer(projectId);
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
});

const allowed = { status: "allowed" } as const;
const denied = { status: "denied", reason: "access_denied" } as const;

describe("scoped analytics capabilities", () => {
  it.each([
    ["owning Member", owner, denied, allowed, allowed, denied, denied],
    ["unrelated Member", unrelated, denied, denied, denied, denied, denied],
    ["workspace Editor", editor, allowed, denied, denied, allowed, denied],
    ["org admin", admin, allowed, denied, denied, allowed, allowed],
    ["read-granted viewer", viewer, denied, denied, allowed, denied, denied],
  ] as const)(
    "keeps projection and server assertion in agreement for the %s",
    async (_role, email, create, run, open, browse, connect) => {
      await assertDecision(email, ids.createProject, workspace, create);
      await assertDecision(email, ids.generateApp, workspace, create);
      await assertDecision(email, ids.runDraftSql, draft, run);
      await assertDecision(email, ids.openPublishedApp, release, open);
      await assertDecision(email, ids.dataBrowse, workspace, browse);
      await assertDecision(
        email,
        ids.bigQueryConnectionCreate,
        workspace,
        connect,
      );
    },
  );

  it("denies the same project owner when the active workspace differs", async () => {
    await assertDecision(
      owner,
      ids.runDraftSql,
      draft,
      { status: "denied", reason: "wrong_workspace" },
      otherOrgId,
    );
    await assertDecision(
      owner,
      ids.runDraftSql,
      capabilityScopeRefSchema.parse({ ...draft, workspaceId: otherOrgId }),
      denied,
      otherOrgId,
    );
  });

  it("projects working-cell and release decisions through the notebook read and enforces them on the live actions", async () => {
    const appRequest = {
      projectId,
      surface: "app",
      version: "latest",
      viewId: crypto.randomUUID(),
    } as const;
    const draftRead = await asActor(owner, () =>
      getProject.run({ projectId }, actionContext(owner)),
    );
    expect(draftRead.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          controlId: ids.runDraftSql,
          scope: draft,
          status: "allowed",
        }),
        expect.objectContaining({
          controlId: ids.openPublishedApp,
          scope: release,
          status: "allowed",
        }),
      ]),
    );
    await expect(
      asActor(owner, () =>
        runProjectCell.run({ projectId, cellId }, actionContext(owner)),
      ),
    ).resolves.toMatchObject({ status: "complete", output: { rowCount: 2 } });

    const viewerRead = await asActor(viewer, () =>
      getProject.run({ projectId }, actionContext(viewer)),
    );
    expect(viewerRead.capabilities).toEqual(
      expect.arrayContaining([
        { controlId: ids.runDraftSql, scope: draft, ...denied },
        expect.objectContaining({
          controlId: ids.openPublishedApp,
          scope: release,
          status: "allowed",
        }),
      ]),
    );
    await expect(
      asActor(viewer, () => getProject.run(appRequest, actionContext(viewer))),
    ).resolves.toMatchObject({ project: { id: projectId } });
    await expect(
      asActor(owner, () =>
        getProject.run(
          { ...appRequest, version: draftRead.project.workingVersionId },
          actionContext(owner),
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "missing_backing", statusCode: 404 });

    for (const [email, activeOrg] of [
      [viewer, orgId],
      [editor, orgId],
      [owner, otherOrgId],
    ] as const) {
      await expect(
        asActor(
          email,
          () =>
            runProjectCell.run(
              { projectId, cellId },
              actionContext(email, activeOrg),
            ),
          activeOrg,
        ),
      ).rejects.toMatchObject({ errorCode: "access_denied", statusCode: 403 });
    }
    await expect(
      asActor(
        owner,
        () => getProject.run(appRequest, actionContext(owner, otherOrgId)),
        otherOrgId,
      ),
    ).rejects.toMatchObject({
      errorCode: "project_not_found",
      statusCode: 404,
    });
  });

  it("returns backed column decisions alongside the scoped Projects rows", async () => {
    const result = await asActor(owner, () =>
      listProjects.run({ view: "active", search: "" }, actionContext(owner)),
    );
    expect(result.viewer).toEqual({ email: owner, orgId });
    expect(
      result.capabilities.map(({ controlId, status }) => [controlId, status]),
    ).toEqual([
      [ids.projectAppViews, "allowed"],
      [ids.projectAppLastPublished, "allowed"],
      [ids.projectAppLastViewed, "allowed"],
      [ids.projectYourAccess, "allowed"],
      [ids.projectSharedWith, "allowed"],
    ]);
    expect(result.projects).toContainEqual(
      expect.objectContaining({
        id: projectId,
        appViews: expect.any(Number),
        appLastViewedAt: null,
        lastPublishedAt: expect.any(String),
        yourAccess: "owner",
        sharedWith: { workspace: false, directCount: 1 },
      }),
    );
  });

  it("rejects a revoked project read grant after a ready projection", async () => {
    const id = "capability-grant-revocation";
    await projectWithSql(id);
    const published = await seedLegacyPublishedProject(
      { ownerEmail: owner, orgId },
      id,
    );
    await grantViewer(id);
    const scope = capabilityScopeRefSchema.parse({
      ...release,
      projectId: id,
      releaseId: published.publishedVersionId,
    });
    const ready = await projectDecision(viewer, ids.openPublishedApp, scope);
    expect(ready).toMatchObject({ status: "allowed" });
    await getDb()
      .delete(schema.projectShares)
      .where(eq(schema.projectShares.resourceId, id));
    await assertDecision(viewer, ids.openPublishedApp, scope, denied);
  });

  it("rejects a revoked SQL connection grant after a ready projection", async () => {
    const connection = await asActor(admin, () =>
      upsertWorkspaceConnection({
        provider: "bigquery",
        label: "Capability proof warehouse",
        status: "connected",
        allowedApps: ["other-app"],
        config: { viewAccessGroupIds: [] },
      }),
    );
    await asActor(admin, () =>
      upsertWorkspaceConnectionGrant({ connectionId: connection.id, appId }),
    );
    const id = "capability-connection-revocation";
    await projectWithSql(id, connection.id);
    const scope = capabilityScopeRefSchema.parse({ ...draft, projectId: id });
    const alias = controlIdSchema.parse("run-cell");
    const ready = await projectDecision(owner, ids.runDraftSql, scope);
    expect(ready).toMatchObject({ status: "allowed" });
    await expect(projectDecision(owner, alias, scope)).resolves.toEqual({
      ...ready,
      controlId: alias,
    });
    const execution = await asActor(owner, () =>
      getNotebookExecution.run({ projectId: id }, actionContext(owner)),
    );
    if (execution.status !== "found")
      throw new Error("Expected a draft snapshot");
    const queued = await asActor(owner, () =>
      startNotebookRun.run(
        runRequestSchema.parse({
          snapshot: execution.snapshot,
          requestId: "run-all-before-revocation",
          mode: "run-all",
          restart: false,
          cache: "reuse",
        }),
        actionContext(owner),
      ),
    );
    const attempt = queued.status === "admitted" && queued.attempts[0]?.attempt;
    if (!attempt) throw new Error("Expected a queued SQL attempt");
    await expect(
      asActor(admin, () =>
        revokeWorkspaceConnectionGrant(connection.id, appId),
      ),
    ).resolves.toBe(true);
    await assertDecision(owner, alias, scope, {
      status: "denied",
      reason: "source_access_denied",
    });
    await expect(
      asActor(owner, () =>
        runProjectCell.run({ projectId: id, cellId }, actionContext(owner)),
      ),
    ).rejects.toMatchObject({
      errorCode: "source_access_denied",
      statusCode: 403,
    });
    await expect(
      asActor(owner, () =>
        startNotebookRun.run(
          runRequestSchema.parse({
            snapshot: execution.snapshot,
            requestId: "cell-only-after-revocation",
            mode: "cell-only",
            targetCellId: cellId,
            staleValues: "reject",
            cache: "reuse",
          }),
          actionContext(owner),
        ),
      ),
    ).resolves.toEqual(denied);
    await sweepNotebookRuns({ deadlineAt: Date.now() + 30_000 });
    await expect(
      asActor(owner, () =>
        getNotebookRunDiagnostics.run(
          { runId: attempt.runId, attemptId: attempt.attemptId },
          actionContext(owner),
        ),
      ),
    ).resolves.toMatchObject({
      status: "found",
      diagnostic: { code: "source_access_denied" },
      compiledSql: null,
    });
  });

  it("restores SQL admission and the run capability for a shared project editor in the warehouse group", async () => {
    const name = "Notebook warehouse group";
    const group = await asActor(admin, () =>
      upsertWorkspaceUserGroup({ name, memberEmails: [viewer] }),
    );
    const connection = await asActor(admin, () =>
      upsertWorkspaceConnection({
        provider: "bigquery",
        label: name,
        status: "connected",
        allowedApps: [appId],
        allowedUsers: [admin],
        allowedUserGroups: [group.id],
        config: {
          queryAccessGroupIds: [group.id],
          viewAccessGroupIds: [group.id],
        },
      }),
    );
    await asActor(admin, () =>
      upsertWorkspaceConnectionGrant({ connectionId: connection.id, appId }),
    );
    const id = "capability-group-sql";
    await projectWithSql(id, connection.id);
    await grantViewer(id);
    await getDb()
      .update(schema.projectShares)
      .set({ role: "editor" })
      .where(eq(schema.projectShares.resourceId, id));
    const execution = () =>
      asActor(viewer, () =>
        getNotebookExecution.run({ projectId: id }, actionContext(viewer)),
      );
    const before = await execution();
    if (before.status !== "found") throw new Error("Expected a draft snapshot");
    const request = runRequestSchema.parse({
      snapshot: before.snapshot,
      requestId: "group-restored-sql",
      mode: "cell-only",
      targetCellId: cellId,
      staleValues: "reject",
      cache: "bypass",
    });
    const admit = () =>
      asActor(viewer, () =>
        startNotebookRun.run(request, actionContext(viewer)),
      );
    const membership = (memberEmails: string[]) =>
      asActor(admin, () =>
        upsertWorkspaceUserGroup({ id: group.id, name, memberEmails }),
      );
    await membership([]);
    await expect(admit()).resolves.toEqual(denied);
    await expect(execution()).resolves.toEqual(before);
    await membership([viewer]);
    await expect(admit()).resolves.toMatchObject({
      status: "admitted",
      plan: { admittedCellIds: [cellId] },
    });
    const read = await asActor(viewer, () =>
      getProject.run({ projectId: id }, actionContext(viewer)),
    );
    expect(read.capabilities).toContainEqual(
      expect.objectContaining({
        controlId: ids.runDraftSql,
        scope: expect.objectContaining({ cellId }),
        status: "allowed",
      }),
    );
  });

  it("allows a backed Projects column and preserves exact reasons for unknown, unsupported and unmounted controls", async () => {
    await assertDecision(viewer, ids.projectYourAccess, workspace, allowed);
    await assertDecision(admin, controlIdSchema.parse("unknown"), workspace, {
      status: "absent",
      reason: "unknown_control",
    });
    for (const id of [ids.unsupportedConnector, ids.placeholderColumn]) {
      await assertDecision(admin, id, workspace, {
        status: "unavailable",
        reason: "unsupported",
      });
    }
    await assertDecision(
      owner,
      ids.explore,
      capabilityScopeRefSchema.parse({
        ...workspace,
        kind: "project",
        projectId,
      }),
      { status: "unavailable", reason: "missing_backing" },
    );
  });

  it("distinguishes unreadable authorization backing from denial", async () => {
    const id = "capability-unreadable-sql";
    await projectWithSql(id);
    const scope = capabilityScopeRefSchema.parse({ ...draft, projectId: id });
    await assertDecision(owner, ids.runDraftSql, scope, allowed);
    await getDb()
      .update(schema.cells)
      .set({ contents: "{" })
      .where(and(eq(schema.cells.projectId, id), eq(schema.cells.id, cellId)));
    await assertDecision(owner, ids.runDraftSql, scope, {
      status: "unreadable",
      reason: "read_failed",
    });
  });
});
