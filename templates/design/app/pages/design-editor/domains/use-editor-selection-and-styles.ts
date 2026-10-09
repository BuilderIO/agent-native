import type { ScrubRelativeExpression } from "@agent-native/toolkit/design-tweaks";
import {
  getBreakpointOverrideState,
  removeBreakpointMediaDeclaration,
} from "@shared/breakpoint-media";
import {
  applyVisualEdit,
  buildCodeLayerProjection,
  type CodeLayerProjection,
} from "@shared/code-layer";
import { linkedComponentRootForNode } from "@shared/component-links";
import type { InteractionState } from "@shared/interaction-states";
import {
  breakpointUpperBoundPx,
  utilityStem,
} from "@shared/responsive-classes";
import {
  isRunningAppSourceType,
  normalizeDesignSourceType,
} from "@shared/source-mode";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { toast } from "sonner";

import { type CanvasContextMenuHandle } from "@/components/design/CanvasContextMenu";
import type { IframeContextMenuPayload } from "@/components/design/design-canvas/iframe-events";
import { recordDesignPerformance } from "@/components/design/design-trace";
import { type DesignExtensionSlotContext } from "@/components/design/DesignExtensionsPanel";
import { sizeNeedsMeasurement } from "@/components/design/edit-panel/element-classification";
import type { CapturedStyleTarget } from "@/components/design/edit-panel/style-change-types";
import {
  mergeRotationValue,
  parseRotationValue,
} from "@/components/design/edit-panel/transform-helpers";
import { nextTextDecorationLineValue } from "@/components/design/edit-panel/typography-helpers";
import { type StyleChangeMeta } from "@/components/design/EditPanel";
import { sendLinkedScreenPreviewInteractionStateStyle } from "@/components/design/multi-screen/linked-screen-preview";
import {
  designPreviewWindows,
  requestSelectionMeasurement,
} from "@/components/design/multi-screen/measure-selection";
import { isWheelCameraGestureActive } from "@/components/design/multi-screen/wheel-gesture-state";
import type {
  CanvasLayerHitCandidate,
  ElementInfo,
  GridGroupStructureMove,
  ElementSelectionIntent,
} from "@/components/design/types";
import { type RepromptDraftRequest } from "@/components/visual-editor";
import type { UploadedFont } from "@/lib/font-upload";

import {
  canonicalizeElementInfoFromProjection,
  type EffectiveCodeLayerState,
  resolveCodeLayerNodeFromElementInfo,
  ensureUploadedFontFaceInHtml,
  type SelectedLayerTarget,
} from "../code-layer-state";
import { runCommitRelativeStyleDeltaToSelectedLayers } from "../commands/commit-relative-style-delta-to-selected-layers";
import {
  runCommitStylesToSelectedLayers,
  type CapturedStyleTargetCommitOptions,
} from "../commands/commit-styles-to-selected-layers";
import { runCommitVisualStyles } from "../commands/commit-visual-styles";
import { runFrameSelection } from "../commands/frame-selection";
import { runIframeContextMenu } from "../commands/iframe-context-menu";
import { type LinkedComponentEdit } from "../commands/linked-component-mutation";
import {
  commitPendingLiveStructureEdits,
  preparePendingLiveStructureEdit,
} from "../commands/record-pending-live-structure-edit";
import { runScreenElementSelect } from "../commands/screen-element-select";
import { runStyleChange } from "../commands/style-change";
import { runStylesChange } from "../commands/styles-change";
import { runTextContentChange } from "../commands/text-content-change";
import {
  planVisualGridGroupStructureChange,
  resolveGridGroupLinkedComponentTarget,
} from "../commands/visual-structure-change";
import { isSupersededSelectionEcho } from "../editor-helpers";
import {
  getPersistedContentHostSyncOptions,
  resolveOptimisticTextDecorationLine,
  type OptimisticTextDecorationLineEntry,
} from "../editor-state";
import { type GeometryHistorySelection } from "../history";
import {
  applyInteractionStateStyleCommit,
  pendingVisualStyleGestureIdForPhase,
  type PendingRelativeStyleOperation,
} from "../pending-edits";
import { isUserOriginatedSelectionIntent } from "../selection-state";
import { preparedSourceProjection } from "../source-publication";
import type { EditorActiveScreenAndGeometry } from "./use-editor-active-screen-and-geometry";
import type { EditorCanvasAndScreens } from "./use-editor-canvas-and-screens";
import type { EditorContentAndComponents } from "./use-editor-content-and-components";
import type { EditorCore } from "./use-editor-core";
import type { EditorFilesAndSaving } from "./use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "./use-editor-generation-and-access";
import type { EditorHistory } from "./use-editor-history";
import type { EditorLiveEditsAndPresence } from "./use-editor-live-edits-and-presence";
import type { EditorToolsAndVectors } from "./use-editor-tools-and-vectors";

