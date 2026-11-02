import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  safeParseIconValue,
  serializeIconValue,
  type IconValue,
} from "@agent-native/core/icons";
import { findTrailingPlainInlineMath } from "@shared/inline-math";
import { NFM_COLORS, serializeToggleTitle } from "@shared/nfm";
import {
  escapeHtml,
  indentMarkdown,
  serializeTagAttributes,
} from "@shared/notion-markdown";
import {
  IconChevronRight,
  IconChevronDown,
  IconDatabase,
  IconExternalLink,
  IconFileText,
} from "@tabler/icons-react";
import { InputRule, type Editor } from "@tiptap/core";
import { Code } from "@tiptap/extension-code";
import {
  Fragment,
  Slice,
  type DOMOutputSpec,
  type NodeType,
  type Node as ProseMirrorNode,
  type ResolvedPos,
  type Schema,
} from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";
import {
  Mark,
  Node,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  mergeAttributes,
  type NodeViewProps,
} from "@tiptap/react";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { useState } from "react";

import { usePageLinkTarget } from "../../../hooks/use-content-links";
import { ContentIcon } from "../../icons/ContentIcon";
import { EmojiPicker } from "../EmojiPicker";
import { MathRenderer } from "../MathRenderer";
import { isSuggestingEdits } from "../suggestions/read-only-blocks";

const BLOCK_ATOM_TAGS = [
  "page",
  "database",
  "file",
  "pdf",
  "bookmark",
  "embed",
  "table_of_contents",
  "synced_block",
  "synced_block_reference",
  "unknown",
  "equation",
];

const INLINE_ATOM_TAGS = [
  "mention-user",
  "mention-page",
  "mention-database",
  "mention-date",
  "mention-link-preview",
  "mention-template-mention",
  "mention-custom-emoji",
];

interface NotionBlockAtomOptions {
  documentId?: string;
  onOpenPageLink?: (documentId: string) => void;
  /** Whether a change is this tab's own edit. */
  isEdit?: (transaction: Transaction) => boolean;
}

function readElementAttributes(
  element: HTMLElement,
  omit: string[] = [],
): Record<string, string> {
  const ignored = new Set(omit);
  const attrs: Record<string, string> = {};

  for (const { name, value } of Array.from(element.attributes)) {
    if (ignored.has(name)) continue;
    attrs[name] = value;
  }

  return attrs;
}

export function parseAttrsJson(
  attrsJson: string | null | undefined,
): Record<string, string> {
  if (!attrsJson) return {};

  try {
    const parsed = JSON.parse(attrsJson) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => {
        return typeof entry[0] === "string" && typeof entry[1] === "string";
      }),
    );
  } catch {
    return {};
  }
}

function serializeInnerMarkdown(editor: any, node: any): string {
  if (!editor?.storage?.markdown?.serializer) {
    return node.textContent || "";
  }
  return editor.storage.markdown.serializer.serialize(node).trimEnd();
}

function serializeContainerTag(
  tagName: string,
  attrs: Record<string, string | number | boolean | null | undefined>,
  innerMarkdown: string,
): string {
  const openTag = `<${tagName}${serializeTagAttributes(attrs)}>`;
  if (!innerMarkdown.trim()) {
    return `${openTag}\n</${tagName}>`;
  }
  return `${openTag}\n${indentMarkdown(innerMarkdown)}\n</${tagName}>`;
}

function serializeAtomTag(
  tagName: string,
  attrsJson: string,
  label: string,
): string {
  const attrs = parseAttrsJson(attrsJson);
  const openTag = `<${tagName}${serializeTagAttributes(attrs)}>`;
  return label.trim()
    ? `${openTag}${escapeHtml(label)}</${tagName}>`
    : `<${tagName}${serializeTagAttributes(attrs)} />`;
}

export function humanizeTag(tagName: string): string {
  return tagName.replace(/[_-]/g, " ");
}

