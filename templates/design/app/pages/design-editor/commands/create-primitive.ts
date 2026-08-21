import { buildCodeLayerProjection } from "@shared/code-layer";
import { shouldUseLiveFileContent } from "@shared/html-content";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";
import * as Y from "yjs";

import type { CanvasPrimitiveInsert } from "@/components/design/multi-screen/types";
import type { RuntimeStructureInsertRequest } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  appendCanvasPrimitiveToHtml,
  blankScreenHtml,
  extractCanvasPrimitiveHtml,
  uniqueLayerId,
} from "@/pages/design-editor/canvas-primitive-insert";
import { parsePenPathFromSerializedD } from "@/pages/design-editor/canvas-primitives";
import { setPenNodesAttributeOnElement } from "@/pages/design-editor/clone-and-pen-edit";
import type { FileContentSaveRequest } from "@/pages/design-editor/editor-state";
import { isStandaloneHttpUrl } from "@/pages/design-editor/editor-state";
import type {
  ContentHistoryEntry,
  PendingTextCreationHistory,
} from "@/pages/design-editor/history";
import type { DesignFile } from "@/pages/design-editor/types";

export interface CreatePrimitiveArgs {
  activeContent: string;
  activeFile: DesignFile;
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
  boardFileId: string | undefined;
  canEditDesign: boolean;
  collabContentFileIdRef: RefObject<string | null>;
  collabContentRef: RefObject<string | null>;
  createFileContentSaveRequest: (
    fileId: string,
    content: string,
    syncCollab: boolean,
  ) => FileContentSaveRequest;
  files: DesignFile[];
  id: string | undefined;
  isSynced: boolean;
  markPendingLocalFileContent: (
    fileId: string,
    content: string,
    baseUpdatedAt?: string | null,
  ) => void;
  pendingLocalFileContentsRef: RefObject<
    Map<
      string,
      { content: string; startedAt: number; baseUpdatedAt?: string | null }
    >
  >;
  pendingTextCreationHistoryRef: RefObject<PendingTextCreationHistory | null>;
  pendingTextEditNodeIdRef: RefObject<string | null>;
  queryClient: QueryClient;
  recordContentHistoryEntry: (entry: ContentHistoryEntry) => void;
  runtimeStructureInsertRevisionRef: RefObject<number>;
  saveFileContent: (pending: FileContentSaveRequest) => void;
  setRuntimeStructureInsertRequest: Dispatch<
    SetStateAction<
      (RuntimeStructureInsertRequest & { screenId: string }) | null
    >
  >;
  t: (key: string, options?: Record<string, unknown>) => string;
  viewModeRef: RefObject<"single" | "overview">;
  ydoc: Y.Doc | null;
}

