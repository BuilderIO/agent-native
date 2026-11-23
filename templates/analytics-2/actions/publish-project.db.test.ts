import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  arbitraryFromJsonSchema,
  checkActionProperties,
} from "@agent-native/core/action-properties";
import {
  closeDbExec,
  getDbExec,
  runMigrations,
  sql,
} from "@agent-native/core/db";
import {
  ORG_MIGRATIONS,
  appMemberRoles,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { unregisterPrivateBlobProvider } from "@agent-native/core/private-blob";
import {
  loadActionsFromStaticRegistry,
  runWithRequestContext,
} from "@agent-native/core/server";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { inputDisplayLabel } from "../app/components/notebook/utils.js";
import type { CellDraft } from "../app/lib/model/contracts.js";
import { flows06To10 } from "../e2e/phase1/flows-06-10.js";
import type { FlowContext } from "../e2e/phase1/runtime.js";
import { getDb, schema } from "../server/db/index.js";
import { analyticsMigrations } from "../server/db/migrations.js";
import { createNotebookWorker } from "../server/execution/notebook-worker.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { seedLegacyPublishedProject } from "../server/model/legacy-published-fixture.test-support.js";
import { getNotebookExecution } from "../server/model/notebook-execution/draft-state.js";
import { digest } from "../server/model/notebook-execution/planner.js";
import type { Claim } from "../server/model/notebook-execution/run-store.js";
import {
  notebookOutputs,
  notebookResultManifests,
  notebookRuns,
  notebookRunWork,
} from "../server/model/notebook-execution/schema.js";
import {
  notebookRunStore,
  sweepNotebookRuns,
  wakeNotebookRun,
} from "../server/model/notebook-execution/service.js";
import { getNotebookResultPage } from "../server/model/notebook-results.js";
import {
  readProjectRelease,
  readReleaseManifest,
} from "../server/model/project-releases.js";
import {
  createProject,
  getProjectDocument,
  listProjectVersions,
} from "../server/model/projects-store.js";
import { openPublishedAppSession } from "../server/model/published-app-sessions.js";
import registerNotebookExecution from "../server/plugins/notebook-execution.js";
import { openAppSessionInput } from "../shared/app-session-operations.js";
import { resultIdSchema } from "../shared/notebook-execution.js";
import { restoreProjectVersionInputSchema } from "../shared/notebook-history.js";
import {
  authorizedResultRefSchema,
  completeResultManifestSchema,
} from "../shared/notebook-result-contract.js";
import { notebookCellIdSchema } from "../shared/notebook-snapshot-contract.js";
import {
  createPublishPreviewInput,
  publishPreviewDetailSchema,
  publishProjectInput,
  type PublishPreviewDetail,
} from "../shared/project-publish.js";
import { SAMPLE_DATA_SOURCE_ID } from "../shared/sample-data-contract.js";
import addProjectCell from "./add-project-cell.js";
import admitBrowserNotebookRun from "./admit-browser-notebook-run.js";
import cancelPreview from "./cancel-project-publish-preview.js";
import completeBrowserNotebookRun from "./complete-browser-notebook-run.js";
import createPreview from "./create-project-publish-preview.js";
import createProjectAction from "./create-project.js";
import getNotebookTransform from "./get-notebook-transform.js";
import getPreview from "./get-project-publish-preview.js";
import getProject from "./get-project.js";
import publishProject from "./publish-project.js";
import saveProjectCell from "./save-project-cell.js";

vi.mock(
  "../server/model/notebook-execution/service.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../server/model/notebook-execution/service.js")
    >()),
    wakeNotebookRun: vi.fn(),
  }),
);

const round = mkdtempSync(join(tmpdir(), "publish-project-"));
const previousDatabase = process.env.DATABASE_URL;
const owner = "publish-owner@example.test";
const orgId = `qa-publish-${randomUUID()}`;
const scope = { ownerEmail: owner, orgId };
const context = {
  caller: "frontend" as const,
  userEmail: owner,
  orgId,
  appId: "analytics-2",
};

function asActor<T>(call: () => T) {
  return runWithRequestContext(
    {
      userEmail: owner,
      orgId,
      authUserId: owner,
      userName: "QA publish",
      isSyntheticTraffic: true,
    },
    call,
  );
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_publish_project_org_migrations",
  })(null);
  await runMigrations(
    analyticsMigrations.filter(({ version }) => version <= 15),
    {
      table: "analytics2_migrations",
    },
  )(null);
  await getDbExec().execute(sql`
    INSERT INTO analytics2_projects (
      id, org_id, owner_email, title, working_version_id, created_at, updated_at
    ) VALUES (
      'v15-publish-fixture', ${sql.value(orgId)}, ${sql.value(owner)}, 'Existing notebook',
      'v15-working-fixture', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
    )
  `);
  await ensureAnalyticsDatabase();
  await getDb().insert(organizations).values({
    id: orgId,
    name: "QA publish",
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
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  const owned = resolve(round),
    temporary = resolve(tmpdir());
  if (
    owned !== temporary &&
    owned !== resolve(process.cwd()) &&
    owned.startsWith(temporary + "/publish-project-")
  )
    rmSync(owned, { recursive: true, force: true });
  else throw new Error("Refused cleanup outside this test round");
});

