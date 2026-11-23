import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import type { CellContents } from "../../../app/lib/model/contracts.js";
import { notebookCellSymbol } from "../../../shared/notebook-cell-edits.js";
import {
  notebookDeltaSchema,
  type NotebookDelta,
  type NotebookEvent,
} from "../../../shared/notebook-operations.js";
import { sectionParent } from "../../../shared/notebook-sections.js";
import type { Revision } from "../../../shared/notebook-snapshot-contract.js";

export const notebookUndoPlanSchema = z.strictObject({
  before: notebookDeltaSchema,
  after: notebookDeltaSchema,
});

export type NotebookUndoPlan = z.infer<typeof notebookUndoPlanSchema>;

export function cellBody({
  label: _label,
  order: _order,
  parentSectionId: _parentSectionId,
  ...body
}: CellContents) {
  return body;
}

export function inversePlan(event: NotebookEvent): NotebookUndoPlan {
  return { before: event.before, after: event.receipt.delta };
}

export function inverseCells({ before, after }: NotebookUndoPlan) {
  const prior = new Map(before.cells.map((cell) => [cell.id, cell]));
  const beforeTombstones = new Map<
    string,
    NotebookUndoPlan["before"]["tombstones"][number]
  >(before.tombstones.map((row) => [row.cellId, row]));
  return [
    ...after.cells.map((expected) => ({
      id: expected.id,
      expected,
      target: prior.get(expected.id),
      targetTombstone: beforeTombstones.get(expected.id),
      expectedTombstone: undefined,
    })),
    ...after.tombstones.map((expectedTombstone) => ({
      id: expectedTombstone.cellId,
      expected: undefined,
      target: prior.get(expectedTombstone.cellId),
      targetTombstone: undefined,
      expectedTombstone,
    })),
  ];
}

export function isUndoable(plan: NotebookUndoPlan) {
  if (plan.after.metadata) return false;
  return inverseCells(plan).some(
    ({ target, expected }) =>
      !target ||
      !expected ||
      target.contents.order !== expected.contents.order ||
      sectionParent(target) !== sectionParent(expected) ||
      target.contents.label !== expected.contents.label ||
      target.contents.kind !== expected.contents.kind ||
      notebookCellSymbol(target.contents) !==
        notebookCellSymbol(expected.contents),
  );
}

export function inverseRevisions(plan: NotebookUndoPlan) {
  const { before, after } = plan;
  const guards: {
    key: string;
    expected?: Revision | undefined;
    target?: Revision | undefined;
  }[] = [];
  if (before.resources.orderRevision !== after.resources.orderRevision)
    guards.push({
      key: "order",
      expected: after.resources.orderRevision,
      target: before.resources.orderRevision,
    });
  if (before.resources.layoutRevision !== after.resources.layoutRevision)
    guards.push({
      key: "layout",
      expected: after.resources.layoutRevision,
      target: before.resources.layoutRevision,
    });
  for (const {
    id,
    target,
    expected,
    expectedTombstone,
    targetTombstone,
  } of inverseCells(plan)) {
    if (
      !expected ||
      !target ||
      !isDeepStrictEqual(cellBody(expected.contents), cellBody(target.contents))
    )
      guards.push({
        key: `cell:${id}`,
        expected: expected?.revision,
        target: target?.revision,
      });
    if (
      !expected ||
      !target ||
      expected.contents.label !== target.contents.label
    )
      guards.push({
        key: `label:${id}`,
        expected: expected?.labelRevision,
        target: target?.labelRevision,
      });
    if (expectedTombstone)
      guards.push({
        key: `tombstone:${id}`,
        expected: expectedTombstone.revision,
      });
    if (targetTombstone)
      guards.push({ key: `tombstone:${id}`, target: targetTombstone.revision });
  }
  return guards;
}

export function resourceRevisions({
  cells,
  tombstones,
  resources,
}: NotebookDelta) {
  const revisions = new Map<string, Revision>([
    ["order", resources.orderRevision],
    ["layout", resources.layoutRevision],
  ]);
  for (const cell of cells) {
    revisions.set(`cell:${cell.id}`, cell.revision);
    revisions.set(`label:${cell.id}`, cell.labelRevision);
  }
  for (const row of tombstones)
    revisions.set(`tombstone:${row.cellId}`, row.revision);
  return revisions;
}
