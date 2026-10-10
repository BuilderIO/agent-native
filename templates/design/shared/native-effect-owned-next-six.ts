import {
  CATALOG_EDGE,
  catalogFloat,
  catalogPalette,
  catalogShader,
  type CatalogShaderSpec,
} from "./native-effect-catalog-kit";
import type {
  EffectDefinition,
  EffectPreset,
  EffectProperty,
  EffectValue,
} from "./native-effects";

type Look = readonly [
  string,
  Record<string, EffectValue>,
  string,
  Record<string, EffectValue>,
];

type Draft = Omit<CatalogShaderSpec, "kind"> & {
  kind: "processor" | "generator";
  mechanism: string;
  looks: Look;
};

const cssPixels = (
  label: string,
  value: number,
  max: number,
): EffectProperty => ({
  type: "float",
  label,
  default: value,
  min: 1,
  max,
  step: 0.1,
  unit: "px",
});
const fraction = (label: string, value: number): EffectProperty =>
  catalogFloat(label, value, 0, 1, 0.01);

export const OWNED_NEXT_SIX_DRAFTS: readonly Draft[] = [
  {
    id: "owned-patch-affinity-denoise",
    name: "Patch Affinity Denoise",
    kind: "processor",
    backdrop: true,
    mechanism:
      "Three-pixel patch similarity weights nine nearby candidate pixels",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      radius: cssPixels("Search radius", 3, 12),
      similarity: catalogFloat("Patch similarity", 0.17, 0.02, 0.6),
      blend: fraction("Blend", 0.85),
    },
    fragment: (p) => `
  let center = sampleSource(input.uv);
  let pixel = globals.clock.z * globals.viewport.zw;
  let reach = ${p("radius")}.x * pixel;
  let centerLeft = sampleSource(input.uv - vec2f(pixel.x, 0.0));
  let centerRight = sampleSource(input.uv + vec2f(pixel.x, 0.0));
  let threshold = ${p("similarity")}.x * ${p("similarity")}.x;
  var sum = vec4f(0.0);
  var total = 0.0;
  for (var y = -1i; y <= 1i; y += 1i) {
    for (var x = -1i; x <= 1i; x += 1i) {
      let uv = input.uv + vec2f(f32(x), f32(y)) * reach;
      let candidate = sampleSource(uv);
      let left = sampleSource(uv - vec2f(pixel.x, 0.0));
      let right = sampleSource(uv + vec2f(pixel.x, 0.0));
      let delta0 = candidate - center;
      let delta1 = left - centerLeft;
      let delta2 = right - centerRight;
      let patchDistance = (dot(delta0, delta0) + dot(delta1, delta1) + dot(delta2, delta2)) / 3.0;
      let weight = exp(-patchDistance / max(threshold, 0.000001));
      sum += candidate * weight;
      total += weight;
    }
  }
  return mix(center, sum / max(total, 0.000001), ${p("blend")}.x);`,
    looks: [
      "Fine texture relief",
      { radius: 2, similarity: 0.12, blend: 0.75 },
      "Repeated pattern cleanup",
      { radius: 5, similarity: 0.25, blend: 0.95 },
    ],
  },
  {
    id: "owned-quadrant-variance-paint",
    name: "Quadrant Variance Paint",
    kind: "processor",
    backdrop: true,
    mechanism: "Select the lowest-variance mean from four local quadrants",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      radius: cssPixels("Region radius", 5, 24),
      colorWeight: catalogFloat("Color preference", 0.6, 0, 2),
      blend: fraction("Blend", 0.9),
    },
    fragment: (p) => `
  let center = sampleSource(input.uv);
  let stepUv = ${p("radius")}.x * globals.clock.z * globals.viewport.zw;
  var bestScore = 1000000.0;
  var bestMean = center;
  for (var quadrant = 0u; quadrant < 4u; quadrant += 1u) {
    let signX = select(-1.0, 1.0, (quadrant & 1u) != 0u);
    let signY = select(-1.0, 1.0, (quadrant & 2u) != 0u);
    var sum = vec4f(0.0);
    var lumaSquare = 0.0;
    var colorSquare = 0.0;
    for (var row = 0u; row < 2u; row += 1u) {
      for (var column = 0u; column < 2u; column += 1u) {
        let displacement = vec2f(signX * (f32(column) + 0.25), signY * (f32(row) + 0.25));
        let sample = sampleSource(input.uv + displacement * stepUv * 0.5);
        let luma = dot(sample.rgb, vec3f(0.2126, 0.7152, 0.0722));
        sum += sample;
        lumaSquare += luma * luma;
        colorSquare += dot(sample.rgb, sample.rgb) + sample.a * sample.a;
      }
    }
    let mean = sum * 0.25;
    let meanLuma = dot(mean.rgb, vec3f(0.2126, 0.7152, 0.0722));
    let lumaVariance = max(lumaSquare * 0.25 - meanLuma * meanLuma, 0.0);
    let colorVariance = max(colorSquare * 0.25 - dot(mean, mean), 0.0);
    let score = lumaVariance + ${p("colorWeight")}.x * colorVariance;
    if (score < bestScore) { bestScore = score; bestMean = mean; }
  }
  return mix(center, bestMean, ${p("blend")}.x);`,
    looks: [
      "Quiet brush",
      { radius: 3, colorWeight: 0.35, blend: 0.7 },
      "Broad planes",
      { radius: 12, colorWeight: 1.2, blend: 1 },
    ],
  },
  {
    id: "owned-chroma-hold",
    name: "Chroma Hold",
    kind: "processor",
    backdrop: true,
    mechanism:
      "Coarse opponent chroma sampling while retaining pixel luminance",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      cellWidth: cssPixels("Chroma width", 8, 64),
      cellHeight: cssPixels("Chroma height", 4, 64),
      blend: fraction("Blend", 0.85),
    },
    fragment: (p) => `
  let center = sampleSource(input.uv);
  let cell = max(vec2f(${p("cellWidth")}.x, ${p("cellHeight")}.x) * globals.clock.z, vec2f(1.0));
  let cellCenter = (floor(input.uv * globals.viewport.xy / cell) + vec2f(0.5)) * cell * globals.viewport.zw;
  let held = sampleSource(cellCenter);
  let currentRgb = straight(center);
  let heldRgb = straight(held);
  let luma = (currentRgb.r + 2.0 * currentRgb.g + currentRgb.b) * 0.25;
  let co = heldRgb.r - heldRgb.b;
  let cg = heldRgb.g - (heldRgb.r + heldRgb.b) * 0.5;
  let base = luma - cg * 0.5;
  let proposed = vec3f(base + co * 0.5, luma + cg * 0.5, base - co * 0.5);
  let delta = proposed - vec3f(luma);
  let towardWhite = (vec3f(1.0) - vec3f(luma)) / max(delta, vec3f(0.00001));
  let towardBlack = vec3f(luma) / max(-delta, vec3f(0.00001));
  let limits = select(towardBlack, towardWhite, delta >= vec3f(0.0));
  let gamutScale = clamp(min(limits.x, min(limits.y, limits.z)), 0.0, 1.0);
  let reconstructed = vec3f(luma) + delta * gamutScale;
  return mix(center, vec4f(reconstructed * center.a, center.a), ${p("blend")}.x);`,
    looks: [
      "Soft chroma grid",
      { cellWidth: 5, cellHeight: 4, blend: 0.65 },
      "Wide color hold",
      { cellWidth: 22, cellHeight: 10, blend: 1 },
    ],
  },
  {
    id: "owned-mosaic-sensor",
    name: "Mosaic Sensor",
    kind: "processor",
    backdrop: true,
    mechanism:
      "Channel-selective 2×2 sensor sampling with local demosaic reconstruction",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      cell: cssPixels("Sensor cell", 3, 12),
      phase: {
        type: "enum",
        label: "Color-filter phase",
        default: "RGGB",
        options: ["RGGB", "GRBG", "GBRG", "BGGR"],
      },
      blend: fraction("Blend", 0.9),
    },
    fragment: (p) => `
  let center = sampleSource(input.uv);
  let cell = max(${p("cell")}.x * globals.clock.z, 1.0);
  let pixel = input.uv * globals.viewport.xy;
  let tile = vec2i(floor(pixel / cell));
  let phase = i32(${p("phase")}.x);
  var sum = vec3f(0.0);
  var weightSum = vec3f(0.0);
  for (var y = -1i; y <= 1i; y += 1i) {
    for (var x = -1i; x <= 1i; x += 1i) {
      let site = tile + vec2i(x, y);
      let uv = (vec2f(site) + vec2f(0.5)) * cell * globals.viewport.zw;
      let sample = sampleSource(uv);
      let parity = (site.x & 1i) + ((site.y & 1i) << 1u);
      let red = select(0.0, 1.0, parity == phase);
      let blue = select(0.0, 1.0, parity == (phase ^ 3i));
      let mask = vec3f(red, 1.0 - red - blue, blue);
      let spatial = select(0.5, 1.0, x == 0i) * select(0.5, 1.0, y == 0i);
      let weight = mask * spatial * sample.a;
      sum += straight(sample) * weight;
      weightSum += weight;
    }
  }
  let reconstructed = sum / max(weightSum, vec3f(0.00001));
  return mix(center, vec4f(reconstructed * center.a, center.a), ${p("blend")}.x);`,
    looks: [
      "Fine color array",
      { cell: 2, phase: "RGGB", blend: 0.8 },
      "Coarse alternate array",
      { cell: 6, phase: "GBRG", blend: 1 },
    ],
  },
  {
    id: "owned-haar-band-remix",
    name: "Haar Band Remix",
    kind: "processor",
    backdrop: true,
    mechanism:
      "2×2 Haar analysis and inverse reconstruction of three directional subbands",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      block: cssPixels("Block width", 3, 24),
      horizontal: catalogFloat("Horizontal band", 1, 0, 2),
      vertical: catalogFloat("Vertical band", 1, 0, 2),
      diagonal: catalogFloat("Diagonal band", 1, 0, 2),
      blend: fraction("Blend", 1),
    },
    fragment: (p) => `
  let center = sampleSource(input.uv);
  let block = max(${p("block")}.x * globals.clock.z, 1.0);
  let local = input.uv * globals.viewport.xy / block;
  let origin = floor(local) * block;
  let a = sampleSource((origin + vec2f(0.25, 0.25) * block) * globals.viewport.zw);
  let b = sampleSource((origin + vec2f(0.75, 0.25) * block) * globals.viewport.zw);
  let c = sampleSource((origin + vec2f(0.25, 0.75) * block) * globals.viewport.zw);
  let d = sampleSource((origin + vec2f(0.75, 0.75) * block) * globals.viewport.zw);
  let low = (a + b + c + d) * 0.25;
  let horizontal = (a - b + c - d) * 0.25 * ${p("horizontal")}.x;
  let vertical = (a + b - c - d) * 0.25 * ${p("vertical")}.x;
  let diagonal = (a - b - c + d) * 0.25 * ${p("diagonal")}.x;
  let side = select(-1.0, 1.0, fract(local.x) < 0.5);
  let row = select(-1.0, 1.0, fract(local.y) < 0.5);
  let originalHorizontal = (a - b + c - d) * 0.25;
  let originalVertical = (a + b - c - d) * 0.25;
  let originalDiagonal = (a - b - c + d) * 0.25;
  let reconstructed = center + side * (horizontal - originalHorizontal) + row * (vertical - originalVertical) + side * row * (diagonal - originalDiagonal);
  let alpha = clamp(reconstructed.a, 0.0, 1.0);
  let bounded = vec4f(clamp(reconstructed.rgb, vec3f(0.0), vec3f(alpha)), alpha);
  return mix(center, bounded, ${p("blend")}.x);`,
    looks: [
      "Directional softening",
      { block: 4, horizontal: 0.2, vertical: 1, diagonal: 0.2 },
      "Cross-detail lift",
      { block: 7, horizontal: 1.6, vertical: 1.6, diagonal: 0.35 },
    ],
  },
  {
    id: "owned-cassini-field-atlas",
    name: "Cassini Field Atlas",
    kind: "generator",
    mechanism:
      "Two-focus product-distance level field with a one-to-two-lobe transition",
    properties: {
      palette: catalogPalette(),
      focusGap: catalogFloat("Focus gap", 0.38, 0, 1.2),
      levels: catalogFloat("Contour density", 10, 2, 30),
      lineWidth: catalogFloat("Contour width", 0.18, 0.02, 0.48),
      spread: catalogFloat("Palette spread", 0.8, 0.2, 2),
    },
    fragment: (p) => `
  let aspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let q = (input.uv - vec2f(0.5)) * vec2f(aspect, 1.0);
  let focus = vec2f(${p("focusGap")}.x * 0.5, 0.0);
  let field = sqrt(length(q - focus) * length(q + focus));
  let bands = field * ${p("levels")}.x;
  let gap = abs(fract(bands + 0.5) - 0.5);
  let line = 1.0 - smoothstep(${p("lineWidth")}.x, ${p("lineWidth")}.x + max(fwidth(bands), 0.001), gap);
  let base = paletteAt(clamp(field * ${p("spread")}.x, 0.0, 1.0));
  let accent = paletteAt(clamp(field * ${p("spread")}.x + 0.22, 0.0, 1.0));
  return mix(base, accent, line);`,
    looks: [
      "Joined ovals",
      { focusGap: 0.2, levels: 12, lineWidth: 0.11, spread: 0.7 },
      "Twin islands",
      { focusGap: 0.9, levels: 8, lineWidth: 0.3, spread: 1.4 },
    ],
  },
];

export const OWNED_NEXT_SIX_DEFINITIONS: EffectDefinition[] =
  OWNED_NEXT_SIX_DRAFTS.map((draft) => {
    const definition = catalogShader(draft);
    return {
      ...definition,
      provenance: {
        origin: "design-original",
        note: `Original Design mechanism: ${draft.mechanism}.`,
      },
    };
  });

export const OWNED_NEXT_SIX_PRESETS: EffectPreset[] =
  OWNED_NEXT_SIX_DRAFTS.flatMap((draft) => {
    const [firstName, firstParams, secondName, secondParams] = draft.looks;
    const preset = (
      variant: "subtle" | "expressive",
      name: string,
      params: Record<string, EffectValue>,
    ): EffectPreset => ({
      id: `an-preset-${draft.id}-${variant}`,
      name,
      definitionId: `an-native-${draft.id}`,
      definitionVersion: 1,
      placement: draft.kind === "generator" ? "fill" : "layer",
      params,
      clip: "bounds",
      provenance: { origin: "design-original" },
    });
    return [
      preset("subtle", firstName, firstParams),
      preset("expressive", secondName, secondParams),
    ];
  });
