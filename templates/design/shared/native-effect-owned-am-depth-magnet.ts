import {
  NATIVE_GLOBAL_BINDINGS,
  NATIVE_RENDER_GLOBALS,
} from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const commonBindings = `
struct Interaction {
  pointer: vec4f,
  control: vec4f,
};
@group(0) @binding(6) var<uniform> interaction: Interaction;
fn hash32(input: u32) -> u32 {
  var value = input ^ (input >> 16u);
  value *= 0x7feb352du;
  value ^= value >> 15u;
  value *= 0x846ca68bu;
  return value ^ (value >> 16u);
}
fn random(input: u32) -> f32 {
  return f32(hash32(input) >> 8u) / 16777216.0;
}
fn unitOr(value: vec2f, fallback: vec2f) -> vec2f {
  let magnitude = length(value);
  return select(fallback, value / max(magnitude, 0.000001), magnitude > 0.000001);
}
fn originFor(index: u32, count: u32, seed: u32) -> vec2f {
  let aspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let columns = max(1u, u32(ceil(sqrt(f32(count) * aspect))));
  let rows = max(1u, (count + columns - 1u) / columns);
  let cell = vec2f(f32(index % columns), f32(index / columns));
  let jitter = vec2f(random(seed ^ 0xb99a1c7du), random(seed ^ 0x487d230bu));
  return clamp((cell + jitter) / vec2f(f32(columns), f32(rows)), vec2f(0.001), vec2f(0.999));
}
`;

const depthState = `
struct DepthParticle {
  point: vec4f,
  motion: vec4f,
};
@group(0) @binding(4) var<storage, read> previousParticles: array<DepthParticle>;
`;

const depthComputeWgsl = `${NATIVE_GLOBAL_BINDINGS}${commonBindings}${depthState}
@group(0) @binding(5) var<storage, read_write> nextParticles: array<DepthParticle>;
fn sourceBrightness(uv: vec2f) -> f32 {
  let dimensions = vec2i(textureDimensions(sourceTexture));
  let coordinate = clamp(vec2i(clamp(uv, vec2f(0.0), vec2f(0.99999)) * vec2f(dimensions)), vec2i(0), dimensions - vec2i(1));
  let color = textureLoad(sourceTexture, coordinate, 0);
  return dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
}
@compute @workgroup_size(256)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let index = invocation.x;
  let count = u32(interaction.control.w);
  if (index >= count) { return; }
  let seed = hash32(index ^ u32(globals.clock.y) ^ 0x11a9be31u) | 1u;
  let origin = originFor(index, count, seed);
  let brightness = sourceBrightness(origin);
  let step = u32(interaction.control.z);
  if (step == 0u) {
    nextParticles[index] = DepthParticle(vec4f(origin, brightness, 0.0), vec4f(0.0));
    return;
  }
  let dt = interaction.control.y;
  var particle = previousParticles[index];
  let spring = globals.params[6].x;
  var acceleration = (origin - particle.point.xy) * globals.viewport.xy * spring;
  var depthAcceleration = -particle.point.w * spring;
  if (interaction.control.x > 0.5) {
    let fromPointer = (particle.point.xy - interaction.pointer.xy) * globals.viewport.xy;
    let radius = max(1.0, globals.params[8].x * globals.clock.z);
    let influence = exp(-dot(fromPointer, fromPointer) / (radius * radius));
    acceleration += unitOr(fromPointer, vec2f(0.0)) * globals.params[7].x * 360.0 * globals.clock.z * influence;
    depthAcceleration += globals.params[7].x * 1.8 * influence;
  }
  let damping = exp(-globals.params[9].x * dt);
  let velocityPixels = (particle.motion.xy * globals.viewport.xy + acceleration * dt) * damping;
  particle.motion = vec4f(velocityPixels * globals.viewport.zw, particle.motion.zw);
  particle.motion.z = (particle.motion.z + depthAcceleration * dt) * damping;
  particle.point = vec4f(clamp(particle.point.xy + particle.motion.xy * dt, vec2f(-0.25), vec2f(1.25)), particle.point.zw);
  particle.point.z = mix(particle.point.z, brightness, 1.0 - exp(-4.0 * dt));
  particle.point.w = clamp(particle.point.w + particle.motion.z * dt, -1.0, 1.0);
  particle.motion.w += dt;
  nextParticles[index] = particle;
}
`;

