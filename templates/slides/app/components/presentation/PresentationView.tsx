import { useT } from "@agent-native/core/client/i18n";
import {
  IconChevronLeft,
  IconChevronRight,
  IconMaximize,
  IconNotes,
  IconX,
} from "@tabler/icons-react";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router";

import SlideRenderer from "@/components/deck/SlideRenderer";
import type {
  Slide,
  SlideAnimation,
  AnimationType,
} from "@/context/DeckContext";
import type { AspectRatio } from "@/lib/aspect-ratios";
import {
  findLegacyAnimationContainer,
  getElementPath,
  resolveSlideAnimationTargets,
} from "@/lib/slide-animation-elements";

import type { DesignSystemData } from "../../../shared/api";
import { openPresentChannel, type PresentMessage } from "./present-channel";

interface PresentationViewProps {
  slides: Slide[];
  deckId: string;
  startIndex?: number;
  aspectRatio?: AspectRatio;
  designSystem?: DesignSystemData;
}

// ─── Element animation helpers ────────────────────────────────────────────────

/**
 * Get the effective animation steps for a slide.
 * Uses slide.animations if defined, falls back to splitByParagraph auto-detection.
 */
function getAnimationSteps(slide: Slide): SlideAnimation[] | null {
  if (slide.animations && slide.animations.length > 0) {
    const doc = new DOMParser().parseFromString(slide.content, "text/html");
    const root = doc.querySelector(".fmd-slide");
    // Explicit metadata is authoritative only when every target still points
    // at a unique element in the final HTML. Otherwise disable the reveal
    // layer for this slide instead of counting invisible phantom steps while
    // leaving the rest of the content visible.
    return root && resolveSlideAnimationTargets(root, slide.animations)
      ? slide.animations
      : null;
  }
  // Legacy splitByParagraph: auto-detect and create steps
  if (slide.splitByParagraph) {
    const doc = new DOMParser().parseFromString(slide.content, "text/html");
    const root = doc.querySelector(".fmd-slide");
    if (!root) return null;

    const paragraphs = Array.from(
      root.querySelectorAll(".fmd-pptx-text p[data-pptx-paragraph]"),
    ).filter((paragraph) => {
      const textBox = paragraph.closest(".fmd-pptx-text");
      return (
        (textBox?.querySelectorAll("p[data-pptx-paragraph]").length ?? 0) > 1
      );
    });
    if (paragraphs.length > 1) {
      return paragraphs.flatMap((paragraph, index) => {
        const elementPath = getElementPath(root, paragraph);
        return elementPath
          ? [
              {
                id: `auto-paragraph-${index}`,
                elementIndex: index,
                elementPath,
                type: "slide-up" as AnimationType,
              },
            ]
          : [];
      });
    }

    const container = findLegacyAnimationContainer(root);
    if (!container) return null;
    return Array.from(container.children).map((_, i) => ({
      id: `auto-${i}`,
      elementIndex: i,
      type: "slide-up" as AnimationType,
    }));
  }
  return null;
}

/** CSS animation string for a given element animation type (for the newly-revealed item). */
function getElemAnimCss(type: AnimationType): string {
  switch (type) {
    case "appear":
      return "animation: elem-appear 100ms ease both;";
    case "fade":
      return "animation: elem-appear 400ms ease both;";
    case "slide-up":
      return "animation: elem-slide-up 300ms cubic-bezier(0.25,0.46,0.45,0.94) both;";
    case "zoom":
      return "animation: elem-zoom 300ms cubic-bezier(0.25,0.46,0.45,0.94) both;";
  }
}

/**
 * Return a modified HTML string where content-container children have
 * data-pstep attributes and an injected <style> controls visibility.
 * Uses per-element animation types from the animations array.
 * Items already revealed jump to end state; the newly revealed item animates.
 */
function annotateStepsForPresentation(
  html: string,
  steps: SlideAnimation[],
  currentStep: number,
): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.querySelector(".fmd-slide");
  if (!root) return html;

  const resolvedSteps = resolveSlideAnimationTargets(root, steps);
  if (!resolvedSteps) return html;

  // Annotate each resolved step element with data-pstep.
  resolvedSteps.forEach(({ element }, stepIdx) => {
    element.setAttribute("data-pstep", String(stepIdx));
  });

  const styleLines = resolvedSteps
    .map(({ target }, stepIdx) => {
      if (stepIdx >= currentStep) {
        return `[data-pstep="${stepIdx}"] { opacity: 0; pointer-events: none; }`;
      } else if (stepIdx < currentStep - 1) {
        // Already revealed — snap to end state
        return `[data-pstep="${stepIdx}"] { opacity: 1; pointer-events: auto; animation: elem-appear 1ms both; }`;
      } else {
        // Newly revealed — animate with its type
        return `[data-pstep="${stepIdx}"] { opacity: 1; pointer-events: auto; ${getElemAnimCss(target.type)} }`;
      }
    })
    .join("\n");

  const styleTag = `<style>[data-pstep] { opacity: 0; pointer-events: none; visibility: visible !important; }\n${styleLines}</style>`;
  return styleTag + doc.body.innerHTML;
}

