import { randomUUID } from "node:crypto";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import {
  organizations,
  ORG_MIGRATIONS,
  orgMembers,
} from "@agent-native/core/org";
import {
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
  type PrivateBlobProvider,
} from "@agent-native/core/private-blob";
import {
  resetAppConfigForTests,
  runBetterAuthMigrations,
  runWithRequestContext,
} from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import getSession from "../../actions/get-published-app-session.js";
import listAccess from "../../actions/list-published-app-access.js";
import openSession from "../../actions/open-published-app-session.js";
import refresh from "../../actions/refresh-published-app-results.js";
import saveView from "../../actions/save-published-app-view.js";
import setAccess from "../../actions/set-published-app-access.js";
import setInputs from "../../actions/set-published-app-inputs.js";
import type { CellDraft } from "../../app/lib/model/contracts.js";
import { applyAppPatches, emptyAppLayout } from "../../shared/app-layout.js";
import {
  executionSnapshotSchema,
  runIdSchema,
} from "../../shared/notebook-execution.js";
import {
  notebookCellIdSchema,
  revisionSchema,
} from "../../shared/notebook-snapshot-contract.js";
import { projectDocumentWithLayoutSchema } from "../../shared/project-document.js";
import { SAMPLE_DATA_SOURCE_ID } from "../../shared/sample-data-contract.js";
import { getDb, schema } from "../db/index.js";
import { runAnalyticsMigrations } from "../db/migrations.js";
import { writeAppDocument } from "./app-layouts.js";
import { seedLegacyPublishedProject } from "./legacy-published-fixture.test-support.js";
import { notebookRuns } from "./notebook-execution/schema.js";
import { getNotebookResultPage } from "./notebook-results.js";
import {
  isLegacySynthesizedRelease,
  readProjectRelease,
} from "./project-releases.js";
import { createProject } from "./projects-store.js";
import { readPublishedExecutionSnapshot } from "./published-app-sessions.js";

const { waitUntilCalls, pendingWakes } = vi.hoisted(() => {
  const pendingWakes: Promise<unknown>[] = [];
  const waitUntilCalls = vi.fn((promise: Promise<unknown>) => {
    pendingWakes.push(promise);
  });
  return { waitUntilCalls, pendingWakes };
});

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  platformWaitUntil: () => waitUntilCalls,
}));
vi.mock("../execution/visualization-kernel.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../execution/visualization-kernel.js")
  >()),
  executeVisualizationSql: (
    await import("../testing/visualization-sql-fixture.js")
  ).runVisualizationInPGlite,
}));

const owner = {
  orgId: "legacy-release-org",
  ownerEmail: "owner@example.test",
  caller: "frontend",
};
const appViewer = { ...owner, ownerEmail: "viewer@example.test" };
const context = { caller: "frontend" } as const;
const as = <T>(actor: typeof owner, work: () => T) =>
  runWithRequestContext(
    {
      orgId: actor.orgId,
      userEmail: actor.ownerEmail,
      authUserId: actor.ownerEmail,
    },
    work,
  );

const blobs = new Map<string, Uint8Array>();
const provider: PrivateBlobProvider = {
  id: "legacy-release-results",
  name: "Legacy release results",
  isConfigured: () => true,
  async put({ key, data }) {
    if (!key) throw new Error("Expected a result segment key");
    blobs.set(key, Uint8Array.from(data));
    return { id: key, provider: this.id, opaque: true, encrypted: false };
  },
  async read(handle) {
    const data = blobs.get(handle.id);
    if (!data) throw new Error("The result fixture is absent");
    return { data, handle };
  },
  async delete(handle) {
    return { deleted: blobs.delete(handle.id), provider: this.id };
  },
};

async function flushWakes() {
  while (pendingWakes.length) {
    const batch = pendingWakes.splice(0, pendingWakes.length);
    await Promise.all(batch);
  }
}

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  resetAppConfigForTests();
  await runMigrations(
    ORG_MIGRATIONS.map(({ name, ...entry }) =>
      name ? { ...entry, name } : entry,
    ),
    { table: "legacy_release_org_migrations" },
  )(undefined);
  await runAnalyticsMigrations(undefined);
  await runBetterAuthMigrations(undefined);
  await getDb().insert(organizations).values({
    id: owner.orgId,
    name: owner.orgId,
    createdBy: owner.ownerEmail,
    createdAt: 0,
  });
  await getDb()
    .insert(orgMembers)
    .values([
      {
        id: "member-owner",
        orgId: owner.orgId,
        email: owner.ownerEmail,
        role: "owner",
        joinedAt: 0,
      },
      {
        id: "member-app-viewer",
        orgId: owner.orgId,
        email: appViewer.ownerEmail,
        role: "member",
        joinedAt: 0,
      },
    ]);
  registerPrivateBlobProvider(provider);
});