function normalizeNotionPageId(input: string | null | undefined) {
  const trimmed = input?.trim();
  if (!trimmed) return null;
  if (/^[0-9a-fA-F]{32}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^[0-9a-fA-F-]{36}$/.test(trimmed)) {
    return trimmed.replace(/-/g, "").toLowerCase();
  }
  try {
    const url = new URL(trimmed);
    const slug = url.pathname.split("/").filter(Boolean).pop() || "";
    const match =
      slug.match(/([0-9a-fA-F]{32})$/) || slug.match(/([0-9a-fA-F-]{36})$/);
    return match?.[1]?.replace(/-/g, "").toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function getNotionPageId(attrs: Record<string, string>) {
  return (
    attrs["data-agent-native-document-id"] ||
    attrs.id ||
    (normalizeNotionPageId(attrs.url) ??
      normalizeNotionPageId(attrs.href) ??
      normalizeNotionPageId(attrs.pageId) ??
      normalizeNotionPageId(attrs.page_id))
  );
}

export function safeExternalPageUrl(input: string | null): string | null {
  if (!input) return null;
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export const TOGGLE_SUMMARY_PLACEHOLDER = "Toggle";
export const EMPTY_TOGGLE_BODY_PLACEHOLDER =
  "Empty toggle. Click or drop blocks inside.";

// A Toggle's title is page text, as in Notion: the toggle's first child, so
// it can be selected, commented on and formatted like a paragraph. A
// suggestion leaves it as it is, as it left the `summary` title. Toggles saved
// before this keep their title in the `summary` attribute and have no title
// child.
export const TOGGLE_TITLE_NODE = "notionToggleSummary";

/** The Toggle's title node, or null for a Toggle that keeps its title in `summary`. */
export function toggleTitleNode(
  toggle: ProseMirrorNode,
): ProseMirrorNode | null {
  const first = toggle.firstChild;
  return first?.type.name === TOGGLE_TITLE_NODE ? first : null;
}

interface ToggleTitleContext {
  togglePos: number;
  toggle: ProseMirrorNode;
  title: ProseMirrorNode;
  /** Where the title's text starts. */
  titleStart: number;
}

/** The Toggle whose title holds the selection, when the whole selection is in one title. */
export function toggleTitleAtSelection(
  state: EditorState,
): ToggleTitleContext | null {
  const { $from, $to } = state.selection;
  if ($from.depth < 2 || $from.parent.type.name !== TOGGLE_TITLE_NODE) {
    return null;
  }
  if (!$from.sameParent($to)) return null;
  const toggleDepth = $from.depth - 1;
  return {
    togglePos: $from.before(toggleDepth),
    toggle: $from.node(toggleDepth),
    title: $from.parent,
    titleStart: $from.start(),
  };
}

/** Whether any of the range is a Toggle title's text. */
export function rangeTouchesToggleTitle(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): boolean {
  let touches = false;
  doc.nodesBetween(from, to, (node) => {
    if (touches) return false;
    if (node.type.name === TOGGLE_TITLE_NODE) touches = true;
    return !touches;
  });
  return touches;
}

function dispatchToggleKeyTransaction(editor: Editor, tr: Transaction) {
  tr.setMeta("preventClearDocument", true);
  tr.setMeta("uiEvent", "keydown");
  editor.view.dispatch(tr.scrollIntoView());
}

/**
 * Enter in a Toggle's title, as in Notion. An empty Toggle becomes a
 * paragraph, and at the start of a title an empty closed Toggle goes above.
 * Otherwise the text after the cursor starts the body of an open Toggle, a
 * paragraph after a closed heading, or the title of a new closed Toggle after
 * any other closed one.
 */
export function splitToggleTitle(editor: Editor): boolean {
  const context = toggleTitleAtSelection(editor.state);
  if (!context) return false;
  const { schema } = editor.state;
  const paragraph = schema.nodes.paragraph as NodeType | undefined;
  const titleType = schema.nodes[TOGGLE_TITLE_NODE] as NodeType | undefined;
  if (!paragraph || !titleType) return false;
  const { togglePos, toggle, title, titleStart } = context;

  let tr = editor.state.tr;
  if (!tr.selection.empty) tr = tr.deleteSelection();
  const cursor = tr.selection.from;
  const titleNode = tr.doc.nodeAt(togglePos + 1);
  if (!titleNode) return false;
  const titleEnd = titleStart + titleNode.content.size;

  if (title.content.size === 0) return unwrapToggleAtTitleStart(editor);

  if (cursor === titleStart && titleEnd > titleStart) {
    tr.insert(
      togglePos,
      toggle.type.create(
        { ...toggle.attrs, summary: "", open: false },
        titleType.create(),
      ),
    );
    dispatchToggleKeyTransaction(editor, tr);
    return true;
  }

  if (toggle.attrs.open) {
    tr.split(cursor, 1, [{ type: paragraph }]);
    dispatchToggleKeyTransaction(editor, tr);
    return true;
  }

  const rest = tr.doc.slice(cursor, titleEnd).content;
  tr.delete(cursor, titleEnd);
  const shortened = tr.doc.nodeAt(togglePos);
  if (!shortened) return false;
  const after = togglePos + shortened.nodeSize;
  tr.insert(
    after,
    toggle.attrs.headingLevel
      ? paragraph.create(null, rest)
      : toggle.type.create(
          { ...toggle.attrs, summary: "", open: false },
          titleType.create(null, rest),
        ),
  );
  tr.setSelection(Selection.near(tr.doc.resolve(after + 1)));
  dispatchToggleKeyTransaction(editor, tr);
  return true;
}

/**
 * Backspace at the start of a Toggle's title turns the Toggle into a
 * paragraph with the title's text, and its body follows it, as in Notion.
 */
export function unwrapToggleAtTitleStart(editor: Editor): boolean {
  const context = toggleTitleAtSelection(editor.state);
  const { selection } = editor.state;
  if (!context || !selection.empty || selection.$from.parentOffset !== 0) {
    return false;
  }
  const paragraph = editor.state.schema.nodes.paragraph as NodeType | undefined;
  if (!paragraph) return false;
  const { togglePos, toggle, title } = context;
  const indent = normalizeIndentAttr(toggle.attrs.indent);
  const heading = editor.state.schema.nodes.heading as NodeType | undefined;
  const level = Number(toggle.attrs.headingLevel);
  const blocks: ProseMirrorNode[] = [
    level && heading
      ? heading.create({ level, indent }, title.content)
      : paragraph.create({ indent }, title.content),
  ];
  toggle.forEach((child, _offset, index) => {
    if (index > 0) blocks.push(child);
  });
  const tr = editor.state.tr.replaceWith(
    togglePos,
    togglePos + toggle.nodeSize,
    blocks,
  );
  tr.setSelection(TextSelection.create(tr.doc, togglePos + 1));
  dispatchToggleKeyTransaction(editor, tr);
  return true;
}

/** The end of the title of the outermost closed Toggle hiding this position. */
function titleHidingPosition($pos: ResolvedPos): number | null {
  for (let depth = 1; depth <= $pos.depth; depth += 1) {
    const node = $pos.node(depth);
    if (node.type.name !== "notionToggle" || node.attrs.open) continue;
    const title = toggleTitleNode(node);
    if (title && $pos.index(depth) > 0) {
      return $pos.start(depth) + 1 + title.content.size;
    }
  }
  return null;
}

/**
 * Where the last line a reader can see in a block ends: the end of an open
 * Toggle's body, or the title of a closed one. Null when the block ends in
 * something without text.
 */
function endOfVisibleText(doc: ProseMirrorNode, pos: number): number | null {
  let at = pos;
  let node = doc.nodeAt(pos);
  while (node) {
    if (node.isTextblock) return at + 1 + node.content.size;
    const title =
      node.type.name === "notionToggle" ? toggleTitleNode(node) : null;
    if (title && (!node.attrs.open || node.childCount === 1)) {
      return at + 2 + title.content.size;
    }
    const last = node.isAtom ? null : node.lastChild;
    if (!last) return null;
    at += node.nodeSize - 1 - last.nodeSize;
    node = last;
  }
  return null;
}

/**
 * Backspace at the start of the block below a Toggle joins it to the last line
 * a reader can see above it, as in Notion. ProseMirror's own join would move
 * it into the body, which a closed Toggle hides.
 */
export function joinBlockToToggleAbove(editor: Editor): boolean {
  const { doc, selection } = editor.state;
  const { $from } = selection;
  if (
    !selection.empty ||
    $from.parentOffset !== 0 ||
    !["paragraph", "heading"].includes($from.parent.type.name)
  ) {
    return false;
  }
  const blockPos = $from.before();
  const above = doc.resolve(blockPos).nodeBefore;
  if (above?.type.name !== "notionToggle" || !toggleTitleNode(above)) {
    return false;
  }
  const end = endOfVisibleText(doc, blockPos - above.nodeSize);
  if (end === null) return false;
  const tr = editor.state.tr.delete(blockPos, $from.after());
  tr.insert(end, $from.parent.content);
  tr.setSelection(TextSelection.create(tr.doc, end));
  dispatchToggleKeyTransaction(editor, tr);
  return true;
}

/**
 * The first line of a block, which Delete at the end of the line above joins
 * to that line, the range it leaves and what stays there. A title's body stays
 * where its Toggle was.
 */
function firstLineOfBlock(block: ProseMirrorNode, pos: number) {
  const whole = { from: pos, to: pos + block.nodeSize, rest: Fragment.empty };
  const { name } = block.type;
  if (name === "paragraph" || name === "heading") {
    return { ...whole, content: block.content };
  }
  if (name === "notionToggle") {
    const title = toggleTitleNode(block);
    return title
      ? {
          ...whole,
          content: title.content,
          rest: block.content.cut(title.nodeSize),
        }
      : null;
  }
  if (!["bulletList", "orderedList", "taskList"].includes(name)) return null;
  const item = block.firstChild;
  const line = item?.firstChild;
  if (!item || item.childCount !== 1 || line?.type.name !== "paragraph") {
    return null;
  }
  return block.childCount === 1
    ? { ...whole, content: line.content }
    : {
        from: pos + 1,
        to: pos + 1 + item.nodeSize,
        rest: Fragment.empty,
        content: line.content,
      };
}

/**
 * Delete at the end of a title with no body showing joins the block below to
 * the title, as in Notion. ProseMirror's own join would move that block into a
 * hidden body, so anything else below stays where it is.
 */
export function joinBlockBelowToToggleTitle(editor: Editor): boolean {
  const context = toggleTitleAtSelection(editor.state);
  const { doc, selection } = editor.state;
  if (
    !context ||
    !selection.empty ||
    selection.$from.parentOffset !== context.title.content.size
  ) {
    return false;
  }
  const { toggle, togglePos } = context;
  if (toggle.attrs.open && toggle.childCount > 1) return false;
  const belowPos = togglePos + toggle.nodeSize;
  const below = doc.nodeAt(belowPos);
  const line = below ? firstLineOfBlock(below, belowPos) : null;
  if (!line) return true;
  const tr = editor.state.tr.replaceWith(line.from, line.to, line.rest);
  tr.insert(selection.from, line.content);
  tr.setSelection(TextSelection.create(tr.doc, selection.from));
  dispatchToggleKeyTransaction(editor, tr);
  return true;
}

/**
 * A selection from a closed Toggle's title to below it looks like it holds no
 * body, so deleting it leaves the body where it is, as in Notion. What's left
 * of the last selected line joins the title. Null for any other selection.
 */
function deleteFromClosedTitle(state: EditorState): Transaction | null {
  const { $from, $to, empty } = state.selection;
  if (
    empty ||
    isSuggestingEdits(state) ||
    $from.parent.type.name !== TOGGLE_TITLE_NODE
  ) {
    return null;
  }
  const toggle = $from.node(-1);
  const belowPos = $from.before(-1) + toggle.nodeSize;
  if (toggle.attrs.open || toggle.childCount === 1 || $to.pos <= belowPos) {
    return null;
  }
  const tr = state.tr.delete(belowPos, $to.pos);
  const below = tr.doc.nodeAt(belowPos);
  const line = below ? firstLineOfBlock(below, belowPos) : null;
  if (line) tr.replaceWith(line.from, line.to, line.rest);
  tr.replaceWith($from.pos, $from.end(), line ? line.content : Fragment.empty);
  return tr.setSelection(TextSelection.create(tr.doc, $from.pos));
}

function deleteSelectionFromClosedTitle(editor: Editor): boolean {
  const tr = deleteFromClosedTitle(editor.state);
  if (!tr) return false;
  dispatchToggleKeyTransaction(editor, tr);
  return true;
}

/**
 * Delete at the end of a line joins the line below to it, as in Notion, when
 * that line is a Toggle's title or the first line after the Toggle this one
 * ends. An empty line just goes, and the caret starts the line below.
 * ProseMirror's own Delete would select the Toggle, or move the whole block
 * below into the body.
 */
export function joinLineBelowToLine(editor: Editor): boolean {
  const { doc, selection } = editor.state;
  const { $from } = selection;
  if (
    !selection.empty ||
    $from.depth === 0 ||
    !$from.parent.isTextblock ||
    $from.parent.type.spec.code ||
    $from.parent.type.name === TOGGLE_TITLE_NODE ||
    $from.parentOffset !== $from.parent.content.size
  ) {
    return false;
  }
  let depth = $from.depth;
  while (
    depth > 1 &&
    $from.node(depth - 1).type.name === "notionToggle" &&
    $from.indexAfter(depth - 1) === $from.node(depth - 1).childCount
  ) {
    depth -= 1;
  }
  const belowPos = $from.after(depth);
  const below = doc.nodeAt(belowPos);
  const line = below ? firstLineOfBlock(below, belowPos) : null;
  if (!line || (depth === $from.depth && below?.type.name !== "notionToggle")) {
    return false;
  }
  const tr = editor.state.tr;
  if ($from.parent.content.size === 0) {
    tr.delete($from.before(), $from.after());
    tr.setSelection(Selection.near(tr.doc.resolve(tr.mapping.map(belowPos))));
  } else {
    tr.replaceWith(line.from, line.to, line.rest);
    tr.insert($from.pos, line.content);
    tr.setSelection(TextSelection.create(tr.doc, $from.pos));
  }
  dispatchToggleKeyTransaction(editor, tr);
  return true;
}

/** Ctrl+Enter in a title opens or closes the Toggle, as in Notion. */
export function toggleOpenAtTitle(editor: Editor): boolean {
  const context = toggleTitleAtSelection(editor.state);
  if (!context) return false;
  // Suggesting can't change whether a Toggle is open; see ToggleView.
  if (isSuggestingEdits(editor.state)) return true;
  const { toggle, togglePos } = context;
  dispatchToggleKeyTransaction(
    editor,
    editor.state.tr.setNodeMarkup(togglePos, undefined, {
      ...toggle.attrs,
      open: !toggle.attrs.open,
    }),
  );
  return true;
}

/** The body line holding an empty selection, and the Toggle around it. */
function bodyLineAtSelection(state: EditorState) {
  const { selection } = state;
  const { $from } = selection;
  if (
    !selection.empty ||
    $from.depth < 2 ||
    $from.parent.type.name !== "paragraph" ||
    $from.node(-1).type.name !== "notionToggle"
  ) {
    return null;
  }
  return { $from, toggle: $from.node(-1), togglePos: $from.before(-1) };
}

/**
 * Moves a body block and the blocks after it out of their Toggle, keeping
 * their order, and returns where they now start.
 */
function moveBodyBlocksOut(
  tr: Transaction,
  togglePos: number,
  toggle: ProseMirrorNode,
  blockPos: number,
): number | null {
  const bodyEnd = togglePos + toggle.nodeSize - 1;
  const moved = tr.doc.slice(blockPos, bodyEnd).content;
  tr.delete(blockPos, bodyEnd);
  const remaining = tr.doc.nodeAt(togglePos);
  if (remaining?.type.name !== "notionToggle") return null;
  const insertPos = togglePos + remaining.nodeSize;
  tr.insert(insertPos, moved);
  return insertPos;
}

/**
 * Enter on an empty line of a Toggle's body adds another line there, as in
 * Notion. ProseMirror's own Enter would move the line out of the Toggle, or
 * split the Toggle in two around it.
 */
export function addBodyLineBelowEmptyLine(editor: Editor): boolean {
  const line = bodyLineAtSelection(editor.state);
  const paragraph = editor.state.schema.nodes.paragraph as NodeType | undefined;
  if (!line || !paragraph || line.$from.parent.content.size > 0) return false;
  const after = line.$from.after();
  const tr = editor.state.tr.insert(after, paragraph.create());
  tr.setSelection(TextSelection.create(tr.doc, after + 1));
  dispatchToggleKeyTransaction(editor, tr);
  return true;
}

/**
 * Backspace at the start of a Toggle's last body line moves the line out of
 * the Toggle, as in Notion, which is how to carry on writing below one. A line
 * that follows the title joins the title instead.
 */
export function moveLastBodyLineOut(editor: Editor): boolean {
  const line = bodyLineAtSelection(editor.state);
  if (!line || line.$from.parentOffset !== 0) return false;
  const { $from, toggle, togglePos } = line;
  const index = $from.index(-1);
  if (index !== toggle.childCount - 1 || index < 2) return false;
  const tr = editor.state.tr;
  const insertPos = moveBodyBlocksOut(tr, togglePos, toggle, $from.before());
  if (insertPos === null) return false;
  tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
  dispatchToggleKeyTransaction(editor, tr);
  return true;
}

/**
 * Tab on a block right below a Toggle, or in the title of one, puts the block
 * in that Toggle's body and opens it, as in Notion.
 */
export function nestBlockInToggleAbove(editor: Editor): boolean {
  const { doc, selection } = editor.state;
  const { $from, $to } = selection;
  if (
    !$from.sameParent($to) ||
    !$from.parent.isTextblock ||
    $from.parent.type.spec.code
  ) {
    return false;
  }
  const depth =
    $from.parent.type.name === TOGGLE_TITLE_NODE
      ? $from.depth - 1
      : $from.depth;
  if (depth < 1) return false;
  const blockPos = $from.before(depth);
  const block = $from.node(depth);
  const above = doc.resolve(blockPos).nodeBefore;
  if (above?.type.name !== "notionToggle" || !toggleTitleNode(above)) {
    return false;
  }
  const tr = editor.state.tr.delete(blockPos, blockPos + block.nodeSize);
  tr.insert(blockPos - 1, block);
  if (!above.attrs.open) {
    tr.setNodeMarkup(blockPos - above.nodeSize, undefined, {
      ...above.attrs,
      open: true,
    });
  }
  // The block moved past only the closing token of the Toggle above.
  tr.setSelection(
    TextSelection.create(tr.doc, selection.anchor - 1, selection.head - 1),
  );
  dispatchToggleKeyTransaction(editor, tr);
  return true;
}

/**
 * Tab and Shift+Tab in a title indent and outdent its Toggle, as they do a
 * paragraph, and Shift+Tab then moves the Toggle out of the Toggle around it,
 * with the lines after it in its body, as in Notion. The keys never leave the
 * page, as the browser's own Tab would.
 */
export function shiftToggleAtTitle(editor: Editor, delta: 1 | -1): boolean {
  const context = toggleTitleAtSelection(editor.state);
  if (!context) return false;
  const { selection } = editor.state;
  const { toggle, togglePos } = context;
  const indent = normalizeIndentAttr(toggle.attrs.indent);
  const next = normalizeIndentAttr(indent + delta);
  if (next !== indent) {
    dispatchToggleKeyTransaction(
      editor,
      editor.state.tr.setNodeMarkup(togglePos, undefined, {
        ...toggle.attrs,
        indent: next,
      }),
    );
    return true;
  }
  const $toggle = editor.state.doc.resolve(togglePos);
  if (delta > 0 || $toggle.parent.type.name !== "notionToggle") return true;
  const outerPos = $toggle.before();
  const bodyEnd = outerPos + $toggle.parent.nodeSize - 1;
  const after = editor.state.doc.slice(togglePos + toggle.nodeSize, bodyEnd);
  const tr = editor.state.tr.delete(togglePos, bodyEnd);
  const remaining = tr.doc.nodeAt(outerPos);
  if (remaining?.type.name !== "notionToggle") return true;
  const insertPos = outerPos + remaining.nodeSize;
  tr.insert(insertPos, toggle.copy(toggle.content.append(after.content)));
  tr.setSelection(
    TextSelection.create(tr.doc, insertPos + (selection.from - togglePos)),
  );
  dispatchToggleKeyTransaction(editor, tr);
  return true;
}

function scheduleEditorViewFocus(editor: Editor) {
  setTimeout(() => {
    if (!editor.isDestroyed) editor.view.focus();
  }, 0);
}

export function outdentDirectToggleChild(editor: Editor): boolean {
  const { state, view } = editor;
  const { $from, $to } = state.selection;
  if ($from.depth < 2 || $to.depth !== $from.depth) return false;

  const toggleDepth = $from.depth - 1;
  if (
    $from.node(toggleDepth).type.name !== "notionToggle" ||
    $to.node(toggleDepth) !== $from.node(toggleDepth)
  ) {
    return false;
  }

  const range = $from.blockRange($to);
  if (!range || range.depth !== toggleDepth) return false;
  const childDepth = $from.depth;
  const child = $from.node(childDepth);
  // The title belongs to its Toggle; only the body's blocks move out.
  if (child.type.name === TOGGLE_TITLE_NODE) return false;
  // An indented line comes back to the Toggle's margin first.
  if (normalizeIndentAttr(child.attrs.indent) > 0) return false;
  const childPos = $from.before(childDepth);
  const togglePos = $from.before(toggleDepth);
  const cursorOffset = $from.parentOffset;
  const tr = state.tr;
  const insertPos = moveBodyBlocksOut(
    tr,
    togglePos,
    $from.node(toggleDepth),
    childPos,
  );
  if (insertPos === null) return false;
  tr.setMeta("preventClearDocument", true);
  tr.setMeta("uiEvent", "keydown");
  tr.setSelection(
    Selection.near(
      tr.doc.resolve(
        insertPos + 1 + Math.min(cursorOffset, child.content.size),
      ),
    ),
  );
  view.dispatch(tr.scrollIntoView());
  scheduleEditorViewFocus(editor);
  return true;
}

export function normalizeIndentAttr(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : 0;
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 8) : 0;
}

/**
 * Moves an old Toggle's title from its `summary` into the page's text, caret
 * at the end, so it can be selected, formatted and commented on. Nothing about
 * the page changes for the person, so it's no undo step. When two tabs do this
 * at once, repairStrayTitles leaves one title.
 */
export function moveToggleSummaryToTitle(editor: Editor, pos: number): boolean {
  const titleType = editor.schema.nodes[TOGGLE_TITLE_NODE] as
    | NodeType
    | undefined;
  const toggle = editor.state.doc.nodeAt(pos);
  if (
    !titleType ||
    !editor.isEditable ||
    isSuggestingEdits(editor.state) ||
    toggle?.type.name !== "notionToggle" ||
    toggleTitleNode(toggle)
  ) {
    return false;
  }
  const text = String(toggle.attrs.summary ?? "");
  const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
    ...toggle.attrs,
    summary: "",
  });
  tr.insert(
    pos + 1,
    titleType.create(null, text ? editor.schema.text(text) : null),
  );
  tr.setSelection(TextSelection.create(tr.doc, pos + 2 + text.length));
  tr.setMeta("addToHistory", false);
  tr.setMeta("preventClearDocument", true);
  tr.setMeta("uiEvent", "pointer");
  editor.view.dispatch(tr);
  scheduleEditorViewFocus(editor);
  return true;
}

