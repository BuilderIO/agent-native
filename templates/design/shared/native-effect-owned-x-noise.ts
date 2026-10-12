import {
  CATALOG_PALETTES,
  catalogFloat,
  catalogPalette,
  catalogShader,
  type CatalogShaderSpec,
} from "./native-effect-catalog-kit";
import { DESIGN_OWNED_DYNAMICS_DEFINITIONS } from "./native-effect-owned-dynamics";
import type {
  EffectDefinition,
  EffectPreset,
  EffectProperty,
  EffectValue,
} from "./native-effects";

type Look = readonly [string, Record<string, EffectValue>];
type Draft = CatalogShaderSpec & {
  mechanism: string;
  looks: readonly [Look, Look];
};

const f = (
  label: string,
  value: number,
  min: number,
  max: number,
): EffectProperty => catalogFloat(label, value, min, max);
const seed = (): EffectProperty => ({
  type: "int",
  label: "Seed",
  default: 17,
  min: 0,
  max: 65535,
  step: 1,
});
const colors = (palette = CATALOG_PALETTES.lagoon) => ({
  palette: catalogPalette(palette),
  seed: seed(),
  contrast: f("Contrast", 1.15, 0.1, 3),
  balance: f("Balance", 0, -0.5, 0.5),
});

const stableNoiseHelpers = `
fn stableHash(cell: vec2i) -> u32 {
  var bits = (bitcast<u32>(cell.x) * 2246822519u) ^ (bitcast<u32>(cell.y) * 3266489917u);
  bits = (bits ^ (bits >> 15u)) * 668265263u;
  bits = (bits ^ (bits >> 13u)) * 2246822519u;
  return bits ^ (bits >> 16u);
}
fn stableRandom(cell: vec2i) -> f32 {
  return f32(stableHash(cell) >> 8u) / 16777216.0;
}
`;

const gradientHelpers =
  stableNoiseHelpers +
  `
fn gradientCell(cell: vec3i) -> vec3f {
  let hash = stableHash(vec2i(cell.x + cell.z * 15731, cell.y + cell.z * 789221));
  let components = vec3f(
    f32(hash & 1023u),
    f32((hash >> 10u) & 1023u),
    f32((hash >> 20u) & 1023u)
  ) / 511.5 - vec3f(1.0);
  return normalize(components + vec3f(0.0001, 0.0002, 0.0003));
}
fn gradientPerlin(point: vec3f) -> f32 {
  let cell = vec3i(floor(point));
  let local = fract(point);
  let fade = local * local * local * (local * (local * 6.0 - vec3f(15.0)) + vec3f(10.0));
  var signal = 0.0;
  for (var z = 0; z <= 1; z += 1) {
    for (var y = 0; y <= 1; y += 1) {
      for (var x = 0; x <= 1; x += 1) {
        let offset = vec3i(x, y, z);
        let displacement = local - vec3f(offset);
        let weight = select(1.0 - fade.x, fade.x, x == 1) *
          select(1.0 - fade.y, fade.y, y == 1) *
          select(1.0 - fade.z, fade.z, z == 1);
        signal += dot(gradientCell(cell + offset), displacement) * weight;
      }
    }
  }
  return signal;
}
fn simplexCorner(cell: vec3i, offset: vec3f) -> f32 {
  let support = max(0.6 - dot(offset, offset), 0.0);
  return support * support * support * support * dot(gradientCell(cell), offset);
}
fn latticeSimplex(point: vec3f) -> f32 {
  let skew = (point.x + point.y + point.z) / 3.0;
  let cell = vec3i(floor(point + vec3f(skew)));
  let unskew = f32(cell.x + cell.y + cell.z) / 6.0;
  let local = point - (vec3f(cell) - vec3f(unskew));
  var first = vec3i(0);
  var second = vec3i(0);
  if (local.x >= local.y) {
    if (local.y >= local.z) { first = vec3i(1, 0, 0); second = vec3i(1, 1, 0); }
    else if (local.x >= local.z) { first = vec3i(1, 0, 0); second = vec3i(1, 0, 1); }
    else { first = vec3i(0, 0, 1); second = vec3i(1, 0, 1); }
  } else {
    if (local.y < local.z) { first = vec3i(0, 0, 1); second = vec3i(0, 1, 1); }
    else if (local.x < local.z) { first = vec3i(0, 1, 0); second = vec3i(0, 1, 1); }
    else { first = vec3i(0, 1, 0); second = vec3i(1, 1, 0); }
  }
  return 32.0 * (
    simplexCorner(cell, local) +
    simplexCorner(cell + first, local - vec3f(first) + vec3f(1.0 / 6.0)) +
    simplexCorner(cell + second, local - vec3f(second) + vec3f(2.0 / 6.0)) +
    simplexCorner(cell + vec3i(1), local - vec3f(0.5))
  );
}
`;

