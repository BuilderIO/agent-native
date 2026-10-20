import { writeClientAppState } from "@agent-native/core/client/application-state";
import {
  actionErrorMessage,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { appStateKeyForBrowserTab } from "@shared/app-state-tabs";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";

import {
  clampPresenterIndex,
  useSlides2PresenterChannel,
  type Slides2PresenterMessage,
  type Slides2PresenterState,
  type PresenterBlackout,
} from "@/components/slides-2-presenter/presenter-channel";
import Slides2Player, {
  type Slides2PresenterLabels,
} from "@/components/slides-2-presenter/Slides2Player";
import type { SlideRenderArtifact } from "@/components/slides-2-runtime/protocol";
import {
  renderSlideArtifactInSandbox,
  SandboxedSlide,
  type SlideFrameController,
  type SandboxedSlideRenderResult,
} from "@/components/slides-2-runtime/SandboxedSlide";
import { Slides2Canvas } from "@/components/slides-2-runtime/Slides2Canvas";
import {
  buildSlideTransitionSrcDoc,
  isSlideTransitionFrameMessage,
} from "@/components/slides-2-runtime/transition-frame";
import { TAB_ID } from "@/lib/tab-id";
import Slides2PresenterConsolePage from "@/pages/Slides2PresenterConsolePage";

type PendingSlideBoundary = {
  sequence: number;
  outgoing: SlideRenderArtifact;
  outgoingSnapshot: Promise<SandboxedSlideRenderResult>;
  direction: "forward" | "backward";
  entryDirection: PresenterEntryDirection;
};

type TransitionFrame = {
  srcDoc: string;
  nonce: string;
  slideId: string;
  slideKey: string;
  completed: boolean;
};

type PresenterStepState = {
  slideId: string | null;
  artifactKey: string | null;
  stepCount: number | null;
  revealedSteps: number;
  initialRevealedSteps: number | null;
};

type PresenterEntryDirection = "forward" | "backward" | "jump";

type PendingPresenterStepEntry = {
  slideId: string;
  direction: PresenterEntryDirection;
};

type LiveStepController = {
  artifactKey: string;
  slideId: string;
  controller: SlideFrameController;
};

type AppliedStepCommand = {
  artifactKey: string;
  revealedSteps: number;
};

function slideArtifactKey(artifact: SlideRenderArtifact): string {
  return `${artifact.deckId}:${artifact.slideId}:${artifact.revision}:${artifact.sourceHash}`;
}

function writeState(key: string, value: unknown) {
  void writeClientAppState(key, value, {
    keepalive: true,
    requestSource: TAB_ID,
  }).catch((error) =>
    console.error(`Could not update application state "${key}".`, error),
  );
}

function OverviewSlide({
  deckId,
  slideId,
  slideNumber,
}: {
  deckId: string;
  slideId: string;
  slideNumber: number;
}) {
  const t = useT();
  const render = useActionQuery("get-slide-render", { deckId, slideId });
  if (!render.data) {
    return <div className="aspect-video w-full rounded-md bg-muted" />;
  }
  return (
    <Slides2Canvas scale={0.1} flat>
      <SandboxedSlide
        artifact={render.data as SlideRenderArtifact}
        title={t("slides2Presenter.slideLabel", { index: slideNumber })}
        onNodes={() => {}}
        onPointer={() => {}}
      />
    </Slides2Canvas>
  );
}

export default function Slides2PresenterPage() {
  const [searchParams] = useSearchParams();
  return searchParams.get("view") === "presenter" ? (
    <Slides2PresenterConsolePage />
  ) : (
    <Slides2ProjectionPage />
  );
}

function Slides2ProjectionPage() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [blackout, setBlackout] = useState<PresenterBlackout>(null);
  const deckQuery = useActionQuery(
    "get-deck",
    { id: id ?? "", compact: "true" },
    { enabled: Boolean(id) },
  );
  const deck = deckQuery.data;
  const slides = deck?.slides ?? [];
  const parsedSlide = Number.parseInt(searchParams.get("slide") ?? "1", 10);
  const index = Math.max(
    0,
    Math.min(
      slides.length - 1,
      Number.isFinite(parsedSlide) ? parsedSlide - 1 : 0,
    ),
  );
  const active = slides[index];
  const [stepState, setStepState] = useState<PresenterStepState>({
    slideId: active?.id ?? null,
    artifactKey: null,
    stepCount: null,
    revealedSteps: 0,
    initialRevealedSteps: null,
  });
  const stepStateRef = useRef(stepState);
  stepStateRef.current = stepState;
  const pendingStepEntryRef = useRef<PendingPresenterStepEntry | null>(
    active?.id ? { slideId: active.id, direction: "jump" } : null,
  );
  const [liveFrameController, setLiveFrameController] =
    useState<LiveStepController | null>(null);
  const liveFrameControllerRef = useRef<LiveStepController | null>(null);
  const lastStepCommandRef = useRef<AppliedStepCommand | null>(null);
  const commitStepState = useCallback((next: PresenterStepState) => {
    const current = stepStateRef.current;
    if (
      current.slideId === next.slideId &&
      current.artifactKey === next.artifactKey &&
      current.stepCount === next.stepCount &&
      current.revealedSteps === next.revealedSteps &&
      current.initialRevealedSteps === next.initialRevealedSteps
    ) {
      return;
    }
    stepStateRef.current = next;
    setStepState(next);
  }, []);
  const sendRevealedSteps = useCallback(
    (artifactKey: string, state: PresenterStepState) => {
      const frame = liveFrameControllerRef.current;
      if (
        state.stepCount === null ||
        state.artifactKey !== artifactKey ||
        !frame ||
        frame.artifactKey !== artifactKey ||
        frame.slideId !== state.slideId
      ) {
        return;
      }
      const last = lastStepCommandRef.current;
      if (
        last?.artifactKey === artifactKey &&
        last.revealedSteps === state.revealedSteps
      ) {
        return;
      }
      if (
        (!last || last.artifactKey !== artifactKey) &&
        state.revealedSteps === state.stepCount
      ) {
        return;
      }
      frame.controller.send({
        type: "set-revealed-steps",
        revealedSteps: state.revealedSteps,
      });
      lastStepCommandRef.current = {
        artifactKey,
        revealedSteps: state.revealedSteps,
      };
    },
    [],
  );

  useEffect(() => {
    if (!active?.id || stepStateRef.current.slideId === active.id) return;
    const pendingEntry = pendingStepEntryRef.current;
    const pending =
      pendingEntry && pendingEntry.slideId === active.id
        ? pendingEntry
        : { slideId: active.id, direction: "jump" as const };
    pendingStepEntryRef.current = pending;
    const next: PresenterStepState = {
      slideId: active.id,
      artifactKey: null,
      stepCount: null,
      revealedSteps: 0,
      initialRevealedSteps: pending.direction === "forward" ? 0 : null,
    };
    commitStepState(next);
  }, [active?.id, commitStepState]);

  const sourceQuery = useActionQuery(
    "get-slide-source",
    { deckId: id ?? "", slideId: active?.id ?? "" },
    { enabled: Boolean(id && active?.id) },
  );
  const source = sourceQuery.data?.slide;
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
  const artifact = renderQuery.data as SlideRenderArtifact | undefined;
  const [pendingBoundary, setPendingBoundary] =
    useState<PendingSlideBoundary | null>(null);
  const pendingBoundaryRef = useRef<PendingSlideBoundary | null>(null);
  const transitionSequenceRef = useRef(0);
  const transitionSnapshotsRef = useRef(
    new Map<string, Promise<SandboxedSlideRenderResult>>(),
  );
  const [transitionFrame, setTransitionFrame] =
    useState<TransitionFrame | null>(null);
  const transitionFrameRef = useRef<TransitionFrame | null>(null);
  transitionFrameRef.current = transitionFrame;
  const transitionIframeRef = useRef<HTMLIFrameElement | null>(null);
  const [liveSlideReadyKey, setLiveSlideReadyKey] = useState<string | null>(
    null,
  );
  const [runtimeRenderError, setRuntimeRenderError] = useState<{
    artifactKey: string;
    message: string;
  } | null>(null);

  const renderSnapshot = useCallback(
    (
      slideArtifact: SlideRenderArtifact,
      initialRevealedSteps: number | null = null,
    ) => {
      const key = `${slideArtifactKey(slideArtifact)}:${initialRevealedSteps ?? "all"}`;
      const cached = transitionSnapshotsRef.current.get(key);
      if (cached) return cached;
      const rendering = renderSlideArtifactInSandbox(
        slideArtifact,
        window.location.origin,
        initialRevealedSteps,
      );
      const pending = rendering.catch((error) => {
        if (transitionSnapshotsRef.current.get(key) === pending) {
          transitionSnapshotsRef.current.delete(key);
        }
        throw error;
      });
      transitionSnapshotsRef.current.set(key, pending);
      return pending;
    },
    [],
  );

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      const frame = transitionFrameRef.current;
      if (
        !frame ||
        event.source !== transitionIframeRef.current?.contentWindow ||
        event.origin !== "null" ||
        !isSlideTransitionFrameMessage(event.data, frame.nonce, frame.slideId)
      ) {
        return;
      }
      if (event.data.type === "transition-error") {
        transitionSequenceRef.current += 1;
        pendingBoundaryRef.current = null;
        setPendingBoundary(null);
        setTransitionFrame(null);
        transitionSnapshotsRef.current.clear();
        return;
      }
      setTransitionFrame((current) =>
        current?.nonce === frame.nonce
          ? { ...current, completed: true }
          : current,
      );
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    if (!id) return;
    const navigation = {
      app: "slides-2",
      view: "present",
      deckId: id,
      slideId: active?.id ?? null,
      slideIndex: index,
      slideNumber: index + 1,
      path: `/deck/${id}/present?slide=${index + 1}`,
    };
    writeState(appStateKeyForBrowserTab("navigation", TAB_ID), navigation);
    writeState("navigation", navigation);
    const selection = {
      deckId: id,
      slideId: active?.id ?? null,
      slideIndex: index,
      slideNumber: index + 1,
      items: [],
    };
    writeState(appStateKeyForBrowserTab("slides-selection", TAB_ID), selection);
  }, [active?.id, id, index]);

  useEffect(() => {
    if (!slides.length) return;
    if (parsedSlide !== index + 1) {
      const next = new URLSearchParams(searchParams);
      next.set("slide", String(index + 1));
      setSearchParams(next, { replace: true });
    }
  }, [index, parsedSlide, searchParams, setSearchParams, slides.length]);

  const onIndexChange = useCallback(
    (nextIndex: number) => {
      const destination = slides[nextIndex];
      const outgoingStepState = stepStateRef.current;
      if (nextIndex !== index && destination) {
        const direction: PresenterEntryDirection =
          nextIndex === index + 1
            ? "forward"
            : nextIndex === index - 1
              ? "backward"
              : "jump";
        pendingStepEntryRef.current = { slideId: destination.id, direction };
        commitStepState({
          slideId: destination.id,
          artifactKey: null,
          stepCount: null,
          revealedSteps: 0,
          initialRevealedSteps: direction === "forward" ? 0 : null,
        });
      }
      const sequence = ++transitionSequenceRef.current;
      setTransitionFrame(null);
      pendingBoundaryRef.current = null;
      setPendingBoundary(null);
      if (
        nextIndex !== index &&
        destination &&
        active &&
        artifact &&
        artifact.slideId === active.id
      ) {
        const pending: PendingSlideBoundary = {
          sequence,
          outgoing: artifact,
          outgoingSnapshot: renderSnapshot(
            artifact,
            outgoingStepState.slideId === active.id &&
              outgoingStepState.artifactKey === slideArtifactKey(artifact)
              ? outgoingStepState.stepCount !== null
                ? outgoingStepState.revealedSteps
                : outgoingStepState.initialRevealedSteps
              : null,
          ),
          direction: nextIndex > index ? "forward" : "backward",
          entryDirection:
            nextIndex === index + 1
              ? "forward"
              : nextIndex === index - 1
                ? "backward"
                : "jump",
        };
        pendingBoundaryRef.current = pending;
        setPendingBoundary(pending);
      }
      const next = new URLSearchParams(searchParams);
      next.set("slide", String(nextIndex + 1));
      setSearchParams(next, { replace: true });
    },
    [
      active,
      artifact,
      index,
      renderSnapshot,
      searchParams,
      setSearchParams,
      slides,
      commitStepState,
    ],
  );

  const goNext = useCallback(() => {
    const current = stepStateRef.current;
    const hasActiveStepState = Boolean(
      active?.id &&
      artifact &&
      current.slideId === active.id &&
      current.artifactKey === slideArtifactKey(artifact) &&
      current.stepCount !== null,
    );
    if (
      hasActiveStepState &&
      current.stepCount !== null &&
      current.revealedSteps < current.stepCount
    ) {
      const next = { ...current, revealedSteps: current.revealedSteps + 1 };
      commitStepState(next);
      return;
    }
    if (index < slides.length - 1) onIndexChange(index + 1);
  }, [
    active?.id,
    artifact,
    commitStepState,
    index,
    onIndexChange,
    slides.length,
  ]);

  const goPrevious = useCallback(() => {
    const current = stepStateRef.current;
    const hasActiveStepState = Boolean(
      active?.id &&
      artifact &&
      current.slideId === active.id &&
      current.artifactKey === slideArtifactKey(artifact) &&
      current.stepCount !== null,
    );
    if (hasActiveStepState && current.revealedSteps > 0) {
      const previous = { ...current, revealedSteps: current.revealedSteps - 1 };
      commitStepState(previous);
      return;
    }
    if (index > 0) onIndexChange(index - 1);
  }, [active?.id, artifact, commitStepState, index, onIndexChange]);

  useEffect(() => {
    const pending = pendingBoundaryRef.current;
    if (
      !pending ||
      pending.sequence !== transitionSequenceRef.current ||
      !artifact ||
      artifact.slideId !== active?.id ||
      artifact.slideId === pending.outgoing.slideId
    ) {
      return;
    }
    const transition = artifact.runtime?.transition;
    if (!transition) {
      pendingBoundaryRef.current = null;
      setPendingBoundary(null);
      transitionSnapshotsRef.current.clear();
      return;
    }

    let cancelled = false;
    const incomingArtifact = artifact;
    void Promise.all([
      pending.outgoingSnapshot,
      renderSnapshot(
        incomingArtifact,
        pending.entryDirection === "forward" ? 0 : null,
      ),
    ])
      .then(([outgoing, incoming]) => {
        if (
          cancelled ||
          pendingBoundaryRef.current?.sequence !== pending.sequence ||
          transitionSequenceRef.current !== pending.sequence
        ) {
          return;
        }
        const frame = buildSlideTransitionSrcDoc({
          outgoing,
          incoming,
          transition,
          direction: pending.direction,
        });
        const slideKey = slideArtifactKey(incomingArtifact);
        transitionSnapshotsRef.current.clear();
        transitionSnapshotsRef.current.set(
          `${slideKey}:${pending.entryDirection === "forward" ? 0 : "all"}`,
          Promise.resolve(incoming),
        );
        setTransitionFrame({
          ...frame,
          slideId: incomingArtifact.slideId,
          slideKey,
          completed: false,
        });
      })
      .catch(() => {
        if (pendingBoundaryRef.current?.sequence !== pending.sequence) return;
        transitionSequenceRef.current += 1;
        pendingBoundaryRef.current = null;
        setPendingBoundary(null);
        setTransitionFrame(null);
        transitionSnapshotsRef.current.clear();
      });
    return () => {
      cancelled = true;
    };
  }, [active?.id, artifact, pendingBoundary?.sequence, renderSnapshot]);

  const displayedArtifact =
    pendingBoundary && !transitionFrame ? pendingBoundary.outgoing : artifact;
  const liveSlideKey = displayedArtifact
    ? slideArtifactKey(displayedArtifact)
    : null;
  const liveSlideId = displayedArtifact?.slideId ?? null;
  const liveRenderError =
    runtimeRenderError?.artifactKey === liveSlideKey
      ? runtimeRenderError.message
      : null;
  const onLiveRenderError = useCallback(
    (message: string) => {
      if (liveSlideKey) {
        setRuntimeRenderError({ artifactKey: liveSlideKey, message });
      }
    },
    [liveSlideKey],
  );
  const onLiveControllerChange = useCallback(
    (controller: SlideFrameController | null) => {
      if (!liveSlideKey || !liveSlideId) return;
      if (!controller) {
        if (liveFrameControllerRef.current?.artifactKey === liveSlideKey) {
          liveFrameControllerRef.current = null;
          setLiveFrameController(null);
        }
        return;
      }
      const frame = {
        artifactKey: liveSlideKey,
        slideId: liveSlideId,
        controller,
      };
      liveFrameControllerRef.current = frame;
      lastStepCommandRef.current = null;
      const current = stepStateRef.current;
      if (
        current.slideId === liveSlideId &&
        current.artifactKey !== liveSlideKey
      ) {
        if (pendingStepEntryRef.current?.slideId !== liveSlideId) {
          pendingStepEntryRef.current = {
            slideId: liveSlideId,
            direction: "jump",
          };
        }
        commitStepState({
          slideId: liveSlideId,
          artifactKey: liveSlideKey,
          stepCount: null,
          revealedSteps: 0,
          initialRevealedSteps:
            pendingStepEntryRef.current?.direction === "forward" ? 0 : null,
        });
      }
      setLiveFrameController(frame);
    },
    [commitStepState, liveSlideId, liveSlideKey],
  );
  const onLiveStepCount = useCallback(
    (stepCount: number) => {
      if (!liveSlideId || !liveSlideKey || liveSlideId !== active?.id) return;
      const current = stepStateRef.current;
      const pending =
        pendingStepEntryRef.current?.slideId === liveSlideId
          ? pendingStepEntryRef.current
          : null;
      const direction =
        pending?.direction ??
        (current.slideId === liveSlideId && current.artifactKey === liveSlideKey
          ? null
          : "jump");
      const revealedSteps =
        direction === "forward"
          ? 0
          : direction
            ? stepCount
            : Math.min(current.revealedSteps, stepCount);
      if (pending) pendingStepEntryRef.current = null;
      const next: PresenterStepState = {
        slideId: liveSlideId,
        artifactKey: liveSlideKey,
        stepCount,
        revealedSteps,
        initialRevealedSteps:
          direction === "forward"
            ? 0
            : current.slideId === liveSlideId &&
                current.artifactKey === liveSlideKey
              ? current.initialRevealedSteps
              : null,
      };
      commitStepState(next);
      if (pending?.direction === "forward") {
        lastStepCommandRef.current = {
          artifactKey: liveSlideKey,
          revealedSteps: 0,
        };
      }
      if (liveSlideKey) sendRevealedSteps(liveSlideKey, next);
    },
    [active?.id, commitStepState, liveSlideId, liveSlideKey, sendRevealedSteps],
  );
  const onLiveSlideReady = useCallback(() => {
    if (liveSlideKey) setLiveSlideReadyKey(liveSlideKey);
  }, [liveSlideKey]);

  const pendingStepEntry = pendingStepEntryRef.current;
  const initialRevealedSteps =
    liveSlideId === active?.id &&
    stepState.slideId === liveSlideId &&
    stepState.artifactKey === liveSlideKey
      ? stepState.initialRevealedSteps
      : liveSlideId === active?.id &&
          pendingStepEntry !== null &&
          pendingStepEntry.slideId === liveSlideId &&
          pendingStepEntry.direction === "forward"
        ? 0
        : null;
  const activeArtifactKey =
    active?.id && artifact && artifact.slideId === active.id
      ? slideArtifactKey(artifact)
      : null;
  const stepStateMatchesArtifact = Boolean(
    activeArtifactKey &&
    stepState.slideId === active?.id &&
    stepState.artifactKey === activeArtifactKey,
  );
  const canPrevious =
    index > 0 ||
    (stepStateMatchesArtifact &&
      stepState.stepCount !== null &&
      stepState.revealedSteps > 0);
  const canNext =
    index < slides.length - 1 ||
    (stepStateMatchesArtifact &&
      stepState.stepCount !== null &&
      stepState.revealedSteps < stepState.stepCount);

  useEffect(() => {
    if (
      !liveFrameController ||
      liveSlideReadyKey !== liveFrameController.artifactKey ||
      liveFrameController.slideId !== stepState.slideId ||
      liveFrameController.artifactKey !== stepState.artifactKey
    ) {
      return;
    }
    sendRevealedSteps(liveFrameController.artifactKey, stepState);
  }, [liveFrameController, liveSlideReadyKey, sendRevealedSteps, stepState]);

  useEffect(() => {
    setLiveSlideReadyKey(null);
  }, [liveSlideKey]);

  useEffect(() => {
    if (
      !transitionFrame?.completed ||
      liveSlideReadyKey !== transitionFrame.slideKey
    ) {
      return;
    }
    setTransitionFrame(null);
    setPendingBoundary(null);
    pendingBoundaryRef.current = null;
  }, [liveSlideReadyKey, transitionFrame]);

  const presentationStateRef = useRef<Slides2PresenterState>({
    index,
    total: slides.length,
    blackout,
    startedAt: Date.now(),
  });
  presentationStateRef.current = {
    ...presentationStateRef.current,
    index,
    total: slides.length,
    blackout,
    stepIndex:
      stepStateMatchesArtifact && stepState.stepCount !== null
        ? stepState.revealedSteps
        : undefined,
    stepCount:
      stepStateMatchesArtifact && stepState.stepCount !== null
        ? stepState.stepCount
        : undefined,
  };
  const channelSendRef = useRef<(message: Slides2PresenterMessage) => boolean>(
    () => false,
  );
  const onPresenterMessage = useCallback(
    (message: Slides2PresenterMessage) => {
      switch (message.type) {
        case "request-state":
          channelSendRef.current({
            type: "state",
            state: presentationStateRef.current,
          });
          break;
        case "goto":
          onIndexChange(clampPresenterIndex(message.index, slides.length));
          break;
        case "switch-deck":
          if (message.deckId !== id) {
            navigate(`/deck/${encodeURIComponent(message.deckId)}/present`, {
              replace: true,
            });
          }
          break;
        case "next":
          goNext();
          break;
        case "prev":
          goPrevious();
          break;
        case "toggle-blackout":
          setBlackout((current) =>
            current === message.mode ? null : message.mode,
          );
          break;
        case "state":
          break;
      }
    },
    [goNext, goPrevious, id, navigate, onIndexChange, slides.length],
  );
  const presenterChannel = useSlides2PresenterChannel(
    id ?? "",
    onPresenterMessage,
  );
  channelSendRef.current = presenterChannel.send;

  const onPresentationStateChange = useCallback(
    (state: Slides2PresenterState) => {
      const nextState = {
        ...state,
        stepIndex: presentationStateRef.current.stepIndex,
        stepCount: presentationStateRef.current.stepCount,
      };
      presentationStateRef.current = nextState;
      presenterChannel.send({ type: "state", state: nextState });
    },
    [presenterChannel.send],
  );
  useEffect(() => {
    presenterChannel.send({
      type: "state",
      state: presentationStateRef.current,
    });
  }, [presenterChannel.send, stepState]);
  const openPresenter = useCallback(() => {
    if (!id) return;
    const url = `/deck/${encodeURIComponent(id)}/present?view=presenter&slide=${index + 1}`;
    const presenterWindow = window.open(
      url,
      `slides-2-presenter-${id}`,
      "popup,width=1280,height=800",
    );
    presenterWindow?.focus();
  }, [id, index]);

  if (!id) return <Navigate to="/" replace />;
  const slideRenderPending = Boolean(
    source && !artifact && renderQuery.isLoading,
  );
  const presenterContentLoading =
    deckQuery.isLoading ||
    (slides.length > 0 && (sourceQuery.isLoading || slideRenderPending));
  if (!deck && deckQuery.isError) {
    return (
      <div
        className={
          /* guard:allow-raw-color — presenter errors stay legible on the fixed black stage. */ "grid h-full place-items-center bg-black px-6 text-center text-sm text-white"
        }
        role="alert"
      >
        {actionErrorMessage(deckQuery.error) ?? t("presentation.loadFailed")}
      </div>
    );
  }
  const sourceMissing = Boolean(
    (sourceQuery.error as { errorCode?: unknown } | null)?.errorCode ===
    "slide_source_missing",
  );
  const loadError = sourceMissing
    ? t("slides2Editor.legacyDescription")
    : (actionErrorMessage(
        renderQuery.error ?? sourceQuery.error ?? deckQuery.error,
      ) ?? null);
  if (!deckQuery.isLoading && slides.length === 0) {
    return (
      <div
        className={
          /* guard:allow-raw-color — no-slide presenter state stays on the fixed black stage. */ "grid h-full place-items-center bg-black px-6 text-center text-sm text-white"
        }
        role="status"
      >
        {t("presentation.noSlides")}
      </div>
    );
  }

  const labels: Slides2PresenterLabels = {
    previous: t("presentation.previousSlide"),
    next: t("presentation.nextSlide"),
    overview: t("slides2Presenter.overview"),
    overviewTitle: t("slides2Presenter.overviewTitle"),
    blackout: t("slides2Presenter.blackout"),
    whiteout: t("slides2Presenter.whiteout"),
    laser: t("slides2Presenter.laser"),
    presenter: t("presentation.presenterView"),
    enterFullscreen: t("presentation.enterFullscreen"),
    exitFullscreen: t("slides2Presenter.exitFullscreen"),
    fullscreenBlocked: t("presentation.clickToEnterFullscreen"),
    help: t("appMenu.help"),
    helpTitle: t("appMenu.help"),
    exit: t("presentation.exitPresentation"),
    close: t("comments.close"),
    elapsedTime: t("slides2Presenter.elapsedTime"),
    jumpHint: t("slides2Presenter.jumpHint"),
    slideLabel: (slideIndex) =>
      t("slides2Presenter.slideLabel", { index: slideIndex }),
    position: (slideIndex, total) =>
      t("slides2Presenter.position", { index: slideIndex, total }),
    shortcutNext: t("presentation.nextSlide"),
    shortcutPrevious: t("presentation.previousSlide"),
    shortcutFirstLast: t("slides2Presenter.shortcutFirstLast"),
    shortcutJump: t("slides2Presenter.shortcutJump"),
    shortcutOverview: t("slides2Presenter.shortcutOverview"),
    shortcutBlackout: t("slides2Presenter.shortcutBlackout"),
    shortcutWhiteout: t("slides2Presenter.shortcutWhiteout"),
    shortcutLaser: t("slides2Presenter.shortcutLaser"),
    shortcutPresenter: t("slides2Presenter.shortcutPresenter"),
    shortcutHelp: t("slides2Presenter.shortcutHelp"),
    shortcutExit: t("slides2Presenter.shortcutExit"),
  };

  return (
    <Slides2Player
      index={index}
      total={slides.length}
      canPrevious={canPrevious}
      canNext={canNext}
      onIndexChange={onIndexChange}
      onPrevious={goPrevious}
      onNext={goNext}
      onExit={() => navigate(`/deck/${id}?slide=${index + 1}`)}
      labels={labels}
      initialFullscreen
      blackout={blackout}
      onBlackoutChange={setBlackout}
      onPresentationStateChange={onPresentationStateChange}
      onPresenter={openPresenter}
      renderOverviewSlide={(slideIndex) => {
        const slide = slides[slideIndex];
        return slide ? (
          <OverviewSlide
            deckId={id}
            slideId={slide.id}
            slideNumber={slide.slideNumber}
          />
        ) : null;
      }}
    >
      {({ onNavigationInput, onFramePointerActivity, onFramePointerMove }) => (
        <>
          <span
            className="sr-only md:hidden"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {labels.position(index + 1, slides.length)}
          </span>
          {displayedArtifact && !liveRenderError ? (
            <Slides2Canvas>
              <div className="relative h-full w-full">
                <SandboxedSlide
                  artifact={displayedArtifact}
                  title={`${deck?.title ?? t("navigation.brand")} · ${t("slides2Presenter.slideLabel", { index: index + 1 })}`}
                  onNodes={() => {}}
                  onPointer={(pointer) => {
                    if (pointer.phase === "move") {
                      onFramePointerMove(
                        { x: pointer.x, y: pointer.y },
                        pointer.pointerType,
                      );
                    }
                  }}
                  onPointerActivity={onFramePointerActivity}
                  onController={onLiveControllerChange}
                  onNavigationInput={onNavigationInput}
                  onReady={onLiveSlideReady}
                  onError={onLiveRenderError}
                  onStepCount={onLiveStepCount}
                  initialRevealedSteps={initialRevealedSteps}
                />
                {transitionFrame ? (
                  <iframe
                    ref={transitionIframeRef}
                    title={labels.slideLabel(index + 1, slides.length)}
                    sandbox="allow-scripts"
                    referrerPolicy="no-referrer"
                    srcDoc={transitionFrame.srcDoc}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 z-10 block h-full w-full border-0"
                  />
                ) : null}
              </div>
            </Slides2Canvas>
          ) : presenterContentLoading ? (
            <div
              className={
                /* guard:allow-raw-color — the presenter loading surface stays black before slide content paints. */ "h-full min-h-0 animate-pulse bg-black"
              }
              aria-hidden="true"
            />
          ) : (
            <div
              className={
                /* guard:allow-raw-color — presenter errors stay legible on the fixed black stage. */ "grid h-full w-full place-items-center bg-black px-6 text-center text-sm text-white"
              }
              role="alert"
            >
              {liveRenderError ?? loadError ?? t("presentation.loadFailed")}
            </div>
          )}
        </>
      )}
    </Slides2Player>
  );
}
