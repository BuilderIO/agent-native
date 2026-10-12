import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const coverageWgsl = `${NATIVE_RENDER_GLOBALS}
const TAU: f32 = 6.283185307179586;

fn rotate(point: vec2f, angle: f32) -> vec2f {
  let c = cos(angle);
  let s = sin(angle);
  return vec2f(c * point.x - s * point.y, s * point.x + c * point.y);
}

fn hashCell(cell: vec2i, seed: u32) -> f32 {
  var state = bitcast<u32>(cell.x) * 1597334677u +
    bitcast<u32>(cell.y) * 3812015801u + seed * 2246822519u;
  state = (state ^ (state >> 16u)) * 3266489917u;
  state = (state ^ (state >> 13u)) * 668265263u;
  return f32((state ^ (state >> 16u)) >> 8u) / 16777216.0;
}

fn smoothNoise(point: vec2f) -> f32 {
  let cell = vec2i(floor(point));
  let local = fract(point);
  let ease = local * local * (vec2f(3.0) - 2.0 * local);
  let a = mix(hashCell(cell, 41u), hashCell(cell + vec2i(1, 0), 41u), ease.x);
  let b = mix(hashCell(cell + vec2i(0, 1), 41u),
    hashCell(cell + vec2i(1, 1), 41u), ease.x);
  return mix(a, b, ease.y);
}

fn coverageRank(uv: vec2f, angle: f32) -> f32 {
  let origin = clamp(globals.params[3].xy, vec2f(0.0), vec2f(1.0));
  let axis = vec2f(cos(angle), sin(angle));
  let turned = rotate(uv - origin, -angle);
  let shape = u32(clamp(globals.params[1].x, 0.0, 4.0));
  if (shape == 0u) {
    let reach = max(abs(axis.x) * max(origin.x, 1.0 - origin.x) +
      abs(axis.y) * max(origin.y, 1.0 - origin.y), 0.00001);
    return clamp(0.5 + dot(uv - origin, axis) / (2.0 * reach), 0.0, 1.0);
  }
  if (shape == 1u) {
    let elliptical = turned * vec2f(1.0, 1.4);
    let farthest = length(max(origin, vec2f(1.0) - origin) * vec2f(1.0, 1.4));
    return clamp(length(elliptical) / max(farthest, 0.00001), 0.0, 1.0);
  }
  if (shape == 2u) {
    return fract(atan2(turned.y, turned.x) / TAU + 1.0);
  }
  if (shape == 3u) {
    let count = clamp(globals.params[5].x, 2.0, 32.0);
    let point = (turned + origin) * count;
    let cell = vec2i(floor(point));
    let inside = fract(point) - vec2f(0.5);
    return clamp(hashCell(cell, 19u) * 0.7 + length(inside) * 0.42, 0.0, 1.0);
  }
  let scale = clamp(globals.params[6].x, 2.0, 32.0);
  return smoothNoise((turned + origin) * scale);
}

@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let source = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let progress = clamp(globals.params[0].x, 0.0, 1.0);
  if (progress <= 0.0) { return source; }
  var destination = textureSampleLevel(maskTexture, effectSampler, input.uv, 0.0);
  if (progress >= 1.0) { return destination; }

  let angle = clamp(globals.params[2].x, -180.0, 180.0) * 0.017453292519943295;
  let origin = clamp(globals.params[3].xy, vec2f(0.0), vec2f(1.0));
  let local = rotate(input.uv - origin, -angle);
  let structure = u32(clamp(globals.params[7].x, 0.0, 4.0));
  let distortion = 4.0 * progress * (1.0 - progress);
  var rank = coverageRank(input.uv, angle);
  var destinationUv = input.uv;

  if (structure == 1u) {
    let depth = clamp(globals.params[8].x, 0.0, 0.3);
    let phase = fract((local.y + 0.5) * 6.0);
    let crease = 1.0 - abs(phase * 2.0 - 1.0);
    let side = select(-1.0, 1.0, phase >= 0.5);
    rank = clamp(rank + (crease - 0.5) * depth, 0.0, 1.0);
    let seam = 1.0 - smoothstep(0.0, 0.16, abs(progress - rank));
    destinationUv = clamp(input.uv + rotate(vec2f(side * crease * depth * seam * distortion, 0.0), angle),
      vec2f(0.0), vec2f(1.0));
  } else if (structure == 2u) {
    let count = clamp(globals.params[9].x, 2.0, 32.0);
    let tile = floor(input.uv * count);
    let center = (tile + vec2f(0.5)) / count;
    rank = clamp(rank * 0.75 + hashCell(vec2i(tile), 73u) * 0.25, 0.0, 1.0);
    destinationUv = clamp(mix(input.uv, center, 0.82 * distortion), vec2f(0.0), vec2f(1.0));
  } else if (structure == 3u) {
    let count = clamp(globals.params[10].x, 2.0, 32.0);
    let band = floor((local.y + 0.5) * count);
    let order = fract(band * 0.61803398875);
    rank = clamp(rank * 0.65 + order * 0.35, 0.0, 1.0);
    destinationUv = clamp(input.uv + rotate(vec2f((order - 0.5) * 0.12 * distortion, 0.0), angle),
      vec2f(0.0), vec2f(1.0));
  } else if (structure == 4u) {
    let count = i32(clamp(globals.params[11].x, 2.0, 24.0));
    let tile = clamp(vec2i(floor(input.uv * f32(count))), vec2i(0), vec2i(count - 1));
    let seed = u32(clamp(globals.params[12].x, 0.0, 65535.0));
    let shift = i32(floor(hashCell(vec2i(tile.y, 0), seed) * f32(count)));
    let sourceTile = vec2i((tile.x + shift) % count, tile.y);
    let offset = fract(input.uv * f32(count));
    rank = clamp(rank * 0.55 + hashCell(tile, seed + 53u) * 0.45, 0.0, 1.0);
    destinationUv = clamp(mix(input.uv, (vec2f(sourceTile) + offset) / f32(count), distortion),
      vec2f(0.0), vec2f(1.0));
  }

  if (structure != 0u) {
    destination = textureSampleLevel(maskTexture, effectSampler, destinationUv, 0.0);
  }
  let feather = max(clamp(globals.params[4].x, 0.0, 0.2),
    0.5 / max(min(globals.viewport.x, globals.viewport.y), 1.0));
  let sweep = mix(-feather, 1.0 + feather, progress);
  let coverage = smoothstep(rank - feather, rank + feather, sweep);
  return mix(source, destination, coverage);
}`;

