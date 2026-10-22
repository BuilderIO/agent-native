import type { Node as ProseMirrorNode, NodeType } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { findWrapping } from "@tiptap/pm/transform";

import { isSourceComponentNode } from "./extensions/registryBlocks";
import { isSuggestingEdits } from "./suggestions/read-only-blocks";

export const TURN_INTO_TARGETS = [
  "text",
  "heading1",
  "heading2",
  "heading3",
  "bulletedList",
  "numberedList",
  "todoList",
  "quote",
  "codeBlock",
] as const;

export type TurnIntoTarget = (typeof TURN_INTO_TARGETS)[number];

const WRAPPERS: Partial<Record<TurnIntoTarget, string>> = {
  bulletedList: "bulletList",
  numberedList: "orderedList",
  todoList: "taskList",
  quote: "blockquote",
};

/** Whether the block menu can turn this block into another kind. */
export function canTurnInto(node: ProseMirrorNode) {
  return node.type.name === "paragraph" || node.type.name === "heading";
}

export function currentTurnIntoTarget(
  node: ProseMirrorNode,
): TurnIntoTarget | null {
  if (node.type.name === "paragraph") return "text";
  if (node.type.name === "heading" && [1, 2, 3].includes(node.attrs.level)) {
    return `heading${node.attrs.level}` as TurnIntoTarget;
  }
  return null;
}

// Attributes both kinds have, such as a block colour, carry over.
function carriedAttrs(
  from: ProseMirrorNode,
  to: NodeType,
  attrs: Record<string, unknown> = {},
) {
  const carried: Record<string, unknown> = {};
  for (const name of Object.keys(to.spec.attrs ?? {})) {
    if (name in from.attrs) carried[name] = from.attrs[name];
  }
  return { ...carried, ...attrs };
}

/**
 * Turns the paragraph or heading at `pos` into `target`, keeping its text.
 * Returns false when it can't, after which `tr` must be dropped.
 */
export function turnBlockInto(
  tr: Transaction,
  pos: number,
  target: TurnIntoTarget,
): boolean {
  const node = tr.doc.nodeAt(pos);
  if (!node || !canTurnInto(node)) return false;
  const { schema } = tr.doc.type;
  const setType = (
    type: NodeType | undefined,
    attrs?: Record<string, unknown>,
  ) => {
    if (!type) return false;
    const current = tr.doc.nodeAt(pos)!;
    tr.setBlockType(
      pos,
      pos + current.nodeSize,
      type,
      carriedAttrs(current, type, attrs),
    );
    return true;
  };

  const wrapper = WRAPPERS[target];
  if (wrapper) {
    // List items and quotes hold paragraphs, so a heading becomes one first.
    if (node.type.name !== "paragraph" && !setType(schema.nodes.paragraph)) {
      return false;
    }
    const paragraph = tr.doc.nodeAt(pos)!;
    const range = tr.doc
      .resolve(pos + 1)
      .blockRange(tr.doc.resolve(pos + paragraph.nodeSize - 1));
    const type = schema.nodes[wrapper];
    const wrapping = range && type && findWrapping(range, type);
    if (!range || !wrapping) return false;
    tr.wrap(range, wrapping);
    return true;
  }
  if (target === "text") return setType(schema.nodes.paragraph);
  if (target === "codeBlock") return setType(schema.nodes.codeBlock);
  return setType(schema.nodes.heading, { level: Number(target.slice(-1)) });
}

/** The menu title for a block: what kind of block it is. */
export function blockTitleKey(node: ProseMirrorNode): string {
  switch (node.type.name) {
    case "paragraph":
      return "editor.slash.text";
    case "heading":
      return `editor.heading${node.attrs.level}`;
    case "bulletList":
      return "editor.slash.bulletedList";
    case "orderedList":
      return "editor.slash.numberedList";
    case "taskList":
      return "editor.slash.todoList";
    case "blockquote":
      return "editor.slash.quote";
    case "codeBlock":
      return "editor.slash.codeBlock";
    case "notionCallout":
      return "editor.slash.callout";
    case "notionToggle":
      return "editor.slash.toggle";
    case "table":
      return "editor.slash.table";
    case "horizontalRule":
      return "editor.slash.divider";
    case "image":
      return "editor.slash.image";
    case "video":
      return "editor.slash.video";
    case "audio":
      return "editor.slash.audio";
    default:
      return "editor.blockMenu.block";
  }
}

/** The text a comment on this block quotes, or null when it has none. */
export function blockCommentRange(node: ProseMirrorNode, pos: number) {
  if (node.isAtom || node.type.name === "table" || !node.textContent.trim()) {
    return null;
  }
  return { from: pos + 1, to: pos + node.nodeSize - 1 };
}

/** Why the page refuses an action on a block, when it does. */
export type BlockLock = "source" | "suggesting" | "page";

function refuses(state: EditorState, tr: Transaction) {
  return state.plugins.some(
    (plugin) =>
      plugin.spec.filterTransaction &&
      !plugin.spec.filterTransaction.call(plugin, tr, state),
  );
}

function containsSourceComponent(node: ProseMirrorNode) {
  if (isSourceComponentNode(node)) return true;
  let found = false;
  node.descendants((child) => {
    found ||= isSourceComponentNode(child);
    return !found;
  });
  return found;
}

/**
 * Whether the page would let the menu duplicate or delete the block at `pos`.
 * Asks the same filters that would refuse the edit, so the menu can say why
 * before anyone tries.
 */
export function blockActionLocks(
  state: EditorState,
  pos: number,
  node: ProseMirrorNode,
): { duplicate: BlockLock | null; remove: BlockLock | null } {
  const end = pos + node.nodeSize;
  const paragraph = state.schema.nodes.paragraph;
  const duplicate = state.tr.insert(end, node);
  // As the drag handle deletes: the last block leaves an empty paragraph.
  const remove =
    state.doc.childCount <= 1 && paragraph
      ? state.tr.replaceWith(pos, end, paragraph.createAndFill()!)
      : state.tr.delete(pos, end);
  const lock = containsSourceComponent(node)
    ? "source"
    : isSuggestingEdits(state)
      ? "suggesting"
      : "page";
  return {
    duplicate: refuses(state, duplicate) ? lock : null,
    remove: refuses(state, remove) ? lock : null,
  };
}
