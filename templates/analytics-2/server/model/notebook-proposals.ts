import { randomUUID } from "node:crypto";

import { fail, isActionContractError } from "@agent-native/core/action";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { z } from "zod";

import { notebookProposalErrors as copy } from "../../app/i18n/messages/notebook-proposal-errors.js";
import {
  cellInputParams,
  cellOutputParams,
} from "../../app/lib/model/cell-references.js";
import {
  type NotebookCell,
  type NotebookDelta,
  type NotebookSnapshot,
  notebookCommandSchema,
} from "../../shared/notebook-operations.js";
import {
  type DecideNotebookPendingChanges,
  type LegacyProposalRecovery,
  type NotebookProposalDecision,
  type NotebookProposalView,
  type NotebookThreadInput,
  type StageNotebookProposal,
  getNotebookPendingChangesSchema,
  notebookPendingChangesSchema,
  notebookProposalDecisionSchema,
  stagedNotebookProposalSchema,
} from "../../shared/notebook-proposals.js";
import {
  CONTRACT_VERSION,
  type DraftHead,
  notebookCellIdSchema,
  revisionSchema,
} from "../../shared/notebook-snapshot-contract.js";
import { getDb, schema } from "../db/index.js";
import { assertGrantedDataConnection } from "../lib/project-action-access.js";
import { writeAppDocument } from "./app-layouts.js";
import { nowIso } from "./clock.js";
import { isBuiltinSampleConnection } from "./data-connection-dto.js";
import { ensureAnalyticsDatabase } from "./database.js";
import { newId } from "./ids.js";
import { digest, notebookGraph } from "./notebook-execution/planner.js";
import {
  queueProposalRun,
  readProposalRuns,
  wakeProposalRun,
} from "./notebook-execution/proposal-runs.js";
import {
  lockReviewRunOutputs,
  promoteReviewedSqlResults,
} from "./notebook-execution/review-results.js";
import {
  readLegacyChange,
  readLegacyDisposition,
  writeLegacyDisposition,
} from "./notebook-legacy-proposals.js";
import {
  NotebookConflict,
  NotebookInvalidChange,
  planNotebookCommand,
} from "./notebook-operations/commands.js";
import {
  applyNotebookOperation,
  lockNotebookProject,
  projectSnapshot,
  writeNotebookVersionCells,
} from "./notebook-operations/store.js";
import {
  type CellProposalChange,
  type NotebookToolIdentity,
  notebookProposalReceipts as receipts,
  notebookProposals as proposals,
  notebookThreadProjects as bindings,
} from "./notebook-proposal-schema.js";
import type { ProjectRow } from "./project-access.js";
import type { Queryable } from "./scope.js";
import {
  type NotebookThreadBinding,
  type NotebookThreadScope,
  requireNotebookThreadBinding,
} from "./thread-projects.js";

type Proposal = typeof proposals.$inferSelect;
type ProposalContext = {
  binding: NotebookThreadBinding;
  notebook: NotebookSnapshot;
  project: ProjectRow;
};
type ToolReceipt = ReturnType<typeof stagedNotebookProposalSchema.parse>;

const reviewLimit = 200;
const revision = (value: bigint) => revisionSchema.parse(value.toString());
const activeStatuses = ["pending", "conflicted"] as const;

function overlayConflict(
  binding: NotebookThreadBinding,
  acceptedHead: DraftHead,
): never {
  return fail(copy.overlayConflict, {
    statusCode: 409,
    errorCode: "overlay_conflict",
    details: {
      overlayRevision: revision(binding.overlayRevision),
      acceptedHead,
    },
  });
}

function baseChanged(acceptedHead: DraftHead, proposalIds: string[]): never {
  return fail(copy.baseChanged, {
    statusCode: 409,
    errorCode: "proposal_base_changed",
    details: { acceptedHead, proposalIds },
  });
}

function invalidProposal(): never {
  return fail(copy.invalidProposal, {
    statusCode: 422,
    errorCode: "invalid_proposal",
  });
}

function reviewLimitReached(): never {
  return fail(copy.limit, { statusCode: 409, errorCode: "overlay_conflict" });
}

async function context(
  scope: NotebookThreadScope,
  input: NotebookThreadInput,
  tx: Queryable,
  mode: "share" | "update",
) {
  const project = await lockNotebookProject(scope, input.projectId, tx, mode);
  const binding = await requireNotebookThreadBinding(scope, input, tx, mode);
  return {
    binding,
    project,
    notebook: await projectSnapshot(scope, project, tx),
  };
}

function readActiveProposals(tx: Queryable, bindingId: string) {
  return tx
    .select()
    .from(proposals)
    .where(
      and(
        eq(proposals.bindingId, bindingId),
        inArray(proposals.status, activeStatuses),
      ),
    )
    .orderBy(proposals.sequence)
    .limit(reviewLimit + 1);
}

