import { openCommandMenu } from "@agent-native/toolkit/app/shared";
import { isBoardFile } from "@shared/board-file";
import { isRunningAppSourceType } from "@shared/source-mode";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";

import { breakpointLabelForWidth } from "@/components/design/BreakpointBar";
import type { IframeHotkeyPayload } from "@/components/design/design-canvas/iframe-events";
import type { MotionTrackWire } from "@/components/design/design-canvas/motion-types";
import { recordDesignPerformance } from "@/components/design/design-trace";
import { DesignCanvas } from "@/components/design/DesignCanvas";
import { getBreakpointIframeId } from "@/components/design/multi-screen/iframe-targeting";
import type {
  ScreenContentRenderOptions,
  MultiScreenCanvasProps,
  KScaleStyleChange,
} from "@/components/design/multi-screen/types";
import { MultiScreenCanvas } from "@/components/design/MultiScreenCanvas";
import type {
  ElementInfo,
  ElementSelectionIntent,
} from "@/components/design/types";
import { prettyScreenName } from "@/lib/screen-names";
import { externalPreviewUrlForContent } from "@/pages/design-editor/preview-html";

import { codeLayerPatchMessage } from "../code-layer-state";
import { runApplyToSource } from "../commands/apply-to-source";
import {
  beginOptimisticBreakpointSetPatch,
  optimisticAddBreakpointData,
} from "../commands/optimistic-breakpoint-mutation";
import { getDesignBreakpointWidths } from "../data-operations";
import {
  cloneCanvasFrameGeometry,
  getCanvasFrameGeometry,
} from "../design-data-geometry-utils";
import { NO_SELECTORS, previewUrlAtLiveRoute } from "../design-editor-shared";
import { isSupersededSelectionEcho } from "../editor-helpers";
import { applyKScaleStyleChanges } from "../k-scale";
import { clampZoom } from "../overview-camera";
import {
  pendingVisualStyleGestureIdForPhase,
  resolveOverviewScreenSourceType,
  shouldUseRuntimeLayerProjection,
} from "../pending-edits";
import {
  getContentSignature,
  getOverviewScreenContentKey,
  getOverviewScreenRuntimeReplacementKey,
  shouldIgnoreOverviewLayerCreationEcho,
  shouldUseOverviewRuntimeReplacement,
} from "../selection-state";
import { resolveToolAfterSelection } from "../tool-state";
import type { EditorActiveScreenAndGeometry } from "./use-editor-active-screen-and-geometry";
import type { EditorCanvasAndScreens } from "./use-editor-canvas-and-screens";
import type { EditorClipboard } from "./use-editor-clipboard";
import type { EditorContentAndComponents } from "./use-editor-content-and-components";
import type { EditorCore } from "./use-editor-core";
import type { EditorEditCommands } from "./use-editor-edit-commands";
import type { EditorExportAndHandoff } from "./use-editor-export-and-handoff";
import type { EditorFilesAndSaving } from "./use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "./use-editor-generation-and-access";
import type { EditorHistory } from "./use-editor-history";
import type { EditorLayerActions } from "./use-editor-layer-actions";
import type { EditorLayerModels } from "./use-editor-layer-models";
import type { EditorLayoutAndStructure } from "./use-editor-layout-and-structure";
import type { EditorLiveEditsAndPresence } from "./use-editor-live-edits-and-presence";
import type { EditorModes } from "./use-editor-modes";
import type { EditorScreenChangeHandlers } from "./use-editor-screen-change-handlers";
import type { EditorSelectionAndStyles } from "./use-editor-selection-and-styles";
import type { EditorSourceAndSync } from "./use-editor-source-and-sync";
import type { EditorToolsAndVectors } from "./use-editor-tools-and-vectors";

const NO_SELECTOR_GROUPS: string[][] = [];

const NO_MOTION_TRACKS: MotionTrackWire[] = [];

type OverviewScreenRenderer = NonNullable<
  React.ComponentProps<typeof MultiScreenCanvas>["renderScreenContent"]
>;

type OverviewBreakpointRenderer = NonNullable<
  MultiScreenCanvasProps["renderBreakpointContent"]
>;

type OverviewScreenRendererArgs = Parameters<OverviewScreenRenderer>;

type OverviewBreakpointRendererArgs = Parameters<OverviewBreakpointRenderer>;

