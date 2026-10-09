import { generateTabId } from "@agent-native/core/client/agent-chat";
import {
  useActionQuery,
  useActionMutation,
  actionErrorMessage,
  callAction,
  getBrowserTabId,
  readClientAppState,
  setClientAppState,
  useChangeVersion,
  useChangeVersions,
  useAvatarUrl,
} from "@agent-native/core/client/hooks";
import { getEmbedAuthToken } from "@agent-native/core/client/host";
import { useLab } from "@agent-native/core/client/labs";
import {
  useReviewComments,
  useSendReviewThreadToAgent,
} from "@agent-native/core/client/review";
import { useCreativeContextLabState } from "@agent-native/creative-context/client";
import { type PromptComposerSubmitOptions } from "@agent-native/toolkit/app/chat/composer/index";
import { getOverviewScreenFileIds } from "@shared/design-files";
import { DESIGN_TWEAKS } from "@shared/labs";
import { designRepromptPendingStateKey } from "@shared/node-rewrite";
import { readDesignReviewSummary } from "@shared/review-summary";
import { sourceContentHash } from "@shared/source-workspace";
import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";

import { failPendingTextCapture } from "@/components/design/design-canvas/pending-text-capture";
import { recordDesignPerformance } from "@/components/design/design-trace";
import { getUnreadReviewThreadIds } from "@/components/design/ReviewCommentsPanel";
import type { ElementInfo } from "@/components/design/types";
import { type DesignAccessStatus } from "@/components/DesignAccessState";
import { useAgentGenerating } from "@/hooks/use-agent-generating";
import { designEditorCommandKey } from "@/hooks/use-navigation-state";
import { useQuestionFlow } from "@/hooks/use-question-flow";
import {
  publishClipboardContentMutation,
  type ClipboardContentMutationOrigin,
  type ClipboardContentMutationPublication,
} from "@/lib/clipboard-content-lineage";
import { isContentIndependentDesignQuery } from "@/lib/design-sync-invalidation";
import {
  clearPendingGeneration,
  failPendingGenerationForMissingImagePayload,
  hasFreshPendingGeneration,
  isPendingGenerationStale,
  patchPendingGeneration,
  PENDING_GENERATION_STALE_MS,
  readPendingGeneration,
} from "@/lib/pending-generation";
import { buildShellDesign } from "@/lib/shell-design";
import {
  captureHistorySelectionSources,
  resolveHistorySelection,
} from "@/pages/design-editor/history-identity";

import type { ResponsiveEditScope, RetryablePrompt } from "../command-types";
import {
  coalesceMarqueeSelectionHistory,
  runMarqueeSelectionCancellation,
} from "../commands/layer-marquee-selection-change";
import {
  createVisualEditSnapshotPublicationState,
  runClearVisualEditSnapshotPublications,
  runReserveVisualEditSnapshotInOrder,
  runScheduleVisualEditSnapshotPublication,
  type VisualEditSnapshotPublicationState,
} from "../commands/publish-visual-edit-snapshot";
import { runStartRetryGeneration } from "../commands/start-retry-generation";
import { isDesignData } from "../design-data-geometry-utils";
import { STORED_RUN_LIVENESS_GRACE_MS } from "../editor-constants";
import { designSelectionStateKeys } from "../editor-helpers";
import { TAB_ID } from "../editor-session";
import {
  createPendingLocalFileContent,
  type PendingLocalFileContent,
  restorePendingFileContent,
} from "../editor-state";
import {
  formatUploadedFileContext,
  imageAttachmentsFromUploadedFiles,
} from "../generation-prompt-directives";
import {
  type GeometryHistorySelection,
  MAX_DESIGN_UNDO_STACK,
} from "../history";
import { createLatestWriteQueue } from "../latest-write-queue";
import { reconcileLiveCollaborationOverride } from "../live-collaboration-override";
import { localhostConsentRequestRefetchInterval } from "../localhost-consent-request";
import { applyMcpDirectoryWidgetReadOnlyPolicy } from "../mcp-widget-write-capabilities";
import {
  explicitOverviewScreenSelectionForHistory,
  selectionHistorySnapshotsEqual,
} from "../selection-state";
import { type DesignData, type DesignFile } from "../types";
import type { EditorCore } from "./use-editor-core";
import type { EditorHistory } from "./use-editor-history";

type RequestDesignAccessResult = {
  ok: boolean;
  alreadyHasAccess: boolean;
  alreadyRequested: boolean;
  notifiedOwner: boolean;
  requestId?: string;
  message: string;
};

type ActiveBreakpointWrite = {
  designId: string;
  breakpointId: string;
  editScope: ResponsiveEditScope;
};

