import { breakpointUpperBoundPx } from "@shared/responsive-classes";
import { isRunningAppSourceType } from "@shared/source-mode";
import { useEffect, useCallback, useRef, useMemo } from "react";

import { registerPendingTextHostCommit } from "@/components/design/design-canvas/pending-text-capture";
import { type StyleChangeMeta } from "@/components/design/EditPanel";
import {
  sendLinkedScreenPreviewInteractionStateStyle,
  sendLinkedScreenPreviewStyleChange,
} from "@/components/design/multi-screen/linked-screen-preview";
import type { MultiScreenCanvasProps } from "@/components/design/multi-screen/types";
import type { ElementInfo } from "@/components/design/types";

import { type ComponentCloneBatchContext } from "../clone-and-pen-edit";
import { runPendingTextHostCommit } from "../commands/pending-text-host-commit";
import { runRecordPendingLiveStructureEdit } from "../commands/record-pending-live-structure-edit";
import { runScreenTextContentChange } from "../commands/screen-text-content-change";
import { runScreenVisualDuplicateChange } from "../commands/screen-visual-duplicate-change";
import { runScreenVisualStructureChange } from "../commands/screen-visual-structure-change";
import { runScreenVisualStyleChange } from "../commands/screen-visual-style-change";
import { styleWriteTarget } from "../commands/style-write-target";
import { runVisualDuplicateChange } from "../commands/visual-duplicate-change";
import { runVisualStructureChange } from "../commands/visual-structure-change";
import {
  applyInteractionStateStyleCommit,
  relativeOperationsForStyles,
  type PendingLiveStructureEdit,
  type PendingLiveStructureUndoEntry,
  type PendingRelativeStyleOperation,
  resolveOverviewScreenSourceType,
} from "../pending-edits";
import type { EditorActiveScreenAndGeometry } from "./use-editor-active-screen-and-geometry";
import type { EditorCanvasAndScreens } from "./use-editor-canvas-and-screens";
import type { EditorContentAndComponents } from "./use-editor-content-and-components";
import type { EditorCore } from "./use-editor-core";
import type { EditorFilesAndSaving } from "./use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "./use-editor-generation-and-access";
import type { EditorHistory } from "./use-editor-history";
import type { EditorLiveEditsAndPresence } from "./use-editor-live-edits-and-presence";
import type { EditorSelectionAndStyles } from "./use-editor-selection-and-styles";

