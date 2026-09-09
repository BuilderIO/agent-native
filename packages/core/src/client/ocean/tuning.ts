/**
 * Canonical parameter table copied from front/fft-ocean-1 DEFAULT_SETTINGS,
 * settings constants, uniform-packing, and bloom-pass.
 *
 * UPSTREAM_TUNING below is that table verbatim; HERO_OVERRIDES is ours. Keeping
 * them separate makes a reframe a readable diff against the example rather
 * than a rewrite of it.
 */
export interface OceanTuning {
  readonly simulation: {
    readonly oceanSize: number;
    readonly worldSize: number;
    readonly timeScale: number;
    readonly spectrumTimeScale: number;
    readonly windSpeed: number;
    readonly windAngle: number;
    readonly amplitude: number;
    readonly choppiness: number;
    readonly displacementScale: number;
    readonly foamThreshold: number;
  };
  readonly particles: {
    readonly pointSize: number;
    readonly fadeNear: number;
    readonly fadeFar: number;
    readonly fadePower: number;
    readonly oceanColor: readonly [number, number, number, number];
    readonly neonColor: readonly [number, number, number, number];
    readonly foamColor: readonly [number, number, number, number];
  };
  readonly camera: {
    readonly eye: readonly [number, number, number];
    readonly target: readonly [number, number, number];
    readonly pitchDegrees: number;
    readonly fovDegrees: number;
    readonly near: number;
    readonly far: number;
  };
  readonly present: {
    readonly fgColor: readonly [number, number, number];
    readonly bgColor: readonly [number, number, number];
    readonly brightness: number;
  };
  readonly bloom: {
    readonly threshold: number;
    readonly smoothWidth: number;
    readonly strength: number;
    readonly radius: number;
    readonly levels: number;
    readonly kernelRadii: readonly number[];
  };
  /**
   * Where the container's bottom fade starts, as a percentage of hero height.
   * 100 disables it. Applied as a CSS mask, not in the shader: the abrupt edge
   * it softens is the container clipping the canvas, which no amount of
   * distance fade can reach.
   */
  readonly bottomFadeStartPercent: number;
}

/** The vgpu example's table, unmodified. HERO_OVERRIDES diffs against this. */
const UPSTREAM_TUNING: OceanTuning = {
  simulation: {
    oceanSize: 200,
    worldSize: 400,
    timeScale: 0.6,
    spectrumTimeScale: 0.5,
    windSpeed: 12.9,
    windAngle: 4.83,
    amplitude: 1.3,
    choppiness: 1.51,
    displacementScale: 0.005,
    foamThreshold: 0,
  },
  particles: {
    pointSize: 0.75,
    fadeNear: 60,
    fadeFar: 250,
    fadePower: 3.2,
    oceanColor: [
      0.003035269835488375, 0.003035269835488375, 0.003035269835488375, 0,
    ],
    neonColor: [1, 1, 1, 0],
    foamColor: [1, 1, 1, 0],
  },
  camera: {
    // Gallery reframe: the docs canvas is much taller than front's hero strip.
    // Raising and backing off the rig keeps the horizon in the upper third.
    eye: [0, 30, 90],
    target: [0, 5, 55],
    pitchDegrees: -10,
    fovDegrees: 90,
    near: 0.1,
    far: 2000,
  },
  present: {
    // Overridden at runtime from --b-bg-page / --b-text-secondary. These are
    // the pre-token defaults and the dark-mode values, so a token read that
    // fails still renders something correct.
    fgColor: [0.682, 0.678, 0.671],
    bgColor: [0.039, 0.039, 0.039],
    // >1 pushes the brightest crests past the foreground token so the field
    // has a lit centre instead of topping out flat at --b-text-secondary.
    brightness: 2.1,
  },
  bloom: {
    threshold: 0.3,
    smoothWidth: 0.01,
    strength: 0.08,
    radius: 0.46,
    levels: 5,
    kernelRadii: [6, 10, 14, 18, 22],
  },
  bottomFadeStartPercent: 100,
};

type Overrides = {
  [K in keyof OceanTuning]?: OceanTuning[K] extends object
    ? Partial<OceanTuning[K]>
    : OceanTuning[K];
};

/**
 * What the marketing hero changes about the example. Kept as an override set
 * rather than a rewritten table so the delta against UPSTREAM_TUNING stays
 * readable when the example is next pulled.
 */
const HERO_OVERRIDES: Overrides = {
  // 400 put the world patch edge inside the frustum, so the right of the hero
  // had a hard vertical cutoff where the ocean simply stopped. At upstream's
  // displacement the water was near-flat and compressed into a sheen at the
  // horizon rather than reading as water at all.
  simulation: { worldSize: 700, displacementScale: 0.035 },
  // fadeFar follows worldSize -- the field has to reach further before fading
  // -- and pointSize compensates for the same 512x512 particles now spread
  // over a three times larger area. fadePower is left low deliberately: it
  // scales both colour and alpha in particles.wgsl, so raising it thins the
  // whole field rather than just its far end.
  particles: { pointSize: 1.1, fadeFar: 520, fadePower: 1.8 },
  // Third reframe of this rig. Upstream's gallery values put the horizon in
  // the upper third, which on a wide, short marketing hero drove the wave band
  // straight through the headline. The positive pitch tilts the rig up so the
  // empty sky covers the copy and the wave energy sits under the CTA row.
  // Re-check against the headline at 1440, 1024, and 390 before changing these.
  camera: {
    eye: [0, 14, 78],
    target: [0, 0, -60],
    pitchDegrees: 21,
    fovDegrees: 95,
  },
  bottomFadeStartPercent: 62,
};

export const OCEAN_TUNING: OceanTuning = {
  simulation: { ...UPSTREAM_TUNING.simulation, ...HERO_OVERRIDES.simulation },
  particles: { ...UPSTREAM_TUNING.particles, ...HERO_OVERRIDES.particles },
  camera: { ...UPSTREAM_TUNING.camera, ...HERO_OVERRIDES.camera },
  present: { ...UPSTREAM_TUNING.present, ...HERO_OVERRIDES.present },
  bloom: { ...UPSTREAM_TUNING.bloom, ...HERO_OVERRIDES.bloom },
  bottomFadeStartPercent:
    HERO_OVERRIDES.bottomFadeStartPercent ??
    UPSTREAM_TUNING.bottomFadeStartPercent,
};

/** Matches front's `gaussianCoefficients`: sigma=radius/3, no normalization pass. */
export function gaussianCoefficients(kernelRadius: number): readonly number[] {
  return Array.from({ length: 24 }, (_, index) =>
    index < kernelRadius
      ? (0.39894 * Math.exp((-0.5 * index * index) / (kernelRadius / 3) ** 2)) /
        (kernelRadius / 3)
      : 0,
  );
}