function flattenChanges(rows: Proposal[]) {
  return rows
    .flatMap(({ changes }) => changes)
    .sort((a, b) => (BigInt(a.sequence) < BigInt(b.sequence) ? -1 : 1))
    .map(({ change }) => change);
}

async function planOverlay(
  tx: Queryable,
  notebook: NotebookSnapshot,
  changes: CellProposalChange[],
  at: string,
) {
  const { head, projectId } = notebook.snapshot;
  const addedIds = changes.flatMap((change) =>
    change.type === "insert" ||
    change.type === "duplicate" ||
    change.type === "group-section"
      ? [change.cellId]
      : [],
  );
  const reserved =
    addedIds.length === 0
      ? []
      : await tx
          .select()
          .from(schema.notebookTombstones)
          .where(
            and(
              eq(schema.notebookTombstones.projectId, projectId),
              inArray(schema.notebookTombstones.cellId, addedIds),
            ),
          )
          .limit(addedIds.length);
  return planNotebookCommand(
    {
      protocol: CONTRACT_VERSION,
      projectId,
      workingVersionId: head.versionId,
      opId: "proposal_projection",
      observedHead: head,
      changes,
    },
    {
      cells: notebook.cells,
      metadata: notebook.metadata,
      resources: notebook.resources,
      appLayout: notebook.appLayout ?? null,
      tombstones: new Map(reserved.map((row) => [row.cellId, row])),
    },
    revision(BigInt(head.revision) + 1n),
    at,
  );
}

function proposalTimestamp(rows: Proposal[]) {
  return (
    rows
      .map((row) => row.after?.updatedAt ?? row.firstBefore?.updatedAt)
      .filter((at) => at !== undefined)
      .sort()
      .at(-1) ?? "1970-01-01T00:00:00.000Z"
  );
}

function guardChanged(notebook: NotebookSnapshot, change: CellProposalChange) {
  const cell = notebook.cells.find(
    ({ id }) =>
      id === (change.type === "duplicate" ? change.fromCellId : change.cellId),
  );
  if (
    "expectedOrderRevision" in change &&
    change.expectedOrderRevision !== notebook.resources.orderRevision
  )
    return true;
  if (
    "expectedRevision" in change &&
    change.expectedRevision !== (cell?.revision ?? "0")
  )
    return true;
  return (
    "expectedLabelRevision" in change &&
    change.expectedLabelRevision !== (cell?.labelRevision ?? "0")
  );
}

function conflictIds(notebook: NotebookSnapshot, rows: Proposal[]) {
  const conflicted = new Set(
    rows
      .filter(
        (row) =>
          row.status === "conflicted" ||
          row.changes.some(({ change }) => guardChanged(notebook, change)) ||
          ((row.kind === "delete" ||
            row.changes.some(({ change }) => change.type === "duplicate")) &&
            row.firstBefore !== null &&
            notebook.cells.some(
              (cell) =>
                cell.id === row.cellId &&
                BigInt(cell.labelRevision) > BigInt(row.baseHead.revision),
            )),
      )
      .map(({ id }) => id),
  );
  for (let size = -1; size !== conflicted.size; ) {
    size = conflicted.size;
    for (const row of rows) {
      if (row.dependencyIds.some((id) => conflicted.has(id)))
        conflicted.add(row.id);
    }
  }
  return conflicted;
}

export async function readNotebookProposalSnapshot(
  scope: NotebookThreadScope,
  input: NotebookThreadInput,
  tx?: Queryable,
  mode: "share" | "update" = "share",
) {
  async function read(db: Queryable) {
    const { binding, notebook } = await context(scope, input, db, mode);
    const rows = await readActiveProposals(db, binding.id);
    const conflicts = conflictIds(notebook, rows);
    const active = rows.filter((row) => !conflicts.has(row.id));
    try {
      const plan = await planOverlay(
        db,
        notebook,
        flattenChanges(active),
        proposalTimestamp(active),
      );
      return { binding, notebook: { ...notebook, cells: plan.cells } };
    } catch (error) {
      if (!(error instanceof NotebookConflict)) throw error;
      return baseChanged(
        notebook.snapshot.head,
        active.map(({ id }) => id),
      );
    }
  }
  if (tx) return read(tx);
  await ensureAnalyticsDatabase();
  return getDb().transaction(read);
}

function toolKey(identity: NotebookToolIdentity) {
  return `tool:${digest([identity.runId, identity.turnId, identity.toolCallId, identity.ordinal ?? 0])}`;
}

function receiptFilter(
  binding: NotebookThreadBinding,
  scope: NotebookThreadScope,
  opId: string,
) {
  return and(
    eq(receipts.bindingId, binding.id),
    eq(receipts.actorId, scope.ownerEmail),
    eq(receipts.opId, opId),
  );
}

