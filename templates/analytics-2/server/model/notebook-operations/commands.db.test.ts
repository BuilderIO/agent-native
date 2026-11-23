import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  actionCallIntent,
  isActionContractError,
  runPreparedActionCall,
} from "@agent-native/core/action";
import {
  closeDbExec,
  getDbExec,
  runMigrations,
  sql,
} from "@agent-native/core/db";
import { and, eq } from "@agent-native/core/db/schema";
import {
  ORG_MIGRATIONS,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import {
  loadActionsFromStaticRegistry,
  runWithRequestContext,
} from "@agent-native/core/server";
import { generateActionRegistryForProject } from "@agent-native/core/vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  projectDocumentSchema,
  type CellDraft,
} from "../../../app/lib/model/contracts.js";
import {
  notebookChangesReadSchema,
  notebookSnapshotSchema,
  operationReceiptSchema,
  type NotebookSnapshot,
} from "../../../shared/notebook-operations.js";
import { notebookSnapshotActionReadSchema } from "../../../shared/notebook-snapshot-read.js";
import { queryNotebookTableReceiptSchema } from "../../../shared/notebook-table-query.js";
import { projectDocumentWithLayoutSchema } from "../../../shared/project-document.js";
import {
  publishPreviewDetailSchema,
  publishPreviewReceiptSchema,
  publishProjectReceiptSchema,
} from "../../../shared/project-publish.js";
import { SAMPLE_DATA_SOURCE_ID } from "../../../shared/sample-data-contract.js";
import { warehouseTableProvenanceSchema } from "../../../shared/warehouse-table.js";
import { getDb, schema } from "../../db/index.js";
import {
  analyticsMigrations,
  runAnalyticsMigrations,
} from "../../db/migrations.js";
import { withFixedClock } from "../clock.js";
import { createComponent } from "../components-store.js";
import { notebookRuns, notebookRunWork } from "../notebook-execution/schema.js";
import { createProject, duplicateProject } from "../projects-store.js";
import {
  CellOutputGenerationConflict,
  lockCellOutputGeneration,
  reserveCellOutputGeneration,
} from "../runs-store.js";
import { createStatus } from "../statuses-store.js";
import { adoptNotebook } from "./migration.js";

const owner = "notebook-owner@example.test";
const unrelated = "notebook-member@example.test";
const orgId = "notebook-command-workspace";
const otherOrgId = "other-notebook-workspace";
const scope = { ownerEmail: owner, orgId };
const appId = "analytics-2";
const previousDatabaseUrl = process.env.DATABASE_URL;
let registry: ReturnType<typeof loadActionsFromStaticRegistry>;
let round: string;

beforeAll(async () => {
  round = await mkdtemp(join(tmpdir(), "notebook-commands-"));
  generateActionRegistryForProject(
    fileURLToPath(new URL("../../..", import.meta.url)),
  );
  const { default: modules } =
    await import("../../../.generated/actions-registry.js");
  registry = loadActionsFromStaticRegistry(modules);
});

afterAll(async () => {
  await closeDbExec();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  await rm(round, { recursive: true, force: true });
});

async function initializeDatabase(mode: "fresh" | "upgrade") {
  await closeDbExec();
  process.env.DATABASE_URL = "pglite:" + join(round, mode);
  const orgMigrations = ORG_MIGRATIONS.map(({ name, ...migration }) => ({
    ...migration,
    ...(name === undefined ? {} : { name }),
  }));
  await runMigrations(orgMigrations, {
    table: "notebook_commands_org_migrations",
  })(null);
  const now = Date.now();
  const orgs = [orgId, otherOrgId].map((id) => ({
    id,
    name: id,
    createdBy: owner,
    createdAt: now,
  }));
  await getDb().insert(organizations).values(orgs);
  const members = [
    { email: owner, orgId, role: "owner" },
    { email: owner, orgId: otherOrgId, role: "member" },
    { email: unrelated, orgId, role: "member" },
  ].map((actor) => ({
    ...actor,
    id: randomUUID(),
    joinedAt: now,
  }));
  await getDb().insert(orgMembers).values(members);
}

async function invoke(
  name: string,
  input: unknown,
  email = owner,
  workspace = orgId,
  caller: "frontend" | "mcp" = "frontend",
): Promise<unknown> {
  const entry = registry[name];
  if (!entry) throw new Error("The compiled fixture is missing action " + name);
  return runWithRequestContext(
    {
      userEmail: email,
      orgId: workspace,
      authUserId: email,
      isSyntheticTraffic: true,
    },
    async () => {
      const prepared = await actionCallIntent(entry, input);
      if (!prepared.valid) throw prepared.error;
      return runPreparedActionCall(entry, prepared, {
        caller,
        userEmail: email,
        orgId: workspace,
        appId,
      });
    },
  );
}

const apply = async (input: unknown) =>
  operationReceiptSchema.parse(await invoke("apply-notebook-operation", input));

const setApp = async (input: unknown) =>
  operationReceiptSchema.parse(await invoke("set-app", input));

const undoNotebook = async (input: unknown) =>
  operationReceiptSchema.parse(await invoke("undo-notebook-operation", input));

async function readAppProject(projectId: string, version?: string) {
  const result = await invoke("get-project", {
    projectId,
    ...(version === undefined
      ? {}
      : { version, surface: "app", viewId: randomUUID() }),
  });
  return projectDocumentWithLayoutSchema.parse(
    (result as { project: unknown }).project,
  );
}

const readSnapshot = async (projectId: string) => {
  const snapshot = notebookSnapshotActionReadSchema.parse(
    await invoke("get-notebook-snapshot", { projectId }),
  );
  if (snapshot.status !== "accepted")
    throw new Error("The fixture notebook is not ready");
  const {
    slug: _slug,
    metadataRevision: _metadataRevision,
    ...projection
  } = snapshot;
  return projection;
};

async function publishFixture(projectId: string) {
  const { project, notebook } = await readProject(projectId);
  if (!notebook) throw new Error("Missing notebook head");
  const create = publishPreviewReceiptSchema.parse(
    await invoke("create-project-publish-preview", {
      projectId,
      expectedHead: notebook.snapshot.head,
      expectedReleaseId: project.publishedVersionId,
      requestId: randomUUID(),
    }),
  );
  for (let attempt = 0; attempt < 3; attempt++) {
    const preview = publishPreviewDetailSchema.parse(
      await invoke("get-project-publish-preview", {
        projectId,
        previewId: create.previewId,
      }),
    );
    try {
      return publishProjectReceiptSchema.parse(
        await invoke("publish-project", {
          projectId,
          previewId: create.previewId,
          expectedHead: preview.head,
          expectedReleaseId: preview.compareReleaseId,
          expectedManifestRevision: preview.manifestRevision,
          requestId: randomUUID(),
          mode:
            preview.state === "ready"
              ? "ready"
              : preview.state === "failed"
                ? "accept-errors"
                : "force",
        }),
      );
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          "errorCode" in error &&
          error.errorCode === "preview_manifest_changed"
        )
      )
        throw error;
    }
  }
  throw new Error("Preview manifest kept changing during publish");
}

const readJournal = (projectId: string, after = "0", limit = 100) =>
  invoke("list-notebook-changes", { projectId, after, limit });

const readReceipt = (projectId: string, opId: string) =>
  invoke("get-notebook-operation", { projectId, opId });

async function readProject(projectId: string, version?: string) {
  return z
    .object({
      project: projectDocumentSchema,
      notebook: notebookSnapshotSchema.nullable(),
    })
    .parse(
      await invoke("get-project", {
        projectId,
        ...(version === undefined ? {} : { version }),
      }),
    );
}

function codeCell(id: string, source: string): CellDraft {
  return {
    id,
    kind: "code",
    language: "python",
    source,
    resultVariable: null,
    outputResult: true,
    label: null,
    hidden: false,
    gridX: null,
    gridY: null,
    gridWidth: null,
    gridHeight: null,
  };
}

async function fixture() {
  const alpha = randomUUID();
  const beta = randomUUID();
  const project = await createProject({
    ...scope,
    cells: [codeCell(alpha, "alpha = 1"), codeCell(beta, "beta = 2")],
  });
  await adoptNotebook(scope, project.id);
  return {
    projectId: project.id,
    snapshot: await readSnapshot(project.id),
    alpha,
    beta,
  };
}

