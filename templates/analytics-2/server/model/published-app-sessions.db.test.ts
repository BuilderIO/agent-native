import { randomUUID } from "node:crypto";

import {
  closeDbExec,
  getDbExec,
  runMigrations,
  sql,
} from "@agent-native/core/db";
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
  type JobRunnerContext,
  resetAppConfigForTests,
  runBetterAuthMigrations,
  runWithRequestContext,
} from "@agent-native/core/server";
import { getOrgSetting } from "@agent-native/core/settings";
import {
  ensureWorkspaceConnectionsTable,
  upsertWorkspaceConnection,
} from "@agent-native/core/workspace-connections";
import { and, desc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import createPreview from "../../actions/create-project-publish-preview.js";
import findColleagues from "../../actions/find-published-app-colleagues.js";
import getTransform from "../../actions/get-notebook-transform.js";
import getVisualizationPage from "../../actions/get-notebook-visualization-page.js";
import getPreview from "../../actions/get-project-publish-preview.js";
import getProject from "../../actions/get-project.js";
import getSession from "../../actions/get-published-app-session.js";
import listAccess from "../../actions/list-published-app-access.js";
import openSession from "../../actions/open-published-app-session.js";
import publish from "../../actions/publish-project.js";
import refresh from "../../actions/refresh-published-app-results.js";
import reset from "../../actions/reset-published-app-session.js";
import saveCell from "../../actions/save-project-cell.js";
import saveView from "../../actions/save-published-app-view.js";
import setAccess from "../../actions/set-published-app-access.js";
import setInputs from "../../actions/set-published-app-inputs.js";
import setSchedule from "../../actions/set-published-app-schedule.js";
import updateDataResourceMetadata from "../../actions/update-data-resource-metadata.js";
import type { CellDraft } from "../../app/lib/model/contracts.js";
import { createWorkerControl } from "../../e2e/phase1/fixtures/worker-control.js";
import { applyAppPatches, emptyAppLayout } from "../../shared/app-layout.js";
import { runIdSchema } from "../../shared/notebook-execution.js";
import {
  notebookCellIdSchema,
  revisionSchema,
} from "../../shared/notebook-snapshot-contract.js";
import { phase1ScheduleFixtureKey } from "../../shared/phase1-schedule-fixture.js";
import {
  setScheduleInput,
  listScheduleRunsInput,
  stopScheduleRunInput,
} from "../../shared/published-app-schedules.js";
import { SAMPLE_DATA_SOURCE_ID } from "../../shared/sample-data-contract.js";
import { defaultTableConfig } from "../../shared/table-visualization-config.js";
import { getDb, schema } from "../db/index.js";
import {
  analyticsMigrations,
  runAnalyticsMigrations,
} from "../db/migrations.js";
import { localDuckDb } from "../execution/local-duckdb.test-support.js";
import type { KernelPort } from "../execution/notebook-kernel.js";
import { createNotebookWorker } from "../execution/notebook-worker.js";
import registerPublishedAppJobs from "../plugins/published-app-jobs.js";
import { writeAppDocument } from "./app-layouts.js";
import { addCell } from "./cells-store.js";
import {
  assertConnectionResultsAccess,
  assertDataframeConnectionAccess,
  canReadConnectionResults,
  readDataConnection,
} from "./data-connections.js";
import { writeDataResourceMetadata } from "./data-resource-metadata.js";
import { seedLegacyPublishedProject } from "./legacy-published-fixture.test-support.js";
import {
  notebookResultManifests,
  notebookRunAttempts,
  notebookRuns,
  notebookRunWork,
} from "./notebook-execution/schema.js";
import {
  notebookRunStore,
  wakeNotebookRun,
} from "./notebook-execution/service.js";
import {
  getNotebookResultPage,
  openPublishedResultDrill,
} from "./notebook-results.js";
import {
  createProject,
  getProjectDocument,
  updateProject,
} from "./projects-store.js";
import { runPublishedAppSchedules } from "./published-app-jobs.js";
import {
  listPublishedAppScheduleRuns,
  setPublishedAppSchedule,
  stopPublishedAppScheduleRun,
} from "./published-app-schedules.js";

const { sendScheduledMail } = vi.hoisted(() => ({
  sendScheduledMail: vi
    .fn<typeof import("@agent-native/core/server").sendEmail>()
    .mockResolvedValue({ status: "sent", provider: "resend" }),
}));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  sendEmail: sendScheduledMail,
}));

vi.mock("./notebook-execution/service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./notebook-execution/service.js")>()),
  wakeNotebookRun: vi.fn(),
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
  orgId: "viewer-proof",
  ownerEmail: "owner@example.test",
  caller: "frontend",
};
const viewer = { ...owner, ownerEmail: "viewer@example.test" };
const otherOrg = { ...viewer, orgId: "other-viewer-proof" };
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
let holdWrite: (() => Promise<void>) | undefined;
const provider: PrivateBlobProvider = {
  id: "viewer-proof-results",
  name: "Viewer proof results",
  isConfigured: () => true,
  async put({ key, data }) {
    if (!key) throw new Error("Expected a result segment key");
    const hold = holdWrite;
    holdWrite = undefined;
    if (hold) await hold();
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

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  resetAppConfigForTests();
  await runMigrations(
    ORG_MIGRATIONS.map(({ name, ...entry }) =>
      name ? { ...entry, name } : entry,
    ),
    { table: "viewer_proof_org_migrations" },
  )(undefined);
  await runMigrations(
    analyticsMigrations.filter(({ version }) => version <= 15),
    { table: "analytics2_migrations" },
  )(undefined);
  await getDbExec().execute(sql`INSERT INTO analytics2_projects
    (id, owner_email, org_id, working_version_id, created_at, updated_at)
    VALUES ('pre-sharing-project', ${sql.value(owner.ownerEmail)}, ${sql.value(owner.orgId)},
            'pre-sharing-draft', '2026-01-01', '2026-01-01')`);
  await runAnalyticsMigrations(undefined);
  await runBetterAuthMigrations(undefined);
  await ensureWorkspaceConnectionsTable();
  await getDb()
    .insert(organizations)
    .values(
      [owner.orgId, otherOrg.orgId].map((id) => ({
        id,
        name: id,
        createdBy: owner.ownerEmail,
        createdAt: 0,
      })),
    );
  await getDb()
    .insert(orgMembers)
    .values(
      [owner, viewer, otherOrg].map((actor) => ({
        id: actor === viewer ? "member-colleague" : randomUUID(),
        orgId: actor.orgId,
        email: actor.ownerEmail,
        role: "owner",
        joinedAt: 0,
      })),
    );
  registerPrivateBlobProvider(provider);
});

afterAll(async () => {
  unregisterPrivateBlobProvider(provider.id);
  await closeDbExec();
  vi.unstubAllEnvs();
  resetAppConfigForTests();
});

const worker = createNotebookWorker(notebookRunStore);
async function drain(actor: typeof owner, runId: string, work = worker) {
  await as(actor, async () => {
    while (await work(actor, runId)) continue;
  });
}

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
async function fixture(
  source = "select case when {{ region }} = 'North' then 62 else 84 end as total from orders limit 1",
  legacyShare = true,
) {
  const project = await createProject({
    ...owner,
    title: "Regional revenue",
    cells: [
      region,
      sqlCell(source, "regional"),
      sqlCell("select 999 as stable from orders limit 1", "independent"),
    ],
  });
  const [input, dependent, independent] = project.cells;
  if (!input || !dependent || !independent)
    throw new Error("The project fixture is absent");
  if (legacyShare)
    await getDb().insert(schema.projectShares).values({
      id: randomUUID(),
      resourceId: project.id,
      principalType: "user",
      principalId: viewer.ownerEmail,
      role: "viewer",
      createdBy: owner.ownerEmail,
      createdAt: project.createdAt,
    });
  return {
    projectId: project.id,
    workingVersionId: project.workingVersionId,
    input: notebookCellIdSchema.parse(input.id),
    dependent: dependent.id,
    independent: independent.id,
  };
}

async function publishRelease(projectId: string, previewWorker = worker) {
  const current = await getProjectDocument(owner, projectId);
  if (!current?.draftHead) throw new Error("The accepted head is absent");
  const condition = {
    projectId,
    expectedHead: current.draftHead,
    expectedReleaseId: current.publishedVersionId,
  };
  const created = await as(owner, () =>
    createPreview.run({ ...condition, requestId: randomUUID() }, context),
  );
  if (!created.runId) throw new Error("The preview run is absent");
  await drain(owner, created.runId, previewWorker);
  const preview = await as(owner, () =>
    getPreview.run({ projectId, previewId: created.previewId }, context),
  );
  expect(preview.state).toBe("ready");
  return as(owner, () =>
    publish.run(
      {
        ...condition,
        previewId: created.previewId,
        expectedManifestRevision: preview.manifestRevision,
        requestId: randomUUID(),
        mode: "ready",
      },
      context,
    ),
  );
}

type Session = Awaited<ReturnType<typeof openSession.run>>;
function ref(session: Session) {
  return { sessionId: session.sessionId, releaseId: session.releaseId };
}
function open(actor: typeof owner, projectId: string) {
  return as(actor, () =>
    openSession.run(
      { projectId, version: "latest", openId: randomUUID() },
      context,
    ),
  );
}
function read(actor: typeof owner, session: Session) {
  return as(actor, () => getSession.run(ref(session), context));
}
function inputOperation(session: Session) {
  return {
    ...ref(session),
    requestId: randomUUID(),
    expectedInputRevision: session.inputRevision,
  };
}
function runId(id: string | undefined) {
  if (!id) throw new Error("The runtime did not admit a run");
  return runIdSchema.parse(id);
}
function resultId(session: Session, cellId: string) {
  const id = session.projection.outputs[cellId]?.resultId;
  if (!id) throw new Error("The result was absent from the session");
  return id;
}
async function assertValue(
  actor: typeof owner,
  session: Session,
  cellId: string,
  expected: number,
) {
  const result = await as(actor, () =>
    getNotebookResultPage(actor, {
      resultId: resultId(session, cellId),
      sessionId: session.sessionId,
      page: 1,
    }),
  );
  expect(result).toMatchObject({ status: "ready", rows: [[expected]] });
}
async function admittedRun(id: string) {
  const [row] = await getDb()
    .select()
    .from(notebookRuns)
    .where(eq(notebookRuns.id, runId(id)))
    .limit(1);
  if (!row) throw new Error("The persisted run is absent");
  return row.receipt;
}