export const COVERAGE_ATLAS_EFFECT: EffectDefinition = {
  id: "an-native-owned-ac-coverage-atlas",
  name: "Coverage Atlas",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    destination: {
      type: "texture",
      label: "Destination image",
      default: null,
      input: "destination",
    },
    progress: {
      type: "float",
      label: "Progress",
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
    },
    shape: {
      type: "enum",
      label: "Coverage shape",
      default: "Directional",
      options: ["Directional", "Radial", "Angular", "Cells", "Noise"],
    },
    direction: {
      type: "float",
      label: "Direction",
      default: 0,
      min: -180,
      max: 180,
      step: 1,
      unit: "deg",
    },
    origin: {
      type: "vec2",
      label: "Origin",
      default: [0.5, 0.5],
      min: 0,
      max: 1,
      step: 0.01,
    },
    feather: {
      type: "float",
      label: "Feather",
      default: 0.025,
      min: 0,
      max: 0.2,
      step: 0.005,
    },
    cellCount: {
      type: "int",
      label: "Cells",
      default: 12,
      min: 2,
      max: 32,
      step: 1,
      visibleWhen: { property: "shape", equals: "Cells" },
    },
    noiseScale: {
      type: "float",
      label: "Noise scale",
      default: 12,
      min: 2,
      max: 32,
      step: 0.5,
      visibleWhen: { property: "shape", equals: "Noise" },
    },
    modifier: {
      type: "enum",
      label: "Structure",
      default: "None",
      options: ["None", "Fold", "Tiles", "Bands", "Shuffle"],
    },
    foldDepth: {
      type: "float",
      label: "Fold depth",
      default: 0.12,
      min: 0,
      max: 0.3,
      step: 0.01,
      visibleWhen: { property: "modifier", equals: "Fold" },
    },
    tileCount: {
      type: "int",
      label: "Tiles",
      default: 12,
      min: 2,
      max: 32,
      step: 1,
      visibleWhen: { property: "modifier", equals: "Tiles" },
    },
    bandCount: {
      type: "int",
      label: "Bands",
      default: 10,
      min: 2,
      max: 32,
      step: 1,
      visibleWhen: { property: "modifier", equals: "Bands" },
    },
    shuffleCount: {
      type: "int",
      label: "Shuffle cells",
      default: 8,
      min: 2,
      max: 24,
      step: 1,
      visibleWhen: { property: "modifier", equals: "Shuffle" },
    },
    shuffleSeed: {
      type: "int",
      label: "Shuffle seed",
      default: 17,
      min: 0,
      max: 65535,
      step: 1,
      visibleWhen: { property: "modifier", equals: "Shuffle" },
    },
  },
  inputs: {
    source: { kind: "texture-2d", resource: "source" },
    destination: { kind: "texture-2d", resource: "destination" },
  },
  outputs: { color: { kind: "texture-2d", resource: "color" } },
  resources: [
    {
      name: "source",
      kind: "texture-2d",
      external: true,
      usage: ["sampled"],
      size: "viewport",
    },
    {
      name: "destination",
      kind: "texture-2d",
      external: true,
      usage: ["sampled"],
      size: "viewport",
      sampleEncoding: "srgb-color-premultiplied",
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
      id: "coverage-exchange",
      kind: "render",
      reads: ["source", "destination"],
      output: "color",
      wgsl: coverageWgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original composable two-input coverage field. Five base fields and four spatial structures alter intermediate coverage and destination sampling; exact endpoints return their corresponding premultiplied input textures.",
  },
};

export const COVERAGE_ATLAS_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-owned-ac-coverage-atlas-radial-fold",
    name: "Radial fold",
    definitionId: COVERAGE_ATLAS_EFFECT.id,
    definitionVersion: COVERAGE_ATLAS_EFFECT.version,
    placement: "layer",
    params: {
      shape: "Radial",
      modifier: "Fold",
      foldDepth: 0.15,
      direction: 30,
      feather: 0.035,
      progress: 0.48,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-ac-coverage-atlas-shuffled-tile-exchange",
    name: "Shuffled tile exchange",
    definitionId: COVERAGE_ATLAS_EFFECT.id,
    definitionVersion: COVERAGE_ATLAS_EFFECT.version,
    placement: "layer",
    params: {
      shape: "Cells",
      modifier: "Shuffle",
      cellCount: 10,
      shuffleCount: 12,
      shuffleSeed: 89,
      feather: 0.012,
      progress: 0.57,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
