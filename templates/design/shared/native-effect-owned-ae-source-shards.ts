import type { EffectDefinition, EffectPreset } from "./native-effects";

const computeWgsl = `
struct Params {
  time: f32, dt: f32, seed: f32, intensity: f32,
  blockSize: f32, drift: f32, churn: f32, sourcePixelRatio: f32,
};
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var priorTexture: texture_2d<f32>;
@group(0) @binding(2) var nextTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var displayTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<uniform> params: Params;

fn sourceAt(uv: vec2f) -> vec4f {
  let size = vec2f(textureDimensions(sourceTexture));
  let pixel = vec2i(clamp(floor(clamp(uv, vec2f(0.0), vec2f(0.99999)) * size), vec2f(0.0), size - 1.0));
  return textureLoad(sourceTexture, pixel, 0);
}
fn lightAt(uv: vec2f) -> f32 {
  let color = sourceAt(uv);
  return dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722)) * color.a;
}
fn hash(value: u32) -> f32 {
  var x = value * 1664525u + u32(params.seed) * 747796405u + 1013904223u;
  x = ((x >> 16u) ^ x) * 2246822519u;
  return f32((x >> 8u) & 16777215u) / 16777216.0;
}
fn anchor(index: u32) -> vec2f {
  let tile = vec2f(f32(index % 8u), f32(index / 8u));
  return (tile + vec2f(0.5)) / 8.0;
}
fn gradientAt(uv: vec2f) -> vec2f {
  let pixel = 2.0 * params.sourcePixelRatio / vec2f(textureDimensions(sourceTexture));
  return vec2f(
    lightAt(uv + vec2f(pixel.x, 0.0)) - lightAt(uv - vec2f(pixel.x, 0.0)),
    lightAt(uv + vec2f(0.0, pixel.y)) - lightAt(uv - vec2f(0.0, pixel.y))
  );
}
fn seedVelocity(index: u32, uv: vec2f) -> vec2f {
  let source = sourceAt(uv);
  let radial = uv - vec2f(0.5);
  let noise = vec2f(hash(index * 2u + 71u), hash(index * 2u + 72u)) - 0.5;
  let gradient = gradientAt(uv);
  let direction = radial * 0.45 + gradient * 3.0 + noise * 0.18;
  let luma = lightAt(uv);
  let strength = params.intensity * (0.08 + luma * 0.16 + length(gradient) * 0.24) * source.a;
  return direction / max(length(direction), 0.00001) * strength;
}
fn update(cell: vec2i) -> vec4f {
  let index = u32(cell.y * 8 + cell.x % 8);
  let positionCell = vec2i(cell.x % 8, cell.y);
  let angleCell = positionCell + vec2i(8, 0);
  let oldPosition = textureLoad(priorTexture, positionCell, 0);
  let oldAngle = textureLoad(priorTexture, angleCell, 0);
  let uv = anchor(index);
  let source = sourceAt(uv);
  if (source.a <= 0.01) { return vec4f(0.0); }
  let initialized = oldAngle.z > 0.5;
  if (cell.x < 8) {
    if (!initialized) { return vec4f(uv, seedVelocity(index, uv)); }
    if (params.dt <= 0.0) { return oldPosition; }
    let gradient = gradientAt(uv);
    let outward = uv - vec2f(0.5);
    let acceleration = vec2f(outward.x * (0.004 + lightAt(uv) * 0.012) * params.intensity + gradient.x * 0.025 * params.intensity, params.drift * 0.24 + outward.y * (0.004 + lightAt(uv) * 0.012) * params.intensity + gradient.y * 0.025 * params.intensity);
    let velocity = clamp((oldPosition.zw + acceleration * params.dt) * (1.0 - 0.08 * params.dt), vec2f(-0.8), vec2f(0.8));
    let position = clamp(oldPosition.xy + velocity * params.dt, vec2f(-2.0), vec2f(3.0));
    return vec4f(position, velocity);
  }
  let gradient = gradientAt(uv);
  let handedness = select(-1.0, 1.0, hash(index + 173u) >= 0.5);
  let spin = handedness * params.churn * (0.6 + length(gradient) * 4.0);
  if (!initialized) { return vec4f(0.0, spin, 1.0, params.blockSize * params.sourcePixelRatio); }
  return vec4f(oldAngle.x + spin * params.dt, spin, 1.0, params.blockSize * params.sourcePixelRatio);
}
@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.x >= 16u || invocation.y >= 8u) { return; }
  let cell = vec2i(invocation.xy);
  let next = update(cell);
  textureStore(nextTexture, cell, next);
  textureStore(displayTexture, cell, next);
}
`;