async function viewOnlyWarehouseFixture(
  materialized: boolean,
  userScoped = false,
) {
  const member = {
    ...owner,
    ownerEmail: `result-viewer-${randomUUID()}@example.test`,
  };
  const memberId = randomUUID();
  await getDb().insert(orgMembers).values({
    id: memberId,
    orgId: owner.orgId,
    email: member.ownerEmail,
    role: "member",
    joinedAt: 0,
  });
  const connection = await as(owner, () =>
    upsertWorkspaceConnection({
      provider: "bigquery",
      label: "Restricted warehouse",
      status: "connected",
      allowedApps: ["analytics-2"],
      allowedUsers: [owner.ownerEmail],
      config: {
        viewAccessGroupIds: ["workspace"],
        includeForAI: userScoped,
        ...(userScoped ? { workspaceConnectionScope: "user" } : {}),
      },
    }),
  );
  const project = await createProject({
    ...owner,
    title: "Result-only app",
    cells: [sqlCell("select 42", "result")],
  });
  const cell = project.cells[0];
  if (!cell) throw new Error("The fixture cell is absent");
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
          cellId: notebookCellIdSchema.parse(cell.id),
          elementId: "result",
          destination: {
            rowId: "row",
            columnId: "column",
            left: 0,
            right: 120,
            afterRowId: null,
          },
        },
      ],
      project.cells,
    ),
  );
  const table = {
    type: "table",
    columns: [{ name: "total", type: "number" }],
    rows: [[42]],
    rowCount: 1,
    truncated: false,
    ...(materialized
      ? {
          materialization: {
            version: 1,
            handle: {
              id: "private-view-only",
              provider: provider.id,
              opaque: true,
              encrypted: false,
            },
            snapshot: "a".repeat(64),
            digest: "b".repeat(64),
            dependencies: [
              {
                cellId: cell.id,
                generation: "1",
                connectionId: connection.id,
                snapshot: "c".repeat(64),
              },
            ],
          },
        }
      : {}),
  };
  await getDb()
    .insert(schema.cellOutputs)
    .values({
      projectId: project.id,
      cellId: cell.id,
      sourceConnectionId: materialized ? SAMPLE_DATA_SOURCE_ID : connection.id,
      connectionProvenanceRecorded: true,
      status: "complete",
      output: JSON.stringify(table),
      ranAt: "2026-01-01T00:00:00.000Z",
    });
  await seedLegacyPublishedProject(owner, project.id, "v1");
  await as(owner, () =>
    setAccess.run(
      {
        projectId: project.id,
        expectedRevision: revisionSchema.parse("0"),
        opId: randomUUID(),
        change: { kind: "grant", memberId, role: "app_viewer" },
      },
      context,
    ),
  );
  return { member, connection, projectId: project.id, cellId: cell.id };
}

it("shows materialized legacy results to a view-only member without granting query access", async () => {
  const { member, connection, projectId, cellId } =
    await viewOnlyWarehouseFixture(true);
  await expect(
    as(member, () => canReadConnectionResults(connection.id)),
  ).resolves.toBe(true);
  await expect(
    as(member, () => readDataConnection(connection.id)),
  ).rejects.toMatchObject({
    errorCode: "data_connection_not_found",
    statusCode: 404,
  });
  const session = await open(member, projectId);
  expect(session.projection.outputs[cellId]).toEqual({
    output: {
      type: "table",
      columns: [{ name: "total", type: "number" }],
      rows: [[42]],
      rowCount: 1,
      truncated: false,
    },
  });
  expect(JSON.stringify(session)).not.toContain("private-view-only");
  const denied = await as(member, () =>
    getSession.run(ref(session), { caller: "tool" }),
  );
  expect(denied.projection.outputs[cellId]).toMatchObject({
    resultStatus: "denied",
    output: { type: "error" },
  });
  expect(JSON.stringify(denied)).not.toContain("[[42]]");
});

it("applies AI inclusion to direct legacy result sources while preserving frontend view access", async () => {
  const { member, connection, projectId, cellId } =
    await viewOnlyWarehouseFixture(false);
  const session = await open(member, projectId);
  expect(session.projection.outputs[cellId]?.output).toMatchObject({
    type: "table",
    rows: [[42]],
  });
  const agentRead = () =>
    as(member, () => getSession.run(ref(session), { caller: "tool" }));
  const denied = await agentRead();
  expect(denied.projection.outputs[cellId]).toMatchObject({
    resultStatus: "denied",
    output: { type: "error" },
  });
  expect(JSON.stringify(denied)).not.toContain("[[42]]");
  await as(owner, () =>
    upsertWorkspaceConnection({
      id: connection.id,
      provider: "bigquery",
      label: connection.label,
      config: { viewAccessGroupIds: ["workspace"], includeForAI: true },
    }),
  );
  const allowed = await agentRead();
  expect(allowed.projection.outputs[cellId]?.output).toMatchObject({
    type: "table",
    rows: [[42]],
  });
  await expect(
    as(member, () => readDataConnection(connection.id)),
  ).rejects.toMatchObject({
    errorCode: "data_connection_not_found",
    statusCode: 404,
  });
  await as(owner, () =>
    writeDataResourceMetadata(
      owner,
      connection.id,
      { kind: "schema", id: "schema:fixture:restricted" },
      { aiUsage: "excluded" },
    ),
  );
  const excluded = await agentRead();
  expect(excluded.projection.outputs[cellId]).toMatchObject({
    resultStatus: "denied",
    output: { type: "error" },
  });
  expect(
    (await read(member, session)).projection.outputs[cellId]?.output,
  ).toMatchObject({ type: "table", rows: [[42]] });
  await as(owner, () =>
    upsertWorkspaceConnection({
      id: connection.id,
      provider: "bigquery",
      label: connection.label,
      config: { viewAccessGroupIds: "invalid", includeForAI: true },
    }),
  );
  await expect(read(member, session)).rejects.toMatchObject({
    errorCode: "data_connection_result_access_unreadable",
    statusCode: 503,
  });
});

it("enforces workspace source AI policies in a personal-scoped session", async () => {
  const { connection, projectId, cellId } =
    await viewOnlyWarehouseFixture(false);
  await as(owner, () =>
    upsertWorkspaceConnection({
      id: connection.id,
      provider: "bigquery",
      label: connection.label,
      config: { viewAccessGroupIds: ["workspace"], includeForAI: true },
    }),
  );
  const session = await open(owner, projectId);
  const personal = <T>(work: () => T) =>
    runWithRequestContext(
      {
        orgId: owner.orgId,
        userEmail: owner.ownerEmail,
        authUserId: owner.ownerEmail,
        orgScope: "personal",
      },
      work,
    );
  const readPersonal = (caller: "frontend" | "tool") =>
    personal(() => getSession.run(ref(session), { caller }));
  await expect(
    personal(() => canReadConnectionResults(connection.id)),
  ).resolves.toBe(true);
  expect(
    (await readPersonal("tool")).projection.outputs[cellId]?.output,
  ).toMatchObject({ type: "table", rows: [[42]] });
  await as(owner, () =>
    writeDataResourceMetadata(
      owner,
      connection.id,
      { kind: "schema", id: "schema:fixture:restricted" },
      { aiUsage: "excluded" },
    ),
  );
  const deniedResource = await readPersonal("tool");
  expect(deniedResource.projection.outputs[cellId]).toMatchObject({
    resultStatus: "denied",
    output: { type: "error" },
  });
  expect(JSON.stringify(deniedResource)).not.toContain("[[42]]");
  expect(
    (await readPersonal("frontend")).projection.outputs[cellId]?.output,
  ).toMatchObject({ type: "table", rows: [[42]] });
  await as(owner, () =>
    writeDataResourceMetadata(
      owner,
      connection.id,
      { kind: "schema", id: "schema:fixture:restricted" },
      { aiUsage: null },
    ),
  );
  await as(owner, () =>
    writeDataResourceMetadata(
      owner,
      connection.id,
      { kind: "connection", id: connection.id },
      { aiUsage: "excluded" },
    ),
  );
  expect((await readPersonal("tool")).projection.outputs[cellId]).toMatchObject(
    { resultStatus: "denied", output: { type: "error" } },
  );
  await as(owner, () =>
    upsertWorkspaceConnection({
      id: connection.id,
      provider: "bigquery",
      label: connection.label,
      config: { viewAccessGroupIds: ["workspace"], includeForAI: false },
    }),
  );
  await as(owner, () =>
    writeDataResourceMetadata(
      owner,
      connection.id,
      { kind: "connection", id: connection.id },
      { aiUsage: "included" },
    ),
  );
  expect(
    (await readPersonal("tool")).projection.outputs[cellId]?.output,
  ).toMatchObject({ type: "table", rows: [[42]] });
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId: otherOrg.orgId,
    email: owner.ownerEmail,
    role: "member",
    joinedAt: 0,
  });
  await expect(
    runWithRequestContext(
      {
        orgId: otherOrg.orgId,
        userEmail: owner.ownerEmail,
        authUserId: owner.ownerEmail,
        orgScope: "personal",
      },
      () => assertConnectionResultsAccess(connection.id, "tool"),
    ),
  ).rejects.toMatchObject({
    errorCode: "data_connection_result_access_denied",
    statusCode: 403,
  });
});

it("keeps genuinely personal connection policy in the personal namespace", async () => {
  const personal = <T>(work: () => T) =>
    runWithRequestContext(
      {
        userEmail: owner.ownerEmail,
        authUserId: owner.ownerEmail,
        orgScope: "personal",
      },
      work,
    );
  const connection = await personal(() =>
    upsertWorkspaceConnection({
      provider: "bigquery",
      label: "Personal connection",
      status: "connected",
      config: { includeForAI: true },
      allowedApps: ["analytics-2"],
    }),
  );
  expect(connection.orgId).toBeNull();
  await expect(
    personal(() => assertConnectionResultsAccess(connection.id, "tool")),
  ).resolves.toBeUndefined();
  await personal(() =>
    upsertWorkspaceConnection({
      id: connection.id,
      provider: "bigquery",
      label: connection.label,
      status: "connected",
      config: { includeForAI: false },
      allowedApps: ["analytics-2"],
    }),
  );
  await expect(
    personal(() => assertConnectionResultsAccess(connection.id, "tool")),
  ).rejects.toMatchObject({
    errorCode: "data_connection_ai_disabled",
    statusCode: 403,
  });
});

