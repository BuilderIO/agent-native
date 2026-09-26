import { sourceContentHash } from "@shared/source-workspace";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";
import * as Y from "yjs";

import { trace } from "@/components/design/design-trace";
import { isShaderWriteInFlight } from "@/components/design/inspector/GlslShaderPanel";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  canWriteCollabText,
  writeCollabText,
} from "@/pages/design-editor/collab-sync";
import {
  LOCAL_EDIT_ORIGIN,
  TAB_ID,
} from "@/pages/design-editor/editor-session";
import type { PreviewContentReplaceResult } from "@/pages/design-editor/editor-state";
import { previewContentReplaceNeedsRenderFallback } from "@/pages/design-editor/editor-state";
import type {
  ContentHistoryChange,
  ContentHistoryEntry,
  YjsUndoSelectionSnapshot,
} from "@/pages/design-editor/history";
import { designSaveErrorMessage } from "@/pages/design-editor/save-failure";
import { prepareAcceptedSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import type { FileContentSaveCompletion } from "./save-file-content";

export interface ApplyLocalContentUpdateArgs {
  acknowledgeAuthoritativeClipboardMutation: (args: {
    fileId: string;
    nextContent: string;
    publication?: ClipboardContentMutationPublication;
  }) => void;
  activeFile: DesignFile;
  canEditDesignRef: RefObject<boolean>;
  cancelQueuedFileContentSave: (fileId: string) => void;
  clearPendingLocalFileContent: (
    fileId: string,
    expectedContent?: string,
  ) => void;
  collabContentFileIdRef: RefObject<string | null>;
  collabContentRef: RefObject<string | null>;
  id: string | undefined;
  isSynced: boolean;
  lastLocalContentRef: RefObject<string | null>;
  latestActiveContentRef: RefObject<string | null>;
  markPendingLocalFileContent: (
    fileId: string,
    content: string,
    baseUpdatedAt?: string | null,
    identityMigrationSourceContent?: string,
  ) => void;
  queryClient: QueryClient;
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
  recordContentHistoryEntry: (
    entry: ContentHistoryEntry,
    selectedLayerIdsOverride?: string[],
  ) => void;
  recordLocalContentHistoryChangeFallback: (
    change: ContentHistoryChange,
  ) => void;
  recordLocalContentHistoryEntry: (change: ContentHistoryChange) => void;
  replacePreviewContent: (
    nextContent: string,
    selector?: string | null,
    options?: { forceFullDocument?: boolean },
  ) => PreviewContentReplaceResult;
  setCollabContent: Dispatch<SetStateAction<string | null>>;
  setCollabContentFileId: Dispatch<SetStateAction<string | null>>;
  setContentRenderRevision: Dispatch<SetStateAction<number>>;
  suppressContentHistoryRef: RefObject<boolean>;
  t: (key: string, options?: Record<string, unknown>) => string;
  undoManagerRef: RefObject<Y.UndoManager | null>;
  viewModeRef: RefObject<"single" | "overview">;
  ydoc: Y.Doc | null;
}

export type ApplyLocalContentUpdateResult =
  | {
      status: "accepted";
      content: string;
      nodeIdMap: ReadonlyMap<string, string>;
      saveCompletion?: Promise<FileContentSaveCompletion>;
    }
  | { status: "refused" };

export function runApplyLocalContentUpdate(
  {
    acknowledgeAuthoritativeClipboardMutation,
    activeFile,
    canEditDesignRef,
    cancelQueuedFileContentSave,
    clearPendingLocalFileContent,
    collabContentFileIdRef,
    collabContentRef,
    id,
    isSynced,
    lastLocalContentRef,
    latestActiveContentRef,
    markPendingLocalFileContent,
    queryClient,
    queueFileContentSave,
    recordContentHistoryEntry,
    recordLocalContentHistoryChangeFallback,
    recordLocalContentHistoryEntry,
    replacePreviewContent,
    setCollabContent,
    setCollabContentFileId,
    setContentRenderRevision,
    suppressContentHistoryRef,
    t,
    undoManagerRef,
    viewModeRef,
    ydoc,
  }: ApplyLocalContentUpdateArgs,
  inputContent: string,
  options: {
    refreshPreview?: boolean;
    skipPreview?: boolean;
    forcePreviewFullDocument?: boolean;
    immediateSave?: boolean;
    persist?: boolean;
    recordHistory?: boolean;
    historyBeforeContent?: string;
    sourceBaseContent?: string;
    identityMigrationSourceContent?: string;
    shaderWriteCompletion?: true;
    updatedAt?: string;
    clipboardMutation?: ClipboardContentMutationPublication;
    awaitSave?: boolean;
    selectionBefore?: YjsUndoSelectionSnapshot;
  } = {},
): ApplyLocalContentUpdateResult {
  if (!activeFile || !canEditDesignRef.current) return { status: "refused" };
  if (isShaderWriteInFlight(activeFile.id) && !options.shaderWriteCompletion) {
    toast.error(t("designEditor.toasts.saveConflict"), {
      id: `design-source-shader-conflict:${activeFile.id}`,
    });
    return { status: "refused" };
  }
  const previousContent =
    typeof options.historyBeforeContent === "string"
      ? options.historyBeforeContent
      : collabContentFileIdRef.current === activeFile.id &&
          typeof collabContentRef.current === "string"
        ? collabContentRef.current
        : (activeFile.content ?? "");
  let prepared: ReturnType<typeof prepareAcceptedSourceContent>;
  try {
    prepared = prepareAcceptedSourceContent(inputContent, {
      fileId: activeFile.id,
      previousContent,
      fileType: activeFile.fileType,
    });
  } catch (error) {
    toast.error(designSaveErrorMessage(error) ?? t("common.genericError"), {
      id: `design-source-integrity:${activeFile.id}`,
    });
    return { status: "refused" };
  }
  const nextContent = prepared.content;
  const needsIdentityMigration = Boolean(options.updatedAt && prepared.changed);
  const identityMigrationSourceContent =
    options.identityMigrationSourceContent ??
    (needsIdentityMigration ? inputContent : undefined);
  trace("persist", "write-file", {
    file: activeFile?.filename ?? null,
    bytes: nextContent.length,
    blocked: !activeFile
      ? "no active file"
      : !canEditDesignRef.current
        ? "read-only design"
        : null,
  });
  const shouldRecordHistory =
    options.recordHistory !== false && !options.updatedAt;

  acknowledgeAuthoritativeClipboardMutation({
    fileId: activeFile.id,
    nextContent,
    publication: options.clipboardMutation,
  });
  const writeLiveDoc =
    !needsIdentityMigration &&
    canWriteCollabText(ydoc, isSynced, previousContent);
  const yjsHistoryAvailable = Boolean(
    shouldRecordHistory &&
    viewModeRef.current !== "overview" &&
    writeLiveDoc &&
    undoManagerRef.current,
  );
  if (
    !suppressContentHistoryRef.current &&
    shouldRecordHistory &&
    !yjsHistoryAvailable &&
    previousContent !== nextContent
  ) {
    const change = {
      fileId: activeFile.id,
      before: previousContent,
      after: nextContent,
    };
    if (viewModeRef.current === "overview") {
      recordContentHistoryEntry(
        change,
        options.selectionBefore?.selectedLayerIds,
      );
    } else {
      recordLocalContentHistoryEntry({
        ...change,
        selectionBefore: options.selectionBefore,
      });
    }
  } else if (
    !suppressContentHistoryRef.current &&
    shouldRecordHistory &&
    yjsHistoryAvailable &&
    previousContent !== nextContent
  ) {
    recordLocalContentHistoryChangeFallback({
      fileId: activeFile.id,
      before: previousContent,
      after: nextContent,
      selectionBefore: options.selectionBefore,
    });
  }
  if (options.updatedAt && !needsIdentityMigration) {
    clearPendingLocalFileContent(activeFile.id);
  } else {
    markPendingLocalFileContent(
      activeFile.id,
      nextContent,
      options.updatedAt ?? activeFile.updatedAt,
      identityMigrationSourceContent,
    );
  }
  setCollabContent(nextContent);
  setCollabContentFileId(activeFile.id);
  collabContentRef.current = nextContent;
  collabContentFileIdRef.current = activeFile.id;
  lastLocalContentRef.current = nextContent;
  latestActiveContentRef.current = nextContent;
  if (id) {
    queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
      if (!old || typeof old !== "object" || !Array.isArray(old.files)) {
        return old;
      }
      return {
        ...old,
        files: old.files.map((file: DesignFile) =>
          file.id === activeFile.id
            ? {
                ...file,
                content: nextContent,
                ...(options.updatedAt ? { updatedAt: options.updatedAt } : {}),
              }
            : file,
        ),
      };
    });
  }
  const forceRefresh = options.refreshPreview === true;
  const replacedPreview = options.skipPreview
    ? "skipped-caller-owns-preview"
    : forceRefresh
      ? "unavailable"
      : replacePreviewContent(
          nextContent,
          null,
          options.forcePreviewFullDocument
            ? { forceFullDocument: true }
            : undefined,
        );
  const renderFallback =
    forceRefresh || previewContentReplaceNeedsRenderFallback(replacedPreview);
  trace("persist", "preview", {
    outcome: replacedPreview,
    forceFullDocument: options.forcePreviewFullDocument === true,
    renderFallback,
    bytes: nextContent.length,
  });
  if (renderFallback) {
    setContentRenderRevision((revision) => revision + 1);
  }
  if (ydoc && writeLiveDoc) {
    const ytext = ydoc.getText("content");
    if (ytext.toJSON() !== nextContent) {
      if (!yjsHistoryAvailable) {
        undoManagerRef.current?.clear(true, false);
      }
      writeCollabText(
        ydoc,
        ytext,
        nextContent,
        yjsHistoryAvailable ? LOCAL_EDIT_ORIGIN : TAB_ID,
      );
    }
  }
  let saveCompletion: Promise<FileContentSaveCompletion> | undefined;
  if (options.persist === false && !needsIdentityMigration) {
    cancelQueuedFileContentSave(activeFile.id);
  } else {
    const completion = queueFileContentSave(activeFile.id, nextContent, {
      expectedVersionHash: sourceContentHash(
        needsIdentityMigration
          ? inputContent
          : (options.sourceBaseContent ?? previousContent),
      ),
      syncCollab: !writeLiveDoc,
      immediate: needsIdentityMigration ? true : options.immediateSave,
      identityMigrationSourceContent,
    });
    if (completion instanceof Promise) saveCompletion = completion;
  }
  return {
    status: "accepted",
    content: nextContent,
    nodeIdMap: prepared.nodeIdMap,
    ...(options.awaitSave && saveCompletion instanceof Promise
      ? { saveCompletion }
      : {}),
  };
}