async function readReceipt(
  tx: Queryable,
  binding: NotebookThreadBinding,
  scope: NotebookThreadScope,
  opId: string,
  fingerprint: string,
) {
  const [prior] = await tx
    .select()
    .from(receipts)
    .where(receiptFilter(binding, scope, opId))
    .limit(1);
  if (!prior) return null;
  if (prior.fingerprint !== fingerprint)
    fail(copy.intentMismatch, {
      statusCode: 409,
      errorCode: "intent_mismatch",
    });
  return prior.receipt;
}

function writeReceipt(
  tx: Queryable,
  binding: NotebookThreadBinding,
  scope: NotebookThreadScope,
  opId: string,
  fingerprint: string,
  receipt: ToolReceipt | NotebookProposalDecision,
  createdAt: string,
  toolIdentity?: NotebookToolIdentity,
) {
  return tx.insert(receipts).values({
    bindingId: binding.id,
    actorId: scope.ownerEmail,
    opId,
    fingerprint,
    receipt,
    createdAt,
    overlayRevision: BigInt(receipt.overlayRevision),
    eventCursor: BigInt(receipt.cursor),
    toolIdentity: toolIdentity
      ? {
          runId: toolIdentity.runId,
          turnId: toolIdentity.turnId,
          toolCallId: toolIdentity.toolCallId,
          ordinal: toolIdentity.ordinal ?? 0,
        }
      : null,
  });
}

export async function replayNotebookProposal(
  scope: NotebookThreadScope,
  input: NotebookThreadInput,
  identity: NotebookToolIdentity,
  facadeIntent: unknown,
) {
  await ensureAnalyticsDatabase();
  const receipt = await getDb().transaction(async (tx) => {
    const binding = await requireNotebookThreadBinding(scope, input, tx);
    const prior = await readReceipt(
      tx,
      binding,
      scope,
      toolKey(identity),
      digest(facadeIntent),
    );
    return prior === null ? null : stagedNotebookProposalSchema.parse(prior);
  });
  if (receipt !== null) wakeProposalRun(receipt.runIntentId);
  return receipt;
}

function normalizedGuards(
  change: CellProposalChange,
  accepted: NotebookSnapshot,
  projected: NotebookCell[],
): CellProposalChange {
  if ("expectedRevision" in change) {
    const id = change.type === "duplicate" ? change.fromCellId : change.cellId;
    const before = accepted.cells.find((cell) => cell.id === id);
    const overlay = projected.find((cell) => cell.id === id);
    if (overlay?.revision === change.expectedRevision)
      return { ...change, expectedRevision: before?.revision ?? revision(0n) };
  }
  if (change.type === "set-label") {
    const before = accepted.cells.find((cell) => cell.id === change.cellId);
    const overlay = projected.find((cell) => cell.id === change.cellId);
    if (overlay?.labelRevision === change.expectedLabelRevision)
      return {
        ...change,
        expectedLabelRevision: before?.labelRevision ?? revision(0n),
      };
  }
  return change;
}

function kindFor(
  before: NotebookCell | undefined,
  after: NotebookCell | undefined,
  change: CellProposalChange,
): Proposal["kind"] {
  if (!before) return "insert";
  if (!after) return "delete";
  return change.type === "move" || change.type === "move-to-section"
    ? "move"
    : "edit";
}

function executableGraph(cells: NotebookCell[]) {
  return notebookGraph(
    cells.flatMap(({ id, contents }) =>
      contents.kind === "sql" ||
      contents.kind === "code" ||
      contents.kind === "input"
        ? [{ id: notebookCellIdSchema.parse(id), contents }]
        : [],
    ),
  );
}

function addDependencies(rows: Proposal[], cells: NotebookCell[]) {
  const graph = new Map(
    executableGraph(cells).map(({ cell, dependencies }) => [
      cell.id as string,
      dependencies.map(({ cellId }) => cellId),
    ]),
  );
  const proposalIds = new Map(rows.map(({ cellId, id }) => [cellId, id]));
  const previous = new Map<string, string>();
  const fieldDependencies = new Map<string, string[]>();
  for (const { id, contents } of cells) {
    fieldDependencies.set(id, [
      ...(contents.kind === "metric" && contents.metricConfig?.source
        ? [contents.metricConfig.source.cellId]
        : []),
      ...cellInputParams(contents).flatMap((name) => {
        const source = previous.get(name.toLowerCase());
        return source ? [source] : [];
      }),
    ]);
    for (const name of cellOutputParams(contents))
      previous.set(name.toLowerCase(), id);
  }
  return rows.map((row) => {
    const refs = [
      ...(graph.get(row.cellId) ?? []),
      ...(fieldDependencies.get(row.cellId) ?? []),
      ...row.changes.flatMap(({ change }) => {
        if (change.type === "group-section") return change.cellIds;
        if (change.type === "move-to-section")
          return [
            ...change.cellIds,
            change.parentSectionId,
            change.beforeCellId ?? null,
          ];
        if ("gap" in change)
          return [
            change.gap.afterCellId,
            change.gap.beforeCellId,
            change.type === "duplicate" ? change.fromCellId : null,
            change.type === "insert" ? (change.parentSectionId ?? null) : null,
          ];
        return [];
      }),
    ];
    return {
      ...row,
      dependencyIds: [
        ...new Set(
          refs.flatMap((cellId) => {
            const dependency =
              cellId === null ? undefined : proposalIds.get(cellId);
            return dependency && dependency !== row.id ? [dependency] : [];
          }),
        ),
      ],
    };
  });
}