async function previewInput(projectId: string, requestId = randomUUID()) {
  const project = await getProjectDocument(scope, projectId);
  if (!project?.draftHead) throw new Error("Missing draft head");
  return createPublishPreviewInput.parse({
    projectId,
    expectedHead: project.draftHead,
    expectedReleaseId: project.publishedVersionId,
    requestId,
  });
}

async function detail(projectId: string, previewId: string) {
  return publishPreviewDetailSchema.parse(
    await asActor(() => getPreview.run({ projectId, previewId }, context)),
  );
}

async function openPreview(projectId: string, requestId?: string) {
  const input = await previewInput(projectId, requestId);
  const receipt = await asActor(() => createPreview.run(input, context));
  return detail(projectId, receipt.previewId);
}

function publish(
  preview: PublishPreviewDetail,
  overrides: Partial<Parameters<typeof publishProject.run>[0]> = {},
) {
  return asActor(() =>
    publishProject.run(
      publishProjectInput.parse({
        projectId: preview.projectId,
        previewId: preview.previewId,
        expectedHead: preview.head,
        expectedReleaseId: preview.compareReleaseId,
        expectedManifestRevision: preview.manifestRevision,
        mode: "ready",
        requestId: randomUUID(),
        ...overrides,
      }),
      context,
    ),
  );
}

const sampleSql: CellDraft = {
  kind: "sql",
  source: "select product_id from products limit 1",
  dataConnectionId: SAMPLE_DATA_SOURCE_ID,
  databaseSchema: null,
  resultVariable: "products_result",
  outputResult: true,
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
};

async function claimPreview(preview: PublishPreviewDetail) {
  if (!preview.runId) throw new Error("Missing preview run");
  const claim = await notebookRunStore.claim(scopeWithCaller, preview.runId);
  if (!claim) throw new Error("Missing preview attempt");
  return claim;
}

const scopeWithCaller = { ...scope, caller: "frontend" };

function completeEmpty(claim: Claim) {
  const expected = authorizedResultRefSchema.parse({
    resultId: randomUUID(),
    snapshot: claim.run.receipt.request.snapshot.ref,
    producer: { ...claim.attempt, exportId: "output" },
    inputRevision: claim.run.receipt.request.snapshot.inputRevision,
    dependencyFingerprint: digest(
      claim.dependencies.map(({ result }) => result.resultId),
    ),
    kernelGeneration: null,
    sourceGeneration: null,
  });
  return {
    status: "result",
    expected,
    artifact: {
      manifest: completeResultManifestSchema.parse({
        status: "complete-empty",
        fields: [],
        rowCount: "0",
        result: expected,
      }),
      artifacts: [],
      authorities: [],
    },
  } as const;
}

