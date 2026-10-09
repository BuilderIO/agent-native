import {
  setAgentChatContextItem,
  removeAgentChatContextItem,
  useAgentChatContext,
} from "@agent-native/core/client/agent-chat";
import type { ReviewComment } from "@agent-native/core/review";
import { type PromptComposerSubmitOptions } from "@agent-native/toolkit/app/chat/composer/index";
import {
  buildReviewThreads,
  type ReviewThread,
} from "@agent-native/toolkit/app/review";
import {
  buildCodeLayerProjection,
  removeCodeLayerNodeFromHtml,
} from "@shared/code-layer";
import { getOverviewScreenFileIds } from "@shared/design-files";
import {
  setPenNodeCornerRadius,
  translatePenPath,
  type PenGeometry,
  type PenPath,
} from "@shared/pen-path";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";

import { type CodeWorkbenchActiveFile } from "@/components/design/code-workbench/CodeWorkbench";
import type { CreatePrimitiveSpec } from "@/components/design/design-canvas/creation";
import type { ScaleToolControls } from "@/components/design/edit-panel/scale-properties";
import { isKeyboardShortcutsDialogTarget } from "@/components/design/KeyboardShortcutsDialog";
import type {
  CanvasPrimitiveInsert,
  MultiScreenCanvasTool,
  ScreenProjectionNodeIdentity,
  VectorEditOverlayState,
} from "@/components/design/multi-screen/types";
import { reviewThreadIdFromHash } from "@/components/design/review-link";
import { type ReviewCommentsPanelProps } from "@/components/design/ReviewCommentsPanel";
import type { ElementSelectionIntent } from "@/components/design/types";
import type { UploadedFile } from "@/components/editor/PromptDialog";
import { type DrawAnnotation } from "@/components/visual-editor/DrawOverlay";
import {
  isDesignHotkeyEditableTarget,
  isNativeKeyboardActivationTarget,
} from "@/hooks/useDesignHotkeys";
import { sendToDesignAgentChat } from "@/lib/agent-chat";

import { uniqueLayerId } from "../canvas-primitive-insert";
import { createPrimitiveInsertFromSpec } from "../canvas-primitives";
import {
  writeBackPrimitiveAsVector,
  writeBackVectorEditedPenPath,
} from "../clone-and-pen-edit";
import { runCreatePrimitive } from "../commands/create-primitive";
import { runPrimitiveCreated } from "../commands/primitive-created";
import { runScaleSelection } from "../commands/scale-selection";
import { runSendOverviewAnnotations } from "../commands/send-overview-annotations";
import { runTweakPromptSubmit } from "../commands/tweak-prompt-submit";
import { getCreatedScreenNavigationPlan } from "../created-screen-navigation";
import {
  EMPTY_TEXT_CLEANUP_MAX_ATTEMPTS,
  EMPTY_TEXT_CLEANUP_RETRY_MS,
} from "../editor-constants";
import { buildSignInHrefForComment } from "../editor-helpers";
import { runMirrorSelectionToAgentChat } from "../effects/mirror-selection-to-agent-chat";
import { runPublishAgentSelectionContext } from "../effects/publish-agent-selection-context";
import { loadDesignSystemGenerationContext } from "../generation-prompt-directives";
import { getScreenFrameOriginCanvas } from "../overview-camera";
import { blurActiveDesignEditableTarget } from "../png-export-render";
import {
  applyExplicitOverviewScreenSelectionToggle,
  computeOverviewScreenPickSelectionIds,
  getSelectedScreenIdsForEditorState,
  overviewScreenSelectionForPendingEcho,
  sameStringIds,
  shouldClearSelectionForReviewThreadTarget,
  updateExplicitOverviewScreenSelection,
} from "../selection-state";
import { endedTextEditMatchesPendingCreation } from "../text-edit-utils";
import {
  resolveSpaceForwardTransition,
  resolveToolAfterSelection,
} from "../tool-state";
import { type DesignTool, type ShapeTool } from "../types";
import type { EditorActiveScreenAndGeometry } from "./use-editor-active-screen-and-geometry";
import type { EditorCanvasAndScreens } from "./use-editor-canvas-and-screens";
import type { EditorContentAndComponents } from "./use-editor-content-and-components";
import type { EditorCore } from "./use-editor-core";
import type { EditorFilesAndSaving } from "./use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "./use-editor-generation-and-access";
import type { EditorHistory } from "./use-editor-history";
import type { EditorLiveEditsAndPresence } from "./use-editor-live-edits-and-presence";