function affectedRunnableCells(before: NotebookCell[], after: NotebookCell[]) {
  const prior = new Map(
    executableGraph(before).map((node) => [node.cell.id, node.signature]),
  );
  return executableGraph(after)
    .filter((node) => prior.get(node.cell.id) !== node.signature)
    .map(({ cell }) => cell.id);
}

function runScope(
  binding: NotebookThreadBinding,
  scope: NotebookThreadScope,
  overlayRevision: bigint,
) {
  return {
    ...scope,
    bindingId: binding.id,
    projectId: binding.projectId,
    threadId: binding.threadId,
    versionId: binding.workingVersionId,
    overlayRevision: revision(overlayRevision),
  };
}

async function advanceOverlay(
  tx: Queryable,
  binding: NotebookThreadBinding,
  eventCursor: bigint,
) {
  const overlayRevision = binding.overlayRevision + 1n;
  await tx
    .update(bindings)
    .set({ overlayRevision, eventCursor })
    .where(eq(bindings.id, binding.id));
  return overlayRevision;
}

class ProposalSourcesNotReady extends Error {
  constructor(readonly connectionIds: string[]) {
    super("Proposal sources require scoped validation");
  }
}

function proposalSourceIds(cells: NotebookCell[]) {
  return [
    ...new Set(
      cells.flatMap(({ contents }) =>
        contents.kind === "sql" && contents.dataConnectionId
          ? [contents.dataConnectionId]
          : [],
      ),
    ),
  ];
}

async function assertProposalSource(connectionId: string) {
  try {
    await assertGrantedDataConnection(connectionId);
  } catch (error) {
    if (
      isActionContractError(error) &&
      (error.statusCode === 403 || error.statusCode === 404)
    )
      fail(copy.sourceDenied, { statusCode: 403, errorCode: "source_denied" });
    throw error;
  }
}