function command(snapshot: NotebookSnapshot, ...changes: unknown[]) {
  return {
    protocol: 1,
    projectId: snapshot.snapshot.projectId,
    workingVersionId: snapshot.snapshot.head.versionId,
    opId: randomUUID(),
    observedHead: snapshot.snapshot.head,
    changes,
  };
}

function getCell(snapshot: NotebookSnapshot, cellId: string) {
  const cell = snapshot.cells.find(({ id }) => id === cellId);
  if (!cell) throw new Error("The fixture snapshot is missing its cell");
  return cell;
}

function setCode(snapshot: NotebookSnapshot, cellId: string, source: string) {
  return {
    type: "set-code",
    cellId,
    expectedRevision: getCell(snapshot, cellId).revision,
    source,
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item === null || typeof item !== "object" || Array.isArray(item))
      return item;
    return Object.fromEntries(
      Object.entries(item).sort(([left], [right]) => left.localeCompare(right)),
    );
  });
}

describe("notebook commands on a fresh database", () => {
  beforeAll(async () => {
    await initializeDatabase("fresh");
    await runAnalyticsMigrations(null);
  });

  it("persists Section membership and collapse across reopen, duplication, and undo", async () => {
    const { projectId, snapshot, alpha, beta } = await fixture();
    const section = randomUUID();
    const originId = randomUUID();
    const group = {
      ...command(snapshot, {
        type: "group-section",
        cellId: section,
        cellIds: [alpha, beta],
        expectedOrderRevision: snapshot.resources.orderRevision,
      }),
      originId,
    };
    expect(await apply(group)).toMatchObject({ status: "applied" });
    expect(await apply(group)).toMatchObject({ status: "applied" });
    const grouped = await readSnapshot(projectId);
    expect(
      await apply(
        command(grouped, {
          type: "set-section",
          cellId: section,
          expectedRevision: getCell(grouped, section).revision,
          config: { collapsed: true, title: "Nested analysis" },
        }),
      ),
    ).toMatchObject({ status: "applied" });

    await closeDbExec();
    const reopened = await readSnapshot(projectId);
    expect(reopened.cells).toMatchObject([
      {
        id: section,
        contents: {
          kind: "collapsible",
          collapsed: true,
          title: "Nested analysis",
        },
      },
      { id: alpha, contents: { parentSectionId: section } },
      { id: beta, contents: { parentSectionId: section } },
    ]);
    const copy = await duplicateProject(scope, projectId);
    const [copiedSection] = copy.cells;
    expect(copiedSection?.id).toBeDefined();
    expect(copiedSection?.id).not.toBe(section);
    expect(copy.cells.slice(1)).toMatchObject([
      { contents: { parentSectionId: copiedSection?.id } },
      { contents: { parentSectionId: copiedSection?.id } },
    ]);
    const remove = {
      ...command(reopened, {
        type: "remove-section",
        cellId: section,
        mode: "delete",
        expectedOrderRevision: reopened.resources.orderRevision,
      }),
      originId,
    };
    expect(await apply(remove)).toMatchObject({ status: "applied" });
    expect((await readSnapshot(projectId)).cells).toEqual([]);
    expect(
      await undoNotebook({
        projectId,
        originId,
        workingVersionId: reopened.snapshot.head.versionId,
        direction: "undo",
        opId: randomUUID(),
      }),
    ).toMatchObject({ status: "applied" });
    expect((await readSnapshot(projectId)).cells.map(({ id }) => id)).toEqual([
      section,
      alpha,
      beta,
    ]);
  });

  it("replays one catalog insert and run after a lost acknowledgement and a later edit", async () => {
    const { projectId, snapshot, beta } = await fixture();
    const { connectionId, tableId, catalogGeneration, authorityGeneration } =
      warehouseTableProvenanceSchema.parse(
        await invoke("get-notebook-table-reference", {
          connectionId: SAMPLE_DATA_SOURCE_ID,
          tableId: "table:sample:PUBLIC:products",
        }),
      );
    const intent = {
      projectId,
      workingVersionId: snapshot.snapshot.head.versionId,
      observedHead: snapshot.snapshot.head,
      requestId: randomUUID(),
      cellId: randomUUID(),
      table: { connectionId, tableId, catalogGeneration, authorityGeneration },
      afterCellId: beta,
      expectedOrderRevision: snapshot.resources.orderRevision,
    };
    await expect(
      invoke("query-notebook-table", {
        ...intent,
        table: {
          ...intent.table,
          tableId: "table:warehouse-test:region:customers",
        },
      }),
    ).rejects.toMatchObject({ statusCode: 404, errorCode: "table_not_found" });
    expect(await readSnapshot(projectId)).toEqual(snapshot);
    await expect(
      invoke("query-notebook-table", {
        ...intent,
        table: { ...intent.table, catalogGeneration: "0" },
      }),
    ).rejects.toMatchObject({ errorCode: "catalog_generation_stale" });
    const accepted = queryNotebookTableReceiptSchema.parse(
      await invoke("query-notebook-table", intent),
    );
    expect(accepted).toMatchObject({
      sql: "select * from products limit 100",
      cellId: intent.cellId,
      resultVariable: "dataframe",
      sourceId: SAMPLE_DATA_SOURCE_ID,
    });
    const after = await readSnapshot(projectId);
    expect(getCell(after, intent.cellId).contents).toMatchObject({
      warehouseTable: { ...intent.table, schema: "PUBLIC", name: "products" },
    });
    await apply(
      command(after, {
        type: "set-metadata",
        expectedMetadataRevision: after.resources.metadataRevision,
        metadata: { title: "After admission" },
      }),
    );
    expect(await invoke("query-notebook-table", intent)).toEqual(accepted);
    expect(await readReceipt(projectId, intent.requestId)).toEqual({
      status: "found",
      receipt: accepted.insert,
    });
    expect(
      await invoke("get-notebook-run", { runId: accepted.runId }),
    ).toMatchObject({
      status: "found",
      run: { attempts: [{ state: { status: "queued" } }] },
    });
    await expect(
      invoke("query-notebook-table", {
        ...intent,
        table: { ...intent.table, tableId: "table:sample:PUBLIC:orders" },
      }),
    ).rejects.toMatchObject({ errorCode: "operation_id_reused" });
    await expect(
      invoke("query-notebook-table", {
        ...intent,
        requestId: randomUUID(),
        cellId: randomUUID(),
      }),
    ).rejects.toMatchObject({ errorCode: "notebook_order_conflict" });
    expect(await readJournal(projectId)).toMatchObject({
      events: [
        { receipt: { opId: intent.requestId } },
        { receipt: { delta: { metadata: { title: "After admission" } } } },
      ],
    });
    const work = await getDb()
      .select({ runId: notebookRunWork.runId })
      .from(notebookRunWork)
      .where(eq(notebookRunWork.runId, accepted.runId))
      .limit(2);
    expect(work).toEqual([{ runId: accepted.runId }]);
    await expect(
      invoke("query-notebook-table", intent, owner, otherOrgId),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rolls the catalog insert and its journal back when run reservation is refused", async () => {
    const { projectId, snapshot, alpha, beta } = await fixture();
    const execution = z
      .object({ snapshot: z.unknown() })
      .parse(await invoke("get-notebook-execution", { projectId }));
    const requestId = randomUUID();
    await expect(
      invoke("start-notebook-run", {
        snapshot: execution.snapshot,
        requestId,
        mode: "cell-only",
        targetCellId: alpha,
        cache: "bypass",
        staleValues: "reject",
      }),
    ).resolves.toMatchObject({ status: "admitted" });
    const { connectionId, tableId, catalogGeneration, authorityGeneration } =
      warehouseTableProvenanceSchema.parse(
        await invoke("get-notebook-table-reference", {
          connectionId: SAMPLE_DATA_SOURCE_ID,
          tableId: "table:sample:PUBLIC:products",
        }),
      );
    await expect(
      invoke("query-notebook-table", {
        projectId,
        workingVersionId: snapshot.snapshot.head.versionId,
        observedHead: snapshot.snapshot.head,
        requestId,
        cellId: randomUUID(),
        table: {
          connectionId,
          tableId,
          catalogGeneration,
          authorityGeneration,
        },
        afterCellId: beta,
        expectedOrderRevision: snapshot.resources.orderRevision,
      }),
    ).rejects.toMatchObject({ errorCode: "operation_id_reused" });
    expect(await readSnapshot(projectId)).toEqual(snapshot);
    expect(await readJournal(projectId)).toMatchObject({ events: [] });
    expect(await readReceipt(projectId, requestId)).toMatchObject({
      status: "absent",
    });
  });

  it("admits one catalog run with the accepted insert and replays its receipt", async () => {
    const project = await createProject({ ...scope, title: "Catalog query" });
    await adoptNotebook(scope, project.id);
    const before = await readSnapshot(project.id);
    const table = {
      connectionId: SAMPLE_DATA_SOURCE_ID,
      tableId: "table:sample:PUBLIC:customers",
    };
    const { catalogGeneration, authorityGeneration } =
      warehouseTableProvenanceSchema.parse(
        await invoke("get-notebook-table-reference", table),
      );
    const input = {
      projectId: project.id,
      workingVersionId: before.snapshot.head.versionId,
      observedHead: before.snapshot.head,
      requestId: randomUUID(),
      originId: randomUUID(),
      cellId: randomUUID(),
      afterCellId: before.cells.at(-1)?.id ?? null,
      expectedOrderRevision: before.resources.orderRevision,
      table: { ...table, catalogGeneration, authorityGeneration },
    };
    const receipt = queryNotebookTableReceiptSchema.parse(
      await invoke("query-notebook-table", input),
    );
    expect(receipt).toMatchObject({
      cellId: input.cellId,
      sql: "select * from customers limit 100",
    });
    expect(await invoke("query-notebook-table", input)).toEqual(receipt);
    await expect(
      invoke("query-notebook-table", { ...input, cellId: randomUUID() }),
    ).rejects.toMatchObject({ errorCode: "operation_id_reused" });
    await expect(
      invoke("query-notebook-table", {
        ...input,
        requestId: randomUUID(),
        table: { ...input.table, tableId: "table:other:PUBLIC:customers" },
      }),
    ).rejects.toMatchObject({ statusCode: 404, errorCode: "table_not_found" });
    const accepted = await readSnapshot(project.id);
    expect(accepted.cells.map(({ id }) => id)).toEqual([
      ...before.cells.map(({ id }) => id),
      input.cellId,
    ]);
    const [run] = await getDb()
      .select()
      .from(notebookRuns)
      .where(eq(notebookRuns.id, receipt.runId))
      .limit(1);
    expect(receipt.run).toEqual(run?.receipt);
    expect(run?.receipt.request.snapshot.ref.head).toEqual(
      accepted.snapshot.head,
    );
    expect(
      await getDb()
        .select()
        .from(notebookRunWork)
        .where(eq(notebookRunWork.runId, receipt.runId))
        .limit(2),
    ).toMatchObject([{ cellId: input.cellId }]);

    const execution = z
      .object({ status: z.literal("found"), snapshot: z.unknown() })
      .parse(await invoke("get-notebook-execution", { projectId: project.id }));
    const conflictingRequestId = randomUUID();
    expect(
      await invoke("start-notebook-run", {
        requestId: conflictingRequestId,
        snapshot: execution.snapshot,
        mode: "run-all",
        restart: false,
        cache: "reuse",
      }),
    ).toMatchObject({ status: "admitted" });
    await expect(
      invoke("query-notebook-table", {
        ...input,
        requestId: conflictingRequestId,
        cellId: randomUUID(),
        observedHead: accepted.snapshot.head,
        expectedOrderRevision: accepted.resources.orderRevision,
        afterCellId: receipt.cellId,
      }),
    ).rejects.toMatchObject({ errorCode: "operation_id_reused" });
    expect(await readSnapshot(project.id)).toEqual(accepted);
    expect(
      await undoNotebook({
        projectId: project.id,
        workingVersionId: input.workingVersionId,
        originId: input.originId,
        direction: "undo",
        opId: randomUUID(),
      }),
    ).toMatchObject({ status: "applied" });
    expect((await readSnapshot(project.id)).cells).toEqual(before.cells);
  });

  it("reopens receipt-backed move and delete history with stable layout and fresh output fences", async () => {
    const alpha = randomUUID();
    const beta = randomUUID();
    const project = await createProject({
      ...scope,
      cells: [
        codeCell(alpha, "alpha = 1"),
        {
          ...codeCell(beta, "beta = 2"),
          gridX: 0,
          gridY: 0,
          gridWidth: 12,
          gridHeight: 2,
        },
      ],
    });
    const projectId = project.id;
    const originId = randomUUID();
    await adoptNotebook(scope, projectId);
    const base = await readSnapshot(projectId);
    await setApp(
      command(base, {
        type: "set-app",
        expectedLayoutRevision: base.resources.layoutRevision,
        patches: [{ type: "initialize" }],
      }),
    );
    const arranged = await readSnapshot(projectId);
    expect(
      arranged.appLayout?.tabs.flatMap(({ rows }) =>
        rows.flatMap(({ columns }) =>
          columns.flatMap(({ elements }) =>
            elements.map(({ cellId }) => cellId),
          ),
        ),
      ),
    ).toContain(beta);
    await invoke("move-project-cell", {
      projectId,
      originId,
      cellId: beta,
      direction: "up",
    });
    const moved = await readSnapshot(projectId);
    expect(moved.cells.map(({ id }) => id)).toEqual([beta, alpha]);
    await invoke("delete-project-cell", { projectId, originId, cellId: beta });
    const [{ generation: deletedFence } = { generation: undefined }] =
      await getDb()
        .select({ generation: schema.cellOutputGenerations.generation })
        .from(schema.cellOutputGenerations)
        .where(
          and(
            eq(schema.cellOutputGenerations.projectId, projectId),
            eq(schema.cellOutputGenerations.cellId, beta),
          ),
        )
        .limit(1);
    expect(deletedFence).toBeDefined();
    await closeDbExec();
    const reopened = await readSnapshot(projectId);
    expect(reopened.cells.map(({ id }) => id)).toEqual([alpha]);
    const request = {
      projectId,
      originId,
      workingVersionId: reopened.snapshot.head.versionId,
      direction: "undo",
      opId: randomUUID(),
    };
    expect(
      await undoNotebook({
        ...request,
        originId: randomUUID(),
        opId: randomUUID(),
      }),
    ).toMatchObject({ status: "no_change" });
    const restored = await undoNotebook(request);
    expect(restored).toMatchObject({
      status: "applied",
      delta: { cells: [{ id: beta }] },
      impact: {
        invalidatedOutputs: expect.arrayContaining([
          expect.objectContaining({ cellId: beta }),
        ]),
      },
    });
    const revived = await readSnapshot(projectId);
    expect(revived.cells.map(({ id }) => id)).toEqual([beta, alpha]);
    expect(getCell(revived, beta).contents).toEqual(
      getCell(moved, beta).contents,
    );
    expect(revived.appLayout?.tabs).toEqual(arranged.appLayout?.tabs);
    expect(stableJson(await undoNotebook(request))).toBe(stableJson(restored));
    if (!deletedFence) throw new Error("Missing deletion fence");
    await expect(
      getDb().transaction((tx) =>
        lockCellOutputGeneration(projectId, beta, deletedFence, tx),
      ),
    ).rejects.toBeInstanceOf(CellOutputGenerationConflict);

    expect(
      await undoNotebook({ ...request, opId: randomUUID() }),
    ).toMatchObject({ status: "applied" });
    expect((await readSnapshot(projectId)).cells.map(({ id }) => id)).toEqual([
      alpha,
      beta,
    ]);
    expect(
      await undoNotebook({ ...request, direction: "redo", opId: randomUUID() }),
    ).toMatchObject({ status: "applied" });
    expect((await readSnapshot(projectId)).cells.map(({ id }) => id)).toEqual([
      beta,
      alpha,
    ]);
    expect(
      await undoNotebook({ ...request, direction: "redo", opId: randomUUID() }),
    ).toMatchObject({
      status: "applied",
      delta: { tombstones: [{ cellId: beta }] },
    });
    expect((await readSnapshot(projectId)).cells.map(({ id }) => id)).toEqual([
      alpha,
    ]);
  });

  it("keeps typing outside history, separates labels from symbols, and refuses a collaborator's change atomically", async () => {
    const { projectId, snapshot, alpha, beta } = await fixture();
    await getDb().insert(schema.projectShares).values({
      id: randomUUID(),
      resourceId: projectId,
      principalType: "user",
      principalId: unrelated,
      role: "editor",
      createdBy: owner,
      createdAt: new Date().toISOString(),
    });
    const originId = randomUUID();
    const workingVersionId = snapshot.snapshot.head.versionId;
    const inversion = (direction: "undo" | "redo") => ({
      projectId,
      originId,
      workingVersionId,
      direction,
      opId: randomUUID(),
    });
    const local = (base: NotebookSnapshot, ...changes: unknown[]) =>
      apply({ ...command(base, ...changes), originId });
    const collaborate = (base: NotebookSnapshot, ...changes: unknown[]) =>
      invoke("apply-notebook-operation", command(base, ...changes), unrelated);
    const rename = (base: NotebookSnapshot, name: string) => ({
      type: "set-output-name",
      cellId: alpha,
      expectedRevision: getCell(base, alpha).revision,
      name,
    });
    const label = (base: NotebookSnapshot, name: string) => ({
      type: "set-label",
      cellId: alpha,
      expectedLabelRevision: getCell(base, alpha).labelRevision,
      label: name,
    });
    const first = getCell(snapshot, alpha);
    await invoke("save-project-cell", {
      projectId,
      cellId: alpha,
      originId,
      contents: { ...first.contents, resultVariable: "named" },
      expectedUpdatedAt: first.updatedAt,
    });
    const renamed = await readSnapshot(projectId);
    await collaborate(renamed, label(renamed, "Collaborator label"));
    expect(await undoNotebook(inversion("undo"))).toMatchObject({
      status: "applied",
      delta: {
        cells: [
          {
            id: alpha,
            contents: { label: "Collaborator label", resultVariable: null },
          },
        ],
      },
    });
    const afterUndo = await readSnapshot(projectId);
    await local(afterUndo, setCode(afterUndo, beta, "beta = 3"));
    expect(await undoNotebook(inversion("redo"))).toMatchObject({
      status: "applied",
      delta: {
        cells: [
          {
            id: alpha,
            contents: { label: "Collaborator label", resultVariable: "named" },
          },
        ],
      },
    });
    await undoNotebook(inversion("undo"));
    const branch = await readSnapshot(projectId);
    await local(branch, label(branch, "Local label"));
    expect(await undoNotebook(inversion("redo"))).toMatchObject({
      status: "no_change",
    });

    const beforeBatch = await readSnapshot(projectId);
    await local(
      beforeBatch,
      rename(beforeBatch, "new_name"),
      setCode(beforeBatch, beta, "beta = 4"),
    );
    const acceptedBatch = await readSnapshot(projectId);
    await collaborate(acceptedBatch, setCode(acceptedBatch, beta, "beta = 5"));
    const remote = await readSnapshot(projectId);
    await collaborate(remote, setCode(remote, beta, "beta = 4"));
    const afterRemote = await readSnapshot(projectId);
    const conflicted = inversion("undo");
    const conflict = {
      status: "conflict",
      reason: "cell_changed",
      opId: conflicted.opId,
      nextHead: afterRemote.snapshot.head,
    };
    await expect(undoNotebook(conflicted)).rejects.toMatchObject({
      errorCode: "notebook_conflict",
      details: { receipt: conflict },
    });
    expect(await readReceipt(projectId, conflicted.opId)).toMatchObject({
      status: "found",
      receipt: conflict,
    });
    expect(
      await invoke(
        "get-notebook-operation",
        { projectId, opId: conflicted.opId },
        unrelated,
      ),
    ).toMatchObject({ status: "absent" });
    await expect(undoNotebook(inversion("undo"))).rejects.toMatchObject({
      details: { receipt: { reason: "cell_changed" } },
    });
    expect(await readSnapshot(projectId)).toEqual(afterRemote);
  });

  it("journals legacy editor cell mutations and MCP metadata edits in one ordered draft", async () => {
    const { projectId, snapshot, alpha, beta } = await fixture();
    const { createdCellId: sqlId } = (await invoke("add-project-cell", {
      projectId,
      kind: "sql",
      name: "weekly_sales",
      afterCellId: alpha,
      source: "select 42",
    })) as { createdCellId: string };
    const sqlCell = getCell(await readSnapshot(projectId), sqlId);
    if (sqlCell.contents.kind !== "sql")
      throw new Error("Missing added SQL cell");
    const { connectionMode: _mode, ...warehouseContents } = sqlCell.contents;
    await invoke("save-project-cell", {
      projectId,
      cellId: sqlId,
      contents: {
        ...warehouseContents,
        source: "select 84",
        dataConnectionId: SAMPLE_DATA_SOURCE_ID,
      },
      expectedUpdatedAt: sqlCell.updatedAt,
    });
    const { createdCellId: chartId } = (await invoke("add-project-cell", {
      projectId,
      kind: "chart",
      dataframe: "weekly_sales",
      afterCellId: sqlId,
    })) as { createdCellId: string };
    const chart = getCell(await readSnapshot(projectId), chartId);
    if (chart.contents.kind !== "chart") throw new Error("Missing added chart");
    await invoke("save-project-cell", {
      projectId,
      cellId: chartId,
      contents: {
        ...chart.contents,
        chartSpec: { ...chart.contents.chartSpec, title: "Weekly sales" },
      },
      expectedUpdatedAt: chart.updatedAt,
    });
    const { createdCellId: copyId } = (await invoke("duplicate-project-cell", {
      projectId,
      cellId: sqlId,
    })) as { createdCellId: string };
    await invoke("move-project-cell", {
      projectId,
      cellId: copyId,
      direction: "down",
    });
    const copy = getCell(await readSnapshot(projectId), copyId);
    await invoke("delete-project-cell", { projectId, cellId: copyId });
    await invoke("add-project-cell", {
      projectId,
      kind: "sql",
      afterCellId: chartId,
      restore: copy.contents,
    });
    const { id: statusId } = await createStatus({ ...scope, name: "Reviewed" });
    const metadata = {
      title: "Weekly report",
      description: "Committed edits and their results",
      statusId,
    };
    await invoke(
      "update-project",
      { projectId, ...metadata },
      owner,
      orgId,
      "mcp",
    );

    const accepted = await readSnapshot(projectId);
    expect(accepted.cells.map(({ id }) => id)).toEqual([
      alpha,
      sqlId,
      chartId,
      copyId,
      beta,
    ]);
    expect(accepted.metadata).toEqual(metadata);
    expect(getCell(accepted, sqlId).contents).toMatchObject({
      source: "select 84",
      dataConnectionId: SAMPLE_DATA_SOURCE_ID,
    });
    expect(getCell(accepted, chartId).contents).toMatchObject({
      dataframe: "weekly_sales",
      chartSpec: { title: "Weekly sales" },
    });
    const journal = notebookChangesReadSchema.parse(
      await readJournal(projectId, snapshot.snapshot.eventSeq),
    );
    if (journal.status !== "ok") throw new Error("Missing mutation journal");
    expect(journal.cursor).toBe(accepted.snapshot.eventSeq);
    expect(
      journal.events.map(({ receipt }) => ({
        affected: receipt.delta.cells.map(({ id }) => id),
        removed: receipt.delta.tombstones.map(({ cellId }) => cellId),
        metadata: receipt.delta.metadata,
      })),
    ).toEqual([
      { affected: [sqlId], removed: [] },
      { affected: [sqlId], removed: [] },
      { affected: [chartId], removed: [] },
      { affected: [chartId], removed: [] },
      { affected: [copyId], removed: [] },
      { affected: [copyId], removed: [] },
      { affected: [], removed: [copyId] },
      { affected: [copyId], removed: [] },
      { affected: [], removed: [], metadata },
    ]);
  });

  it("journals component import creation and the selected component binding", async () => {
    const { projectId, snapshot, alpha } = await fixture();
    const component = await createComponent(scope, {
      projectId,
      cellIds: [alpha],
      name: "Regional analysis",
    });
    const { createdCellId: importId } = (await invoke("add-project-cell", {
      projectId,
      kind: "component-import",
      name: component.name,
    })) as { createdCellId: string };
    const draft = getCell(await readSnapshot(projectId), importId);
    await invoke("save-project-cell", {
      projectId,
      cellId: importId,
      expectedUpdatedAt: draft.updatedAt,
      contents: { ...draft.contents, componentVersionId: component.id },
    });
    const contents = {
      kind: "component-import",
      title: "Regional analysis",
      componentVersionId: component.id,
    };
    expect(
      getCell(await readSnapshot(projectId), importId).contents,
    ).toMatchObject(contents);
    expect(
      await readJournal(projectId, snapshot.snapshot.eventSeq),
    ).toMatchObject({
      status: "ok",
      events: [
        {
          receipt: {
            delta: {
              cells: [
                {
                  id: importId,
                  contents: {
                    ...contents,
                    componentVersionId: null,
                  },
                },
              ],
            },
          },
        },
        { receipt: { delta: { cells: [{ id: importId, contents }] } } },
      ],
    });
  });

  it("duplicates a tab through layout CAS and deletes its source without deleting notebook cells", async () => {
    const { projectId, snapshot, alpha } = await fixture();
    await setApp(
      command(snapshot, {
        type: "set-app",
        expectedLayoutRevision: snapshot.resources.layoutRevision,
        patches: [
          { type: "initialize" },
          {
            type: "place",
            tabId: "tab-1",
            cellId: alpha,
            elementId: "alpha-placement",
            destination: {
              rowId: "alpha-row",
              columnId: "alpha-column",
              left: 0,
              right: 120,
              afterRowId: null,
            },
          },
        ],
      }),
    );
    const arranged = await readSnapshot(projectId);
    const duplicate = command(arranged, {
      type: "set-app",
      expectedLayoutRevision: arranged.resources.layoutRevision,
      patches: [
        {
          type: "tab-duplicate",
          sourceTabId: "tab-1",
          tabId: "copied-tab",
          name: "Tab 1 (Copy)",
        },
      ],
    });
    const receipt = await setApp(duplicate);
    expect(receipt).toMatchObject({
      status: "applied",
      delta: { cells: [], tombstones: [] },
    });
    const updated = await readSnapshot(projectId);
    expect(updated.appLayout?.tabs.map(({ tabId }) => tabId)).toEqual([
      "tab-1",
      "copied-tab",
    ]);
    expect(updated.appLayout?.tabs[0]).toEqual(arranged.appLayout?.tabs[0]);
    expect(
      updated.appLayout?.tabs[1]?.rows[0]?.columns[0]?.elements[0],
    ).toMatchObject({
      elementId: expect.not.stringMatching(/^alpha-placement$/),
      cellId: alpha,
    });
    const removeTab = { type: "tab-remove", tabId: "tab-1" };
    await expect(
      setApp(
        command(arranged, {
          type: "set-app",
          expectedLayoutRevision: arranged.resources.layoutRevision,
          patches: [removeTab],
        }),
      ),
    ).rejects.toMatchObject({
      errorCode: "notebook_conflict",
      details: { receipt: { status: "conflict", reason: "layout_changed" } },
    });
    expect(await readSnapshot(projectId)).toEqual(updated);

    await setApp(
      command(updated, {
        type: "set-app",
        expectedLayoutRevision: updated.resources.layoutRevision,
        patches: [removeTab],
      }),
    );
    const removed = await readSnapshot(projectId);
    expect(removed.cells).toEqual(arranged.cells);
    expect(removed.appLayout?.tabs).toEqual(updated.appLayout?.tabs.slice(1));
  });

  it("commits insert-and-place, layout CAS and exact replay as one notebook operation", async () => {
    const project = await createProject({ ...scope, cells: [] });
    const draft = await readAppProject(project.id);
    expect(draft.appLayout).toMatchObject({
      initialized: false,
      tabs: [{ rows: [] }],
    });
    const draftHead = draft.draftHead;
    if (!draftHead) throw new Error("The draft head is missing");
    const initialized = await setApp({
      protocol: 1,
      projectId: project.id,
      workingVersionId: draftHead.versionId,
      observedHead: draftHead,
      opId: randomUUID(),
      changes: [
        {
          type: "set-app",
          expectedLayoutRevision: "0",
          patches: [{ type: "initialize" }],
        },
      ],
    });
    expect(initialized).toMatchObject({
      status: "applied",
      nextHead: { revision: "1" },
    });
    const original = await readSnapshot(project.id);
    const cellId = randomUUID();
    const { tabId } = original.appLayout?.tabs[0] ?? { tabId: "" };
    expect(tabId).not.toBe("");
    const layoutInsertion = {
      type: "insert-and-place",
      insert: {
        type: "insert",
        cellId,
        expectedOrderRevision: original.resources.orderRevision,
        gap: { afterCellId: null, beforeCellId: null },
        contents: { kind: "text", text: "Regional revenue", label: null },
      },
      placement: {
        tabId,
        cellId,
        elementId: "regional-revenue",
        destination: {
          rowId: "title-row",
          columnId: "title-column",
          left: 0,
          right: 120,
        },
      },
    };
    const rejected = command(original, {
      type: "set-app",
      expectedLayoutRevision: original.resources.layoutRevision,
      patches: [layoutInsertion],
    });
    await expect(setApp(rejected)).rejects.toMatchObject({
      errorCode: "app_layout_invalid",
    });
    expect(await readSnapshot(project.id)).toEqual(original);
    expect(await readReceipt(project.id, rejected.opId)).toMatchObject({
      status: "absent",
    });

    const accepted = command(original, {
      type: "set-app",
      expectedLayoutRevision: original.resources.layoutRevision,
      patches: [
        {
          ...layoutInsertion,
          placement: {
            ...layoutInsertion.placement,
            destination: {
              ...layoutInsertion.placement.destination,
              afterRowId: null,
            },
          },
        },
      ],
    });
    const receipt = await setApp(accepted);
    expect(receipt).toMatchObject({
      status: "applied",
      nextHead: { revision: "2" },
      delta: {
        cells: [{ id: cellId, contents: { text: "Regional revenue" } }],
        resources: { layoutRevision: "2", orderRevision: "2" },
        appLayout: {
          revision: "2",
          tabs: [
            {
              rows: [
                {
                  rowId: "title-row",
                  columns: [
                    {
                      columnId: "title-column",
                      left: 0,
                      right: 120,
                      elements: [
                        {
                          cellId,
                          display: "output",
                          elementId: "regional-revenue",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    });
    const stale = command(original, {
      type: "set-app",
      expectedLayoutRevision: original.resources.layoutRevision,
      patches: [{ type: "tab-rename", tabId, name: "Stale" }],
    });
    await expect(setApp(stale)).rejects.toMatchObject({
      errorCode: "notebook_conflict",
      details: {
        receipt: {
          status: "conflict",
          reason: "layout_changed",
          nextHead: { revision: "2" },
        },
      },
    });
    const snapshot = await readSnapshot(project.id);
    const renamed = await setApp(
      command(snapshot, {
        type: "set-app",
        expectedLayoutRevision: snapshot.resources.layoutRevision,
        patches: [{ type: "tab-add", tabId: "details", name: "Details" }],
      }),
    );
    expect(renamed).toMatchObject({
      status: "applied",
      nextHead: { revision: "3" },
    });
    expect(stableJson(await setApp(accepted))).toBe(stableJson(receipt));
    const reused = { ...accepted, changes: stale.changes };
    await expect(setApp(reused)).rejects.toMatchObject({
      errorCode: "operation_id_reused",
    });
    await expect(
      invoke("set-app", accepted, owner, otherOrgId),
    ).rejects.toMatchObject({
      errorCode: "project_not_found",
    });
    expect(await readJournal(project.id)).toMatchObject({
      cursor: "3",
      events: [
        { sequence: "1", receipt: { opId: initialized.opId } },
        {
          sequence: "2",
          receipt: { opId: accepted.opId },
          before: { appLayout: original.appLayout },
        },
        { sequence: "3", receipt: { opId: renamed.opId } },
      ],
    });
    const cold = await readAppProject(project.id);
    const [persisted] = await getDb()
      .select()
      .from(schema.appLayouts)
      .where(eq(schema.appLayouts.projectId, project.id))
      .limit(1);
    expect(persisted).toMatchObject({
      orgId,
      workingVersionId: draftHead.versionId,
      layoutRevision: 3n,
    });
    expect(cold.appLayout).toEqual(persisted?.document);
    expect(cold.cells.map(({ id }) => id)).toEqual([cellId]);

    await invoke("update-project", { projectId: project.id, title: "Revenue" });
    expect((await readSnapshot(project.id)).appLayout).toEqual(cold.appLayout);
    await invoke("delete-project-cell", { projectId: project.id, cellId });
    const afterDelete = await readSnapshot(project.id);
    expect(afterDelete.appLayout).toMatchObject({
      revision: afterDelete.resources.layoutRevision,
      tabs: [{ rows: [] }, { rows: [] }],
    });
    expect(await readJournal(project.id, "4")).toMatchObject({
      events: [
        {
          receipt: {
            delta: {
              tombstones: [{ cellId }],
              appLayout: afterDelete.appLayout,
            },
          },
        },
      ],
    });
  });

  it("pins unopened and arranged layouts in published versions and restores the pinned arrangement", async () => {
    const cellId = randomUUID();
    const codeId = randomUUID();
    const source = "sensitive_amount = 42";
    const project = await createProject({
      ...scope,
      cells: [
        {
          id: cellId,
          kind: "text",
          text: "Regional revenue",
          label: null,
          hidden: false,
          gridX: null,
          gridY: null,
          gridWidth: null,
          gridHeight: null,
        },
        codeCell(codeId, source),
      ],
    });
    const { releaseId: emptyRelease } = await publishFixture(project.id);
    expect(
      (await readAppProject(project.id, emptyRelease)).appLayout,
    ).toMatchObject({
      initialized: false,
      tabs: [{ rows: [] }],
    });

    await adoptNotebook(scope, project.id);
    const base = await readSnapshot(project.id);
    await setApp(
      command(base, {
        type: "set-app",
        expectedLayoutRevision: "0",
        patches: [{ type: "initialize" }],
      }),
    );
    const arranged = await readSnapshot(project.id);
    expect(arranged.appLayout).toMatchObject({
      initialized: true,
      tabs: [
        {
          rows: [
            { columns: [{ left: 0, right: 120, elements: [{ cellId }] }] },
          ],
        },
      ],
    });
    const { releaseId: arrangedRelease } = await publishFixture(project.id);
    await getDb().insert(schema.projectShares).values({
      id: randomUUID(),
      resourceId: project.id,
      principalType: "user",
      principalId: unrelated,
      role: "viewer",
      createdBy: owner,
      createdAt: new Date().toISOString(),
    });
    const appRead = {
      projectId: project.id,
      version: arrangedRelease,
      surface: "app",
      viewId: randomUUID(),
    };
    expect(await invoke("get-project", appRead)).toMatchObject({
      canViewSource: true,
      project: {
        cells: [{ id: cellId }, { id: codeId, contents: { source } }],
      },
    });
    expect(await invoke("get-project", appRead, unrelated)).toMatchObject({
      canViewSource: false,
      project: {
        cells: [{ id: cellId }, { id: codeId, contents: { source: "" } }],
      },
    });
    await expect(
      invoke(
        "set-app",
        command(arranged, {
          type: "set-app",
          expectedLayoutRevision: arranged.resources.layoutRevision,
          patches: [{ type: "reset", preset: "empty" }],
        }),
        unrelated,
      ),
    ).rejects.toMatchObject({ errorCode: "project_not_found" });
    await setApp(
      command(arranged, {
        type: "set-app",
        expectedLayoutRevision: arranged.resources.layoutRevision,
        patches: [{ type: "reset", preset: "empty" }],
      }),
    );
    expect((await readAppProject(project.id)).appLayout).toMatchObject({
      tabs: [{ rows: [] }],
    });
    expect(
      (await readAppProject(project.id, arrangedRelease)).appLayout,
    ).toEqual(arranged.appLayout);
    expect(
      (await readAppProject(project.id, emptyRelease)).appLayout,
    ).toMatchObject({ tabs: [{ rows: [] }] });

    await invoke("restore-project-version", {
      projectId: project.id,
      versionId: arrangedRelease,
      observedHead: (await readSnapshot(project.id)).snapshot.head,
      opId: randomUUID(),
    });
    const restored = await readAppProject(project.id);
    expect(restored.draftHead?.versionId).not.toBe(
      base.snapshot.head.versionId,
    );
    const restoredSnapshot = await readSnapshot(project.id);
    expect(restored.appLayout).toEqual({
      ...arranged.appLayout,
      revision: restoredSnapshot.resources.layoutRevision,
    });
    expect(restoredSnapshot.appLayout).toEqual(restored.appLayout);
    expect(
      await readJournal(
        project.id,
        (BigInt(restoredSnapshot.snapshot.eventSeq) - 1n).toString(),
      ),
    ).toMatchObject({
      events: [{ receipt: { delta: { appLayout: restored.appLayout } } }],
    });
    const duplicate = await duplicateProject(scope, project.id);
    const copy = await readAppProject(duplicate.id);
    expect(copy.cells[0]?.id).not.toBe(cellId);
    expect(copy.appLayout).toMatchObject({
      tabs: [
        {
          rows: [
            {
              columns: [
                {
                  left: 0,
                  right: 120,
                  elements: [{ cellId: copy.cells[0]?.id }],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("reopens before and after a committed edit whose acknowledgement was lost", async () => {
    const { projectId, snapshot, alpha } = await fixture();
    const input = command(snapshot, setCode(snapshot, alpha, "alpha = 84"));
    await closeDbExec();
    const before = await readProject(projectId);
    expect(before.notebook).toEqual(snapshot);
    expect(
      before.project.cells.find(({ id }) => id === alpha)?.contents,
    ).toMatchObject({
      source: "alpha = 1",
    });
    expect(await readReceipt(projectId, input.opId)).toEqual({
      status: "absent",
      reason: "not_found",
    });
    await apply(input);
    await closeDbExec();
    const reopened = await readProject(projectId);
    expect(
      reopened.project.cells.find(({ id }) => id === alpha)?.contents,
    ).toMatchObject({
      source: "alpha = 84",
    });
    const replay = await apply(input);
    expect(reopened.notebook?.snapshot).toMatchObject({
      head: replay.nextHead,
      eventSeq: replay.eventSeq,
    });
    expect(replay).toMatchObject({
      status: "applied",
      opId: input.opId,
      delta: { cells: [{ id: alpha, contents: { source: "alpha = 84" } }] },
    });
    expect(await readReceipt(projectId, input.opId)).toEqual({
      status: "found",
      receipt: replay,
    });
    expect(
      await readJournal(projectId, snapshot.snapshot.eventSeq),
    ).toMatchObject({
      status: "ok",
      events: [{ receipt: replay }],
    });
  });

  it("opens starter, imported and copied projects on an accepted working lineage", async () => {
    const { id: starterId } = (await invoke("create-project", {
      title: "Starter",
      sampleDataset: "orders",
    })) as { id: string };
    const starter = await readSnapshot(starterId);
    expect(starter.cells.map(({ contents }) => contents)).toMatchObject([
      { kind: "sql", source: "SELECT * FROM orders LIMIT 100" },
    ]);
    const imported = projectDocumentSchema.parse(
      (
        (await invoke("import-project", {
          title: "Imported workbook",
          cells: [
            { kind: "markdown", markdown: "## Customer retention" },
            { kind: "code", source: "retained = 84" },
          ],
        })) as { project: unknown }
      ).project,
    );
    const original = await readSnapshot(imported.id);
    const contents = [
      { kind: "markdown", markdown: "## Customer retention" },
      { kind: "code", source: "retained = 84" },
    ];
    expect(original.cells.map((cell) => cell.contents)).toMatchObject(contents);
    const copied = projectDocumentSchema.parse(
      (
        (await invoke("duplicate-project", { projectId: imported.id })) as {
          project: unknown;
        }
      ).project,
    );
    const copy = await readSnapshot(copied.id);
    expect(copy.cells.map((cell) => cell.contents)).toMatchObject(contents);
    expect(copy.snapshot.head.versionId).not.toBe(
      original.snapshot.head.versionId,
    );
    const originalIds = new Set(original.cells.map(({ id }) => id));
    expect(copy.cells.some(({ id }) => originalIds.has(id))).toBe(false);
  });

  it("adopts a restored version atomically and rejects delayed edits from the old lineage", async () => {
    const { projectId, snapshot, alpha } = await fixture();
    const { releaseId: publishedId } = await publishFixture(projectId);
    await apply(command(snapshot, setCode(snapshot, alpha, "alpha = 84")));
    const oldDraft = await readSnapshot(projectId);
    const stale = command(oldDraft, setCode(oldDraft, alpha, "alpha = 99"));
    await invoke("restore-project-version", {
      projectId,
      versionId: publishedId,
      observedHead: oldDraft.snapshot.head,
      opId: randomUUID(),
    });

    const restored = await readSnapshot(projectId);
    expect(restored.snapshot.head.versionId).not.toBe(
      oldDraft.snapshot.head.versionId,
    );
    expect(restored.snapshot.head.versionId).not.toBe(publishedId);
    expect(getCell(restored, alpha).contents).toMatchObject({
      source: "alpha = 1",
    });
    await expect(apply(stale)).rejects.toMatchObject({
      errorCode: "notebook_conflict",
      details: { receipt: { reason: "lineage_changed" } },
    });
    const release = await readProject(projectId, publishedId);
    expect(release.notebook).toBeNull();
    expect(
      release.project.cells.find(({ id }) => id === alpha)?.contents,
    ).toMatchObject({
      source: "alpha = 1",
    });
    expect(
      await readJournal(projectId, oldDraft.snapshot.eventSeq),
    ).toMatchObject({
      status: "ok",
      cursor: restored.snapshot.eventSeq,
      events: [{ receipt: { nextHead: restored.snapshot.head } }],
    });
    expect(await readSnapshot(projectId)).toEqual(restored);
  });

  it("rejects an unavailable warehouse on a cold grant store without committing another change", async () => {
    const { projectId, snapshot, alpha, beta } = await fixture();
    const rejected = command(snapshot, setCode(snapshot, alpha, "alpha = 42"), {
      type: "insert",
      cellId: randomUUID(),
      expectedOrderRevision: snapshot.resources.orderRevision,
      gap: { afterCellId: alpha, beforeCellId: beta },
      contents: {
        kind: "sql",
        source: "select 42",
        label: null,
        databaseSchema: null,
        dataConnectionId: "unavailable-fixture-source",
        outputResult: true,
      },
    });
    await expect(apply(rejected)).rejects.toMatchObject({
      errorCode: "data_connection_not_found",
    });
    expect(await readSnapshot(projectId)).toEqual(snapshot);
    expect(await readReceipt(projectId, rejected.opId)).toMatchObject({
      status: "absent",
    });
  });

  it("replays the exact first receipt after a held acknowledgement and a later edit", async () => {
    const { projectId, snapshot, alpha } = await fixture();
    const initial = command(snapshot, setCode(snapshot, alpha, "alpha = 10"));
    const sameTimestamp = getCell(snapshot, alpha).updatedAt;
    const heldResponse = withFixedClock(sameTimestamp, () =>
      apply(initial).then(async (receipt) => {
        const current = await readSnapshot(projectId);
        await apply(command(current, setCode(current, alpha, "alpha = 42")));
        return receipt;
      }),
    );
    const original = await heldResponse;
    const replay = await apply(initial);
    expect(stableJson(replay)).toBe(stableJson(original));
    expect(original.previousHead.revision).toBe("0");
    expect(original.nextHead.revision).toBe("1");
    expect(original.eventSeq).toBe("1");
    expect(await readReceipt(projectId, initial.opId)).toEqual({
      status: "found",
      receipt: original,
    });
    expect(await readJournal(projectId)).toMatchObject({
      status: "ok",
      events: [
        {
          sequence: "1",
          receipt: original,
          before: { cells: [{ contents: { source: "alpha = 1" } }] },
        },
        { sequence: "2", receipt: { nextHead: { revision: "2" } } },
      ],
      hasMore: false,
    });
    const fresh = await readSnapshot(projectId);
    expect(fresh.snapshot.head.revision).toBe("2");
    expect(getCell(fresh, alpha).updatedAt).toBe(
      new Date(Date.parse(sameTimestamp) + 2).toISOString(),
    );
    expect(getCell(fresh, alpha).contents).toMatchObject({
      source: "alpha = 42",
    });
    await expect(
      apply({ ...initial, changes: [setCode(snapshot, alpha, "alpha = 99")] }),
    ).rejects.toMatchObject({ errorCode: "operation_id_reused" });
    expect(await readSnapshot(projectId)).toEqual(fresh);
  });

  it("retains both disjoint writes and resolves a same-cell race with one recoverable conflict", async () => {
    const { projectId, snapshot, alpha, beta } = await fixture();
    await Promise.all([
      apply(command(snapshot, setCode(snapshot, alpha, "alpha = 42"))),
      apply(command(snapshot, setCode(snapshot, beta, "beta = 84"))),
    ]);
    const both = await readSnapshot(projectId);
    expect(both.snapshot.head.revision).toBe("2");
    expect(getCell(both, alpha).contents).toMatchObject({
      source: "alpha = 42",
    });
    expect(getCell(both, beta).contents).toMatchObject({ source: "beta = 84" });
    const left = command(both, setCode(both, alpha, "alpha = 43"));
    const right = command(both, setCode(both, alpha, "alpha = 44"));
    const [leftResult, rightResult] = await Promise.allSettled([
      apply(left),
      apply(right),
    ]);
    const leftWon = leftResult.status === "fulfilled";
    const [accepted, rejected] = leftWon
      ? [leftResult, rightResult]
      : [rightResult, leftResult];
    if (accepted.status !== "fulfilled" || rejected.status !== "rejected")
      throw new Error("Expected one winner and one conflict");
    const losingInput = leftWon ? right : left;
    expect(rejected.reason).toMatchObject({
      statusCode: 409,
      errorCode: "notebook_conflict",
      details: {
        receipt: {
          opId: losingInput.opId,
          status: "conflict",
          eventSeq: "3",
          reason: "cell_changed",
        },
      },
    });
    const error: unknown = rejected.reason;
    if (!isActionContractError(error)) throw error;
    const receipt = operationReceiptSchema.parse(error.details?.receipt);
    const found = { status: "found", receipt };
    expect(await readReceipt(projectId, losingInput.opId)).toEqual(found);
    const details = { receipt };
    await expect(apply(losingInput)).rejects.toMatchObject({ details });
    const fresh = await readSnapshot(projectId);
    expect(fresh.snapshot.head.revision).toBe("3");
    expect(getCell(fresh, alpha).contents).toMatchObject({
      source: leftWon ? "alpha = 43" : "alpha = 44",
    });
    expect(await readJournal(projectId, "2")).toMatchObject({
      events: [{ sequence: "3", receipt: accepted.value }],
    });
  });

  it("rejects receipt, journal and replay access for unrelated and other-workspace callers", async () => {
    const { projectId, snapshot, alpha } = await fixture();
    const input = command(snapshot, setCode(snapshot, alpha, "alpha = 42"));
    await apply(input);
    const calls = [
      ["get-notebook-operation", { projectId, opId: input.opId }],
      ["list-notebook-changes", { projectId, after: "0" }],
      ["apply-notebook-operation", input],
    ] as const;
    for (const [email, workspace] of [
      [unrelated, orgId],
      [owner, otherOrgId],
    ] as const) {
      for (const [name, args] of calls) {
        await expect(
          invoke(name, args, email, workspace),
        ).rejects.toMatchObject({
          errorCode: "project_not_found",
        });
      }
    }
  });

  it("places an insertion in its exact gap and rejects the occupied anchor pair", async () => {
    const { projectId, snapshot, alpha, beta } = await fixture();
    const cellId = randomUUID();
    const insert = {
      type: "insert",
      cellId,
      gap: { afterCellId: alpha, beforeCellId: beta },
      expectedOrderRevision: snapshot.resources.orderRevision,
      contents: { kind: "text", label: null, text: "Reporting notes" },
    };
    await apply(command(snapshot, insert));
    const current = await readSnapshot(projectId);
    expect(current.cells.map(({ id }) => id)).toEqual([alpha, cellId, beta]);
    const staleGap = {
      ...insert,
      cellId: randomUUID(),
      expectedOrderRevision: current.resources.orderRevision,
    };
    await expect(apply(command(current, staleGap))).rejects.toMatchObject({
      errorCode: "notebook_conflict",
      details: { receipt: { reason: "stale_anchor" } },
    });
    expect(await readSnapshot(projectId)).toEqual(current);
  });

  it("rolls back an invalid batch and records a no-change receipt without advancing the head", async () => {
    const { projectId, snapshot, alpha } = await fixture();
    const invalid = command(snapshot, setCode(snapshot, alpha, "alpha = 42"), {
      type: "set-text",
      cellId: alpha,
      expectedRevision: getCell(snapshot, alpha).revision,
      text: "Invalid cell kind",
    });
    await expect(apply(invalid)).rejects.toMatchObject({
      errorCode: "notebook_invalid_change",
    });
    expect(await readSnapshot(projectId)).toEqual(snapshot);
    const absent = { status: "absent", reason: "not_found" };
    expect(await readReceipt(projectId, invalid.opId)).toEqual(absent);
    const unchanged = command(snapshot, setCode(snapshot, alpha, "alpha = 1"));
    const receipt = await apply(unchanged);
    expect(receipt).toMatchObject({
      status: "no_change",
      previousHead: snapshot.snapshot.head,
      nextHead: snapshot.snapshot.head,
      eventSeq: "0",
    });
    const found = { status: "found", receipt };
    expect(await readReceipt(projectId, unchanged.opId)).toEqual(found);
    const journal = await readJournal(projectId);
    expect(journal).toMatchObject({ cursor: "0", events: [], hasMore: false });
  });

  it("retains a deletion tombstone and fences a previously admitted output", async () => {
    const { projectId, snapshot, alpha } = await fixture();
    const oldGeneration = randomUUID();
    await getDb().transaction((tx) =>
      reserveCellOutputGeneration(projectId, alpha, oldGeneration, tx),
    );
    const receipt = await apply(
      command(snapshot, {
        type: "delete",
        cellId: alpha,
        expectedRevision: getCell(snapshot, alpha).revision,
        expectedOrderRevision: snapshot.resources.orderRevision,
      }),
    );
    const tombstones = await getDb()
      .select()
      .from(schema.notebookTombstones)
      .where(eq(schema.notebookTombstones.projectId, projectId))
      .limit(2);
    expect(tombstones).toMatchObject([
      {
        cellId: alpha,
        revision: 1n,
        versionId: snapshot.snapshot.head.versionId,
      },
    ]);
    expect(receipt).toMatchObject({
      delta: { tombstones: [{ cellId: alpha }] },
    });
    const [tombstone] = tombstones;
    expect(tombstone?.outputGeneration).not.toBe(oldGeneration);
    await expect(
      getDb().transaction((tx) =>
        lockCellOutputGeneration(projectId, alpha, oldGeneration, tx),
      ),
    ).rejects.toBeInstanceOf(CellOutputGenerationConflict);
    expect(
      (await readSnapshot(projectId)).cells.map(({ id }) => id),
    ).not.toContain(alpha);
  });

  it("pages journal cursors in sequence and returns an expired cursor across a gap", async () => {
    const { projectId, snapshot, alpha } = await fixture();
    await apply(command(snapshot, setCode(snapshot, alpha, "alpha = 42")));
    const current = await readSnapshot(projectId);
    await apply(command(current, setCode(current, alpha, "alpha = 43")));
    expect(await readJournal(projectId, "0", 1)).toMatchObject({
      status: "ok",
      events: [{ sequence: "1" }],
      cursor: "1",
      hasMore: true,
    });
    expect(await readJournal(projectId, "1", 1)).toMatchObject({
      status: "ok",
      events: [{ sequence: "2" }],
      cursor: "2",
      hasMore: false,
    });
    await getDb()
      .delete(schema.notebookEvents)
      .where(
        and(
          eq(schema.notebookEvents.projectId, projectId),
          eq(schema.notebookEvents.eventSeq, 1n),
        ),
      );
    const expired = { status: "expired", cursor: "2" };
    expect(await readJournal(projectId)).toEqual(expired);
    expect(await readJournal(projectId, "3")).toEqual(expired);
    expect((await readSnapshot(projectId)).snapshot.eventSeq).toBe("2");
  });
});

it("upgrades a v15 notebook and adopts its collision-resolved legacy layout on first open", async () => {
  await initializeDatabase("upgrade");
  await runMigrations(
    analyticsMigrations.filter(({ version }) => version <= 15),
    {
      table: "analytics2_migrations",
    },
  )(null);
  const projectId = randomUUID();
  const versionId = randomUUID();
  const cellId = randomUUID();
  const overlapId = randomUUID();
  const now = "2026-11-18T00:00:00.000Z";
  const legacy = { gridX: 2, gridY: 0, gridWidth: 8, gridHeight: 2 };
  const contents = JSON.stringify({
    ...codeCell(cellId, "alpha = 1"),
    ...legacy,
    order: "i",
  });
  const overlap = JSON.stringify({
    ...codeCell(overlapId, "beta = 2"),
    ...legacy,
    order: "j",
  });
  await getDbExec().execute(sql`
    INSERT INTO analytics2_projects (id, owner_email, org_id, title, working_version_id, created_at, updated_at)
    VALUES (${sql.value(projectId)}, ${sql.value(owner)}, ${sql.value(orgId)}, 'Existing notebook', ${sql.value(versionId)}, ${sql.value(now)}, ${sql.value(now)})
  `);
  await getDbExec().execute(sql`
    INSERT INTO analytics2_project_versions (id, project_id, number, created_at, created_by)
    VALUES (${sql.value(versionId)}, ${sql.value(projectId)}, '1', ${sql.value(now)}, ${sql.value(owner)})
  `);
  await getDbExec().execute(sql`
    INSERT INTO analytics2_cells (id, project_id, version_id, kind, "order", contents, created_at, updated_at)
    VALUES (${sql.value(cellId)}, ${sql.value(projectId)}, ${sql.value(versionId)}, 'code', 'i', ${sql.value(contents)}, ${sql.value(now)}, ${sql.value(now)}),
           (${sql.value(overlapId)}, ${sql.value(projectId)}, ${sql.value(versionId)}, 'code', 'j', ${sql.value(overlap)}, ${sql.value(now)}, ${sql.value(now)})
  `);
  await runAnalyticsMigrations(null);
  const pending = await invoke("get-notebook-snapshot", { projectId });
  expect(pending).toMatchObject({ status: "pending" });
  const legacyDraft = await readAppProject(projectId);
  const invalidLayout = {
    protocol: 1,
    projectId,
    workingVersionId: versionId,
    observedHead: legacyDraft.draftHead,
    opId: randomUUID(),
    changes: [
      {
        type: "set-app",
        expectedLayoutRevision: "0",
        patches: [{ type: "tab-rename", tabId: "missing", name: "Missing" }],
      },
    ],
  };
  await expect(setApp(invalidLayout)).rejects.toMatchObject({
    errorCode: "app_layout_invalid",
  });
  expect(await invoke("get-notebook-snapshot", { projectId })).toEqual(pending);
  await adoptNotebook(scope, projectId);
  const initial = await readSnapshot(projectId);
  expect(initial.snapshot.head).toEqual({ versionId, revision: "0" });
  expect(initial.metadata.title).toBe("Existing notebook");
  const originalContents = getCell(initial, cellId).contents;
  expect(originalContents).toMatchObject({ source: "alpha = 1", order: "i" });
  const rename = {
    type: "set-metadata",
    expectedMetadataRevision: initial.resources.metadataRevision,
    metadata: { title: "Renamed notebook" },
  };
  await apply(command(initial, setCode(initial, cellId, "alpha = 42"), rename));
  const fresh = await readSnapshot(projectId);
  expect(fresh.snapshot.head).toEqual({ versionId, revision: "1" });
  expect(fresh.metadata.title).toBe("Renamed notebook");
  const savedContents = getCell(fresh, cellId).contents;
  expect(savedContents).toEqual({ ...originalContents, source: "alpha = 42" });
  const journal = await readJournal(projectId);
  expect(journal).toMatchObject({ cursor: "1", events: [{ sequence: "1" }] });
  const beforeAdoption = await getDb()
    .select()
    .from(schema.appLayouts)
    .where(eq(schema.appLayouts.projectId, projectId))
    .limit(1);
  expect(beforeAdoption).toEqual([]);
  await setApp(
    command(fresh, {
      type: "set-app",
      expectedLayoutRevision: "0",
      patches: [{ type: "initialize" }],
    }),
  );
  const cold = await readAppProject(projectId);
  expect(cold.appLayout).toMatchObject({
    initialized: true,
    revision: "2",
    tabs: [
      {
        rows: [
          {
            columns: [
              { left: 20, right: 100, elements: [{ cellId, heightPx: 240 }] },
            ],
          },
          {
            columns: [
              {
                left: 20,
                right: 100,
                elements: [{ cellId: overlapId, heightPx: 240 }],
              },
            ],
          },
        ],
      },
    ],
  });
  await expect(
    invoke("save-project-cell", {
      projectId,
      cellId,
      contents: { ...savedContents, gridX: 4 },
    }),
  ).rejects.toMatchObject({ errorCode: "layout_changed" });
  expect((await readAppProject(projectId)).appLayout).toEqual(cold.appLayout);
});
