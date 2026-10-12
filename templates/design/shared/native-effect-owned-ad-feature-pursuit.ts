import type { EffectDefinition, EffectPreset } from "./native-effects";

const computeWgsl = `
struct Params {
  time: f32, dt: f32, seed: f32, intensity: f32,
  blockSize: f32, drift: f32, churn: f32, sourcePixelRatio: f32,
};
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var priorTexture: texture_2d<f32>;
@group(0) @binding(2) var nextTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var displayTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<uniform> params: Params;

fn sourceAt(uv: vec2f) -> vec4f {
  let size = vec2f(textureDimensions(sourceTexture));
  let pixel = vec2i(clamp(floor(clamp(uv, vec2f(0.0), vec2f(0.99999)) * size), vec2f(0.0), size - 1.0));
  return textureLoad(sourceTexture, pixel, 0);
}
fn lightAt(uv: vec2f) -> f32 {
  let c = sourceAt(uv);
  return dot(c.rgb, vec3f(0.2126, 0.7152, 0.0722)) * c.a;
}
fn hash(value: u32) -> f32 {
  var x = value * 1664525u + u32(params.seed) * 747796405u + 1013904223u;
  x = ((x >> 16u) ^ x) * 2246822519u;
  return f32((x >> 8u) & 16777215u) / 16777216.0;
}
fn anchor(index: u32) -> vec2f {
  let tile = vec2f(f32(index % 8u), f32(index / 8u));
  let jitter = vec2f(hash(index * 2u + 1u), hash(index * 2u + 2u)) - 0.5;
  return (tile + vec2f(0.5) + jitter * 0.3) / 8.0;
}
fn withinHome(index: u32, uv: vec2f) -> vec2f {
  let tile = vec2f(f32(index % 8u), f32(index / 8u)) / 8.0;
  return clamp(uv, tile - vec2f(0.035), tile + vec2f(0.16));
}
fn harris(uv: vec2f) -> f32 {
  let pixel = params.sourcePixelRatio / vec2f(textureDimensions(sourceTexture));
  var xx = 0.0;
  var yy = 0.0;
  var xy = 0.0;
  for (var y = -1; y <= 1; y += 1) {
    for (var x = -1; x <= 1; x += 1) {
      let p = uv + vec2f(f32(x), f32(y)) * pixel * 2.0;
      let gx = lightAt(p + vec2f(pixel.x, 0.0)) - lightAt(p - vec2f(pixel.x, 0.0));
      let gy = lightAt(p + vec2f(0.0, pixel.y)) - lightAt(p - vec2f(0.0, pixel.y));
      xx += gx * gx;
      yy += gy * gy;
      xy += gx * gy;
    }
  }
  let trace = xx + yy;
  return max((xx * yy - xy * xy - 0.04 * trace * trace) / (trace + 0.00001), 0.0);
}

@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.x >= 64u || invocation.y >= 16u) { return; }
  let cell = vec2i(invocation.xy);
  let index = invocation.x;
  let enabled = index < u32(round(params.churn * 64.0));
  let previous = textureLoad(priorTexture, cell, 0);
  if (!enabled) {
    textureStore(nextTexture, cell, vec4f(0.0));
    textureStore(displayTexture, cell, vec4f(0.0));
    return;
  }
  if (invocation.y > 0u) {
    let old = select(textureLoad(priorTexture, cell - vec2i(0, 1), 0), previous, params.dt <= 0.0);
    textureStore(nextTexture, cell, old);
    textureStore(displayTexture, cell, old);
    return;
  }
  if (params.dt <= 0.0 && previous.w > 0.0) {
    textureStore(nextTexture, cell, previous);
    textureStore(displayTexture, cell, previous);
    return;
  }
  let recovering = previous.w <= 0.0;
  let center = select(previous.xy, anchor(index), recovering);
  let dimensions = vec2f(textureDimensions(sourceTexture));
  let radius = select(params.blockSize * params.sourcePixelRatio / dimensions, vec2f(0.035), recovering);
  var best = center;
  var bestScore = -1.0;
  var bestCorner = 0.0;
  for (var y = -2; y <= 2; y += 1) {
    for (var x = -2; x <= 2; x += 1) {
      if (!recovering && (abs(x) > 1 || abs(y) > 1)) { continue; }
      let offset = vec2f(f32(x), f32(y)) * radius * select(0.5, 1.0, recovering);
      let candidate = withinHome(index, center + offset);
      let corner = harris(candidate);
      let similarity = select(1.0, 1.0 - 0.4 * abs(lightAt(candidate) - previous.z), !recovering);
      let distance = length(offset / max(radius, vec2f(0.00001)));
      let score = corner * similarity - corner * distance * select(0.02, 0.08, !recovering);
      if (score > bestScore) {
        bestScore = score;
        bestCorner = corner;
        best = candidate;
      }
    }
  }
  let threshold = 0.0003 + params.intensity * params.intensity * 0.018;
  let found = bestCorner >= threshold;
  let pursued = select(mix(center, best, params.drift), best, recovering);
  let position = withinHome(index, pursued);
  let next = select(vec4f(0.0), vec4f(position, lightAt(position), 1.0), found);
  textureStore(nextTexture, cell, next);
  textureStore(displayTexture, cell, next);
}
`;