const depthRenderWgsl = `${NATIVE_GLOBAL_BINDINGS}${commonBindings}${depthState}
struct ParticleVertex {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) sourceUv: vec2f,
  @location(2) alpha: f32,
};
@vertex fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> ParticleVertex {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let count = u32(interaction.control.w);
  let seed = hash32(instanceIndex ^ u32(globals.clock.y) ^ 0x11a9be31u) | 1u;
  let origin = originFor(instanceIndex, count, seed);
  let point = previousParticles[instanceIndex].point;
  let aspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let depth = (point.z - 0.5) * globals.params[1].x + point.w;
  let world = vec3f((point.x - 0.5) * aspect, 0.5 - point.y, depth);
  let yaw = globals.params[2].x + globals.clock.x * globals.params[12].x;
  let pitch = globals.params[3].x;
  let yawed = vec3f(world.x * cos(yaw) + world.z * sin(yaw), world.y, -world.x * sin(yaw) + world.z * cos(yaw));
  let rotated = vec3f(yawed.x, yawed.y * cos(pitch) - yawed.z * sin(pitch), yawed.y * sin(pitch) + yawed.z * cos(pitch));
  let cameraDistance = globals.params[4].x;
  let perspective = cameraDistance / max(0.35, cameraDistance - rotated.z);
  let projected = vec2f(0.5 + rotated.x * perspective / aspect, 0.5 - rotated.y * perspective);
  let radius = globals.params[5].x * globals.clock.z * perspective;
  let local = corners[vertexIndex];
  var output: ParticleVertex;
  output.position = vec4f((projected + local * radius * globals.viewport.zw) * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), 0.0, 1.0);
  output.local = local;
  output.sourceUv = origin;
  output.alpha = globals.params[10].x;
  return output;
}
@fragment fn fs(input: ParticleVertex) -> @location(0) vec4f {
  let coverage = 1.0 - smoothstep(0.45, 1.0, length(input.local));
  let color = textureSampleLevel(sourceTexture, effectSampler, input.sourceUv, 0.0);
  return color * coverage * input.alpha;
}
`;

const filingState = `
struct Filing {
  position: vec2f,
  velocity: vec2f,
  direction: vec2f,
  age: f32,
  seed: u32,
};
@group(0) @binding(4) var<storage, read> previousFilings: array<Filing>;
`;

