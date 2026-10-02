import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
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

// Replacing the whole document loads a draft or the canonical body; every
// other change that reaches into an unsupported node edits it.
export function editsUnsupportedSuggestionNode(
  transaction: Transaction,
): boolean {
  return transaction.steps.some((step, index) => {
    const doc = transaction.docs[index]!;
    const range = stepRange(step, doc);
    if (!range) return true;
    if (range.from === 0 && range.to === doc.content.size) return false;
    let touched = false;
    doc.nodesBetween(range.from, range.to, (node) => {
      if (touched) return false;
      if (supportsSuggestionNode(node.type.name)) return true;
      touched = true;
      return false;
    });
    return touched;
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