beforeEach(async () => {
  await flushWakes();
  waitUntilCalls.mockClear();
});

afterAll(async () => {
  await flushWakes();
  unregisterPrivateBlobProvider(provider.id);
  await closeDbExec();
  vi.unstubAllEnvs();
  resetAppConfigForTests();
});

const cellFields = {
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
};
const region: CellDraft = {
  ...cellFields,
  kind: "input",
  name: "region",
  inputType: "DROPDOWN",
  options: ["North", "South"],
  defaultValueString: "North",
  optional: true,
};
function sqlCell(source: string, resultVariable: string): CellDraft {
  return {
    ...cellFields,
    kind: "sql",
    source,
    resultVariable,
    dataConnectionId: SAMPLE_DATA_SOURCE_ID,
    databaseSchema: null,
    outputResult: true,
  };
}

async function seedLegacyFixture({
  withLegacyOutput = false,
}: { withLegacyOutput?: boolean } = {}) {
  const project = await createProject({
    ...owner,
    title: "Legacy regional app",
    cells: [
      region,
      sqlCell(
        "select case when {{ region }} = 'North' then 62 else 84 end as total from orders limit 1",
        "regional",
      ),
    ],
  });
  const [inputCell, sql] = project.cells;
  if (!inputCell || !sql) throw new Error("Expected fixture cells");
  const inputCellId = notebookCellIdSchema.parse(inputCell.id);
  const sqlCellId = notebookCellIdSchema.parse(sql.id);
  await writeAppDocument(
    getDb(),
    owner.orgId,
    project.id,
    project.workingVersionId,
    applyAppPatches(
      emptyAppLayout(revisionSchema.parse("0")),
      [
        { type: "initialize" },
        {
          type: "place",
          tabId: "tab-1",
          cellId: sqlCellId,
          elementId: "regional-output",
          destination: {
            rowId: "row-output",
            columnId: "col-output",
            left: 0,
            right: 120,
            afterRowId: null,
          },
        },
      ],
      project.cells,
    ),
  );
  if (withLegacyOutput) {
    await getDb()
      .insert(schema.cellOutputs)
      .values({
        cellId: sql.id,
        projectId: project.id,
        sourceConnectionId: SAMPLE_DATA_SOURCE_ID,
        connectionProvenanceRecorded: true,
        status: "complete",
        output: JSON.stringify({
          type: "table",
          columns: [{ name: "total", type: "number" }],
          rows: [[11]],
          rowCount: 1,
          truncated: false,
        }),
        ranAt: "2026-01-01T00:00:00.000Z",
      });
  }
  const published = await seedLegacyPublishedProject(owner, project.id, "v1");
  const releaseId = published.publishedVersionId;
  if (!releaseId) throw new Error("Expected legacy published version");
  return {
    projectId: project.id,
    workingVersionId: project.workingVersionId,
    releaseId,
    inputCellId,
    sqlCellId: sql.id,
  };
}

async function grantAppViewer(projectId: string) {
  const listed = await as(owner, () => listAccess.run({ projectId }, context));
  expect(listed.appHref).toBe(`/app/${projectId}/latest`);
  expect(listed.supportedRoles).toEqual(["app_viewer"]);
  await as(owner, () =>
    setAccess.run(
      {
        projectId,
        expectedRevision: listed.revision,
        opId: randomUUID(),
        change: {
          kind: "grant",
          memberId: "member-app-viewer",
          role: "app_viewer",
        },
      },
      context,
    ),
  );
}

