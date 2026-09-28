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
  readonly bottomFadeStartPercent: number;
}

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
    eye: [0, 30, 90],
    target: [0, 5, 55],
    pitchDegrees: -10,
    fovDegrees: 90,
    near: 0.1,
    far: 2000,
  },
  present: {
    fgColor: [0.682, 0.678, 0.671],
    bgColor: [0.039, 0.039, 0.039],
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

const HERO_OVERRIDES: Overrides = {
  simulation: { worldSize: 700, displacementScale: 0.035 },
  particles: { pointSize: 1.1, fadeFar: 520, fadePower: 1.8 },
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

export function gaussianCoefficients(kernelRadius: number): readonly number[] {
  return Array.from({ length: 24 }, (_, index) =>
    index < kernelRadius
      ? (0.39894 * Math.exp((-0.5 * index * index) / (kernelRadius / 3) ** 2)) /
        (kernelRadius / 3)
      : 0,
  );
}
