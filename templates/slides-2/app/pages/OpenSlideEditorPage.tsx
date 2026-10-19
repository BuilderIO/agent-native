import { writeClientAppState } from "@agent-native/core/client/application-state";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useGuidedQuestionFlow } from "@agent-native/toolkit/app/chat/agentkit-chat";
import type { PromptComposerSubmitOptions } from "@agent-native/toolkit/app/chat/composer/index";
import { appStateKey, appStateKeyForBrowserTab } from "@shared/app-state-tabs";
import { ASPECT_RATIO_VALUES, type AspectRatio } from "@shared/aspect-ratios";
import {
  currentSlideTextRangeSelection,
  type SlideTextRangeSelection,
} from "@shared/slide-text-range-selection";
import { IconAlertTriangle, IconArrowLeft } from "@tabler/icons-react";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";

import type { PromptChatAttachment } from "@/components/editor/PromptDialog";
import { QuestionFlow } from "@/components/editor/QuestionFlow";
import {
  getEditorActionErrorCode,
  getEditorActionErrorTranslationKey,
} from "@/components/open-slide-editor/editor-action-errors";
import {
  OpenSlideEditor,
  type OpenSlideEditorMode,
  type OpenSlideInspectorPanel,
} from "@/components/open-slide-editor/OpenSlideEditor";
import type {
  ElementSnapshot,
  SlideSource,
  SourceEdit,
} from "@/components/open-slide-editor/types";
import type { SlideDesignTokens } from "@/components/open-slide-runtime/protocol";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getStartedGenerationAttemptTabId } from "@/hooks/use-agent-generating";
import {
  clearNewDeckGenerationRun,
  useNewDeckGeneration,
  useNewDeckGenerationRun,
} from "@/hooks/use-new-deck-generation";
import { useNewDeckGenerationSignal } from "@/hooks/use-new-deck-generation-signal";
import { TAB_ID } from "@/lib/tab-id";

type DeckDesignTokenSnapshot = {
  deckId: string;
  updatedAt: string;
  tokens: SlideDesignTokens;
};

type DeckModelSelection = Pick<
  PromptComposerSubmitOptions,
  "model" | "engine" | "effort"
>;

