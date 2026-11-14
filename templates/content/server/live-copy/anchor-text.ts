import {
  CollabStateMalformedError,
  createBoundedTaskRunner,
  strictBase64ToUint8Array,
} from "@agent-native/core/collab";
import type { DbExec } from "@agent-native/core/db";

import { CONTENT_ANCHOR_TEXT_TASK } from "./task-names.js";
import source from "./tasks.ts?bounded-task";

// Its own worker, as `holds.ts` has: this runs under the page lock.
const runner = createBoundedTaskRunner({ source });

/**
 * The text comment quotes on a page's live copy were captured from: the
 * tree open editors showed, read through `tx`. Null when the live copy
 * holds no body. Read in a commit's persist, before core saves the commit's
 * state, it is the state that commit replaces; a commit that raced another
 * fails core's version check and rolls back with it.
 */
export async function liveCopyAnchorText(
  tx: DbExec,
  documentId: string,
): Promise<string | null> {
  const { rows } = await tx.execute({
    sql: "SELECT yjs_state FROM _collab_docs WHERE doc_id = ?",
    args: [documentId],
  });
  if (rows.length === 0) return null;
  const stored = rows[0].yjs_state;
  const state =
    typeof stored === "string" ? strictBase64ToUint8Array(stored) : null;
  if (!state) {
    throw new CollabStateMalformedError(
      documentId,
      "base64",
      `_collab_docs.yjs_state for ${documentId} is not valid base64`,
    );
  }
  if (state.length === 0) return null;
  const text = await runner.run<unknown>(CONTENT_ANCHOR_TEXT_TASK, { state });
  if (text !== null && typeof text !== "string") {
    throw new TypeError(
      `${CONTENT_ANCHOR_TEXT_TASK} answered ${JSON.stringify(text)}`,
    );
  }
  return text;
}
