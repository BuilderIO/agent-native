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

export function shouldApplyRemotePreviewContent({
  isLocalEdit,
  previousContent,
  nextContent,
  paintedContent,
}: {
  isLocalEdit: boolean;
  previousContent: string | null;
  nextContent: string;
  paintedContent?: string | null;
}): boolean {
  if (isLocalEdit) return false;
  if (paintedContent != null && paintedContent !== nextContent) return true;
  return nextContent !== previousContent;
}

const diffMatchPatch = new DiffMatchPatch();

export function canWriteCollabText(
  ydoc: Y.Doc | null,
  isSynced: boolean,
  baseContent: string,
): boolean {
  return Boolean(
    ydoc &&
    !ydoc.isDestroyed &&
    isSynced &&
    ydoc.getText("content").toString() === baseContent,
  );
}

export function writeCollabText(
  ydoc: Y.Doc,
  ytext: Y.Text,
  next: string,
  origin: unknown,
): boolean {
  const current = ytext.toJSON();
  if (current === next) return false;
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
