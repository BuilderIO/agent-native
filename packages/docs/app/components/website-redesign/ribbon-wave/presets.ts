export type Vec3 = readonly [number, number, number];

export interface RibbonPlacement {
  position: Vec3;
  /** Euler angles in radians, applied X then Y then Z. */
  rotation: Vec3;
  scale: Vec3;
}

export type RibbonBreakpoint = "wide" | "medium" | "small";

const widePlacement: RibbonPlacement = {
  position: [380, -301.7, -11.1],
  rotation: [-0.449592653589793, -0.117592653589793, 1.87440734641021],
  scale: [9, 8, 5],
};

export const RIBBON_PLACEMENTS: Record<RibbonBreakpoint, RibbonPlacement> = {
  wide: widePlacement,
  medium: {
    ...widePlacement,
    position: [525, -301.7, -11.1],
    rotation: [-0.64, widePlacement.rotation[1], 1.68],
  },
  small: {
    ...widePlacement,
    position: [320, -315, -11.1],
    rotation: [-0.5, widePlacement.rotation[1], 1.64],
  },
};

export const RIBBON_BREAKPOINT_QUERIES: Record<
  Exclude<RibbonBreakpoint, "wide">,
  string
> = {
  small: "(max-width: 639px)",
  medium: "(min-width: 640px) and (max-width: 1263px)",
};

/** Orthographic camera in CSS pixels, looking at the origin. */
export const RIBBON_CAMERA = {
  eye: [100, 0, 5000] as Vec3,
  near: 1,
  far: 10000,
};

export const RIBBON_SHEET = {
  size: 400,
  columns: 128,
  rows: 256,
  /** Half-width of the semicircular turn where the sheet folds back. */
  foldHalfWidth: 16,
  foldGap: 4,
  /** How sharply the gap narrows toward the middle row band. */
  foldPinch: 9.5,
};

export const RIBBON_MOTION = {
  /** Milliseconds added to the clock so the first frame is already mid-swell. */
  startMs: 35000,
  /** Noise phase advanced per millisecond. */
  phasePerMs: 4e-5,
  /** Fraction of full speed gained per rendered frame while easing in. */
  easeInPerFrame: 0.016,
  /** Draw every Nth animation frame. */
  frameStride: 2,
  displaceFrequency: [0.005831, 0.016001] as const,
  displaceAmount: -7.821,
  /** Peak twist angle (radians) and falloff exponent around each diagonal. */
  twistAngle: { across: 0.41, along: -0.65, lengthwise: -0.58 },
  twistFalloff: { across: 0.7, along: 3.63, lengthwise: 3.95 },
};

export const RIBBON_SURFACE = {
  glowAmount: 1.98,
  glowPower: 0.806,
  glowRamp: 0.834,
  fibreStrength: 0.2,
  fibreFrequency: 600,
  fibreBlueDamping: 0.9,
  fibreEdgePower: 3,
  contrast: 1,
  saturation: 1,
  hueTurn: -0.00159265358979299,
  /** Lift added where the sheet faces the camera head-on. */
  faceLift: 0.25,
};

export const RIBBON_FINISH = {
  /** Total angle (radians) of the rotational smear at the top and bottom. */
  blurAngle: 0.02,
  blurTaps: 6,
  grain: 1.1,
};