const filingComputeWgsl = `${NATIVE_GLOBAL_BINDINGS}${commonBindings}${filingState}
@group(0) @binding(5) var<storage, read_write> nextFilings: array<Filing>;
@compute @workgroup_size(256)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let index = invocation.x;
  let count = u32(interaction.control.w);
  if (index >= count) { return; }
  let seed = hash32(index ^ u32(globals.clock.y) ^ 0x2f34c185u) | 1u;
  let origin = originFor(index, count, seed);
  let initialAngle = 6.2831853 * random(seed ^ 0x641acd23u);
  let initialDirection = vec2f(cos(initialAngle), sin(initialAngle));
  let step = u32(interaction.control.z);
  if (step == 0u || previousFilings[index].seed == 0u) {
    nextFilings[index] = Filing(origin, vec2f(0.0), initialDirection, 0.0, seed);
    return;
  }
  let dt = interaction.control.y;
  var filing = previousFilings[index];
  let fallbackMoment = vec2f(cos(globals.params[6].x), sin(globals.params[6].x));
  let pointerTravel = interaction.pointer.zw * globals.viewport.xy;
  let moment = select(fallbackMoment, unitOr(pointerTravel, fallbackMoment), interaction.control.x > 0.5 && length(pointerTravel) > 0.5);
  let pole = select(vec2f(0.5), interaction.pointer.xy, interaction.control.x > 0.5);
  let displacement = (filing.position - pole) * globals.viewport.xy;
  let radius = max(1.0, globals.params[4].x * globals.clock.z);
  let distance = length(displacement);
  let directionFromPole = unitOr(displacement, initialDirection);
  let projection = dot(moment, directionFromPole);
  let dipole = (3.0 * projection * directionFromPole - moment) * globals.params[5].x;
  let influence = pow(radius / (distance + radius), 3.0) * globals.params[3].x * abs(globals.params[5].x);
  let targetDirection = unitOr(dipole, fallbackMoment);
  let response = 1.0 - exp(-globals.params[8].x * dt);
  filing.direction = unitOr(mix(filing.direction, targetDirection, response * clamp(influence, 0.0, 1.0)), filing.direction);
  let travel = filing.direction * globals.params[7].x * globals.clock.z * influence;
  let restoring = (origin - filing.position) * globals.viewport.xy * 1.4;
  let velocityPixels = (filing.velocity * globals.viewport.xy + (travel + restoring) * dt) * exp(-globals.params[8].x * 0.3 * dt);
  filing.velocity = velocityPixels * globals.viewport.zw;
  filing.position = clamp(filing.position + filing.velocity * dt, vec2f(-0.05), vec2f(1.05));
  filing.age += dt;
  nextFilings[index] = filing;
}
`;

const filingRenderWgsl = `${NATIVE_GLOBAL_BINDINGS}${commonBindings}${filingState}
struct FilingVertex {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) color: vec4f,
};
@vertex fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> FilingVertex {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let filing = previousFilings[instanceIndex];
  let forward = unitOr(filing.direction, vec2f(1.0, 0.0));
  let across = vec2f(-forward.y, forward.x);
  let local = corners[vertexIndex];
  let halfLength = 0.5 * globals.params[9].x * globals.clock.z;
  let offset = forward * local.y * halfLength + across * local.x * max(0.6, halfLength * 0.13);
  var output: FilingVertex;
  output.position = vec4f((filing.position + offset * globals.viewport.zw) * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), 0.0, 1.0);
  output.local = local;
  output.color = mix(globals.params[1], globals.params[2], random(filing.seed));
  return output;
}
@fragment fn fs(input: FilingVertex) -> @location(0) vec4f {
  let tapered = 1.0 - smoothstep(0.55, 1.0, length(vec2f(input.local.x * 1.1, input.local.y * 0.9)));
  let head = 0.55 + 0.45 * smoothstep(-1.0, 1.0, input.local.y);
  let alpha = input.color.a * globals.params[10].x * tapered * head;
  return vec4f(input.color.rgb * alpha, alpha);
}
`;

const depthTrailWgsl = `${NATIVE_RENDER_GLOBALS}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let current = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let previous = textureSampleLevel(maskTexture, effectSampler, input.uv, 0.0);
  let retained = previous * exp(-globals.params[11].x * max(0.0, globals.clock.w));
  return current + retained * (1.0 - current.a);
}
`;

const filingTrailWgsl = `${NATIVE_RENDER_GLOBALS}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let current = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let previous = textureSampleLevel(maskTexture, effectSampler, input.uv, 0.0);
  let retained = previous * exp(-globals.params[11].x * max(0.0, globals.clock.w));
  return current + retained * (1.0 - current.a);
}
`;

function countProperty(defaultCount: number) {
  return {
    type: "int" as const,
    label: "Particles",
    default: defaultCount,
    min: 256,
    max: 2048,
    step: 1,
  };
}

function scalar(
  label: string,
  value: number,
  min: number,
  max: number,
  step = 0.1,
) {
  return { type: "float" as const, label, default: value, min, max, step };
}

