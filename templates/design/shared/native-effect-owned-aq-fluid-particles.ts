import { NATIVE_GRAPH_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const fluidCommon = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
fn sourceAt(uv: vec2f) -> vec4f {
  return textureSampleLevel(sourceTexture, effectSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
}
fn contained(uv: vec2f) -> bool {
  return all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0)) && sourceAt(uv).a > 0.025;
}
fn fluidUv(point: vec2i, size: vec2i) -> vec2f {
  return (vec2f(point) + vec2f(0.5)) / vec2f(size);
}
fn bounded(point: vec2i, size: vec2i) -> vec2i {
  return clamp(point, vec2i(0), size - vec2i(1));
}
`;

const advectVelocityWgsl = `${fluidCommon}
@group(0) @binding(3) var priorVelocity: texture_2d<f32>;
@group(0) @binding(18) var nextVelocity: texture_storage_2d<rgba16float, write>;
fn velocityAt(uv: vec2f) -> vec2f {
  return textureSampleLevel(priorVelocity, effectSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0).xy;
}
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let size = vec2i(textureDimensions(nextVelocity));
  if (any(invocation.xy >= vec2u(size))) { return; }
  let point = vec2i(invocation.xy);
  let uv = fluidUv(point, size);
  if (!contained(uv)) { textureStore(nextVelocity, point, vec4f(0.0)); return; }
  let dt = globals.clock.w;
  let old = velocityAt(uv);
  var backtrace = uv - old * dt;
  if (!contained(backtrace)) { backtrace = uv; }
  var flow = velocityAt(backtrace);
  let pixel = vec2f(1.0) / vec2f(size);
  let left = select(flow, velocityAt(uv - vec2f(pixel.x, 0.0)), contained(uv - vec2f(pixel.x, 0.0)));
  let right = select(flow, velocityAt(uv + vec2f(pixel.x, 0.0)), contained(uv + vec2f(pixel.x, 0.0)));
  let top = select(flow, velocityAt(uv - vec2f(0.0, pixel.y)), contained(uv - vec2f(0.0, pixel.y)));
  let bottom = select(flow, velocityAt(uv + vec2f(0.0, pixel.y)), contained(uv + vec2f(0.0, pixel.y)));
  let viscosity = globals.params[0].x;
  flow = mix(flow, (left + right + top + bottom) * 0.25, clamp(viscosity * dt * 9.0, 0.0, 1.0));
  flow *= exp(-viscosity * dt * 0.65);
  let turbulence = globals.params[1].x;
  let angle = sin(uv.x * 37.0 + globals.clock.x * 1.7 + globals.clock.y) * cos(uv.y * 31.0 - globals.clock.x * 1.3);
  flow += vec2f(-cos(angle * 3.0 + uv.y * 19.0), sin(angle * 3.0 + uv.x * 17.0)) * turbulence * dt * 0.055;
  if (globals.params[10].x > 0.5) {
    let pointer = globals.params[9].xy;
    let offset = (uv - pointer) * globals.viewport.xy;
    let radius = max(1.0, globals.params[3].x * globals.clock.z);
    let brush = exp(-dot(offset, offset) / (radius * radius));
    let tangent = vec2f(-offset.y, offset.x) / max(length(offset), 1.0);
    flow += tangent * globals.params[2].x * brush * dt * 0.28;
  }
  textureStore(nextVelocity, point, vec4f(clamp(flow, vec2f(-0.6), vec2f(0.6)), 0.0, 0.0));
}`;

const divergenceWgsl = `${fluidCommon}
@group(0) @binding(3) var advectedVelocity: texture_2d<f32>;
@group(0) @binding(18) var divergenceOutput: texture_storage_2d<rgba16float, write>;
fn componentAt(point: vec2i, size: vec2i) -> vec2f {
  let uv = fluidUv(point, size);
  return select(vec2f(0.0), textureLoad(advectedVelocity, bounded(point, size), 0).xy, contained(uv));
}
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let size = vec2i(textureDimensions(divergenceOutput));
  if (any(invocation.xy >= vec2u(size))) { return; }
  let point = vec2i(invocation.xy);
  if (!contained(fluidUv(point, size))) { textureStore(divergenceOutput, point, vec4f(0.0)); return; }
  let left = componentAt(point + vec2i(-1, 0), size);
  let right = componentAt(point + vec2i(1, 0), size);
  let top = componentAt(point + vec2i(0, -1), size);
  let bottom = componentAt(point + vec2i(0, 1), size);
  let divergence = 0.5 * (right.x - left.x + bottom.y - top.y);
  textureStore(divergenceOutput, point, vec4f(divergence, 0.0, 0.0, 0.0));
}`;

function pressureWgsl(): string {
  return `${fluidCommon}
