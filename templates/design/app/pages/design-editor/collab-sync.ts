import { shouldUseLiveFileContent } from "@shared/html-content";
import DiffMatchPatch from "diff-match-patch";
import type * as Y from "yjs";

const { DIFF_DELETE, DIFF_EQUAL } = DiffMatchPatch;

export function shouldRebaseCollabDocFromStoredContent({
  liveContent,
  storedContent,
  storedUpdatedAt,
  lastAppliedUpdatedAt,
  fileType,
}: {
  liveContent: string;
  storedContent: string;
  storedUpdatedAt: string | null | undefined;
  lastAppliedUpdatedAt: string | null;
  fileType: string;
}): boolean {
  if (liveContent === storedContent) return false;
  if (
    !shouldUseLiveFileContent({
      liveContent,
      storedContent,
      fileType,
    })
  ) {
    return true;
  }
  if (fileType.toLowerCase() !== "html") return false;
  if (!lastAppliedUpdatedAt) return !!storedUpdatedAt;
  return false;
}

export function resolveScreenCollabSyncTarget({
  fileId,
  overviewPresenceFileId,
  overviewDocConnected,
}: {
  fileId: string;
  overviewPresenceFileId: string | null;
  overviewDocConnected: boolean;
}): { writeLiveDoc: boolean; syncCollab: boolean } {
  const writeLiveDoc =
    overviewDocConnected && overviewPresenceFileId === fileId;
  return { writeLiveDoc, syncCollab: !writeLiveDoc };
}

/** A local transaction already updated the preview optimistically, and a
 * same-content remote transaction is only an acknowledgement echo. Only a
 * genuinely different remote snapshot should touch the live document. */
export function shouldApplyRemotePreviewContent({
  isLocalEdit,
  previousContent,
  nextContent,
  paintedContent,
}: {
  isLocalEdit: boolean;
  previousContent: string | null;
  nextContent: string;
  /** What's actually on the canvas. Latest-active can race ahead of paint. */
  paintedContent?: string | null;
}): boolean {
  if (isLocalEdit) return false;
  if (paintedContent != null && paintedContent !== nextContent) return true;
  return nextContent !== previousContent;
}

const diffMatchPatch = new DiffMatchPatch();

/**
 * Replace the collab document's text with `next` as the smallest set of
 * disjoint splices, and report whether anything changed.
 *
 * Never `delete(0, length) + insert(0, next)`. That shape ships the whole
 * document on every edit, the UndoManager pins every replaced copy so the doc
 * grows without bound within a session, and it is wrong under concurrency:
 * two peers each rewriting the whole text merge into a duplicated document
 * instead of both edits.
 *
 * Disjoint rather than one prefix/suffix splice, because a single splice spans
 * everything between the first and last changed character. An agent rewrite
 * touching two ends of a screen would delete the untouched middle and take a
 * concurrent edit inside it with it. This mirrors the server's own
 * `applyTextToYDoc`, which has always diffed this way.
 */
export function writeCollabText(
  ydoc: Y.Doc,
  ytext: Y.Text,
  next: string,
  origin: unknown,
): boolean {
  const current = ytext.toJSON();
  if (current === next) return false;
  // No cleanup pass: diff_cleanupEfficiency merges edits across equal runs
  // shorter than Diff_EditCost (4), which deletes up to three untouched
  // characters and takes any concurrent edit anchored in them along with it.
  const diffs = diffMatchPatch.diff_main(current, next);
  ydoc.transact(() => {
    let cursor = 0;
    for (const [operation, text] of diffs) {
      if (operation === DIFF_EQUAL) {
        cursor += text.length;
      } else if (operation === DIFF_DELETE) {
        ytext.delete(cursor, text.length);
      } else {
        ytext.insert(cursor, text);
        cursor += text.length;
      }
    }
  }, origin);
  return true;
}
