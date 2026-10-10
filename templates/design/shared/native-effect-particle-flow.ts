import {
  NATIVE_GLOBAL_BINDINGS,
  NATIVE_RENDER_GLOBALS,
} from "./native-effect-wgsl";
import type { EffectDefinition } from "./native-effects";

const stateBindings = `
struct Particle {
  position: vec2f,
  velocity: vec2f,
  age: f32,
  seed: u32,
  padding: vec2f,
};
struct Interaction {
  pointer: vec4f,
  control: vec4f,
};
@group(0) @binding(4) var<storage, read> previousParticles: array<Particle>;
@group(0) @binding(6) var<uniform> interaction: Interaction;
fn hash32(input: u32) -> u32 {
  var value = input ^ (input >> 16u);
  value *= 0x7feb352du;
  value ^= value >> 15u;
  value *= 0x846ca68bu;
  return value ^ (value >> 16u);
}
fn random(input: u32) -> f32 {
  return f32(hash32(input)) / 4294967295.0;
}
`;

const computeWgsl = `${NATIVE_GLOBAL_BINDINGS}${stateBindings}
@group(0) @binding(5) var<storage, read_write> nextParticles: array<Particle>;
@compute @workgroup_size(256)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let index = invocation.x;
  if (index >= u32(interaction.control.w)) { return; }
  let dt = interaction.control.y;
  let step = u32(interaction.control.z);
  let initialSeed = index ^ u32(globals.clock.y);
  if (step == 0u) {
    nextParticles[index] = Particle(
      vec2f(random(initialSeed), random(initialSeed ^ 0x68bc21ebu)),
      vec2f(0.0),
      random(initialSeed ^ 0xa553c75du),
      hash32(initialSeed),
      vec2f(0.0)
    );
    return;
  }
  var particle = previousParticles[index];
  let scale = max(0.1, globals.params[4].x);
  let speed = max(0.0, globals.params[6].x);
  let turbulence = max(0.0, globals.params[5].x);
  let phase = globals.clock.x * speed;
  let angle = sin(particle.position.y * scale * 6.2831853 + phase) +
    cos(particle.position.x * scale * 7.193 + phase * 0.71);
  let field = vec2f(cos(angle), sin(angle)) * speed * 0.2;
  particle.velocity = mix(particle.velocity, field, clamp(turbulence * dt, 0.0, 1.0));
  if (interaction.control.x > 0.5) {
    let delta = interaction.pointer.xy - particle.position;
    let deltaPixels = delta * globals.viewport.xy;
    let radiusPixels = max(1.0, globals.params[8].x * globals.clock.z);
    let influence = exp(-dot(deltaPixels, deltaPixels) / (radiusPixels * radiusPixels));
    let directionPixels = deltaPixels / max(length(deltaPixels), 0.0001);
    let direction = directionPixels * (100.0 * globals.clock.z * globals.viewport.zw);
    particle.velocity += (direction + interaction.pointer.zw) *
      globals.params[7].x * influence * dt;
  }
  particle.position = fract(particle.position + particle.velocity * dt);
  particle.age += dt;
  nextParticles[index] = particle;
}
`;

const renderWgsl = `${NATIVE_GLOBAL_BINDINGS}${stateBindings}
struct ParticleVertex {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) color: vec4f,
};
@vertex fn vs(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> ParticleVertex {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let particle = previousParticles[instanceIndex];
  let local = corners[vertexIndex];
  let size = max(0.5, globals.params[10].x) * globals.clock.z;
  let center = particle.position * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0);
  var output: ParticleVertex;
  output.position = vec4f(center + local * size * globals.viewport.zw * 2.0, 0.0, 1.0);
  output.local = local;
  let blend = random(particle.seed);
  output.color = mix(globals.params[1], globals.params[2], blend);
  return output;
}
@fragment fn fs(input: ParticleVertex) -> @location(0) vec4f {
  let falloff = exp(-dot(input.local, input.local) * 3.5);
  let alpha = input.color.a * falloff * clamp(globals.params[3].x, 0.0, 1.0);
  return vec4f(input.color.rgb * alpha, alpha);
}
`;