@group(0) @binding(3) var divergenceTexture: texture_2d<f32>;
@group(0) @binding(4) var pressureTexture: texture_2d<f32>;
@group(0) @binding(18) var nextPressure: texture_storage_2d<rgba16float, write>;
fn pressureAt(point: vec2i, size: vec2i, center: f32) -> f32 {
  return select(center, textureLoad(pressureTexture, bounded(point, size), 0).x, contained(fluidUv(point, size)));
}
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let size = vec2i(textureDimensions(nextPressure));
  if (any(invocation.xy >= vec2u(size))) { return; }
  let point = vec2i(invocation.xy);
  if (!contained(fluidUv(point, size))) { textureStore(nextPressure, point, vec4f(0.0)); return; }
  let center = textureLoad(pressureTexture, point, 0).x;
  let left = pressureAt(point + vec2i(-1, 0), size, center);
  let right = pressureAt(point + vec2i(1, 0), size, center);
  let top = pressureAt(point + vec2i(0, -1), size, center);
  let bottom = pressureAt(point + vec2i(0, 1), size, center);
  let divergence = textureLoad(divergenceTexture, point, 0).x;
  textureStore(nextPressure, point, vec4f((left + right + top + bottom - divergence) * 0.25, 0.0, 0.0, 0.0));
}`;
}

const projectVelocityWgsl = `${fluidCommon}
@group(0) @binding(3) var advectedVelocity: texture_2d<f32>;
@group(0) @binding(4) var pressureTexture: texture_2d<f32>;
@group(0) @binding(18) var projectedVelocity: texture_storage_2d<rgba16float, write>;
fn pressureAt(point: vec2i, size: vec2i, center: f32) -> f32 {
  return select(center, textureLoad(pressureTexture, bounded(point, size), 0).x, contained(fluidUv(point, size)));
}
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let size = vec2i(textureDimensions(projectedVelocity));
  if (any(invocation.xy >= vec2u(size))) { return; }
  let point = vec2i(invocation.xy);
  let uv = fluidUv(point, size);
  if (!contained(uv)) { textureStore(projectedVelocity, point, vec4f(0.0)); return; }
  let center = textureLoad(pressureTexture, point, 0).x;
  let left = pressureAt(point + vec2i(-1, 0), size, center);
  let right = pressureAt(point + vec2i(1, 0), size, center);
  let top = pressureAt(point + vec2i(0, -1), size, center);
  let bottom = pressureAt(point + vec2i(0, 1), size, center);
  var flow = textureLoad(advectedVelocity, point, 0).xy - 0.5 * vec2f(right - left, bottom - top);
  let pixel = vec2f(1.0) / vec2f(size);
  if (!contained(uv - vec2f(pixel.x, 0.0)) && flow.x < 0.0) { flow.x = 0.0; }
  if (!contained(uv + vec2f(pixel.x, 0.0)) && flow.x > 0.0) { flow.x = 0.0; }
  if (!contained(uv - vec2f(0.0, pixel.y)) && flow.y < 0.0) { flow.y = 0.0; }
  if (!contained(uv + vec2f(0.0, pixel.y)) && flow.y > 0.0) { flow.y = 0.0; }
  textureStore(projectedVelocity, point, vec4f(clamp(flow, vec2f(-0.6), vec2f(0.6)), 0.0, 0.0));
}`;

const particleCommon = `${NATIVE_GRAPH_GLOBALS}
struct Particle { kinematics: vec4f, appearance: vec4f };
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var velocityTexture: texture_2d<f32>;
fn hash32(input: u32) -> u32 {
  var value = input ^ (input >> 16u);
  value *= 0x7feb352du;
  value ^= value >> 15u;
  value *= 0x846ca68bu;
  return value ^ (value >> 16u);
}
fn random(input: u32) -> f32 { return f32(hash32(input) >> 8u) / 16777216.0; }
fn sourceAt(uv: vec2f) -> vec4f {
  return textureSampleLevel(sourceTexture, effectSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
}
fn spawn(index: u32, cycle: u32) -> vec2f {
  let seed = hash32(index ^ (cycle * 0x9e3779b9u) ^ u32(globals.clock.y) ^ u32(globals.params[13].x));
  let columns = 64u;
  let cell = vec2u(index % columns, index / columns);
  var uv = (vec2f(cell) + vec2f(random(seed ^ 0xa851f3d1u), random(seed ^ 0x6c8e9cf5u))) / vec2f(64.0);
  for (var attempt = 0u; attempt < 4u; attempt += 1u) {
    if (sourceAt(uv).a > 0.04) { break; }
    uv = vec2f(random(seed ^ (attempt * 19u + 7u)), random(seed ^ (attempt * 23u + 11u)));
  }
  return clamp(uv, vec2f(0.001), vec2f(0.999));
}
`;

const advanceParticlesWgsl = `${particleCommon}
@group(0) @binding(4) var<storage, read> previousParticles: array<Particle>;
@group(0) @binding(18) var<storage, read_write> nextParticles: array<Particle>;
@compute @workgroup_size(256, 1, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let index = invocation.x;
  if (index >= 4096u) { return; }
  let dt = globals.clock.w;
  let prior = previousParticles[index];
  let lifetime = globals.params[6].x;
  let cycle = u32(floor(prior.appearance.z / max(lifetime, 0.01))) + u32(globals.clock.x / max(lifetime, 0.01));
  var particle = prior;
  var position = prior.kinematics.xy;
  if (dt == 0.0 || prior.appearance.w <= 0.0 || prior.appearance.z >= lifetime || any(position < vec2f(0.0)) || any(position > vec2f(1.0)) || sourceAt(position).a <= 0.04) {
    position = spawn(index, cycle);
    let startAge = random(index ^ u32(globals.clock.y) ^ u32(globals.params[13].x) ^ 0xafe2b271u) * lifetime * 0.8;
    particle.kinematics = vec4f(position, 0.0, 0.0);
    particle.appearance = vec4f(position, startAge, max(0.0001, random(index ^ 0xcd98f739u)));
  } else {
    let flow = textureSampleLevel(velocityTexture, effectSampler, position, 0.0).xy;
    let inertia = clamp(globals.params[4].x * dt * 8.0, 0.0, 1.0);
    var movement = mix(prior.kinematics.zw, flow, inertia);
    var nextPosition = position + movement * dt;
    if (any(nextPosition < vec2f(0.0)) || any(nextPosition > vec2f(1.0)) || sourceAt(nextPosition).a <= 0.04) {
      movement *= -0.2;
      nextPosition = position;
    }
    particle.kinematics = vec4f(nextPosition, movement);
    particle.appearance.z = prior.appearance.z + dt;
  }
  nextParticles[index] = particle;
}`;

const particlePaintWgsl = `${NATIVE_GRAPH_GLOBALS}
struct Particle { kinematics: vec4f, appearance: vec4f };
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var<storage, read> particles: array<Particle>;
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) origin: vec2f,
  @location(2) vitality: f32,
  @location(3) screenUv: vec2f,
};
@vertex fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
  let corners = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let particle = particles[instanceIndex];
  let local = corners[vertexIndex];
  let radius = globals.params[5].x * globals.clock.z * 0.5;
  let uv = particle.kinematics.xy + local * radius * globals.viewport.zw;
  var output: VertexOutput;
  output.position = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
  output.local = local;
  output.origin = particle.appearance.xy;
  output.vitality = clamp(1.0 - particle.appearance.z / max(globals.params[6].x, 0.01), 0.0, 1.0);
  output.screenUv = uv;
  return output;
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let source = textureSampleLevel(sourceTexture, effectSampler, input.origin, 0.0);
  let boundary = textureSampleLevel(sourceTexture, effectSampler, input.screenUv, 0.0).a;
  let radius = length(input.local);
  let coverage = clamp((1.0 - radius) * 4.0, 0.0, 1.0);
  let alphaScale = coverage * input.vitality * globals.params[8].x * clamp(boundary * 8.0, 0.0, 1.0);
  return vec4f(source.rgb * alphaScale, source.a * alphaScale);
}`;

const fullScreen = `
struct VertexOutput { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let triangle = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var output: VertexOutput;
  output.position = vec4f(triangle[vertexIndex], 0.0, 1.0);
  output.uv = triangle[vertexIndex] * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
  return output;
}
`;

const trailWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var particlePaint: texture_2d<f32>;
@group(0) @binding(3) var previousTrail: texture_2d<f32>;
${fullScreen}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let fresh = textureSampleLevel(particlePaint, effectSampler, input.uv, 0.0);
  let old = textureSampleLevel(previousTrail, effectSampler, input.uv, 0.0);
  let fade = exp(-globals.params[7].x * globals.clock.w);
  let retained = old * fade;
  return fresh + retained * (1.0 - fresh.a);
}`;

const compositeWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var trailTexture: texture_2d<f32>;
${fullScreen}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let source = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let trail = textureSampleLevel(trailTexture, effectSampler, input.uv, 0.0);
  let amount = globals.params[11].x;
  return trail * amount + source * (1.0 - trail.a * amount);
}`;

const texture = (
  name: string,
  usage: ("sampled" | "storage" | "render")[],
  width = 128,
  persistent = false,
) => ({
  name,
  kind: "texture-2d" as const,
  format: "rgba16float",
  usage,
  size: "fixed" as const,
  width,
  height: width,
  ...(persistent ? { persistent: true } : {}),
});

export const FLUID_ADVECTED_PARTICLES_EFFECT: EffectDefinition = {
  id: "an-native-owned-aq-fluid-advected-particles",
  name: "Fluid Advected Particles",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    viscosity: {
      type: "float",
      label: "Viscosity",
      default: 0.38,
      min: 0,
      max: 1,
      step: 0.01,
    },
    turbulence: {
      type: "float",
      label: "Turbulence",
      default: 0.55,
      min: 0,
      max: 1,
      step: 0.01,
    },
    stirring: {
      type: "float",
      label: "Stirring",
      default: 0.75,
      min: 0,
      max: 2,
      step: 0.01,
    },
    brushRadius: {
      type: "float",
      label: "Brush radius",
      default: 90,
      min: 20,
      max: 220,
      step: 1,
      unit: "px",
    },
    flowFollowing: {
      type: "float",
      label: "Flow following",
      default: 0.85,
      min: 0.05,
      max: 2,
      step: 0.01,
    },
    particleSize: {
      type: "float",
      label: "Particle size",
      default: 3,
      min: 1,
      max: 12,
      step: 0.1,
      unit: "px",
    },
    particleLife: {
      type: "float",
      label: "Particle life",
      default: 8,
      min: 1,
      max: 30,
      step: 0.1,
      unit: "s",
    },
    trailDecay: {
      type: "float",
      label: "Trail decay",
      default: 1.6,
      min: 0.1,
      max: 8,
      step: 0.1,
    },
    opacity: {
      type: "float",
      label: "Particle opacity",
      default: 0.65,
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
    amount: {
      type: "float",
      label: "Amount",
      default: 0.9,
      min: 0,
      max: 1,
      step: 0.01,
    },
    particleCount: {
      type: "int",
      label: "Particle count",
      default: 2048,
      min: 256,
      max: 4096,
      step: 256,
    },
    patternSeed: {
      type: "int",
      label: "Pattern seed",
      default: 19,
      min: 0,
      max: 100000,
      step: 1,
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
    texture("advectedVelocity", ["sampled", "storage"]),
    texture("divergence", ["sampled", "storage"]),
    ...Array.from({ length: 7 }, (_, index) =>
      texture(`pressure${index}`, ["sampled", "storage"]),
    ),
    texture("pressure", ["sampled", "storage"], 128, true),
    texture("velocity", ["sampled", "storage"], 128, true),
    {
      name: "particles",
      kind: "buffer",
      usage: ["storage"],
      size: "fixed",
      byteLength: 4096 * 32,
      persistent: true,
    },
    {
      name: "particlePaint",
      kind: "texture-2d",
      format: "rgba16float",
      usage: ["render", "sampled"],
      size: "viewport",
    },
    texture("trail", ["render", "sampled"], 256, true),
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
    stateResources: ["velocity", "pressure", "particles", "trail"],
    sourceHistory: "sequential-captures",
    resetProperties: ["particleCount", "patternSeed"],
  },
  passes: [
    {
      id: "advect-velocity",
      kind: "compute",
      wgsl: advectVelocityWgsl,
      reads: ["source"],
      previousFrameReads: ["velocity"],
      output: "advectedVelocity",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
    },
    {
      id: "divergence",
      kind: "compute",
      wgsl: divergenceWgsl,
      reads: ["source", "advectedVelocity"],
      output: "divergence",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
    },
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `pressure-${index}`,
      kind: "compute" as const,
      wgsl: pressureWgsl(),
      reads:
        index === 0
          ? ["source", "divergence"]
          : ["source", "divergence", `pressure${index - 1}`],
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
      wgsl: projectVelocityWgsl,
      reads: ["source", "advectedVelocity", "pressure"],
      output: "velocity",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
    },
    {
      id: "advance-particles",
      kind: "compute",
      wgsl: advanceParticlesWgsl,
      reads: ["source", "velocity"],
      previousFrameReads: ["particles"],
      output: "particles",
      dispatch: { elements: "output-buffer", workgroupSize: [256, 1, 1] },
    },
    {
      id: "draw-particles",
      kind: "render",
      wgsl: particlePaintWgsl,
      reads: ["source", "particles"],
      output: "particlePaint",
      draw: {
        vertices: 6,
        instances: { property: "particleCount", max: 4096 },
      },
    },
    {
      id: "accumulate-trail",
      kind: "render",
      wgsl: trailWgsl,
      reads: ["particlePaint"],
      previousFrameReads: ["trail"],
      output: "trail",
    },
    {
      id: "compose",
      kind: "render",
      wgsl: compositeWgsl,
      reads: ["source", "trail"],
      output: "color",
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original bounded pressure-projected fluid transports retained source-colored particles within the source alpha silhouette.",
  },
};

export const FLUID_ADVECTED_PARTICLES_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-aq-fluid-advected-particles-ink",
    name: "Ink Vortices",
    definitionId: FLUID_ADVECTED_PARTICLES_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      viscosity: 0.62,
      turbulence: 0.32,
      stirring: 1.1,
      brushRadius: 115,
      flowFollowing: 0.75,
      particleSize: 3.8,
      particleLife: 12,
      trailDecay: 0.65,
      opacity: 0.55,
      pointerPosition: [0.5, 0.5],
      pointerActive: true,
      amount: 0.9,
      particleCount: 3072,
      patternSeed: 19,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-aq-fluid-advected-particles-sparks",
    name: "Swift Current",
    definitionId: FLUID_ADVECTED_PARTICLES_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      viscosity: 0.1,
      turbulence: 0.9,
      stirring: 0.4,
      brushRadius: 52,
      flowFollowing: 1.7,
      particleSize: 1.8,
      particleLife: 3.5,
      trailDecay: 4.2,
      opacity: 0.9,
      pointerPosition: [0.5, 0.5],
      pointerActive: false,
      amount: 1,
      particleCount: 4096,
      patternSeed: 71,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
