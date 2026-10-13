import type { EffectDefinition, EffectPreset } from "./native-effects";

const globals = `struct Globals {
  viewport: vec4f,
  clock: vec4f,
  params: array<vec4f, 32>,
};
@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var effectSampler: sampler;`;

const classifyWgsl = `${globals}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(18) var occupancyOut: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  if (any(invocation.xy >= vec2u(128))) { return; }
  let uv = (vec2f(invocation.xy) + 0.5) / 128.0;
  let source = textureSampleLevel(sourceTexture, effectSampler, uv, 0.0);
  let straight = select(vec3f(0.0), source.rgb / max(source.a, 0.00001), source.a > 0.00001);
  let light = dot(straight, vec3f(0.2126, 0.7152, 0.0722));
  let mode = u32(globals.params[0].x);
  var score = source.a;
  if (mode == 1u) { score = light * source.a; }
  if (mode == 2u) { score = (1.0 - light) * source.a; }
  if (mode == 3u) { score = straight.r * source.a; }
  if (mode == 4u) { score = straight.g * source.a; }
  if (mode == 5u) { score = straight.b * source.a; }
  textureStore(occupancyOut, vec2i(invocation.xy), vec4f(score, source.a, light, 1.0));
}`;

const trackWgsl = `${globals}
@group(0) @binding(2) var occupancy: texture_2d<f32>;
struct Track {
  bounds: vec4f,
  state: vec4f,
};
@group(0) @binding(3) var<storage, read> previousTracks: array<Track>;
@group(0) @binding(18) var<storage, read_write> nextTracks: array<Track>;
fn hash32(input: u32) -> u32 {
  var value = input ^ (input >> 16u);
  value *= 0x7feb352du;
  value ^= value >> 15u;
  value *= 0x846ca68bu;
  return value ^ (value >> 16u);
}
fn scoreAt(pixel: vec2i) -> f32 {
  return textureLoad(occupancy, clamp(pixel, vec2i(0), vec2i(127)), 0).r;
}
fn scan(center: vec2i, radius: i32, threshold: f32) -> Track {
  var low = vec2i(128);
  var high = vec2i(-1);
  var hits = 0.0;
  var examined = 0.0;
  for (var dy = -16; dy <= 16; dy += 1) {
    for (var dx = -16; dx <= 16; dx += 1) {
      if (abs(dx) > radius || abs(dy) > radius) { continue; }
      let pixel = center + vec2i(dx, dy);
      if (any(pixel < vec2i(0)) || any(pixel >= vec2i(128))) { continue; }
      examined += 1.0;
      if (scoreAt(pixel) < threshold) { continue; }
      low = min(low, pixel);
      high = max(high, pixel);
      hits += 1.0;
    }
  }
  if (hits == 0.0) { return Track(vec4f(0.0), vec4f(0.0)); }
  return Track(vec4f(vec2f(low) / 128.0, vec2f(high + vec2i(1)) / 128.0),
    vec4f(1.0, 0.0, hits, examined));
}
fn homeFor(index: u32, count: u32, arrangement: u32, seed: u32) -> vec2i {
  let aspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let columns = max(1u, u32(ceil(sqrt(f32(count) * aspect))));
  let rows = max(1u, (count + columns - 1u) / columns);
  var tile = index;
  if (arrangement == 2u) { tile = (index * 37u) % count; }
  var cell = vec2f(f32(tile % columns) + 0.5, f32(tile / columns) + 0.5) / vec2f(f32(columns), f32(rows));
  if (arrangement == 2u) {
    let jitter = vec2f(f32(hash32(index ^ seed) & 255u), f32(hash32((index * 17u) ^ seed) & 255u)) / 255.0 - 0.5;
    cell += jitter * vec2f(0.35 / f32(columns), 0.35 / f32(rows));
  }
  return clamp(vec2i(floor(cell * 128.0)), vec2i(0), vec2i(127));
}
@compute @workgroup_size(64, 1, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let index = invocation.x;
  if (index >= 64u) { return; }
  let count = u32(globals.params[4].x);
  if (index >= count) {
    nextTracks[index] = Track(vec4f(0.0), vec4f(0.0));
    return;
  }
  let mode = u32(globals.params[2].x);
  let seed = u32(globals.params[8].x);
  let home = homeFor(index, count, mode, seed);
  let old = previousTracks[index];
  let threshold = globals.params[1].x;
  let span = i32(globals.params[3].x);
  var radius = clamp(span, 4, 16);
  if (mode == 1u) {
    let centerScore = scoreAt(home);
    radius = select(min(radius + 4, 16), max(radius - 3, 4), centerScore >= threshold);
  }
  if (mode == 2u) { radius = clamp(radius + i32(hash32(index ^ seed) % 7u) - 3, 4, 16); }
  let tracking = old.state.x > 0.05;
  let oldCenter = vec2i(floor((old.bounds.xy + old.bounds.zw) * 64.0));
  let pursuit = clamp(globals.params[5].x, 0.0, 1.0);
  let followed = vec2i(round(mix(vec2f(home), vec2f(oldCenter), pursuit)));
  let search = select(home, clamp(followed, vec2i(0), vec2i(127)), tracking);
  var candidate = scan(search, radius, threshold);
  if (candidate.state.z == 0.0 && tracking) {
    candidate = scan(home, min(radius + 4, 16), threshold);
  }
  if (candidate.state.z > 0.0) {
    candidate.state.x = min(1.0, old.state.x * 0.4 + 0.6);
    candidate.state.y = 0.0;
    nextTracks[index] = candidate;
    return;
  }
  let missed = old.state.y + 1.0;
  let hold = globals.params[6].x;
  if (tracking && missed <= hold) {
    let retainedConfidence = old.state.x * (1.0 - 0.6 / max(hold, 1.0));
    nextTracks[index] = Track(old.bounds, vec4f(retainedConfidence, missed, old.state.z, old.state.w));
  } else {
    nextTracks[index] = Track(vec4f(0.0), vec4f(0.0));
  }
}`;

