import { NATIVE_GRAPH_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const fieldSize = 256;

const common = `${NATIVE_GRAPH_GLOBALS}
fn bounded(cell: vec2i) -> vec2i { return clamp(cell, vec2i(0), vec2i(255)); }
fn sourceAt(cell: vec2i) -> vec4f {
  let uv = (vec2f(bounded(cell)) + 0.5) / 256.0;
  return textureSampleLevel(sourceTexture, effectSampler, uv, 0.0);
}
fn difference(a: vec4f, b: vec4f) -> f32 {
  let aColor = select(vec3f(0.0), a.rgb / max(a.a, 0.00001), a.a > 0.0);
  let bColor = select(vec3f(0.0), b.rgb / max(b.a, 0.00001), b.a > 0.0);
  return dot(abs(aColor - bColor), vec3f(0.2126, 0.7152, 0.0722)) * min(a.a, b.a)
    + abs(a.a - b.a) * 0.6;
}
fn blockExtent() -> vec2i {
  return max(vec2i(round(vec2f(globals.params[0].x * globals.clock.z * 256.0) / globals.viewport.xy)), vec2i(1));
}
fn hash(block: vec2i, generation: f32) -> f32 {
  let p = vec3f(vec2f(block), generation * 4096.0 + globals.params[7].x);
  return fract(sin(dot(p, vec3f(127.1, 311.7, 74.7))) * 43758.5453);
}`;

const metaWgsl = `${common}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var priorSource: texture_2d<f32>;
@group(0) @binding(4) var priorMeta: texture_2d<f32>;
@group(0) @binding(5) var<storage, read> priorClock: array<vec4f>;
@group(0) @binding(18) var nextMeta: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  if (any(invocation.xy >= vec2u(256))) { return; }
  let cell = vec2i(invocation.xy);
  let extent = blockExtent();
  let block = cell / extent;
  let anchor = bounded(block * extent + extent / 2);
  let previous = textureLoad(priorMeta, anchor, 0);
  let initial = priorClock[0].y <= 0.0;
  let elapsed = max(globals.clock.w, globals.clock.x - priorClock[0].x);
  let interval = globals.params[1].x * mix(1.0, 0.35 + 1.3 * hash(block, 0.0), globals.params[2].x);
  let age = abs(previous.z) + elapsed;
  let refresh = initial || age >= interval;
  var velocity = previous.xy;
  if (!initial) {
    let current = sourceAt(anchor);
    let stride = max(extent / 2, vec2i(1));
    var best = vec2f(0.0);
    var bestError = 1000000.0;
    for (var y = -1; y <= 1; y += 1) {
      for (var x = -1; x <= 1; x += 1) {
        let candidate = vec2i(x, y) * stride;
        let old = textureLoad(priorSource, bounded(anchor + candidate), 0);
        let error = difference(current, old) + f32(abs(x) + abs(y)) * 0.008;
        if (error < bestError) { bestError = error; best = vec2f(candidate); }
      }
    }
    velocity = mix(previous.xy, best, 0.68);
  }
  let generation = select(previous.w, fract(previous.w + 0.137 + hash(block, previous.w) * 0.071), refresh);
  textureStore(nextMeta, cell, vec4f(velocity, select(age, -0.0001, refresh), generation));
}`;

const holdWgsl = `${common}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var metaTexture: texture_2d<f32>;
@group(0) @binding(4) var previousHeld: texture_2d<f32>;
@group(0) @binding(5) var<storage, read> priorClock: array<vec4f>;
@group(0) @binding(18) var nextHeld: texture_storage_2d<rgba16float, write>;
fn quantize(color: vec4f, block: vec2i, generation: f32) -> vec4f {
  let steps = max(globals.params[4].x, 2.0);
  let offset = hash(block, generation) - 0.5;
  let straight = select(vec3f(0.0), color.rgb / max(color.a, 0.00001), color.a > 0.0);
  let quantized = floor(straight * steps + 0.5 + offset) / steps;
  return vec4f(quantized * color.a, color.a);
}
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  if (any(invocation.xy >= vec2u(256))) { return; }
  let cell = vec2i(invocation.xy);
  let block = cell / blockExtent();
  let blockState = textureLoad(metaTexture, cell, 0);
  let fresh = quantize(sourceAt(cell), block, blockState.w);
  if (blockState.z < 0.0) {
    textureStore(nextHeld, cell, fresh);
    return;
  }
  let shifted = (vec2f(cell) + 0.5 + blockState.xy * globals.params[3].x) / 256.0;
  let history = textureSampleLevel(previousHeld, effectSampler, clamp(shifted, vec2f(0.0), vec2f(1.0)), 0.0);
  let elapsed = max(globals.clock.w, globals.clock.x - priorClock[0].x);
  let freshWeight = 1.0 - exp(-elapsed / globals.params[5].x);
  textureStore(nextHeld, cell, mix(history, fresh, freshWeight));
}`;

const captureWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(18) var nextSource: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  if (any(invocation.xy >= vec2u(256))) { return; }
  let uv = (vec2f(invocation.xy) + 0.5) / 256.0;
  textureStore(nextSource, vec2i(invocation.xy), textureSampleLevel(sourceTexture, effectSampler, uv, 0.0));
}`;

const clockWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(18) var<storage, read_write> nextClock: array<vec4f>;
@compute @workgroup_size(1, 1, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  nextClock[invocation.x] = vec4f(globals.clock.x, 1.0, 0.0, 0.0);
}`;

const compositeWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var heldTexture: texture_2d<f32>;
struct VertexOutput { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) index: u32) -> VertexOutput {
  let triangle = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var output: VertexOutput;
  output.position = vec4f(triangle[index], 0.0, 1.0);
  output.uv = triangle[index] * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
  return output;
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let source = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let amount = globals.params[6].x;
  if (amount <= 0.0) { return source; }
  let held = textureSampleLevel(heldTexture, effectSampler, input.uv, 0.0);
  return mix(source, held, amount);
}`;

const float = (label: string, value: number, min: number, max: number) => ({
  type: "float" as const,
  label,
  default: value,
  min,
  max,
  step: 0.01,
});

const textureState = (name: string) => ({
  name,
  kind: "texture-2d" as const,
  format: "rgba16float" as const,
  usage: ["sampled", "storage"] as ("sampled" | "storage")[],
  persistent: true,
  size: "fixed" as const,
  width: fieldSize,
  height: fieldSize,
});

export const FRAME_MOSH_V2_EFFECT: EffectDefinition = {
  id: "an-native-owned-frame-mosh",
  name: "Frame Mosh",
  version: 2,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    blockSize: float("Block size", 24, 4, 96),
    refreshSeconds: float("Refresh interval", 0.62, 0.08, 4),
    stagger: float("Refresh stagger", 0.7, 0, 1),
    motionGain: float("Motion advection", 0.82, 0, 2),
    colorSteps: {
      type: "int",
      label: "Color steps",
      default: 12,
      min: 2,
      max: 64,
      step: 1,
    },
    decaySeconds: float("History decay", 1.8, 0.08, 8),
    amount: float("Amount", 0.86, 0, 1),
    patternSeed: {
      type: "int",
      label: "Pattern seed",
      default: 39,
      min: 0,
      max: 10000,
      step: 1,
    },
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
    textureState("held"),
    textureState("priorSource"),
    textureState("blockMeta"),
    {
      name: "captureClock",
      kind: "buffer",
      usage: ["storage"],
      persistent: true,
      size: "fixed",
      byteLength: 16,
    },
    {
      name: "color",
      kind: "texture-2d",
      format: "rgba16float",
      usage: ["render", "sampled"],
      size: "viewport",
    },
  ],
  resourceGraph: {
    abi: "stateful-resource-v1",
    timing: { fixedDt: 1 / 60, maxStepsPerCall: 8, maxStepIndex: 36000 },
    stateResources: ["held", "priorSource", "blockMeta", "captureClock"],
    sourceHistory: "sequential-captures",
    resetProperties: ["blockSize", "patternSeed"],
  },
  passes: [
    {
      id: "update-blocks",
      kind: "compute",
      reads: ["source"],
      previousFrameReads: ["priorSource", "blockMeta", "captureClock"],
      output: "blockMeta",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
      wgsl: metaWgsl,
    },
    {
      id: "advect-and-refresh",
      kind: "compute",
      reads: ["source", "blockMeta"],
      previousFrameReads: ["held", "captureClock"],
      output: "held",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
      wgsl: holdWgsl,
    },
    {
      id: "capture-source",
      kind: "compute",
      reads: ["source"],
      output: "priorSource",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
      wgsl: captureWgsl,
    },
    {
      id: "capture-clock",
      kind: "compute",
      reads: [],
      output: "captureClock",
      dispatch: { elements: "output-buffer", workgroupSize: [1, 1, 1] },
      wgsl: clockWgsl,
    },
    {
      id: "composite",
      kind: "render",
      reads: ["source", "held"],
      output: "color",
      wgsl: compositeWgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original per-block capture schedule with motion-compensated retained RGBA and per-generation quantization.",
  },
};

export const FRAME_MOSH_V2_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-owned-be-staggered-mosh",
    name: "Staggered Mosh",
    definitionId: FRAME_MOSH_V2_EFFECT.id,
    definitionVersion: 2,
    placement: "layer",
    clip: "bounds",
    params: {
      blockSize: 24,
      refreshSeconds: 0.62,
      stagger: 0.7,
      motionGain: 0.82,
      colorSteps: 12,
      decaySeconds: 1.8,
      amount: 0.86,
      patternSeed: 39,
    },
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-be-slow-block-drift",
    name: "Slow Block Drift",
    definitionId: FRAME_MOSH_V2_EFFECT.id,
    definitionVersion: 2,
    placement: "backdrop",
    clip: "bounds",
    params: {
      blockSize: 44,
      refreshSeconds: 1.9,
      stagger: 1,
      motionGain: 1.25,
      colorSteps: 6,
      decaySeconds: 4.5,
      amount: 1,
      patternSeed: 83,
    },
    provenance: { origin: "design-original" },
  },
];

export const FRAME_MOSH_V2_PRESET_LABEL_SOURCE_IDS: Readonly<
  Record<string, string>
> = Object.fromEntries(
  FRAME_MOSH_V2_PRESETS.map((preset) => [preset.id, preset.id]),
);
