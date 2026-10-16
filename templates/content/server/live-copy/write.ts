import { ActionContractError } from "@agent-native/core";
import {
  LiveCopyError,
  mutateLiveCopy,
  type LiveCopyCallChange,
  type LiveCopyMutationResult,
} from "@agent-native/core/collab";
import type { DbExec } from "@agent-native/core/db";
import { eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { isLiveBodyWriterPage } from "../lib/live-body-writer.js";
import { CONTENT_LIVE_COPY_EDITS, contentLiveCopy } from "./binding.js";
import { persistUnchangedContentBodyEdit } from "./persist.js";
import {
  withContentBodyWriteCause,
  type ContentBodyWriteCause,
} from "./write-cause.js";

type ContentLiveCopyBodyEdit = {
  base: string;
  candidate: string;
  /**
   * The ranges of `base` the writer replaced, such as edit-document's finds;
   * a tab's change to a block they touch refuses the rebase.
   */
  authored?: ReadonlyArray<{ start: number; end: number }>;
};

/**
 * A server writer's replace names the body it was built from. Core retries
 * an edit a peer's commit overtook, and a replace without `expected` would
 * silently overwrite the peer's text on that retry. A rebase names the body
 * its edit was made on, or, with `earlier`, the recorded bodies after and
 * before a base History no longer holds.
 */
export type ContentLiveCopyRebaseInput = ContentLiveCopyBodyEdit & {
  earlier?: ContentLiveCopyBodyEdit;
};

type ContentLiveCopyEditInput<Edit extends string> =
  typeof CONTENT_LIVE_COPY_EDITS.replaceBody extends Edit
    ? { content: string; expected: string }
    : typeof CONTENT_LIVE_COPY_EDITS.rebaseBody extends Edit
      ? ContentLiveCopyRebaseInput
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

function bodyEditInput(input: unknown): Record<string, unknown> {
  const { base, candidate, authored } = (input ?? {}) as Record<
    string,
    unknown
  >;
  if (authored === undefined) return { base, candidate };
  return {
    base,
    candidate,
    authored: Array.isArray(authored)
      ? authored.map((range) => {
          const { start, end } = (range ?? {}) as Record<string, unknown>;
          return { start, end };
        })
      : authored,
  };
}

function rebaseBodyInput(input: unknown): Record<string, unknown> {
  const { earlier } = (input ?? {}) as Record<string, unknown>;
  return earlier === undefined
    ? bodyEditInput(input)
    : { ...bodyEditInput(input), earlier: bodyEditInput(earlier) };
}

/**
 * True when a server write found its page off its live copy before anything
 * committed, so the writer can take its legacy path. A released or replaced
 * binding (`binding_inactive`) refuses every write through its handle, so it
 * is no reason to change path.
 */
export function liveCopyWriteLeftPath(error: unknown): boolean {
  if (error instanceof LiveCopyError) {
    return (
      error.code === "not_live_copy" && error.reason !== "binding_inactive"
    );
  }
  return (
    error instanceof ActionContractError &&
    error.errorCode === "LIVE_BODY_WRITE_PATH_CHANGED"
  );
}

/** A replace refused because the page's body changed since `expected`. */
export function liveCopyBaseChanged(error: unknown): boolean {
  return (
    error instanceof LiveCopyError &&
    error.code === "build_refused" &&
    error.reason === "base_changed"
  );
}

/**
 * A rebase refused because what other writers changed since its base leaves
 * the edit's place in the current body ambiguous.
 */
export function liveCopyRebaseConflict(error: unknown): boolean {
  return (
    error instanceof LiveCopyError &&
    error.code === "build_refused" &&
    error.reason === "conflict"
  );
}

/**
 * The typed refusal for a body the page can't hold in full; the live copy
 * refuses it rather than keep part of it.
 */
export function unrepresentableBodyError(
  error: unknown,
): ActionContractError | undefined {
  if (!(error instanceof LiveCopyError) || error.code !== "build_refused")
    return undefined;
  if (error.reason !== "lossy" && error.reason !== "unrepresentable")
    return undefined;
  return new ActionContractError(
    `The edited body can't be stored on this page in full (${error.reason}). Read the page with get-document and write the change in its Markdown.`,
    {
      errorCode: "DOCUMENT_BODY_UNREPRESENTABLE",
      statusCode: 422,
      details: { reason: error.reason },
    },
  );
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
      : options.edit === CONTENT_LIVE_COPY_EDITS.rebaseBody
        ? rebaseBodyInput(options.input)
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

/**
 * Writes `rewrite(body)` to a switched page for a server writer that derives
 * its change from the page's current body, such as alt text or a
 * transcript. The change is rebased onto any tab's commit since the read,
 * as an agent's edit is: the rewrite's target is the block it changed, not
 * whatever a selector such as "the first image with this URL" would pick in
 * the newer body. A change whose place that commit leaves ambiguous, or a
 * target `rewrite` (null) doesn't find, is refused as
 * DOCUMENT_REVISION_CONFLICT. False when the page is not on its live copy,
 * or left it before anything committed, so the writer takes its legacy path.
 */
export async function rewriteContentLiveCopyBody(
  documentId: string,
  options: {
    cause: ContentBodyWriteCause;
    rewrite: (body: string) => string | null;
  },
): Promise<boolean> {
  if (!(await isLiveBodyWriterPage(documentId))) return false;
  // guard:allow-unscoped — callers assert editor access to the page first.
  const [row] = await getDb()
    .select({ content: schema.documents.content })
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId));
  const body = row?.content ?? "";
  const content = options.rewrite(body);
  if (content === null) {
    throw new ActionContractError(
      "The document changed, and this change no longer applies to it. Read it again and retry.",
      { errorCode: "DOCUMENT_REVISION_CONFLICT", statusCode: 409 },
    );
  }
  try {
    await editContentLiveCopy(documentId, {
      cause: options.cause,
      edit: CONTENT_LIVE_COPY_EDITS.rebaseBody,
      input: { base: body, candidate: content },
    });
    return true;
  } catch (error) {
    if (liveCopyWriteLeftPath(error)) return false;
    if (liveCopyRebaseConflict(error)) {
      throw new ActionContractError(
        "The document changed where this change applies. Read it again and retry.",
        { errorCode: "DOCUMENT_REVISION_CONFLICT", statusCode: 409 },
      );
    }
    throw unrepresentableBodyError(error) ?? error;
  }
}
