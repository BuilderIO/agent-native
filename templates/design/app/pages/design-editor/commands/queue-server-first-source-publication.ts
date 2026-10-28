import { sourceContentHash } from "@shared/source-workspace";

import type { ApplyFileContentUpdateResult } from "./apply-file-content-update";
import type { FileContentSaveCompletion } from "./save-file-content";

export interface QueueServerFirstSourcePublicationArgs {
  applyFileContentUpdate: (
    fileId: string,
    acceptedContent: string,
    options: {
      immediateSave: true;
      serverAccepted: true;
      recordHistory: true;
      historyBeforeContent: string;
      sourceBaseContent: string;
      forcePreviewFullDocument: boolean;
    },
  ) => ApplyFileContentUpdateResult;
  isActiveFile: (fileId: string) => boolean;
  clearPendingLocalFileContent: (
    fileId: string,
    expectedContent?: string,
  ) => void;
  shouldPublish: (fileId: string, acceptedContent: string) => boolean;
  queueFileContentSave: (
    fileId: string,
    content: string,
    options: {
      expectedVersionHash: string;
      syncCollab: false;
      immediate: true;
      deferCollabReconcile: true;
      onPersistedContent: (acceptedContent: string) => void;
    },
  ) => Promise<FileContentSaveCompletion | false> | void;
}

export function canPublishAcceptedSource(args: {
  activeFileId: string | null;
  capturedActiveFileId: string | null;
  baseContent: string;
  currentContent: string;
  acceptedContent: string;
  targetWasActive: boolean;
  targetDocumentMatches: boolean;
  targetYTextMatches: boolean;
  latestActiveContentMatches: boolean;
  lastLocalContentMatches: boolean;
}): boolean {
  if (args.activeFileId !== args.capturedActiveFileId) return false;
  if (
    args.currentContent !== args.baseContent &&
    args.currentContent !== args.acceptedContent
  ) {
    return false;
  }
  if (!args.targetWasActive) return true;
  return (
    args.targetDocumentMatches &&
    args.targetYTextMatches &&
    args.latestActiveContentMatches &&
    args.lastLocalContentMatches
  );
}

export function queueServerFirstSourcePublication(
  args: QueueServerFirstSourcePublicationArgs,
  fileId: string,
  requestedContent: string,
  baseContent: string,
  onPublished?: (acceptedContent: string) => void,
): void {
  void args.queueFileContentSave(fileId, requestedContent, {
    expectedVersionHash: sourceContentHash(baseContent),
    syncCollab: false,
    immediate: true,
    deferCollabReconcile: true,
    onPersistedContent: (acceptedContent) => {
      if (!args.shouldPublish(fileId, acceptedContent)) {
        args.clearPendingLocalFileContent(fileId, acceptedContent);
        return;
      }
      const result = args.applyFileContentUpdate(fileId, acceptedContent, {
        immediateSave: true,
        serverAccepted: true,
        recordHistory: true,
        historyBeforeContent: baseContent,
        sourceBaseContent: baseContent,
        forcePreviewFullDocument: args.isActiveFile(fileId),
      });
      if (result.status === "accepted") {
        onPublished?.(result.content);
      } else {
        args.clearPendingLocalFileContent(fileId, acceptedContent);
      }
    },
  });
}