export async function stageNotebookProposal(
  scope: NotebookThreadScope,
  input: StageNotebookProposal,
  identity: NotebookToolIdentity | { legacyRecovery: LegacyProposalRecovery },
  facadeIntent?: unknown,
) {
  await ensureAnalyticsDatabase();
  const command = notebookCommandSchema.parse(input.command);
  if (command.projectId !== input.projectId) invalidProposal();
  const changes = command.changes.map((change) =>
    "cellId" in change && change.type !== "remove-section"
      ? change
      : invalidProposal(),
  );
  const recovery =
    "legacyRecovery" in identity ? identity.legacyRecovery : null;
  const opId =
    "legacyRecovery" in identity
      ? `orphan:${identity.legacyRecovery.opId}`
      : toolKey(identity);
  const fingerprint = digest(facadeIntent ?? input);
  const checkedSources = new Set<string>();
  const db = getDb();
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const receipt = await db.transaction(stage);
      wakeProposalRun(receipt.runIntentId);
      return receipt;
    } catch (error) {
      if (!(error instanceof ProposalSourcesNotReady)) throw error;
      for (const id of error.connectionIds) {
        await assertProposalSource(id);
        checkedSources.add(id);
      }
    }
  }
  return fail(copy.overlayConflict, {
    statusCode: 409,
    errorCode: "overlay_conflict",
  });

  async function stage(tx: Queryable) {
    const { binding, notebook, project } = await context(
      scope,
      input,
      tx,
      "update",
    );
    const prior = await readReceipt(tx, binding, scope, opId, fingerprint);
    if (prior !== null) return stagedNotebookProposalSchema.parse(prior);
    if (recovery) {
      if (await readLegacyDisposition(tx, scope, project, recovery))
        invalidProposal();
      const legacy = await readLegacyChange(tx, scope, project, recovery);
      const [change] = changes;
      if (
        changes.length !== 1 ||
        change?.type !== "set-code" ||
        change.cellId !== recovery.cellId ||
        change.expectedRevision !== legacy.revision ||
        change.source !== legacy.source
      )
        invalidProposal();
    }
    const acceptedHead = notebook.snapshot.head;
    if (input.expectedOverlayRevision !== revision(binding.overlayRevision))
      overlayConflict(binding, acceptedHead);
    if (
      command.workingVersionId !== acceptedHead.versionId ||
      command.observedHead.versionId !== acceptedHead.versionId ||
      BigInt(command.observedHead.revision) > BigInt(acceptedHead.revision)
    )
      baseChanged(acceptedHead, []);
    const rows = await readActiveProposals(tx, binding.id);
    const conflicted = conflictIds(notebook, rows);
    if (conflicted.size > 0) baseChanged(acceptedHead, [...conflicted]);
    const at = nowIso();
    const projected = await planOverlay(tx, notebook, flattenChanges(rows), at);
    const normalized = changes.map((change) =>
      normalizedGuards(change, notebook, projected.cells),
    );
    const next = binding.overlayRevision + 1n;
    const changed = new Map<string, Proposal>();
    let eventCursor = binding.eventCursor;
    const first = new Map(notebook.cells.map((cell) => [cell.id, cell]));
    const existing = new Map(rows.map((row) => [row.cellId, row]));
    const plan = await planOverlay(
      tx,
      notebook,
      [...flattenChanges(rows), ...normalized],
      at,
    ).catch((error: unknown) => {
      if (error instanceof NotebookConflict) baseChanged(acceptedHead, []);
      if (error instanceof NotebookInvalidChange) invalidProposal();
      throw error;
    });
    const last = new Map(plan.cells.map((cell) => [cell.id, cell]));
    const previous = new Map(projected.cells.map((cell) => [cell.id, cell]));
    const sources = proposalSourceIds(
      plan.cells.filter((row) => {
        const prior = previous.get(row.id);
        return (
          prior === undefined ||
          (prior.contents.kind === "sql" &&
            row.contents.kind === "sql" &&
            (prior.contents.source !== row.contents.source ||
              prior.contents.dataConnectionId !==
                row.contents.dataConnectionId ||
              prior.contents.databaseSchema !== row.contents.databaseSchema ||
              prior.contents.connectionMode !== row.contents.connectionMode))
        );
      }),
    );
    const missingSources = sources.filter(
      (id) => !isBuiltinSampleConnection(id) && !checkedSources.has(id),
    );
    if (missingSources.length > 0)
      throw new ProposalSourcesNotReady(missingSources);
    for (const id of sources) await assertProposalSource(id);
    for (const [index, change] of normalized.entries()) {
      const before = first.get(change.cellId);
      const after = last.get(change.cellId);
      const row = changed.get(change.cellId) ?? existing.get(change.cellId);
      const entry = {
        sequence: (next * BigInt(reviewLimit) + BigInt(index)).toString(),
        change,
      };
      const eventSeq = ++eventCursor;
      changed.set(change.cellId, {
        id: row?.id ?? randomUUID(),
        bindingId: binding.id,
        cellId: change.cellId,
        sequence: row?.sequence ?? eventSeq,
        eventSeq,
        baseHead: row?.baseHead ?? command.observedHead,
        firstBefore: row ? row.firstBefore : (before ?? null),
        firstResources: row?.firstResources ?? notebook.resources,
        after: after ?? null,
        changes: [...(row?.changes ?? []), entry],
        dependencyIds: [],
        status: "pending",
        kind:
          row?.kind === "insert" ? "insert" : kindFor(before, after, change),
        runIntentId: row?.runIntentId ?? null,
        decidedBy: null,
        decidedAt: null,
      });
    }
    const all = addDependencies(
      [...rows.filter((row) => !changed.has(row.cellId)), ...changed.values()],
      plan.cells,
    );
    if (
      all.length > reviewLimit ||
      all.reduce((count, row) => count + row.changes.length, 0) > reviewLimit
    )
      reviewLimitReached();
    await advanceOverlay(tx, binding, eventCursor);
    for (const row of all) {
      if (!existing.has(row.cellId)) {
        await tx.insert(proposals).values(row);
      } else {
        await tx
          .update(proposals)
          .set({
            eventSeq: row.eventSeq,
            after: row.after,
            changes: row.changes,
            dependencyIds: row.dependencyIds,
            kind: row.kind,
          })
          .where(eq(proposals.id, row.id));
      }
    }
    const cellIds = affectedRunnableCells(projected.cells, plan.cells);
    const runIntentId = await queueProposalRun(tx, {
      ...runScope(binding, scope, next),
      cellIds,
      kind: "thread",
    });
    const proposalIds = [...changed.values()].map(({ id }) => id);
    if (runIntentId !== null) {
      await tx
        .update(proposals)
        .set({ runIntentId })
        .where(
          and(
            eq(proposals.bindingId, binding.id),
            inArray(proposals.id, proposalIds),
          ),
        );
    }
    const result = stagedNotebookProposalSchema.parse({
      status: "proposed",
      proposalIds,
      overlayRevision: revision(next),
      acceptedHead,
      cursor: revision(eventCursor),
      runIntentId,
    });
    await writeReceipt(
      tx,
      binding,
      scope,
      opId,
      fingerprint,
      result,
      at,
      "legacyRecovery" in identity ? undefined : identity,
    );
    if (recovery)
      await writeLegacyDisposition(tx, scope, project, recovery, proposalIds);
    return result;
  }
}

