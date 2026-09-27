import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import {
  CONTENT_BODY_DOM_MARK,
  CONTENT_BODY_ELEMENT_TIMING,
  markStartupMilestone,
} from "@/lib/startup-timing";

function firstTextBlock(doc: import("@tiptap/pm/model").Node) {
  let found: { pos: number; size: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.isTextblock && node.textContent.trim()) {
      found = { pos, size: node.nodeSize };
      return false;
    }
    return true;
  });
  return found as { pos: number; size: number } | null;
}

export function createBodyElementTimingPlugin(documentId?: string) {
  return new Plugin({
    key: new PluginKey("bodyElementTiming"),
    view(view) {
      let marked = false;
      const markOnce = () => {
        if (marked || !firstTextBlock(view.state.doc)) return;
        marked = true;
        markStartupMilestone(CONTENT_BODY_DOM_MARK, documentId);
      };
      markOnce();
      return { update: markOnce };
    },
    props: {
      decorations(state) {
        const block = firstTextBlock(state.doc);
        if (!block) return DecorationSet.empty;
        // Element Timing reports text only through the element that directly
        // owns the text nodes, so wrap the inline content rather than tagging
        // the block, whose text may sit inside marks or links.
        return DecorationSet.create(state.doc, [
          Decoration.inline(block.pos + 1, block.pos + block.size - 1, {
            elementtiming: CONTENT_BODY_ELEMENT_TIMING,
          }),
        ]);
      },
    },
  });
}

// Tags the text of the first non-empty block with an Element Timing identifier
// so the browser reports when the document body first paints.
export const BodyElementTiming = Extension.create<{ documentId?: string }>({
  name: "bodyElementTiming",
  addOptions() {
    return { documentId: undefined };
  },
  addProseMirrorPlugins() {
    return [createBodyElementTimingPlugin(this.options.documentId)];
  },
});
