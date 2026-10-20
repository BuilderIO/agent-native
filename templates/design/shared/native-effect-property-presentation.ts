import type { EffectDefinition, EffectProperty } from "./native-effects";

export interface NativeEffectPropertyPresentation {
  readonly displayScale: number;
  readonly unit: string;
  readonly step: number;
}

export interface NativeEffectPropertyDisplayMetadata extends NativeEffectPropertyPresentation {
  default: number | [number, number];
  min?: number;
  max?: number;
}

const percent: NativeEffectPropertyPresentation = {
  displayScale: 100,
  unit: "%",
  step: 1,
};
const finePercent: NativeEffectPropertyPresentation = { ...percent, step: 0.1 };
const degrees: NativeEffectPropertyPresentation = {
  displayScale: 180 / Math.PI,
  unit: "°",
  step: 1,
};
const count: NativeEffectPropertyPresentation = {
  displayScale: 1,
  unit: "",
  step: 1,
};
const multiplier: NativeEffectPropertyPresentation = {
  displayScale: 1,
  unit: "×",
  step: 0.1,
};
const exposure: NativeEffectPropertyPresentation = {
  displayScale: 1,
  unit: "EV",
  step: 0.05,
};
const pixels = (step = 0.1): NativeEffectPropertyPresentation => ({
  displayScale: 1,
  unit: "px",
  step,
});

// Presentation is deliberately outside EffectDefinition so familiar units do not change execution hashes.
export const NATIVE_EFFECT_PROPERTY_PRESENTATIONS: Readonly<
  Record<string, Readonly<Record<string, NativeEffectPropertyPresentation>>>