describe("publish-project", () => {
  it("publishes a persisted version with optional details and reads it back", async () => {
    const scope = { ownerEmail: owner, orgId };
    const source = await createProject({
      ...scope,
      title: "QA publish notebook",
      cells: [
        {
          kind: "markdown",
          markdown: "# Totals",
          label: null,
          hidden: false,
          gridX: null,
          gridY: null,
          gridWidth: null,
          gridHeight: null,
        },
      ],
    });
    const preview = await openPreview(source.id);
    const result = await publish(preview, { description: "Updated totals" });
    const projected = await getProjectDocument(scope, source.id);
    if (!projected) throw new Error("Missing project");
    expect(projected.publishedHead).toEqual(preview.head);
    expect(projected.publishedVersionId).not.toBeNull();
    expect(projected.workingVersionId).not.toBe(projected.publishedVersionId);
    expect(projected.workingVersionId).toBe(source.workingVersionId);
    expect(projected.cells[0]?.contents).toMatchObject({
      kind: "markdown",
      markdown: "# Totals",
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
    });
    expect(projected.publishedVersionId).toBe(result.releaseId);
    expect(result.manifestId).toBe(preview.manifestId);
    const versions = await listProjectVersions(scope, source.id);
    expect(versions[0]).toMatchObject({
      kind: "published",
      name: "Updated totals",
    });
  });

  it("refuses foreign workspace and owner ids without creating a version", async () => {
    const foreignWorkspace = await createProject({
      ownerEmail: owner,
      orgId: "another-workspace",
      title: "QA foreign workspace",
    });
    const foreignOwner = await createProject({
      ownerEmail: "another@example.test",
      orgId,
      title: "QA foreign owner",
    });
    for (const source of [foreignWorkspace, foreignOwner]) {
      const args = createPublishPreviewInput.parse({
        projectId: source.id,
        expectedHead: source.draftHead,
        expectedReleaseId: null,
        requestId: randomUUID(),
      });
      await expect(
        asActor(() => createPreview.run(args, context)),
      ).rejects.toMatchObject({ statusCode: 403, errorCode: "access_denied" });
      const reread = await getProjectDocument(
        {
          ownerEmail: source.ownerEmail,
          orgId:
            source.id === foreignWorkspace.id ? "another-workspace" : orgId,
        },
        source.id,
      );
      expect(reread?.publishedVersionId).toBeNull();
    }
  });

  it("refuses a viewer even for their own notebook", async () => {
    const email = "publish-viewer@example.test";
    await getDb().insert(orgMembers).values({
      id: randomUUID(),
      orgId,
      email,
      role: "viewer",
      joinedAt: Date.now(),
    });
    await getDb().insert(appMemberRoles).values({
      id: randomUUID(),
      orgId,
      email,
      appId: "analytics-2",
      role: "viewer",
      updatedBy: owner,
      updatedAt: Date.now(),
    });
    const source = await createProject({
      ownerEmail: email,
      orgId,
      title: "QA viewer notebook",
    });
    await expect(
      runWithRequestContext(
        { userEmail: email, orgId, authUserId: email },
        () =>
          createPreview.run(
            createPublishPreviewInput.parse({
              projectId: source.id,
              expectedHead: source.draftHead,
              expectedReleaseId: null,
              requestId: randomUUID(),
            }),
            { ...context, userEmail: email },
          ),
      ),
    ).rejects.toThrow();
    expect(
      (await getProjectDocument({ ownerEmail: email, orgId }, source.id))
        ?.publishedVersionId,
    ).toBeNull();
  });

  it("satisfies action properties for generated version details", async () => {
    const source = await createProject({
      ownerEmail: owner,
      orgId,
      title: "QA publish properties",
    });
    await asActor(() =>
      checkActionProperties(publishProject, {
        context,
        runs: 6,
        seed: 31,
        overrides: {
          "/projectId": arbitraryFromJsonSchema({ const: source.id }),
          "/expectedHead/revision": arbitraryFromJsonSchema({ const: "0" }),
          "/expectedManifestRevision": arbitraryFromJsonSchema({ const: "0" }),
        },
      }),
    );
  });
});

it("report FLOW-version-history-restore preserves the published snapshot and restores its cells and outputs into a new draft", async () => {
  const { updateCell } = await import("../server/model/cells-store.js");
  const { readProjectOutputs, reserveCellOutputGeneration } =
    await import("../server/model/runs-store.js");
  const { default: restore } = await import("./restore-project-version.js");
  const scope = { ownerEmail: owner, orgId };
  const project = await createProject({
    ...scope,
    cells: [
      {
        kind: "markdown",
        markdown: "old",
        label: null,
        hidden: false,
        gridX: null,
        gridY: null,
        gridWidth: null,
        gridHeight: null,
      },
    ],
  });
  const cell = project.cells.at(0);
  if (!cell || cell.contents.kind !== "markdown")
    throw new Error("Expected a markdown cell");
  await getDb()
    .insert(schema.cellOutputs)
    .values({
      projectId: project.id,
      cellId: cell.id,
      status: "complete",
      output: JSON.stringify({
        type: "table",
        columns: [],
        rows: [["old"]],
        rowCount: 1,
        truncated: false,
      }),
      ranAt: new Date().toISOString(),
      connectionProvenanceRecorded: true,
    });
  const published = await seedLegacyPublishedProject(scope, project.id);
  const versionId = published.publishedVersionId;
  if (!versionId) throw new Error("Expected a published version");
  await updateCell({
    ...scope,
    projectId: project.id,
    versionId: project.workingVersionId,
    cellId: cell.id,
    contents: { ...cell.contents, markdown: "new" },
    expectedUpdatedAt: cell.updatedAt,
  });
  const runId = randomUUID();
  await getDb().transaction(async (tx) => {
    await reserveCellOutputGeneration(project.id, cell.id, runId, tx);
    await tx
      .update(schema.cellOutputs)
      .set({
        runId,
        output: JSON.stringify({
          type: "table",
          columns: [],
          rows: [["new"]],
          rowCount: 1,
          truncated: false,
        }),
      })
      .where(eq(schema.cellOutputs.cellId, cell.id));
  });
  expect(
    (await readProjectOutputs(scope, project.id))[cell.id]?.output,
  ).toMatchObject({ rows: [["new"]] });
  const currentDraft = await getProjectDocument(scope, project.id);
  const result = await asActor(() =>
    restore.run(
      restoreProjectVersionInputSchema.parse({
        projectId: project.id,
        versionId,
        observedHead: currentDraft?.draftHead,
        opId: randomUUID(),
      }),
      context,
    ),
  );
  expect(result.project.workingVersionId).not.toBe(project.workingVersionId);
  expect(result.project.publishedVersionId).toBe(versionId);
  expect(result.project.cells[0]?.contents).toMatchObject({ markdown: "old" });
  expect(
    (await readProjectOutputs(scope, project.id))[cell.id]?.output,
  ).toMatchObject({ rows: [["old"]] });
  expect(
    (await getProjectDocument(scope, project.id, versionId))?.cells[0]
      ?.contents,
  ).toMatchObject({ markdown: "old" });
  expect(
    await updateCell({
      ...scope,
      projectId: project.id,
      versionId: project.workingVersionId,
      cellId: cell.id,
      contents: cell.contents,
      expectedUpdatedAt: cell.updatedAt,
    }),
  ).toBeNull();
  const restoredDraft = await asActor(() =>
    restore.run(
      restoreProjectVersionInputSchema.parse({
        projectId: project.id,
        versionId: project.workingVersionId,
        observedHead: result.project.draftHead,
        opId: randomUUID(),
      }),
      context,
    ),
  );
  expect(restoredDraft.project.publishedVersionId).toBe(versionId);
  expect(restoredDraft.project.cells[0]?.contents).toMatchObject({
    markdown: "new",
  });
  expect(
    (await readProjectOutputs(scope, project.id))[cell.id]?.output,
  ).toMatchObject({ rows: [["new"]] });
  expect(
    (await readProjectOutputs(scope, project.id, versionId))[cell.id]?.output,
  ).toMatchObject({ rows: [["old"]] });
});