const hudWgsl = `${globals}
struct Track {
  bounds: vec4f,
  state: vec4f,
};
@group(0) @binding(2) var<storage, read> tracks: array<Track>;
struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) bounds: vec4f,
  @location(1) state: vec4f,
};
@vertex fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  let corners = array<vec2f, 6>(vec2f(0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0));
  let track = tracks[instanceIndex];
  let density = max(globals.clock.z, 0.01);
  let glyphSize = globals.params[17].x * density;
  let stroke = globals.params[10].x * density;
  let labelRadius = globals.params[20].x * density;
  let labelMode = u32(globals.params[14].x);
  let glyphCount = select(7.0, 4.0, labelMode == 2u);
  let labelWidth = select(0.0, (glyphCount * 4.0 + 4.0) * glyphSize, labelMode != 0u);
  let labelHeight = select(0.0, 9.0 * glyphSize, labelMode != 0u);
  let margin = vec2f(labelWidth + stroke + labelRadius + 8.0 * density,
    labelHeight + stroke + labelRadius + 8.0 * density) * globals.viewport.zw;
  let low = track.bounds.xy - margin;
  let high = track.bounds.zw + margin;
  let uv = mix(low, high, corners[vertexIndex]);
  var result: VertexOut;
  result.position = select(vec4f(2.0, 2.0, 0.0, 1.0),
    vec4f(uv * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), 0.0, 1.0), track.state.x > 0.01);
  result.bounds = track.bounds;
  result.state = track.state;
  return result;
}
fn roundedBox(point: vec2f, low: vec2f, high: vec2f, radius: f32) -> f32 {
  let half = max((high - low) * 0.5, vec2f(0.0));
  let center = (low + high) * 0.5;
  let r = min(radius, min(half.x, half.y));
  let q = abs(point - center) - half + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}
fn over(top: vec4f, bottom: vec4f) -> vec4f {
  return top + bottom * (1.0 - top.a);
}
fn colored(color: vec4f, coverage: f32) -> vec4f {
  let alpha = color.a * clamp(coverage, 0.0, 1.0);
  return vec4f(color.rgb * alpha, alpha);
}
fn glyph(digit: u32, x: u32, y: u32) -> f32 {
  if (x >= 3u || y >= 5u) { return 0.0; }
  let segments = array<u32, 10>(63u, 6u, 91u, 79u, 102u, 109u, 125u, 7u, 127u, 111u);
  if (digit == 10u) {
    return select(0.0, 1.0, (x == 0u && y == 0u) || (x == 2u && y == 4u) || (x + y == 3u));
  }
  if (digit == 11u) {
    return select(0.0, 1.0, (x == 0u && (y == 1u || y == 4u)) || (x == 1u && y == 3u) || (x == 2u && y == 1u));
  }
  let mask = segments[min(digit, 9u)];
  let top = y == 0u && (mask & 1u) != 0u;
  let rightTop = x == 2u && y == 1u && (mask & 2u) != 0u;
  let rightBottom = x == 2u && y == 3u && (mask & 4u) != 0u;
  let bottom = y == 4u && (mask & 8u) != 0u;
  let leftBottom = x == 0u && y == 3u && (mask & 16u) != 0u;
  let leftTop = x == 0u && y == 1u && (mask & 32u) != 0u;
  let middle = y == 2u && (mask & 64u) != 0u;
  return select(0.0, 1.0, top || rightTop || rightBottom || bottom || leftBottom || leftTop || middle);
}
fn labelDigit(position: u32, mode: u32, bounds: vec4f, state: vec4f) -> u32 {
  let density = max(globals.clock.z, 0.01);
  let width = min(999u, u32(round((bounds.z - bounds.x) * globals.viewport.x / density)));
  let height = min(999u, u32(round((bounds.w - bounds.y) * globals.viewport.y / density)));
  let coverage = min(100u, u32(round(100.0 * state.z / max(state.w, 1.0))));
  if (mode == 2u) {
    if (position == 3u) { return 11u; }
    let divisor = select(select(1u, 10u, position == 1u), 100u, position == 0u);
    return (coverage / divisor) % 10u;
  }
  if (position == 3u) { return 10u; }
  let value = select(width, height, position > 3u);
  let digitPosition = select(position, position - 4u, position > 3u);
  let divisor = select(select(1u, 10u, digitPosition == 1u), 100u, digitPosition == 0u);
  return (value / divisor) % 10u;
}
@fragment fn fs(input: VertexOut) -> @location(0) vec4f {
  if (input.state.x <= 0.01) { return vec4f(0.0); }
  let pixel = input.position.xy;
  let low = input.bounds.xy * globals.viewport.xy;
  let high = input.bounds.zw * globals.viewport.xy;
  let density = max(globals.clock.z, 0.01);
  let width = globals.params[10].x * density;
  let distance = roundedBox(pixel, low, high, globals.params[11].x * density);
  let inside = 1.0 - smoothstep(-0.5, 0.5, distance);
  var border = 1.0 - smoothstep(width - 0.5, width + 0.5, abs(distance));
  if (u32(globals.params[9].x) == 1u) {
    let reach = min(18.0 * density, min(high.x - low.x, high.y - low.y) * 0.3);
    let nearTopBottom = min(abs(pixel.y - low.y), abs(pixel.y - high.y)) < width + 1.0;
    let nearLeftRight = min(abs(pixel.x - low.x), abs(pixel.x - high.x)) < width + 1.0;
    let nearXEnds = min(abs(pixel.x - low.x), abs(pixel.x - high.x)) < reach;
    let nearYEnds = min(abs(pixel.y - low.y), abs(pixel.y - high.y)) < reach;
    border *= select(0.0, 1.0, (nearTopBottom && nearXEnds) || (nearLeftRight && nearYEnds));
  }
  let fill = colored(globals.params[13], inside);
  let stroke = colored(globals.params[12], border);
  var paint = over(stroke, fill);
  let labelMode = u32(globals.params[14].x);
  if (labelMode != 0u) {
    let size = globals.params[17].x * density;
    let glyphCount = select(7.0, 4.0, labelMode == 2u);
    let labelWidth = (glyphCount * 4.0 + 4.0) * size;
    let labelHeight = 9.0 * size;
    let position = u32(globals.params[15].x);
    let right = position == 0u || position == 2u;
    let top = position == 1u || position == 2u;
    let inset = globals.params[16].x > 0.5;
    let labelX = select(low.x, high.x - labelWidth, right);
    var labelY = select(high.y - labelHeight, low.y, top);
    if (!inset) { labelY = select(high.y + 2.0 * density, low.y - labelHeight - 2.0 * density, top); }
    let labelLow = vec2f(labelX, labelY);
    let labelHigh = labelLow + vec2f(labelWidth, labelHeight);
    let panel = 1.0 - smoothstep(-0.5, 0.5, roundedBox(pixel, labelLow, labelHigh, globals.params[20].x * density));
    paint = over(colored(globals.params[19], panel), paint);
    let local = (pixel - labelLow) / max(size, 0.1) - vec2f(2.0);
    if (all(local >= vec2f(0.0)) && local.y < 5.0 && local.x < glyphCount * 4.0) {
      let character = u32(floor(local.x / 4.0));
      let glyphX = u32(floor(local.x)) % 4u;
      let glyphY = u32(floor(local.y));
      let mask = glyph(labelDigit(character, labelMode, input.bounds, input.state), glyphX, glyphY);
      paint = over(colored(globals.params[18], mask), paint);
    }
  }
  return paint * (globals.params[21].x * input.state.x);
}`;