function reviewedDigest(rows: Proposal[]) {
  return digest(rows.map(({ id, eventSeq }) => [id, eventSeq.toString()]));
}

function toDelta(
  cell: NotebookCell | null,
  resources: NotebookSnapshot["resources"],
): NotebookDelta | null {
  return cell === null ? null : { cells: [cell], resources, tombstones: [] };
}

export async function getNotebookPendingChanges(
  scope: NotebookThreadScope,
  input: z.infer<typeof getNotebookPendingChangesSchema>,
) {
  await ensureAnalyticsDatabase();
  return getDb().transaction(async (tx) => {
    const { binding, notebook } = await context(scope, input, tx, "share");
    const active = await readActiveProposals(tx, binding.id);
    const conflicts = conflictIds(notebook, active);
    const after = input.after === undefined ? null : BigInt(input.after);
    const reset = after !== null && after > binding.eventCursor;
    const initial = after === null || reset;
    const page = initial
      ? [
          ...active,
          ...(await tx
            .select()
            .from(proposals)
            .where(
              and(
                eq(proposals.bindingId, binding.id),
                inArray(proposals.status, ["confirmed", "undone"]),
              ),
            )
            .orderBy(sql`${proposals.eventSeq} desc`)
            .limit(reviewLimit + 1 - active.length)),
        ]
      : await tx
          .select()
          .from(proposals)
          .where(
            and(
              eq(proposals.bindingId, binding.id),
              gt(proposals.eventSeq, after),
            ),
          )
          .orderBy(proposals.eventSeq)
          .limit(reviewLimit + 1);
    const visible = page.slice(0, reviewLimit);
    const runs = await readProposalRuns(tx, [
      ...new Set(
        visible.flatMap((row) =>
          row.runIntentId && row.status === "pending" && !conflicts.has(row.id)
            ? [row.runIntentId]
            : [],
        ),
      ),
    ]);
    const changes: NotebookProposalView[] = visible.map((row) => {
      const status = conflicts.has(row.id) ? "conflicted" : row.status;
      const run =
        status === "pending" && row.runIntentId
          ? runs.get(row.runIntentId)
          : undefined;
      return {
        id: row.id,
        cellId: row.cellId,
        status,
        kind: row.kind,
        before: toDelta(row.firstBefore, row.firstResources),
        after: toDelta(row.after, notebook.resources),
        dependsOn: row.dependencyIds,
        runId: run?.runId ?? null,
        resultIds:
          run?.results
            .filter(({ cellId }) => cellId === row.cellId)
            .map(({ resultId }) => resultId) ?? [],
      };
    });
    const hasMore = page.length > reviewLimit;
    return notebookPendingChangesSchema.parse({
      bindingId: binding.id,
      acceptedHead: notebook.snapshot.head,
      overlayRevision: revision(binding.overlayRevision),
      cursor: revision(
        initial || !hasMore
          ? binding.eventCursor
          : (visible.at(-1)?.eventSeq ?? binding.eventCursor),
      ),
      reviewedSetDigest: reviewedDigest(active),
      changes,
      hasMore: !initial && hasMore,
      reset,
    });
  });
}

function selectProposals(
  context: ProposalContext,
  rows: Proposal[],
  input: DecideNotebookPendingChanges,
) {
  const { binding, notebook } = context;
  const acceptedHead = notebook.snapshot.head;
  if (input.expectedOverlayRevision !== revision(binding.overlayRevision))
    overlayConflict(binding, acceptedHead);
  if (
    input.observedHead.versionId !== acceptedHead.versionId ||
    BigInt(input.observedHead.revision) > BigInt(acceptedHead.revision)
  )
    baseChanged(acceptedHead, []);
  const selectedIds =
    input.selection.kind === "selected"
      ? new Set(input.selection.ids)
      : new Set(rows.map(({ id }) => id));
  const selected = rows.filter(({ id }) => selectedIds.has(id));
  if (
    selected.length === 0 ||
    selected.length !== selectedIds.size ||
    (input.selection.kind === "all" &&
      input.selection.reviewedSetDigest !== reviewedDigest(rows))
  )
    overlayConflict(binding, acceptedHead);
  const remaining = rows.filter(({ id }) => !selectedIds.has(id));
  const remainingIds = new Set(remaining.map(({ id }) => id));
  const missing =
    input.decision === "confirm"
      ? selected.flatMap(({ dependencyIds }) =>
          dependencyIds.filter((id) => remainingIds.has(id)),
        )
      : remaining
          .filter(({ dependencyIds }) =>
            dependencyIds.some((id) => selectedIds.has(id)),
          )
          .map(({ id }) => id);
  if (missing.length > 0)
    fail(copy.dependencyRequired, {
      statusCode: 409,
      errorCode: "review_dependency_required",
      details: { proposalIds: [...new Set(missing)] },
    });
  if (input.decision === "confirm") {
    const conflicts = conflictIds(notebook, rows);
    const blocked = selected
      .filter(({ id }) => conflicts.has(id))
      .map(({ id }) => id);
    if (blocked.length > 0) baseChanged(acceptedHead, blocked);
  }
  return { selected, remaining };
}

