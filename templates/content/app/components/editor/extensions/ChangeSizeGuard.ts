import { collabUpdateFits } from "@agent-native/core/client/collab";
import type { Slice } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { prosemirrorToYXmlFragment, ySyncPluginKey } from "@tiptap/y-tiptap";
import * as Y from "yjs";

// Below this many inserted positions a change cannot come near the update
// limit, so typing never pays for measuring.
const MEASURED_CHANGE_SIZE = 64 * 1024;

const encoder = new TextEncoder();

function slices(tr: Transaction): Slice[] {
  const found: Slice[] = [];
  for (const step of tr.steps) {
    const slice = (step as { slice?: Slice }).slice;
    if (slice && slice.size > 0) found.push(slice);
  }
  return found;
}

// What the inserted content takes as ProseMirror JSON, which measures at or
// above the Yjs update it makes.
function insertedJsonBytes(inserted: Slice[]): number {
  let bytes = 0;
  for (const slice of inserted) {
    bytes += encoder.encode(JSON.stringify(slice.toJSON())).length;
  }
  return bytes;
}

/** The Yjs update the inserted content makes, written into a doc of its own. */
export function insertedUpdateBytes(tr: Transaction): number {
  let bytes = 0;
  for (const slice of slices(tr)) {
    const doc = new Y.Doc();
    try {
      prosemirrorToYXmlFragment(
        tr.doc.type.create(null, slice.content),
        doc.getXmlFragment("default"),
      );
      bytes += Y.encodeStateAsUpdate(doc).length;
    } finally {
      doc.destroy();
    }
  }
  return bytes;
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
      const inserted = slices(tr);
      let size = 0;
      for (const slice of inserted) size += slice.size;
      if (size < MEASURED_CHANGE_SIZE) return true;
      const stateBytes = Y.encodeStateAsUpdate(doc).length;
      if (
        collabUpdateFits(insertedJsonBytes(inserted), stateBytes) ||
        collabUpdateFits(insertedUpdateBytes(tr), stateBytes)
      ) {
        return true;
      }
      options.refused();
      return false;
    },
  });
}
