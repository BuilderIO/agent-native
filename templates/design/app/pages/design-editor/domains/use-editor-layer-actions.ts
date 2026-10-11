import { agentNativePath } from "@agent-native/core/client/api-path";
import { type CodeLayerNode, type CodeLayerTreeNode } from "@shared/code-layer";
import type { InteractionState } from "@shared/interaction-states";
import { isRunningAppSourceType } from "@shared/source-mode";
import { useState, useCallback, useRef, useMemo } from "react";

import { type LayersPanelMoveIntent } from "@/components/design/LayersPanel";
import {
  getInitialFrameGeometry,
  reorderCanonicalScreenStack,
} from "@/components/design/multi-screen/frame-geometry";
import {
  designPreviewWindowsForScreen,
  requestSelectionMeasurement,
} from "@/components/design/multi-screen/measure-selection";
import type {
  MultiScreenCanvasProps,
  CanvasLayerMarqueeSelection,
  GradientEditOverlayTarget,
} from "@/components/design/multi-screen/types";
import type {
  ElementInfo,
  ElementSelectionIntent,
} from "@/components/design/types";

import {
  bridgeSourceIdForCodeLayerNode,
  elementInfoFromCodeLayerNode,
  findCodeLayerSiblingOrder,
  preferredCodeLayerSelector,
} from "../code-layer-state";
import { runCanMoveLayer } from "../commands/can-move-layer";
import { runLayerMarqueeSelectionChange } from "../commands/layer-marquee-selection-change";
import { runLayerMove } from "../commands/layer-move";
import { runLayerMoveToScreen } from "../commands/layer-move-to-screen";
import { runLayerRename } from "../commands/layer-rename";
import { runLayerSelectionChange } from "../commands/layer-selection-change";
import { runSendRuntimeLayerStateSemanticHandoff } from "../commands/send-runtime-layer-state-semantic-handoff";
import { runToggleLayerHidden } from "../commands/toggle-layer-hidden";
import { runToggleLayerLocked } from "../commands/toggle-layer-locked";
import {
  cloneCanvasFrameGeometry,
  getCanvasFrameGeometry,
} from "../design-data-geometry-utils";
import {
  buildSignInHrefForDesignIntent,
  samePlainData,
} from "../editor-helpers";
import { getLocalhostRouteSourceFile } from "../editor-state";
import { getBodyInlineStyles } from "../html-layer-positioning";
import { deriveStatePreviewTarget } from "../pending-edits";
import {
  measurePositionCoordinateContext,
  positionCoordinateRenderOffsetForWindow,
} from "../position-coordinate-context";
import {
  isScreenRootElementInfo,
  resolveMarqueeAdditive,
  sameStringIds,
} from "../selection-state";
import type { EditorActiveScreenAndGeometry } from "./use-editor-active-screen-and-geometry";
import type { EditorCanvasAndScreens } from "./use-editor-canvas-and-screens";
import type { EditorClipboard } from "./use-editor-clipboard";
import type { EditorContentAndComponents } from "./use-editor-content-and-components";
import type { EditorCore } from "./use-editor-core";
import type { EditorEditCommands } from "./use-editor-edit-commands";
import type { EditorFilesAndSaving } from "./use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "./use-editor-generation-and-access";
import type { EditorHistory } from "./use-editor-history";
import type { EditorLayerModels } from "./use-editor-layer-models";
import type { EditorLayoutAndStructure } from "./use-editor-layout-and-structure";
import type { EditorLiveEditsAndPresence } from "./use-editor-live-edits-and-presence";
import type { EditorSelectionAndStyles } from "./use-editor-selection-and-styles";
import type { EditorToolsAndVectors } from "./use-editor-tools-and-vectors";

function readRenderedLayerInfo(
  owner: {
    fileId: string;
    node: CodeLayerNode;
  },
  breakpointWidth?: number,
  boardFileId?: string,
): ElementInfo | null {
  const base = elementInfoFromCodeLayerNode(owner.node);
  for (const preview of designPreviewWindowsForScreen(
    owner.fileId,
    breakpointWidth,
    boardFileId,
  )) {
    try {
      const element = preview.document.querySelector(
        preferredCodeLayerSelector(owner.node),
      );
      if (!element) continue;
      const computed = preview.getComputedStyle(element);
      const parent = element.parentElement;
      const renderOffset = positionCoordinateRenderOffsetForWindow(preview);
      if (!renderOffset) continue;
      const positionCoordinateContext = measurePositionCoordinateContext(
        element,
        preview,
        renderOffset,
      );
      const parentComputed = parent
        ? preview.getComputedStyle(parent)
        : undefined;
      const rect = element.getBoundingClientRect();
      const parentRect = parent?.getBoundingClientRect();
      const scrollX = preview.scrollX || preview.pageXOffset || 0;
      const scrollY = preview.scrollY || preview.pageYOffset || 0;
      if (rect.width <= 0 || rect.height <= 0) continue;
      return {
        ...base,
        sourceLayerIdentity: { screenId: owner.fileId, nodeId: owner.node.id },
        computedStyles: {
          ...base.computedStyles,
          position: computed.position,
          zIndex: computed.zIndex,
        },
        boundingRect: {
          x: rect.x + scrollX,
          y: rect.y + scrollY,
          width: rect.width,
          height: rect.height,
        },
        parentBoundingRect: parentRect
          ? {
              x: parentRect.x + scrollX,
              y: parentRect.y + scrollY,
              width: parentRect.width,
              height: parentRect.height,
            }
          : undefined,
        ...positionCoordinateContext,
        ...(parentComputed
          ? {
              parentDisplay: parentComputed.display,
              parentLayout: {
                ...base.parentLayout,
                display: parentComputed.display,
              },
            }
          : {}),
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "SecurityError") {
        continue;
      }
      throw error;
    }
  }
  return null;
}