it("resolves a legacy published version in readProjectRelease without a project_releases row", async () => {
  const { projectId, workingVersionId, releaseId, sqlCellId } =
    await seedLegacyFixture();
  const db = getDb();
  const storedRows = await db
    .select()
    .from(schema.projectReleases)
    .where(eq(schema.projectReleases.id, releaseId));
  expect(storedRows).toEqual([]);

  const resolved = await readProjectRelease(db, {
    orgId: owner.orgId,
    projectId,
    releaseId,
  });
  expect(resolved).not.toBeNull();
  if (!resolved) throw new Error("Expected synthesized legacy release");
  expect(isLegacySynthesizedRelease(resolved)).toBe(true);
  expect(resolved.id).toBe(releaseId);
  expect(resolved.projectId).toBe(projectId);
  expect(resolved.orgId).toBe(owner.orgId);
  expect(resolved.requestId).toBe(`legacy:${releaseId}`);
  expect(resolved.mode).toBe("force");
  expect(resolved.project.publishedVersionId).toBe(releaseId);
  expect(
    resolved.project.cells.every((cell) => cell.versionId === releaseId),
  ).toBe(true);
  expect(resolved.project.cells.some((cell) => cell.id === sqlCellId)).toBe(
    true,
  );
  expect(() =>
    projectDocumentWithLayoutSchema.parse(resolved.project),
  ).not.toThrow();
  expect(() => executionSnapshotSchema.parse(resolved.snapshot)).not.toThrow();

  await db
    .delete(schema.appLayouts)
    .where(eq(schema.appLayouts.workingVersionId, releaseId));
  const withoutLayout = await readProjectRelease(db, {
    orgId: owner.orgId,
    projectId,
    releaseId,
  });
  expect(withoutLayout?.project.appLayout).toBeDefined();

  expect(
    await readProjectRelease(db, {
      orgId: owner.orgId,
      projectId,
      releaseId: workingVersionId,
    }),
  ).toBeNull();
  expect(
    await readProjectRelease(db, {
      orgId: "other-org",
      projectId,
      releaseId,
    }),
  ).toBeNull();
});

it("opens legacy published sessions for owner and appOnly viewer with expected capabilities", async () => {
  const { projectId, releaseId, inputCellId, sqlCellId } =
    await seedLegacyFixture();
  await grantAppViewer(projectId);

  const ownerSession = await as(owner, () =>
    openSession.run(
      { projectId, version: "latest", openId: randomUUID() },
      context,
    ),
  );
  expect(ownerSession.releaseId).toBe(releaseId);
  expect(ownerSession.caps).toEqual({ refreshDefault: true, saveView: true });

  const viewerSession = await as(appViewer, () =>
    openSession.run(
      { projectId, version: "latest", openId: randomUUID() },
      context,
    ),
  );
  expect(viewerSession.releaseId).toBe(releaseId);
  expect(viewerSession.caps).toEqual({ refreshDefault: false, saveView: true });

  const saved = await as(appViewer, () =>
    saveView.run(
      {
        sessionId: viewerSession.sessionId,
        releaseId: viewerSession.releaseId,
        expectedInputRevision: viewerSession.inputRevision,
        requestId: randomUUID(),
        name: "Saved viewer view",
      },
      context,
    ),
  );
  expect(saved.releaseId).toBe(releaseId);

  const mutated = await as(appViewer, () =>
    setInputs.run(
      {
        sessionId: viewerSession.sessionId,
        releaseId: viewerSession.releaseId,
        expectedInputRevision: viewerSession.inputRevision,
        requestId: randomUUID(),
        updates: [
          {
            inputCellId,
            value: { kind: "string", value: "South" },
          },
        ],
      },
      context,
    ),
  );
  expect(mutated.state).toBe("queued");
  expect(mutated.runId).toBeTruthy();
  expect(waitUntilCalls).toHaveBeenCalledTimes(1);
  await flushWakes();

  const updated = await as(appViewer, () =>
    getSession.run({ sessionId: viewerSession.sessionId, releaseId }, context),
  );
  const updatedResultId = updated.projection.outputs[sqlCellId]?.resultId;
  expect(updatedResultId).toBeTruthy();
  if (!updatedResultId) throw new Error("Expected result after input change");
  expect(
    await as(appViewer, () =>
      getNotebookResultPage(appViewer, {
        resultId: updatedResultId,
        sessionId: viewerSession.sessionId,
        page: 1,
      }),
    ),
  ).toMatchObject({ status: "ready", rows: [[84]] });
});