/** Where a Toggle's body starts, after its title when it has one. */
function toggleBodyStart(toggle: ProseMirrorNode, pos: number) {
  return pos + 1 + (toggleTitleNode(toggle)?.nodeSize ?? 0);
}

function ToggleView({ node, editor, getPos }: NodeViewProps) {
  const t = useT();
  // The page stores whether a Toggle is open, which a suggestion cannot
  // change, so while suggesting it opens and closes only in this view.
  const suggesting = isSuggestingEdits(editor.state);
  const [suggestingOpen, setSuggestingOpen] = useState<boolean | null>(null);
  const open = suggestingOpen ?? !!node.attrs.open;
  const summary = (node.attrs.summary || "") as string;
  const isEditable = editor.isEditable && !suggesting;
  // Browsers won't select text inside a draggable element, and someone who
  // can't edit has to select a Toggle's text to comment on it.
  const dragProps = isEditable
    ? { draggable: true, "data-drag-handle": "" }
    : {};
  const title = toggleTitleNode(node);
  const bodyHasNoBlocks = node.childCount === (title ? 1 : 0);

  const updateToggleAttributes = (
    attrs: Record<string, unknown>,
    uiEvent: "input" | "pointer",
  ) => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    const currentNode = editor.state.doc.nodeAt(pos);
    if (currentNode?.type.name !== "notionToggle") return;
    const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
      ...currentNode.attrs,
      ...attrs,
    });
    tr.setMeta("preventClearDocument", true);
    tr.setMeta("uiEvent", uiEvent);
    editor.view.dispatch(tr);
  };

  const setOpen = (value: boolean) => {
    if (!suggesting) {
      updateToggleAttributes({ open: value }, "pointer");
      return;
    }
    setSuggestingOpen(value);
    // The title's plugin moves the caret out of a Toggle the page has closed,
    // but as far as the page knows this one is still open.
    const pos = getPos();
    if (value || typeof pos !== "number" || !title) return;
    const bodyStart = pos + 1 + title.nodeSize;
    const { from, to } = editor.state.selection;
    if (to > bodyStart && from < pos + node.nodeSize) {
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, bodyStart - 1),
        ),
      );
    }
  };

  const focusEmptyBody = (event: React.MouseEvent<HTMLElement>) => {
    if (!isEditable) return;
    event.preventDefault();
    event.stopPropagation();

    const pos = getPos();
    if (typeof pos !== "number") return;

    if (!open) setOpen(true);

    const paragraph = editor.state.schema.nodes.paragraph as
      | NodeType
      | undefined;
    const currentNode = editor.state.doc.nodeAt(pos);
    if (!paragraph || currentNode?.type.name !== "notionToggle") return;
    const bodyStart = toggleBodyStart(currentNode, pos);
    const tr = editor.state.tr.insert(bodyStart, paragraph.create());
    tr.setMeta("preventClearDocument", true);
    tr.setMeta("uiEvent", "pointer");
    tr.setSelection(Selection.near(tr.doc.resolve(bodyStart + 1)));
    editor.view.dispatch(tr.scrollIntoView());
    scheduleEditorViewFocus(editor);
  };

  const getEmptyBodyInsertPos = () => {
    if (!isEditable) return;

    const pos = getPos();
    if (typeof pos !== "number") return;

    const currentNode = editor.state.doc.nodeAt(pos);
    if (
      !currentNode ||
      currentNode.type.name !== "notionToggle" ||
      currentNode.childCount > (toggleTitleNode(currentNode) ? 1 : 0)
    ) {
      return;
    }

    return toggleBodyStart(currentNode, pos);
  };

  const allowEmptyBodyDrop = (event: React.DragEvent<HTMLElement>) => {
    if (!getEmptyBodyInsertPos()) return;

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
  };

  const handleEmptyBodyDrop = (event: React.DragEvent<HTMLElement>) => {
    const insertPos = getEmptyBodyInsertPos();
    if (!insertPos) return;

    const dragging = (
      editor.view as typeof editor.view & {
        dragging?: { slice?: { content: Fragment }; move?: boolean } | null;
      }
    ).dragging;
    const text = event.dataTransfer?.getData("text/plain").trim();
    let contentToInsert: Fragment | ProseMirrorNode | null = null;

    if (dragging?.slice?.content?.size) {
      contentToInsert = dragging.slice.content;
    } else if (text) {
      const textNode = editor.state.schema.text(text);
      contentToInsert =
        editor.state.schema.nodes.paragraph?.create(null, textNode) ?? null;
    }

    if (!contentToInsert) return;

    event.preventDefault();
    event.stopPropagation();

    const { selection } = editor.state;
    let targetPos = insertPos;
    let tr = editor.state.tr;

    if (
      dragging?.move &&
      !selection.empty &&
      selection.from <= targetPos &&
      selection.to >= targetPos
    ) {
      return;
    }

    if (dragging?.move && !selection.empty && selection.from < targetPos) {
      tr = tr.delete(selection.from, selection.to);
      targetPos -= selection.to - selection.from;
    }

    tr = tr.insert(targetPos, contentToInsert);

    if (dragging?.move && !selection.empty && selection.from > insertPos) {
      tr = tr.delete(
        tr.mapping.map(selection.from, 1),
        tr.mapping.map(selection.to, -1),
      );
    }

    tr.setMeta("preventClearDocument", true);
    tr.setMeta("uiEvent", "drop");

    editor.view.dispatch(tr.scrollIntoView());
    editor.view.focus();
    (
      editor.view as typeof editor.view & {
        dragging?: unknown;
      }
    ).dragging = null;
  };

  const emptyBodyPlaceholder =
    isEditable && open && bodyHasNoBlocks ? (
      <div
        className="content-toggle__body-placeholder content-toggle__body-placeholder--empty-node"
        contentEditable={false}
        onDragEnter={allowEmptyBodyDrop}
        onDragOver={allowEmptyBodyDrop}
        onDrop={handleEmptyBodyDrop}
        onMouseDown={focusEmptyBody}
      >
        {EMPTY_TOGGLE_BODY_PLACEHOLDER}
      </div>
    ) : null;

  if (title) {
    // The title is the first block of the content, so the page edits,
    // selects and comments on it like any other text. A closed Toggle hides
    // the blocks after it.
    return (
      <NodeViewWrapper
        className={`content-toggle content-toggle--titled ${
          open ? "content-toggle--open" : ""
        } ${bodyHasNoBlocks ? "content-toggle--body-empty" : ""} ${
          title.content.size === 0 ? "content-toggle--title-empty" : ""
        }`}
        data-color={node.attrs.color || undefined}
        data-heading-level={node.attrs.headingLevel || undefined}
        data-nfm-indent={normalizeIndentAttr(node.attrs.indent) || undefined}
        {...dragProps}
      >
        <button
          type="button"
          className="content-toggle__chevron"
          contentEditable={false}
          tabIndex={-1}
          aria-expanded={open}
          aria-label={t("editor.slash.toggle")}
          onClick={() => setOpen(!open)}
        >
          {open ? (
            <IconChevronDown size={18} stroke={2} />
          ) : (
            <IconChevronRight size={18} stroke={2} />
          )}
        </button>
        <NodeViewContent className="content-toggle__content" />
        {emptyBodyPlaceholder}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      className={`content-toggle ${open ? "content-toggle--open" : ""} ${
        bodyHasNoBlocks ? "content-toggle--body-empty" : ""
      }`}
      data-color={node.attrs.color || undefined}
      data-heading-level={node.attrs.headingLevel || undefined}
      data-nfm-indent={normalizeIndentAttr(node.attrs.indent) || undefined}
      {...dragProps}
    >
      <div
        className="content-toggle__summary-row"
        onClick={() => setOpen(!open)}
      >
        <span className="content-toggle__chevron" contentEditable={false}>
          {open ? (
            <IconChevronDown size={18} stroke={2} />
          ) : (
            <IconChevronRight size={18} stroke={2} />
          )}
        </span>
        {isEditable ? (
          <input
            readOnly
            value={summary}
            onFocus={() => {
              const pos = getPos();
              if (typeof pos === "number")
                moveToggleSummaryToTitle(editor, pos);
            }}
            onClick={(e) => e.stopPropagation()}
            placeholder={TOGGLE_SUMMARY_PLACEHOLDER}
            className="content-toggle__summary"
          />
        ) : (
          <span className="content-toggle__summary" contentEditable={false}>
            {summary || TOGGLE_SUMMARY_PLACEHOLDER}
          </span>
        )}
      </div>
      <div
        className={`content-toggle__body ${open ? "" : "content-toggle__body--collapsed"}`}
      >
        {emptyBodyPlaceholder}
        <NodeViewContent className="content-toggle__content" />
      </div>
    </NodeViewWrapper>
  );
}

