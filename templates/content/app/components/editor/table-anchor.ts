import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { type Item, XmlElement, type XmlFragment } from "yjs";

import type { TableAt } from "./table-commands";

// The part of the editor's binding to its live copy that an anchor reads: the
// page in the live copy, and the editor's node for each of its parts.
interface LiveCopy {
  type: XmlFragment;
  mapping: Map<unknown, unknown>;
}

function liveCopy(state: EditorState) {
  const binding = ySyncPluginKey.getState(state)?.binding as
    | LiveCopy
    | null
    | undefined;
  return binding ?? null;
}

/**
 * A table as a drag found it. While the drag goes on, a collaborator can add
 * a row to it, or a table above it, so the drag finds it again each time with
 * `findAnchoredTable` rather than trusting where it was.
 */
export interface TableAnchor {
  doc: ProseMirrorNode;
  pos: number;
  // The table in the live copy, and its rows and their cells there, which
  // keep who they are through everyone's edits.
  live: { table: XmlElement; parts: unknown[] } | null;
}

// A part of the live copy, as far as walking up from it to the page needs.
interface LivePart {
  _item: Item | null;
  readonly parent: LivePart | null;
}

// Whether `type` is still in the page: neither it nor anything it's in has
// been deleted.
function isInPage(type: LivePart, page: XmlFragment) {
  let current: LivePart | null = type;
  while (current && current !== page) {
    if (!current._item || current._item.deleted) return false;
    current = current.parent;
  }
  return current === page;
}

// The table's rows in order, each followed by its cells.
function tableParts(table: XmlElement) {
  return table
    .toArray()
    .flatMap((row) =>
      row instanceof XmlElement ? [row, ...row.toArray()] : [row],
    );
}

export function anchorTable(state: EditorState, table: TableAt): TableAnchor {
  const copy = liveCopy(state);
  let live: TableAnchor["live"] = null;
  // A part the live copy has deleted can still be listed with its old node.
  for (const [type, node] of copy?.mapping ?? []) {
    if (node !== table.node || !(type instanceof XmlElement)) continue;
    if (!copy || !isInPage(type, copy.type)) continue;
    live = { table: type, parts: tableParts(type) };
    break;
  }
  return { doc: state.doc, pos: table.pos, live };
}

/**
 * The anchored table as it is now, while its rows and cells are the ones it
 * had: none added, removed or merged since, by anyone. Without a live copy,
 * that can only be told while the page hasn't changed at all.
 */
export function findAnchoredTable(
  state: EditorState,
  anchor: TableAnchor,
): TableAt | null {
  if (state.doc === anchor.doc) {
    const node = state.doc.nodeAt(anchor.pos);
    return node ? { node, pos: anchor.pos } : null;
  }
  const copy = liveCopy(state);
  const live = anchor.live;
  if (!copy || !live || !isInPage(live.table, copy.type)) return null;
  const parts = tableParts(live.table);
  const unchanged =
    parts.length === live.parts.length &&
    parts.every((part, index) => part === live.parts[index]);
  if (!unchanged) return null;

  const node = copy.mapping.get(live.table);
  let result: TableAt | null = null;
  state.doc.descendants((child, pos) => {
    if (result) return false;
    if (child === node) {
      result = { node: child, pos };
      return false;
    }
    return !child.isTextblock;
  });
  return result;
}