function simulationResources(source: boolean) {
  return [
    ...(source
      ? [
          {
            name: "source",
            kind: "texture-2d" as const,
            usage: ["sampled" as const],
            external: true,
            size: "viewport" as const,
          },
        ]
      : []),
    {
      name: "state",
      kind: "buffer" as const,
      byteLength: 65_536,
      persistent: true,
      usage: ["storage" as const, "copy-src" as const, "copy-dst" as const],
    },
    {
      name: "particles",
      kind: "texture-2d" as const,
      format: "rgba16float" as const,
      usage: ["render" as const, "sampled" as const],
    },
    {
      name: "trail",
      kind: "texture-2d" as const,
      format: "rgba16float" as const,
      persistent: true,
      usage: ["render" as const, "sampled" as const],
    },
  ];
}

function simulationPasses(
  computeWgsl: string,
  renderWgsl: string,
  trailWgsl: string,
  source: boolean,
): EffectDefinition["passes"] {
  return [
    {
      id: "advance",
      kind: "compute",
      wgsl: computeWgsl,
      reads: source ? ["source"] : [],
      previousFrameReads: ["state"],
      output: "state",
      persistent: true,
      dispatch: { workgroupSize: 256, elements: "simulation-count" },
    },
    {
      id: "particles",
      kind: "render",
      wgsl: renderWgsl,
      reads: source ? ["source", "state"] : ["state"],
      output: "particles",
      draw: { vertices: 6, instances: "simulation-count" },
    },
    {
      id: "trail",
      kind: "render",
      wgsl: trailWgsl,
      reads: ["particles"],
      previousFrameReads: ["trail"],
      output: "trail",
      persistent: true,
    },
  ];
}

export const SOURCE_DEPTH_PARTICLES_EFFECT: EffectDefinition = {
  id: "an-native-source-depth-particles",
  name: "Source Depth Particles",
  version: 1,
  kind: "simulation",
  placements: ["layer", "backdrop"],
  properties: {
    particleCount: countProperty(1280),
    depthScale: scalar("Depth scale", 0.85, 0, 2),
    yaw: scalar("Orbit yaw", 0.35, -3.14, 3.14, 0.01),
    pitch: scalar("Orbit pitch", -0.18, -1.3, 1.3, 0.01),
    cameraDistance: scalar("Camera distance", 2.4, 1, 6),
    particleSize: { ...scalar("Particle size", 3.8, 0.5, 12), unit: "px" },
    spring: scalar("Spring", 7, 0, 30),
    pointerForce: scalar("Pointer force", 1.6, 0, 8),
    pointerRadius: { ...scalar("Pointer radius", 130, 20, 500, 1), unit: "px" },
    damping: scalar("Damping", 2.5, 0.1, 12),
    opacity: scalar("Opacity", 0.92, 0, 1, 0.01),
    trailDecay: scalar("Trail decay", 8, 0.1, 30),
    orbitSpeed: scalar("Orbit speed", 0.16, -1, 1, 0.01),
  },
  inputs: { source: { kind: "texture-2d", resource: "source" } },
  outputs: { color: { kind: "texture-2d", resource: "trail" } },
  simulation: {
    fixedDt: 1 / 120,
    stateResource: "state",
    bytesPerParticle: 32,
    count: { property: "particleCount", min: 256, max: 2048 },
    maxInteractiveSteps: 8,
    maxDeterministicSteps: 512,
    idlePointer: { x: 0.5, y: 0.5 },
  },
  resources: simulationResources(true),
  output: "trail",
  passes: simulationPasses(
    depthComputeWgsl,
    depthRenderWgsl,
    depthTrailWgsl,
    true,
  ),
  provenance: {
    origin: "design-original",
    note: "Original source-luminance depth cloud with retained 3D displacements, camera projection, and bounded pointer spring physics.",
  },
};

