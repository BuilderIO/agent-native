import type { EffectDefinition, EffectPreset } from "./native-effects";

const computeHeader = `
struct Params {
  time: f32, dt: f32, seed: f32, intensity: f32,
  blockSize: f32, drift: f32, churn: f32, sourcePixelRatio: f32,
};
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var priorTexture: texture_2d<f32>;
@group(0) @binding(2) var nextTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var displayTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<uniform> params: Params;
fn bounded(cell: vec2i) -> vec2i { return clamp(cell, vec2i(0), vec2i(255)); }
fn sourceAt(cell: vec2i) -> vec4f {
  let size = vec2f(textureDimensions(sourceTexture));
  let uv = (vec2f(bounded(cell)) + 0.5) / 256.0;
  let sourceCell = vec2i(clamp(floor(uv * size), vec2f(0.0), size - 1.0));
  return textureLoad(sourceTexture, sourceCell, 0);
}
fn heldAt(cell: vec2i) -> vec4f { return textureLoad(priorTexture, bounded(cell), 0); }
fn oldSourceAt(cell: vec2i) -> vec4f { return textureLoad(priorTexture, bounded(cell) + vec2i(256, 0), 0); }
fn difference(a: vec4f, b: vec4f) -> f32 {
  return dot(abs(a.rgb - b.rgb), vec3f(0.2126, 0.7152, 0.0722)) + abs(a.a - b.a) * 0.35;
}
fn luminance(color: vec4f) -> f32 {
  return dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
}
fn hash(cell: vec2i) -> f32 {
  var x = u32(cell.x) * 1664525u + u32(cell.y) * 1013904223u + u32(params.seed) * 747796405u;
  x = ((x >> 16u) ^ x) * 2246822519u;
  return f32((x >> 8u) & 16777215u) / 16777216.0;
}
`;

const exposureComputeWgsl =
  computeHeader +
  `
fn exposure(cell: vec2i, current: vec4f) -> vec4f {
  let oldSource = oldSourceAt(cell);
  let oldExposure = heldAt(cell);
  let differenceNow = difference(current, oldSource);
  let threshold = 0.012 + (1.0 - params.intensity) * 0.22 + hash(cell) * 0.02;
  let motion = smoothstep(threshold, threshold + 0.08, differenceNow);
  let remaining = smoothstep(0.03, 0.2, difference(current, oldExposure));
  let retention = (1.0 - 1.0 / params.blockSize) * params.churn * max(motion, remaining * 0.9);
  let gx = luminance(sourceAt(cell + vec2i(1, 0))) - luminance(sourceAt(cell - vec2i(1, 0)));
  let gy = luminance(sourceAt(cell + vec2i(0, 1))) - luminance(sourceAt(cell - vec2i(0, 1)));
  let offset = vec2i(round(vec2f(gx, gy) * params.drift * 32.0));
  let history = heldAt(cell - offset);
  return mix(current, history, retention);
}
@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.x >= 512u || invocation.y >= 256u) { return; }
  let cell = vec2i(invocation.xy);
  let sampleCell = vec2i(cell.x % 256, cell.y);
  let current = sourceAt(sampleCell);
  let initial = params.dt <= 0.0 && params.time <= 0.0;
  var next: vec4f;
  if (initial) {
    next = current;
  } else if (params.dt <= 0.0) {
    next = textureLoad(priorTexture, cell, 0);
  } else if (cell.x >= 256) {
    next = current;
  } else {
    next = exposure(sampleCell, current);
  }
  textureStore(nextTexture, cell, next);
  textureStore(displayTexture, cell, next);
}
`;

const moshComputeWgsl =
  computeHeader +
  `
fn blockMotion(cell: vec2i) -> vec2i {
  let sourceSize = vec2f(textureDimensions(sourceTexture));
  let extent = max(vec2i(round(vec2f(params.blockSize * params.sourcePixelRatio * 256.0) / sourceSize)), vec2i(1));
  let anchor = bounded((cell / extent) * extent + extent / 2);
  let stride = max(extent / 3, vec2i(1));
  let current = sourceAt(anchor);
  var best = vec2i(0);
  var bestError = 1000.0;
  for (var y = -1; y <= 1; y += 1) {
    for (var x = -1; x <= 1; x += 1) {
      let candidate = vec2i(x, y) * stride;
      let error = difference(current, oldSourceAt(anchor + candidate)) + f32(abs(x) + abs(y)) * 0.007;
      if (error < bestError) { bestError = error; best = candidate; }
    }
  }
  return best;
}
fn mosh(cell: vec2i, current: vec4f) -> vec4f {
  let sourceSize = vec2f(textureDimensions(sourceTexture));
  let extent = max(vec2i(round(vec2f(params.blockSize * params.sourcePixelRatio * 256.0) / sourceSize)), vec2i(1));
  let block = cell / extent;
  let motion = blockMotion(cell);
  let offset = vec2i(round(vec2f(motion) * params.drift));
  let held = heldAt(cell + offset);
  let oldSource = oldSourceAt(cell);
  let threshold = 0.014 + (1.0 - params.intensity) * 0.24 + hash(block) * 0.025;
  let changed = smoothstep(threshold, threshold + 0.12, difference(current, oldSource));
  let unresolved = smoothstep(0.03, 0.18, difference(current, held));
  let persistence = params.churn * max(changed, unresolved * 0.92);
  return mix(current, held, persistence);
}
@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.x >= 512u || invocation.y >= 256u) { return; }
  let cell = vec2i(invocation.xy);
  let sampleCell = vec2i(cell.x % 256, cell.y);
  let current = sourceAt(sampleCell);
  let initial = params.dt <= 0.0 && params.time <= 0.0;
  var next: vec4f;
  if (initial) {
    next = current;
  } else if (params.dt <= 0.0) {
    next = textureLoad(priorTexture, cell, 0);
  } else if (cell.x >= 256) {
    next = current;
  } else {
    next = mosh(sampleCell, current);
  }
  textureStore(nextTexture, cell, next);
  textureStore(displayTexture, cell, next);
}
`;

