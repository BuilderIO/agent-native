import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";
import * as Y from "yjs";

import type {
  ElementInfo,
  RuntimeStructureInsertRequest,
} from "@/components/design/types";
import type {
  ClipboardContentLineage,
  ClipboardContentMutationOrigin,
  ClipboardContentMutationPublication,
} from "@/lib/clipboard-content-lineage";
import type { DesignClipboardScreenEntry } from "@/lib/design-import";
import {
  extractLayerPosition,
  insertClonedHtmlLayers,
  prepareClonedHtmlLayersForLiveInsert,
} from "@/pages/design-editor/clone-and-pen-edit";
import type { CanvasLayerClipboardEntry } from "@/pages/design-editor/command-types";
import { isStandaloneHttpUrl } from "@/pages/design-editor/editor-state";
import type { ContentHistoryChange } from "@/pages/design-editor/history";
import { MAX_DESIGN_UNDO_STACK } from "@/pages/design-editor/history";
import { resolvePastePlacementForSelection } from "@/pages/design-editor/paste-placement";
import type { DesignFile } from "@/pages/design-editor/types";

export interface PasteSelectionArgs {
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
  boardFileId: string | undefined;
  canEditDesign: boolean;
  canvasContainerRef: RefObject<HTMLDivElement | null>;
  clearRedoStacks: () => void;
  clipboardPasteRedoStackRef: RefObject<ContentHistoryChange[]>;
  clipboardPasteUndoStackRef: RefObject<ContentHistoryChange[]>;
  files: DesignFile[];
  getCanvasClipboardEntries: () => CanvasLayerClipboardEntry[];
  getCanvasScreenClipboardEntries: () => DesignClipboardScreenEntry[];
  getFreshActiveContent: () => string;
  getScreenContent: (screenId: string) => string;
  latestClipboardMutationContentRef: RefObject<
    Map<string, ClipboardContentLineage>
  >;
  pasteCascadeRef: RefObject<number>;
  pasteCopiedScreens: (
    screens: DesignClipboardScreenEntry[],
    position?: { x: number; y: number },
  ) => void;
  pendingLocalFileContentsRef: RefObject<
    Map<
      string,
      { content: string; startedAt: number; baseUpdatedAt?: string | null }
    >
  >;
  publishAuthoritativeClipboardMutation: (args: {
    fileId: string;
    baseContent: string;
    nextContent: string;
    origin: ClipboardContentMutationOrigin;
  }) => ClipboardContentMutationPublication | null;
  refreshClipboardFromSystemClipboard: () => Promise<void>;
  remapMotionTracksForClone: (
    nodeIdMap: Map<string, string>,
    targetFileId: string,
  ) => void;
  runtimeStructureInsertRevisionRef: RefObject<number>;
  selectInsertedLayers: (
    screenId: string,
    content: string,
    rootNodeIds: string[],
  ) => void;
  selectedCanvasSelector: string;
  selectedElement: ElementInfo | null;
  setRuntimeStructureInsertRequest: Dispatch<
    SetStateAction<
      (RuntimeStructureInsertRequest & { screenId: string }) | null
    >
  >;
  syncUndoRedoState: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  undoManagerRef: RefObject<Y.UndoManager | null>;
  viewModeRef: RefObject<"single" | "overview">;
  zoom: number;
}

