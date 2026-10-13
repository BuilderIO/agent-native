import {
  CONTENT_BOUNDS_TRACKER_EFFECT,
  CONTENT_BOUNDS_TRACKER_PRESETS,
} from "./native-effect-owned-ar-content-bounds-tracker";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const globals = `struct Globals {
  viewport: vec4f,
  clock: vec4f,
  params: array<vec4f, 32>,
};
@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var effectSampler: sampler;`;

const summarizeWgsl = `${globals}
@group(0) @binding(2) var occupancy: texture_2d<f32>;
@group(0) @binding(18) var summaryOut: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  if (any(invocation.xy >= vec2u(8))) { return; }
  var mass = 0.0;
  var square = 0.0;
  var hits = 0.0;
  let threshold = globals.params[1].x;
  for (var y = 0; y < 16; y += 1) {
    for (var x = 0; x < 16; x += 1) {
      let score = textureLoad(occupancy, vec2i(invocation.xy * 16u + vec2u(u32(x), u32(y))), 0).r;
      if (score < threshold) { continue; }
      mass += score;
      square += score * score;
      hits += 1.0;
    }
  }
  textureStore(summaryOut, vec2i(invocation.xy), vec4f(mass / 256.0, square / 256.0, hits / 256.0, 1.0));
}`;

const partitionWgsl = `${globals}
@group(0) @binding(2) var summary: texture_2d<f32>;
struct Region { bounds: vec4f, info: vec4f };
@group(0) @binding(18) var<storage, read_write> regions: array<Region>;
fn hash32(input: u32) -> u32 {
  var value = input ^ (input >> 16u);
  value *= 0x7feb352du;
  value ^= value >> 15u;
  value *= 0x846ca68bu;
  return value ^ (value >> 16u);
}
fn priority(rect: vec4u, mode: u32, seed: u32) -> f32 {
  let size = rect.zw - rect.xy;
  let area = f32(size.x * size.y);
  if (mode == 0u) { return area; }
  var mass = 0.0;
  var square = 0.0;
  var hits = 0.0;
  var moment = vec2f(0.0);
  var moment2 = vec2f(0.0);
  for (var y = rect.y; y < rect.w; y += 1u) {
    for (var x = rect.x; x < rect.z; x += 1u) {
      let tile = textureLoad(summary, vec2i(i32(x), i32(y)), 0);
      let weight = tile.z;
      let point = (vec2f(f32(x), f32(y)) + 0.5) / 8.0;
      mass += tile.x;
      square += tile.y;
      hits += weight;
      moment += point * weight;
      moment2 += point * point * weight;
    }
  }
  let contrast = max(square / area - (mass / area) * (mass / area), 0.0);
  let spread = max(dot(moment2 / max(hits, 0.00001) - pow(moment / max(hits, 0.00001), vec2f(2.0)), vec2f(1.0)), 0.0);
  let occupancy = hits + mass;
  let content = occupancy * (1.0 + 8.0 * contrast + 2.0 * spread) * area;
  if (mode == 1u) { return content; }
  let noise = f32(hash32(rect.x * 17u + rect.y * 131u + rect.z * 911u + rect.w * 3571u + seed) & 255u) / 255.0;
  return content * (0.55 + noise * 0.9) + area * (0.01 + noise * 0.02);
}
@compute @workgroup_size(64, 1, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.x != 0u) { return; }
  var leaves: array<vec4u, 64>;
  leaves[0] = vec4u(0u, 0u, 8u, 8u);
  var count = 1u;
  let mode = u32(globals.params[2].x);
  let limit = min(u32(globals.params[4].x), 64u);
  let minSpan = min(u32(globals.params[3].x), 64u);
  let seed = u32(globals.params[8].x);
  for (var iteration = 0u; iteration < 21u; iteration += 1u) {
    if (count + 3u > limit) { break; }
    var selected = 64u;
    var best = -1.0;
    for (var index = 0u; index < count; index += 1u) {
      let rect = leaves[index];
      let size = rect.zw - rect.xy;
      if (size.x <= 1u || size.y <= 1u || min(size.x, size.y) * 16u <= minSpan) { continue; }
      let value = priority(rect, mode, seed);
      if (value > best) { best = value; selected = index; }
    }
    if (selected == 64u) { break; }
    let parent = leaves[selected];
    let mid = (parent.xy + parent.zw) / 2u;
    leaves[selected] = vec4u(parent.xy, mid);
    leaves[count] = vec4u(mid.x, parent.y, parent.z, mid.y);
    leaves[count + 1u] = vec4u(parent.x, mid.y, mid.x, parent.w);
    leaves[count + 2u] = vec4u(mid, parent.zw);
    count += 3u;
  }
  for (var index = 0u; index < 64u; index += 1u) {
    if (index < count) {
      let rect = leaves[index];
      regions[index] = Region(vec4f(vec2f(rect.xy) / 8.0, vec2f(rect.zw) / 8.0), vec4f(1.0, f32(index), 0.0, 0.0));
    } else {
      regions[index] = Region(vec4f(0.0), vec4f(0.0));
    }
  }
}`;

