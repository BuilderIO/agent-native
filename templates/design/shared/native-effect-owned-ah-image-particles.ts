import {
  NATIVE_GLOBAL_BINDINGS,
  NATIVE_RENDER_GLOBALS,
} from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const particleBindings = `
struct Particle {
  position: vec2f,
  velocity: vec2f,
  origin: vec2f,
  age: f32,
  seed: u32,
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
  return f32(hash32(input) >> 8u) / 16777216.0;
}
fn unitOr(value: vec2f, fallback: vec2f) -> vec2f {
  let magnitude = length(value);
  return select(fallback, value / max(magnitude, 0.000001), magnitude > 0.000001);
}
`;

const sourceSampling = `
fn sourceAt(uv: vec2f) -> vec4f {
  let dimensions = vec2i(textureDimensions(sourceTexture));
  let coordinate = clamp(vec2i(clamp(uv, vec2f(0.0), vec2f(0.99999)) * vec2f(dimensions)), vec2i(0), dimensions - vec2i(1));
  return textureLoad(sourceTexture, coordinate, 0);
}
fn lightAt(uv: vec2f) -> f32 {
  let color = sourceAt(uv);
  return dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
}
fn sourceGradient(uv: vec2f) -> vec2f {
  let pixel = max(globals.clock.z, 1.0) * globals.viewport.zw;
  return vec2f(
    lightAt(uv + vec2f(pixel.x, 0.0)) - lightAt(uv - vec2f(pixel.x, 0.0)),
    lightAt(uv + vec2f(0.0, pixel.y)) - lightAt(uv - vec2f(0.0, pixel.y))
  );
}
fn originFor(index: u32, count: u32, seed: u32) -> vec2f {
  let aspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let columns = max(1u, u32(ceil(sqrt(f32(count) * aspect))));
  let rows = max(1u, (count + columns - 1u) / columns);
  let cell = vec2f(f32(index % columns), f32(index / columns));
  let jitter = vec2f(random(seed ^ 0x1a92b43du), random(seed ^ 0x75bd321bu));
  return clamp((cell + jitter) / vec2f(f32(columns), f32(rows)), vec2f(0.001), vec2f(0.999));
}
`;

const driftComputeWgsl = `${NATIVE_GLOBAL_BINDINGS}${particleBindings}${sourceSampling}
@group(0) @binding(5) var<storage, read_write> nextParticles: array<Particle>;
@compute @workgroup_size(256)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let index = invocation.x;
  let count = u32(interaction.control.w);
  if (index >= count) { return; }
  let step = u32(interaction.control.z);
  let seed = hash32(index ^ u32(globals.clock.y) ^ 0x85a313a1u) | 1u;
  var particle = previousParticles[index];
  if (step == 0u || particle.seed == 0u || particle.age >= globals.params[8].x || any(particle.position < vec2f(-0.1)) || any(particle.position > vec2f(1.1))) {
    let cycleSeed = select(particle.seed ^ hash32(step), seed, step == 0u || particle.seed == 0u);
    var origin = originFor(index, count, cycleSeed);
    for (var attempt = 0u; attempt < 3u; attempt += 1u) {
      if (sourceAt(origin).a > 0.05) { break; }
      origin = vec2f(random(cycleSeed ^ (attempt * 19u + 3u)), random(cycleSeed ^ (attempt * 23u + 11u)));
    }
    nextParticles[index] = Particle(origin, vec2f(0.0), origin, 0.0, cycleSeed | 1u);
    return;
  }
  let dt = interaction.control.y;
  let gradient = sourceGradient(particle.position);
  let contour = unitOr(vec2f(-gradient.y, gradient.x), vec2f(0.0));
  let phase = f32(particle.seed & 65535u) * 0.00019;
  let noise = unitOr(vec2f(
    sin(phase + particle.position.y * 27.0 + globals.clock.x * 1.7),
    cos(phase * 1.3 + particle.position.x * 23.0 - globals.clock.x * 1.2)
  ), vec2f(1.0, 0.0));
  let force = contour * globals.params[3].x + noise * globals.params[4].x + vec2f(0.0, -globals.params[2].x);
  let direction = unitOr(force, noise);
  let speedPixels = globals.params[1].x * globals.clock.z;
  let target = direction * speedPixels;
  let velocityPixels = particle.velocity * globals.viewport.xy;
  velocityPixels = mix(velocityPixels, target, 1.0 - exp(-4.0 * dt));
  particle.velocity = velocityPixels * globals.viewport.zw;
  particle.position += particle.velocity * dt;
  particle.age += dt;
  nextParticles[index] = particle;
}
`;

