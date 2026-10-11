// Slide transition catalog, matching the Google Slides Transitions panel.
// A slide's transition belongs to the boundary before it. It plays when moving
// across that boundary in either direction, and the later slide of the pair
// supplies the type and speed (boundarySlideIndex in slide-navigation.ts).

export const SLIDE_TRANSITION_TYPES = [
  "none",
  "dissolve",
  "fade",
  "slide-from-right",
  "slide-from-left",
  "flip",
  "cube",
  "gallery",
] as const;

export type SlideTransitionType = (typeof SLIDE_TRANSITION_TYPES)[number];

// Values stored before the Google Slides catalog. They normalize on every
// read and write so a stored deck keeps a defined meaning.
export const LEGACY_SLIDE_TRANSITIONS = {
  instant: "none",
  slide: "slide-from-right",
  zoom: "dissolve",
} as const satisfies Record<string, SlideTransitionType>;

export const SLIDE_TRANSITION_INPUTS = [
  ...SLIDE_TRANSITION_TYPES,
  ...Object.keys(LEGACY_SLIDE_TRANSITIONS),
] as const;

// Google Slides speed slider. Measured at v = 0..45 (5.0 s to 0.5 s); the
// upper end (46..49) is extrapolated from the same line and not yet measured.
export const SLIDE_TRANSITION_SPEED = { min: 0, max: 49, default: 45 } as const;

export function isSlideTransitionType(
  value: unknown,
): value is SlideTransitionType {
  return (SLIDE_TRANSITION_TYPES as readonly unknown[]).includes(value);
}

/** Canonical transition for a stored or agent-supplied value. Unknown or missing → "none". */
export function normalizeSlideTransition(value: unknown): SlideTransitionType {
  if (isSlideTransitionType(value)) return value;
  // hasOwn, not `in`: "toString" must not resolve through the prototype chain.
  if (
    typeof value === "string" &&
    Object.hasOwn(LEGACY_SLIDE_TRANSITIONS, value)
  ) {
    return LEGACY_SLIDE_TRANSITIONS[
      value as keyof typeof LEGACY_SLIDE_TRANSITIONS
    ];
  }
  return "none";
}

export function clampTransitionSpeed(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return SLIDE_TRANSITION_SPEED.default;
  }
  return Math.min(
    SLIDE_TRANSITION_SPEED.max,
    Math.max(SLIDE_TRANSITION_SPEED.min, Math.round(value)),
  );
}

/** Duration in ms for a speed value: (5.0 - 0.1 × v) s. */
export function transitionDurationMs(speed: number | null | undefined): number {
  return Math.round((5 - 0.1 * clampTransitionSpeed(speed)) * 1000);
}