const trackWgsl = `${globals}
@group(0) @binding(2) var occupancy: texture_2d<f32>;
struct Region { bounds: vec4f, info: vec4f };
@group(0) @binding(3) var<storage, read> regions: array<Region>;
struct Track { bounds: vec4f, state: vec4f };
@group(0) @binding(4) var<storage, read> previousTracks: array<Track>;
@group(0) @binding(18) var<storage, read_write> nextTracks: array<Track>;
fn overlap(a: vec4f, b: vec4f) -> f32 {
  let extent = max(min(a.zw, b.zw) - max(a.xy, b.xy), vec2f(0.0));
  let intersection = extent.x * extent.y;
  let areaA = max(a.z - a.x, 0.0) * max(a.w - a.y, 0.0);
  let areaB = max(b.z - b.x, 0.0) * max(b.w - b.y, 0.0);
  return intersection / max(areaA + areaB - intersection, 0.000001);
}
fn centerInside(bounds: vec4f, region: vec4f) -> bool {
  let center = (bounds.xy + bounds.zw) * 0.5;
  return all(center >= region.xy) && all(center < region.zw);
}
@compute @workgroup_size(64, 1, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let index = invocation.x;
  if (index >= 64u) { return; }
  let region = regions[index];
  if (region.info.x < 0.5) {
    nextTracks[index] = Track(vec4f(0.0), vec4f(0.0));
    return;
  }
  let first = vec2i(round(region.bounds.xy * 128.0));
  let end = vec2i(round(region.bounds.zw * 128.0));
  let threshold = globals.params[1].x;
  var low = vec2i(128);
  var high = vec2i(-1);
  var hits = 0.0;
  let examined = f32((end.x - first.x) * (end.y - first.y));
  for (var y = first.y; y < end.y; y += 1) {
    for (var x = first.x; x < end.x; x += 1) {
      if (textureLoad(occupancy, vec2i(x, y), 0).r < threshold) { continue; }
      low = min(low, vec2i(x, y));
      high = max(high, vec2i(x, y));
      hits += 1.0;
    }
  }
  let found = hits > 0.0;
  let bounds = vec4f(vec2f(low) / 128.0, vec2f(high + vec2i(1)) / 128.0);
  var selected = 64u;
  var best = -1.0;
  for (var previousIndex = 0u; previousIndex < 64u; previousIndex += 1u) {
    let old = previousTracks[previousIndex];
    if (old.state.x <= 0.01 || !centerInside(old.bounds, region.bounds)) { continue; }
    let intersection = select(0.0, overlap(bounds, old.bounds), found);
    if (found && intersection <= 0.01) { continue; }
    let similarity = select(old.state.x, intersection * 2.0 + old.state.x * 0.2, found);
    if (similarity > best) { best = similarity; selected = previousIndex; }
  }
  if (found) {
    let pursuit = clamp(globals.params[5].x, 0.0, 1.0);
    var confidence = 0.6;
    if (selected < 64u) {
      let old = previousTracks[selected];
      confidence = min(1.0, old.state.x * (1.0 - pursuit) + pursuit);
    }
    nextTracks[index] = Track(bounds, vec4f(confidence, 0.0, hits, examined));
    return;
  }
  if (selected < 64u) {
    let old = previousTracks[selected];
    let missed = old.state.y + 1.0;
    let hold = globals.params[6].x;
    if (missed <= hold) {
      let clipped = vec4f(max(old.bounds.xy, region.bounds.xy), min(old.bounds.zw, region.bounds.zw));
      if (all(clipped.zw > clipped.xy)) {
        let confidence = old.state.x * (1.0 - 0.6 / max(hold, 1.0));
        nextTracks[index] = Track(clipped, vec4f(confidence, missed, old.state.z, old.state.w));
        return;
      }
    }
  }
  nextTracks[index] = Track(vec4f(0.0), vec4f(0.0));
}`;

