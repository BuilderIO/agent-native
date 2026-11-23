import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { fail } from "@agent-native/core/action";
import {
  and,
  eq,
  inArray,
  isNull,
  or,
  sql,
} from "@agent-native/core/db/schema";
import { z } from "zod";

import { notebookMessages } from "../../../app/i18n/messages/notebook.js";
import {
  cellContentsSchema,
  withoutPendingCellEdit,
  type CellDraft,
} from "../../../app/lib/model/contracts.js";
import {
  isValidOrderKey,
  orderForInsertion,
} from "../../../app/lib/model/order.js";
import {
  AppLayoutError,
  draftAppLayout,
  pruneAppLayout,
} from "../../../shared/app-layout.js";
import {
  resultIdSchema,
  runInvalidationSchema,
  runReceiptSchema,
  runRequestSchema,
} from "../../../shared/notebook-execution.js";
import {
  appliedReceiptSchema,
  notebookCellSchema,
  notebookMetadataSchema,
  notebookResourcesSchema,
  notebookSnapshotSchema,
  notebookTableRunSchema,
  notebookTombstoneSchema,
  operationReceiptSchema,
  type NotebookCell,
  type NotebookEvent,
  type OperationReceipt,
  type NotebookSnapshot,
} from "../../../shared/notebook-operations.js";
import {
  authorizedNotebookSnapshotRefSchema,
  CONTRACT_VERSION,
  draftHeadSchema,
  notebookCommandImpactSchema,
  notebookProjectIdSchema,
  outputFenceSchema,
  revisionSchema,
} from "../../../shared/notebook-snapshot-contract.js";
import type { QueryNotebookTableInput } from "../../../shared/notebook-table-query.js";
import type { NotebookUndoRequest } from "../../../shared/notebook-undo.js";
import type { WarehouseTableProvenance } from "../../../shared/warehouse-table.js";
import { getDb, schema } from "../../db/index.js";
import {
  assertGrantedDataConnection,
  assertValidCellConnection,
} from "../../lib/project-action-access.js";
import { readAppDocument, writeAppDocument } from "../app-layouts.js";
import {
  restoreDeletedCellOutput,
  retainDeletedCellOutput,
} from "../cell-output-undo.js";
import { nowIso } from "../clock.js";
import { ensureAnalyticsDatabase } from "../database.js";
import { sweepDataframeBlobsAfterWrite } from "../dataframe-lifecycle.js";
import { newId } from "../ids.js";
import {
  decodeJsonColumn,
  encodeJsonColumn,
  StoredDataError,
} from "../json-column.js";
import { inputOptionsPointer } from "../notebook-execution/input-choices.js";
import { executionContents } from "../notebook-execution/planner.js";
import {
  consumeReactiveInputs,
  enqueueReactiveInputs,
} from "../notebook-execution/reactive.js";
import {
  createRunStore,
  invalidateNotebookRunOutputs,
  lockNotebookRunOutputs,
} from "../notebook-execution/run-store.js";
import { notebookRuns } from "../notebook-execution/schema.js";
import {
  draftNamespace,
  readCurrentDraftSnapshot,
  readDraftSnapshot,
  type ExecutionActor,
} from "../notebook-execution/snapshot.js";
import { readNotebookResultChoices } from "../notebook-results.js";
import { getReadableProjectRow, type ProjectRow } from "../project-access.js";
import { canEditProject, projectAccessLevel } from "../project-grant-access.js";
import { settledWarehouseOutputGeneration } from "../project-query.js";
import {
  lockCellOutputForEdit,
  reserveCellOutputGeneration,
} from "../runs-store.js";
import type { Queryable, WorkspaceScope } from "../scope.js";
import {
  NotebookConflict,
  NotebookInvalidChange,
  notebookCellChanges,
  planNotebookCommand,
  type NotebookWriteCommand,
} from "./commands.js";
import { adoptNotebook } from "./migration.js";
import {
  inverseCells,
  inversePlan,
  isUndoable,
  resourceRevisions,
} from "./undo-plan.js";
import {
  advanceUndoEntry,
  readUndoEntry,
  readUndoEquivalences,
  recordUndoEntry,
  undoOrigin,
} from "./undo-store.js";

const { notebook: copy } = notebookMessages;

const {
  projects,
  cells,
  statuses,
  cellOutputs,
  notebookReceipts,
  notebookEvents,
  notebookTombstones,
} = schema;
export const notebookPending = {
  status: "pending",
  reason: "not_ready",
} as const;

export function notebookBusy(): never {
  return fail(copy.saveFailed, { statusCode: 409, errorCode: "notebook_busy" });
}

export function notebookUnavailable(): never {
  return fail(copy.loadFailed, {
    statusCode: 404,
    errorCode: "project_not_found",
  });
}

export function projectScopeFilter(scope: WorkspaceScope, projectId: string) {
  return and(
    eq(projects.id, projectId),
    eq(projects.orgId, scope.orgId),
    isNull(projects.trashedAt),
  );
}

export async function lockNotebookProject(
  scope: WorkspaceScope,
  projectId: string,
  tx: Queryable,
  mode: "share" | "update",
) {
  const [project] = await tx
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.orgId, scope.orgId),
        isNull(projects.trashedAt),
      ),
    )
    .limit(1)
    .for(mode);
  if (
    !project ||
    !canEditProject(await projectAccessLevel(scope, project, [], tx))
  ) {
    notebookUnavailable();
  }
  return project;
}

async function readableDraft(scope: WorkspaceScope, projectId: string) {
  await ensureAnalyticsDatabase();
  const project = await getReadableProjectRow(scope, projectId);
  if (
    !project ||
    project.trashedAt !== null ||
    !canEditProject(await projectAccessLevel(scope, project))
  ) {
    notebookUnavailable();
  }
  return project;
}

const isAdopted = (project: ProjectRow) =>
  project.notebookVersionId === project.workingVersionId;
const draftCells = (project: ProjectRow) =>
  and(
    eq(cells.projectId, project.id),
    eq(cells.versionId, project.workingVersionId),
  );

export async function readNotebookCells(project: ProjectRow, tx: Queryable) {
  const rows = await tx
    .select()
    .from(cells)
    .where(draftCells(project))
    .orderBy(cells.order, cells.id);
  return rows.map((row) => {
    const contents = decodeJsonColumn(row.contents, cellContentsSchema);
    if (contents === null || contents.id !== row.id)
      throw new StoredDataError(copy.savedContentFailed);
    return notebookCellSchema.parse({
      id: row.id,
      projectId: row.projectId,
      versionId: row.versionId,
      contents,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      revision: row.notebookRevision.toString(),
      labelRevision: row.notebookLabelRevision.toString(),
    });
  });
}

function head(project: ProjectRow) {
  return draftHeadSchema.parse({
    versionId: project.workingVersionId,
    revision: project.notebookRevision.toString(),
  });
}

export function snapshotRef(scope: WorkspaceScope, project: ProjectRow) {
  return authorizedNotebookSnapshotRefSchema.parse({
    workspaceId: scope.orgId,
    projectId: project.id,
    head: head(project),
    eventSeq: project.notebookEventSeq.toString(),
  });
}

function metadata(project: ProjectRow) {
  return notebookMetadataSchema.parse({
    title: project.title,
    description: project.description,
    statusId: project.statusId,
  });
}