it("upgrades v15 through sharing and schedules without replacing existing draft state", async () => {
  const projectId = "v15-publish-fixture";
  const row = await getProjectDocument(scope, projectId);
  expect(row).toMatchObject({
    title: "Existing notebook",
    workingVersionId: "v15-working-fixture",
    publishedVersionId: null,
  });
  const db = getDb();
  expect(
    await db
      .select({ revision: schema.projects.appSharingRevision })
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.id, projectId),
          eq(schema.projects.orgId, orgId),
        ),
      )
      .limit(1),
  ).toEqual([{ revision: 0n }]);
  expect(
    await db
      .select({ id: schema.publishedAppGrants.id })
      .from(schema.publishedAppGrants)
      .where(
        and(
          eq(schema.publishedAppGrants.projectId, projectId),
          eq(schema.publishedAppGrants.orgId, orgId),
        ),
      )
      .limit(1),
  ).toEqual([]);
  expect(
    await db
      .select({ id: schema.publishedAppSchedules.id })
      .from(schema.publishedAppSchedules)
      .where(
        and(
          eq(schema.publishedAppSchedules.projectId, projectId),
          eq(schema.publishedAppSchedules.orgId, orgId),
        ),
      )
      .limit(1),
  ).toEqual([]);
  const ledger = await getDbExec().execute(sql`
    SELECT name, version FROM analytics2_migrations_named
    WHERE version BETWEEN 19 AND 34
    ORDER BY version
  `);
  expect(
    ledger.rows.map(({ name, version }) => [name, String(version)]),
  ).toEqual([
    ["analytics2-cell-output-undo", "19"],
    ["analytics2-notebook-commands", "20"],
    ["analytics2-notebook-execution", "21"],
    ["analytics2-kernel-namespaces", "22"],
    ["analytics2-notebook-result-artifacts", "23"],
    ["analytics2-app-layouts", "24"],
    ["analytics2-notebook-run-controls", "25"],
    ["analytics2-notebook-kernel-results", "26"],
    ["analytics2-notebook-creation-history-and-undo", "27"],
    ["analytics2-publish-previews-and-releases", "28"],
    ["analytics2-published-app-sessions", "29"],
    ["analytics2-notebook-proposals", "30"],
    ["analytics2-full-result-visualizations", "31"],
    ["analytics2-published-app-sharing", "32"],
    ["analytics2-published-app-schedules", "33"],
    ["analytics2-ask-thread-lifecycle", "34"],
  ]);
});