export function useEditorScreenChangeHandlers({
  editorCore,
  editorHistory,
  editorGenerationAndAccess,
  editorFilesAndSaving,
  editorActiveScreenAndGeometry,
  editorCanvasAndScreens,
  editorLiveEditsAndPresence,
  editorContentAndComponents,
  editorSelectionAndStyles,
}: {
  editorCore: EditorCore;
  editorHistory: EditorHistory;
  editorGenerationAndAccess: EditorGenerationAndAccess;
  editorFilesAndSaving: EditorFilesAndSaving;
  editorActiveScreenAndGeometry: EditorActiveScreenAndGeometry;
  editorCanvasAndScreens: EditorCanvasAndScreens;
  editorLiveEditsAndPresence: EditorLiveEditsAndPresence;
  editorContentAndComponents: EditorContentAndComponents;
  editorSelectionAndStyles: EditorSelectionAndStyles;
}) {
  const {
    t,
    setMode,
    setActiveTool,
    selectedElement,
    setSelectedElement,
    liveRoutePathsByScreenIdRef,
    pendingStructureRedoReplayTimerRef,
    cancelPendingStructureVerification,
    textEditingState,
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
    activeBreakpointWidthState,
    activeBreakpointWidthStateRef,
    undoManagerRef,
    captureCurrentSelection,
    prepareTextCreationFinalization,
  } = editorHistory;
  const { canEditDesign } = editorGenerationAndAccess;
  const {
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
    responsiveEditScope,
    responsiveEditScopeRef,
    activeFile,
    designBreakpoints,
    activeScreenBaseWidthPx,
    activeBreakpointUpperBoundPx,
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
    recordPendingHistoryEntry,
    canEditLiveScreenIdsRef,
    activeContent,
    getScreenContent,
    recordPendingVisualStyleEdit,
    recordPendingLiveTextEdit,
  } = editorCanvasAndScreens;
  const {
    selectedCanvasSelectorCandidates,
    canEditLiveScreen,
    remapMotionTracksForClone,
  } = editorLiveEditsAndPresence;
  const { applyLocalContentUpdate, applyFileContentUpdate } =
    editorContentAndComponents;
  const {
    canEditActiveVisualScreen,
    applyLinkedComponentEdit,
    commitVisualStyles,
    getFreshActiveContent,
    commitInteractionStateStyles,
    handleTextContentChange,
  } = editorSelectionAndStyles;

  const pendingStructureRedoPreparedEditsRef = useRef<
    | {
        replay: PendingLiveStructureUndoEntry;
        edits: PendingLiveStructureEdit[];
      }
    | undefined
  >(undefined);

  const recordPendingLiveStructureEdit = useCallback(
    (
      screenId: string,
      selector: string,
      anchorSelector: string,
      placement: "before" | "after" | "inside",
      elementInfo?: ElementInfo,
      details?: {
        sourceId?: string;
        anchorSourceId?: string;
        anchorElementInfo?: ElementInfo;
        requestId?: string;
        transactionId?: string;
        routePath?: string;
        dropMode?: "flow-insert" | "absolute-container";
        forceFlowPositionOverride?: boolean;
        sourceRect?: { x: number; y: number; width: number; height: number };
        anchorRect?: { x: number; y: number; width: number; height: number };
        gridPlacement?: {
          column: number;
          columnEnd: number;
          row: number;
          rowEnd: number;
        };
        gridDisplacements?: Array<{
          sourceId?: string;
          selector?: string;
          placement: {
            column: number;
            columnEnd: number;
            row: number;
            rowEnd: number;
          };
        }>;
        insertedHtml?: string;
        remintCollidingNodeIds?: boolean;
        replaced?: true;
        replacementSelector?: string;
        replacementSourceId?: string;
        replacementElementInfo?: ElementInfo;
        replacementSnapshotHtml?: string;
        removed?: true;
      },
    ) => {
      runRecordPendingLiveStructureEdit(
        {
          canEditDesign,
          canEditLiveScreens: canEditLiveScreenIdsRef.current,
          cancelPendingStructureVerification,
          files,
          localhostConnectionRootPathByIdRef,
          overviewScreens,
          pendingLiveNonStyleEditsRef,
          pendingLiveNonStyleRedoStackRef,
          pendingLiveNonStyleUndoStackRef,
          pendingStructureRedoReplayRef,
          pendingStructureRedoReplayTimerRef,
          pendingStructureRedoPreparedEditsRef,
          pendingVisualStyleRedoStackRef,
          recordPendingHistoryEntry,
          runtimeLayerSnapshotsById,
          setPendingLiveNonStyleEdits,
        },
        screenId,
        selector,
        anchorSelector,
        placement,
        elementInfo,
        details,
      );
    },
    [
      canEditDesign,
      cancelPendingStructureVerification,
      files,
      overviewScreens,
      recordPendingHistoryEntry,
      runtimeLayerSnapshotsById,
    ],
  );

  const breakpointContext = useMemo(() => {
    if (designBreakpoints.length === 0 || activeScreenBaseWidthPx == null) {
      return undefined;
    }
    return {
      breakpointWidths: designBreakpoints.map((bp) => bp.widthPx),
      baseWidthPx: activeScreenBaseWidthPx,
      activeWidthPx: activeBreakpointWidthState ?? null,
      upperBoundPx: activeBreakpointUpperBoundPx,
      lowerBoundPx:
        responsiveEditScope === "only"
          ? (activeBreakpointWidthState ?? null)
          : null,
      html: activeContent,
    };
  }, [
    activeBreakpointUpperBoundPx,
    activeBreakpointWidthState,
    activeContent,
    activeScreenBaseWidthPx,
    designBreakpoints,
    responsiveEditScope,
  ]);

  const handleVisualStyleChange = useCallback(
    (
      selector: string,
      styles: Record<string, string>,
      elementInfo?: ElementInfo,
      metadata?: {
        phase?: "preview" | "commit";
        originalStyles?: Record<string, string>;
        preserveSelection?: boolean;
        routePath?: string;
        runtimeApplied?: boolean;
      },
    ) => {
      if (!activeFile?.id) return;
      if (metadata?.phase === "preview") {
        if (elementInfo) {
          setSelectedElement((current) =>
            current
              ? {
                  ...current,
                  computedStyles: elementInfo.computedStyles,
                  inlineStyles: elementInfo.inlineStyles,
                  authoredSizeStyles: elementInfo.authoredSizeStyles,
                  boundingRect: elementInfo.boundingRect,
                  parentBoundingRect: elementInfo.parentBoundingRect,
                  positionReferenceRect: elementInfo.positionReferenceRect,
                  positionContainingBlockOrigin:
                    elementInfo.positionContainingBlockOrigin,
                  positionContainingBlockTransform:
                    elementInfo.positionContainingBlockTransform,
                }
              : current,
          );
        }
        return;
      }
      const gestureTarget = styleWriteTarget({
        selector,
        selectedElement: elementInfo,
      });
      const affectsEveryRow = gestureTarget !== selector;
      commitVisualStyles(gestureTarget, styles, {
        runtimeApplied: metadata?.runtimeApplied ?? !affectsEveryRow,
        elementInfo,
        originalStyles: metadata?.originalStyles,
        preserveSelection: metadata?.preserveSelection,
        routePath: metadata?.routePath,
      });
    },
    [activeFile?.id, commitVisualStyles],
  );

  const handleVisualStructureChange = useCallback(
    (
      selector: string,
      anchorSelector: string,
      placement: "before" | "after" | "inside",
      elementInfo?: ElementInfo,
      details?: {
        sourceId?: string;
        anchorSourceId?: string;
        anchorElementInfo?: ElementInfo;
        requestId?: string;
        transactionId?: string;
        dropMode?: "flow-insert" | "absolute-container";
        forceFlowPositionOverride?: boolean;
        sourceRect?: { x: number; y: number; width: number; height: number };
        anchorRect?: { x: number; y: number; width: number; height: number };
        gridPlacement?: {
          column: number;
          columnEnd: number;
          row: number;
          rowEnd: number;
        };
        gridDisplacements?: Array<{
          sourceId?: string;
          selector?: string;
          placement: {
            column: number;
            columnEnd: number;
            row: number;
            rowEnd: number;
          };
        }>;
        insertedHtml?: string;
        replaced?: true;
        replacementSelector?: string;
        replacementSourceId?: string;
        replacementElementInfo?: ElementInfo;
        replacementSnapshotHtml?: string;
      },
    ) =>
      runVisualStructureChange(
        {
          activeCanvasSourceType,
          activeFile,
          applyLinkedComponentEdit,
          applyLocalContentUpdate,
          canEditDesign,
          canEditLiveScreen: canEditActiveVisualScreen,
          getFreshActiveContent,
          recordPendingLiveStructureEdit,
          setSelectedElement,
          setSelectedLayerIdsState,
          t,
        },
        selector,
        anchorSelector,
        placement,
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
      getFreshActiveContent,
      recordPendingLiveStructureEdit,
      t,
    ],
  );

  const componentCloneContextForFile = useCallback(
    (fileId: string): ComponentCloneBatchContext => {
      const documents = files.map((file) => ({
        source: codeLayerSourceForScreen(file.id),
        content: getScreenContent(file.id),
      }));
      return {
        sourceFileIds: [fileId],
        targetSource: codeLayerSourceForScreen(fileId),
        documents,
      };
    },
    [codeLayerSourceForScreen, files, getScreenContent],
  );

  const handleVisualDuplicateChange = useCallback(
    (
      selector: string,
      cloneHtml: string,
      elementInfo?: ElementInfo,
      details?: {
        sourceId?: string;
        sourceNodeIdMap?: readonly (readonly [string, string])[] | null;
        anchorSelector?: string;
        anchorSourceId?: string;
        anchorElementInfo?: ElementInfo;
        requestId?: string;
        transactionId?: string;
        dropMode?: "flow-insert" | "absolute-container";
        forceFlowPositionOverride?: boolean;
        sourceRect?: { x: number; y: number; width: number; height: number };
        anchorRect?: { x: number; y: number; width: number; height: number };
        gridPlacement?: {
          column: number;
          columnEnd: number;
          row: number;
          rowEnd: number;
        };
        gridDisplacements?: Array<{
          sourceId?: string;
          selector?: string;
          placement: {
            column: number;
            columnEnd: number;
            row: number;
            rowEnd: number;
          };
        }>;
        placement?: "before" | "after" | "inside";
      },
    ) => {
      if (isRunningAppSourceType(activeCanvasSourceType) && activeFile) {
        if (!canEditActiveVisualScreen) return false;
        recordPendingLiveStructureEdit(
          activeFile.id,
          elementInfo?.runtimeSelector ?? elementInfo?.selector ?? selector,
          details?.anchorSelector ?? selector,
          details?.placement ?? "after",
          elementInfo,
          {
            sourceId: elementInfo?.runtimeSourceId || elementInfo?.sourceId,
            anchorSourceId: details?.anchorSourceId || details?.sourceId,
            anchorElementInfo: details?.anchorElementInfo,
            requestId: details?.requestId,
            dropMode: details?.dropMode,
            forceFlowPositionOverride: details?.forceFlowPositionOverride,
            sourceRect: details?.sourceRect,
            anchorRect: details?.anchorRect,
            insertedHtml: cloneHtml,
          },
        );
        return "pending";
      }
      return runVisualDuplicateChange(
        {
          activeFile,
          applyLinkedComponentEdit,
          selectionBefore: captureCurrentSelection(),
          componentLinks: activeFile
            ? componentCloneContextForFile(activeFile.id)
            : undefined,
          applyLocalContentUpdate,
          canEditDesign,
          canEditLiveScreen: canEditActiveVisualScreen,
          remapMotionTracksForClone,
          getFreshActiveContent,
          selectedElement,
          selectedLayerIdsState,
          setSelectedElement,
          setSelectedLayerIdsState,
          t,
          undoManagerRef,
        },
        selector,
        cloneHtml,
        elementInfo,
        details,
      );
    },
    [
      remapMotionTracksForClone,
      applyLinkedComponentEdit,
      activeFile,
      activeCanvasSourceType,
      applyLocalContentUpdate,
      canEditDesign,
      canEditActiveVisualScreen,
      componentCloneContextForFile,
      getFreshActiveContent,
      recordPendingLiveStructureEdit,
      selectedElement,
      selectedLayerIdsState,
      t,
    ],
  );

  const handleScreenVisualStyleChange = useCallback(
    (
      screenId: string,
      selector: string,
      styles: Record<string, string>,
      elementInfo?: ElementInfo,
      metadata?: {
        phase?: "preview" | "commit";
        originalStyles?: Record<string, string>;
        preserveSelection?: boolean;
        routePath?: string;
        runtimeApplied?: boolean;
        relativeOperations?: Record<string, PendingRelativeStyleOperation>;
      },
    ) =>
      runScreenVisualStyleChange(
        {
          activeBreakpointUpperBoundPx: activeBreakpointUpperBoundAtEvent(),
          activeBreakpointWidthStateRef,
          activeFile,
          applyFileContentUpdate,
          canEditDesign,
          canEditLiveScreen,
          designSourceType,
          getScreenContent,
          handleVisualStyleChange,
          overviewScreens,
          recordPendingVisualStyleEdit,
          responsiveEditScopeRef,
          t,
        },
        screenId,
        selector,
        styles,
        elementInfo,
        metadata,
      ),
    [
      activeBreakpointUpperBoundAtEvent,
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      canEditLiveScreen,
      designSourceType,
      getScreenContent,
      handleVisualStyleChange,
      overviewScreens,
      recordPendingVisualStyleEdit,
    ],
  );

  const handleInspectorScreenStyleChange = useCallback(
    (
      screenId: string,
      selector: string,
      styles: Record<string, string>,
      elementInfo?: ElementInfo,
      metadata?: StyleChangeMeta,
    ) => {
      if (!canEditDesign && !canEditLiveScreen(screenId)) return;
      const selectorCandidates = Array.from(
        new Set(
          [
            selector,
            elementInfo?.runtimeSelector,
            elementInfo?.selector,
            ...selectedCanvasSelectorCandidates,
          ].filter((candidate): candidate is string => Boolean(candidate)),
        ),
      );
      const textRangeOwnsScreen =
        textEditingState.hasRange &&
        textEditingState.screenId === screenId &&
        textEditingState.selector === selector;
      const interactionState = metadata?.interactionState;
      if (interactionState) {
        const relativeOperations = relativeOperationsForStyles(
          styles,
          metadata ?? {},
        );
        const routePath =
          metadata.routePath ?? liveRoutePathsByScreenIdRef.current[screenId];
        const previewInteractionState = (nextStyles: Record<string, string>) =>
          sendLinkedScreenPreviewInteractionStateStyle(screenId, {
            routePath,
            selector,
            selectorCandidates,
            nodeId: elementInfo?.runtimeSourceId ?? elementInfo?.sourceId ?? "",
            state: interactionState,
            styles: nextStyles,
          });
        if (metadata.phase === "preview" || metadata.phase === "cancel") {
          previewInteractionState(styles);
          return;
        }
        const screenSourceType = resolveOverviewScreenSourceType(
          overviewScreens.find((screen) => screen.id === screenId),
          designSourceType,
        );
        if (isRunningAppSourceType(screenSourceType)) {
          if (screenId === activeFile?.id) {
            commitInteractionStateStyles(interactionState, styles);
          } else {
            recordPendingVisualStyleEdit(
              screenId,
              selector,
              styles,
              elementInfo,
              {
                interactionState,
                routePath,
                ...(relativeOperations ? { relativeOperations } : {}),
              },
            );
            previewInteractionState(styles);
          }
          return;
        }
        if (!canEditDesign || !elementInfo?.sourceId) return;
        if (screenId === activeFile?.id) {
          commitInteractionStateStyles(interactionState, styles);
          return;
        }
        const baseContent = getScreenContent(screenId);
        const nextContent = applyInteractionStateStyleCommit(
          baseContent,
          elementInfo.sourceId,
          interactionState,
          styles,
          activeBreakpointUpperBoundAtEvent(),
        );
        if (nextContent === baseContent) return;
        applyFileContentUpdate(screenId, nextContent, {
          refreshPreview: false,
          forcePreviewFullDocument: true,
        });
        previewInteractionState(
          Object.fromEntries(
            Object.keys(styles).map((property) => [property, ""]),
          ),
        );
        return;
      }
      for (const [property, value] of Object.entries(styles)) {
        sendLinkedScreenPreviewStyleChange(
          screenId,
          selector,
          property,
          value,
          {
            selectorCandidates,
            nodeId: elementInfo?.runtimeSourceId ?? elementInfo?.sourceId,
            relativeOperation: relativeOperationsForStyles(
              { [property]: value },
              metadata,
            )?.[property],
          },
        );
      }
      if (
        metadata?.phase === "preview" ||
        metadata?.phase === "cancel" ||
        textRangeOwnsScreen
      )
        return;
      const relativeOperations = relativeOperationsForStyles(styles, metadata);
      handleScreenVisualStyleChange(screenId, selector, styles, elementInfo, {
        phase: metadata?.phase === "commit" ? "commit" : undefined,
        runtimeApplied: true,
        ...(relativeOperations ? { relativeOperations } : {}),
        routePath:
          metadata?.routePath ?? liveRoutePathsByScreenIdRef.current[screenId],
      });
    },
    [
      activeBreakpointUpperBoundAtEvent,
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      canEditLiveScreen,
      commitInteractionStateStyles,
      designSourceType,
      getScreenContent,
      handleScreenVisualStyleChange,
      overviewScreens,
      recordPendingVisualStyleEdit,
      selectedCanvasSelectorCandidates,
      textEditingState.hasRange,
      textEditingState.screenId,
      textEditingState.selector,
    ],
  );
  selectedScreenStyleChangeRef.current = handleInspectorScreenStyleChange;

  const handleScreenVisualStructureChange = useCallback(
    (
      screenId: string,
      selector: string,
      anchorSelector: string,
      placement: "before" | "after" | "inside",
      elementInfo?: ElementInfo,
      details?: {
        sourceId?: string;
        anchorSourceId?: string;
        anchorElementInfo?: ElementInfo;
        requestId?: string;
        transactionId?: string;
        routePath?: string;
        dropMode?: "flow-insert" | "absolute-container";
        forceFlowPositionOverride?: boolean;
        sourceRect?: { x: number; y: number; width: number; height: number };
        anchorRect?: { x: number; y: number; width: number; height: number };
        gridPlacement?: {
          column: number;
          columnEnd: number;
          row: number;
          rowEnd: number;
        };
        gridDisplacements?: Array<{
          sourceId?: string;
          selector?: string;
          placement: {
            column: number;
            columnEnd: number;
            row: number;
            rowEnd: number;
          };
        }>;
        insertedHtml?: string;
        replaced?: true;
        replacementSelector?: string;
        replacementSourceId?: string;
        replacementElementInfo?: ElementInfo;
        replacementSnapshotHtml?: string;
      },
    ) =>
      runScreenVisualStructureChange(
        {
          activeFile,
          applyLinkedComponentEdit,
          applyFileContentUpdate,
          canEditDesign,
          canEditLiveScreen,
          designSourceType,
          getScreenContent,
          handleVisualStructureChange,
          overviewScreens,
          recordPendingLiveStructureEdit,
          setActiveFileId,
          setSelectedElement,
          setSelectedLayerIdsState,
          t,
        },
        screenId,
        selector,
        anchorSelector,
        placement,
        elementInfo,
        details,
      ),
    [
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      canEditLiveScreen,
      designSourceType,
      getScreenContent,
      handleVisualStructureChange,
      overviewScreens,
      recordPendingLiveStructureEdit,
      applyLinkedComponentEdit,
      t,
    ],
  );

  const handleScreenVisualDuplicateChange = useCallback(
    (
      screenId: string,
      selector: string,
      cloneHtml: string,
      elementInfo?: ElementInfo,
      details?: {
        sourceId?: string;
        sourceNodeIdMap?: readonly (readonly [string, string])[] | null;
        anchorSelector?: string;
        anchorSourceId?: string;
        anchorElementInfo?: ElementInfo;
        requestId?: string;
        dropMode?: "flow-insert" | "absolute-container";
        forceFlowPositionOverride?: boolean;
        sourceRect?: { x: number; y: number; width: number; height: number };
        anchorRect?: { x: number; y: number; width: number; height: number };
        placement?: "before" | "after" | "inside";
      },
    ) =>
      runScreenVisualDuplicateChange(
        {
          activeFile,
          applyLinkedComponentEdit,
          selectionBefore: captureCurrentSelection(),
          applyFileContentUpdate,
          canEditDesign,
          canEditLiveScreen,
          remapMotionTracksForClone,
          componentLinksForFile: componentCloneContextForFile,
          getScreenContent,
          handleVisualDuplicateChange,
          designSourceType,
          overviewScreens,
          recordPendingLiveStructureEdit,
          t,
        },
        screenId,
        selector,
        cloneHtml,
        elementInfo,
        details,
      ),
    [
      remapMotionTracksForClone,
      applyLinkedComponentEdit,
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      canEditLiveScreen,
      componentCloneContextForFile,
      designSourceType,
      getScreenContent,
      handleVisualDuplicateChange,
      overviewScreens,
      recordPendingLiveStructureEdit,
      t,
    ],
  );

  const handleScreenTextContentChange = useCallback(
    (
      screenId: string,
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
      runScreenTextContentChange(
        {
          activeFile,
          applyFileContentUpdate,
          applyLinkedComponentEdit,
          canEditDesign,
          canEditLiveScreen,
          designSourceType,
          prepareTextCreationFinalization,
          getScreenContent,
          handleTextContentChange,
          liveScreenSnapshotsById,
          overviewScreens,
          recordPendingLiveTextEdit,
          setActiveFileId,
          setActiveTool,
          setMode,
          setSelectedElement,
          setSelectedLayerIdsState,
          t,
          updateLiveScreenSnapshotContent,
        },
        screenId,
        selector,
        value,
        elementInfo,
        details,
      ),
    [
      activeFile?.id,
      applyFileContentUpdate,
      applyLinkedComponentEdit,
      canEditDesign,
      canEditLiveScreen,
      designSourceType,
      prepareTextCreationFinalization,
      getScreenContent,
      handleTextContentChange,
      liveScreenSnapshotsById,
      overviewScreens,
      recordPendingLiveTextEdit,
      t,
      updateLiveScreenSnapshotContent,
    ],
  );

  const pendingTextHostCommitRef = useRef({
    commitText: handleScreenTextContentChange,
  });
  pendingTextHostCommitRef.current = {
    commitText: handleScreenTextContentChange,
  };
  useEffect(
    () =>
      registerPendingTextHostCommit((screenId, nodeId, text) =>
        runPendingTextHostCommit(
          pendingTextHostCommitRef.current.commitText,
          screenId,
          nodeId,
          text,
        ),
      ),
    [],
  );
  const handleBoardVisualStyleChange = useCallback<
    NonNullable<MultiScreenCanvasProps["onBoardVisualStyleChange"]>
  >(
    (selector, styles, info, metadata) => {
      if (!boardFileId) return;
      handleScreenVisualStyleChange(
        boardFileId,
        selector,
        styles,
        info,
        metadata,
      );
    },
    [boardFileId, handleScreenVisualStyleChange],
  );
  const handleBoardVisualStructureChange = useCallback<
    NonNullable<MultiScreenCanvasProps["onBoardVisualStructureChange"]>
  >(
    (selector, anchorSelector, placement, info, details) => {
      if (!boardFileId) return;
      return handleScreenVisualStructureChange(
        boardFileId,
        selector,
        anchorSelector,
        placement,
        info,
        details,
      );
    },
    [boardFileId, handleScreenVisualStructureChange],
  );
  const handleBoardVisualDuplicateChange = useCallback<
    NonNullable<MultiScreenCanvasProps["onBoardVisualDuplicateChange"]>
  >(
    (selector, cloneHtml, info, details) => {
      if (!boardFileId) return;
      return handleScreenVisualDuplicateChange(
        boardFileId,
        selector,
        cloneHtml,
        info,
        details,
      );
    },
    [boardFileId, handleScreenVisualDuplicateChange],
  );
  const handleBoardTextContentChange = useCallback<
    NonNullable<MultiScreenCanvasProps["onBoardTextContentChange"]>
  >(
    (selector, value, info, details) => {
      if (!boardFileId) return;
      handleScreenTextContentChange(
        boardFileId,
        selector,
        value,
        info,
        details,
      );
    },
    [boardFileId, handleScreenTextContentChange],
  );

  return {
    pendingStructureRedoPreparedEditsRef,
    recordPendingLiveStructureEdit,
    breakpointContext,
    handleVisualStyleChange,
    handleVisualStructureChange,
    handleVisualDuplicateChange,
    handleScreenVisualStyleChange,
    handleScreenVisualStructureChange,
    handleScreenVisualDuplicateChange,
    handleScreenTextContentChange,
    handleBoardVisualStyleChange,
    handleBoardVisualStructureChange,
    handleBoardVisualDuplicateChange,
    handleBoardTextContentChange,
  };
}

export type EditorScreenChangeHandlers = ReturnType<
  typeof useEditorScreenChangeHandlers
>;