export function useEditorSelectionAndStyles({
  editorCore,
  editorHistory,
  editorGenerationAndAccess,
  editorFilesAndSaving,
  editorActiveScreenAndGeometry,
  editorCanvasAndScreens,
  editorLiveEditsAndPresence,
  editorContentAndComponents,
  editorToolsAndVectors,
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
}) {
  const {
    t,
    id,
    shellMode,
    embedded,
    embedChromeRequested,
    mode,
    setMode,
    activeTool,
    setActiveTool,
    viewMode,
    setViewMode,
    viewModeRef,
    selectedElement,
    setSelectedElement,
    selectedElementRef,
    liveRoutePathsByScreenIdRef,
    pendingStructureRedoReplayTimerRef,
    cancelPendingStructureVerification,
    textEditingState,
    setHoveredElement,
    activeFileId,
    setActiveFileId,
  } = editorCore;
  const {
    setPendingLiveNonStyleEdits,
    pendingLiveNonStyleEditsRef,
    pendingVisualStyleRedoStackRef,
    pendingLiveNonStyleUndoStackRef,
    pendingLiveNonStyleRedoStackRef,
    pendingStructureRedoReplayRef,
    selectedLayerIdsState,
    setSelectedLayerIdsState,
    selectedScreenStyleChangeRef,
    renderedElementInfoByLayerKeyRef,
    invalidateRenderedElementInfo,
    rehydrateRenderedInfoAfterPreview,
    revealLayer,
    overviewSelectedScreenIds,
    setOverviewSelectedScreenIds,
    createdOverviewLayerSelection,
    setCreatedOverviewLayerSelection,
    pendingOverviewScreenSelectionRef,
    pendingOverviewLayerSelectionRef,
    clearPendingOverviewLayerSelectionTimer,
    setShaderFillPreview,
    activeBreakpointWidthState,
    activeBreakpointWidthStateRef,
    undoManagerRef,
    linkedComponentMutationQueueRef,
    contentUndoStackRef,
    selectedLayerIdsStateRef,
    explicitOverviewScreenSelectionRef,
    recordContentHistoryEntry,
    recordLocalContentHistoryEntry,
    recordLocalContentHistoryChangeFallback,
    prepareTextCreationFinalization,
  } = editorHistory;
  const {
    recordSelectionHistoryAroundChange,
    pendingQuestions,
    design,
    canEditDesign,
  } = editorGenerationAndAccess;
  const {
    setPatchProof,
    queueFileContentSave,
    tweakSelections,
    files,
    codeLayerSourceForScreen,
    liveScreenSnapshotsById,
    runtimeLayerSnapshotsById,
    designSourceType,
    boardFileId,
    overviewScreens,
    updateLiveScreenSnapshotContent,
  } = editorFilesAndSaving;
  const {
    responsiveEditScopeRef,
    activeFile,
    designBreakpoints,
    handleBreakpointBarSelect,
    activeScreenBaseWidthPx,
    overviewCanvasZoom,
    activeCanvasSourceType,
  } = editorActiveScreenAndGeometry;
  const activeBreakpointUpperBoundAtEvent = useCallback(() => {
    const activeWidthPx = activeBreakpointWidthStateRef.current;
    return activeWidthPx == null
      ? null
      : breakpointUpperBoundPx(
          designBreakpoints.map((breakpoint) => breakpoint.widthPx),
          activeWidthPx,
          activeScreenBaseWidthPx,
        );
  }, [
    activeBreakpointWidthStateRef,
    activeScreenBaseWidthPx,
    designBreakpoints,
  ]);
  const {
    localhostConnectionRootPathByIdRef,
    setHoveredElementScreenId,
    recordPendingHistoryEntry,
    ydoc,
    isSynced,
    setCollabContent,
    setCollabContentFileId,
    lastLocalContentRef,
    latestActiveContentRef,
    activeContent,
    fileContentById,
    getScreenContent,
    getProjectionContentForScreen,
    recordPendingVisualStyleEdit,
    recordPendingLiveTextEdit,
  } = editorCanvasAndScreens;
  const {
    setContentRenderRevision,
    zoom,
    canvasContainerRef,
    activeProjectionContent,
    activeCodeLayerProjection,
    selectedCodeLayerNode,
    selectedCanvasSelectorCandidates,
    selectedCanvasSelector,
    liveScreenIds,
    canEditLiveScreen,
    replacePreviewContent,
  } = editorLiveEditsAndPresence;
  const {
    clearShaderFillPreview,
    contentHistorySelectionAfterRef,
    suppressContentHistoryRef,
    canApplyContentEdit,
    upsertMotionKeyframesFromStyles,
    applyLocalContentUpdate,
    applyFileContentUpdate,
  } = editorContentAndComponents;
  const { selectionRevisionRef, selectedScreenIds, shiftKeyHeldRef } =
    editorToolsAndVectors;

  const pendingLiveStyleGestureStateRef = useRef({
    sequence: 0,
    activeId: null as string | null,
  });
  const selectedLayerTargetsRef = useRef<SelectedLayerTarget[]>([]);
  const routeSelectedScreenStyleChange = useCallback(
    (
      screenId: string,
      selector: string,
      styles: Record<string, string>,
      elementInfo?: ElementInfo,
      metadata?: StyleChangeMeta,
    ) =>
      selectedScreenStyleChangeRef.current?.(
        screenId,
        selector,
        styles,
        elementInfo,
        metadata,
      ),
    [],
  );
  const commitStylesToSelectedLayersRef = useRef<
    (
      styles: Record<string, string>,
      targets?: SelectedLayerTarget[],
      capturedOptions?: CapturedStyleTargetCommitOptions,
    ) => boolean
  >(() => false);
  const commitCapturedStyleTargetsRef = useRef<
    (
      styles: Record<string, string>,
      targets: CapturedStyleTarget[],
      interactionState?: InteractionState,
    ) => void
  >(() => {});
  const effectiveCodeLayerStateRef = useRef<EffectiveCodeLayerState>({
    lockedIds: new Set(),
    hiddenIds: new Set(),
  });
  const lastDuplicateTransformRef = useRef<{
    rootNodeIds: string[];
    dx: number;
    dy: number;
  } | null>(null);
  const [repromptDraftRequest, setRepromptDraftRequest] =
    useState<RepromptDraftRequest | null>(null);

  const canvasContextMenuRef = useRef<CanvasContextMenuHandle | null>(null);
  const [canvasLayerHitCandidates, setCanvasLayerHitCandidates] = useState<
    CanvasLayerHitCandidate[]
  >([]);
  const canEditActiveVisualScreen =
    canEditDesign || canEditLiveScreen(activeFile?.id ?? activeFileId);
  const nonActiveProjectionCacheRef = useRef<
    Map<string, { contentRef: string; projection: CodeLayerProjection }>
  >(new Map());
  const getCodeLayerProjectionForScreen = useCallback(
    (screenId: string) => {
      if (!fileContentById.has(screenId)) return null;
      const content = getProjectionContentForScreen(screenId);
      const cache = nonActiveProjectionCacheRef.current;
      if (screenId === activeFile?.id) {
        cache.set(screenId, {
          contentRef: content,
          projection: activeCodeLayerProjection,
        });
        return activeCodeLayerProjection;
      }
      const cached = cache.get(screenId);
      if (cached && cached.contentRef === content) return cached.projection;
      const source = codeLayerSourceForScreen(screenId);
      let projection = preparedSourceProjection(screenId, content, source);
      if (!projection) {
        recordDesignPerformance("buildCodeLayerProjection");
        projection = buildCodeLayerProjection(content, { source });
      }
      cache.set(screenId, { contentRef: content, projection });
      return projection;
    },
    [
      activeCodeLayerProjection,
      activeFile?.id,
      codeLayerSourceForScreen,
      fileContentById,
      getProjectionContentForScreen,
    ],
  );
  const applyLinkedComponentEdit = useCallback(
    (
      fileId: string,
      nodeId: string,
      edit: LinkedComponentEdit,
      selectionBefore?: GeometryHistorySelection,
      onApplied?: () => void,
    ) => {
      const current = linkedComponentMutationQueueRef.current;
      if (!id || current?.designId !== id) {
        toast.error(t("designEditor.patchProof.selectorMissing"), {
          duration: 4000,
        });
        return;
      }
      void current.queue
        .enqueue(fileId, nodeId, edit, selectionBefore, onApplied)
        .catch(() => {});
    },
    [id, t],
  );

  const shouldPreserveBlockedOverviewLayerSelectionRef = useRef<
    (screenId: string) => boolean
  >(() => false);

  const handleAssetInserted = useCallback(
    (selection: {
      fileId?: string;
      nodeId?: string;
      selector?: string;
      title?: string;
    }) => {
      explicitOverviewScreenSelectionRef.current = [];
      if (viewModeRef.current === "single") {
        viewModeRef.current = "overview";
        setViewMode("overview");
      }
      if (selection.fileId) {
        setActiveFileId(selection.fileId);
        setOverviewSelectedScreenIds([selection.fileId]);
      }
      if (selection.nodeId) {
        setSelectedLayerIdsState([selection.nodeId]);
      }
      if (selection.selector || selection.nodeId) {
        setSelectedElement({
          tagName: "section",
          sourceId: selection.nodeId,
          selector:
            selection.selector ??
            `[data-agent-native-node-id="${selection.nodeId}"]`,
          classes: [],
          computedStyles: {},
          boundingRect: { x: 0, y: 0, width: 0, height: 0 },
          textContent: selection.title,
          isFlexChild: false,
          isFlexContainer: false,
        });
      }
      setHoveredElement(null);
      setHoveredElementScreenId(null);
      setActiveTool("move");
      setMode("edit");
    },
    [],
  );

  const designExtensionContext = useMemo<DesignExtensionSlotContext>(
    () => ({
      designId: id ?? "",
      designTitle: design?.title ?? null,
      activeFileId: activeFile?.id ?? null,
      activeFilename: activeFile?.filename ?? null,
      activeFileUpdatedAt: activeFile?.updatedAt ?? null,
      activeContent,
      viewMode,
      zoom,
      screens: files.map((file) => ({
        id: file.id,
        filename: file.filename,
        fileType: file.fileType,
      })),
      selectedScreenIds,
      selectedElement,
      mode,
      activeTool,
      tweakValues: tweakSelections,
      onShaderFillPreview: (_descriptor, css) => {
        setShaderFillPreview({
          selector: selectedElement?.selector ?? undefined,
          nodeId:
            selectedElement?.sourceId ?? selectedCodeLayerNode?.id ?? undefined,
          css,
        });
      },
      onShaderFillPreviewClear: clearShaderFillPreview,
      onShaderFillApplied: (fileId, content, updatedAt) => {
        applyFileContentUpdate(
          fileId,
          content,
          getPersistedContentHostSyncOptions({
            fileId,
            activeFileId: activeFile?.id ?? null,
            updatedAt,
          }),
        );
      },
      onAssetInserted: handleAssetInserted,
    }),
    [
      activeContent,
      activeFile?.filename,
      activeFile?.fileType,
      activeFile?.id,
      activeFile?.updatedAt,
      activeTool,
      applyFileContentUpdate,
      clearShaderFillPreview,
      design?.title,
      files,
      handleAssetInserted,
      id,
      mode,
      overviewSelectedScreenIds,
      selectedElement,
      selectedCodeLayerNode?.id,
      selectedScreenIds,
      tweakSelections,
      viewMode,
      zoom,
    ],
  );

  const handleScreenElementSelect = useCallback(
    (
      screenId: string,
      info: ElementInfo,
      intent?: ElementSelectionIntent,
      options: {
        persistPendingNodeId?: boolean;
        breakpointWidthPx?: number;
      } = {},
    ) => {
      const run = () => {
        if (
          isUserOriginatedSelectionIntent(intent) &&
          !(intent?.additive || intent?.shiftKey || shiftKeyHeldRef.current)
        ) {
          explicitOverviewScreenSelectionRef.current = [];
        }
        runScreenElementSelect(
          {
            activeBreakpointWidthStateRef,
            applyFileContentUpdate,
            clearPendingOverviewLayerSelectionTimer,
            createdOverviewLayerSelection,
            getCodeLayerProjectionForScreen,
            getScreenContent,
            handleBreakpointBarSelect,
            id,
            liveScreenIds,
            pendingOverviewLayerSelectionRef,
            pendingOverviewScreenSelectionRef,
            renderedElementInfoByLayerKeyRef,
            revealLayer,
            selectedElementRef,
            selectedLayerIdsState,
            setActiveFileId,
            setActiveTool,
            setCreatedOverviewLayerSelection,
            setHoveredElement,
            setHoveredElementScreenId,
            setMode,
            setOverviewSelectedScreenIds,
            setSelectedElement,
            setSelectedLayerIdsState,
            shouldPreserveBlockedOverviewLayerSelectionRef,
            t,
            viewModeRef,
          },
          screenId,
          info,
          intent,
          options,
        );
        rehydrateRenderedInfoAfterPreview();
      };
      if (!isUserOriginatedSelectionIntent(intent)) {
        run();
        return;
      }
      selectionRevisionRef.current += 1;
      recordSelectionHistoryAroundChange(run);
    },
    [
      activeFile?.id,
      applyFileContentUpdate,
      clearPendingOverviewLayerSelectionTimer,
      createdOverviewLayerSelection,
      recordSelectionHistoryAroundChange,
      getCodeLayerProjectionForScreen,
      getScreenContent,
      handleBreakpointBarSelect,
      id,
      liveScreenIds,
      rehydrateRenderedInfoAfterPreview,
      revealLayer,
      selectedLayerIdsState,
      t,
    ],
  );

  const handleElementSelect = useCallback(
    (info: ElementInfo, intent?: ElementSelectionIntent) => {
      const screenId = activeFile?.id ?? activeFileId;
      if (screenId) {
        if (
          !intent &&
          isSupersededSelectionEcho(info, selectedElementRef.current)
        ) {
          return;
        }
        handleScreenElementSelect(screenId, info, intent);
        return;
      }
      explicitOverviewScreenSelectionRef.current = [];
      setSelectedElement(
        canonicalizeElementInfoFromProjection(activeCodeLayerProjection, info),
      );
      if (viewModeRef.current === "overview") {
        setOverviewSelectedScreenIds([]);
      }
    },
    [
      activeCodeLayerProjection,
      activeFile?.id,
      activeFileId,
      handleScreenElementSelect,
    ],
  );

  const handleScreenElementDblClickText = useCallback(
    (screenId: string, info: ElementInfo) => {
      explicitOverviewScreenSelectionRef.current = [];
      pendingOverviewScreenSelectionRef.current = null;
      pendingOverviewLayerSelectionRef.current = null;
      clearPendingOverviewLayerSelectionTimer();
      setCreatedOverviewLayerSelection(null);
      const projection = getCodeLayerProjectionForScreen(screenId);
      const canonical = projection
        ? canonicalizeElementInfoFromProjection(projection, info, screenId)
        : info;
      const node = projection
        ? resolveCodeLayerNodeFromElementInfo(projection, canonical)
        : null;
      setActiveFileId(screenId);
      setSelectedElement(canonical);
      setHoveredElement(null);
      setHoveredElementScreenId(null);
      setSelectedLayerIdsState(node ? [node.id] : []);
      if (viewModeRef.current === "overview") {
        setOverviewSelectedScreenIds([]);
      }
      setMode("edit");
    },
    [
      clearPendingOverviewLayerSelectionTimer,
      createdOverviewLayerSelection,
      getCodeLayerProjectionForScreen,
    ],
  );

  const handleElementDblClickText = useCallback(
    (info: ElementInfo) => {
      const screenId = activeFile?.id ?? activeFileId;
      if (screenId) {
        handleScreenElementDblClickText(screenId, info);
        return;
      }
      explicitOverviewScreenSelectionRef.current = [];
      setSelectedElement(
        canonicalizeElementInfoFromProjection(activeCodeLayerProjection, info),
      );
      setMode("edit");
    },
    [
      activeCodeLayerProjection,
      activeFile?.id,
      activeFileId,
      handleScreenElementDblClickText,
    ],
  );

  const handleScreenElementHover = useCallback(
    (screenId: string, info: ElementInfo | null) => {
      if (isWheelCameraGestureActive()) return;
      const projection = getCodeLayerProjectionForScreen(screenId);
      const nextHovered = info
        ? projection
          ? canonicalizeElementInfoFromProjection(projection, info)
          : info
        : null;
      setHoveredElement((prev) => {
        if (prev === nextHovered) return prev;
        if (
          prev &&
          nextHovered &&
          prev.selector === nextHovered.selector &&
          prev.sourceId === nextHovered.sourceId &&
          prev.tagName === nextHovered.tagName
        ) {
          return prev;
        }
        return nextHovered;
      });
      setHoveredElementScreenId((prev) => {
        const next = info ? screenId : null;
        return prev === next ? prev : next;
      });
    },
    [getCodeLayerProjectionForScreen],
  );

  const handleElementHover = useCallback(
    (info: ElementInfo | null) => {
      const screenId = activeFile?.id ?? activeFileId;
      if (screenId) {
        handleScreenElementHover(screenId, info);
        return;
      }
      setHoveredElement(
        info
          ? canonicalizeElementInfoFromProjection(
              activeCodeLayerProjection,
              info,
            )
          : null,
      );
      setHoveredElementScreenId(info ? screenId : null);
    },
    [
      activeCodeLayerProjection,
      activeFile?.id,
      activeFileId,
      handleScreenElementHover,
    ],
  );

  useEffect(() => {
    if (
      shellMode ||
      (embedded && !embedChromeRequested) ||
      (pendingQuestions && pendingQuestions.length > 0)
    ) {
      return;
    }
    const handleForwardedSpaceKeyUp = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; code?: unknown } | null;
      if (!data || data.type !== "design-hotkey-up" || data.code !== "Space") {
        return;
      }
      const keyupEvent = new KeyboardEvent("keyup", {
        key: " ",
        code: "Space",
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(keyupEvent, "__agentNativeIframeHotkey", {
        value: true,
      });
      window.dispatchEvent(keyupEvent);
    };
    window.addEventListener("message", handleForwardedSpaceKeyUp);
    return () =>
      window.removeEventListener("message", handleForwardedSpaceKeyUp);
  }, [embedded, embedChromeRequested, pendingQuestions, shellMode]);

  const handleIframeContextMenu = useCallback(
    (payload: IframeContextMenuPayload) =>
      runIframeContextMenu(
        {
          activeFile,
          activeFileId,
          boardFileId,
          canvasContainerRef,
          canvasContextMenuRef,
          getCodeLayerProjectionForScreen,
          handleScreenElementSelect,
          overviewCanvasZoom,
          setCanvasLayerHitCandidates,
          viewMode,
          zoom,
        },
        payload,
      ),
    [
      activeFile?.id,
      activeFileId,
      boardFileId,
      getCodeLayerProjectionForScreen,
      handleScreenElementSelect,
      overviewCanvasZoom,
      viewMode,
      zoom,
    ],
  );

  const handleContextMenuSelectLayer = useCallback(
    (candidate: CanvasLayerHitCandidate) => {
      const screenId = candidate.screenId ?? activeFile?.id ?? activeFileId;
      if (!screenId) return;
      handleScreenElementSelect(screenId, candidate.info, undefined, {
        persistPendingNodeId: false,
        breakpointWidthPx: candidate.breakpointWidthPx,
      });
    },
    [activeFile?.id, activeFileId, handleScreenElementSelect],
  );

  const handleRepromptDraftConsumed = useCallback((nonce: number) => {
    setRepromptDraftRequest((current) =>
      current?.nonce === nonce ? null : current,
    );
  }, []);

  const measureTargetSelector =
    selectedElement && sizeNeedsMeasurement(selectedElement.computedStyles)
      ? (selectedElement.runtimeSelector ?? selectedElement.selector ?? null)
      : null;
  const measureTargetScreenId = activeFile?.id ?? "";
  const measureTargetKey = measureTargetSelector
    ? [
        measureTargetScreenId,
        measureTargetSelector,
        selectedElement?.computedStyles.width ?? "",
        selectedElement?.computedStyles.height ?? "",
      ].join("|")
    : null;
  useEffect(() => {
    if (!measureTargetSelector || !measureTargetKey) return;
    let cancelled = false;
    void requestSelectionMeasurement({
      targetWindows: designPreviewWindows,
      screenId: measureTargetScreenId,
      selector: measureTargetSelector,
    }).then((measured) => {
      if (cancelled || !measured) return;
      setSelectedElement((prev) =>
        prev &&
        (prev.runtimeSelector ?? prev.selector) === measureTargetSelector
          ? {
              ...prev,
              boundingRect: measured.boundingRect,
              computedStyles: measured.computedStyles,
              inlineStyles: measured.inlineStyles,
              authoredSizeStyles: measured.authoredSizeStyles,
            }
          : prev,
      );
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureTargetKey]);

  const pendingLiveStyleGestureIdForPhase = useCallback(
    (phase?: StyleChangeMeta["phase"]) => {
      return pendingVisualStyleGestureIdForPhase(
        pendingLiveStyleGestureStateRef.current,
        phase,
        isRunningAppSourceType(activeCanvasSourceType) &&
          selectedLayerTargetsRef.current.length > 1,
      );
    },
    [activeCanvasSourceType],
  );

  const commitVisualStyles = useCallback(
    (
      selector: string,
      styles: Record<string, string>,
      options: {
        runtimeApplied?: boolean;
        elementInfo?: ElementInfo;
        originalStyles?: Record<string, string>;
        preserveSelection?: boolean;
        routePath?: string;
        pendingUndoGestureId?: string;
      } = {},
    ) => {
      const routePath =
        options.routePath ??
        (isRunningAppSourceType(activeCanvasSourceType)
          ? liveRoutePathsByScreenIdRef.current[activeFile?.id ?? ""]
          : undefined);
      runCommitVisualStyles(
        {
          activeBreakpointUpperBoundPx: activeBreakpointUpperBoundAtEvent(),
          activeBreakpointWidthStateRef,
          activeCanvasSourceType,
          activeCodeLayerProjection,
          activeFile,
          activeProjectionContent,
          applyLinkedComponentEdit,
          canApplyContentEdit,
          canEditDesign: canEditActiveVisualScreen,
          commitVisualStyles,
          getScreenContent,
          isSynced,
          lastDuplicateTransformRef,
          lastLocalContentRef,
          latestActiveContentRef,
          liveScreenSnapshotsById,
          onNoRenderedBox: () =>
            toast.error(t("designEditor.patchProof.noRenderedBox"), {
              id: "design-no-rendered-box",
              duration: 4000,
            }),
          queueFileContentSave,
          recordContentHistoryEntry,
          recordLocalContentHistoryChangeFallback,
          recordLocalContentHistoryEntry,
          recordPendingVisualStyleEdit,
          replacePreviewContent,
          responsiveEditScopeRef,
          selectedElement,
          selectedElementRef,
          setCollabContent,
          setCollabContentFileId,
          setContentRenderRevision,
          setPatchProof,
          setSelectedElement,
          setSelectedLayerIdsState,
          suppressContentHistoryRef,
          t,
          undoManagerRef,
          updateLiveScreenSnapshotContent,
          upsertMotionKeyframesFromStyles,
          viewModeRef,
          ydoc,
        },
        selector,
        styles,
        routePath ? { ...options, routePath } : options,
      );
      invalidateRenderedElementInfo();
    },
    [
      activeFile,
      activeBreakpointUpperBoundAtEvent,
      activeCanvasSourceType,
      activeCodeLayerProjection,
      activeProjectionContent,
      applyLinkedComponentEdit,
      canApplyContentEdit,
      canEditActiveVisualScreen,
      getScreenContent,
      liveScreenSnapshotsById,
      queueFileContentSave,
      recordContentHistoryEntry,
      recordLocalContentHistoryEntry,
      recordLocalContentHistoryChangeFallback,
      recordPendingVisualStyleEdit,
      replacePreviewContent,
      selectedElement,
      t,
      updateLiveScreenSnapshotContent,
      upsertMotionKeyframesFromStyles,
      ydoc,
      isSynced,
      invalidateRenderedElementInfo,
    ],
  );

  const commitStylesToSelectedLayers = useCallback(
    (
      styles: Record<string, string>,
      targets?: SelectedLayerTarget[],
      capturedOptions?: CapturedStyleTargetCommitOptions,
      pendingUndoGestureId?: string,
    ) => {
      const canEditSelectedVisualLayers =
        canEditDesign ||
        (selectedLayerTargetsRef.current.length > 0 &&
          selectedLayerTargetsRef.current.every((target) =>
            canEditLiveScreen(target.fileId),
          ));
      return runCommitStylesToSelectedLayers(
        {
          activeCanvasSourceType,
          activeBreakpointUpperBoundPx: activeBreakpointUpperBoundAtEvent(),
          activeBreakpointWidthStateRef,
          activeContent,
          activeFile,
          applyFileContentUpdate,
          applyLinkedComponentEdit,
          commitVisualStyles,
          canEditDesign: canEditSelectedVisualLayers,
          effectiveCodeLayerStateRef,
          getScreenContent,
          getProjectionContentForScreen,
          lastLocalContentRef,
          latestActiveContentRef,
          responsiveEditScopeRef,
          selectedLayerTargetsRef,
          selectedLayerIdsStateRef,
          reportLinkedEditUnavailable: (reason) =>
            toast.error(
              t(
                {
                  scope:
                    "designEditor.componentInstances.linkedEditScopeUnsupported",
                  source:
                    "designEditor.componentInstances.linkedEditSourceUnsupported",
                  targets:
                    "designEditor.componentInstances.linkedEditTargetsUnavailable",
                }[reason],
              ),
            ),
          setSelectedElement,
        },
        styles,
        targets,
        capturedOptions,
        pendingUndoGestureId,
      );
    },
    [
      activeCanvasSourceType,
      activeBreakpointUpperBoundAtEvent,
      activeContent,
      activeFile?.id,
      applyFileContentUpdate,
      applyLinkedComponentEdit,
      commitVisualStyles,
      canEditDesign,
      canEditLiveScreen,
      getScreenContent,
      getProjectionContentForScreen,
      t,
    ],
  );
  commitStylesToSelectedLayersRef.current = commitStylesToSelectedLayers;

  const commitRelativeStyleDeltaToSelectedLayers = useCallback(
    (
      property: string | string[],
      operation: number | ScrubRelativeExpression,
      pendingUndoGestureId?: string,
    ) => {
      const canEditSelectedVisualLayers =
        canEditDesign ||
        (selectedLayerTargetsRef.current.length > 0 &&
          selectedLayerTargetsRef.current.every((target) =>
            canEditLiveScreen(target.fileId),
          ));
      return runCommitRelativeStyleDeltaToSelectedLayers(
        {
          activeCanvasSourceType,
          activeBreakpointUpperBoundPx: activeBreakpointUpperBoundAtEvent(),
          activeBreakpointWidthStateRef,
          activeContent,
          activeFile,
          applyFileContentUpdate,
          applyLinkedComponentEdit,
          commitVisualStyles,
          canEditDesign: canEditSelectedVisualLayers,
          effectiveCodeLayerStateRef,
          getScreenContent,
          getProjectionContentForScreen,
          lastLocalContentRef,
          latestActiveContentRef,
          responsiveEditScopeRef,
          selectedLayerTargetsRef,
          reportLinkedEditUnavailable: (reason) =>
            toast.error(
              t(
                {
                  scope:
                    "designEditor.componentInstances.linkedEditScopeUnsupported",
                  source:
                    "designEditor.componentInstances.linkedEditSourceUnsupported",
                  targets:
                    "designEditor.componentInstances.linkedEditTargetsUnavailable",
                }[reason],
              ),
            ),
          setSelectedElement,
        },
        property,
        operation,
        pendingUndoGestureId,
      );
    },
    [
      activeCanvasSourceType,
      activeBreakpointUpperBoundAtEvent,
      activeContent,
      activeFile?.id,
      applyFileContentUpdate,
      applyLinkedComponentEdit,
      commitVisualStyles,
      canEditDesign,
      canEditLiveScreen,
      getScreenContent,
      getProjectionContentForScreen,
      t,
    ],
  );

  const getFreshActiveContent = useCallback(
    () => (activeFile?.id ? getScreenContent(activeFile.id) : activeContent),
    [activeContent, activeFile?.id, getScreenContent],
  );

  const handleClearBreakpointOverride = useCallback(
    (property: string, maxWidthPx: number): boolean => {
      if (!canEditDesign || !activeFile?.id || !selectedElement?.sourceId) {
        return false;
      }
      const nodeId = selectedElement.sourceId;
      const baseContent = getFreshActiveContent();
      const overrideState = getBreakpointOverrideState({
        className: selectedElement.classes?.join(" ") ?? "",
        html: baseContent,
        nodeId,
        property,
        breakpointWidths: designBreakpoints.map((bp) => bp.widthPx),
        baseWidthPx: activeScreenBaseWidthPx,
        activeWidthPx: activeBreakpointWidthState,
      });
      const override = overrideState.overrides.find(
        (candidate) => candidate.maxWidthPx === maxWidthPx,
      );
      if (!override) return false;
      const nextContent =
        override.source === "media"
          ? removeBreakpointMediaDeclaration(baseContent, {
              nodeId,
              maxWidthPx,
              property,
            })
          : applyVisualEdit(
              baseContent,
              {
                kind: "responsive-class",
                target: { nodeId },
                prefix: "base",
                maxWidthPx,
                operation: "remove",
                stem: utilityStem(override.value),
              },
              {
                source: codeLayerSourceForScreen(activeFile.id),
              },
            ).content;
      if (nextContent === baseContent) return false;
      applyFileContentUpdate(activeFile.id, nextContent, {
        refreshPreview: false,
        forcePreviewFullDocument: true,
      });
      return true;
    },
    [
      activeBreakpointWidthState,
      activeFile?.id,
      activeScreenBaseWidthPx,
      applyFileContentUpdate,
      canEditDesign,
      codeLayerSourceForScreen,
      designBreakpoints,
      getFreshActiveContent,
      selectedElement,
    ],
  );

  const previewInteractionStateStyles = useCallback(
    (state: InteractionState, styles: Record<string, string>) => {
      if (!selectedElement) return;
      const screenId = activeFile?.id;
      const routePath = screenId
        ? liveRoutePathsByScreenIdRef.current[screenId]
        : undefined;
      if (
        screenId &&
        sendLinkedScreenPreviewInteractionStateStyle(screenId, {
          routePath,
          selector: selectedCanvasSelector ?? selectedElement.selector ?? "",
          selectorCandidates: selectedCanvasSelectorCandidates,
          nodeId: selectedElement.sourceId ?? "",
          state,
          styles,
        })
      ) {
        return;
      }
      const sendPreview = (window as any)
        .__designCanvasSendInteractionStatePreviewStyle;
      if (typeof sendPreview !== "function") return;
      sendPreview({
        screenId,
        routePath,
        selector: selectedCanvasSelector ?? selectedElement.selector ?? "",
        selectorCandidates: selectedCanvasSelectorCandidates,
        nodeId: selectedElement.sourceId ?? "",
        state,
        styles,
      });
    },
    [
      activeFile?.id,
      selectedCanvasSelector,
      selectedCanvasSelectorCandidates,
      selectedElement,
    ],
  );

  const commitInteractionStateStyles = useCallback(
    (state: InteractionState, styles: Record<string, string>): boolean => {
      const canEditInteractionState =
        canEditDesign ||
        (isRunningAppSourceType(activeCanvasSourceType) &&
          canEditActiveVisualScreen);
      if (
        !canEditInteractionState ||
        !activeFile?.id ||
        !selectedElement?.sourceId
      ) {
        return false;
      }
      const entries = Object.entries(styles).filter(
        ([, value]) => value !== undefined,
      );
      if (entries.length === 0) return false;
      const interactionStateTarget = resolveCodeLayerNodeFromElementInfo(
        activeCodeLayerProjection,
        selectedElement,
      );
      if (
        interactionStateTarget &&
        linkedComponentRootForNode(
          interactionStateTarget,
          activeCodeLayerProjection,
        )
      ) {
        toast.error(
          t("designEditor.componentInstances.linkedEditScopeUnsupported"),
          { duration: 4000 },
        );
        return true;
      }
      const nodeId = selectedElement.sourceId;
      if (isRunningAppSourceType(activeCanvasSourceType)) {
        recordPendingVisualStyleEdit(
          activeFile.id,
          selectedCanvasSelector ?? selectedElement.selector ?? "",
          Object.fromEntries(entries),
          selectedElement,
          {
            interactionState: state,
            routePath: liveRoutePathsByScreenIdRef.current[activeFile.id],
          },
        );
        previewInteractionStateStyles(state, Object.fromEntries(entries));
        return true;
      }
      const baseContent = getFreshActiveContent();
      const nextContent = applyInteractionStateStyleCommit(
        baseContent,
        nodeId,
        state,
        Object.fromEntries(entries),
        activeBreakpointUpperBoundAtEvent(),
      );
      if (nextContent === baseContent) return true;
      applyFileContentUpdate(activeFile.id, nextContent, {
        refreshPreview: false,
        forcePreviewFullDocument: true,
      });
      previewInteractionStateStyles(
        state,
        Object.fromEntries(entries.map(([property]) => [property, ""])),
      );
      return true;
    },
    [
      activeCodeLayerProjection,
      activeCanvasSourceType,
      activeBreakpointUpperBoundAtEvent,
      activeFile?.id,
      applyFileContentUpdate,
      canEditActiveVisualScreen,
      canEditDesign,
      getFreshActiveContent,
      previewInteractionStateStyles,
      recordPendingVisualStyleEdit,
      selectedCanvasSelector,
      selectedElement,
      t,
    ],
  );

  const handleStyleChange = useCallback(
    (property: string, value: string, meta?: StyleChangeMeta) =>
      runStyleChange(
        {
          canEditLiveScreen,
          commitInteractionStateStyles,
          commitRelativeStyleDeltaToSelectedLayers: (
            property,
            operation,
            phase,
          ) =>
            commitRelativeStyleDeltaToSelectedLayers(
              property,
              operation,
              pendingLiveStyleGestureIdForPhase(phase),
            ),
          commitStylesToSelectedLayers: (styles, phase) =>
            commitStylesToSelectedLayers(
              styles,
              undefined,
              undefined,
              pendingLiveStyleGestureIdForPhase(phase),
            ),
          commitCapturedStyleTargets: (styles, targets, interactionState) =>
            commitCapturedStyleTargetsRef.current(
              styles,
              targets,
              interactionState,
            ),
          commitVisualStyles,
          handleClearBreakpointOverride,
          previewInteractionStateStyles,
          selectedCanvasSelectorCandidates,
          selectedElement,
          selectedScreenStyleChange: routeSelectedScreenStyleChange,
          selectedLayerTargetsRef,
          textEditingState,
        },
        property,
        value,
        meta,
      ),
    [
      commitInteractionStateStyles,
      canEditLiveScreen,
      previewInteractionStateStyles,
      commitRelativeStyleDeltaToSelectedLayers,
      commitStylesToSelectedLayers,
      pendingLiveStyleGestureIdForPhase,
      commitVisualStyles,
      handleClearBreakpointOverride,
      selectedElement,
      selectedElement?.selector,
      selectedElement?.sourceId,
      selectedCanvasSelectorCandidates,
      routeSelectedScreenStyleChange,
      textEditingState.active,
      textEditingState.hasRange,
      textEditingState.selector,
    ],
  );

  // BUG-DOUBLE-TOGGLE-RACE: commitVisualStyles commits Cmd+U/Cmd+Shift+X
  // through the SHORTHAND "textDecoration" property, but its synchronous
  // optimistic patch to selectedElement.computedStyles only merges the exact
  // key(s) it was given — it never decomposes "textDecoration" into the
  // LONGHAND "textDecorationLine" the toggle READS to decide its next value.
  // `textDecorationLine` only catches up once the bridge's async
  // getComputedStyle round trip lands. A second Cmd+U within that window
  // therefore recomputes nextTextDecorationLineValue from the STALE
  // pre-toggle value, lands on the SAME target the first press already
  // committed, and the style-commit pipeline dedupes the identical value as
  // a no-op — consecutive toggles silently stop alternating.
  //
  // Fix: track our own optimistic textDecorationLine value per selected
  // element, updated synchronously the instant we commit, and prefer it over
  // the (possibly still-stale) computedStyles reading for the SAME element.
  // Shared between underline and strikethrough since both toggle tokens
  // within the same textDecorationLine value — a separate ref per hotkey
  // would let one clobber the other's still-in-flight token.
  const optimisticTextDecorationLineRef =
    useRef<OptimisticTextDecorationLineEntry | null>(null);
  const readOptimisticTextDecorationLine = useCallback(() => {
    if (!selectedElement) return undefined;
    return resolveOptimisticTextDecorationLine(
      optimisticTextDecorationLineRef.current,
      selectedElement.sourceId ?? selectedElement.selector,
      selectedElement.computedStyles.textDecorationLine,
    );
  }, [selectedElement]);

  const handleToggleUnderlineHotkey = useCallback(() => {
    if (!canEditActiveVisualScreen || !selectedElement) return;
    const nextValue = nextTextDecorationLineValue(
      readOptimisticTextDecorationLine(),
      "underline",
    );
    const elementKey = selectedElement.sourceId ?? selectedElement.selector;
    if (elementKey) {
      optimisticTextDecorationLineRef.current = {
        key: elementKey,
        value: nextValue,
      };
    }
    handleStyleChange("textDecoration", nextValue);
  }, [
    canEditActiveVisualScreen,
    selectedElement,
    handleStyleChange,
    readOptimisticTextDecorationLine,
  ]);

  const handleToggleStrikethroughHotkey = useCallback(() => {
    if (!canEditActiveVisualScreen || !selectedElement) return;
    const nextValue = nextTextDecorationLineValue(
      readOptimisticTextDecorationLine(),
      "line-through",
    );
    const elementKey = selectedElement.sourceId ?? selectedElement.selector;
    if (elementKey) {
      optimisticTextDecorationLineRef.current = {
        key: elementKey,
        value: nextValue,
      };
    }
    handleStyleChange("textDecoration", nextValue);
  }, [
    canEditActiveVisualScreen,
    selectedElement,
    handleStyleChange,
    readOptimisticTextDecorationLine,
  ]);

  const handleStylesChange = useCallback(
    (styles: Record<string, string>, meta?: StyleChangeMeta) =>
      runStylesChange(
        {
          canEditLiveScreen,
          commitInteractionStateStyles,
          commitRelativeStyleDeltaToSelectedLayers: (
            property,
            operation,
            phase,
          ) =>
            commitRelativeStyleDeltaToSelectedLayers(
              property,
              operation,
              pendingLiveStyleGestureIdForPhase(phase),
            ),
          commitStylesToSelectedLayers: (styles, phase) =>
            commitStylesToSelectedLayers(
              styles,
              undefined,
              undefined,
              pendingLiveStyleGestureIdForPhase(phase),
            ),
          commitCapturedStyleTargets: (styles, targets, interactionState) =>
            commitCapturedStyleTargetsRef.current(
              styles,
              targets,
              interactionState,
            ),
          commitVisualStyles,
          handleClearBreakpointOverride,
          previewInteractionStateStyles,
          selectedCanvasSelectorCandidates,
          selectedElement,
          selectedScreenStyleChange: routeSelectedScreenStyleChange,
          selectedLayerTargetsRef,
          textEditingState,
        },
        styles,
        meta,
      ),
    [
      commitInteractionStateStyles,
      canEditLiveScreen,
      previewInteractionStateStyles,
      commitRelativeStyleDeltaToSelectedLayers,
      commitStylesToSelectedLayers,
      pendingLiveStyleGestureIdForPhase,
      commitVisualStyles,
      handleClearBreakpointOverride,
      selectedElement,
      selectedCanvasSelectorCandidates,
      selectedElement?.selector,
      selectedElement?.sourceId,
      routeSelectedScreenStyleChange,
      textEditingState.active,
      textEditingState.hasRange,
      textEditingState.selector,
    ],
  );

  const handleFontUploaded = useCallback(
    async (font: UploadedFont) => {
      if (!activeFile?.id || activeCanvasSourceType !== "inline") {
        throw new Error(t("common.genericError"));
      }
      const currentContent = getFreshActiveContent();
      const nextContent = ensureUploadedFontFaceInHtml(currentContent, font);
      const result = applyFileContentUpdate(activeFile.id, nextContent, {
        forcePreviewFullDocument: true,
        refreshPreview: false,
        recordHistory: false,
      });
      if (result.status !== "accepted") {
        throw new Error(t("common.genericError"));
      }
      handleStyleChange(
        "fontFamily",
        `${JSON.stringify(font.family)}, sans-serif`,
      );
    },
    [
      activeCanvasSourceType,
      activeFile?.id,
      applyFileContentUpdate,
      ensureUploadedFontFaceInHtml,
      getFreshActiveContent,
      handleStyleChange,
      t,
    ],
  );

  const handleTextContentChange = useCallback(
    (
      selector: string,
      value: string,
      elementInfo?: ElementInfo,
      details?: {
        html?: string;
        originalValue?: string;
        originalHtml?: string;
        routePath?: string;
        relativeOperations?: Record<string, PendingRelativeStyleOperation>;
      },
    ) =>
      runTextContentChange(
        {
          activeCanvasSourceType,
          activeFile,
          applyLinkedComponentEdit,
          applyLocalContentUpdate,
          canEditDesign,
          canEditLiveScreen: canEditActiveVisualScreen,
          prepareTextCreationFinalization,
          getFreshActiveContent,
          liveScreenSnapshotsById,
          recordPendingLiveTextEdit,
          setActiveTool,
          setMode,
          setSelectedElement,
          setSelectedLayerIdsState,
          t,
          updateLiveScreenSnapshotContent,
        },
        selector,
        value,
        elementInfo,
        details,
      ),
    [
      activeFile,
      activeCanvasSourceType,
      applyLinkedComponentEdit,
      applyLocalContentUpdate,
      canEditDesign,
      canEditActiveVisualScreen,
      prepareTextCreationFinalization,
      getFreshActiveContent,
      liveScreenSnapshotsById,
      recordPendingLiveTextEdit,
      t,
      updateLiveScreenSnapshotContent,
    ],
  );

  const handleScreenGridGroupChange = useCallback(
    (screenId: string, moves: GridGroupStructureMove[]) => {
      const screen = overviewScreens.find(
        (candidate) => candidate.id === screenId,
      );
      const sourceType =
        normalizeDesignSourceType(screen?.sourceType) ?? designSourceType;
      if (isRunningAppSourceType(sourceType)) {
        const transactionId = moves[0]?.transactionId;
        const edits = moves.map((move) =>
          preparePendingLiveStructureEdit(
            {
              canEditDesign,
              files,
              localhostConnectionRootPathByIdRef,
              overviewScreens,
              runtimeLayerSnapshotsById,
            },
            screenId,
            move.selector,
            move.persistenceAnchorSelector ?? move.anchorSelector,
            move.persistencePlacement ?? move.placement ?? "inside",
            undefined,
            {
              sourceId: move.sourceId,
              anchorSourceId:
                move.persistenceAnchorSourceId ?? move.anchorSourceId,
              requestId: move.requestId,
              transactionId,
              dropMode: "flow-insert",
              gridPlacement: move.gridPlacement,
              gridDisplacements: move.gridDisplacements,
            },
          ),
        );
        if (
          !edits.every(
            (edit): edit is NonNullable<typeof edit> => edit !== undefined,
          )
        )
          return false;
        commitPendingLiveStructureEdits(
          {
            cancelPendingStructureVerification,
            pendingLiveNonStyleEditsRef,
            pendingLiveNonStyleRedoStackRef,
            pendingLiveNonStyleUndoStackRef,
            pendingStructureRedoReplayRef,
            pendingStructureRedoReplayTimerRef,
            pendingVisualStyleRedoStackRef,
            recordPendingHistoryEntry,
            setPendingLiveNonStyleEdits,
          },
          edits,
        );
        return "pending";
      }
      const screenFile = files.find((file) => file.id === screenId);
      if (!screenFile || !canEditDesign) return false;
      const content = getScreenContent(screenId);
      const linked = resolveGridGroupLinkedComponentTarget(
        content,
        screenId,
        moves,
      );
      if (linked.status === "mixed") return false;
      const nextContent = planVisualGridGroupStructureChange(
        screenFile,
        content,
        moves,
        t,
        linked.status === "linked",
      );
      if (nextContent === null) return false;
      if (linked.status === "linked") {
        applyLinkedComponentEdit(linked.fileId, linked.nodeId, {
          kind: "structure",
          before: content,
          after: nextContent,
          selectionNodeIds: moves.map((move) => move.sourceId),
        });
        setActiveFileId(screenId);
        return true;
      }
      const published = applyFileContentUpdate(screenId, nextContent, {
        skipPreview: true,
      });
      if (published.status !== "accepted") return false;
      setActiveFileId(screenId);
      return true;
    },
    [
      overviewScreens,
      designSourceType,
      files,
      canEditDesign,
      getScreenContent,
      t,
      applyFileContentUpdate,
      applyLinkedComponentEdit,
    ],
  );

  const handleFrameSelection = useCallback(
    () =>
      runFrameSelection({
        activeBreakpointWidthState,
        activeFile,
        applyLinkedComponentEdit,
        applyLocalContentUpdate,
        boardFileId,
        canEditDesign,
        contentHistorySelectionAfterRef,
        contentUndoStackRef,
        files,
        getFreshActiveContent,
        overviewSelectedScreenIds,
        selectedLayerIdsState,
        setSelectedElement,
        setSelectedLayerIdsState,
        t,
        undoManagerRef,
      }),
    [
      activeBreakpointWidthState,
      activeFile,
      applyLinkedComponentEdit,
      applyLocalContentUpdate,
      boardFileId,
      canEditDesign,
      files,
      getFreshActiveContent,
      overviewSelectedScreenIds,
      selectedLayerIdsState,
      t,
    ],
  );

  const handleRotateSelectionClockwise = useCallback(() => {
    if (!canEditDesign || !selectedElement) return;
    const transform = selectedElement.computedStyles.transform;
    handleStyleChange(
      "transform",
      mergeRotationValue(transform, parseRotationValue(transform) + 90),
    );
  }, [canEditDesign, handleStyleChange, selectedElement]);

  return {
    pendingLiveStyleGestureStateRef,
    selectedLayerTargetsRef,
    commitStylesToSelectedLayersRef,
    commitCapturedStyleTargetsRef,
    effectiveCodeLayerStateRef,
    lastDuplicateTransformRef,
    repromptDraftRequest,
    setRepromptDraftRequest,
    canvasContextMenuRef,
    canvasLayerHitCandidates,
    setCanvasLayerHitCandidates,
    canEditActiveVisualScreen,
    nonActiveProjectionCacheRef,
    getCodeLayerProjectionForScreen,
    applyLinkedComponentEdit,
    shouldPreserveBlockedOverviewLayerSelectionRef,
    designExtensionContext,
    handleScreenElementSelect,
    handleElementSelect,
    handleScreenElementDblClickText,
    handleElementDblClickText,
    handleScreenElementHover,
    handleElementHover,
    handleIframeContextMenu,
    handleContextMenuSelectLayer,
    handleRepromptDraftConsumed,
    commitVisualStyles,
    getFreshActiveContent,
    commitInteractionStateStyles,
    handleStyleChange,
    handleToggleUnderlineHotkey,
    handleToggleStrikethroughHotkey,
    handleStylesChange,
    handleFontUploaded,
    handleTextContentChange,
    handleScreenGridGroupChange,
    handleFrameSelection,
    handleRotateSelectionClockwise,
  };
}

export type EditorSelectionAndStyles = ReturnType<
  typeof useEditorSelectionAndStyles
>;