// ─── Animation class helpers ──────────────────────────────────────────────────

function isInstant(t: Slide["transition"]): boolean {
  return !t || t === "instant" || t === "none";
}

function getEnterClass(
  transition: Slide["transition"],
  direction: "next" | "prev",
): string {
  switch (transition) {
    case "fade":
      return "slide-anim-fade-enter";
    case "slide":
      return direction === "next"
        ? "slide-anim-slide-enter-right"
        : "slide-anim-slide-enter-left";
    case "zoom":
      return "slide-anim-zoom-enter";
    default:
      return "";
  }
}

function getExitClass(
  transition: Slide["transition"],
  direction: "next" | "prev",
): string {
  switch (transition) {
    case "fade":
      return "slide-anim-fade-exit";
    case "slide":
      return direction === "next"
        ? "slide-anim-slide-exit-left"
        : "slide-anim-slide-exit-right";
    case "zoom":
      return "slide-anim-zoom-exit";
    default:
      return "";
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PresentationView({
  slides,
  deckId,
  startIndex = 0,
  aspectRatio,
  designSystem,
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
  // `startIndex` is a raw index into the full (unfiltered) deck.slides array —
  // e.g. from the editor's current slide or a `?slide=N` deep link. Skipped
  // slides are absent from safeSlides, so translate it to the nearest visible
  // slide's position within safeSlides rather than clamping the raw index
  // directly, which would land on the wrong slide whenever a skip precedes it.
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
  const [currentIndex, setCurrentIndex] = useState(() =>
    clampIndex(initialIndex),
  );
  const [prevIndex, setPrevIndex] = useState<number | null>(null);
  const [direction, setDirection] = useState<"next" | "prev">("next");
  const [animating, setAnimating] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [showControls, setShowControls] = useState(false);
  const [cursorVisible, setCursorVisible] = useState(true);
  const [needsFullscreenGesture, setNeedsFullscreenGesture] = useState(false);
  const enteredFullscreenRef = useRef(false);
  const transitionTimerRef = useRef<number | null>(null);
  const queuedNavigationRef = useRef<"next" | "prev" | null>(null);
  const goNextRef = useRef<() => void>(() => {});
  const goPrevRef = useRef<() => void>(() => {});
  const navigate = useNavigate();

  const isShared = deckId.startsWith("__shared__/");

  // `safeSlides` excludes skipped slides, so its index isn't the deck index
  // DeckEditor's `?slide=N` param expects. Map back to the raw position so
  // exiting/opening Presenter lands on the same slide it's currently showing.
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

  // Exit handlers read these instead of closing over `currentIndex`/`deckId`/
  // `isShared` so the mount-only fullscreenchange listener still lands on the
  // right deck and slide even if this component is reused for a different
  // deck without remounting (e.g. an agent-driven navigation).
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;
  const visibleRawIndicesRef = useRef(visibleRawIndices);
  visibleRawIndicesRef.current = visibleRawIndices;
  const deckIdRef = useRef(deckId);
  deckIdRef.current = deckId;
  const isSharedRef = useRef(isShared);
  isSharedRef.current = isShared;

  const clearTransitionTimer = useCallback(() => {
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearTransitionTimer, [clearTransitionTimer]);

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

    if (isDeepLinkChange) {
      prevSafeSlideIdsRef.current = safeSlides.map((s) => s.id);
      clearTransitionTimer();
      queuedNavigationRef.current = null;
      setCurrentIndex(clampIndex(initialIndex));
      setCurrentStep(0);
      setPrevIndex(null);
      setAnimating(false);
      return;
    }

    // Read the prior ids before overwriting the ref below — the lookup needs
    // the slide order from before this update, not the one it's producing.
    const activeId = prevSafeSlideIdsRef.current[currentIndexRef.current];
    const newIds = safeSlides.map((s) => s.id);
    const followedIndex = activeId ? newIds.indexOf(activeId) : -1;
    prevSafeSlideIdsRef.current = newIds;
    setCurrentIndex(
      followedIndex >= 0 ? followedIndex : clampIndex(currentIndexRef.current),
    );
    setPrevIndex((prev) =>
      prev !== null && prev >= safeSlides.length ? null : prev,
    );
    if (followedIndex < 0) {
      // The active slide is gone (e.g. just skipped) and we fell back to a
      // different one — its reveal/transition state doesn't apply here.
      clearTransitionTimer();
      queuedNavigationRef.current = null;
      setCurrentStep(0);
      setPrevIndex(null);
      setAnimating(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeSlides, startIndex, deckId]);

  const currentSlide = safeSlides[currentIndex];
  const animSteps = currentSlide ? getAnimationSteps(currentSlide) : null;
  const maxSteps = animSteps ? animSteps.length : 0;

  const startTransition = useCallback(
    (newIndex: number, dir: "next" | "prev") => {
      const incoming = safeSlides[newIndex];
      const t = incoming?.transition;
      // Going backward → fully revealed; forward → start at 0
      const incomingSteps = incoming ? getAnimationSteps(incoming) : null;
      const initialStep =
        dir === "prev" ? (incomingSteps ? incomingSteps.length : 0) : 0;

      clearTransitionTimer();
      queuedNavigationRef.current = null;
      if (isInstant(t)) {
        setPrevIndex(null);
        setAnimating(false);
        setCurrentIndex(newIndex);
        setCurrentStep(initialStep);
        return;
      }

      setPrevIndex(currentIndex);
      setDirection(dir);
      setAnimating(true);
      setCurrentIndex(newIndex);
      setCurrentStep(initialStep);

      transitionTimerRef.current = window.setTimeout(() => {
        transitionTimerRef.current = null;
        setPrevIndex(null);
        setAnimating(false);
        const queued = queuedNavigationRef.current;
        queuedNavigationRef.current = null;
        if (queued) {
          window.setTimeout(() => {
            if (queued === "next") goNextRef.current();
            else goPrevRef.current();
          }, 0);
        }
      }, 400);
    },
    [clearTransitionTimer, currentIndex, safeSlides],
  );

  const goNext = useCallback(() => {
    if (animating) {
      queuedNavigationRef.current = "next";
      return;
    }
    // Reveal next paragraph step if enabled
    if (maxSteps > 0 && currentStep < maxSteps /* i18n-ignore */) {
      setCurrentStep((prev) => prev + 1);
      return;
    }
    if (currentIndex >= safeSlides.length - 1) return;
    startTransition(currentIndex + 1, "next");
  }, [
    animating,
    maxSteps,
    currentStep,
    currentIndex,
    safeSlides.length,
    startTransition,
  ]);

  const goPrev = useCallback(() => {
    if (animating) {
      queuedNavigationRef.current = "prev";
      return;
    }
    if (currentIndex <= 0) return;
    startTransition(currentIndex - 1, "prev");
  }, [animating, currentIndex, startTransition]);

  const exit = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    if (isShared) {
      const token = deckId.replace("__shared__/", "");
      navigate(`/share/${token}`);
    } else {
      const rawIndex =
        visibleRawIndicesRef.current[currentIndexRef.current] ??
        currentIndexRef.current;
      navigate(`/deck/${deckId}?slide=${rawIndex + 1}`);
    }
  }, [navigate, deckId, isShared]);

  // Presenter window: it owns no navigation state of its own, it just sends
  // commands and mirrors whatever we echo back — so build steps stay
  // authoritative here.
  const channelRef = useRef<BroadcastChannel | null>(null);
  goNextRef.current = goNext;
  goPrevRef.current = goPrev;

  const broadcastState = useCallback(() => {
    channelRef.current?.postMessage({
      type: "state",
      index: currentIndex,
    } satisfies PresentMessage);
  }, [currentIndex]);
  const broadcastStateRef = useRef(broadcastState);
  broadcastStateRef.current = broadcastState;

  useEffect(() => {
    const channel = openPresentChannel(deckId);
    channelRef.current = channel;
    if (!channel) return;
    channel.onmessage = (event: MessageEvent<PresentMessage>) => {
      const message = event.data;
      if (message?.type === "hello") {
        broadcastStateRef.current();
      } else if (message?.type === "command") {
        if (message.command === "next") goNextRef.current();
        else goPrevRef.current();
      }
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [deckId]);

  useEffect(() => {
    broadcastState();
  }, [broadcastState]);

  const openPresenterWindow = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("presenter", "1");
    url.searchParams.set("slide", String(toRawIndex(currentIndex) + 1));
    window.open(
      url.toString(),
      `slides-presenter-${deckId}`,
      "width=1200,height=760",
    );
  }, [currentIndex, deckId, toRawIndex]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
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

  // Try to enter fullscreen. Browsers require a user gesture; the click that
  // navigated to /present often counts, but Safari/Firefox sometimes block
  // it. If blocked, we surface a "Click to enter fullscreen" overlay.
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

  // Request fullscreen on mount; track exit-by-Escape to navigate back
  useEffect(() => {
    enterFullscreen();
    const handleFullscreenChange = () => {
      // If the user pressed Escape (browser auto-exits fullscreen), leave
      // present mode. We only navigate-back when WE successfully entered
      // fullscreen first — otherwise the gesture-fallback overlay handles it.
      if (enteredFullscreenRef.current && !document.fullscreenElement) {
        enteredFullscreenRef.current = false;
        if (isSharedRef.current) {
          const token = deckIdRef.current.replace("__shared__/", "");
          navigate(`/share/${token}`);
        } else {
          const rawIndex =
            visibleRawIndicesRef.current[currentIndexRef.current] ??
            currentIndexRef.current;
          navigate(`/deck/${deckIdRef.current}?slide=${rawIndex + 1}`);
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

  // Lock the body during present mode: hide scrollbars, mark the body so
  // external automation/test tooling can detect present mode is active.
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

  // Auto-hide controls AND cursor after inactivity
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

  const displaySlide = useMemo(() => {
    if (!currentSlide || !animSteps || animSteps.length === 0)
      return currentSlide;
    return {
      ...currentSlide,
      content: annotateStepsForPresentation(
        currentSlide.content,
        animSteps,
        currentStep,
      ),
    };
  }, [currentSlide, animSteps, currentStep]);

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

  const enterClass = animating
    ? getEnterClass(currentSlide.transition, direction)
    : "";
  const exitClass =
    animating && prevIndex !== null
      ? getExitClass(currentSlide.transition, direction)
      : "";

  return (
    <div
      className="fixed inset-0 z-[100] bg-black overflow-hidden"
      style={{
        height: "100dvh",
        cursor: cursorVisible ? "default" : "none",
      }}
      onClick={() => {
        // If fullscreen was blocked by the browser (no user gesture),
        // any click in the presentation is itself a gesture — retry.
        if (needsFullscreenGesture) {
          enterFullscreen();
          return;
        }
        goNext();
      }}
    >
      {/* Exiting slide — rendered only during transition */}
      {animating && prevIndex !== null && safeSlides[prevIndex] && (
        <div
          key={safeSlides[prevIndex].id + "-exit"}
          className={`absolute inset-0 z-10 ${exitClass}`}
          style={{ willChange: "transform, opacity" }}
        >
          <SlideRenderer
            slide={safeSlides[prevIndex]}
            thumbnail={false}
            aspectRatio={aspectRatio}
            designSystem={designSystem}
          />
        </div>
      )}

      {/* Entering / current slide */}
      <div
        key={currentSlide.id + "-enter"}
        className={`absolute inset-0 z-20 ${enterClass}`}
        style={animating ? { willChange: "transform, opacity" } : undefined}
      >
        <SlideRenderer
          slide={displaySlide}
          thumbnail={false}
          aspectRatio={aspectRatio}
          designSystem={designSystem}
        />
      </div>

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
            {currentIndex + 1} / {safeSlides.length}
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={goPrev}
              disabled={currentIndex === 0}
              className="p-3 sm:p-2 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label={t("presentation.previousSlide")}
            >
              <IconChevronLeft className="w-5 h-5 sm:w-4 sm:h-4 text-white" />
            </button>
            <button
              onClick={goNext}
              disabled={
                currentIndex === safeSlides.length - 1 &&
                (maxSteps === 0 || // i18n-ignore: boolean expression, not visible copy.
                  currentStep >= maxSteps)
              }
              className="p-3 sm:p-2 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label={t("presentation.nextSlide")}
            >
              <IconChevronRight className="w-5 h-5 sm:w-4 sm:h-4 text-white" />
            </button>
          </div>

          <div className="flex items-center gap-2">
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
              transform: `scaleX(${(currentIndex + 1) / safeSlides.length})`,
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
    </div>
  );
}