it("seeds the publish runner with a Region dropdown bound to region", async () => {
  const runner = flows06To10.find(({ id }) => id === "10-arrange-and-publish");
  if (!runner) throw new Error("The publish runner is missing");
  const registered = loadActionsFromStaticRegistry({
    "create-project": createProjectAction,
    "add-project-cell": addProjectCell,
    "save-project-cell": saveProjectCell,
    "get-project": getProject,
  });
  const identities = new Map<string, string>();
  const browserBoundary = new Error("Open the seeded app builder");
  const flow = {
    name: (name: string) => name,
    id: (key: string, value: string) => identities.set(key, value),
    async action(name: string, input: object) {
      const action = registered[name];
      if (!action) throw new Error(`Unexpected seed action ${name}`);
      return asActor(() => action.run(action.schema.parse(input), context));
    },
    async open() {
      throw browserBoundary;
    },
  } as unknown as FlowContext;
  await expect(runner.run(flow)).rejects.toBe(browserBoundary);
  const projectId = identities.get("projectId");
  if (!projectId) throw new Error("The runner did not record the project ID");
  const project = await getProjectDocument(scope, projectId);
  const region = project?.cells.find(
    ({ id }) => id === identities.get("inputCellId"),
  )?.contents;
  if (region?.kind !== "input")
    throw new Error("Region dropdown was not saved");
  expect(inputDisplayLabel(region)).toBe("Region");
  expect(region).toMatchObject({
    inputType: "DROPDOWN",
    name: "region",
    defaultValueString: "North",
    options: ["North", "South"],
  });
});

it("pins an accepted preview and rejects a later notebook head", async () => {
  const source = await createProject({ ...scope, title: "Revenue" });
  const original = await openPreview(source.id);
  const { updateProject } = await import("../server/model/projects-store.js");
  await updateProject({ ...scope, projectId: source.id, title: "Revenue v2" });
  expect((await detail(source.id, original.previewId)).project.title).toBe(
    "Revenue",
  );
  await expect(publish(original)).rejects.toMatchObject({
    errorCode: "publish_head_changed",
  });
  expect(
    (await getProjectDocument(scope, source.id))?.publishedVersionId,
  ).toBeNull();
});

it("lets only one competing preview advance the checked release pointer and replays its receipt", async () => {
  const source = await createProject({ ...scope, title: "Revenue" });
  const previewA = await openPreview(source.id);
  const previewB = await openPreview(source.id);
  const attempts = [previewA, previewB].map((preview) => ({
    preview,
    requestId: randomUUID(),
  }));
  const settled = await Promise.allSettled(
    attempts.map(({ preview, requestId }) => publish(preview, { requestId })),
  );
  const winnerIndex = settled.findIndex(({ status }) => status === "fulfilled");
  expect(winnerIndex).toBeGreaterThanOrEqual(0);
  const winner = settled.at(winnerIndex);
  const intent = attempts.at(winnerIndex);
  if (!winner || winner.status !== "fulfilled" || !intent)
    throw new Error("Neither checked release committed");
  const result = winner.value;
  expect(settled.filter(({ status }) => status === "rejected")).toMatchObject([
    { reason: { errorCode: "publish_release_changed" } },
  ]);
  const { preview, requestId } = intent;
  expect(await publish(preview, { requestId })).toEqual(result);
  await expect(
    publish(preview, { requestId, description: "changed intent" }),
  ).rejects.toMatchObject({
    errorCode: "request_id_reused",
  });
  expect((await getProjectDocument(scope, source.id))?.publishedVersionId).toBe(
    result.releaseId,
  );
});

it("cancels by create intent on either side of the create acknowledgement and fences late completion", async () => {
  const source = await createProject({ ...scope, cells: [sampleSql] });
  const preempted = await previewInput(source.id);
  const before = {
    projectId: source.id,
    createRequestId: preempted.requestId,
    requestId: randomUUID(),
  };
  const tombstone = await asActor(() => cancelPreview.run(before, context));
  expect(tombstone).toMatchObject({ state: "cancelled", cursor: "0" });
  expect(await asActor(() => cancelPreview.run(before, context))).toEqual(
    tombstone,
  );
  await expect(
    asActor(() => createPreview.run(preempted, context)),
  ).rejects.toMatchObject({
    errorCode: "preview_cancelled",
  });
  const input = await previewInput(source.id);
  const pendingAck = await asActor(() => createPreview.run(input, context));
  const running = await detail(source.id, pendingAck.previewId);
  const claim = await claimPreview(running);
  expect(
    await notebookRunStore.renew(claim, Date.now(), {
      fingerprint: "dispatched-preview-fixture",
    }),
  ).toMatchObject({ status: "continue" });
  const cancellation = await asActor(() =>
    cancelPreview.run(
      {
        projectId: source.id,
        createRequestId: input.requestId,
        requestId: randomUUID(),
      },
      context,
    ),
  );
  expect(cancellation).toMatchObject({
    state: "cancelled",
    previewId: pendingAck.previewId,
  });
  expect(await asActor(() => createPreview.run(input, context))).toEqual(
    pendingAck,
  );
  const late = completeEmpty(claim);
  expect(await notebookRunStore.finish(claim, late)).toBe(false);
  expect(
    await getDb()
      .select()
      .from(notebookResultManifests)
      .where(eq(notebookResultManifests.id, late.expected.resultId))
      .limit(1),
  ).toEqual([]);
  await expect(
    publish(await detail(source.id, pendingAck.previewId), { mode: "force" }),
  ).rejects.toMatchObject({
    errorCode: "preview_cancelled",
  });
  expect(
    (await getProjectDocument(scope, source.id))?.publishedVersionId,
  ).toBeNull();
});

