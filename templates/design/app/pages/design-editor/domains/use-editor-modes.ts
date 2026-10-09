import { getFrameGroupBounds } from "@shared/canvas-math";
import { type CodeLayerNode } from "@shared/code-layer";
import { type NodeRewriteProposal } from "@shared/node-rewrite";
import { parsePenNodes } from "@shared/pen-path";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";

import { isShowKeyboardShortcutsHotkey } from "@/hooks/useDesignHotkeys";

import {
  boardRenderOffset,
  penPathForVectorEdit,
  penPathScreenContentOffset,
  primitiveVectorEditSource,
} from "../clone-and-pen-edit";
import {
  collectCodeLayerAncestors,
  elementInfoFromCodeLayerNode,
  findCodeLayerSiblingOrder,
} from "../code-layer-state";
import { runEnterHotkey } from "../commands/enter-hotkey";
import {
  runEnterSingleScreen,
  type EnterSingleScreenOptions,
} from "../commands/enter-single-screen";
import { runEscapeHotkey } from "../commands/escape-hotkey";
import { runModeChange } from "../commands/mode-change";
import { getFocusedScreenNavigationPlan } from "../created-screen-navigation";
import { isRadixOverlayOpen } from "../dom-guards";
import { OVERVIEW_ZOOM_THRESHOLD } from "../editor-constants";
import {
  getAllScreenFrameEntries,
  getScreenFrameOriginCanvas,
  shouldPopToOverviewOnZoomChange,
} from "../overview-camera";
import { computeInteractZoomToFit } from "../responsive-interact";
import { hasSelectableCodeLayerParent } from "../selection-state";
import { shouldAutoEnableDrawOverlay } from "../tool-state";
import { type EditorMode } from "../types";
import type { EditorActiveScreenAndGeometry } from "./use-editor-active-screen-and-geometry";
import type { EditorCanvasAndScreens } from "./use-editor-canvas-and-screens";
import type { EditorContentAndComponents } from "./use-editor-content-and-components";
import type { EditorCore } from "./use-editor-core";
import type { EditorEditCommands } from "./use-editor-edit-commands";
import type { EditorFilesAndSaving } from "./use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "./use-editor-generation-and-access";
import type { EditorHistory } from "./use-editor-history";
import type { EditorLayoutAndStructure } from "./use-editor-layout-and-structure";
import type { EditorLiveEditsAndPresence } from "./use-editor-live-edits-and-presence";
import type { EditorToolsAndVectors } from "./use-editor-tools-and-vectors";

