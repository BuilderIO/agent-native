import { assertDesignHtmlEditIntegrity } from "@shared/html-integrity";
import { sourceContentHash } from "@shared/source-workspace";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";
import * as Y from "yjs";

import { trace } from "@/components/design/design-trace";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  LOCAL_EDIT_ORIGIN,
  TAB_ID,
} from "@/pages/design-editor/editor-session";
import type { PreviewContentReplaceResult } from "@/pages/design-editor/editor-state";
import { previewContentReplaceNeedsRenderFallback } from "@/pages/design-editor/editor-state";
import type {
  ContentHistoryChange,
  ContentHistoryEntry,
} from "@/pages/design-editor/history";
import { designSaveErrorMessage } from "@/pages/design-editor/save-failure";
import type { DesignFile } from "@/pages/design-editor/types";

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
  lastAckedFileContentHashRef: RefObject<Record<string, string>>;
  lastLocalContentRef: RefObject<string | null>;
  latestActiveContentRef: RefObject<string | null>;
  markPendingLocalFileContent: (
    fileId: string,
    content: string,
    baseUpdatedAt?: string | null,
  ) => void;
  queryClient: QueryClient;
  queueFileContentSave: (
    fileId: string,
    content: string,
    options?: { syncCollab?: boolean; immediate?: boolean },
  ) => void;
  recordContentHistoryEntry: (entry: ContentHistoryEntry) => void;
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
    lastAckedFileContentHashRef,
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
  nextContent: string,
  options: {
    refreshPreview?: boolean;
    /**
     * Requires the caller to own the preview: it already patched the live
     * iframe, or its target is not the rendered document. Set on a
     * host-computed edit to the active screen and the canvas renders stale
     * content until a reload.
     */
    skipPreview?: boolean;
    forcePreviewFullDocument?: boolean;
    immediateSave?: boolean;
    persist?: boolean;
    recordHistory?: boolean;
    historyBeforeContent?: string;
    updatedAt?: string;
    clipboardMutation?: ClipboardContentMutationPublication;
  } = {},
) {
  trace("persist", "write-file", {
    file: activeFile?.filename ?? null,
    bytes: nextContent.length,
    blocked: !activeFile
      ? "no active file"
      : !canEditDesignRef.current
        ? "read-only design"
        : null,
  });
  if (!activeFile || !canEditDesignRef.current) return;
  const shouldRecordHistory =
    options.recordHistory !== false && !options.updatedAt;
  const previousContent =
    typeof options.historyBeforeContent === "string"
      ? options.historyBeforeContent
      : collabContentFileIdRef.current === activeFile.id &&
          typeof collabContentRef.current === "string"
        ? collabContentRef.current
        : (activeFile.content ?? "");
  try {
    assertDesignHtmlEditIntegrity({
      previousContent,
      nextContent,
      fileType: activeFile.fileType,
    });
  } catch (error) {
    toast.error(designSaveErrorMessage(error) ?? t("common.genericError"), {
      id: `design-source-integrity:${activeFile.id}`,
    });
    return;
  }
  // No implicit authority from `recordHistory`: save/query/Yjs echoes can
  // traverse this same function with history enabled. Only a publication
  // allocated synchronously at a user-action boundary may advance lineage.
  acknowledgeAuthoritativeClipboardMutation({
    fileId: activeFile.id,
    nextContent,
    publication: options.clipboardMutation,
  });
  const yjsHistoryAvailable = Boolean(
    shouldRecordHistory &&
    viewModeRef.current !== "overview" &&
    ydoc &&
    isSynced &&
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
      recordContentHistoryEntry(change);
    } else {
      recordLocalContentHistoryEntry(change);
    }
  } else if (
    !suppressContentHistoryRef.current &&
    shouldRecordHistory &&
    yjsHistoryAvailable &&
    previousContent !== nextContent
  ) {
    // The Yjs UndoManager is the primary undo path here, but it (and its
    // whole undo stack) is destroyed on every view-mode switch and zoom
    // (docId goes null -> ydoc changes). Mirror the same before/after into
    // the local fallback stack so handleUndo can still recover the edit
    // once the Yjs stack is gone; it is only consulted when Yjs itself has
    // nothing left to undo, so this never causes a double-undo.
    recordLocalContentHistoryChangeFallback({
      fileId: activeFile.id,
      before: previousContent,
      after: nextContent,
    });
  }
  if (options.updatedAt) {
    clearPendingLocalFileContent(activeFile.id);
    // options.updatedAt means this content is already server-persisted
    // (apply-source-edit's onApplied host-sync and friends) — record it
    // as the server-acknowledged base so the next guarded update-file
    // save carries the POST-shader hash, not a stale pre-shader one.
    lastAckedFileContentHashRef.current[activeFile.id] =
      sourceContentHash(nextContent);
  } else {
    markPendingLocalFileContent(
      activeFile.id,
      nextContent,
      activeFile.updatedAt,
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
            ? // Update content optimistically but keep the file's prior
              // (server-clock) updatedAt. Seeding the reconcile watermark
              // from a client-clock timestamp can, under clock skew, make a
              // later server-authored agent edit look "older" and get
              // dropped by the watermark gate (agent edit silently lost).
              {
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
  // Holistic flash pipeline: `forcePreviewFullDocument` tells the bridge
  // to use its whole-document innerHTML replace (needed when the change
  // isn't scoped to the currently selected element's subtree — e.g. an
  // undo/redo that can touch anywhere in the document), NOT to force a
  // full iframe srcdoc rebuild here. `replaceRuntimeDocument`'s full-body
  // branch already swaps content inside the SAME live iframe document (no
  // navigation, no onload refire, persistent overlay nodes preserved —
  // see that function's module doc) — it is exactly as flash-free as the
  // scoped single-element patch, just broader. Previously this always
  // bumped contentRenderRevision whenever forcePreviewFullDocument was
  // set, even after replacePreviewContent already applied the update in
  // place, forcing a completely redundant full srcdoc rebuild (real
  // iframe reload, white flash, lost scroll/CSS-transition/Alpine state)
  // on top of a change that had already rendered correctly. Only fall
  // back to the expensive srcdoc rebuild when the live patch genuinely
  // couldn't run (bridge not registered for this surface yet, or an
  // explicit forceRefresh request).
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
  if (ydoc && isSynced) {
    const ytext = ydoc.getText("content");
    if (ytext.toString() !== nextContent) {
      if (!yjsHistoryAvailable) {
        // Untracked full rewrite (recordHistory:false callers such as the
        // code-layer id-stamping effect, or history-suppressed replays) —
        // see U1 note above: clear the undo stack so a stale tracked
        // delta can't be replayed against content it no longer matches.
        undoManagerRef.current?.clear(true, false);
      }
      ydoc.transact(
        () => {
          ytext.delete(0, ytext.length);
          ytext.insert(0, nextContent);
        },
        yjsHistoryAvailable ? LOCAL_EDIT_ORIGIN : TAB_ID,
      );
    }
  }
  if (options.persist === false) {
    cancelQueuedFileContentSave(activeFile.id);
  } else {
    queueFileContentSave(activeFile.id, nextContent, {
      syncCollab: !(ydoc && isSynced),
      immediate: options.immediateSave,
    });
  }
}
