import { NATIVE_GRAPH_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const grid = `${NATIVE_GRAPH_GLOBALS}
fn uvAt(p: vec2i, size: vec2i) -> vec2f { return (vec2f(p) + 0.5) / vec2f(size); }
fn inside(p: vec2i, size: vec2i) -> bool { return all(p >= vec2i(0)) && all(p < size); }
fn atEdge(uv: vec2f) -> bool { return any(uv <= vec2f(0.0)) || any(uv >= vec2f(1.0)); }
fn segmentDistance(point: vec2f, a: vec2f, b: vec2f) -> f32 {
  let direction = b - a;
  let t = clamp(dot(point - a, direction) / max(dot(direction, direction), 0.0001), 0.0, 1.0);
  return length(point - (a + direction * t));
}
`;

const advectVelocity = `${grid}
@group(0) @binding(2) var priorVelocity: texture_2d<f32>;
@group(0) @binding(3) var priorPointer: texture_2d<f32>;
@group(0) @binding(18) var outputTexture: texture_storage_2d<rgba16float, write>;
fn flowAt(uv: vec2f) -> vec2f { return textureSampleLevel(priorVelocity, effectSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0).xy; }
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2i(textureDimensions(outputTexture));
  if (any(id.xy >= vec2u(size))) { return; }
  let p = vec2i(id.xy);
  let uv = uvAt(p, size);
  let dt = globals.clock.w;
  let old = flowAt(uv);
  let traced = clamp(uv - old * dt * globals.params[2].x, vec2f(0.0), vec2f(1.0));
  var velocity = flowAt(traced);
  let texel = 1.0 / vec2f(size);
  let left = flowAt(traced - vec2f(texel.x, 0.0));
  let right = flowAt(traced + vec2f(texel.x, 0.0));
  let top = flowAt(traced - vec2f(0.0, texel.y));
  let bottom = flowAt(traced + vec2f(0.0, texel.y));
  let viscosity = globals.params[0].x;
  velocity = mix(velocity, (left + right + top + bottom) * 0.25, clamp(viscosity * dt * 12.0, 0.0, 1.0));
  velocity *= exp(-viscosity * dt);
  let curl = 0.5 * ((right.y - left.y) - (bottom.x - top.x));
  let leftCurl = 0.5 * ((flowAt(traced).y - flowAt(traced - vec2f(2.0 * texel.x, 0.0)).y) - (bottom.x - top.x));
  let topCurl = 0.5 * ((right.y - left.y) - (flowAt(traced).x - flowAt(traced - vec2f(0.0, 2.0 * texel.y)).x));
  let grad = vec2f(abs(curl) - abs(leftCurl), abs(curl) - abs(topCurl));
  let normal = grad / max(length(grad), 0.00001);
  velocity += vec2f(normal.y, -normal.x) * curl * globals.params[1].x * dt * 0.15;
  let previous = textureLoad(priorPointer, vec2i(0), 0);
  if (globals.params[9].x > 0.5) {
    let current = globals.params[8].xy * globals.viewport.xy;
    let start = select(current, previous.xy * globals.viewport.xy, previous.z > 0.5);
    let pixel = uv * globals.viewport.xy;
    let radius = max(1.0, globals.params[7].x * globals.clock.z);
    let ribbon = exp(-pow(segmentDistance(pixel, start, current) / radius, 2.0) * 2.0);
    let tangent = (current - start) / max(length(current - start), 1.0);
    let swirl = vec2f(-(pixel - current).y, (pixel - current).x) / max(length(pixel - current), 1.0);
    velocity += (tangent * 0.36 + swirl * 0.12) * globals.params[6].x * ribbon * dt;
  }
  if (globals.params[4].x < 0.5) { velocity.y -= dt * 0.004; }
  if (uv.x <= texel.x && velocity.x < 0.0) { velocity.x = 0.0; }
  if (uv.x >= 1.0 - texel.x && velocity.x > 0.0) { velocity.x = 0.0; }
  if (uv.y <= texel.y && velocity.y < 0.0) { velocity.y = 0.0; }
  if (uv.y >= 1.0 - texel.y && velocity.y > 0.0) { velocity.y = 0.0; }
  textureStore(outputTexture, p, vec4f(clamp(velocity, vec2f(-0.7), vec2f(0.7)), 0.0, 0.0));
}`;

const divergence = `${grid}
@group(0) @binding(2) var flow: texture_2d<f32>;
@group(0) @binding(18) var outputTexture: texture_storage_2d<rgba16float, write>;
fn component(p: vec2i, size: vec2i) -> vec2f { return select(vec2f(0.0), textureLoad(flow, clamp(p, vec2i(0), size - 1), 0).xy, inside(p, size)); }
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2i(textureDimensions(outputTexture));
  if (any(id.xy >= vec2u(size))) { return; }
  let p = vec2i(id.xy);
  let x = component(p + vec2i(1, 0), size).x - component(p + vec2i(-1, 0), size).x;
  let y = component(p + vec2i(0, 1), size).y - component(p + vec2i(0, -1), size).y;
  textureStore(outputTexture, p, vec4f(0.5 * (x + y), 0.0, 0.0, 0.0));
}`;

const pressure = `${grid}
@group(0) @binding(2) var divergenceTexture: texture_2d<f32>;
@group(0) @binding(3) var priorPressure: texture_2d<f32>;
@group(0) @binding(18) var outputTexture: texture_storage_2d<rgba16float, write>;
fn pressureAt(p: vec2i, size: vec2i, center: f32) -> f32 { return select(center, textureLoad(priorPressure, clamp(p, vec2i(0), size - 1), 0).x, inside(p, size)); }
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2i(textureDimensions(outputTexture));
  if (any(id.xy >= vec2u(size))) { return; }
  let p = vec2i(id.xy);
  let center = textureLoad(priorPressure, p, 0).x;
  let sum = pressureAt(p + vec2i(1, 0), size, center) + pressureAt(p + vec2i(-1, 0), size, center) + pressureAt(p + vec2i(0, 1), size, center) + pressureAt(p + vec2i(0, -1), size, center);
  textureStore(outputTexture, p, vec4f(0.25 * (sum - textureLoad(divergenceTexture, p, 0).x), 0.0, 0.0, 0.0));
}`;

const project = `${grid}
@group(0) @binding(2) var advected: texture_2d<f32>;
@group(0) @binding(3) var pressureTexture: texture_2d<f32>;
@group(0) @binding(18) var outputTexture: texture_storage_2d<rgba16float, write>;
fn pressureAt(p: vec2i, size: vec2i, center: f32) -> f32 { return select(center, textureLoad(pressureTexture, clamp(p, vec2i(0), size - 1), 0).x, inside(p, size)); }
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2i(textureDimensions(outputTexture));
  if (any(id.xy >= vec2u(size))) { return; }
  let p = vec2i(id.xy);
  let center = textureLoad(pressureTexture, p, 0).x;
  let x = pressureAt(p + vec2i(1, 0), size, center) - pressureAt(p + vec2i(-1, 0), size, center);
  let y = pressureAt(p + vec2i(0, 1), size, center) - pressureAt(p + vec2i(0, -1), size, center);
  var velocity = textureLoad(advected, p, 0).xy - 0.5 * vec2f(x, y);
  if (p.x == 0 && velocity.x < 0.0) { velocity.x = 0.0; }
  if (p.y == 0 && velocity.y < 0.0) { velocity.y = 0.0; }
  if (p.x == size.x - 1 && velocity.x > 0.0) { velocity.x = 0.0; }
  if (p.y == size.y - 1 && velocity.y > 0.0) { velocity.y = 0.0; }
  textureStore(outputTexture, p, vec4f(clamp(velocity, vec2f(-0.7), vec2f(0.7)), 0.0, 0.0));
}`;

const dyeHelpers = `${grid}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var flowTexture: texture_2d<f32>;
@group(0) @binding(4) var priorDye: texture_2d<f32>;
@group(0) @binding(5) var priorPointer: texture_2d<f32>;
@group(0) @binding(6) var<storage, read> priorClock: array<vec4f>;
fn sourceAt(uv: vec2f) -> vec4f { return textureSampleLevel(sourceTexture, effectSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0); }
fn injection(uv: vec2f, dt: f32) -> vec4f {
  let source = sourceAt(uv);
  let sourceWeight = clamp(globals.params[5].x * max(dt, 1.0 / 60.0) * 2.5, 0.0, 1.0);
  var added = vec4f(source.rgb * sourceWeight, source.a * sourceWeight);
  if (globals.params[9].x > 0.5) {
    let current = globals.params[8].xy * globals.viewport.xy;
    let old = textureLoad(priorPointer, vec2i(0), 0);
    let start = select(current, old.xy * globals.viewport.xy, old.z > 0.5);
    let radius = max(1.0, globals.params[7].x * globals.clock.z);
    let ribbon = exp(-pow(segmentDistance(uv * globals.viewport.xy, start, current) / radius, 2.0) * 2.0);
    let density = clamp(ribbon * globals.params[6].x * max(dt, 1.0 / 60.0) * 2.0, 0.0, 1.0);
    let palette = globals.params[10];
    added += vec4f(palette.rgb * palette.a * density, palette.a * density);
  }
  return added * min(1.0, 1.0 / max(added.a, 0.00001));
}
`;

const advanceDye = `${dyeHelpers}
@group(0) @binding(18) var outputTexture: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2i(textureDimensions(outputTexture));
  if (any(id.xy >= vec2u(size))) { return; }
  let uv = uvAt(vec2i(id.xy), size);
  let fixedDt = globals.clock.w;
  let recorded = priorClock[0];
  let elapsed = select(fixedDt, max(fixedDt, globals.clock.x - recorded.x), recorded.y > 0.5 && fixedDt > 0.0);
  let flow = textureSampleLevel(flowTexture, effectSampler, uv, 0.0).xy;
  let traced = uv - flow * globals.params[2].x * fixedDt;
  var dye = vec4f(0.0);
  if (!atEdge(traced)) { dye = textureSampleLevel(priorDye, effectSampler, traced, 0.0); }
  let halfLife = max(0.1, globals.params[3].x);
  let modeDecay = select(0.45, 1.0, globals.params[4].x < 0.5);
  dye *= exp(-0.69314718 * elapsed * modeDecay / halfLife);
  let added = injection(uv, fixedDt);
  let room = max(0.0, 1.0 - dye.a);
  dye += added * room;
  dye.a = clamp(dye.a, 0.0, 1.0);
  textureStore(outputTexture, vec2i(id.xy), dye);
}`;

const advanceAge = `${grid}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var flowTexture: texture_2d<f32>;
@group(0) @binding(4) var currentDye: texture_2d<f32>;
@group(0) @binding(5) var priorAge: texture_2d<f32>;
@group(0) @binding(6) var priorPointer: texture_2d<f32>;
@group(0) @binding(7) var<storage, read> priorClock: array<vec4f>;
@group(0) @binding(18) var outputTexture: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2i(textureDimensions(outputTexture));
  if (any(id.xy >= vec2u(size))) { return; }
  let uv = uvAt(vec2i(id.xy), size);
  let fixedDt = globals.clock.w;
  let recorded = priorClock[0];
  let elapsed = select(fixedDt, max(fixedDt, globals.clock.x - recorded.x), recorded.y > 0.5 && fixedDt > 0.0);
  let flow = textureSampleLevel(flowTexture, effectSampler, uv, 0.0).xy;
  let traced = uv - flow * globals.params[2].x * fixedDt;
  var age = 0.0;
  if (!atEdge(traced)) { age = textureSampleLevel(priorAge, effectSampler, traced, 0.0).x + elapsed; }
  let source = textureSampleLevel(sourceTexture, effectSampler, uv, 0.0);
  let sourceStamp = source.a * globals.params[5].x * max(fixedDt, 1.0 / 60.0) * 2.5;
  var pointerStamp = 0.0;
  if (globals.params[9].x > 0.5) {
    let current = globals.params[8].xy * globals.viewport.xy;
    let old = textureLoad(priorPointer, vec2i(0), 0);
    let start = select(current, old.xy * globals.viewport.xy, old.z > 0.5);
    let radius = max(1.0, globals.params[7].x * globals.clock.z);
    pointerStamp = exp(-pow(segmentDistance(uv * globals.viewport.xy, start, current) / radius, 2.0) * 2.0) * globals.params[6].x * max(fixedDt, 1.0 / 60.0) * 2.0;
  }
  let density = textureLoad(currentDye, vec2i(id.xy), 0).a;
  age = select(min(age, 60.0), age * max(0.0, 1.0 - clamp(sourceStamp + pointerStamp, 0.0, 1.0)), density > 0.0001);
  textureStore(outputTexture, vec2i(id.xy), vec4f(age, density, 0.0, 0.0));
}`;

const captureClock = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(18) var<storage, read_write> nextClock: array<vec4f>;
@compute @workgroup_size(1, 1, 1)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  nextClock[id.x] = vec4f(globals.clock.x, 1.0, 0.0, 0.0);
}`;

const rememberPointer = `${grid}
@group(0) @binding(2) var oldPointer: texture_2d<f32>;
@group(0) @binding(18) var outputTexture: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(1, 1, 1)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= vec2u(textureDimensions(outputTexture)))) { return; }
  let prior = textureLoad(oldPointer, vec2i(0), 0);
  let current = vec4f(globals.params[8].xy, globals.params[9].x, 1.0);
  textureStore(outputTexture, vec2i(0), select(prior, current, globals.clock.w > 0.0 || prior.w < 0.5));
}`;

const composite = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var dyeTexture: texture_2d<f32>;
@group(0) @binding(4) var ageTexture: texture_2d<f32>;
struct VertexOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) index: u32) -> VertexOut {
  let point = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0))[index];
  var out: VertexOut;
  out.position = vec4f(point, 0.0, 1.0);
  out.uv = point * vec2f(0.5, -0.5) + vec2f(0.5);
  return out;
}
@fragment fn fs(input: VertexOut) -> @location(0) vec4f {
  let source = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let dye = textureSampleLevel(dyeTexture, effectSampler, input.uv, 0.0);
  let age = textureSampleLevel(ageTexture, effectSampler, input.uv, 0.0).x;
  let ageFade = exp(-age * 0.05);
  let opacity = clamp(dye.a * ageFade, 0.0, 1.0) * globals.params[11].x;
  let dyeColor = dye.rgb * ageFade * select(0.7, 1.0, globals.params[4].x < 0.5);
  return vec4f(source.rgb * (1.0 - opacity) + dyeColor * globals.params[11].x, source.a * (1.0 - opacity) + opacity);
}`;