export function useEditorToolsAndVectors({
  editorCore,
  editorHistory,
  editorGenerationAndAccess,
  editorFilesAndSaving,
  editorActiveScreenAndGeometry,
  editorCanvasAndScreens,
  editorLiveEditsAndPresence,
  editorContentAndComponents,
}: {
  editorCore: EditorCore;
  editorHistory: EditorHistory;
  editorGenerationAndAccess: EditorGenerationAndAccess;
  editorFilesAndSaving: EditorFilesAndSaving;
  editorActiveScreenAndGeometry: EditorActiveScreenAndGeometry;
  editorCanvasAndScreens: EditorCanvasAndScreens;
  editorLiveEditsAndPresence: EditorLiveEditsAndPresence;
  editorContentAndComponents: EditorContentAndComponents;
}) {
  const {
    t,
    id,
    session,
    isSignedIn,
    location,
    shellMode,
    embedded,
    embedChromeRequested,
    mode,
    setMode,
    activeTool,
    setActiveTool,
    activeToolRef,
    viewMode,
    setViewMode,
    viewModeRef,
    selectedElement,
    setSelectedElement,
    setRuntimeStructureInsertRequest,
    textEditingState,
    hoveredElement,
    setHoveredElement,
    activeFileId,
    setActiveFileId,
  } = editorCore;
  const {
    activeInspectorTab,
    setActiveInspectorTab,
    activeLeftPanel,
    setActiveLeftPanel,
    selectedLayerIdsState,
    setSelectedLayerIdsState,
    codeLayerOwnerByNodeIdRef,
    overviewSelectedScreenIds,
    setOverviewSelectedScreenIds,
    setCreatedOverviewLayerSelection,
    pendingOverviewScreenSelectionRef,
    pendingOverviewLayerSelectionRef,
    pendingTextCreationHistoryRef,
    clearPendingOverviewLayerSelectionTimer,
    motionDockOpen,
    activeBreakpointWidthState,
    activeBreakpointWidthStateRef,
    selectedLayerIdsStateRef,
    overviewSelectedScreenIdsRef,
    explicitOverviewScreenSelectionRef,
    prepareTextCreationFinalization,
  } = editorHistory;
  const {
    persistedSelectionStateRef,
    persistedSelectionContextRef,
    pendingPersistedSelectionWriteRef,
    persistedSelectionWriteTimerRef,
    designSelectionOwnerIdRef,
    setDrawMode,
    setPinMode,
    resetAgentGenerating,
    pendingQuestions,
    design,
    canEditDesign,
    canCommentDesign,
    reviewResult,
    reviewComments,
    sendReviewThreadToAgent,
    reviewSendingThreadId,
    setReviewSendingThreadId,
    canEditDesignRef,
  } = editorGenerationAndAccess;
  const {
    tweakSelections,
    tweaks,
    handleTweakPromptOpenChange,
    files,
    codeLayerSourceForScreen,
    designDataJson,
    layoutGrids,
    canvasFrameGeometryById,
    boardFileId,
    overviewScreens,
    remoteVisualEditPending,
  } = editorFilesAndSaving;
  const {
    responsiveEditScope,
    activeFile,
    handleBreakpointBarSelect,
    overviewCanvasZoom,
    setCameraCommand,
    cameraCommandNonceRef,
    exportCanvasFrameGeometryById,
  } = editorActiveScreenAndGeometry;
  const {
    setHoveredElementScreenId,
    setOverviewClearSelectionRequest,
    activeEditorDragRef,
    canvasIframeRef,
    getScreenContent,
  } = editorCanvasAndScreens;
  const {
    selectedStateId,
    zoom,
    canvasContainerRef,
    activeProjectionContent,
    selectedCodeLayerNode,
  } = editorLiveEditsAndPresence;
  const { applyLocalContentUpdate, applyFileContentUpdate } =
    editorContentAndComponents;

  const [shapeTool, setShapeTool] = useState<ShapeTool>("rect");
  const [vectorEditingState, setVectorEditingState] = useState<{
    screenId: string;
    nodeId: string;
    layerId: string;
    path: PenPath;
    selectedAnchorIndex: number | null;
    sourceOffset: { x: number; y: number };
    primitiveSource: {
      geometry: PenGeometry;
      fill: string;
    } | null;
  } | null>(null);
  const runtimeStructureInsertRevisionRef = useRef(0);
  const [reviewFocusRequest, setReviewFocusRequest] = useState<{
    nonce: number;
    anchor: unknown;
    targetId?: string | null;
    threadId?: string;
  } | null>(null);
  const reviewFocusNonceRef = useRef(0);
  const openedReviewHashRef = useRef<string | null>(null);
  const layersRevealedForFirstCreateRef = useRef(false);
  const [activeCodeFile, setActiveCodeFile] =
    useState<CodeWorkbenchActiveFile | null>(null);
  const pendingTextEditNodeIdRef = useRef<string | null>(null);
  const pendingEmptyTextEditRef = useRef<{
    screenId: string | null;
    nodeId: string;
    cancel: () => void;
    settled: boolean;
  } | null>(null);
  const selectionRevisionRef = useRef(0);
  const [overviewAnnotationResetSignal, setOverviewAnnotationResetSignal] =
    useState(0);
  const [focusedAnnotationResetSignal, setFocusedAnnotationResetSignal] =
    useState(0);
  const [overviewAnnotationSending, setOverviewAnnotationSending] =
    useState(false);
  const overviewAnnotationSendingRef = useRef(false);
  const signInToCommentHref = buildSignInHrefForComment();

  const selectedScreenIds = useMemo(
    () =>
      getSelectedScreenIdsForEditorState({
        activeFileId: activeFile?.id ?? activeFileId,
        overviewSelectedScreenIds,
        viewMode,
      }),
    [activeFile?.id, activeFileId, overviewSelectedScreenIds, viewMode],
  );
  const canvasBackgroundRef = useRef<string | null>(null);

  const dispatchReviewFeedbackToAgent = useCallback(
    (root: ReviewComment, replies: ReviewComment[] = []) => {
      if (!id) return;
      const replyText = replies
        .map((reply) => `${reply.authorName ?? "Reviewer"}: ${reply.body}`)
        .join("\n");
      sendToDesignAgentChat({
        message: "Apply this selected design review thread only.", // i18n-ignore agent dispatch prompt
        context: [
          `Design id: ${id}`,
          `Review thread id: ${root.threadId}`,
          `Screen id: ${root.targetId ?? "unknown"}`,
          `Feedback: ${root.body}`,
          replyText ? `Replies:\n${replyText}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        submit: true,
        openSidebar: true,
        newTab: true,
      });
    },
    [id],
  );

  const handleDispatchCommentToAgent = useCallback(
    (comment: ReviewComment) => {
      if (!canEditDesign) return;
      dispatchReviewFeedbackToAgent(comment);
    },
    [canEditDesign, dispatchReviewFeedbackToAgent],
  );

  const handleSendReviewThreadToAgent = useCallback(
    (thread: ReviewThread) => {
      if (
        !id ||
        !canEditDesign ||
        thread.root.status !== "open" ||
        reviewSendingThreadId
      ) {
        return;
      }
      setReviewSendingThreadId(thread.root.threadId);
      sendReviewThreadToAgent.mutate(
        {
          resourceType: "design",
          resourceId: id,
          threadId: thread.root.threadId,
        },
        {
          onSuccess: () => {
            dispatchReviewFeedbackToAgent(thread.root, thread.replies);
          },
          onError: () => {
            setReviewSendingThreadId(null);
            toast.error(t("review.sendToAgentFailed"));
          },
        },
      );
    },
    [
      canEditDesign,
      dispatchReviewFeedbackToAgent,
      id,
      reviewSendingThreadId,
      sendReviewThreadToAgent,
      t,
    ],
  );

  const handleReviewThreadSelect = useCallback(
    (thread: ReviewThread) => {
      const targetId = thread.root.targetId;
      explicitOverviewScreenSelectionRef.current =
        targetId && overviewScreens.some((screen) => screen.id === targetId)
          ? [targetId]
          : [];
      if (
        shouldClearSelectionForReviewThreadTarget({
          activeFileId: activeFile?.id,
          targetId,
          boardFileId,
        })
      ) {
        setSelectedElement(null);
        setSelectedLayerIdsState([]);
        setHoveredElement(null);
        setHoveredElementScreenId(null);
        setOverviewClearSelectionRequest((request) => request + 1);
      }
      const boardTarget = targetId === null;
      if (targetId || boardTarget) {
        viewModeRef.current = "overview";
        setViewMode("overview");
        setActiveFileId(boardTarget ? (boardFileId ?? null) : targetId);
        setOverviewSelectedScreenIds(boardTarget ? [] : [targetId]);
        setSelectedLayerIdsState(boardTarget ? [] : [targetId]);
        setMode("edit");
      }
      setActiveInspectorTab("comments");
      reviewFocusNonceRef.current += 1;
      setReviewFocusRequest({
        nonce: reviewFocusNonceRef.current,
        anchor: thread.root.anchor,
        targetId,
        threadId: thread.root.threadId,
      });
    },
    [activeFile?.id, boardFileId, overviewScreens],
  );

  useEffect(() => {
    if (!id || reviewResult.isLoading) return;
    const threadId = reviewThreadIdFromHash(location.hash);
    if (!threadId) return;
    const hashKey = `${id}:${threadId}`;
    if (openedReviewHashRef.current === hashKey) return;
    const thread = buildReviewThreads(reviewComments).find(
      (candidate) => candidate.root.threadId === threadId,
    );
    if (!thread) return;
    openedReviewHashRef.current = hashKey;
    handleReviewThreadSelect(thread);
  }, [
    handleReviewThreadSelect,
    id,
    location.hash,
    reviewComments,
    reviewResult.isLoading,
  ]);

  const reviewCommentsPanelProps = useMemo<
    ReviewCommentsPanelProps | undefined
  >(
    () =>
      id
        ? {
            designId: id,
            canComment: canCommentDesign,
            currentUserEmail: session?.email,
            currentTargetId:
              activeFile?.id === boardFileId ? null : activeFile?.id,
            canResolve: canEditDesign,
            canDeleteComment: (comment) =>
              canEditDesign ||
              ("canDelete" in comment && comment.canDelete === true) ||
              comment.authorEmail === session?.email,
            signInHref: signInToCommentHref,
            canDispatchToAgent: canEditDesign,
            sendingThreadId: reviewSendingThreadId,
            onSendThreadToAgent: canEditDesign
              ? handleSendReviewThreadToAgent
              : undefined,
            onSelectThread: handleReviewThreadSelect,
          }
        : undefined,
    [
      canCommentDesign,
      canEditDesign,
      activeFile?.id,
      handleReviewThreadSelect,
      handleSendReviewThreadToAgent,
      id,
      reviewSendingThreadId,
      session?.email,
      signInToCommentHref,
    ],
  );

  const handleCreatePrimitive = useCallback(
    (
      screenId: string,
      primitive: CanvasPrimitiveInsert,
      options?: {
        reparentTargetIdentity?: ScreenProjectionNodeIdentity;
      },
    ) =>
      runCreatePrimitive(
        {
          activeBreakpointWidthState,
          activeFile,
          applyFileContentUpdate,
          applyLocalContentUpdate,
          boardFileId,
          canvasBackground: canvasBackgroundRef.current,
          canEditDesign,
          files,
          getScreenContent,
          pendingTextCreationHistoryRef,
          pendingTextEditNodeIdRef,
          overviewScreens,
          runtimeStructureInsertRevisionRef,
          setRuntimeStructureInsertRequest,
          t,
          viewModeRef,
        },
        screenId,
        primitive,
        options,
      ),
    [
      activeBreakpointWidthState,
      activeFile?.id,
      applyFileContentUpdate,
      applyLocalContentUpdate,
      boardFileId,
      canEditDesign,
      files,
      getScreenContent,
      overviewScreens,
      t,
    ],
  );

  const removeEmptyTextNodeIfUntouched = useCallback(
    (
      screenId: string | null,
      nodeId: string,
    ):
      | "removed"
      | "kept-has-content"
      | "node-absent"
      | "content-unavailable"
      | "no-screen"
      | "remove-failed" => {
      if (!screenId) return "no-screen";
      const content = getScreenContent(screenId);
      if (!content) return "content-unavailable";
      const projection = buildCodeLayerProjection(content, {
        source: codeLayerSourceForScreen(screenId),
      });
      const node = projection.nodes.find(
        (n) =>
          n.dataAttributes["data-agent-native-node-id"] === nodeId ||
          n.id === nodeId,
      );
      if (!node) return "node-absent";
      const hasContent = (node.textSnippet ?? "").trim().length > 0;
      if (hasContent) return "kept-has-content";
      const nextContent = removeCodeLayerNodeFromHtml(content, node);
      if (!nextContent || nextContent === content) return "remove-failed";
      const finalizedCreation = prepareTextCreationFinalization(
        screenId,
        [nodeId, node.id, node.dataAttributes["data-agent-native-node-id"]],
        nextContent,
      );
      const publication = applyFileContentUpdate(screenId, nextContent, {
        refreshPreview: false,
        recordHistory: !finalizedCreation.historyHandled,
      });
      if (publication.status !== "accepted") return "remove-failed";
      finalizedCreation.confirm();
      setSelectedLayerIdsState((current) =>
        current.filter((id) => id !== node.id),
      );
      setSelectedElement((current) =>
        current?.sourceId === nodeId || current?.id === nodeId ? null : current,
      );
      return "removed";
    },
    [
      applyFileContentUpdate,
      codeLayerSourceForScreen,
      prepareTextCreationFinalization,
      getScreenContent,
    ],
  );

  const removeEmptyTextNodeWithRetry = useCallback(
    (screenId: string | null, nodeId: string) => {
      const attempt = (remaining: number) => {
        const outcome = removeEmptyTextNodeIfUntouched(screenId, nodeId);
        if (outcome !== "node-absent" && outcome !== "content-unavailable") {
          return;
        }
        if (remaining <= 0) {
          console.warn(
            `[design] could not resolve empty text node ${screenId}/${nodeId} to clean up (${outcome})`,
          );
          return;
        }
        window.setTimeout(
          () => attempt(remaining - 1),
          EMPTY_TEXT_CLEANUP_RETRY_MS,
        );
      };
      attempt(EMPTY_TEXT_CLEANUP_MAX_ATTEMPTS - 1);
    },
    [removeEmptyTextNodeIfUntouched],
  );

  const handlePrimitiveCreated = useCallback(
    (
      screenId: string,
      nodeId: string,
      options?: {
        nextTool?: "move" | "pen";
        preserveActiveTool?: boolean;
      },
    ) =>
      runPrimitiveCreated(
        {
          activeLeftPanel,
          boardFileId,
          clearPendingOverviewLayerSelectionTimer,
          pendingEmptyTextEditRef,
          pendingOverviewLayerSelectionRef,
          pendingOverviewScreenSelectionRef,
          pendingTextEditNodeIdRef,
          layersRevealedForFirstCreateRef,
          removeEmptyTextNodeWithRetry,
          setActiveFileId,
          setActiveLeftPanel,
          setActiveTool,
          setCreatedOverviewLayerSelection,
          setHoveredElement,
          setMode,
          setOverviewSelectedScreenIds,
          setSelectedElement,
          setSelectedLayerIdsState,
        },
        screenId,
        nodeId,
        options,
      ),
    [
      activeLeftPanel,
      boardFileId,
      clearPendingOverviewLayerSelectionTimer,
      removeEmptyTextNodeWithRetry,
    ],
  );

  useEffect(() => {
    const pending = pendingEmptyTextEditRef.current;
    if (!endedTextEditMatchesPendingCreation(pending, textEditingState)) return;
    pending?.cancel();
  }, [
    textEditingState.active,
    textEditingState.screenId,
    textEditingState.sourceId,
  ]);

  const handleBoardDrawPrimitive = useCallback(
    (
      primitive: CanvasPrimitiveInsert,
      options?: {
        nextTool?: "move" | "pen";
        reparentTargetIdentity?: ScreenProjectionNodeIdentity;
      },
    ) => {
      if (!boardFileId || !canEditDesign) return false;
      const result = handleCreatePrimitive(
        boardFileId,
        primitive,
        options?.reparentTargetIdentity
          ? { reparentTargetIdentity: options.reparentTargetIdentity }
          : undefined,
      );
      if (!result) return false;
      const nodeId =
        typeof result === "string"
          ? result
          : typeof result === "object"
            ? result.nodeId
            : primitive.nodeId;
      if (nodeId) {
        handlePrimitiveCreated(boardFileId, nodeId, options);
      }

      return typeof result === "object"
        ? result
        : typeof result === "string"
          ? result
          : true;
    },
    [boardFileId, canEditDesign, handleCreatePrimitive, handlePrimitiveCreated],
  );

  const handleSingleScreenCreatePrimitive = useCallback(
    (spec: CreatePrimitiveSpec) => {
      if (!activeFile || !canEditDesign) return false;
      const nodeId = uniqueLayerId(spec.tool === "pen" ? "path" : spec.tool);
      const primitive = createPrimitiveInsertFromSpec(spec, nodeId);
      if (!primitive) return false;
      const result = handleCreatePrimitive(activeFile.id, primitive);
      if (!result) return false;
      const resultNodeId = typeof result === "string" ? result : nodeId;
      handlePrimitiveCreated(activeFile.id, resultNodeId, {
        nextTool:
          spec.nextTool ??
          (spec.tool === "pen" && spec.preserveActiveTool !== false
            ? "pen"
            : undefined),
        preserveActiveTool: spec.preserveActiveTool,
      });
      return resultNodeId;
    },
    [activeFile, canEditDesign, handleCreatePrimitive, handlePrimitiveCreated],
  );

  const handleUpdatePenPath = useCallback(
    (screenId: string, nodeId: string, path: PenPath) => {
      if (!canEditDesign) return false;
      const baseContent = getScreenContent(screenId);
      if (!baseContent) return false;
      const nextContent = writeBackVectorEditedPenPath(
        baseContent,
        nodeId,
        path,
      );
      if (nextContent === null) return false;
      if (nextContent === baseContent) return true;
      return (
        applyFileContentUpdate(screenId, nextContent, {
          skipPreview: screenId !== activeFile?.id,
          historyBeforeContent: baseContent,
        }).status === "accepted"
      );
    },
    [activeFile?.id, applyFileContentUpdate, canEditDesign, getScreenContent],
  );

  const handleVectorEditChange = useCallback(
    (nextPath: PenPath, phase: "preview" | "commit") => {
      const current = vectorEditingState;
      if (!current) return false;
      let primitiveSource = current.primitiveSource;
      if (phase === "commit") {
        const baseContent = getScreenContent(current.screenId);
        if (!baseContent) {
          toast.error(t("designEditor.toasts.vectorEditUnsupported"));
          return false;
        }

        const sourcePath = translatePenPath(
          nextPath,
          -current.sourceOffset.x,
          -current.sourceOffset.y,
        );
        const nextContent = current.primitiveSource
          ? writeBackPrimitiveAsVector(
              baseContent,
              current.nodeId,
              sourcePath,
              current.primitiveSource.geometry,
              current.primitiveSource.fill,
            )
          : writeBackVectorEditedPenPath(
              baseContent,
              current.nodeId,
              sourcePath,
            );
        if (nextContent === null) {
          toast.error(t("designEditor.toasts.vectorEditUnsupported"));
          return false;
        }
        if (nextContent !== baseContent) {
          const result = applyFileContentUpdate(current.screenId, nextContent, {
            skipPreview: current.screenId !== activeFile?.id,
            historyBeforeContent: baseContent,
          });
          if (result.status !== "accepted") return false;
          if (current.primitiveSource) primitiveSource = null;
        }
      }
      setVectorEditingState((latest) =>
        latest?.layerId === current.layerId
          ? { ...latest, path: nextPath, primitiveSource }
          : latest,
      );
      return true;
    },
    [
      activeFile?.id,
      applyFileContentUpdate,
      getScreenContent,
      t,
      vectorEditingState,
    ],
  );

  const handleVectorEditExit = useCallback(() => {
    setVectorEditingState(null);
  }, []);

  const handleVectorAnchorSelection = useCallback(
    (selectedAnchorIndex: number | null) => {
      setVectorEditingState((current) =>
        current ? { ...current, selectedAnchorIndex } : current,
      );
    },
    [],
  );

  const handleVectorCornerRadiusChange = useCallback(
    (radius: number, phase: "preview" | "commit") => {
      setVectorEditingState((current) => {
        if (!current || current.selectedAnchorIndex === null) return current;
        const nextPath = setPenNodeCornerRadius(
          current.path,
          current.selectedAnchorIndex,
          radius,
        );
        if (!nextPath) return current;
        if (
          (current.path.nodes[current.selectedAnchorIndex]?.cornerRadius ??
            0) ===
          (nextPath.nodes[current.selectedAnchorIndex]?.cornerRadius ?? 0)
        ) {
          return current;
        }
        if (phase === "commit") {
          const baseContent = getScreenContent(current.screenId);
          if (!baseContent) {
            toast.error(t("designEditor.toasts.vectorEditUnsupported"));
            return current;
          }
          const sourcePath = translatePenPath(
            nextPath,
            -current.sourceOffset.x,
            -current.sourceOffset.y,
          );
          const nextContent = writeBackVectorEditedPenPath(
            baseContent,
            current.nodeId,
            sourcePath,
          );
          if (nextContent === null) {
            toast.error(t("designEditor.toasts.vectorEditUnsupported"));
            return current;
          }
          if (nextContent !== baseContent) {
            applyFileContentUpdate(current.screenId, nextContent, {
              skipPreview: current.screenId !== activeFile?.id,
              historyBeforeContent: baseContent,
            });
          }
        }
        return { ...current, path: nextPath };
      });
    },
    [activeFile?.id, applyFileContentUpdate, getScreenContent, t],
  );

  useEffect(() => {
    if (
      vectorEditingState &&
      !selectedLayerIdsState.includes(vectorEditingState.layerId)
    ) {
      setVectorEditingState(null);
    }
  }, [selectedLayerIdsState, vectorEditingState]);

  const vectorEditOverlayState = useMemo<VectorEditOverlayState | null>(() => {
    if (!vectorEditingState) return null;
    const originCanvas = getScreenFrameOriginCanvas({
      screenId: vectorEditingState.screenId,
      overviewScreens,
      canvasFrameGeometryById,
      boardFileId,
    });
    if (!originCanvas) return null;
    return {
      path: vectorEditingState.path,
      selectedAnchorIndex: vectorEditingState.selectedAnchorIndex,
      onSelectedAnchorChange: handleVectorAnchorSelection,
      originCanvas,
      onChange: handleVectorEditChange,
      onExit: handleVectorEditExit,
    };
  }, [
    boardFileId,
    canvasFrameGeometryById,
    handleVectorEditChange,
    handleVectorEditExit,
    handleVectorAnchorSelection,
    overviewScreens,
    vectorEditingState,
  ]);

  const handleMoveTool = useCallback(() => {
    if (!canEditDesign) return;
    blurActiveDesignEditableTarget();
    flushSync(() => {
      setActiveTool("move");
      setMode("edit");
      setDrawMode(false);
      setPinMode(false);
    });
  }, [canEditDesign]);

  const handleShapeTool = useCallback(
    (tool: ShapeTool) => {
      if (!canEditDesign) return;
      blurActiveDesignEditableTarget();
      flushSync(() => {
        setActiveTool(tool);
        setShapeTool(tool);
        if (viewModeRef.current === "single" && activeFile) {
          setMode("edit");
          setDrawMode(false);
          setPinMode(false);
          setSelectedElement(null);
          return;
        }
        viewModeRef.current = "overview";
        setViewMode("overview");
        setMode("edit");
        setDrawMode(false);
        setPinMode(false);
        setSelectedElement(null);
      });
    },
    [activeFile, canEditDesign],
  );

  const handleRectTool = useCallback(() => {
    handleShapeTool("rect");
  }, [handleShapeTool]);

  const handleLineTool = useCallback(() => {
    handleShapeTool("line");
  }, [handleShapeTool]);

  const handleArrowTool = useCallback(() => {
    handleShapeTool("arrow");
  }, [handleShapeTool]);

  const handleEllipseTool = useCallback(() => {
    handleShapeTool("ellipse");
  }, [handleShapeTool]);

  const handleOverviewActiveToolChange = useCallback(
    (tool: MultiScreenCanvasTool) => {
      setActiveTool(tool === "rectangle" ? "rect" : (tool as DesignTool));
    },
    [],
  );

  const [spacePanActive, setSpacePanActive] = useState(false);
  const spacePanStashedToolRef = useRef<DesignTool | null>(null);
  const broadcastSpaceHeldToIframes = useCallback((held: boolean) => {
    if (typeof document === "undefined") return;
    document
      .querySelectorAll<HTMLIFrameElement>("iframe[data-design-preview-iframe]")
      .forEach((iframe) => {
        iframe.contentWindow?.postMessage(
          { type: "agent-native:set-space-held", held },
          "*",
        );
      });
  }, []);
  const spaceForwardArmedRef = useRef(false);
  useEffect(() => {
    if (
      shellMode ||
      (embedded && !embedChromeRequested) ||
      (pendingQuestions && pendingQuestions.length > 0)
    ) {
      return;
    }

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== " " || event.code !== "Space") return;
      if (event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isKeyboardShortcutsDialogTarget(event.target)) return;
      if (isNativeKeyboardActivationTarget(event.target)) return;
      if (isDesignHotkeyEditableTarget(event.target)) return;
      if (canEditDesignRef.current) {
        const armKeydown = resolveSpaceForwardTransition(
          "keydown",
          spaceForwardArmedRef.current,
          Boolean(activeEditorDragRef.current),
        );
        if (armKeydown.armed) {
          event.preventDefault();
          spaceForwardArmedRef.current = true;
          if (armKeydown.broadcast !== null) {
            broadcastSpaceHeldToIframes(armKeydown.broadcast);
          }
          return;
        }
      }
      if (spacePanStashedToolRef.current !== null) return;
      event.preventDefault();
      spacePanStashedToolRef.current = activeToolRef.current;
      setSpacePanActive(true);
      setActiveTool("hand");
    };

    const handleWindowKeyUp = (event: KeyboardEvent) => {
      if (event.key !== " " || event.code !== "Space") return;
      const releaseKeyup = resolveSpaceForwardTransition(
        "keyup",
        spaceForwardArmedRef.current,
        Boolean(activeEditorDragRef.current),
      );
      if (releaseKeyup.broadcast !== null) {
        spaceForwardArmedRef.current = releaseKeyup.armed;
        event.preventDefault();
        broadcastSpaceHeldToIframes(releaseKeyup.broadcast);
        return;
      }
      const stashedTool = spacePanStashedToolRef.current;
      if (stashedTool === null) return;
      spacePanStashedToolRef.current = null;
      setSpacePanActive(false);
      setActiveTool((current) => (current === "hand" ? stashedTool : current));
      event.preventDefault();
    };

    const handleWindowBlur = () => {
      const releaseBlur = resolveSpaceForwardTransition(
        "blur",
        spaceForwardArmedRef.current,
        Boolean(activeEditorDragRef.current),
      );
      if (releaseBlur.broadcast !== null) {
        spaceForwardArmedRef.current = releaseBlur.armed;
        broadcastSpaceHeldToIframes(releaseBlur.broadcast);
      }
      const stashedTool = spacePanStashedToolRef.current;
      if (stashedTool === null) return;
      spacePanStashedToolRef.current = null;
      setSpacePanActive(false);
      setActiveTool((current) => (current === "hand" ? stashedTool : current));
    };

    window.addEventListener("keydown", handleWindowKeyDown, {
      capture: true,
    });
    window.addEventListener("keyup", handleWindowKeyUp, { capture: true });
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown, {
        capture: true,
      });
      window.removeEventListener("keyup", handleWindowKeyUp, {
        capture: true,
      });
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [
    broadcastSpaceHeldToIframes,
    embedChromeRequested,
    embedded,
    pendingQuestions,
    shellMode,
  ]);

  const shiftKeyHeldRef = useRef(false);

  const handleOverviewScreenSelectionChange = useCallback(
    (ids: string[], intent?: ElementSelectionIntent) => {
      const pendingId = pendingOverviewScreenSelectionRef.current;
      const fileIds = new Set(getOverviewScreenFileIds(files));
      const nextIds = ids.filter((layerId) => fileIds.has(layerId));
      if (intent?.screenSelectionToggle) {
        explicitOverviewScreenSelectionRef.current =
          applyExplicitOverviewScreenSelectionToggle({
            currentExplicitScreenIds:
              explicitOverviewScreenSelectionRef.current,
            screenId: intent.screenSelectionToggle.screenId,
            selected: intent.screenSelectionToggle.selected,
          });
      }
      if (intent?.source === "marquee" && intent.cancelled) {
        setOverviewSelectedScreenIds((current) =>
          sameStringIds(current, nextIds) ? current : nextIds,
        );
        return;
      }
      if (!intent?.screenSelectionToggle && pendingId && ids.length === 0) {
        explicitOverviewScreenSelectionRef.current = [];
        return;
      }
      if (
        !intent?.screenSelectionToggle &&
        pendingId &&
        ids.includes(pendingId)
      ) {
        explicitOverviewScreenSelectionRef.current =
          overviewScreenSelectionForPendingEcho({
            screenIds: nextIds,
            pendingLayerId: pendingOverviewLayerSelectionRef.current,
            screenFileIds: fileIds,
          });
        setOverviewSelectedScreenIds((current) =>
          sameStringIds(current, nextIds) ? current : nextIds,
        );
        if (fileIds.has(pendingId)) {
          pendingOverviewScreenSelectionRef.current = null;
        }
        return;
      }
      if (!sameStringIds(overviewSelectedScreenIdsRef.current, nextIds)) {
        selectionRevisionRef.current += 1;
      }
      if (pendingId) {
        pendingOverviewScreenSelectionRef.current = null;
        pendingOverviewLayerSelectionRef.current = null;
        clearPendingOverviewLayerSelectionTimer();
        setCreatedOverviewLayerSelection(null);
      }
      const ownerDerivedScreenIds = new Set(
        selectedLayerIdsStateRef.current.flatMap((layerId) => {
          const owner = codeLayerOwnerByNodeIdRef.current.get(layerId);
          return owner ? [owner.fileId] : [];
        }),
      );
      if (
        intent?.source === "marquee" &&
        (intent.metaKey === true || intent.ctrlKey === true)
      ) {
        const deepSelectedScreenIds = new Set(
          intent.marqueeSelectedScreenIds ?? [],
        );
        explicitOverviewScreenSelectionRef.current =
          explicitOverviewScreenSelectionRef.current.filter(
            (screenId) =>
              nextIds.includes(screenId) &&
              !deepSelectedScreenIds.has(screenId),
          );
      } else {
        explicitOverviewScreenSelectionRef.current =
          updateExplicitOverviewScreenSelection({
            previousSelectedScreenIds: overviewSelectedScreenIdsRef.current,
            selectedScreenIds: nextIds,
            currentExplicitScreenIds:
              explicitOverviewScreenSelectionRef.current,
            ownerDerivedScreenIds,
            additive:
              intent?.source === "marquee"
                ? intent.additive === true
                : shiftKeyHeldRef.current,
          });
      }
      setOverviewSelectedScreenIds((current) =>
        sameStringIds(current, nextIds) ? current : nextIds,
      );
      // BP-DEEP item 5 — Framer click-to-target: a click on EMPTY overview
      // canvas clears the screen selection (ids === []); that gesture also
      // returns the active edit scope to Base, mirroring clicking the base
      // frame itself. Two guards keep this from over-firing:
      // - viewModeRef: the selection-clear that fires while entering
      //   single-screen mode (enterSingleScreen flips the ref to "single"
      //   synchronously before any state settles) must not reset a
      //   breakpoint the user is about to keep editing in the focused view.
      // - overviewSelectedScreenIdsRef (still holding the PRE-update
      //   selection when this callback runs — it's re-assigned during
      //   render): MultiScreenCanvas's selection-report effect fires once on
      //   mount with [] before its prop sync, and an []→[] "transition" is
      //   that mount echo, not a user's empty-canvas click; without this
      //   guard every overview (re)mount would clobber a persisted/agent-set
      //   active breakpoint back to auto.
      if (
        ids.length === 0 &&
        overviewSelectedScreenIdsRef.current.length > 0 &&
        viewModeRef.current === "overview" &&
        activeBreakpointWidthStateRef.current !== undefined
      ) {
        handleBreakpointBarSelect(undefined);
      }
    },
    [
      boardFileId,
      clearPendingOverviewLayerSelectionTimer,
      files,
      handleBreakpointBarSelect,
    ],
  );
  useEffect(() => {
    const handleShiftKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift") shiftKeyHeldRef.current = true;
    };
    const handleShiftKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") shiftKeyHeldRef.current = false;
    };
    const handleShiftBlur = () => {
      shiftKeyHeldRef.current = false;
    };
    window.addEventListener("keydown", handleShiftKeyDown, { capture: true });
    window.addEventListener("keyup", handleShiftKeyUp, { capture: true });
    window.addEventListener("blur", handleShiftBlur);
    return () => {
      window.removeEventListener("keydown", handleShiftKeyDown, {
        capture: true,
      });
      window.removeEventListener("keyup", handleShiftKeyUp, {
        capture: true,
      });
      window.removeEventListener("blur", handleShiftBlur);
    };
  }, []);
  const scaleToolControls = useMemo<ScaleToolControls>(
    () => ({
      onScale: (factor, anchor) =>
        runScaleSelection(
          {
            selectedElement,
            boardFileId,
            activeBreakpointWidthPx: activeBreakpointWidthState,
            fallbackIframe: canvasIframeRef.current,
          },
          factor,
          anchor,
        ),
      onExit: handleMoveTool,
    }),
    [
      activeBreakpointWidthState,
      boardFileId,
      canvasIframeRef,
      handleMoveTool,
      selectedElement,
    ],
  );

  const handleExitOverviewDrawMode = useCallback(() => {
    setDrawMode(false);
    setPinMode(false);
    setActiveTool("move");
    setMode("edit");
    setOverviewAnnotationResetSignal((signal) => signal + 1);
  }, []);

  const handleExitFocusedDrawMode = useCallback(() => {
    setDrawMode(false);
    setPinMode(false);
    setActiveTool("move");
    setMode("edit");
    setFocusedAnnotationResetSignal((signal) => signal + 1);
  }, []);

  const handleSendOverviewAnnotations = useCallback(
    async (
      annotations: DrawAnnotation[],
      instruction: string,
      canvasSize: { width: number; height: number },
    ) =>
      runSendOverviewAnnotations(
        {
          canvasContainerRef,
          design,
          handleExitOverviewDrawMode,
          id,
          overviewAnnotationSendingRef,
          overviewCanvasZoom,
          overviewScreens,
          setOverviewAnnotationSending,
          t,
        },
        annotations,
        instruction,
        canvasSize,
      ),
    [
      design?.title,
      handleExitOverviewDrawMode,
      id,
      overviewCanvasZoom,
      overviewScreens,
      t,
    ],
  );

  useEffect(() => {
    if (files.length > 0) resetAgentGenerating();
  }, [files.length, resetAgentGenerating]);

  const handleTweakPromptSubmit = useCallback(
    (
      prompt: string,
      files: UploadedFile[],
      options: PromptComposerSubmitOptions,
    ) =>
      runTweakPromptSubmit(
        {
          activeFile,
          canEditDesign,
          design,
          handleTweakPromptOpenChange,
          imageAttachmentUnavailableMessage: t(
            "promptDialog.imageAttachmentUnavailable",
          ),
          id,
          tweakSelections,
          tweaks,
        },
        prompt,
        files,
        options,
      ),
    [
      activeFile,
      remoteVisualEditPending,
      canEditDesign,
      design,
      handleTweakPromptOpenChange,
      id,
      t,
      tweakSelections,
      tweaks,
    ],
  );

  useEffect(
    () =>
      runPublishAgentSelectionContext({
        activeBreakpointWidthState,
        activeCodeFile,
        activeFile,
        activeInspectorTab,
        activeLeftPanel,
        activeTool,
        design,
        designDataJson,
        layoutGrids,
        designSelectionOwnerIdRef,
        files,
        hoveredElement,
        id,
        isSignedIn,
        mode,
        motionDockOpen,
        pendingPersistedSelectionWriteRef,
        persistedSelectionContextRef,
        persistedSelectionStateRef,
        persistedSelectionWriteTimerRef,
        responsiveEditScope,
        selectedElement,
        selectedScreenIds,
        selectedStateId,
        viewMode,
        zoom,
      }),
    [
      id,
      design,
      activeFile,
      files,
      selectedScreenIds,
      selectedElement,
      hoveredElement,
      mode,
      activeTool,
      activeInspectorTab,
      activeLeftPanel,
      activeCodeFile,
      overviewSelectedScreenIds,
      viewMode,
      zoom,
      motionDockOpen,
      activeBreakpointWidthState,
      responsiveEditScope,
      designDataJson,
      layoutGrids,
      selectedStateId,
      isSignedIn,
    ],
  );

  const mirroredSelectionIdRef = useRef<string | null>(null);
  const mirroredExcerptRef = useRef<string | null>(null);
  const sentSelectionIdRef = useRef<string | null>(null);
  const composerContextHasOurKeyRef = useRef(true);

  const composerContextItemsForBookkeeping =
    useAgentChatContext(isSignedIn).items;
  useEffect(() => {
    const key = "design:selected-element";
    composerContextHasOurKeyRef.current =
      composerContextItemsForBookkeeping.some((item) => item.key === key);
  }, [composerContextItemsForBookkeeping]);

  useEffect(
    () =>
      runMirrorSelectionToAgentChat({
        activeFile,
        activeProjectionContent,
        composerContextHasOurKeyRef,
        design,
        id,
        isSignedIn,
        mirroredExcerptRef,
        mirroredSelectionIdRef,
        selectedCodeLayerNode,
        selectedElement,
        sentSelectionIdRef,
      }),
    [
      activeFile,
      activeProjectionContent,
      design?.title,
      id,
      isSignedIn,
      selectedCodeLayerNode,
      selectedElement,
    ],
  );

  useEffect(() => {
    const key = "design:design-system";
    if (!isSignedIn) return;
    const designSystemId = design?.designSystemId;
    if (!designSystemId) {
      removeAgentChatContextItem(key);
      return;
    }

    let cancelled = false;
    void loadDesignSystemGenerationContext(designSystemId).then((context) => {
      if (cancelled || !context.trim()) return;
      setAgentChatContextItem({
        key,
        title: "Selected design system" /* i18n-ignore agent context label */,
        context,
        openSidebar: false,
      });
    });

    return () => {
      cancelled = true;
      removeAgentChatContextItem(key);
    };
  }, [design?.designSystemId, isSignedIn]);
  // PF8: rare, discrete interactions (add/activate a breakpoint) — not a
  // per-frame gesture path. addBreakpointMutation/setActiveBreakpointMutation
  // are useActionMutation(...) results (packages/core/src/client/use-action.ts),
  // which return a fresh object every render (untyped passthrough of
  // TanStack Query's useMutation with an inline mutationFn/onSuccess), so
  // these deps still change every render — same as the ~24 other
  // useCallback([...Mutation...]) call sites already in this file. Hoisting
  // still centralizes the closure and keeps the JSX prop list declarative;
  // full stabilization would require a latest-ref wrapper around
  // useActionMutation itself, out of scope for a call-site-only fix.
  // (handleBreakpointBarSelect itself now lives up near designBreakpoints'
  // own declaration — see the comment there — so handleEscapeHotkey, which
  // is defined earlier in this component than this line, can reference it.)
  // BP-DEEP item 5 — Framer-style click-to-target: picking a BASE screen
  // frame (a regular Screen, not one of its breakpoint sub-frames) always
  // returns the active edit target to Base. This mirrors clicking the Base
  // chip in BreakpointBar (handleBreakpointBarSelect(undefined)) so the two
  // entry points ("click the frame" vs "click the chip") stay in sync
  // instead of leaving activeBreakpointWidthState pointed at a breakpoint
  // that's no longer the visibly-focused frame. Only resets when a
  // breakpoint is ACTUALLY active, so plain screen-to-screen picking while
  // already on Base doesn't fire a redundant mutation on every click.
  // PF8: onPick has no unstable deps (state setters + refs + a
  // zero-dep useCallback) — hoisting removes a fresh-arrow-per-render prop
  // on MultiScreenCanvas without changing behavior.
  const selectOverviewScreen = useCallback(
    (pickedId: string, fitCamera: boolean) => {
      if (!shiftKeyHeldRef.current) selectionRevisionRef.current += 1;
      pendingOverviewScreenSelectionRef.current = null;
      pendingOverviewLayerSelectionRef.current = null;
      clearPendingOverviewLayerSelectionTimer();
      setCreatedOverviewLayerSelection(null);
      if (!shiftKeyHeldRef.current) {
        explicitOverviewScreenSelectionRef.current = [pickedId];
      }
      setSelectedElement(null);
      setHoveredElement(null);
      // MultiScreenCanvas reports the Shift-toggled Screen separately from
      // the primary target so provenance follows the user's toggle intent,
      // while the selection-change callback remains the source of the full
      // selected Screen list.
      if (!shiftKeyHeldRef.current) {
        setOverviewSelectedScreenIds([pickedId]);
      }
      setSelectedLayerIdsState((current) =>
        computeOverviewScreenPickSelectionIds({
          pickedId,
          shiftKeyHeld: shiftKeyHeldRef.current,
          currentSelectedLayerIds: current,
        }),
      );
      setActiveFileId(pickedId);
      setActiveTool(resolveToolAfterSelection);
      setMode("edit");
      if (fitCamera) {
        const geometry = exportCanvasFrameGeometryById[pickedId];
        if (
          geometry &&
          Number.isFinite(geometry.x) &&
          Number.isFinite(geometry.y) &&
          Number.isFinite(geometry.width) &&
          Number.isFinite(geometry.height)
        ) {
          cameraCommandNonceRef.current += 1;
          setCameraCommand({
            ...getCreatedScreenNavigationPlan({
              screenId: pickedId,
              geometry: {
                x: geometry.x as number,
                y: geometry.y as number,
                width: geometry.width as number,
                height: geometry.height as number,
              },
            }).camera,
            nonce: cameraCommandNonceRef.current,
          });
        }
      }
      if (activeBreakpointWidthStateRef.current !== undefined) {
        handleBreakpointBarSelect(undefined);
      }
    },
    [
      cameraCommandNonceRef,
      clearPendingOverviewLayerSelectionTimer,
      exportCanvasFrameGeometryById,
      handleBreakpointBarSelect,
      setCameraCommand,
    ],
  );

  const handleOverviewScreenPick = useCallback(
    (pickedId: string) => selectOverviewScreen(pickedId, true),
    [selectOverviewScreen],
  );

  const handleOverviewScreenGestureSelect = useCallback(
    (pickedId: string) => selectOverviewScreen(pickedId, false),
    [selectOverviewScreen],
  );

  return {
    shapeTool,
    vectorEditingState,
    setVectorEditingState,
    runtimeStructureInsertRevisionRef,
    reviewFocusRequest,
    activeCodeFile,
    setActiveCodeFile,
    selectionRevisionRef,
    overviewAnnotationResetSignal,
    focusedAnnotationResetSignal,
    overviewAnnotationSending,
    selectedScreenIds,
    canvasBackgroundRef,
    handleDispatchCommentToAgent,
    handleSendReviewThreadToAgent,
    reviewCommentsPanelProps,
    handleCreatePrimitive,
    handlePrimitiveCreated,
    handleBoardDrawPrimitive,
    handleSingleScreenCreatePrimitive,
    handleUpdatePenPath,
    handleVectorCornerRadiusChange,
    vectorEditOverlayState,
    handleOverviewScreenSelectionChange,
    handleMoveTool,
    handleShapeTool,
    handleRectTool,
    handleLineTool,
    handleArrowTool,
    handleEllipseTool,
    handleOverviewActiveToolChange,
    spacePanActive,
    shiftKeyHeldRef,
    scaleToolControls,
    handleExitOverviewDrawMode,
    handleExitFocusedDrawMode,
    handleSendOverviewAnnotations,
    handleTweakPromptSubmit,
    handleOverviewScreenPick,
    handleOverviewScreenGestureSelect,
  };
}

export type EditorToolsAndVectors = ReturnType<typeof useEditorToolsAndVectors>;