function BlockAtomView({ node, extension }: NodeViewProps) {
  const tagName = (node.attrs.tagName || "block") as string;
  const label = (node.attrs.label || "") as string;
  const attrs = parseAttrsJson(node.attrs.attrsJson as string);
  const options = extension.options as NotionBlockAtomOptions;
  const t = useT();
  const notionPageId = tagName === "page" ? getNotionPageId(attrs) : null;
  const pageLinkQuery = usePageLinkTarget(
    notionPageId && options.onOpenPageLink ? notionPageId : null,
  );
  const pageLink = pageLinkQuery.data ?? null;
  // An unreadable lookup is not a missing page: keep the block usable so a
  // click retries instead of presenting the link as gone.
  const pageLinkLookupFailed = pageLinkQuery.isError;
  const primary =
    pageLink?.title ||
    label ||
    attrs.title ||
    attrs.alt ||
    attrs.url ||
    attrs.src ||
    humanizeTag(tagName);
  const canOpenLocalPage = Boolean(pageLink && options.onOpenPageLink);
  const externalUrl = safeExternalPageUrl(attrs.url || attrs.href || null);

  if (tagName === "equation") {
    return (
      <NodeViewWrapper
        className="content-equation"
        data-latex={label || attrs.latex || ""}
      >
        <MathRenderer latex={label || attrs.latex || ""} displayMode={true} />
      </NodeViewWrapper>
    );
  }

  if (tagName === "page") {
    const openPage = () => {
      if (pageLink && options.onOpenPageLink) {
        options.onOpenPageLink(pageLink.documentId);
        return;
      }
      if (pageLinkLookupFailed) {
        const retry = pageLinkQuery.refetch();
        if (!externalUrl) {
          void retry.then((result) => {
            if (result.data) options.onOpenPageLink?.(result.data.documentId);
          });
          return;
        }
      }
      if (externalUrl) {
        window.open(externalUrl, "_blank", "noopener,noreferrer");
      }
    };

    return (
      <NodeViewWrapper
        className={`content-page-reference ${
          canOpenLocalPage || pageLinkLookupFailed || externalUrl
            ? "content-page-reference--clickable"
            : ""
        }`}
        data-page-link-state={pageLinkLookupFailed ? "unavailable" : undefined}
      >
        <button
          type="button"
          className="content-page-reference__button"
          contentEditable={false}
          disabled={!canOpenLocalPage && !pageLinkLookupFailed && !externalUrl}
          title={
            pageLinkLookupFailed ? t("editor.reference.loadError") : undefined
          }
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            openPage();
          }}
        >
          <span className="content-page-reference__icon" aria-hidden="true">
            <ContentIcon
              value={pageLink?.icon}
              size={20}
              fallback={<IconFileText size={20} stroke={1.8} />}
            />
          </span>
          <span className="content-page-reference__label">{primary}</span>
          {!pageLink && externalUrl ? (
            <IconExternalLink
              className="content-page-reference__external"
              size={16}
              stroke={1.8}
            />
          ) : null}
        </button>
      </NodeViewWrapper>
    );
  }

  const AtomIcon = tagName === "database" ? IconDatabase : IconFileText;

  return (
    <NodeViewWrapper className="content-atom content-atom--block">
      <div className="content-atom__kind">
        <AtomIcon size={14} stroke={1.8} />
        {humanizeTag(tagName)}
      </div>
      <div className="content-atom__label">{primary}</div>
    </NodeViewWrapper>
  );
}