const BLANK_SLIDE_SOURCE = `export default function Slide() {
  return <div style={{ width: "1920px", height: "1080px", boxSizing: "border-box" }} />;
}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function renderedInstanceState(
  node: ElementSnapshot,
): { instanceIndex: number; instanceCount: number } | Record<string, never> {
  const { instanceIndex, instanceCount } = node;
  const nodeId = /^(\d+):(\d+):(\d+)$/.exec(node.nodeId);
  if (
    typeof instanceIndex !== "number" ||
    !Number.isSafeInteger(instanceIndex) ||
    typeof instanceCount !== "number" ||
    !Number.isSafeInteger(instanceCount) ||
    instanceIndex < 0 ||
    instanceCount < 1 ||
    instanceCount > 8_000 ||
    instanceIndex >= instanceCount ||
    Number(nodeId?.[1]) !== node.line ||
    Number(nodeId?.[2]) !== node.column ||
    Number(nodeId?.[3]) !== instanceIndex
  ) {
    return {};
  }
  return { instanceIndex, instanceCount };
}

function isPromptChatAttachment(value: unknown): value is PromptChatAttachment {
  return (
    isRecord(value) &&
    value.type === "file" &&
    typeof value.name === "string" &&
    value.displayOnly === true &&
    (value.contentType === undefined ||
      typeof value.contentType === "string") &&
    (value.text === undefined || typeof value.text === "string")
  );
}

function readDeckModelSelection(
  value: unknown,
): DeckModelSelection | undefined {
  if (!isRecord(value)) return undefined;
  const selection: DeckModelSelection = {
    ...(typeof value.model === "string" ? { model: value.model } : {}),
    ...(typeof value.engine === "string" ? { engine: value.engine } : {}),
    ...(typeof value.effort === "string"
      ? { effort: value.effort as DeckModelSelection["effort"] }
      : {}),
  };
  return Object.keys(selection).length > 0 ? selection : undefined;
}

function readAspectRatio(value: unknown): AspectRatio | undefined {
  return typeof value === "string" &&
    ASPECT_RATIO_VALUES.includes(value as AspectRatio)
    ? (value as AspectRatio)
    : undefined;
}

function writeState(key: string, value: unknown) {
  void writeClientAppState(key, value, {
    keepalive: true,
    requestSource: TAB_ID,
  }).catch((error) =>
    console.error(`Could not update application state "${key}".`, error),
  );
}

export default function OpenSlideEditorPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const t = useT();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editorMode, setEditorMode] = useState<OpenSlideEditorMode>("edit");
  const routeGenerationSubmitId = searchParams.get("generationSubmitId");
  const routeIsNewDeckGeneration =
    searchParams.get("generating") === "1" || Boolean(routeGenerationSubmitId);
  const generationRouteState = isRecord(location.state) ? location.state : null;
  const routeGenerationPrompt = generationRouteState?.generationOriginalPrompt;
  const generationRetryAttachments = Array.isArray(
    generationRouteState?.generationRetryAttachments,
  )
    ? generationRouteState.generationRetryAttachments.filter(
        isPromptChatAttachment,
      )
    : [];
  const generationModelSelection = readDeckModelSelection(
    generationRouteState?.generationModelSelection,
  );
  const {
    generating: generationRunActive,
    submitMessageId: restoredGenerationSubmitId,
    tabId: generationTabId,
    conversationThreadId: generationThreadId,
    questionContinuationPending,
    submitQuestionContinuation,
  } = useNewDeckGenerationRun(
    id ?? "",
    routeIsNewDeckGeneration,
    routeGenerationSubmitId,
  );
  const generationSubmitId =
    routeGenerationSubmitId ?? restoredGenerationSubmitId;
  const isNewDeckGenerationRoute =
    routeIsNewDeckGeneration || Boolean(restoredGenerationSubmitId);
  const settlementCheckRef = useRef<string | null>(null);
  const [settlementRetryVersion, setSettlementRetryVersion] = useState(0);
  const [settledGeneration, setSettledGeneration] = useState<{
    attemptId: string;
    outcome: "failed" | "unresolved";
    runError: boolean;
  } | null>(null);
  const deckQuery = useActionQuery(
    "get-deck",
    { id: id ?? "", compact: "true" },
    { enabled: Boolean(id) },
  );
  const deck = deckQuery.data;
  const slides = deck?.slides ?? [];
  const generationContext = isRecord(deck?.generationContext)
    ? deck.generationContext
    : null;
  const contextAttemptId =
    typeof generationContext?.generationAttemptId === "string"
      ? generationContext.generationAttemptId
      : null;
  const generationAttemptId =
    searchParams.get("generation_attempt_id") ?? contextAttemptId;
  const generationPrompt =
    typeof generationContext?.originalPrompt === "string" &&
    generationContext.originalPrompt.trim()
      ? generationContext.originalPrompt
      : typeof routeGenerationPrompt === "string" &&
          routeGenerationPrompt.trim()
        ? routeGenerationPrompt
        : null;
  const generationFiles = Array.isArray(generationContext?.files)
    ? generationContext.files.flatMap((value: unknown) => {
        if (
          !isRecord(value) ||
          typeof value.path !== "string" ||
          typeof value.originalName !== "string" ||
          typeof value.type !== "string"
        ) {
          return [];
        }
        return [
          {
            path: value.path,
            ...(typeof value.url === "string" ? { url: value.url } : {}),
            originalName: value.originalName,
            filename: value.originalName,
            type: value.type,
            size: 0,
          },
        ];
      })
    : [];
  const generationReferenceSelection: Record<string, unknown> = {};
  if (generationContext) {
    for (const key of [
      "composerContext",
      "contextItems",
      "designSystemId",
      "referenceDeckId",
      "referenceSource",
    ]) {
      if (generationContext[key] !== undefined) {
        generationReferenceSelection[key] = generationContext[key];
      }
    }
  }
  const retryState = generationPrompt
    ? {
        retryPrompt: generationPrompt,
        ...(generationFiles.length ? { retryFiles: generationFiles } : {}),
        ...(typeof generationContext?.additionalContext === "string"
          ? { retryContext: generationContext.additionalContext }
          : {}),
        ...(Object.keys(generationReferenceSelection).length
          ? { retryReferenceSelection: generationReferenceSelection }
          : {}),
        ...(generationRetryAttachments.length > 0
          ? { retryAttachments: generationRetryAttachments }
          : {}),
        ...(generationModelSelection
          ? { modelSelection: generationModelSelection }
          : {}),
      }
    : undefined;
  const generationTabForAttempt =
    generationAttemptId && id
      ? (getStartedGenerationAttemptTabId(generationAttemptId, id) ??
        generationTabId)
      : generationTabId;
  const { attempt: generationAttempt, generating: attemptGenerationActive } =
    useNewDeckGenerationSignal({
      attemptId: generationAttemptId,
      outputId: id ?? null,
      tabId: generationTabForAttempt,
      progressToken: slides.length,
    });
  const generationActive = generationRunActive || attemptGenerationActive;
  const {
    questions: questionFlowQuestions,
    title: questionFlowTitle,
    description: questionFlowDescription,
    skipLabel: questionFlowSkipLabel,
    submitLabel: questionFlowSubmitLabel,
    isSubmissionBlocked: questionFlowSubmissionBlocked,
    providerStatus: questionFlowProviderStatus,
    retryProviderStatus: retryQuestionFlowProviderStatus,
    handleSubmit: handleQuestionSubmit,
    handleSkip: handleQuestionSkip,
    isSubmitting: questionFlowSubmitting,
    refetchPendingQuestionStatus,
  } = useGuidedQuestionFlow({
    stateKey: appStateKey("guided-questions"),
    browserTabId: TAB_ID,
    threadId: generationThreadId ?? undefined,
    queryKey: ["slides-2", "guided-questions"],
    submitMessage: "Here are my answers — go ahead and create the slides.",
    skipMessage:
      "Skip the questions — just go ahead and create the slides with your best judgment.",
    buildSubmitContext: ({ formattedAnswers }) =>
      [
        "The user answered the pre-generation questions.",
        `Deck ID: ${id}`,
        "Call get-deck first and treat its persisted generationContext as the canonical brief. Continue the original slide sequence and target count.",
        "",
        "Answers:",
        formattedAnswers,
        "",
        `Continue generating slides sequentially with add-slide for deck ${id}.`,
      ].join("\n"),
    buildSkipContext: () =>
      `The user skipped the pre-generation questions for deck ${id}. Call get-deck first, use its persisted generationContext as the canonical brief, and continue the original slide sequence with reasonable defaults.`,
    onSubmitMessage: submitQuestionContinuation,
    onSkipMessage: submitQuestionContinuation,
  });
  const showQuestionFlow = Boolean(questionFlowQuestions?.length);
  const waitingOnGenerationQuestions =
    showQuestionFlow || questionContinuationPending;
  const { isNewDeckCreation, phase: generationPhase } = useNewDeckGeneration({
    deckId: id ?? "",
    isNewDeckRoute: isNewDeckGenerationRoute,
    generating: generationActive,
    waitingOnQuestions: waitingOnGenerationQuestions,
    slideCount: slides.length,
  });
  const currentSettledGeneration =
    settledGeneration?.attemptId === generationAttemptId
      ? settledGeneration
      : null;
  const questionFlowOverlay = showQuestionFlow ? (
    <QuestionFlow
      questions={questionFlowQuestions ?? []}
      onSubmit={handleQuestionSubmit}
      onSkip={handleQuestionSkip}
      title={questionFlowTitle}
      description={questionFlowDescription}
      skipLabel={questionFlowSkipLabel}
      submitLabel={questionFlowSubmitLabel}
      isSubmitting={questionFlowSubmitting}
      isSubmissionBlocked={questionFlowSubmissionBlocked}
      providerStatus={questionFlowProviderStatus}
      onRetryProviderStatus={retryQuestionFlowProviderStatus}
    />
  ) : null;
  const showEmptyGenerationPending =
    isNewDeckCreation &&
    Boolean(generationAttemptId) &&
    !currentSettledGeneration &&
    (generationActive ||
      generationPhase === "pending" ||
      generationPhase === "started" ||
      generationPhase === "abandoned");
  const generationSettlementKey = generationAttemptId
    ? `${generationAttemptId}:${generationAttempt.runError}`
    : null;
  const generationOutcomeCopy = currentSettledGeneration
    ? currentSettledGeneration.outcome === "failed"
      ? currentSettledGeneration.runError
        ? t("deckEditor.agentRunFailed")
        : t("deckEditor.generationFailed")
      : slides.length > 0
        ? t("deckEditor.generationOutcomeUnresolvedWithSlides")
        : t("deckEditor.generationOutcomeUnresolved")
    : null;

  useEffect(() => {
    settlementCheckRef.current = null;
    setSettledGeneration(null);
  }, [id, generationAttemptId]);

  useEffect(() => {
    if (!showQuestionFlow) return;
    if (generationTabId) {
      window.dispatchEvent(
        new CustomEvent("agent-chat:open-thread", {
          detail: { threadId: generationTabId },
        }),
      );
    }
    window.dispatchEvent(new Event("agent-panel:open"));
  }, [generationTabId, showQuestionFlow]);

  useEffect(() => {
    if (
      !id ||
      !generationAttemptId ||
      !generationSettlementKey ||
      !isNewDeckGenerationRoute ||
      generationActive ||
      waitingOnGenerationQuestions ||
      (generationPhase !== "started" && generationPhase !== "abandoned") ||
      settlementCheckRef.current === generationSettlementKey
    ) {
      return;
    }

    settlementCheckRef.current = generationSettlementKey;
    let cancelled = false;
    let completed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const retrySettlementCheck = () => {
      retryTimer = setTimeout(() => {
        if (!cancelled) {
          setSettlementRetryVersion((version) => version + 1);
        }
      }, 1000);
    };
    void (async () => {
      const latestDeck = await deckQuery.refetch();
      if (cancelled) return;
      if (latestDeck.isError) {
        retrySettlementCheck();
        return;
      }
      const latestSlides = latestDeck.data?.slides ?? [];
      const latestContext = isRecord(latestDeck.data?.generationContext)
        ? latestDeck.data.generationContext
        : generationContext;
      const latestTargetCount =
        typeof latestContext?.targetSlideCount === "number" &&
        Number.isInteger(latestContext.targetSlideCount) &&
        latestContext.targetSlideCount > 0
          ? latestContext.targetSlideCount
          : null;
      const runError = generationAttempt.runError;
      const reachedTarget =
        latestTargetCount !== null && latestSlides.length >= latestTargetCount;
      const outcome = runError
        ? "failed"
        : reachedTarget
          ? null
          : generationPhase === "abandoned"
            ? "failed"
            : "unresolved";
      const questionCheck = await refetchPendingQuestionStatus();
      if (cancelled) return;
      if (questionCheck.status !== "none") {
        retrySettlementCheck();
        return;
      }

      completed = true;
      if (outcome) {
        setSettledGeneration({
          attemptId: generationAttemptId,
          outcome,
          runError,
        });
      }
      if (generationSubmitId) {
        clearNewDeckGenerationRun(id, generationSubmitId);
      }

      const next = new URLSearchParams(searchParams);
      next.delete("generating");
      next.delete("generation_attempt_id");
      next.delete("generationSubmitId");
      const nextLocationState = isRecord(location.state)
        ? { ...location.state }
        : {};
      delete nextLocationState.generationOriginalPrompt;
      if (!outcome) {
        delete nextLocationState.generationRetryAttachments;
        delete nextLocationState.generationModelSelection;
      }
      const search = next.toString();
      navigate(
        `${location.pathname}${search ? `?${search}` : ""}${location.hash}`,
        {
          replace: true,
          state:
            Object.keys(nextLocationState).length > 0
              ? nextLocationState
              : null,
        },
      );
    })().catch((error: unknown) => {
      if (cancelled) return;
      completed = false;
      console.error("Failed to check new deck generation settlement", error);
      retrySettlementCheck();
    });
    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      if (
        !completed &&
        settlementCheckRef.current === generationSettlementKey
      ) {
        settlementCheckRef.current = null;
      }
    };
  }, [
    deckQuery.refetch,
    generationActive,
    generationAttempt,
    generationAttemptId,
    generationSettlementKey,
    generationContext,
    generationPhase,
    generationSubmitId,
    id,
    isNewDeckGenerationRoute,
    location.hash,
    location.pathname,
    location.state,
    navigate,
    refetchPendingQuestionStatus,
    settlementRetryVersion,
    searchParams,
    waitingOnGenerationQuestions,
  ]);
  const canEdit =
    deck?.widgetAccessRole !== "viewer" &&
    deck?.widgetAccessRole !== "commenter";
  const canComment = deck?.widgetAccessRole !== "viewer";
  const tokenQuery = useActionQuery(
    "get-deck-design-tokens",
    { deckId: id ?? "" },
    { enabled: Boolean(id) },
  );
  const [localTokenSnapshot, setLocalTokenSnapshot] =
    useState<DeckDesignTokenSnapshot | null>(null);
  const tokenSnapshot =
    localTokenSnapshot &&
    localTokenSnapshot.deckId === id &&
    (!tokenQuery.data ||
      typeof tokenQuery.data.updatedAt !== "string" ||
      localTokenSnapshot.updatedAt >= tokenQuery.data.updatedAt)
      ? localTokenSnapshot
      : tokenQuery.data;
  const updateTokens = useActionMutation("update-deck-design-tokens");
  const patchDeck = useActionMutation("patch-deck");
  const [structuralError, setStructuralError] = useState<string | null>(null);
  const parsedSlide = Number.parseInt(
    searchParams.get("p") ?? searchParams.get("slide") ?? "1",
    10,
  );
  const activeIndex = slides.length
    ? Math.max(
        0,
        Math.min(
          slides.length - 1,
          Number.isFinite(parsedSlide) ? parsedSlide - 1 : 0,
        ),
      )
    : 0;
  const activeSlide = slides[activeIndex];
  const sourceQuery = useActionQuery(
    "get-slide-source",
    { deckId: id ?? "", slideId: activeSlide?.id ?? "" },
    { enabled: Boolean(id && activeSlide?.id) },
  );
  const [localSource, setLocalSource] = useState<{
    slideId: string;
    source: SlideSource;
  } | null>(null);
  const [sourceConflictSnapshot, setSourceConflictSnapshot] = useState<{
    slideId: string;
    source: SlideSource;
  } | null>(null);
  const querySource =
    sourceQuery.data?.slide && sourceQuery.data.slide.id === activeSlide?.id
      ? sourceQuery.data.slide
      : undefined;
  const conflictedSource =
    sourceConflictSnapshot && sourceConflictSnapshot.slideId === activeSlide?.id
      ? sourceConflictSnapshot.source
      : undefined;
  const source =
    conflictedSource ??
    (localSource &&
    activeSlide &&
    localSource.slideId === activeSlide.id &&
    (!querySource || localSource.source.revision >= querySource.revision)
      ? localSource.source
      : querySource);
  const renderQuery = useActionQuery(
    "get-slide-render",
    {
      deckId: id ?? "",
      slideId: source?.id ?? "",
      expectedRevision: source?.revision,
      expectedSourceHash: source?.sourceHash,
    },
    {
      enabled: Boolean(
        id && source?.id && source.revision && source.sourceHash,
      ),
    },
  );
  const updateSource = useActionMutation("update-slide-source");
  const currentIndex = activeIndex;

  const readLatestSource = useCallback(
    async (slideId: string) => {
      const result = await sourceQuery.refetch();
      if (result.isError) throw result.error;
      const latest = result.data?.slide;
      if (!latest || latest.id !== slideId) {
        throw Object.assign(
          new Error(
            "Slide source readback did not include the requested slide.",
          ),
          { errorCode: "slide_source_missing" },
        );
      }
      return latest;
    },
    [sourceQuery],
  );

  const refreshSourceAfterConflict = useCallback(
    async (error: unknown, current: SlideSource) => {
      if (getEditorActionErrorCode(error) !== "slide_source_conflict") return;
      setSourceConflictSnapshot({ slideId: current.id, source: current });
      try {
        await readLatestSource(current.id);
      } catch (refreshError) {
        console.error(
          "Could not read the current slide source after a revision conflict.",
          refreshError,
        );
      }
    },
    [readLatestSource],
  );

  const handleReloadSource = useCallback(async () => {
    if (!activeSlide?.id) {
      throw Object.assign(new Error("No active slide source is available."), {
        errorCode: "slide_source_missing",
      });
    }
    const latest = await readLatestSource(activeSlide.id);
    setLocalSource({ slideId: latest.id, source: latest });
    setSourceConflictSnapshot((current) =>
      current?.slideId === latest.id ? null : current,
    );
    return latest;
  }, [activeSlide?.id, readLatestSource]);

  useEffect(() => {
    if (!slides.length) return;
    if (parsedSlide !== currentIndex + 1 || searchParams.has("slide")) {
      const next = new URLSearchParams(searchParams);
      next.delete("slide");
      next.set("p", String(currentIndex + 1));
      setSearchParams(next, { replace: true });
    }
  }, [currentIndex, parsedSlide, searchParams, setSearchParams, slides.length]);

  useEffect(() => {
    if (!id) return;
    const navigation = {
      app: "slides-2",
      view: "editor",
      deckId: id,
      slideId: activeSlide?.id ?? null,
      slideIndex: currentIndex,
      slideNumber: currentIndex + 1,
      editorMode,
      path: `/deck/${id}?p=${currentIndex + 1}`,
    };
    writeState(appStateKeyForBrowserTab("navigation", TAB_ID), navigation);
    writeState("navigation", navigation);
  }, [activeSlide?.id, currentIndex, editorMode, id]);

  const handleSelectionChange = useCallback(
    (
      selected: ElementSnapshot[],
      textRange: SlideTextRangeSelection | null,
    ) => {
      if (!id) return;
      const selectionArtifact =
        renderQuery.data?.deckId === id &&
        renderQuery.data.slideId === activeSlide?.id &&
        renderQuery.data.revision === source?.revision &&
        renderQuery.data.sourceHash === source?.sourceHash
          ? renderQuery.data
          : null;
      const selectedTextRange =
        selectionArtifact && selected.length === 1
          ? currentSlideTextRangeSelection(
              textRange,
              {
                slideId: selectionArtifact.slideId,
                revision: selectionArtifact.revision,
                sourceHash: selectionArtifact.sourceHash,
              },
              {
                line: selected[0]!.line,
                column: selected[0]!.column,
              },
            )
          : null;
      const state = {
        deckId: id,
        slideId: activeSlide?.id ?? null,
        slideIndex: currentIndex,
        slideNumber: currentIndex + 1,
        ...(selectionArtifact
          ? {
              sourceRevision: selectionArtifact.revision,
              sourceHash: selectionArtifact.sourceHash,
            }
          : {}),
        ...(selectedTextRange ? { textRange: selectedTextRange } : {}),
        items: selected.map((node) => ({
          sourceLine: node.line,
          sourceColumn: node.column,
          ...renderedInstanceState(node),
          sourceTag: node.tagName,
          sourceText: node.text.slice(0, 300),
          sourceStyle: node.styles,
        })),
      };
      writeState(appStateKeyForBrowserTab("slides-selection", TAB_ID), state);
    },
    [
      activeSlide?.id,
      currentIndex,
      id,
      renderQuery.data,
      source?.revision,
      source?.sourceHash,
    ],
  );

  const handlePanelChange = useCallback(
    (panel: OpenSlideInspectorPanel | null) => {
      if (!id) return;
      const state = {
        app: "slides-2",
        deckId: id,
        slideId: activeSlide?.id ?? null,
        panel,
      };
      writeState(appStateKeyForBrowserTab("slides-open-panel", TAB_ID), state);
    },
    [activeSlide?.id, id],
  );

  const handleSelectSlide = useCallback(
    (index: number) => {
      const next = new URLSearchParams(searchParams);
      next.delete("slide");
      next.set("p", String(index + 1));
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const refreshSlides = useCallback(async () => {
    const result = await deckQuery.refetch();
    if (result.isError) throw result.error;
    return result.data?.slides ?? [];
  }, [deckQuery.refetch]);

  const handleAddSlide = useCallback(async () => {
    if (!id || !canEdit) return;
    setStructuralError(null);
    const slideId = `slide-${nanoid(8)}`;
    try {
      await patchDeck.mutateAsync({
        deckId: id,
        operations: [
          {
            op: "add-slide",
            slideId,
            ...(slides.length
              ? { afterSlideId: slides[slides.length - 1]?.id }
              : {}),
            fields: {
              sourceTsx: BLANK_SLIDE_SOURCE,
              notes: "",
              layout: "blank",
            },
          },
        ],
      });
      const nextSlides = await refreshSlides();
      const nextIndex = nextSlides.findIndex(
        (candidate: { id: string }) => candidate.id === slideId,
      );
      if (nextIndex < 0) throw new Error(t("presentation.loadFailed"));
      handleSelectSlide(nextIndex);
    } catch (error) {
      setStructuralError(
        t(getEditorActionErrorTranslationKey(error) ?? "settings.saveFailed"),
      );
    }
  }, [canEdit, handleSelectSlide, id, patchDeck, refreshSlides, slides, t]);

  const handleDuplicateSlide = useCallback(
    async (index: number) => {
      const slide = slides[index];
      if (!id || !slide || !canEdit) return;
      setStructuralError(null);
      try {
        const slideId = `slide-${nanoid(8)}`;
        await patchDeck.mutateAsync({
          deckId: id,
          operations: [
            {
              op: "add-slide",
              slideId,
              duplicateSlideId: slide.id,
              afterSlideId: slide.id,
              fields: {},
            },
          ],
        });
        const nextSlides = await refreshSlides();
        const nextIndex = nextSlides.findIndex(
          (candidate: { id: string }) => candidate.id === slideId,
        );
        if (nextIndex < 0) throw new Error(t("presentation.loadFailed"));
        handleSelectSlide(nextIndex);
      } catch (error) {
        setStructuralError(
          t(getEditorActionErrorTranslationKey(error) ?? "settings.saveFailed"),
        );
      }
    },
    [canEdit, handleSelectSlide, id, patchDeck, refreshSlides, slides, t],
  );

  const handleDeleteSlide = useCallback(
    async (index: number) => {
      const slide = slides[index];
      if (!id || !slide || !canEdit || slides.length <= 1) return;
      setStructuralError(null);
      try {
        await patchDeck.mutateAsync({
          deckId: id,
          operations: [{ op: "delete-slide", slideId: slide.id }],
        });
        const nextSlides = await refreshSlides();
        if (!nextSlides.length) throw new Error(t("presentation.loadFailed"));
        handleSelectSlide(Math.min(index, nextSlides.length - 1));
      } catch (error) {
        setStructuralError(
          t(getEditorActionErrorTranslationKey(error) ?? "settings.saveFailed"),
        );
      }
    },
    [canEdit, handleSelectSlide, id, patchDeck, refreshSlides, slides, t],
  );

  const handleMoveSlide = useCallback(
    async (from: number, to: number) => {
      if (
        !id ||
        !canEdit ||
        from < 0 ||
        to < 0 ||
        from >= slides.length ||
        to >= slides.length ||
        from === to
      )
        return;
      setStructuralError(null);
      const reordered = [...slides];
      const [moving] = reordered.splice(from, 1);
      if (!moving) return;
      reordered.splice(to, 0, moving);
      try {
        await patchDeck.mutateAsync({
          deckId: id,
          operations: [
            {
              op: "reorder-slides",
              orderedIds: reordered.map((candidate) => candidate.id),
            },
          ],
        });
        const nextSlides = await refreshSlides();
        const nextIndex = nextSlides.findIndex(
          (candidate: { id: string }) => candidate.id === moving.id,
        );
        if (nextIndex < 0) throw new Error(t("presentation.loadFailed"));
        handleSelectSlide(nextIndex);
      } catch (error) {
        setStructuralError(
          t(getEditorActionErrorTranslationKey(error) ?? "settings.saveFailed"),
        );
      }
    },
    [canEdit, handleSelectSlide, id, patchDeck, refreshSlides, slides, t],
  );

  const handleSave = useCallback(
    async (edits: SourceEdit[]) => {
      if (!id || !source) throw new Error(t("settings.saveFailed"));
      try {
        const result = await updateSource.mutateAsync({
          deckId: id,
          slideId: source.id,
          expectedRevision: source.revision,
          expectedSourceHash: source.sourceHash,
          edits,
        });
        const next = { ...source, ...result };
        setLocalSource({ slideId: source.id, source: next });
        return next;
      } catch (error) {
        await refreshSourceAfterConflict(error, source);
        throw error;
      }
    },
    [id, refreshSourceAfterConflict, source, updateSource],
  );

  const handleRestore = useCallback(
    async (
      sourceTsx: string,
      expected?: Pick<SlideSource, "revision" | "sourceHash">,
    ) => {
      if (!id || !source) throw new Error(t("settings.saveFailed"));
      try {
        const result = await updateSource.mutateAsync({
          deckId: id,
          slideId: source.id,
          expectedRevision: expected?.revision ?? source.revision,
          expectedSourceHash: expected?.sourceHash ?? source.sourceHash,
          sourceTsx,
        });
        const next = { ...source, ...result };
        setLocalSource({ slideId: source.id, source: next });
        return next;
      } catch (error) {
        await refreshSourceAfterConflict(error, source);
        throw error;
      }
    },
    [id, refreshSourceAfterConflict, source, updateSource],
  );

  const handleSaveDesignTokens = useCallback(
    async (tokens: SlideDesignTokens) => {
      if (!id || !tokenSnapshot) throw new Error(t("settings.saveFailed"));
      try {
        const result = await updateTokens.mutateAsync({
          deckId: id,
          expectedUpdatedAt: tokenSnapshot.updatedAt,
          tokens,
        });
        setLocalTokenSnapshot(result);
      } catch (error) {
        throw new Error(
          t(getEditorActionErrorTranslationKey(error) ?? "settings.saveFailed"),
        );
      }
    },
    [id, t, tokenSnapshot, updateTokens],
  );

  const handleSaveNotes = useCallback(
    async (notes: string) => {
      if (!id || !source) throw new Error(t("settings.saveFailed"));
      setStructuralError(null);
      try {
        await patchDeck.mutateAsync({
          deckId: id,
          operations: [
            {
              op: "patch-slide",
              slideId: source.id,
              fields: { notes },
              baseFields: {
                notes:
                  typeof source.notes === "string"
                    ? { present: true, value: source.notes }
                    : { present: false },
              },
            },
          ],
        });
        setLocalSource({
          slideId: source.id,
          source: { ...source, notes },
        });
      } catch (error) {
        setStructuralError(
          t(getEditorActionErrorTranslationKey(error) ?? "settings.saveFailed"),
        );
      }
    },
    [id, patchDeck, source, t],
  );

  if (!id) return <Navigate to="/home" replace />;

  const isLegacy =
    getEditorActionErrorCode(sourceQuery.error) === "slide_source_missing";
  if (isLegacy) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 px-6 text-center">
        <IconAlertTriangle
          className="size-8 text-muted-foreground"
          aria-hidden="true"
        />
        <h1 className="text-base font-medium">
          {t("openSlideEditor.legacyTitle")}
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          {t("openSlideEditor.legacyDescription")}
        </p>
        <Button asChild variant="outline">
          <Link to="/home">
            <IconArrowLeft className="me-2 size-4" />
            {t("editorToolbar.backToDecks")}
          </Link>
        </Button>
      </div>
    );
  }

  if (
    deckQuery.isLoading ||
    (slides.length > 0 && sourceQuery.isLoading) ||
    tokenQuery.isLoading
  ) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="ms-auto h-8 w-24" />
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="w-[264px] shrink-0 space-y-3 border-e border-border p-3">
            {[0, 1, 2].map((item) => (
              <Skeleton key={item} className="aspect-video w-full rounded-md" />
            ))}
          </div>
          <div className="grid min-w-0 flex-1 place-items-center bg-muted/40 p-6">
            <Skeleton className="aspect-video w-full max-w-5xl rounded-md" />
          </div>
          <Skeleton className="hidden h-full w-[288px] shrink-0 lg:block" />
        </div>
      </div>
    );
  }

  const deckError = deckQuery.isError
    ? t(
        getEditorActionErrorTranslationKey(deckQuery.error) ??
          "presentation.loadFailed",
      )
    : undefined;
  const sourceError = sourceQuery.isError
    ? conflictedSource
      ? undefined
      : t(
          getEditorActionErrorTranslationKey(sourceQuery.error) ??
            "presentation.loadFailed",
        )
    : undefined;
  const renderError = renderQuery.isError
    ? t(
        getEditorActionErrorTranslationKey(renderQuery.error) ??
          "presentation.loadFailed",
      )
    : undefined;
  const loadingError = deckError ?? sourceError ?? renderError;
  if (
    deckQuery.isError ||
    (activeSlide && sourceQuery.isError && !isLegacy && !conflictedSource)
  ) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 px-6 text-center">
        <IconAlertTriangle
          className="size-8 text-muted-foreground"
          aria-hidden="true"
        />
        <p className="max-w-md text-sm text-muted-foreground">
          {loadingError ?? t("presentation.loadFailed")}
        </p>
        <Button asChild variant="outline">
          <Link to="/home">
            <IconArrowLeft className="me-2 size-4" />
            {t("editorToolbar.backToDecks")}
          </Link>
        </Button>
      </div>
    );
  }

  if (!activeSlide || !source) {
    if (showEmptyGenerationPending) {
      return (
        <div className="relative flex h-full min-h-0 items-center justify-center px-6 text-center">
          <div
            className="flex w-full max-w-2xl flex-col items-center gap-5"
            role="status"
          >
            <Skeleton className="aspect-video w-full rounded-md" />
            <p className="text-sm text-muted-foreground">
              {t("editorSidebar.generatingSlide")}
            </p>
          </div>
          {questionFlowOverlay}
        </div>
      );
    }

    if (currentSettledGeneration && generationOutcomeCopy) {
      return (
        <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="max-w-md text-sm text-muted-foreground" role="alert">
            {generationOutcomeCopy}
          </p>
          {generationPrompt ? (
            <div className="w-full max-w-md text-left">
              <p className="text-xs font-medium text-muted-foreground">
                {t("deckEditor.originalPrompt")}
              </p>
              <p className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
                {generationPrompt}
              </p>
            </div>
          ) : null}
          <Button asChild variant="outline">
            <Link to="/home" state={retryState}>
              <IconArrowLeft className="me-2 size-4" />
              {t("deckEditor.tryAgain")}
            </Link>
          </Button>
        </div>
      );
    }

    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-muted-foreground">
          {t("presentation.noSlides")}
        </p>
        <Button asChild variant="outline">
          <Link to="/home">
            <IconArrowLeft className="me-2 size-4" />
            {t("editorToolbar.backToDecks")}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {generationOutcomeCopy ? (
        <div
          className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 py-2"
          role="alert"
        >
          <p className="min-w-0 text-sm text-muted-foreground">
            {generationOutcomeCopy}
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to="/home" state={retryState}>
              {t("deckEditor.tryAgain")}
            </Link>
          </Button>
        </div>
      ) : isNewDeckGenerationRoute && generationActive ? (
        <div
          className="shrink-0 border-b border-border bg-background px-4 py-2 text-sm text-muted-foreground"
          role="status"
        >
          {t("editorSidebar.generatingSlide")}
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <OpenSlideEditor
          key={activeSlide?.id ?? "empty"}
          deckId={id}
          title={
            deck?.title ?? sourceQuery.data?.deck.title ?? t("navigation.brand")
          }
          slides={slides}
          activeIndex={currentIndex}
          source={source}
          notes={source.notes ?? ""}
          artifact={renderQuery.data ?? null}
          designTokens={tokenSnapshot?.tokens ?? null}
          savingDesignTokens={updateTokens.isPending}
          savingNotes={patchDeck.isPending}
          loading={renderQuery.isLoading || sourceQuery.isLoading}
          loadingError={loadingError}
          saving={updateSource.isPending}
          sourceConflict={Boolean(conflictedSource)}
          structuralSaving={patchDeck.isPending}
          structuralError={structuralError}
          canEdit={canEdit}
          canComment={canComment}
          backHref="/home"
          presentHref={`/deck/${id}/present?slide=${currentIndex + 1}`}
          aspectRatio={readAspectRatio(deck?.aspectRatio)}
          editorMode={editorMode}
          onSelectSlide={handleSelectSlide}
          onPresent={(mode = "fullscreen") => {
            const params = new URLSearchParams({
              slide: String(currentIndex + 1),
            });
            if (mode === "windowed") params.set("windowed", "1");
            navigate(`/deck/${encodeURIComponent(id)}/present?${params}`);
          }}
          onOpenPresenter={() => {
            const url = `/deck/${encodeURIComponent(id)}/present?view=presenter&slide=${currentIndex + 1}`;
            const presenterWindow = window.open(
              url,
              `slides-2-presenter-${id}`,
              "popup,width=1280,height=800",
            );
            presenterWindow?.focus();
          }}
          onSave={handleSave}
          onRestore={handleRestore}
          onReloadSource={handleReloadSource}
          onSaveDesignTokens={handleSaveDesignTokens}
          onSaveNotes={handleSaveNotes}
          onSelectionChange={handleSelectionChange}
          onPanelChange={handlePanelChange}
          onEditorModeChange={setEditorMode}
          onAddSlide={handleAddSlide}
          onDuplicateSlide={handleDuplicateSlide}
          onDeleteSlide={handleDeleteSlide}
          onMoveSlide={handleMoveSlide}
        />
      </div>
      {questionFlowOverlay}
    </div>
  );
}