it("enforces workspace policy for user-scoped connection results in personal sessions", async () => {
  const { connection, projectId, cellId } = await viewOnlyWarehouseFixture(
    false,
    true,
  );
  await getOrgSetting(owner.orgId, "fixture-settings-initialization");
  expect(connection.orgId).toBe(owner.orgId);
  const session = await open(owner, projectId);
  const personal = <T>(work: () => T) =>
    runWithRequestContext(
      {
        orgId: owner.orgId,
        userEmail: owner.ownerEmail,
        authUserId: owner.ownerEmail,
        orgScope: "personal",
      },
      work,
    );
  const readPersonal = (caller: "frontend" | "tool") =>
    personal(() => getSession.run(ref(session), { caller }));
  expect(
    (await readPersonal("tool")).projection.outputs[cellId]?.output,
  ).toMatchObject({ type: "table", rows: [[42]] });
  await as(owner, () =>
    updateDataResourceMetadata.run(
      {
        connectionId: connection.id,
        resource: { kind: "connection", id: connection.id },
        patch: { aiUsage: "excluded" },
      },
      context,
    ),
  );
  const denied = await readPersonal("tool");
  expect(denied.projection.outputs[cellId]).toMatchObject({
    resultStatus: "denied",
    output: { type: "error" },
  });
  expect(JSON.stringify(denied)).not.toContain("[[42]]");
  expect(
    (await readPersonal("frontend")).projection.outputs[cellId]?.output,
  ).toMatchObject({ type: "table", rows: [[42]] });
  await as(owner, () =>
    updateDataResourceMetadata.run(
      {
        connectionId: connection.id,
        resource: { kind: "connection", id: connection.id },
        patch: { aiUsage: "included" },
      },
      context,
    ),
  );
  await as(owner, () =>
    upsertWorkspaceConnection({
      id: connection.id,
      provider: "bigquery",
      label: connection.label,
      status: "connected",
      config: {
        workspaceConnectionScope: "user",
        includeForAI: false,
        viewAccessGroupIds: ["workspace"],
      },
    }),
  );
  await expect(
    personal(() => assertDataframeConnectionAccess(connection.id, "tool")),
  ).resolves.toBeUndefined();
  await as(owner, () =>
    updateDataResourceMetadata.run(
      {
        connectionId: connection.id,
        resource: { kind: "schema", id: "schema:fixture:restricted" },
        patch: { aiUsage: "excluded" },
      },
      context,
    ),
  );
  await expect(
    personal(() => assertDataframeConnectionAccess(connection.id, "tool")),
  ).rejects.toMatchObject({
    errorCode: "warehouse_query_resource_policy_unavailable",
    statusCode: 403,
  });
  const excluded = await readPersonal("tool");
  expect(excluded.projection.outputs[cellId]).toMatchObject({
    resultStatus: "denied",
    output: { type: "error" },
  });
  expect(JSON.stringify(excluded)).not.toContain("[[42]]");
  expect(
    (await readPersonal("frontend")).projection.outputs[cellId]?.output,
  ).toMatchObject({ type: "table", rows: [[42]] });
});

