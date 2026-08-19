import { assertDesignHtmlEditIntegrity } from "@shared/html-integrity";
import { sourceContentHash } from "@shared/source-workspace";
import type { QueryClient } from "@tanstack/react-query";
import type { RefObject } from "react";
import { toast } from "sonner";
import * as Y from "yjs";

import {
  isShaderWriteInFlight,
  waitForShaderWriteToSettle,
} from "@/components/design/inspector/GlslShaderPanel";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import { resolveScreenCollabSyncTarget } from "@/pages/design-editor/collab-sync";
import { TAB_ID } from "@/pages/design-editor/editor-session";
import type { FileContentSaveRequest } from "@/pages/design-editor/editor-state";
import type { ContentHistoryEntry } from "@/pages/design-editor/history";
import { designSaveErrorMessage } from "@/pages/design-editor/save-failure";
import type { DesignFile } from "@/pages/design-editor/types";

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
      persist?: boolean;
      recordHistory?: boolean;
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
      persist?: boolean;
      recordHistory?: boolean;
      historyBeforeContent?: string;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => void;
  canEditDesignRef: RefObject<boolean>;
  cancelQueuedFileContentSave: (fileId: string) => void;
  clearPendingLocalFileContent: (
    fileId: string,
    expectedContent?: string,
  ) => void;
  createFileContentSaveRequest: (
    fileId: string,
    content: string,
    syncCollab: boolean,
  ) => FileContentSaveRequest;
  files: DesignFile[];
  getScreenContent: (screenId: string) => string;
  id: string | undefined;
  lastAckedFileContentHashRef: RefObject<Record<string, string>>;
  markPendingLocalFileContent: (
    fileId: string,
    content: string,
    baseUpdatedAt?: string | null,
  ) => void;
  overviewIsSynced: boolean;
  overviewPresenceFileId: string | null;
  overviewYdoc: Y.Doc | null;
  queryClient: QueryClient;
  recordContentHistoryEntry: (entry: ContentHistoryEntry) => void;
  saveFileContent: (pending: FileContentSaveRequest) => void;
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
    createFileContentSaveRequest,
    files,
    getScreenContent,
    id,
    lastAckedFileContentHashRef,
    markPendingLocalFileContent,
    overviewIsSynced,
    overviewPresenceFileId,
    overviewYdoc,
    queryClient,
    recordContentHistoryEntry,
    saveFileContent,
    suppressContentHistoryRef,
    t,
  }: ApplyFileContentUpdateArgs,
  fileId: string,
  nextContent: string,
  options: {
    refreshPreview?: boolean;
    skipPreview?: boolean;
    forcePreviewFullDocument?: boolean;
    persist?: boolean;
    recordHistory?: boolean;
    updatedAt?: string;
    clipboardMutation?: ClipboardContentMutationPublication;
  } = {},
) {
  if (!canEditDesignRef.current) return;
  if (fileId === activeFile?.id) {
    applyLocalContentUpdate(nextContent, options);
    return;
  }
  // Cross-pipeline write race guard — same hazard commitVisualStyles
  // already defends against (see its withShaderWriteLock note): a shader
  // apply/remove/knob-commit for this same file runs a separate
  // read-source-file -> apply-source-edit round trip, and the overview
  // writeLiveDoc rewrite below replays FULL content into the connected
  // overviewYdoc. Racing the two corrupts the doc (server-side diff vs
  // synchronous untracked full rewrite). Defer the whole update until the
  // in-flight shader write settles; the common no-shader case stays fully
  // synchronous.
  if (isShaderWriteInFlight(fileId)) {
    void waitForShaderWriteToSettle(fileId).then(() => {
      applyFileContentUpdate(fileId, nextContent, options);
    });
    return;
  }
  const previousFile = files.find((file) => file.id === fileId);
  const previousContent =
    getScreenContent(fileId) ?? previousFile?.content ?? "";
  try {
    assertDesignHtmlEditIntegrity({
      previousContent,
      nextContent,
      fileType: previousFile?.fileType ?? "html",
    });
  } catch (error) {
    toast.error(designSaveErrorMessage(error) ?? t("common.genericError"), {
      id: `design-source-integrity:${fileId}`,
    });
    return;
  }
  acknowledgeAuthoritativeClipboardMutation({
    fileId,
    nextContent,
    publication: options.clipboardMutation,
  });
  const shouldRecordHistory =
    options.recordHistory !== false && !options.updatedAt;
  if (
    !suppressContentHistoryRef.current &&
    shouldRecordHistory &&
    previousContent !== nextContent
  ) {
    recordContentHistoryEntry({
      fileId,
      before: previousContent,
      after: nextContent,
    });
  }
  if (options.updatedAt) {
    clearPendingLocalFileContent(fileId);
    // Server-persisted content (see the matching note in
    // applyLocalContentUpdate) — refresh the acked-hash base for the
    // guarded update-file saves.
    lastAckedFileContentHashRef.current[fileId] =
      sourceContentHash(nextContent);
  } else {
    markPendingLocalFileContent(fileId, nextContent, previousFile?.updatedAt);
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
              content: nextContent,
              ...(options.updatedAt ? { updatedAt: options.updatedAt } : {}),
            }
          : file,
      ),
    };
  });
  // §gesture-persistence — mirror applyLocalContentUpdate's collab-doc
  // write. This screen isn't the active file, but overview mode can still
  // hold a LIVE connected Yjs doc for it via the presence-only
  // `overviewYdoc` subscription (keyed on `overviewPresenceFileId`, the
  // selected/worked screen in overview — see its declaration doc comment).
  // Before this fix, per-screen gesture commits only ever wrote SQL and
  // relied entirely on the server-side `syncCollab: true` -> applyText
  // round-trip to keep that connected doc in step; any gap between the
  // SQL write and the next collab poll/state fetch left the connected
  // client holding pre-edit Yjs text, which a subsequent doc connect
  // (Code panel open) could read back as the seed snapshot. Writing the
  // ydoc directly here — the same untracked-full-rewrite pattern used
  // throughout this file — closes that gap the same way the active-file
  // path already does, and lets syncCollab be skipped for the
  // server-side round-trip since the client push already covers it.
  const { writeLiveDoc, syncCollab } = resolveScreenCollabSyncTarget({
    fileId,
    overviewPresenceFileId,
    overviewDocConnected: !!(overviewYdoc && overviewIsSynced),
  });
  if (writeLiveDoc && overviewYdoc) {
    const ytext = overviewYdoc.getText("content");
    if (ytext.toString() !== nextContent) {
      overviewYdoc.transact(() => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, nextContent);
      }, TAB_ID);
    }
  }
  if (options.persist === false) {
    cancelQueuedFileContentSave(fileId);
  } else {
    saveFileContent(
      createFileContentSaveRequest(fileId, nextContent, syncCollab),
    );
  }
}
