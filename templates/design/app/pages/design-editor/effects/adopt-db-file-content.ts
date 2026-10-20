import { shouldUseLiveFileContent } from "@shared/html-content";
import type { Dispatch, RefObject, SetStateAction } from "react";

import { shouldAdoptExternalReconcileContent } from "@/pages/design-editor/editor-session";
import type { PreviewContentReplaceResult } from "@/pages/design-editor/editor-state";
import { previewContentReplaceNeedsRenderFallback } from "@/pages/design-editor/editor-state";
import type { ContentHistoryChange } from "@/pages/design-editor/history";
import type { DesignFile } from "@/pages/design-editor/types";

import { prepareCanonicalSourceContent } from "../source-publication";

export interface AdoptDbFileContentArgs {
  publishCanonicalContent: (
    fileId: string,
    sourceContent: string,
    fileType?: string,
  ) => string;
  activeFile: DesignFile;
  agentActive: boolean;
  clearStaleAgentCollabRecovery: () => void;
  collabContent: string | null;
  collabContentFileId: string | null;
  collabContentFileIdRef: RefObject<string | null>;
  collabContentRef: RefObject<string | null>;
  documentFileContentRef: RefObject<string | null>;
  documentFileUpdatedAtRef: RefObject<string | null>;
  isSynced: boolean;
  lastAppliedFileContentRef: RefObject<string | null>;
  lastAppliedFileUpdatedAtRef: RefObject<string | null>;
  lastLocalContentRef: RefObject<string | null>;
  latestActiveContentRef: RefObject<string | null>;
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
  staleAgentCollabRecoveryTimerRef: RefObject<number | null>;
}

