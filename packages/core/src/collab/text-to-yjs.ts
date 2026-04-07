/**
 * Bridge between plain text and Yjs CRDT operations.
 *
 * Converts text diffs into minimal Yjs Y.Text operations (insert/delete)
 * so that agent text changes merge cleanly with concurrent editor edits.
 */

import * as Y from "yjs";
import DiffMatchPatch from "diff-match-patch";

const dmp = new DiffMatchPatch();

/**
 * Apply new text content to a Y.Text field, computing a minimal diff
 * and translating it into Yjs insert/delete operations.
 *
 * Returns the binary Yjs update produced by the transaction.
 */
export function applyTextToYDoc(
  doc: Y.Doc,
  fieldName: string,
  newText: string,
  origin?: string,
): Uint8Array {
  const ytext = doc.getText(fieldName);
  const currentText = ytext.toString();

  if (currentText === newText) {
    // No change — return empty update
    return new Uint8Array(0);
  }

  // Compute character-level diff
  const diffs = dmp.diff_main(currentText, newText);
  dmp.diff_cleanupEfficiency(diffs);

  // Capture the update produced by this transaction
  let update: Uint8Array = new Uint8Array(0);
  const handler = (u: Uint8Array) => {
    update = u;
  };
  doc.on("update", handler);

  doc.transact(() => {
    let cursor = 0;
    for (const [op, text] of diffs) {
      switch (op) {
        case DiffMatchPatch.DIFF_EQUAL:
          cursor += text.length;
          break;
        case DiffMatchPatch.DIFF_DELETE:
          ytext.delete(cursor, text.length);
          break;
        case DiffMatchPatch.DIFF_INSERT:
          ytext.insert(cursor, text);
          cursor += text.length;
          break;
      }
    }
  }, origin);

  doc.off("update", handler);
  return update;
}

/**
 * Initialize a Y.Doc with text content (for seeding from existing data).
 * Returns the full document state as a Uint8Array.
 */
export function initYDocWithText(
  fieldName: string,
  text: string,
): { doc: Y.Doc; state: Uint8Array } {
  const doc = new Y.Doc();
  const ytext = doc.getText(fieldName);
  ytext.insert(0, text);
  const state = Y.encodeStateAsUpdate(doc);
  return { doc, state };
}
