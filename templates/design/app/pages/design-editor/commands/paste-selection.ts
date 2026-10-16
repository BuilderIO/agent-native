import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import { buildCodeLayerProjection } from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";
import * as Y from "yjs";

import { trace } from "@/components/design/design-trace";
import { isShaderWriteInFlight } from "@/components/design/inspector/GlslShaderPanel";
import { findCanvasIframeForScreen } from "@/components/design/multi-screen/iframe-targeting";
import type { VisibleCanvasRect } from "@/components/design/multi-screen/types";
import type {
  ElementInfo,
  PortableStyleSnapshot,
  RuntimeStructureInsertRequest,
} from "@/components/design/types";
import type {
  ClipboardContentLineage,
  ClipboardContentMutationOrigin,
  ClipboardContentMutationPublication,
} from "@/lib/clipboard-content-lineage";
import type { DesignClipboardManagedStyleSnapshot } from "@/lib/design-clipboard-managed-styles";
import type { DesignClipboardScreenEntry } from "@/lib/design-import";
import {
  extractLayerPosition,
  insertClonedHtmlLayers,
  planLinkedComponentStructureClone,
  prepareClonedHtmlLayersForLiveInsert,
  portableStyleSnapshotForPasteTarget,
  type CloneLayerPosition,
} from "@/pages/design-editor/clone-and-pen-edit";
import {
  codeLayerSelectorAliases,
  resolveCodeLayerNodeFromElementInfo,
} from "@/pages/design-editor/code-layer-state";
import type { CanvasLayerClipboardEntry } from "@/pages/design-editor/command-types";
import type { ApplyFileContentUpdateResult } from "@/pages/design-editor/commands/apply-file-content-update";
import type { ApplyLocalContentUpdateResult } from "@/pages/design-editor/commands/apply-local-content-update";
import { resolveViewPastePosition } from "@/pages/design-editor/commands/paste-view-position";
import {
  mapAcceptedSelectionNode,
  projectAcceptedSource,
} from "@/pages/design-editor/commands/selection-publication";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import {
  isStandaloneHttpUrl,
  type UndoRedoOrderKind,
} from "@/pages/design-editor/editor-state";
import type { ContentHistoryChange } from "@/pages/design-editor/history";
import {
  MAX_DESIGN_UNDO_STACK,
  type GeometryHistorySelection,
} from "@/pages/design-editor/history";
import { getAllScreenFrameEntries } from "@/pages/design-editor/overview-camera";
import {
  resolvePastePlacementForSelection,
  resolvePasteSourceAnchor,
} from "@/pages/design-editor/paste-placement";
import type { DesignFile } from "@/pages/design-editor/types";

import type { ApplyLinkedComponentEdit } from "./linked-component-structure";

const ORPHANED_PASTE_INSET = 24;

export interface PastedClipboardLayerSource {
  sourceFileId: string;
  rootNodeId: string;
}

interface PastePosition {
  x: number;
  y: number;
  // The file the point is local to; a point without one is on the board.
  fileId?: string;
}

export interface PreparedPasteVisualOffsetArgs {
  targetFileId: string;
  targetSelector?: string;
  placement: "before" | "after" | "inside";
  layerHtml: string;
  styleSnapshot?: PortableStyleSnapshot;
  managedStyleSnapshot?: DesignClipboardManagedStyleSnapshot;
}

type PreparedPasteVisualOffset = { x: number; y: number };

function pastedClipboardLayerSourceKey(
  targetFileId: string,
  generatedRootNodeId: string,
) {
  return JSON.stringify([targetFileId, generatedRootNodeId]);
}

function recordPastedClipboardLayerSources(
  ref: RefObject<Map<string, PastedClipboardLayerSource>> | undefined,
  targetFileId: string,
  generatedRootNodeIds: string[],
  entries: readonly CanvasLayerClipboardEntry[],
) {
  if (!ref) return;
  generatedRootNodeIds.forEach((generatedRootNodeId, index) => {
    const entry = entries[index];
    if (!entry?.sourceFileId || !entry.rootNodeId) return;
    ref.current.set(
      pastedClipboardLayerSourceKey(targetFileId, generatedRootNodeId),
      { sourceFileId: entry.sourceFileId, rootNodeId: entry.rootNodeId },
    );
  });
}