export const MAGNETIC_FILINGS_EFFECT: EffectDefinition = {
  id: "an-native-magnetic-filings",
  name: "Magnetic Filings",
  version: 1,
  kind: "simulation",
  placements: ["fill"],
  properties: {
    particleCount: countProperty(1024),
    colorA: {
      type: "color",
      label: "Color A",
      default: { space: "srgb", components: [0.3, 0.82, 0.95], alpha: 0.9 },
    },
    colorB: {
      type: "color",
      label: "Color B",
      default: { space: "srgb", components: [1, 0.7, 0.26], alpha: 0.9 },
    },
    fieldStrength: scalar("Field strength", 1.8, 0, 6),
    fieldRadius: { ...scalar("Field radius", 180, 20, 700, 1), unit: "px" },
    polarity: scalar("Polarity", 1, -1, 1),
    fieldAngle: scalar("Field angle", 0.4, -3.14, 3.14, 0.01),
    drift: { ...scalar("Drift", 80, 0, 300, 1), unit: "px" },
    damping: scalar("Damping", 5.5, 0.1, 20),
    filingLength: { ...scalar("Filing length", 9, 2, 30, 0.5), unit: "px" },
    opacity: scalar("Opacity", 0.9, 0, 1, 0.01),
    trailDecay: scalar("Trail decay", 12, 0.1, 30),
  },
  outputs: { color: { kind: "texture-2d", resource: "trail" } },
  simulation: {
    fixedDt: 1 / 120,
    stateResource: "state",
    bytesPerParticle: 32,
    count: { property: "particleCount", min: 256, max: 2048 },
    maxInteractiveSteps: 8,
    maxDeterministicSteps: 512,
    idlePointer: { x: 0.5, y: 0.5 },
  },
  resources: simulationResources(false),
  output: "trail",
  passes: simulationPasses(
    filingComputeWgsl,
    filingRenderWgsl,
    filingTrailWgsl,
    false,
  ),
  provenance: {
    origin: "design-original",
    note: "Original retained filings with softened dipole field, cursor-directed magnetic moment, spring drift, and directional premultiplied marks.",
  },
};

export const DEPTH_MAGNET_DEFINITIONS: readonly EffectDefinition[] = [
  SOURCE_DEPTH_PARTICLES_EFFECT,
  MAGNETIC_FILINGS_EFFECT,
];

export const DEPTH_MAGNET_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-depth-particles-relief",
    name: "Luminous Relief",
    definitionId: SOURCE_DEPTH_PARTICLES_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      particleCount: 1536,
      depthScale: 1.3,
      yaw: 0.65,
      pitch: -0.24,
      cameraDistance: 2.1,
      particleSize: 3.1,
      spring: 9,
      pointerForce: 2.3,
      trailDecay: 10,
      orbitSpeed: 0.24,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-depth-particles-orbit",
    name: "Deep Orbit",
    definitionId: SOURCE_DEPTH_PARTICLES_EFFECT.id,
    definitionVersion: 1,
    placement: "backdrop",
    params: {
      particleCount: 896,
      depthScale: 1.75,
      yaw: -1.15,
      pitch: 0.5,
      cameraDistance: 3.8,
      particleSize: 5.2,
      spring: 3,
      pointerForce: 0.9,
      pointerRadius: 230,
      damping: 1.2,
      trailDecay: 3.5,
      orbitSpeed: -0.35,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-magnetic-filings-compass",
    name: "Compass Sweep",
    definitionId: MAGNETIC_FILINGS_EFFECT.id,
    definitionVersion: 1,
    placement: "fill",
    params: {
      particleCount: 1536,
      fieldStrength: 2.8,
      fieldRadius: 220,
      polarity: 1,
      fieldAngle: 0.7,
      drift: 95,
      damping: 7,
      filingLength: 11,
      trailDecay: 14,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-magnetic-filings-reverse",
    name: "Reverse Current",
    definitionId: MAGNETIC_FILINGS_EFFECT.id,
    definitionVersion: 1,
    placement: "fill",
    params: {
      particleCount: 640,
      colorA: { space: "srgb", components: [0.85, 0.42, 1], alpha: 0.9 },
      colorB: { space: "srgb", components: [0.32, 1, 0.72], alpha: 0.9 },
      fieldStrength: 4.2,
      fieldRadius: 110,
      polarity: -1,
      fieldAngle: -0.9,
      drift: 170,
      damping: 2.5,
      filingLength: 17,
      opacity: 1,
      trailDecay: 4,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
