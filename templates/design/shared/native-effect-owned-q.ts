import {
  catalogColor,
  catalogFloat,
  catalogShader,
  type CatalogShaderSpec,
} from "./native-effect-catalog-kit";
import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type {
  EffectDefinition,
  EffectPreset,
  EffectProperty,
  EffectValue,
} from "./native-effects";

type Look = readonly [string, Record<string, EffectValue>];
type Draft = Omit<CatalogShaderSpec, "kind"> & {
  kind: "generator" | "processor";
  mechanism: string;
  cost: string;
  looks: readonly [Look, Look];
};

const float = (
  label: string,
  value: number,
  min: number,
  max: number,
  step = 0.01,
): Extract<EffectProperty, { type: "float" | "int" }> & { type: "float" } =>
  catalogFloat(label, value, min, max, step);
const pixels = (
  label: string,
  value: number,
  min: number,
  max: number,
): EffectProperty => ({
  ...float(label, value, min, max, 0.1),
  unit: "px",
});
const color = (
  label: string,
  r: number,
  g: number,
  b: number,
  alpha = 1,
): EffectProperty => ({
  type: "color",
  label,
  default: catalogColor(r, g, b, alpha),
});
const edges: EffectProperty = {
  type: "enum",
  label: "Outside source",
  default: "transparent",
  options: ["transparent", "clamp"],
  advanced: true,
};