function InlineAtomView({ node }: NodeViewProps) {
  const tagName = (node.attrs.tagName || "mention") as string;
  const label = (node.attrs.label || "") as string;
  const attrs = parseAttrsJson(node.attrs.attrsJson as string);

  if (tagName === "math") {
    const latex = label || attrs.latex || "";
    return (
      <NodeViewWrapper
        as="span"
        className="content-inline-equation"
        contentEditable={false}
        data-latex={latex}
      >
        <MathRenderer latex={latex} displayMode={false} />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="span"
      className="content-inline-atom"
      contentEditable={false}
    >
      {label || humanizeTag(tagName)}
    </NodeViewWrapper>
  );
}

export const NotionSpanMark = Mark.create({
  name: "notionSpan",

  priority: 1000,

  addAttributes() {
    return {
      color: { default: null },
      bgColor: { default: null },
      underline: { default: null },
      href: { default: null },
      attrsJson: { default: "{}" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[color], span[bg_color], span[underline], span[data-notion-span]",
        getAttrs: (element) => {
          const node = element as HTMLElement;
          return {
            color: node.getAttribute("color"),
            bgColor: node.getAttribute("bg_color"),
            underline: node.getAttribute("underline"),
            href: node.getAttribute("href"),
            attrsJson: JSON.stringify(
              readElementAttributes(node, [
                "data-notion-span",
                "style",
                "class",
              ]),
            ),
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = parseAttrsJson(HTMLAttributes.attrsJson as string);
    const style: string[] = [];
    const classes: string[] = [];

    if (
      NFM_COLORS.has(HTMLAttributes.color) &&
      !HTMLAttributes.color.endsWith("_bg")
    ) {
      classes.push(`content-block-color--${HTMLAttributes.color}`);
    }
    if (
      NFM_COLORS.has(HTMLAttributes.bgColor) &&
      HTMLAttributes.bgColor.endsWith("_bg")
    ) {
      classes.push(`content-block-bg--${HTMLAttributes.bgColor.slice(0, -3)}`);
    }
    if (HTMLAttributes.underline === "true") {
      style.push("text-decoration: underline");
    }

    return [
      "span",
      mergeAttributes(attrs, {
        "data-notion-span": "true",
        color: HTMLAttributes.color || undefined,
        bg_color: HTMLAttributes.bgColor || undefined,
        underline: HTMLAttributes.underline || undefined,
        href: HTMLAttributes.href || undefined,
        class: classes.length ? classes.join(" ") : undefined,
        style: style.length ? style.join("; ") : undefined,
      }),
      0,
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize: {
          open: (_state: any, mark: any) => {
            const attrs = parseAttrsJson(mark.attrs.attrsJson);
            return `<span${serializeTagAttributes(attrs)}>`;
          },
          close: "</span>",
          expelEnclosingWhitespace: true,
        },
        parse: {},
      },
    };
  },
});

export const CompatibleCode = Code.extend({
  excludes: "",
});

export interface NotionToggleOptions {
  /** Whether a change is this tab's own edit, which may repair a title. */
  isEdit: (transaction: Transaction) => boolean;
}

const isNotRemoteChange = (transaction: Transaction) =>
  !transaction.getMeta(ySyncPluginKey)?.isChangeOrigin;

export const NotionToggle = Node.create<NotionToggleOptions>({
  name: "notionToggle",
  priority: 1000,
  group: "block",
  // The title is optional: Toggles saved before titles were page text keep
  // theirs in `summary`, and every reader must still take them as they are.
  // One may also stand out of place until repairStrayTitles moves it: tabs
  // editing at once can merge into that, and y-tiptap deletes any node the
  // schema refuses, in every tab, with everything in it.
  content: `${TOGGLE_TITLE_NODE}? (block | ${TOGGLE_TITLE_NODE})*`,
  defining: true,
  draggable: true,

  addOptions() {
    return { isEdit: isNotRemoteChange };
  },

  addExtensions() {
    return [NotionToggleSummary.configure({ isEdit: this.options.isEdit })];
  },

  addAttributes() {
    return {
      summary: { default: "" },
      color: { default: null },
      headingLevel: { default: null },
      open: { default: false },
      indent: { default: 0 },
    };
  },

  parseHTML() {
    return [
      {
        tag: "details",
        getAttrs: (element) => {
          const node = element as HTMLElement;
          return {
            summary: node.querySelector("summary")?.textContent?.trim() || "",
            color: node.getAttribute("color"),
            headingLevel: node.getAttribute("data-heading-level"),
            open: node.hasAttribute("open"),
            indent: normalizeIndentAttr(node.getAttribute("data-nfm-indent")),
          };
        },
        contentElement: (element) => {
          const body = element.ownerDocument.createElement("div");
          for (const child of Array.from(element.childNodes)) {
            if (
              child.nodeType === globalThis.Node.ELEMENT_NODE &&
              (child as HTMLElement).tagName.toLowerCase() === "summary"
            ) {
              continue;
            }
            body.appendChild(child.cloneNode(true));
          }
          return body;
        },
      },
      {
        tag: "div[data-notion-toggle]",
        getAttrs: (element) => {
          const node = element as HTMLElement;
          return {
            summary: node.getAttribute("data-summary") || "",
            color: node.getAttribute("data-color"),
            headingLevel: node.getAttribute("data-heading-level"),
            open: node.getAttribute("data-open") === "true",
            indent: normalizeIndentAttr(node.getAttribute("data-nfm-indent")),
          };
        },
        contentElement: (element) =>
          (element as HTMLElement).querySelector(
            "[data-notion-toggle-content]",
          ) as HTMLElement,
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const content: DOMOutputSpec = [
      "div",
      { "data-notion-toggle-content": "true" },
      0,
    ];
    // A titled Toggle's title is its first child, inside the content.
    const summary: DOMOutputSpec[] = toggleTitleNode(node)
      ? []
      : [
          [
            "div",
            { "data-notion-toggle-summary": "true" },
            HTMLAttributes.summary || "",
          ],
        ];
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-notion-toggle": "true",
        "data-summary": HTMLAttributes.summary || "",
        "data-color": HTMLAttributes.color || undefined,
        "data-heading-level": HTMLAttributes.headingLevel || undefined,
        "data-open": HTMLAttributes.open ? "true" : undefined,
        "data-nfm-indent": HTMLAttributes.indent
          ? String(HTMLAttributes.indent)
          : undefined,
      }),
      ...summary,
      content,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleView);
  },
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => addBodyLineBelowEmptyLine(editor),
      Backspace: ({ editor }) =>
        deleteSelectionFromClosedTitle(editor) ||
        moveLastBodyLineOut(editor) ||
        joinBlockToToggleAbove(editor),
      Delete: ({ editor }) =>
        deleteSelectionFromClosedTitle(editor) || joinLineBelowToLine(editor),
      Tab: ({ editor }) => nestBlockInToggleAbove(editor),
      "Shift-Tab": ({ editor }) => outdentDirectToggleChild(editor),
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize: function (_state: any, node: any) {
          const title = toggleTitleNode(node);
          const attrs: Record<string, string> = {};
          // A title that is page text is written as Markdown; see nfm.ts.
          if (title) attrs.markdown = "1";
          if (node.attrs.color) attrs.color = String(node.attrs.color);
          if (node.attrs.headingLevel) {
            attrs["data-heading-level"] = String(node.attrs.headingLevel);
          }
          if (node.attrs.open) attrs.open = "";
          const indent = normalizeIndentAttr(node.attrs.indent);
          const prefix = "\t".repeat(indent);
          const body = title
            ? node.copy(node.content.cut(title.nodeSize))
            : node;
          // The Markdown extension calls this with its editor as `this`.
          const { editor } = this as { editor?: unknown };
          const inner = serializeInnerMarkdown(editor, body);
          const openTag = `<details${serializeTagAttributes(attrs)}>`;
          _state.write(`${prefix}${openTag}`);
          _state.ensureNewLine();
          _state.write(
            `${prefix}<summary>${
              title
                ? serializeToggleTitle(title.toJSON())
                : escapeHtml(node.attrs.summary || "")
            }</summary>`,
          );
          if (inner.trim()) {
            _state.ensureNewLine();
            _state.write(indentMarkdown(inner, `${prefix}\t`));
          }
          _state.ensureNewLine();
          _state.write(`${prefix}</details>`);
          _state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

const TITLE_CODE_MARKER = /^(?:```|~~~)([a-z]+)?[\s\n]$/;
const TITLE_DIVIDER_MARKER = /^(?:---|—-|___\s|\*\*\*\s)$/;

// Other markers typed in a title stay text there, unless they turn the Toggle
// into another block below: a heading's fourth level has no Toggle in Notion,
// and a code block or divider has nowhere to keep a title or a body.
const TITLE_BLOCK_MARKERS = [
  /^#{4,6}\s$/,
  TITLE_CODE_MARKER,
  TITLE_DIVIDER_MARKER,
];

const TITLE_QUOTE_MARKER = /^["|]\s$/;

/** The list a Markdown marker typed at the start of a title makes. */
function listTypesForMarker(typed: string, schema: Schema) {
  const names = /^[-+*]\s$/.test(typed)
    ? ["bulletList", "listItem"]
    : /^\d+\.\s$/.test(typed)
      ? ["orderedList", "listItem"]
      : /^\[[ x]?\]\s$/.test(typed)
        ? ["taskList", "taskItem"]
        : null;
  if (!names) return null;
  const [listName = "", itemName = ""] = names;
  const list = schema.nodes[listName] as NodeType | undefined;
  const item = schema.nodes[itemName] as NodeType | undefined;
  return list && item ? { list, item } : null;
}

/**
 * Turns a Toggle into what the Markdown marker typed at the start of its title
 * makes, as in Notion: `# ` a Toggle heading, `- ` a list item or `" ` a quote
 * with the body under it, and a code block or divider when there's no text to
 * lose.
 */
function turnToggleAtTitleMarker(
  view: EditorView,
  from: number,
  to: number,
  typed: string,
): boolean {
  const { state } = view;
  const { schema } = state;
  const $from = state.doc.resolve(from);
  const toggle = $from.node(-1);
  const togglePos = $from.before(-1);
  const titleStart = $from.start();
  const title = $from.parent;
  const paragraph = schema.nodes.paragraph as NodeType | undefined;
  if (!paragraph) return false;
  const rest = title.content.cut(to - titleStart);

  const heading = /^(#{1,3})\s$/.exec(typed);
  if (heading?.[1]) {
    const tr = state.tr.delete(titleStart, to);
    tr.setNodeMarkup(togglePos, undefined, {
      ...toggle.attrs,
      headingLevel: heading[1].length,
    });
    view.dispatch(tr);
    return true;
  }

  const lines = Fragment.from(paragraph.create(null, rest)).append(
    toggle.content.cut(title.nodeSize),
  );
  const list = listTypesForMarker(typed, schema);
  if (list) {
    if (!list.item.validContent(lines)) return false;
    const tr = state.tr.replaceWith(
      togglePos,
      togglePos + toggle.nodeSize,
      list.list.create(null, list.item.create(null, lines)),
    );
    tr.setSelection(TextSelection.create(tr.doc, togglePos + 3));
    view.dispatch(tr.scrollIntoView());
    return true;
  }
  const quote = schema.nodes.blockquote as NodeType | undefined;
  if (TITLE_QUOTE_MARKER.test(typed) && quote?.validContent(lines)) {
    const tr = state.tr.replaceWith(
      togglePos,
      togglePos + toggle.nodeSize,
      quote.create(null, lines),
    );
    tr.setSelection(TextSelection.create(tr.doc, togglePos + 2));
    view.dispatch(tr.scrollIntoView());
    return true;
  }

  // With a title or a body left, the marker stays text.
  if (rest.size > 0 || toggle.childCount > 1) return false;
  const code = TITLE_CODE_MARKER.exec(typed);
  const codeBlock = schema.nodes.codeBlock as NodeType | undefined;
  if (code && codeBlock) {
    const tr = state.tr.replaceWith(
      togglePos,
      togglePos + toggle.nodeSize,
      codeBlock.create(code[1] ? { language: code[1] } : null),
    );
    tr.setSelection(TextSelection.create(tr.doc, togglePos + 1));
    view.dispatch(tr.scrollIntoView());
    return true;
  }
  const divider = schema.nodes.horizontalRule as NodeType | undefined;
  if (TITLE_DIVIDER_MARKER.test(typed) && divider) {
    const tr = state.tr.replaceWith(togglePos, togglePos + toggle.nodeSize, [
      divider.create(),
      paragraph.create(),
    ]);
    tr.setSelection(
      TextSelection.create(tr.doc, togglePos + divider.create().nodeSize + 1),
    );
    view.dispatch(tr.scrollIntoView());
    return true;
  }
  return false;
}

/**
 * How long the page has to be quiet before a title out of place is put right.
 * That rewrites the title, and whatever another tab types into the old one
 * before the rewrite reaches it is lost. Whoever typed last is the first to
 * come out of this wait, so it's usually their tab that does it.
 */
export const STRAY_TITLE_REPAIR_DELAY_MS = 1000;

/**
 * The edit that leaves each Toggle one title, its first child, or null when
 * they all have that. A second title that only repeats the first goes, and one
 * with text of its own stays as a body line. Each tab sees the same merge, so
 * they delete the same nodes and the page settles on one title.
 */
function repairStrayTitles(state: EditorState): Transaction | null {
  const paragraph = state.schema.nodes.paragraph as NodeType | undefined;
  const tr = state.tr;
  const toggles: { pos: number; node: ProseMirrorNode }[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name === "notionToggle") toggles.push({ pos, node });
    return !node.isTextblock;
  });
  // From the end, so a change never moves what's left to do.
  for (const { pos, node } of toggles.reverse()) {
    const titles: { pos: number; node: ProseMirrorNode }[] = [];
    node.forEach((child, offset) => {
      if (child.type.name === TOGGLE_TITLE_NODE) {
        titles.push({ pos: pos + 1 + offset, node: child });
      }
    });
    const first = titles.shift();
    if (!first) continue;
    for (const stray of titles.reverse()) {
      const at = tr.mapping.map(stray.pos);
      if (!stray.node.content.size || stray.node.eq(first.node)) {
        tr.delete(at, at + stray.node.nodeSize);
      } else if (paragraph) {
        tr.setNodeMarkup(at, paragraph);
      }
    }
    if (first.pos !== pos + 1) {
      const at = tr.mapping.map(first.pos);
      tr.delete(at, at + first.node.nodeSize);
      tr.insert(tr.mapping.map(pos + 1), first.node);
    }
  }
  if (!tr.docChanged) return null;
  return tr.setMeta("addToHistory", false);
}

/** The Toggles of the old document that the changes touched, by position. */
function togglesTouchedBy(
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
            if (node.type.name === "notionToggle") found.set(pos, node);
          },
        );
      });
      mapping.appendMap(stepMap);
    }
  }
  return found;
}