it("authorizes legacy app session results and preserves real cell errors", async () => {
  const { projectId, workingVersionId, input, dependent, independent } =
    await fixture(undefined, false);
  const draft = await getProjectDocument(owner, projectId);
  if (!draft) throw new Error("The fixture draft is absent");
  await writeAppDocument(
    getDb(),
    owner.orgId,
    projectId,
    workingVersionId,
    applyAppPatches(
      emptyAppLayout(revisionSchema.parse("0")),
      [
        { type: "initialize" },
        {
          type: "remove",
          tabId: "tab-1",
          elementId: `default-element:${JSON.stringify(["tab-1", input])}`,
        },
        ...[dependent, independent].map((cellId, index) => ({
          type: "place" as const,
          tabId: "tab-1",
          cellId: notebookCellIdSchema.parse(cellId),
          elementId: `result-${index}`,
          destination: {
            rowId: `row-${index}`,
            columnId: `column-${index}`,
            left: 0,
            right: 120,
            afterRowId: index === 0 ? null : "row-0",
          },
        })),
      ],
      draft.cells,
    ),
  );
  const table = {
    type: "table" as const,
    columns: [{ name: "total", type: "number" as const }],
    rows: [[42]],
    rowCount: 1,
    truncated: false,
    materialization: {
      version: 1 as const,
      handle: {
        id: "private-result",
        provider: provider.id,
        opaque: true as const,
        encrypted: false,
      },
      snapshot: "a".repeat(64),
      digest: "b".repeat(64),
      dependencies: [
        {
          cellId: dependent,
          generation: "1",
          connectionId: SAMPLE_DATA_SOURCE_ID,
          snapshot: "c".repeat(64),
        },
      ],
    },
  };
  await getDb()
    .insert(schema.cellOutputs)
    .values([
      {
        projectId,
        cellId: dependent,
        sourceConnectionId: SAMPLE_DATA_SOURCE_ID,
        connectionProvenanceRecorded: true,
        status: "complete",
        output: JSON.stringify(table),
        ranAt: "2026-01-01T00:00:00.000Z",
      },
      {
        projectId,
        cellId: independent,
        sourceConnectionId: SAMPLE_DATA_SOURCE_ID,
        connectionProvenanceRecorded: true,
        status: "error",
        output: JSON.stringify({
          type: "error",
          message: "Query failed",
          detail: null,
        }),
        ranAt: "2026-01-01T00:00:00.000Z",
      },
      {
        projectId,
        cellId: input,
        sourceConnectionId: SAMPLE_DATA_SOURCE_ID,
        connectionProvenanceRecorded: true,
        status: "complete",
        output: JSON.stringify(table),
        ranAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  const published = await seedLegacyPublishedProject(owner, projectId, "v1");
  const releaseId = published.publishedVersionId;
  if (!releaseId) throw new Error("The legacy release is absent");
  await as(owner, () =>
    setAccess.run(
      {
        projectId,
        expectedRevision: revisionSchema.parse("0"),
        opId: randomUUID(),
        change: {
          kind: "grant",
          memberId: "member-colleague",
          role: "app_viewer",
        },
      },
      context,
    ),
  );
  const updateOutput = (
    values: Partial<typeof schema.publishedCellOutputs.$inferInsert>,
  ) =>
    getDb()
      .update(schema.publishedCellOutputs)
      .set(values)
      .where(
        and(
          eq(schema.publishedCellOutputs.versionId, releaseId),
          eq(schema.publishedCellOutputs.cellId, dependent),
        ),
      );
  await getDb()
    .update(schema.publishedCellOutputs)
    .set({ output: "not-json" })
    .where(
      and(
        eq(schema.publishedCellOutputs.versionId, releaseId),
        eq(schema.publishedCellOutputs.cellId, input),
      ),
    );
  const session = await open(viewer, projectId);
  expect(session.projection.outputs[dependent]).toEqual({
    output: {
      type: "table",
      columns: table.columns,
      rows: [[42]],
      rowCount: 1,
      truncated: false,
    },
  });
  expect(session.projection.outputs[independent]).toEqual({
    output: { type: "error", message: "Query failed", detail: null },
  });
  expect(session.projection.outputs[input]).toBeUndefined();
  expect(JSON.stringify(session)).not.toContain("private-result");

  for (const blank of ["", "  "]) {
    for (const position of ["source", "lineage"] as const) {
      await updateOutput({
        sourceConnectionId:
          position === "source" ? blank : SAMPLE_DATA_SOURCE_ID,
        output: JSON.stringify({
          ...table,
          materialization: {
            ...table.materialization,
            dependencies: [
              {
                ...table.materialization.dependencies[0],
                connectionId:
                  position === "lineage" ? blank : SAMPLE_DATA_SOURCE_ID,
              },
            ],
          },
        }),
      });
      const invalid = await read(viewer, session);
      expect.soft(invalid.projection.outputs[dependent]).toMatchObject({
        resultStatus: "unreadable",
        output: { type: "error" },
      });
      expect.soft(JSON.stringify(invalid)).not.toContain("[[42]]");
      expect.soft(JSON.stringify(invalid)).not.toContain("private-result");
    }
  }
  await updateOutput({
    sourceConnectionId: null,
    output: JSON.stringify({
      ...table,
      materialization: {
        ...table.materialization,
        dependencies: [
          { ...table.materialization.dependencies[0], connectionId: null },
        ],
      },
    }),
  });
  expect((await read(viewer, session)).projection.outputs[dependent]).toEqual({
    output: {
      type: "table",
      columns: table.columns,
      rows: [[42]],
      rowCount: 1,
      truncated: false,
    },
  });
  await updateOutput({
    sourceConnectionId: SAMPLE_DATA_SOURCE_ID,
    output: JSON.stringify({
      ...table,
      materialization: {
        ...table.materialization,
        dependencies: [
          {
            ...table.materialization.dependencies[0],
            connectionId: "missing-lineage",
          },
        ],
      },
    }),
  });
  const lineageDenied = await read(viewer, session);
  expect(lineageDenied.projection.outputs[dependent]).toMatchObject({
    resultStatus: "denied",
    output: { type: "error" },
  });
  expect(JSON.stringify(lineageDenied)).not.toContain("private-result");
  expect(JSON.stringify(lineageDenied)).not.toContain("[[42]]");

  await updateOutput({
    output: JSON.stringify(table),
    sourceConnectionId: "missing-source",
  });
  const sourceDenied = await read(viewer, session);
  expect(sourceDenied.projection.outputs[dependent]).toMatchObject({
    resultStatus: "denied",
    output: { type: "error" },
  });
  expect(JSON.stringify(sourceDenied)).not.toContain("private-result");
  expect(JSON.stringify(sourceDenied)).not.toContain("[[42]]");

  await updateOutput({
    sourceConnectionId: SAMPLE_DATA_SOURCE_ID,
    connectionProvenanceRecorded: false,
  });
  const unreadable = await read(viewer, session);
  expect(unreadable.projection.outputs[dependent]).toMatchObject({
    resultStatus: "unreadable",
    output: { type: "error" },
  });
  expect(JSON.stringify(unreadable)).not.toContain("private-result");
  expect(JSON.stringify(unreadable)).not.toContain("[[42]]");

  await updateOutput({
    connectionProvenanceRecorded: true,
    output: JSON.stringify({ ...table, rows: [], rowCount: 0 }),
  });
  const empty = await read(viewer, session);
  expect(empty.projection.outputs[dependent]).toEqual({
    output: {
      type: "table",
      columns: table.columns,
      rows: [],
      rowCount: 0,
      truncated: false,
    },
  });
  await updateOutput({ output: "not-json" });
  await expect(read(viewer, session)).rejects.toThrow(
    "Stored workspace data could not be read.",
  );
});

it("upgrades v15 projects with revision zero and preserves independent legacy access during a sharing revision race", async () => {
  const [upgraded] = await getDb()
    .select({
      id: schema.projects.id,
      revision: schema.projects.appSharingRevision,
    })
    .from(schema.projects)
    .where(eq(schema.projects.id, "pre-sharing-project"))
    .limit(1);
  expect(upgraded).toEqual({ id: "pre-sharing-project", revision: 0n });
  const { projectId } = await fixture();
  await publishRelease(projectId);
  const secondMember = "member-other-colleague";
  await getDb().insert(orgMembers).values({
    id: secondMember,
    orgId: owner.orgId,
    email: "other-colleague@example.test",
    role: "member",
    joinedAt: 0,
  });
  const apply = (input: Parameters<typeof setAccess.run>[0]) =>
    as(owner, () => setAccess.run(input, context));
  const added = await apply({
    projectId,
    opId: randomUUID(),
    expectedRevision: revisionSchema.parse("0"),
    change: { kind: "grant", memberId: "member-colleague", role: "app_viewer" },
  });
  const revoke = {
    projectId,
    opId: randomUUID(),
    expectedRevision: added.revision,
    change: { kind: "revoke", grantId: added.grant.id },
  } as const;
  const [removed, competing] = await Promise.allSettled([
    apply(revoke),
    apply({
      projectId,
      opId: randomUUID(),
      expectedRevision: added.revision,
      change: { kind: "grant", memberId: secondMember, role: "app_viewer" },
    }),
  ]);
  const outcomes = [removed, competing];
  expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(
    1,
  );
  expect(outcomes).toContainEqual(
    expect.objectContaining({
      status: "rejected",
      reason: expect.objectContaining({
        errorCode: "sharing_revision_conflict",
      }),
    }),
  );
  if (removed.status === "rejected")
    await apply({
      ...revoke,
      opId: randomUUID(),
      expectedRevision: revisionSchema.parse("2"),
    });
  await expect(open(viewer, projectId)).resolves.toMatchObject({
    state: "ready",
  });
  await expect(
    as(viewer, () => getProject.run({ projectId }, context)),
  ).resolves.toMatchObject({
    project: { id: projectId },
    canEdit: false,
  });
});

it("persists an app-only grant and receipt, isolates cached results, and fences a revoked viewer’s late promotion", async () => {
  const { projectId, workingVersionId, input, dependent, independent } =
    await fixture(
      "select case when {{ region }} = 'North' then 11042 else 12042 end as total from orders limit 1",
      false,
    );
  const zero = revisionSchema.parse("0");
  const draft = await getProjectDocument(owner, projectId);
  if (!draft) throw new Error("The sharing fixture draft is absent");
  await writeAppDocument(
    getDb(),
    owner.orgId,
    projectId,
    workingVersionId,
    applyAppPatches(
      emptyAppLayout(zero),
      [
        { type: "initialize" },
        {
          type: "place",
          tabId: "tab-1",
          cellId: notebookCellIdSchema.parse(dependent),
          elementId: "visible-result",
          destination: {
            rowId: "visible-result-row",
            columnId: "visible-result-column",
            left: 0,
            right: 120,
            afterRowId: null,
          },
        },
        { type: "tab-add", tabId: "source-tab", name: "Quarterly overview!" },
        {
          type: "place",
          tabId: "source-tab",
          cellId: notebookCellIdSchema.parse(independent),
          elementId: "private-source",
          destination: {
            rowId: "source-row",
            columnId: "source-column",
            left: 0,
            right: 120,
            afterRowId: null,
          },
        },
        {
          type: "display",
          tabId: "source-tab",
          elementId: "private-source",
          display: "source",
          showLabel: true,
        },
        {
          type: "tab-add",
          tabId: "report-tab",
          name: "Quarterly overview",
          afterTabId: "source-tab",
        },
      ],
      draft.cells,
    ),
  );
  const receipt = await publishRelease(projectId);
  const ownerView = await open(owner, projectId);
  const hiddenResult = resultId(ownerView, independent);
  const readAccess = () =>
    as(owner, () => listAccess.run({ projectId, limit: 25 }, context));
  const grantRequest = {
    projectId,
    expectedRevision: zero,
    opId: randomUUID(),
    change: { kind: "grant", memberId: "member-colleague", role: "app_viewer" },
  } as const;
  const apply = (request: Parameters<typeof setAccess.run>[0]) =>
    as(owner, () => setAccess.run(request, context));
  await expect(readAccess()).resolves.toMatchObject({
    revision: "0",
    grants: [],
    generalAccess: "private",
    supportedRoles: ["app_viewer"],
    appHref: `/app/${projectId}/latest`,
  });
  await expect(
    as(owner, () =>
      findColleagues.run({ projectId, query: "viewer@" }, context),
    ),
  ).resolves.toEqual({
    people: [{ id: "member-colleague", displayName: viewer.ownerEmail }],
    nextCursor: null,
  });
  await expect(open(viewer, projectId)).rejects.toMatchObject({
    errorCode: "project_not_found",
  });
  const granted = await apply(grantRequest);
  expect(granted).toMatchObject({
    revision: "1",
    effect: "added",
    grant: {
      person: { id: "member-colleague" },
      role: "app_viewer",
    },
  });
  await expect(apply(grantRequest)).resolves.toEqual(granted);
  await expect(
    apply({ ...grantRequest, expectedRevision: granted.revision }),
  ).rejects.toMatchObject({ errorCode: "intent_mismatch" });
  await expect(
    apply({ ...grantRequest, opId: randomUUID() }),
  ).rejects.toMatchObject({ errorCode: "sharing_revision_conflict" });
  const [persisted] = await getDb()
    .select()
    .from(schema.publishedAppGrants)
    .where(eq(schema.publishedAppGrants.id, granted.grant.id))
    .limit(1);
  expect(persisted).toMatchObject({
    orgId: owner.orgId,
    projectId,
    memberId: "member-colleague",
    role: "app_viewer",
    revokedAt: null,
  });
  await expect(readAccess()).resolves.toMatchObject({
    revision: "1",
    grants: [granted.grant],
  });
  const jobs = await getDb().$count(notebookRuns);
  const cached = await open(viewer, projectId);
  expect(await getDb().$count(notebookRuns)).toBe(jobs);
  expect(cached.releaseId).toBe(receipt.releaseId);
  expect(cached.projection.canViewSource).toBe(false);
  expect(cached.projection.project.cells.map(({ id }) => id)).toEqual([
    input,
    dependent,
  ]);
  expect(cached.projection.project).toMatchObject({
    workingVersionId: receipt.releaseId,
    collectionIds: [],
  });
  expect(cached.projection.project.publishedHead).toBeUndefined();
  expect(cached.appDocument?.tabs.map(({ name }) => name)).toEqual([
    "Tab 1",
    "Quarterly overview",
  ]);
  expect(ownerView.projection).toHaveProperty("tabSlugs", [
    ["tab-1", "tab-1"],
    ["source-tab", "quarterly-overview"],
    ["report-tab", "quarterly-overview-1"],
  ]);
  expect(cached.projection).toHaveProperty("tabSlugs", [
    ["tab-1", "tab-1"],
    ["report-tab", "quarterly-overview-1"],
  ]);
  expect(cached.projection.project.cells[1]?.contents).toMatchObject({
    source: "",
    dataConnectionId: null,
    databaseSchema: null,
  });
  await assertValue(viewer, cached, dependent, 11042);
  await expect(
    as(viewer, () =>
      getNotebookResultPage(viewer, {
        resultId: hiddenResult,
        sessionId: cached.sessionId,
        page: 1,
      }),
    ),
  ).resolves.toMatchObject({ status: "denied" });
  await expect(
    as(viewer, () => getProject.run({ projectId }, context)),
  ).rejects.toMatchObject({ errorCode: "project_not_found" });
  await expect(
    as(viewer, () => listAccess.run({ projectId, limit: 25 }, context)),
  ).rejects.toMatchObject({ errorCode: "project_not_found" });
  await expect(open(otherOrg, projectId)).rejects.toMatchObject({
    errorCode: "project_not_found",
  });

  const change = await as(viewer, () =>
    setInputs.run(
      {
        ...inputOperation(cached),
        updates: [
          { inputCellId: input, value: { kind: "string", value: "South" } },
        ],
      },
      context,
    ),
  );
  const writing = deferred();
  const allowWrite = deferred();
  holdWrite = () => {
    writing.resolve();
    return allowWrite.promise;
  };
  const pending = drain(viewer, runId(change.runId));
  try {
    await Promise.race([
      writing.promise,
      pending.then(() => {
        throw new Error("The protected run finished before revocation");
      }),
    ]);
    const revoked = await apply({
      projectId,
      expectedRevision: granted.revision,
      opId: randomUUID(),
      change: { kind: "revoke", grantId: granted.grant.id },
    });
    expect(revoked).toMatchObject({
      revision: "2",
      effect: "removed",
      grant: granted.grant,
    });
    await expect(readAccess()).resolves.toMatchObject({
      revision: "2",
      grants: [],
    });
    await expect(read(viewer, cached)).rejects.toMatchObject({
      errorCode: "project_version_not_found",
    });
    await expect(open(viewer, projectId)).rejects.toMatchObject({
      errorCode: "project_not_found",
    });
    await expect(
      as(viewer, () =>
        getNotebookResultPage(viewer, {
          resultId: resultId(cached, dependent),
          sessionId: cached.sessionId,
          page: 1,
        }),
      ),
    ).resolves.toMatchObject({ status: "denied" });
  } finally {
    allowWrite.resolve();
    await pending;
  }
  const admitted = (await admittedRun(runId(change.runId))).attempts.find(
    ({ attempt }) => attempt.cellId === dependent,
  );
  if (!admitted) throw new Error("The affected result attempt is absent");
  const [attempt] = await getDb()
    .select()
    .from(notebookRunAttempts)
    .where(eq(notebookRunAttempts.id, admitted.attempt.attemptId))
    .limit(1);
  expect(attempt?.terminal).toBe(true);
  expect(attempt?.receipt.state.status).toBe("failed");
  await assertValue(owner, await read(owner, ownerView), dependent, 11042);
}, 45_000);

it("opens a fresh cache with zero jobs and resumes v1 after v2 advances latest", async () => {
  const { projectId, dependent, independent } = await fixture();
  const first = await publishRelease(projectId);
  const before = await getDb().$count(notebookRuns);
  const v1 = await open(viewer, projectId);
  expect(await getDb().$count(notebookRuns)).toBe(before);
  expect(v1).toMatchObject({
    releaseId: first.releaseId,
    state: "ready",
    ageStatus: "fresh",
    runId: null,
  });
  expect(v1.projection.canViewSource).toBe(false);
  const manifests = notebookResultManifests;
  const timestamps = await getDb()
    .select({ createdAt: manifests.createdAt })
    .from(manifests)
    .where(
      inArray(manifests.id, [
        resultId(v1, dependent),
        resultId(v1, independent),
      ]),
    )
    .orderBy(desc(manifests.createdAt))
    .limit(1);
  const refreshedAt = timestamps.at(0)?.createdAt;
  if (refreshedAt == null)
    throw new Error("The release artifact is missing its age");
  expect(v1.refreshedAt).toBe(new Date(refreshedAt).toISOString());
  await assertValue(viewer, v1, dependent, 62);
  await assertValue(viewer, v1, independent, 999);
  await updateProject({ ...owner, projectId, title: "Regional revenue v2" });
  const draft = await getProjectDocument(owner, projectId);
  const cell = draft?.cells.find(({ id }) => id === dependent);
  if (cell?.contents.kind !== "sql")
    throw new Error("The dependent cell is absent");
  const contents = {
    ...cell.contents,
    source: cell.contents.source.replace("62", "620"),
  };
  await as(owner, () =>
    saveCell.run({ projectId, cellId: dependent, contents }, context),
  );
  const second = await publishRelease(projectId);
  const resumed = await as(viewer, () =>
    openSession.run(
      {
        projectId,
        version: v1.releaseId,
        sessionId: v1.sessionId,
        openId: randomUUID(),
      },
      context,
    ),
  );
  const latest = await open(viewer, projectId);
  expect(ref(resumed)).toEqual(ref(v1));
  expect(resumed.projection.project.title).toBe("Regional revenue");
  expect(resultId(resumed, dependent)).toBe(resultId(v1, dependent));
  expect(latest.releaseId).toBe(second.releaseId);
  expect(latest.projection.project.title).toBe("Regional revenue v2");
  await assertValue(viewer, resumed, dependent, 62);
  await assertValue(viewer, latest, dependent, 620);
  await expect(
    as(viewer, () =>
      getSession.run({ ...ref(v1), releaseId: latest.releaseId }, context),
    ),
  ).rejects.toMatchObject({ errorCode: "session_release_mismatch" });
}, 45_000);

it("keeps concurrent viewers and idempotent input edits private while rerunning only descendants", async () => {
  const { projectId, input, dependent, independent } = await fixture();
  await publishRelease(projectId);
  const [first, second] = await Promise.all([
    open(viewer, projectId),
    open(owner, projectId),
  ]);
  const operation = {
    ...inputOperation(first),
    updates: [
      {
        inputCellId: input,
        value: { kind: "string" as const, value: "South" },
      },
    ],
  };
  const changed = await as(viewer, () => setInputs.run(operation, context));
  const replay = await as(viewer, () => setInputs.run(operation, context));
  expect(changed).toEqual(replay);
  expect(changed).toMatchObject({
    changedInputIds: [input],
    affectedCellIds: [dependent],
    state: "queued",
  });
  expect(
    (await admittedRun(runId(changed.runId))).plan.admittedCellIds,
  ).toEqual([dependent]);
  expect(await read(viewer, first)).toMatchObject({
    projection: { runningCellIds: [dependent] },
  });
  expect(await read(owner, second)).toMatchObject({
    projection: { runningCellIds: [] },
  });
  await expect(
    as(viewer, () =>
      setInputs.run(
        {
          ...operation,
          updates: [{ inputCellId: input, value: { kind: "null" } }],
        },
        context,
      ),
    ),
  ).rejects.toMatchObject({ errorCode: "session_request_reused" });
  await drain(viewer, runId(changed.runId));
  const privateState = await read(viewer, first);
  expect(privateState).toMatchObject({ projection: { runningCellIds: [] } });
  await assertValue(viewer, privateState, dependent, 84);
  await assertValue(owner, await read(owner, second), dependent, 62);
  expect(resultId(privateState, independent)).toBe(
    resultId(first, independent),
  );
  expect((await read(owner, second)).overrides).toEqual({});
  await expect(
    as(owner, () => getSession.run(ref(first), context)),
  ).rejects.toMatchObject({ errorCode: "project_version_not_found" });
  const saved = await as(viewer, () =>
    saveView.run(
      { ...inputOperation(privateState), name: "South only" },
      context,
    ),
  );
  await expect(
    as(owner, () =>
      openSession.run(
        {
          projectId,
          version: "latest",
          openId: randomUUID(),
          savedViewId: saved.savedViewId,
        },
        context,
      ),
    ),
  ).rejects.toMatchObject({ errorCode: "project_version_not_found" });
  const restored = await as(viewer, () =>
    openSession.run(
      {
        projectId,
        version: first.releaseId,
        openId: randomUUID(),
        savedViewId: saved.savedViewId,
      },
      context,
    ),
  );
  expect(restored.overrides).toEqual(privateState.overrides);
  expect(restored.sessionId).not.toBe(first.sessionId);
  const explicit = await as(viewer, () =>
    setInputs.run(
      {
        ...inputOperation(privateState),
        updates: [{ inputCellId: input, value: { kind: "null" } }],
      },
      context,
    ),
  );
  expect(explicit.effectiveValues[input]).toEqual({ kind: "null" });
  expect((await read(viewer, first)).overrides[input]).toEqual({
    kind: "null",
  });
}, 45_000);

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((ready) => {
    resolve = ready;
  });
  return { promise, resolve };
}

it("resets verified defaults and fences a late completion without changing the cache age", async () => {
  const { projectId, input, dependent } = await fixture();
  await publishRelease(projectId);
  const baseline = await open(viewer, projectId);
  const changed = await as(viewer, () =>
    setInputs.run(
      {
        ...inputOperation(baseline),
        updates: [
          { inputCellId: input, value: { kind: "string", value: "South" } },
        ],
      },
      context,
    ),
  );
  await drain(viewer, runId(changed.runId));
  const alternate = await read(viewer, baseline);
  await assertValue(viewer, alternate, dependent, 84);
  const late = await as(viewer, () =>
    setInputs.run(
      {
        ...inputOperation(alternate),
        updates: [{ inputCellId: input, value: { kind: "null" } }],
      },
      context,
    ),
  );
  const writing = deferred();
  const allowWrite = deferred();
  holdWrite = () => {
    writing.resolve();
    return allowWrite.promise;
  };
  const pending = drain(viewer, runId(late.runId));
  try {
    await Promise.race([
      writing.promise,
      pending.then(() => {
        throw new Error("The run completed before the controlled result write");
      }),
    ]);
    const shown = await read(viewer, baseline);
    expect(shown.state).toBe("running");
    const resetInput = inputOperation(shown);
    const restored = await as(viewer, () => reset.run(resetInput, context));
    expect(restored.state).toBe("reset");
    await expect(
      as(viewer, () => reset.run(resetInput, context)),
    ).resolves.toEqual(restored);
  } finally {
    allowWrite.resolve();
    await pending;
  }
  const after = await read(viewer, baseline);
  expect(after.refreshedAt).toBe(baseline.refreshedAt);
  expect(after.overrides).toEqual({});
  expect(resultId(after, dependent)).toBe(resultId(baseline, dependent));
  await assertValue(viewer, after, dependent, 62);
  const [terminated] = await getDb()
    .select()
    .from(notebookRunAttempts)
    .where(eq(notebookRunAttempts.runId, runId(late.runId)))
    .limit(1);
  expect(terminated?.receipt.state.status).toBe("failed");
}, 45_000);

it("deduplicates a default refresh and keeps exact truncation and page or drill authorization", async () => {
  const { projectId, input, dependent } = await fixture(
    "select value as total from generate_series(1, case when {{ region }} = 'North' then 1 else 10001 end) as value",
  );
  await publishRelease(projectId);
  const [own, ownerSecond, participant] = await Promise.all([
    open(owner, projectId),
    open(owner, projectId),
    open(viewer, projectId),
  ]);
  const refreshRequest = (session: Session) =>
    as(owner, () =>
      refresh.run(
        {
          ...ref(session),
          requestId: randomUUID(),
          scope: "default",
          cachePolicy: "bypass",
        },
        context,
      ),
    );
  const [refreshOne, refreshTwo] = await Promise.all([
    refreshRequest(own),
    refreshRequest(ownerSecond),
  ]);
  expect(refreshOne.runId).toBe(refreshTwo.runId);
  expect((await admittedRun(refreshOne.runId)).request).toMatchObject({
    cache: "bypass",
    snapshot: { namespace: { kind: "release-default" } },
  });
  expect(await read(viewer, participant)).toMatchObject({
    projection: { runningCellIds: expect.arrayContaining([dependent]) },
  });
  await drain(owner, refreshOne.runId);
  const defaultSession = await read(viewer, participant);
  expect(defaultSession).toMatchObject({ projection: { runningCellIds: [] } });
  expect(defaultSession.defaultCacheGeneration).toBe("1");
  const baselineId = resultId(defaultSession, dependent);
  const baseline = await as(viewer, () =>
    getNotebookResultPage(viewer, {
      resultId: baselineId,
      sessionId: participant.sessionId,
      page: 1,
    }),
  );
  if (baseline.status !== "ready")
    throw new Error("The verified baseline was not readable");
  const field = baseline.manifest.fields[0];
  if (!field) throw new Error("The result field is absent");
  const drill = {
    resultId: baselineId,
    sessionId: participant.sessionId,
    filters: [{ fieldId: field.fieldId, value: 1 }],
    page: 1,
  };
  await expect(
    as(viewer, () => openPublishedResultDrill(viewer, drill)),
  ).resolves.toMatchObject({ status: "ready", rows: [[1]], totalRows: 1 });
  await expect(
    as(owner, () => openPublishedResultDrill(owner, drill)),
  ).resolves.toMatchObject({ status: "denied" });
  await expect(
    as(otherOrg, () =>
      getNotebookResultPage(otherOrg, {
        resultId: baselineId,
        sessionId: participant.sessionId,
      }),
    ),
  ).resolves.toMatchObject({ status: "absent" });

  const changed = await as(viewer, () =>
    setInputs.run(
      {
        ...inputOperation(defaultSession),
        updates: [
          { inputCellId: input, value: { kind: "string", value: "South" } },
        ],
      },
      context,
    ),
  );
  await drain(viewer, runId(changed.runId));
  await expect(
    getDb().$count(
      notebookRunWork,
      and(
        eq(notebookRunWork.runId, runId(changed.runId)),
        eq(notebookRunWork.done, true),
      ),
    ),
  ).resolves.toBe(1);
  const partial = await read(viewer, participant);
  const partialId = resultId(partial, dependent);
  expect(partial.projection.outputs[dependent]?.resultStatus).toBe("truncated");
  expect(partial.defaultCacheGeneration).toBe("1");
  await expect(
    as(viewer, () =>
      getNotebookResultPage(viewer, {
        resultId: partialId,
        sessionId: partial.sessionId,
        page: 201,
      }),
    ),
  ).resolves.toEqual({
    status: "incomplete",
    resultId: partialId,
    page: 201,
    knownRows: "10000",
    reason: "truncated",
  });
  await expect(
    as(viewer, () =>
      openPublishedResultDrill(viewer, { ...drill, resultId: partialId }),
    ),
  ).resolves.toMatchObject({ status: "unavailable", reason: "incomplete" });
  await as(viewer, () => reset.run(inputOperation(partial), context));
  await expect(
    as(viewer, () =>
      getNotebookResultPage(viewer, {
        resultId: partialId,
        sessionId: partial.sessionId,
      }),
    ),
  ).resolves.toMatchObject({ status: "denied" });
}, 45_000);

const weekdayDue = "2026-11-18T08:00:00Z";

function scheduler(at: string, assertCanContinue = vi.fn(async () => {})) {
  const deadlineAt = Date.now() + 60_000;
  const historyId = randomUUID();
  const context: JobRunnerContext = {
    name: "analytics2-published-app-schedules",
    path: "jobs/analytics2-published-app-schedules.md",
    meta: {
      schedule: "* * * * *",
      enabled: true,
      triggerType: "schedule",
      runner: "analytics2-published-app-schedules",
    },
    ownerEmail: owner.ownerEmail,
    orgId: owner.orgId,
    historyId,
    manual: false,
    scheduledFor: at,
    deadlineAt,
    hardDeadlineAt: deadlineAt,
    signal: new AbortController().signal,
    assertCanContinue,
    actionAutomation: {
      triggerId: historyId,
      triggerName: "analytics2-published-app-schedules",
    },
  };
  return runPublishedAppSchedules(context);
}

function createScheduleInput(
  projectId: string,
  recipients: { memberId: string; on: "both" }[] = [],
  updatePublishedResults = true,
) {
  return setScheduleInput.parse({
    projectId,
    opId: randomUUID(),
    change: {
      kind: "create",
      scheduleId: randomUUID(),
      config: {
        cadence: { kind: "custom", cron: "0 9 * * 1-5" },
        timezone: "Europe/Amsterdam",
        recipients,
        updatePublishedResults,
      },
    },
  });
}

async function saveSchedule(
  projectId: string,
  recipients: { memberId: string; on: "both" }[] = [],
  updatePublishedResults = true,
) {
  const input = createScheduleInput(
    projectId,
    recipients,
    updatePublishedResults,
  );
  const now = new Date("2026-11-18T07:59:00Z");
  const receipt = await setPublishedAppSchedule(owner, input, now);
  return { input, receipt, now };
}

async function runLog(projectId: string, scheduleId?: string) {
  return (
    await listPublishedAppScheduleRuns(
      owner,
      listScheduleRunsInput.parse({ projectId, scheduleId }),
    )
  ).runs;
}

async function runScheduleTick(
  projectId: string,
  at: string,
  scheduleId?: string,
  tickWorker = worker,
) {
  await scheduler(at);
  const [tick] = await runLog(projectId, scheduleId);
  if (!tick) throw new Error("The scheduler did not claim a tick");
  await drain(
    { ...owner, caller: "scheduler" },
    runId(tick.runId ?? undefined),
    tickWorker,
  );
  await scheduler(at);
  return (await runLog(projectId, scheduleId))[0];
}

it("creates and edits with exact replay, revision conflicts, scoped authority and tombstones", async () => {
  const { projectId } = await fixture();
  await publishRelease(projectId);
  const { input, receipt, now } = await saveSchedule(projectId);
  expect(receipt.schedule.nextFireAt).toBe(weekdayDue);
  expect(receipt.schedule.config).toMatchObject({
    timezone: "Europe/Amsterdam",
    updatePublishedResults: true,
    useCachedSqlResults: false,
  });
  expect(await setPublishedAppSchedule(owner, input, now)).toEqual(receipt);
  await expect(
    setPublishedAppSchedule(viewer, input, now),
  ).rejects.toMatchObject({ errorCode: "schedule_forbidden" });
  await expect(
    listPublishedAppScheduleRuns(
      otherOrg,
      listScheduleRunsInput.parse({ projectId }),
    ),
  ).rejects.toMatchObject({ errorCode: "project_not_found" });
  const mutation = (
    kind: "edit" | "pause" | "resume" | "delete",
    expectedRevision: string,
  ) =>
    setScheduleInput.parse({
      projectId,
      opId: randomUUID(),
      change: {
        kind,
        scheduleId: receipt.schedule.scheduleId,
        expectedRevision,
        ...(kind === "edit"
          ? {
              config: {
                ...receipt.schedule.config,
                cadence: { kind: "hourly", minute: 11 },
              },
            }
          : {}),
      },
    });
  const edit = mutation("edit", "1");
  const edited = await setPublishedAppSchedule(owner, edit, now);
  expect(edited).toMatchObject({
    effect: "updated",
    schedule: { revision: "2", normalizedCron: "11 * * * *" },
  });
  expect(await setPublishedAppSchedule(owner, edit, now)).toEqual(edited);
  const pause = mutation("pause", "2");
  await expect(
    setPublishedAppSchedule(owner, pause, now),
  ).resolves.toMatchObject({
    effect: "paused",
    schedule: { enabled: false, nextFireAt: null },
  });
  await expect(
    setPublishedAppSchedule(owner, mutation("resume", "2"), now),
  ).rejects.toMatchObject({ errorCode: "schedule_revision_conflict" });
  await expect(
    setPublishedAppSchedule(owner, { ...input, opId: pause.opId }, now),
  ).rejects.toMatchObject({ errorCode: "intent_mismatch" });
  await expect(
    setPublishedAppSchedule(owner, mutation("delete", "3"), now),
  ).resolves.toMatchObject({
    effect: "deleted",
    schedule: { deleted: true, enabled: false },
  });
}, 45_000);

it("updates the app-only Table from one due E1 tick and preserves the result after failure", async () => {
  const { projectId, workingVersionId, dependent } = await fixture(
    undefined,
    false,
  );
  const contents = {
    ...cellFields,
    kind: "display-table",
    dataframe: null,
    columns: [],
    tableConfig: {
      ...defaultTableConfig,
      source: { cellId: dependent, exportId: "result" },
    },
  } satisfies CellDraft;
  const addTable = () =>
    addCell({ ...owner, projectId, versionId: workingVersionId, contents });
  const table = await addTable();
  const hiddenTable = await addTable();
  const draft = await getProjectDocument(owner, projectId);
  if (!draft) throw new Error("The scheduled Table fixture is absent");
  const zero = revisionSchema.parse("0");
  await writeAppDocument(
    getDb(),
    owner.orgId,
    projectId,
    workingVersionId,
    applyAppPatches(
      { ...emptyAppLayout(zero), initialized: true },
      [
        {
          type: "place",
          tabId: "tab-1",
          cellId: notebookCellIdSchema.parse(table.id),
          elementId: "scheduled-table",
          destination: {
            rowId: "scheduled-row",
            columnId: "scheduled-column",
            left: 0,
            right: 120,
            afterRowId: null,
          },
        },
      ],
      draft.cells,
    ),
  );
  const release = await publishRelease(projectId);
  await as(owner, () =>
    setAccess.run(
      {
        projectId,
        expectedRevision: zero,
        opId: randomUUID(),
        change: {
          kind: "grant",
          memberId: "member-colleague",
          role: "app_viewer",
        },
      },
      context,
    ),
  );
  const before = await open(viewer, projectId);
  const { receipt } = await saveSchedule(projectId);
  const { scheduleId } = receipt.schedule;
  const tick = await runScheduleTick(projectId, weekdayDue, scheduleId);
  await scheduler(weekdayDue);
  expect(tick).toMatchObject({
    dueAt: weekdayDue,
    releaseId: release.releaseId,
    status: "succeeded",
    cache: "updated",
  });
  expect(await runLog(projectId, scheduleId)).toHaveLength(1);
  const run = await admittedRun(runId(tick?.runId ?? undefined));
  expect(run.request).toMatchObject({
    cache: "bypass",
    snapshot: {
      namespace: {
        kind: "schedule-tick",
        releaseId: release.releaseId,
        tickId: tick?.tickId,
      },
    },
  });
  const refreshed = await open(viewer, projectId);
  expect(resultId(refreshed, dependent)).not.toBe(resultId(before, dependent));
  await assertValue(viewer, refreshed, dependent, 62);
  const readTable = (cellId: string, sessionId?: string) =>
    as(viewer, () =>
      getVisualizationPage.run(
        {
          projectId,
          releaseId: release.releaseId,
          cellId,
          kind: "table",
          ...(sessionId ? { sessionId } : {}),
        },
        context,
      ),
    );
  await expect(readTable(table.id, refreshed.sessionId)).resolves.toMatchObject(
    {
      status: "ready",
      resultId: resultId(refreshed, dependent),
      rows: [[62]],
    },
  );
  await expect(
    readTable(hiddenTable.id, refreshed.sessionId),
  ).resolves.toMatchObject({
    status: "denied",
  });
  await expect(readTable(table.id)).resolves.toMatchObject({
    status: "denied",
  });
  holdWrite = async () => {
    throw new Error("injected schedule storage fault");
  };
  const failed = await runScheduleTick(
    projectId,
    "2026-11-19T08:00:00Z",
    scheduleId,
  );
  expect(failed).toMatchObject({
    releaseId: release.releaseId,
    status: "failed",
    cache: "preserved",
    diagnostic: { code: "execution_failed" },
  });
  expect(resultId(await open(viewer, projectId), dependent)).toBe(
    resultId(refreshed, dependent),
  );
  const next = (await runLog(projectId, scheduleId))[0];
  expect(next?.runId).not.toBe(tick?.runId);
}, 45_000);

it("publishes Single value across tabs while keeping the hidden source private", async () => {
  const { projectId, workingVersionId, dependent } = await fixture(
    "select cast(value as double precision) as total from generate_series(1, 60) as value",
    false,
  );
  const contents = {
    ...cellFields,
    kind: "metric",
    format: null,
    outputResult: false,
    resultVariable: null,
    valueRowIndex: null,
    valueVariableName: null,
    metricConfig: {
      version: 1,
      revision: 0,
      source: { cellId: dependent, exportId: "result" },
      fieldId: null,
      mode: "aggregate",
      aggregation: null,
      row: 0,
      title: "Total revenue",
      format: "number",
    },
  } satisfies CellDraft;
  const metric = await addCell({
    ...owner,
    projectId,
    versionId: workingVersionId,
    contents,
  });
  const draft = await getProjectDocument(owner, projectId);
  if (!draft) throw new Error("The metric fixture was not saved");
  const zero = revisionSchema.parse("0");
  await writeAppDocument(
    getDb(),
    owner.orgId,
    projectId,
    workingVersionId,
    applyAppPatches(
      { ...emptyAppLayout(zero), initialized: true },
      [
        { type: "tab-add", tabId: "second", name: "Details" },
        ...["tab-1", "second"].map(
          (tabId) =>
            ({
              type: "place",
              tabId,
              cellId: notebookCellIdSchema.parse(metric.id),
              elementId: `metric-${tabId}`,
              destination: {
                rowId: `row-${tabId}`,
                columnId: `column-${tabId}`,
                left: 0,
                right: 120,
                afterRowId: null,
              },
            }) as const,
        ),
      ],
      draft.cells,
    ),
  );
  await publishRelease(projectId);
  await as(owner, () =>
    setAccess.run(
      {
        projectId,
        expectedRevision: zero,
        opId: randomUUID(),
        change: {
          kind: "grant",
          memberId: "member-colleague",
          role: "app_viewer",
        },
      },
      context,
    ),
  );
  const session = await open(viewer, projectId);
  const reopened = await read(viewer, session);
  expect(reopened.projection.canViewSource).toBe(false);
  expect(reopened.projection.project.cells.map(({ id }) => id)).toEqual([
    metric.id,
  ]);
  expect(reopened.projection.outputs[dependent]).toBeUndefined();
  expect(
    reopened.appDocument?.tabs.map(({ rows }) =>
      rows.flatMap(({ columns }) =>
        columns.flatMap(({ elements }) => elements.map(({ cellId }) => cellId)),
      ),
    ),
  ).toEqual([[metric.id], [metric.id]]);
  const transform = await as(viewer, () =>
    getTransform.run(
      { projectId, cellId: metric.id, ...ref(reopened) },
      context,
    ),
  );
  expect(transform.result).toMatchObject({
    status: "ready",
    kind: "metric",
    value: 1830,
    aggregation: "sum",
    source: { rowCount: 60 },
  });
  const ownerSession = await open(owner, projectId);
  const sourceId = resultId(ownerSession, dependent);
  expect(reopened.projection.metricSourceResultIds?.[metric.id]).toBe(sourceId);
  await expect(
    as(viewer, () =>
      getNotebookResultPage(viewer, {
        resultId: sourceId,
        sessionId: reopened.sessionId,
        page: 1,
      }),
    ),
  ).resolves.toMatchObject({ status: "denied" });
});

it("pins v1 while v2 publishes, fences the older cache and skips a revoked recipient before send", async () => {
  const { projectId, dependent } = await fixture();
  const first = await publishRelease(projectId);
  const [recipient] = await getDb()
    .select({ id: orgMembers.id })
    .from(orgMembers)
    .where(
      and(
        eq(orgMembers.orgId, owner.orgId),
        eq(orgMembers.email, viewer.ownerEmail),
      ),
    )
    .limit(1);
  if (!recipient) throw new Error("The schedule recipient fixture is absent");
  vi.stubEnv("RESEND_API_KEY", "fixture");
  vi.stubEnv("EMAIL_FROM", "Analytics <notifications@example.test>");
  sendScheduledMail.mockClear();
  try {
    const { receipt } = await saveSchedule(projectId, [
      { memberId: recipient.id, on: "both" },
    ]);
    const { scheduleId } = receipt.schedule;
    const draft = await getProjectDocument(owner, projectId);
    const cell = draft?.cells.find(({ id }) => id === dependent);
    if (cell?.contents.kind !== "sql")
      throw new Error("The dependent cell is absent");
    const contents = {
      ...cell.contents,
      source: cell.contents.source.replace("62", "620"),
    };
    await as(owner, () =>
      saveCell.run({ projectId, cellId: dependent, contents }, context),
    );
    await Promise.all([scheduler(weekdayDue), scheduler(weekdayDue)]);
    const [pinned] = await runLog(projectId, scheduleId);
    expect(pinned).toMatchObject({
      releaseId: first.releaseId,
      status: "running",
    });
    const second = await publishRelease(projectId);
    const latest = await open(owner, projectId);
    await assertValue(owner, latest, dependent, 620);
    await getDb()
      .delete(schema.projectShares)
      .where(
        and(
          eq(schema.projectShares.resourceId, projectId),
          eq(schema.projectShares.principalId, viewer.ownerEmail),
        ),
      );
    await drain(
      { ...owner, caller: "scheduler" },
      runId(pinned?.runId ?? undefined),
    );
    await scheduler(weekdayDue);
    const log = await runLog(projectId, scheduleId);
    expect(log).toMatchObject([
      {
        tickId: pinned?.tickId,
        releaseId: first.releaseId,
        status: "succeeded",
        cache: "superseded",
        deliveries: [
          { memberId: recipient.id, outcome: "recipient_unavailable" },
        ],
      },
    ]);
    expect(sendScheduledMail).not.toHaveBeenCalled();
    const current = await open(owner, projectId);
    expect(current.releaseId).toBe(second.releaseId);
    expect(resultId(current, dependent)).toBe(resultId(latest, dependent));
  } finally {
    vi.stubEnv("RESEND_API_KEY", undefined);
    vi.stubEnv("EMAIL_FROM", undefined);
  }
}, 45_000);

it("drives the local fixture clock, held SQL and test mail through the registered scheduler", async () => {
  const priorEnvironment = process.env.AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT;
  const priorSha = process.env.AGENT_NATIVE_BUILD_SHA;
  const buildSha = "a".repeat(40);
  vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "local");
  vi.stubEnv("AGENT_NATIVE_BUILD_SHA", buildSha);
  resetAppConfigForTests();
  const { control, bridge } = createWorkerControl();
  Object.defineProperty(globalThis, phase1ScheduleFixtureKey, {
    value: bridge,
    configurable: true,
  });
  const works = new Map<string, Promise<void>>();
  try {
    const { projectId, dependent } = await fixture("select 15040 as result");
    await getDb()
      .update(schema.projects)
      .set({ title: "schedule15-v1 focused" })
      .where(eq(schema.projects.id, projectId));
    const release = await publishRelease(projectId);
    const [recipient] = await getDb()
      .insert(orgMembers)
      .values({
        id: randomUUID(),
        orgId: owner.orgId,
        email: "colleague@local.test",
        role: "member",
        joinedAt: 0,
      })
      .returning({ id: orgMembers.id });
    if (!recipient) throw new Error("The fixture recipient was not saved");
    const { revision } = await as(owner, () =>
      listAccess.run({ projectId }, context),
    );
    await as(owner, () =>
      setAccess.run(
        {
          projectId,
          expectedRevision: revision,
          opId: randomUUID(),
          change: { kind: "grant", memberId: recipient.id, role: "app_viewer" },
        },
        context,
      ),
    );
    registerPublishedAppJobs();
    await expect(
      control({
        operation: "schedule-clock",
        projectId,
        at: "2026-11-18T07:59:00Z",
      }),
    ).resolves.toMatchObject({ workerBuildSha: buildSha });
    const input = createScheduleInput(projectId, [
      { memberId: recipient.id, on: "both" },
    ]);
    const saved = await as(owner, () => setSchedule.run(input, context));
    expect(saved.schedule.nextFireAt).toBe(weekdayDue);
    const scope = { projectId, scheduleId: saved.schedule.scheduleId };
    const held = await control({
      operation: "schedule-hold-query",
      ...scope,
      dueAt: weekdayDue,
      result: 15042,
    });
    if (!("holdId" in held) || !held.holdId)
      throw new Error("The scheduled query was not held");
    const { holdId } = held;
    vi.mocked(wakeNotebookRun).mockImplementation((actor, id) => {
      if (!works.has(id)) works.set(id, drain(actor, id));
    });
    sendScheduledMail.mockClear();
    await control({ operation: "schedule-sweep", ...scope, dueAt: weekdayDue });
    await control({ operation: "schedule-sweep", ...scope, dueAt: weekdayDue });
    expect(await runLog(projectId, scope.scheduleId)).toMatchObject([
      { status: "running", releaseId: release.releaseId, deliveries: [] },
    ]);
    await control({ operation: "schedule-release-query", ...scope, holdId });
    expect(await runLog(projectId, scope.scheduleId)).toMatchObject([
      {
        status: "succeeded",
        cache: "updated",
        deliveries: [{ memberId: recipient.id, outcome: "sent" }],
      },
    ]);
    const nextDue = "2026-11-19T08:00:00Z";
    await control({
      operation: "schedule-fail-query",
      ...scope,
      dueAt: nextDue,
      code: "fixture_schedule_15_fault",
    });
    await control({ operation: "schedule-sweep", ...scope, dueAt: nextDue });
    const log = await runLog(projectId, scope.scheduleId);
    expect(log).toHaveLength(2);
    expect(log.find(({ dueAt }) => dueAt === nextDue)).toMatchObject({
      status: "failed",
      cache: "preserved",
      diagnostic: { code: "fixture_schedule_15_fault" },
      deliveries: [{ memberId: recipient.id, outcome: "sent" }],
    });
    expect(sendScheduledMail).not.toHaveBeenCalled();
    await assertValue(owner, await open(owner, projectId), dependent, 15042);
    await control({ operation: "schedule-reset", ...scope, holdId });
    await control({ operation: "schedule-reset-clock", projectId });
  } finally {
    Reflect.deleteProperty(globalThis, phase1ScheduleFixtureKey);
    vi.mocked(wakeNotebookRun).mockReset();
    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", priorEnvironment);
    vi.stubEnv("AGENT_NATIVE_BUILD_SHA", priorSha);
    resetAppConfigForTests();
  }
}, 45_000);

it("preserves cache when configured off and stops a queued run without publishing work", async () => {
  const { projectId, dependent } = await fixture();
  const first = await publishRelease(projectId);
  const baseline = await open(owner, projectId);
  const { receipt } = await saveSchedule(projectId, [], false);
  const { scheduleId } = receipt.schedule;
  expect(
    await runScheduleTick(projectId, weekdayDue, scheduleId),
  ).toMatchObject({
    releaseId: first.releaseId,
    status: "succeeded",
    cache: "preserved",
  });
  expect(resultId(await open(owner, projectId), dependent)).toBe(
    resultId(baseline, dependent),
  );
  const at = "2026-11-19T08:00:00Z";
  await scheduler(at);
  const [pending] = await runLog(projectId, scheduleId);
  const input = stopScheduleRunInput.parse({
    projectId,
    tickId: pending?.tickId,
    opId: randomUUID(),
  });
  const stopped = await stopPublishedAppScheduleRun(owner, input);
  expect(stopped).toMatchObject({ outcome: "cancelled" });
  expect(await stopPublishedAppScheduleRun(owner, input)).toEqual(stopped);
  await drain(
    { ...owner, caller: "scheduler" },
    runId(pending?.runId ?? undefined),
  );
  await scheduler(at);
  expect((await runLog(projectId, scheduleId))[0]).toMatchObject({
    status: "cancelled",
    cache: "preserved",
  });
}, 45_000);

it("sends one success notification and retries an ambiguous failure delivery with the same key", async () => {
  const { projectId } = await fixture();
  const release = await publishRelease(projectId);
  const [recipient] = await getDb()
    .select({ id: orgMembers.id })
    .from(orgMembers)
    .where(
      and(
        eq(orgMembers.orgId, owner.orgId),
        eq(orgMembers.email, viewer.ownerEmail),
      ),
    )
    .limit(1);
  if (!recipient) throw new Error("The schedule recipient fixture is absent");
  vi.stubEnv("RESEND_API_KEY", "fixture");
  vi.stubEnv("EMAIL_FROM", "Analytics <notifications@example.test>");
  sendScheduledMail.mockClear();
  try {
    const { receipt } = await saveSchedule(projectId, [
      { memberId: recipient.id, on: "both" },
    ]);
    const { scheduleId } = receipt.schedule;
    const mailForProject = () =>
      sendScheduledMail.mock.calls
        .map(([mail]) => mail)
        .filter((mail) =>
          mail.text?.includes(`/app/${projectId}/${release.releaseId}`),
        );
    await expect(
      runScheduleTick(projectId, weekdayDue, scheduleId),
    ).resolves.toMatchObject({
      status: "succeeded",
      deliveries: [{ memberId: recipient.id, outcome: "sent" }],
    });
    await scheduler(weekdayDue);
    expect(mailForProject()).toHaveLength(1);
    expect(mailForProject()[0]).toMatchObject({
      subject: "Scheduled run succeeded: Regional revenue",
      to: viewer.ownerEmail,
    });
    holdWrite = async () => {
      throw new Error("fixture failure");
    };
    sendScheduledMail.mockRejectedValueOnce(
      new Error("transport response lost"),
    );
    const failedAt = "2026-11-19T08:00:00Z";
    await expect(
      runScheduleTick(projectId, failedAt, scheduleId),
    ).resolves.toMatchObject({
      status: "failed",
      deliveries: [{ memberId: recipient.id, outcome: "pending" }],
    });
    await scheduler(failedAt);
    expect(mailForProject()).toHaveLength(2);
    await scheduler("2026-11-19T08:01:00Z");
    expect((await runLog(projectId, scheduleId))[0]).toMatchObject({
      status: "failed",
      cache: "preserved",
      deliveries: [{ memberId: recipient.id, outcome: "sent" }],
    });
    const [success, failed, retried] = mailForProject();
    expect(mailForProject()).toHaveLength(3);
    expect(retried).toMatchObject({
      idempotencyKey: failed?.idempotencyKey,
      subject: failed?.subject,
      to: failed?.to,
      html: failed?.html,
      text: failed?.text,
    });
    expect(failed).toMatchObject({
      subject: "Scheduled run failed: Regional revenue",
    });
    expect(failed?.idempotencyKey).not.toBe(success?.idempotencyKey);
  } finally {
    vi.stubEnv("RESEND_API_KEY", undefined);
    vi.stubEnv("EMAIL_FROM", undefined);
  }
}, 45_000);

it("rolls back the tick and next fire when the core scheduler lease expires during a claim", async () => {
  const { projectId } = await fixture();
  await publishRelease(projectId);
  const { receipt } = await saveSchedule(projectId);
  const { scheduleId } = receipt.schedule;
  const notOwner = vi
    .fn(async () => {})
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("scheduler lease expired"));
  await expect(scheduler(weekdayDue, notOwner)).rejects.toThrow(
    "scheduler lease expired",
  );
  expect(await runLog(projectId, scheduleId)).toEqual([]);
  await expect(
    runScheduleTick(projectId, weekdayDue, scheduleId),
  ).resolves.toMatchObject({
    dueAt: weekdayDue,
    status: "succeeded",
    cache: "updated",
  });
}, 45_000);