interface SelectedPastedClipboardLayer {
  entryIndex: number;
}

function directlyCopiedClipboardLayer(
  entries: readonly CanvasLayerClipboardEntry[],
  targetFileId: string,
  selectedNodeId: string | null | undefined,
) {
  return Boolean(
    selectedNodeId &&
    entries.every((entry) => entry.sourceFileId === targetFileId) &&
    entries.some(
      (entry) =>
        entry.sourceFileId === targetFileId &&
        entry.rootNodeId === selectedNodeId,
    ),
  );
}

function selectedPastedClipboardLayer(
  entries: readonly CanvasLayerClipboardEntry[],
  targetFileId: string,
  selectedTargetNodeIds: (string | null | undefined)[],
  pastedClipboardLayerSourcesRef:
    | RefObject<Map<string, PastedClipboardLayerSource>>
    | undefined,
): SelectedPastedClipboardLayer | undefined {
  if (!pastedClipboardLayerSourcesRef) return undefined;
  for (const nodeId of selectedTargetNodeIds) {
    if (!nodeId) continue;
    const source = pastedClipboardLayerSourcesRef.current.get(
      pastedClipboardLayerSourceKey(targetFileId, nodeId),
    );
    if (!source) continue;
    const entryIndex = entries.findIndex(
      (entry) =>
        entry.sourceFileId === source.sourceFileId &&
        entry.rootNodeId === source.rootNodeId,
    );
    if (entryIndex >= 0) return { entryIndex };
  }
  return undefined;
}

function isPixelPosition(
  left: string | undefined,
  top: string | undefined,
): { x: number; y: number } | null {
  const parse = (value: string | undefined) => {
    const match = value?.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))px$/i);
    if (!match) return null;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const x = parse(left);
  const y = parse(top);
  return x === null || y === null ? null : { x, y };
}

type ClipboardRepeatLayerLayout =
  | {
      kind: "flow";
      position: { x: number; y: number } | null;
      positionMode?: "relative";
      unknownPosition: boolean;
    }
  | { kind: "positioned"; position: { x: number; y: number } }
  | { kind: "unavailable" };

type ClipboardRepeatPositionedLayout =
  | Extract<ClipboardRepeatLayerLayout, { kind: "positioned" }>
  | (Extract<ClipboardRepeatLayerLayout, { kind: "flow" }> & {
      position: { x: number; y: number };
    });

function hasClipboardRepeatPosition(
  layout: ClipboardRepeatLayerLayout,
): layout is ClipboardRepeatPositionedLayout {
  return layout.kind !== "unavailable" && layout.position !== null;
}

function cloneLayerPositionForRepeat(
  layout: ClipboardRepeatPositionedLayout,
  x: number,
  y: number,
  modeOverride?: "absolute" | "relative",
): CloneLayerPosition {
  const positionMode =
    modeOverride ??
    (layout.kind === "flow" && layout.positionMode === "relative"
      ? "relative"
      : "absolute");
  return {
    x,
    y,
    space: "layout",
    ...(positionMode === "relative" ? { positionMode } : {}),
  };
}

function clipboardRepeatLayerLayout(args: {
  position?: string;
  left?: string;
  top?: string;
  unknownPosition?: boolean;
}): ClipboardRepeatLayerLayout {
  const position = args.position?.trim().toLowerCase();
  if (position === "absolute" || position === "fixed") {
    const coordinates = isPixelPosition(args.left, args.top);
    return coordinates
      ? { kind: "positioned", position: coordinates }
      : { kind: "unavailable" };
  }
  if (position === "relative") {
    return {
      kind: "flow",
      position: isPixelPosition(args.left, args.top),
      positionMode: "relative",
      unknownPosition: false,
    };
  }
  return {
    kind: "flow",
    position: null,
    unknownPosition: args.unknownPosition ?? false,
  };
}

