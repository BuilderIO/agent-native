import { sourceContentHash } from "@shared/source-workspace";
import type { QueryClient } from "@tanstack/react-query";
import type { RefObject } from "react";
import { toast } from "sonner";
import * as Y from "yjs";

import { isShaderWriteInFlight } from "@/components/design/inspector/GlslShaderPanel";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  canWriteCollabText,
  resolveScreenCollabSyncTarget,
  writeCollabText,
} from "@/pages/design-editor/collab-sync";
import { TAB_ID } from "@/pages/design-editor/editor-session";
import type { ContentHistoryEntry } from "@/pages/design-editor/history";
import { designSaveErrorMessage } from "@/pages/design-editor/save-failure";
import { prepareAcceptedSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import type { ApplyLocalContentUpdateResult } from "./apply-local-content-update";
import type { FileContentSaveCompletion } from "./save-file-content";

export type ApplyFileContentUpdateResult =
  | ApplyLocalContentUpdateResult
  | { status: "deferred" };

export interface ApplyFileContentUpdateArgs {
  acknowledgeAuthoritativeClipboardMutation: (args: {
    fileId: string;
    nextContent: string;
    publication?: ClipboardContentMutationPublication;
  }) => void;
  activeFile: DesignFile;
  applyFileContentUpdate: (
    fileId: string,
    nextContent: string,
    options?: {
      refreshPreview?: boolean;
      skipPreview?: boolean;
      forcePreviewFullDocument?: boolean;
      immediateSave?: boolean;
      awaitSave?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
      historyBeforeContent?: string;
      sourceBaseContent?: string;
      identityMigrationSourceContent?: string;
      shaderWriteCompletion?: true;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => void;
  applyLocalContentUpdate: (
    nextContent: string,
    options?: {
      refreshPreview?: boolean;
      skipPreview?: boolean;
      forcePreviewFullDocument?: boolean;
      immediateSave?: boolean;
      awaitSave?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
      historyBeforeContent?: string;
      sourceBaseContent?: string;
      identityMigrationSourceContent?: string;
      shaderWriteCompletion?: true;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => ApplyLocalContentUpdateResult;
  canEditDesignRef: RefObject<boolean>;
  cancelQueuedFileContentSave: (fileId: string) => void;
  clearPendingLocalFileContent: (
    fileId: string,
    expectedContent?: string,
  ) => void;
  queueFileContentSave: (
    fileId: string,
    content: string,
    options: {
      expectedVersionHash: string;
      syncCollab?: boolean;
      immediate?: boolean;
      identityMigrationSourceContent?: string;
    },
  ) => unknown;
  files: DesignFile[];
  getScreenContent: (screenId: string) => string;
  id: string | undefined;
  markPendingLocalFileContent: (
    fileId: string,
    content: string,
    baseUpdatedAt?: string | null,
    identityMigrationSourceContent?: string,
  ) => void;
  overviewIsSynced: boolean;
  overviewPresenceFileId: string | null;
  overviewYdoc: Y.Doc | null;
  queryClient: QueryClient;
  recordContentHistoryEntry: (entry: ContentHistoryEntry) => void;
  suppressContentHistoryRef: RefObject<boolean>;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function runApplyFileContentUpdate(
  {
    acknowledgeAuthoritativeClipboardMutation,
    activeFile,
    applyFileContentUpdate,
    applyLocalContentUpdate,
    canEditDesignRef,
    cancelQueuedFileContentSave,
    clearPendingLocalFileContent,
    files,
    getScreenContent,
    id,
    markPendingLocalFileContent,
    overviewIsSynced,
    overviewPresenceFileId,
    overviewYdoc,
    queryClient,
    queueFileContentSave,
    recordContentHistoryEntry,
    suppressContentHistoryRef,
    t,
  }: ApplyFileContentUpdateArgs,
  fileId: string,
  nextContent: string,
  options: {
    refreshPreview?: boolean;
    skipPreview?: boolean;
    forcePreviewFullDocument?: boolean;
    immediateSave?: boolean;
    awaitSave?: boolean;
    persist?: boolean;
    recordHistory?: boolean;
    historyBeforeContent?: string;
    sourceBaseContent?: string;
    identityMigrationSourceContent?: string;
    shaderWriteCompletion?: true;
    updatedAt?: string;
    clipboardMutation?: ClipboardContentMutationPublication;
  } = {},
): ApplyFileContentUpdateResult {
  if (!canEditDesignRef.current) return { status: "refused" };
  if (isShaderWriteInFlight(fileId) && !options.shaderWriteCompletion) {
    toast.error(t("designEditor.toasts.saveConflict"), {
      id: `design-source-shader-conflict:${fileId}`,
    });
    return { status: "refused" };
  }
  if (fileId === activeFile?.id) {
    return applyLocalContentUpdate(nextContent, options);
  }
  const previousFile = files.find((file) => file.id === fileId);
  const previousContent =
    options.historyBeforeContent ??
    getScreenContent(fileId) ??
    previousFile?.content ??
    "";
  let prepared: ReturnType<typeof prepareAcceptedSourceContent>;
  try {
    prepared = prepareAcceptedSourceContent(nextContent, {
      fileId,
      previousContent,
      fileType: previousFile?.fileType,
    });
  } catch (error) {
    toast.error(designSaveErrorMessage(error) ?? t("common.genericError"), {
      id: `design-source-integrity:${fileId}`,
    });
    return { status: "refused" };
  }
  const acceptedContent = prepared.content;
  const needsIdentityMigration = Boolean(options.updatedAt && prepared.changed);
  const identityMigrationSourceContent =
    options.identityMigrationSourceContent ??
    (needsIdentityMigration ? nextContent : undefined);

  acknowledgeAuthoritativeClipboardMutation({
    fileId,
    nextContent: acceptedContent,
    publication: options.clipboardMutation,
  });
  const shouldRecordHistory =
    options.recordHistory !== false && !options.updatedAt;
  if (
    !suppressContentHistoryRef.current &&
    shouldRecordHistory &&
    previousContent !== acceptedContent
  ) {
    recordContentHistoryEntry({
      fileId,
      before: previousContent,
      after: acceptedContent,
    });
  }
  if (options.updatedAt && !needsIdentityMigration) {
    clearPendingLocalFileContent(fileId);
  } else {
    markPendingLocalFileContent(
      fileId,
      acceptedContent,
      options.updatedAt ?? previousFile?.updatedAt,
      identityMigrationSourceContent,
    );
  }
  queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
    if (!old || typeof old !== "object" || !Array.isArray(old.files)) {
      return old;
    }
    return {
      ...old,
      files: old.files.map((file: DesignFile) =>
        file.id === fileId
          ? {
              ...file,
              content: acceptedContent,
              ...(options.updatedAt ? { updatedAt: options.updatedAt } : {}),
            }
          : file,
      ),
    };
  });
  const { writeLiveDoc, syncCollab } = resolveScreenCollabSyncTarget({
    fileId,
    overviewPresenceFileId,
    overviewDocConnected:
      !needsIdentityMigration &&
      canWriteCollabText(overviewYdoc, overviewIsSynced, previousContent),
  });
  if (writeLiveDoc && overviewYdoc) {
    writeCollabText(
      overviewYdoc,
      overviewYdoc.getText("content"),
      acceptedContent,
      TAB_ID,
    );
  }
  let saveCompletion: Promise<FileContentSaveCompletion> | undefined;
  if (options.persist === false && !needsIdentityMigration) {
    cancelQueuedFileContentSave(fileId);
  } else {
    const completion = queueFileContentSave(fileId, acceptedContent, {
      expectedVersionHash: sourceContentHash(
        needsIdentityMigration
          ? nextContent
          : (options.sourceBaseContent ?? previousContent),
      ),
      syncCollab,
      immediate: true,
      identityMigrationSourceContent,
    });
    if (completion instanceof Promise) saveCompletion = completion;
  }
  return {
    status: "accepted",
    content: acceptedContent,
    nodeIdMap: prepared.nodeIdMap,
    ...(options.awaitSave && saveCompletion instanceof Promise
      ? { saveCompletion }
      : {}),
  };
}
