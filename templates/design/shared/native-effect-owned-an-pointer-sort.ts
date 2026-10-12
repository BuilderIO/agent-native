import type { EffectDefinition, EffectPreset } from "./native-effects";

const computeWgsl = `
struct Params {
  time: f32, dt: f32, seed: f32, intensity: f32,
  blockSize: f32, drift: f32, churn: f32, sourcePixelRatio: f32,
};
struct Pointer { motion: vec4f, status: vec4f };
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var priorTexture: texture_2d<f32>;
@group(0) @binding(2) var nextTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var displayTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<uniform> params: Params;
@group(0) @binding(5) var<uniform> pointer: Pointer;

fn bounded(cell: vec2i) -> vec2i { return clamp(cell, vec2i(0), vec2i(511, 255)); }
fn sourceAt(cell: vec2i) -> vec4f {
  let uv = (vec2f(bounded(cell)) + 0.5) / vec2f(512.0, 256.0);
  let size = vec2i(textureDimensions(sourceTexture));
  let sourceCell = clamp(vec2i(floor(uv * vec2f(size))), vec2i(0), size - vec2i(1));
  return textureLoad(sourceTexture, sourceCell, 0);
}
fn priorColor(cell: vec2i) -> vec4f { return textureLoad(priorTexture, bounded(cell), 0); }
fn priorMask(cell: vec2i) -> f32 { return textureLoad(priorTexture, bounded(cell) + vec2i(512, 0), 0).r; }
fn luminance(color: vec4f) -> f32 {
  return dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
}
fn hash(cell: vec2i) -> f32 {
  var value = u32(cell.x) * 1664525u + u32(cell.y) * 1013904223u + u32(params.seed) * 747796405u;
  value = ((value >> 16u) ^ value) * 2246822519u;
  return f32((value >> 8u) & 16777215u) / 16777216.0;
}
fn brush(cell: vec2i) -> f32 {
  if (pointer.status.x < 0.5) { return 0.0; }
  let sourceSize = vec2f(textureDimensions(sourceTexture));
  let radius = max(vec2f(params.blockSize * params.sourcePixelRatio) / sourceSize, vec2f(0.00001));
  let uv = (vec2f(cell) + 0.5) / vec2f(512.0, 256.0);
  let distance = length((uv - pointer.motion.xy) / radius);
  return 1.0 - smoothstep(0.55, 1.0, distance);
}
fn sortPair(cell: vec2i) -> vec4f {
  let stride = 1 + i32(floor(params.drift * 3.999));
  let block = cell.x / stride;
  let left = block % 2 == 0;
  let partner = bounded(cell + vec2i(select(-stride, stride, left), 0));
  let own = priorColor(cell);
  let other = priorColor(partner);
  let leftColor = select(other, own, left);
  let rightColor = select(own, other, left);
  let run = vec2i((block / 2) * 2 * stride, cell.y);
  let brightLeft = select(hash(run) > 0.5, pointer.motion.z > 0.0, abs(pointer.motion.z) > 0.00001);
  let swap = select(luminance(leftColor) > luminance(rightColor), luminance(leftColor) < luminance(rightColor), brightLeft);
  return select(own, other, swap);
}
@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.x >= 1024u || invocation.y >= 256u) { return; }
  let cell = vec2i(i32(invocation.x % 512u), i32(invocation.y));
  let baseline = params.time <= 0.0 && params.dt <= 0.0;
  let current = sourceAt(cell);
  let oldMask = select(priorMask(cell), 0.0, baseline);
  let influence = brush(cell) * params.intensity;
  let relax = clamp(params.churn * max(params.dt, 0.0) * 4.0, 0.0, 1.0);
  let nextMask = max(oldMask * (1.0 - relax), influence);
  var nextColor = current;
  if (!baseline) {
    let previous = priorColor(cell);
    let restored = mix(previous, current, relax);
    let sorted = sortPair(cell);
    nextColor = mix(restored, sorted, influence);
  }
  let result = select(nextColor, vec4f(nextMask, 0.0, 0.0, 1.0), invocation.x >= 512u);
  textureStore(nextTexture, vec2i(invocation.xy), result);
  textureStore(displayTexture, vec2i(invocation.xy), result);
}`;

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
@fragment fn fs(input: VertexOut) -> @location(0) vec4f {
  let source = textureSampleLevel(sourceTexture, linearClamp, input.uv, 0.0);
  if (resolve.blend <= 0.0) { return source; }
  let colorUv = vec2f(min(input.uv.x * 0.5, 0.5 - 0.5 / 1024.0), input.uv.y);
  let maskUv = vec2f(max(0.5 + input.uv.x * 0.5, 0.5 + 0.5 / 1024.0), input.uv.y);
  let sorted = textureSampleLevel(displayTexture, linearClamp, colorUv, 0.0);
  let mask = textureSampleLevel(displayTexture, linearClamp, maskUv, 0.0).r;
  return mix(source, sorted, clamp(mask * resolve.blend, 0.0, 1.0));
}`;

export const POINTER_RUN_SORT_DEFINITIONS: readonly EffectDefinition[] = [
  {
    id: "an-native-owned-an-cursor-run-sort",
    name: "Cursor Run Sort",
    version: 1,
    kind: "processor",
    placements: ["layer", "backdrop"],
    properties: {
      sortStrength: {
        type: "float",
        label: "Sort strength",
        default: 0.82,
        min: 0,
        max: 1,
        step: 0.01,
      },
      brushRadius: {
        type: "float",
        label: "Brush radius",
        default: 95,
        min: 30,
        max: 150,
        step: 1,
        unit: "px",
      },
      runSpan: {
        type: "float",
        label: "Run span",
        default: 0.3,
        min: 0,
        max: 1,
        step: 0.01,
      },
      relaxation: {
        type: "float",
        label: "Relaxation",
        default: 0.25,
        min: 0,
        max: 1,
        step: 0.01,
      },
      amount: {
        type: "float",
        label: "Amount",
        default: 0.9,
        min: 0,
        max: 1,
        step: 0.01,
      },
      patternSeed: {
        type: "float",
        label: "Pattern seed",
        default: 37,
        min: 0,
        max: 100,
        step: 1,
      },
      cursorPosition: {
        type: "vec2",
        label: "Cursor position",
        default: [0.5, 0.5],
        min: 0,
        max: 1,
      },
      cursorActive: { type: "bool", label: "Cursor active", default: true },
    },
    interaction: {
      positionProperty: "cursorPosition",
      activeProperty: "cursorActive",
    },
    inputs: { source: { kind: "texture-2d", resource: "source" } },
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
        name: "state",
        kind: "texture-2d",
        format: "rgba16float",
        usage: ["sampled", "storage"],
        persistent: true,
        size: "fixed",
        width: 1024,
        height: 256,
      },
      {
        name: "display",
        kind: "texture-2d",
        format: "rgba16float",
        usage: ["sampled", "storage"],
        size: "fixed",
        width: 1024,
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
      pointer: "interaction-v1",
      grid: {
        width: 1024,
        height: 256,
        format: "rgba16float",
        workgroup: [8, 8],
      },
      timing: { fixedDt: 1 / 60, maxStepsPerCall: 120, maxStepIndex: 36000 },
      stateResource: "state",
      displayResource: "display",
      uniformProperties: {
        intensity: "sortStrength",
        blockSize: "brushRadius",
        drift: "runSpan",
        churn: "relaxation",
        blend: "amount",
        seed: "patternSeed",
      },
      resetProperties: ["patternSeed"],
    },
    passes: [
      {
        id: "sort-step",
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
        id: "sort-resolve",
        kind: "render",
        reads: ["source", "display"],
        output: "color",
        wgsl: resolveWgsl,
      },
    ],
    provenance: {
      origin: "design-original",
      note: "Original fixed-grid source-image run sorting around an authored or live cursor. Touched pixels persist and relax toward newly sampled source; unedited pixels resolve from the source, and Amount zero is exact identity.",
    },
  },
];

export const POINTER_RUN_SORT_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-owned-an-cursor-silk",
    name: "Cursor silk",
    definitionId: "an-native-owned-an-cursor-run-sort",
    definitionVersion: 1,
    placement: "layer",
    params: {
      sortStrength: 0.65,
      brushRadius: 75,
      runSpan: 0.2,
      relaxation: 0.5,
      amount: 0.76,
      patternSeed: 37,
      cursorPosition: [0.38, 0.46],
      cursorActive: true,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-an-cursor-fray",
    name: "Cursor fray",
    definitionId: "an-native-owned-an-cursor-run-sort",
    definitionVersion: 1,
    placement: "layer",
    params: {
      sortStrength: 1,
      brushRadius: 135,
      runSpan: 0.88,
      relaxation: 0.08,
      amount: 1,
      patternSeed: 81,
      cursorPosition: [0.62, 0.52],
      cursorActive: true,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