function clipboardRepeatSourceLayout(
  entry: CanvasLayerClipboardEntry,
): ClipboardRepeatLayerLayout {
  if (typeof window === "undefined") return { kind: "unavailable" };
  try {
    const doc = new DOMParser().parseFromString(
      `<template>${entry.html}</template>`,
      "text/html",
    );
    const root = doc.querySelector("template")?.content
      .firstElementChild as HTMLElement | null;
    if (!root || entry.styleSnapshotCaptureFailed) {
      return { kind: "unavailable" };
    }
    const snapshotStyles = entry.portableStyleSnapshot?.nodes.find(
      (node) => node.path.length === 0,
    )?.styles;
    const position =
      root.style.getPropertyValue("position") || snapshotStyles?.position;
    const left = root.style.left || snapshotStyles?.left;
    const top = root.style.top || snapshotStyles?.top;
    const unknownPosition = !position;
    return clipboardRepeatLayerLayout({
      position,
      left,
      top,
      unknownPosition,
    });
  } catch {
    return { kind: "unavailable" };
  }
}

function clipboardRepeatSelectedCloneLayout(args: {
  html?: string;
  inlineStyles?: Record<string, string>;
}): ClipboardRepeatLayerLayout {
  if (args.html !== undefined) {
    if (typeof window === "undefined") return { kind: "unavailable" };
    try {
      const doc = new DOMParser().parseFromString(
        `<template>${args.html}</template>`,
        "text/html",
      );
      const root = doc.querySelector("template")?.content
        .firstElementChild as HTMLElement | null;
      if (!root) return { kind: "unavailable" };
      return clipboardRepeatLayerLayout({
        position: root.style.position,
        left: root.style.left,
        top: root.style.top,
        unknownPosition: !root.style.position,
      });
    } catch {
      return { kind: "unavailable" };
    }
  }
  return clipboardRepeatLayerLayout({
    position: args.inlineStyles?.position,
    left: args.inlineStyles?.left,
    top: args.inlineStyles?.top,
  });
}

function positionsFromSelectedClipboardClone(
  sourceLayouts: ClipboardRepeatLayerLayout[],
  selectedEntryIndex: number,
  selectedCloneLayout: ClipboardRepeatLayerLayout,
  cascadeOffset: number,
): Array<CloneLayerPosition | undefined> | null | undefined {
  if (selectedEntryIndex < 0 || selectedEntryIndex >= sourceLayouts.length) {
    return null;
  }
  if (
    sourceLayouts.some((layout) => layout.kind === "unavailable") ||
    selectedCloneLayout.kind === "unavailable"
  ) {
    return null;
  }
  const sourcePositions = sourceLayouts.map((layout) =>
    layout.kind === "unavailable" ? null : layout.position,
  );
  const hasSourcePosition = sourcePositions.some(Boolean);
  const unknownPositionInMixedRoots =
    hasSourcePosition &&
    sourceLayouts.some(
      (layout) => layout.kind === "flow" && layout.unknownPosition,
    );
  if (unknownPositionInMixedRoots) return null;
  const naturalFlowRoots = sourceLayouts.map(
    (layout) => layout.kind === "flow",
  );
  if (naturalFlowRoots.every(Boolean) && selectedCloneLayout.kind === "flow") {
    return undefined;
  }
  const selectedClonePosition = selectedCloneLayout.position;
  const selectedSourcePosition = sourcePositions[selectedEntryIndex];
  if (sourcePositions.every((source) => source === null)) {
    if (!naturalFlowRoots.every(Boolean)) return null;
    if (!selectedClonePosition) {
      return naturalFlowRoots[selectedEntryIndex] ? undefined : null;
    }
    if (
      !Number.isFinite(selectedClonePosition.x) ||
      !Number.isFinite(selectedClonePosition.y)
    ) {
      return null;
    }
    return sourcePositions.map((_, index) => ({
      x: selectedClonePosition.x + (index - selectedEntryIndex + 1) * 16,
      y: selectedClonePosition.y + (index - selectedEntryIndex + 1) * 16,
      space: "layout",
    }));
  }
  if (!selectedSourcePosition) {
    if (!naturalFlowRoots[selectedEntryIndex] || selectedClonePosition) {
      return null;
    }
    if (
      sourcePositions.some(
        (source, index) => !source && !naturalFlowRoots[index],
      )
    ) {
      return null;
    }
    return sourcePositions.map((source, index) => {
      const layout = sourceLayouts[index];
      if (!source || !layout || layout.kind !== "positioned") {
        return undefined;
      }
      return cloneLayerPositionForRepeat(
        layout,
        source.x + cascadeOffset,
        source.y + cascadeOffset,
      );
    });
  }
  if (
    !selectedClonePosition ||
    !Number.isFinite(selectedClonePosition.x) ||
    !Number.isFinite(selectedClonePosition.y) ||
    sourcePositions.some((source, index) => !source && !naturalFlowRoots[index])
  ) {
    return null;
  }
  const selectedFlowWasMoved =
    sourceLayouts[selectedEntryIndex]?.kind === "flow" &&
    (selectedClonePosition.x !== selectedSourcePosition.x ||
      selectedClonePosition.y !== selectedSourcePosition.y);
  const offsetX = selectedClonePosition.x - selectedSourcePosition.x + 16;
  const offsetY = selectedClonePosition.y - selectedSourcePosition.y + 16;
  return sourcePositions.map((source, index) => {
    const layout = sourceLayouts[index];
    if (!source || !layout || !hasClipboardRepeatPosition(layout)) {
      return undefined;
    }
    if (layout.kind === "flow" && !selectedFlowWasMoved) return undefined;
    return cloneLayerPositionForRepeat(
      layout,
      source.x + offsetX,
      source.y + offsetY,
      index === selectedEntryIndex && selectedCloneLayout.kind === "positioned"
        ? "absolute"
        : undefined,
    );
  });
}

