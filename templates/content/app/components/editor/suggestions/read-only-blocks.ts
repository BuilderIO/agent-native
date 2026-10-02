import { RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION } from "@agent-native/toolkit/editor";
import { Extension } from "@tiptap/core";
import type {
  Fragment,
  Node as ProseMirrorNode,
  Slice,
} from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { supportsSuggestionNode } from "./model";

type NodeRange = { from: number; to: number };

export function unsupportedSuggestionRanges(doc: ProseMirrorNode): NodeRange[] {
  const ranges: NodeRange[] = [];
  doc.descendants((node, pos) => {
    if (supportsSuggestionNode(node.type.name)) return true;
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

function holdsUnsupportedNode(
  content: Fragment,
  from = 0,
  to = content.size,
): boolean {
  let found = false;
  content.nodesBetween(from, to, (node) => {
    if (found) return false;
    if (supportsSuggestionNode(node.type.name)) return true;
    found = true;
    return false;
  });
  return found;
}

// Loading a draft or the canonical body replaces the whole document outside
// undo history. Select-all followed by typing also replaces the whole
// document, so the history flag is what tells a load from an edit. A step
// that inserts an unsupported node is refused too: once in the draft, the
// node would be read-only and could not be removed again.
export function editsUnsupportedSuggestionNode(
  transaction: Transaction,
): boolean {
  if (transaction.getMeta(RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION)) return false;
  const loadsBody = transaction.getMeta("addToHistory") === false;
  return transaction.steps.some((step, index) => {
    const doc = transaction.docs[index]!;
    const range = stepRange(step, doc);
    if (!range) return true;
    if (loadsBody && range.from === 0 && range.to === doc.content.size) {
      return false;
    }
    const { slice } = step as { slice?: Slice };
    return (
      (slice !== undefined && holdsUnsupportedNode(slice.content)) ||
      holdsUnsupportedNode(doc.content, range.from, range.to)
    );
  });
}

const readOnlyBlocksKey = new PluginKey("suggestingReadOnlyBlocks");

export function suggestingReadOnlyBlocksPlugin(isSuggesting: () => boolean) {
  let cached: { doc: ProseMirrorNode; decorations: DecorationSet } | null =
    null;
  return new Plugin({
    key: readOnlyBlocksKey,
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
              unsupportedSuggestionRanges(state.doc).map(({ from, to }) =>
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
