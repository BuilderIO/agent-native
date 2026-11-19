import { normalizeColumnRatios, parseColumnRatio } from "@shared/column-ratios";
import { Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Mapping, ReplaceAroundStep } from "@tiptap/pm/transform";

export const COLUMNS_NODE = "notionColumns";
export const COLUMN_NODE = "notionColumn";

/** A column left holding only the empty paragraph ProseMirror puts there. */
function isBlankColumn(column: ProseMirrorNode) {
  const only = column.childCount === 1 ? column.firstChild : null;
  return only?.type.name === "paragraph" && only.content.size === 0;
}

/** The column sets in `oldDoc` that the changes reach into, by position. */
function columnSetsTouchedBy(
  transactions: readonly Transaction[],
  oldDoc: ProseMirrorNode,
): Map<number, ProseMirrorNode> {
  const found = new Map<number, ProseMirrorNode>();
  const mapping = new Mapping();
  for (const transaction of transactions) {
    for (const stepMap of transaction.mapping.maps) {
      const back = mapping.invert();
      stepMap.forEach((start, end) => {
        oldDoc.nodesBetween(
          back.map(start, -1),
          back.map(end, 1),
          (node, pos) => {
            if (node.type.name === COLUMNS_NODE) found.set(pos, node);
          },
        );
      });
      mapping.appendMap(stepMap);
    }
  }
  return found;
}

/**
 * Where the node that started at `pos` starts after the changes, or null once
 * its opening token is gone. It asks about the position just inside the node:
 * `deletedAfter` at `pos` itself is also true when something is only inserted
 * there, such as a block dropped right before the node.
 */
function mapKept(
  transactions: readonly Transaction[],
  pos: number,
): number | null {
  let inside = pos + 1;
  for (const transaction of transactions) {
    const result = transaction.mapping.mapResult(inside, -1);
    if (result.deletedBefore) return null;
    inside = result.pos;
  }
  return inside - 1;
}

interface ColumnSetRepair {
  pos: number;
  columnsBefore: number;
  emptied: number[];
}

/**
 * What the changes did to each column set they reached: where it is now, how
 * many columns it had, and which columns lost every block they held. Moving or
 * deleting a column's only block leaves the column one empty paragraph, as
 * ProseMirror refills it; clearing its text keeps the paragraph it was in.
 */
function columnSetRepairs(
  transactions: readonly Transaction[],
  oldDoc: ProseMirrorNode,
  newDoc: ProseMirrorNode,
): ColumnSetRepair[] {
  const repairs: ColumnSetRepair[] = [];
  for (const [oldPos, oldSet] of columnSetsTouchedBy(transactions, oldDoc)) {
    const pos = mapKept(transactions, oldPos);
    if (pos === null || newDoc.nodeAt(pos)?.type.name !== COLUMNS_NODE)
      continue;
    const emptied: number[] = [];
    oldSet.forEach((column, columnOffset) => {
      const columnPos = oldPos + 1 + columnOffset;
      let everyBlockGone = column.childCount > 0;
      column.forEach((_block, blockOffset) => {
        if (mapKept(transactions, columnPos + 1 + blockOffset) !== null)
          everyBlockGone = false;
      });
      if (!everyBlockGone) return;
      const after = mapKept(transactions, columnPos);
      if (after === null) return;
      const node = newDoc.nodeAt(after);
      if (node?.type.name === COLUMN_NODE && isBlankColumn(node))
        emptied.push(after);
    });
    repairs.push({ pos, columnsBefore: oldSet.childCount, emptied });
  }
  return repairs.sort((left, right) => right.pos - left.pos);
}

/**
 * Keeps column sets as Notion keeps them after this tab's edits. A column
 * whose blocks all moved or were deleted goes away, a set left with one column
 * becomes that column's blocks, and when a set's columns change, their widths
 * still add up to the whole row. Sets the edits didn't reach stay as they
 * are, including one-column sets a page or an agent wrote.
 */
export function repairColumnSets(
  transactions: readonly Transaction[],
  oldState: EditorState,
  newState: EditorState,
): Transaction | null {
  const repairs = columnSetRepairs(transactions, oldState.doc, newState.doc);
  if (repairs.length === 0) return null;
  const tr = newState.tr;
  for (const repair of repairs) {
    const pos = tr.mapping.map(repair.pos);
    const set = tr.doc.nodeAt(pos);
    if (set?.type.name !== COLUMNS_NODE) continue;
    const emptied = repair.emptied
      .map((at) => tr.mapping.map(at))
      .filter((at) => tr.doc.nodeAt(at)?.type.name === COLUMN_NODE);
    // Every column emptied at once leaves nothing to keep; leave the set.
    if (emptied.length < set.childCount) {
      for (const at of emptied.sort((left, right) => right - left)) {
        const column = tr.doc.nodeAt(at);
        if (column) tr.delete(at, at + column.nodeSize);
      }
    }
    const current = tr.doc.nodeAt(pos);
    if (!current) continue;
    if (current.childCount === 1 && repair.columnsBefore > 1) {
      const end = pos + current.nodeSize;
      tr.step(
        new ReplaceAroundStep(pos, end, pos + 2, end - 2, Slice.empty, 0, true),
      );
      continue;
    }
    const ratios: (number | null)[] = [];
    current.forEach((column) =>
      ratios.push(parseColumnRatio(column.attrs.ratio)),
    );
    const normalized = normalizeColumnRatios(ratios);
    current.forEach((column, offset, index) => {
      if (normalized[index] !== ratios[index])
        tr.setNodeAttribute(pos + 1 + offset, "ratio", normalized[index]);
    });
  }
  return tr.docChanged ? tr : null;
}
