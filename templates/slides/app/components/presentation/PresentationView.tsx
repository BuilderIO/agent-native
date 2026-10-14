import { captureError, trackEvent } from "@agent-native/core/client/analytics";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconChevronLeft,
  IconChevronRight,
  IconFileTypePdf,
  IconLoader2,
  IconMaximize,
  IconNotes,
  IconX,
} from "@tabler/icons-react";
import {
  useState,
  useEffect,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import SlideRenderer from "@/components/deck/SlideRenderer";
import type { Slide } from "@/context/DeckContext";
import { getAspectRatioDims, type AspectRatio } from "@/lib/aspect-ratios";
import { exportDeckAsPdf } from "@/lib/export-pdf-client";
import { isMediaKeyboardEvent } from "@/lib/slide-video";
import { trackSlidesRelay } from "@/lib/slides-relay-tracking";

import type { DesignSystemData } from "../../../shared/api";
import { normalizeSlideTransition } from "../../../shared/slide-transitions";
import { openPresentChannel, type PresentMessage } from "./present-channel";
import {
  annotateBuildSteps,
  findBuildStepElements,
  getBuildSteps,
  hasBuildSteps,
  setBuildState,
  type BuildSteps,
} from "./slide-build-steps";
import {
  boundarySlideIndex,
  boundaryTransition,
  canCommand,
  createSlideNavigation,
  reduceSlideNavigation,
  targetBuildStep,
  type SlideNavigationAction,
  type SlideNavigationLayout,
} from "./slide-navigation";
import {
  prefersReducedMotion,
  resolveSlideTransitionMotion,
} from "./slide-transition-motion";
import { SlideTransitionStage } from "./SlideTransitionStage";

const NO_BUILD_STEPS: BuildSteps = { steps: [], unresolved: [] };

interface PresentationViewProps {
  slides: Slide[];
  deckId: string;
  startIndex?: number;
  aspectRatio?: AspectRatio;
  designSystem?: DesignSystemData;
  pdfExportTitle?: string;
  pdfExportToken?: string;
}

function PdfExportStage({
  slides,
  aspectRatio,
  designSystem,
}: Pick<PresentationViewProps, "slides" | "aspectRatio" | "designSystem">) {
  const dims = getAspectRatioDims(aspectRatio);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed top-0"
      data-pdf-export-stage="true"
      style={{ left: "-10000px", width: dims.width }}
    >
      {slides.map((slide, index) => (
        <div key={slide.id} style={{ width: dims.width, height: dims.height }}>
          <SlideRenderer
            slide={slide}
            slidePosition={{ number: index + 1, count: slides.length }}
            thumbnail={false}
            disableVideoAutoplay
            aspectRatio={aspectRatio}
            designSystem={designSystem}
          />
        </div>
      ))}
    </div>
  );
}

