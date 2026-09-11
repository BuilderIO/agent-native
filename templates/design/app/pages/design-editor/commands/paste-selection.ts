import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";
import * as Y from "yjs";

import { trace } from "@/components/design/design-trace";
import { findCanvasIframeForScreen } from "@/components/design/multi-screen/iframe-targeting";
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
import {
  resolvePastePlacementForSelection,
  resolvePasteSourceAnchor,
} from "@/pages/design-editor/paste-placement";
import type { DesignFile } from "@/pages/design-editor/types";

/** Inset for a copy whose original parent is gone, so it lands on screen. */
const ORPHANED_PASTE_INSET = 24;

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
    baseSource?: "lineage" | "document";
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
  if (entries.length === 0) {
    // No layer-level clipboard content — fall back to whole-screen paste
    // (U6) when the clipboard instead carries copied screen snapshots.
    const screens = getCanvasScreenClipboardEntries();
    if (screens.length > 0 && canEditDesign) {
      pasteCopiedScreens(screens, position);
    }
    return;
  }
  const sourceAnchor = position
    ? null
    : resolvePasteSourceAnchor({ entries, getContent: getScreenContent });
  const activeSurfaceFileId =
    viewModeRef.current === "overview" && position && boardFileId
      ? boardFileId
      : activeFile?.id;
  // The board is an infinite canvas layer behind every screen, so a screen
  // layer dropped on it renders under a frame at coordinates no camera or
  // selection outline resolves. A keyboard paste goes back to its source.
  const returnToSourceFileId =
    sourceAnchor &&
    activeSurfaceFileId === boardFileId &&
    sourceAnchor.fileId !== boardFileId
      ? sourceAnchor.fileId
      : null;
  const targetFileId = returnToSourceFileId ?? activeSurfaceFileId;
  if (!targetFileId || !canEditDesign) return;
  if (!position && targetFileId === boardFileId && !sourceAnchor) {
    trace("structure", "paste-refused", {
      reason: "clipboard has no readable source file to return the copy to",
      targetFileId,
      entries: entries.length,
    });
    toast.error(t("designEditor.toasts.primitiveInsertFailed"), {
      duration: 4000,
    });
    return;
  }
  // The pending-local map is the synchronous write-through source for
  // same-task/repeated operations. React query/collab mirrors can lag one
  // render behind a just-completed paste even after its save is already
  // observable from another request; rebasing a second paste on that stale
  // mirror makes its history `before` skip the first clone, so one undo
  // removes both. Prefer the pending snapshot exactly like primitive and
  // cross-screen structure writes do elsewhere in this editor.
  const pendingBase =
    pendingLocalFileContentsRef.current.get(targetFileId)?.content;
  const lineageBase =
    latestClipboardMutationContentRef.current.get(targetFileId)?.content;
  // The lineage is NOT a content source: it advances only on a clipboard
  // mutation, so after a delete it still describes the pre-delete document
  // and rebasing there resurrects what was removed.
  const baseContent =
    pendingBase ??
    (targetFileId === activeFile?.id
      ? getFreshActiveContent()
      : (getScreenContent(targetFileId) ?? ""));
  trace("structure", "paste-base", {
    targetFileId,
    rebasedOn: pendingBase
      ? "pending-local"
      : targetFileId === activeFile?.id
        ? "fresh-active"
        : "screen-content",
    bytes: baseContent.length,
    lineageBytes: lineageBase?.length ?? null,
    entries: entries.length,
  });
  if (!baseContent && targetFileId !== boardFileId) {
    trace("structure", "paste-refused", {
      reason: "destination file has no readable content",
      targetFileId,
    });
    toast.error(t("designEditor.toasts.primitiveInsertFailed"), {
      duration: 4000,
    });
    return;
  }
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
      baseSource: "document",
    });
    if (!clipboardMutation) {
      trace("structure", "paste-refused", {
        reason: "clipboard lineage refused the publication",
        targetFileId,
      });
      toast.error(t("designEditor.toasts.primitiveInsertFailed"), {
        duration: 4000,
      });
      return false;
    }
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
  if (
    !position &&
    !returnToSourceFileId &&
    targetFileId !== boardFileId &&
    selectedElement?.selector
  ) {
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
  const sourceParentSelectors =
    sourceAnchor?.fileId === targetFileId ? sourceAnchor.parentSelectors : null;
  // The copy is going to the screen root because its parent is gone. Its
  // stored left/top belong to that parent, so reusing them can place it off
  // the screen entirely; a fixed inset is always somewhere the user can see.
  const rootFallbackPlacement =
    sourceAnchor !== null &&
    sourceAnchor.fileId === targetFileId &&
    sourceParentSelectors === null;
  const viewportCenter = (() => {
    const container = canvasContainerRef.current;
    const factor = zoom / 100;
    if (factor <= 0) return { x: 120, y: 120 };
    if (viewModeRef.current === "single") {
      const iframe = container?.querySelector<HTMLElement>(
        "[data-design-preview-iframe]",
      );
      if (iframe) {
        const iframeRect = iframe.getBoundingClientRect();
        return {
          x: Math.max(0, iframeRect.width / 2 / factor),
          y: Math.max(0, iframeRect.height / 2 / factor),
        };
      }
    }
    // The container's rect is screen pixels; left/top are document pixels.
    // Only the destination frame's own rect converts between them — the
    // board's cannot, because its iframe is a render window, not its origin.
    const frameRect =
      targetFileId !== boardFileId
        ? findCanvasIframeForScreen(
            container,
            targetFileId,
          )?.getBoundingClientRect()
        : null;
    const containerRect = container?.getBoundingClientRect();
    if (!frameRect || !containerRect) return { x: 120, y: 120 };
    const clamp = (value: number, extent: number) =>
      Math.max(0, Math.min(value, extent / factor));
    return {
      x: clamp(
        (containerRect.left + containerRect.width / 2 - frameRect.left) /
          factor,
        frameRect.width,
      ),
      y: clamp(
        (containerRect.top + containerRect.height / 2 - frameRect.top) / factor,
        frameRect.height,
      ),
    };
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
    if (rootFallbackPlacement) {
      return {
        x: ORPHANED_PASTE_INSET + cascadeOffset + index * 16,
        y: ORPHANED_PASTE_INSET + cascadeOffset + index * 16,
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
  const result = insertClonedHtmlLayers(baseContent, layerHtmls, {
    positions,
    styleSnapshots,
    managedStyleSnapshots,
    ...(sourceParentSelectors
      ? { targetSelectors: sourceParentSelectors, placement: "inside" as const }
      : {}),
  });
  if (!result) {
    trace("structure", "paste-refused", {
      reason: "destination document refused the clone",
      targetFileId,
      anchors: sourceParentSelectors?.length ?? 0,
    });
    toast.error(t("designEditor.toasts.primitiveInsertFailed"), {
      duration: 4000,
    });
    return;
  }
  if (!position) pasteCascadeRef.current += 1;
  if (!applyPasteContentUpdate(result.content)) return;
  remapMotionTracksForClone(result.nodeIdMap, targetFileId);
  selectInsertedLayers(targetFileId, result.content, result.rootNodeIds);
}