export function runCreatePrimitive(
  {
    activeContent,
    activeFile,
    applyLocalContentUpdate,
    boardFileId,
    canEditDesign,
    collabContentFileIdRef,
    collabContentRef,
    createFileContentSaveRequest,
    files,
    id,
    isSynced,
    markPendingLocalFileContent,
    pendingLocalFileContentsRef,
    pendingTextCreationHistoryRef,
    pendingTextEditNodeIdRef,
    queryClient,
    recordContentHistoryEntry,
    runtimeStructureInsertRevisionRef,
    saveFileContent,
    setRuntimeStructureInsertRequest,
    t,
    viewModeRef,
    ydoc,
  }: CreatePrimitiveArgs,
  screenId: string,
  primitive: CanvasPrimitiveInsert,
) {
  if (!canEditDesign) return false;
  const targetFile = files.find((file) => file.id === screenId);
  if (!targetFile) return false;
  const pendingContent = pendingLocalFileContentsRef.current.get(
    targetFile.id,
  )?.content;
  const storedContent = targetFile.content ?? "";
  const baseContent =
    pendingContent ??
    (targetFile.id === activeFile?.id
      ? (() => {
          const liveContent =
            ydoc && isSynced
              ? ydoc.getText("content").toString()
              : ((collabContentFileIdRef.current === activeFile.id
                  ? collabContentRef.current
                  : null) ?? activeContent);
          return shouldUseLiveFileContent({
            liveContent,
            storedContent,
            fileType: targetFile.fileType,
          })
            ? liveContent
            : storedContent;
        })()
      : storedContent);
  // A localhost screen's stored content is its route URL, not an editable
  // document. Keep that URL intact and send one serialized primitive
  // through the same live insert bridge used by board-to-screen drops.
  // The bridge echo records the pending source handoff and owns the
  // optimistic DOM/history lifecycle (selection, Layers, undo, and redo).
  if (isStandaloneHttpUrl(baseContent)) {
    const nodeId =
      primitive.nodeId ?? uniqueLayerId(primitive.kind || "primitive");
    const livePrimitive = { ...primitive, nodeId };
    const temporaryDocument = appendCanvasPrimitiveToHtml(
      blankScreenHtml("Live insert"),
      livePrimitive,
    );
    if (!temporaryDocument) {
      toast.error(t("designEditor.toasts.primitiveInsertFailed"));
      return false;
    }
    const enrichedDocument =
      primitive.kind === "path" && primitive.pathData
        ? (() => {
            const reconstructed = parsePenPathFromSerializedD(
              primitive.pathData!,
            );
            return reconstructed
              ? setPenNodesAttributeOnElement(
                  temporaryDocument,
                  nodeId,
                  reconstructed,
                )
              : temporaryDocument;
          })()
        : temporaryDocument;
    const insertedHtml = extractCanvasPrimitiveHtml(enrichedDocument, nodeId);
    if (!insertedHtml) {
      toast.error(t("designEditor.toasts.primitiveInsertFailed"));
      return false;
    }
    pendingTextEditNodeIdRef.current =
      primitive.kind === "text" ? nodeId : null;
    runtimeStructureInsertRevisionRef.current += 1;
    setRuntimeStructureInsertRequest({
      requestId: runtimeStructureInsertRevisionRef.current,
      screenId: targetFile.id,
      html: insertedHtml,
      anchor: { selector: "body" },
      placement: "inside",
    });
    return nodeId;
  }
  const insertedContent = appendCanvasPrimitiveToHtml(baseContent, primitive, {
    preserveNegativePosition: targetFile.id === boardFileId,
    isBoardTarget: targetFile.id === boardFileId,
  });
  if (!insertedContent) {
    toast.error(t("designEditor.toasts.primitiveInsertFailed"));
    return false;
  }
  // Vector-edit foundations: stash the structured pen path (nodes +
  // handles) alongside the flattened `d` so a later double-click/Enter
  // can re-hydrate it into an editable path instead of only having the
  // already-flattened curve. `primitive.pathData` is the only carrier of
  // pen geometry that crosses the MultiScreenCanvas -> DesignEditor
  // boundary for an OVERVIEW-drawn pen path (see
  // parsePenPathFromSerializedD's doc comment for why this reconstructs
  // rather than receives the structured path directly).
  const nextContent =
    primitive.kind === "path" && primitive.pathData && primitive.nodeId
      ? (() => {
          const reconstructed = parsePenPathFromSerializedD(
            primitive.pathData!,
          );
          return reconstructed
            ? setPenNodesAttributeOnElement(
                insertedContent,
                primitive.nodeId!,
                reconstructed,
              )
            : insertedContent;
        })()
      : insertedContent;
  const projectedNodeId = primitive.nodeId
    ? buildCodeLayerProjection(nextContent).nodes.find(
        (node) =>
          node.dataAttributes["data-agent-native-node-id"] === primitive.nodeId,
      )?.id
    : null;

  pendingTextCreationHistoryRef.current =
    primitive.kind === "text" &&
    primitive.nodeId &&
    viewModeRef.current === "overview"
      ? {
          fileId: targetFile.id,
          nodeId: primitive.nodeId,
          before: baseContent,
          created: nextContent,
        }
      : null;

  if (targetFile.id === activeFile?.id) {
    applyLocalContentUpdate(nextContent, {
      forcePreviewFullDocument: true,
      historyBeforeContent: baseContent,
      immediateSave: true,
    });
  } else {
    recordContentHistoryEntry({
      fileId: targetFile.id,
      before: baseContent,
      after: nextContent,
    });
    // Stamp the server-clock base the same way applyFileContentUpdate
    // does. Without it the reconcile effect reads the optimistic cache
    // write below as a server acknowledgement and retires the pending
    // entry immediately, leaving that cache the only carrier of the
    // insert — so any get-design response already in flight (the board
    // file's own lazy migration invalidates on success, so one usually
    // is) overwrites it with pre-insert content and the primitive
    // disappears from the canvas until a reload.
    markPendingLocalFileContent(
      targetFile.id,
      nextContent,
      targetFile.updatedAt,
    );
    queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
      if (!old || typeof old !== "object" || !Array.isArray(old.files)) {
        return old;
      }
      return {
        ...old,
        files: old.files.map((file: DesignFile) =>
          file.id === targetFile.id ? { ...file, content: nextContent } : file,
        ),
      };
    });
    saveFileContent(
      createFileContentSaveRequest(targetFile.id, nextContent, true),
    );
  }

  const result = projectedNodeId ?? primitive.nodeId ?? true;

  // Record the nodeId when a TEXT primitive is created so the next
  // handlePrimitiveCreated (or handleBoardDrawPrimitive) can immediately
  // enter text-edit mode — fixing the "click to add text should let me
  // type immediately" bug. The ref is read once and cleared.
  if (primitive.kind === "text") {
    pendingTextEditNodeIdRef.current = primitive.nodeId ?? null;
  } else {
    pendingTextEditNodeIdRef.current = null;
  }

  return result;
}
