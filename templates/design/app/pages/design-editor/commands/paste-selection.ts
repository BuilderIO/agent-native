import { buildCodeLayerProjection } from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";
import * as Y from "yjs";

import { trace } from "@/components/design/design-trace";
import { isShaderWriteInFlight } from "@/components/design/inspector/GlslShaderPanel";
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
  planLinkedComponentStructureClone,
  prepareClonedHtmlLayersForLiveInsert,
  portableStyleSnapshotForPasteTarget,
} from "@/pages/design-editor/clone-and-pen-edit";
import { codeLayerSelectorAliases } from "@/pages/design-editor/code-layer-state";
import type { CanvasLayerClipboardEntry } from "@/pages/design-editor/command-types";
import type { ApplyFileContentUpdateResult } from "@/pages/design-editor/commands/apply-file-content-update";
import type { ApplyLocalContentUpdateResult } from "@/pages/design-editor/commands/apply-local-content-update";
import {
  mapAcceptedSelectionNode,
  projectAcceptedSource,
} from "@/pages/design-editor/commands/selection-publication";
import {
  isStandaloneHttpUrl,
  type UndoRedoOrderKind,
} from "@/pages/design-editor/editor-state";
import type { ContentHistoryChange } from "@/pages/design-editor/history";
import {
  MAX_DESIGN_UNDO_STACK,
  type GeometryHistorySelection,
} from "@/pages/design-editor/history";
import {
  resolvePastePlacementForSelection,
  resolvePasteSourceAnchor,
} from "@/pages/design-editor/paste-placement";
import type { DesignFile } from "@/pages/design-editor/types";

import type { ApplyLinkedComponentEdit } from "./linked-component-structure";

const ORPHANED_PASTE_INSET = 24;

function isSelectedClipboardLayer(
  entries: ReadonlyArray<CanvasLayerClipboardEntry>,
  targetFileId: string,
  selectedNodeId: string | null | undefined,
) {
  return Boolean(
    selectedNodeId &&
    entries.every((entry) => entry.sourceFileId === targetFileId) &&
    entries.some((entry) => entry.rootNodeId === selectedNodeId),
  );
}

function offsetPositionsFromSource(
  sourcePositions: Array<{ x: number; y: number } | null>,
  cascadeOffset: number,
) {
  const positionedSources = sourcePositions.filter(
    (source): source is { x: number; y: number } => Boolean(source),
  );
  if (positionedSources.length !== sourcePositions.length) return undefined;
  return positionedSources.map((source) => ({
    x: source.x + 10 + cascadeOffset,
    y: source.y + 10 + cascadeOffset,
    space: "layout" as const,
  }));
}

function commonClipboardSourceParentNodeId(
  entries: ReadonlyArray<CanvasLayerClipboardEntry>,
  targetFileId: string,
) {
  const sourceParentNodeId = entries[0]?.sourceParentNodeId;
  if (
    !sourceParentNodeId ||
    !entries.every(
      (entry) =>
        entry.sourceFileId === targetFileId &&
        entry.sourceParentNodeId === sourceParentNodeId,
    )
  ) {
    return null;
  }
  return sourceParentNodeId;
}

