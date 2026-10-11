import { type CanvasFrameGeometry } from "@shared/canvas-frames";
import {
  applyVisualEdit,
  buildCodeLayerProjection,
  type CodeLayerNode,
  type CodeLayerSource,
} from "@shared/code-layer";
import type { SourceNodeProvenance } from "@shared/preview-source-provenance";
import { getResponsiveBreakpointHeightPx } from "@shared/responsive-frame-layout";
import { sourceContentHash } from "@shared/source-workspace";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { toast } from "sonner";

import { trace } from "@/components/design/design-trace";
import {
  getInitialFrameGeometry,
  getResponsiveScreenCullGeometry,
} from "@/components/design/multi-screen/frame-geometry";
import type { FrameGeometry } from "@/components/design/multi-screen/types";
import type {
  CanvasLayerHitCandidate,
  ElementInfo,
  PortableStyleSnapshot,
  RuntimeStructureDeleteRequest,
  RuntimeStructureRollbackRequest,
} from "@/components/design/types";
import { useViewSettings } from "@/hooks/use-view-settings";
import {
  type DesignHotkeyAlignEdge,
  type DesignHotkeyDistributeAxis,
} from "@/hooks/useDesignHotkeys";
import {
  DESIGN_HISTORY_OPEN_EVENT,
  DESIGN_UI_TOGGLE_EVENT,
} from "@/lib/design-ui-events";

import {
  applyAutoLayoutSuggestion,
  isExistingFlowLayout,
  type AutoLayoutSuggestion,
} from "../auto-layout-suggestion";
import {
  bridgeSourceIdForCodeLayerNode,
  codeLayerSelectorMatches,
  resolveCodeLayerNodeFromElementInfo,
} from "../code-layer-state";
import { runAddAutoLayout } from "../commands/add-auto-layout";
import {
  alignSelectionAvailability,
  runAlignSelection,
} from "../commands/align-selection";
import { runApplyLayoutFlow } from "../commands/apply-layout-flow";
import {
  releaseCrossScreenDropAdmission,
  resolveCrossScreenMoveFailureRecovery,
  runCrossScreenElementDrop,
} from "../commands/cross-screen-element-drop";
import {
  crossScreenSourceCancellationNeedsRetry,
  crossScreenRollbackAfterSourceCancellation,
  retryCrossScreenDeleteCancellation,
  scheduleCrossScreenDeleteTimeout,
  scheduleCrossScreenInsertTimeout,
} from "../commands/cross-screen-insert-timeout";
import { runDistributeSelection } from "../commands/distribute-selection";
import { runSuggestAutoLayout } from "../commands/suggest-auto-layout";
import { runTidyUp } from "../commands/tidy-up";
import {
  cloneCanvasFrameGeometry,
  getCanvasFrameGeometry,
} from "../design-data-geometry-utils";
import {
  BOARD_SURFACE_SIZE,
  DESIGN_EDITOR_DEBUG_LOGS,
} from "../editor-constants";
import { isAbsoluteCodeLayerNode } from "../html-layer-positioning";
import {
  type AlignableRect,
  authoredPxLength,
  computeOverlapReflowGeometry,
  mergeAuthoredAndLiveRect,
  type ReflowCandidate,
} from "../layout-operations";
import { measureFreeformGeometry } from "../measure-child-rects";
import { resolveOverviewScreenSourceType } from "../pending-edits";
import { buildActiveFileNodeIdSet } from "../selection-state";
import type { EditorActiveScreenAndGeometry } from "./use-editor-active-screen-and-geometry";
import type { EditorCanvasAndScreens } from "./use-editor-canvas-and-screens";
import type { EditorClipboard } from "./use-editor-clipboard";
import type { EditorContentAndComponents } from "./use-editor-content-and-components";
import type { EditorCore } from "./use-editor-core";
import type { EditorFilesAndSaving } from "./use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "./use-editor-generation-and-access";
import type { EditorHistory } from "./use-editor-history";
import type { EditorLiveEditsAndPresence } from "./use-editor-live-edits-and-presence";
import type { EditorScreenChangeHandlers } from "./use-editor-screen-change-handlers";
import type { EditorSelectionAndStyles } from "./use-editor-selection-and-styles";
import type { EditorToolsAndVectors } from "./use-editor-tools-and-vectors";

