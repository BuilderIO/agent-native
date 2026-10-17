import { collabUpdateFits } from "@agent-native/core/client/collab";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import {
  AddMarkStep,
  AddNodeMarkStep,
  AttrStep,
  DocAttrStep,
  RemoveMarkStep,
  RemoveNodeMarkStep,
  ReplaceStep,
  type Step,
} from "@tiptap/pm/transform";
import { updateYFragment, ySyncPluginKey } from "@tiptap/y-tiptap";
import * as Y from "yjs";

// Below this many bytes a change cannot come near the update limit, so
// typing never pays for reading the doc's size.
const MEASURED_CHANGE_BYTES = 64 * 1024;

const encoder = new TextEncoder();

function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

// Whether the Yjs binding writes `step` as no more than the step carries:
// text replacing text within one textblock, an attribute, or a mark.
function writesOnlyItself(step: Step, before: ProseMirrorNode): boolean {
  if (
    step instanceof AttrStep ||
    step instanceof DocAttrStep ||
    step instanceof AddMarkStep ||
    step instanceof RemoveMarkStep ||
    step instanceof AddNodeMarkStep ||
    step instanceof RemoveNodeMarkStep
  ) {
    return true;
  }
  if (!(step instanceof ReplaceStep)) return false;
  const { slice } = step;
  let onlyText = slice.openStart === 0 && slice.openEnd === 0;
  slice.content.forEach((node) => {
    onlyText &&= node.isText;
  });
  const $from = before.resolve(step.from);
  const $to = before.resolve(step.to);
  if (!onlyText || !$from.sameParent($to) || !$from.parent.isTextblock) {
    return false;
  }
  $from.parent.nodesBetween($from.parentOffset, $to.parentOffset, (node) => {
    onlyText &&= node.isText;
  });
  return onlyText;
}

// What a change can make the Yjs binding write, as JSON, which measures at
// or above the update: each step, and the blocks around any step that changes
// structure. The binding writes those blocks again when it cannot match them,
// so wrapping a long selection costs the selection though its step names
// only the wrapper.
function changeBound(tr: Transaction): number {
  let bytes = 0;
  tr.steps.forEach((step, index) => {
    bytes += jsonBytes(step.toJSON());
    if (writesOnlyItself(step, tr.docs[index]!)) return;
    const after = tr.docs[index + 1] ?? tr.doc;
    let start = Infinity;
    let end = -Infinity;
    step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      start = Math.min(start, newStart);
      end = Math.max(end, newEnd);
    });
    if (start > end) {
      bytes = Infinity;
      return;
    }
    const $start = after.resolve(start);
    // Removing whole nodes leaves every node around them as it was.
    if (start === end && !$start.parent.inlineContent) return;
    const range = $start.blockRange(after.resolve(end));
    if (!range) return;
    for (let child = range.startIndex; child < range.endIndex; child++) {
      bytes += jsonBytes(range.parent.child(child).toJSON());
    }
  });
  return bytes;
}

/**
 * The Yjs update that writing `body` onto `doc` makes, and the size of the
 * document it leaves, measured on a copy.
 */
export function measureBodyUpdate(
  doc: Y.Doc,
  body: ProseMirrorNode,
): { updateBytes: number; stateBytes: number } {
  const copy = new Y.Doc();
  try {
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    const vector = Y.encodeStateVector(copy);
    updateYFragment(copy, copy.getXmlFragment("default"), body, {
      mapping: new Map(),
      isOMark: new Map(),
    });
    return {
      updateBytes: Y.encodeStateAsUpdate(copy, vector).length,
      stateBytes: Y.encodeStateAsUpdate(copy).length,
    };
  } finally {
    copy.destroy();
  }
}

/**
 * Refuses a change the user makes that the collab server would refuse as
 * one update onto `doc()`, calling `refused()` instead of applying it. Once
 * the server refuses an update, every later one from the tab is refused too.
 * Collaborators' changes and the editor's own writes, which skip history,
 * always apply.
 */
export function createChangeSizeGuardPlugin(options: {
  doc: () => Y.Doc | null;
  refused: () => void;
}) {
  return new Plugin({
    key: new PluginKey("contentChangeSizeGuard"),
    filterTransaction(tr) {
      if (
        !tr.docChanged ||
        tr.getMeta(ySyncPluginKey) ||
        tr.getMeta("addToHistory") === false
      ) {
        return true;
      }
      const doc = options.doc();
      if (!doc) return true;
      const bound = changeBound(tr);
      if (bound < MEASURED_CHANGE_BYTES) return true;
      // Twice the bound covers what it leaves out, such as deletions.
      const headroom = 2 * bound;
      if (
        collabUpdateFits(headroom, Y.encodeStateAsUpdate(doc).length + headroom)
      ) {
        return true;
      }
      const measured = measureBodyUpdate(doc, tr.doc);
      if (collabUpdateFits(measured.updateBytes, measured.stateBytes)) {
        return true;
      }
      options.refused();
      return false;
    },
  });
}