/**
 * Where an old document's position is after the changes, or null when the
 * token right after it was deleted.
 */
function mapKept(
  transactions: readonly Transaction[],
  pos: number,
  assoc: -1 | 1,
): number | null {
  let mapped = pos;
  for (const transaction of transactions) {
    const result = transaction.mapping.mapResult(mapped, assoc);
    if (result.deletedAfter) return null;
    mapped = result.pos;
  }
  return mapped;
}

/**
 * Where an old Toggle is after the changes. An edit can delete its start,
 * such as one from the block above into its title, and leave the rest of it,
 * which then ends where it ended.
 */
function toggleAfterChanges(
  transactions: readonly Transaction[],
  pos: number,
  toggle: ProseMirrorNode,
  doc: ProseMirrorNode,
): number | null {
  const start = mapKept(transactions, pos, 1);
  if (start !== null) return start;
  const end = mapKept(transactions, pos + toggle.nodeSize - 1, -1);
  if (end === null) return null;
  const $end = doc.resolve(end);
  return $end.depth > 0 ? $end.before() : null;
}

export const NotionToggleSummary = Node.create<NotionToggleOptions>({
  name: TOGGLE_TITLE_NODE,
  priority: 1000,
  content: "inline*",
  defining: true,

  addOptions() {
    return { isEdit: isNotRemoteChange };
  },

  parseHTML() {
    return [{ tag: "div[data-notion-toggle-title]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-notion-toggle-title": "true",
        "data-placeholder": TOGGLE_SUMMARY_PLACEHOLDER,
        class: "content-toggle__title",
      }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => splitToggleTitle(editor),
      "Mod-Enter": ({ editor }) => toggleOpenAtTitle(editor),
      Backspace: ({ editor }) => unwrapToggleAtTitleStart(editor),
      Delete: ({ editor }) => joinBlockBelowToToggleTitle(editor),
      Tab: ({ editor }) =>
        nestBlockInToggleAbove(editor) || shiftToggleAtTitle(editor, 1),
      "Shift-Tab": ({ editor }) => shiftToggleAtTitle(editor, -1),
    };
  },

  addProseMirrorPlugins() {
    const { editor, options } = this;
    // A plugin's follow-up is only as much this tab's edit as the change it
    // follows.
    const isEdit = (transaction: Transaction) =>
      options.isEdit(
        (transaction.getMeta("appendedTransaction") as
          | Transaction
          | undefined) ?? transaction,
      );
    return [
      // A closed Toggle hides its body, so the caret can't stay in there: the
      // next keys would edit text no one can see. However the Toggle closed,
      // the caret moves to its title.
      new Plugin({
        key: new PluginKey("notionToggleHiddenCaret"),
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged || tr.selectionSet)) {
            return null;
          }
          const { $from, $to } = newState.selection;
          const end = titleHidingPosition($from) ?? titleHidingPosition($to);
          if (end === null) return null;
          return newState.tr.setSelection(
            TextSelection.create(newState.doc, end),
          );
        },
      }),
      // After the change, not with it: y-tiptap doesn't write what follows a
      // change that came from another tab.
      new Plugin({
        key: new PluginKey("notionToggleStrayTitles"),
        view() {
          let timer: ReturnType<typeof setTimeout> | null = null;
          return {
            update(view, prevState) {
              if (view.state.doc.eq(prevState.doc)) return;
              if (timer !== null) clearTimeout(timer);
              timer = setTimeout(() => {
                timer = null;
                if (
                  view.isDestroyed ||
                  view.composing ||
                  !editor.isEditable ||
                  isSuggestingEdits(view.state)
                ) {
                  return;
                }
                const repair = repairStrayTitles(view.state);
                if (repair) view.dispatch(repair);
              }, STRAY_TITLE_REPAIR_DELAY_MS);
            },
            destroy() {
              if (timer !== null) clearTimeout(timer);
            },
          };
        },
      }),
      new Plugin({
        key: new PluginKey("notionToggleSummary"),
        props: {
          // A title belongs to its Toggle, so one pasted or dropped on its own
          // is a line of text, not a second title for repairStrayTitles.
          transformPasted(slice, view) {
            const paragraph = view.state.schema.nodes.paragraph as
              | NodeType
              | undefined;
            if (!paragraph) return slice;
            const lines: ProseMirrorNode[] = [];
            slice.content.forEach((node) =>
              lines.push(
                node.type.name === TOGGLE_TITLE_NODE
                  ? paragraph.create(null, node.content)
                  : node,
              ),
            );
            return new Slice(
              Fragment.fromArray(lines),
              slice.openStart,
              slice.openEnd,
            );
          },
          handleTextInput(view, from, to, text) {
            const $from = view.state.doc.resolve(from);
            if ($from.parent.type.name !== TOGGLE_TITLE_NODE) return false;
            const overHiddenBody = deleteFromClosedTitle(view.state);
            if (overHiddenBody) {
              view.dispatch(overHiddenBody.insertText(text));
              return true;
            }
            const typed =
              $from.parent.textBetween(0, $from.parentOffset, undefined, "￼") +
              text;
            if (turnToggleAtTitleMarker(view, from, to, typed)) return true;
            if (!TITLE_BLOCK_MARKERS.some((marker) => marker.test(typed))) {
              return false;
            }
            view.dispatch(view.state.tr.insertText(text, from, to));
            return true;
          },
        },
        // An edit that takes a titled Toggle's title away, such as deleting
        // from the block above into the title, leaves the Toggle an empty
        // title rather than none. The text it moved stays where the edit put
        // it. A command that only turned the title into another kind of line,
        // such as a heading shortcut or the toolbar's style menu, leaves it
        // the title, and a heading makes a Toggle heading. Another tab's
        // change is left to that tab.
        appendTransaction(transactions, oldState, newState) {
          if (!editor.isEditable || !transactions.some(isEdit)) return null;
          const titleType = newState.schema.nodes[TOGGLE_TITLE_NODE] as
            | NodeType
            | undefined;
          if (!titleType) return null;
          const touched = togglesTouchedBy(transactions, oldState.doc);
          // A Toggle that kept its title in `summary` and still starts where
          // it did stays that way, even when a titled one's end joined it.
          const keptUntitled = new Set<number>();
          for (const [pos, toggle] of touched) {
            if (toggleTitleNode(toggle)) continue;
            const start = mapKept(transactions, pos, 1);
            if (start !== null) keptUntitled.add(start);
          }
          const untitled = new Map<number, ProseMirrorNode | null>();
          for (const [pos, toggle] of touched) {
            const title = toggleTitleNode(toggle);
            if (!title) continue;
            const mapped = toggleAfterChanges(
              transactions,
              pos,
              toggle,
              newState.doc,
            );
            if (mapped === null || keptUntitled.has(mapped)) continue;
            const after = newState.doc.nodeAt(mapped);
            if (
              after?.type.name === "notionToggle" &&
              !toggleTitleNode(after)
            ) {
              const line = after.firstChild;
              const sameLine =
                line?.isTextblock &&
                line.content.eq(title.content) &&
                mapKept(transactions, pos + 2, 1) === mapped + 2;
              untitled.set(mapped, sameLine ? line : null);
            }
          }
          if (untitled.size === 0) return null;
          const tr = newState.tr;
          const lastFirst = [...untitled].sort(
            ([left], [right]) => right - left,
          );
          for (const [pos, line] of lastFirst) {
            if (!line) {
              tr.insert(pos + 1, titleType.create());
              continue;
            }
            tr.setNodeMarkup(pos + 1, titleType);
            const level = Number(line.attrs.level);
            if (line.type.name === "heading" && level <= 3) {
              tr.setNodeAttribute(pos, "headingLevel", level);
            }
          }
          return tr;
        },
      }),
    ];
  },
});

