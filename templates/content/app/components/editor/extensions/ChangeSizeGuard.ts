import { collabUpdateFits } from "@agent-native/core/client/collab";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { updateYFragment, ySyncPluginKey } from "@tiptap/y-tiptap";
import * as Y from "yjs";

// Below this many bytes of steps a change cannot come near the update limit,
// so typing never pays for reading the doc's size.
const MEASURED_CHANGE_BYTES = 64 * 1024;

const encoder = new TextEncoder();

// What the change's steps take as JSON, which measures at or above the Yjs
// update they make. Counting steps rather than inserted positions keeps a
// node with large attributes, one position wide, in the count.
function stepJsonBytes(tr: Transaction): number {
  let bytes = 0;
  for (const step of tr.steps) {
    bytes += encoder.encode(JSON.stringify(step.toJSON())).length;
  }
  return bytes;
}

/** The Yjs update that writing `body` onto `doc` makes, measured on a copy. */
export function bodyUpdateBytes(doc: Y.Doc, body: ProseMirrorNode): number {
  const copy = new Y.Doc();
  try {
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    const vector = Y.encodeStateVector(copy);
    updateYFragment(copy, copy.getXmlFragment("default"), body, {
      mapping: new Map(),
      isOMark: new Map(),
    });
    return Y.encodeStateAsUpdate(copy, vector).length;
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
      const bound = stepJsonBytes(tr);
      if (bound < MEASURED_CHANGE_BYTES) return true;
      const stateBytes = Y.encodeStateAsUpdate(doc).length;
      if (
        collabUpdateFits(bound, stateBytes) ||
        collabUpdateFits(bodyUpdateBytes(doc, tr.doc), stateBytes)
      ) {
        return true;
      }
      options.refused();
      return false;
    },
  });
}
