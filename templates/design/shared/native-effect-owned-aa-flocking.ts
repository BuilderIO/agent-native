import {
  NATIVE_GLOBAL_BINDINGS,
  NATIVE_RENDER_GLOBALS,
} from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const stateBindings = `
struct Agent {
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
@group(0) @binding(4) var<storage, read> previousAgents: array<Agent>;
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

const computeWgsl = `${NATIVE_GLOBAL_BINDINGS}${stateBindings}
@group(0) @binding(5) var<storage, read_write> nextAgents: array<Agent>;
@compute @workgroup_size(256)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let index = invocation.x;
  let activeCount = u32(interaction.control.w);
  if (index >= activeCount) { return; }
  let dt = interaction.control.y;
  let step = u32(interaction.control.z);
  let seeded = index ^ u32(globals.clock.y);
  let speedPixels = max(1.0, globals.params[7].x * globals.clock.z);
  if (step == 0u || previousAgents[index].seed == 0u) {
    let angle = 6.2831853 * random(seeded ^ 0x92af311du);
    let distance = mix(0.07, 0.37, random(seeded ^ 0x67e1b3a5u));
    let offset = vec2f(cos(angle), sin(angle));
    let tangent = vec2f(-offset.y, offset.x);
    let direction = unitOr(tangent + 0.38 * vec2f(
      random(seeded ^ 0x62ad23f1u) - 0.5,
      random(seeded ^ 0x459a847bu) - 0.5
    ), tangent);
    nextAgents[index] = Agent(
      fract(vec2f(0.5) + offset * distance),
      direction * speedPixels * globals.viewport.zw,
      0.0,
      hash32(seeded) | 1u,
      vec2f(0.0)
    );
    return;
  }
  var agent = previousAgents[index];
  let radius = max(1.0, globals.params[3].x * globals.clock.z);
  let radiusSquared = radius * radius;
  let separationRadius = radius * 0.48;
  let separationSquared = separationRadius * separationRadius;
  var separation = vec2f(0.0);
  var alignment = vec2f(0.0);
  var cohesion = vec2f(0.0);
  var neighbors = 0.0;
  for (var otherIndex = 0u; otherIndex < 256u; otherIndex += 1u) {
    if (otherIndex >= activeCount) { break; }
    if (otherIndex == index) { continue; }
    let other = previousAgents[otherIndex];
    let offset = fract(other.position - agent.position + vec2f(0.5)) - vec2f(0.5);
    let offsetPixels = offset * globals.viewport.xy;
    let distanceSquared = dot(offsetPixels, offsetPixels);
    if (distanceSquared >= radiusSquared) { continue; }
    let influence = 1.0 - distanceSquared / radiusSquared;
    alignment += unitOr(other.velocity * globals.viewport.xy, vec2f(0.0)) * influence;
    cohesion += offsetPixels * influence;
    neighbors += influence;
    if (distanceSquared < separationSquared) {
      separation -= offsetPixels * (1.0 - distanceSquared / separationSquared) /
        max(distanceSquared, 16.0);
    }
  }
  let current = unitOr(agent.velocity * globals.viewport.xy, vec2f(1.0, 0.0));
  var steering = vec2f(0.0);
  if (neighbors > 0.0) {
    steering += unitOr(separation, vec2f(0.0)) * globals.params[4].x;
    steering += (unitOr(alignment, current) - current) * globals.params[5].x;
    steering += unitOr(cohesion, vec2f(0.0)) * globals.params[6].x;
  }
  if (interaction.control.x > 0.5) {
    let pointerOffset = (interaction.pointer.xy - agent.position) * globals.viewport.xy;
    let pointerRadius = max(1.0, globals.params[9].x * globals.clock.z);
    let influence = exp(-dot(pointerOffset, pointerOffset) /
      (pointerRadius * pointerRadius));
    steering += unitOr(pointerOffset, vec2f(0.0)) *
      globals.params[8].x * influence;
  }
  let direction = unitOr(current + steering * dt * 3.5, current);
  agent.velocity = direction * speedPixels * globals.viewport.zw;
  agent.position = fract(agent.position + agent.velocity * dt);
  agent.age += dt;
  nextAgents[index] = agent;
}
`;

const renderWgsl = `${NATIVE_GLOBAL_BINDINGS}${stateBindings}
struct AgentVertex {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) color: vec4f,
};
@vertex fn vs(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> AgentVertex {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  var output: AgentVertex;
  let agent = previousAgents[instanceIndex];
  let forward = unitOr(agent.velocity * globals.viewport.xy, vec2f(1.0, 0.0));
  let across = vec2f(-forward.y, forward.x);
  let local = corners[vertexIndex];
  let size = max(0.5, globals.params[11].x) * globals.clock.z;
  let pixelOffset = (forward * local.y * 1.6 + across * local.x * 0.75) * size;
  let center = agent.position * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0);
  output.position = vec4f(center + pixelOffset * globals.viewport.zw * vec2f(2.0, -2.0), 0.0, 1.0);
  output.local = local;
  output.color = mix(globals.params[1], globals.params[2], random(agent.seed));
  return output;
}
@fragment fn fs(input: AgentVertex) -> @location(0) vec4f {
  let radius = length(vec2f(input.local.x * 1.18, input.local.y * 0.83));
  let coverage = 1.0 - smoothstep(0.52, 1.0, radius);
  let alpha = input.color.a * coverage;
  return vec4f(input.color.rgb * alpha, alpha);
}
`;

const trailWgsl = `${NATIVE_RENDER_GLOBALS}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let current = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let previous = textureSampleLevel(maskTexture, effectSampler, input.uv, 0.0);
  let elapsed = max(0.0, globals.clock.w);
  let retained = previous * exp(-max(0.0, globals.params[10].x) * elapsed);
  let emitted = current * (1.0 - exp(-60.0 * elapsed));
  return emitted + retained * (1.0 - emitted.a);
}
`;

export const FLOCKING_SWARM_EFFECT: EffectDefinition = {
  id: "an-native-flocking-swarm",
  name: "Flocking Swarm",
  version: 1,
  kind: "simulation",
  placements: ["fill"],
  properties: {
    agentCount: {
      type: "int",
      label: "Agents",
      default: 160,
      min: 64,
      max: 256,
      step: 1,
    },
    colorA: {
      type: "color",
      label: "Color A",
      default: { space: "srgb", components: [0.24, 0.8, 0.95], alpha: 0.85 },
    },
    colorB: {
      type: "color",
      label: "Color B",
      default: { space: "srgb", components: [0.9, 0.46, 0.8], alpha: 0.85 },
    },
    perception: {
      type: "float",
      label: "Perception",
      default: 68,
      min: 12,
      max: 220,
      step: 1,
      unit: "px",
    },
    separation: {
      type: "float",
      label: "Separation",
      default: 2.4,
      min: 0,
      max: 8,
      step: 0.1,
    },
    alignment: {
      type: "float",
      label: "Alignment",
      default: 2.2,
      min: 0,
      max: 8,
      step: 0.1,
    },
    cohesion: {
      type: "float",
      label: "Cohesion",
      default: 1.4,
      min: 0,
      max: 8,
      step: 0.1,
    },
    speed: {
      type: "float",
      label: "Speed",
      default: 82,
      min: 8,
      max: 240,
      step: 1,
      unit: "px",
    },
    pointerForce: {
      type: "float",
      label: "Pointer force",
      default: 2.2,
      min: 0,
      max: 8,
      step: 0.1,
    },
    pointerRadius: {
      type: "float",
      label: "Pointer radius",
      default: 130,
      min: 20,
      max: 500,
      step: 1,
      unit: "px",
    },
    trailDecay: {
      type: "float",
      label: "Trail decay",
      default: 2.5,
      min: 0.1,
      max: 20,
      step: 0.1,
    },
    agentSize: {
      type: "float",
      label: "Agent size",
      default: 2.8,
      min: 0.5,
      max: 10,
      step: 0.1,
      unit: "px",
    },
  },
  simulation: {
    fixedDt: 1 / 120,
    stateResource: "state",
    bytesPerParticle: 32,
    count: { property: "agentCount", min: 64, max: 256 },
    maxInteractiveSteps: 8,
    maxDeterministicSteps: 512,
    idlePointer: { x: 0.5, y: 0.5 },
  },
  outputs: { color: { kind: "texture-2d", resource: "trail" } },
  resources: [
    {
      name: "state",
      kind: "buffer",
      byteLength: 8_192,
      persistent: true,
      usage: ["storage", "copy-src", "copy-dst"],
    },
    {
      name: "agents",
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
      id: "agents",
      kind: "render",
      wgsl: renderWgsl,
      reads: ["state"],
      output: "agents",
      draw: { vertices: 6, instances: "simulation-count" },
    },
    {
      id: "trail",
      kind: "render",
      wgsl: trailWgsl,
      reads: ["agents"],
      previousFrameReads: ["trail"],
      output: "trail",
      persistent: true,
    },
  ],
  provenance: {
    origin: "design-original",
    note: "Original bounded neighborhood flocking with persistent WebGPU agents and premultiplied trails.",
  },
};

export const FLOCKING_SWARM_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-flocking-swirl",
    name: "Luminous Swirl",
    definitionId: FLOCKING_SWARM_EFFECT.id,
    definitionVersion: FLOCKING_SWARM_EFFECT.version,
    placement: "fill",
    params: {
      agentCount: 192,
      perception: 78,
      separation: 2.8,
      alignment: 2.1,
      cohesion: 1.7,
      speed: 76,
      pointerForce: 2.4,
      trailDecay: 1.4,
      agentSize: 3.1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-flocking-migration",
    name: "Swift Migration",
    definitionId: FLOCKING_SWARM_EFFECT.id,
    definitionVersion: FLOCKING_SWARM_EFFECT.version,
    placement: "fill",
    params: {
      agentCount: 96,
      colorA: { space: "srgb", components: [1, 0.72, 0.24], alpha: 0.9 },
      colorB: { space: "srgb", components: [0.96, 0.3, 0.28], alpha: 0.9 },
      perception: 120,
      separation: 0.8,
      alignment: 4.3,
      cohesion: 0.55,
      speed: 165,
      pointerForce: 0.9,
      trailDecay: 7.5,
      agentSize: 2.1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
