import type { Node as ProseMirrorNode, NodeType } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { canJoin } from "@tiptap/pm/transform";

const LIST_ITEM_TYPES = new Set(["listItem", "taskItem"]);

/** Whether the node is one item of a bulleted, numbered or to-do list. */
export function isListItem(node: ProseMirrorNode | null | undefined): boolean {
  return !!node && LIST_ITEM_TYPES.has(node.type.name);
}

/** The kind of item a list of this type holds, or null for any other type. */
export function listItemTypeOf(type: NodeType): NodeType | null {
  const item = type.contentMatch.defaultType;
  return item && LIST_ITEM_TYPES.has(item.name) ? item : null;
}

/** Whether the node is a list, whose children are its items. */
export function isList(node: ProseMirrorNode | null | undefined): boolean {
  return !!node && !!listItemTypeOf(node.type);
}

/**
 * Calls `visit` with each block the page shows a grip for, in document order:
 * each top-level block, except that a list gives each of its items, and each
 * item is followed by the items of the lists nested in it.
 */
export function forEachListItemBlock(
  doc: ProseMirrorNode,
  visit: (node: ProseMirrorNode, pos: number) => void,
): void {
  const visitItems = (list: ProseMirrorNode, listPos: number) => {
    list.forEach((item, offset) => {
      const itemPos = listPos + 1 + offset;
      visit(item, itemPos);
      item.forEach((child, childOffset) => {
        if (isList(child)) visitItems(child, itemPos + 1 + childOffset);
      });
    });
  };
  doc.forEach((node, offset) => {
    if (isList(node)) visitItems(node, offset);
    else visit(node, offset);
  });
}

/**
 * Where a block dropped just below this one lands: under an item with nested
 * items, that is before the first of them.
 */
export function positionBelowBlock(node: ProseMirrorNode, pos: number) {
  const nested = isListItem(node) ? nestedListOffset(node) : null;
  return nested === null ? pos + node.nodeSize : pos + 1 + nested + 1;
}

export function nestedListOffset(item: ProseMirrorNode): number | null {
  let offset = 0;
  for (let index = 0; index < item.childCount; index++) {
    const child = item.child(index);
    if (isList(child)) return offset;
    offset += child.nodeSize;
  }
  return null;
}

/**
 * What deleting the block at `pos` removes: the block, or for a list's only
 * item, its list, which can't stay empty.
 */
export function blockRemovalRange(
  doc: ProseMirrorNode,
  pos: number,
  node: ProseMirrorNode,
): { from: number; to: number } {
  let from = pos;
  let to = pos + node.nodeSize;
  let $from = doc.resolve(from);
  while (
    $from.depth > 0 &&
    $from.parent.childCount === 1 &&
    isList($from.parent)
  ) {
    from = $from.before();
    to = $from.after();
    $from = doc.resolve(from);
  }
  return { from, to };
}

function itemAs(item: ProseMirrorNode, type: NodeType): ProseMirrorNode {
  if (item.type === type) return item;
  const attrs: Record<string, unknown> = {};
  for (const name of Object.keys(type.spec.attrs ?? {})) {
    if (name in item.attrs) attrs[name] = item.attrs[name];
  }
  return type.create(attrs, item.content, item.marks);
}

function listTypeFor(
  item: ProseMirrorNode,
  preferred: NodeType | null,
): NodeType | null {
  if (preferred && listItemTypeOf(preferred) === item.type) return preferred;
  const { nodes } = item.type.schema;
  for (const name of ["bulletList", "taskList", "orderedList"]) {
    const type = nodes[name] as NodeType | undefined;
    if (type && listItemTypeOf(type) === item.type) return type;
  }
  return null;
}

/** Joins the lists on both sides of `pos` when they're the same kind. */
export function joinListsAt(tr: Transaction, pos: number): boolean {
  if (pos <= 0 || pos >= tr.doc.content.size) return false;
  const $pos = tr.doc.resolve(pos);
  const { nodeBefore, nodeAfter } = $pos;
  if (
    !nodeBefore ||
    !nodeAfter ||
    !isList(nodeBefore) ||
    nodeBefore.type !== nodeAfter.type ||
    !canJoin(tr.doc, pos)
  ) {
    return false;
  }
  tr.join(pos);
  return true;
}

/**
 * Puts `node` at `pos`, fitted to where it lands. An item between items
 * becomes that list's kind of item; an item anywhere else goes in a list of
 * its own, of `listType` when it came from one; any other block between two
 * items splits their list around it. Lists of one kind left side by side
 * join. Returns where the block starts, or null when it can't go there.
 */
export function insertBlockAt(
  tr: Transaction,
  pos: number,
  node: ProseMirrorNode,
  listType: NodeType | null = null,
): number | null {
  const $pos = tr.doc.resolve(pos);
  const slotItemType = listItemTypeOf($pos.parent.type);
  let insertPos = pos;
  let block = node;
  let offset = 0;
  if (slotItemType && isListItem(node)) {
    block = itemAs(node, slotItemType);
  } else if (slotItemType) {
    const index = $pos.index();
    if (index === 0) {
      insertPos = $pos.before();
    } else if (index === $pos.parent.childCount) {
      insertPos = $pos.after();
    } else {
      tr.split(pos);
      insertPos = pos + 1;
    }
  } else if (isListItem(node)) {
    const type = listTypeFor(node, listType);
    if (!type) return null;
    block = type.create(null, node);
    offset = 1;
  }
  const $insert = tr.doc.resolve(insertPos);
  if (
    !$insert.parent.canReplaceWith($insert.index(), $insert.index(), block.type)
  ) {
    return null;
  }
  tr.insert(insertPos, block);
  const steps = tr.steps.length;
  joinListsAt(tr, insertPos + block.nodeSize);
  joinListsAt(tr, insertPos);
  return tr.mapping.slice(steps).map(insertPos + offset);
}

/**
 * The edit that moves the block at `sourcePos` to `dropPos`, fitted to where
 * it lands as `insertBlockAt` does, or null when it can't move there.
 * Returns where the block now starts.
 */
export function moveBlockTransaction(
  state: EditorState,
  sourcePos: number,
  sourceNode: ProseMirrorNode,
  dropPos: number,
): { tr: Transaction; pos: number } | null {
  const $source = state.doc.resolve(sourcePos);
  const listType = isListItem(sourceNode) ? $source.parent.type : null;
  const { from, to } = blockRemovalRange(state.doc, sourcePos, sourceNode);
  if (dropPos > from && dropPos < to) return null;
  const tr = state.tr.delete(from, to);
  const placed = insertBlockAt(
    tr,
    tr.mapping.map(dropPos),
    sourceNode,
    listType,
  );
  if (placed === null) return null;
  const steps = tr.steps.length;
  joinListsAt(tr, tr.mapping.slice(1).map(from, -1));
  return { tr, pos: tr.mapping.slice(steps).map(placed) };
}