function withPreparedVisualOffsets(
  positions: Array<CloneLayerPosition | null | undefined> | undefined,
  args: {
    getPreparedPasteVisualOffset?: (
      request: PreparedPasteVisualOffsetArgs,
    ) => PreparedPasteVisualOffset | null | undefined;
    targetFileId: string;
    targetSelector?: string;
    placement: "before" | "after" | "inside";
    layerHtmls: string[];
    styleSnapshots: Array<PortableStyleSnapshot | null | undefined>;
    managedStyleSnapshots: Array<
      DesignClipboardManagedStyleSnapshot | undefined
    >;
  },
): Array<CloneLayerPosition | null | undefined> | null | undefined {
  const { getPreparedPasteVisualOffset } = args;
  if (!positions || !getPreparedPasteVisualOffset) return positions;

  let invalidMeasurement = false;
  const measuredPositions = positions.map((position, index) => {
    if (!position || position.space !== "visual") return position;
    const visualOffset = getPreparedPasteVisualOffset({
      targetFileId: args.targetFileId,
      targetSelector: args.targetSelector,
      placement: args.placement,
      layerHtml: args.layerHtmls[index]!,
      styleSnapshot: args.styleSnapshots[index] ?? undefined,
      managedStyleSnapshot: args.managedStyleSnapshots[index],
    });
    if (visualOffset === null) {
      invalidMeasurement = true;
      return position;
    }
    if (visualOffset === undefined) return position;
    if (!Number.isFinite(visualOffset.x) || !Number.isFinite(visualOffset.y)) {
      invalidMeasurement = true;
      return position;
    }
    return {
      ...position,
      visualOffset: { x: visualOffset.x, y: visualOffset.y },
    };
  });

  return invalidMeasurement ? null : measuredPositions;
}