function CalloutView({ editor, getPos, node, extension }: NodeViewProps) {
  const documentId = (extension.options as NotionBlockAtomOptions).documentId;
  const registerPrivateIcon = useActionMutation(
    "register-private-callout-icon",
  );
  const icon = typeof node.attrs.icon === "string" ? node.attrs.icon : "💡";
  const updateIcon = async (value: IconValue | null) => {
    if (!editor.isEditable) throw new Error("Callout is not editable");
    if (value?.kind === "image" && value.authority === "private-icon") {
      if (!documentId) throw new Error("Callout document is unavailable");
      await registerPrivateIcon.mutateAsync({
        documentId,
        assetId: value.assetId,
      });
    }
    const pos = getPos();
    if (typeof pos !== "number") throw new Error("Callout is unavailable");
    const currentNode = editor.state.doc.nodeAt(pos);
    if (currentNode?.type.name !== "notionCallout")
      throw new Error("Callout is unavailable");
    const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
      ...currentNode.attrs,
      icon: value ? serializeIconValue(value) : "💡",
    });
    tr.setMeta("preventClearDocument", true);
    tr.setMeta("uiEvent", "pointer");
    editor.view.dispatch(tr);
  };
  return (
    <NodeViewWrapper
      data-notion-callout="true"
      data-icon={icon}
      data-color={node.attrs.color || undefined}
    >
      <div data-notion-callout-icon="true" contentEditable={false}>
        {isSuggestingEdits(editor.state) ? (
          <span className="flex size-9 shrink-0 items-center justify-center">
            <ContentIcon value={icon} size={22} />
          </span>
        ) : (
          <EmojiPicker
            icon={icon}
            assetScopeDocumentId={documentId}
            variant="compact"
            onSelect={updateIcon}
          />
        )}
      </div>
      <NodeViewContent data-notion-callout-content="true" />
    </NodeViewWrapper>
  );
}