async function saveCheckpoint(
  tx: Queryable,
  scope: NotebookThreadScope,
  notebook: NotebookSnapshot,
  at: string,
) {
  const { projectId } = notebook.snapshot;
  const { projectVersions } = schema;
  const [latest] = await tx
    .select({
      largest: sql<
        number | null
      >`max(cast(${projectVersions.number} as integer))`,
    })
    .from(projectVersions)
    .where(eq(projectVersions.projectId, projectId));
  const id = newId("ver");
  await tx.insert(projectVersions).values({
    id,
    projectId,
    kind: "autosave",
    number: String((latest?.largest ?? 0) + 1),
    createdAt: at,
    createdBy: scope.ownerEmail,
  });
  await writeNotebookVersionCells(
    tx,
    { projectId, versionId: id },
    notebook.cells.map(({ contents }) => contents),
    at,
  );
  if (notebook.appLayout)
    await writeAppDocument(tx, scope.orgId, projectId, id, notebook.appLayout);
  return id;
}

function rebaseRemaining(
  row: Proposal,
  resolved: Proposal[],
  previous: NotebookSnapshot,
  accepted: NotebookSnapshot,
): Proposal {
  const acceptedIds = new Set(resolved.map(({ id }) => id));
  const dependencyCells = new Set(
    resolved
      .filter(({ id }) => row.dependencyIds.includes(id))
      .map(({ cellId }) => cellId),
  );
  return {
    ...row,
    dependencyIds: row.dependencyIds.filter((id) => !acceptedIds.has(id)),
    changes: row.changes.map((entry) => {
      let { change } = entry;
      if (
        "expectedOrderRevision" in change &&
        change.expectedOrderRevision === previous.resources.orderRevision
      )
        change = {
          ...change,
          expectedOrderRevision: accepted.resources.orderRevision,
        };
      if (
        change.type === "duplicate" &&
        dependencyCells.has(change.fromCellId)
      ) {
        const { fromCellId } = change;
        const source = accepted.cells.find(({ id }) => id === fromCellId);
        if (source) change = { ...change, expectedRevision: source.revision };
      }
      return { ...entry, change };
    }),
  };
}

async function finishDecision(
  tx: Queryable,
  scope: NotebookThreadScope,
  context: ProposalContext,
  accepted: NotebookSnapshot,
  input: DecideNotebookPendingChanges,
  selection: ReturnType<typeof selectProposals>,
  fingerprint: string,
  promoted: { cellId: string; resultId: string }[] = [],
) {
  const { selected, remaining } = selection;
  const { binding, notebook } = context;
  const at = nowIso();
  let eventCursor = binding.eventCursor;
  const confirming = input.decision === "confirm";
  const status = confirming ? "confirmed" : "undone";
  for (const row of selected) {
    await tx
      .update(proposals)
      .set({
        status,
        eventSeq: ++eventCursor,
        decidedBy: scope.ownerEmail,
        decidedAt: at,
      })
      .where(
        and(
          eq(proposals.bindingId, binding.id),
          eq(proposals.id, row.id),
          inArray(proposals.status, activeStatuses),
        ),
      );
  }
  if (confirming) {
    for (const row of remaining) {
      const rebased = rebaseRemaining(row, selected, notebook, accepted);
      await tx
        .update(proposals)
        .set({
          changes: rebased.changes,
          dependencyIds: rebased.dependencyIds,
          eventSeq: ++eventCursor,
        })
        .where(eq(proposals.id, row.id));
    }
  }
  const overlayRevision = await advanceOverlay(tx, binding, eventCursor);
  const checkpointId =
    confirming && input.selection.kind === "all"
      ? await saveCheckpoint(tx, scope, accepted, at)
      : null;
  let cellIds = affectedRunnableCells(notebook.cells, accepted.cells);
  if (!confirming) {
    const active = [...selected, ...remaining];
    const conflicts = conflictIds(notebook, active);
    const preUndo = await planOverlay(
      tx,
      notebook,
      flattenChanges(active.filter(({ id }) => !conflicts.has(id))),
      at,
    ).catch((error: unknown) => {
      if (error instanceof NotebookConflict)
        return {
          cells: active.flatMap(({ after }) => (after === null ? [] : [after])),
        };
      throw error;
    });
    const targets = new Set([
      ...selected.map(({ cellId }) => cellId),
      ...affectedRunnableCells(preUndo.cells, accepted.cells),
    ]);
    cellIds = executableGraph(accepted.cells)
      .filter(({ cell }) => targets.has(cell.id))
      .map(({ cell }) => cell.id);
  }
  const promotedCells = new Set(promoted.map(({ cellId }) => cellId));
  const rerunIntentId = await queueProposalRun(tx, {
    ...runScope(binding, scope, overlayRevision),
    cellIds: cellIds.filter((id) => !promotedCells.has(id)),
    kind: "draft",
    allowCandidateReuse: confirming,
  });
  const decision = notebookProposalDecisionSchema.parse({
    opId: input.opId,
    decision: input.decision,
    proposalIds: selected.map(({ id }) => id),
    acceptedHead: accepted.snapshot.head,
    overlayRevision: revision(overlayRevision),
    cursor: revision(eventCursor),
    checkpointId,
    rerunIntentId,
    promotedResultIds: promoted.map(({ resultId }) => resultId),
  });
  await writeReceipt(tx, binding, scope, input.opId, fingerprint, decision, at);
  return decision;
}

