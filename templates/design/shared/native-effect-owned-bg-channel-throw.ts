import { NATIVE_GRAPH_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const advanceFieldWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var previousField: texture_2d<f32>;
@group(0) @binding(4) var previousPointer: texture_2d<f32>;
@group(0) @binding(18) var nextField: texture_storage_2d<rgba16float, write>;

fn responseAt(uv: vec2f) -> f32 {
  let sample = textureSampleLevel(sourceTexture, effectSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
  let straight = select(vec3f(0.0), sample.rgb / max(sample.a, 0.00001), sample.a > 0.00001);
  let luma = dot(straight, vec3f(0.2126, 0.7152, 0.0722));
  let channel = globals.params[0].x;
  var value = luma;
  if (channel > 0.5 && channel < 1.5) { value = 1.0 - luma; }
  if (channel > 1.5 && channel < 2.5) { value = straight.r; }
  if (channel > 2.5 && channel < 3.5) { value = straight.g; }
  if (channel > 3.5) { value = straight.b; }
  return mix(1.0, clamp(value, 0.0, 1.0), clamp(globals.params[1].x * sample.a, 0.0, 1.0));
}

@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let dimensions = vec2i(textureDimensions(nextField));
  if (any(invocation.xy >= vec2u(dimensions))) { return; }
  let cell = vec2i(invocation.xy);
  let previous = textureLoad(previousField, cell, 0);
  let dt = globals.clock.w;
  if (dt <= 0.0) { textureStore(nextField, cell, previous); return; }

  let uv = (vec2f(cell) + 0.5) / vec2f(dimensions);
  let cssSize = globals.viewport.xy / max(globals.clock.z, 0.01);
  let backtrace = uv - previous.zw * dt * globals.params[5].x / cssSize;
  let advected = textureSampleLevel(previousField, effectSampler, clamp(backtrace, vec2f(0.0), vec2f(1.0)), 0.0);
  let response = responseAt(uv);
  var velocity = mix(advected.zw, previous.zw, globals.params[3].x)
    * exp(-(0.25 + globals.params[4].x * 10.0) * dt);
  velocity += (globals.params[9].xy * 120.0 * response - advected.xy * globals.params[6].x * 16.0) * dt;

  let cursor = clamp(globals.params[11].xy, vec2f(0.0), vec2f(1.0));
  let priorCursor = textureLoad(previousPointer, vec2i(0), 0);
  if (globals.params[12].x > 0.5 && priorCursor.z > 0.5) {
    let pointerMotion = (cursor - priorCursor.xy) * cssSize;
    if (dot(pointerMotion, pointerMotion) > 0.04) {
      let offset = (uv - cursor) * cssSize;
      let radius = max(globals.params[7].x, 1.0);
      let brush = exp(-dot(offset, offset) / (radius * radius));
      let pointerVelocity = clamp(pointerMotion / dt, vec2f(-900.0), vec2f(900.0));
      velocity += pointerVelocity * brush * response * globals.params[2].x * 0.8;
    }
  }
  velocity = clamp(velocity, vec2f(-1200.0), vec2f(1200.0));
  let limit = max(globals.params[8].x, 1.0);
  let displacement = clamp(advected.xy + velocity * dt, vec2f(-limit), vec2f(limit));
  textureStore(nextField, cell, vec4f(displacement, velocity));
}`;

const capturePointerWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(18) var nextPointer: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(1, 1, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.x > 0u) { return; }
  textureStore(nextPointer, vec2i(0), vec4f(clamp(globals.params[11].xy, vec2f(0.0), vec2f(1.0)), globals.params[12].x, 1.0));
}`;

const resolveWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var fieldTexture: texture_2d<f32>;
struct VertexOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) index: u32) -> VertexOut {
  let triangle = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var output: VertexOut;
  output.position = vec4f(triangle[index], 0.0, 1.0);
  output.uv = triangle[index] * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
  return output;
}
fn displacedSource(uv: vec2f, edge: f32) -> vec4f {
  if (edge < 0.5) {
    if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return vec4f(0.0); }
    return textureSampleLevel(sourceTexture, effectSampler, uv, 0.0);
  }
  if (edge < 1.5) {
    return textureSampleLevel(sourceTexture, effectSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
  }
  if (edge < 2.5) {
    return textureSampleLevel(sourceTexture, effectSampler, fract(uv), 0.0);
  }
  let mirrored = vec2f(1.0) - abs(fract(uv * 0.5) * 2.0 - vec2f(1.0));
  return textureSampleLevel(sourceTexture, effectSampler, mirrored, 0.0);
}
@fragment fn fs(input: VertexOut) -> @location(0) vec4f {
  let source = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let amount = clamp(globals.params[13].x, 0.0, 1.0);
  if (amount <= 0.0) { return source; }
  let displacementCss = textureSampleLevel(fieldTexture, effectSampler, input.uv, 0.0).xy;
  let displacedUv = input.uv - displacementCss * globals.clock.z * globals.viewport.zw;
  let warped = displacedSource(displacedUv, globals.params[10].x);
  return mix(source, warped, amount);
}`;

export const CHANNEL_THROW_EFFECT: EffectDefinition = {
  id: "an-native-owned-bg-channel-throw",
  name: "Channel Throw",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    throwChannel: {
      type: "enum",
      label: "Throw channel",
      default: "Luma",
      options: ["Luma", "Darkness", "Red", "Green", "Blue"],
    },
    channelWeight: {
      type: "float",
      label: "Channel weight",
      default: 0.8,
      min: 0,
      max: 1,
      step: 0.01,
    },
    throwStrength: {
      type: "float",
      label: "Throw strength",
      default: 0.9,
      min: 0,
      max: 2,
      step: 0.01,
    },
    momentum: {
      type: "float",
      label: "Momentum",
      default: 0.75,
      min: 0,
      max: 1,
      step: 0.01,
    },
    friction: {
      type: "float",
      label: "Friction",
      default: 0.35,
      min: 0,
      max: 1,
      step: 0.01,
    },
    fieldAdvection: {
      type: "float",
      label: "Field advection",
      default: 0.6,
      min: 0,
      max: 1,
      step: 0.01,
    },
    returnForce: {
      type: "float",
      label: "Return force",
      default: 0.25,
      min: 0,
      max: 1,
      step: 0.01,
    },
    throwBrushRadius: {
      type: "float",
      label: "Throw radius",
      default: 92,
      min: 8,
      max: 240,
      step: 1,
      unit: "px",
    },
    displacementLimit: {
      type: "float",
      label: "Displacement limit",
      default: 110,
      min: 8,
      max: 240,
      step: 1,
      unit: "px",
    },
    ambientForce: {
      type: "vec2",
      label: "Ambient force",
      default: [0.15, 0],
      min: -2,
      max: 2,
    },
    throwEdgeMode: {
      type: "enum",
      label: "Throw edge mode",
      default: "Transparent",
      options: ["Transparent", "Clamp", "Repeat", "Mirror"],
    },
    pointerPosition: {
      type: "vec2",
      label: "Pointer position",
      default: [0.5, 0.5],
      min: 0,
      max: 1,
    },
    pointerActive: { type: "bool", label: "Pointer active", default: false },
    amount: {
      type: "float",
      label: "Amount",
      default: 0.9,
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
      name: "field",
      kind: "texture-2d",
      format: "rgba16float",
      usage: ["sampled", "storage"],
      persistent: true,
      size: "fixed",
      width: 128,
      height: 128,
    },
    {
      name: "pointer",
      kind: "texture-2d",
      format: "rgba16float",
      usage: ["sampled", "storage"],
      persistent: true,
      size: "fixed",
      width: 1,
      height: 1,
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
    timing: { fixedDt: 1 / 60, maxStepsPerCall: 16, maxStepIndex: 36_000 },
    stateResources: ["field", "pointer"],
    sourceHistory: "sequential-captures",
  },
  passes: [
    {
      id: "advect-channel-field",
      kind: "compute",
      wgsl: advanceFieldWgsl,
      reads: ["source"],
      previousFrameReads: ["field", "pointer"],
      output: "field",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
    },
    {
      id: "capture-pointer",
      kind: "compute",
      wgsl: capturePointerWgsl,
      reads: [],
      output: "pointer",
      dispatch: { elements: "output-texture", workgroupSize: [1, 1, 1] },
    },
    {
      id: "resolve",
      kind: "render",
      wgsl: resolveWgsl,
      reads: ["source", "field"],
      output: "color",
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original semi-Lagrangian channel-weighted throw field with retained pointer momentum, friction, and four source edge treatments.",
  },
};

export const CHANNEL_THROW_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-bg-channel-throw-light-current",
    name: "Light Current",
    definitionId: CHANNEL_THROW_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      throwChannel: "Luma",
      channelWeight: 0.85,
      throwStrength: 0.6,
      momentum: 0.65,
      friction: 0.42,
      fieldAdvection: 0.5,
      returnForce: 0.32,
      throwBrushRadius: 110,
      displacementLimit: 90,
      ambientForce: [0.28, 0.04],
      throwEdgeMode: "Transparent",
      pointerActive: true,
      amount: 0.88,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-bg-channel-throw-dark-loop",
    name: "Dark Loop",
    definitionId: CHANNEL_THROW_EFFECT.id,
    definitionVersion: 1,
    placement: "backdrop",
    params: {
      throwChannel: "Darkness",
      channelWeight: 1,
      throwStrength: 1.35,
      momentum: 0.9,
      friction: 0.18,
      fieldAdvection: 0.85,
      returnForce: 0.12,
      throwBrushRadius: 65,
      displacementLimit: 170,
      ambientForce: [-0.15, 0.24],
      throwEdgeMode: "Mirror",
      pointerActive: true,
      amount: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
