import { useT } from "@agent-native/core/client/i18n";
import { IconMaximize, IconMinimize } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ScreenshotStageProps {
  src: string;
  alt: string;
  /** Pixel size of the stored image, when known, to reserve the right shape. */
  width?: number | null;
  height?: number | null;
  className?: string;
}

/**
 * A screenshot, shown at its own aspect ratio with room above it.
 *
 * This is the image counterpart to the video player. Marks and redactions are
 * already flattened into the served file, so the stage only shows it; editing
 * happens in `ScreenshotEditor`.
 *
 * The stage can be taken full screen, because a screenshot is usually bigger
 * than the column it is shown in: in the page it is capped so the discussion
 * below stays reachable, and reading the small print in it otherwise means
 * downloading the file.
 */
export function ScreenshotStage({
  src,
  alt,
  width,
  height,
  className,
}: ScreenshotStageProps) {
  const t = useT();
  const stageRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  /**
   * Some browsers — and any page served without the fullscreen permission —
   * expose no working Fullscreen API. Covering the viewport ourselves keeps
   * the control from being a button that does nothing.
   */
  const [usingFallback, setUsingFallback] = useState(false);

  const exit = useCallback(() => {
    setUsingFallback(false);
    setIsFullscreen(false);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = stageRef.current;
    if (!el) return;

    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch (err) {
        console.warn("[clips] Exiting screenshot fullscreen failed", err);
      }
      exit();
      return;
    }
    if (usingFallback) {
      exit();
      return;
    }

    if (document.fullscreenEnabled && typeof el.requestFullscreen === "function") {
      try {
        await el.requestFullscreen();
        setIsFullscreen(true);
        return;
      } catch (err) {
        console.warn("[clips] Screenshot fullscreen failed", err);
      }
    }
    setUsingFallback(true);
    setIsFullscreen(true);
  }, [exit, usingFallback]);

  useEffect(() => {
    const onFullscreenChange = () => {
      const el = stageRef.current;
      const active = Boolean(el && document.fullscreenElement === el);
      if (!active && !usingFallback) setIsFullscreen(false);
      else if (active) setIsFullscreen(true);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [usingFallback]);

  useEffect(() => {
    // The browser handles Escape for real fullscreen; the fallback has to.
    if (!usingFallback) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") exit();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exit, usingFallback]);

  /**
   * Full screen is worth having only if a small capture actually grows to fill
   * it, which means letting the image box be the viewport rather than the
   * picture.
   */
  const fillsViewport = isFullscreen;

  return (
    <div
      ref={stageRef}
      className={cn(
        "relative flex items-center justify-center overflow-hidden",
        // The caller's classes style the stage as a card in the page — a
        // border, rounded corners, a card background. None of that belongs
        // around a picture that now owns the whole screen, so full screen
        // drops them rather than trying to override each one.
        isFullscreen
          ? "h-full max-h-none w-full rounded-none bg-black"
          : cn("max-h-[calc(100vh-16rem)] rounded-lg bg-muted", className),
        usingFallback && "fixed inset-0 z-50",
      )}
    >
      <div
        className={cn(
          "relative flex max-h-full max-w-full items-center justify-center",
          fillsViewport ? "h-full w-full" : "inline-flex",
        )}
      >
        <img
          src={src}
          alt={alt}
          width={width ?? undefined}
          height={height ?? undefined}
          className={cn(
            "block object-contain",
            fillsViewport ? "h-full w-full" : "max-h-full max-w-full",
          )}
          draggable={false}
        />
      </div>

      <Button
        type="button"
        size="sm"
        variant="secondary"
        aria-label={t(
          isFullscreen ? "screenshot.exitFullscreen" : "screenshot.fullscreen",
        )}
        title={t(
          isFullscreen ? "screenshot.exitFullscreen" : "screenshot.fullscreen",
        )}
        className="absolute right-3 top-3 gap-1.5 opacity-80 shadow-sm transition-opacity hover:opacity-100 focus-visible:opacity-100"
        onClick={() => void toggleFullscreen()}
      >
        {isFullscreen ? (
          <IconMinimize className="size-4" />
        ) : (
          <IconMaximize className="size-4" />
        )}
        <span className="hidden sm:inline">
          {t(
            isFullscreen ? "screenshot.exitFullscreen" : "screenshot.fullscreen",
          )}
        </span>
      </Button>
    </div>
  );
}