export function useEditorModes({
  editorCore,
  editorHistory,
  editorGenerationAndAccess,
  editorFilesAndSaving,
  editorActiveScreenAndGeometry,
  editorCanvasAndScreens,
  editorLiveEditsAndPresence,
  editorContentAndComponents,
  editorToolsAndVectors,
  editorLayoutAndStructure,
  editorEditCommands,
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
  editorLayoutAndStructure: EditorLayoutAndStructure;
  editorEditCommands: EditorEditCommands;
}) {
  const {
    t,
    embedded,
    mode,
    setMode,
    overviewInteractScreenId,
    setOverviewInteractScreenId,
    overviewInteractScreenIdRef,
    activeTool,
    setActiveTool,
    viewMode,
    setViewMode,
    viewModeRef,
    selectedElement,
    setSelectedElement,
    setPendingVisualEditRecoveryVisible,
    clearPendingEditSessionRecoveryRef,
    requestPendingVisualStyleRevert,
    requestPendingLiveNonStyleRevert,
    setHoveredElement,
    activeFileId,
    setActiveFileId,
  } = editorCore;
  const {
    pendingVisualStyleEdits,
    pendingLiveNonStyleEdits,
    pendingVisualStyleEditsRef,
    pendingLiveNonStyleEditsRef,
    clearPendingLiveEditState,
    setActiveInspectorTab,
    setMinimalUi,
    setExpandedLayerIds,
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
    linkedComponentMutationQueueRef,
    explicitOverviewScreenSelectionRef,
    fileHistoryMutationPendingRef,
    pendingHistoryDirectionsRef,
    replayPendingHistoryRef,
  } = editorHistory;
  const {
    setRuntimeLayerSnapshotRequest,
    lastOverviewSelectedScreenIdsRef,
    recordSelectionHistoryAroundChange,
    drawMode,
    setDrawMode,
    pinMode,
    setPinMode,
    focusedAnnotationSending,
    canEditDesign,
    canCommentDesign,
  } = editorGenerationAndAccess;
  const {
    files,
    pendingNodeRewriteByFile,
    canvasFrameGeometryById,
    boardFileId,
    overviewScreens,
    remoteVisualEditPending,
  } = editorFilesAndSaving;
  const {
    setScreenZoom,
    setCameraCommand,
    cameraCommandNonceRef,
    screenZoomByIdRef,
    setInteractDeviceName,
    interactDeviceSize,
    setInteractDeviceSize,
    exportCanvasFrameGeometryById,
    activeFile,
    handleBreakpointBarSelect,
  } = editorActiveScreenAndGeometry;
  const {
    setOverviewClearSelectionRequest,
    boardContentBounds,
    cancelActiveEditorDrag,
    getProjectionContentForScreen,
  } = editorCanvasAndScreens;
  const { zoom, canvasContainerRef, getOverviewFrameIframe } =
    editorLiveEditsAndPresence;
  const { setUiHidden } = editorContentAndComponents;
  const {
    setVectorEditingState,
    selectionRevisionRef,
    overviewAnnotationSending,
    handleExitOverviewDrawMode,
    handleExitFocusedDrawMode,
  } = editorToolsAndVectors;
  const { showComments } = editorLayoutAndStructure;
  const { runCurrentUndo, runCurrentRedo } = editorEditCommands;

  const [interactZoom, setInteractZoom] = useState(100);
  const [keyboardShortcutsOpen, setKeyboardShortcutsOpen] = useState(false);
  const keyboardShortcutsReturnFocusRef = useRef<HTMLElement | null>(null);
  const projectMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const suppressProjectMenuReturnFocusRef = useRef(false);
  const overviewCommentPinNonceRef = useRef(0);
  const [overviewCommentPinRequest, setOverviewCommentPinRequest] = useState<{
    nonce: number;
    canvasPoint: { x: number; y: number };
  } | null>(null);

  const historyDispatchRef = useRef({
    undo: runCurrentUndo,
    redo: runCurrentRedo,
  });
  historyDispatchRef.current = { undo: runCurrentUndo, redo: runCurrentRedo };
  const dispatchHistory = useCallback((direction: "undo" | "redo") => {
    if (fileHistoryMutationPendingRef.current) {
      pendingHistoryDirectionsRef.current.push(direction);
      return;
    }
    const pendingCountBefore =
      pendingVisualStyleEditsRef.current.length +
      pendingLiveNonStyleEditsRef.current.length;
    const run = () => {
      historyDispatchRef.current[direction]();
      const pendingCountAfter =
        pendingVisualStyleEditsRef.current.length +
        pendingLiveNonStyleEditsRef.current.length;
      if (pendingCountBefore > 0 && pendingCountAfter === 0) {
        clearPendingEditSessionRecoveryRef.current();
      }
    };
    const queue = linkedComponentMutationQueueRef.current?.queue;
    const pending = queue
      ? queue.dispatchHistory(queue.hasPending() ? () => flushSync(run) : run)
      : run();
    if (pending) void pending.catch((error) => toast.error(String(error)));
  }, []);
  replayPendingHistoryRef.current = dispatchHistory;
  const handleUndo = useCallback(
    () => dispatchHistory("undo"),
    [dispatchHistory],
  );
  const handleRedo = useCallback(
    () => dispatchHistory("redo"),
    [dispatchHistory],
  );

  const runEditorViewTransition = useCallback((update: () => void) => {
    if (typeof document === "undefined") {
      update();
      return;
    }

    const startViewTransition = (
      document as Document & {
        startViewTransition?: (callback: () => void) => unknown;
      }
    ).startViewTransition;

    if (typeof startViewTransition !== "function") {
      update();
      return;
    }

    let transition:
      | {
          ready?: Promise<unknown>;
          finished?: Promise<unknown>;
          updateCallbackDone?: Promise<unknown>;
        }
      | undefined;
    try {
      transition = startViewTransition.call(document, () => {
        flushSync(update);
      }) as typeof transition;
    } catch {
      update();
      return;
    }
    transition?.ready?.catch(() => {});
    transition?.finished?.catch(() => {});
    transition?.updateCallbackDone?.catch(() => {});
  }, []);

  const getRestoredOverviewSelection = useCallback(() => {
    const fileIds = new Set(files.map((file) => file.id));
    const restored = lastOverviewSelectedScreenIdsRef.current.filter((id) =>
      fileIds.has(id),
    );
    if (restored.length > 0) return restored;
    return activeFileId && fileIds.has(activeFileId) ? [activeFileId] : [];
  }, [activeFileId, files]);
  const rememberOverviewScreenSelection = useCallback((screenId: string) => {
    lastOverviewSelectedScreenIdsRef.current = [screenId];
  }, []);

  const focusOverviewScreen = useCallback(
    (screenId: string) => {
      if (!files.some((file) => file.id === screenId)) return;
      const geometry = exportCanvasFrameGeometryById[screenId];
      const plan = geometry
        ? getFocusedScreenNavigationPlan({
            screenId,
            geometry: {
              x: geometry.x as number,
              y: geometry.y as number,
              width: geometry.width as number,
              height: geometry.height as number,
            },
          })
        : null;
      selectionRevisionRef.current += 1;
      explicitOverviewScreenSelectionRef.current = [screenId];
      lastOverviewSelectedScreenIdsRef.current = [screenId];
      pendingOverviewScreenSelectionRef.current = null;
      pendingOverviewLayerSelectionRef.current = null;
      clearPendingOverviewLayerSelectionTimer();
      setCreatedOverviewLayerSelection(null);
      setOverviewSelectedScreenIds(plan?.selectedScreenIds ?? [screenId]);
      setSelectedLayerIdsState(plan?.selectedLayerIds ?? [screenId]);
      setActiveFileId(plan?.activeFileId ?? screenId);
      setSelectedElement(null);
      setHoveredElement(null);
      setActiveTool(plan?.tool ?? "move");
      setMode(plan?.editorMode ?? "edit");
      setDrawMode(plan?.drawMode ?? false);
      setPinMode(plan?.pinMode ?? false);
      setOverviewInteractScreenId(null);
      overviewInteractScreenIdRef.current = null;
      viewModeRef.current = "overview";
      setViewMode("overview");
      if (activeBreakpointWidthStateRef.current !== undefined) {
        handleBreakpointBarSelect(undefined);
      }

      if (plan) {
        cameraCommandNonceRef.current += 1;
        setCameraCommand({
          ...plan.camera,
          nonce: cameraCommandNonceRef.current,
        });
      }
    },
    [
      activeBreakpointWidthStateRef,
      cameraCommandNonceRef,
      clearPendingOverviewLayerSelectionTimer,
      exportCanvasFrameGeometryById,
      files,
      handleBreakpointBarSelect,
      lastOverviewSelectedScreenIdsRef,
      overviewInteractScreenIdRef,
      pendingOverviewLayerSelectionRef,
      pendingOverviewScreenSelectionRef,
      explicitOverviewScreenSelectionRef,
      selectionRevisionRef,
      setActiveFileId,
      setActiveTool,
      setCameraCommand,
      setCreatedOverviewLayerSelection,
      setDrawMode,
      setHoveredElement,
      setMode,
      setOverviewInteractScreenId,
      setOverviewSelectedScreenIds,
      setPinMode,
      setSelectedElement,
      setSelectedLayerIdsState,
      setViewMode,
      viewModeRef,
    ],
  );

  const enterOverviewFromZoom = useCallback(
    (nextMode?: EditorMode) => {
      if (viewModeRef.current === "overview") return;
      viewModeRef.current = "overview";
      pendingOverviewScreenSelectionRef.current = null;
      pendingOverviewLayerSelectionRef.current = null;
      clearPendingOverviewLayerSelectionTimer();
      setCreatedOverviewLayerSelection(null);
      const restoredOverviewSelection = getRestoredOverviewSelection();
      runEditorViewTransition(() => {
        setDrawMode(nextMode === "annotate");
        setPinMode(false);
        setMode(
          (currentMode) =>
            nextMode ?? (currentMode === "annotate" ? "annotate" : "edit"),
        );
        setSelectedElement(null);
        setHoveredElement(null);
        setActiveTool(nextMode === "annotate" ? "draw" : "move");
        setOverviewSelectedScreenIds(restoredOverviewSelection);
        setSelectedLayerIdsState(restoredOverviewSelection);
        setViewMode("overview");
      });
    },
    [
      clearPendingOverviewLayerSelectionTimer,
      getRestoredOverviewSelection,
      runEditorViewTransition,
    ],
  );

  const enterSingleScreen = useCallback(
    (fileId?: string | null, options?: EnterSingleScreenOptions) =>
      runEnterSingleScreen(
        {
          activeFileId,
          canvasFrameGeometryById,
          clearPendingOverviewLayerSelectionTimer,
          overviewScreens,
          pendingOverviewLayerSelectionRef,
          pendingOverviewScreenSelectionRef,
          runEditorViewTransition,
          screenZoomByIdRef,
          setActiveFileId,
          setActiveTool,
          setCreatedOverviewLayerSelection,
          setDrawMode,
          setHoveredElement,
          setInteractDeviceName,
          setInteractDeviceSize,
          setMode,
          setPinMode,
          setScreenZoom,
          setSelectedElement,
          setVectorEditingState,
          setViewMode,
          viewModeRef,
        },
        fileId,
        options,
      ),
    [
      activeFileId,
      canvasFrameGeometryById,
      clearPendingOverviewLayerSelectionTimer,
      overviewScreens,
      runEditorViewTransition,
    ],
  );
  const responsiveInteractActive =
    mode === "interact" && viewMode === "single" && !!activeFile && !embedded;

  const lastSettledSingleZoomRef = useRef<number | null>(null);
  const suppressOverviewPopForExplicitZoomRef = useRef(false);
  useEffect(() => {
    if (!activeFile || viewMode !== "single" || mode !== "edit") {
      lastSettledSingleZoomRef.current = null;
      return;
    }
    const previousZoom = lastSettledSingleZoomRef.current;
    lastSettledSingleZoomRef.current = zoom;
    const suppressPop = suppressOverviewPopForExplicitZoomRef.current;
    suppressOverviewPopForExplicitZoomRef.current = false;
    if (
      shouldPopToOverviewOnZoomChange({
        previousZoom,
        zoom,
        threshold: OVERVIEW_ZOOM_THRESHOLD,
        suppressExplicitZoom: suppressPop,
      })
    ) {
      enterOverviewFromZoom();
    }
  }, [activeFile, enterOverviewFromZoom, mode, viewMode, zoom]);

  const handleModeChange = useCallback(
    (
      next: EditorMode,
      options?: {
        discardPendingLiveEdits?: boolean;
        pendingLiveEditsAlreadyHandled?: boolean;
        targetFileId?: string;
      },
    ) =>
      runModeChange(
        {
          activeFile,
          canEditDesign,
          onPendingVisualEditsBlocked: () =>
            setPendingVisualEditRecoveryVisible(true),
          hasPendingVisualEdits:
            pendingVisualStyleEdits.length > 0 ||
            pendingLiveNonStyleEdits.length > 0 ||
            remoteVisualEditPending,
          clearPendingLiveEditState,
          enterOverviewFromZoom,
          enterSingleScreen,
          files,
          pendingLiveNonStyleEdits,
          pendingVisualStyleEdits,
          requestPendingLiveNonStyleRevert,
          requestPendingVisualStyleRevert,
          setActiveFileId,
          setActiveTool,
          setDrawMode,
          setMode,
          setPinMode,
          setSelectedElement,
          rememberOverviewScreenSelection,
          overviewInteractScreenId,
          setOverviewInteractScreenId,
          t,
          viewModeRef,
        },
        next,
        options,
      ),
    [
      activeFile,
      canEditDesign,
      setPendingVisualEditRecoveryVisible,
      remoteVisualEditPending,
      pendingLiveNonStyleEdits,
      pendingVisualStyleEdits,
      clearPendingLiveEditState,
      enterOverviewFromZoom,
      enterSingleScreen,
      requestPendingLiveNonStyleRevert,
      requestPendingVisualStyleRevert,
      rememberOverviewScreenSelection,
      t,
      files,
      overviewInteractScreenId,
    ],
  );
  const handleExitResponsiveInteract = useCallback(() => {
    setRuntimeLayerSnapshotRequest(Date.now() + Math.random());
    handleModeChange("edit");
  }, [handleModeChange]);
  const handleOverviewFrameAction = useCallback(
    (screenId: string) => focusOverviewScreen(screenId),
    [focusOverviewScreen],
  );
  useEffect(() => {
    if (!responsiveInteractActive) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      handleExitResponsiveInteract();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [responsiveInteractActive, handleExitResponsiveInteract]);
  useEffect(() => {
    if (!responsiveInteractActive) return;
    const container = canvasContainerRef.current;
    if (!container) return;
    const updateZoomToFit = () => {
      setInteractZoom(
        computeInteractZoomToFit({
          availableWidth: Math.max(1, container.clientWidth - 48),
          availableHeight: Math.max(1, container.clientHeight - 48),
          deviceWidth: interactDeviceSize.width,
          deviceHeight: interactDeviceSize.height,
        }),
      );
    };
    updateZoomToFit();
    window.addEventListener("resize", updateZoomToFit);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateZoomToFit);
    observer?.observe(container);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateZoomToFit);
    };
  }, [
    responsiveInteractActive,
    interactDeviceSize.width,
    interactDeviceSize.height,
  ]);

  useEffect(() => {
    if (
      embedded ||
      !activeFile ||
      !shouldAutoEnableDrawOverlay({ mode, activeTool, pinMode })
    ) {
      return;
    }
    if (!canEditDesign) return;
    setDrawMode(true);
  }, [activeFile?.id, activeTool, canEditDesign, embedded, mode, pinMode]);

  const handleViewModeToggle = useCallback(() => {
    if (viewModeRef.current === "overview") {
      const screenId = overviewSelectedScreenIds[0] ?? activeFileId;
      if (screenId) focusOverviewScreen(screenId);
      return;
    }
    enterOverviewFromZoom();
  }, [
    activeFileId,
    enterOverviewFromZoom,
    focusOverviewScreen,
    overviewSelectedScreenIds,
  ]);

  const handleSidebarScreenSelect = useCallback(
    (screenId: string) => focusOverviewScreen(screenId),
    [focusOverviewScreen],
  );

  const handleReviewNodeRewrite = useCallback(
    (proposal: NodeRewriteProposal) => {
      explicitOverviewScreenSelectionRef.current = [proposal.fileId];
      pendingOverviewScreenSelectionRef.current = null;
      pendingOverviewLayerSelectionRef.current = null;
      clearPendingOverviewLayerSelectionTimer();
      setCreatedOverviewLayerSelection(null);
      viewModeRef.current = "overview";
      setViewMode("overview");
      setActiveFileId(proposal.fileId);
      setOverviewSelectedScreenIds([proposal.fileId]);
      setSelectedLayerIdsState([proposal.fileId]);
      setSelectedElement(null);
      setHoveredElement(null);
      setActiveTool("move");
      setMode("edit");
      setPinMode(false);
      setDrawMode(false);
      if (activeBreakpointWidthStateRef.current !== undefined) {
        handleBreakpointBarSelect(undefined);
      }
      const reviewFrame = getAllScreenFrameEntries({
        overviewScreens,
        canvasFrameGeometryById: exportCanvasFrameGeometryById,
        boardContentBounds,
        boardFileId,
      }).find((frame) => frame.id === proposal.fileId);
      const reviewBounds = reviewFrame
        ? getFrameGroupBounds([reviewFrame])
        : null;
      if (reviewBounds) {
        cameraCommandNonceRef.current += 1;
        setCameraCommand({
          fitBounds: reviewBounds,
          nonce: cameraCommandNonceRef.current,
          paddingScreenPx: 96,
        });
      }
    },
    [
      clearPendingOverviewLayerSelectionTimer,
      boardContentBounds,
      boardFileId,
      exportCanvasFrameGeometryById,
      handleBreakpointBarSelect,
      overviewScreens,
    ],
  );
  const handleReviewPendingScreen = useCallback(
    (screenId: string) => {
      const proposal = pendingNodeRewriteByFile.get(screenId);
      if (proposal) handleReviewNodeRewrite(proposal);
    },
    [handleReviewNodeRewrite, pendingNodeRewriteByFile],
  );

  const handleSidebarScreenOverview = useCallback(() => {
    const restoredOverviewSelection = getRestoredOverviewSelection();
    explicitOverviewScreenSelectionRef.current = restoredOverviewSelection;
    pendingOverviewScreenSelectionRef.current = null;
    pendingOverviewLayerSelectionRef.current = null;
    clearPendingOverviewLayerSelectionTimer();
    setCreatedOverviewLayerSelection(null);
    setOverviewSelectedScreenIds(restoredOverviewSelection);
    setSelectedLayerIdsState(restoredOverviewSelection);
    if (viewModeRef.current === "overview") {
      setDrawMode(false);
      setPinMode(false);
      setMode("edit");
      setSelectedElement(null);
      setHoveredElement(null);
      setActiveTool("move");
      return;
    }
    enterOverviewFromZoom();
  }, [
    clearPendingOverviewLayerSelectionTimer,
    enterOverviewFromZoom,
    getRestoredOverviewSelection,
  ]);

  const handleExitReviewCommentMode = useCallback(() => {
    setPinMode(false);
    setOverviewCommentPinRequest(null);
    setDrawMode(false);
    setActiveTool("move");
    setMode("edit");
  }, []);

  const handleOverviewCommentPin = useCallback(
    (canvasPoint: { x: number; y: number }) => {
      overviewCommentPinNonceRef.current += 1;
      setOverviewCommentPinRequest({
        nonce: overviewCommentPinNonceRef.current,
        canvasPoint,
      });
    },
    [],
  );

  const handlePinToolToggle = useCallback(() => {
    if (!canCommentDesign) return;
    if (pinMode) {
      handleExitReviewCommentMode();
      return;
    }
    showComments();
    setActiveInspectorTab("comments");
    if (viewMode !== "overview") {
      enterOverviewFromZoom("annotate");
    }
    setActiveTool("comment");
    setMode("annotate");
    setPinMode(true);
    setDrawMode(false);
  }, [
    canCommentDesign,
    enterOverviewFromZoom,
    handleExitReviewCommentMode,
    pinMode,
    showComments,
    viewMode,
  ]);

  const handleShowKeyboardShortcutsFromMenu = useCallback(() => {
    keyboardShortcutsReturnFocusRef.current = projectMenuTriggerRef.current;
    suppressProjectMenuReturnFocusRef.current = true;
    setMinimalUi(false);
    setUiHidden(false);
    setKeyboardShortcutsOpen(true);
  }, []);

  const handleCloseKeyboardShortcuts = useCallback(() => {
    setKeyboardShortcutsOpen(false);
    const returnFocusTarget = keyboardShortcutsReturnFocusRef.current;
    keyboardShortcutsReturnFocusRef.current = null;
    window.requestAnimationFrame(() => {
      if (returnFocusTarget?.isConnected) {
        returnFocusTarget.focus({ preventScroll: true });
      }
    });
  }, []);

  const handleToggleKeyboardShortcuts = useCallback(() => {
    if (keyboardShortcutsOpen) {
      handleCloseKeyboardShortcuts();
      return;
    }
    const activeElement = document.activeElement;
    keyboardShortcutsReturnFocusRef.current =
      activeElement instanceof HTMLElement ? activeElement : null;
    setMinimalUi(false);
    setUiHidden(false);
    setKeyboardShortcutsOpen(true);
  }, [handleCloseKeyboardShortcuts, keyboardShortcutsOpen]);

  useEffect(() => {
    if (embedded) return;
    const handleHelpHotkey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (!isShowKeyboardShortcutsHotkey(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      handleToggleKeyboardShortcuts();
    };
    window.addEventListener("keydown", handleHelpHotkey, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleHelpHotkey, {
        capture: true,
      });
  }, [embedded, handleToggleKeyboardShortcuts]);

  const handleEscapeHotkey = useCallback(() => {
    recordSelectionHistoryAroundChange(() =>
      runEscapeHotkey({
        activeBreakpointWidthStateRef,
        activeTool,
        cancelActiveEditorDrag,
        drawMode,
        enterOverviewFromZoom,
        focusedAnnotationSending,
        handleBreakpointBarSelect,
        handleCloseKeyboardShortcuts,
        handleExitFocusedDrawMode,
        handleExitOverviewDrawMode,
        keyboardShortcutsOpen,
        mode,
        overviewAnnotationSending,
        pinMode,
        selectedElement,
        setActiveTool,
        setDrawMode,
        setHoveredElement,
        setMode,
        setOverviewClearSelectionRequest,
        setOverviewSelectedScreenIds,
        setPinMode,
        setSelectedElement,
        setSelectedLayerIdsState,
        viewMode,
      }),
    );
  }, [
    activeTool,
    cancelActiveEditorDrag,
    drawMode,
    enterOverviewFromZoom,
    focusedAnnotationSending,
    handleBreakpointBarSelect,
    keyboardShortcutsOpen,
    handleCloseKeyboardShortcuts,
    handleExitFocusedDrawMode,
    handleExitOverviewDrawMode,
    mode,
    overviewAnnotationSending,
    pinMode,
    recordSelectionHistoryAroundChange,
    selectedElement,
    viewMode,
  ]);

  const SINGLE_MODE_TEXT_TAGS = useMemo(
    () =>
      new Set([
        "a",
        "button",
        "em",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "label",
        "li",
        "p",
        "span",
        "strong",
      ]),
    [],
  );
  const selectCodeLayerNodesForHotkey = useCallback(
    (
      fileId: string,
      nodes: CodeLayerNode[],
      expandedIds: readonly string[] = [],
    ): boolean => {
      if (nodes.length === 0) return false;
      explicitOverviewScreenSelectionRef.current = [];
      setActiveFileId(fileId);
      setOverviewSelectedScreenIds([]);
      setSelectedLayerIdsState(nodes.map((node) => node.id));
      setSelectedElement(
        elementInfoFromCodeLayerNode(nodes[nodes.length - 1]!),
      );
      setExpandedLayerIds((current) => {
        const next = new Set(current);
        next.add(fileId);
        expandedIds.forEach((expandedId) => next.add(expandedId));
        return next.size === current.length ? current : Array.from(next);
      });
      return true;
    },
    [],
  );
  const enterVectorEditForSelection = useCallback(
    (owner: { fileId: string; node: CodeLayerNode }): boolean => {
      const penNodesAttr = owner.node.dataAttributes["data-an-pen-nodes"];
      const primitive = owner.node.dataAttributes["data-an-primitive"];
      const isEditablePrimitive = ["ellipse", "rect", "rectangle"].includes(
        primitive ?? "",
      );
      if (!penNodesAttr && !isEditablePrimitive) return false;
      const originCanvas = getScreenFrameOriginCanvas({
        screenId: owner.fileId,
        overviewScreens,
        canvasFrameGeometryById,
        boardFileId,
      });
      const nodeId =
        owner.node.dataAttributes["data-agent-native-node-id"] ?? owner.node.id;
      if (!originCanvas) {
        toast.error(t("designEditor.toasts.vectorEditUnsupported"));
        return true;
      }
      const iframe = getOverviewFrameIframe(owner.fileId);
      const safeNodeId = nodeId.replace(/["\\]/g, "\\$&");
      const element = iframe?.contentDocument?.querySelector<Element>(
        `[data-agent-native-node-id="${safeNodeId}"]`,
      );
      if (!iframe || !element) {
        toast.error(t("designEditor.toasts.vectorEditUnsupported"));
        return true;
      }

      if (penNodesAttr) {
        const path = parsePenNodes(penNodesAttr);
        const elementTag = element.tagName.toLowerCase();
        const svg =
          elementTag === "svg"
            ? (element as SVGSVGElement)
            : elementTag === "path"
              ? (element as SVGPathElement).ownerSVGElement
              : null;
        const isPastedChildPath =
          elementTag === "path" &&
          svg?.getAttribute("data-an-primitive") === "pasted-svg";
        const renderOffset =
          owner.fileId === boardFileId
            ? boardRenderOffset(element)
            : { x: 0, y: 0 };
        const editable =
          path &&
          svg &&
          (elementTag === "svg" ||
            (isPastedChildPath && penPathScreenContentOffset(svg)))
            ? penPathForVectorEdit(svg, path, renderOffset)
            : null;
        if (!editable) {
          toast.error(t("designEditor.toasts.vectorEditUnsupported"));
          return true;
        }
        setVectorEditingState({
          screenId: owner.fileId,
          nodeId,
          layerId: owner.node.id,
          path: editable.path,
          selectedAnchorIndex: null,
          sourceOffset: editable.sourceOffset,
          primitiveSource: null,
        });
        return true;
      }

      if (element.tagName.toLowerCase() === "svg") {
        toast.error(t("designEditor.toasts.vectorEditUnsupported"));
        return true;
      }
      const source = primitiveVectorEditSource(element as HTMLElement);
      if (!source) {
        toast.error(t("designEditor.toasts.vectorEditUnsupported"));
        return true;
      }
      setVectorEditingState({
        screenId: owner.fileId,
        nodeId,
        layerId: owner.node.id,
        path: source.path,
        selectedAnchorIndex: null,
        sourceOffset: { x: 0, y: 0 },
        primitiveSource: { geometry: source.geometry, fill: source.fill },
      });
      return true;
    },
    [
      boardFileId,
      canvasFrameGeometryById,
      getOverviewFrameIframe,
      overviewScreens,
      t,
    ],
  );
  const handleEnterHotkey = useCallback(
    () =>
      runEnterHotkey({
        SINGLE_MODE_TEXT_TAGS,
        activeFile,
        activeFileId,
        boardFileId,
        codeLayerOwnerByNodeIdRef,
        enterVectorEditForSelection,
        getProjectionContentForScreen,
        overviewSelectedScreenIds,
        selectedElement,
        selectCodeLayerNodesForHotkey,
        selectedLayerIdsState,
        setActiveFileId,
        setSelectedLayerIdsState,
        viewMode,
      }),
    [
      SINGLE_MODE_TEXT_TAGS,
      activeFile?.id,
      activeFileId,
      boardFileId,
      enterVectorEditForSelection,
      getProjectionContentForScreen,
      overviewSelectedScreenIds,
      selectedElement,
      selectCodeLayerNodesForHotkey,
      selectedLayerIdsState,
      viewMode,
    ],
  );

  useEffect(() => {
    const getPreviewIframe = () =>
      document.querySelector(
        // i18n-ignore: DOM selector helper.
        "iframe[data-design-preview-iframe]",
      ) as HTMLIFrameElement | null;

    const updateIframePointerEvents = () => {
      const iframe = getPreviewIframe();
      if (!iframe) return;
      const wrappers = document.body.querySelectorAll(
        "[data-radix-popper-content-wrapper]",
      );
      const hasOpenPopperOverlay = Array.from(wrappers).some((wrapper) =>
        isRadixOverlayOpen(wrapper),
      );
      const hasOpenOverlay =
        hasOpenPopperOverlay ||
        Boolean(
          document.querySelector(
            "[data-radix-portal] [data-state='open']:not([data-agent-native-tooltip])",
          ),
        );
      iframe.style.pointerEvents = hasOpenOverlay ? "none" : "";
    };

    const observer = new MutationObserver(updateIframePointerEvents);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });

    return () => {
      observer.disconnect();
      const iframe = getPreviewIframe();
      if (iframe) iframe.style.pointerEvents = "";
    };
  }, []);

  const handleCycleSibling = useCallback(
    (backwards: boolean) => {
      const selectedId =
        selectedLayerIdsState[selectedLayerIdsState.length - 1];
      if (!selectedId) return;
      const owner = codeLayerOwnerByNodeIdRef.current.get(selectedId);
      if (!owner) return;
      const siblingOrder = findCodeLayerSiblingOrder(owner.tree, selectedId);
      if (!siblingOrder || siblingOrder.siblingIds.length < 2) return;
      const nextIndex =
        (siblingOrder.index +
          (backwards ? -1 : 1) +
          siblingOrder.siblingIds.length) %
        siblingOrder.siblingIds.length;
      const nextId = siblingOrder.siblingIds[nextIndex];
      if (!nextId) return;
      const nextOwner = codeLayerOwnerByNodeIdRef.current.get(nextId);
      if (!nextOwner || nextOwner.fileId !== owner.fileId) return;
      selectCodeLayerNodesForHotkey(
        nextOwner.fileId,
        [nextOwner.node],
        collectCodeLayerAncestors(nextOwner.tree, nextId),
      );
    },
    [selectCodeLayerNodesForHotkey, selectedLayerIdsState],
  );

  const handleSelectParentLayer = useCallback(() => {
    const selectedId = selectedLayerIdsState[selectedLayerIdsState.length - 1];
    if (!selectedId) return;
    const owner = codeLayerOwnerByNodeIdRef.current.get(selectedId);
    if (!owner?.node.parentId) return;
    const parentOwner = codeLayerOwnerByNodeIdRef.current.get(
      owner.node.parentId,
    );
    if (!parentOwner || parentOwner.fileId !== owner.fileId) return;
    if (!hasSelectableCodeLayerParent({ parentNode: parentOwner.node })) {
      return;
    }
    selectCodeLayerNodesForHotkey(
      parentOwner.fileId,
      [parentOwner.node],
      collectCodeLayerAncestors(parentOwner.tree, parentOwner.node.id),
    );
  }, [selectCodeLayerNodesForHotkey, selectedLayerIdsState]);
  const handleAbortPendingVisualStyles = useCallback(() => {
    if (
      pendingVisualStyleEdits.length === 0 &&
      pendingLiveNonStyleEdits.length === 0
    ) {
      return;
    }
    requestPendingVisualStyleRevert(pendingVisualStyleEdits);
    requestPendingLiveNonStyleRevert(pendingLiveNonStyleEdits);
    clearPendingLiveEditState();
    window.setTimeout(() => handleModeChange("edit"), 50);
    toast.success(t("designEditor.pendingVisualStyles.abortedToast"));
  }, [
    clearPendingLiveEditState,
    handleModeChange,
    pendingLiveNonStyleEdits,
    pendingVisualStyleEdits,
    requestPendingLiveNonStyleRevert,
    requestPendingVisualStyleRevert,
    t,
  ]);
  const handleOverviewEditBreakpoint = useCallback(
    (screenId: string, _widthPx: number) => {
      handleOverviewFrameAction(screenId);
    },
    [handleOverviewFrameAction],
  );

  return {
    interactZoom,
    keyboardShortcutsOpen,
    projectMenuTriggerRef,
    suppressProjectMenuReturnFocusRef,
    overviewCommentPinRequest,
    handleUndo,
    handleRedo,
    responsiveInteractActive,
    suppressOverviewPopForExplicitZoomRef,
    handleModeChange,
    handleExitResponsiveInteract,
    handleOverviewFrameAction,
    handleViewModeToggle,
    handleSidebarScreenSelect,
    handleReviewNodeRewrite,
    handleReviewPendingScreen,
    handleSidebarScreenOverview,
    handleExitReviewCommentMode,
    handleOverviewCommentPin,
    handlePinToolToggle,
    handleShowKeyboardShortcutsFromMenu,
    handleCloseKeyboardShortcuts,
    handleToggleKeyboardShortcuts,
    handleEscapeHotkey,
    handleEnterHotkey,
    handleCycleSibling,
    handleSelectParentLayer,
    handleAbortPendingVisualStyles,
    handleOverviewEditBreakpoint,
  };
}

export type EditorModes = ReturnType<typeof useEditorModes>;