const drafts: readonly Draft[] = [
  {
    id: "owned-q-alpha-cast-shadow",
    name: "Alpha Cast Shadow",
    version: 2,
    kind: "processor",
    backdrop: false,
    mechanism:
      "A bounded two-dimensional Gaussian gathers source coverage at an offset, then composites a colored shadow behind the untouched premultiplied source. It follows the source silhouette rather than a synthetic geometric occluder.",
    cost: "26 source reads per physical output pixel, fixed five-by-five support; maximum declared expansion 42 CSS px on each side.",
    properties: {
      edge: structuredClone(edges),
      shadowColor: color("Shadow color", 0.02, 0.035, 0.075, 0.8),
      radius: pixels("Softness", 7, 0, 18),
      offsetX: pixels("Horizontal offset", 8, -24, 24),
      offsetY: pixels("Vertical offset", 10, -24, 24),
      strength: float("Strength", 0.85, 0, 1),
    },
    fragment: (p) => `
  let base = sampleSource(input.uv);
  if (${p("strength")}.x <= 0.0 || ${p("shadowColor")}.a <= 0.0) { return base; }
  let offsetUv = vec2f(${p("offsetX")}.x, ${p("offsetY")}.x) * globals.clock.z * globals.viewport.zw;
  let radiusUv = ${p("radius")}.x * globals.clock.z * globals.viewport.zw;
  var alphaSum = 0.0;
  var weightSum = 0.0;
  for (var row = -2; row <= 2; row += 1) {
    for (var column = -2; column <= 2; column += 1) {
      let distanceSquared = f32(row * row + column * column);
      let weight = exp(-distanceSquared * 0.5);
      let displaced = input.uv - offsetUv + vec2f(f32(column), f32(row)) * radiusUv * 0.5;
      alphaSum += sampleSource(displaced).a * weight;
      weightSum += weight;
    }
  }
  let shadowAlpha = clamp(alphaSum / weightSum * ${p("shadowColor")}.a * ${p("strength")}.x, 0.0, 1.0);
  let behind = shadowAlpha * (1.0 - base.a);
  return vec4f(base.rgb + ${p("shadowColor")}.rgb * behind, base.a + behind);`,
    looks: [
      ["Soft lift", { radius: 7, offsetX: 5, offsetY: 9, strength: 0.65 }],
      [
        "Long violet",
        {
          radius: 15,
          offsetX: -18,
          offsetY: 17,
          strength: 1,
          shadowColor: catalogColor(0.16, 0.06, 0.3, 0.9),
        },
      ],
    ],
  },
  {
    id: "owned-q-gabor-packets",
    name: "Gabor Packets",
    kind: "generator",
    mechanism:
      "Overlapping finite Gaussian envelopes carry oriented sinusoidal waves. A deterministic per-cell phase and angular perturbation creates anisotropic local texture rather than isotropic value/fractal noise.",
    cost: "Nine Gaussian wave packets per physical output pixel, with fixed three-by-three neighboring-cell support.",
    properties: {
      cellSize: pixels("Packet spacing", 58, 24, 96),
      wavelength: pixels("Wavelength", 18, 7, 45),
      direction: float("Direction", 0.2, -3.14159, 3.14159),
      scatter: float("Angular scatter", 0.35, 0, 1),
      contrast: float("Contrast", 1.2, 0, 2),
      dark: color("Dark", 0.055, 0.11, 0.16),
      light: color("Light", 0.72, 0.86, 0.8),
    },
    fragment: (p) => `
  let position = input.uv * globals.viewport.xy / globals.clock.z;
  let spacing = ${p("cellSize")}.x;
  let cell = floor(position / spacing);
  let sigma = spacing * 0.38;
  var signal = 0.0;
  var energy = 0.0;
  for (var row = -1; row <= 1; row += 1) {
    for (var column = -1; column <= 1; column += 1) {
      let site = cell + vec2f(f32(column), f32(row));
      let delta = position - (site + vec2f(0.5)) * spacing;
      let envelope = exp(-dot(delta, delta) / (2.0 * sigma * sigma));
      let orientation = ${p("direction")}.x + ${p("scatter")}.x * sin(dot(site, vec2f(1.173, 2.091)) + globals.clock.y * 0.173);
      let axis = vec2f(cos(orientation), sin(orientation));
      let phase = 6.28318530718 * fract(sin(dot(site, vec2f(3.713, 5.291)) + globals.clock.y * 0.117) * 173.3187);
      signal += envelope * cos(6.28318530718 * dot(delta, axis) / ${p("wavelength")}.x + phase);
      energy += envelope;
    }
  }
  let tone = clamp(0.5 + 0.5 * signal / max(energy, 0.00001) * ${p("contrast")}.x, 0.0, 1.0);
  let low = ${p("dark")};
  let high = ${p("light")};
  return mix(vec4f(low.rgb * low.a, low.a), vec4f(high.rgb * high.a, high.a), tone);`,
    looks: [
      [
        "Directional silk",
        {
          cellSize: 62,
          wavelength: 16,
          direction: 0.1,
          scatter: 0.12,
          contrast: 1.1,
        },
      ],
      [
        "Crosswind grain",
        {
          cellSize: 34,
          wavelength: 9,
          direction: 1.5,
          scatter: 0.8,
          contrast: 1.8,
          dark: catalogColor(0.09, 0.045, 0.12),
          light: catalogColor(0.9, 0.58, 0.7),
        },
      ],
    ],
  },
  {
    id: "owned-q-haar-detail-field",
    name: "Haar Detail Field",
    kind: "generator",
    mechanism:
      "Four dyadic scales of signed, localized Haar-like quadrant functions form a zero-mean multiresolution field. Per-cell coefficients, compact support, and footprint-softened internal seams distinguish it from interpolated fractal noise.",
    cost: "Four fixed dyadic bands per pixel, no neighbor taps or mutable state.",
    properties: {
      coarseSize: pixels("Coarse cell", 96, 24, 192),
      persistence: float("Detail persistence", 0.52, 0.2, 0.85),
      contrast: float("Contrast", 1.3, 0, 2),
      phaseX: pixels("Horizontal phase", 0, -128, 128),
      phaseY: pixels("Vertical phase", 0, -128, 128),
      low: color("Low", 0.04, 0.09, 0.14),
      high: color("High", 0.85, 0.83, 0.68),
    },
    fragment: (p) => `
  let position = input.uv * globals.viewport.xy / globals.clock.z + vec2f(${p("phaseX")}.x, ${p("phaseY")}.x);
  var wave = 0.0;
  var amplitude = 1.0;
  var normalization = 0.0;
  for (var octave = 0; octave < 4; octave += 1) {
    let size = ${p("coarseSize")}.x / exp2(f32(octave));
    let q = position / size;
    let cell = floor(q);
    let local = fract(q);
    let feather = min(0.12, 1.0 / max(size * globals.clock.z, 1.0));
    let signX = 1.0 - 2.0 * smoothstep(0.5 - feather, 0.5 + feather, local.x);
    let signY = 1.0 - 2.0 * smoothstep(0.5 - feather, 0.5 + feather, local.y);
    let envelope = sin(3.14159265 * local.x) * sin(3.14159265 * local.y);
    let coefficient = 2.0 * random(vec2i(cell) + vec2i(octave * 401, octave * 719)) - 1.0;
    wave += coefficient * signX * signY * envelope * envelope * amplitude;
    normalization += amplitude;
    amplitude *= ${p("persistence")}.x;
  }
  let tone = clamp(0.5 + wave / max(normalization, 0.00001) * ${p("contrast")}.x, 0.0, 1.0);
  let low = ${p("low")};
  let high = ${p("high")};
  return mix(vec4f(low.rgb * low.a, low.a), vec4f(high.rgb * high.a, high.a), tone);`,
    looks: [
      ["Large fibers", { coarseSize: 150, persistence: 0.35, contrast: 1.15 }],
      [
        "Fine relief",
        {
          coarseSize: 62,
          persistence: 0.72,
          contrast: 1.75,
          low: catalogColor(0.08, 0.06, 0.16),
          high: catalogColor(0.85, 0.72, 0.92),
        },
      ],
    ],
  },
  {
    id: "owned-q-star-cutout",
    name: "Star Cutout",
    kind: "generator",
    mechanism:
      "The signed distance to an alternating-radius simple polygon is obtained from the nearest of up to 32 line segments and a winding crossing test, then used for independent fill, outline, and antialias coverage.",
    cost: "Up to 32 bounded polygon segments per output pixel; no textures or live media.",
    properties: {
      tips: {
        type: "int",
        label: "Points",
        default: 6,
        min: 4,
        max: 16,
        step: 1,
      },
      radius: pixels("Outer radius", 92, 8, 280),
      innerRatio: float("Inner radius", 0.48, 0.15, 0.85),
      rotation: float("Rotation", -1.5708, -3.14159, 3.14159),
      centerX: float("Center X", 0.5, 0, 1),
      centerY: float("Center Y", 0.5, 0, 1),
      outline: pixels("Outline", 2, 0, 24),
      fillColor: color("Fill", 0.96, 0.72, 0.24),
      outlineColor: color("Outline color", 0.12, 0.08, 0.18),
      background: color("Background", 0, 0, 0, 0),
    },
    fragment: (p) => `
  let physical = globals.viewport.xy / globals.clock.z;
  let point = input.uv * physical - vec2f(${p("centerX")}.x, ${p("centerY")}.x) * physical;
  let total = i32(${p("tips")}.x) * 2;
  var distanceToEdge = 1e9;
  var inside = false;
  for (var index = 0; index < 32; index += 1) {
    if (index >= total) { break; }
    let next = (index + 1) % total;
    let angleA = ${p("rotation")}.x + 3.14159265 * f32(index) / f32(${p("tips")}.x);
    let angleB = ${p("rotation")}.x + 3.14159265 * f32(next) / f32(${p("tips")}.x);
    let radiusA = select(${p("radius")}.x * ${p("innerRatio")}.x, ${p("radius")}.x, index % 2 == 0);
    let radiusB = select(${p("radius")}.x * ${p("innerRatio")}.x, ${p("radius")}.x, next % 2 == 0);
    let a = vec2f(cos(angleA), sin(angleA)) * radiusA;
    let b = vec2f(cos(angleB), sin(angleB)) * radiusB;
    let segment = b - a;
    let fraction = clamp(dot(point - a, segment) / max(dot(segment, segment), 0.00001), 0.0, 1.0);
    distanceToEdge = min(distanceToEdge, length(point - a - segment * fraction));
    if ((a.y > point.y) != (b.y > point.y)) {
      let crossing = a.x + (point.y - a.y) * (b.x - a.x) / (b.y - a.y);
      if (crossing > point.x) { inside = !inside; }
    }
  }
  let signedDistance = select(distanceToEdge, -distanceToEdge, inside);
  let antialias = 0.75 / globals.clock.z;
  let fillCoverage = 1.0 - smoothstep(-antialias, antialias, signedDistance);
  let outlineCoverage = select(0.0, 1.0 - smoothstep(${p("outline")}.x - antialias, ${p("outline")}.x + antialias, abs(signedDistance)), ${p("outline")}.x > 0.0);
  let background = ${p("background")};
  let fill = ${p("fillColor")};
  let line = ${p("outlineColor")};
  let fillAlpha = fill.a * fillCoverage;
  let base = vec4f(fill.rgb * fillAlpha + background.rgb * background.a * (1.0 - fillAlpha), fillAlpha + background.a * (1.0 - fillAlpha));
  let lineAlpha = line.a * outlineCoverage;
  return vec4f(line.rgb * lineAlpha + base.rgb * (1.0 - lineAlpha), lineAlpha + base.a * (1.0 - lineAlpha));`,
    looks: [
      ["Gold emblem", { tips: 6, innerRatio: 0.48, outline: 3, radius: 100 }],
      [
        "Narrow sparks",
        {
          tips: 11,
          innerRatio: 0.22,
          outline: 0,
          radius: 76,
          fillColor: catalogColor(0.55, 0.84, 1, 0.82),
        },
      ],
    ],
  },
  {
    id: "owned-q-checker-phase",
    name: "Checker Phase",
    kind: "generator",
    mechanism:
      "The parity of two orthogonal lattice coordinates produces a two-color checker field; rotation, independent phase, physical cell size, and analytically softened crossing lines retain exact tile identity without noise or moire interference.",
    cost: "Constant arithmetic per pixel, no texture reads.",
    properties: {
      tileSize: pixels("Tile size", 34, 4, 160),
      rotation: float("Rotation", 0, -3.14159, 3.14159),
      phaseX: pixels("Horizontal phase", 0, -160, 160),
      phaseY: pixels("Vertical phase", 0, -160, 160),
      softness: pixels("Boundary softness", 0.8, 0, 10),
      first: color("First tile", 0.08, 0.12, 0.16),
      second: color("Second tile", 0.88, 0.81, 0.66),
    },
    fragment: (p) => `
  let physical = input.uv * globals.viewport.xy / globals.clock.z;
  let point = physical + vec2f(${p("phaseX")}.x, ${p("phaseY")}.x);
  let angle = ${p("rotation")}.x;
  let rotated = vec2f(cos(angle) * point.x - sin(angle) * point.y, sin(angle) * point.x + cos(angle) * point.y);
  let cell = rotated / ${p("tileSize")}.x;
  let checker = sin(3.14159265 * cell.x) * sin(3.14159265 * cell.y);
  let footprint = 1.5 / max(${p("tileSize")}.x * globals.clock.z, 1.0);
  let edgeWidth = max(footprint, ${p("softness")}.x / ${p("tileSize")}.x);
  let blend = smoothstep(-edgeWidth, edgeWidth, checker);
  let first = ${p("first")};
  let second = ${p("second")};
  return mix(vec4f(first.rgb * first.a, first.a), vec4f(second.rgb * second.a, second.a), blend);`,
    looks: [
      [
        "Quiet checks",
        {
          tileSize: 42,
          softness: 1.2,
          first: catalogColor(0.08, 0.12, 0.16),
          second: catalogColor(0.84, 0.82, 0.71),
        },
      ],
      [
        "Tilted acetate",
        {
          tileSize: 16,
          rotation: 0.38,
          phaseX: 9,
          phaseY: -6,
          softness: 2.5,
          first: catalogColor(0.1, 0.48, 0.7, 0.7),
          second: catalogColor(0.82, 0.16, 0.42, 0.55),
        },
      ],
    ],
  },
];