export function useEditorScreenRendering({
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
  editorLayoutAndStructure,
  editorEditCommands,
  editorModes,
  editorExportAndHandoff,
  editorLayerModels,
  editorLayerActions,
  editorSourceAndSync,
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
  editorLayoutAndStructure: EditorLayoutAndStructure;
  editorEditCommands: EditorEditCommands;
  editorModes: EditorModes;
  editorExportAndHandoff: EditorExportAndHandoff;
  editorLayerModels: EditorLayerModels;
  editorLayerActions: EditorLayerActions;
  editorSourceAndSync: EditorSourceAndSync;
}) {
  const {
    t,
    id,
    session,
    queryClient,
    isVisualEditSurface,
    isLiveCanvasShareLink,
    mode,
    setMode,
    overviewInteractScreenId,
    activeTool,
    setActiveTool,
    viewModeRef,
    setSelectedElement,
    selectedElementRef,
    pendingVisualStyleRevertRequest,
    pendingTextRevertRequest,
    pendingStructureAckRequest,
    runtimeStructureInsertRequest,
    liveRoutePathsByScreenId,
    liveRoutePathsByScreenIdRef,
    handleLiveRoutePathChange,
    runtimeStructureVerificationRequest,
    pendingVisualStyleBaselineResetRequest,
    handleTextEditingStateChangeForScreen,
    setHoveredElement,
    setActiveFileId,
    activeFileIdRef,
  } = editorCore;
  const {
    pendingVisualStyleEdits,
    setSelectedLayerIdsState,
    invalidateRenderedElementInfo,
    setOverviewSelectedScreenIds,
    setCreatedOverviewLayerSelection,
    pendingOverviewScreenSelectionRef,
    pendingOverviewLayerSelectionRef,
    clearPendingOverviewLayerSelectionTimer,
    lockedLayerIds,
    hiddenLayerIds,
    shaderFillPreview,
    activeBreakpointWidthState,
    setActiveBreakpointWidthState,
    activeBreakpointWidthStateRef,
  } = editorHistory;
  const {
    runtimeLayerSnapshotRequest,
    pinMode,
    design,
    designAccessRole,
    canEditDesign,
    publicVisualEdit,
    canCommentDesign,
    liveCollaborationEnabled,
    reviewSendingThreadId,
    addBreakpointMutation,
    updateBreakpointMutation,
    reserveVisualEditSnapshot,
    scheduleVisualEditSnapshotPublication,
    handleComponentSourceJump,
  } = editorGenerationAndAccess;
  const {
    navigate,
    cssVarValues,
    files,
    codeLayerSourceForScreen,
    liveScreenSnapshotsById,
    designDataJson,
    designSourceType,
    layoutGrids,
    designDataJsonRef,
    boardFileId,
    overviewScreens,
    publicVisualEditPreviewTokenQuery,
    remoteVisualEditPending,
    handleScreenExternalContentSnapshot,
    getScreenRootComputedStylesCallback,
  } = editorFilesAndSaving;
  const {
    effectivePreviewTokensByScreenId,
    effectiveLiveEditCapabilitiesByScreenId,
    effectiveLiveEditRegistrationCapabilitiesByScreenId,
    responsiveEditScopeRef,
    lastAppliedActiveBreakpointIdRef,
    persistActiveBreakpoint,
    publicVisualEditConnectionId,
    handleGeometryCommit,
    activeFile,
    designBreakpoints,
    handleBreakpointBarSelect,
    handleEffectivePreviewTokenChange,
    handleLiveEditCapabilityChange,
    handleLiveEditRegistrationCapabilityChange,
    overviewCanvasZoom,
    setZoom,
    activeCanvasSourceType,
  } = editorActiveScreenAndGeometry;
  const {
    hoveredElementScreenId,
    setHoveredElementScreenId,
    overviewClearSelectionRequest,
    latestActiveContentRef,
    handleEditorDragStateChange,
    getScreenContent,
    getEmbeddedFrame,
    getRuntimeLayerSnapshotCallback,
    getRuntimeLayerSnapshotReadinessCallback,
    getRuntimeVerificationSnapshotCallback,
    recordPendingVisualStyleEdit,
  } = editorCanvasAndScreens;
  const {
    contentRenderRevision,
    motionDurationMs,
    motionDefaultEase,
    zoom,
    selectedCanvasSelectorCandidates,
    selectedCanvasSelector,
    canEditLiveScreen,
    designFusionUrl,
    motionTracksWire,
  } = editorLiveEditsAndPresence;
  const {
    hoveredCanvasSelectorCandidates,
    hoveredCanvasSelector,
    applyFileContentUpdate,
  } = editorContentAndComponents;
  const {
    reviewFocusRequest,
    selectionRevisionRef,
    handleDispatchCommentToAgent,
    handleSendReviewThreadToAgent,
    spacePanActive,
  } = editorToolsAndVectors;
  const {
    pendingLiveStyleGestureStateRef,
    repromptDraftRequest,
    shouldPreserveBlockedOverviewLayerSelectionRef,
    handleScreenElementSelect,
    handleScreenElementDblClickText,
    handleScreenElementHover,
    handleIframeContextMenu,
    handleRepromptDraftConsumed,
    getFreshActiveContent,
    handleScreenGridGroupChange,
  } = editorSelectionAndStyles;
  const {
    handleScreenVisualStyleChange,
    handleScreenVisualStructureChange,
    handleScreenVisualDuplicateChange,
    handleScreenTextContentChange,
  } = editorScreenChangeHandlers;
  const { handleCanvasFigmaClipboardPaste, handleCanvasImagePaste } =
    editorClipboard;
  const {
    runtimeStructureDeleteRequest,
    runtimeStructureRollbackRequest,
    reflowOverviewScreensForBreakpoints,
    commentsHidden,
    handleRuntimeStructureInsertRejected,
    handleRuntimeStructureInsertApplied,
    handleRuntimeStructureDeleteApplied,
    handleRuntimeStructureDeleteRejected,
  } = editorLayoutAndStructure;
  const {
    runtimeStructureMoveRequest,
    handleRuntimeStructureRollbackResult,
    handleRuntimeLayerRenameApplied,
    runtimeLayerRenameForScreen,
  } = editorEditCommands;
  const { suppressOverviewPopForExplicitZoomRef, handleExitReviewCommentMode } =
    editorModes;
  const { exportPreviewScreenId } = editorExportAndHandoff;
  const {
    getLayerSelectorsForFile,
    selectedElementScreenId,
    selectedLayerSelectorGroupsByScreen,
  } = editorLayerModels;
  const {
    inScreenGradientEditTarget,
    handleInScreenGradientEditChange,
    statePreviewTarget,
    activeLocalhostRelPath,
    activeLocalhostSourceSnapshotHtml,
    handleScreenElementMarqueeSelect,
  } = editorLayerActions;
  const { activeLocalhostConnectionId, requestLocalhostWrite } =
    editorSourceAndSync;

  const [applyToSourcePending, setApplyToSourcePending] = useState(false);

  const handleScreenElementClear = useCallback(
    (screenId: string, breakpointWidthPx?: number) => {
      const pendingLayerId = pendingOverviewLayerSelectionRef.current;
      const pendingScreenId = pendingOverviewScreenSelectionRef.current;
      if (
        shouldIgnoreOverviewLayerCreationEcho({
          pendingLayerId,
          pendingScreenId,
          screenId,
          event: "clear",
        })
      ) {
        return;
      }
      if (shouldPreserveBlockedOverviewLayerSelectionRef.current(screenId)) {
        return;
      }
      selectionRevisionRef.current += 1;
      pendingOverviewScreenSelectionRef.current = null;
      pendingOverviewLayerSelectionRef.current = null;
      clearPendingOverviewLayerSelectionTimer();
      setCreatedOverviewLayerSelection(null);
      setActiveFileId(screenId);
      setSelectedElement(null);
      setHoveredElement(null);
      setHoveredElementScreenId(null);
      setSelectedLayerIdsState([]);
      invalidateRenderedElementInfo();
      if (viewModeRef.current === "overview") {
        setOverviewSelectedScreenIds([]);
        if (breakpointWidthPx !== undefined) {
          handleBreakpointBarSelect(breakpointWidthPx);
        } else if (activeBreakpointWidthStateRef.current !== undefined) {
          handleBreakpointBarSelect(undefined);
        }
      }
      setActiveTool(resolveToolAfterSelection);
      setMode("edit");
    },
    [
      clearPendingOverviewLayerSelectionTimer,
      handleBreakpointBarSelect,
      invalidateRenderedElementInfo,
    ],
  );

  const handleIframeElementSelect = useCallback(
    (
      screenId: string,
      info: ElementInfo,
      intent?: ElementSelectionIntent,
      options: {
        persistPendingNodeId?: boolean;
        breakpointWidthPx?: number;
      } = {},
    ) => {
      const currentSelection = selectedElementRef.current;
      const supersededEcho = intent
        ? false
        : isSupersededSelectionEcho(info, currentSelection);
      const inactiveScreenEcho =
        !intent &&
        activeFileIdRef.current !== null &&
        screenId !== activeFileIdRef.current;
      const droppedEcho = supersededEcho || inactiveScreenEcho;
      if (!intent && droppedEcho) {
        return;
      }
      handleScreenElementSelect(screenId, info, intent, options);
    },
    [handleScreenElementSelect],
  );

  const handleIframeHotkey = useCallback((payload: IframeHotkeyPayload) => {
    if (!payload.key) return;
    const primary = payload.metaKey || payload.ctrlKey;
    if (
      primary &&
      !payload.altKey &&
      !payload.shiftKey &&
      payload.key.toLowerCase() === "k"
    ) {
      openCommandMenu();
      return;
    }
    const event = new KeyboardEvent("keydown", {
      key: payload.key,
      code: payload.code,
      metaKey: payload.metaKey,
      ctrlKey: payload.ctrlKey,
      shiftKey: payload.shiftKey,
      altKey: payload.altKey,
      repeat: payload.repeat,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "__agentNativeIframeHotkey", {
      value: true,
    });
    window.dispatchEvent(event);
  }, []);

  const handleKScaleStyleBatchChange = useCallback(
    (screenId: string, changes: KScaleStyleChange[]) => {
      if (changes.length === 0) return true;
      if (!canEditDesign && !canEditLiveScreen(screenId)) return false;
      const screen = overviewScreens.find((entry) => entry.id === screenId);
      const sourceFile = files.find((file) => file.id === screenId);
      const sourceType = isBoardFile(sourceFile?.filename ?? "")
        ? "inline"
        : resolveOverviewScreenSourceType(
            screen,
            screenId === activeFile?.id
              ? activeCanvasSourceType
              : designSourceType,
          );
      if (isRunningAppSourceType(sourceType)) {
        const pendingUndoGestureId =
          changes.length > 1
            ? pendingVisualStyleGestureIdForPhase(
                pendingLiveStyleGestureStateRef.current,
                undefined,
                true,
              )
            : undefined;
        changes.forEach(
          ({
            selector,
            styles,
            elementInfo,
            originalStyles,
            preserveSelection,
          }) => {
            recordPendingVisualStyleEdit(
              screenId,
              selector,
              styles,
              elementInfo,
              {
                originalStyles,
                pendingUndoGestureId,
                preserveSelection,
                routePath: liveRoutePathsByScreenIdRef.current[screenId],
              },
            );
          },
        );
        return true;
      }
      const content =
        screenId === activeFile?.id
          ? getFreshActiveContent()
          : getScreenContent(screenId);
      if (!content || externalPreviewUrlForContent(content) !== null)
        return false;
      const patch = applyKScaleStyleChanges(
        content,
        changes,
        codeLayerSourceForScreen(screenId),
      );
      if (patch.status !== "applied") {
        toast.error(
          codeLayerPatchMessage(
            patch.reason,
            t("designEditor.patchProof.selectorMissing"),
          ),
        );
        return false;
      }
      if (patch.content === content) return true;
      applyFileContentUpdate(screenId, patch.content, {
        skipPreview: true,
      });
      return true;
    },
    [
      activeCanvasSourceType,
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      canEditLiveScreen,
      codeLayerSourceForScreen,
      designSourceType,
      files,
      getFreshActiveContent,
      getScreenContent,
      overviewScreens,
      pendingVisualStyleGestureIdForPhase,
      recordPendingVisualStyleEdit,
      t,
    ],
  );

  function stripEditorOnlyAttributes(html: string): string {
    if (typeof window === "undefined") return html;
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const STRIP_ATTRS = [
        "data-agent-native-node-id",
        "data-code-layer-id",
      ] as const;
      for (const attr of STRIP_ATTRS) {
        doc.querySelectorAll(`[${attr}]`).forEach((el) => {
          el.removeAttribute(attr);
        });
      }
      const doctype = doc.doctype
        ? new XMLSerializer().serializeToString(doc.doctype) + "\n"
        : "";
      const htmlEl = doc.documentElement;
      return doctype + htmlEl.outerHTML;
    } catch {
      return html;
    }
  }

  const handleApplyToSource = useCallback(
    () =>
      runApplyToSource({
        activeLocalhostConnectionId,
        activeLocalhostRelPath,
        activeLocalhostSourceSnapshotHtml,
        canEditDesign,
        id,
        latestActiveContentRef,
        requestLocalhostWrite,
        setApplyToSourcePending,
        stripEditorOnlyAttributes,
        t,
      }),
    [
      id,
      canEditDesign,
      activeFile?.id,
      activeLocalhostConnectionId,
      activeLocalhostRelPath,
      activeLocalhostSourceSnapshotHtml,
      requestLocalhostWrite,
      t,
    ],
  );

  const zoomLabel = `${Math.round(zoom)}%`;
  const [openZoomControl, setOpenZoomControl] = useState<
    "toolbar" | "inspector" | "topbar" | null
  >(null);
  const [zoomInputValue, setZoomInputValue] = useState(zoomLabel);
  useEffect(() => {
    if (!openZoomControl) setZoomInputValue(zoomLabel);
  }, [zoomLabel, openZoomControl]);
  const commitZoomInput = useCallback(() => {
    const next = Number(zoomInputValue.replace("%", "").trim());
    if (!Number.isFinite(next)) {
      setZoomInputValue(zoomLabel);
      return;
    }
    suppressOverviewPopForExplicitZoomRef.current = true;
    setZoom(clampZoom(next));
    setOpenZoomControl(null);
  }, [setZoom, zoomInputValue, zoomLabel]);
  const renderEditableScreenContent = useCallback(
    (
      screen: OverviewScreenRendererArgs[0],
      metadata: OverviewScreenRendererArgs[1],
      geometry: OverviewScreenRendererArgs[2],
      breakpointFrame?: OverviewBreakpointRendererArgs[2],
      renderOptions?: ScreenContentRenderOptions,
    ) => {
      const breakpointWidthPx = breakpointFrame?.widthPx;
      const screenIsActive =
        screen.id === activeFile?.id &&
        (breakpointWidthPx === undefined
          ? activeBreakpointWidthState === undefined
          : activeBreakpointWidthState === breakpointWidthPx);
      const screenIsBeingExported = screen.id === exportPreviewScreenId;
      const screenSelectedLayerGroups =
        selectedLayerSelectorGroupsByScreen[screen.id] ?? NO_SELECTOR_GROUPS;
      const screenOwnsSelection =
        selectedElementScreenId === screen.id ||
        screenSelectedLayerGroups.length > 0;
      const screenContent = getScreenContent(screen.id);
      const runtimeProjectionEligible = shouldUseRuntimeLayerProjection({
        screen,
        fallbackSourceType: designSourceType,
        content: screenContent,
      });
      const screenSourceType = resolveOverviewScreenSourceType(
        screen,
        metadata.source ?? designSourceType,
      );
      const screenSnapshotOnly = Boolean(
        isLiveCanvasShareLink &&
        designAccessRole &&
        designAccessRole !== "owner" &&
        screenSourceType === "localhost",
      );
      const screenBridgeUrl = screenSnapshotOnly ? undefined : screen.bridgeUrl;
      const screenPreviewUrl = screen.url ?? screen.previewUrl;
      const currentLiveRoutePath =
        liveRoutePathsByScreenIdRef.current[screen.id];
      const screenPreviewToken =
        effectivePreviewTokensByScreenId[screen.id] ??
        ("previewToken" in screen && typeof screen.previewToken === "string"
          ? screen.previewToken
          : (publicVisualEditPreviewTokenQuery.data?.connections?.[
              screen.connectionId ?? ""
            ]?.previewToken ??
            (screen.connectionId === publicVisualEditConnectionId
              ? publicVisualEditPreviewTokenQuery.data?.previewToken
              : undefined)));
      const screenLiveEditCapability =
        effectiveLiveEditCapabilitiesByScreenId[screen.id] ??
        publicVisualEditPreviewTokenQuery.data?.connections?.[
          screen.connectionId ?? ""
        ]?.liveEditCapability ??
        (screen.connectionId === publicVisualEditConnectionId
          ? publicVisualEditPreviewTokenQuery.data?.liveEditCapability
          : undefined);
      const screenLiveEditRegistrationCapability =
        effectiveLiveEditRegistrationCapabilitiesByScreenId[screen.id] ??
        publicVisualEditPreviewTokenQuery.data?.connections?.[
          screen.connectionId ?? ""
        ]?.liveEditRegistrationCapability ??
        (screen.connectionId === publicVisualEditConnectionId
          ? publicVisualEditPreviewTokenQuery.data
              ?.liveEditRegistrationCapability
          : undefined);
      const screenSnapshot = liveScreenSnapshotsById[screen.id]?.html;
      const useRuntimeReplacement = shouldUseOverviewRuntimeReplacement({
        sourceType: screenSourceType,
        externalSnapshotHtml: screenSnapshot,
      });
      const runtimeReplacementKey = useRuntimeReplacement
        ? getOverviewScreenRuntimeReplacementKey({
            screenId: screen.id,
            updatedAt: screen.updatedAt,
            content: screenContent,
          })
        : undefined;
      const baseScreenContentKey = getOverviewScreenContentKey({
        screenId: screen.id,
        screenIsActive,
        contentRenderRevision,
        updatedAt: screen.updatedAt,
        content: screenContent,
        useRuntimeReplacement,
      });
      const screenContentKey =
        breakpointWidthPx === undefined
          ? baseScreenContentKey
          : `${baseScreenContentKey}::breakpoint-${breakpointWidthPx}`;
      const activateResponsiveScope = () => {
        if (breakpointWidthPx === undefined) return;
        handleBreakpointBarSelect(breakpointWidthPx);
      };

      return (
        <DesignCanvas
          layoutGridStep={layoutGrids[screen.id]?.size ?? 1}
          content={screenContent}
          contentKey={screenContentKey}
          runtimeReplacementContent={
            useRuntimeReplacement ? screenContent : undefined
          }
          runtimeReplacementKey={runtimeReplacementKey}
          styleRevertRequest={
            pendingVisualStyleRevertRequest
              ? {
                  requestId: pendingVisualStyleRevertRequest.requestId,
                  patches: pendingVisualStyleRevertRequest.patches.filter(
                    (patch) => patch.screenId === screen.id,
                  ),
                }
              : null
          }
          pendingStylePreviewPatches={pendingVisualStyleEdits}
          styleBaselineResetRequest={pendingVisualStyleBaselineResetRequest}
          textRevertRequest={
            pendingTextRevertRequest
              ? {
                  requestId: pendingTextRevertRequest.requestId,
                  patches: pendingTextRevertRequest.patches.filter(
                    (patch) => patch.screenId === screen.id,
                  ),
                }
              : null
          }
          structureAckRequest={
            pendingStructureAckRequest
              ? {
                  requestId: pendingStructureAckRequest.requestId,
                  acks: pendingStructureAckRequest.acks.filter(
                    (ack) => ack.screenId === screen.id,
                  ),
                }
              : null
          }
          runtimeStructureMoveRequest={
            runtimeStructureMoveRequest?.screenId === screen.id
              ? runtimeStructureMoveRequest
              : null
          }
          runtimeStructureInsertRequest={
            runtimeStructureInsertRequest?.screenId === screen.id
              ? runtimeStructureInsertRequest
              : null
          }
          runtimeStructureDeleteRequest={
            runtimeStructureDeleteRequest?.screenId === screen.id
              ? runtimeStructureDeleteRequest
              : null
          }
          runtimeStructureRollbackRequest={
            runtimeStructureRollbackRequest?.screenId === screen.id
              ? runtimeStructureRollbackRequest
              : null
          }
          runtimeStructureTargetTransactionId={
            runtimeStructureDeleteRequest?.rollbackScreenId === screen.id
              ? runtimeStructureDeleteRequest.transactionId
              : null
          }
          runtimeLayerRenameRequest={runtimeLayerRenameForScreen(screen.id)}
          runtimeLayerSnapshotRequest={runtimeLayerSnapshotRequest}
          onRuntimeStructureInsertRejected={
            handleRuntimeStructureInsertRejected
          }
          onRuntimeStructureInsertApplied={handleRuntimeStructureInsertApplied}
          onRuntimeStructureDeleteApplied={handleRuntimeStructureDeleteApplied}
          onRuntimeStructureDeleteRejected={
            handleRuntimeStructureDeleteRejected
          }
          onRuntimeStructureRollbackResult={
            handleRuntimeStructureRollbackResult
          }
          onRuntimeLayerRenameApplied={(details) =>
            handleRuntimeLayerRenameApplied(screen.id, details)
          }
          runtimeVerificationRequest={
            runtimeStructureVerificationRequest?.screenIds.includes(screen.id)
              ? {
                  requestId: runtimeStructureVerificationRequest.requestId,
                }
              : null
          }
          screenId={screen.id}
          previewUrlOverride={
            !screenSnapshotOnly && screenSourceType === "localhost"
              ? previewUrlAtLiveRoute(screenPreviewUrl, currentLiveRoutePath)
              : undefined
          }
          previewUrlSourceKey={`${screen.id}:${screenPreviewUrl ?? getContentSignature(screenContent)}`}
          previewFrameId={
            breakpointWidthPx === undefined
              ? undefined
              : getBreakpointIframeId(screen.id, breakpointWidthPx)
          }
          zoom={100}
          deviceFrame="none"
          sourceType={screenSourceType}
          allowLocalNetworkAccessPrompt={screenIsActive}
          bridgeUrl={screenBridgeUrl}
          connectionId={screenSnapshotOnly ? undefined : screen.connectionId}
          nativePreviewActive={screenIsActive}
          sharedSnapshotPollActive={screenIsActive}
          previewToken={screenSnapshotOnly ? undefined : screenPreviewToken}
          liveEditCapability={
            screenSnapshotOnly ? undefined : screenLiveEditCapability
          }
          liveEditRegistrationCapability={
            screenSnapshotOnly
              ? undefined
              : screenLiveEditRegistrationCapability
          }
          onPreviewTokenChange={
            screenSnapshotOnly ? undefined : handleEffectivePreviewTokenChange
          }
          onLiveEditCapabilityChange={
            screenSnapshotOnly ? undefined : handleLiveEditCapabilityChange
          }
          onLiveEditRegistrationCapabilityChange={
            screenSnapshotOnly
              ? undefined
              : handleLiveEditRegistrationCapabilityChange
          }
          onRoutePathChange={
            screenSnapshotOnly ? undefined : handleLiveRoutePathChange
          }
          publicVisualEdit={!screenSnapshotOnly && publicVisualEdit}
          externalSnapshotHtml={screenSnapshotOnly ? undefined : screenSnapshot}
          snapshotOnly={screenSnapshotOnly}
          blockPreviewInteraction={
            remoteVisualEditPending &&
            (mode === "interact" || overviewInteractScreenId === screen.id)
          }
          onBootStart={renderOptions?.onBootStart}
          onBootReady={renderOptions?.onBootReady}
          onRuntimeReload={renderOptions?.onRuntimeReload}
          onExternalContentSnapshot={
            screenSnapshotOnly
              ? undefined
              : (snapshot) =>
                  handleScreenExternalContentSnapshot(screen.id, snapshot)
          }
          onRuntimeLayerSnapshotReadinessChange={
            (screenIsActive || screenIsBeingExported) &&
            runtimeProjectionEligible
              ? getRuntimeLayerSnapshotReadinessCallback(screen.id)
              : undefined
          }
          onRuntimeLayerSnapshot={
            runtimeProjectionEligible
              ? getRuntimeLayerSnapshotCallback(screen.id)
              : undefined
          }
          onReserveVisualEditSnapshot={
            !screenSnapshotOnly &&
            canEditDesign &&
            liveCollaborationEnabled &&
            id &&
            screenSourceType === "localhost"
              ? reserveVisualEditSnapshot
              : undefined
          }
          onScreenRootComputedStyles={getScreenRootComputedStylesCallback(
            breakpointWidthPx === undefined
              ? screen.id
              : getBreakpointIframeId(screen.id, breakpointWidthPx),
          )}
          onRuntimeVerificationSnapshot={
            runtimeStructureVerificationRequest?.screenIds.includes(screen.id)
              ? getRuntimeVerificationSnapshotCallback(screen.id)
              : undefined
          }
          fusionUrl={designFusionUrl}
          onComponentSourceJump={handleComponentSourceJump}
          motionTracks={screenIsActive ? motionTracksWire : NO_MOTION_TRACKS}
          motionDefaultEase={motionDefaultEase}
          motionDurationMs={motionDurationMs}
          shaderFillPreview={screenIsActive ? shaderFillPreview : null}
          gradientEditTarget={
            inScreenGradientEditTarget?.screenId === screen.id
              ? inScreenGradientEditTarget
              : null
          }
          onGradientEditChange={handleInScreenGradientEditChange}
          statePreviewTarget={
            statePreviewTarget?.screenId === screen.id
              ? statePreviewTarget
              : null
          }
          embeddedFrame={
            breakpointFrame
              ? {
                  viewportWidth: breakpointFrame.widthPx,
                  viewportHeight: breakpointFrame.viewportHeight,
                  displayWidth: breakpointFrame.displayWidth,
                  displayHeight: breakpointFrame.displayHeight,
                }
              : getEmbeddedFrame(screen.id, geometry.width, geometry.height)
          }
          fitRootBodyToFrame={metadata.heightMode !== "hug"}
          editorChromeScaleX={overviewCanvasZoom / 100}
          editorChromeScaleY={overviewCanvasZoom / 100}
          editMode={
            screenSnapshotOnly ||
            (mode === "edit" && overviewInteractScreenId !== screen.id)
          }
          interactMode={
            !screenSnapshotOnly &&
            (mode === "interact" || overviewInteractScreenId === screen.id)
          }
          readOnly={!canEditDesign && !canEditLiveScreen(screen.id)}
          scaleMode={screenIsActive && activeTool === "scale"}
          handToolActive={activeTool === "hand"}
          spacePanActive={spacePanActive}
          clearSelectionRequest={overviewClearSelectionRequest}
          registerRuntimeBridge={screenIsActive || screenIsBeingExported}
          selectedSelector={screenOwnsSelection ? selectedCanvasSelector : null}
          selectedSelectorCandidates={
            screenOwnsSelection
              ? selectedCanvasSelectorCandidates
              : NO_SELECTORS
          }
          selectedSelectorGroups={screenSelectedLayerGroups}
          passiveSelectionStyle={
            screen.breakpointWidths?.length && !screenIsActive
              ? "soft"
              : "default"
          }
          hoveredSelector={
            hoveredElementScreenId === screen.id ? hoveredCanvasSelector : null
          }
          hoveredSelectorCandidates={
            hoveredElementScreenId === screen.id
              ? hoveredCanvasSelectorCandidates
              : NO_SELECTORS
          }
          lockedSelectors={getLayerSelectorsForFile(screen.id, lockedLayerIds)}
          hiddenSelectors={getLayerSelectorsForFile(screen.id, hiddenLayerIds)}
          onElementSelect={(info, intent) => {
            activateResponsiveScope();
            handleIframeElementSelect(screen.id, info, intent, {
              breakpointWidthPx,
            });
          }}
          onElementMarqueeSelect={(infos, intent) => {
            activateResponsiveScope();
            handleScreenElementMarqueeSelect(screen.id, infos, intent);
          }}
          onElementHover={(info) => handleScreenElementHover(screen.id, info)}
          onEditorDragStateChange={handleEditorDragStateChange}
          onClearSelection={() => {
            activateResponsiveScope();
            handleScreenElementClear(screen.id, breakpointWidthPx);
          }}
          onIframeHotkey={handleIframeHotkey}
          onFigmaClipboardPaste={handleCanvasFigmaClipboardPaste}
          onImagePaste={handleCanvasImagePaste}
          onIframeContextMenu={(payload) =>
            handleIframeContextMenu({ ...payload, breakpointWidthPx })
          }
          onVisualStyleChange={(selector, styles, info, metadata) => {
            activateResponsiveScope();
            handleScreenVisualStyleChange(
              screen.id,
              selector,
              styles,
              info,
              metadata,
            );
          }}
          onVisualStyleBatchChange={(changes) => {
            activateResponsiveScope();
            return handleKScaleStyleBatchChange(screen.id, changes);
          }}
          onVisualStructureChange={(
            selector,
            anchorSelector,
            placement,
            info,
            details,
          ) => {
            activateResponsiveScope();
            return handleScreenVisualStructureChange(
              screen.id,
              selector,
              anchorSelector,
              placement,
              info,
              details,
            );
          }}
          onVisualGridGroupChange={(moves) => {
            activateResponsiveScope();
            return handleScreenGridGroupChange(screen.id, moves);
          }}
          onVisualDuplicateChange={(selector, cloneHtml, info, details) => {
            activateResponsiveScope();
            return handleScreenVisualDuplicateChange(
              screen.id,
              selector,
              cloneHtml,
              info,
              details,
            );
          }}
          onTextContentChange={(selector, value, info, details) => {
            activateResponsiveScope();
            handleScreenTextContentChange(
              screen.id,
              selector,
              value,
              info,
              details,
            );
          }}
          onTextEditingStateChange={(state) =>
            handleTextEditingStateChangeForScreen(screen.id, state)
          }
          onElementDblClickText={(info) =>
            handleScreenElementDblClickText(screen.id, info)
          }
          tweakValues={cssVarValues}
          drawMode={false}
          pinMode={screenIsActive && pinMode}
          commentPinsHidden={commentsHidden || !screenIsActive}
          onExitPinMode={handleExitReviewCommentMode}
          designId={id}
          reviewCanPost={canCommentDesign}
          reviewCanResolve={canEditDesign}
          reviewCurrentUserEmail={session?.email}
          reviewFocusRequest={reviewFocusRequest}
          onDispatchCommentToAgent={handleDispatchCommentToAgent}
          onSendThreadToAgent={handleSendReviewThreadToAgent}
          reviewSendingThreadId={reviewSendingThreadId}
          designTitle={design?.title}
          commentContextId={`${id}:${screen.id}`}
          commentContextLabel={`${design?.title ?? t("navigation.brand")} / ${prettyScreenName(screen.filename)}`}
          repromptDraftRequest={
            repromptDraftRequest?.fileId === screen.id
              ? repromptDraftRequest
              : null
          }
          nodeRewriteCanvasTarget={screenIsActive}
          onRepromptDraftConsumed={handleRepromptDraftConsumed}
        />
      );
    },
    [
      activeFile?.id,
      activeBreakpointWidthState,
      exportPreviewScreenId,
      getScreenContent,
      handleBreakpointBarSelect,
      designSourceType,
      liveScreenSnapshotsById,
      pendingVisualStyleEdits,
      pendingVisualStyleRevertRequest,
      pendingVisualStyleBaselineResetRequest,
      pendingTextRevertRequest,
      pendingStructureAckRequest,
      runtimeStructureMoveRequest,
      runtimeStructureInsertRequest,
      runtimeStructureDeleteRequest,
      runtimeStructureRollbackRequest,
      handleRuntimeStructureInsertRejected,
      handleRuntimeStructureDeleteApplied,
      handleRuntimeStructureInsertApplied,
      handleRuntimeStructureDeleteRejected,
      handleRuntimeStructureRollbackResult,
      handleLiveRoutePathChange,
      liveRoutePathsByScreenId,
      handleRuntimeStructureDeleteApplied,
      runtimeStructureVerificationRequest,
      contentRenderRevision,
      handleScreenExternalContentSnapshot,
      getRuntimeLayerSnapshotCallback,
      getRuntimeLayerSnapshotReadinessCallback,
      getScreenRootComputedStylesCallback,
      getRuntimeVerificationSnapshotCallback,
      designFusionUrl,
      handleComponentSourceJump,
      motionTracksWire,
      motionDefaultEase,
      motionDurationMs,
      shaderFillPreview,
      inScreenGradientEditTarget,
      handleInScreenGradientEditChange,
      statePreviewTarget,
      getEmbeddedFrame,
      overviewCanvasZoom,
      mode,
      overviewInteractScreenId,
      remoteVisualEditPending,
      isVisualEditSurface,
      isLiveCanvasShareLink,
      publicVisualEditConnectionId,
      publicVisualEditPreviewTokenQuery.data?.previewToken,
      publicVisualEditPreviewTokenQuery.data?.connections,
      designAccessRole,
      scheduleVisualEditSnapshotPublication,
      canEditDesign,
      canEditLiveScreen,
      effectivePreviewTokensByScreenId,
      effectiveLiveEditCapabilitiesByScreenId,
      handleEffectivePreviewTokenChange,
      handleLiveEditCapabilityChange,
      canCommentDesign,
      activeTool,
      pinMode,
      commentsHidden,
      spacePanActive,
      overviewClearSelectionRequest,
      selectedCanvasSelector,
      selectedCanvasSelectorCandidates,
      selectedLayerSelectorGroupsByScreen,
      selectedElementScreenId,
      hoveredElementScreenId,
      hoveredCanvasSelector,
      hoveredCanvasSelectorCandidates,
      getLayerSelectorsForFile,
      lockedLayerIds,
      hiddenLayerIds,
      handleIframeElementSelect,
      handleScreenElementMarqueeSelect,
      handleScreenElementHover,
      handleEditorDragStateChange,
      handleScreenElementClear,
      handleIframeHotkey,
      handleCanvasFigmaClipboardPaste,
      handleCanvasImagePaste,
      handleIframeContextMenu,
      handleScreenVisualStyleChange,
      handleScreenVisualStructureChange,
      handleScreenVisualDuplicateChange,
      handleScreenTextContentChange,
      handleTextEditingStateChangeForScreen,
      handleScreenElementDblClickText,
      cssVarValues,
      id,
      design?.title,
      session?.email,
      reviewFocusRequest,
      handleDispatchCommentToAgent,
      handleSendReviewThreadToAgent,
      reviewSendingThreadId,
      repromptDraftRequest,
      handleRepromptDraftConsumed,
      handleExitReviewCommentMode,
      layoutGrids,
      t,
    ],
  );
  const renderScreenContent = useCallback<OverviewScreenRenderer>(
    (screen, metadata, geometry, options) => {
      recordDesignPerformance("renderScreenContent");
      return renderEditableScreenContent(
        screen,
        metadata,
        geometry,
        undefined,
        options,
      );
    },
    [renderEditableScreenContent],
  );
  const renderBreakpointContent = useCallback<OverviewBreakpointRenderer>(
    (screen, metadata, frame) =>
      renderEditableScreenContent(
        screen,
        metadata,
        {
          x: 0,
          y: 0,
          width: frame.displayWidth,
          height: frame.displayHeight,
        },
        frame,
        {
          onBootStart: frame.onBootStart,
          onBootReady: frame.onBootReady,
          onRuntimeReload: frame.onRuntimeReload,
        },
      ),
    [renderEditableScreenContent],
  );

  const handleBoardElementSelect = useCallback<
    NonNullable<MultiScreenCanvasProps["onBoardElementSelect"]>
  >(
    (info, intent) => {
      if (!boardFileId) return;
      handleIframeElementSelect(boardFileId, info, intent);
    },
    [boardFileId, handleIframeElementSelect],
  );
  const handleBoardElementHover = useCallback<
    NonNullable<MultiScreenCanvasProps["onBoardElementHover"]>
  >(
    (info) => {
      if (!boardFileId) return;
      handleScreenElementHover(boardFileId, info);
    },
    [boardFileId, handleScreenElementHover],
  );
  const handleBoardElementClear = useCallback(() => {
    if (!boardFileId) return;
    handleScreenElementClear(boardFileId);
  }, [boardFileId, handleScreenElementClear]);
  const handleBoardTextEditingStateChange = useCallback<
    NonNullable<MultiScreenCanvasProps["onBoardTextEditingStateChange"]>
  >(
    (state) => {
      handleTextEditingStateChangeForScreen(boardFileId ?? "__board__", state);
    },
    [boardFileId, handleTextEditingStateChangeForScreen],
  );
  const handleBoardElementDblClickText = useCallback<
    NonNullable<MultiScreenCanvasProps["onBoardElementDblClickText"]>
  >(
    (info) => {
      if (!boardFileId) return;
      handleScreenElementDblClickText(boardFileId, info);
    },
    [boardFileId, handleScreenElementDblClickText],
  );
  const handleBoardVisualStyleBatchChange = useCallback<
    NonNullable<MultiScreenCanvasProps["onBoardVisualStyleBatchChange"]>
  >(
    (changes) => {
      if (!boardFileId) return false;
      return handleKScaleStyleBatchChange(boardFileId, changes);
    },
    [boardFileId, handleKScaleStyleBatchChange],
  );
  const addDesignBreakpoint = useCallback(
    (widthPx: number, label?: string) => {
      if (!id) return;
      const resolvedLabel = label ?? breakpointLabelForWidth(widthPx);
      const existingWidths = getDesignBreakpointWidths(
        designDataJsonRef.current,
      );
      if (existingWidths.includes(widthPx)) return;
      const nextWidths = [...new Set([...existingWidths, widthPx])];
      const optimisticId = `optimistic-bp-${widthPx}`;
      const geometryBefore = cloneCanvasFrameGeometry(
        getCanvasFrameGeometry(designDataJsonRef.current),
      );
      const { rollback } = beginOptimisticBreakpointSetPatch({
        designId: id,
        queryClient,
        designDataJsonRef,
        nextData: optimisticAddBreakpointData(designDataJsonRef.current, {
          id: optimisticId,
          label: resolvedLabel,
          widthPx,
        }),
      });
      reflowOverviewScreensForBreakpoints(nextWidths);
      void addBreakpointMutation
        .mutateAsync({
          designId: id,
          id: optimisticId,
          label: resolvedLabel,
          widthPx,
        })
        .catch((error) => {
          rollback();
          const geometryAfter = getCanvasFrameGeometry(
            designDataJsonRef.current,
          );
          handleGeometryCommit(geometryAfter, geometryBefore);
          toast.error(t("common.genericError"), {
            description:
              error instanceof Error
                ? error.message
                : t("designEditor.breakpointBar.addBreakpoint"),
          });
        });
    },
    [
      addBreakpointMutation,
      handleGeometryCommit,
      id,
      queryClient,
      reflowOverviewScreensForBreakpoints,
      t,
    ],
  );
  const handleBreakpointBarAdd = useCallback(
    (widthPx: number, label: string) => addDesignBreakpoint(widthPx, label),
    [addDesignBreakpoint],
  );
  const handleBreakpointChangeWidth = useCallback(
    (breakpointId: string, widthPx: number) => {
      if (!id) return;
      const existing = designBreakpoints.find((bp) => bp.id === breakpointId);
      if (!existing || existing.widthPx === widthPx) return;
      if (
        designBreakpoints.some(
          (bp) => bp.id !== breakpointId && bp.widthPx === widthPx,
        )
      ) {
        return;
      }
      const label = breakpointLabelForWidth(widthPx);
      void updateBreakpointMutation
        .mutateAsync({
          designId: id,
          breakpointId,
          label,
          widthPx,
        })
        .then((result) => {
          if (!result?.updated) {
            toast.error(t("common.genericError"), {
              description:
                result?.reason ?? t("designEditor.breakpointBar.changeWidth"),
            });
            return;
          }
          const reconcilePending = (
            result as { collabReconcilePending?: unknown } | undefined
          )?.collabReconcilePending;
          if (Array.isArray(reconcilePending) && reconcilePending.length > 0) {
            toast.warning(t("visualEditor.changesSaveWhenReconnected"));
          }
          if (activeBreakpointWidthStateRef.current === existing.widthPx) {
            handleBreakpointBarSelect(widthPx, breakpointId);
          }
        })
        .catch((error) => {
          toast.error(t("common.genericError"), {
            description:
              error instanceof Error
                ? error.message
                : t("designEditor.breakpointBar.changeWidth"),
          });
        });
    },
    [
      id,
      designBreakpoints,
      handleBreakpointBarSelect,
      t,
      updateBreakpointMutation,
    ],
  );

  const handleOverviewAddBreakpoint = useCallback(
    (widthPx: number) => addDesignBreakpoint(widthPx),
    [addDesignBreakpoint],
  );
  const handleOverviewActiveBreakpointChange = useCallback(
    (_screenId: string, widthPx: number | undefined) => {
      activeBreakpointWidthStateRef.current = widthPx;
      setActiveBreakpointWidthState(widthPx);
      if (!id) return;
      const bpSet = (() => {
        try {
          const raw = (designDataJson as Record<string, unknown>)
            ?.breakpointSet;
          if (
            raw &&
            typeof raw === "object" &&
            Array.isArray((raw as Record<string, unknown>).breakpoints)
          ) {
            return raw as {
              breakpoints: Array<{ id: string; widthPx: number }>;
            };
          }
          // coercion-ok: unreadable breakpoint data reads as "none configured"; the mutation below still clears back to auto.
        } catch {
          // Ignore malformed design data; the mutation below can still clear
          // back to auto.
        }
        return null;
      })();
      const bp = bpSet?.breakpoints.find((b) => b.widthPx === widthPx);
      const breakpointId = widthPx !== undefined && bp ? bp.id : "auto";
      lastAppliedActiveBreakpointIdRef.current = breakpointId;
      persistActiveBreakpoint(breakpointId, responsiveEditScopeRef.current);
    },
    [id, designDataJson, persistActiveBreakpoint],
  );
  const handleOverviewChangeBreakpointWidth = useCallback(
    (_screenId: string, widthPx: number, nextWidthPx: number) => {
      const bp = designBreakpoints.find((b) => b.widthPx === widthPx);
      if (!bp) return;
      handleBreakpointChangeWidth(bp.id, nextWidthPx);
    },
    [designBreakpoints, handleBreakpointChangeWidth],
  );

  useEffect(() => {
    if (!id) void navigate("/home");
  }, [id, navigate]);

  return {
    applyToSourcePending,
    handleIframeHotkey,
    handleKScaleStyleBatchChange,
    handleApplyToSource,
    zoomLabel,
    openZoomControl,
    setOpenZoomControl,
    zoomInputValue,
    setZoomInputValue,
    commitZoomInput,
    renderScreenContent,
    renderBreakpointContent,
    handleBoardElementSelect,
    handleBoardElementHover,
    handleBoardElementClear,
    handleBoardTextEditingStateChange,
    handleBoardElementDblClickText,
    handleBoardVisualStyleBatchChange,
    handleBreakpointBarAdd,
    handleBreakpointChangeWidth,
    handleOverviewAddBreakpoint,
    handleOverviewActiveBreakpointChange,
    handleOverviewChangeBreakpointWidth,
  };
}

export type EditorScreenRendering = ReturnType<typeof useEditorScreenRendering>;