const resolveWgsl = `
struct Resolve { blend: f32, padding: vec3f };
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var displayTexture: texture_2d<f32>;
@group(0) @binding(2) var linearClamp: sampler;
@group(0) @binding(3) var<uniform> resolve: Resolve;
struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) sourceUv: vec2f,
  @location(1) tileMin: vec2f,
};
@vertex fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) shardIndex: u32) -> VertexOut {
  let corners = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0)
  );
  let local = corners[vertexIndex] - vec2f(0.5);
  let tile = vec2f(f32(shardIndex % 8u), f32(shardIndex / 8u));
  let tileMin = tile / 8.0;
  let anchorUv = tileMin + vec2f(0.0625);
  let sourceSize = vec2f(textureDimensions(sourceTexture));
  let position = textureLoad(displayTexture, vec2i(i32(shardIndex % 8u), i32(shardIndex / 8u)), 0);
  let angleState = textureLoad(displayTexture, vec2i(i32(shardIndex % 8u + 8u), i32(shardIndex / 8u)), 0);
  let initialized = angleState.z > 0.5;
  let center = mix(anchorUv, select(anchorUv, position.xy, initialized), resolve.blend);
  let fragmentSpan = select(vec2f(0.125), vec2f(max(angleState.w, 1.0)) / sourceSize, initialized);
  let span = mix(vec2f(0.125), fragmentSpan, resolve.blend);
  let angle = select(0.0, angleState.x, initialized) * resolve.blend;
  let rotated = vec2f(local.x * cos(angle) - local.y * sin(angle), local.x * sin(angle) + local.y * cos(angle));
  let destinationUv = center + rotated * span;
  var result: VertexOut;
  result.position = vec4f(destinationUv.x * 2.0 - 1.0, 1.0 - destinationUv.y * 2.0, 0.0, 1.0);
  result.sourceUv = anchorUv + local * 0.125;
  result.tileMin = tileMin;
  return result;
}
@fragment fn fs(input: VertexOut) -> @location(0) vec4f {
  if (any(input.sourceUv < input.tileMin) || any(input.sourceUv >= input.tileMin + vec2f(0.125))) {
    discard;
  }
  return textureSampleLevel(sourceTexture, linearClamp, input.sourceUv, 0.0);
}
`;

export const SOURCE_SHARDS_DEFINITIONS = [
  {
    id: "an-native-owned-source-shards",
    name: "Source Shards",
    version: 1,
    kind: "processor",
    placements: ["layer", "backdrop"],
    properties: {
      burst: {
        type: "float",
        label: "Burst",
        default: 0.72,
        min: 0,
        max: 1,
        step: 0.01,
      },
      fragmentSize: {
        type: "float",
        label: "Fragment size",
        default: 95,
        min: 30,
        max: 150,
        step: 1,
      },
      gravity: {
        type: "float",
        label: "Gravity",
        default: 0.36,
        min: 0,
        max: 1,
        step: 0.01,
      },
      spin: {
        type: "float",
        label: "Spin",
        default: 0.46,
        min: 0,
        max: 1,
        step: 0.01,
      },
      amount: {
        type: "float",
        label: "Amount",
        default: 0.86,
        min: 0,
        max: 1,
        step: 0.01,
      },
      patternSeed: {
        type: "float",
        label: "Pattern seed",
        default: 34,
        min: 0,
        max: 100,
        step: 1,
      },
    },
    inputs: { source: { kind: "texture-2d", resource: "source" } },
    outputs: { color: { kind: "texture-2d", resource: "color" } },
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
        kind: "texture-2d",
        format: "rgba16float",
        usage: ["sampled", "storage"],
        persistent: true,
        size: "fixed",
        width: 16,
        height: 8,
      },
      {
        name: "display",
        kind: "texture-2d",
        format: "rgba16float",
        usage: ["sampled", "storage"],
        size: "fixed",
        width: 16,
        height: 8,
      },
      {
        name: "color",
        kind: "texture-2d",
        format: "rgba16float",
        usage: ["render", "sampled"],
        size: "viewport",
      },
    ],
    output: "color",
    feedback: {
      abi: "texture-feedback-v1",
      sourceHistory: "sequential-captures",
      resolveDraw: { vertices: 6, instances: 64 },
      grid: { width: 16, height: 8, format: "rgba16float", workgroup: [8, 8] },
      timing: { fixedDt: 1 / 60, maxStepsPerCall: 120, maxStepIndex: 36000 },
      stateResource: "state",
      displayResource: "display",
      uniformProperties: {
        intensity: "burst",
        blockSize: "fragmentSize",
        drift: "gravity",
        churn: "spin",
        blend: "amount",
        seed: "patternSeed",
      },
      resetProperties: ["patternSeed", "burst"],
    },
    passes: [
      {
        id: "advance",
        kind: "compute",
        reads: ["source"],
        previousFrameReads: ["state"],
        output: "state",
        additionalOutputs: ["display"],
        persistent: true,
        dispatch: { workgroupSize: [8, 8], elements: "fixed-grid" },
        wgsl: computeWgsl,
      },
      {
        id: "resolve",
        kind: "render",
        reads: ["source", "display"],
        output: "color",
        wgsl: resolveWgsl,
      },
    ],
    provenance: {
      origin: "design-original",
      note: "Original source-conditioned shard transport with live source texture crops.",
    },
  },
] as unknown as readonly EffectDefinition[];

export const SOURCE_SHARDS_PRESETS = [
  {
    id: "an-preset-owned-source-shards",
    name: "Source Shards",
    definitionId: "an-native-owned-source-shards",
    definitionVersion: 1,
    placement: "layer",
    params: {
      burst: 0.72,
      fragmentSize: 95,
      gravity: 0.36,
      spin: 0.46,
      amount: 0.86,
      patternSeed: 34,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-shard-drift",
    name: "Shard Drift",
    definitionId: "an-native-owned-source-shards",
    definitionVersion: 1,
    placement: "layer",
    params: {
      burst: 0.42,
      fragmentSize: 140,
      gravity: 0.12,
      spin: 0.76,
      amount: 1,
      patternSeed: 68,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
] as unknown as readonly EffectPreset[];

export const SOURCE_SHARDS_PRESET_LABEL_SOURCE_IDS: Readonly<
  Record<string, string>
> = Object.fromEntries(
  SOURCE_SHARDS_PRESETS.map((preset) => [preset.id, preset.id]),
);
