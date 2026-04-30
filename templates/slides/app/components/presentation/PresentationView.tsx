import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router";
import {
  IconChevronLeft,
  IconChevronRight,
  IconMaximize,
  IconX,
} from "@tabler/icons-react";
import type {
  Slide,
  SlideAnimation,
  AnimationType,
} from "@/context/DeckContext";
import SlideRenderer from "@/components/deck/SlideRenderer";
import type { AspectRatio } from "@/lib/aspect-ratios";

interface PresentationViewProps {
  slides: Slide[];
  deckId: string;
  startIndex?: number;
  aspectRatio?: AspectRatio;
}

// ─── Element animation helpers ────────────────────────────────────────────────

/** Find the content container inside .fmd-slide that has multiple children. */
function findContentContainer(root: Element): Element | null {
  const children = Array.from(root.children);
  for (let i = children.length - 1; i >= 0; i--) {
    if (children[i].children.length >= 2) return children[i];
  }
  return null;
}

/**
 * Get the effective animation steps for a slide.
 * Uses slide.animations if defined, falls back to splitByParagraph auto-detection.
 */
function getAnimationSteps(slide: Slide): SlideAnimation[] | null {
  if (slide.animations && slide.animations.length > 0) return slide.animations;
  // Legacy splitByParagraph: auto-detect and create steps
  if (slide.splitByParagraph) {
    const doc = new DOMParser().parseFromString(slide.content, "text/html");
    const root = doc.querySelector(".fmd-slide");
    if (!root) return null;
    const container = findContentContainer(root);
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
  const container = findContentContainer(root);
  if (!container) return html;

  const containerChildren = Array.from(container.children);

  // Annotate each step element with data-pstep
  steps.forEach((anim, stepIdx) => {
    const el = containerChildren[anim.elementIndex];
    if (el) el.setAttribute("data-pstep", String(stepIdx));
  });

  const styleLines = steps
    .map((anim, stepIdx) => {
      if (stepIdx >= currentStep) {
        return `[data-pstep="${stepIdx}"] { opacity: 0; pointer-events: none; }`;
      } else if (stepIdx < currentStep - 1) {
        // Already revealed — snap to end state
        return `[data-pstep="${stepIdx}"] { opacity: 1; pointer-events: auto; animation: elem-appear 1ms both; }`;
      } else {
        // Newly revealed — animate with its type
        return `[data-pstep="${stepIdx}"] { opacity: 1; pointer-events: auto; ${getElemAnimCss(anim.type)} }`;
      }
    })
    .join("\n");

  const styleTag = `<style>[data-pstep] { opacity: 0; pointer-events: none; }\n${styleLines}</style>`;
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
}: PresentationViewProps) {
  const [currentIndex, setCurrentIndex] = useState(
    Math.min(startIndex, slides.length - 1),
  );
  const [prevIndex, setPrevIndex] = useState<number | null>(null);
  const [direction, setDirection] = useState<"next" | "prev">("next");
  const [animating, setAnimating] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [showControls, setShowControls] = useState(false);
  const [cursorVisible, setCursorVisible] = useState(true);
  const [needsFullscreenGesture, setNeedsFullscreenGesture] = useState(false);
  const enteredFullscreenRef = useRef(false);
  const navigate = useNavigate();

  const isShared = deckId.startsWith("__shared__/");

  const currentSlide = slides[currentIndex];
  const animSteps = currentSlide ? getAnimationSteps(currentSlide) : null;
  const maxSteps = animSteps ? animSteps.length : 0;

  const startTransition = useCallback(
    (newIndex: number, dir: "next" | "prev") => {
      const incoming = slides[newIndex];
      const t = incoming?.transition;
      // Going backward → fully revealed; forward → start at 0
      const incomingSteps = incoming ? getAnimationSteps(incoming) : null;
      const initialStep =
        dir === "prev" ? (incomingSteps ? incomingSteps.length : 0) : 0;

      if (isInstant(t)) {
        setCurrentIndex(newIndex);
        setCurrentStep(initialStep);
        return;
      }

      setPrevIndex(currentIndex);
      setDirection(dir);
      setAnimating(true);
      setCurrentIndex(newIndex);
      setCurrentStep(initialStep);

      setTimeout(() => {
        setPrevIndex(null);
        setAnimating(false);
      }, 400);
    },
    [currentIndex, slides],
  );

  const goNext = useCallback(() => {
    if (animating) return;
    // Reveal next paragraph step if enabled
    if (maxSteps > 0 && currentStep < maxSteps) {
      setCurrentStep((prev) => prev + 1);
      return;
    }
    if (currentIndex >= slides.length - 1) return;
    startTransition(currentIndex + 1, "next");
  }, [
    animating,
    maxSteps,
    currentStep,
    currentIndex,
    slides.length,
    startTransition,
  ]);

  const goPrev = useCallback(() => {
    if (animating) return;
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
      navigate(`/deck/${deckId}`);
    }
  }, [navigate, deckId, isShared]);

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
        case "Escape":
          exit();
          break;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goNext, goPrev, exit]);

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
        if (isShared) {
          const token = deckId.replace("__shared__/", "");
          navigate(`/share/${token}`);
        } else {
          navigate(`/deck/${deckId}`);
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

  if (!currentSlide) return null;

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
      {animating && prevIndex !== null && (
        <div
          key={slides[prevIndex].id + "-exit"}
          className={`absolute inset-0 z-10 ${exitClass}`}
          style={{ willChange: "transform, opacity" }}
        >
          <SlideRenderer
            slide={slides[prevIndex]}
            thumbnail={false}
            aspectRatio={aspectRatio}
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
            {currentIndex + 1} / {slides.length}
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={goPrev}
              disabled={currentIndex === 0}
              className="p-3 sm:p-2 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Previous slide"
            >
              <IconChevronLeft className="w-5 h-5 sm:w-4 sm:h-4 text-white" />
            </button>
            <button
              onClick={goNext}
              disabled={
                currentIndex === slides.length - 1 &&
                (maxSteps === 0 || currentStep >= maxSteps)
              }
              className="p-3 sm:p-2 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Next slide"
            >
              <IconChevronRight className="w-5 h-5 sm:w-4 sm:h-4 text-white" />
            </button>
          </div>

          <button
            onClick={exit}
            className="p-3 sm:p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
            aria-label="Exit presentation"
          >
            <IconX className="w-5 h-5 sm:w-4 sm:h-4 text-white" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-0.5 bg-white/10">
          <div
            className="h-full bg-[#609FF8]"
            style={{
              width: `${((currentIndex + 1) / slides.length) * 100}%`,
              transition: "width 0.3s",
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
          aria-label="Enter fullscreen"
        >
          <IconMaximize className="w-4 h-4" />
          Click to enter fullscreen
        </button>
      )}
    </div>
  );
}
