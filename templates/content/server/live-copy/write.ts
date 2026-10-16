import {
  mutateLiveCopy,
  type LiveCopyCallChange,
  type LiveCopyMutationResult,
} from "@agent-native/core/collab";
import type { DbExec } from "@agent-native/core/db";

import { CONTENT_LIVE_COPY_EDITS, contentLiveCopy } from "./binding.js";
import { persistUnchangedContentBodyEdit } from "./persist.js";
import {
  withContentBodyWriteCause,
  type ContentBodyWriteCause,
} from "./write-cause.js";

/**
 * A server writer's replace names the body it was built from. Core retries
 * an edit a peer's commit overtook, and a replace without `expected` would
 * silently overwrite the peer's text on that retry.
 */
type ContentLiveCopyEditInput<Edit extends string> =
  typeof CONTENT_LIVE_COPY_EDITS.replaceBody extends Edit
    ? { content: string; expected: string }
    : unknown;

function replaceBodyInput(
  documentId: string,
  input: unknown,
): { content: unknown; expected: string } {
  const { content, expected } = (input ?? {}) as {
    content?: unknown;
    expected?: unknown;
  };
  if (typeof expected !== "string") {
    throw new Error(
      `A server writer's replace of page ${documentId} must name the body it was built from as \`expected\`.`,
    );
  }
  // The worker gets a structured clone, which drops a getter's or a
  // non-enumerable property's value, so send the values checked here.
  return { content, expected };
}

/**
 * Applies a named edit to a switched page's live copy for a server writer.
 * A changed edit commits through the binding's persist; an unchanged one
 * still locks the page in Content's order and records the cause's intent,
 * which core's binding persist never sees. `persist` runs after either, in
 * the same transaction, with the page locked.
 *
 * Throws `LIVE_BODY_WRITE_PATH_CHANGED` when the page left its live copy
 * after the writer chose it; nothing commits, so the writer can take its
 * legacy path. An edit a peer's commit overtook is retried against the
 * peer's body, so a replace whose `expected` body changed is refused
 * `base_changed`.
 */
export async function editContentLiveCopy<Edit extends string>(
  documentId: string,
  options: {
    cause: ContentBodyWriteCause;
    edit: Edit;
    input: ContentLiveCopyEditInput<Edit>;
    requestSource?: string;
    persist?: (tx: DbExec, change: LiveCopyCallChange) => Promise<void>;
  },
): Promise<LiveCopyMutationResult> {
  const input =
    options.edit === CONTENT_LIVE_COPY_EDITS.replaceBody
      ? replaceBodyInput(documentId, options.input)
      : options.input;
  return withContentBodyWriteCause(options.cause, () =>
    mutateLiveCopy(contentLiveCopy, documentId, {
      edit: options.edit,
      input,
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