function resources(project: ProjectRow) {
  return notebookResourcesSchema.parse({
    orderRevision: project.notebookOrderRevision.toString(),
    metadataRevision: project.notebookMetadataRevision.toString(),
    inputRevision: project.notebookInputRevision.toString(),
    layoutRevision: project.notebookLayoutRevision.toString(),
  });
}

function acceptedCell(cell: NotebookCell) {
  return { ...cell, contents: withoutPendingCellEdit(cell.contents) };
}

export async function projectSnapshot(
  scope: WorkspaceScope,
  project: ProjectRow,
  tx: Queryable,
  draft?: NotebookCell[],
): Promise<NotebookSnapshot> {
  const cells = (draft ?? (await readNotebookCells(project, tx))).map(
    acceptedCell,
  );
  const appLayout = await readAppDocument(
    tx,
    scope.orgId,
    project.id,
    project.workingVersionId,
  );
  return notebookSnapshotSchema.parse({
    status: "accepted",
    snapshot: snapshotRef(scope, project),
    metadata: metadata(project),
    resources: resources(project),
    cells,
    appLayout: appLayout
      ? pruneAppLayout(appLayout, cells)
      : draftAppLayout(cells, resources(project).layoutRevision),
  });
}

export async function readNotebookDraft(
  scope: WorkspaceScope,
  projectId: string,
) {
  await ensureAnalyticsDatabase();
  return getDb().transaction(async (tx) => {
    const project = await lockNotebookProject(scope, projectId, tx, "share");
    if (!isAdopted(project)) return null;
    const cells = await readNotebookCells(project, tx);
    return {
      project,
      cells,
      notebook: await projectSnapshot(scope, project, tx, cells),
    };
  });
}

export async function readNotebookSnapshot(
  scope: WorkspaceScope,
  projectId: string,
) {
  return (
    (await readNotebookDraft(scope, projectId))?.notebook ?? notebookPending
  );
}

function receiptKey(scope: WorkspaceScope, projectId: string, opId: string) {
  return { orgId: scope.orgId, projectId, principalId: scope.ownerEmail, opId };
}

async function readReceipt(tx: Queryable, key: ReturnType<typeof receiptKey>) {
  const [row] = await tx
    .select()
    .from(notebookReceipts)
    .where(
      and(
        eq(notebookReceipts.orgId, key.orgId),
        eq(notebookReceipts.projectId, key.projectId),
        eq(notebookReceipts.principalId, key.principalId),
        eq(notebookReceipts.opId, key.opId),
      ),
    )
    .limit(1);
  return row;
}

export async function readNotebookOperation(
  scope: WorkspaceScope,
  projectId: string,
  opId: string,
) {
  await ensureAnalyticsDatabase();
  return getDb().transaction(async (tx) => {
    await lockNotebookProject(scope, projectId, tx, "share");
    const row = await readReceipt(tx, receiptKey(scope, projectId, opId));
    return row
      ? {
          status: "found" as const,
          receipt: operationReceiptSchema.parse(row.receipt),
        }
      : { status: "absent" as const, reason: "not_found" as const };
  });
}

type NotebookOperation = NotebookWriteCommand | NotebookUndoRequest;

async function evaluate(
  tx: Queryable,
  scope: WorkspaceScope,
  project: ProjectRow,
  operation: NotebookOperation,
  committedAt: string,
) {
  const command: NotebookWriteCommand =
    "changes" in operation
      ? operation
      : {
          protocol: CONTRACT_VERSION,
          projectId: operation.projectId,
          workingVersionId: operation.workingVersionId,
          observedHead: head(project),
          opId: operation.opId,
          originId: operation.originId,
          changes: [],
        };
  if (
    command.workingVersionId !== project.workingVersionId ||
    command.observedHead.versionId !== project.workingVersionId
  ) {
    return { status: "conflict" as const, reason: "lineage_changed" as const };
  }
  if (BigInt(command.observedHead.revision) > project.notebookRevision) {
    return { status: "conflict" as const, reason: "head_ahead" as const };
  }
  const origin =
    command.originId === undefined
      ? undefined
      : undoOrigin(
          scope,
          project.id,
          project.workingVersionId,
          command.originId,
        );
  const entry =
    "direction" in operation && origin
      ? await readUndoEntry(tx, origin, operation.direction)
      : undefined;
  if ("direction" in operation && !entry)
    return { status: "no_change" as const };
  const candidates = [
    ...notebookCellChanges(command).flatMap((change) =>
      change.type === "insert" ||
      change.type === "insert-legacy" ||
      change.type === "group-section" ||
      change.type === "duplicate"
        ? [change.cellId]
        : [],
    ),
    ...(entry
      ? inverseCells(entry.plan).flatMap(({ id, expected }) =>
          expected ? [] : [id],
        )
      : []),
  ];
  const reserved =
    candidates.length === 0
      ? []
      : await tx
          .select({
            cellId: notebookTombstones.cellId,
            versionId: notebookTombstones.versionId,
            revision: notebookTombstones.revision,
            outputGeneration: notebookTombstones.outputGeneration,
          })
          .from(notebookTombstones)
          .where(
            and(
              eq(notebookTombstones.projectId, project.id),
              inArray(notebookTombstones.cellId, candidates),
            ),
          );
  const metadataOnly =
    !entry && command.changes.every((change) => change.type === "set-metadata");
  const before = metadataOnly ? [] : await readNotebookCells(project, tx);
  const revision = revisionSchema.parse(
    (project.notebookRevision + 1n).toString(),
  );
  const tombstones = reserved.map((row) =>
    notebookTombstoneSchema.parse({
      ...row,
      revision: row.revision.toString(),
    }),
  );
  const currentResources = resources(project);
  const currentRevisions = entry
    ? resourceRevisions({
        cells: before,
        resources: currentResources,
        tombstones,
      })
    : undefined;
  const undo =
    entry && origin && currentRevisions
      ? {
          entry,
          origin,
          equivalent: await readUndoEquivalences(
            tx,
            origin,
            entry.plan,
            currentRevisions,
          ),
          currentRevisions,
        }
      : undefined;
  try {
    const plan = planNotebookCommand(
      command,
      {
        cells: before,
        metadata: metadata(project),
        resources: currentResources,
        tombstones: new Map(reserved.map((row) => [row.cellId, row])),
        appLayout: metadataOnly
          ? null
          : await readAppDocument(
              tx,
              scope.orgId,
              project.id,
              project.workingVersionId,
            ),
      },
      revision,
      committedAt,
      undo && {
        plan: undo.entry.plan,
        currentRevisions: undo.currentRevisions,
        equivalent: undo.equivalent,
      },
    );
    const authorDefaultTitle =
      project.untitledOrdinal !== null &&
      command.changes.some(
        (change) =>
          change.type === "set-metadata" && change.metadata.title !== undefined,
      );
    return plan.changed || authorDefaultTitle
      ? {
          status: "applied" as const,
          before,
          plan,
          revision,
          command,
          tombstones,
          undo,
          origin,
          authorDefaultTitle,
        }
      : { status: "no_change" as const };
  } catch (error) {
    if (error instanceof NotebookConflict)
      return { status: "conflict" as const, reason: error.reason };
    if (error instanceof NotebookInvalidChange)
      return { status: "invalid" as const };
    if (error instanceof AppLayoutError)
      return { status: "invalid_layout" as const };
    throw error;
  }
}