> = {
  "an-native-gradient-field@1": {
    scale: percent,
    movement: percent,
    detail: count,
    softness: finePercent,
    rotation: degrees,
  },
  "an-native-mesh-anchors@5": {
    scale: percent,
    movement: percent,
    detail: count,
    softness: finePercent,
    rotation: degrees,
  },
  "an-native-hex-tiles@1": {
    scale: percent,
    movement: percent,
    detail: count,
    softness: finePercent,
    rotation: degrees,
  },
  "an-native-palette-map@1": { amount: percent, contrast: percent },
  "an-native-posterize@1": { amount: percent, levels: count },
  "an-native-sobel-edges@1": {
    amount: percent,
    radius: pixels(0.05),
    strength: multiplier,
  },
  "an-native-pixelate@1": { amount: percent, cellSize: pixels() },
  "an-native-chromatic-aberration@1": {
    amount: percent,
    distance: pixels(),
    angle: degrees,
  },
  "an-native-film-grain@1": {
    amount: percent,
    strength: percent,
    size: pixels(),
    movement: percent,
  },
  "an-native-grain-gradient@3": {
    scale: percent,
    movement: percent,
    grain: finePercent,
  },
  "an-native-halftone@3": {
    cellSize: pixels(),
    angle: degrees,
    contrast: percent,
  },
  "an-native-frosted-refraction@3": {
    blur: pixels(),
    distortion: pixels(),
    movement: percent,
  },
  "an-native-nebula@1": {
    scale: percent,
    cloudDensity: percent,
    movement: percent,
  },
  "an-native-glowing-waves@1": {
    amplitude: percent,
    wavesAcrossWidth: { displayScale: 1, unit: "", step: 0.1 },
    glowWidth: pixels(1),
    movement: percent,
  },
  "an-native-glowing-waves@2": {
    amplitude: percent,
    wavesAcrossWidth: { displayScale: 1, unit: "", step: 0.1 },
    glowWidth: pixels(1),
    movement: percent,
  },
  "an-native-color-grade@2": {
    amount: percent,
    exposure,
    contrast: percent,
    saturation: percent,
    warmth: percent,
    brightness: percent,
  },
  "an-native-gaussian-blur@2": { radius: pixels() },
  "an-native-bloom@2": {
    radius: pixels(),
    threshold: percent,
    knee: percent,
    intensity: percent,
  },
  "an-native-owned-cc-source-glints@1": {
    spacing: pixels(1),
    threshold: percent,
    intensity: percent,
    rayLength: pixels(0.5),
    twinkleSpeed: { ...percent, step: 10 },
    amount: percent,
  },
  "an-native-liquid-metal@1": {
    scale: percent,
    distortion: percent,
    roughness: percent,
    lightAngle: degrees,
    movement: percent,
  },
  "an-native-liquid-metal@2": {
    scale: percent,
    distortion: percent,
    roughness: percent,
    lightAngle: degrees,
    movement: percent,
  },
  "an-native-liquid-metal@3": {
    scale: percent,
    repetition: percent,
    contour: percent,
    distortion: percent,
    softness: percent,
    angle: degrees,
    shiftRed: percent,
    shiftBlue: percent,
  },
  "an-native-liquid-metal@4": {
    scale: percent,
    repetition: percent,
    contour: percent,
    distortion: percent,
    softness: percent,
    angle: degrees,
    shiftRed: percent,
    shiftBlue: percent,
  },
  "an-native-liquid-metal@5": {
    scale: percent,
    repetition: percent,
    contour: percent,
    distortion: percent,
    softness: percent,
    angle: degrees,
    shiftRed: percent,
    shiftBlue: percent,
  },
  "an-native-liquid-metal@6": {
    scale: percent,
    repetition: percent,
    contour: percent,
    distortion: percent,
    softness: percent,
    angle: degrees,
    shiftRed: percent,
    shiftBlue: percent,
  },
  "an-native-liquid-metal@7": {
    scale: percent,
    repetition: percent,
    contour: percent,
    distortion: percent,
    softness: percent,
    angle: degrees,
    shiftRed: percent,
    shiftBlue: percent,
  },
  "an-native-liquid-metal@8": {
    scale: percent,
    repetition: percent,
    contour: percent,
    distortion: percent,
    softness: percent,
    angle: degrees,
    shiftRed: percent,
    shiftBlue: percent,
  },
  "an-native-liquid-metal@9": {
    scale: percent,
    repetition: percent,
    contour: percent,
    distortion: percent,
    softness: percent,
    angle: degrees,
    shiftRed: percent,
    shiftBlue: percent,
  },
  "an-native-liquid-metal@10": {
    scale: percent,
    repetition: percent,
    contour: percent,
    distortion: percent,
    softness: percent,
    angle: degrees,
    shiftRed: percent,
    shiftBlue: percent,
  },
  "an-native-liquid-metal@11": {
    scale: percent,
    repetition: percent,
    contour: percent,
    distortion: percent,
    softness: percent,
    angle: degrees,
    shiftRed: percent,
    shiftBlue: percent,
  },
  "an-native-liquid-metal@12": {
    scale: percent,
    repetition: percent,
    contour: percent,
    distortion: percent,
    softness: percent,
    angle: degrees,
    shiftRed: percent,
    shiftBlue: percent,
  },
  "an-native-liquid-glass@1": {
    thickness: pixels(),
    edgeWidth: pixels(),
    frost: pixels(),
    highlight: percent,
    lightAngle: degrees,
  },
  "an-native-liquid-glass@2": {
    thickness: pixels(),
    edgeWidth: pixels(),
    frost: pixels(),
    highlight: percent,
    lightAngle: degrees,
  },
  "an-native-liquid-glass@3": {
    thickness: pixels(),
    edgeWidth: pixels(),
    frost: pixels(),
    highlight: percent,
    lightAngle: degrees,
  },
  "an-native-fluted-glass@1": {
    fluteWidth: pixels(1),
    rotation: degrees,
    refraction: pixels(),
    frost: pixels(),
  },
  "an-native-image-dithering@1": {
    cellSize: pixels(1),
    contrast: percent,
    amount: percent,
  },
  "an-native-waves@1": {
    scale: percent,
    amplitude: percent,
    frequency: { ...multiplier, step: 0.05 },
    softness: finePercent,
    rotation: degrees,
    movement: percent,
  },
  "an-native-fiber-texture@1": {
    scale: percent,
    detail: count,
    grain: percent,
    movement: percent,
  },
  "an-native-textured-stock@1": {
    scale: percent,
    detail: count,
    grain: percent,
    fiber: percent,
    folds: percent,
    angle: degrees,
  },
  "an-native-halftone-cmyk@1": {
    cellSize: pixels(1),
    angle: degrees,
    contrast: percent,
  },
  "an-native-lens-distortion@1": {
    distortion: percent,
    dispersion: pixels(),
    angle: degrees,
    amount: percent,
  },
  "an-native-lens-distortion@2": {
    distortion: percent,
    dispersion: pixels(),
    angle: degrees,
    amount: percent,
  },
  "an-native-water@1": {
    distortion: pixels(),
    scale: percent,
    highlights: percent,
    movement: percent,
  },
  "an-native-water@2": {
    distortion: pixels(),
    scale: percent,
    highlights: percent,
    movement: percent,
  },
  "an-native-heatmap@1": {
    scale: percent,
    detail: count,
    contour: percent,
    movement: percent,
  },
  "an-native-gem-smoke@1": {
    scale: percent,
    detail: count,
    distortion: percent,
    movement: percent,
  },
  "an-native-dot-orbit@1": {
    detail: count,
    size: percent,
    amplitude: percent,
    movement: percent,
  },
  "an-native-dot-grid@1": {
    detail: count,
    size: percent,
    rotation: degrees,
    softness: percent,
  },
  "an-native-spiral@1": {
    frequency: count,
    scale: percent,
    softness: percent,
    movement: percent,
    rotation: degrees,
  },
  "an-native-neuro-noise@1": {
    scale: percent,
    detail: count,
    distortion: percent,
    movement: percent,
  },
  "an-native-perlin-noise@1": {
    scale: percent,
    detail: count,
    contrast: percent,
    movement: percent,
  },
  "an-native-simplex-noise@1": {
    scale: percent,
    detail: count,
    movement: percent,
    contrast: percent,
  },
  "an-native-pulsing-border@1": {
    thickness: pixels(),
    softness: percent,
    intensity: percent,
    movement: percent,
  },
  "an-native-color-panels@1": {
    detail: count,
    softness: percent,
    movement: percent,
    rotation: degrees,
  },
  "an-native-smoke-ring@1": {
    scale: percent,
    detail: count,
    softness: percent,
    movement: percent,
  },
  "an-native-god-rays@1": {
    scale: percent,
    detail: count,
    angle: degrees,
    intensity: percent,
    movement: percent,
  },
  "an-native-ordered-dither@1": {
    amount: percent,
    cellSize: pixels(),
  },
  "an-native-noise-displacement@1": {
    amount: percent,
    distance: pixels(),
    scale: multiplier,
    movement: multiplier,
  },
  "an-native-swirl@1": {
    amount: percent,
    angle: degrees,
    radius: percent,
  },
  "an-native-voronoi-cells@2": {
    scale: percent,
    movement: percent,
    detail: count,
    softness: finePercent,
    rotation: degrees,
  },
  "an-native-metaball-field@2": {
    scale: percent,
    movement: percent,
    detail: count,
    softness: finePercent,
    rotation: degrees,
  },
};

