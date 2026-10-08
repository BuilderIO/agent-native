import type { Dispatch, RefObject, SetStateAction } from "react";
import * as Y from "yjs";

import { shouldRebaseCollabDocFromStoredContent } from "@/pages/design-editor/collab-sync";
import type {
  PendingLocalFileContent,
  PreviewContentReplaceResult,
} from "@/pages/design-editor/editor-state";
import { previewContentReplaceNeedsRenderFallback } from "@/pages/design-editor/editor-state";
import type { DesignFile } from "@/pages/design-editor/types";

import { prepareCanonicalSourceContent } from "../source-publication";

export interface SeedCollabContentArgs {
  publishCanonicalContent: (
    fileId: string,
    sourceContent: string,
    fileType?: string,
  ) => string;
  activeFile: DesignFile;
  activeFileId: string | null;
  collabContentFileIdRef: RefObject<string | null>;
  isSynced: boolean;
  lastAppliedFileContentRef: RefObject<string | null>;
  lastAppliedFileUpdatedAtRef: RefObject<string | null>;
  lastLocalContentRef: RefObject<string | null>;
  latestActiveContentRef: RefObject<string | null>;
  pendingLocalFileContentsRef: RefObject<Map<string, PendingLocalFileContent>>;
  replacePreviewContent: (
    nextContent: string,
    selector?: string | null,
    options?: { forceFullDocument?: boolean },
  ) => PreviewContentReplaceResult;
  setCollabContent: Dispatch<SetStateAction<string | null>>;
  setCollabContentFileId: Dispatch<SetStateAction<string | null>>;
  setContentRenderRevision: Dispatch<SetStateAction<number>>;
  ydoc: Y.Doc | null;
}

export function runSeedCollabContent({
  activeFile,
  publishCanonicalContent,
  activeFileId,
  collabContentFileIdRef,
  isSynced,
  lastAppliedFileContentRef,
  lastAppliedFileUpdatedAtRef,
  lastLocalContentRef,
  latestActiveContentRef,
  pendingLocalFileContentsRef,
  replacePreviewContent,
  setCollabContent,
  setCollabContentFileId,
  setContentRenderRevision,
  ydoc,
}: SeedCollabContentArgs) {
  if (!ydoc || !isSynced || !activeFileId) return;
  const fileId = activeFileId;
  const ytext = ydoc.getText("content");
  const text = ytext.toJSON();
  const pending = pendingLocalFileContentsRef.current.get(fileId);
  const pendingLocalContent = pending?.content;
  if (
    pendingLocalContent &&
    pending.identityMigrationSourceContent === undefined
  ) {
    if (text !== pendingLocalContent) {
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
    } else {
      setCollabContent(pendingLocalContent);
      setCollabContentFileId(fileId);
      lastLocalContentRef.current = pendingLocalContent;
      latestActiveContentRef.current = pendingLocalContent;
    }
    return;
  }
  if (text.length > 0) {
    const storedSourceContent = activeFile?.content ?? "";
    const storedContent = prepareCanonicalSourceContent(storedSourceContent, {
      fileId,
      fileType: activeFile?.fileType,
    }).content;
    if (
      shouldRebaseCollabDocFromStoredContent({
        liveContent: text,
        storedContent,
        storedUpdatedAt: activeFile?.updatedAt ?? null,
        lastAppliedUpdatedAt: lastAppliedFileUpdatedAtRef.current,
        fileType: activeFile?.fileType ?? "html",
      })
    ) {
      const acceptedStoredContent = publishCanonicalContent(
        fileId,
        storedSourceContent,
        activeFile?.fileType,
      );
      setCollabContent(acceptedStoredContent);
      setCollabContentFileId(fileId);
      lastLocalContentRef.current = acceptedStoredContent;
      latestActiveContentRef.current = acceptedStoredContent;
      if (activeFile?.updatedAt) {
        lastAppliedFileUpdatedAtRef.current = activeFile.updatedAt;
        lastAppliedFileContentRef.current = storedSourceContent;
      }
      if (
        previewContentReplaceNeedsRenderFallback(
          replacePreviewContent(acceptedStoredContent, null, {
            forceFullDocument: true,
          }),
        )
      ) {
        setContentRenderRevision((revision) => revision + 1);
      }

      return;
    }
    const canonicalLiveContent = prepareCanonicalSourceContent(text, {
      fileId,
      fileType: activeFile?.fileType,
    }).content;
    const hasPendingIdentityMigration =
      pending?.identityMigrationSourceContent !== undefined;
    if (
      canonicalLiveContent !== latestActiveContentRef.current ||
      collabContentFileIdRef.current !== fileId ||
      hasPendingIdentityMigration
    ) {
      const shouldRefreshPreview =
        canonicalLiveContent !== latestActiveContentRef.current ||
        collabContentFileIdRef.current !== fileId;
      const canonical = publishCanonicalContent(
        fileId,
        text,
        activeFile?.fileType,
      );
      setCollabContent(canonical);
      setCollabContentFileId(fileId);
      latestActiveContentRef.current = canonical;
      if (
        shouldRefreshPreview &&
        previewContentReplaceNeedsRenderFallback(
          replacePreviewContent(canonical, null, { forceFullDocument: true }),
        )
      ) {
        setContentRenderRevision((revision) => revision + 1);
      }
    }
  }
}