function writeCell(tx: Queryable, row: NotebookCell, exists: boolean) {
  const { contents } = row;
  const values = {
    kind: contents.kind,
    order: contents.order,
    label: contents.label,
    hidden: contents.hidden,
    gridX: contents.gridX,
    gridY: contents.gridY,
    gridWidth: contents.gridWidth,
    gridHeight: contents.gridHeight,
    contents: encodeJsonColumn(contents),
    updatedAt: row.updatedAt,
    notebookRevision: BigInt(row.revision),
    notebookLabelRevision: BigInt(row.labelRevision),
  };
  return exists
    ? tx
        .update(cells)
        .set(values)
        .where(
          and(
            eq(cells.projectId, row.projectId),
            eq(cells.versionId, row.versionId),
            eq(cells.id, row.id),
          ),
        )
    : tx.insert(cells).values({
        ...values,
        id: row.id,
        projectId: row.projectId,
        versionId: row.versionId,
        createdAt: row.createdAt,
      });
}

export async function writeNotebookVersionCells(
  tx: Queryable,
  version: { projectId: string; versionId: string },
  drafts: readonly CellDraft[],
  at: string,
  afterOrder: string | null = null,
): Promise<NotebookCell[]> {
  const revision = revisionSchema.parse("0");
  let previousOrder = afterOrder;
  const written: NotebookCell[] = [];
  for (const draft of drafts) {
    const order =
      draft.order !== undefined && isValidOrderKey(draft.order)
        ? draft.order
        : orderForInsertion(previousOrder === null ? [] : [previousOrder], 1);
    const id = draft.id || newId("cel");
    const contents = cellContentsSchema.parse({ ...draft, id, order });
    const cell = {
      ...version,
      id,
      contents,
      createdAt: at,
      updatedAt: at,
      revision,
      labelRevision: revision,
    };
    await writeCell(tx, cell, false);
    written.push(cell);
    previousOrder = order;
  }
  return written;
}

type VersionOperation = { opId: string; fingerprint: string };

export async function readNotebookVersionOperation(
  tx: Queryable,
  scope: WorkspaceScope,
  projectId: string,
  operation: VersionOperation,
) {
  const prior = await readReceipt(
    tx,
    receiptKey(scope, projectId, operation.opId),
  );
  if (!prior) return null;
  if (prior.fingerprint !== operation.fingerprint)
    fail(copy.saveFailed, {
      statusCode: 409,
      errorCode: "operation_id_reused",
    });
  return appliedReceiptSchema.parse(prior.receipt);
}

async function recordVersionOperation(
  tx: Queryable,
  scope: WorkspaceScope,
  projectId: string,
  operation: VersionOperation,
  event: NotebookEvent,
) {
  await tx.insert(notebookEvents).values({
    projectId,
    eventSeq: BigInt(event.sequence),
    event,
  });
  await tx.insert(notebookReceipts).values({
    ...receiptKey(scope, projectId, operation.opId),
    fingerprint: operation.fingerprint,
    receipt: event.receipt,
  });
}

export async function recordNotebookCheckpoint(
  tx: Queryable,
  scope: WorkspaceScope,
  project: ProjectRow,
  versionId: string,
  operation: VersionOperation,
  committedAt: string,
) {
  const notebookEventSeq = project.notebookEventSeq + 1n;
  const snapshot = snapshotRef(scope, { ...project, notebookEventSeq });
  const delta = { cells: [], tombstones: [], resources: resources(project) };
  const receipt = appliedReceiptSchema.parse({
    status: "applied",
    opId: operation.opId,
    previousHead: snapshot.head,
    nextHead: snapshot.head,
    eventSeq: snapshot.eventSeq,
    committedAt,
    versionChange: { type: "checkpoint", versionId },
    impact: {
      opId: operation.opId,
      previousHead: snapshot.head,
      snapshot,
      changedCellIds: [],
      invalidatedOutputs: [],
    },
    delta,
  });
  const [updated] = await tx
    .update(projects)
    .set({ notebookEventSeq })
    .where(projectScopeFilter(scope, project.id))
    .returning({ id: projects.id });
  if (!updated) throw new StoredDataError(copy.savedContentFailed);
  await recordVersionOperation(tx, scope, project.id, operation, {
    sequence: snapshot.eventSeq,
    principalId: scope.ownerEmail,
    before: delta,
    receipt,
    invalidations: [],
    runIntent: null,
  });
  return receipt;
}

export async function installNotebookLineage(
  tx: Queryable,
  scope: WorkspaceScope,
  project: ProjectRow,
  versionId: string,
  sourceVersionId: string,
  previousCells: NotebookCell[],
  nextCells: readonly NotebookCell[],
  affectedIds: readonly string[],
  committedAt: string,
  operation?: VersionOperation,
) {
  const revision = revisionSchema.parse(
    (project.notebookRevision + 1n).toString(),
  );
  const next = {
    ...project,
    workingVersionId: versionId,
    notebookVersionId: versionId,
    notebookRevision: BigInt(revision),
    notebookEventSeq: project.notebookEventSeq + 1n,
    notebookOrderRevision: BigInt(revision),
    notebookInputRevision: BigInt(revision),
    notebookLayoutRevision: BigInt(revision),
    updatedAt: committedAt,
    userUpdatedAt: committedAt,
  };
  const restored = nextCells.map((cell) => ({
    ...cell,
    versionId,
    revision,
    labelRevision: revision,
  }));
  for (const cell of restored) await writeCell(tx, cell, false);
  const previousLayout = await readAppDocument(
    tx,
    scope.orgId,
    project.id,
    project.workingVersionId,
  );
  const sourceLayout =
    sourceVersionId === project.workingVersionId
      ? previousLayout
      : await readAppDocument(tx, scope.orgId, project.id, sourceVersionId);
  const appLayout = sourceLayout
    ? { ...pruneAppLayout(sourceLayout, restored), revision }
    : draftAppLayout(restored, revision);
  if (sourceLayout)
    await writeAppDocument(tx, scope.orgId, project.id, versionId, appLayout);
  const fences = [];
  for (const cellId of affectedIds) {
    const outputGeneration = randomUUID();
    await reserveCellOutputGeneration(project.id, cellId, outputGeneration, tx);
    fences.push(outputFenceSchema.parse({ cellId, outputGeneration }));
  }
  await tx
    .delete(cellOutputs)
    .where(
      and(
        eq(cellOutputs.projectId, project.id),
        inArray(cellOutputs.status, ["queued", "running"]),
      ),
    );
  await tx
    .update(projects)
    .set({
      workingVersionId: versionId,
      notebookVersionId: versionId,
      notebookRevision: next.notebookRevision,
      notebookEventSeq: next.notebookEventSeq,
      notebookOrderRevision: next.notebookOrderRevision,
      notebookInputRevision: next.notebookInputRevision,
      notebookLayoutRevision: next.notebookLayoutRevision,
      updatedAt: committedAt,
      userUpdatedAt: committedAt,
    })
    .where(projectScopeFilter(scope, project.id));
  const operationId = operation?.opId ?? randomUUID();
  const snapshot = snapshotRef(scope, next);
  const impact = notebookCommandImpactSchema.parse({
    opId: operationId,
    previousHead: head(project),
    snapshot,
    changedCellIds: affectedIds,
    invalidatedOutputs: fences,
  });
  const receipt = appliedReceiptSchema.parse({
    status: "applied",
    opId: operationId,
    previousHead: impact.previousHead,
    nextHead: snapshot.head,
    eventSeq: snapshot.eventSeq,
    committedAt,
    ...(operation
      ? { versionChange: { type: "restore", versionId: sourceVersionId } }
      : {}),
    impact,
    delta: {
      cells: restored.map(acceptedCell),
      tombstones: [],
      resources: resources(next),
      appLayout,
    },
  });
  const event: NotebookEvent = {
    sequence: snapshot.eventSeq,
    principalId: scope.ownerEmail,
    before: {
      cells: previousCells.map(acceptedCell),
      tombstones: [],
      resources: resources(project),
      appLayout: previousLayout
        ? pruneAppLayout(previousLayout, previousCells)
        : draftAppLayout(previousCells, resources(project).layoutRevision),
    },
    receipt,
    invalidations: fences.length
      ? [
          runInvalidationSchema.parse({
            snapshot: snapshotRef(scope, project),
            namespace: draftNamespace(scope, project.id),
            inputRevision: resources(project).inputRevision,
            cause: "restore",
            outputs: fences,
          }),
        ]
      : [],
    runIntent: null,
  };
  for (const invalidation of event.invalidations)
    await invalidateNotebookRunOutputs(tx, invalidation);
  await consumeReactiveInputs(tx, project.id);
  await recordVersionOperation(
    tx,
    scope,
    project.id,
    operation ?? {
      opId: operationId,
      fingerprint: createHash("sha256")
        .update(JSON.stringify({ versionId, affectedIds }))
        .digest("hex"),
    },
    event,
  );
  return next;
}

