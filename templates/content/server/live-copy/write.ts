import {
  mutateLiveCopy,
  type LiveCopyCallChange,
  type LiveCopyMutationResult,
} from "@agent-native/core/collab";
import type { DbExec } from "@agent-native/core/db";

import { contentLiveCopy } from "./binding.js";
import { persistUnchangedContentBodyEdit } from "./persist.js";
import {
  withContentBodyWriteCause,
  type ContentBodyWriteCause,
} from "./write-cause.js";

/**
 * Applies a named edit to a switched page's live copy for a server writer.
 * A changed edit commits through the binding's persist; an unchanged one
 * still locks the page in Content's order and records the cause's intent,
 * which core's binding persist never sees. `persist` runs after either, in
 * the same transaction, with the page locked.
 *
 * Throws `LIVE_BODY_WRITE_PATH_CHANGED` when the page left its live copy
 * after the writer chose it; nothing commits, so the writer can take its
 * legacy path. An edit a peer's commit overtook is retried, not refused.
 */
export function editContentLiveCopy(
  documentId: string,
  options: {
    cause: ContentBodyWriteCause;
    edit: string;
    input: unknown;
    requestSource?: string;
    persist?: (tx: DbExec, change: LiveCopyCallChange) => Promise<void>;
  },
): Promise<LiveCopyMutationResult> {
  return withContentBodyWriteCause(options.cause, () =>
    mutateLiveCopy(contentLiveCopy, documentId, {
      edit: options.edit,
      input: options.input,
      ...(options.requestSource
        ? { requestSource: options.requestSource }
        : {}),
      persist: async (tx, change) => {
        if (!change.changed) {
          await persistUnchangedContentBodyEdit(tx, documentId, options.cause);
        }
        await options.persist?.(tx, change);
      },
    }),
  );
}