export function useEditorLayoutAndStructure({
  editorCore,
  editorHistory,
  editorGenerationAndAccess,
  editorFilesAndSaving,
  editorActiveScreenAndGeometry,
  editorCanvasAndScreens,
  editorLiveEditsAndPresence,
  editorContentAndComponents,
  editorToolsAndVectors,
  editorSelectionAndStyles,
  editorScreenChangeHandlers,
  editorClipboard,
}: {
  editorCore: EditorCore;
  editorHistory: EditorHistory;
  editorGenerationAndAccess: EditorGenerationAndAccess;
  editorFilesAndSaving: EditorFilesAndSaving;
  editorActiveScreenAndGeometry: EditorActiveScreenAndGeometry;
  editorCanvasAndScreens: EditorCanvasAndScreens;
  editorLiveEditsAndPresence: EditorLiveEditsAndPresence;
  editorContentAndComponents: EditorContentAndComponents;
  editorToolsAndVectors: EditorToolsAndVectors;
  editorSelectionAndStyles: EditorSelectionAndStyles;
  editorScreenChangeHandlers: EditorScreenChangeHandlers;
  editorClipboard: EditorClipboard;
}) {
  const {
    t,
    id,
    setMode,
    setActiveTool,
    viewMode,
    setViewMode,
    viewModeRef,
    selectedElement,
    setSelectedElement,
    selectedElementRef,
    runtimeStructureInsertRequest,
    runtimeStructurePendingTransactionRef,
    setRuntimeStructureInsertRequest,
    cancelPendingStructureVerification,
    activeFileId,
    setActiveFileId,
    activeFileIdRef,
    isSignedIn,
  } = editorCore;
  const {
    selectedLayerIdsState,
    setSelectedLayerIdsState,
    codeLayerOwnerByNodeIdRef,
    overviewSelectedScreenIds,
    setOverviewSelectedScreenIds,
    setCreatedOverviewLayerSelection,
    pendingOverviewScreenSelectionRef,
    pendingOverviewLayerSelectionRef,
    clearPendingOverviewLayerSelectionTimer,
    activeBreakpointWidthStateRef,
    contentUndoStackRef,
    selectedLayerIdsStateRef,
    overviewSelectedScreenIdsRef,
    explicitOverviewScreenSelectionRef,
    fileHistoryMutationPendingRef,
    clearPendingHistoryDirections,
    syncUndoRedoState,
    recordContentHistoryEntry,
  } = editorHistory;
  const {
    setDrawMode,
    setPinMode,
    canEditDesign,
    publicVisualEdit,
    canEditDesignRef,
    rawServerFilesByIdRef,
  } = editorGenerationAndAccess;
  const {
    fileSaveOperationRevisionRef,
    files,
    codeLayerSourceForScreen,
    runtimeLayerSnapshotsById,
    designSourceType,
    designDataJsonRef,
    boardFileId,
    overviewScreens,
  } = editorFilesAndSaving;
  const { handleGeometryCommit, activeFile, activeCanvasSourceType } =
    editorActiveScreenAndGeometry;
  const { getScreenContent, sendRuntimeLayerMoveSemanticHandoff } =
    editorCanvasAndScreens;
  const { activeCodeLayerProjection, canEditLiveScreen } =
    editorLiveEditsAndPresence;
  const {
    setUiHidden,
    contentHistorySelectionAfterRef,
    applyLocalContentUpdate,
    applyFileContentUpdate,
  } = editorContentAndComponents;
  const { runtimeStructureInsertRevisionRef } = editorToolsAndVectors;
  const {
    effectiveCodeLayerStateRef,
    setRepromptDraftRequest,
    getCodeLayerProjectionForScreen,
    handleScreenElementSelect,
    getFreshActiveContent,
  } = editorSelectionAndStyles;
  const { recordPendingLiveStructureEdit } = editorScreenChangeHandlers;
  const { sendRuntimeLayerSemanticHandoff } = editorClipboard;

  const [runtimeStructureDeleteRequest, setRuntimeStructureDeleteRequest] =
    useState<(RuntimeStructureDeleteRequest & { screenId: string }) | null>(
      null,
    );
  const [runtimeStructureRollbackRequest, setRuntimeStructureRollbackRequest] =
    useState<(RuntimeStructureRollbackRequest & { screenId: string }) | null>(
      null,
    );
  const runtimeStructureRollbackRevisionRef = useRef(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [autoLayoutSuggestionPreview, setAutoLayoutSuggestionPreview] =
    useState<{
      suggestion: AutoLayoutSuggestion;
      sourceType: "inline" | "localhost";
      contentHash: string;
      screenId: string;
    } | null>(null);

  const boardFrameGeometry = useMemo((): FrameGeometry | undefined => {
    if (!boardFileId) return undefined;
    const origin = -BOARD_SURFACE_SIZE / 2;
    return {
      x: origin,
      y: origin,
      width: BOARD_SURFACE_SIZE,
      height: BOARD_SURFACE_SIZE,
    };
  }, [boardFileId]);

  const liveElementForNode = useCallback(
    (node: CodeLayerNode): HTMLElement | null => {
      if (typeof document === "undefined") return null;
      const iframe = document.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      const doc = iframe?.contentDocument;
      if (!doc) return null;
      const stableId = node.dataAttributes["data-agent-native-node-id"];
      const selectors = [
        ...(stableId
          ? [`[data-agent-native-node-id="${CSS.escape(stableId)}"]`]
          : []),
        ...node.selectors,
        node.selector,
      ];
      for (const selector of selectors) {
        if (!selector) continue;
        try {
          const found = doc.querySelectorAll<HTMLElement>(selector);
          if (found.length === 1) return found[0]!;
        } catch {
          // coercion-ok: a projection selector may not be valid CSS
        }
      }
      return null;
    },
    [],
  );

  const liveBoxesForNode = useCallback(
    (
      node: CodeLayerNode,
    ): {
      self: { x: number; y: number; width: number; height: number } | null;
      parent: { width: number; height: number } | null;
    } | null => {
      const el = liveElementForNode(node);
      if (!el) return null;
      const parent = el.parentElement;
      const offsetParent = el.offsetParent;
      const size = { width: el.offsetWidth, height: el.offsetHeight };
      const self =
        offsetParent && parent
          ? offsetParent === parent
            ? { x: el.offsetLeft, y: el.offsetTop, ...size }
            : parent.offsetParent === offsetParent
              ? {
                  x: el.offsetLeft - parent.offsetLeft - parent.clientLeft,
                  y: el.offsetTop - parent.offsetTop - parent.clientTop,
                  ...size,
                }
              : null
          : null;
      return {
        self,
        parent:
          parent &&
          offsetParent === parent &&
          parent.clientWidth > 0 &&
          parent.clientHeight > 0
            ? { width: parent.clientWidth, height: parent.clientHeight }
            : null,
      };
    },
    [liveElementForNode],
  );

  const rectLiveFallbackForNode = useCallback(
    (node: CodeLayerNode) => liveBoxesForNode(node)?.self ?? null,
    [liveBoxesForNode],
  );

  const measureAlignParentBox = useCallback(
    (node: CodeLayerNode, parentNode: CodeLayerNode) => {
      const boxes = liveBoxesForNode(node);
      if (boxes) return boxes.parent;
      const width = authoredPxLength(parentNode.style.width);
      const height = authoredPxLength(parentNode.style.height);
      if (width === null || height === null) return null;
      return width > 0 && height > 0 ? { width, height } : null;
    },
    [liveBoxesForNode],
  );

  const liveComputedLayoutForNode = useCallback(
    (node: CodeLayerNode) => {
      const element = liveElementForNode(node);
      if (!element) return null;
      const computed =
        element.ownerDocument.defaultView?.getComputedStyle(element);
      if (!computed) return null;
      return {
        display: computed.display,
        transform: computed.transform,
        rotate: computed.rotate,
        scale: computed.scale,
      };
    },
    [liveElementForNode],
  );

  const rectFromCodeLayerNode = useCallback(
    (node: CodeLayerNode): AlignableRect => {
      const authoredX = authoredPxLength(node.style.left);
      const authoredY = authoredPxLength(node.style.top);
      const authoredWidth = authoredPxLength(node.style.width);
      const authoredHeight = authoredPxLength(node.style.height);
      const live =
        authoredX !== null &&
        authoredY !== null &&
        authoredWidth !== null &&
        authoredHeight !== null
          ? null
          : rectLiveFallbackForNode(node);
      return mergeAuthoredAndLiveRect({
        id: node.id,
        authored: {
          x: authoredX ?? undefined,
          y: authoredY ?? undefined,
          width: authoredWidth ?? undefined,
          height: authoredHeight ?? undefined,
        },
        live,
      });
    },
    [rectLiveFallbackForNode],
  );

  const getActiveFileSelectedNodeIds = useCallback(
    (content: string): string[] => {
      if (!activeFile?.id) return [];
      const fileIds = new Set(files.map((file) => file.id));
      const activeNodeIdSet = buildActiveFileNodeIdSet(
        buildCodeLayerProjection(content, {
          source: codeLayerSourceForScreen(activeFile.id),
        }),
      );
      return selectedLayerIdsState.filter(
        (layerId) =>
          !layerId.startsWith("__") &&
          !fileIds.has(layerId) &&
          activeNodeIdSet.has(layerId),
      );
    },
    [activeFile?.id, codeLayerSourceForScreen, files, selectedLayerIdsState],
  );

  const commitNodePositions = useCallback(
    (
      baseContent: string,
      positions: ReadonlyMap<string, { x: number; y: number }>,
      providedSource?: CodeLayerSource,
    ): boolean => {
      if (positions.size === 0 || !activeFile?.id) return false;
      if (providedSource && providedSource.fileId !== activeFile.id)
        return false;
      const source = providedSource ?? codeLayerSourceForScreen(activeFile.id);
      let content = baseContent;
      let appliedAny = false;
      for (const [nodeId, position] of positions) {
        const projection = buildCodeLayerProjection(content, { source });
        const node = projection.nodes.find((n) => n.id === nodeId);
        if (node && !isAbsoluteCodeLayerNode(node)) {
          const positionPatch = applyVisualEdit(
            content,
            {
              kind: "style",
              target: { nodeId },
              property: "position",
              value: "absolute",
            },
            { source },
          );
          if (positionPatch.result.status === "applied") {
            content = positionPatch.content;
          }
        }
        const leftPatch = applyVisualEdit(
          content,
          {
            kind: "style",
            target: { nodeId },
            property: "left",
            value: `${position.x}px`,
          },
          { source },
        );
        if (leftPatch.result.status !== "applied") continue;
        content = leftPatch.content;
        const topPatch = applyVisualEdit(
          content,
          {
            kind: "style",
            target: { nodeId },
            property: "top",
            value: `${position.y}px`,
          },
          { source },
        );
        if (topPatch.result.status !== "applied") continue;
        content = topPatch.content;
        appliedAny = true;
      }
      if (!appliedAny) return false;
      applyLocalContentUpdate(content, { forcePreviewFullDocument: true });
      return true;
    },
    [activeFile?.id, applyLocalContentUpdate, codeLayerSourceForScreen],
  );

  const handleApplyLayoutFlow = useCallback(
    (nodeId: string | null, containerStyles: Record<string, string>) => {
      const content = getFreshActiveContent();
      const selectedNodeIds = content
        ? getActiveFileSelectedNodeIds(content)
        : [];
      const selectedFileIds = new Set(files.map((file) => file.id));
      const selectableLayerIds = selectedLayerIdsState.filter(
        (layerId) => !layerId.startsWith("__") && !selectedFileIds.has(layerId),
      );
      if (
        selectableLayerIds.length > 1 &&
        selectedNodeIds.length !== selectableLayerIds.length
      ) {
        return "unsupported" as const;
      }
      const targetIds =
        selectedNodeIds.length > 0 ? selectedNodeIds : nodeId ? [nodeId] : [];
      return runApplyLayoutFlow(
        {
          applyLocalContentUpdate,
          canEditDesign,
          getFreshActiveContent,
          ...(activeFile?.id
            ? { source: codeLayerSourceForScreen(activeFile.id) }
            : {}),
          t,
        },
        targetIds,
        containerStyles,
      );
    },
    [
      applyLocalContentUpdate,
      canEditDesign,
      activeFile?.id,
      codeLayerSourceForScreen,
      files,
      getActiveFileSelectedNodeIds,
      getFreshActiveContent,
      selectedLayerIdsState,
      t,
    ],
  );

  const handleDisableAutoLayout = useCallback(
    (nodeId: string) => {
      if (!canEditDesign) return;
      if (!activeFile?.id) return;
      const baseContent = getFreshActiveContent();
      if (!baseContent) {
        trace("structure", "freeform-abandoned", {
          reason: "no active content",
          nodeId,
        });
        return;
      }
      const geometry = measureFreeformGeometry(nodeId);
      const patch = applyVisualEdit(
        baseContent,
        {
          kind: "autoLayout",
          targetId: nodeId,
          enabled: false,
          childRects: geometry.children,
          ...(geometry.container ? { containerRect: geometry.container } : {}),
        },
        { source: codeLayerSourceForScreen(activeFile.id) },
      );
      trace("structure", "freeform", {
        nodeId,
        measuredChildren: Object.keys(geometry.children).length,
        measuredContainer: geometry.container !== null,
        status: patch.result.status,
      });
      if (patch.result.status !== "applied") return;
      applyLocalContentUpdate(patch.content, {
        forcePreviewFullDocument: true,
      });
    },
    [
      activeFile?.id,
      applyLocalContentUpdate,
      canEditDesign,
      codeLayerSourceForScreen,
      getFreshActiveContent,
    ],
  );

  const handleAlignSelection = useCallback(
    (edge: DesignHotkeyAlignEdge) =>
      runAlignSelection(
        {
          activeFile,
          boardFileId,
          boardFrameGeometry,
          canEditDesign,
          commitNodePositions,
          designDataJsonRef,
          files,
          getActiveFileSelectedNodeIds,
          getFreshActiveContent,
          handleGeometryCommit,
          measureAlignParentBox,
          overviewScreens,
          overviewSelectedScreenIds,
          rectFromCodeLayerNode,
          selectedElement,
          selectedLayerIdsState,
          viewModeRef,
        },
        edge,
      ),
    [
      activeFile,
      boardFileId,
      boardFrameGeometry,
      canEditDesign,
      commitNodePositions,
      getActiveFileSelectedNodeIds,
      getFreshActiveContent,
      handleGeometryCommit,
      measureAlignParentBox,
      overviewScreens,
      overviewSelectedScreenIds,
      selectedLayerIdsState,
      rectFromCodeLayerNode,
    ],
  );

  const alignAvailability = useMemo(
    () =>
      alignSelectionAvailability({
        canEditDesign,
        fileIds: files.map((file) => file.id),
        measureAlignParentBox,
        overviewSelectedScreenIds,
        resolveNodesById: () =>
          new Map(
            activeCodeLayerProjection.nodes.map((node) => [node.id, node]),
          ),
        selectedElement,
        selectedLayerIds: selectedLayerIdsState,
        viewMode,
      }),
    [
      activeCodeLayerProjection,
      canEditDesign,
      files,
      measureAlignParentBox,
      overviewSelectedScreenIds,
      selectedElement,
      selectedLayerIdsState,
      viewMode,
    ],
  );

  const handleDistributeSelection = useCallback(
    (axis: DesignHotkeyDistributeAxis) =>
      runDistributeSelection(
        {
          activeFile,
          boardFileId,
          boardFrameGeometry,
          canEditDesign,
          commitNodePositions,
          designDataJsonRef,
          getActiveFileSelectedNodeIds,
          getFreshActiveContent,
          handleGeometryCommit,
          overviewScreens,
          overviewSelectedScreenIds,
          rectFromCodeLayerNode,
          viewModeRef,
        },
        axis,
      ),
    [
      activeFile,
      boardFileId,
      boardFrameGeometry,
      canEditDesign,
      commitNodePositions,
      getActiveFileSelectedNodeIds,
      getFreshActiveContent,
      handleGeometryCommit,
      overviewScreens,
      overviewSelectedScreenIds,
      rectFromCodeLayerNode,
    ],
  );

  const getScreenGroupFootprint = useCallback(
    (
      screenId: string,
      geometry: CanvasFrameGeometry,
      breakpointWidthsOverride?: readonly number[],
    ): { x: number; y: number; width: number; height: number } => {
      const x = geometry.x ?? 0;
      const y = geometry.y ?? 0;
      const width = geometry.width ?? 0;
      const height = geometry.height ?? 0;
      const screen = overviewScreens.find((item) => item.id === screenId);
      if (!screen) return { x, y, width, height };
      return getResponsiveScreenCullGeometry(
        {
          id: screenId,
          metadata: {
            width: screen.width ?? width,
            height: screen.height ?? height,
          },
          breakpointWidths: breakpointWidthsOverride ?? screen.breakpointWidths,
        },
        { x, y, width, height, rotation: geometry.rotation },
        (widthPx) =>
          getResponsiveBreakpointHeightPx(
            { breakpointHeights: screen.breakpointHeights },
            widthPx,
          ),
      );
    },
    [overviewScreens],
  );

  const reflowOverviewScreensForBreakpoints = useCallback(
    (breakpointWidths: readonly number[]) => {
      if (!canEditDesignRef.current) return;
      const before = getCanvasFrameGeometry(designDataJsonRef.current);
      const candidates: ReflowCandidate[] = overviewScreens.map(
        (screen, index) => {
          const geometry = {
            ...getInitialFrameGeometry(index, {
              width: screen.width ?? 1280,
              height: screen.height ?? 2560,
            }),
            ...before[screen.id],
          };
          const footprint = getScreenGroupFootprint(
            screen.id,
            geometry,
            breakpointWidths,
          );
          return {
            id: screen.id,
            geometry,
            footprint: {
              id: screen.id,
              x: footprint.x,
              y: footprint.y,
              width: footprint.width,
              height: footprint.height,
            },
          };
        },
      );
      const reflowed = computeOverlapReflowGeometry(candidates);
      if (reflowed.size === 0) return;
      const after = cloneCanvasFrameGeometry(before);
      reflowed.forEach((geometry, screenId) => {
        after[screenId] = { ...after[screenId], ...geometry };
      });
      handleGeometryCommit(before, after);
    },
    [getScreenGroupFootprint, handleGeometryCommit, overviewScreens],
  );

  const handleTidyUp = useCallback(
    () =>
      runTidyUp({
        activeFile,
        boardFileId,
        boardFrameGeometry,
        canEditDesign,
        commitNodePositions,
        designDataJsonRef,
        getActiveFileSelectedNodeIds,
        getFreshActiveContent,
        getScreenGroupFootprint,
        handleGeometryCommit,
        overviewScreens,
        overviewSelectedScreenIds,
        rectFromCodeLayerNode,
        viewModeRef,
      }),
    [
      activeFile,
      boardFileId,
      boardFrameGeometry,
      canEditDesign,
      commitNodePositions,
      getActiveFileSelectedNodeIds,
      getFreshActiveContent,
      getScreenGroupFootprint,
      handleGeometryCommit,
      overviewScreens,
      overviewSelectedScreenIds,
      rectFromCodeLayerNode,
    ],
  );

  const canSuggestAutoLayout = useMemo(() => {
    if (!canEditDesign || !activeFile || viewMode !== "single") return false;
    const resolvedSourceType = activeCanvasSourceType ?? designSourceType;
    if (resolvedSourceType !== "inline" && resolvedSourceType !== "localhost") {
      return false;
    }
    const sourceContent =
      resolvedSourceType === "localhost"
        ? runtimeLayerSnapshotsById[activeFile.id]?.html
        : getFreshActiveContent();
    if (!sourceContent) return false;
    const projection = buildCodeLayerProjection(sourceContent, {
      source: codeLayerSourceForScreen(activeFile.id),
    });
    const selectedIds = getActiveFileSelectedNodeIds(sourceContent);
    if (selectedIds.length !== 1) return false;
    const container = projection.nodes.find(
      (node) => node.id === selectedIds[0],
    );
    const computedLayout = container
      ? liveComputedLayoutForNode(container)
      : null;
    return Boolean(
      container &&
      container.children.length > 0 &&
      !isExistingFlowLayout({
        display: container.style.display,
        computedDisplay: computedLayout?.display,
        classes: container.classes,
      }),
    );
  }, [
    activeCanvasSourceType,
    activeFile,
    canEditDesign,
    codeLayerSourceForScreen,
    designSourceType,
    getActiveFileSelectedNodeIds,
    getFreshActiveContent,
    liveComputedLayoutForNode,
    runtimeLayerSnapshotsById,
    viewMode,
  ]);

  const handleSuggestAutoLayout = useCallback(
    () =>
      runSuggestAutoLayout({
        activeCanvasSourceType,
        activeFile,
        canEditDesign,
        designSourceType,
        getActiveFileSelectedNodeIds,
        getFreshActiveContent,
        liveComputedLayoutForNode,
        rectFromCodeLayerNode,
        runtimeLayerSnapshotsById,
        setAutoLayoutSuggestionPreview,
        t,
        viewModeRef,
      }),
    [
      activeCanvasSourceType,
      activeFile,
      canEditDesign,
      designSourceType,
      getActiveFileSelectedNodeIds,
      getFreshActiveContent,
      liveComputedLayoutForNode,
      rectFromCodeLayerNode,
      runtimeLayerSnapshotsById,
      t,
    ],
  );

  const handleApplyAutoLayoutSuggestion = useCallback(() => {
    const preview = autoLayoutSuggestionPreview;
    if (!preview) return;
    const currentContent =
      preview.sourceType === "localhost"
        ? runtimeLayerSnapshotsById[preview.screenId]?.html
        : getFreshActiveContent();
    if (
      !currentContent ||
      sourceContentHash(currentContent) !== preview.contentHash
    ) {
      toast.error(t("designEditor.autoLayoutSuggestion.stale"));
      setAutoLayoutSuggestionPreview(null);
      return;
    }

    if (preview.sourceType === "localhost") {
      const proposal = preview.suggestion;
      sendRuntimeLayerSemanticHandoff("auto-layout", [proposal.containerId], {
        desiredChange: `Apply the user-reviewed auto-layout proposal atomically: ${proposal.direction} flow; child source order ${proposal.orderedChildIds.join(", ")}; ${proposal.gap}px gap; padding ${proposal.padding.top}px ${proposal.padding.right}px ${proposal.padding.bottom}px ${proposal.padding.left}px; align-items ${proposal.alignItems}; justify-content ${proposal.justifyContent}; horizontal sizing ${proposal.horizontalSizing}; vertical sizing ${proposal.verticalSizing}. Preserve nested absolute-positioned descendants and unrelated responsive behavior.`,
        description: "apply the reviewed auto-layout suggestion",
        commandContext:
          "The user previewed and explicitly approved this measured geometry proposal. Make one source transaction so undo restores the exact prior structure.",
      });
      setAutoLayoutSuggestionPreview(null);
      return;
    }

    const result = applyAutoLayoutSuggestion(
      currentContent,
      preview.suggestion,
      codeLayerSourceForScreen(preview.screenId),
    );
    if (result.status !== "applied") {
      toast.error(t("designEditor.autoLayoutSuggestion.stale"));
      setAutoLayoutSuggestionPreview(null);
      return;
    }
    applyLocalContentUpdate(result.content, {
      forcePreviewFullDocument: true,
    });
    setAutoLayoutSuggestionPreview(null);
  }, [
    applyLocalContentUpdate,
    autoLayoutSuggestionPreview,
    codeLayerSourceForScreen,
    getFreshActiveContent,
    runtimeLayerSnapshotsById,
    sendRuntimeLayerSemanticHandoff,
    t,
  ]);

  const handleAddAutoLayout = useCallback(
    () =>
      runAddAutoLayout({
        activeFile,
        applyFileContentUpdate,
        applyLocalContentUpdate,
        canEditDesign,
        codeLayerOwnerByNodeIdRef,
        designSourceType,
        effectiveCodeLayerStateRef,
        files,
        getActiveFileSelectedNodeIds,
        getFreshActiveContent,
        getScreenContent,
        overviewScreens,
        overviewSelectedScreenIds,
        rectFromCodeLayerNode,
        runtimeLayerSnapshotsById,
        selectedElement,
        selectedLayerIdsState,
        sendRuntimeLayerSemanticHandoff,
        setSelectedElement,
        setSelectedLayerIdsState,
        t,
        viewModeRef,
      }),
    [
      activeFile,
      applyFileContentUpdate,
      applyLocalContentUpdate,
      canEditDesign,
      designSourceType,
      getActiveFileSelectedNodeIds,
      getFreshActiveContent,
      getScreenContent,
      overviewScreens,
      overviewSelectedScreenIds,
      rectFromCodeLayerNode,
      runtimeLayerSnapshotsById,
      selectedElement,
      selectedLayerIdsState,
      sendRuntimeLayerSemanticHandoff,
      t,
    ],
  );

  const handleToggleUi = useCallback(() => {
    setUiHidden((current) => !current);
  }, []);

  useEffect(() => {
    window.addEventListener(DESIGN_UI_TOGGLE_EVENT, handleToggleUi);
    return () =>
      window.removeEventListener(DESIGN_UI_TOGGLE_EVENT, handleToggleUi);
  }, [handleToggleUi]);

  useEffect(() => {
    const openHistory = () => setHistoryOpen(true);
    window.addEventListener(DESIGN_HISTORY_OPEN_EVENT, openHistory);
    return () =>
      window.removeEventListener(DESIGN_HISTORY_OPEN_EVENT, openHistory);
  }, []);

  const {
    settings: viewSettings,
    update: updateViewSettings,
    toggle: toggleViewSetting,
  } = useViewSettings({ enabled: isSignedIn });
  const { commentsHidden } = viewSettings;
  const showComments = useCallback(
    () => updateViewSettings({ commentsHidden: false }),
    [updateViewSettings],
  );

  const openRepromptComposer = useCallback(
    (screenId: string, info: ElementInfo, breakpointWidthPx?: number) => {
      if (!id || !canEditDesign) return;
      const screen = overviewScreens.find(
        (candidate) => candidate.id === screenId,
      );
      if (
        !screen ||
        resolveOverviewScreenSourceType(screen, designSourceType) !== "inline"
      ) {
        return;
      }
      const projection = getCodeLayerProjectionForScreen(screenId);
      const node = projection
        ? resolveCodeLayerNodeFromElementInfo(projection, info)
        : null;
      const stableNodeId =
        node?.dataAttributes["data-agent-native-node-id"]?.trim() ?? node?.id;
      const selector = node?.selector ?? info.selector;
      if (!stableNodeId && !selector) return;

      handleScreenElementSelect(screenId, info, undefined, {
        persistPendingNodeId: false,
        breakpointWidthPx,
      });
      showComments();
      viewModeRef.current = "overview";
      setActiveFileId(screenId);
      setOverviewSelectedScreenIds([screenId]);
      setViewMode("overview");
      setActiveTool("comment");
      setMode("annotate");
      setPinMode(true);
      setDrawMode(false);
      setRepromptDraftRequest({
        nonce: Date.now() + Math.random(),
        fileId: screenId,
        target: {
          ...(stableNodeId ? { nodeId: stableNodeId } : {}),
          ...(selector ? { selector } : {}),
        },
      });
    },
    [
      canEditDesign,
      designSourceType,
      getCodeLayerProjectionForScreen,
      handleScreenElementSelect,
      id,
      overviewScreens,
      showComments,
    ],
  );

  const handleContextMenuReprompt = useCallback(() => {
    const screenId = activeFile?.id ?? activeFileId;
    if (!screenId || !selectedElement) return;
    openRepromptComposer(
      screenId,
      selectedElement,
      activeBreakpointWidthStateRef.current,
    );
  }, [activeFile?.id, activeFileId, openRepromptComposer, selectedElement]);

  const handleContextMenuRepromptLayer = useCallback(
    (candidate: CanvasLayerHitCandidate) => {
      const screenId = candidate.screenId ?? activeFile?.id ?? activeFileId;
      if (!screenId) return;
      openRepromptComposer(
        screenId,
        candidate.info,
        candidate.breakpointWidthPx,
      );
    },
    [activeFile?.id, activeFileId, openRepromptComposer],
  );
  const handleToggleComments = useCallback(() => {
    toggleViewSetting("commentsHidden");
  }, [toggleViewSetting]);

  const handleCrossScreenElementDrop = useCallback(
    (arg0: {
      sourceSelector: string;
      sourceNodeId?: string;
      sourceDeleteRequestId?: string;
      sourceProvenance?: SourceNodeProvenance;
      targetAnchorProvenance?: SourceNodeProvenance;
      sourceScreenId: string;
      targetScreenId: string;
      targetAnchorNodeId?: string;
      targetAnchorPendingNodeId?: string;
      targetAnchorSelector?: string;
      targetAnchorPlacement?: "before" | "after" | "inside";
      targetDropMode?: "flow-insert" | "absolute-container";
      targetGridPlacement?: {
        column: number;
        columnEnd: number;
        row: number;
        rowEnd: number;
      };
      targetAnchorRect?: {
        left: number;
        top: number;
        width: number;
        height: number;
      };
      targetCanvasPoint?: { x: number; y: number };
      targetLocalPoint?: { x: number; y: number };
      sourcePointerOffset?: { x: number; y: number };
      sourceComputedSize?: { width?: number; height?: number };
      sourceHtmlSnapshot?: string;
      duplicate?: boolean;
      sourceCloneHtml?: string;
      styleSnapshot?: PortableStyleSnapshot;
      styleSnapshotCaptureFailed?: boolean;
    }) => {
      const movedSourceId =
        arg0.sourceProvenance?.uniqueNodeId?.trim() ||
        arg0.sourceNodeId?.trim() ||
        undefined;
      const movedSourceSelector = arg0.sourceSelector.trim() || undefined;
      const sourceOwners = Array.from(
        codeLayerOwnerByNodeIdRef.current.entries(),
      ).filter(([, owner]) => owner.fileId === arg0.sourceScreenId);
      const sourceIdMatches = movedSourceId
        ? sourceOwners.filter(
            ([, owner]) =>
              bridgeSourceIdForCodeLayerNode(owner.node).trim() ===
              movedSourceId,
          )
        : [];
      const selectorMatches = movedSourceSelector
        ? sourceOwners.filter(([, owner]) =>
            codeLayerSelectorMatches(owner.node, movedSourceSelector),
          )
        : [];
      const movedSourceMatches =
        sourceIdMatches.length === 1
          ? sourceIdMatches
          : selectorMatches.length === 1
            ? selectorMatches
            : [];
      const movedSourceSelection = {
        movedSourceId,
        sourceIdMatches,
        movedSourceOwner: movedSourceMatches[0]?.[1],
        movedSourceLayerIds: new Set(
          movedSourceMatches.map(([layerId]) => layerId),
        ),
      };

      return runCrossScreenElementDrop(
        {
          applyFileContentUpdate,
          boardFileId,
          canEditDesign,
          canEditLiveScreen,
          canEditLiveBoard: canEditDesign || publicVisualEdit,
          clearPendingOverviewLayerSelectionTimer,
          codeLayerOwnerByNodeIdRef,
          clearPendingHistory: clearPendingHistoryDirections,
          contentUndoStackRef,
          contentHistorySelectionAfterRef,
          designSourceType,
          fileHistoryMutationPendingRef,
          fileSaveOperationRevisionRef,
          getCurrentFileSnapshot: (fileId) => {
            const file = rawServerFilesByIdRef.current.get(fileId);
            return {
              content: file?.content ?? "",
              updatedAt: file?.updatedAt,
            };
          },
          getCurrentSelectionFingerprint: () => {
            const selectedElement = selectedElementRef.current;
            const selectedElementSourceScreenId =
              selectedElement?.sourceLayerIdentity?.screenId?.trim() ||
              undefined;
            const selectedElementBelongsToSource =
              selectedElementSourceScreenId !== undefined &&
              selectedElementSourceScreenId === arg0.sourceScreenId;
            const selectedMovedSource =
              selectedElement !== null &&
              selectedElementBelongsToSource &&
              movedSourceSelection.movedSourceOwner !== undefined &&
              (movedSourceSelection.sourceIdMatches.length === 1
                ? selectedElement.sourceId?.trim() === movedSourceId
                : codeLayerSelectorMatches(
                    movedSourceSelection.movedSourceOwner.node,
                    selectedElement.selector,
                  ));
            const selectedLayerIds = selectedLayerIdsStateRef.current.filter(
              (layerId) => {
                const owner = codeLayerOwnerByNodeIdRef.current.get(layerId);
                if (owner) {
                  return !movedSourceSelection.movedSourceLayerIds.has(layerId);
                }
                return !selectedMovedSource;
              },
            );
            return JSON.stringify({
              activeFileId: activeFileIdRef.current,
              selectedLayerIds,
              overviewSelectedScreenIds: overviewSelectedScreenIdsRef.current,
              selectedElement:
                selectedElement && !selectedMovedSource
                  ? {
                      id: selectedElement.id ?? null,
                      selector: selectedElement.selector ?? null,
                      sourceId: selectedElement.sourceId ?? null,
                    }
                  : null,
              viewMode: viewModeRef.current,
            });
          },
          getScreenContent,
          id,
          overviewScreens,
          pendingOverviewLayerSelectionRef,
          pendingOverviewScreenSelectionRef,
          recordContentHistoryEntry,
          syncUndoRedoState,
          runtimeStructureInsertRevisionRef,
          runtimeStructurePendingTransactionRef,
          sendRuntimeLayerMoveSemanticHandoff,
          clearExplicitOverviewScreenSelection: () => {
            explicitOverviewScreenSelectionRef.current = [];
          },
          setActiveFileId,
          setCreatedOverviewLayerSelection,
          setOverviewSelectedScreenIds,
          setRuntimeStructureInsertRequest,
          setRuntimeStructureDeleteRequest,
          setSelectedElement,
          setSelectedLayerIdsState,
          t,
          viewModeRef,
        },
        arg0,
      );
    },
    [
      applyFileContentUpdate,
      boardFileId,
      canEditDesign,
      canEditLiveScreen,
      publicVisualEdit,
      clearPendingHistoryDirections,
      clearPendingOverviewLayerSelectionTimer,
      getScreenContent,
      id,
      recordContentHistoryEntry,
      sendRuntimeLayerMoveSemanticHandoff,
      syncUndoRedoState,
      designSourceType,
      overviewScreens,
      setRuntimeStructureDeleteRequest,
      t,
    ],
  );

  const handleRuntimeStructureInsertRejected = useCallback(
    (reason: string, transactionId?: string) => {
      if (reason.startsWith("verification-")) {
        releaseCrossScreenDropAdmission(
          runtimeStructurePendingTransactionRef,
          transactionId,
        );
        cancelPendingStructureVerification("conflict");
        toast.error(t("designEditor.pendingVisualStyles.conflictToast"));
        return false;
      }
      if (DESIGN_EDITOR_DEBUG_LOGS) {
        console.warn("[design] runtime structure insert rejected", { reason });
      }
      if (transactionId) {
        runtimeStructureRollbackRevisionRef.current += 1;
        const recovery = resolveCrossScreenMoveFailureRecovery({
          reason,
          transactionId,
          insertRequest: runtimeStructureInsertRequest,
          sourceDeleteRequest: runtimeStructureDeleteRequest,
          rollbackRequestId: `${transactionId}:recovery-rollback:${runtimeStructureRollbackRevisionRef.current}`,
          pendingTransactionRef: runtimeStructurePendingTransactionRef,
        });
        if (recovery.rollbackRequest) {
          setRuntimeStructureRollbackRequest(recovery.rollbackRequest);
        } else if (
          runtimeStructureRollbackRequest?.transactionId === transactionId
        ) {
          setRuntimeStructureRollbackRequest(null);
        }
        setRuntimeStructureInsertRequest((current) =>
          current?.transactionId === transactionId ? null : current,
        );
        const sourceDeleteRequest = recovery.sourceDeleteRequest;
        if (sourceDeleteRequest !== undefined) {
          setRuntimeStructureDeleteRequest((current) =>
            current?.transactionId === transactionId
              ? sourceDeleteRequest
              : current,
          );
        }
        toast.error(t("designEditor.toasts.layerMoveFailed"), {
          duration: 4000,
        });
        return Boolean(
          recovery.rollbackRequest ||
          recovery.sourceDeleteRequest?.cancelRequested,
        );
      }
      toast.error(t("designEditor.toasts.layerMoveFailed"), { duration: 4000 });
      return false;
    },
    [
      cancelPendingStructureVerification,
      runtimeStructurePendingTransactionRef,
      runtimeStructureInsertRequest,
      runtimeStructureRollbackRequest,
      runtimeStructureDeleteRequest,
      setRuntimeStructureDeleteRequest,
      setRuntimeStructureInsertRequest,
      setRuntimeStructureRollbackRequest,
      t,
    ],
  );

  useEffect(() => {
    if (!runtimeStructureInsertRequest?.transactionId) return;
    return scheduleCrossScreenInsertTimeout(
      runtimeStructureInsertRequest,
      boardFileId ?? null,
      (transactionId) =>
        handleRuntimeStructureInsertRejected(
          "cross-screen-insert-timeout",
          transactionId,
        ),
    );
  }, [
    boardFileId,
    handleRuntimeStructureInsertRejected,
    runtimeStructureInsertRequest,
  ]);

  const handleRuntimeStructureInsertApplied = useCallback(
    (details: {
      requestId: string;
      transactionId?: string;
      routePath?: string;
      selector: string;
      sourceId?: string;
      applied?: boolean;
    }) => {
      const request = runtimeStructureInsertRequest;
      if (!request || !details.selector) return;
      const requestMatches = request.transactionId
        ? request.transactionId === details.transactionId
        : Number.isFinite(Number(details.requestId)) &&
          Math.floor(Number(details.requestId)) === request.requestId;
      if (!requestMatches) return;
      if (details.applied === false) {
        setRuntimeStructureDeleteRequest((current) =>
          current?.transactionId === request.transactionId ? null : current,
        );
        setRuntimeStructureInsertRequest((current) =>
          current?.transactionId === request.transactionId &&
          current?.requestId === request.requestId
            ? null
            : current,
        );
        releaseCrossScreenDropAdmission(
          runtimeStructurePendingTransactionRef,
          request.transactionId,
        );
        return;
      }
      recordPendingLiveStructureEdit(
        request.screenId,
        details.selector,
        request.anchor.selector,
        request.placement,
        undefined,
        {
          sourceId: details.sourceId,
          anchorSourceId: request.anchor.sourceId ?? undefined,
          routePath: details.routePath,
          insertedHtml: request.html,
          remintCollidingNodeIds: request.remintCollidingNodeIds,
          requestId: details.requestId,
          transactionId: request.transactionId,
          gridPlacement: request.gridPlacement,
        },
      );
      if (request.transactionId) {
        setRuntimeStructureDeleteRequest((current) =>
          current && current.transactionId === request.transactionId
            ? {
                ...current,
                waitForInsertTransaction: false,
                rollbackSelector: details.selector,
                rollbackSourceId: details.sourceId,
              }
            : current,
        );
      }
      setRuntimeStructureInsertRequest((current) =>
        current?.transactionId === request.transactionId &&
        current?.requestId === request.requestId
          ? null
          : current,
      );
      if (
        request.transactionId &&
        runtimeStructureDeleteRequest?.transactionId !==
          request.transactionId &&
        runtimeStructurePendingTransactionRef.current === request.transactionId
      ) {
        runtimeStructurePendingTransactionRef.current = null;
      }
    },
    [
      recordPendingLiveStructureEdit,
      runtimeStructureDeleteRequest,
      runtimeStructureInsertRequest,
      runtimeStructurePendingTransactionRef,
    ],
  );

  const handleRuntimeStructureDeleteApplied = useCallback(
    (details: {
      screenId?: string;
      requestId: string;
      selector: string;
      sourceId?: string;
      routePath?: string;
      info?: ElementInfo;
    }) => {
      const screenId = details.screenId;
      const request = runtimeStructureDeleteRequest;
      if (
        !screenId ||
        !request ||
        request.cancelRequested ||
        request.screenId !== screenId ||
        request.requestId !== details.requestId
      ) {
        return;
      }
      recordPendingLiveStructureEdit(
        screenId,
        details.selector,
        "",
        "after",
        details.info,
        {
          sourceId: details.sourceId,
          requestId: details.requestId,
          transactionId: request.transactionId,
          routePath: details.routePath,
          removed: true,
        },
      );
      if (
        request.transactionId &&
        runtimeStructurePendingTransactionRef.current === request.transactionId
      ) {
        releaseCrossScreenDropAdmission(
          runtimeStructurePendingTransactionRef,
          request.transactionId,
        );
      }
      setRuntimeStructureDeleteRequest(null);
    },
    [
      recordPendingLiveStructureEdit,
      runtimeStructureDeleteRequest,
      runtimeStructurePendingTransactionRef,
    ],
  );
  const handleRuntimeStructureDeleteRejected = useCallback(
    (details: {
      screenId?: string;
      requestId: string;
      transactionId?: string;
      reason: string;
      sourcePresent?: boolean;
    }) => {
      const request = runtimeStructureDeleteRequest;
      if (
        !request ||
        !details.screenId ||
        request.screenId !== details.screenId ||
        request.requestId !== details.requestId
      ) {
        return;
      }
      if (request.cancelRequested) {
        const retrySourceCancellation = () => {
          const retryRequest = retryCrossScreenDeleteCancellation(request);
          setRuntimeStructureDeleteRequest((current) =>
            current?.transactionId === request.transactionId &&
            current?.requestId === request.requestId
              ? retryRequest
              : current,
          );
        };
        if (crossScreenSourceCancellationNeedsRetry(details)) {
          retrySourceCancellation();
          return;
        }
        if (
          runtimeStructureRollbackRequest?.transactionId ===
          request.transactionId
        ) {
          setRuntimeStructureDeleteRequest((current) =>
            current?.transactionId === request.transactionId ? null : current,
          );
          return;
        }
        const recoveryRollbackRequest =
          crossScreenRollbackAfterSourceCancellation(
            request,
            true,
            `${request.transactionId}:recovery-rollback:${runtimeStructureRollbackRevisionRef.current + 1}`,
          );
        setRuntimeStructureDeleteRequest((current) =>
          current?.transactionId === request.transactionId ? null : current,
        );
        if (recoveryRollbackRequest) {
          runtimeStructureRollbackRevisionRef.current += 1;
          setRuntimeStructureRollbackRequest(recoveryRollbackRequest);
          return;
        }
        releaseCrossScreenDropAdmission(
          runtimeStructurePendingTransactionRef,
          request.transactionId,
        );
        if (request.rollbackSelector) {
          toast.error(t("designEditor.toasts.layerMoveFailed"), {
            duration: 4000,
          });
        }
        return;
      }
      const transactionId = request.transactionId;
      let recovery:
        | ReturnType<typeof resolveCrossScreenMoveFailureRecovery>
        | undefined;
      if (transactionId) {
        runtimeStructureRollbackRevisionRef.current += 1;
        recovery = resolveCrossScreenMoveFailureRecovery({
          reason: details.reason,
          transactionId,
          insertRequest: runtimeStructureInsertRequest,
          sourceDeleteRequest: request,
          rollbackRequestId: `${transactionId}:rollback:${runtimeStructureRollbackRevisionRef.current}`,
          pendingTransactionRef: runtimeStructurePendingTransactionRef,
        });
        if (recovery.rollbackRequest) {
          setRuntimeStructureRollbackRequest(recovery.rollbackRequest);
        }
        const sourceDeleteRequest = recovery.sourceDeleteRequest;
        if (sourceDeleteRequest !== undefined) {
          setRuntimeStructureDeleteRequest((current) =>
            current?.transactionId === transactionId
              ? sourceDeleteRequest
              : current,
          );
        }
      } else {
        setRuntimeStructureDeleteRequest(null);
      }
      if (DESIGN_EDITOR_DEBUG_LOGS) {
        console.warn("[design] runtime structure delete rejected", details);
      }
      if (details.reason !== "cancelled") {
        toast.error(t("designEditor.toasts.layerMoveFailed"), {
          duration: 4000,
        });
      }
    },
    [
      runtimeStructureDeleteRequest,
      runtimeStructureRollbackRequest,
      runtimeStructurePendingTransactionRef,
      runtimeStructureInsertRequest,
      setRuntimeStructureDeleteRequest,
      setRuntimeStructureRollbackRequest,
      t,
    ],
  );
  useEffect(() => {
    const deleteRequest = runtimeStructureDeleteRequest;
    if (
      runtimeStructureRollbackRequest?.transactionId &&
      runtimeStructureRollbackRequest.transactionId ===
        deleteRequest?.transactionId
    ) {
      return;
    }
    return scheduleCrossScreenDeleteTimeout(
      deleteRequest,
      boardFileId ?? null,
      (request) =>
        handleRuntimeStructureDeleteRejected({
          screenId: request.screenId,
          requestId: request.requestId,
          transactionId: request.transactionId,
          reason: "source-delete-timeout",
        }),
    );
  }, [
    boardFileId,
    handleRuntimeStructureDeleteRejected,
    runtimeStructureDeleteRequest,
    runtimeStructureRollbackRequest,
  ]);

  return {
    runtimeStructureDeleteRequest,
    setRuntimeStructureDeleteRequest,
    runtimeStructureRollbackRequest,
    setRuntimeStructureRollbackRequest,
    runtimeStructureRollbackRevisionRef,
    historyOpen,
    setHistoryOpen,
    autoLayoutSuggestionPreview,
    setAutoLayoutSuggestionPreview,
    boardFrameGeometry,
    handleContextMenuReprompt,
    handleContextMenuRepromptLayer,
    getActiveFileSelectedNodeIds,
    handleApplyLayoutFlow,
    handleDisableAutoLayout,
    handleAlignSelection,
    alignAvailability,
    handleDistributeSelection,
    reflowOverviewScreensForBreakpoints,
    handleTidyUp,
    canSuggestAutoLayout,
    handleSuggestAutoLayout,
    handleApplyAutoLayoutSuggestion,
    handleAddAutoLayout,
    handleToggleUi,
    commentsHidden,
    viewSettings,
    updateViewSettings,
    toggleViewSetting,
    showComments,
    handleToggleComments,
    handleCrossScreenElementDrop,
    handleRuntimeStructureInsertRejected,
    handleRuntimeStructureInsertApplied,
    handleRuntimeStructureDeleteApplied,
    handleRuntimeStructureDeleteRejected,
  };
}

export type EditorLayoutAndStructure = ReturnType<
  typeof useEditorLayoutAndStructure
>;