type Accepted = Extract<
  Awaited<ReturnType<typeof evaluate>>,
  { status: "applied" }
>;

function choiceWrites(
  command: NotebookWriteCommand,
  { before, plan, undo }: Accepted,
) {
  if (undo) return [];
  const previous = new Map(before.map(({ id, contents }) => [id, contents]));
  return plan.cells.flatMap(({ id, contents }, index) => {
    if (
      contents.kind !== "input" ||
      (contents.inputType !== "DROPDOWN" &&
        contents.inputType !== "MULTISELECT")
    )
      return [];
    const prior = previous.get(id);
    if (
      prior?.kind === "input" &&
      prior.defaultValueString === contents.defaultValueString &&
      isDeepStrictEqual(prior.dynamicOptions, contents.dynamicOptions) &&
      isDeepStrictEqual(prior.options, contents.options)
    )
      return [];
    const dynamic = contents.dynamicOptions;
    if (
      dynamic &&
      !plan.cells
        .slice(0, index)
        .some(
          ({ id, contents }) =>
            id === dynamic.producerCellId &&
            (contents.kind === "sql" || contents.kind === "code"),
        )
    )
      fail(copy.inputChoices.missing, {
        statusCode: 422,
        errorCode: "input_options_source_invalid",
      });
    const proof = [...command.changes]
      .reverse()
      .find(
        (change) =>
          (change.type === "set-input-default" ||
            change.type === "save-legacy") &&
          change.cellId === id &&
          change.optionsResultId !== undefined,
      );
    const resultId =
      proof && "optionsResultId" in proof ? proof.optionsResultId : undefined;
    return [{ contents, dynamic, resultId }];
  });
}

type ChoiceWrite = ReturnType<typeof choiceWrites>[number];

function choiceValues({ contents }: ChoiceWrite) {
  const value = contents.defaultValueString;
  if (value === "" || value === "null") return [];
  return contents.inputType === "MULTISELECT"
    ? z.array(z.string()).parse(JSON.parse(value))
    : [value];
}

function choiceProofKey({ dynamic, resultId }: ChoiceWrite) {
  return JSON.stringify([
    resultId,
    dynamic?.valueFieldId,
    dynamic?.displayFieldId,
  ]);
}

function inputOptionNotAllowed(): never {
  return fail(copy.inputChoices.removed, {
    statusCode: 422,
    errorCode: "input_option_not_allowed",
  });
}

function commandSources(
  command: NotebookWriteCommand,
  { before, plan }: Accepted,
) {
  const connectionIds = new Set<string>();
  for (const change of notebookCellChanges(command)) {
    const id =
      change.type === "set-source"
        ? change.dataConnectionId
        : (change.type === "insert" || change.type === "insert-legacy") &&
            change.contents.kind === "sql"
          ? change.contents.dataConnectionId
          : null;
    if (id !== null) connectionIds.add(id);
  }
  const previous = new Map(before.map(({ id, contents }) => [id, contents]));
  for (const row of plan.cells) {
    const contents = row.contents;
    const old = previous.get(row.id);
    if (
      contents.kind === "sql" &&
      (old?.kind !== "sql" ||
        old.source !== contents.source ||
        old.dataConnectionId !== contents.dataConnectionId ||
        old.databaseSchema !== contents.databaseSchema ||
        old.connectionMode !== contents.connectionMode)
    ) {
      assertValidCellConnection(contents);
      if (contents.dataConnectionId !== null)
        connectionIds.add(contents.dataConnectionId);
    }
  }
  return connectionIds;
}