const prior = CONTENT_BOUNDS_TRACKER_EFFECT;
const classify = prior.passes?.find((pass) => pass.id === "classify");
const hud = prior.passes?.find((pass) => pass.id === "hud");
const composite = prior.passes?.find((pass) => pass.id === "composite");
if (!classify || !hud || !composite) {
  throw new Error("Content Bounds Tracker v1 rendering passes are missing");
}

export const CONTENT_BOUNDS_TRACKER_V2_EFFECT: EffectDefinition = {
  ...prior,
  version: 2,
  properties: {
    ...prior.properties,
    cellSpan: {
      type: "int",
      label: "Cell span",
      default: 16,
      min: 16,
      max: 64,
      step: 16,
    },
  },
  resources: [
    ...(prior.resources ?? []),
    {
      name: "summary",
      kind: "texture-2d",
      format: "rgba16float",
      usage: ["sampled", "storage"],
      size: "fixed",
      width: 8,
      height: 8,
    },
    {
      name: "regions",
      kind: "buffer",
      usage: ["storage"],
      size: "fixed",
      byteLength: 64 * 32,
    },
  ],
  passes: [
    classify,
    {
      id: "summarize",
      kind: "compute",
      reads: ["occupancy"],
      output: "summary",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
      wgsl: summarizeWgsl,
    },
    {
      id: "partition",
      kind: "compute",
      reads: ["summary"],
      output: "regions",
      dispatch: { elements: "output-buffer", workgroupSize: [64, 1, 1] },
      wgsl: partitionWgsl,
    },
    {
      id: "track",
      kind: "compute",
      reads: ["occupancy", "regions"],
      previousFrameReads: ["tracks"],
      output: "tracks",
      dispatch: { elements: "output-buffer", workgroupSize: [64, 1, 1] },
      wgsl: trackWgsl,
    },
    hud,
    composite,
  ],
  provenance: {
    origin: "design-original",
    note: "Original disjoint whole-source occupancy partition with bounded temporal box matching and numeric HUD labels on a 128 by 128 classification raster.",
  },
};

export const CONTENT_BOUNDS_TRACKER_V2_PRESETS: readonly EffectPreset[] = [
  {
    ...CONTENT_BOUNDS_TRACKER_PRESETS[0],
    id: "an-preset-at-content-bounds-global-lime",
    name: "Global Lime Markers",
    definitionVersion: 2,
    params: { ...CONTENT_BOUNDS_TRACKER_PRESETS[0].params, cellSpan: 16 },
  },
  {
    ...CONTENT_BOUNDS_TRACKER_PRESETS[1],
    id: "an-preset-at-content-bounds-global-amber",
    name: "Global Amber Boxes",
    definitionVersion: 2,
    params: { ...CONTENT_BOUNDS_TRACKER_PRESETS[1].params, cellSpan: 32 },
  },
];