function nodeIdSelector(nodeId: string) {
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(nodeId)
      : nodeId.replace(/["\\]/g, "\\$&");
  return `[data-agent-native-node-id="${escaped}"]`;
}

function positionsFromSource(
  sourceLayouts: ClipboardRepeatLayerLayout[],
  cascadeOffset = 0,
) {
  if (cascadeOffset === 0) return undefined;
  if (
    sourceLayouts.some(
      (layout) =>
        layout.kind === "unavailable" ||
        (layout.kind === "flow" && layout.unknownPosition),
    )
  ) {
    return undefined;
  }
  return sourceLayouts.map((layout) =>
    layout.kind === "positioned"
      ? cloneLayerPositionForRepeat(
          layout,
          layout.position.x + cascadeOffset,
          layout.position.y + cascadeOffset,
        )
      : undefined,
  );
}

function commonClipboardSourceParentNodeId(
  entries: readonly CanvasLayerClipboardEntry[],
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
  canvasFrameGeometryById: CanvasFrameGeometryById;
  clearRedoStacks: () => void;
  clipboardPasteRedoStackRef: RefObject<ContentHistoryChange[]>;
  clipboardPasteUndoStackRef: RefObject<ContentHistoryChange[]>;
  files: DesignFile[];
  getCanvasClipboardEntries: () => CanvasLayerClipboardEntry[];
  getCanvasScreenClipboardEntries: () => DesignClipboardScreenEntry[];
  getFreshActiveContent: () => string;
  getPreparedPasteVisualOffset?: (
    request: PreparedPasteVisualOffsetArgs,
  ) => PreparedPasteVisualOffset | null | undefined;
  pastedClipboardLayerSourcesRef?: RefObject<
    Map<string, PastedClipboardLayerSource>
  >;
  getScreenContent: (screenId: string) => string;
  getVisibleCanvasRect: () => VisibleCanvasRect | null;
  historyOrderRef: RefObject<(UndoRedoOrderKind | "selection")[]>;
  latestClipboardMutationContentRef: RefObject<
    Map<string, ClipboardContentLineage>
  >;
  overviewScreens: OverviewScreen[];
  overviewSelectedScreenIds: readonly string[];
  pasteCascadeRef: RefObject<number>;
  pasteCopiedScreens: (
    screens: DesignClipboardScreenEntry[],
    position?: { x: number; y: number },
  ) => void;
  pendingLocalFileContentsRef: RefObject<
    Map<
      string,
      {
        content: string;
        startedAt: number;
        baseUpdatedAt?: string | null;
        deferCollabReconcile?: boolean;
      }
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
    canvasFrameGeometryById,
    clearRedoStacks,
    clipboardPasteRedoStackRef,
    clipboardPasteUndoStackRef,
    files,
    getCanvasClipboardEntries,
    getCanvasScreenClipboardEntries,
    getFreshActiveContent,
    getPreparedPasteVisualOffset,
    pastedClipboardLayerSourcesRef,
    getScreenContent,
    getVisibleCanvasRect,
    historyOrderRef,
    latestClipboardMutationContentRef,
    overviewScreens,
    overviewSelectedScreenIds,
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
  explicitPosition?: { x: number; y: number },
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
      pasteCopiedScreens(screens, explicitPosition);
    }
    return;
  }
  const viewPosition = explicitPosition
    ? null
    : resolveViewPastePosition({
        visibleRect:
          viewModeRef.current === "overview" ? getVisibleCanvasRect() : null,
        frames: getAllScreenFrameEntries({
          overviewScreens,
          canvasFrameGeometryById,
        }),
        boardFileId,
        sourceFileIds: entries.map((entry) => entry.sourceFileId),
        selectedFrameIds: [
          ...(selectedElement && activeFile ? [activeFile.id] : []),
          ...overviewSelectedScreenIds,
        ],
        cascadeOffset: pasteCascadeRef.current * 16,
      });
  if (viewPosition) {
    trace("structure", "paste-in-view", {
      targetFileId: viewPosition.fileId,
      sourceFileIds: entries.map((entry) => entry.sourceFileId),
    });
  }
  const position: PastePosition | undefined =
    explicitPosition ?? viewPosition ?? undefined;
  const sourceAnchor = position
    ? null
    : resolvePasteSourceAnchor({ entries, getContent: getScreenContent });
  const activeSurfaceFileId =
    position?.fileId ??
    (viewModeRef.current === "overview" && position && boardFileId
      ? boardFileId
      : activeFile?.id);
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
  const pendingBaseEntry =
    pendingLocalFileContentsRef.current.get(targetFileId);
  const pendingBase = pendingBaseEntry?.deferCollabReconcile
    ? undefined
    : pendingBaseEntry?.content;
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
              selectedElement.runtimeSelector ||
              selectedCanvasSelector ||
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
    const selectedPastedLayer = selectedAnchor
      ? selectedPastedClipboardLayer(
          entries,
          targetFileId,
          [selectedAnchor.sourceId],
          pastedClipboardLayerSourcesRef,
        )
      : undefined;
    const directlyCopiedAnchor = Boolean(
      selectedAnchor &&
      directlyCopiedClipboardLayer(
        entries,
        targetFileId,
        selectedAnchor.sourceId,
      ),
    );
    const selectedCloneLayout = selectedPastedLayer
      ? clipboardRepeatSelectedCloneLayout({
          inlineStyles: selectedElement?.inlineStyles,
        })
      : null;
    const selectedSourcePositions = selectedPastedLayer
      ? positionsFromSelectedClipboardClone(
          entries.map(clipboardRepeatSourceLayout),
          selectedPastedLayer.entryIndex,
          selectedCloneLayout ?? { kind: "unavailable" },
          cascadeOffset,
        )
      : directlyCopiedAnchor
        ? positionsFromSource(
            entries.map(clipboardRepeatSourceLayout),
            cascadeOffset,
          )
        : undefined;
    if (selectedSourcePositions === null) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), {
        duration: 4000,
      });
      return;
    }
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
          return source
            ? {
                x: source.x + cascadeOffset,
                y: source.y + cascadeOffset,
                space: "layout" as const,
              }
            : {
                x: viewportCenter.x + cascadeOffset + index * 16,
                y: viewportCenter.y + cascadeOffset + index * 16,
                space: "visual" as const,
              };
        });
    const preparedPositions = withPreparedVisualOffsets(positions, {
      getPreparedPasteVisualOffset,
      targetFileId,
      targetSelector:
        selectedAnchor?.selector ??
        (sourceParentNodeId ? nodeIdSelector(sourceParentNodeId) : "body"),
      placement: selectedAnchor ? "after" : "inside",
      layerHtmls,
      styleSnapshots,
      managedStyleSnapshots,
    });
    if (preparedPositions === null) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), {
        duration: 4000,
      });
      return;
    }
    const prepared = prepareClonedHtmlLayersForLiveInsert(
      targetStoredContent,
      layerHtmls,
      {
        stripRootPosition: Boolean(
          selectedAnchor && !selectedPastedLayer && !directlyCopiedAnchor,
        ),
        positions: preparedPositions,
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
    recordPastedClipboardLayerSources(
      pastedClipboardLayerSourcesRef,
      targetFileId,
      prepared.rootNodeIds,
      entries,
    );
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
      recordPastedClipboardLayerSources(
        pastedClipboardLayerSourcesRef,
        targetFileId,
        acceptedRootIds,
        entries,
      );
      selectInsertedLayers(targetFileId, publication.content, acceptedRootIds);
    }
  };

  if (
    !position &&
    !returnToSourceFileId &&
    targetFileId !== boardFileId &&
    selectedElement?.selector
  ) {
    const selector = selectedCanvasSelector || selectedElement.selector;
    const decision = resolvePastePlacementForSelection({
      content: baseContent,
      source: { kind: "design-file", fileId: targetFileId },
      selectedElement,
    });
    const selectedNode = resolveCodeLayerNodeFromElementInfo(
      buildCodeLayerProjection(baseContent),
      selectedElement,
    );
    const selectedNodeId =
      selectedElement.runtimeSourceId ??
      selectedElement.sourceId ??
      selectedElement.id;
    const selectedTargetNodeIds = [
      selectedNode?.dataAttributes["data-agent-native-node-id"],
      selectedElement.sourceLayerIdentity?.screenId === targetFileId
        ? selectedElement.sourceLayerIdentity.nodeId
        : undefined,
      selectedElement.runtimeSourceId,
      selectedElement.sourceId,
      selectedElement.id,
      selectedNode?.id,
    ];
    const directlySelectedClipboardRoot = directlyCopiedClipboardLayer(
      entries,
      targetFileId,
      selectedNodeId,
    );
    const selectedPastedLayer = selectedPastedClipboardLayer(
      entries,
      targetFileId,
      selectedTargetNodeIds,
      pastedClipboardLayerSourcesRef,
    );
    const selectedClipboardRoot =
      directlySelectedClipboardRoot || Boolean(selectedPastedLayer);
    const placement = selectedClipboardRoot
      ? "after"
      : (decision?.placement ?? "after");
    const insideFreeContainer =
      placement === "inside" &&
      selectedNode &&
      !selectedElement.isFlexContainer &&
      !selectedElement.isGridContainer &&
      !selectedNode.layout.isFlexContainer &&
      !selectedNode.layout.isGridContainer;
    const cascadeOffset = pasteCascadeRef.current * 16;
    const selectedCloneLayout =
      selectedPastedLayer && selectedNode?.source
        ? clipboardRepeatSelectedCloneLayout({
            html: baseContent.slice(
              selectedNode.source.start,
              selectedNode.source.end,
            ),
          })
        : selectedPastedLayer
          ? clipboardRepeatSelectedCloneLayout({
              inlineStyles: selectedElement?.inlineStyles,
            })
          : null;
    const selectedSourcePositions = selectedClipboardRoot
      ? selectedPastedLayer
        ? positionsFromSelectedClipboardClone(
            entries.map(clipboardRepeatSourceLayout),
            selectedPastedLayer.entryIndex,
            selectedCloneLayout ?? { kind: "unavailable" },
            cascadeOffset,
          )
        : positionsFromSource(
            entries.map(clipboardRepeatSourceLayout),
            cascadeOffset,
          )
      : insideFreeContainer
        ? entries.map((entry, index) => {
            const source = extractLayerPosition(entry.html);
            return {
              x: (source?.x ?? index * 16) + cascadeOffset,
              y: (source?.y ?? index * 16) + cascadeOffset,
              space: "layout" as const,
            };
          })
        : undefined;
    if (selectedSourcePositions === null) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), {
        duration: 4000,
      });
      return;
    }
    const cloneOptions = {
      onUnsupportedStructure,
      targetSelectors: [selector],
      placement,
      stripRootPosition: !selectedClipboardRoot,
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
    return source
      ? {
          x: source.x + cascadeOffset,
          y: source.y + cascadeOffset,
          space: "layout" as const,
        }
      : {
          x: viewportCenter.x + cascadeOffset + index * 16,
          y: viewportCenter.y + cascadeOffset + index * 16,
          space: "visual" as const,
        };
  });
  const visualTargetSelectors = pasteAfterOriginalSelectors?.length
    ? pasteAfterOriginalSelectors
    : sourceParentSelectors;
  const preparedPositions = withPreparedVisualOffsets(positions, {
    getPreparedPasteVisualOffset,
    targetFileId,
    targetSelector: visualTargetSelectors?.[0] ?? "body",
    placement: pasteAfterOriginalSelectors?.length ? "after" : "inside",
    layerHtmls,
    styleSnapshots,
    managedStyleSnapshots,
  });
  if (preparedPositions === null) {
    toast.error(t("designEditor.toasts.layerMoveFailed"), {
      duration: 4000,
    });
    return;
  }
  const cloneOptions = {
    onUnsupportedStructure,
    positions: preparedPositions,
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
    if (!explicitPosition) pasteCascadeRef.current += 1;
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
  if (!explicitPosition) pasteCascadeRef.current += 1;
  const publication = applyPasteContentUpdate(result.content);
  if (!publication) return;
  remapMotionTracksForClone(result.nodeIdMap, targetFileId);
  selectAcceptedInsertedLayers(result.content, result.rootNodeIds, publication);
}