async function commitChanges(
  tx: Queryable,
  scope: WorkspaceScope,
  project: ProjectRow,
  committedAt: string,
  accepted: Accepted,
) {
  const { command, before, plan, revision, undo, origin, authorDefaultTitle } =
    accepted;
  const { opId, changes } = command;
  const previous = new Map(before.map((row) => [row.id, row]));
  const current = new Map(plan.cells.map((row) => [row.id, row]));
  const updated = plan.cells.filter((row) => previous.get(row.id) !== row);
  const deleted = before.filter((row) => !current.has(row.id));
  const restored = new Set<string>(
    accepted.tombstones.flatMap(({ cellId }) =>
      !previous.has(cellId) && current.has(cellId) ? [cellId] : [],
    ),
  );
  const sqlSelection = updated
    .flatMap<NonNullable<ProjectRow["notebookLastSqlSource"]>>(
      ({ id, contents }) => {
        if (contents.kind !== "sql" || (undo && restored.has(id))) return [];
        const prior = previous.get(id)?.contents;
        if (
          prior?.kind === "sql" &&
          prior.connectionSelectedAt === contents.connectionSelectedAt
        )
          return [];
        if (contents.connectionMode === "dataframes")
          return [{ kind: "dataframes" } as const];
        return contents.dataConnectionId
          ? [
              {
                kind: "warehouse",
                connectionId: contents.dataConnectionId,
              } as const,
            ]
          : [];
      },
    )
    .at(-1);
  const metadataChanged =
    authorDefaultTitle || !isDeepStrictEqual(metadata(project), plan.metadata);
  if (
    metadataChanged &&
    plan.metadata.statusId !== project.statusId &&
    plan.metadata.statusId !== null
  ) {
    const [status] = await tx
      .select({ id: statuses.id })
      .from(statuses)
      .where(
        and(
          eq(statuses.orgId, scope.orgId),
          eq(statuses.id, plan.metadata.statusId),
        ),
      )
      .limit(1)
      .for("share");
    if (!status)
      fail(copy.saveFailed, {
        statusCode: 422,
        errorCode: "project_status_not_found",
      });
  }
  for (const row of updated) {
    await writeCell(tx, row, previous.has(row.id));
  }
  const undoGenerations = new Map<string, string>();
  for (const change of changes) {
    if (change.type === "delete" && change.outputUndoToken !== undefined) {
      const row = previous.get(change.cellId);
      if (row?.contents.kind !== "sql" || current.has(row.id)) continue;
      const retained = await retainDeletedCellOutput(
        row,
        before,
        change.outputUndoToken,
        await settledWarehouseOutputGeneration(scope, row, before),
        tx,
      );
      if (retained) undoGenerations.set(row.id, change.outputUndoToken);
    } else if (change.type === "insert-legacy" && change.restore) {
      const row = current.get(change.cellId);
      if (row?.contents.kind !== "sql" || previous.has(row.id)) continue;
      const generation = await restoreDeletedCellOutput(
        row,
        plan.cells,
        change.outputUndoToken,
        tx,
      );
      if (generation !== undefined) undoGenerations.set(row.id, generation);
    }
  }
  const fences = new Map<string, string>();
  for (const cellId of plan.invalidatedCellIds) {
    const generation = undoGenerations.get(cellId) ?? randomUUID();
    await reserveCellOutputGeneration(project.id, cellId, generation, tx);
    fences.set(cellId, generation);
  }
  const tombstones = [];
  for (const row of deleted) {
    const outputGeneration = fences.get(row.id);
    const tombstone = notebookTombstoneSchema.parse({
      cellId: row.id,
      versionId: project.workingVersionId,
      revision,
      outputGeneration,
    });
    const values = { ...tombstone, revision: BigInt(revision) };
    await tx
      .insert(notebookTombstones)
      .values({ projectId: project.id, ...values })
      .onConflictDoUpdate({
        target: [notebookTombstones.projectId, notebookTombstones.cellId],
        set: values,
      });
    await tx
      .delete(cells)
      .where(and(draftCells(project), eq(cells.id, row.id)));
    tombstones.push(tombstone);
  }
  const invalidatedOutputs = [...fences].map(([cellId, outputGeneration]) =>
    outputFenceSchema.parse({ cellId, outputGeneration }),
  );
  const discardedOutputIds = [...fences.keys()].filter(
    (id) => !undoGenerations.has(id),
  );
  const discardedCellIds = [
    ...deleted.map(({ id }) => id),
    ...(undo ? restored : []),
  ];
  if (discardedOutputIds.length > 0) {
    await tx
      .delete(cellOutputs)
      .where(
        and(
          eq(cellOutputs.projectId, project.id),
          inArray(cellOutputs.cellId, discardedOutputIds),
          or(
            inArray(cellOutputs.status, ["queued", "running"]),
            ...(discardedCellIds.length > 0
              ? [inArray(cellOutputs.cellId, discardedCellIds)]
              : []),
          ),
        ),
      );
  }
  const next = {
    ...project,
    ...plan.metadata,
    ...(sqlSelection ? { notebookLastSqlSource: sqlSelection } : {}),
    notebookRevision: BigInt(revision),
    notebookEventSeq: project.notebookEventSeq + 1n,
    notebookOrderRevision: plan.orderChanged
      ? BigInt(revision)
      : project.notebookOrderRevision,
    notebookMetadataRevision: metadataChanged
      ? BigInt(revision)
      : project.notebookMetadataRevision,
    notebookInputRevision: plan.inputChanged
      ? BigInt(revision)
      : project.notebookInputRevision,
    notebookLayoutRevision: plan.layoutChanged
      ? BigInt(revision)
      : project.notebookLayoutRevision,
  };
  if (plan.appLayout) {
    await writeAppDocument(
      tx,
      scope.orgId,
      project.id,
      project.workingVersionId,
      plan.appLayout,
    );
  }
  const [written] = await tx
    .update(projects)
    .set({
      ...plan.metadata,
      ...(authorDefaultTitle ? { untitledOrdinal: null } : {}),
      notebookRevision: next.notebookRevision,
      notebookEventSeq: next.notebookEventSeq,
      notebookOrderRevision: next.notebookOrderRevision,
      notebookMetadataRevision: next.notebookMetadataRevision,
      notebookInputRevision: next.notebookInputRevision,
      notebookLayoutRevision: next.notebookLayoutRevision,
      notebookLastSqlSource: next.notebookLastSqlSource,
      userUpdatedAt: sql`greatest(${projects.userUpdatedAt}, ${committedAt})`,
      updatedAt: committedAt,
    })
    .where(and(eq(projects.id, project.id), eq(projects.orgId, scope.orgId)))
    .returning({ id: projects.id });
  if (!written) throw new StoredDataError(copy.savedContentFailed);
  const snapshot = snapshotRef(scope, next);
  const changedCellIds = [...updated, ...deleted].map((row) => row.id);
  const impact = notebookCommandImpactSchema.parse({
    opId,
    previousHead: head(project),
    snapshot,
    changedCellIds,
    invalidatedOutputs,
  });
  const receipt = {
    status: "applied" as const,
    opId,
    previousHead: impact.previousHead,
    nextHead: snapshot.head,
    eventSeq: snapshot.eventSeq,
    committedAt,
    impact,
    delta: {
      cells: updated.map(acceptedCell),
      tombstones,
      resources: resources(next),
      ...(metadataChanged ? { metadata: plan.metadata } : {}),
      ...(plan.appLayout ? { appLayout: plan.appLayout } : {}),
    },
  };
  const deletedIds = new Set(deleted.map((row) => row.id));
  const namespace = draftNamespace(scope, project.id);
  const inputOutputs = new Set(plan.inputInvalidatedCellIds);
  const byCause: Record<
    "delete" | "input-change" | "edit",
    typeof invalidatedOutputs
  > = {
    delete: [],
    "input-change": [],
    edit: [],
  };
  for (const fence of invalidatedOutputs) {
    const cause = deletedIds.has(fence.cellId)
      ? "delete"
      : inputOutputs.has(fence.cellId)
        ? "input-change"
        : "edit";
    byCause[cause].push(fence);
  }
  const invalidations = Object.entries(byCause).flatMap(([cause, outputs]) =>
    outputs.length === 0
      ? []
      : [
          runInvalidationSchema.parse({
            snapshot,
            namespace,
            inputRevision: receipt.delta.resources.inputRevision,
            cause,
            outputs,
          }),
        ],
  );
  const changedIds = new Set(changedCellIds);
  for (const invalidation of invalidations)
    await invalidateNotebookRunOutputs(tx, invalidation);
  if (
    plan.inputChanged &&
    project.notebookAutoRerun &&
    !command.suppressReactiveRun
  ) {
    const changedInputs = updated.flatMap(({ id, contents }) => {
      if (contents.kind !== "input") return [];
      const prior = previous.get(id)?.contents;
      return prior?.kind === "input" &&
        isDeepStrictEqual(executionContents(prior), executionContents(contents))
        ? []
        : [id];
    });
    if (changedInputs.length > 0)
      await enqueueReactiveInputs(
        tx,
        project.id,
        project.workingVersionId,
        changedInputs,
      );
  }
  const event: NotebookEvent = {
    sequence: snapshot.eventSeq,
    principalId: scope.ownerEmail,
    receipt,
    invalidations,
    before: {
      cells: before.filter((row) => changedIds.has(row.id)).map(acceptedCell),
      tombstones: accepted.tombstones.filter(({ cellId }) =>
        restored.has(cellId),
      ),
      resources: resources(project),
      ...(metadataChanged ? { metadata: metadata(project) } : {}),
      ...(plan.appLayout && plan.previousLayout
        ? { appLayout: plan.previousLayout }
        : {}),
    },
    runIntent:
      byCause["input-change"].length === 0
        ? null
        : {
            kind: "reactive-input",
            cellIds: byCause["input-change"].map(({ cellId }) => cellId),
          },
  };
  await tx
    .insert(notebookEvents)
    .values({ projectId: project.id, eventSeq: next.notebookEventSeq, event });
  if (origin) {
    const inverse = inversePlan(event);
    if (undo) {
      await advanceUndoEntry(
        tx,
        origin,
        undo.entry,
        next.notebookEventSeq,
        revision,
        inverse,
        undo.equivalent,
      );
    } else if (isUndoable(inverse)) {
      await recordUndoEntry(tx, origin, opId, next.notebookEventSeq, inverse);
    }
  }
  return receipt;
}