const trailWgsl = `${NATIVE_RENDER_GLOBALS}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let current = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let previous = textureSampleLevel(maskTexture, effectSampler, input.uv, 0.0);
  let elapsed = max(0.0, globals.clock.w);
  let retained = previous * exp(-max(0.0, globals.params[9].x) * elapsed);
  let emitted = current * (1.0 - exp(-60.0 * elapsed));
  return emitted + retained * (1.0 - emitted.a);
}
`;

export const PARTICLE_FLOW_EFFECT: EffectDefinition = {
  id: "an-native-particle-flow",
  name: "Particle Flow",
  version: 1,
  kind: "simulation",
  placements: ["fill"],
  properties: {
    quality: {
      type: "enum",
      label: "Quality",
      default: "low",
      options: ["low", "medium", "high"],
    },
    colorA: {
      type: "color",
      label: "Color A",
      default: { space: "srgb", components: [0.2, 0.75, 1], alpha: 0.75 },
    },
    colorB: {
      type: "color",
      label: "Color B",
      default: { space: "srgb", components: [1, 0.42, 0.63], alpha: 0.75 },
    },
    density: {
      type: "float",
      label: "Density",
      default: 0.65,
      min: 0,
      max: 1,
      step: 0.01,
    },
    fieldScale: {
      type: "float",
      label: "Field scale",
      default: 2.5,
      min: 0.1,
      max: 12,
      step: 0.1,
    },
    turbulence: {
      type: "float",
      label: "Turbulence",
      default: 2,
      min: 0,
      max: 20,
      step: 0.1,
    },
    speed: {
      type: "float",
      label: "Speed",
      default: 0.4,
      min: 0,
      max: 4,
      step: 0.01,
    },
    pointerForce: {
      type: "float",
      label: "Pointer force",
      default: 1.5,
      min: 0,
      max: 10,
      step: 0.1,
    },
    pointerRadius: {
      type: "float",
      label: "Pointer radius",
      default: 120,
      min: 1,
      max: 500,
      step: 1,
      unit: "px",
    },
    trailDecay: {
      type: "float",
      label: "Trail decay",
      default: 1.8,
      min: 0.1,
      max: 20,
      step: 0.1,
    },
    particleSize: {
      type: "float",
      label: "Particle size",
      default: 1.6,
      min: 0.5,
      max: 8,
      step: 0.1,
      unit: "px",
    },
  },
  simulation: {
    fixedDt: 1 / 120,
    stateResource: "state",
    bytesPerParticle: 32,
    count: {
      property: "quality",
      tiers: { low: 10000, medium: 25000, high: 50000 },
    },
    maxInteractiveSteps: 8,
    maxDeterministicSteps: 512,
    idlePointer: { x: 0.5, y: 0.5 },
  },
  outputs: { color: { kind: "texture-2d", resource: "trail" } },
  resources: [
    {
      name: "state",
      kind: "buffer",
      byteLength: 1_600_000,
      persistent: true,
      usage: ["storage", "copy-src", "copy-dst"],
    },
    {
      name: "particles",
      kind: "texture-2d",
      format: "rgba16float",
      usage: ["render", "sampled"],
    },
    {
      name: "trail",
      kind: "texture-2d",
      format: "rgba16float",
      persistent: true,
      usage: ["render", "sampled"],
    },
  ],
  output: "trail",
  passes: [
    {
      id: "advance",
      kind: "compute",
      wgsl: computeWgsl,
      reads: [],
      previousFrameReads: ["state"],
      output: "state",
      persistent: true,
      dispatch: { workgroupSize: 256, elements: "simulation-count" },
    },
    {
      id: "particles",
      kind: "render",
      wgsl: renderWgsl,
      reads: ["state"],
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
  ],
  provenance: {
    origin: "design-original",
    note: "Original Design seeded flow field, bounded WebGPU state, instanced particles, and fixed-step premultiplied trails.",
  },
};