const texture = (name: string, width = 128, persistent = false) => ({
  name,
  kind: "texture-2d" as const,
  format: "rgba16float",
  usage: ["sampled", "storage"] as ("sampled" | "storage")[],
  size: "fixed" as const,
  width,
  height: width,
  ...(persistent ? { persistent: true } : {}),
});

export const PROJECTED_DYE_FLOW_EFFECT: EffectDefinition = {
  id: "an-native-owned-bb-projected-dye-flow",
  name: "Projected Dye Flow",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    viscosity: {
      type: "float",
      label: "Viscosity",
      default: 0.3,
      min: 0,
      max: 1,
      step: 0.01,
    },
    vorticity: {
      type: "float",
      label: "Vorticity",
      default: 0.7,
      min: 0,
      max: 2,
      step: 0.01,
    },
    advection: {
      type: "float",
      label: "Advection",
      default: 1,
      min: 0.1,
      max: 2,
      step: 0.01,
    },
    aging: {
      type: "float",
      label: "Dye lifetime",
      default: 7,
      min: 0.2,
      max: 30,
      step: 0.1,
      unit: "s",
    },
    flowMode: {
      type: "enum",
      label: "Flow mode",
      default: "smoke",
      options: ["smoke", "ink"],
    },
    sourceContribution: {
      type: "float",
      label: "Source contribution",
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
    },
    ribbonForce: {
      type: "float",
      label: "Ribbon force",
      default: 1,
      min: 0,
      max: 3,
      step: 0.01,
    },
    ribbonRadius: {
      type: "float",
      label: "Ribbon radius",
      default: 65,
      min: 5,
      max: 200,
      step: 1,
      unit: "px",
    },
    pointerPosition: {
      type: "vec2",
      label: "Pointer position",
      default: [0.5, 0.5],
      min: 0,
      max: 1,
    },
    pointerActive: { type: "bool", label: "Pointer active", default: false },
    dyeColor: {
      type: "color",
      label: "Dye color",
      default: { space: "srgb", components: [0.365, 0.525, 0.91], alpha: 1 },
    },
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
    texture("advectedVelocity"),
    texture("divergence"),
    ...Array.from({ length: 7 }, (_, index) => texture(`pressure${index}`)),
    texture("pressure", 128, true),
    texture("velocity", 128, true),
    texture("dye", 256, true),
    texture("age", 256, true),
    texture("pointer", 1, true),
    {
      name: "captureClock",
      kind: "buffer",
      usage: ["storage"],
      size: "fixed",
      byteLength: 16,
      persistent: true,
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
    stateResources: [
      "pressure",
      "velocity",
      "dye",
      "age",
      "pointer",
      "captureClock",
    ],
    sourceHistory: "sequential-captures",
  },
  passes: [
    {
      id: "advect-velocity",
      kind: "compute",
      wgsl: advectVelocity,
      reads: [],
      previousFrameReads: ["velocity", "pointer"],
      output: "advectedVelocity",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
    },
    {
      id: "divergence",
      kind: "compute",
      wgsl: divergence,
      reads: ["advectedVelocity"],
      output: "divergence",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
    },
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `pressure-${index}`,
      kind: "compute" as const,
      wgsl: pressure,
      reads:
        index === 0 ? ["divergence"] : ["divergence", `pressure${index - 1}`],
      ...(index === 0 ? { previousFrameReads: ["pressure"] } : {}),
      output: index === 7 ? "pressure" : `pressure${index}`,
      dispatch: {
        elements: "output-texture" as const,
        workgroupSize: [8, 8, 1] as const,
      },
    })),
    {
      id: "project-velocity",
      kind: "compute",
      wgsl: project,
      reads: ["advectedVelocity", "pressure"],
      output: "velocity",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
    },
    {
      id: "advance-dye",
      kind: "compute",
      wgsl: advanceDye,
      reads: ["source", "velocity"],
      previousFrameReads: ["dye", "pointer", "captureClock"],
      output: "dye",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
    },
    {
      id: "advance-age",
      kind: "compute",
      wgsl: advanceAge,
      reads: ["source", "velocity", "dye"],
      previousFrameReads: ["age", "pointer", "captureClock"],
      output: "age",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
    },
    {
      id: "remember-pointer",
      kind: "compute",
      wgsl: rememberPointer,
      reads: [],
      previousFrameReads: ["pointer"],
      output: "pointer",
      dispatch: { elements: "output-texture", workgroupSize: [1, 1, 1] },
    },
    {
      id: "capture-clock",
      kind: "compute",
      wgsl: captureClock,
      reads: [],
      output: "captureClock",
      dispatch: { elements: "output-buffer", workgroupSize: [1, 1, 1] },
    },
    {
      id: "compose",
      kind: "render",
      wgsl: composite,
      reads: ["source", "dye", "age"],
      output: "color",
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original bounded projected velocity advects retained premultiplied source dye and age; pointer ribbons inject pigment into transparent regions within the layer bounds.",
  },
};

export const PROJECTED_DYE_FLOW_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-bb-rising-pigment",
    name: "Rising Pigment",
    definitionId: PROJECTED_DYE_FLOW_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      viscosity: 0.22,
      vorticity: 1.1,
      advection: 1.15,
      aging: 6,
      flowMode: "smoke",
      sourceContribution: 0.65,
      ribbonForce: 1.3,
      ribbonRadius: 76,
      pointerPosition: [0.5, 0.5],
      pointerActive: true,
      dyeColor: { space: "srgb", components: [0.41, 0.56, 0.91], alpha: 1 },
      amount: 0.85,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-bb-ink-ribbon",
    name: "Ink Ribbon",
    definitionId: PROJECTED_DYE_FLOW_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      viscosity: 0.55,
      vorticity: 0.5,
      advection: 0.85,
      aging: 14,
      flowMode: "ink",
      sourceContribution: 0.3,
      ribbonForce: 1.75,
      ribbonRadius: 44,
      pointerPosition: [0.5, 0.5],
      pointerActive: true,
      dyeColor: { space: "srgb", components: [0.85, 0.36, 0.56], alpha: 1 },
      amount: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