class StatusAssignmentsChanged extends Error {}

export async function deleteNotebookStatus(
  scope: WorkspaceScope,
  statusId: string,
) {
  const assignedStatus = and(
    eq(projects.orgId, scope.orgId),
    eq(projects.statusId, statusId),
  );
  const status = and(
    eq(statuses.orgId, scope.orgId),
    eq(statuses.id, statusId),
  );
  const db = getDb();
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await db.transaction(async (tx) => {
        const assigned = await tx
          .select()
          .from(projects)
          .where(assignedStatus)
          .orderBy(projects.id)
          .for("update");
        await tx
          .select({ id: statuses.id })
          .from(statuses)
          .where(status)
          .limit(1)
          .for("update");
        const current = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(assignedStatus);
        const locked = new Set(assigned.map((project) => project.id));
        if (current.some((project) => !locked.has(project.id)))
          throw new StatusAssignmentsChanged();
        for (const project of assigned) {
          const snapshot = snapshotRef(scope, project);
          const command: NotebookWriteCommand = {
            protocol: CONTRACT_VERSION,
            projectId: snapshot.projectId,
            workingVersionId: snapshot.head.versionId,
            observedHead: snapshot.head,
            opId: randomUUID(),
            changes: [
              {
                type: "set-metadata",
                expectedMetadataRevision: resources(project).metadataRevision,
                metadata: { statusId: null },
              },
            ],
          };
          const at = nowIso();
          const accepted = await evaluate(tx, scope, project, command, at);
          if (accepted.status !== "applied")
            throw new StoredDataError(copy.savedContentFailed);
          const receipt = await commitChanges(tx, scope, project, at, accepted);
          await tx.insert(notebookReceipts).values({
            ...receiptKey(scope, project.id, command.opId),
            fingerprint: fingerprint(command),
            receipt,
          });
        }
        await tx.delete(statuses).where(status);
      });
      return;
    } catch (error) {
      if (!(error instanceof StatusAssignmentsChanged)) throw error;
    }
  }
  notebookBusy();
}

class RetryOutputLocks extends Error {
  constructor(
    readonly cellIds: string[],
    readonly sources: ReadonlySet<string> = new Set(),
    readonly choices: ChoiceWrite[] = [],
  ) {
    super();
  }
}

class AdoptLayoutDraft extends Error {}

function affectedLocks({ before, plan }: Accepted, choices: ChoiceWrite[]) {
  const existing = new Set(before.map(({ id }) => id));
  return [
    ...new Set([
      ...plan.invalidatedCellIds,
      ...plan.cells.filter(({ id }) => !existing.has(id)).map(({ id }) => id),
      ...choices.flatMap(({ dynamic }) =>
        dynamic ? [dynamic.producerCellId] : [],
      ),
    ]),
  ].sort();
}

function fingerprint(command: unknown) {
  const json = JSON.stringify(command, (_key, value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) =>
            a < b ? -1 : Number(a > b),
          ),
        )
      : value,
  );
  return createHash("sha256").update(json).digest("hex");
}

async function tableQueryReplay(
  db: Queryable,
  scope: WorkspaceScope,
  prior: NonNullable<Awaited<ReturnType<typeof readReceipt>>>,
  intent: QueryNotebookTableInput,
) {
  const stored = operationReceiptSchema.parse(prior.receipt);
  if (
    prior.fingerprint !== fingerprint(intent) ||
    stored.status !== "applied" ||
    !stored.tableRun
  )
    fail(copy.saveFailed, {
      statusCode: 409,
      errorCode: "operation_id_reused",
    });
  const [saved] = await db
    .select({ receipt: notebookRuns.receipt })
    .from(notebookRuns)
    .where(
      and(
        eq(notebookRuns.id, stored.tableRun.runId),
        eq(notebookRuns.orgId, scope.orgId),
        eq(notebookRuns.ownerEmail, scope.ownerEmail),
      ),
    )
    .limit(1);
  if (!saved)
    fail(copy.saveFailed, {
      statusCode: 503,
      errorCode: "notebook_run_admission_unreadable",
    });
  return {
    ...stored.tableRun,
    insert: stored,
    run: runReceiptSchema.parse(saved.receipt),
  };
}

async function readableTableQueryDraft(
  scope: WorkspaceScope,
  projectId: string,
) {
  await ensureAnalyticsDatabase();
  const project = await getReadableProjectRow(scope, projectId);
  if (!project || project.trashedAt !== null) notebookUnavailable();
  if (!canEditProject(await projectAccessLevel(scope, project)))
    fail("You don’t have permission to query this table.", {
      statusCode: 403,
      errorCode: "notebook_edit_denied",
    });
  return project;
}

export async function readNotebookTableQueryReplay(
  scope: WorkspaceScope,
  intent: QueryNotebookTableInput,
) {
  await readableTableQueryDraft(scope, intent.projectId);
  const key = receiptKey(scope, intent.projectId, intent.requestId);
  const db = getDb();
  const prior = await readReceipt(db, key);
  return prior ? tableQueryReplay(db, scope, prior, intent) : null;
}

const tableQueryRuns = createRunStore(readDraftSnapshot);

async function planTableInsert(
  tx: Queryable,
  actor: ExecutionActor,
  project: ProjectRow,
  intent: QueryNotebookTableInput,
  table: WarehouseTableProvenance,
  source: string,
  committedAt: string,
) {
  const cells = await readNotebookCells(project, tx);
  const anchor = cells.findIndex(({ id }) => id === intent.afterCellId);
  const before = cells[anchor + 1];
  return evaluate(
    tx,
    actor,
    project,
    {
      protocol: CONTRACT_VERSION,
      projectId: intent.projectId,
      workingVersionId: intent.workingVersionId,
      observedHead: intent.observedHead,
      opId: intent.requestId,
      ...(intent.originId === undefined ? {} : { originId: intent.originId }),
      warehouseTable: table,
      changes: [
        {
          type: "insert",
          cellId: intent.cellId,
          gap: {
            afterCellId: intent.afterCellId,
            beforeCellId: before
              ? outputFenceSchema.shape.cellId.parse(before.id)
              : null,
          },
          expectedOrderRevision: intent.expectedOrderRevision,
          contents: {
            kind: "sql",
            label: null,
            source,
            dataConnectionId: table.connectionId,
            databaseSchema: null,
            outputResult: true,
          },
        },
      ],
    },
    committedAt,
  );
}