export function useEditorGenerationAndAccess({
  editorCore,
  editorHistory,
}: {
  editorCore: EditorCore;
  editorHistory: EditorHistory;
}) {
  const {
    t,
    id,
    session,
    isSignedIn,
    sessionResolved,
    reviewPreview,
    queryClient,
    shellMode,
    isVisualEditSurface,
    readOnlyWidget,
    viewMode,
    viewModeRef,
    setSelectedElement,
    selectedElementRef,
    setPendingVisualEditPublicationFailed,
    activeFileId,
    setActiveFileId,
  } = editorCore;
  const {
    shellInput,
    setSelectedLayerIdsState,
    codeLayerOwnerByNodeIdRef,
    overviewSelectedScreenIds,
    setOverviewSelectedScreenIds,
    pendingOverviewScreenSelectionRef,
    pendingOverviewLayerSelectionRef,
    clearPendingOverviewLayerSelectionTimer,
    schedulePendingOverviewLayerSelectionClear,
    latestClipboardMutationContentRef,
    linkedComponentMutationQueueRef,
    explicitOverviewScreenSelectionRef,
    historyOrderRef,
    selectionUndoStackRef,
    clearRedoStacks,
    historySourceReaderRef,
    captureCurrentSelection,
    syncUndoRedoState,
  } = editorHistory;

  const browserTabId = getBrowserTabId();
  const [runtimeLayerSnapshotRequest, setRuntimeLayerSnapshotRequest] =
    useState<number | null>(null);
  const lastOverviewSelectedScreenIdsRef = useRef<string[]>([]);
  const lastMarqueeSelectionSignatureRef = useRef<string | null>(null);
  const marqueeSelectionHistoryBeforeRef =
    useRef<GeometryHistorySelection | null>(null);
  const marqueeSelectedElementBeforeRef = useRef<ElementInfo | null>(null);
  const persistedSelectionStateRef = useRef<string | null>(null);
  const persistedSelectionContextRef = useRef<string | null>(null);
  const pendingPersistedSelectionWriteRef = useRef<{
    key: string;
    contextKey: string;
    value: Record<string, unknown>;
  } | null>(null);
  const persistedSelectionWriteTimerRef = useRef<number | null>(null);
  const designSelectionOwnerIdRef = useRef(`${TAB_ID}:${generateTabId()}`);
  const lastGeometryCommitAtRef = useRef(0);
  const lastGeometryCommitSourceRef = useRef<"pointer" | "keyboard" | null>(
    null,
  );
  const resetGeometryCommitCoalescing = useCallback(() => {
    lastGeometryCommitAtRef.current = 0;
    lastGeometryCommitSourceRef.current = null;
  }, []);
  const [drawMode, setDrawMode] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [focusedAnnotationSending, setFocusedAnnotationSending] =
    useState(false);
  const focusedAnnotationSendingCountRef = useRef(0);
  const handleFocusedAnnotationSendingChange = useCallback(
    (sending: boolean) => {
      focusedAnnotationSendingCountRef.current = Math.max(
        0,
        focusedAnnotationSendingCountRef.current + (sending ? 1 : -1),
      );
      setFocusedAnnotationSending(focusedAnnotationSendingCountRef.current > 0);
    },
    [],
  );
  const promptAnchorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== "overview" || overviewSelectedScreenIds.length === 0) {
      return;
    }
    lastOverviewSelectedScreenIdsRef.current = [...overviewSelectedScreenIds];
  }, [overviewSelectedScreenIds, viewMode]);
  const [hasPendingGeneration, setHasPendingGeneration] = useState(false);
  const [generationChatTabId, setGenerationChatTabId] = useState<string | null>(
    null,
  );
  const [generationIssue, setGenerationIssue] = useState<string | null>(null);

  useEffect(() => {
    if (!isSignedIn) return;
    return () => {
      void (async () => {
        const keys = designSelectionStateKeys();
        if (persistedSelectionWriteTimerRef.current !== null) {
          window.clearTimeout(persistedSelectionWriteTimerRef.current);
          persistedSelectionWriteTimerRef.current = null;
        }
        pendingPersistedSelectionWriteRef.current = null;
        persistedSelectionStateRef.current = null;
        persistedSelectionContextRef.current = null;
        for (const key of keys) {
          // coercion-ok: absent client state means there is nothing to clear.
          const current = await readClientAppState(key).catch(() => null);
          const ownerId =
            current && typeof current === "object"
              ? (current as { ownerId?: unknown }).ownerId
              : undefined;
          if (ownerId !== designSelectionOwnerIdRef.current) continue;
          // coercion-ok: state cleanup is best effort during unmount.
          await setClientAppState(key, null, {
            keepalive: true,
          }).catch(() => {});
        }
      })();
    };
  }, [isSignedIn]);
  const [retryablePrompt, setRetryablePrompt] =
    useState<RetryablePrompt | null>(null);
  const generationOutputReadyRef = useRef(false);
  const pendingQuestionsVisibleRef = useRef(false);
  const generationRunConfirmedRef = useRef(false);
  const generationCompleteTimerRef = useRef<number | null>(null);
  const autoRetryTimerRef = useRef<number | null>(null);
  const storedRunLivenessTimerRef = useRef<number | null>(null);
  const clearGenerationCompleteTimer = useCallback(() => {
    if (generationCompleteTimerRef.current !== null) {
      window.clearTimeout(generationCompleteTimerRef.current);
      generationCompleteTimerRef.current = null;
    }
  }, []);
  const clearAutoRetryTimer = useCallback(() => {
    if (autoRetryTimerRef.current !== null) {
      window.clearTimeout(autoRetryTimerRef.current);
      autoRetryTimerRef.current = null;
    }
  }, []);
  const clearStoredRunLivenessTimer = useCallback(() => {
    if (storedRunLivenessTimerRef.current !== null) {
      window.clearTimeout(storedRunLivenessTimerRef.current);
      storedRunLivenessTimerRef.current = null;
    }
  }, []);
  const staleToastShownRef = useRef(false);
  const generationModelRef = useRef<{
    model?: string;
    engine?: string;
    effort?: PromptComposerSubmitOptions["effort"];
  } | null>(null);
  const rememberPendingGenerationForRetry = useCallback(() => {
    const pending = readPendingGeneration(id);
    if (pending?.prompt) {
      setRetryablePrompt({
        prompt: pending.prompt,
        files: Array.isArray(pending.files) ? pending.files : [],
        model: pending.model,
        engine: pending.engine,
        effort: pending.effort,
        contextItems: pending.contextItems,
        designSystemId: pending.designSystemId,
        attempt: pending.attempt ?? 1,
        source: pending.source,
        templateId: pending.templateId,
        templateBaselineFiles: pending.templateBaselineFiles,
      });
      return true;
    }
    return false;
  }, [id]);
  const markGenerationStale = useCallback(() => {
    clearGenerationCompleteTimer();
    rememberPendingGenerationForRetry();
    clearPendingGeneration(id);
    setHasPendingGeneration(false);
    setGenerationIssue(t("designEditor.generationMayHaveStopped"));
    if (!staleToastShownRef.current) {
      staleToastShownRef.current = true;
      toast.info(t("designEditor.generationMayHaveStoppedToast"));
    }
  }, [clearGenerationCompleteTimer, id, rememberPendingGenerationForRetry, t]);
  const handleGenerationComplete = useCallback(() => {
    clearGenerationCompleteTimer();
    generationCompleteTimerRef.current = window.setTimeout(() => {
      generationCompleteTimerRef.current = null;
      if (pendingQuestionsVisibleRef.current) {
        setHasPendingGeneration(false);
        staleToastShownRef.current = false;
        setGenerationIssue(null);
        return;
      }
      const hasOutput = generationOutputReadyRef.current;
      const preservedForRetry = hasOutput
        ? false
        : rememberPendingGenerationForRetry();
      clearPendingGeneration(id);
      setHasPendingGeneration(false);
      staleToastShownRef.current = false;
      setGenerationIssue(
        hasOutput
          ? null
          : preservedForRetry
            ? t("designEditor.generationStoppedRetry")
            : t("designEditor.generationStoppedCheckAgent"),
      );
    }, 4000);
  }, [clearGenerationCompleteTimer, id, rememberPendingGenerationForRetry, t]);
  const handleGenerationStopped = useCallback(() => {
    clearGenerationCompleteTimer();
    clearAutoRetryTimer();
    clearStoredRunLivenessTimer();
    clearPendingGeneration(id);
    setGenerationChatTabId(null);
    setHasPendingGeneration(false);
    setGenerationIssue(null);
    setRetryablePrompt(null);
    staleToastShownRef.current = false;
  }, [
    clearAutoRetryTimer,
    clearGenerationCompleteTimer,
    clearStoredRunLivenessTimer,
    id,
  ]);
  const scheduleStoredRunLivenessCheck = useCallback(
    (runTabId: string) => {
      clearStoredRunLivenessTimer();
      generationRunConfirmedRef.current = false;
      storedRunLivenessTimerRef.current = window.setTimeout(() => {
        storedRunLivenessTimerRef.current = null;
        if (generationRunConfirmedRef.current) return;
        if (pendingQuestionsVisibleRef.current) {
          return;
        }
        const pending = readPendingGeneration(id);
        if (!pending || pending.runTabId !== runTabId) return;
        if (generationOutputReadyRef.current) {
          clearPendingGeneration(id);
          setHasPendingGeneration(false);
          setGenerationIssue(null);
          return;
        }
        rememberPendingGenerationForRetry();
        clearPendingGeneration(id);
        setHasPendingGeneration(false);
        setGenerationIssue(t("designEditor.generationStoppedRetry"));
      }, STORED_RUN_LIVENESS_GRACE_MS);
    },
    [clearStoredRunLivenessTimer, id, rememberPendingGenerationForRetry, t],
  );
  const {
    generating,
    submit: agentSubmit,
    reset: resetAgentGenerating,
    track: trackAgentGeneration,
  } = useAgentGenerating({
    onComplete: handleGenerationComplete,
    onStopped: handleGenerationStopped,
    onStale: markGenerationStale,
    shouldAdoptRunningTab: () =>
      Boolean(id) &&
      !generationOutputReadyRef.current &&
      hasFreshPendingGeneration(id),
    onAdoptRunningTab: (tabId) => {
      generationRunConfirmedRef.current = true;
      setGenerationChatTabId(tabId);
      setHasPendingGeneration(true);
    },
    onRunning: () => {
      generationRunConfirmedRef.current = true;
      clearStoredRunLivenessTimer();
    },
  });
  const { generating: reviewFeedbackApplying, submit: submitReviewFeedback } =
    useAgentGenerating();
  const handleQuestionFlowContinue = useCallback(
    (runTabId: string) => {
      clearGenerationCompleteTimer();
      setGenerationIssue(null);
      setRetryablePrompt(null);
      setGenerationChatTabId(runTabId);
      const pending = readPendingGeneration(id, { allowUntimestamped: true });
      patchPendingGeneration(id, {
        prompt: pending?.prompt ?? "Continue from answered design questions.",
        files: pending?.files ?? [],
        title: pending?.title,
        designSystemId: pending?.designSystemId,
        model: pending?.model,
        engine: pending?.engine,
        effort: pending?.effort,
        contextItems: pending?.contextItems,
        runTabId,
        attempt: pending?.attempt ?? 1,
        startedAt: Date.now(),
      });
      setHasPendingGeneration(true);
      trackAgentGeneration(runTabId);
    },
    [clearGenerationCompleteTimer, id, trackAgentGeneration],
  );

  const getQuestionFlowModelSelection = useCallback(
    () =>
      generationModelRef.current ??
      readPendingGeneration(id, { allowUntimestamped: true }),
    [id],
  );
  const getQuestionFlowGenerationBrief = useCallback(() => {
    const pending = readPendingGeneration(id, { allowUntimestamped: true });
    if (!pending) return null;
    const files = pending.files ?? [];
    let images: string[];
    try {
      images = imageAttachmentsFromUploadedFiles(files);
    } catch (error) {
      if (
        !failPendingGenerationForMissingImagePayload(
          id,
          error,
          t("promptDialog.imageAttachmentUnavailable"),
          setGenerationIssue,
          setHasPendingGeneration,
        )
      ) {
        throw error;
      }
      return null;
    }
    return {
      prompt: pending.prompt,
      designSystemId: pending.designSystemId,
      images,
      contextItems: pending.contextItems,
      uploadedFileContext: formatUploadedFileContext(files),
    };
  }, [id, t]);
  const {
    questions: pendingQuestions,
    title: pendingQuestionsTitle,
    description: pendingQuestionsDescription,
    skipLabel: pendingQuestionsSkipLabel,
    submitLabel: pendingQuestionsSubmitLabel,
    isSubmissionBlocked: pendingQuestionsSubmissionBlocked,
    providerStatus: pendingQuestionsProviderStatus,
    retryProviderStatus: retryPendingQuestionsProviderStatus,
    handleSubmit: handleQuestionsSubmit,
    handleSkip: handleQuestionsSkip,
  } = useQuestionFlow(id, {
    enabled: isSignedIn,
    continuationTabId: generationChatTabId,
    onContinue: handleQuestionFlowContinue,
    getModelSelection: getQuestionFlowModelSelection,
    getGenerationBrief: getQuestionFlowGenerationBrief,
  });
  const pendingQuestionsVisible = Boolean(
    pendingQuestions && pendingQuestions.length > 0,
  );

  useEffect(() => {
    return () => clearGenerationCompleteTimer();
  }, [clearGenerationCompleteTimer]);
  useEffect(() => {
    return () => clearAutoRetryTimer();
  }, [clearAutoRetryTimer]);
  useEffect(() => {
    return () => clearStoredRunLivenessTimer();
  }, [clearStoredRunLivenessTimer]);
  useEffect(() => {
    pendingQuestionsVisibleRef.current = pendingQuestionsVisible;
    if (!pendingQuestionsVisible || !hasPendingGeneration || generating) return;
    clearGenerationCompleteTimer();
    clearStoredRunLivenessTimer();
    setHasPendingGeneration(false);
    setGenerationIssue(null);
  }, [
    clearGenerationCompleteTimer,
    clearStoredRunLivenessTimer,
    generating,
    hasPendingGeneration,
    pendingQuestionsVisible,
  ]);

  const currentUserAvatarUrl = useAvatarUrl(session?.email);

  useEffect(() => {
    if (!id || !sessionResolved) return;
    const pending = readPendingGeneration(id);
    if (!pending) {
      setHasPendingGeneration(false);
      return;
    }
    if (isPendingGenerationStale(pending)) {
      markGenerationStale();
      return;
    }
    setHasPendingGeneration(true);
    if (pending.runTabId) {
      setGenerationChatTabId(pending.runTabId);
      trackAgentGeneration(pending.runTabId);
      scheduleStoredRunLivenessCheck(pending.runTabId);
    }
  }, [
    id,
    markGenerationStale,
    scheduleStoredRunLivenessCheck,
    sessionResolved,
    trackAgentGeneration,
  ]);

  const pendingGenerationActive =
    (hasPendingGeneration || Boolean(readPendingGeneration(id))) &&
    !pendingQuestionsVisible;

  const {
    data: designResult,
    error: designQueryError,
    isError: designQueryFailed,
    isLoading: designLoading,
    dataUpdatedAt: designDataUpdatedAt,
    refetch: refetchDesign,
  } = useActionQuery<DesignData | string>(
    "get-design",
    { id: id!, ...(reviewPreview ? { reviewPreview: true } : {}) },
    {
      enabled: !shellMode,
      refetchInterval: isVisualEditSurface
        ? pendingGenerationActive || generating
          ? 1000
          : 30_000
        : pendingGenerationActive || generating
          ? 1000
          : false,
    },
  );
  const {
    data: designAccessStatus,
    isLoading: designAccessStatusLoading,
    isError: designAccessStatusError,
    refetch: refetchDesignAccessStatus,
  } = useActionQuery<DesignAccessStatus>(
    "get-design-access-status",
    { designId: id! },
    {
      enabled: !shellMode && Boolean(id) && !isDesignData(designResult),
    },
  );
  const requestDesignAccessMutation = useActionMutation<
    RequestDesignAccessResult,
    { designId: string }
  >("request-design-access");
  const [designAccessRequestSent, setDesignAccessRequestSent] = useState(false);

  useEffect(() => {
    setDesignAccessRequestSent(false);
  }, [id]);

  const handleRequestDesignAccess = useCallback(async () => {
    if (!id || requestDesignAccessMutation.isPending) return;
    try {
      const result = await requestDesignAccessMutation.mutateAsync({
        designId: id,
      });
      if (result.alreadyHasAccess) {
        await Promise.all([refetchDesign(), refetchDesignAccessStatus()]);
      } else if (result.notifiedOwner) {
        setDesignAccessRequestSent(true);
      }
    } catch (error) {
      toast.error(actionErrorMessage(error) ?? t("common.genericError"));
    }
  }, [
    id,
    refetchDesign,
    refetchDesignAccessStatus,
    requestDesignAccessMutation,
    t,
  ]);

  const shellDesign = useMemo(
    () => (shellInput ? buildShellDesign(shellInput).design : null),
    [shellInput],
  );

  const design = shellMode
    ? shellDesign
    : isDesignData(designResult)
      ? designResult
      : null;
  const overviewDataReady = shellMode || designResult !== undefined;
  const activeBreakpointStateVersion = useChangeVersion(
    id ? `app-state:design-active-breakpoint:${id}` : "",
  );
  const designEditorCommandKeys = useMemo(
    () =>
      browserTabId
        ? [designEditorCommandKey(browserTabId), designEditorCommandKey()]
        : [designEditorCommandKey()],
    [browserTabId],
  );
  const designEditorCommandVersion = useChangeVersions(
    designEditorCommandKeys.map((key) => `app-state:${key}`),
  );
  const pendingNodeRewriteStateKeys = useMemo(
    () =>
      id
        ? (design?.files.map((file) =>
            designRepromptPendingStateKey(id, file.id),
          ) ?? [])
        : [],
    [design?.files, id],
  );
  const pendingNodeRewriteStateVersion = useChangeVersions(
    pendingNodeRewriteStateKeys.map((key) => `app-state:${key}`),
  );
  const designAccessRole = design?.accessRole;
  const canShareDesign =
    designAccessRole === "owner" || designAccessRole === "admin";
  const designQueryErrorStatus =
    designQueryError && typeof designQueryError === "object"
      ? (designQueryError as { status?: unknown }).status
      : undefined;
  const designQueryAuthFailed =
    designQueryErrorStatus === 401 || designQueryErrorStatus === 403;
  const visualEditAccessLost =
    isVisualEditSurface &&
    designQueryFailed &&
    (designResult === undefined || designQueryAuthFailed);
  const roleCanEditDesign =
    !visualEditAccessLost && (canShareDesign || designAccessRole === "editor");
  const roleCanEditLiveScreens =
    isVisualEditSurface &&
    !visualEditAccessLost &&
    (roleCanEditDesign ||
      design?.visibility === "public" ||
      designAccessRole === "viewer" ||
      designAccessRole === "commenter");
  const rolePublicVisualEdit =
    isVisualEditSurface &&
    !visualEditAccessLost &&
    !roleCanEditDesign &&
    design?.visibility === "public";
  const roleCanCommentDesign =
    isSignedIn &&
    (designAccessRole === "owner" ||
      designAccessRole === "admin" ||
      designAccessRole === "editor" ||
      designAccessRole === "commenter");
  const {
    canEditDesign,
    canEditLiveScreens,
    publicVisualEdit,
    canCommentDesign,
    canRenderAuthenticatedShare,
  } = applyMcpDirectoryWidgetReadOnlyPolicy(
    {
      canEditDesign: roleCanEditDesign,
      canEditLiveScreens: roleCanEditLiveScreens,
      publicVisualEdit: rolePublicVisualEdit,
      canCommentDesign: roleCanCommentDesign,
      canRenderAuthenticatedShare: isSignedIn || roleCanEditDesign,
    },
    readOnlyWidget,
  );
  const [failedLocalhostConsentClear, setFailedLocalhostConsentClear] =
    useState<string | null>(null);
  const localhostConsentRequestQuery = useActionQuery(
    "get-localhost-write-consent-request",
    { designId: id ?? "" },
    {
      enabled: Boolean(id && canEditDesign),
      refetchInterval: (query) => {
        const request = query.state.data?.request;
        return localhostConsentRequestRefetchInterval({
          requestKey: request ? `${id}:${request.requestedAt}` : null,
          failedClearKey: failedLocalhostConsentClear,
          queryFailed: query.state.status === "error",
        });
      },
    },
  );
  const clearLocalhostConsentRequestMutation = useActionMutation(
    "clear-localhost-write-consent-request",
  );
  const visualEditSnapshotPublicationStateRef =
    useRef<VisualEditSnapshotPublicationState | null>(null);
  if (!visualEditSnapshotPublicationStateRef.current) {
    visualEditSnapshotPublicationStateRef.current =
      createVisualEditSnapshotPublicationState();
  }
  const visualEditSnapshotPublicationState =
    visualEditSnapshotPublicationStateRef.current;
  const [liveCollaborationOverride, setLiveCollaborationOverride] = useState<{
    enabled: boolean;
    observedDataUpdatedAt: number;
  } | null>(null);
  const [liveCollaborationSaving, setLiveCollaborationSaving] = useState(false);
  const liveCollaborationEnabled =
    liveCollaborationOverride?.enabled ??
    design?.liveCollaborationEnabled === true;
  useEffect(() => setLiveCollaborationOverride(null), [id]);
  useEffect(() => {
    setLiveCollaborationOverride((override) =>
      reconcileLiveCollaborationOverride(
        override,
        design?.liveCollaborationEnabled,
        designDataUpdatedAt,
      ),
    );
  }, [design?.liveCollaborationEnabled, designDataUpdatedAt]);
  const handleLiveCollaborationChange = useCallback(
    async (enabled: boolean) => {
      if (!id || !isSignedIn || !canEditDesign || liveCollaborationSaving)
        return;
      setLiveCollaborationSaving(true);
      try {
        const result = await callAction<{
          designId: string;
          enabled: boolean;
        }>("update-visual-edit-collaboration", { designId: id, enabled });
        setLiveCollaborationOverride({
          enabled: result.enabled,
          observedDataUpdatedAt: designDataUpdatedAt,
        });
        if (result.enabled) {
          setRuntimeLayerSnapshotRequest(Date.now() + Math.random());
        } else {
          runClearVisualEditSnapshotPublications(
            visualEditSnapshotPublicationState,
          );
        }
        try {
          const refreshed = await refetchDesign();
          if (
            refreshed.isSuccess &&
            isDesignData(refreshed.data) &&
            typeof refreshed.data.liveCollaborationEnabled === "boolean"
          ) {
            setLiveCollaborationOverride(null);
          }
        } catch {
          // coercion-ok: the mutation is committed; a later query reconciles this visible value.
          // Keep the successful mutation value visible until a later query confirms it.
        }
      } catch (error) {
        toast.error(
          actionErrorMessage(error) ??
            t("designEditor.liveCollaboration.enableError"),
        );
      } finally {
        setLiveCollaborationSaving(false);
      }
    },
    [
      canEditDesign,
      id,
      isSignedIn,
      liveCollaborationSaving,
      designDataUpdatedAt,
      refetchDesign,
      t,
      visualEditSnapshotPublicationState,
    ],
  );
  const canEditPublicLiveScreenUrl =
    publicVisualEdit && Boolean(getEmbedAuthToken());
  const creativeContextLab = useCreativeContextLabState();
  const tweaksEnabled = useLab(DESIGN_TWEAKS.key);
  const reviewResult = useReviewComments(
    {
      resourceType: "design",
      resourceId: id ?? "",
      includeResolved: true,
      newestFirst: true,
      limit: 500,
    },
    { enabled: Boolean(id) && !shellMode },
  );
  const reviewComments = reviewResult.data?.comments ?? [];
  const reviewUnreadCount = useMemo(
    () =>
      getUnreadReviewThreadIds(
        reviewComments,
        reviewResult.data?.discussion?.threadPreferences ?? {},
      ).size,
    [reviewComments, reviewResult.data?.discussion?.threadPreferences],
  );
  const reviewAgentQueueThreadIds = useMemo(
    () =>
      new Set(
        reviewComments
          .filter(
            (comment) =>
              comment.status === "open" &&
              comment.parentCommentId === null &&
              comment.resolutionTarget !== "human" &&
              !comment.consumedAt,
          )
          .map((comment) => comment.threadId),
      ),
    [reviewComments],
  );
  const persistedReviewSummary = readDesignReviewSummary(reviewResult.data);
  const reviewAgentQueueCount =
    persistedReviewSummary?.agentQueueCount ?? reviewAgentQueueThreadIds.size;
  const sendReviewThreadToAgent = useSendReviewThreadToAgent();
  const [reviewSendingThreadId, setReviewSendingThreadId] = useState<
    string | null
  >(null);
  useEffect(() => {
    if (
      reviewSendingThreadId &&
      reviewAgentQueueThreadIds.has(reviewSendingThreadId)
    ) {
      setReviewSendingThreadId(null);
    }
  }, [reviewAgentQueueThreadIds, reviewSendingThreadId]);
  const canEditDesignRef = useRef(canEditDesign);
  const canPersistDesignSourceRef = useRef(canEditDesign && isSignedIn);
  const rawServerFilesByIdRef = useRef(new Map<string, DesignFile>());
  const historyFilesRef = useRef<DesignFile[]>([]);
  const restoreSelectionSnapshot = useCallback(
    (selection: GeometryHistorySelection | undefined) => {
      if (!selection) return;
      if (viewModeRef.current !== "overview") {
        explicitOverviewScreenSelectionRef.current = [];
        setSelectedLayerIdsState(selection.selectedLayerIds);
        if (selection.activeFileId) setActiveFileId(selection.activeFileId);
        return;
      }
      const screenFileIds = new Set(
        getOverviewScreenFileIds(historyFilesRef.current),
      );
      explicitOverviewScreenSelectionRef.current =
        explicitOverviewScreenSelectionForHistory({ selection, screenFileIds });
      const restoredLayerId =
        selection.selectedLayerIds.length === 1
          ? selection.selectedLayerIds[0]
          : undefined;
      const restoredScreenSelectionId =
        selection.overviewSelectedScreenIds.length === 1 &&
        selection.selectedLayerIds.length === 1 &&
        selection.overviewSelectedScreenIds[0] === restoredLayerId
          ? restoredLayerId
          : null;
      pendingOverviewScreenSelectionRef.current = restoredScreenSelectionId;
      pendingOverviewLayerSelectionRef.current =
        restoredLayerId &&
        (codeLayerOwnerByNodeIdRef.current.has(restoredLayerId) ||
          restoredLayerId === restoredScreenSelectionId)
          ? restoredLayerId
          : null;
      if (pendingOverviewLayerSelectionRef.current) {
        schedulePendingOverviewLayerSelectionClear(
          pendingOverviewLayerSelectionRef.current,
        );
      } else {
        clearPendingOverviewLayerSelectionTimer();
      }
      setOverviewSelectedScreenIds(selection.overviewSelectedScreenIds);
      setSelectedLayerIdsState(selection.selectedLayerIds);
      if (selection.activeFileId) {
        setActiveFileId(selection.activeFileId);
      }
    },
    [
      clearPendingOverviewLayerSelectionTimer,
      schedulePendingOverviewLayerSelectionClear,
    ],
  );
  const pushSelectionHistoryEntry = useCallback(
    (before: GeometryHistorySelection, after: GeometryHistorySelection) => {
      if (selectionHistorySnapshotsEqual(before, after)) return;
      const record = (
        before: GeometryHistorySelection,
        after: GeometryHistorySelection,
      ) => {
        if (selectionHistorySnapshotsEqual(before, after)) return;
        selectionUndoStackRef.current = [
          ...selectionUndoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
          { before, after },
        ];
        clearRedoStacks();
        historyOrderRef.current = [
          ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
          "selection",
        ];
        syncUndoRedoState();
      };
      if (
        linkedComponentMutationQueueRef.current?.queue.deferHistoryChange(
          () => {
            const previous = captureCurrentSelection();
            const fileIds = new Set([
              ...Object.keys(after.sourceContentByFileId ?? {}),
              ...after.overviewSelectedScreenIds,
              ...(after.activeFileId ? [after.activeFileId] : []),
            ]);
            const sources = Object.fromEntries(
              [...fileIds].map((fileId) => [
                fileId,
                historySourceReaderRef.current(fileId),
              ]),
            );
            const resolved = resolveHistorySelection(
              captureHistorySelectionSources(after, sources),
              sources,
            );
            flushSync(() => {
              restoreSelectionSnapshot(resolved.selection);
              setSelectedElement(resolved.element);
            });
            record(previous, resolved.selection!);
          },
        )
      )
        return;
      record(before, after);
    },
    [clearRedoStacks, restoreSelectionSnapshot, syncUndoRedoState],
  );
  const recordSelectionHistoryAroundChange = useCallback(
    (run: () => void) => {
      marqueeSelectionHistoryBeforeRef.current = null;
      marqueeSelectedElementBeforeRef.current = null;
      lastMarqueeSelectionSignatureRef.current = null;
      if (viewModeRef.current !== "overview") {
        run();
        return;
      }
      const before = captureCurrentSelection();
      flushSync(run);
      const after = captureCurrentSelection();
      pushSelectionHistoryEntry(before, after);
    },
    [pushSelectionHistoryEntry],
  );
  const recordMarqueeSelectionHistoryAroundChange = useCallback(
    (
      run: () => void,
      intent: {
        source?: string;
        final?: boolean;
        cancelled?: boolean;
        restoreHostSelection?: boolean;
        resetHistory?: boolean;
      },
    ) => {
      if (intent.source === "marquee" && intent.cancelled) {
        const before = marqueeSelectionHistoryBeforeRef.current;
        const selectedElementBefore = marqueeSelectedElementBeforeRef.current;
        marqueeSelectionHistoryBeforeRef.current = null;
        marqueeSelectedElementBeforeRef.current = null;
        lastMarqueeSelectionSignatureRef.current = null;
        runMarqueeSelectionCancellation({
          before,
          flushSync,
          restoreHostSelection: intent.restoreHostSelection === true,
          restoreSelectionSnapshot,
          run,
          selectedElementBefore,
          setSelectedElement,
        });
        return;
      }
      if (intent.source === "marquee" && intent.resetHistory) {
        marqueeSelectionHistoryBeforeRef.current = null;
        marqueeSelectedElementBeforeRef.current = null;
        lastMarqueeSelectionSignatureRef.current = null;
      }
      if (intent.source !== "marquee") {
        recordSelectionHistoryAroundChange(run);
        return;
      }
      if (viewModeRef.current !== "overview") {
        marqueeSelectionHistoryBeforeRef.current = null;
        marqueeSelectedElementBeforeRef.current = null;
        lastMarqueeSelectionSignatureRef.current = null;
        run();
        return;
      }
      recordDesignPerformance("marqueeSelectionChange");
      if (intent.final !== true) {
        if (marqueeSelectionHistoryBeforeRef.current === null) {
          lastMarqueeSelectionSignatureRef.current = null;
          marqueeSelectionHistoryBeforeRef.current = captureCurrentSelection();
          marqueeSelectedElementBeforeRef.current = selectedElementRef.current;
        }
        run();
        return;
      }
      const before =
        marqueeSelectionHistoryBeforeRef.current ?? captureCurrentSelection();
      flushSync(run);
      recordDesignPerformance("marqueeFinalSelectionChange");
      const after = captureCurrentSelection();
      const entry = coalesceMarqueeSelectionHistory(
        marqueeSelectionHistoryBeforeRef,
        intent.final === true,
        before,
        after,
      );
      if (entry) pushSelectionHistoryEntry(entry.before, entry.after);
      marqueeSelectedElementBeforeRef.current = null;
      lastMarqueeSelectionSignatureRef.current = null;
    },
    [
      pushSelectionHistoryEntry,
      recordSelectionHistoryAroundChange,
      restoreSelectionSnapshot,
    ],
  );
  const pendingLocalFileContentsRef = useRef<
    Map<string, PendingLocalFileContent>
  >(new Map());
  const [
    pendingLocalFileContentsRevision,
    setPendingLocalFileContentsRevision,
  ] = useState(0);

  const markPendingLocalFileContent = useCallback(
    (
      fileId: string,
      content: string,
      baseUpdatedAt?: string | null,
      identityMigrationSourceContent?: string,
    ) => {
      const current = pendingLocalFileContentsRef.current.get(fileId);
      if (
        current?.content === content &&
        current.identityMigrationSourceContent ===
          identityMigrationSourceContent &&
        (baseUpdatedAt === undefined || current.baseUpdatedAt !== undefined)
      )
        return;
      pendingLocalFileContentsRef.current.set(
        fileId,
        createPendingLocalFileContent({
          current,
          file: rawServerFilesByIdRef.current.get(fileId),
          content,
          baseUpdatedAt,
          identityMigrationSourceContent,
        }),
      );
      setPendingLocalFileContentsRevision((revision) => revision + 1);
    },
    [],
  );

  const clearPendingLocalFileContent = useCallback(
    (fileId: string, expectedContent?: string) => {
      const current = pendingLocalFileContentsRef.current.get(fileId);
      if (!current) return;
      if (
        expectedContent !== undefined &&
        current.content !== expectedContent
      ) {
        return;
      }
      pendingLocalFileContentsRef.current.delete(fileId);
      setPendingLocalFileContentsRevision((revision) => revision + 1);
    },
    [],
  );

  const rollbackPendingLocalFileContent = useCallback(
    (fileId: string, expectedContent: string) => {
      const pending = pendingLocalFileContentsRef.current.get(fileId);
      if (!pending || pending.content !== expectedContent) return;
      if (id) {
        queryClient.setQueryData(["action", "get-design", { id }], (old: any) =>
          old && typeof old === "object"
            ? restorePendingFileContent(old, fileId, pending, expectedContent)
            : old,
        );
      }
      clearPendingLocalFileContent(fileId, expectedContent);
      failPendingTextCapture(fileId);
    },
    [clearPendingLocalFileContent, id, queryClient],
  );

  useLayoutEffect(() => {
    canEditDesignRef.current = canEditDesign;
    canPersistDesignSourceRef.current = canEditDesign && isSignedIn;
  }, [canEditDesign, isSignedIn]);

  useEffect(() => {
    if (!id || !hasPendingGeneration) return;
    const pending = readPendingGeneration(id);
    if (!pending) {
      setHasPendingGeneration(false);
      return;
    }
    if (isPendingGenerationStale(pending)) {
      markGenerationStale();
      return;
    }

    const timestamp = pending.startedAt ?? pending.createdAt ?? Date.now();
    const remaining = Math.max(
      0,
      PENDING_GENERATION_STALE_MS - (Date.now() - timestamp),
    );
    const timer = window.setTimeout(() => {
      const latest = readPendingGeneration(id);
      if (isPendingGenerationStale(latest)) {
        markGenerationStale();
      }
    }, remaining + 250);

    return () => window.clearTimeout(timer);
  }, [id, hasPendingGeneration, markGenerationStale]);

  const updateFileMutation = useActionMutation("update-file", {
    skipActionQueryInvalidation: true,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["action"],
        predicate: (query) =>
          query.queryKey[1] !== "get-design" &&
          !isContentIndependentDesignQuery(query.queryKey[1]),
      });
    },
  });
  const renameScreenMutation = useActionMutation("rename-screen");
  const updateScreenSourceMutation = useActionMutation("update-screen-source");
  const createFileMutation = useActionMutation("create-file", {
    skipActionQueryInvalidation: true,
  });
  const createFileAsync = createFileMutation.mutateAsync;
  const deleteFileMutation = useActionMutation("delete-file");
  const updateDesignMutation = useActionMutation("update-design");
  const updateDesignAsync = updateDesignMutation.mutateAsync;
  const applyTweaksMutation = useActionMutation("apply-tweaks");
  const applyTweaksAsync = applyTweaksMutation.mutateAsync;
  const duplicateDesignMutation = useActionMutation("duplicate-design");
  const saveDesignAsTemplateMutation = useActionMutation(
    "save-design-as-template",
  );
  const exportHtmlMutation = useActionMutation("export-html");
  const exportZipMutation = useActionMutation("export-zip");
  const applyMotionEditMutation = useActionMutation("apply-motion-edit");
  const applyMotionEdit = applyMotionEditMutation.mutate;
  const removeMotionTimelineMutation = useActionMutation(
    "remove-motion-timeline",
  );
  const removeMotionTimeline = removeMotionTimelineMutation.mutate;
  const motionAutosavePending = applyMotionEditMutation.isPending;
  const addBreakpointMutation = useActionMutation("add-breakpoint");
  const removeBreakpointMutation = useActionMutation("remove-breakpoint");
  const updateBreakpointMutation = useActionMutation("update-breakpoint");
  const setActiveBreakpointMutation = useActionMutation(
    "set-active-breakpoint",
  );
  const setActiveBreakpointMutateAsyncRef = useRef(
    setActiveBreakpointMutation.mutateAsync,
  );
  setActiveBreakpointMutateAsyncRef.current =
    setActiveBreakpointMutation.mutateAsync;
  const activeBreakpointWriteQueueRef =
    useRef<ReturnType<typeof createLatestWriteQueue<ActiveBreakpointWrite>>>(
      null,
    );
  if (!activeBreakpointWriteQueueRef.current) {
    activeBreakpointWriteQueueRef.current = createLatestWriteQueue((input) =>
      setActiveBreakpointMutateAsyncRef.current(input),
    );
  }

  const openComponentSourceMutation = useActionMutation(
    "open-component-source",
  );
  const goToMainComponentMutation = useActionMutation("go-to-main-component");
  const detachComponentInstanceMutation = useActionMutation(
    "detach-component-instance",
  );

  const migrateBoardObjectsMutation = useActionMutation(
    "migrate-board-objects-to-file",
  );

  const migrateMutation = useActionMutation("migrate-inline-design-to-app");
  const [publishWaitlistPopoverOpen, setPublishWaitlistPopoverOpen] =
    useState(false);
  const [publishWaitlistPopoverView, setPublishWaitlistPopoverView] = useState<
    "actions" | "waitlist"
  >("actions");

  const persistPromptDesignSystem = useCallback(
    (designSystemId: string | null | undefined) => {
      if (
        designSystemId === undefined ||
        !id ||
        !canEditDesign ||
        design?.designSystemId === designSystemId
      ) {
        return;
      }
      queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
        if (!old || typeof old !== "object") return old;
        return { ...old, designSystemId };
      });
      updateDesignMutation.mutate({ id, designSystemId } as any, {
        onError: () => {
          void queryClient.invalidateQueries({
            queryKey: ["action", "get-design"],
          });
        },
      });
    },
    [
      canEditDesign,
      design?.designSystemId,
      id,
      queryClient,
      updateDesignMutation,
    ],
  );
  const pendingLocalFileContentsSnapshot = useMemo(
    () => new Map(pendingLocalFileContentsRef.current),
    [pendingLocalFileContentsRevision],
  );
  const reserveVisualEditSnapshot = useCallback(
    (fileId?: string) => {
      if (!id || !fileId) {
        return Promise.reject(new Error("Missing visual edit snapshot target"));
      }
      return runReserveVisualEditSnapshotInOrder(
        visualEditSnapshotPublicationState,
        id,
        fileId,
        () =>
          callAction<{ reservationToken: string }>(
            "reserve-visual-edit-snapshot",
            { designId: id, fileId },
          ),
      );
    },
    [id, visualEditSnapshotPublicationState],
  );
  const scheduleVisualEditSnapshotPublication = useCallback(
    (screenId: string, html: string, reservationToken?: string) => {
      runScheduleVisualEditSnapshotPublication({
        canPublish: canEditDesign && liveCollaborationEnabled,
        designId: id,
        fileId: screenId,
        html,
        reservationToken,
        publish: (payload) =>
          callAction<{ published: boolean }>(
            "publish-visual-edit-snapshot",
            payload,
          ),
        setFailed: setPendingVisualEditPublicationFailed,
        showError: (fileId, error) => {
          console.error(
            "[design:visual-edit] fallback snapshot publication failed",
            error,
          );
          toast.error(t("designEditor.toasts.codingHandoffError"), {
            id: `design-visual-edit-snapshot:${fileId}`,
          });
        },
        state: visualEditSnapshotPublicationState,
      });
    },
    [
      canEditDesign,
      id,
      liveCollaborationEnabled,
      t,
      visualEditSnapshotPublicationState,
    ],
  );

  const handleComponentSourceJump = useCallback(
    ({ nodeId }: { nodeId: string; componentName: string }) => {
      if (!id || !nodeId) return;
      openComponentSourceMutation.mutate(
        { designId: id, nodeId, fileId: activeFileId ?? undefined } as any,
        {
          onError: () => {
            toast.error(
              "Could not open component source" /* i18n-ignore edge-case jump failure */,
            );
          },
        },
      );
    },
    [id, activeFileId, openComponentSourceMutation],
  );

  const publishAuthoritativeClipboardMutation = useCallback(
    (args: {
      fileId: string;
      baseContent: string;
      nextContent: string;
      origin: ClipboardContentMutationOrigin;
      baseSource?: "lineage" | "document";
    }): ClipboardContentMutationPublication | null => {
      const current = latestClipboardMutationContentRef.current.get(
        args.fileId,
      );
      const nextLineage = publishClipboardContentMutation({
        current,
        fileId: args.fileId,
        fileType: rawServerFilesByIdRef.current.get(args.fileId)?.fileType,
        baseContentHash: sourceContentHash(args.baseContent),
        nextContent: args.nextContent,
        origin: args.origin,
        baseSource: args.baseSource,
      });
      if (!nextLineage) return null;
      latestClipboardMutationContentRef.current.set(args.fileId, nextLineage);
      return {
        mutationId: nextLineage.mutationId,
        contentHash: nextLineage.contentHash,
        origin: nextLineage.origin,
      };
    },
    [],
  );

  const startRetryGeneration = useCallback(
    async (
      promptState: NonNullable<typeof retryablePrompt>,
      attempt: number,
      mode: "manual" | "auto",
    ) =>
      runStartRetryGeneration(
        {
          agentSubmit,
          canEditDesign,
          clearAutoRetryTimer,
          clearGenerationCompleteTimer,
          design,
          generationModelRef,
          imageAttachmentUnavailableMessage: t(
            "promptDialog.imageAttachmentUnavailable",
          ),
          invalidCanvasDimensionsMessage: t(
            "designEditor.invalidCanvasDimensions",
          ),
          id,
          setGenerationChatTabId,
          setGenerationIssue,
          setHasPendingGeneration,
          setRetryablePrompt,
        },
        promptState,
        attempt,
        mode,
      ),
    [
      agentSubmit,
      canEditDesign,
      clearAutoRetryTimer,
      clearGenerationCompleteTimer,
      design,
      id,
      t,
    ],
  );

  const handleRetryGeneration = useCallback(() => {
    if (!retryablePrompt || !canEditDesign) return;
    void startRetryGeneration(
      retryablePrompt,
      (retryablePrompt.attempt ?? 1) + 1,
      "manual",
    );
  }, [canEditDesign, retryablePrompt, startRetryGeneration]);

  const handleApplyReviewFeedback = useCallback(() => {
    if (
      !id ||
      !canEditDesign ||
      reviewAgentQueueCount === 0 ||
      reviewFeedbackApplying
    )
      return;
    submitReviewFeedback(
      "Apply all open design review feedback for this design. After each change, verify it in the affected screen and resolve the corresponding thread only after the saved edit is confirmed.",
      `Design id: ${id}. Start by reading the current screen and fetching the open review feedback queue. Apply one thread at a time with persisted edits and verification.`,
      { openSidebar: true, newTab: true },
    );
  }, [
    canEditDesign,
    id,
    reviewAgentQueueCount,
    reviewFeedbackApplying,
    submitReviewFeedback,
  ]);

  return {
    browserTabId,
    runtimeLayerSnapshotRequest,
    setRuntimeLayerSnapshotRequest,
    lastOverviewSelectedScreenIdsRef,
    lastMarqueeSelectionSignatureRef,
    restoreSelectionSnapshot,
    recordSelectionHistoryAroundChange,
    recordMarqueeSelectionHistoryAroundChange,
    persistedSelectionStateRef,
    persistedSelectionContextRef,
    pendingPersistedSelectionWriteRef,
    persistedSelectionWriteTimerRef,
    designSelectionOwnerIdRef,
    lastGeometryCommitAtRef,
    lastGeometryCommitSourceRef,
    resetGeometryCommitCoalescing,
    drawMode,
    setDrawMode,
    pinMode,
    setPinMode,
    focusedAnnotationSending,
    handleFocusedAnnotationSendingChange,
    promptAnchorRef,
    setHasPendingGeneration,
    setGenerationChatTabId,
    generationIssue,
    setGenerationIssue,
    retryablePrompt,
    setRetryablePrompt,
    generationOutputReadyRef,
    autoRetryTimerRef,
    clearGenerationCompleteTimer,
    clearAutoRetryTimer,
    staleToastShownRef,
    generationModelRef,
    markGenerationStale,
    generating,
    agentSubmit,
    resetAgentGenerating,
    trackAgentGeneration,
    reviewFeedbackApplying,
    pendingQuestions,
    pendingQuestionsTitle,
    pendingQuestionsDescription,
    pendingQuestionsSkipLabel,
    pendingQuestionsSubmitLabel,
    pendingQuestionsSubmissionBlocked,
    pendingQuestionsProviderStatus,
    retryPendingQuestionsProviderStatus,
    handleQuestionsSubmit,
    handleQuestionsSkip,
    pendingQuestionsVisible,
    currentUserAvatarUrl,
    pendingGenerationActive,
    designLoading,
    refetchDesign,
    designAccessStatus,
    designAccessStatusLoading,
    designAccessStatusError,
    refetchDesignAccessStatus,
    requestDesignAccessMutation,
    designAccessRequestSent,
    handleRequestDesignAccess,
    design,
    overviewDataReady,
    activeBreakpointStateVersion,
    designEditorCommandVersion,
    pendingNodeRewriteStateVersion,
    designAccessRole,
    canShareDesign,
    canEditDesign,
    canEditLiveScreens,
    publicVisualEdit,
    canCommentDesign,
    canRenderAuthenticatedShare,
    failedLocalhostConsentClear,
    setFailedLocalhostConsentClear,
    localhostConsentRequestQuery,
    clearLocalhostConsentRequestMutation,
    visualEditSnapshotPublicationState,
    liveCollaborationSaving,
    liveCollaborationEnabled,
    handleLiveCollaborationChange,
    canEditPublicLiveScreenUrl,
    creativeContextLab,
    tweaksEnabled,
    reviewResult,
    reviewComments,
    reviewUnreadCount,
    reviewAgentQueueCount,
    sendReviewThreadToAgent,
    reviewSendingThreadId,
    setReviewSendingThreadId,
    canEditDesignRef,
    canPersistDesignSourceRef,
    rawServerFilesByIdRef,
    historyFilesRef,
    pendingLocalFileContentsRef,
    pendingLocalFileContentsRevision,
    setPendingLocalFileContentsRevision,
    markPendingLocalFileContent,
    clearPendingLocalFileContent,
    rollbackPendingLocalFileContent,
    updateFileMutation,
    renameScreenMutation,
    updateScreenSourceMutation,
    createFileMutation,
    createFileAsync,
    deleteFileMutation,
    updateDesignMutation,
    updateDesignAsync,
    applyTweaksAsync,
    duplicateDesignMutation,
    saveDesignAsTemplateMutation,
    exportHtmlMutation,
    exportZipMutation,
    applyMotionEdit,
    removeMotionTimelineMutation,
    removeMotionTimeline,
    motionAutosavePending,
    addBreakpointMutation,
    removeBreakpointMutation,
    updateBreakpointMutation,
    activeBreakpointWriteQueueRef,
    goToMainComponentMutation,
    detachComponentInstanceMutation,
    migrateBoardObjectsMutation,
    migrateMutation,
    publishWaitlistPopoverOpen,
    setPublishWaitlistPopoverOpen,
    publishWaitlistPopoverView,
    setPublishWaitlistPopoverView,
    persistPromptDesignSystem,
    pendingLocalFileContentsSnapshot,
    reserveVisualEditSnapshot,
    scheduleVisualEditSnapshotPublication,
    handleComponentSourceJump,
    publishAuthoritativeClipboardMutation,
    startRetryGeneration,
    handleRetryGeneration,
    handleApplyReviewFeedback,
  };
}

export type EditorGenerationAndAccess = ReturnType<
  typeof useEditorGenerationAndAccess
>;