it("reuses scoped SQL artifacts across ticks only when cached SQL results is enabled", async () => {
  const { projectId, workingVersionId, dependent } = await fixture();
  const layout = emptyAppLayout(revisionSchema.parse("0"));
  await writeAppDocument(getDb(), owner.orgId, projectId, workingVersionId, {
    ...layout,
    settings: { ...layout.settings, autoRefresh: false },
  });
  await publishRelease(projectId);
  const input = createScheduleInput(projectId);
  if (input.change.kind !== "create")
    throw new Error("Expected a new schedule");
  const receipt = await setPublishedAppSchedule(
    owner,
    {
      ...input,
      change: {
        ...input.change,
        config: {
          ...input.change.config,
          cadence: { kind: "custom", cron: "* * * * *" },
          useCachedSqlResults: true,
        },
      },
    },
    new Date("2026-11-18T07:59:00Z"),
  );
  const { scheduleId } = receipt.schedule;
  async function computeArtifact(at: string) {
    const tick = await runScheduleTick(projectId, at, scheduleId);
    expect(tick).toMatchObject({ status: "succeeded", cache: "updated" });
    const id = resultId(await open(owner, projectId), dependent);
    const [artifact] = await getDb()
      .select({ artifactId: notebookResultManifests.artifactId })
      .from(notebookResultManifests)
      .where(eq(notebookResultManifests.id, id))
      .limit(1);
    if (!artifact?.artifactId) throw new Error("The SQL artifact is absent");
    return { id, artifactId: artifact.artifactId };
  }
  const first = await computeArtifact(weekdayDue);
  const second = await computeArtifact("2026-11-18T08:01:00Z");
  expect(second.id).not.toBe(first.id);
  expect(second.artifactId).toBe(first.artifactId);
  await setPublishedAppSchedule(
    owner,
    setScheduleInput.parse({
      projectId,
      opId: randomUUID(),
      change: {
        kind: "edit",
        scheduleId,
        expectedRevision: receipt.schedule.revision,
        config: { ...receipt.schedule.config, useCachedSqlResults: false },
      },
    }),
    new Date("2026-11-18T08:01:00Z"),
  );
  expect((await computeArtifact("2026-11-18T08:02:00Z")).artifactId).not.toBe(
    first.artifactId,
  );
}, 45_000);