it("publishes only its own verified attempt after SQL changes under a stable cell ID", async () => {
  const source = await createProject({ ...scope, cells: [sampleSql] });
  const cell = source.cells.at(0);
  if (!cell || cell.contents.kind !== "sql")
    throw new Error("Missing SQL cell");
  const old = await openPreview(source.id);
  const oldClaim = await claimPreview(old);
  const oldResult = completeEmpty(oldClaim);
  expect(await notebookRunStore.finish(oldClaim, oldResult)).toBe(true);

  const { updateCell } = await import("../server/model/cells-store.js");
  await updateCell({
    ...scope,
    projectId: source.id,
    versionId: source.workingVersionId,
    cellId: cell.id,
    contents: {
      ...cell.contents,
      source: "select product_id from products limit 2",
    },
    expectedUpdatedAt: cell.updatedAt,
  });
  await getDb()
    .insert(schema.cellOutputs)
    .values({
      projectId: source.id,
      cellId: cell.id,
      status: "complete",
      output: JSON.stringify({ type: "table", rows: [["old"]] }),
      ranAt: "2026-01-01T00:00:00Z",
      connectionProvenanceRecorded: true,
      sourceConnectionId: SAMPLE_DATA_SOURCE_ID,
    });

  const fresh = await openPreview(source.id);
  const claimed = await claimPreview(fresh);
  const own = completeEmpty(claimed);
  expect(await notebookRunStore.finish(claimed, own)).toBe(true);
  await expect(publish(fresh)).rejects.toMatchObject({
    errorCode: "preview_manifest_changed",
  });
  const ready = await detail(source.id, fresh.previewId);
  expect(ready.state).toBe("ready");
  expect(ready.outputs).toEqual([
    {
      cellId: cell.id,
      state: "ready",
      resultId: own.expected.resultId,
      diagnosticId: null,
    },
  ]);
  const release = await publish(ready);
  expect(await readReleaseManifest(getDb(), release.manifestId)).toEqual(
    ready.outputs,
  );
  expect(
    await getDb()
      .select()
      .from(schema.publishedCellOutputs)
      .where(eq(schema.publishedCellOutputs.versionId, release.releaseId))
      .limit(1),
  ).toEqual([]);
  const saved = await readProjectRelease(getDb(), {
    orgId,
    projectId: source.id,
    releaseId: release.releaseId,
  });
  if (!saved) throw new Error("Missing immutable release");
  expect(saved.project.cells[0]).toMatchObject({
    id: cell.id,
    contents: { source: "select product_id from products limit 2" },
  });
  expect(saved.snapshot.namespace).toMatchObject({
    kind: "preview",
    previewId: fresh.previewId,
  });
});

it("publishes an accepted preview backed by a real local sample result", async () => {
  const project = await createProject({
    ...scope,
    cells: [{ ...sampleSql, source: "select 15084 as result" }],
  });
  const nodeEnvironment = process.env.NODE_ENV;
  const deploymentEnvironment = process.env.AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT;
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "local");
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(round);
  try {
    registerNotebookExecution();
  } finally {
    cwd.mockRestore();
  }
  try {
    const preview = await openPreview(project.id);
    const { runId, previewId } = preview;
    if (!runId) throw new Error("Missing preview run");
    await asActor(() =>
      createNotebookWorker(notebookRunStore)(scopeWithCaller, runId),
    );
    const ready = await detail(project.id, previewId);
    expect(ready.state).toBe("ready");
    expect(ready.outputs).toHaveLength(1);
    const resultId = resultIdSchema.parse(ready.outputs[0]?.resultId);
    expect(
      await asActor(() =>
        getNotebookResultPage(scopeWithCaller, { resultId, previewId }),
      ),
    ).toMatchObject({ status: "ready", rows: [[15084]] });
    const release = await publish(ready);
    expect(release.head).toEqual(preview.head);
    expect(await readReleaseManifest(getDb(), release.manifestId)).toEqual(
      ready.outputs,
    );
  } finally {
    vi.stubEnv("NODE_ENV", nodeEnvironment);
    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", deploymentEnvironment);
    unregisterPrivateBlobProvider("analytics2-local-notebook-results");
  }
});

