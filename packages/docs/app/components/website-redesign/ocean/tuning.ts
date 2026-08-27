/**
 * Canonical parameter table copied from front/fft-ocean-1 DEFAULT_SETTINGS,
 * settings constants, uniform-packing, and bloom-pass.
 */
export const OCEAN_TUNING = {
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
    ] as const,
    neonColor: [1, 1, 1, 0] as const,
    foamColor: [1, 1, 1, 0] as const,
  },
  camera: {
    // Gallery reframe: the docs canvas is much taller than front's hero strip.
    // Raising and backing off the rig keeps the horizon in the upper third.
    eye: [0, 30, 90] as const,
    target: [0, 5, 55] as const,
    pitchDegrees: -10,
    fovDegrees: 90,
    near: 0.1,
    far: 2000,
  },
  present: {
    // The hero's own greyscale, not the example's. Overridden at runtime from
    // --b-bg-page / --b-text-secondary; these are only the pre-token defaults
    // and the dark-mode values, so a token read that fails still renders.
    fgColor: [0.682, 0.678, 0.671] as const,
    bgColor: [0.039, 0.039, 0.039] as const,
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
    kernelRadii: [6, 10, 14, 18, 22] as const,
  },
} as const;

/** Matches front's `gaussianCoefficients`: sigma=radius/3, no normalization pass. */
export function gaussianCoefficients(kernelRadius: number): readonly number[] {
  return Array.from({ length: 24 }, (_, index) =>
    index < kernelRadius
      ? (0.39894 * Math.exp((-0.5 * index * index) / (kernelRadius / 3) ** 2)) /
        (kernelRadius / 3)
      : 0,
  );
}