it("refreshes legacy published sessions for both session and default scopes with accepted snapshots", async () => {
  const { projectId, releaseId, sqlCellId } = await seedLegacyFixture();
  await grantAppViewer(projectId);

  const ownerSession = await as(owner, () =>
    openSession.run(
      { projectId, version: "latest", openId: randomUUID() },
      context,
    ),
  );
  const viewerSession = await as(appViewer, () =>
    openSession.run(
      { projectId, version: "latest", openId: randomUUID() },
      context,
    ),
  );

  const sessionRefresh = await as(appViewer, () =>
    refresh.run(
      {
        sessionId: viewerSession.sessionId,
        releaseId,
        requestId: randomUUID(),
        scope: "session",
        cachePolicy: "bypass",
      },
      context,
    ),
  );
  expect(waitUntilCalls).toHaveBeenCalledTimes(1);
  const [sessionRunRow] = await getDb()
    .select()
    .from(notebookRuns)
    .where(eq(notebookRuns.id, runIdSchema.parse(sessionRefresh.runId)))
    .limit(1);
  expect(sessionRunRow).toBeDefined();
  if (!sessionRunRow) throw new Error("Expected admitted session run");
  expect(
    await readPublishedExecutionSnapshot(
      appViewer,
      sessionRunRow.receipt.request.snapshot,
    ),
  ).toMatchObject({ status: "accepted" });

  await flushWakes();
  const refreshedViewer = await as(appViewer, () =>
    getSession.run({ sessionId: viewerSession.sessionId, releaseId }, context),
  );
  const viewerResultId =
    refreshedViewer.projection.outputs[sqlCellId]?.resultId;
  expect(viewerResultId).toBeTruthy();
  if (!viewerResultId) throw new Error("Expected session refreshed resultId");
  expect(
    await as(appViewer, () =>
      getNotebookResultPage(appViewer, {
        resultId: viewerResultId,
        sessionId: viewerSession.sessionId,
        page: 1,
      }),
    ),
  ).toMatchObject({ status: "ready", rows: [[62]] });

  waitUntilCalls.mockClear();
  const defaultRefresh = await as(owner, () =>
    refresh.run(
      {
        sessionId: ownerSession.sessionId,
        releaseId,
        requestId: randomUUID(),
        scope: "default",
        cachePolicy: "bypass",
      },
      context,
    ),
  );
  expect(defaultRefresh.cacheGeneration).toBe(revisionSchema.parse("0"));
  expect(waitUntilCalls).toHaveBeenCalledTimes(1);
  const [defaultRunRow] = await getDb()
    .select()
    .from(notebookRuns)
    .where(eq(notebookRuns.id, runIdSchema.parse(defaultRefresh.runId)))
    .limit(1);
  expect(defaultRunRow).toBeDefined();
  if (!defaultRunRow) throw new Error("Expected admitted default run");
  expect(
    await readPublishedExecutionSnapshot(
      owner,
      defaultRunRow.receipt.request.snapshot,
    ),
  ).toMatchObject({ status: "accepted" });

  await flushWakes();
  const refreshedOwner = await as(owner, () =>
    getSession.run({ sessionId: ownerSession.sessionId, releaseId }, context),
  );
  const ownerResultId = refreshedOwner.projection.outputs[sqlCellId]?.resultId;
  expect(ownerResultId).toBeTruthy();
  if (!ownerResultId) throw new Error("Expected default refreshed resultId");
  expect(
    await as(owner, () =>
      getNotebookResultPage(owner, {
        resultId: ownerResultId,
        sessionId: ownerSession.sessionId,
        page: 1,
      }),
    ),
  ).toMatchObject({ status: "ready", rows: [[62]] });
});

it("renders legacy published_cell_outputs before refresh and overrides them with live outputs after refresh", async () => {
  const { projectId, releaseId, sqlCellId } = await seedLegacyFixture({
    withLegacyOutput: true,
  });
  await grantAppViewer(projectId);

  const ownerBefore = await as(owner, () =>
    openSession.run(
      { projectId, version: "latest", openId: randomUUID() },
      context,
    ),
  );
  expect(ownerBefore.projection.outputs[sqlCellId]).toEqual({
    output: {
      type: "table",
      columns: [{ name: "total", type: "number" }],
      rows: [[11]],
      rowCount: 1,
      truncated: false,
    },
  });

  const viewerBefore = await as(appViewer, () =>
    openSession.run(
      { projectId, version: "latest", openId: randomUUID() },
      context,
    ),
  );
  expect(viewerBefore.projection.outputs[sqlCellId]).toEqual({
    output: {
      type: "table",
      columns: [{ name: "total", type: "number" }],
      rows: [[11]],
      rowCount: 1,
      truncated: false,
    },
  });

  await as(owner, () =>
    refresh.run(
      {
        sessionId: ownerBefore.sessionId,
        releaseId,
        requestId: randomUUID(),
        scope: "session",
        cachePolicy: "bypass",
      },
      context,
    ),
  );
  expect(waitUntilCalls).toHaveBeenCalledTimes(1);
  await flushWakes();

  const ownerAfter = await as(owner, () =>
    getSession.run({ sessionId: ownerBefore.sessionId, releaseId }, context),
  );
  const liveResultId = ownerAfter.projection.outputs[sqlCellId]?.resultId;
  expect(liveResultId).toBeTruthy();
  expect(ownerAfter.projection.outputs[sqlCellId]).toEqual({
    output: null,
    resultId: liveResultId,
    resultStatus: "ready",
  });
  if (!liveResultId) throw new Error("Expected live resultId after refresh");
  expect(
    await as(owner, () =>
      getNotebookResultPage(owner, {
        resultId: liveResultId,
        sessionId: ownerBefore.sessionId,
        page: 1,
      }),
    ),
  ).toMatchObject({ status: "ready", rows: [[62]] });
});