export const NATIVE_OPACITY_PRESENTATION = percent;
export const NATIVE_SPEED_PRESENTATION = percent;

function numericProperty(
  property: EffectProperty | undefined,
): property is Extract<EffectProperty, { type: "float" | "int" | "vec2" }> {
  return (
    property?.type === "float" ||
    property?.type === "int" ||
    property?.type === "vec2"
  );
}

export function getNativeEffectPropertyPresentation(
  definition: EffectDefinition,
  propertyKey: string,
): NativeEffectPropertyPresentation | null {
  const property = definition.properties[propertyKey];
  if (!numericProperty(property)) return null;
  const curated =
    NATIVE_EFFECT_PROPERTY_PRESENTATIONS[
      `${definition.id}@${definition.version}`
    ]?.[propertyKey];
  if (curated) return curated;
  const displayScale = property.displayScale ?? 1;
  return {
    displayScale,
    unit: property.unit ?? "",
    step:
      (property.step ?? (property.type === "int" ? 1 : 0.01)) * displayScale,
  };
}

export function nativeEffectValueToDisplay(
  value: number,
  presentation: NativeEffectPropertyPresentation,
): number {
  if (!Number.isFinite(value))
    throw new RangeError("Native effect display values must be finite.");
  return value * presentation.displayScale;
}

export function nativeEffectValueFromDisplay(
  value: number,
  presentation: NativeEffectPropertyPresentation,
): number {
  if (!Number.isFinite(value))
    throw new RangeError("Native effect display values must be finite.");
  return value / presentation.displayScale;
}

export function getNativeEffectPropertyPresentations(
  definition: EffectDefinition,
): Record<string, NativeEffectPropertyDisplayMetadata> {
  const result: Record<string, NativeEffectPropertyDisplayMetadata> = {};
  for (const [key, property] of Object.entries(definition.properties)) {
    if (!numericProperty(property)) continue;
    const presentation = getNativeEffectPropertyPresentation(definition, key)!;
    result[key] = {
      ...presentation,
      default: Array.isArray(property.default)
        ? (property.default.map((value) =>
            nativeEffectValueToDisplay(value, presentation),
          ) as [number, number])
        : nativeEffectValueToDisplay(property.default, presentation),
      ...(property.min === undefined
        ? {}
        : { min: nativeEffectValueToDisplay(property.min, presentation) }),
      ...(property.max === undefined
        ? {}
        : { max: nativeEffectValueToDisplay(property.max, presentation) }),
    };
  }
  return result;
}