const resolveWgsl = `
struct Resolve { blend: f32, padding: vec3f };
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
@fragment fn fs(input: VertexOut) -> @location(0) vec4f {
  let source = textureSampleLevel(sourceTexture, linearClamp, input.uv, 0.0);
  if (resolve.blend <= 0.0) { return source; }
  let historyUv = vec2f((input.uv.x * 255.0 + 0.5) / 512.0, (input.uv.y * 255.0 + 0.5) / 256.0);
  let history = textureSampleLevel(displayTexture, linearClamp, historyUv, 0.0);
  return mix(source, history, resolve.blend);
}
`;

function temporalDefinition(
  id: string,
  name: string,
  compute: string,
  controls: {
    threshold: string;
    hold: string;
    drift: string;
    persistence: string;
  },
): EffectDefinition {
  return {
    id,
    name,
    version: 1,
    kind: "processor",
    placements: ["layer", "backdrop"],
    properties: {
      threshold: {
        type: "float",
        label: controls.threshold,
        default: 0.62,
        min: 0,
        max: 1,
        step: 0.01,
      },
      hold: {
        type: "float",
        label: controls.hold,
        default: 70,
        min: 30,
        max: 150,
        step: 1,
      },
      drift: {
        type: "float",
        label: controls.drift,
        default: 0.58,
        min: 0,
        max: 1,
        step: 0.01,
      },
      persistence: {
        type: "float",
        label: controls.persistence,
        default: 0.88,
        min: 0,
        max: 1,
        step: 0.01,
      },
      amount: {
        type: "float",
        label: "Amount",
        default: 0.8,
        min: 0,
        max: 1,
        step: 0.01,
      },
      patternSeed: {
        type: "float",
        label: "Pattern seed",
        default: 27,
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
        width: 512,
        height: 256,
      },
      {
        name: "display",
        kind: "texture-2d",
        format: "rgba16float",
        usage: ["sampled", "storage"],
        size: "fixed",
        width: 512,
        height: 256,
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
      grid: {
        width: 512,
        height: 256,
        format: "rgba16float",
        workgroup: [8, 8],
      },
      timing: { fixedDt: 1 / 60, maxStepsPerCall: 512, maxStepIndex: 36000 },
      stateResource: "state",
      displayResource: "display",
      uniformProperties: {
        intensity: "threshold",
        blockSize: "hold",
        drift: "drift",
        churn: "persistence",
        blend: "amount",
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
        wgsl: compute,
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
      note: "Original source-frame temporal image processing.",
    },
  } as EffectDefinition;
}

export const TEMPORAL_IMAGE_DEFINITIONS: readonly EffectDefinition[] = [
  temporalDefinition(
    "an-native-owned-exposure-trail",
    "Exposure Trail",
    exposureComputeWgsl,
    {
      threshold: "Difference sensitivity",
      hold: "Exposure hold",
      drift: "Trail drift",
      persistence: "Trail strength",
    },
  ),
  temporalDefinition(
    "an-native-owned-frame-mosh",
    "Frame Mosh",
    moshComputeWgsl,
    {
      threshold: "Change sensitivity",
      hold: "Block size",
      drift: "Motion shift",
      persistence: "Corruption hold",
    },
  ),
];

export const TEMPORAL_IMAGE_PRESETS = [
  {
    id: "an-preset-owned-exposure-trail",
    name: "Exposure Trail",
    definitionId: "an-native-owned-exposure-trail",
    definitionVersion: 1,
    placement: "layer",
    params: {
      threshold: 0.62,
      hold: 70,
      drift: 0.58,
      persistence: 0.88,
      amount: 0.8,
      patternSeed: 27,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-exposure-echo",
    name: "Exposure Echo",
    definitionId: "an-native-owned-exposure-trail",
    definitionVersion: 1,
    placement: "layer",
    params: {
      threshold: 0.82,
      hold: 130,
      drift: 0.2,
      persistence: 0.96,
      amount: 1,
      patternSeed: 71,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-frame-mosh",
    name: "Frame Mosh",
    definitionId: "an-native-owned-frame-mosh",
    definitionVersion: 1,
    placement: "layer",
    params: {
      threshold: 0.68,
      hold: 75,
      drift: 0.76,
      persistence: 0.9,
      amount: 0.86,
      patternSeed: 39,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-block-corruption",
    name: "Block Corruption",
    definitionId: "an-native-owned-frame-mosh",
    definitionVersion: 1,
    placement: "layer",
    params: {
      threshold: 0.9,
      hold: 140,
      drift: 1,
      persistence: 0.98,
      amount: 1,
      patternSeed: 83,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
] as unknown as readonly EffectPreset[];

export const TEMPORAL_IMAGE_PRESET_LABEL_SOURCE_IDS: Readonly<
  Record<string, string>
> = Object.fromEntries(
  TEMPORAL_IMAGE_PRESETS.map((preset) => [preset.id, preset.id]),
);