export interface PasteSelectionArgs {
  activeFile: DesignFile;
  applyLinkedComponentEdit?: ApplyLinkedComponentEdit;
  designId: string | undefined;
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
  ) => ApplyFileContentUpdateResult;
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
  ) => ApplyLocalContentUpdateResult;
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
  historyOrderRef: RefObject<(UndoRedoOrderKind | "selection")[]>;
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
  selectionBefore?: GeometryHistorySelection;
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
    designId,
    applyLinkedComponentEdit,
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
    historyOrderRef,
    latestClipboardMutationContentRef,
    pasteCascadeRef,
    pasteCopiedScreens,
    pendingLocalFileContentsRef,
    publishAuthoritativeClipboardMutation,
    refreshClipboardFromSystemClipboard,
    remapMotionTracksForClone,
    selectionBefore,
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
  let structureUnsupported = false;
  const onUnsupportedStructure = () => {
    structureUnsupported = true;
    toast.error(
      t("designEditor.componentInstances.linkedStructureUnsupported"),
    );
  };
  undoManagerRef.current?.stopCapturing();
  await refreshClipboardFromSystemClipboard();
  const entries = getCanvasClipboardEntries();
  if (entries.length === 0) {
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
  const returnToSourceFileId =
    sourceAnchor &&
    activeSurfaceFileId === boardFileId &&
    sourceAnchor.fileId !== boardFileId
      ? sourceAnchor.fileId
      : null;
  const targetFileId = returnToSourceFileId ?? activeSurfaceFileId;
  if (!targetFileId || !canEditDesign) return;
  const targetFile = files.find((file) => file.id === targetFileId);
  const componentLinks = targetFile
    ? {
        sourceFileIds: entries.map((entry) => entry.sourceFileId),
        targetSource: {
          kind: "design-file" as const,
          designId,
          fileId: targetFile.id,
          filename: targetFile.filename,
        },
        documents: files.map((file) => ({
          source: {
            kind: "design-file" as const,
            designId,
            fileId: file.id,
            filename: file.filename,
          },
          content: getScreenContent(file.id),
        })),
      }
    : undefined;
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
  const pendingBase =
    pendingLocalFileContentsRef.current.get(targetFileId)?.content;
  const lineageBase =
    latestClipboardMutationContentRef.current.get(targetFileId)?.content;
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
  const styleSnapshots = entries.map((entry) =>
    portableStyleSnapshotForPasteTarget(entry, targetFileId),
  );
  if (styleSnapshots.some((snapshot) => snapshot === null)) {
    trace("structure", "paste-refused", {
      reason: "source appearance could not be captured for cross-file paste",
      targetFileId,
      entries: entries.length,
    });
    toast.error(t("designEditor.toasts.layerMoveFailed"), {
      duration: 4000,
    });
    return;
  }
  const managedStyleSnapshots = entries.map(
    (entry) => entry.managedStyleSnapshot,
  );
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
    const sourceParentNodeId =
      !position && !selectedAnchor
        ? commonClipboardSourceParentNodeId(entries, targetFileId)
        : null;
    const sourceParentAnchor = sourceParentNodeId
      ? { selector: "", sourceId: sourceParentNodeId }
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
    const selectedSourcePositions =
      selectedAnchor &&
      isSelectedClipboardLayer(entries, targetFileId, selectedAnchor.sourceId)
        ? offsetPositionsFromSource(sourcePositions, cascadeOffset)
        : undefined;
    const positions = selectedAnchor
      ? selectedSourcePositions
      : entries.map((_, index) => {
          const source = sourcePositions[index];
          if (position) {
            return source && positionedSources.length
              ? {
                  x: position.x + source.x - minSourceX,
                  y: position.y + source.y - minSourceY,
                  space: "visual" as const,
                }
              : {
                  x: position.x + index * 16,
                  y: position.y + index * 16,
                  space: "visual" as const,
                };
          }
          return source && pastingIntoSourceScreen
            ? {
                x: source.x + 10 + cascadeOffset,
                y: source.y + 10 + cascadeOffset,
                space: "layout" as const,
              }
            : {
                x: viewportCenter.x + cascadeOffset + index * 16,
                y: viewportCenter.y + cascadeOffset + index * 16,
                space: "visual" as const,
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
      anchor: selectedAnchor ?? sourceParentAnchor ?? { selector: "body" },
      placement: selectedAnchor ? "after" : "inside",
    });
    return;
  }
  const applyPasteContentUpdate = (
    nextContent: string,
  ): Extract<ApplyFileContentUpdateResult, { status: "accepted" }> | null => {
    if (isShaderWriteInFlight(targetFileId)) {
      toast.error(t("designEditor.toasts.saveConflict"), {
        id: `design-source-shader-conflict:${targetFileId}`,
      });
      return null;
    }
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
      return null;
    }
    const publication =
      targetFileId === activeFile?.id
        ? applyLocalContentUpdate(nextContent, {
            forcePreviewFullDocument: true,
            clipboardMutation,
            recordHistory: false,
          })
        : applyFileContentUpdate(targetFileId, nextContent, {
            forcePreviewFullDocument: true,
            clipboardMutation,
            recordHistory: false,
          });
    if (publication.status !== "accepted") {
      toast.error(t("designEditor.toasts.primitiveInsertFailed"), {
        duration: 4000,
      });
      return null;
    }
    if (nextContent !== baseContent) {
      clipboardPasteUndoStackRef.current = [
        ...clipboardPasteUndoStackRef.current.slice(
          -(MAX_DESIGN_UNDO_STACK - 1),
        ),
        {
          fileId: targetFileId,
          before: baseContent,
          after: publication.content,
        },
      ];
      clipboardPasteRedoStackRef.current = [];
      clearRedoStacks();
      historyOrderRef.current = [
        ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        "clipboard-paste",
      ];
      syncUndoRedoState();
    }
    return publication;
  };

  const dispatchLinkedClone = (
    options: Parameters<typeof insertClonedHtmlLayers>[2],
  ): boolean => {
    if (!applyLinkedComponentEdit) return false;
    if (isShaderWriteInFlight(targetFileId)) {
      toast.error(t("designEditor.toasts.saveConflict"), {
        id: `design-source-shader-conflict:${targetFileId}`,
      });
      return true;
    }
    const plan = planLinkedComponentStructureClone(
      baseContent,
      layerHtmls,
      options,
    );
    if (!plan) return false;
    applyLinkedComponentEdit(
      targetFileId,
      plan.targetNodeId,
      {
        kind: "structure",
        before: plan.mainBefore,
        after: plan.mainAfter,
        selectionNodeIds: plan.selectionNodeIds,
      },
      selectionBefore,
      () => remapMotionTracksForClone(plan.nodeIdMap, targetFileId),
    );
    return true;
  };

  const selectAcceptedInsertedLayers = (
    submittedContent: string,
    rootNodeIds: string[],
    publication: Extract<ApplyFileContentUpdateResult, { status: "accepted" }>,
  ) => {
    const source = { kind: "design-file" as const, fileId: targetFileId };
    const submittedProjection = buildCodeLayerProjection(submittedContent, {
      source,
    });
    const acceptedProjection = projectAcceptedSource(publication, source);
    const acceptedRootIds = rootNodeIds.flatMap((rootNodeId) => {
      const submittedNode = submittedProjection.nodes.find(
        (node) =>
          node.id === rootNodeId ||
          node.dataAttributes["data-agent-native-node-id"] === rootNodeId,
      );
      const acceptedNode = mapAcceptedSelectionNode(
        publication,
        acceptedProjection,
        submittedNode,
      );
      const acceptedRootId =
        acceptedNode?.dataAttributes["data-agent-native-node-id"];
      return acceptedRootId ? [acceptedRootId] : [];
    });
    if (acceptedRootIds.length === rootNodeIds.length) {
      selectInsertedLayers(targetFileId, publication.content, acceptedRootIds);
    }
  };

  if (
    !position &&
    !returnToSourceFileId &&
    targetFileId !== boardFileId &&
    selectedElement?.selector
  ) {
    const selector = selectedCanvasSelector ?? selectedElement.selector;
    const decision = resolvePastePlacementForSelection({
      content: baseContent,
      source: { kind: "design-file", fileId: targetFileId },
      selectedElement,
    });
    const sourceParentSelectors =
      sourceAnchor?.fileId === targetFileId
        ? sourceAnchor.parentSelectors
        : null;
    const pasteBackIntoSourceParent =
      decision?.placement === "after" &&
      sourceParentSelectors !== null &&
      isSelectedClipboardLayer(
        entries,
        targetFileId,
        selectedElement.runtimeSourceId ??
          selectedElement.sourceId ??
          selectedElement.id,
      );
    const selectedSourcePositions = pasteBackIntoSourceParent
      ? offsetPositionsFromSource(
          entries.map((entry) => extractLayerPosition(entry.html)),
          pasteCascadeRef.current * 16,
        )
      : undefined;
    const cloneOptions = {
      onUnsupportedStructure,
      targetSelectors: pasteBackIntoSourceParent
        ? (sourceParentSelectors ?? [selector])
        : [selector],
      placement: pasteBackIntoSourceParent
        ? "inside"
        : (decision?.placement ?? "after"),
      stripRootPosition: true,
      positions: selectedSourcePositions,
      styleSnapshots,
      managedStyleSnapshots,
      componentLinks,
    };
    if (dispatchLinkedClone(cloneOptions)) {
      pasteCascadeRef.current += 1;
      return;
    }
    const result = insertClonedHtmlLayers(
      baseContent,
      layerHtmls,
      cloneOptions,
    );
    if (structureUnsupported) return;
    if (result) {
      pasteCascadeRef.current += 1;
      const publication = applyPasteContentUpdate(result.content);
      if (!publication) return;
      remapMotionTracksForClone(result.nodeIdMap, targetFileId);
      selectAcceptedInsertedLayers(
        result.content,
        result.rootNodeIds,
        publication,
      );
      return;
    }
    // Fall through to position-based clone if insert failed.
  }

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
  const pastingIntoSourceScreen = entries.every(
    (entry) => entry.sourceFileId === targetFileId,
  );
  const sourceParentSelectors =
    sourceAnchor?.fileId === targetFileId ? sourceAnchor.parentSelectors : null;
  const pasteAfterOriginalSelectors =
    sourceParentSelectors && entries.length === 1 && entries[0]!.rootNodeId
      ? (() => {
          const rootNodeId = entries[0]!.rootNodeId!;
          const originalNode = buildCodeLayerProjection(baseContent).nodes.find(
            (node) =>
              node.dataAttributes["data-agent-native-node-id"] === rootNodeId ||
              node.id === rootNodeId,
          );
          return originalNode ? codeLayerSelectorAliases(originalNode) : null;
        })()
      : null;
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
            space: "visual" as const,
          }
        : {
            x: position.x + index * 16,
            y: position.y + index * 16,
            space: "visual" as const,
          };
    }
    if (rootFallbackPlacement) {
      return {
        x: ORPHANED_PASTE_INSET + cascadeOffset + index * 16,
        y: ORPHANED_PASTE_INSET + cascadeOffset + index * 16,
        space: "visual" as const,
      };
    }
    return source && pastingIntoSourceScreen
      ? {
          x: source.x + 10 + cascadeOffset,
          y: source.y + 10 + cascadeOffset,
          space: "layout" as const,
        }
      : {
          x: viewportCenter.x + cascadeOffset + index * 16,
          y: viewportCenter.y + cascadeOffset + index * 16,
          space: "visual" as const,
        };
  });
  const cloneOptions = {
    onUnsupportedStructure,
    positions,
    styleSnapshots,
    managedStyleSnapshots,
    componentLinks,
    ...(pasteAfterOriginalSelectors?.length
      ? {
          targetSelectors: pasteAfterOriginalSelectors,
          placement: "after" as const,
        }
      : sourceParentSelectors
        ? {
            targetSelectors: sourceParentSelectors,
            placement: "inside" as const,
          }
        : {}),
  };
  if (dispatchLinkedClone(cloneOptions)) {
    if (!position) pasteCascadeRef.current += 1;
    return;
  }
  const result = insertClonedHtmlLayers(baseContent, layerHtmls, cloneOptions);
  if (structureUnsupported) return;
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
  const publication = applyPasteContentUpdate(result.content);
  if (!publication) return;
  remapMotionTracksForClone(result.nodeIdMap, targetFileId);
  selectAcceptedInsertedLayers(result.content, result.rootNodeIds, publication);
}