const driftRenderWgsl = `${NATIVE_GLOBAL_BINDINGS}${particleBindings}
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
  let particle = previousParticles[instanceIndex];
  let local = corners[vertexIndex];
  let radius = globals.params[5].x * globals.clock.z;
  let clip = particle.position * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0);
  var output: ParticleVertex;
  output.position = vec4f(clip + local * radius * globals.viewport.zw * vec2f(2.0, -2.0), 0.0, 1.0);
  output.local = local;
  output.sourceUv = particle.position;
  output.alpha = globals.params[6].x;
  return output;
}
@fragment fn fs(input: ParticleVertex) -> @location(0) vec4f {
  let coverage = 1.0 - smoothstep(0.45, 1.0, length(input.local));
  let color = textureSampleLevel(sourceTexture, effectSampler, clamp(input.sourceUv, vec2f(0.0), vec2f(1.0)), 0.0);
  return color * (coverage * input.alpha);
}
`;

const transportComputeWgsl = `${NATIVE_GLOBAL_BINDINGS}${particleBindings}${sourceSampling}
@group(0) @binding(5) var<storage, read_write> nextParticles: array<Particle>;
@compute @workgroup_size(256)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let index = invocation.x;
  let count = u32(interaction.control.w);
  if (index >= count) { return; }
  let step = u32(interaction.control.z);
  let seed = hash32(index ^ u32(globals.clock.y) ^ 0x6c4e2b11u) | 1u;
  var particle = previousParticles[index];
  if (step == 0u || particle.seed == 0u) {
    let origin = originFor(index, count, seed);
    nextParticles[index] = Particle(origin, vec2f(0.0), origin, 0.0, seed);
    return;
  }
  let dt = interaction.control.y;
  let gradient = sourceGradient(particle.origin);
  let contour = unitOr(vec2f(-gradient.y, gradient.x), vec2f(0.0));
  let normal = unitOr(gradient, vec2f(0.0));
  let phase = f32(particle.seed & 65535u) * 0.00023;
  let swirl = vec2f(sin(globals.clock.x * 0.9 + phase), cos(globals.clock.x * 1.1 + phase));
  let field = contour * globals.params[2].x + normal * globals.params[3].x + swirl * globals.params[4].x;
  let travel = unitOr(field, swirl) * globals.params[1].x * globals.clock.z;
  let offsetPixels = (particle.origin - particle.position) * globals.viewport.xy;
  let restoring = offsetPixels * globals.params[5].x;
  let target = travel + restoring;
  let velocityPixels = particle.velocity * globals.viewport.xy;
  velocityPixels = mix(velocityPixels, target, 1.0 - exp(-3.0 * dt));
  particle.velocity = velocityPixels * globals.viewport.zw;
  particle.position = clamp(particle.position + particle.velocity * dt, vec2f(-0.1), vec2f(1.1));
  particle.age += dt;
  nextParticles[index] = particle;
}
`;

const transportRenderWgsl = `${NATIVE_GLOBAL_BINDINGS}${particleBindings}
struct CellVertex {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) sourceUv: vec2f,
};
@vertex fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> CellVertex {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let particle = previousParticles[instanceIndex];
  let local = corners[vertexIndex];
  let halfSize = 0.5 * globals.params[6].x * globals.clock.z;
  let offset = local * halfSize * globals.viewport.zw;
  var output: CellVertex;
  output.position = vec4f((particle.position + offset) * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), 0.0, 1.0);
  output.local = local;
  output.sourceUv = particle.origin + offset;
  return output;
}
@fragment fn fs(input: CellVertex) -> @location(0) vec4f {
  if (any(input.sourceUv < vec2f(0.0)) || any(input.sourceUv > vec2f(1.0))) { return vec4f(0.0); }
  let edge = 1.0 - smoothstep(0.82, 1.0, max(abs(input.local.x), abs(input.local.y)));
  let color = textureSampleLevel(sourceTexture, effectSampler, input.sourceUv, 0.0);
  return color * edge * globals.params[7].x;
}
`;

