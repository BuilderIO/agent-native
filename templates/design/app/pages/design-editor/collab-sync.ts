import { shouldUseLiveFileContent } from "@shared/html-content";
import type * as Y from "yjs";

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
}: {
  isLocalEdit: boolean;
  previousContent: string | null;
  nextContent: string;
}): boolean {
  return !isLocalEdit && nextContent !== previousContent;
}

/** Byte range that turns `previous` into `next`, as one contiguous splice. */
export interface TextSplice {
  index: number;
  removeLength: number;
  insert: string;
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * Y.Text indexes UTF-16 code units, so a prefix/suffix boundary landing
 * between a surrogate pair would splice half a code point and leave lone
 * surrogates in the document.
 */
export function diffTextSplice(previous: string, next: string): TextSplice {
  const max = Math.min(previous.length, next.length);
  let start = 0;
  while (start < max && previous[start] === next[start]) start += 1;
  if (start > 0 && isHighSurrogate(previous.charCodeAt(start - 1))) start -= 1;

  let end = 0;
  while (
    end < previous.length - start &&
    end < next.length - start &&
    previous[previous.length - 1 - end] === next[next.length - 1 - end]
  ) {
    end += 1;
  }
  if (end > 0 && isLowSurrogate(previous.charCodeAt(previous.length - end))) {
    end -= 1;
  }

  return {
    index: start,
    removeLength: previous.length - start - end,
    insert: next.slice(start, next.length - end),
  };
}

/**
 * Replace the collab document's text with `next` as one minimal splice, and
 * report whether anything changed.
 *
 * Never `delete(0, length) + insert(0, next)`. That shape ships the whole
 * document on every edit, the UndoManager pins every replaced copy so the doc
 * grows without bound within a session, and it is wrong under concurrency:
 * two peers each rewriting the whole text merge into a duplicated document
 * instead of both edits.
 */
export function writeCollabText(
  ydoc: Y.Doc,
  ytext: Y.Text,
  next: string,
  origin: unknown,
): boolean {
  const current = ytext.toString();
  if (current === next) return false;
  const { index, removeLength, insert } = diffTextSplice(current, next);
  ydoc.transact(() => {
    if (removeLength > 0) ytext.delete(index, removeLength);
    if (insert) ytext.insert(index, insert);
  }, origin);
  return true;
}