it("pins a completed browser Python output through the preview and release", async () => {
  const cellId = notebookCellIdSchema.parse(randomUUID());
  const chartId = randomUUID();
  const { id } = await createProject({
    ...scope,
    cells: [
      {
        id: cellId,
        kind: "code",
        language: "python",
        source: "print('Browser output')",
        outputResult: true,
        resultVariable: null,
        label: null,
        hidden: false,
        gridX: null,
        gridY: null,
        gridWidth: null,
        gridHeight: null,
      },
      {
        id: chartId,
        kind: "chart",
        dataframe: "frame",
        chartSpec: {
          sourceCellId: cellId,
          sourceExportId: "symbol:frame",
          mark: "bar",
          xField: "category",
          yField: "amount",
          seriesField: null,
          yAggregation: "sum",
          title: null,
        },
        label: null,
        hidden: false,
        gridX: null,
        gridY: null,
        gridWidth: null,
        gridHeight: null,
      },
    ],
  });
  const execution = await getNotebookExecution(scopeWithCaller, id);
  if (execution.status !== "found") throw new Error("Missing draft snapshot");
  const nodeEnvironment = process.env.NODE_ENV;
  const deploymentEnvironment = process.env.AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT;
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "local");
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(round);
  try {
    registerNotebookExecution();
  } finally {
    cwd.mockRestore();
  }
  try {
    const receipt = await asActor(() =>
      admitBrowserNotebookRun.run(
        {
          snapshot: execution.snapshot,
          requestId: randomUUID(),
          cellId,
        },
        { caller: "frontend" },
      ),
    );
    if (receipt.status !== "admitted")
      throw new Error("Missing browser attempt");
    const json = (value: object) => ({
      type: "result" as const,
      contentType: "application/json" as const,
      data: Buffer.from(JSON.stringify(value)).toString("base64"),
    });
    const arrow = Buffer.from(
      tableToIPC(
        tableFromArrays({
          category: ["A", "A", "A"],
          amount: Int32Array.from([2, 3, 5]),
        }),
        "stream",
      ),
    ).toString("base64");
    const { runId, attemptId } = receipt;
    expect(
      await asActor(() =>
        completeBrowserNotebookRun.run(
          {
            runId,
            attemptId,
            outcome: "complete",
            events: [
              { type: "stream", channel: "stdout", text: "Browser output\n" },
              json({ kind: "export", name: "frame" }),
              {
                type: "result",
                contentType: "application/vnd.apache.arrow.stream",
                data: arrow,
              },
              json({
                kind: "variables",
                variables: [
                  { name: "frame", kind: "dataframe", type: "DataFrame" },
                ],
                exports: ["frame"],
              }),
            ],
          },
          { caller: "frontend" },
        ),
      ),
    ).toEqual({ status: "saved" });
    const completed = await getNotebookExecution(scopeWithCaller, id);
    if (completed.status !== "found")
      throw new Error("Missing saved execution");
    const resultId = resultIdSchema.parse(completed.cells[cellId]?.resultId);
    const pythonOutputs = [
      { kind: "stream", channel: "stdout", text: "Browser output\n" },
    ];

    const preview = await openPreview(id);
    expect(preview.state).toBe("ready");
    expect(preview.outputs).toMatchObject([
      { cellId, state: "ready", resultId },
    ]);
    await expect(
      getNotebookResultPage(scopeWithCaller, {
        resultId,
        previewId: preview.previewId,
      }),
    ).resolves.toMatchObject({ status: "ready", pythonOutputs });

    const release = await publish(preview);
    const session = await asActor(() =>
      openPublishedAppSession(
        scopeWithCaller,
        openAppSessionInput.parse({
          projectId: id,
          version: release.releaseId,
          openId: randomUUID(),
        }),
      ),
    );
    expect(session).toMatchObject({
      state: "ready",
      refreshUnavailable: "hosted-kernel-required",
      projection: {
        outputs: { [cellId]: { resultId, resultStatus: "ready" } },
      },
    });
    await expect(
      getNotebookResultPage(scopeWithCaller, {
        resultId,
        sessionId: session.sessionId,
      }),
    ).resolves.toMatchObject({ status: "ready", pythonOutputs });
    const chart = await asActor(() =>
      getNotebookTransform.run({
        projectId: id,
        cellId: chartId,
        releaseId: release.releaseId,
        sessionId: session.sessionId,
      }),
    );
    expect(chart.result).toMatchObject({
      status: "ready",
      source: {
        rowCount: 3,
        result: { producer: { exportId: "symbol:frame" } },
      },
      rows: [expect.objectContaining({ x: "A", value: 10 })],
    });
  } finally {
    vi.stubEnv("NODE_ENV", nodeEnvironment);
    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", deploymentEnvironment);
    unregisterPrivateBlobProvider("analytics2-local-notebook-results");
  }
});

