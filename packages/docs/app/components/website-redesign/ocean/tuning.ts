/**
 * Canonical parameter table copied from front/fft-ocean-1 DEFAULT_SETTINGS,
 * settings constants, uniform-packing, and bloom-pass.
 */
export const OCEAN_TUNING = {
  simulation: {
    oceanSize: 200,
    worldSize: 700,
    timeScale: 0.6,
    spectrumTimeScale: 0.5,
    windSpeed: 12.9,
    windAngle: 4.83,
    amplitude: 1.3,
    choppiness: 1.51,
    displacementScale: 0.035,
    foamThreshold: 0,
  },
  particles: {
    pointSize: 1.1,
    fadeNear: 60,
    fadeFar: 520,
    fadePower: 1.8,
    oceanColor: [
      0.003035269835488375, 0.003035269835488375, 0.003035269835488375, 0,
    ] as const,
    neonColor: [1, 1, 1, 0] as const,
    foamColor: [1, 1, 1, 0] as const,
  },
  camera: {
    // Third reframe of this rig. Upstream's gallery values put the horizon in
    // the upper third, which on a wide, short marketing hero drove the wave
    // band straight through the headline. The positive pitch tilts the rig up
    // so the empty sky covers the copy and the wave energy sits under the CTA
    // row instead. Re-check against the headline at 1440, 1024, and 390 before
    // changing any of these.
    eye: [0, 14, 78] as const,
    target: [0, 0, -60] as const,
    pitchDegrees: 21,
    fovDegrees: 95,
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