export async function applyNotebookTableQuery(
  actor: ExecutionActor,
  intent: QueryNotebookTableInput,
  table: WarehouseTableProvenance,
  source: string,
  recheckSource: () => Promise<void>,
) {
  const projectId = intent.projectId;
  const namespace = draftNamespace(actor, projectId);
  const key = receiptKey(actor, projectId, intent.requestId);
  const db = getDb();
  const initial = await readableTableQueryDraft(actor, projectId);
  const committedAt = nowIso();
  const predicted = await planTableInsert(
    db,
    actor,
    initial,
    intent,
    table,
    source,
    committedAt,
  );
  const lockIds =
    predicted.status === "applied" ? affectedLocks(predicted, []) : [];
  return db.transaction(async (tx) => {
    for (const cellId of lockIds)
      await lockCellOutputForEdit(projectId, cellId, tx);
    await lockNotebookRunOutputs(
      tx,
      namespace.namespaceId,
      lockIds.map((id) => outputFenceSchema.shape.cellId.parse(id)),
      true,
    );
    const project = await lockNotebookProject(actor, projectId, tx, "update");
    await recheckSource();
    const prior = await readReceipt(tx, key);
    if (prior) return tableQueryReplay(tx, actor, prior, intent);
    if (
      !isAdopted(project) ||
      intent.workingVersionId !== project.workingVersionId ||
      intent.observedHead.versionId !== project.workingVersionId
    )
      fail(copy.loadFailed, {
        statusCode: 409,
        errorCode: "notebook_lineage_changed",
      });
    for (const id of intent.throughOperationIds) {
      const observed = await readReceipt(tx, receiptKey(actor, projectId, id));
      if (
        !observed ||
        observed.receipt.status === "conflict" ||
        observed.receipt.nextHead.versionId !== project.workingVersionId ||
        BigInt(observed.receipt.nextHead.revision) >
          BigInt(intent.observedHead.revision)
      )
        fail(copy.saveFailed, {
          statusCode: 409,
          errorCode: "notebook_barrier_pending",
        });
    }
    const accepted = await planTableInsert(
      tx,
      actor,
      project,
      intent,
      table,
      source,
      committedAt,
    );
    if (
      accepted.status !== "applied" ||
      !isDeepStrictEqual(affectedLocks(accepted, []), lockIds)
    )
      fail(copy.saveFailed, {
        statusCode: 409,
        errorCode: "notebook_order_conflict",
      });
    const insert = await commitChanges(
      tx,
      actor,
      project,
      committedAt,
      accepted,
    );
    const statement = insert.delta.cells.find(
      ({ id }) => id === intent.cellId,
    )?.contents;
    const latest = await readCurrentDraftSnapshot(actor, projectId, tx);
    if (
      statement?.kind !== "sql" ||
      !statement.resultVariable ||
      latest.status !== "accepted"
    )
      fail(copy.saveFailed, {
        statusCode: 503,
        errorCode: "notebook_insert_unreadable",
      });
    const run = await tableQueryRuns.admit(
      actor,
      runRequestSchema.parse({
        requestId: intent.requestId,
        snapshot: latest.value.snapshot,
        mode: "cell-only",
        targetCellId: intent.cellId,
        cache: "bypass",
        staleValues: "reject",
      }),
      { newTableCell: true },
      tx,
    );
    if (run.status !== "admitted" || run.attempts.length !== 1)
      fail(copy.saveFailed, {
        statusCode: run.status === "rejected" ? 409 : 503,
        errorCode:
          run.status === "rejected" && run.reason === "request_id_reused"
            ? "operation_id_reused"
            : "notebook_run_admission_failed",
      });
    // raw-sql-ok: The receipt stores the compiled query as data.
    const tableRun = notebookTableRunSchema.parse({
      requestId: intent.requestId,
      runId: run.runId,
      cellId: intent.cellId,
      table: intent.table,
      sql: statement.source,
      sourceId: table.connectionId,
      resultVariable: statement.resultVariable,
      admittedAt: run.startedAt,
    });
    const receipt = appliedReceiptSchema.parse({ ...insert, tableRun });
    await tx.insert(notebookReceipts).values({
      ...key,
      fingerprint: fingerprint(intent),
      receipt,
    });
    return { ...tableRun, insert: receipt, run };
  });
}

