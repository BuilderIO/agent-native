import { RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION } from "@agent-native/toolkit/editor";
import { Extension } from "@tiptap/core";
import type {
  Fragment,
  Node as ProseMirrorNode,
  Slice,
} from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import {
  isOpenSuggestionFrame,
  suggestionFrameShape,
  suggestionNodeRole,
} from "./model";

type NodeRange = { from: number; to: number };

const role = (node: ProseMirrorNode) => suggestionNodeRole(node.type.name);
const isFrozen = (node: ProseMirrorNode) => role(node) === "frozen";
const isFrame = (node: ProseMirrorNode) => role(node) === "frame";
const isOpenFrame = (node: ProseMirrorNode) =>
  isOpenSuggestionFrame(node.type.name);

// The start of the innermost ancestor that matches, or -1 for the page.
function enclosingStart(
  doc: ProseMirrorNode,
  pos: number,
  matches: (node: ProseMirrorNode) => boolean,
): number {
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth--) {
    if (matches($pos.node(depth))) return $pos.before(depth);
  }
  return -1;
}

export function frozenSuggestionRanges(doc: ProseMirrorNode): NodeRange[] {
  const ranges: NodeRange[] = [];
  doc.descendants((node, pos) => {
    if (!isFrozen(node)) return true;
    ranges.push({ from: pos, to: pos + node.nodeSize });
    return false;
  });
  return ranges;
}

// Mark and attribute steps have empty step maps, so read the range each step
// touches from its own fields rather than from its map.
function stepRange(
  step: Transaction["steps"][number],
  doc: ProseMirrorNode,
): NodeRange | null {
  const { from, to, pos } = step as unknown as {
    from?: number;
    to?: number;
    pos?: number;
  };
  if (typeof from === "number" && typeof to === "number") return { from, to };
  if (typeof pos === "number") {
    return { from: pos, to: pos + (doc.nodeAt(pos)?.nodeSize ?? 0) };
  }
  return null;
}

function findsNode(
  content: Fragment,
  from: number,
  to: number,
  matches: (node: ProseMirrorNode, pos: number) => boolean,
): boolean {
  let found = false;
  content.nodesBetween(from, to, (node, pos) => {
    if (found) return false;
    found = matches(node, pos);
    return !found && !isFrozen(node);
  });
  return found;
}

const frames = new WeakMap<ProseMirrorNode, string>();

function frameSignature(doc: ProseMirrorNode): string {
  let signature = frames.get(doc);
  if (signature !== undefined) return signature;
  const parts: string[] = [];
  doc.descendants((node) => {
    if (isFrame(node)) {
      const children: string[] = [];
      node.forEach((child) => children.push(child.type.name));
      parts.push(suggestionFrameShape(node.type.name, node.attrs, children));
    }
    return !isFrozen(node);
  });
  signature = parts.join("\n");
  frames.set(doc, signature);
  return signature;
}

// Loading a draft or the canonical body replaces the whole document outside
// undo history. Select-all followed by typing also replaces the whole
// document, so the history flag is what tells a load from an edit. Steps after
// a load edit the loaded body, so they are checked against it. Moving or
// deleting a whole frame is refused even when every frame keeps its shape.
// Text can't cross a frame's edge either, whether one step joins across it
// (Backspace after a callout) or two steps move a block over it (Shift-Tab
// out of a toggle, a drag): the saved suggestion would replace the frame's
// closing tag, which the server refuses.
export function editsUnsupportedSuggestionNode(
  transaction: Transaction,
): boolean {
  if (transaction.getMeta(RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION)) return false;
  const loadsBody = transaction.getMeta("addToHistory") === false;
  let base = transaction.before;
  let reachesFrame = false;
  let container: number | undefined;
  for (const [index, step] of transaction.steps.entries()) {
    const doc = transaction.docs[index]!;
    const range = stepRange(step, doc);
    if (!range) return true;
    if (loadsBody && range.from === 0 && range.to === doc.content.size) {
      base = transaction.docs[index + 1] ?? transaction.doc;
      reachesFrame = false;
      container = undefined;
      continue;
    }
    const { slice, gapFrom, gapTo } = step as {
      slice?: Slice;
      gapFrom?: number;
      gapTo?: number;
    };
    const inserted = slice?.content;
    const coversFrame = (node: ProseMirrorNode, pos: number) =>
      isFrame(node) && pos >= range.from && pos + node.nodeSize <= range.to;
    if (
      (inserted && findsNode(inserted, 0, inserted.size, isFrozen)) ||
      findsNode(doc.content, range.from, range.to, isFrozen) ||
      findsNode(doc.content, range.from, range.to, coversFrame)
    ) {
      return true;
    }
    if (slice) {
      const frame = enclosingStart(doc, range.from, isFrame);
      if (
        [range.to, gapFrom, gapTo].some(
          (pos) =>
            pos !== undefined && enclosingStart(doc, pos, isFrame) !== frame,
        )
      ) {
        return true;
      }
      const start = enclosingStart(doc, range.from, isOpenFrame);
      const mapped =
        start < 0 ? -1 : transaction.mapping.slice(index).map(start);
      if (container !== undefined && container !== mapped) return true;
      container = mapped;
    }
    reachesFrame ||=
      (inserted !== undefined &&
        findsNode(inserted, 0, inserted.size, isFrame)) ||
      findsNode(doc.content, range.from, range.to, isFrame);
  }
  return (
    reachesFrame && frameSignature(base) !== frameSignature(transaction.doc)
  );
}

const readOnlyBlocksKey = new PluginKey("suggestingReadOnlyBlocks");

export function isSuggestingEdits(state: EditorState): boolean {
  return readOnlyBlocksKey.get(state)?.spec.isSuggesting?.() === true;
}

export function suggestingReadOnlyBlocksPlugin(isSuggesting: () => boolean) {
  let cached: { doc: ProseMirrorNode; decorations: DecorationSet } | null =
    null;
  return new Plugin({
    key: readOnlyBlocksKey,
    isSuggesting,
    filterTransaction: (transaction) =>
      !isSuggesting() ||
      !transaction.docChanged ||
      !editsUnsupportedSuggestionNode(transaction),
    props: {
      decorations(state) {
        if (!isSuggesting()) return null;
        if (cached?.doc !== state.doc) {
          cached = {
            doc: state.doc,
            decorations: DecorationSet.create(
              state.doc,
              frozenSuggestionRanges(state.doc).map(({ from, to }) =>
                Decoration.node(from, to, { contenteditable: "false" }),
              ),
            ),
          };
        }
        return cached.decorations;
      },
    },
  });
}

export const SuggestingReadOnlyBlocks = Extension.create<{
  isSuggesting: () => boolean;
}>({
  name: "suggestingReadOnlyBlocks",

  addOptions() {
    return { isSuggesting: () => false };
  },

  addProseMirrorPlugins() {
    return [suggestingReadOnlyBlocksPlugin(this.options.isSuggesting)];
  },
});
