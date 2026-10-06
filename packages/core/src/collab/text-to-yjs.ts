import DiffMatchPatch from "diff-match-patch";
import * as Y from "yjs";

const dmp = new DiffMatchPatch();

export function applyTextToYDoc(
  doc: Y.Doc,
  fieldName: string,
  newText: string,
  origin?: string,
): Uint8Array {
  const ytext = doc.getText(fieldName);
  const currentText = ytext.toString();

  if (currentText === newText) {
    return new Uint8Array(0);
  }

  const diffs = dmp.diff_main(currentText, newText);
  dmp.diff_cleanupEfficiency(diffs);

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