const currentCurl = DESIGN_OWNED_DYNAMICS_DEFINITIONS.find(
  (definition) => definition.id === "an-native-curl-streamlines",
);
if (!currentCurl || currentCurl.version !== 1)
  throw new Error("The frozen Curl Streamlines predecessor is unavailable");

export const OWNED_X_NOISE_DRAFTS: readonly Draft[] = [
  {
    id: "owned-x-high-pass-speckle",
    name: "High-Pass Speckle",
    kind: "generator",
    mechanism:
      "A static integer pixel lattice subtracts a four-neighbor local mean from seeded white speckle, suppressing low spatial frequencies without claiming a blue-noise distribution.",
    properties: {
      ...colors(CATALOG_PALETTES.ink),
      grainSize: f("Grain size", 2, 1, 10),
    },
    helpers: () => stableNoiseHelpers,
    fragment: (p) => `
  let scale = max(${p("grainSize")}.x * globals.clock.z, 1.0);
  let cell = vec2i(floor(input.uv * globals.viewport.xy / scale));
  let seedOffset = vec2i(i32(${p("seed")}.x), 917);
  let center = stableRandom(cell + seedOffset);
  let surround = (stableRandom(cell + seedOffset + vec2i(1, 0)) +
    stableRandom(cell + seedOffset + vec2i(-1, 0)) +
    stableRandom(cell + seedOffset + vec2i(0, 1)) +
    stableRandom(cell + seedOffset + vec2i(0, -1))) * 0.25;
  let tone = clamp(0.5 + (center - surround) * ${p("contrast")}.x * 0.75 + ${p("balance")}.x, 0.0, 1.0);
  return paletteAt(tone);`,
    looks: [
      ["Fine print speckle", { grainSize: 1, contrast: 1.4 }],
      ["Broad matte grain", { grainSize: 4, contrast: 0.85, seed: 271 }],
    ],
  },
  {
    id: "owned-x-drainage-field",
    name: "Drainage Field",
    kind: "generator",
    mechanism:
      "A static gradient-noise height field traces a few local downhill steps and accents converging channels; it is a drainage pattern, not an erosion simulation.",
    properties: {
      ...colors(CATALOG_PALETTES.ember),
      scale: f("Scale", 4.5, 1, 12),
      channelDepth: f("Channel depth", 0.6, 0, 1),
    },
    helpers: () =>
      gradientHelpers +
      `
fn terrain(point: vec2f) -> f32 {
  var position = point;
  var amplitude = 0.6;
  var value = 0.0;
  for (var octave = 0u; octave < 4u; octave += 1u) {
    value += gradientPerlin(vec3f(position, f32(octave) * 8.1)) * amplitude;
    position = rotate(position, 0.47) * 2.03;
    amplitude *= 0.48;
  }
  return value;
}
fn slope(point: vec2f) -> vec2f {
  let d = vec2f(0.035, 0.0);
  let e = vec2f(0.0, 0.035);
  return vec2f(terrain(point + d) - terrain(point - d),
    terrain(point + e) - terrain(point - e));
}
`,
    fragment: (p) => `
  let aspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let seedOffset = vec2f(${p("seed")}.x * 0.017, ${p("seed")}.x * 0.031);
  let point = (input.uv - vec2f(0.5)) * vec2f(aspect, 1.0) * ${p("scale")}.x + seedOffset;
  var position = point;
  var channel = 0.0;
  for (var step = 0u; step < 3u; step += 1u) {
    let grade = slope(position);
    let direction = grade / max(length(grade), 0.0001);
    position -= direction * 0.11;
    channel += exp(-abs(terrain(position) - terrain(point)) * 8.0) *
      (0.25 + length(grade) * 2.0);
  }
  let elevation = terrain(point);
  let relief = 0.5 + elevation * ${p("contrast")}.x * 0.65 + ${p("balance")}.x;
  let carved = relief - clamp(channel * 0.18, 0.0, 0.35) * ${p("channelDepth")}.x;
  return paletteAt(clamp(carved, 0.0, 1.0));`,
    looks: [
      ["Dry tributaries", { scale: 3.2, channelDepth: 0.45 }],
      ["Deep wash", { scale: 7.2, channelDepth: 0.95, seed: 91 }],
    ],
  },
  {
    id: "owned-x-wavelet-bands",
    name: "Wavelet Bands",
    kind: "generator",
    mechanism:
      "Rotating Gaussian-windowed wave packets combine at several frequency bands; phase advances in time while band spread and octave spacing shape the interference.",
    properties: {
      ...colors(CATALOG_PALETTES.orchid),
      scale: f("Scale", 4.5, 1, 12),
      speed: f("Speed", 0.28, 0, 2),
      bandSpread: f("Band spread", 3.5, 0.5, 9),
    },
    helpers: () => stableNoiseHelpers,
    fragment: (p) => `
  let aspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let point = (input.uv - vec2f(0.5)) * vec2f(aspect, 1.0) * ${p("scale")}.x;
  let time = globals.clock.x * ${p("speed")}.x;
  var signal = 0.0;
  var weight = 0.55;
  var position = point;
  for (var octave = 0u; octave < 4u; octave += 1u) {
    let cell = vec2i(floor(position));
    let jitter = stableRandom(cell + vec2i(i32(${p("seed")}.x), i32(octave) * 71));
    let local = fract(position) - vec2f(0.5);
    let angle = f32(octave) * 1.17 + time * (0.2 + f32(octave) * 0.12);
    let axis = vec2f(cos(angle), sin(angle));
    let envelope = exp(-dot(local, local) * ${p("bandSpread")}.x);
    signal += cos(dot(local, axis) * TAU * 2.0 + jitter * TAU + time) * envelope * weight;
    position = rotate(position, 0.63) * 1.91 + vec2f(3.7, 9.1);
    weight *= 0.57;
  }
  let tone = clamp(0.5 + signal * ${p("contrast")}.x * 0.7 + ${p("balance")}.x, 0.0, 1.0);
  return paletteAt(tone);`,
    looks: [
      ["Soft wavelets", { scale: 3.2, bandSpread: 2.1, speed: 0.18 }],
      [
        "Dense wavelets",
        { scale: 8.1, bandSpread: 6.3, speed: 0.6, seed: 109 },
      ],
    ],
  },
  {
    id: "owned-x-perlin-gradient-field",
    name: "Perlin Gradient Field",
    kind: "generator",
    mechanism:
      "Three-dimensional gradient lattice interpolation uses quintic fade and morphs along its third axis; a second octave adds controllable detail without switching to value noise.",
    properties: {
      ...colors(CATALOG_PALETTES.lagoon),
      scale: f("Scale", 4, 1, 12),
      speed: f("Speed", 0.25, 0, 2),
      detail: f("Detail", 0.35, 0, 1),
    },
    helpers: () => gradientHelpers,
    fragment: (p) => `
  let aspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let position = (input.uv - vec2f(0.5)) * vec2f(aspect, 1.0) * ${p("scale")}.x;
  let time = globals.clock.x * ${p("speed")}.x + ${p("seed")}.x * 0.037;
  let base = gradientPerlin(vec3f(position, time));
  let fine = gradientPerlin(vec3f(rotate(position, 0.73) * 2.03, time * 0.71 + 13.7));
  let tone = clamp(0.5 + (base + fine * ${p("detail")}.x * 0.5) * ${p("contrast")}.x * 0.9 + ${p("balance")}.x, 0.0, 1.0);
  return paletteAt(tone);`,
    looks: [
      ["Gradient fog", { scale: 2.6, detail: 0.15, speed: 0.14 }],
      ["Gradient turbulence", { scale: 7, detail: 0.8, contrast: 1.55 }],
    ],
  },
  {
    id: "owned-x-simplex-lattice",
    name: "Simplex Lattice",
    kind: "generator",
    mechanism:
      "Three-dimensional skewed simplex cells blend four gradient corners and morph continuously through the time axis, distinct from Perlin's gradient lattice interpolation.",
    properties: {
      ...colors(CATALOG_PALETTES.ember),
      scale: f("Scale", 4.8, 1, 12),
      speed: f("Speed", 0.3, 0, 2),
      detail: f("Detail", 0.28, 0, 1),
    },
    helpers: () => gradientHelpers,
    fragment: (p) => `
  let aspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let position = (input.uv - vec2f(0.5)) * vec2f(aspect, 1.0) * ${p("scale")}.x;
  let time = globals.clock.x * ${p("speed")}.x + ${p("seed")}.x * 0.043;
  let base = latticeSimplex(vec3f(position, time));
  let fine = latticeSimplex(vec3f(rotate(position, 0.49) * 2.11, time * 0.79 + 11.3));
  let tone = clamp(0.5 + (base + fine * ${p("detail")}.x * 0.45) * ${p("contrast")}.x * 0.6 + ${p("balance")}.x, 0.0, 1.0);
  return paletteAt(tone);`,
    looks: [
      ["Simplex glow", { scale: 3, detail: 0.1, speed: 0.19 }],
      ["Simplex turbulence", { scale: 8, detail: 0.86, contrast: 1.45 }],
    ],
  },
  {
    id: "curl-streamlines",
    name: "Curl Streamlines",
    version: currentCurl.version + 1,
    kind: "generator",
    mechanism:
      "Keeps the original streamline rendering and adds a curl-magnitude view derived from finite differences of a smooth gradient-noise potential.",
    properties: {
      ...structuredClone(currentCurl.properties),
      fieldMode: {
        type: "enum",
        label: "Field mode",
        default: "streamlines",
        options: ["streamlines", "curl-magnitude"],
      },
      derivativeStep: f("Derivative step", 0.035, 0.005, 0.12),
    },
    helpers: () => gradientHelpers,
    fragment: (p) => `
  let aspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let q = (input.uv - vec2f(0.5)) * vec2f(aspect, 1.0) * ${p("scale")}.x;
  let time = globals.clock.x * ${p("speed")}.x;
  let density = ${p("density")}.x;
  if (u32(${p("fieldMode")}.x) == 0u) {
    var position = q;
    var ink = 0.0;
    for (var step = 0u; step < 12u; step += 1u) {
      let angle = sin(position.y * density + time) + cos(position.x * density * 0.7 - time);
      position += vec2f(cos(angle), sin(angle)) * 0.018;
      ink += exp(-abs(sin(position.x * density * 1.8 - position.y * density * 0.9)) / max(${p("softness")}.x, 0.005));
    }
    return paletteAt(clamp(ink / 8.0, 0.0, 1.0));
  }
  let delta = ${p("derivativeStep")}.x;
  let field = vec3f(q * density * 0.28, time * 0.5);
  let dx = vec3f(delta, 0.0, 0.0);
  let dy = vec3f(0.0, delta, 0.0);
  let dphiDx = (gradientPerlin(field + dx) - gradientPerlin(field - dx)) / (2.0 * delta);
  let dphiDy = (gradientPerlin(field + dy) - gradientPerlin(field - dy)) / (2.0 * delta);
  let curl = vec2f(dphiDy, -dphiDx);
  let magnitude = length(curl);
  let tone = clamp(magnitude * ${p("softness")}.x * 1.4, 0.0, 1.0);
  return paletteAt(tone);`,
    looks: [
      ["Flowing ink", { fieldMode: "streamlines", density: 8 }],
      [
        "Curl energy",
        { fieldMode: "curl-magnitude", density: 10, softness: 0.24 },
      ],
    ],
  },
];

export const OWNED_X_NOISE_DEFINITIONS: readonly EffectDefinition[] =
  OWNED_X_NOISE_DRAFTS.map((draft) => {
    const base = catalogShader(draft);
    return {
      ...base,
      resources: base.resources?.map((resource) =>
        resource.name === "color"
          ? { ...resource, format: "rgba16float" }
          : resource,
      ),
      provenance: { origin: "design-original", note: draft.mechanism },
    };
  });

export const OWNED_X_NOISE_PRESETS: readonly EffectPreset[] =
  OWNED_X_NOISE_DRAFTS.flatMap((draft) =>
    draft.looks.map(([name, params], index) => ({
      id: `an-preset-${draft.id}-v${draft.version ?? 1}-${index + 1}`,
      name,
      definitionId: `an-native-${draft.id}`,
      definitionVersion: draft.version ?? 1,
      placement: "fill" as const,
      params,
      clip: "bounds" as const,
      provenance: { origin: "design-original" as const },
    })),
  );