const compositeWgsl = `${globals}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var hudTexture: texture_2d<f32>;
struct VertexOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  let xy = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var output: VertexOut;
  output.position = vec4f(xy[vertexIndex], 0.0, 1.0);
  output.uv = xy[vertexIndex] * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
  return output;
}
@fragment fn fs(input: VertexOut) -> @location(0) vec4f {
  let source = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let hud = textureSampleLevel(hudTexture, effectSampler, input.uv, 0.0);
  let blend = clamp(globals.params[22].x, 0.0, 1.0);
  let base = source.rgb * clamp(globals.params[7].x, 0.0, 1.0);
  let rgb = mix(source.rgb, base * (1.0 - hud.a) + hud.rgb * source.a, blend);
  return vec4f(rgb, source.a);
}`;

const color = (components: [number, number, number], alpha = 1) => ({
  space: "srgb" as const,
  components,
  alpha,
});

export const CONTENT_BOUNDS_TRACKER_EFFECT: EffectDefinition = {
  id: "an-native-owned-ar-content-bounds-tracker",
  name: "Content Bounds Tracker",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    detect: {
      type: "enum",
      label: "Detect",
      default: "alpha",
      options: ["alpha", "bright", "dark", "red", "green", "blue"],
    },
    threshold: {
      type: "float",
      label: "Threshold",
      default: 0.25,
      min: 0,
      max: 1,
      step: 0.01,
    },
    layout: {
      type: "enum",
      label: "Cell layout",
      default: "adaptive",
      options: ["grid", "adaptive", "mosaic"],
    },
    cellSpan: {
      type: "int",
      label: "Cell span",
      default: 10,
      min: 4,
      max: 16,
      step: 1,
    },
    cells: {
      type: "int",
      label: "Detection cells",
      default: 48,
      min: 4,
      max: 64,
      step: 1,
    },
    pursuit: {
      type: "float",
      label: "Pursuit",
      default: 0.72,
      min: 0.05,
      max: 1,
      step: 0.01,
    },
    holdFrames: {
      type: "int",
      label: "Hold frames",
      default: 12,
      min: 0,
      max: 60,
      step: 1,
    },
    sourceVisibility: {
      type: "float",
      label: "Source visibility",
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
    },
    patternSeed: {
      type: "int",
      label: "Pattern seed",
      default: 19,
      min: 0,
      max: 100000,
      step: 1,
    },
    boxStyle: {
      type: "enum",
      label: "Box style",
      default: "corners",
      options: ["full", "corners"],
    },
    lineWidth: {
      type: "float",
      label: "Line width",
      default: 2,
      min: 0.5,
      max: 8,
      step: 0.5,
      unit: "px",
    },
    cornerRadius: {
      type: "float",
      label: "Corner radius",
      default: 5,
      min: 0,
      max: 24,
      step: 1,
      unit: "px",
    },
    strokeColor: {
      type: "color",
      label: "Stroke color",
      default: color([0.24, 0.94, 0.55]),
    },
    fillColor: {
      type: "color",
      label: "Fill color",
      default: color([0.1, 0.42, 0.22], 0.12),
    },
    labelMode: {
      type: "enum",
      label: "Label mode",
      default: "coverage",
      options: ["none", "dimensions", "coverage"],
    },
    labelPosition: {
      type: "enum",
      label: "Label position",
      default: "top-left",
      options: ["bottom-right", "top-left", "top-right", "bottom-left"],
    },
    labelInset: { type: "bool", label: "Label inset", default: false },
    labelSize: {
      type: "float",
      label: "Label size",
      default: 1.8,
      min: 1,
      max: 4,
      step: 0.1,
    },
    labelColor: {
      type: "color",
      label: "Label color",
      default: color([0.02, 0.08, 0.04]),
    },
    labelBackgroundColor: {
      type: "color",
      label: "Label background",
      default: color([0.72, 1, 0.78], 0.9),
    },
    labelRadius: {
      type: "float",
      label: "Label radius",
      default: 3,
      min: 0,
      max: 12,
      step: 1,
      unit: "px",
    },
    opacity: {
      type: "float",
      label: "Overlay opacity",
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
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
    {
      name: "occupancy",
      kind: "texture-2d",
      format: "rgba16float",
      usage: ["sampled", "storage"],
      size: "fixed",
      width: 128,
      height: 128,
    },
    {
      name: "tracks",
      kind: "buffer",
      usage: ["storage"],
      size: "fixed",
      byteLength: 64 * 32,
      persistent: true,
    },
    {
      name: "hud",
      kind: "texture-2d",
      format: "rgba16float",
      usage: ["sampled", "render"],
      size: "viewport",
    },
    {
      name: "color",
      kind: "texture-2d",
      format: "rgba16float",
      usage: ["sampled", "render"],
      size: "viewport",
    },
  ],
  resourceGraph: {
    abi: "stateful-resource-v1",
    timing: { fixedDt: 1 / 60, maxStepsPerCall: 8, maxStepIndex: 36000 },
    stateResources: ["tracks"],
    sourceHistory: "sequential-captures",
    resetProperties: [
      "detect",
      "threshold",
      "layout",
      "cellSpan",
      "cells",
      "patternSeed",
    ],
  },
  passes: [
    {
      id: "classify",
      kind: "compute",
      reads: ["source"],
      output: "occupancy",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
      wgsl: classifyWgsl,
    },
    {
      id: "track",
      kind: "compute",
      reads: ["occupancy"],
      previousFrameReads: ["tracks"],
      output: "tracks",
      dispatch: { elements: "output-buffer", workgroupSize: [64, 1, 1] },
      wgsl: trackWgsl,
    },
    {
      id: "hud",
      kind: "render",
      reads: ["tracks"],
      output: "hud",
      draw: { vertices: 6, instances: { property: "cells", max: 64 } },
      wgsl: hudWgsl,
    },
    {
      id: "composite",
      kind: "render",
      reads: ["source", "hud"],
      output: "color",
      wgsl: compositeWgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original bounded raster-content boxes with adaptive local reacquisition and numeric HUD labels.",
  },
};

export const CONTENT_BOUNDS_TRACKER_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-ar-content-bounds-tracker-lime",
    name: "Lime Markers",
    definitionId: CONTENT_BOUNDS_TRACKER_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      detect: "alpha",
      threshold: 0.25,
      layout: "adaptive",
      cellSpan: 10,
      cells: 48,
      pursuit: 0.72,
      holdFrames: 12,
      sourceVisibility: 1,
      patternSeed: 19,
      boxStyle: "corners",
      lineWidth: 2,
      cornerRadius: 5,
      strokeColor: color([0.24, 0.94, 0.55]),
      fillColor: color([0.1, 0.42, 0.22], 0.12),
      labelMode: "coverage",
      labelPosition: "top-left",
      labelInset: false,
      labelSize: 1.8,
      labelColor: color([0.02, 0.08, 0.04]),
      labelBackgroundColor: color([0.72, 1, 0.78], 0.9),
      labelRadius: 3,
      opacity: 1,
      amount: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-ar-content-bounds-tracker-amber",
    name: "Amber Boxes",
    definitionId: CONTENT_BOUNDS_TRACKER_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      detect: "bright",
      threshold: 0.38,
      layout: "mosaic",
      cellSpan: 12,
      cells: 36,
      pursuit: 0.86,
      holdFrames: 8,
      sourceVisibility: 1,
      patternSeed: 43,
      boxStyle: "full",
      lineWidth: 2.5,
      cornerRadius: 8,
      strokeColor: color([1, 0.64, 0.17]),
      fillColor: color([0.55, 0.26, 0.02], 0.15),
      labelMode: "dimensions",
      labelPosition: "bottom-right",
      labelInset: true,
      labelSize: 1.5,
      labelColor: color([0.18, 0.08, 0.01]),
      labelBackgroundColor: color([1, 0.85, 0.57], 0.9),
      labelRadius: 5,
      opacity: 0.9,
      amount: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