export async function applyNotebookOperation(
  scope: WorkspaceScope,
  operation: NotebookOperation,
  ownerOnly = false,
  review?: {
    lockOutputs: (tx: Queryable, cellIds: string[]) => Promise<void>;
    validate: (tx: Queryable, project: ProjectRow) => Promise<void>;
    commit: (
      tx: Queryable,
      project: ProjectRow,
      receipt: OperationReceipt,
    ) => Promise<void>;
  },
) {
  const initial = await readableDraft(scope, operation.projectId);
  if (ownerOnly && initial.ownerEmail !== scope.ownerEmail)
    notebookUnavailable();
  const key = receiptKey(scope, initial.id, operation.opId);
  const digest = fingerprint(operation);
  let lockIds: string[] = [];
  const readySources = new Set<string>();
  const readyChoices = new Map<string, readonly string[]>();
  async function prepareSources(sources: ReadonlySet<string>) {
    for (const id of sources) {
      if (readySources.has(id)) continue;
      await assertGrantedDataConnection(id);
      readySources.add(id);
    }
  }
  async function prepareChoices(choices: ChoiceWrite[]) {
    for (const choice of choices) {
      const { dynamic, resultId } = choice;
      if (!dynamic || choiceValues(choice).length === 0) continue;
      if (!resultId) inputOptionNotAllowed();
      const key = choiceProofKey(choice);
      if (readyChoices.has(key)) continue;
      const read = await readNotebookResultChoices(
        { ...scope, caller: "unknown" },
        resultIdSchema.parse(resultId),
        dynamic.valueFieldId,
        dynamic.displayFieldId,
      );
      if (read.status === "denied")
        fail(copy.inputChoices.denied, {
          statusCode: 403,
          errorCode: "input_options_denied",
        });
      if (read.status === "unreadable")
        fail(copy.inputChoices.unreadable, {
          statusCode: 503,
          errorCode: "input_options_unreadable",
        });
      if (read.status !== "ready") inputOptionNotAllowed();
      readyChoices.set(
        key,
        read.values.map(({ value }) => value),
      );
    }
  }
  const db = getDb();
  const onlyLayout =
    "changes" in operation &&
    operation.changes.length === 1 &&
    operation.changes[0]?.type === "set-app";
  if (isAdopted(initial) && !(await readReceipt(db, key))) {
    const predicted = await evaluate(db, scope, initial, operation, nowIso());
    if (predicted.status === "applied") {
      const choices = choiceWrites(predicted.command, predicted);
      lockIds = affectedLocks(predicted, choices);
      await prepareSources(commandSources(predicted.command, predicted));
      await prepareChoices(choices);
    }
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const receipt = await db.transaction(async (tx) => {
        for (const cellId of lockIds)
          await lockCellOutputForEdit(initial.id, cellId, tx);
        await lockNotebookRunOutputs(
          tx,
          draftNamespace(scope, initial.id).namespaceId,
          lockIds.map((cellId) => outputFenceSchema.shape.cellId.parse(cellId)),
          true,
        );
        await review?.lockOutputs(tx, lockIds);
        const project = await lockNotebookProject(
          scope,
          initial.id,
          tx,
          "update",
        );
        if (ownerOnly && project.ownerEmail !== scope.ownerEmail)
          notebookUnavailable();
        const prior = await readReceipt(tx, key);
        if (prior) {
          if (lockIds.length > 0) throw new RetryOutputLocks([]);
          if (prior.fingerprint !== digest)
            fail(copy.saveFailed, {
              statusCode: 409,
              errorCode: "operation_id_reused",
            });
          return operationReceiptSchema.parse(prior.receipt);
        }
        await review?.validate(tx, project);
        const adopted = isAdopted(project);
        if (!adopted && !onlyLayout)
          fail(copy.loadFailed, {
            statusCode: 409,
            errorCode: "notebook_not_adopted",
          });
        const committedAt = nowIso();
        const accepted = await evaluate(
          tx,
          scope,
          project,
          operation,
          committedAt,
        );
        if (accepted.status === "invalid")
          fail(copy.saveFailed, {
            statusCode: 422,
            errorCode: "notebook_invalid_change",
          });
        if (accepted.status === "invalid_layout")
          fail(copy.saveFailed, {
            statusCode: 422,
            errorCode: "app_layout_invalid",
          });
        const choices =
          accepted.status === "applied"
            ? choiceWrites(accepted.command, accepted)
            : [];
        const required =
          accepted.status === "applied" ? affectedLocks(accepted, choices) : [];
        const sources =
          accepted.status === "applied"
            ? commandSources(accepted.command, accepted)
            : new Set<string>();
        if (
          !isDeepStrictEqual(required, lockIds) ||
          [...sources].some((id) => !readySources.has(id)) ||
          choices.some(
            (choice) =>
              choice.dynamic &&
              choiceValues(choice).length > 0 &&
              !readyChoices.has(choiceProofKey(choice)),
          )
        ) {
          throw new RetryOutputLocks(required, sources, choices);
        }
        for (const id of sources) await assertGrantedDataConnection(id);
        for (const choice of choices) {
          const { contents, dynamic, resultId } = choice;
          const selected = choiceValues(choice);
          if (selected.length === 0) continue;
          let allowed: readonly string[] | undefined = contents.options;
          if (dynamic) {
            const live = await inputOptionsPointer(
              tx,
              scope,
              project.id,
              dynamic.producerCellId,
            );
            if (live?.resultId !== resultId)
              fail(copy.inputChoices.removed, {
                statusCode: 409,
                errorCode: "input_options_changed",
              });
            allowed = readyChoices.get(choiceProofKey(choice));
          }
          if (selected.some((value) => !allowed?.includes(value)))
            inputOptionNotAllowed();
        }
        if (!adopted && accepted.status === "applied")
          throw new AdoptLayoutDraft();
        const previousHead = head(project);
        const receipt =
          accepted.status === "applied"
            ? await commitChanges(tx, scope, project, committedAt, accepted)
            : operationReceiptSchema.parse({
                ...accepted,
                opId: operation.opId,
                previousHead,
                nextHead: previousHead,
                committedAt,
                eventSeq: project.notebookEventSeq.toString(),
              });
        await tx
          .insert(notebookReceipts)
          .values({ ...key, fingerprint: digest, receipt });
        await review?.commit(tx, project, receipt);
        return receipt;
      });
      if (receipt.status === "applied" && receipt.delta.tombstones.length > 0)
        await sweepDataframeBlobsAfterWrite(
          { ownerEmail: initial.ownerEmail, orgId: scope.orgId },
          initial.id,
        );
      return receipt;
    } catch (error) {
      if (error instanceof AdoptLayoutDraft) {
        await adoptNotebook(scope, initial.id);
        continue;
      }
      if (!(error instanceof RetryOutputLocks)) throw error;
      lockIds = error.cellIds;
      await prepareSources(error.sources);
      await prepareChoices(error.choices);
    }
  }
  return notebookBusy();
}

export async function listNotebookProject(
  scope: WorkspaceScope,
  projectId: string,
  opId: string,
  expectedHead: z.infer<typeof draftHeadSchema>,
) {
  const key = receiptKey(scope, notebookProjectIdSchema.parse(projectId), opId);
  const digest = fingerprint({ kind: "list-project", projectId, expectedHead });
  return getDb().transaction(async (tx) => {
    const project = await lockNotebookProject(scope, projectId, tx, "update");
    if (project.ownerEmail !== scope.ownerEmail) notebookUnavailable();
    const prior = await readReceipt(tx, key);
    if (prior) {
      if (prior.fingerprint !== digest)
        fail(copy.saveFailed, {
          statusCode: 409,
          errorCode: "intent_mismatch",
        });
      return operationReceiptSchema.parse(prior.receipt);
    }
    const previousHead = head(project);
    if (!isDeepStrictEqual(previousHead, expectedHead))
      fail(copy.saveFailed, {
        statusCode: 409,
        errorCode: "thread_revision_conflict",
      });
    const committedAt = nowIso();
    const next = project.listed
      ? project
      : {
          ...project,
          listed: true,
          notebookRevision: project.notebookRevision + 1n,
          notebookMetadataRevision: project.notebookRevision + 1n,
          notebookEventSeq: project.notebookEventSeq + 1n,
        };
    const snapshot = snapshotRef(scope, next);
    const base = {
      opId,
      previousHead,
      nextHead: snapshot.head,
      committedAt,
      eventSeq: snapshot.eventSeq,
    };
    const receipt = project.listed
      ? operationReceiptSchema.parse({ ...base, status: "no_change" })
      : appliedReceiptSchema.parse({
          ...base,
          status: "applied",
          delta: {
            cells: [],
            tombstones: [],
            resources: resources(next),
            listed: true,
          },
          impact: {
            opId,
            previousHead,
            snapshot,
            changedCellIds: [],
            invalidatedOutputs: [],
          },
        });
    if (receipt.status === "applied") {
      await tx
        .update(projects)
        .set({
          listed: true,
          updatedAt: committedAt,
          notebookRevision: next.notebookRevision,
          notebookMetadataRevision: next.notebookMetadataRevision,
          notebookEventSeq: next.notebookEventSeq,
        })
        .where(
          and(eq(projects.id, project.id), eq(projects.orgId, scope.orgId)),
        );
      await tx.insert(notebookEvents).values({
        projectId: project.id,
        eventSeq: next.notebookEventSeq,
        event: {
          sequence: snapshot.eventSeq,
          principalId: scope.ownerEmail,
          before: {
            cells: [],
            tombstones: [],
            resources: resources(project),
            listed: false,
          },
          receipt,
          invalidations: [],
          runIntent: null,
        },
      });
    }
    await tx
      .insert(notebookReceipts)
      .values({ ...key, fingerprint: digest, receipt });
    return receipt;
  });
}
