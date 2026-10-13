import { NATIVE_GRAPH_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const scoreWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(18) var scoreOutput: texture_storage_2d<rgba16float, write>;
fn signal(uv: vec2f) -> f32 {
  let color = textureSampleLevel(sourceTexture, effectSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
  let straight = select(vec3f(0.0), color.rgb / max(color.a, 0.00001), color.a > 0.00001);
  let luma = dot(straight, vec3f(0.2126, 0.7152, 0.0722));
  let mode = u32(globals.params[1].x);
  if (mode == 1u) { return (1.0 - luma) * color.a; }
  if (mode == 2u) { return color.a; }
  if (mode == 3u) { return max(straight.r - max(straight.g, straight.b) * 0.35, 0.0) * color.a; }
  if (mode == 4u) { return max(straight.g - max(straight.r, straight.b) * 0.35, 0.0) * color.a; }
  if (mode == 5u) { return max(straight.b - max(straight.r, straight.g) * 0.35, 0.0) * color.a; }
  return luma * color.a;
}
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  if (any(invocation.xy >= vec2u(64))) { return; }
  let uv = (vec2f(invocation.xy) + 0.5) / 64.0;
  let stepUv = 0.25 / 64.0;
  let center = signal(uv);
  let a = signal(uv + vec2f(stepUv, stepUv));
  let b = signal(uv + vec2f(-stepUv, stepUv));
  let c = signal(uv + vec2f(stepUv, -stepUv));
  let d = signal(uv + vec2f(-stepUv, -stepUv));
  let contrast = max(max(abs(a - d), abs(b - c)), 0.0);
  let score = clamp(max(center, max(max(a, b), max(c, d))) * 0.76 + contrast * 0.24, 0.0, 1.0);
  textureStore(scoreOutput, vec2i(invocation.xy), vec4f(score, contrast, 0.0, 1.0));
}`;

const pursuitWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var scores: texture_2d<f32>;
struct Tracker { pose: vec4f, memory: vec4f };
@group(0) @binding(3) var<storage, read> previousTracks: array<Tracker>;
@group(0) @binding(18) var<storage, read_write> nextTracks: array<Tracker>;
fn hash(input: u32) -> f32 {
  var value = input * 1664525u + u32(globals.params[14].x) * 747796405u + 1013904223u;
  value = ((value >> 16u) ^ value) * 2246822519u;
  return f32((value >> 8u) & 16777215u) / 16777216.0;
}
fn scoreAt(uv: vec2f) -> f32 {
  let point = clamp(vec2i(floor(uv * 64.0)), vec2i(0), vec2i(63));
  return textureLoad(scores, point, 0).x;
}
fn preference(index: u32, generation: u32) -> f32 {
  let floorScore = max(globals.params[2].x, 0.02);
  let spread = clamp(globals.params[3].x, 0.0, 1.0);
  return mix(1.0, mix(floorScore, 1.0, hash(index * 79u + generation * 173u + 37u)), spread);
}
fn affinity(score: f32, preferred: f32) -> f32 {
  if (score < globals.params[2].x || score < 0.015) { return 0.0; }
  return score * exp(-abs(score - preferred) * 7.0);
}
@compute @workgroup_size(64, 1, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let index = invocation.x;
  if (index >= 64u) { return; }
  if (index >= u32(globals.params[0].x)) {
    nextTracks[index] = Tracker(vec4f(0.0), vec4f(0.0));
    return;
  }
  let old = previousTracks[index];
  let born = old.pose.w < 0.5;
  var generation = select(u32(old.pose.w), 1u, born);
  let dt = max(globals.clock.w, 0.0);
  let life = globals.params[5].x;
  let retired = !born && life > 0.0 && old.memory.z + dt >= life;
  var position = select(old.pose.xy, vec2f(hash(index * 23u + 5u), hash(index * 31u + 11u)), born);
  var misses = old.memory.w;
  var age = old.memory.z + dt;
  var velocity = old.memory.xy;
  var confidence = old.pose.z;
  let preferred = preference(index, generation);
  let searchRadius = mix(0.022, 0.105, clamp(globals.params[4].x, 0.0, 1.0));
  var sum = 0.0;
  var center = vec2f(0.0);
  if (!born && !retired) {
    for (var y = -2; y <= 2; y += 1) {
      for (var x = -2; x <= 2; x += 1) {
        let delta = vec2f(f32(x), f32(y)) * searchRadius * 0.5;
        let candidate = clamp(position + delta, vec2f(0.0), vec2f(0.9999));
        let weight = affinity(scoreAt(candidate), preferred) / (1.0 + dot(delta, delta) * 180.0);
        sum += weight;
        center += candidate * weight;
      }
    }
  }
  let locked = sum > 0.2;
  if (locked) {
    let destination = center / sum;
    let follow = 1.0 - exp(-(3.0 + globals.params[4].x * 17.0) * dt);
    let next = mix(position, destination, follow);
    velocity = (next - position) / max(dt, 0.00001);
    position = next;
    confidence = scoreAt(position);
    misses = 0.0;
  } else if (!born && !retired) {
    misses += 1.0;
    position = clamp(position + velocity * dt * 0.45, vec2f(0.0), vec2f(0.9999));
    velocity *= exp(-8.0 * dt);
  }
  if (born || retired || misses > globals.params[6].x) {
    if (!born) { generation += 1u; }
    let band = preference(index, generation);
    let home = vec2f(hash(index * 43u + generation * 13u), hash(index * 59u + generation * 17u));
    var bestWeight = 0.0;
    var destination = home;
    var bestScore = 0.0;
    for (var y = 0; y < 64; y += 1) {
      for (var x = 0; x < 64; x += 1) {
        let cell = vec2i(x, y);
        let uv = (vec2f(cell) + 0.5) / 64.0;
        let value = textureLoad(scores, cell, 0).x;
        let distance = uv - home;
        var weight = affinity(value, band) / (1.0 + 4.0 * dot(distance, distance));
        weight *= 0.8 + 0.4 * hash(index * 137u + generation * 181u + u32(x) * 23u + u32(y) * 47u);
        if (weight > bestWeight) {
          bestWeight = weight;
          destination = uv;
          bestScore = value;
        }
      }
    }
    if (bestWeight <= 0.0) {
      nextTracks[index] = Tracker(vec4f(0.0), vec4f(0.0));
      return;
    }
    position = destination;
    confidence = bestScore;
    velocity = vec2f(0.0);
    age = 0.0;
    misses = 0.0;
  }
  nextTracks[index] = Tracker(vec4f(position, confidence, f32(generation)), vec4f(velocity, age, misses));
}`;

const historyWgsl = `${NATIVE_GRAPH_GLOBALS}
struct Tracker { pose: vec4f, memory: vec4f };
@group(0) @binding(2) var<storage, read> tracks: array<Tracker>;
@group(0) @binding(3) var<storage, read> previousHistory: array<vec4f>;
@group(0) @binding(18) var<storage, read_write> nextHistory: array<vec4f>;
fn entry(track: u32, slot: u32, replaceSlot: u32, stamp: bool, pose: vec4f) -> vec4f {
  let prior = previousHistory[track * 17u + slot];
  if (stamp && slot == replaceSlot) { return vec4f(pose.xy, pose.w, globals.clock.x + 0.00001); }
  return select(vec4f(0.0), prior, prior.z == pose.w);
}
@compute @workgroup_size(64, 1, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let index = invocation.x;
  if (index >= 1088u) { return; }
  let track = index / 17u;
  let slot = index % 17u;
  let pose = tracks[track].pose;
  if (pose.w < 0.5) { nextHistory[index] = vec4f(0.0); return; }
  let frame = u32(round(globals.clock.x * 60.0));
  let stamp = frame % 4u == 0u;
  let replaceSlot = (frame / 4u) % 16u;
  if (slot < 16u) {
    nextHistory[index] = entry(track, slot, replaceSlot, stamp, pose);
    return;
  }
  var low = pose.xy;
  var high = pose.xy;
  for (var i = 0u; i < 16u; i += 1u) {
    let point = entry(track, i, replaceSlot, stamp, pose);
    if (point.z != pose.w || point.w <= 0.0) { continue; }
    low = min(low, point.xy);
    high = max(high, point.xy);
  }
  nextHistory[index] = vec4f(low, high);
}`;

const hudWgsl = `${NATIVE_GRAPH_GLOBALS}
struct Tracker { pose: vec4f, memory: vec4f };
@group(0) @binding(2) var<storage, read> tracks: array<Tracker>;
@group(0) @binding(3) var<storage, read> history: array<vec4f>;
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) trackerIndex: u32,
};
@vertex fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
  let corners = array<vec2f, 6>(vec2f(0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0), vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0));
  let pose = tracks[instanceIndex].pose;
  let bounds = history[instanceIndex * 17u + 16u];
  let margin = (globals.params[8].x * 0.75 + globals.params[9].x * 2.0 + 3.0) * globals.clock.z;
  let low = clamp(bounds.xy - vec2f(margin) * globals.viewport.zw, vec2f(0.0), vec2f(1.0));
  let high = clamp(bounds.zw + vec2f(margin) * globals.viewport.zw, vec2f(0.0), vec2f(1.0));
  let uv = mix(low, high, corners[vertexIndex]);
  var output: VertexOutput;
  output.position = select(vec4f(2.0, 2.0, 0.0, 1.0), vec4f(uv * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), 0.0, 1.0), pose.w >= 0.5);
  output.trackerIndex = instanceIndex;
  return output;
}
fn segmentDistance(point: vec2f, a: vec2f, b: vec2f) -> f32 {
  let direction = b - a;
  let fraction = clamp(dot(point - a, direction) / max(dot(direction, direction), 0.0001), 0.0, 1.0);
  return length(point - (a + direction * fraction));
}
fn coverage(distance: f32, width: f32) -> f32 {
  return 1.0 - smoothstep(width - 0.5, width + 0.5, distance);
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let tracker = tracks[input.trackerIndex];
  if (tracker.pose.w < 0.5) { return vec4f(0.0); }
  let pixel = input.position.xy;
  let head = tracker.pose.xy * globals.viewport.xy;
  let width = globals.params[9].x * globals.clock.z;
  let size = globals.params[8].x * globals.clock.z;
  let generation = tracker.pose.w;
  let frame = u32(round(globals.clock.x * 60.0));
  let latest = (frame / 4u) % 16u;
  let visible = u32(globals.params[7].x);
  var path = 0.0;
  var keys = 0.0;
  var previous = head;
  var previousValid = true;
  for (var age = 0u; age < 16u; age += 1u) {
    if (age >= visible) { break; }
    let slot = (latest + 16u - age) % 16u;
    let sample = history[input.trackerIndex * 17u + slot];
    if (sample.z != generation || sample.w <= 0.0) { previousValid = false; continue; }
    let point = sample.xy * globals.viewport.xy;
    let fade = 1.0 - f32(age) / max(f32(visible), 1.0);
    if (previousValid) {
      path = max(path, coverage(segmentDistance(pixel, previous, point), width * 0.5) * fade);
    }
    let delta = abs(pixel - point);
    keys = max(keys, coverage(abs(delta.x + delta.y - size * 0.25), width * 0.7) * select(0.0, fade, max(delta.x, delta.y) <= size * 0.3));
    previous = point;
    previousValid = true;
  }
  let local = abs(pixel - head);
  let arm = size * 0.5;
  let corner = max(local.x, local.y) >= arm * 0.58;
  let bracket = max(coverage(abs(local.x - arm), width * 0.5), coverage(abs(local.y - arm), width * 0.5));
  let marker = select(0.0, bracket, corner && all(local <= vec2f(arm + width)));
  let markerColor = globals.params[10];
  let keyColor = globals.params[11];
  let pathColor = globals.params[12];
  let strength = globals.params[13].x;
  let pathAlpha = path * pathColor.a * strength;
  let keyAlpha = keys * keyColor.a * strength;
  let markerAlpha = marker * markerColor.a * strength;
  let pathPaint = vec4f(pathColor.rgb * pathAlpha, pathAlpha);
  let keyPaint = vec4f(keyColor.rgb * keyAlpha, keyAlpha);
  let markerPaint = vec4f(markerColor.rgb * markerAlpha, markerAlpha);
  let combined = keyPaint + pathPaint * (1.0 - keyPaint.a);
  return markerPaint + combined * (1.0 - markerPaint.a);
}`;

const compositeWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var hudTexture: texture_2d<f32>;
struct VertexOutput { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let triangle = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var output: VertexOutput;
  output.position = vec4f(triangle[vertexIndex], 0.0, 1.0);
  output.uv = triangle[vertexIndex] * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
  return output;
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let source = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let hud = textureSampleLevel(hudTexture, effectSampler, input.uv, 0.0);
  let amount = globals.params[15].x;
  return hud * amount + source * (1.0 - hud.a * amount);
}`;

const scoreTexture = {
  name: "scores",
  kind: "texture-2d" as const,
  format: "rgba16float" as const,
  usage: ["sampled", "storage"] as ("sampled" | "storage")[],
  size: "fixed" as const,
  width: 64,
  height: 64,
};

export const FEATURE_TRAILS_EFFECT: EffectDefinition = {
  id: "an-native-owned-as-feature-trails",
  name: "Feature Trails",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    trackerCount: {
      type: "int",
      label: "Trackers",
      default: 16,
      min: 1,
      max: 64,
      step: 1,
    },
    detect: {
      type: "enum",
      label: "Detect",
      default: "bright",
      options: ["bright", "dark", "alpha", "red", "green", "blue"],
    },
    threshold: {
      type: "float",
      label: "Feature threshold",
      default: 0.15,
      min: 0,
      max: 0.9,
      step: 0.01,
    },
    preferenceSpread: {
      type: "float",
      label: "Preference spread",
      default: 0.75,
      min: 0,
      max: 1,
      step: 0.01,
    },
    agility: {
      type: "float",
      label: "Agility",
      default: 0.55,
      min: 0,
      max: 1,
      step: 0.01,
    },
    lifespan: {
      type: "float",
      label: "Tracker lifespan",
      default: 6,
      min: 0,
      max: 20,
      step: 0.5,
      unit: "s",
    },
    missedFrames: {
      type: "int",
      label: "Miss tolerance",
      default: 4,
      min: 0,
      max: 12,
      step: 1,
    },
    trailLength: {
      type: "int",
      label: "Trail length",
      default: 12,
      min: 1,
      max: 16,
      step: 1,
    },
    markerSize: {
      type: "float",
      label: "Marker size",
      default: 28,
      min: 8,
      max: 80,
      step: 1,
      unit: "px",
    },
    lineWidth: {
      type: "float",
      label: "Line width",
      default: 1.5,
      min: 0.5,
      max: 6,
      step: 0.25,
      unit: "px",
    },
    markerColor: {
      type: "color",
      label: "Marker color",
      default: { space: "srgb", components: [0.33, 0.84, 0.44], alpha: 1 },
    },
    keyframeColor: {
      type: "color",
      label: "Keyframe color",
      default: { space: "srgb", components: [1, 0.82, 0.2], alpha: 1 },
    },
    pathColor: {
      type: "color",
      label: "Path color",
      default: { space: "srgb", components: [0.88, 0.94, 1], alpha: 0.8 },
    },
    opacity: {
      type: "float",
      label: "Overlay opacity",
      default: 0.9,
      min: 0,
      max: 1,
      step: 0.01,
    },
    patternSeed: {
      type: "int",
      label: "Pattern seed",
      default: 31,
      min: 0,
      max: 100000,
      step: 1,
    },
    amount: {
      type: "float",
      label: "Amount",
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
    },
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
    scoreTexture,
    {
      name: "tracks",
      kind: "buffer",
      usage: ["storage"],
      size: "fixed",
      byteLength: 64 * 32,
      persistent: true,
    },
    {
      name: "history",
      kind: "buffer",
      usage: ["storage"],
      size: "fixed",
      byteLength: 64 * 17 * 16,
      persistent: true,
    },
    {
      name: "hud",
      kind: "texture-2d",
      format: "rgba16float",
      usage: ["render", "sampled"],
      size: "viewport",
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
    stateResources: ["tracks", "history"],
    sourceHistory: "sequential-captures",
    resetProperties: ["trackerCount", "detect", "patternSeed"],
  },
  passes: [
    {
      id: "score-features",
      kind: "compute",
      wgsl: scoreWgsl,
      reads: ["source"],
      output: "scores",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
    },
    {
      id: "pursue-features",
      kind: "compute",
      wgsl: pursuitWgsl,
      reads: ["scores"],
      previousFrameReads: ["tracks"],
      output: "tracks",
      dispatch: { elements: "output-buffer", workgroupSize: [64, 1, 1] },
    },
    {
      id: "record-history",
      kind: "compute",
      wgsl: historyWgsl,
      reads: ["tracks"],
      previousFrameReads: ["history"],
      output: "history",
      dispatch: { elements: "output-buffer", workgroupSize: [64, 1, 1] },
    },
    {
      id: "draw-trackers",
      kind: "render",
      wgsl: hudWgsl,
      reads: ["tracks", "history"],
      output: "hud",
      draw: { vertices: 6, instances: { property: "trackerCount", max: 64 } },
    },
    {
      id: "compose",
      kind: "render",
      wgsl: compositeWgsl,
      reads: ["source", "hud"],
      output: "color",
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original bounded feature-grid pursuit with per-generation score preferences, retained tracker histories, and instanced motion HUD.",
  },
};

export const FEATURE_TRAILS_PRESETS: EffectPreset[] = [
  {
    id: "an-preset-owned-as-bright-pursuit",
    name: "Bright Pursuit",
    definitionId: FEATURE_TRAILS_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      trackerCount: 16,
      detect: "bright",
      threshold: 0.16,
      preferenceSpread: 0.8,
      agility: 0.62,
      lifespan: 5,
      missedFrames: 3,
      trailLength: 12,
      markerSize: 28,
      lineWidth: 1.5,
      patternSeed: 31,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-as-color-drift",
    name: "Color Drift",
    definitionId: FEATURE_TRAILS_EFFECT.id,
    definitionVersion: 1,
    placement: "backdrop",
    params: {
      trackerCount: 36,
      detect: "red",
      threshold: 0.08,
      preferenceSpread: 0.95,
      agility: 0.25,
      lifespan: 12,
      missedFrames: 8,
      trailLength: 16,
      markerSize: 18,
      lineWidth: 1,
      markerColor: { space: "srgb", components: [1, 0.42, 0.27], alpha: 1 },
      keyframeColor: { space: "srgb", components: [0.36, 0.8, 1], alpha: 1 },
      pathColor: { space: "srgb", components: [1, 0.8, 0.6], alpha: 0.7 },
      patternSeed: 113,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];

export const FEATURE_TRAILS_PRESET_LABEL_SOURCE_IDS: Readonly<
  Record<string, string>
> = Object.fromEntries(
  FEATURE_TRAILS_PRESETS.map((preset) => [preset.id, preset.id]),
);