export default function PresentationView({
  slides,
  deckId,
  startIndex = 0,
  aspectRatio,
  designSystem,
  pdfExportTitle,
  pdfExportToken,
}: PresentationViewProps) {
  const t = useT();
  const safeSlides = useMemo(
    () =>
      (Array.isArray(slides) ? slides : [])
        .filter((slide): slide is Slide => Boolean(slide) && !slide.skipped)
        .map((slide, index) => ({
          ...slide,
          id: slide.id || `slide-${index}`,
          content: typeof slide.content === "string" ? slide.content : "",
          notes: slide.notes || "",
          layout: slide.layout || "blank",
        })),
    [slides],
  );
  const initialIndex = useMemo(() => {
    const rawSlides = (Array.isArray(slides) ? slides : []).filter(Boolean);
    if (rawSlides.length === 0) return 0;
    const clampedRaw = Math.max(0, Math.min(startIndex, rawSlides.length - 1));
    for (let i = clampedRaw; i < rawSlides.length; i++) {
      if (!rawSlides[i]?.skipped) {
        return rawSlides.slice(0, i).filter((s) => !s?.skipped).length;
      }
    }
    for (let i = clampedRaw - 1; i >= 0; i--) {
      if (!rawSlides[i]?.skipped) {
        return rawSlides.slice(0, i).filter((s) => !s?.skipped).length;
      }
    }
    return 0;
  }, [slides, startIndex]);
  const clampIndex = useCallback(
    (index: number) => {
      if (safeSlides.length === 0) return 0;
      const safeIndex = Number.isFinite(index) ? index : 0;
      return Math.max(0, Math.min(safeIndex, safeSlides.length - 1));
    },
    [safeSlides.length],
  );

  // Build steps parse the slide HTML with DOMParser, which the server lacks. The
  // server render and the first client render both use no steps, so their markup
  // matches. The flag flips in a layout effect, before the first paint.
  const [buildStepsReady, setBuildStepsReady] = useState(false);
  useLayoutEffect(() => {
    setBuildStepsReady(true);
  }, []);
  const allBuildSteps = useMemo(
    () =>
      safeSlides.map((slide) =>
        buildStepsReady ? getBuildSteps(slide) : NO_BUILD_STEPS,
      ),
    [buildStepsReady, safeSlides],
  );
  // Unresolved reveals stay visible (see getBuildSteps). Each is recorded here.
  useEffect(() => {
    allBuildSteps.forEach((build, index) => {
      for (const issue of build.unresolved) {
        captureError(
          new Error(
            `[slides] reveal ${issue.reason} on slide ${safeSlides[index]?.id ?? "unknown"} (animation ${issue.animationIndex})`,
          ),
          { tags: { area: "slides-animation-issue" } },
        );
      }
    });
  }, [allBuildSteps, safeSlides]);
  const layout = useMemo<SlideNavigationLayout>(
    () => ({
      stepCounts: allBuildSteps.map((build) => build.steps.length),
      transitions: safeSlides.map((slide) =>
        normalizeSlideTransition(slide.transition),
      ),
    }),
    [allBuildSteps, safeSlides],
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Commands never read render-time state: they reduce against navRef, so
  // presses and presenter messages that arrive mid-transition are all kept.
  const [nav, setNav] = useState(() =>
    createSlideNavigation(clampIndex(initialIndex)),
  );
  const navRef = useRef(nav);
  const apply = useCallback((action: SlideNavigationAction) => {
    const next = reduceSlideNavigation(
      navRef.current,
      action,
      layoutRef.current,
    );
    if (next === navRef.current) return;
    navRef.current = next;
    setNav(next);
  }, []);

  const [showControls, setShowControls] = useState(false);
  const [cursorVisible, setCursorVisible] = useState(true);
  const [needsFullscreenGesture, setNeedsFullscreenGesture] = useState(false);
  const [pdfExportRequest, setPdfExportRequest] = useState<{
    deckId: string;
    title: string;
    slides: Slide[];
    aspectRatio?: AspectRatio;
    shareToken?: string;
  } | null>(null);
  const pdfExporting = pdfExportRequest !== null;
  const enteredFullscreenRef = useRef(false);
  const navigate = useNavigate();

  const isShared = deckId.startsWith("__shared__/");

  const trackedDeckRef = useRef<string | null>(null);
  useEffect(() => {
    if (trackedDeckRef.current === deckId) return;
    trackedDeckRef.current = deckId;
    const properties = {
      ...(isShared ? {} : { output_id: deckId }),
      output_type: "deck",
      slide_count: safeSlides.length,
      is_shared: isShared,
    };
    if (isShared) trackEvent("presented", properties);
    else trackSlidesRelay("presented", properties);
  }, [deckId, isShared, safeSlides.length]);

  const visibleRawIndices = useMemo(() => {
    const rawSlides = (Array.isArray(slides) ? slides : []).filter(Boolean);
    const rawIndices: number[] = [];
    rawSlides.forEach((slide, i) => {
      if (!slide?.skipped) rawIndices.push(i);
    });
    return rawIndices;
  }, [slides]);
  const toRawIndex = useCallback(
    (filteredIndex: number) =>
      visibleRawIndices[filteredIndex] ?? filteredIndex,
    [visibleRawIndices],
  );

  const presentationStatsRef = useRef<{
    lastIndex: number;
    slidesAdvanced: number;
    maxSlideIndex: number;
    fullscreen: boolean;
  } | null>(null);
  useEffect(() => {
    if (isShared) return;
    const startedAt = Date.now();
    const stats = {
      lastIndex: navRef.current.displayedIndex,
      slidesAdvanced: 0,
      maxSlideIndex: navRef.current.displayedIndex,
      fullscreen: Boolean(document.fullscreenElement),
    };
    presentationStatsRef.current = stats;
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      if (presentationStatsRef.current === stats) {
        presentationStatsRef.current = null;
      }
      trackSlidesRelay("presentation_ended", {
        output_id: deckId,
        output_type: "deck",
        duration_ms: Math.max(0, Date.now() - startedAt),
        slides_advanced: stats.slidesAdvanced,
        max_slide_index: stats.maxSlideIndex,
        fullscreen: stats.fullscreen,
      });
    };
    const noteFullscreen = () => {
      if (document.fullscreenElement) stats.fullscreen = true;
    };
    // Mobile browsers often kill a backgrounded tab without firing pagehide,
    // so the first hide ends the presentation (once; returning doesn't restart it).
    const endWhenHidden = () => {
      if (document.visibilityState === "hidden") end();
    };
    window.addEventListener("pagehide", end);
    document.addEventListener("visibilitychange", endWhenHidden);
    document.addEventListener("fullscreenchange", noteFullscreen);
    return () => {
      window.removeEventListener("pagehide", end);
      document.removeEventListener("visibilitychange", endWhenHidden);
      document.removeEventListener("fullscreenchange", noteFullscreen);
      end();
    };
  }, [deckId, isShared]);
  useEffect(() => {
    const stats = presentationStatsRef.current;
    const index = nav.displayedIndex;
    if (!stats || stats.lastIndex === index) return;
    if (index > stats.lastIndex) stats.slidesAdvanced += 1;
    stats.lastIndex = index;
    stats.maxSlideIndex = Math.max(stats.maxSlideIndex, index);
  }, [nav.displayedIndex]);
  const visibleRawIndicesRef = useRef(visibleRawIndices);
  visibleRawIndicesRef.current = visibleRawIndices;
  const deckIdRef = useRef(deckId);
  deckIdRef.current = deckId;
  const isSharedRef = useRef(isShared);
  isSharedRef.current = isShared;

  // One atomic effect handles both cases so they can't race each other:
  // - A genuine deep link or deck switch (startIndex/deckId changed) reseeds
  //   from initialIndex. This component is reused across deck navigation
  //   (see the exit-handler refs above), so a new deck at the same `?slide=`
  //   must still reset instead of inheriting the previous deck's position.
  // - Otherwise, a skip toggle or reorder changed safeSlides without a new
  //   deep link. A length-only clamp would silently swap in a different
  //   slide at the same index, so follow the previously-shown slide's id to
  //   its new position, falling back to a raw clamp only when it's gone.
  const prevDeepLinkKeyRef = useRef({ startIndex, deckId });
  const prevSafeSlideIdsRef = useRef<string[]>(safeSlides.map((s) => s.id));
  useEffect(() => {
    const prevKey = prevDeepLinkKeyRef.current;
    const isDeepLinkChange =
      prevKey.startIndex !== startIndex || prevKey.deckId !== deckId;
    prevDeepLinkKeyRef.current = { startIndex, deckId };
    const newIds = safeSlides.map((s) => s.id);
    const prevIds = prevSafeSlideIdsRef.current;
    prevSafeSlideIdsRef.current = newIds;

    if (isDeepLinkChange) {
      // A seeded slide was not reached by a press, so its builds never animate,
      // whatever DOM was shown before. Forgetting that DOM is what guarantees it.
      liveBuildRef.current = null;
      const index = clampIndex(initialIndex);
      apply({ type: "seed", index, targetIndex: index, buildStep: 0 });
      return;
    }

    const followIndex = (oldIndex: number) => {
      const id = prevIds[oldIndex];
      return id ? newIds.indexOf(id) : -1;
    };
    const current = navRef.current;
    const followedIndex = followIndex(current.displayedIndex);
    if (followedIndex < 0) {
      apply({
        type: "seed",
        index: clampIndex(current.displayedIndex),
        targetIndex: clampIndex(current.targetIndex),
        buildStep: 0,
      });
      return;
    }
    const followedTarget = followIndex(current.targetIndex);
    apply({
      type: "seed",
      index: followedIndex,
      targetIndex:
        followedTarget >= 0 ? followedTarget : clampIndex(current.targetIndex),
      buildStep: current.buildStep,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeSlides, startIndex, deckId]);

  const currentSlide = safeSlides[nav.displayedIndex];
  const currentSteps = allBuildSteps[nav.displayedIndex]?.steps;
  // The live slide's HTML is built once per slide. Presses move build state on
  // the mounted DOM (see the layout effect below), so the HTML does not change
  // and the slide is not re-rendered on each press.
  const displaySlide = useMemo(
    () => annotateBuildSteps(currentSlide, currentSteps, 0),
    [currentSlide, currentSteps],
  );
  // The outgoing layer of a transition shows the slide fully built.
  const outgoingSlide = useMemo(
    () =>
      annotateBuildSteps(currentSlide, currentSteps, currentSteps?.length ?? 0),
    [currentSlide, currentSteps],
  );

  const liveSlideRef = useRef<HTMLDivElement>(null);
  const liveBuildRef = useRef<{
    root: Element;
    displayedIndex: number;
    buildStep: number;
  } | null>(null);
  useLayoutEffect(() => {
    const root = liveSlideRef.current;
    if (!root) return;
    const steps = currentSteps ?? [];
    const last = liveBuildRef.current;
    // Same DOM: a press moves build state, so only the step it entered animates.
    // A new DOM for a slide entered forward: its builds start hidden, so any
    // reveal the press produced animates. Backward entry lands fully built.
    const previous =
      last?.root === root
        ? last.buildStep
        : last && nav.displayedIndex > last.displayedIndex
          ? 0
          : null;
    setBuildState(
      findBuildStepElements(root, steps.length),
      steps,
      nav.buildStep,
      previous,
      prefersReducedMotion(),
    );
    liveBuildRef.current = {
      root,
      displayedIndex: nav.displayedIndex,
      buildStep: nav.buildStep,
    };
  }, [currentSteps, nav.buildStep, nav.displayedIndex]);

  const goNext = useCallback(
    () => apply({ type: "command", command: "next" }),
    [apply],
  );
  const goPrev = useCallback(
    () => apply({ type: "command", command: "prev" }),
    [apply],
  );

  const exit = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    if (isShared) {
      const token = deckId.replace("__shared__/", "");
      void navigate(`/share/${token}`);
    } else {
      const target = navRef.current.targetIndex;
      const rawIndex = visibleRawIndicesRef.current[target] ?? target;
      void navigate(`/deck/${deckId}?slide=${rawIndex + 1}`);
    }
  }, [navigate, deckId, isShared]);

  const channelRef = useRef<BroadcastChannel | null>(null);
  const postState = useCallback((index: number, buildStep: number) => {
    channelRef.current?.postMessage({
      type: "state",
      index,
      buildStep,
    } satisfies PresentMessage);
  }, []);

  useEffect(() => {
    const channel = openPresentChannel(deckId);
    channelRef.current = channel;
    if (!channel) return;
    channel.onmessage = (event: MessageEvent<PresentMessage>) => {
      const message = event.data;
      if (message?.type === "hello") {
        postState(
          navRef.current.targetIndex,
          targetBuildStep(navRef.current, layoutRef.current),
        );
      } else if (message?.type === "command") {
        apply({ type: "command", command: message.command });
      }
    };
    // BroadcastChannel has no close event, so the presenter learns the audience
    // left only from this message: on window close (pagehide) and on unmount
    // (exit to the editor, or a deck switch).
    const sayBye = () =>
      channel.postMessage({ type: "bye" } satisfies PresentMessage);
    window.addEventListener("pagehide", sayBye);
    return () => {
      window.removeEventListener("pagehide", sayBye);
      sayBye();
      channel.close();
      channelRef.current = null;
    };
  }, [deckId, apply, postState]);

  // The presenter follows the target, so it updates on every press rather than
  // when each transition lands. A build press changes only the build step.
  useEffect(() => {
    postState(nav.targetIndex, targetBuildStep(nav, layout));
  }, [nav, layout, postState]);

  const openPresenterWindow = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("presenter", "1");
    url.searchParams.set(
      "slide",
      String(toRawIndex(navRef.current.targetIndex) + 1),
    );
    window.open(
      url.toString(),
      `slides-presenter-${deckId}`,
      "width=1200,height=760",
    );
  }, [deckId, toRawIndex]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (isMediaKeyboardEvent(e)) return;
      // A held key auto-repeats keydown with repeat=true. Each one would step
      // again, so one physical press could advance two or more slides.
      if (e.repeat) return;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
        case " ":
          e.preventDefault();
          goNext();
          break;
        case "ArrowLeft":
        case "ArrowUp":
          e.preventDefault();
          goPrev();
          break;
        case "f":
        case "F":
          e.preventDefault();
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
          } else {
            document.exitFullscreen().catch(() => {});
          }
          break;
        case "s":
        case "S":
          e.preventDefault();
          openPresenterWindow();
          break;
        case "Escape":
          exit();
          break;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goNext, goPrev, exit, openPresenterWindow]);

  const enterFullscreen = useCallback(() => {
    const el = document.documentElement;
    if (!el.requestFullscreen || document.fullscreenElement) {
      setNeedsFullscreenGesture(false);
      return;
    }
    el.requestFullscreen()
      .then(() => {
        enteredFullscreenRef.current = true;
        setNeedsFullscreenGesture(false);
      })
      .catch(() => setNeedsFullscreenGesture(true));
  }, []);

  useEffect(() => {
    enterFullscreen();
    const handleFullscreenChange = () => {
      if (enteredFullscreenRef.current && !document.fullscreenElement) {
        enteredFullscreenRef.current = false;
        if (isSharedRef.current) {
          const token = deckIdRef.current.replace("__shared__/", "");
          void navigate(`/share/${token}`);
        } else {
          const target = navRef.current.targetIndex;
          const rawIndex = visibleRawIndicesRef.current[target] ?? target;
          void navigate(`/deck/${deckIdRef.current}?slide=${rawIndex + 1}`);
        }
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.setAttribute("data-presentation-mode", "active");
    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      body.removeAttribute("data-presentation-mode");
    };
  }, []);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const handleMove = () => {
      setShowControls(true);
      setCursorVisible(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        setShowControls(false);
        setCursorVisible(false);
      }, 2500);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("touchstart", handleMove);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("touchstart", handleMove);
      clearTimeout(timeout);
    };
  }, []);

  const handleDownloadPdf = useCallback(() => {
    if (!pdfExportTitle || pdfExporting || safeSlides.length === 0) return;
    setPdfExportRequest({
      deckId,
      title: pdfExportTitle,
      slides: safeSlides,
      aspectRatio,
      shareToken: pdfExportToken,
    });
  }, [
    aspectRatio,
    deckId,
    pdfExportTitle,
    pdfExportToken,
    pdfExporting,
    safeSlides,
  ]);

  useEffect(() => {
    if (!pdfExportRequest) return;
    if (pdfExportRequest.deckId !== deckId) {
      setPdfExportRequest(null);
      return;
    }
    let cancelled = false;
    const abortController = new AbortController();

    const exportPdf = async () => {
      try {
        await exportDeckAsPdf(
          pdfExportRequest.title,
          pdfExportRequest.slides,
          pdfExportRequest.aspectRatio,
          {
            signal: abortController.signal,
            shareToken: pdfExportRequest.shareToken,
            // Owner exports count toward activation; shared viewers stay
            // untracked here because their deck id carries the share token.
            ...(isShared ? {} : { analytics: { deckId } }),
          },
        );
      } catch (error) {
        if (cancelled || abortController.signal.aborted) return;
        console.error("[slides] shared PDF export failed:", error);
        toast.error(t("deckEditor.pdfRenderFailed"));
      } finally {
        if (!cancelled) setPdfExportRequest(null);
      }
    };

    void exportPdf();
    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [deckId, isShared, pdfExportRequest, t]);

  if (!currentSlide) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black text-white">
        <button
          type="button"
          onClick={exit}
          className="rounded-lg bg-white/10 px-4 py-3 text-sm text-white transition-colors hover:bg-white/20"
        >
          {t("presentation.noSlides")}
        </button>
      </div>
    );
  }

  const flight = nav.flight;
  const flightSlide = flight ? safeSlides[flight.to] : undefined;
  // While a flight plays, displayedIndex is still the outgoing slide. The
  // boundary's slide supplies the speed, as it supplies the type.
  const boundarySlide = flight
    ? safeSlides[boundarySlideIndex(nav.displayedIndex, flight.to)]
    : undefined;
  const flightMotion =
    flight && flightSlide && boundarySlide
      ? resolveSlideTransitionMotion(
          boundaryTransition(layout.transitions, nav.displayedIndex, flight.to),
          flight.direction,
          {
            speed: boundarySlide.transitionSpeed,
            reducedMotion: prefersReducedMotion(),
          },
        )
      : null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black overflow-hidden"
      style={{
        height: "100dvh",
        cursor: cursorVisible ? "default" : "none",
      }}
      onClick={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("video, audio")
        ) {
          return;
        }
        if (needsFullscreenGesture) {
          enterFullscreen();
          return;
        }
        goNext();
      }}
    >
      {flight && flightSlide && flightMotion ? (
        <SlideTransitionStage
          key={flight.id}
          outgoing={outgoingSlide}
          incoming={annotateBuildSteps(
            flightSlide,
            allBuildSteps[flight.to]?.steps,
            flight.direction === "backward" ? layout.stepCounts[flight.to] : 0,
          )}
          outgoingPosition={{
            number: nav.displayedIndex + 1,
            count: safeSlides.length,
          }}
          incomingPosition={{ number: flight.to + 1, count: safeSlides.length }}
          motion={flightMotion}
          aspectRatio={aspectRatio}
          designSystem={designSystem}
          onFinished={() =>
            apply({ type: "flightFinished", flightId: flight.id })
          }
        />
      ) : (
        <div
          key={currentSlide.id}
          ref={liveSlideRef}
          className="absolute inset-0 z-20"
          // Before the builds are annotated, a reveal slide would show every
          // reveal in the server HTML. Hold the slide until the flag flips.
          style={
            !buildStepsReady && hasBuildSteps(currentSlide)
              ? { visibility: "hidden" }
              : undefined
          }
        >
          <SlideRenderer
            slide={displaySlide}
            slidePosition={{
              number: nav.displayedIndex + 1,
              count: safeSlides.length,
            }}
            thumbnail={false}
            aspectRatio={aspectRatio}
            designSystem={designSystem}
          />
        </div>
      )}

      {/* Controls overlay */}
      <div
        className={`fixed inset-x-0 bottom-0 z-[101] ${
          showControls ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
        }`}
        style={{ transition: "opacity 0.3s, transform 0.3s" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 bg-gradient-to-t from-black/80 to-transparent">
          <span className="text-sm text-white/50 font-mono">
            {nav.displayedIndex + 1} / {safeSlides.length}
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={goPrev}
              disabled={!canCommand(nav, layout, "prev")}
              className="p-3 sm:p-2 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label={t("presentation.previousSlide")}
            >
              <IconChevronLeft className="w-5 h-5 sm:w-4 sm:h-4 text-white" />
            </button>
            <button
              onClick={goNext}
              disabled={!canCommand(nav, layout, "next")}
              className="p-3 sm:p-2 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label={t("presentation.nextSlide")}
            >
              <IconChevronRight className="w-5 h-5 sm:w-4 sm:h-4 text-white" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            {pdfExportTitle && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handleDownloadPdf();
                }}
                disabled={pdfExporting}
                aria-busy={pdfExporting}
                className={
                  "p-3 sm:p-2 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" // guard:allow-raw-color - fixed black presentation surface
                }
                aria-label={t("editorExport.exportPdf")}
                title={t("editorExport.exportPdf")}
              >
                {pdfExporting ? (
                  <IconLoader2
                    className={
                      "w-5 h-5 sm:w-4 sm:h-4 animate-spin motion-reduce:animate-none text-white" // guard:allow-raw-color - fixed black presentation surface
                    }
                  />
                ) : (
                  <IconFileTypePdf
                    className={
                      "w-5 h-5 sm:w-4 sm:h-4 text-white" // guard:allow-raw-color - fixed black presentation surface
                    }
                  />
                )}
              </button>
            )}
            <button
              onClick={openPresenterWindow}
              className="p-3 sm:p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"
              aria-label={t("presentation.presenterView")}
              title={t("presentation.presenterView")}
            >
              <IconNotes className="w-5 h-5 sm:w-4 sm:h-4 text-white" />
            </button>
            <button
              onClick={exit}
              className="p-3 sm:p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              aria-label={t("presentation.exitPresentation")}
            >
              <IconX className="w-5 h-5 sm:w-4 sm:h-4 text-white" />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-0.5 bg-white/10">
          <div
            className="h-full bg-[#609FF8]"
            style={{
              transform: `scaleX(${(nav.displayedIndex + 1) / safeSlides.length})`,
              transformOrigin: "left",
              transition: "transform 0.3s cubic-bezier(0.2, 0, 0, 1)",
              width: "100%",
            }}
          />
        </div>
      </div>

      {/* Fullscreen-gesture fallback — shown when the browser blocked our
          auto requestFullscreen() because there was no user gesture. */}
      {needsFullscreenGesture && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            enterFullscreen();
          }}
          className="fixed top-4 right-4 z-[102] flex items-center gap-2 rounded-lg bg-white/10 px-4 py-3 text-sm text-white hover:bg-white/20 transition-colors"
          aria-label={t("presentation.enterFullscreen")}
        >
          <IconMaximize className="w-4 h-4" />
          {t("presentation.clickToEnterFullscreen")}
        </button>
      )}

      {pdfExportRequest && (
        <PdfExportStage
          slides={pdfExportRequest.slides}
          aspectRatio={pdfExportRequest.aspectRatio}
          designSystem={designSystem}
        />
      )}
    </div>
  );
}