function blockTransformDefinition(): EffectDefinition {
  const properties: Record<string, EffectProperty> = {
    quantization: float("Coefficient step", 0.045, 0, 0.25, 0.001),
    frequencyBias: float("Fine detail loss", 0.7, 0, 2),
    amount: float("Mix", 0.85, 0, 1),
  };
  const basis = `
fn dctBasis(sampleIndex: f32, frequency: f32) -> f32 {
  let normalization = select(0.70710678118, 0.5, frequency == 0.0);
  return normalization * cos((2.0 * sampleIndex + 1.0) * frequency * 3.14159265359 / 8.0);
}
fn sourceAt(pixel: vec2f) -> vec4f {
  let clamped = clamp(pixel, vec2f(0.0), globals.viewport.xy - vec2f(1.0));
  return textureSampleLevel(sourceTexture, effectSampler, (clamped + vec2f(0.5)) * globals.viewport.zw, 0.0);
}
`;
  const analyze = `${NATIVE_RENDER_GLOBALS}${basis}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let pixel = floor(input.uv * globals.viewport.xy);
  let origin = floor(pixel / 4.0) * 4.0;
  let frequency = pixel - origin;
  var coefficient = vec4f(0.0);
  for (var row = 0; row < 4; row += 1) {
    for (var column = 0; column < 4; column += 1) {
      let sample = sourceAt(origin + vec2f(f32(column), f32(row)));
      let weight = dctBasis(f32(column), frequency.x) * dctBasis(f32(row), frequency.y);
      coefficient += sample * weight;
    }
  }
  return coefficient;
}
`;
  const reconstruct = `${NATIVE_RENDER_GLOBALS}${basis}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let pixel = floor(input.uv * globals.viewport.xy);
  let original = sourceAt(pixel);
  if (original.a <= 0.00001 || globals.params[2].x <= 0.0 || globals.params[0].x <= 0.0) { return original; }
  let origin = floor(pixel / 4.0) * 4.0;
  if (any(origin + vec2f(4.0) > globals.viewport.xy)) { return original; }
  let local = pixel - origin;
  var decoded = vec4f(0.0);
  for (var row = 0; row < 4; row += 1) {
    for (var column = 0; column < 4; column += 1) {
      let location = origin + vec2f(f32(column), f32(row));
      if (any(location >= globals.viewport.xy)) { continue; }
      let coefficient = textureSampleLevel(maskTexture, effectSampler, (location + vec2f(0.5)) * globals.viewport.zw, 0.0);
      let frequency = f32(column + row);
      let stepSize = globals.params[0].x * (1.0 + globals.params[1].x * frequency);
      let stepped = round(coefficient / stepSize) * stepSize;
      decoded += stepped * dctBasis(local.x, f32(column)) * dctBasis(local.y, f32(row));
    }
  }
  let straight = select(original.rgb / original.a, max(decoded.rgb / max(decoded.a, 0.00001), vec3f(0.0)), decoded.a > 0.00001);
  let altered = vec4f(straight * original.a, original.a);
  return mix(original, altered, globals.params[2].x);
}
`;
  return {
    id: "an-native-owned-q-block-transform",
    name: "Block Transform",
    version: 2,
    kind: "processor",
    placements: ["layer", "backdrop"],
    properties,
    inputs: { source: { kind: "texture-2d", resource: "source" } },
    outputs: { color: { kind: "texture-2d", resource: "color" } },
    output: "color",
    resources: [
      {
        name: "source",
        kind: "texture-2d",
        usage: ["sampled"],
        external: true,
        size: "viewport",
      },
      {
        name: "coefficients",
        kind: "texture-2d",
        format: "rgba16float",
        usage: ["render", "sampled"],
        size: "viewport",
      },
      {
        name: "color",
        kind: "texture-2d",
        format: "rgba16float",
        usage: ["render", "sampled"],
        size: "viewport",
      },
    ],
    passes: [
      {
        id: "analyze",
        kind: "render",
        reads: ["source"],
        output: "coefficients",
        wgsl: analyze,
      },
      {
        id: "reconstruct",
        kind: "render",
        reads: ["source", "coefficients"],
        output: "color",
        wgsl: reconstruct,
      },
    ],
    provenance: {
      origin: "design-original",
      note: "Original four-by-four orthonormal spatial transform and coefficient quantization in linear-premultiplied working color. Incomplete edge blocks preserve the source exactly.",
    },
  };
}

