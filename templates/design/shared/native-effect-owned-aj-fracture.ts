import {
  NATIVE_GLOBAL_BINDINGS,
  NATIVE_RENDER_GLOBALS,
} from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const stateBindings = `
struct FragmentState {
  offset: vec2f,
  velocity: vec2f,
  angle: f32,
  angularVelocity: f32,
  age: f32,
  seed: u32,
};
struct Interaction {
  pointer: vec4f,
  control: vec4f,
};
@group(0) @binding(4) var<storage, read> previousFragments: array<FragmentState>;
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
fn gridDimensions(count: u32) -> vec2u {
  let aspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let columns = max(1u, u32(ceil(sqrt(f32(count) * aspect))));
  return vec2u(columns, max(1u, (count + columns - 1u) / columns));
}
fn rowWidth(row: u32, count: u32, dimensions: vec2u) -> u32 {
  return select(count - (dimensions.y - 1u) * dimensions.x, dimensions.x, row + 1u < dimensions.y);
}
fn site(index: u32, count: u32) -> vec2f {
  let dimensions = gridDimensions(count);
  let row = index / dimensions.x;
  let column = index % dimensions.x;
  let width = rowWidth(row, count, dimensions);
  let seed = hash32(index ^ u32(globals.clock.y) ^ 0x81b3a72du);
  let jitter = vec2f(random(seed ^ 0x569d51b5u), random(seed ^ 0x33c293d1u)) - 0.5;
  return vec2f(
    (f32(column) + 0.5 + jitter.x * 0.3) / f32(width),
    (f32(row) + 0.5 + jitter.y * 0.3) / f32(dimensions.y)
  );
}
`;

const computeWgsl = `${NATIVE_GLOBAL_BINDINGS}${stateBindings}
@group(0) @binding(5) var<storage, read_write> nextFragments: array<FragmentState>;
fn sourceLight(uv: vec2f) -> f32 {
  let size = vec2i(textureDimensions(sourceTexture));
  let coordinate = clamp(vec2i(clamp(uv, vec2f(0.0), vec2f(0.99999)) * vec2f(size)), vec2i(0), size - vec2i(1));
  let color = textureLoad(sourceTexture, coordinate, 0);
  return dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
}
fn sourceGradient(uv: vec2f) -> vec2f {
  let pixel = max(1.0, globals.clock.z) * globals.viewport.zw;
  return vec2f(
    sourceLight(uv + vec2f(pixel.x, 0.0)) - sourceLight(uv - vec2f(pixel.x, 0.0)),
    sourceLight(uv + vec2f(0.0, pixel.y)) - sourceLight(uv - vec2f(0.0, pixel.y))
  );
}
@compute @workgroup_size(256)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let index = invocation.x;
  let count = u32(interaction.control.w);
  if (index >= count) { return; }
  let step = u32(interaction.control.z);
  let seed = hash32(index ^ u32(globals.clock.y) ^ 0x4169f23bu) | 1u;
  if (step == 0u || previousFragments[index].seed == 0u) {
    let anchor = site(index, count);
    let gradient = sourceGradient(anchor);
    let radial = unitOr((anchor - vec2f(0.5)) * globals.viewport.xy, vec2f(0.0));
    let edge = unitOr(gradient, vec2f(0.0));
    let randomDirection = vec2f(cos(random(seed) * 6.2831853), sin(random(seed) * 6.2831853));
    let impulse = radial * globals.params[2].x + edge * globals.params[7].x + randomDirection * 0.2 * (globals.params[2].x + globals.params[7].x);
    let velocityPixels = unitOr(impulse, randomDirection) *
      (45.0 + 85.0 * length(impulse)) * min(length(impulse), 1.0) * globals.clock.z;
    let angularVelocity = (random(seed ^ 0xa5f61b37u) * 2.0 - 1.0) * globals.params[4].x;
    nextFragments[index] = FragmentState(vec2f(0.0), velocityPixels * globals.viewport.zw, 0.0, angularVelocity, 0.0, seed);
    return;
  }
  var piece = previousFragments[index];
  let dt = interaction.control.y;
  let damping = exp(-globals.params[5].x * dt);
  let gravity = vec2f(0.0, globals.params[3].x * globals.clock.z);
  let velocityPixels = (piece.velocity * globals.viewport.xy + gravity * dt) * damping;
  piece.velocity = velocityPixels * globals.viewport.zw;
  piece.offset = clamp(piece.offset + piece.velocity * dt, vec2f(-3.0), vec2f(3.0));
  piece.angle += piece.angularVelocity * dt;
  piece.angularVelocity *= damping;
  piece.age += dt;
  nextFragments[index] = piece;
}
`;

