import {
  deleteBlockTransaction,
  duplicateBlockTransaction,
  isListItem,
  joinListsAt,
  listItemTypeOf,
} from "@agent-native/toolkit/editor";
import {
  CLIP_EMBED_BLOCK_TYPE,
  clipEmbedOriginFromRaw,
} from "@shared/clip-embed-block";
import {
  Fragment,
  type Node as ProseMirrorNode,
  type NodeType,
} from "@tiptap/pm/model";
import {
  type EditorState,
  type Selection,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import { findWrapping } from "@tiptap/pm/transform";

import { blockMenuEntry } from "./block-menu-registry";
import {
  TOGGLE_TITLE_NODE,
  toggleTitleNode,
} from "./extensions/NotionExtensions";
import { isSourceComponentNode } from "./extensions/registryBlocks";
import {
  isSuggestingEdits,
  SUGGESTING_REFUSAL_PROBE,
} from "./suggestions/read-only-blocks";

export const TURN_INTO_TARGETS = [
  "text",
  "heading1",
  "heading2",
  "heading3",
  "bulletedList",
  "numberedList",
  "todoList",
  "toggle",
  "toggleHeading1",
  "toggleHeading2",
  "toggleHeading3",
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

const TOGGLE_HEADINGS: Partial<Record<TurnIntoTarget, number>> = {
  toggleHeading1: 1,
  toggleHeading2: 2,
  toggleHeading3: 3,
};

const LIST_ITEMS: Record<string, string> = {
  bulletList: "listItem",
  orderedList: "listItem",
  taskList: "taskItem",
};

function isTitledToggle(node: ProseMirrorNode) {
  return node.type.name === "notionToggle" && !!toggleTitleNode(node);
}

/** Whether the block menu can turn this block into another kind. */
export function canTurnInto(node: ProseMirrorNode) {
  const { turnInto } = blockMenuEntry(node);
  return typeof turnInto === "function" ? turnInto(node) : turnInto === true;
}

const LIST_TARGETS: Partial<Record<string, TurnIntoTarget>> = {
  bulletList: "bulletedList",
  orderedList: "numberedList",
  taskList: "todoList",
};

export function currentTurnIntoTarget(
  node: ProseMirrorNode,
  parent: ProseMirrorNode | null = null,
): TurnIntoTarget | null {
  if (isListItem(node)) return LIST_TARGETS[parent?.type.name ?? ""] ?? null;
  if (node.type.name === "paragraph") return "text";
  if (node.type.name === "heading" && [1, 2, 3].includes(node.attrs.level)) {
    return `heading${node.attrs.level}` as TurnIntoTarget;
  }
  if (isTitledToggle(node)) {
    return node.attrs.headingLevel
      ? (`toggleHeading${node.attrs.headingLevel}` as TurnIntoTarget)
      : "toggle";
  }
  return null;
}

// Attributes both kinds have, such as a block colour, carry over.
export function carriedAttrs(
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
 * A Toggle's title makes the new block, as in Notion. Its body stays under a
 * list item or quote, which can hold it, and otherwise follows as plain blocks.
 */
function turnToggleInto(
  tr: Transaction,
  pos: number,
  toggle: ProseMirrorNode,
  target: TurnIntoTarget,
): boolean {
  const title = toggleTitleNode(toggle);
  if (!title) return false;
  const { schema } = tr.doc.type;
  const headingLevel = TOGGLE_HEADINGS[target];
  if (target === "toggle" || headingLevel) {
    tr.setNodeAttribute(pos, "headingLevel", headingLevel ?? null);
    return true;
  }
  const paragraph = schema.nodes.paragraph as NodeType | undefined;
  if (!paragraph) return false;
  const body = toggle.content.cut(title.nodeSize);
  const line = (type: NodeType, attrs?: Record<string, unknown>) =>
    type.create(carriedAttrs(toggle, type, attrs), title.content);
  const wrapper = WRAPPERS[target];
  let blocks: Fragment;
  if (wrapper) {
    const type = schema.nodes[wrapper] as NodeType | undefined;
    const itemName = LIST_ITEMS[wrapper];
    const item = itemName
      ? (schema.nodes[itemName] as NodeType | undefined)
      : undefined;
    const lines = Fragment.from(paragraph.create(null, title.content)).append(
      body,
    );
    if (!type || (itemName && !item)) return false;
    if (!(item ?? type).validContent(lines)) return false;
    blocks = Fragment.from(
      type.create(null, item ? item.create(null, lines) : lines),
    );
  } else if (target === "codeBlock") {
    const code = schema.nodes.codeBlock as NodeType | undefined;
    if (!code) return false;
    const text = title.textBetween(0, title.content.size, undefined, "\n");
    blocks = Fragment.from(
      code.create(null, text ? schema.text(text) : null),
    ).append(body);
  } else if (target === "text") {
    blocks = Fragment.from(line(paragraph)).append(body);
  } else {
    const heading = schema.nodes.heading as NodeType | undefined;
    if (!heading) return false;
    blocks = Fragment.from(
      line(heading, { level: Number(target.slice(-1)) }),
    ).append(body);
  }
  tr.replaceWith(pos, pos + toggle.nodeSize, blocks);
  return true;
}

function isolateListItem(tr: Transaction, pos: number): number {
  const $pos = tr.doc.resolve(pos);
  const item = $pos.nodeAfter;
  const index = $pos.index();
  if (item && index < $pos.parent.childCount - 1) {
    tr.split(pos + item.nodeSize);
  }
  if (index === 0) return $pos.before();
  tr.split(pos);
  return pos + 1;
}

function caretAtEnd(tr: Transaction, from: number, steps: number) {
  const end = tr.mapping.slice(steps).map(from, -1);
  tr.setSelection(TextSelection.near(tr.doc.resolve(end), -1));
}

function turnListItemInto(
  tr: Transaction,
  pos: number,
  target: TurnIntoTarget,
): boolean {
  const { schema } = tr.doc.type;
  const wrapper = WRAPPERS[target];
  const $pos = tr.doc.resolve(pos);
  if (wrapper === $pos.parent.type.name) {
    const first = $pos.nodeAfter?.firstChild;
    if (first) caretAtEnd(tr, pos + first.nodeSize, tr.steps.length);
    return !!first;
  }
  const listPos = isolateListItem(tr, pos);
  const list = tr.doc.nodeAt(listPos);
  const item = list?.firstChild;
  const line = item?.firstChild;
  if (!list || !item || line?.type.name !== "paragraph") return false;
  const listType = wrapper
    ? (schema.nodes[wrapper] as NodeType | undefined)
    : undefined;
  const itemType = listType && listItemTypeOf(listType);
  if (listType && itemType) {
    const turned = listType.create(
      listType === list.type ? list.attrs : null,
      itemType.create(carriedAttrs(item, itemType), item.content, item.marks),
    );
    tr.replaceWith(listPos, listPos + list.nodeSize, turned);
    const steps = tr.steps.length;
    joinListsAt(tr, listPos + turned.nodeSize);
    joinListsAt(tr, listPos);
    caretAtEnd(tr, listPos + 1 + line.nodeSize, steps);
    return true;
  }
  const headingLevel = TOGGLE_HEADINGS[target];
  if (target === "toggle" || headingLevel) {
    const toggle = schema.nodes.notionToggle as NodeType | undefined;
    const title = schema.nodes[TOGGLE_TITLE_NODE] as NodeType | undefined;
    const content = title
      ? Fragment.from(title.create(null, line.content)).append(
          item.content.cut(line.nodeSize),
        )
      : null;
    if (!toggle || !content || !toggle.validContent(content)) return false;
    tr.replaceWith(
      listPos,
      listPos + list.nodeSize,
      toggle.create(
        carriedAttrs(line, toggle, {
          open: true,
          headingLevel: headingLevel ?? null,
        }),
        content,
      ),
    );
    caretAtEnd(tr, listPos + line.nodeSize, tr.steps.length);
    return true;
  }
  tr.replaceWith(listPos, listPos + list.nodeSize, item.content);
  const steps = tr.steps.length;
  if (target === "quote") {
    const quote = schema.nodes.blockquote as NodeType | undefined;
    const range = tr.doc
      .resolve(listPos + 1)
      .blockRange(tr.doc.resolve(listPos + item.content.size - 1));
    const wrapping = range && quote && findWrapping(range, quote);
    if (!range || !wrapping) return false;
    tr.wrap(range, wrapping);
  } else if (!turnBlockInto(tr, listPos, target)) {
    return false;
  }
  caretAtEnd(tr, listPos + line.nodeSize - 1, steps);
  return true;
}

/** Code holds only text and line breaks, so anything else on a line would go. */
function fitsInCode(line: ProseMirrorNode): boolean {
  return line.content.content.every(
    (node) => node.isText || node.type.name === "hardBreak",
  );
}

/**
 * Turns the paragraph, heading or Toggle at `pos` into `target`, keeping its
 * text. Returns false when it can't, after which `tr` must be dropped.
 */
export function turnBlockInto(
  tr: Transaction,
  pos: number,
  target: TurnIntoTarget,
): boolean {
  const node = tr.doc.nodeAt(pos);
  if (!node || !canTurnInto(node)) return false;
  if (isListItem(node)) {
    if (
      target === "codeBlock" &&
      node.firstChild &&
      !fitsInCode(node.firstChild)
    ) {
      return false;
    }
    return turnListItemInto(tr, pos, target);
  }
  if (target === "codeBlock" && !fitsInCode(toggleTitleNode(node) ?? node)) {
    return false;
  }
  if (isTitledToggle(node)) return turnToggleInto(tr, pos, node, target);
  const { schema } = tr.doc.type;
  if (target === "toggle" || TOGGLE_HEADINGS[target]) {
    const toggle = schema.nodes.notionToggle as NodeType | undefined;
    const title = schema.nodes[TOGGLE_TITLE_NODE] as NodeType | undefined;
    if (!toggle || !title) return false;
    tr.replaceWith(
      pos,
      pos + node.nodeSize,
      toggle.create(
        carriedAttrs(node, toggle, {
          open: true,
          headingLevel: TOGGLE_HEADINGS[target] ?? null,
        }),
        title.create(null, node.content),
      ),
    );
    return true;
  }
  const setType = (
    type: NodeType | undefined,
    attrs?: Record<string, unknown>,
  ) => {
    const current = tr.doc.nodeAt(pos);
    if (!type || !current) return false;
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
    const paragraph = tr.doc.nodeAt(pos);
    if (!paragraph) return false;
    const range = tr.doc
      .resolve(pos + 1)
      .blockRange(tr.doc.resolve(pos + paragraph.nodeSize - 1));
    const type = schema.nodes[wrapper] as NodeType | undefined;
    const wrapping = range && type && findWrapping(range, type);
    if (!range || !wrapping) return false;
    tr.wrap(range, wrapping);
    const wrapped = tr.doc.nodeAt(pos);
    if (wrapped) joinListsAt(tr, pos + wrapped.nodeSize);
    joinListsAt(tr, pos);
    return true;
  }
  if (target === "text") return setType(schema.nodes.paragraph);
  if (target === "codeBlock") return setType(schema.nodes.codeBlock);
  return setType(schema.nodes.heading, { level: Number(target.slice(-1)) });
}

export function selectedListItem(selection: Selection) {
  const { $from, $to } = selection;
  if ($from.depth < 2 || !$from.sameParent($to) || !$from.parent.isTextblock) {
    return null;
  }
  const item = $from.node(-1);
  return isListItem(item) && $from.index(-1) === 0
    ? { node: item, pos: $from.before(-1) }
    : null;
}

export function turnSelectedListItemInto(
  tr: Transaction,
  target: TurnIntoTarget,
): boolean {
  const item = selectedListItem(tr.selection);
  if (!item) return false;
  const from = tr.selection.$from.parentOffset;
  const to = tr.selection.$to.parentOffset;
  if (!turnBlockInto(tr, item.pos, target)) return false;
  const { $from } = tr.selection;
  const end = $from.end();
  tr.setSelection(
    TextSelection.create(
      tr.doc,
      Math.min($from.start() + from, end),
      Math.min($from.start() + to, end),
    ),
  );
  return true;
}

/** The text a comment on this block quotes, or null when it has none. */
export function blockCommentRange(node: ProseMirrorNode, pos: number) {
  if (node.isAtom || node.type.name === "table" || !node.textContent.trim()) {
    return null;
  }
  if (isListItem(node)) {
    const line = node.firstChild;
    return line?.textContent.trim()
      ? { from: pos + 2, to: pos + line.nodeSize }
      : null;
  }
  // A comment on a Toggle is about its own line, not everything folded in it.
  const title = toggleTitleNode(node);
  if (title) {
    return title.textContent.trim()
      ? { from: pos + 2, to: pos + title.nodeSize }
      : null;
  }
  return { from: pos + 1, to: pos + node.nodeSize - 1 };
}

export function blockColorTarget(node: ProseMirrorNode, pos: number) {
  const line = node.firstChild;
  return isListItem(node) && line?.type.name === "paragraph"
    ? { node: line, pos: pos + 1 }
    : { node, pos };
}

/** Why the page refuses an action on a block, when it does. */
export type BlockLock =
  | "source"
  | "suggesting"
  | "page"
  | "collection"
  | "uploadedClip";

function refuses(state: EditorState, tr: Transaction) {
  tr.setMeta(SUGGESTING_REFUSAL_PROBE, true);
  return state.plugins.some(
    (plugin) =>
      plugin.spec.filterTransaction &&
      !plugin.spec.filterTransaction.call(plugin, tr, state),
  );
}

function contains(
  node: ProseMirrorNode,
  test: (node: ProseMirrorNode) => boolean,
) {
  if (test(node)) return true;
  let found = false;
  node.descendants((child) => {
    found ||= test(child);
    return !found;
  });
  return found;
}

function containsSourceComponent(node: ProseMirrorNode) {
  return contains(node, isSourceComponentNode);
}

function isInlineCollection(node: ProseMirrorNode) {
  return (
    node.type.name === "registryBlock" &&
    node.attrs.blockType === "inline-database"
  );
}

function isUploadedClip(node: ProseMirrorNode) {
  return (
    node.type.name === "registryBlock" &&
    node.attrs.blockType === CLIP_EMBED_BLOCK_TYPE &&
    clipEmbedOriginFromRaw(node.attrs.__raw) === "upload"
  );
}

function moveLock(node: ProseMirrorNode): BlockLock | null {
  if (contains(node, isInlineCollection)) return "collection";
  if (contains(node, isUploadedClip)) return "uploadedClip";
  return null;
}

/**
 * Whether the page would let the menu duplicate or delete the block at `pos`.
 * Asks the page's filters about the drag handle's own edits, so the menu can
 * say why before anyone tries.
 */
export function blockActionLocks(
  state: EditorState,
  pos: number,
  node: ProseMirrorNode,
): {
  duplicate: BlockLock | null;
  remove: BlockLock | null;
  move: BlockLock | null;
} {
  const duplicate = duplicateBlockTransaction(state, pos, node);
  const remove = deleteBlockTransaction(state, pos, node);
  const lock = containsSourceComponent(node)
    ? "source"
    : isSuggestingEdits(state)
      ? "suggesting"
      : "page";
  const removeLock = refuses(state, remove) ? lock : null;
  return {
    duplicate: !duplicate || refuses(state, duplicate) ? lock : null,
    remove: removeLock,
    move: removeLock ?? moveLock(node),
  };
}