export function useEditorLayerActions({
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
  editorClipboard,
  editorLayoutAndStructure,
  editorEditCommands,
  editorLayerModels,
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
  editorClipboard: EditorClipboard;
  editorLayoutAndStructure: EditorLayoutAndStructure;
  editorEditCommands: EditorEditCommands;
  editorLayerModels: EditorLayerModels;
}) {
  const {
    t,
    id,
    isSignedIn,
    queryClient,
    setMode,
    setActiveTool,
    viewMode,
    setViewMode,
    viewModeRef,
    selectedElement,
    setSelectedElement,
    selectedElementRef,
    setRuntimeStructureInsertRequest,
    liveRoutePathsByScreenIdRef,
    setHoveredElement,
    activeFileId,
    setActiveFileId,
  } = editorCore;
  const {
    pendingVisualStyleEdits,
    setActiveLeftPanel,
    setExpandedLayerIds,
    selectedLayerIdsState,
    setSelectedLayerIdsState,
    renderedElementInfoByLayerKeyRef,
    renderedElementInfoRevisionRef,
    rehydrateRenderedElementInfoRef,
    codeLayerOwnerByNodeIdRef,
    overviewSelectedScreenIds,
    setOverviewSelectedScreenIds,
    setCreatedOverviewLayerSelection,
    pendingOverviewScreenSelectionRef,
    pendingOverviewLayerSelectionRef,
    hasActiveSelectionRef,
    clearPendingOverviewLayerSelectionTimer,
    lockedLayerIds,
    hiddenLayerIds,
    applyLayerStatePreview,
    activeBreakpointWidthState,
    activeBreakpointWidthStateRef,
    activeInteractionStateState,
    focusDesignInspectorForSelection,
    contentUndoStackRef,
    selectedLayerIdsStateRef,
    explicitOverviewScreenSelectionRef,
    recordContentHistoryEntry,
    recordLocalContentHistoryEntry,
  } = editorHistory;
  const {
    lastMarqueeSelectionSignatureRef,
    recordSelectionHistoryAroundChange,
    recordMarqueeSelectionHistoryAroundChange,
    design,
    canEditDesign,
    canEditLiveScreens,
    renameScreenMutation,
  } = editorGenerationAndAccess;
  const {
    serverFiles,
    files,
    liveScreenSnapshotsById,
    runtimeLayerSnapshotsById,
    designSourceType,
    designDataJsonRef,
    boardFileId,
    boardFileIdRef,
    overviewScreens,
    updateLiveScreenSnapshotContent,
  } = editorFilesAndSaving;
  const {
    handleGeometryCommit,
    activeFile,
    activeOverviewScreen,
    activeCanvasSourceType,
  } = editorActiveScreenAndGeometry;
  const {
    localhostConnectionRootPathByIdRef,
    setHoveredElementScreenId,
    setOverviewClearSelectionRequest,
    handleAddScreen,
    activeContent,
    getScreenContent,
    recordPendingLiveLayerStateEdit,
    sendRuntimeLayerMoveSemanticHandoff,
  } = editorCanvasAndScreens;
  const {
    selectedElementLayerId,
    selectedCanvasSelectorCandidates,
    selectedCanvasSelector,
    liveScreenIds,
    canEditLiveScreen,
    syncLiveScreenSnapshotPreview,
    remapMotionTracksForClone,
  } = editorLiveEditsAndPresence;
  const { contentHistorySelectionAfterRef, applyFileContentUpdate } =
    editorContentAndComponents;
  const {
    runtimeStructureInsertRevisionRef,
    selectionRevisionRef,
    handleOverviewScreenSelectionChange,
  } = editorToolsAndVectors;
  const {
    getCodeLayerProjectionForScreen,
    applyLinkedComponentEdit,
    getFreshActiveContent,
    handleStyleChange,
    handleFrameSelection,
  } = editorSelectionAndStyles;
  const {
    handleCopySelection,
    handlePasteToReplace,
    handleDuplicateSelection,
    handleDeleteSelection,
    handleGroupSelection,
    handleUngroupSelection,
  } = editorClipboard;
  const { setRuntimeStructureDeleteRequest, getActiveFileSelectedNodeIds } =
    editorLayoutAndStructure;
  const {
    setRuntimeStructureMoveRequest,
    runtimeStructureMoveRevisionRef,
    setRuntimeLayerRenameRequest,
    handleFlipHorizontal,
    handleFlipVertical,
    changeSelectedZIndex,
  } = editorEditCommands;
  const {
    codeLayerOwnerByNodeId,
    effectiveCodeLayerState,
    visualScreenFileIds,
    canonicalOverviewScreenIds,
    selectedLayerIds,
    canEditSelectedLiveLayer,
  } = editorLayerModels;

  const runtimeLayerRenameRevisionRef = useRef(0);
  const layerSelectionHydrationRevisionRef = useRef(0);
  const handleSignInToSave = useCallback(() => {
    window.location.href = buildSignInHrefForDesignIntent("save");
  }, []);
  const [publishWaitlistJoined, setPublishWaitlistJoined] = useState(false);
  const [joiningPublishWaitlist, setJoiningPublishWaitlist] = useState(false);
  const [publishWaitlistError, setPublishWaitlistError] = useState<
    string | null
  >(null);
  const pageStyles = useMemo(
    () => getBodyInlineStyles(activeContent),
    [activeContent],
  );
  const editableLiveScreenIds = useMemo(
    () =>
      canEditDesign || canEditLiveScreens ? liveScreenIds : new Set<string>(),
    [canEditDesign, canEditLiveScreens, liveScreenIds],
  );

  const sendRuntimeLayerStateSemanticHandoff = useCallback(
    (
      layerId: string,
      state: "locked" | "hidden",
      enabled: boolean,
    ): true | "preview-only" | false =>
      runSendRuntimeLayerStateSemanticHandoff(
        {
          codeLayerOwnerByNodeIdRef,
          localhostConnectionRootPathByIdRef,
          overviewScreens,
          runtimeLayerSnapshotsById,
          setActiveLeftPanel,
          t,
        },
        layerId,
        state,
        enabled,
      ),
    [overviewScreens, runtimeLayerSnapshotsById, t],
  );

  const publishDesignTitle = design?.title?.trim() || "Untitled design";

  const handleJoinPublishWaitlist = useCallback(async () => {
    if (!isSignedIn) {
      handleSignInToSave();
      return;
    }

    setJoiningPublishWaitlist(true);
    setPublishWaitlistError(null);

    try {
      const res = await fetch(
        new URL(
          agentNativePath("/_agent-native/builder/branch-waitlist"),
          window.location.origin,
        ).href,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pageUrl: window.location.href,
            prompt: `Publish design "${publishDesignTitle}" as an app.`,
            source: "design_editor_publish_app_menu",
            useCase: "design_publish_app",
          }),
        },
      );
      // coercion-ok: res.ok decides the outcome; an unreadable body only loses the server's error text.
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : `Request failed (${res.status})`,
        );
      }

      setPublishWaitlistJoined(true);
    } catch (err) {
      setPublishWaitlistError(
        err instanceof Error
          ? err.message
          : "Couldn't join the waitlist. Please try again.",
      );
    } finally {
      setJoiningPublishWaitlist(false);
    }
  }, [handleSignInToSave, isSignedIn, publishDesignTitle]);

  const activeLayerId =
    selectedLayerIds[selectedLayerIds.length - 1] ??
    selectedElementLayerId ??
    activeFile?.id ??
    "";
  const selectedElementFullViewScreenId =
    viewMode === "overview" && selectedElement
      ? selectedElementLayerId
        ? (codeLayerOwnerByNodeId.get(selectedElementLayerId)?.fileId ??
          activeFileId)
        : activeFileId
      : null;
  const fullViewScreenIds = useMemo(
    () =>
      selectedElementFullViewScreenId ? [selectedElementFullViewScreenId] : [],
    [selectedElementFullViewScreenId],
  );

  const singleSelectedOverviewScreenId =
    viewMode === "overview" &&
    !selectedElement &&
    overviewSelectedScreenIds.length === 1
      ? overviewSelectedScreenIds[0]
      : null;
  const selectedFrameBackgroundImage =
    singleSelectedOverviewScreenId &&
    singleSelectedOverviewScreenId === activeFileId
      ? pageStyles.backgroundImage
      : undefined;
  const gradientEditTarget = useMemo<GradientEditOverlayTarget | null>(() => {
    if (!singleSelectedOverviewScreenId) return null;
    if (!selectedFrameBackgroundImage?.trim().startsWith("linear-gradient("))
      return null;
    const frameOrDraftId = singleSelectedOverviewScreenId;
    return {
      frameOrDraftId,
      cssValue: selectedFrameBackgroundImage,
      onChange: (nextCss, meta) => {
        handleStyleChange("backgroundImage", nextCss, meta);
      },
    };
  }, [
    handleStyleChange,
    selectedFrameBackgroundImage,
    singleSelectedOverviewScreenId,
  ]);

  const inScreenGradientEditNodeId = useMemo(() => {
    if (!selectedElement || isScreenRootElementInfo(selectedElement))
      return null;
    return selectedElement.sourceId ?? null;
  }, [selectedElement]);
  const inScreenGradientEditScreenId = useMemo(() => {
    if (!inScreenGradientEditNodeId) return null;
    if (viewMode !== "overview") return activeFile?.id ?? null;
    return (
      (selectedElementLayerId
        ? codeLayerOwnerByNodeId.get(selectedElementLayerId)?.fileId
        : undefined) ?? activeFileId
    );
  }, [
    activeFile?.id,
    activeFileId,
    codeLayerOwnerByNodeId,
    inScreenGradientEditNodeId,
    selectedElementLayerId,
    viewMode,
  ]);
  const inScreenBackgroundImage =
    selectedElement?.inlineStyles?.backgroundImage ??
    selectedElement?.computedStyles.backgroundImage;
  const inScreenGradientEditCssValue =
    inScreenGradientEditNodeId &&
    inScreenBackgroundImage?.trim().startsWith("linear-gradient(")
      ? inScreenBackgroundImage
      : null;
  const inScreenGradientEditTarget = useMemo<{
    screenId: string;
    nodeId: string;
    cssValue: string;
  } | null>(() => {
    if (
      !inScreenGradientEditScreenId ||
      !inScreenGradientEditNodeId ||
      !inScreenGradientEditCssValue
    ) {
      return null;
    }
    return {
      screenId: inScreenGradientEditScreenId,
      nodeId: inScreenGradientEditNodeId,
      cssValue: inScreenGradientEditCssValue,
    };
  }, [
    inScreenGradientEditCssValue,
    inScreenGradientEditNodeId,
    inScreenGradientEditScreenId,
  ]);
  const handleInScreenGradientEditChange = useCallback(
    (nodeId: string, cssValue: string, phase: "preview" | "commit") => {
      if (
        !inScreenGradientEditTarget ||
        inScreenGradientEditTarget.nodeId !== nodeId
      ) {
        return;
      }
      handleStyleChange("backgroundImage", cssValue, { phase });
    },
    [handleStyleChange, inScreenGradientEditTarget],
  );
  const pendingInspectorInteractionStateStyles = useMemo(() => {
    if (
      activeCanvasSourceType !== "localhost" ||
      !inScreenGradientEditScreenId ||
      !inScreenGradientEditNodeId
    ) {
      return undefined;
    }
    const stylesByState: Partial<
      Record<InteractionState, Record<string, string>>
    > = {};
    for (const edit of pendingVisualStyleEdits) {
      if (
        !edit.interactionState ||
        edit.screenId !== inScreenGradientEditScreenId ||
        (edit.sourceId !== inScreenGradientEditNodeId &&
          edit.selector !== selectedCanvasSelector)
      ) {
        continue;
      }
      stylesByState[edit.interactionState] = {
        ...(stylesByState[edit.interactionState] ?? {}),
        ...edit.styles,
      };
    }
    return Object.keys(stylesByState).length > 0 ? stylesByState : undefined;
  }, [
    activeCanvasSourceType,
    inScreenGradientEditNodeId,
    inScreenGradientEditScreenId,
    pendingVisualStyleEdits,
    selectedCanvasSelector,
  ]);
  const statePreviewTarget = useMemo(() => {
    const target = deriveStatePreviewTarget(
      activeInteractionStateState,
      inScreenGradientEditScreenId,
      inScreenGradientEditNodeId,
    );
    if (!target) return null;
    const pendingStateEdit = isRunningAppSourceType(activeCanvasSourceType)
      ? pendingVisualStyleEdits.find(
          (edit) =>
            edit.screenId === target.screenId &&
            edit.interactionState === target.state &&
            (edit.sourceId === target.nodeId ||
              edit.selector === selectedCanvasSelector),
        )
      : undefined;
    return {
      ...target,
      selector: selectedCanvasSelector,
      selectorCandidates: selectedCanvasSelectorCandidates,
      previewStyles: pendingStateEdit?.styles ?? null,
    };
  }, [
    activeCanvasSourceType,
    activeInteractionStateState,
    inScreenGradientEditNodeId,
    inScreenGradientEditScreenId,
    pendingVisualStyleEdits,
    selectedCanvasSelector,
    selectedCanvasSelectorCandidates,
  ]);
  const activeLayerLocked = Boolean(
    activeLayerId && effectiveCodeLayerState.lockedIds.has(activeLayerId),
  );
  const activeLayerHidden = Boolean(
    activeLayerId && effectiveCodeLayerState.hiddenIds.has(activeLayerId),
  );

  const activeScreenIsLocalSource =
    Boolean(activeFile) && activeOverviewScreen?.sourceType === "localhost";
  const activeScreenRouteSourceFile = activeScreenIsLocalSource
    ? getLocalhostRouteSourceFile({
        sourceFile: activeOverviewScreen?.sourceFile,
        source: activeOverviewScreen?.source,
      })
    : undefined;

  const [addLocalhostScreenOpen, setAddLocalhostScreenOpen] = useState(false);
  const handleOpenAddLocalhostScreen = useCallback(
    () => setAddLocalhostScreenOpen(true),
    [],
  );
  const addLocalhostScreenFallbackPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const screen of overviewScreens) {
      if (screen.sourceType !== "localhost") continue;
      const screenUrl = screen.url ?? screen.previewUrl;
      if (!screenUrl) continue;
      try {
        const parsed = new URL(screenUrl);
        paths.add(`${parsed.pathname}${parsed.search}`);
        // coercion-ok: a malformed screen URL has no path to offer as a fallback.
      } catch {
        // Skip malformed screen URLs.
      }
    }
    return [...paths];
  }, [overviewScreens]);
  const handleAddScreenAffordance = useCallback(() => {
    if (designSourceType === "localhost") {
      setAddLocalhostScreenOpen(true);
      return;
    }
    handleAddScreen();
  }, [designSourceType, handleAddScreen]);

  const activeLocalhostRelPath = useMemo<string | undefined>(() => {
    if (!activeScreenIsLocalSource) return undefined;
    const sf = activeScreenRouteSourceFile;
    if (sf?.trim()) return sf.trim();
    const url = activeOverviewScreen?.url;
    if (!url) return undefined;
    try {
      const pathname = new URL(url).pathname.replace(/^\//, "");
      return pathname || undefined;
      // coercion-ok: undefined already means "no writable route" to every reader of this path.
    } catch {
      return undefined;
    }
  }, [
    activeScreenIsLocalSource,
    activeScreenRouteSourceFile,
    activeOverviewScreen?.url,
  ]);
  const activeLocalhostSourceSnapshot = activeFile?.id
    ? liveScreenSnapshotsById[activeFile.id]
    : undefined;
  const currentLocalhostPreviewUrl = activeOverviewScreen?.url;
  const activeLocalhostSourceSnapshotHtml =
    activeLocalhostSourceSnapshot &&
    currentLocalhostPreviewUrl &&
    activeLocalhostSourceSnapshot.url === currentLocalhostPreviewUrl
      ? activeLocalhostSourceSnapshot.html
      : undefined;

  const fileIdSet = new Set(files.map((f) => f.id));
  const selectedDomLayerIds = selectedLayerIds.filter(
    (id) => !id.startsWith("__") && !fileIdSet.has(id),
  );
  const selectedActiveFileNodeIds = useMemo(
    () =>
      selectedLayerIdsState.length >= 2
        ? getActiveFileSelectedNodeIds(activeContent)
        : [],
    [activeContent, getActiveFileSelectedNodeIds, selectedLayerIdsState.length],
  );
  const selectedDomLayerOwners = selectedDomLayerIds.map((layerId) =>
    codeLayerOwnerByNodeId.get(layerId),
  );
  const selectedRuntimeLayerOwners = selectedDomLayerOwners.filter(
    (owner) => owner?.runtimeOnly,
  );
  const selectedLayersUseCompatibleSourceBackend =
    selectedRuntimeLayerOwners.length === 0 ||
    (selectedRuntimeLayerOwners.length === selectedDomLayerIds.length &&
      selectedRuntimeLayerOwners.every(
        (owner) => owner?.fileId === selectedRuntimeLayerOwners[0]?.fileId,
      ));
  const canUngroup =
    canEditDesign &&
    viewMode === "single" &&
    Boolean(activeFile) &&
    selectedDomLayerIds.length >= 1 &&
    selectedLayersUseCompatibleSourceBackend &&
    selectedDomLayerIds.every((id) => {
      const node = codeLayerOwnerByNodeIdRef.current.get(id)?.node;
      return Boolean(node) && node!.children.length > 0;
    });

  const handleScreenLayerMove = useCallback(
    (intent: LayersPanelMoveIntent) => {
      const nextOrder = reorderCanonicalScreenStack({
        orderedIds: canonicalOverviewScreenIds,
        draggedIds: intent.draggedIds,
        targetId: intent.targetId,
        placement: intent.placement,
      });
      if (!nextOrder) return;

      const before = getCanvasFrameGeometry(designDataJsonRef.current);
      const after = cloneCanvasFrameGeometry(before);
      nextOrder.forEach((screenId, z) => {
        const screenIndex = overviewScreens.findIndex(
          (screen) => screen.id === screenId,
        );
        const screen = overviewScreens[screenIndex];
        if (!screen || screenIndex < 0) return;
        const fallback = getInitialFrameGeometry(screenIndex, {
          width: screen.width ?? 1280,
          height: screen.height ?? 2560,
        });
        after[screenId] = { ...fallback, ...before[screenId], z };
      });
      handleGeometryCommit(before, after);
    },
    [canonicalOverviewScreenIds, handleGeometryCommit, overviewScreens],
  );

  const canMoveLayer = useCallback(
    (intent: LayersPanelMoveIntent) =>
      runCanMoveLayer(
        {
          codeLayerOwnerByNodeId,
          effectiveCodeLayerState,
          files,
          liveScreenIds,
          lockedLayerIds,
          visualScreenFileIds,
        },
        intent,
      ),
    [
      codeLayerOwnerByNodeId,
      effectiveCodeLayerState,
      files,
      liveScreenIds,
      lockedLayerIds,
      visualScreenFileIds,
    ],
  );

  const handleLayerMoveToScreen = useCallback(
    (intent: LayersPanelMoveIntent, targetFileId: string) =>
      runLayerMoveToScreen(
        {
          activeBreakpointWidthState,
          activeFileId,
          overviewSelectedScreenIds,
          contentUndoStackRef,
          contentHistorySelectionAfterRef,
          activeFile,
          applyFileContentUpdate,
          boardFileId,
          codeLayerOwnerByNodeId,
          effectiveCodeLayerState,
          files,
          getFreshActiveContent,
          getScreenContent,
          overviewScreens,
          recordContentHistoryEntry,
          recordLocalContentHistoryEntry,
          runtimeStructureInsertRevisionRef,
          setExpandedLayerIds,
          setRuntimeStructureInsertRequest,
          setSelectedElement,
          setSelectedLayerIdsState,
          t,
          viewModeRef,
        },
        intent,
        targetFileId,
      ),
    [
      activeFileId,
      overviewSelectedScreenIds,
      activeBreakpointWidthState,
      activeFile?.id,
      applyFileContentUpdate,
      boardFileId,
      codeLayerOwnerByNodeId,
      effectiveCodeLayerState,
      files,
      getFreshActiveContent,
      getScreenContent,
      overviewScreens,
      recordContentHistoryEntry,
      recordLocalContentHistoryEntry,
      t,
    ],
  );

  const handleLayerMove = useCallback(
    (intent: LayersPanelMoveIntent) =>
      runLayerMove(
        {
          activeBreakpointWidthState,
          activeFileId,
          overviewSelectedScreenIds,
          contentUndoStackRef,
          contentHistorySelectionAfterRef,
          activeFile,
          applyLinkedComponentEdit,
          applyFileContentUpdate,
          boardFileId,
          canEditDesign,
          canEditLiveScreen,
          canMoveLayer,
          codeLayerOwnerByNodeId,
          effectiveCodeLayerState,
          files,
          getFreshActiveContent,
          getScreenContent,
          overviewScreens,
          handleLayerMoveToScreen,
          handleScreenLayerMove,
          recordContentHistoryEntry,
          recordLocalContentHistoryEntry,
          remapMotionTracksForClone,
          runtimeLayerSnapshotsById,
          runtimeStructureInsertRevisionRef,
          runtimeStructureMoveRevisionRef,
          sendRuntimeLayerMoveSemanticHandoff,
          setExpandedLayerIds,
          setRuntimeStructureDeleteRequest,
          setRuntimeStructureInsertRequest,
          setRuntimeStructureMoveRequest,
          setSelectedElement,
          setSelectedLayerIdsState,
          t,
          viewModeRef,
          visualScreenFileIds,
        },
        intent,
      ),
    [
      activeFileId,
      overviewSelectedScreenIds,
      activeBreakpointWidthState,
      activeFile?.id,
      applyFileContentUpdate,
      boardFileId,
      canEditDesign,
      canEditLiveScreen,
      canMoveLayer,
      codeLayerOwnerByNodeId,
      effectiveCodeLayerState,
      files,
      getFreshActiveContent,
      getScreenContent,
      overviewScreens,
      handleLayerMoveToScreen,
      handleScreenLayerMove,
      recordContentHistoryEntry,
      recordLocalContentHistoryEntry,
      remapMotionTracksForClone,
      runtimeLayerSnapshotsById,
      sendRuntimeLayerMoveSemanticHandoff,
      applyLinkedComponentEdit,
      setRuntimeStructureDeleteRequest,
      setRuntimeStructureInsertRequest,
      t,
      visualScreenFileIds,
    ],
  );

  const handleLayerHover = useCallback(
    (layerId: string) => {
      const owner = codeLayerOwnerByNodeId.get(layerId);
      if (!owner) return;
      setHoveredElement(elementInfoFromCodeLayerNode(owner.node));
      setHoveredElementScreenId(owner.fileId);
    },
    [codeLayerOwnerByNodeId],
  );

  const hydrateRenderedLayerInfoForIds = useCallback((ids: string[]) => {
    const hydrationRevision = ++layerSelectionHydrationRevisionRef.current;
    const renderedRevision = renderedElementInfoRevisionRef.current;
    const breakpointWidth = activeBreakpointWidthStateRef.current;
    const ownerByNodeId = codeLayerOwnerByNodeIdRef.current;
    const currentBoardFileId = boardFileIdRef.current;
    type RenderedLayerOwner = {
      fileId: string;
      node: CodeLayerNode;
      tree: CodeLayerTreeNode[];
      runtimeOnly: boolean;
    };
    const ownersToMeasure = new Map<string, RenderedLayerOwner>();
    for (const layerId of ids) {
      const owner = ownerByNodeId.get(layerId);
      if (!owner || owner.runtimeOnly) continue;
      ownersToMeasure.set(layerId, owner);
      for (const siblingId of findCodeLayerSiblingOrder(owner.tree, layerId)
        ?.siblingIds ?? []) {
        const siblingOwner = ownerByNodeId.get(siblingId);
        if (
          siblingOwner &&
          siblingOwner.fileId === owner.fileId &&
          !siblingOwner.runtimeOnly
        ) {
          ownersToMeasure.set(siblingId, siblingOwner);
        }
      }
      const pendingDescendants = [...owner.node.children];
      while (pendingDescendants.length > 0) {
        const descendantId = pendingDescendants.pop()!;
        const descendantOwner = ownerByNodeId.get(descendantId);
        if (
          !descendantOwner ||
          descendantOwner.fileId !== owner.fileId ||
          descendantOwner.runtimeOnly
        ) {
          continue;
        }
        ownersToMeasure.set(descendantId, descendantOwner);
        pendingDescendants.push(...descendantOwner.node.children);
      }
    }
    const cache = (
      layerId: string,
      owner: RenderedLayerOwner,
      measured: ElementInfo,
    ) => {
      const currentOwner = codeLayerOwnerByNodeIdRef.current.get(layerId);
      if (
        layerSelectionHydrationRevisionRef.current !== hydrationRevision ||
        renderedElementInfoRevisionRef.current !== renderedRevision ||
        activeBreakpointWidthStateRef.current !== breakpointWidth ||
        currentOwner?.fileId !== owner.fileId ||
        currentOwner?.node.id !== owner.node.id
      ) {
        return;
      }
      if (
        !measured.positionReferenceRect ||
        !measured.positionContainingBlockOrigin ||
        !measured.positionContainingBlockTransform
      ) {
        return;
      }
      const stableId = owner.node.dataAttributes["data-agent-native-node-id"];
      const ownerId = stableId ?? bridgeSourceIdForCodeLayerNode(owner.node);
      const layerKey = `${owner.fileId}:${owner.node.id}`;
      const stableKey = stableId ? `${owner.fileId}:${stableId}` : undefined;
      renderedElementInfoByLayerKeyRef.current.set(layerKey, measured);
      if (stableKey) {
        renderedElementInfoByLayerKeyRef.current.set(stableKey, measured);
      }
      if (selectedLayerIdsStateRef.current.includes(layerId)) {
        const mergeMeasured = (current: ElementInfo | null) => {
          if (!current) return measured;
          const currentId = current.sourceId ?? current.runtimeSourceId;
          if (currentId !== ownerId) return current;
          const merged = {
            ...measured,
            ...current,
            sourceLayerIdentity: measured.sourceLayerIdentity,
            boundingRect: measured.boundingRect,
            parentBoundingRect:
              measured.parentBoundingRect ?? current.parentBoundingRect,
            positionReferenceRect: measured.positionReferenceRect,
            positionContainingBlockOrigin:
              measured.positionContainingBlockOrigin,
            positionContainingBlockTransform:
              measured.positionContainingBlockTransform,
            computedStyles: {
              ...measured.computedStyles,
              ...current.computedStyles,
            },
          };
          return samePlainData(merged, current) ? current : merged;
        };
        const rendered = selectedElementRef.current;
        // The ref lags a selection set earlier in the same handler, so only a
        // no-op merge into the element it already holds is safe to skip.
        if (
          (rendered?.sourceId ?? rendered?.runtimeSourceId) !== ownerId ||
          mergeMeasured(rendered) !== rendered
        ) {
          setSelectedElement(mergeMeasured);
        }
      }
      if (
        measured.boundingRect.width <= 0 ||
        measured.boundingRect.height <= 0
      ) {
        return;
      }
    };
    for (const [layerId, owner] of ownersToMeasure) {
      const synchronouslyMeasured = readRenderedLayerInfo(
        owner,
        breakpointWidth,
        currentBoardFileId,
      );
      if (synchronouslyMeasured) {
        cache(layerId, owner, synchronouslyMeasured);
        continue;
      }
      void requestSelectionMeasurement({
        targetWindows: () =>
          designPreviewWindowsForScreen(
            owner.fileId,
            breakpointWidth,
            currentBoardFileId,
          ),
        screenId: owner.fileId,
        selector: preferredCodeLayerSelector(owner.node),
      }).then((measured) => {
        if (!measured) return;
        cache(layerId, owner, measured);
      });
    }
  }, []);
  rehydrateRenderedElementInfoRef.current = () =>
    hydrateRenderedLayerInfoForIds(selectedLayerIdsStateRef.current);

  const handleLayerSelectionChange = useCallback(
    (
      ids: string[],
      _intent: {
        additive: boolean;
        currentSelectedIds?: string[];
        id: string;
        range: boolean;
      },
    ) => {
      if (!sameStringIds(selectedLayerIdsStateRef.current, ids)) {
        selectionRevisionRef.current += 1;
      }
      recordSelectionHistoryAroundChange(() => {
        explicitOverviewScreenSelectionRef.current = [];
        const effectiveIds = runLayerSelectionChange(
          {
            applyFileContentUpdate,
            activeFile,
            clearPendingOverviewLayerSelectionTimer,
            codeLayerOwnerByNodeId,
            effectiveCodeLayerState,
            files,
            getScreenContent,
            focusDesignInspectorForSelection,
            overviewSelectedScreenIds,
            pendingOverviewLayerSelectionRef,
            pendingOverviewScreenSelectionRef,
            setActiveFileId,
            setActiveTool,
            setCreatedOverviewLayerSelection,
            selectedElement,
            setMode,
            setOverviewSelectedScreenIds,
            setSelectedElement,
            setSelectedLayerIdsState,
            setViewMode,
            viewModeRef,
          },
          ids,
          _intent,
        );
        hydrateRenderedLayerInfoForIds(effectiveIds);
        queueMicrotask(() => hydrateRenderedLayerInfoForIds(effectiveIds));
      });
    },
    [
      activeFile?.id,
      activeFileId,
      applyFileContentUpdate,
      clearPendingOverviewLayerSelectionTimer,
      codeLayerOwnerByNodeId,
      effectiveCodeLayerState,
      files,
      focusDesignInspectorForSelection,
      getScreenContent,
      activeBreakpointWidthStateRef,
      overviewSelectedScreenIds,
      recordSelectionHistoryAroundChange,
      selectedElement,
      layerSelectionHydrationRevisionRef,
      hydrateRenderedLayerInfoForIds,
    ],
  );

  const handleLayerMarqueeSelectionChange = useCallback(
    (
      selection: CanvasLayerMarqueeSelection[],
      intent: ElementSelectionIntent,
      options: {
        clearExplicitScreenSelection?: boolean;
        clearExplicitScreenIds?: string[];
        marqueeSelectedScreenIds?: string[];
      } = {},
    ) => {
      if (!intent.cancelled) selectionRevisionRef.current += 1;
      recordMarqueeSelectionHistoryAroundChange(() => {
        if (
          !intent.cancelled &&
          (intent.source !== "marquee" || options.clearExplicitScreenSelection)
        ) {
          explicitOverviewScreenSelectionRef.current = [];
        }
        if (!intent.cancelled && options.clearExplicitScreenIds?.length) {
          const clearedScreenIds = new Set(options.clearExplicitScreenIds);
          explicitOverviewScreenSelectionRef.current =
            explicitOverviewScreenSelectionRef.current.filter(
              (screenId) => !clearedScreenIds.has(screenId),
            );
        }
        if (
          !intent.cancelled &&
          intent.final === true &&
          options.marqueeSelectedScreenIds
        ) {
          const selectedScreenIds = new Set(intent.selectedScreenIds ?? []);
          const explicitScreenIds =
            explicitOverviewScreenSelectionRef.current.filter((screenId) =>
              selectedScreenIds.has(screenId),
            );
          for (const screenId of options.marqueeSelectedScreenIds) {
            if (
              selectedScreenIds.has(screenId) &&
              !explicitScreenIds.includes(screenId)
            ) {
              explicitScreenIds.push(screenId);
            }
          }
          explicitOverviewScreenSelectionRef.current = explicitScreenIds;
        }
        runLayerMarqueeSelectionChange(
          {
            clearPendingOverviewLayerSelectionTimer,
            focusDesignInspectorForSelection,
            getCodeLayerProjectionForScreen,
            hasActiveSelectionRef,
            lastMarqueeSelectionSignatureRef,
            pendingOverviewLayerSelectionRef,
            pendingOverviewScreenSelectionRef,
            renderedElementInfoByLayerKeyRef,
            setActiveFileId,
            setActiveTool,
            setCreatedOverviewLayerSelection,
            setMode,
            setOverviewClearSelectionRequest,
            setOverviewSelectedScreenIds,
            setSelectedElement,
            setSelectedLayerIdsState,
            viewModeRef,
          },
          selection,
          intent,
        );
      }, intent);
    },
    [
      clearPendingOverviewLayerSelectionTimer,
      focusDesignInspectorForSelection,
      getCodeLayerProjectionForScreen,
      recordMarqueeSelectionHistoryAroundChange,
    ],
  );

  const handleCanvasLayerMarqueeSelectionChange = useCallback(
    (
      selection: CanvasLayerMarqueeSelection[],
      intent: ElementSelectionIntent,
    ) => {
      const resolvedIntent = intent;
      if (
        resolvedIntent.final === true &&
        resolvedIntent.cancelled !== true &&
        resolvedIntent.selectedScreenIds !== undefined
      ) {
        handleOverviewScreenSelectionChange(
          resolvedIntent.selectedScreenIds,
          resolvedIntent,
        );
      }
      handleLayerMarqueeSelectionChange(selection, resolvedIntent, {
        clearExplicitScreenSelection:
          resolvedIntent.metaKey === true ||
          resolvedIntent.ctrlKey === true ||
          (!resolvedIntent.shiftKey &&
            resolvedIntent.selectedScreenIds !== undefined &&
            resolvedIntent.selectedScreenIds.length === 0),
        clearExplicitScreenIds:
          resolvedIntent.shiftKey &&
          resolvedIntent.metaKey !== true &&
          resolvedIntent.ctrlKey !== true
            ? [...new Set(selection.map(({ screenId }) => screenId))]
            : undefined,
        marqueeSelectedScreenIds:
          resolvedIntent.final &&
          !resolvedIntent.metaKey &&
          !resolvedIntent.ctrlKey
            ? resolvedIntent.marqueeSelectedScreenIds
            : undefined,
      });
    },
    [handleLayerMarqueeSelectionChange, handleOverviewScreenSelectionChange],
  );

  const handleScreenElementMarqueeSelect = useCallback(
    (
      screenId: string,
      infos: ElementInfo[],
      intent?: ElementSelectionIntent,
    ) => {
      handleLayerMarqueeSelectionChange(
        infos.map((info) => ({ screenId, info })),
        {
          additive: resolveMarqueeAdditive(intent),
          range: Boolean(intent?.range || intent?.shiftKey),
          source: "marquee",
          final: intent?.final === true,
          shiftKey: Boolean(intent?.shiftKey),
          metaKey: Boolean(intent?.metaKey),
          ctrlKey: Boolean(intent?.ctrlKey),
        },
        {
          clearExplicitScreenSelection:
            !intent?.shiftKey ||
            intent?.metaKey === true ||
            intent?.ctrlKey === true,
          clearExplicitScreenIds:
            intent?.shiftKey &&
            intent.metaKey !== true &&
            intent.ctrlKey !== true
              ? [screenId]
              : undefined,
        },
      );
    },
    [handleLayerMarqueeSelectionChange],
  );

  const handleElementMarqueeSelect = useCallback(
    (infos: ElementInfo[], intent?: ElementSelectionIntent) => {
      const screenId = activeFile?.id ?? activeFileId;
      if (!screenId) return;
      handleScreenElementMarqueeSelect(screenId, infos, intent);
    },
    [activeFile?.id, activeFileId, handleScreenElementMarqueeSelect],
  );

  const handleLayerRename = useCallback(
    (layerId: string, name: string) => {
      const owner = codeLayerOwnerByNodeId.get(layerId);
      if (owner && canEditLiveScreen(owner.fileId) && !canEditDesign) {
        runtimeLayerRenameRevisionRef.current += 1;
        setRuntimeLayerRenameRequest({
          requestId: runtimeLayerRenameRevisionRef.current,
          screenId: owner.fileId,
          layerId,
          selector: preferredCodeLayerSelector(owner.node),
          sourceId: bridgeSourceIdForCodeLayerNode(owner.node),
          routePath: liveRoutePathsByScreenIdRef.current[owner.fileId],
          name,
        });
        return;
      }
      runLayerRename(
        {
          activeFile,
          applyFileContentUpdate,
          canEditDesign,
          codeLayerOwnerByNodeId,
          designSourceType,
          files,
          getFreshActiveContent,
          getScreenContent,
          id,
          overviewScreens,
          queryClient,
          renameScreenMutation,
          serverFiles,
          setSelectedLayerIdsState,
          t,
        },
        layerId,
        name,
      );
    },
    [
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      canEditLiveScreen,
      codeLayerOwnerByNodeId,
      designSourceType,
      files,
      getFreshActiveContent,
      getScreenContent,
      id,
      liveScreenSnapshotsById,
      overviewScreens,
      queryClient,
      renameScreenMutation,
      serverFiles,
      setRuntimeLayerRenameRequest,
      syncLiveScreenSnapshotPreview,
      t,
      updateLiveScreenSnapshotContent,
    ],
  );

  const handleToggleLayerLocked = useCallback(
    (layerId: string, locked: boolean) =>
      runToggleLayerLocked(
        {
          activeFile,
          applyFileContentUpdate,
          applyLayerStatePreview,
          canEditDesign,
          canEditLiveScreens: editableLiveScreenIds,
          codeLayerOwnerByNodeId,
          designSourceType,
          files,
          getFreshActiveContent,
          liveScreenSnapshotsById,
          lockedLayerIds,
          overviewScreens,
          recordPendingLiveLayerStateEdit,
          sendRuntimeLayerStateSemanticHandoff,
          syncLiveScreenSnapshotPreview,
          updateLiveScreenSnapshotContent,
        },
        layerId,
        locked,
      ),
    [
      activeFile?.id,
      applyLayerStatePreview,
      applyFileContentUpdate,
      canEditDesign,
      editableLiveScreenIds,
      codeLayerOwnerByNodeId,
      designSourceType,
      files,
      getFreshActiveContent,
      liveScreenSnapshotsById,
      lockedLayerIds,
      overviewScreens,
      recordPendingLiveLayerStateEdit,
      sendRuntimeLayerStateSemanticHandoff,
      syncLiveScreenSnapshotPreview,
      updateLiveScreenSnapshotContent,
    ],
  );

  const handleToggleLayerHidden = useCallback(
    (layerId: string, hidden: boolean) =>
      runToggleLayerHidden(
        {
          activeFile,
          applyFileContentUpdate,
          applyLayerStatePreview,
          canEditDesign,
          canEditLiveScreens: editableLiveScreenIds,
          codeLayerOwnerByNodeId,
          designSourceType,
          files,
          getFreshActiveContent,
          hiddenLayerIds,
          liveScreenSnapshotsById,
          overviewScreens,
          recordPendingLiveLayerStateEdit,
          sendRuntimeLayerStateSemanticHandoff,
          syncLiveScreenSnapshotPreview,
          updateLiveScreenSnapshotContent,
        },
        layerId,
        hidden,
      ),
    [
      activeFile?.id,
      applyLayerStatePreview,
      applyFileContentUpdate,
      canEditDesign,
      editableLiveScreenIds,
      codeLayerOwnerByNodeId,
      designSourceType,
      files,
      getFreshActiveContent,
      hiddenLayerIds,
      liveScreenSnapshotsById,
      overviewScreens,
      recordPendingLiveLayerStateEdit,
      sendRuntimeLayerStateSemanticHandoff,
      syncLiveScreenSnapshotPreview,
      updateLiveScreenSnapshotContent,
    ],
  );

  const layerPanelHandlers = {
    onRename: handleLayerRename,
    onToggleLocked: handleToggleLayerLocked,
    onToggleHidden: handleToggleLayerHidden,
    onHoverLayer: handleLayerHover,
    onMoveLayer: handleLayerMove,
    canMoveLayer,
    onSelectionChange: handleLayerSelectionChange,
    onCopyLayer: handleCopySelection,
    onDuplicateLayer: handleDuplicateSelection,
    onDeleteLayer: handleDeleteSelection,
    onGroupSelection: handleGroupSelection,
    onUngroupSelection: handleUngroupSelection,
    onReorderLayer: changeSelectedZIndex,
    onPasteToReplace: handlePasteToReplace,
    onFrameSelection: handleFrameSelection,
    onFlipHorizontal: handleFlipHorizontal,
    onFlipVertical: handleFlipVertical,
  };
  const layerPanelHandlersRef = useRef(layerPanelHandlers);
  layerPanelHandlersRef.current = layerPanelHandlers;
  const layerPanelCallbacks = useMemo(() => {
    const latest = () => layerPanelHandlersRef.current;
    return {
      onRename: (...args: Parameters<typeof handleLayerRename>) =>
        latest().onRename(...args),
      onToggleLocked: (...args: Parameters<typeof handleToggleLayerLocked>) =>
        latest().onToggleLocked(...args),
      onToggleHidden: (...args: Parameters<typeof handleToggleLayerHidden>) =>
        latest().onToggleHidden(...args),
      onHoverLayer: (...args: Parameters<typeof handleLayerHover>) =>
        latest().onHoverLayer(...args),
      onMoveLayer: (...args: Parameters<typeof handleLayerMove>) =>
        latest().onMoveLayer(...args),
      canMoveLayer: (...args: Parameters<typeof canMoveLayer>) =>
        latest().canMoveLayer(...args),
      onSelectionChange: (
        ...args: Parameters<typeof handleLayerSelectionChange>
      ) => latest().onSelectionChange(...args),
      onCopyLayer: () => latest().onCopyLayer(),
      onDuplicateLayer: () => latest().onDuplicateLayer(),
      onDeleteLayer: () => latest().onDeleteLayer(),
      onGroupSelection: () => latest().onGroupSelection(),
      onUngroupSelection: () => latest().onUngroupSelection(),
      onReorderLayer: (
        _ids: string[],
        direction: Parameters<typeof changeSelectedZIndex>[0],
      ) => latest().onReorderLayer(direction),
      onPasteToReplace: () => latest().onPasteToReplace(),
      onFrameSelection: () => latest().onFrameSelection(),
      onFlipHorizontal: () => latest().onFlipHorizontal(),
      onFlipVertical: () => latest().onFlipVertical(),
    };
  }, []);

  const handleToggleHiddenForSelection = useCallback(() => {
    if (!canEditDesign && !canEditLiveScreens) return;
    const targets = selectedLayerIds.length > 0 ? selectedLayerIds : [];
    if (targets.length === 0) return;
    const nextHidden = !activeLayerHidden;
    targets.forEach((layerId) => handleToggleLayerHidden(layerId, nextHidden));
  }, [
    activeLayerHidden,
    canEditDesign,
    canEditLiveScreens,
    handleToggleLayerHidden,
    selectedLayerIds,
  ]);

  const handleToggleLockedForSelection = useCallback(() => {
    if (!canEditDesign && !canEditSelectedLiveLayer) return;
    const targets = selectedLayerIds.length > 0 ? selectedLayerIds : [];
    if (targets.length === 0) return;
    const nextLocked = !activeLayerLocked;
    targets.forEach((layerId) => handleToggleLayerLocked(layerId, nextLocked));
  }, [
    activeLayerLocked,
    canEditDesign,
    canEditSelectedLiveLayer,
    handleToggleLayerLocked,
    selectedLayerIds,
  ]);
  const handleBoardElementMarqueeSelect = useCallback<
    NonNullable<MultiScreenCanvasProps["onBoardElementMarqueeSelect"]>
  >(
    (infos, intent) => {
      if (!boardFileId) return;
      handleScreenElementMarqueeSelect(boardFileId, infos, intent);
    },
    [boardFileId, handleScreenElementMarqueeSelect],
  );

  return {
    publishWaitlistJoined,
    joiningPublishWaitlist,
    publishWaitlistError,
    setPublishWaitlistError,
    pageStyles,
    editableLiveScreenIds,
    handleJoinPublishWaitlist,
    activeLayerId,
    fullViewScreenIds,
    gradientEditTarget,
    inScreenGradientEditTarget,
    handleInScreenGradientEditChange,
    pendingInspectorInteractionStateStyles,
    statePreviewTarget,
    activeLayerLocked,
    activeLayerHidden,
    activeScreenIsLocalSource,
    activeScreenRouteSourceFile,
    addLocalhostScreenOpen,
    setAddLocalhostScreenOpen,
    handleOpenAddLocalhostScreen,
    addLocalhostScreenFallbackPaths,
    handleAddScreenAffordance,
    activeLocalhostRelPath,
    activeLocalhostSourceSnapshotHtml,
    selectedDomLayerIds,
    selectedActiveFileNodeIds,
    selectedLayersUseCompatibleSourceBackend,
    canUngroup,
    handleCanvasLayerMarqueeSelectionChange,
    handleScreenElementMarqueeSelect,
    handleElementMarqueeSelect,
    handleToggleLayerLocked,
    handleToggleLayerHidden,
    layerPanelCallbacks,
    handleToggleHiddenForSelection,
    handleToggleLockedForSelection,
    handleBoardElementMarqueeSelect,
  };
}

export type EditorLayerActions = ReturnType<typeof useEditorLayerActions>;