const renderWgsl = `${NATIVE_GLOBAL_BINDINGS}${stateBindings}
struct FragmentVertex {
  @builtin(position) position: vec4f,
  @location(0) sourceUv: vec2f,
  @location(1) @interpolate(flat) pieceIndex: u32,
};
@vertex fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> FragmentVertex {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let count = u32(interaction.control.w);
  let dimensions = gridDimensions(count);
  let row = instanceIndex / dimensions.x;
  let width = rowWidth(row, count, dimensions);
  let center = site(instanceIndex, count);
  let extent = vec2f(2.1 / f32(width), 2.1 / f32(dimensions.y));
  let local = corners[vertexIndex] * extent;
  let state = previousFragments[instanceIndex];
  let amount = globals.params[1].x;
  let angle = state.angle * amount;
  let rotated = vec2f(
    local.x * cos(angle) - local.y * sin(angle),
    local.x * sin(angle) + local.y * cos(angle)
  );
  let position = center + state.offset * amount + rotated;
  var output: FragmentVertex;
  output.position = vec4f(position * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), 0.0, 1.0);
  output.sourceUv = center + local;
  output.pieceIndex = instanceIndex;
  return output;
}
struct NearestSites { owner: u32, nearest: f32, second: f32 };
fn nearestSites(uv: vec2f, count: u32) -> NearestSites {
  let dimensions = gridDimensions(count);
  let centerRow = i32(floor(uv.y * f32(dimensions.y)));
  var result = NearestSites(0u, 1.0e30, 1.0e30);
  for (var rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    let row = centerRow + rowOffset;
    if (row < 0 || row >= i32(dimensions.y)) { continue; }
    let width = rowWidth(u32(row), count, dimensions);
    let centerColumn = i32(floor(uv.x * f32(width)));
    for (var columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
      let column = centerColumn + columnOffset;
      if (column < 0 || column >= i32(width)) { continue; }
      let candidate = u32(row) * dimensions.x + u32(column);
      let delta = (uv - site(candidate, count)) * globals.viewport.xy;
      let distanceSquared = dot(delta, delta);
      if (distanceSquared < result.nearest) {
        result.second = result.nearest;
        result.nearest = distanceSquared;
        result.owner = candidate;
      } else if (distanceSquared < result.second) {
        result.second = distanceSquared;
      }
    }
  }
  return result;
}
@fragment fn fs(input: FragmentVertex) -> @location(0) vec4f {
  if (any(input.sourceUv < vec2f(0.0)) || any(input.sourceUv > vec2f(1.0))) { return vec4f(0.0); }
  let nearest = nearestSites(input.sourceUv, u32(interaction.control.w));
  if (nearest.owner != input.pieceIndex) { return vec4f(0.0); }
  let border = sqrt(nearest.second) - sqrt(nearest.nearest);
  if (border < globals.params[6].x * globals.clock.z * globals.params[1].x) { return vec4f(0.0); }
  return textureSampleLevel(sourceTexture, effectSampler, input.sourceUv, 0.0);
}
`;