const resolveWgsl = `
struct Resolve { blend: f32, sourcePixelRatio: f32, padding: vec2f };
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var displayTexture: texture_2d<f32>;
@group(0) @binding(2) var linearClamp: sampler;
@group(0) @binding(3) var<uniform> resolve: Resolve;
struct VertexOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) index: u32) -> VertexOut {
  let xy = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  var result: VertexOut;
  result.position = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  result.uv = vec2f(xy.x, 1.0 - xy.y);
  return result;
}
fn segmentDistance(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let delta = b - a;
  let t = clamp(dot(p - a, delta) / max(dot(delta, delta), 0.00000001), 0.0, 1.0);
  return length(p - (a + t * delta));
}
@fragment fn fs(input: VertexOut) -> @location(0) vec4f {
  let source = textureSampleLevel(sourceTexture, linearClamp, input.uv, 0.0);
  let size = vec2f(textureDimensions(sourceTexture));
  var trail = 0.0;
  var marker = 0.0;
  for (var index = 0; index < 64; index += 1) {
    let home = vec2f(f32(index % 8), f32(index / 8)) / 8.0;
    if (any(input.uv < home - vec2f(0.04)) || any(input.uv > home + vec2f(0.17))) { continue; }
    var last = textureLoad(displayTexture, vec2i(index, 0), 0);
    if (last.w <= 0.0) { continue; }
    marker = max(marker, 1.0 - smoothstep(2.0 * resolve.sourcePixelRatio, 5.0 * resolve.sourcePixelRatio, distance(input.uv * size, last.xy * size)));
    for (var age = 1; age < 12; age += 1) {
      let point = textureLoad(displayTexture, vec2i(index, age), 0);
      if (point.w <= 0.0) { break; }
      let distancePx = segmentDistance(input.uv * size, last.xy * size, point.xy * size);
      let fade = 1.0 - f32(age) / 12.0;
      trail = max(trail, (1.0 - smoothstep(1.0 * resolve.sourcePixelRatio, 3.0 * resolve.sourcePixelRatio, distancePx)) * fade);
      if (age % 4 == 0) {
        let markPx = distance(input.uv * size, point.xy * size);
        marker = max(marker, (1.0 - smoothstep(1.0 * resolve.sourcePixelRatio, 3.0 * resolve.sourcePixelRatio, markPx)) * fade * 0.55);
      }
      last = point;
    }
  }
  let paint = clamp(trail * 0.7 + marker, 0.0, 1.0) * resolve.blend * source.a;
  let color = mix(source.rgb, vec3f(0.96, 0.76, 0.24) * source.a, paint);
  return vec4f(color, source.a);
}
`;

