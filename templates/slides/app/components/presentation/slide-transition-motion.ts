import {
  transitionDurationMs,
  type SlideTransitionType,
} from "../../../shared/slide-transitions";
import type { SlideDirection } from "./slide-navigation";

interface LayerSpec {
  keyframes: Keyframe[];
  /** Start and length as fractions of the whole transition. */
  startAt: number;
  span: number;
  /** Defaults to linear. */
  easing?: string;
  /** Set on layers that turn about their vertical axis, so the mirrored back face never shows. */
  backfaceHidden?: boolean;
}

interface TransitionMotionSpec {
  outgoing: LayerSpec;
  incoming: LayerSpec;
}

export interface LayerTiming {
  keyframes: Keyframe[];
  delay: number;
  duration: number;
  easing: string;
  /** Held as the layer's style for the whole transition, not animated in the keyframes. */
  backfaceVisibility: "hidden" | "visible";
}

export interface ResolvedSlideTransitionMotion {
  durationMs: number;
  outgoing: LayerTiming;
  incoming: LayerTiming;
}

const LINEAR = "linear";
const PERSPECTIVE = "perspective(1600px)";
// Keyframe offsets are matched against eased progress, so each gallery curve
// also decides when its tilt keyframe lands in time.
const GALLERY_INCOMING_EASING = "cubic-bezier(0.96, 0.9, 0.58, 0.79)";
const GALLERY_OUTGOING_EASING = "cubic-bezier(0.77, 0.08, 0.11, 0.24)";
const SLIDE_EASING = "cubic-bezier(0.7, 0.35, 0.27, 0.63)";

// Entry from the right (sign 1) or left (sign -1) going forward. Backward
// entries mirror it, so a slide-from-right deck reverses cleanly when stepping back.
function slideSpec(
  fromRight: 1 | -1,
  direction: SlideDirection,
): TransitionMotionSpec {
  const enter = (direction === "forward" ? fromRight : -fromRight) * 100;
  return {
    outgoing: {
      keyframes: [
        { transform: "translateX(0%)" },
        { transform: `translateX(${-enter}%)` },
      ],
      easing: SLIDE_EASING,
      startAt: 0,
      span: 1,
    },
    incoming: {
      keyframes: [
        { transform: `translateX(${enter}%)` },
        { transform: "translateX(0%)" },
      ],
      easing: SLIDE_EASING,
      startAt: 0,
      span: 1,
    },
  };
}

// The cube's centre path is half * sin(angle), with the angle linear in time.
// Rotating about the hinge already moves the centre by side * half *
// (cos(angle) - 1), so the translate carries only the rest; a bare sine would
// double-count that move. CSS keyframes cannot express sin, so the path is
// sampled at each offset; the rotation stays linear because every sample
// carries its own angle.
const CUBE_SAMPLES = 8;

function cubeFrames(
  hinge: "0% 50%" | "100% 50%",
  angleAt: (progress: number) => number,
): Keyframe[] {
  // +1 when the hinge is the left edge, so the centre sits to its right.
  const side = hinge === "0% 50%" ? 1 : -1;
  return Array.from({ length: CUBE_SAMPLES + 1 }, (_, i) => {
    const progress = i / CUBE_SAMPLES;
    const degrees = angleAt(progress);
    const radians = (degrees * Math.PI) / 180;
    const x = 50 * (Math.sin(radians) + side * (1 - Math.cos(radians)));
    return {
      offset: progress,
      transform: `${PERSPECTIVE} translateX(${x.toFixed(2)}%) rotateY(${degrees}deg)`,
      transformOrigin: hinge,
    };
  });
}

// Keyed by canonical type. `none` returns null (instant). Backward entries
// mirror every sign, so each function takes the direction.
const MOTION: Record<
  SlideTransitionType,
  (direction: SlideDirection) => TransitionMotionSpec | null