const trailWgsl = (decaySlot: number) => `${NATIVE_RENDER_GLOBALS}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let current = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let previous = textureSampleLevel(maskTexture, effectSampler, input.uv, 0.0);
  let elapsed = max(0.0, globals.clock.w);
  let retained = previous * exp(-globals.params[${decaySlot}].x * elapsed);
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

function imageParticleDefinition(
  id: string,
  name: string,
  properties: EffectDefinition["properties"],
  computeWgsl: string,
  renderWgsl: string,
  decaySlot: number,
): EffectDefinition {
  return {
    id,
    name,
    version: 1,
    kind: "simulation",
    placements: ["layer", "backdrop"],
    properties,
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
        kind: "buffer",
        byteLength: 65_536,
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
        reads: ["source"],
        previousFrameReads: ["state"],
        output: "state",
        persistent: true,
        dispatch: { workgroupSize: 256, elements: "simulation-count" },
      },
      {
        id: "particles",
        kind: "render",
        wgsl: renderWgsl,
        reads: ["source", "state"],
        output: "particles",
        draw: { vertices: 6, instances: "simulation-count" },
      },
      {
        id: "trail",
        kind: "render",
        wgsl: trailWgsl(decaySlot),
        reads: ["particles"],
        previousFrameReads: ["trail"],
        output: "trail",
        persistent: true,
      },
    ],
    provenance: {
      origin: "design-original",
      note: "Original source-driven retained particle transport with bounded WebGPU buffers and premultiplied image sampling.",
    },
  };
}

export const SOURCE_IMAGE_PARTICLE_DEFINITIONS: readonly EffectDefinition[] = [
  imageParticleDefinition(
    "an-native-source-particle-drift",
    "Source Particle Drift",
    {
      particleCount: countProperty(1024),
      speed: { ...scalar("Speed", 42, 0, 180, 1), unit: "px" },
      buoyancy: scalar("Buoyancy", 0.35, -2, 2),
      edgeFollow: scalar("Edge follow", 1.2, 0, 3),
      turbulence: scalar("Turbulence", 0.55, 0, 3),
      radius: { ...scalar("Particle radius", 3.2, 0.5, 12), unit: "px" },
      opacity: scalar("Opacity", 0.9, 0, 1, 0.01),
      trailDecay: scalar("Trail decay", 4.5, 0.1, 25),
      lifetime: scalar("Lifetime", 8, 0.5, 30),
    },
    driftComputeWgsl,
    driftRenderWgsl,
    7,
  ),
  imageParticleDefinition(
    "an-native-pixel-transport",
    "Pixel Transport",
    {
      particleCount: countProperty(1536),
      speed: { ...scalar("Speed", 46, 0, 200, 1), unit: "px" },
      edgeFlow: scalar("Edge flow", 1.1, 0, 3),
      edgePush: scalar("Edge push", 0.7, -2, 2),
      wandering: scalar("Wandering", 0.55, 0, 3),
      returnForce: scalar("Return force", 0.2, 0, 3),
      cellSize: { ...scalar("Cell size", 12, 2, 36, 1), unit: "px" },
      opacity: scalar("Opacity", 0.94, 0, 1, 0.01),
      trailDecay: scalar("Trail decay", 7, 0.1, 30),
    },
    transportComputeWgsl,
    transportRenderWgsl,
    8,
  ),
];

export const SOURCE_IMAGE_PARTICLE_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-source-particle-drift-float",
    name: "Floating Pigment",
    definitionId: "an-native-source-particle-drift",
    definitionVersion: 1,
    placement: "layer",
    params: {
      particleCount: 1536,
      speed: 30,
      buoyancy: 0.9,
      edgeFollow: 1.5,
      turbulence: 0.35,
      radius: 3.8,
      trailDecay: 2.2,
      lifetime: 12,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-source-particle-drift-spark",
    name: "Chromatic Sparks",
    definitionId: "an-native-source-particle-drift",
    definitionVersion: 1,
    placement: "backdrop",
    params: {
      particleCount: 768,
      speed: 110,
      buoyancy: -0.2,
      edgeFollow: 0.65,
      turbulence: 2.2,
      radius: 2.1,
      opacity: 1,
      trailDecay: 12,
      lifetime: 3.2,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-pixel-transport-current",
    name: "Image Current",
    definitionId: "an-native-pixel-transport",
    definitionVersion: 1,
    placement: "layer",
    params: {
      particleCount: 2048,
      speed: 34,
      edgeFlow: 1.5,
      edgePush: 0.35,
      wandering: 0.25,
      returnForce: 0.8,
      cellSize: 11,
      trailDecay: 10,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-pixel-transport-scatter",
    name: "Scatter Mosaic",
    definitionId: "an-native-pixel-transport",
    definitionVersion: 1,
    placement: "backdrop",
    params: {
      particleCount: 896,
      speed: 120,
      edgeFlow: 0.5,
      edgePush: 1.8,
      wandering: 1.7,
      returnForce: 0.05,
      cellSize: 18,
      opacity: 0.86,
      trailDecay: 3.4,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];

export const SOURCE_IMAGE_PARTICLE_PRESET_LABEL_SOURCE_IDS: Record<
  string,
  string
> = Object.fromEntries(
  SOURCE_IMAGE_PARTICLE_PRESETS.map((preset) => [preset.id, preset.id]),
);
