/**
 * Canonical parameter table copied from front/fft-ocean-1 DEFAULT_SETTINGS,
 * settings constants, uniform-packing, and bloom-pass.
 *
 * UPSTREAM_TUNING below is that table verbatim. Everything after it is ours:
 * named presets that override individual fields so a reframe is a readable
 * diff against the example rather than a rewrite of it. Switch presets with
 * ACTIVE_OCEAN_PRESET, or `?ocean=<name>` in dev.
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

/** The vgpu example's table, unmodified. Presets diff against this. */
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
 * A: dense horizon band. The wave energy compresses into a bright ribbon under
 * the CTA row and the near field stays sparse. Reads as a lit seascape.
 */
const PRESET_A: Overrides = {
  simulation: { worldSize: 700, displacementScale: 0.035 },
  particles: { pointSize: 1.1, fadeFar: 520, fadePower: 1.8 },
  // Third reframe of this rig. Upstream's gallery values put the horizon in
  // the upper third, which on a wide, short marketing hero drove the wave band
  // straight through the headline. The positive pitch tilts the rig up so the
  // empty sky covers the copy and the wave energy sits under the CTA row.
  camera: {
    eye: [0, 14, 78],
    target: [0, 0, -60],
    pitchDegrees: 21,
    fovDegrees: 95,
  },
};

/**
 * B: dissolving field. Same framing as A, but the distance fade returns to
 * upstream's steeper curve over a shorter range, so the field thins out
 * instead of ending in a defined band -- and a container mask carries whatever
 * is left down into the section below rather than letting the canvas edge cut
 * it off.
 */
const PRESET_B: Overrides = {
  simulation: { worldSize: 700, displacementScale: 0.032 },
  particles: { pointSize: 1.1, fadeNear: 40, fadeFar: 430, fadePower: 2.6 },
  camera: {
    eye: [0, 14, 78],
    target: [0, 0, -60],
    pitchDegrees: 21,
    fovDegrees: 95,
  },
  bottomFadeStartPercent: 62,
};

/**
 * C: A's field, B's tail. Keeps A's wave height, particle size and fade range
 * -- the density that made it read as a lit seascape -- and takes only B's
 * steeper fade exponent and container mask, which are the two things that
 * stopped the field ending on a line at the section edge.
 */
const PRESET_C: Overrides = {
  simulation: { worldSize: 700, displacementScale: 0.035 },
  particles: { pointSize: 1.1, fadeNear: 60, fadeFar: 520, fadePower: 2.6 },
  camera: {
    eye: [0, 14, 78],
    target: [0, 0, -60],
    pitchDegrees: 21,
    fovDegrees: 95,
  },
  bottomFadeStartPercent: 62,
};

const OCEAN_PRESETS = { a: PRESET_A, b: PRESET_B, c: PRESET_C } as const;

export type OceanPresetName = keyof typeof OCEAN_PRESETS;

/** The preset that ships. `?ocean=<name>` overrides it in dev only. */
export const ACTIVE_OCEAN_PRESET: OceanPresetName = "c";

function isPresetName(value: string | null): value is OceanPresetName {
  return value !== null && value in OCEAN_PRESETS;
}

function selectedPreset(): OceanPresetName {
  // Dev only, and guarded for SSR: this module is on the static graph through
  // ocean-colors.ts, so it evaluates during prerender too.
  if (!import.meta.env.DEV || typeof location === "undefined") {
    return ACTIVE_OCEAN_PRESET;
  }
  const requested = new URLSearchParams(location.search).get("ocean");
  return isPresetName(requested) ? requested : ACTIVE_OCEAN_PRESET;
}

function applyPreset(name: OceanPresetName): OceanTuning {
  const overrides = OCEAN_PRESETS[name];
  return {
    simulation: { ...UPSTREAM_TUNING.simulation, ...overrides.simulation },
    particles: { ...UPSTREAM_TUNING.particles, ...overrides.particles },
    camera: { ...UPSTREAM_TUNING.camera, ...overrides.camera },
    present: { ...UPSTREAM_TUNING.present, ...overrides.present },
    bloom: { ...UPSTREAM_TUNING.bloom, ...overrides.bloom },
    bottomFadeStartPercent:
      overrides.bottomFadeStartPercent ??
      UPSTREAM_TUNING.bottomFadeStartPercent,
  };
}

export const OCEAN_PRESET_NAMES = Object.keys(
  OCEAN_PRESETS,
) as readonly OceanPresetName[];

/**
 * `let`, not `const`, so the dev preset switcher can swap it: ES module
 * bindings are live, so renderer.ts's twenty read sites pick the new table up
 * without tuning having to be threaded through the whole graph builder. The
 * renderer reads it while building, so a swap only takes effect on the next
 * graph -- the switcher remounts the background to force one.
 *
 * DEV-ONLY MUTATION. Nothing in a production build calls setOceanPreset.
 */
export let OCEAN_TUNING: OceanTuning = applyPreset(selectedPreset());

/** No-ops outside dev. Remove with the dev preset switcher. */
export function setOceanPreset(name: OceanPresetName): void {
  if (!import.meta.env.DEV) return;
  OCEAN_TUNING = applyPreset(name);
}

export function currentOceanPreset(): OceanPresetName {
  return selectedPreset();
}

/** Matches front's `gaussianCoefficients`: sigma=radius/3, no normalization pass. */
export function gaussianCoefficients(kernelRadius: number): readonly number[] {
  return Array.from({ length: 24 }, (_, index) =>
    index < kernelRadius
      ? (0.39894 * Math.exp((-0.5 * index * index) / (kernelRadius / 3) ** 2)) /
        (kernelRadius / 3)
      : 0,
  );
}