> = {
  none: () => null,

  // The outgoing slide stays fully visible; the incoming one fades in over it.
  dissolve: () => ({
    outgoing: {
      keyframes: [{ opacity: 1 }, { opacity: 1 }],
      startAt: 0,
      span: 1,
    },
    incoming: {
      keyframes: [{ opacity: 0 }, { opacity: 1 }],
      startAt: 0,
      span: 1,
    },
  }),

  // Sequential, not a crossfade: the outgoing slide is gone before the
  // incoming one starts, with a short blank between them.
  fade: () => ({
    outgoing: {
      keyframes: [{ opacity: 1 }, { opacity: 0 }],
      startAt: 0,
      span: 0.49,
    },
    incoming: {
      keyframes: [{ opacity: 0 }, { opacity: 1 }],
      startAt: 0.526,
      span: 0.474,
    },
  }),

  "slide-from-right": (direction) => slideSpec(1, direction),
  "slide-from-left": (direction) => slideSpec(-1, direction),

  // Both faces turn about the vertical axis for the full duration. The
  // outgoing face is edge-on at the midpoint.
  flip: (direction) => {
    const turn = direction === "forward" ? -180 : 180;
    return {
      outgoing: {
        keyframes: [
          { transform: `${PERSPECTIVE} rotateY(0deg)` },
          { transform: `${PERSPECTIVE} rotateY(${turn}deg)` },
        ],
        startAt: 0,
        span: 1,
        backfaceHidden: true,
      },
      incoming: {
        keyframes: [
          { transform: `${PERSPECTIVE} rotateY(${-turn}deg)` },
          { transform: `${PERSPECTIVE} rotateY(0deg)` },
        ],
        startAt: 0,
        span: 1,
        backfaceHidden: true,
      },
    };
  },

  // Two faces turning at once. Forward, the outgoing face hinges on its left
  // edge and turns to -90 while the incoming face hinges on its right edge and
  // turns in from +90, so the sweep runs right to left. Backward mirrors both.
  cube: (direction) => {
    const forward = direction === "forward";
    const turn = forward ? -90 : 90;
    const outgoingHinge = forward ? "0% 50%" : "100% 50%";
    const incomingHinge = forward ? "100% 50%" : "0% 50%";
    return {
      outgoing: {
        keyframes: cubeFrames(outgoingHinge, (p) => turn * p),
        startAt: 0,
        span: 1,
        backfaceHidden: true,
      },
      incoming: {
        keyframes: cubeFrames(incomingHinge, (p) => -turn * (1 - p)),
        startAt: 0,
        span: 1,
        backfaceHidden: true,
      },
    };
  },

  // Both slides travel past one slide width: the outgoing one ends at -115%,
  // the incoming one starts at +110%. Each tilts the same way to 35 degrees and
  // lies flat again at the end. Each layer has its own curve: the outgoing one
  // eases in, the incoming one speeds up late and then settles.
  gallery: (direction) => {
    const sign = direction === "forward" ? 1 : -1;
    const frame = (x: number, angle: number, offset: number): Keyframe => ({
      offset,
      transform: `${PERSPECTIVE} translateX(${x * sign}%) rotateY(${angle * sign}deg)`,
    });
    return {
      outgoing: {
        keyframes: [frame(0, 0, 0), frame(-46, 35, 0.4), frame(-115, 0, 1)],
        easing: GALLERY_OUTGOING_EASING,
        startAt: 0,
        span: 1,
      },
      incoming: {
        keyframes: [frame(110, 0, 0), frame(55, 35, 0.5), frame(0, 0, 1)],
        easing: GALLERY_INCOMING_EASING,
        startAt: 0,
        span: 1,
      },
    };
  },
};

// Under prefers-reduced-motion these play as dissolve instead.
const SPATIAL: ReadonlySet<SlideTransitionType> = new Set([
  "slide-from-right",
  "slide-from-left",
  "flip",
  "cube",
  "gallery",
]);

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function layerTiming(layer: LayerSpec, durationMs: number): LayerTiming {
  return {
    keyframes: layer.keyframes,
    delay: layer.startAt * durationMs,
    duration: layer.span * durationMs,
    easing: layer.easing ?? LINEAR,
    backfaceVisibility: layer.backfaceHidden ? "hidden" : "visible",
  };
}

/** Null for `none`, which has nothing to animate. */
export function resolveSlideTransitionMotion(
  type: SlideTransitionType,
  direction: SlideDirection,
  options: { speed: number | null | undefined; reducedMotion: boolean },
): ResolvedSlideTransitionMotion | null {
  const effective =
    options.reducedMotion && SPATIAL.has(type) ? "dissolve" : type;
  const spec = MOTION[effective](direction);
  if (!spec) return null;
  const durationMs = transitionDurationMs(options.speed);
  return {
    durationMs,
    outgoing: layerTiming(spec.outgoing, durationMs),
    incoming: layerTiming(spec.incoming, durationMs),
  };
}