export const NotionCallout = Node.create({
  name: "notionCallout",
  group: "block",
  content: "block*",
  defining: true,
  draggable: true,

  addAttributes() {
    return {
      icon: { default: "💡" },
      color: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: "callout",
        getAttrs: (element) => {
          const node = element as HTMLElement;
          return {
            icon: node.getAttribute("icon") || "💡",
            color: node.getAttribute("color"),
          };
        },
      },
      {
        tag: "div[data-notion-callout]",
        getAttrs: (element) => {
          const node = element as HTMLElement;
          return {
            icon: node.getAttribute("data-icon") || "💡",
            color: node.getAttribute("data-color"),
          };
        },
        contentElement: (element) =>
          (element as HTMLElement).querySelector(
            "[data-notion-callout-content]",
          ) as HTMLElement,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const parsedIcon = safeParseIconValue(HTMLAttributes.icon || "💡");
    const fallbackIcon =
      parsedIcon.success && parsedIcon.data?.kind === "emoji"
        ? parsedIcon.data.emoji
        : "";
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-notion-callout": "true",
        "data-icon": HTMLAttributes.icon || "💡",
        "data-color": HTMLAttributes.color || undefined,
      }),
      ["div", { "data-notion-callout-icon": "true" }, fallbackIcon],
      ["div", { "data-notion-callout-content": "true" }, 0],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },

  addStorage() {
    return {
      markdown: {
        serialize: function (_state: any, node: any) {
          const inner = serializeInnerMarkdown((this as any).editor, node);
          _state.write(
            serializeContainerTag(
              "callout",
              {
                icon: node.attrs.icon || "💡",
                color: node.attrs.color || null,
              },
              inner,
            ),
          );
          _state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

export const NotionColumns = Node.create({
  name: "notionColumns",
  group: "block",
  content: "notionColumn+",
  defining: true,

  parseHTML() {
    return [{ tag: "columns" }, { tag: "div[data-notion-columns]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-notion-columns": "true" }),
      0,
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize: function (_state: any, node: any) {
          const inner = serializeInnerMarkdown((this as any).editor, node);
          _state.write(serializeContainerTag("columns", {}, inner));
          _state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

export const NotionColumn = Node.create({
  name: "notionColumn",
  content: "block+",
  defining: true,

  parseHTML() {
    return [{ tag: "column" }, { tag: "div[data-notion-column]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-notion-column": "true" }),
      0,
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize: function (_state: any, node: any) {
          const inner = serializeInnerMarkdown((this as any).editor, node);
          _state.write(serializeContainerTag("column", {}, inner));
          _state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

export const NotionBlockAtom = Node.create({
  name: "notionBlockAtom",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addOptions(): NotionBlockAtomOptions {
    return {
      onOpenPageLink: undefined,
    };
  },

  addAttributes() {
    return {
      tagName: { default: "unknown" },
      attrsJson: { default: "{}" },
      label: { default: "" },
      __raw: { default: "" },
    };
  },

  parseHTML() {
    return [
      ...BLOCK_ATOM_TAGS.map((tag) => ({
        tag,
        getAttrs: (element: any) => {
          const node = element as HTMLElement;
          return {
            tagName: tag,
            attrsJson: JSON.stringify(readElementAttributes(node)),
            label: node.textContent?.trim() || "",
          };
        },
      })),
      {
        tag: "div[data-notion-block-atom]",
        getAttrs: (element) => {
          const node = element as HTMLElement;
          return {
            tagName: node.getAttribute("data-tag-name") || "unknown",
            attrsJson: node.getAttribute("data-attrs-json") || "{}",
            label: node.getAttribute("data-label") || "",
            __raw: node.getAttribute("data-raw") || "",
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-notion-block-atom": "true",
        "data-tag-name": HTMLAttributes.tagName,
        "data-attrs-json": HTMLAttributes.attrsJson,
        "data-label": HTMLAttributes.label || "",
        "data-raw": HTMLAttributes.__raw || "",
      }),
      HTMLAttributes.label || humanizeTag(HTMLAttributes.tagName || "block"),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlockAtomView);
  },

  addStorage() {
    return {
      markdown: {
        serialize: (_state: any, node: any) => {
          _state.write(
            serializeAtomTag(
              node.attrs.tagName || "unknown",
              node.attrs.attrsJson || "{}",
              node.attrs.label || "",
            ),
          );
          _state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

export const NotionInlineAtom = Node.create({
  name: "notionInlineAtom",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addInputRules() {
    return [
      new InputRule({
        find: (text) => {
          const match = findTrailingPlainInlineMath(text);
          if (!match) return null;
          return {
            index: match.from,
            text: text.slice(match.from, match.to),
            data: { latex: match.latex },
          };
        },
        handler: ({ state, range, match }) => {
          const latex = match.data?.latex;
          if (typeof latex !== "string") return null;

          const mathNode = state.schema.nodes.notionInlineAtom?.create({
            tagName: "math",
            attrsJson: "{}",
            label: latex,
          });
          if (!mathNode) return null;

          state.tr.replaceWith(range.from, range.to, mathNode).scrollIntoView();
        },
      }),
    ];
  },

  addAttributes() {
    return {
      tagName: { default: "mention-user" },
      attrsJson: { default: "{}" },
      label: { default: "" },
    };
  },

  parseHTML() {
    return [
      ...INLINE_ATOM_TAGS.map((tag) => ({
        tag,
        getAttrs: (element: any) => {
          const node = element as HTMLElement;
          return {
            tagName: tag,
            attrsJson: JSON.stringify(readElementAttributes(node)),
            label: node.textContent?.trim() || "",
          };
        },
      })),
      {
        tag: "span[data-notion-inline-atom]",
        getAttrs: (element) => {
          const node = element as HTMLElement;
          return {
            tagName: node.getAttribute("data-tag-name") || "mention-user",
            attrsJson: node.getAttribute("data-attrs-json") || "{}",
            label: node.textContent?.trim() || "",
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-notion-inline-atom": "true",
        "data-tag-name": HTMLAttributes.tagName,
        "data-attrs-json": HTMLAttributes.attrsJson,
        class: "content-inline-atom",
      }),
      HTMLAttributes.label || humanizeTag(HTMLAttributes.tagName || "mention"),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(InlineAtomView);
  },

  addStorage() {
    return {
      markdown: {
        serialize: (_state: any, node: any) => {
          _state.write(
            serializeAtomTag(
              node.attrs.tagName || "mention-user",
              node.attrs.attrsJson || "{}",
              node.attrs.label || "",
            ),
          );
        },
        parse: {},
      },
    };
  },
});

export function createNotionEditorExtensions(
  blockAtomOptions: NotionBlockAtomOptions = {},
) {
  return [
    NotionSpanMark,
    blockAtomOptions.isEdit
      ? NotionToggle.configure({ isEdit: blockAtomOptions.isEdit })
      : NotionToggle,
    NotionCallout.configure({ documentId: blockAtomOptions.documentId }),
    NotionColumns,
    NotionColumn,
    NotionBlockAtom.configure(blockAtomOptions),
    NotionInlineAtom,
  ];
}