export async function runPasteSelection(
  {
    activeFile,
    applyFileContentUpdate,
    applyLocalContentUpdate,
    boardFileId,
    canEditDesign,
    canvasContainerRef,
    clearRedoStacks,
    clipboardPasteRedoStackRef,
    clipboardPasteUndoStackRef,
    files,
    getCanvasClipboardEntries,
    getCanvasScreenClipboardEntries,
    getFreshActiveContent,
    getScreenContent,
    latestClipboardMutationContentRef,
    pasteCascadeRef,
    pasteCopiedScreens,
    pendingLocalFileContentsRef,
    publishAuthoritativeClipboardMutation,
    refreshClipboardFromSystemClipboard,
    remapMotionTracksForClone,
    runtimeStructureInsertRevisionRef,
    selectInsertedLayers,
    selectedCanvasSelector,
    selectedElement,
    setRuntimeStructureInsertRequest,
    syncUndoRedoState,
    t,
    undoManagerRef,
    viewModeRef,
    zoom,
  }: PasteSelectionArgs,
  position?: { x: number; y: number },
) {
  // U19: paste is a discrete one-shot action, never a continuous gesture
  // like a slider drag. Without stopCapturing(), a paste that happens to
  // land within 800ms of the previous Yjs-tracked edit (captureTimeout)
  // would merge with it into one undo step — Cmd+Z would then undo both
  // the unrelated prior edit AND the paste together.
  undoManagerRef.current?.stopCapturing();
  await refreshClipboardFromSystemClipboard();
  const entries = getCanvasClipboardEntries();
  const targetFileId =
    viewModeRef.current === "overview" && position && boardFileId
      ? boardFileId
      : activeFile?.id;
  if (entries.length === 0) {
    // No layer-level clipboard content — fall back to whole-screen paste
    // (U6) when the clipboard instead carries copied screen snapshots.
    const screens = getCanvasScreenClipboardEntries();
    if (screens.length > 0 && canEditDesign) {
      pasteCopiedScreens(screens, position);
    }
    return;
  }
  if (!targetFileId || !canEditDesign) return;
  // The pending-local map is the synchronous write-through source for
  // same-task/repeated operations. React query/collab mirrors can lag one
  // render behind a just-completed paste even after its save is already
  // observable from another request; rebasing a second paste on that stale
  // mirror makes its history `before` skip the first clone, so one undo
  // removes both. Prefer the pending snapshot exactly like primitive and
  // cross-screen structure writes do elsewhere in this editor.
  const baseContent =
    latestClipboardMutationContentRef.current.get(targetFileId)?.content ??
    pendingLocalFileContentsRef.current.get(targetFileId)?.content ??
    (targetFileId === activeFile?.id
      ? getFreshActiveContent()
      : (getScreenContent(targetFileId) ?? ""));
  if (!baseContent && targetFileId !== boardFileId) return;
  const layerHtmls = entries.map((entry) => entry.html);
  const styleSnapshots = entries.map((entry) => entry.portableStyleSnapshot);
  const managedStyleSnapshots = entries.map(
    (entry) => entry.managedStyleSnapshot,
  );
  const targetFile = files.find((file) => file.id === targetFileId);
  const targetStoredContent = targetFile?.content ?? baseContent;
  if (isStandaloneHttpUrl(targetStoredContent)) {
    const selectedAnchor =
      !position &&
      targetFileId === activeFile?.id &&
      selectedElement?.selector &&
      !["body", "html"].includes(selectedElement.tagName?.toLowerCase() ?? "")
        ? {
            selector:
              selectedElement.runtimeSelector ??
              selectedCanvasSelector ??
              selectedElement.selector,
            sourceId:
              selectedElement.runtimeSourceId ??
              selectedElement.sourceId ??
              undefined,
          }
        : null;
    const sourcePositions = entries.map((entry) =>
      extractLayerPosition(entry.html),
    );
    const positionedSources = sourcePositions.filter(
      (source): source is { x: number; y: number } => Boolean(source),
    );
    const minSourceX = positionedSources.length
      ? Math.min(...positionedSources.map((source) => source.x))
      : 0;
    const minSourceY = positionedSources.length
      ? Math.min(...positionedSources.map((source) => source.y))
      : 0;
    const iframe =
      canvasContainerRef.current?.querySelector<HTMLElement>(
        "[data-design-preview-iframe]",
      ) ?? null;
    const iframeRect = iframe?.getBoundingClientRect();
    const factor = zoom / 100;
    const viewportCenter = iframeRect
      ? {
          x: Math.max(0, iframeRect.width / 2 / factor),
          y: Math.max(0, iframeRect.height / 2 / factor),
        }
      : { x: 120, y: 120 };
    const cascadeOffset = pasteCascadeRef.current * 16;
    const pastingIntoSourceScreen = entries.every(
      (entry) => entry.sourceFileId === targetFileId,
    );
    const positions = selectedAnchor
      ? undefined
      : entries.map((_, index) => {
          const source = sourcePositions[index];
          if (position) {
            return source && positionedSources.length
              ? {
                  x: position.x + source.x - minSourceX,
                  y: position.y + source.y - minSourceY,
                }
              : {
                  x: position.x + index * 16,
                  y: position.y + index * 16,
                };
          }
          return source && pastingIntoSourceScreen
            ? {
                x: source.x + 10 + cascadeOffset,
                y: source.y + 10 + cascadeOffset,
              }
            : {
                x: viewportCenter.x + cascadeOffset + index * 16,
                y: viewportCenter.y + cascadeOffset + index * 16,
              };
        });
    const prepared = prepareClonedHtmlLayersForLiveInsert(
      targetStoredContent,
      layerHtmls,
      {
        stripRootPosition: Boolean(selectedAnchor),
        positions,
        styleSnapshots,
      },
    );
    const firstHtml = prepared?.htmlFragments[0];
    if (!prepared || !firstHtml) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), {
        duration: 4000,
      });
      return;
    }
    pasteCascadeRef.current += 1;
    runtimeStructureInsertRevisionRef.current += 1;
    setRuntimeStructureInsertRequest({
      requestId: runtimeStructureInsertRevisionRef.current,
      screenId: targetFileId,
      html: firstHtml,
      additionalHtml: prepared.htmlFragments.slice(1),
      anchor: selectedAnchor ?? { selector: "body" },
      placement: selectedAnchor ? "after" : "inside",
    });
    return;
  }
  const applyPasteContentUpdate = (nextContent: string) => {
    const clipboardMutation = publishAuthoritativeClipboardMutation({
      fileId: targetFileId,
      baseContent,
      nextContent,
      origin: "clipboard-paste",
    });
    if (!clipboardMutation) return false;
    if (nextContent !== baseContent) {
      // Capture the exact immutable pre-paste document here, before the
      // optimistic cache/collab mirrors can advance independently. The
      // dedicated stack owns paste history in both single and overview
      // mode: generic Yjs/local history can be destroyed by a view switch
      // and cannot publish the authoritative clipboard generation on
      // undo. DOM insertion + every remapped managed rule stay in this
      // single before/after snapshot.
      clipboardPasteUndoStackRef.current = [
        ...clipboardPasteUndoStackRef.current.slice(
          -(MAX_DESIGN_UNDO_STACK - 1),
        ),
        {
          fileId: targetFileId,
          before: baseContent,
          after: nextContent,
        },
      ];
      clipboardPasteRedoStackRef.current = [];
      clearRedoStacks();
      syncUndoRedoState();
    }
    if (targetFileId === activeFile?.id) {
      applyLocalContentUpdate(nextContent, {
        forcePreviewFullDocument: true,
        clipboardMutation,
        recordHistory: false,
      });
      return true;
    }
    applyFileContentUpdate(targetFileId, nextContent, {
      forcePreviewFullDocument: true,
      clipboardMutation,
      recordHistory: false,
    });
    return true;
  };

  // Inside a frame, after an object — but always into normal flow: a
  // container is not a free canvas, so carrying the source's left/top
  // across drops the clone on top of the target's content.
  if (!position && targetFileId !== boardFileId && selectedElement?.selector) {
    const selector = selectedCanvasSelector ?? selectedElement.selector;
    const decision = resolvePastePlacementForSelection({
      content: baseContent,
      selectedElement,
    });
    const result = insertClonedHtmlLayers(baseContent, layerHtmls, {
      targetSelectors: [selector],
      placement: decision?.placement ?? "after",
      stripRootPosition: true,
      styleSnapshots,
      managedStyleSnapshots,
    });
    if (result) {
      pasteCascadeRef.current += 1;
      if (!applyPasteContentUpdate(result.content)) return;
      remapMotionTracksForClone(result.nodeIdMap, targetFileId);
      selectInsertedLayers(targetFileId, result.content, result.rootNodeIds);
      return;
    }
    // Fall through to position-based clone if insert failed.
  }

  // Explicit positions (e.g. "Paste here" at the cursor) are honored as-is.
  // Keyboard pastes land near the source layer and cascade so repeats don't
  // stack exactly.
  const sourcePositions = entries.map((entry) =>
    extractLayerPosition(entry.html),
  );
  const positionedSources = sourcePositions.filter(
    (source): source is { x: number; y: number } => Boolean(source),
  );
  const minSourceX = positionedSources.length
    ? Math.min(...positionedSources.map((source) => source.x))
    : 0;
  const minSourceY = positionedSources.length
    ? Math.min(...positionedSources.map((source) => source.y))
    : 0;
  const cascadeOffset = pasteCascadeRef.current * 16;
  // U16: reusing the raw source coordinates only makes sense when the
  // source screen is the one being pasted into — otherwise that source
  // screen may not even be visible in the current viewport (a different
  // active screen, or the source screen scrolled off in overview), and
  // the paste would land somewhere the user can't see. Fall back to the
  // current viewport's center in that case (same computation as the
  // U8 image-paste center).
  const pastingIntoSourceScreen = entries.every(
    (entry) => entry.sourceFileId === targetFileId,
  );
  const viewportCenter = (() => {
    if (viewModeRef.current === "single") {
      const iframe = canvasContainerRef.current?.querySelector<HTMLElement>(
        "[data-design-preview-iframe]",
      );
      if (iframe) {
        const iframeRect = iframe.getBoundingClientRect();
        const factor = zoom / 100;
        return {
          x: Math.max(0, iframeRect.width / 2 / factor),
          y: Math.max(0, iframeRect.height / 2 / factor),
        };
      }
    }
    const rect = canvasContainerRef.current?.getBoundingClientRect();
    return rect
      ? { x: Math.max(0, rect.width / 2), y: Math.max(0, rect.height / 2) }
      : { x: 120, y: 120 };
  })();
  const positions = entries.map((_, index) => {
    const source = sourcePositions[index];
    if (position) {
      return source && positionedSources.length
        ? {
            x: position.x + source.x - minSourceX,
            y: position.y + source.y - minSourceY,
          }
        : { x: position.x + index * 16, y: position.y + index * 16 };
    }
    return source && pastingIntoSourceScreen
      ? {
          x: source.x + 10 + cascadeOffset,
          y: source.y + 10 + cascadeOffset,
        }
      : {
          x: viewportCenter.x + cascadeOffset + index * 16,
          y: viewportCenter.y + cascadeOffset + index * 16,
        };
  });
  const result = insertClonedHtmlLayers(baseContent, layerHtmls, {
    positions,
    styleSnapshots,
    managedStyleSnapshots,
  });
  if (!result) return;
  if (!position) pasteCascadeRef.current += 1;
  if (!applyPasteContentUpdate(result.content)) return;
  remapMotionTracksForClone(result.nodeIdMap, targetFileId);
  selectInsertedLayers(targetFileId, result.content, result.rootNodeIds);
}
