import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { IconChevronLeft, IconChevronRight, IconX } from "@tabler/icons-react";
import type { Slide } from "@/context/DeckContext";
import SlideRenderer from "@/components/deck/SlideRenderer";

interface PresentationViewProps {
  slides: Slide[];
  deckId: string;
  startIndex?: number;
}

export default function PresentationView({
  slides,
  deckId,
  startIndex = 0,
}: PresentationViewProps) {
  const [currentIndex, setCurrentIndex] = useState(
    Math.min(startIndex, slides.length - 1),
  );
  const [showControls, setShowControls] = useState(false);
  const navigate = useNavigate();

  const isShared = deckId.startsWith("__shared__/");

  const goNext = useCallback(() => {
    setCurrentIndex((prev) => Math.min(prev + 1, slides.length - 1));
  }, [slides.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex((prev) => Math.max(prev - 1, 0));
  }, []);

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
          // If in fullscreen, browser handles Escape -> fullscreenchange listener navigates back
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
      // Only navigate back if we were actually in fullscreen and user exited
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

  // Auto-hide controls (mouse + touch)
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

  const currentSlide = slides[currentIndex];
  if (!currentSlide) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black flex items-center justify-center"
      onClick={goNext}
    >
      {/* Slide - fills viewport using same SlideInner as thumbnails */}
      <div className="w-full h-full">
        <SlideRenderer slide={currentSlide} thumbnail={false} />
      </div>

      {/* Controls overlay */}
      <div
        className={`fixed inset-x-0 bottom-0 transition-all duration-300 z-[101] ${
          showControls ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
        }`}
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
              disabled={currentIndex === slides.length - 1}
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
            className="h-full bg-[#609FF8] transition-all duration-300"
            style={{ width: `${((currentIndex + 1) / slides.length) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
