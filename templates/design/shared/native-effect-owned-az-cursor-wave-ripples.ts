import { NATIVE_GRAPH_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const waveAdvanceWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var previousWave: texture_2d<f32>;
@group(0) @binding(3) var<storage, read> previousCursor: array<vec4f>;
@group(0) @binding(18) var nextWave: texture_storage_2d<rgba16float, write>;

fn heightAt(cell: vec2i, dimensions: vec2i) -> f32 {
  return textureLoad(previousWave, clamp(cell, vec2i(0), dimensions - vec2i(1)), 0).x;
}
fn cursorDistance(uv: vec2f, start: vec2f, end: vec2f) -> f32 {
  let size = globals.viewport.xy / globals.clock.z;
  let point = uv * size;
  let a = start * size;
  let b = end * size;
  let edge = b - a;
  let fraction = clamp(dot(point - a, edge) / max(dot(edge, edge), 0.0001), 0.0, 1.0);
  return length(point - (a + edge * fraction));
}

@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let dimensions = vec2i(textureDimensions(nextWave));
  if (any(invocation.xy >= vec2u(dimensions))) { return; }
  let cell = vec2i(invocation.xy);
  let uv = (vec2f(cell) + vec2f(0.5)) / vec2f(dimensions);
  let cursor = previousCursor[0];
  let position = globals.params[6].xy;
  let pointerDown = globals.params[7].x > 0.5;
  let radius = max(globals.params[3].x, 1.0);
  if (globals.clock.w <= 0.0 || cursor.w <= 0.0) {
    let initialDistance = cursorDistance(uv, position, position);
    let initial = select(0.0, exp(-initialDistance * initialDistance / (radius * radius)) * globals.params[2].x * 0.12, pointerDown);
    textureStore(nextWave, cell, vec4f(initial, initial, 0.0, 0.0));
    return;
  }

  let state = textureLoad(previousWave, cell, 0);
  let current = state.x;
  let earlier = state.y;
  let neighbors = heightAt(cell + vec2i(-1, 0), dimensions)
    + heightAt(cell + vec2i(1, 0), dimensions)
    + heightAt(cell + vec2i(0, -1), dimensions)
    + heightAt(cell + vec2i(0, 1), dimensions);
  let laplacian = neighbors - 4.0 * current;
  let propagation = globals.params[0].x * globals.params[0].x * 0.4;
  let damping = exp(-globals.params[1].x * globals.clock.w);
  var next = current + (current - earlier) * damping + propagation * laplacian;

  if (pointerDown && cursor.z > 0.5) {
    let size = globals.viewport.xy / globals.clock.z;
    let distanceMoved = length((position - cursor.xy) * size);
    if (distanceMoved > 0.2) {
      let speed = distanceMoved / globals.clock.w;
      let impulse = globals.params[2].x * clamp(speed / 450.0, 0.0, 1.0) * 0.24;
      let distance = cursorDistance(uv, cursor.xy, position);
      next += exp(-distance * distance / (radius * radius)) * impulse;
    }
  }
  textureStore(nextWave, cell, vec4f(clamp(next, -1.0, 1.0), current, 0.0, 0.0));
}`;

const cursorCaptureWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(18) var<storage, read_write> nextCursor: array<vec4f>;
@compute @workgroup_size(1, 1, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  nextCursor[invocation.x] = vec4f(globals.params[6].xy, globals.params[7].x, 1.0);
}`;

const resolveWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var waveTexture: texture_2d<f32>;
struct VertexOutput { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let triangle = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var output: VertexOutput;
  output.position = vec4f(triangle[vertexIndex], 0.0, 1.0);
  output.uv = triangle[vertexIndex] * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
  return output;
}
fn heightAt(cell: vec2i, dimensions: vec2i) -> f32 {
  return textureLoad(waveTexture, clamp(cell, vec2i(0), dimensions - vec2i(1)), 0).x;
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let source = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let amount = globals.params[8].x;
  if (amount <= 0.0) { return source; }
  let dimensions = vec2i(textureDimensions(waveTexture));
  let cell = clamp(vec2i(input.uv * vec2f(dimensions)), vec2i(0), dimensions - vec2i(1));
  let gradient = vec2f(
    heightAt(cell + vec2i(1, 0), dimensions) - heightAt(cell + vec2i(-1, 0), dimensions),
    heightAt(cell + vec2i(0, 1), dimensions) - heightAt(cell + vec2i(0, -1), dimensions)
  ) * 0.5;
  if (dot(gradient, gradient) <= 0.00000001) { return source; }
  let displacement = gradient * globals.params[4].x * globals.clock.z / globals.viewport.xy;
  let warpedUv = clamp(input.uv + displacement, vec2f(0.0), vec2f(1.0));
  let center = textureSampleLevel(sourceTexture, effectSampler, warpedUv, 0.0);
  let split = globals.params[5].x * globals.clock.z / globals.viewport.xy;
  let direction = normalize(gradient);
  let red = textureSampleLevel(sourceTexture, effectSampler, clamp(warpedUv + direction * split, vec2f(0.0), vec2f(1.0)), 0.0);
  let blue = textureSampleLevel(sourceTexture, effectSampler, clamp(warpedUv - direction * split, vec2f(0.0), vec2f(1.0)), 0.0);
  let warped = vec4f(
    vec3f(red.r / max(red.a, 0.00001), center.g / max(center.a, 0.00001), blue.b / max(blue.a, 0.00001)) * center.a,
    center.a
  );
  return mix(source, warped, amount);
}`;

export const CURSOR_WAVE_RIPPLES_EFFECT: EffectDefinition = {
  id: "an-native-owned-az-cursor-wave-ripples",
  name: "Cursor Wave Ripples",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    waveSpeed: {
      type: "float",
      label: "Wave speed",
      default: 0.65,
      min: 0,
      max: 1,
      step: 0.01,
    },
    damping: {
      type: "float",
      label: "Damping",
      default: 1.5,
      min: 0.1,
      max: 8,
      step: 0.1,
    },
    impact: {
      type: "float",
      label: "Impact",
      default: 0.8,
      min: 0,
      max: 2,
      step: 0.01,
    },
    brushRadius: {
      type: "float",
      label: "Brush radius",
      default: 48,
      min: 8,
      max: 180,
      step: 1,
      unit: "px",
    },
    displacement: {
      type: "float",
      label: "Displacement",
      default: 24,
      min: 0,
      max: 80,
      step: 1,
      unit: "px",
    },
    chromaticSplit: {
      type: "float",
      label: "Chromatic split",
      default: 1.2,
      min: 0,
      max: 8,
      step: 0.1,
      unit: "px",
    },
    pointerPosition: {
      type: "vec2",
      label: "Pointer position",
      default: [0.5, 0.5],
      min: 0,
      max: 1,
    },
    pointerActive: { type: "bool", label: "Pointer active", default: true },
    amount: {
      type: "float",
      label: "Amount",
      default: 0.85,
      min: 0,
      max: 1,
      step: 0.01,
    },
  },
  interaction: {
    positionProperty: "pointerPosition",
    activeProperty: "pointerActive",
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
      name: "wave",
      kind: "texture-2d",
      format: "rgba16float",
      usage: ["sampled", "storage"],
      persistent: true,
      size: "fixed",
      width: 128,
      height: 128,
    },
    {
      name: "cursor",
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
    stateResources: ["wave", "cursor"],
    sourceHistory: "sequential-captures",
  },
  passes: [
    {
      id: "advance-wave",
      kind: "compute",
      reads: [],
      previousFrameReads: ["wave", "cursor"],
      output: "wave",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
      wgsl: waveAdvanceWgsl,
    },
    {
      id: "capture-cursor",
      kind: "compute",
      reads: [],
      output: "cursor",
      dispatch: { elements: "output-buffer", workgroupSize: [1, 1, 1] },
      wgsl: cursorCaptureWgsl,
    },
    {
      id: "resolve",
      kind: "render",
      reads: ["source", "wave"],
      output: "color",
      wgsl: resolveWgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original two-time-slice damped wave field with cursor-path impact and source-image refraction.",
  },
};

export const CURSOR_WAVE_RIPPLES_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-az-glass-pulse",
    name: "Glass Pulse",
    definitionId: CURSOR_WAVE_RIPPLES_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      waveSpeed: 0.72,
      damping: 1.25,
      impact: 0.8,
      brushRadius: 42,
      displacement: 26,
      chromaticSplit: 0.6,
      pointerPosition: [0.5, 0.5],
      pointerActive: true,
      amount: 0.9,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-az-prismatic-wake",
    name: "Prismatic Wake",
    definitionId: CURSOR_WAVE_RIPPLES_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      waveSpeed: 0.42,
      damping: 0.65,
      impact: 1.45,
      brushRadius: 70,
      displacement: 48,
      chromaticSplit: 4,
      pointerPosition: [0.42, 0.5],
      pointerActive: true,
      amount: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];

export const CURSOR_WAVE_RIPPLES_PRESET_LABEL_SOURCE_IDS: Readonly<
  Record<string, string>
> = Object.fromEntries(
  CURSOR_WAVE_RIPPLES_PRESETS.map((preset) => [preset.id, preset.id]),
);