it("stores explicit missing and error markers without letting a forced run update the release", async () => {
  const project = await createProject({ ...scope, cells: [sampleSql] });
  const forced = await openPreview(project.id);
  const claim = await claimPreview(forced);
  const running = await detail(project.id, forced.previewId);
  expect(running.state).toBe("running");
  await expect(publish(running)).rejects.toMatchObject({
    errorCode: "preview_not_ready",
  });
  const forcedRelease = await publish(running, { mode: "force" });
  const markers = await readReleaseManifest(getDb(), forcedRelease.manifestId);
  expect(markers).toMatchObject([
    { state: "missing", resultId: null, diagnosticId: null },
  ]);
  const late = completeEmpty(claim);
  expect(await notebookRunStore.finish(claim, late)).toBe(false);
  expect(
    await getDb()
      .select()
      .from(notebookOutputs)
      .where(
        and(
          eq(notebookOutputs.namespaceId, claim.attempt.namespaceId),
          eq(notebookOutputs.cellId, claim.attempt.cellId),
        ),
      )
      .limit(1),
  ).toMatchObject([{ resultId: null }]);
  expect(await readReleaseManifest(getDb(), forcedRelease.manifestId)).toEqual(
    markers,
  );

  const repro = await openPreview(project.id);
  expect(repro.compared?.project.publishedVersionId).toBe(
    forcedRelease.releaseId,
  );
  const failure = await claimPreview(repro);
  expect(
    await notebookRunStore.finish(failure, {
      status: "failed",
      code: "fixture_error",
    }),
  ).toBe(true);
  const failed = await detail(project.id, repro.previewId);
  expect(failed.state).toBe("failed");
  await expect(publish(failed)).rejects.toMatchObject({
    errorCode: "publish_error_ack_required",
  });
  const release = await publish(failed, { mode: "accept-errors" });
  expect(await readReleaseManifest(getDb(), release.manifestId)).toMatchObject([
    {
      state: "failed",
      resultId: null,
      diagnosticId: failure.attempt.attemptId,
    },
  ]);
  expect(
    await getDb()
      .select({ id: notebookRuns.id })
      .from(notebookRuns)
      .where(eq(notebookRuns.namespaceId, claim.attempt.namespaceId))
      .limit(2),
  ).toHaveLength(1);
});

it("report A2-BQ-V3-NO-RESULTS: get-project-publish-preview wakes a stalled preview run when unleased or lease-expired and skips while actively leased", async () => {
  const project = await createProject({
    ...scope,
    cells: [{ ...sampleSql, source: "select 15085 as result" }],
  });
  const nodeEnvironment = process.env.NODE_ENV;
  const deploymentEnvironment = process.env.AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT;
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "local");
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(round);
  try {
    registerNotebookExecution();
  } finally {
    cwd.mockRestore();
  }
  try {
    const preview = await openPreview(project.id);
    const runId = preview.runId;
    if (!runId) throw new Error("Expected preview runId");

    vi.mocked(wakeNotebookRun).mockClear();
    const queued = await detail(project.id, preview.previewId);
    expect(queued.state).toBe("queued");
    expect(wakeNotebookRun).toHaveBeenCalledTimes(1);
    expect(wakeNotebookRun).toHaveBeenCalledWith(
      expect.objectContaining({ orgId, ownerEmail: owner }),
      runId,
    );

    const activeClaim = await claimPreview(preview);
    vi.mocked(wakeNotebookRun).mockClear();
    const running = await detail(project.id, preview.previewId);
    expect(running.state).toBe("running");
    expect(wakeNotebookRun).not.toHaveBeenCalled();

    await getDb()
      .update(notebookRunWork)
      .set({ leaseUntil: Date.now() - 1_000 })
      .where(eq(notebookRunWork.runId, activeClaim.run.id));
    vi.mocked(wakeNotebookRun).mockClear();
    const stalled = await detail(project.id, preview.previewId);
    expect(stalled.state).toBe("running");
    expect(wakeNotebookRun).toHaveBeenCalledTimes(1);
    expect(wakeNotebookRun).toHaveBeenCalledWith(
      expect.objectContaining({ orgId, ownerEmail: owner }),
      runId,
    );

    await sweepNotebookRuns({ deadlineAt: Date.now() + 60_000 });
    const afterSweep = await detail(project.id, preview.previewId);
    expect(afterSweep.state).toBe("ready");
  } finally {
    vi.stubEnv("NODE_ENV", nodeEnvironment);
    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", deploymentEnvironment);
    unregisterPrivateBlobProvider("analytics2-local-notebook-results");
  }
});