export async function decideNotebookPendingChanges(
  scope: NotebookThreadScope,
  input: DecideNotebookPendingChanges,
) {
  await ensureAnalyticsDatabase();
  const db = getDb();
  const fingerprint = digest(input);
  const prepared = await db.transaction(async (tx) => {
    const review = await context(
      scope,
      input,
      tx,
      input.decision === "undo" ? "update" : "share",
    );
    const prior = await readReceipt(
      tx,
      review.binding,
      scope,
      input.opId,
      fingerprint,
    );
    if (prior !== null)
      return { receipt: notebookProposalDecisionSchema.parse(prior) };
    const active = await readActiveProposals(tx, review.binding.id);
    const selection = selectProposals(review, active, input);
    if (input.decision === "undo") {
      return {
        receipt: await finishDecision(
          tx,
          scope,
          review,
          review.notebook,
          input,
          selection,
          fingerprint,
        ),
      };
    }
    return {
      changes: flattenChanges(selection.selected),
      bindingId: review.binding.id,
    };
  });
  if (prepared.receipt) {
    wakeProposalRun(prepared.receipt.rerunIntentId);
    return prepared.receipt;
  }
  const command = notebookCommandSchema.parse({
    protocol: CONTRACT_VERSION,
    projectId: input.projectId,
    workingVersionId: input.observedHead.versionId,
    opId: `review:${prepared.bindingId}:${input.opId}`,
    observedHead: input.observedHead,
    changes: prepared.changes,
  });
  let locked:
    | { review: ProposalContext; selection: ReturnType<typeof selectProposals> }
    | undefined;
  await applyNotebookOperation(scope, command, false, {
    lockOutputs: async (tx, cellIds) => {
      await lockReviewRunOutputs(
        scope,
        {
          bindingId: prepared.bindingId,
          threadId: input.threadId,
          cellIds,
        },
        tx,
      );
    },
    validate: async (tx) => {
      const review = await context(scope, input, tx, "update");
      if (review.binding.id !== prepared.bindingId)
        overlayConflict(review.binding, review.notebook.snapshot.head);
      const rows = await readActiveProposals(tx, review.binding.id);
      locked = { review, selection: selectProposals(review, rows, input) };
    },
    commit: async (tx, _project, operation) => {
      if (!locked) throw new Error("The notebook review lock is required");
      if (operation.status === "conflict")
        baseChanged(
          operation.previousHead,
          locked.selection.selected.map(({ id }) => id),
        );
      const project = await lockNotebookProject(
        scope,
        input.projectId,
        tx,
        "update",
      );
      const accepted = await projectSnapshot(scope, project, tx);
      const selected = new Set(
        locked.selection.selected.map(({ cellId }) => cellId),
      );
      const cellIds = affectedRunnableCells(
        locked.review.notebook.cells,
        accepted.cells,
      ).filter((id) => selected.has(id));
      const promoted = await promoteReviewedSqlResults(
        scope,
        {
          bindingId: prepared.bindingId,
          threadId: input.threadId,
          projectId: input.projectId,
          cellIds,
        },
        tx,
      );
      await finishDecision(
        tx,
        scope,
        locked.review,
        accepted,
        input,
        locked.selection,
        fingerprint,
        promoted,
      );
    },
  });
  const receipt = await db.transaction(async (tx) => {
    const binding = await requireNotebookThreadBinding(scope, input, tx);
    const result = await readReceipt(
      tx,
      binding,
      scope,
      input.opId,
      fingerprint,
    );
    if (result === null)
      throw new Error("The notebook review receipt is missing");
    return notebookProposalDecisionSchema.parse(result);
  });
  wakeProposalRun(receipt.rerunIntentId);
  return receipt;
}