it("allocates separate K0 namespaces and passes only public scheduled metadata for Python ticks", async () => {
  const { id: projectId } = await createProject({
    ...owner,
    title: "Scheduled Python",
    cells: [
      {
        ...cellFields,
        kind: "code",
        language: "python",
        source: "pass",
        outputResult: true,
        resultVariable: null,
      },
    ],
  });
  const execute = vi.fn<KernelPort["execute"]>(async () => {});
  const work = createNotebookWorker(notebookRunStore, {
    generation: localDuckDb().generation,
    execute,
  });
  const release = await publishRelease(projectId, work);
  expect(execute).toHaveBeenCalledTimes(1);
  const preview = execute.mock.calls[0]?.[1].namespaceId;
  execute.mockClear();
  const { receipt } = await saveSchedule(projectId);
  const { scheduleId } = receipt.schedule;
  await scheduler(weekdayDue);
  const namespacesBefore = await getDb()
    .select()
    .from(schema.kernelNamespaces)
    .where(
      and(
        eq(schema.kernelNamespaces.projectId, projectId),
        eq(schema.kernelNamespaces.scopeKind, "schedule-tick"),
      ),
    )
    .limit(2);
  expect(namespacesBefore).toEqual([]);
  const first = await runScheduleTick(projectId, weekdayDue, scheduleId, work);
  const second = await runScheduleTick(
    projectId,
    "2026-11-19T08:00:00Z",
    scheduleId,
    work,
  );
  expect(first).toMatchObject({
    status: "succeeded",
    releaseId: release.releaseId,
  });
  expect(second).toMatchObject({
    status: "succeeded",
    releaseId: release.releaseId,
  });
  const commands = execute.mock.calls.map(([, envelope]) => envelope);
  expect(commands).toHaveLength(2);
  expect(
    new Set([preview, ...commands.map(({ namespaceId }) => namespaceId)]).size,
  ).toBe(3);
  for (const [index, envelope] of commands.entries()) {
    if (envelope.command.operation !== "execute-python")
      throw new Error("The scheduler did not execute the Python cell");
    expect(envelope.command.source).toContain('"notebook_scheduled":true');
    expect(envelope.command.source).toContain(
      '"notebook_timezone":"Europe/Amsterdam"',
    );
    expect(envelope.command.source).toContain('"notebook_run_context":"app"');
    expect(envelope.command.source).toContain(
      `"notebook_scheduled_for":"2026-11-${18 + index}T08:00:00.000Z"`,
    );
    expect(envelope.command.source).not.toContain("notebook_user_email");
    expect(envelope.command.source).not.toContain(owner.ownerEmail);
  }
}, 45_000);