const trailWgsl = `${NATIVE_RENDER_GLOBALS}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let current = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  if (globals.params[1].x <= 0.0) { return current; }
  let previous = textureSampleLevel(maskTexture, effectSampler, input.uv, 0.0);
  let retained = previous * exp(-globals.params[8].x * max(0.0, globals.clock.w)) * globals.params[1].x;
  return current + retained * (1.0 - current.a);
}
`;

export const FRACTURE_SCATTER_EFFECT: EffectDefinition = {
  id: "an-native-fracture-scatter",
  name: "Fracture Scatter",
  version: 1,
  kind: "simulation",
  placements: ["layer", "backdrop"],
  properties: {
    fragmentCount: {
      type: "int",
      label: "Fragments",
      default: 144,
      min: 64,
      max: 256,
      step: 1,
    },
    amount: {
      type: "float",
      label: "Amount",
      default: 0.8,
      min: 0,
      max: 1,
      step: 0.01,
    },
    impact: {
      type: "float",
      label: "Impact",
      default: 1.2,
      min: 0,
      max: 3,
      step: 0.1,
    },
    gravity: {
      type: "float",
      label: "Gravity",
      default: 90,
      min: -200,
      max: 400,
      step: 1,
      unit: "px",
    },
    spin: {
      type: "float",
      label: "Spin",
      default: 1.8,
      min: 0,
      max: 8,
      step: 0.1,
    },
    drag: {
      type: "float",
      label: "Drag",
      default: 0.32,
      min: 0,
      max: 4,
      step: 0.01,
    },
    gap: {
      type: "float",
      label: "Gap",
      default: 3,
      min: 0,
      max: 16,
      step: 0.5,
      unit: "px",
    },
    edgeImpulse: {
      type: "float",
      label: "Edge impulse",
      default: 0.9,
      min: 0,
      max: 3,
      step: 0.1,
    },
    trailDecay: {
      type: "float",
      label: "Trail decay",
      default: 9,
      min: 0.1,
      max: 30,
      step: 0.1,
    },
  },
  inputs: { source: { kind: "texture-2d", resource: "source" } },
  outputs: { color: { kind: "texture-2d", resource: "trail" } },
  simulation: {
    fixedDt: 1 / 120,
    stateResource: "state",
    bytesPerParticle: 32,
    count: { property: "fragmentCount", min: 64, max: 256 },
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
      byteLength: 8_192,
      persistent: true,
      usage: ["storage", "copy-src", "copy-dst"],
    },
    {
      name: "fragments",
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
      id: "fragments",
      kind: "render",
      wgsl: renderWgsl,
      reads: ["source", "state"],
      output: "fragments",
      draw: { vertices: 6, instances: "simulation-count" },
    },
    {
      id: "trail",
      kind: "render",
      wgsl: trailWgsl,
      reads: ["fragments"],
      previousFrameReads: ["trail"],
      output: "trail",
      persistent: true,
    },
  ],
  provenance: {
    origin: "design-original",
    note: "Original jittered Voronoi image tessellation with bounded retained rigid-body fragments and source-sampled premultiplied output.",
  },
};

export const FRACTURE_SCATTER_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-fracture-scatter-glass-burst",
    name: "Glass Burst",
    definitionId: FRACTURE_SCATTER_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      fragmentCount: 196,
      amount: 1,
      impact: 2.2,
      gravity: 180,
      spin: 3.4,
      drag: 0.12,
      gap: 5,
      edgeImpulse: 1.4,
      trailDecay: 16,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-fracture-scatter-hanging-fragments",
    name: "Hanging Fragments",
    definitionId: FRACTURE_SCATTER_EFFECT.id,
    definitionVersion: 1,
    placement: "backdrop",
    params: {
      fragmentCount: 81,
      amount: 0.72,
      impact: 0.38,
      gravity: -25,
      spin: 0.45,
      drag: 1.4,
      gap: 2,
      edgeImpulse: 0.6,
      trailDecay: 3.5,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