function definitionFor(draft: Draft): EffectDefinition {
  const base = catalogShader(draft);
  return {
    ...base,
    resources: base.resources?.map((resource) =>
      resource.name === "color"
        ? { ...resource, format: "rgba16float" }
        : resource,
    ),
    extent:
      draft.id === "owned-q-alpha-cast-shadow"
        ? { output: { top: 42, right: 42, bottom: 42, left: 42 } }
        : undefined,
    provenance: { origin: "design-original", note: draft.mechanism },
  };
}

export const OWNED_Q_DRAFTS = drafts;
export const OWNED_Q_DEFINITIONS: readonly EffectDefinition[] = [
  definitionFor(drafts[0]),
  blockTransformDefinition(),
  ...drafts.slice(1).map(definitionFor),
];
export const OWNED_Q_PRESETS: readonly EffectPreset[] = [
  ...drafts.flatMap((draft) =>
    draft.looks.map(([name, params], index) => ({
      id: `an-preset-${draft.id}-${index + 1}`,
      name,
      definitionId: `an-native-${draft.id}`,
      definitionVersion: draft.version ?? 1,
      placement:
        draft.kind === "generator" ? ("fill" as const) : ("layer" as const),
      params,
      clip: "bounds" as const,
      provenance: { origin: "design-original" as const },
    })),
  ),
  {
    id: "an-preset-owned-q-block-transform-1",
    name: "Gentle quantization",
    definitionId: "an-native-owned-q-block-transform",
    definitionVersion: 2,
    placement: "layer",
    params: { quantization: 0.025, frequencyBias: 0.25, amount: 0.55 },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-q-block-transform-2",
    name: "Hard blocks",
    definitionId: "an-native-owned-q-block-transform",
    definitionVersion: 2,
    placement: "layer",
    params: { quantization: 0.14, frequencyBias: 1.6, amount: 1 },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
