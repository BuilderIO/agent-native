import type { Dispatch, RefObject, SetStateAction } from "react";
import * as Y from "yjs";

import type { ElementInfo } from "@/components/design/types";
import { refreshElementInfoFromContent } from "@/pages/design-editor/code-layer-state";
import { shouldApplyRemotePreviewContent } from "@/pages/design-editor/collab-sync";
import {
  LOCAL_EDIT_ORIGIN,
  TAB_ID,
  shouldCheckpointAgentContent,
} from "@/pages/design-editor/editor-session";
import type { PreviewContentReplaceResult } from "@/pages/design-editor/editor-state";
import { previewContentReplaceNeedsRenderFallback } from "@/pages/design-editor/editor-state";
import type { ContentHistoryChange } from "@/pages/design-editor/history";

export interface ObserveCollabTextArgs {
  activeFileId: string | null;
  agentActive: boolean;
  documentFileContentRef: RefObject<string | null>;
  documentFileUpdatedAtRef: RefObject<string | null>;
  isSynced: boolean;
  lastAppliedFileUpdatedAtRef: RefObject<string | null>;
  lastLocalContentRef: RefObject<string | null>;
  latestActiveContentRef: RefObject<string | null>;
  pendingLocalFileContentsRef: RefObject<
    Map<
      string,
      { content: string; startedAt: number; baseUpdatedAt?: string | null }
    >
  >;
  recordExternalContentHistoryCheckpoint: (
    change: ContentHistoryChange,
  ) => void;
  replacePreviewContent: (
    nextContent: string,
    selector?: string | null,
    options?: { forceFullDocument?: boolean },
  ) => PreviewContentReplaceResult;
  setCollabContent: Dispatch<SetStateAction<string | null>>;
  setCollabContentFileId: Dispatch<SetStateAction<string | null>>;
  setContentRenderRevision: Dispatch<SetStateAction<number>>;
  setHoveredElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  undoManagerRef: RefObject<Y.UndoManager | null>;
  ydoc: Y.Doc | null;
}

export function runObserveCollabText({
  activeFileId,
  agentActive,
  documentFileContentRef,
  documentFileUpdatedAtRef,
  isSynced,
  lastAppliedFileUpdatedAtRef,
  lastLocalContentRef,
  latestActiveContentRef,
  pendingLocalFileContentsRef,
  recordExternalContentHistoryCheckpoint,
  replacePreviewContent,
  setCollabContent,
  setCollabContentFileId,
  setContentRenderRevision,
  setHoveredElement,
  setSelectedElement,
  undoManagerRef,
  ydoc,
}: ObserveCollabTextArgs) {
  if (!ydoc || !isSynced || !activeFileId) return;
  const fileId = activeFileId;
  const ytext = ydoc.getText("content");
  const handler = (_event: unknown, transaction?: { origin?: unknown }) => {
    const next = ytext.toString();
    // Item 5 (edit-flash): capture what the preview already reflects BEFORE
    // this observe fires, so a remote-origin transaction that merely ECHOES
    // content we already rendered (e.g. update-file's own applyText/
    // seedFromText round-tripping our own just-saved commit back through
    // the collab sync channel) can be recognized as a no-op instead of
    // unconditionally forcing a full srcdoc rebuild below. Every commit
    // path already sets latestActiveContentRef.current synchronously
    // before the network round trip lands, so this ref reliably holds the
    // pre-update value at the moment a same-content echo arrives.
    const previousActiveContent = latestActiveContentRef.current;
    // UndoManager fires with itself as the origin; treat those as local too
    // so the reconcile watermark and stale-selection fix are consistent.
    const isLocalEdit =
      transaction?.origin === TAB_ID ||
      transaction?.origin === LOCAL_EDIT_ORIGIN ||
      transaction?.origin === undoManagerRef.current;
    if (
      shouldCheckpointAgentContent({
        agentActive,
        isLocalEdit,
        previousContent: previousActiveContent,
        nextContent: next,
      })
    ) {
      // An agent/chat edit is remote at the CRDT layer but local in the UX:
      // Cmd+Z should restore the attachment/design state from before the run.
      // Record the replacement in the history owned by the current view
      // mode so it remains undoable from either canvas.
      recordExternalContentHistoryCheckpoint({
        fileId,
        before: previousActiveContent!,
        after: next,
      });
    }
    const pendingLocalContent =
      pendingLocalFileContentsRef.current.get(fileId)?.content;
    if (pendingLocalContent && next !== pendingLocalContent && !isLocalEdit) {
      setCollabContent(pendingLocalContent);
      setCollabContentFileId(fileId);
      lastLocalContentRef.current = pendingLocalContent;
      latestActiveContentRef.current = pendingLocalContent;
      if (
        previewContentReplaceNeedsRenderFallback(
          replacePreviewContent(pendingLocalContent, null, {
            forceFullDocument: true,
          }),
        )
      ) {
        setContentRenderRevision((revision) => revision + 1);
      }
      // Untracked full rewrite — see clear() note in the seed effect above.
      undoManagerRef.current?.clear(true, false);
      ydoc.transact(() => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, pendingLocalContent);
      }, TAB_ID);
      return;
    }
    setCollabContent(next);
    setCollabContentFileId(fileId);
    latestActiveContentRef.current = next;
    if (isLocalEdit) {
      lastLocalContentRef.current = next;
    } else if (
      shouldApplyRemotePreviewContent({
        isLocalEdit,
        previousContent: previousActiveContent,
        nextContent: next,
      })
    ) {
      // Holistic flash pipeline: a remote (peer/agent) edit arriving mid-
      // session is exactly the "remote adoption" case that should apply
      // in-place — this is not a file switch or initial mount. Try the
      // bridge's live in-place full-document replace (same live iframe, no
      // navigation) first; only fall back to an actual srcdoc rebuild when
      // the bridge can't apply it (e.g. this screen's iframe isn't mounted/
      // registered right now).
      if (
        previewContentReplaceNeedsRenderFallback(
          replacePreviewContent(next, null, { forceFullDocument: true }),
        )
      ) {
        setContentRenderRevision((revision) => revision + 1);
      }
    }
    // Only advance the DB reconcile watermark when the live CRDT text
    // actually matches the current SQL snapshot. Otherwise an intermediate
    // or malformed Yjs update can shadow valid saved HTML until reload.
    if (next === documentFileContentRef.current) {
      lastAppliedFileUpdatedAtRef.current =
        documentFileUpdatedAtRef.current ?? lastAppliedFileUpdatedAtRef.current;
    }
    // Stale-selection fix: when a remote/agent edit changes the document,
    // verify the selected element still exists in the new DOM. If not, clear
    // selection and hover so the Edit panel doesn't operate on a ghost element.
    if (!isLocalEdit) {
      setSelectedElement((prev) => {
        if (!prev) return prev;
        return refreshElementInfoFromContent(next, prev);
      });
      setHoveredElement((prev) => {
        if (!prev) return prev;
        return refreshElementInfoFromContent(next, prev);
      });
    }
  };
  ytext.observe(handler);
  return () => {
    ytext.unobserve(handler);
  };
}