export function runAdoptDbFileContent({
  activeFile,
  publishCanonicalContent,
  agentActive,
  clearStaleAgentCollabRecovery,
  collabContent,
  collabContentFileId,
  collabContentFileIdRef,
  collabContentRef,
  documentFileContentRef,
  documentFileUpdatedAtRef,
  isSynced,
  lastAppliedFileContentRef,
  lastAppliedFileUpdatedAtRef,
  lastLocalContentRef,
  latestActiveContentRef,
  recordExternalContentHistoryCheckpoint,
  replacePreviewContent,
  setCollabContent,
  setCollabContentFileId,
  setContentRenderRevision,
  staleAgentCollabRecoveryTimerRef,
}: AdoptDbFileContentArgs) {
  if (!activeFile || !isSynced) return;
  const dbSourceContent = activeFile.content ?? "";
  const dbContent = prepareCanonicalSourceContent(dbSourceContent, {
    fileId: activeFile.id,
    fileType: activeFile.fileType,
  }).content;
  const publishDbSource = () =>
    publishCanonicalContent(
      activeFile.id,
      dbSourceContent,
      activeFile.fileType,
    );
  const dbUpdatedAt = activeFile.updatedAt ?? null;
  const activeScopedCollabContent =
    collabContentFileId === activeFile.id ? collabContent : null;
  if (
    typeof activeScopedCollabContent === "string" &&
    !shouldUseLiveFileContent({
      liveContent: activeScopedCollabContent,
      storedContent: dbContent,
      fileType: activeFile.fileType,
    })
  ) {
    clearStaleAgentCollabRecovery();
    publishDbSource();
    setCollabContent(dbContent);
    setCollabContentFileId(activeFile.id);
    lastLocalContentRef.current = dbContent;
    latestActiveContentRef.current = dbContent;
    if (dbUpdatedAt) {
      lastAppliedFileUpdatedAtRef.current = dbUpdatedAt;
      lastAppliedFileContentRef.current = dbSourceContent;
    }
    if (
      previewContentReplaceNeedsRenderFallback(
        replacePreviewContent(dbContent, null, {
          forceFullDocument: true,
        }),
      )
    ) {
      setContentRenderRevision((revision) => revision + 1);
    }

    return;
  }

  if (
    activeScopedCollabContent === dbContent ||
    lastLocalContentRef.current === dbContent
  ) {
    publishDbSource();
    if (dbUpdatedAt) {
      lastAppliedFileUpdatedAtRef.current = dbUpdatedAt;
      lastAppliedFileContentRef.current = dbSourceContent;
    }
    return;
  }

  const applied = lastAppliedFileUpdatedAtRef.current;
  const externalNewerByTimestamp = shouldAdoptExternalReconcileContent({
    appliedUpdatedAt: applied,
    dbUpdatedAt,
    agentActive,
  });
  const sameTimestampAlreadyApplied =
    !!applied &&
    !!dbUpdatedAt &&
    dbUpdatedAt === applied &&
    dbSourceContent === lastAppliedFileContentRef.current;
  const externalNewer =
    externalNewerByTimestamp && !sameTimestampAlreadyApplied;
  const staleAgentEchoPossible =
    agentActive &&
    !sameTimestampAlreadyApplied &&
    !!applied &&
    !!dbUpdatedAt &&
    dbUpdatedAt === applied &&
    lastLocalContentRef.current !== activeScopedCollabContent;
  if (!externalNewer) {
    if (staleAgentEchoPossible) {
      if (staleAgentCollabRecoveryTimerRef.current === null) {
        const expectedSourceContent = dbSourceContent;
        const expectedContent = dbContent;
        const expectedUpdatedAt = dbUpdatedAt;
        const expectedFileId = activeFile.id;
        staleAgentCollabRecoveryTimerRef.current = window.setTimeout(() => {
          staleAgentCollabRecoveryTimerRef.current = null;
          const currentCollab = collabContentRef.current;
          if (collabContentFileIdRef.current !== expectedFileId) return;
          if (documentFileUpdatedAtRef.current !== expectedUpdatedAt) return;
          if (documentFileContentRef.current !== expectedSourceContent) return;
          if (currentCollab === expectedContent) return;
          if (lastLocalContentRef.current === currentCollab) return;

          publishCanonicalContent(
            expectedFileId,
            expectedSourceContent,
            activeFile.fileType,
          );
          setCollabContent(expectedContent);
          setCollabContentFileId(expectedFileId);
          lastLocalContentRef.current = expectedContent;
          latestActiveContentRef.current = expectedContent;
          lastAppliedFileUpdatedAtRef.current = expectedUpdatedAt;
          lastAppliedFileContentRef.current = expectedSourceContent;
          if (
            previewContentReplaceNeedsRenderFallback(
              replacePreviewContent(expectedContent, null, {
                forceFullDocument: true,
              }),
            )
          ) {
            setContentRenderRevision((revision) => revision + 1);
          }
        }, 1200);
      }
    } else {
      clearStaleAgentCollabRecovery();
    }
    return;
  }
  clearStaleAgentCollabRecovery();
  publishDbSource();

  const previousActiveContentForCheckpoint = latestActiveContentRef.current;
  if (
    typeof previousActiveContentForCheckpoint === "string" &&
    previousActiveContentForCheckpoint !== dbContent
  ) {
    recordExternalContentHistoryCheckpoint({
      fileId: activeFile.id,
      before: previousActiveContentForCheckpoint,
      after: dbContent,
    });
  }

  setCollabContent(dbContent);
  setCollabContentFileId(activeFile.id);
  lastLocalContentRef.current = dbContent;
  latestActiveContentRef.current = dbContent;
  if (dbUpdatedAt) {
    lastAppliedFileUpdatedAtRef.current = dbUpdatedAt;
    lastAppliedFileContentRef.current = dbSourceContent;
  }
  if (
    previewContentReplaceNeedsRenderFallback(
      replacePreviewContent(dbContent, null, { forceFullDocument: true }),
    )
  ) {
    setContentRenderRevision((revision) => revision + 1);
  }
}