export const FEATURE_PURSUIT_DEFINITIONS = [
  {
    id: "an-native-owned-feature-pursuit",
    name: "Feature Pursuit",
    version: 1,
    kind: "processor",
    placements: ["layer", "backdrop"],
    properties: {
      cornerThreshold: {
        type: "float",
        label: "Corner threshold",
        default: 0.32,
        min: 0,
        max: 1,
        step: 0.01,
      },
      searchRadius: {
        type: "float",
        label: "Search radius",
        default: 56,
        min: 30,
        max: 150,
        step: 1,
      },
      pursuitAgility: {
        type: "float",
        label: "Pursuit agility",
        default: 0.8,
        min: 0,
        max: 1,
        step: 0.01,
      },
      trackCount: {
        type: "float",
        label: "Track count",
        default: 0.75,
        min: 0,
        max: 1,
        step: 0.015625,
      },
      sourceMix: {
        type: "float",
        label: "Source mix",
        default: 0.9,
        min: 0,
        max: 1,
        step: 0.01,
      },
      patternSeed: {
        type: "float",
        label: "Pattern seed",
        default: 23,
        min: 0,
        max: 100,
        step: 1,
      },
    },
    inputs: { source: { kind: "texture-2d", resource: "source" } },
    outputs: { color: { kind: "texture-2d", resource: "color" } },
    resources: [
      {
        name: "source",
        kind: "texture-2d",
        usage: ["sampled"],
        external: true,
        size: "viewport",
      },
      {
        name: "state",
        kind: "texture-2d",
        format: "rgba16float",
        usage: ["sampled", "storage"],
        persistent: true,
        size: "fixed",
        width: 64,
        height: 16,
      },
      {
        name: "display",
        kind: "texture-2d",
        format: "rgba16float",
        usage: ["sampled", "storage"],
        size: "fixed",
        width: 64,
        height: 16,
      },
      {
        name: "color",
        kind: "texture-2d",
        format: "rgba16float",
        usage: ["render", "sampled"],
        size: "viewport",
      },
    ],
    output: "color",
    feedback: {
      abi: "texture-feedback-v1",
      sourceHistory: "sequential-captures",
      grid: { width: 64, height: 16, format: "rgba16float", workgroup: [8, 8] },
      timing: { fixedDt: 1 / 60, maxStepsPerCall: 120, maxStepIndex: 36000 },
      stateResource: "state",
      displayResource: "display",
      uniformProperties: {
        intensity: "cornerThreshold",
        blockSize: "searchRadius",
        drift: "pursuitAgility",
        churn: "trackCount",
        blend: "sourceMix",
        seed: "patternSeed",
      },
      resetProperties: ["patternSeed"],
    },
    passes: [
      {
        id: "advance",
        kind: "compute",
        reads: ["source"],
        previousFrameReads: ["state"],
        output: "state",
        additionalOutputs: ["display"],
        persistent: true,
        dispatch: { workgroupSize: [8, 8], elements: "fixed-grid" },
        wgsl: computeWgsl,
      },
      {
        id: "resolve",
        kind: "render",
        reads: ["source", "display"],
        output: "color",
        wgsl: resolveWgsl,
      },
    ],
    provenance: {
      origin: "design-original",
      note: "Original source-corner pursuit with persistent point histories.",
    },
  },
] as unknown as readonly EffectDefinition[];

export const FEATURE_PURSUIT_PRESETS = [
  {
    id: "an-preset-owned-feature-pursuit",
    name: "Feature Pursuit",
    definitionId: "an-native-owned-feature-pursuit",
    definitionVersion: 1,
    placement: "layer",
    params: {
      cornerThreshold: 0.32,
      searchRadius: 56,
      pursuitAgility: 0.8,
      trackCount: 0.75,
      sourceMix: 0.9,
      patternSeed: 23,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-motion-trails",
    name: "Motion Trails",
    definitionId: "an-native-owned-feature-pursuit",
    definitionVersion: 1,
    placement: "layer",
    params: {
      cornerThreshold: 0.18,
      searchRadius: 100,
      pursuitAgility: 0.96,
      trackCount: 1,
      sourceMix: 0.7,
      patternSeed: 61,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
] as unknown as readonly EffectPreset[];

export const FEATURE_PURSUIT_PRESET_LABEL_SOURCE_IDS: Readonly<
  Record<string, string>
> = Object.fromEntries(
  FEATURE_PURSUIT_PRESETS.map((preset) => [preset.id, preset.id]),
);
