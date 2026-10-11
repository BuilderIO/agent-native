import { useT } from "@agent-native/core/client/i18n";
import { IconX } from "@tabler/icons-react";
import { useLayoutEffect, useRef } from "react";

import SlideRenderer from "@/components/deck/SlideRenderer";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Slide } from "@/context/DeckContext";
import type { AspectRatio } from "@/lib/aspect-ratios";

import type { DesignSystemData } from "../../../shared/api";
import type { SlidePosition } from "../../../shared/slide-number";
import { normalizeSlideTransition } from "../../../shared/slide-transitions";
import { annotateBuildSteps, getBuildSteps } from "./slide-build-steps";
import {
  prefersReducedMotion,
  resolveSlideTransitionMotion,
  type LayerTiming,
  type ResolvedSlideTransitionMotion,
} from "./slide-transition-motion";

function layerOptions(timing: LayerTiming): KeyframeEffectOptions {
  return {
    delay: timing.delay,
    duration: timing.duration,
    easing: timing.easing,
    fill: "both",
  };
}

export interface SlideTransitionStageProps {
  /** Already annotated for the build step it is leaving at. */
  outgoing: Slide;
  /** Already annotated for the build step it enters at. */
  incoming: Slide;
  outgoingPosition: SlidePosition;
  incomingPosition: SlidePosition;
  motion: ResolvedSlideTransitionMotion;
  aspectRatio?: AspectRatio;
  designSystem?: DesignSystemData;
  onFinished?: () => void;
}

/**
 * Plays one slide transition and reports when both layers finish. Callers key
 * it by flight, so a new transition mounts a new stage. Unmounting cancels the
 * animations and suppresses onFinished.
 */
export function SlideTransitionStage({
  outgoing,
  incoming,
  outgoingPosition,
  incomingPosition,
  motion,
  aspectRatio,
  designSystem,
  onFinished,
}: SlideTransitionStageProps) {
  const outgoingRef = useRef<HTMLDivElement>(null);
  const incomingRef = useRef<HTMLDivElement>(null);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  // Layout effect so the first painted frame already shows the start keyframes.
  // Runs once per mount on purpose: `motion` is re-resolved on every render and
  // restarting on each would make the transition stutter.
  useLayoutEffect(() => {
    const outgoingEl = outgoingRef.current;
    const incomingEl = incomingRef.current;
    if (!outgoingEl || !incomingEl) {
      throw new Error("SlideTransitionStage: layers were not mounted");
    }
    const animations = [
      outgoingEl.animate(
        motion.outgoing.keyframes,
        layerOptions(motion.outgoing),
      ),
      incomingEl.animate(
        motion.incoming.keyframes,
        layerOptions(motion.incoming),
      ),
    ];
    let stopped = false;
    Promise.all(animations.map((animation) => animation.finished)).then(
      () => {
        if (!stopped) onFinishedRef.current?.();
      },
      (error: unknown) => {
        // Only our own cancel rejects this promise while the stage is mounted.
        if (!stopped) throw error;
      },
    );
    return () => {
      stopped = true;
      for (const animation of animations) animation.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div
        ref={outgoingRef}
        className="absolute inset-0 z-10"
        style={{
          willChange: "transform, opacity",
          backfaceVisibility: motion.outgoing.backfaceVisibility,
        }}
        // aria-hidden alone leaves the layer's controls in the tab order.
        inert
        aria-hidden="true"
      >
        <SlideRenderer
          slide={outgoing}
          slidePosition={outgoingPosition}
          thumbnail={false}
          aspectRatio={aspectRatio}
          designSystem={designSystem}
        />
      </div>
      <div
        ref={incomingRef}
        className="absolute inset-0 z-20"
        style={{
          willChange: "transform, opacity",
          backfaceVisibility: motion.incoming.backfaceVisibility,
        }}
      >
        <SlideRenderer
          slide={incoming}
          slidePosition={incomingPosition}
          thumbnail={false}
          aspectRatio={aspectRatio}
          designSystem={designSystem}
        />
      </div>
    </>
  );
}

// Black playback surface, like the presentation it previews.
const PREVIEW_SURFACE_CLASS =
  "left-0 top-0 h-[100dvh] w-screen max-h-none max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 bg-black p-0 text-white shadow-none"; // guard:allow-raw-color - fixed black playback surface
const PREVIEW_CLOSE_CLASS =
  "absolute end-4 top-4 z-10 rounded-lg bg-white/10 p-3 text-white hover:bg-white/20 sm:p-2"; // guard:allow-raw-color - fixed black playback surface

/**
 * The pair a transition preview plays for slides[index], with the visible
 * numbering playback uses: the visible slide before it, then the slide itself.
 * Null when that slide is skipped, since playback never shows it, or when no
 * visible slide precedes it, since it has no incoming transition.
 */
export function transitionPreviewPair(slides: readonly Slide[], index: number) {
  const incoming = slides[index];
  if (!incoming || incoming.skipped) return null;
  const visible = slides.filter((slide) => Boolean(slide) && !slide.skipped);
  const position = visible.indexOf(incoming);
  if (position <= 0) return null;
  return {
    outgoing: visible[position - 1],
    incoming,
    position,
    count: visible.length,
  };
}

export interface SlideTransitionPreviewProps {
  slides: Slide[];
  /** Plays slides[index]'s incoming transition from the visible slide before it. */
  index: number;
  aspectRatio?: AspectRatio;
  designSystem?: DesignSystemData;
  onClose: () => void;
}

/** Renders nothing where transitionPreviewPair has no pair to play. */
export function SlideTransitionPreview({
  slides,
  index,
  aspectRatio,
  designSystem,
  onClose,
}: SlideTransitionPreviewProps) {
  const t = useT();
  const pair = transitionPreviewPair(slides, index);
  if (!pair) return null;

  const {
    outgoing: outgoingSource,
    incoming: incomingSource,
    position,
    count,
  } = pair;
  const outgoingSteps = getBuildSteps(outgoingSource).steps;
  const incomingSteps = getBuildSteps(incomingSource).steps;
  // The outgoing slide has just finished its build, so it shows fully built.
  const outgoing = annotateBuildSteps(
    outgoingSource,
    outgoingSteps,
    outgoingSteps.length,
  );
  const incoming = annotateBuildSteps(incomingSource, incomingSteps, 0);
  const motion = resolveSlideTransitionMotion(
    normalizeSlideTransition(incomingSource.transition),
    "forward",
    {
      speed: incomingSource.transitionSpeed,
      reducedMotion: prefersReducedMotion(),
    },
  );
  const incomingPosition = { number: position + 1, count };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        motion="instant"
        hideClose
        className={PREVIEW_SURFACE_CLASS}
      >
        <DialogTitle className="sr-only">
          {t("editorToolbar.transition_panel")}
        </DialogTitle>
        <div className="relative h-full w-full">
          {motion ? (
            <SlideTransitionStage
              key={index}
              outgoing={outgoing}
              incoming={incoming}
              outgoingPosition={{ number: position, count }}
              incomingPosition={incomingPosition}
              motion={motion}
              aspectRatio={aspectRatio}
              designSystem={designSystem}
            />
          ) : (
            <div className="absolute inset-0">
              <SlideRenderer
                slide={incoming}
                slidePosition={incomingPosition}
                thumbnail={false}
                aspectRatio={aspectRatio}
                designSystem={designSystem}
              />
            </div>
          )}
        </div>
        <DialogClose asChild>
          <button
            type="button"
            className={PREVIEW_CLOSE_CLASS}
            aria-label={t("comments.close")}
          >
            <IconX className="h-5 w-5" />
          </button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
