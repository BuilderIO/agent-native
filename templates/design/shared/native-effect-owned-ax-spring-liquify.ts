import { NATIVE_GRAPH_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const pointerWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var previousPointer: texture_2d<f32>;
@group(0) @binding(18) var nextPointer: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  if (any(invocation.xy > vec2u(0))) { return; }
  let previous = textureLoad(previousPointer, vec2i(0), 0);
  let position = clamp(globals.params[7].xy, vec2f(0.0), vec2f(1.0));
  let engaged = select(0.0, 1.0, globals.params[8].x > 0.5);
  if (globals.clock.w == 0.0) {
    textureStore(nextPointer, vec2i(0), vec4f(position, engaged, 0.0));
    return;
  }
  textureStore(nextPointer, vec2i(0), vec4f(position, engaged, previous.z));
}`;

const springWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var previousField: texture_2d<f32>;
@group(0) @binding(3) var previousPointer: texture_2d<f32>;
@group(0) @binding(18) var nextField: texture_storage_2d<rgba16float, write>;
fn fieldAt(uv: vec2f) -> vec4f {
  return textureSampleLevel(previousField, effectSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
}
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let size = vec2i(textureDimensions(nextField));
  if (any(invocation.xy >= vec2u(size))) { return; }
  let point = vec2i(invocation.xy);
  let uv = (vec2f(point) + 0.5) / vec2f(size);
  let old = textureLoad(previousField, point, 0);
  let dt = globals.clock.w;
  if (dt <= 0.0) { textureStore(nextField, point, old); return; }
  let pixel = 1.0 / vec2f(size);
  let neighbors = (fieldAt(uv - vec2f(pixel.x, 0.0)).xy +
    fieldAt(uv + vec2f(pixel.x, 0.0)).xy +
    fieldAt(uv - vec2f(0.0, pixel.y)).xy +
    fieldAt(uv + vec2f(0.0, pixel.y)).xy) * 0.25;
  let elasticity = globals.params[0].x;
  let recoil = globals.params[1].x;
  let damping = globals.params[2].x;
  var acceleration = -old.xy * (3.0 + elasticity * 20.0) +
    (neighbors - old.xy) * recoil * 38.0;
  acceleration += globals.params[5].xy * 250.0;
  let currentPointer = clamp(globals.params[7].xy, vec2f(0.0), vec2f(1.0));
  let priorPointer = textureLoad(previousPointer, vec2i(0), 0);
  var velocity = old.zw;
  if (globals.params[8].x > 0.5 && priorPointer.z > 0.5) {
    let density = max(globals.clock.z, 0.01);
    let outputSizeCss = globals.viewport.xy / density;
    let offset = (uv - currentPointer) * outputSizeCss;
    let radius = max(1.0, globals.params[3].x);
    let brush = exp(-dot(offset, offset) / (radius * radius));
    let pointerMotion = (currentPointer - priorPointer.xy) * outputSizeCss;
    let pointerVelocity = clamp(pointerMotion / dt, vec2f(-600.0), vec2f(600.0));
    velocity += pointerVelocity * brush * globals.params[4].x * 0.85;
  }
  velocity += acceleration * dt;
  velocity *= exp(-(0.5 + damping * 11.0) * dt);
  velocity = clamp(velocity, vec2f(-600.0), vec2f(600.0));
  let displacement = clamp(old.xy + velocity * dt, vec2f(-240.0), vec2f(240.0));
  textureStore(nextField, point, vec4f(displacement, velocity));
}`;

const resolveWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var fieldTexture: texture_2d<f32>;
struct VertexOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) index: u32) -> VertexOut {
  let xy = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var output: VertexOut;
  output.position = vec4f(xy[index], 0.0, 1.0);
  output.uv = xy[index] * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
  return output;
}
@fragment fn fs(input: VertexOut) -> @location(0) vec4f {
  let source = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let amount = clamp(globals.params[6].x, 0.0, 1.0);
  if (amount <= 0.0) { return source; }
  let displacementCss = textureSampleLevel(fieldTexture, effectSampler, input.uv, 0.0).xy;
  let displacedUv = input.uv - displacementCss * globals.clock.z * globals.viewport.zw;
  var displaced = vec4f(0.0);
  if (all(displacedUv >= vec2f(0.0)) && all(displacedUv <= vec2f(1.0))) {
    displaced = textureSampleLevel(sourceTexture, effectSampler, displacedUv, 0.0);
  }
  return mix(source, displaced, amount);
}`;

export const SPRING_LIQUIFY_EFFECT: EffectDefinition = {
  id: "an-native-owned-ax-spring-liquify",
  name: "Spring Liquify",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    elasticity: {
      type: "float",
      label: "Elasticity",
      default: 0.55,
      min: 0,
      max: 1,
      step: 0.01,
    },
    recoil: {
      type: "float",
      label: "Recoil",
      default: 0.55,
      min: 0,
      max: 1,
      step: 0.01,
    },
    damping: {
      type: "float",
      label: "Damping",
      default: 0.4,
      min: 0,
      max: 1,
      step: 0.01,
    },
    brushRadius: {
      type: "float",
      label: "Brush radius",
      default: 90,
      min: 8,
      max: 240,
      step: 1,
      unit: "px",
    },
    dragForce: {
      type: "float",
      label: "Drag force",
      default: 0.8,
      min: 0,
      max: 2,
      step: 0.01,
    },
    wind: { type: "vec2", label: "Wind", default: [0.35, 0], min: -1, max: 1 },
    amount: {
      type: "float",
      label: "Amount",
      default: 0.9,
      min: 0,
      max: 1,
      step: 0.01,
    },
    pointerPosition: {
      type: "vec2",
      label: "Pointer position",
      default: [0.5, 0.5],
      min: 0,
      max: 1,
    },
    pointerActive: { type: "bool", label: "Pointer active", default: false },
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
    stateResources: ["pointer", "field"],
    sourceHistory: "sequential-captures",
  },
  passes: [
    {
      id: "track-pointer",
      kind: "compute",
      wgsl: pointerWgsl,
      reads: [],
      previousFrameReads: ["pointer"],
      output: "pointer",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
    },
    {
      id: "spring-field",
      kind: "compute",
      wgsl: springWgsl,
      reads: [],
      previousFrameReads: ["field", "pointer"],
      output: "field",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
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
    note: "Original damped spring lattice with retained image displacement, pointer-motion impulses, and premultiplied source resampling across transparent content.",
  },
};

export const SPRING_LIQUIFY_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-ax-spring-liquify-soft-pull",
    name: "Soft Pull",
    definitionId: SPRING_LIQUIFY_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      elasticity: 0.28,
      recoil: 0.78,
      damping: 0.32,
      brushRadius: 120,
      dragForce: 1.25,
      wind: [0.75, 0.05],
      amount: 0.9,
      pointerActive: true,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-ax-spring-liquify-quick-recoil",
    name: "Quick Recoil",
    definitionId: SPRING_LIQUIFY_EFFECT.id,
    definitionVersion: 1,
    placement: "backdrop",
    params: {
      elasticity: 0.9,
      recoil: 0.3,
      damping: 0.14,
      brushRadius: 55,
      dragForce: 0.65,
      wind: [-0.45, 0.2],
      amount: 1,
      pointerActive: true,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
