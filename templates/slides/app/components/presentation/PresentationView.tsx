import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import { IconChevronLeft, IconChevronRight, IconX } from "@tabler/icons-react";
import type { Slide } from "@/context/DeckContext";
import SlideRenderer from "@/components/deck/SlideRenderer";

interface PresentationViewProps {
  slides: Slide[];
  deckId: string;
  startIndex?: number;
}

// ─── Paragraph step helpers ───────────────────────────────────────────────────

/** Find the content container inside .fmd-slide that has multiple children. */
function findContentContainer(root: Element): Element | null {
  const children = Array.from(root.children);
  for (let i = children.length - 1; i >= 0; i--) {
    if (children[i].children.length >= 2) return children[i];
  }
  return null;
}

/** Count how many paragraph steps a slide has (0 = feature disabled). */
function countSteps(html: string): number {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.querySelector(".fmd-slide");
  if (!root) return 0;
  const container = findContentContainer(root);
  return container ? container.children.length : 0;
}

/**
 * Return a modified HTML string where content-container children have
 * data-pstep attributes and an injected <style> controls visibility.
 * Items already revealed (index < visibleCount-1) jump to end state instantly;
 * the newly revealed item (index === visibleCount-1) animates in.
 */
function annotateStepsForPresentation(
  html: string,
  visibleCount: number,
): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.querySelector(".fmd-slide");
  if (!root) return html;
  const container = findContentContainer(root);
  if (!container || container.children.length < 2) return html;

  const steps = Array.from(container.children);
  steps.forEach((child, i) => child.setAttribute("data-pstep", String(i)));

  const styleLines = steps
    .map((_, i) => {
      if (i >= visibleCount) {
        return `[data-pstep="${i}"] { opacity: 0; pointer-events: none; }`;
      } else if (i < visibleCount - 1) {
        // Already revealed — jump to end state instantly
        return `[data-pstep="${i}"] { opacity: 1; pointer-events: auto; animation: step-reveal 280ms both; animation-delay: -1s; }`;
      } else {
        // Newly revealed — animate normally
        return `[data-pstep="${i}"] { opacity: 1; pointer-events: auto; animation: step-reveal 280ms cubic-bezier(0.25,0.46,0.45,0.94) both; }`;
      }
    })
    .join("\n");

  const styleTag = `<style>[data-pstep] { opacity: 0; pointer-events: none; }\n${styleLines}</style>`;
  return styleTag + doc.body.innerHTML;
}

// ─── Animation class helpers ──────────────────────────────────────────────────

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
}: PresentationViewProps) {
  const [currentIndex, setCurrentIndex] = useState(
    Math.min(startIndex, slides.length - 1),
  );
  const [prevIndex, setPrevIndex] = useState<number | null>(null);
  const [direction, setDirection] = useState<"next" | "prev">("next");
  const [animating, setAnimating] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [showControls, setShowControls] = useState(false);
  const navigate = useNavigate();

  const isShared = deckId.startsWith("__shared__/");

  const currentSlide = slides[currentIndex];
  const maxSteps = currentSlide?.splitByParagraph
    ? countSteps(currentSlide.content)
    : 0;

  const startTransition = useCallback(
    (newIndex: number, dir: "next" | "prev") => {
      const incoming = slides[newIndex];
      const t = incoming?.transition ?? "none";
      // Going backward → show slide fully revealed; forward → start at 0
      const initialStep =
        dir === "prev" ? countSteps(incoming?.content ?? "") : 0;

      if (t === "none") {
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
        case "Escape":
          if (!document.fullscreenElement) {
            exit();
          }
          break;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goNext, goPrev, exit]);

  // Request fullscreen on mount
  useEffect(() => {
    let wasFullscreen = false;
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) {
      el.requestFullscreen()
        .then(() => {
          wasFullscreen = true;
        })
        .catch(() => {});
    }
    const handleFullscreenChange = () => {
      if (wasFullscreen && !document.fullscreenElement) {
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
  }, []);

  // Auto-hide controls
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const handleMove = () => {
      setShowControls(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => setShowControls(false), 2500);
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
    if (!currentSlide?.splitByParagraph || maxSteps === 0) return currentSlide;
    return {
      ...currentSlide,
      content: annotateStepsForPresentation(currentSlide.content, currentStep),
    };
  }, [currentSlide, currentStep, maxSteps]);

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
      onClick={goNext}
    >
      {/* Exiting slide — rendered only during transition */}
      {animating && prevIndex !== null && (
        <div
          key={slides[prevIndex].id + "-exit"}
          className={`absolute inset-0 z-10 ${exitClass}`}
          style={{ willChange: "transform, opacity" }}
        >
          <SlideRenderer slide={slides[prevIndex]} thumbnail={false} />
        </div>
      )}

      {/* Entering / current slide */}
      <div
        key={currentSlide.id + "-enter"}
        className={`absolute inset-0 z-20 ${enterClass}`}
        style={animating ? { willChange: "transform, opacity" } : undefined}
      >
        <SlideRenderer slide={displaySlide} thumbnail={false} />
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
    </div>
  );
}
