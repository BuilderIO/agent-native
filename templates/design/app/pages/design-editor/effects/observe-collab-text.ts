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
import type {
  PendingLocalFileContent,
  PreviewContentReplaceResult,
} from "@/pages/design-editor/editor-state";
import { previewContentReplaceNeedsRenderFallback } from "@/pages/design-editor/editor-state";
import type { ContentHistoryChange } from "@/pages/design-editor/history";

import { prepareCanonicalSourceContent } from "../source-publication";

export interface ObserveCollabTextArgs {
  publishCanonicalContent: (
    fileId: string,
    sourceContent: string,
    fileType?: string,
  ) => string;
  fileType?: string;
  activeFileId: string | null;
  agentActive: boolean;
  documentFileContentRef: RefObject<string | null>;
  documentFileUpdatedAtRef: RefObject<string | null>;
  isSynced: boolean;
  lastAppliedFileContentRef: RefObject<string | null>;
  lastAppliedFileUpdatedAtRef: RefObject<string | null>;
  lastLocalContentRef: RefObject<string | null>;
  latestActiveContentRef: RefObject<string | null>;
  pendingLocalFileContentsRef: RefObject<Map<string, PendingLocalFileContent>>;
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
  publishCanonicalContent,
  fileType,
  agentActive,
  documentFileContentRef,
  documentFileUpdatedAtRef,
  isSynced,
  lastAppliedFileContentRef,
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
    const rawNext = ytext.toJSON();
    const previousActiveContent = latestActiveContentRef.current;
    const isLocalEdit =
      transaction?.origin === TAB_ID ||
      transaction?.origin === LOCAL_EDIT_ORIGIN ||
      transaction?.origin === undoManagerRef.current;
    const pending = pendingLocalFileContentsRef.current.get(fileId);
    const pendingLocalContent = pending?.content;
    if (
      pendingLocalContent &&
      pending?.identityMigrationSourceContent === undefined &&
      rawNext !== pendingLocalContent &&
      !isLocalEdit
    ) {
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
      return;
    }
    const next = isLocalEdit
      ? prepareCanonicalSourceContent(rawNext, { fileId, fileType }).content
      : publishCanonicalContent(fileId, rawNext, fileType);
    if (
      shouldCheckpointAgentContent({
        agentActive,
        isLocalEdit,
        previousContent: previousActiveContent,
        nextContent: next,
      })
    ) {
      recordExternalContentHistoryCheckpoint({
        fileId,
        before: previousActiveContent!,
        after: next,
      });
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
        paintedContent: lastLocalContentRef.current,
      })
    ) {
      if (
        previewContentReplaceNeedsRenderFallback(
          replacePreviewContent(next, null, { forceFullDocument: true }),
        )
      ) {
        setContentRenderRevision((revision) => revision + 1);
      }
      lastLocalContentRef.current = next;
    }
    const documentUpdatedAt = documentFileUpdatedAtRef.current;
    if (rawNext === documentFileContentRef.current && documentUpdatedAt) {
      lastAppliedFileUpdatedAtRef.current = documentUpdatedAt;
      lastAppliedFileContentRef.current = documentFileContentRef.current;
    }
    if (!isLocalEdit) {
      setSelectedElement((prev) => {
        if (!prev) return prev;
        return refreshElementInfoFromContent(next, prev, {
          kind: "design-file",
          fileId,
        });
      });
      setHoveredElement((prev) => {
        if (!prev) return prev;
        return refreshElementInfoFromContent(next, prev, {
          kind: "design-file",
          fileId,
        });
      });
    }
  };
  ytext.observe(handler);
  return () => {
    ytext.unobserve(handler);
  };
}
