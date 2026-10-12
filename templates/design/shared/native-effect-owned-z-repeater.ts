import { NATIVE_GRAPH_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

// Each copy occupies two vec4 cells. A fixed buffer keeps the compute dispatch bounded.
const descriptorsWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(18) var<storage, read_write> descriptors: array<vec4f>;

fn random01(index: u32, channel: u32, seed: u32) -> f32 {
  var value = ((index + 1u) * 0x9e3779b9u) ^ ((channel + 1u) * 0x85ebca6bu) ^ seed;
  value = (value ^ (value >> 16u)) * 0x7feb352du;
  value = (value ^ (value >> 15u)) * 0x846ca68bu;
  return f32((value ^ (value >> 16u)) >> 8u) / 16777216.0;
}

@compute @workgroup_size(256, 1, 1) fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let index = invocation.x;
  if (index >= 32u) { return; }
  let count = u32(clamp(globals.params[1].x, 1.0, 32.0));
  let mode = u32(globals.params[0].x);
  let columns = max(1u, u32(globals.params[2].x));
  let spacing = globals.params[3].x;
  let radius = globals.params[4].x;
  let baseAngle = globals.params[5].x * 0.017453292519943295;
  let scale = globals.params[6].x;
  let rotation = globals.params[7].x * 0.017453292519943295;
  let opacity = globals.params[8].x;
  let fade = globals.params[9].x;
  let hue = globals.params[10].x * 0.017453292519943295;
  let jitter = globals.params[11].x;
  let seed = u32(globals.params[12].x);
  var center = vec2f(0.5);
  if (count > 1u) {
    if (mode == 0u) {
      let rows = (count + columns - 1u) / columns;
      let row = index / columns;
      let column = index % columns;
      let rowCount = min(columns, count - row * columns);
      let offset = vec2f((f32(column) - 0.5 * f32(rowCount - 1u)) * spacing,
        (f32(row) - 0.5 * f32(rows - 1u)) * spacing);
      center += vec2f(cos(baseAngle) * offset.x - sin(baseAngle) * offset.y,
        sin(baseAngle) * offset.x + cos(baseAngle) * offset.y);
    } else if (mode == 1u) {
      let angle = baseAngle + 6.283185307179586 * f32(index) / f32(count);
      center += radius * vec2f(cos(angle), sin(angle));
    } else {
      let distance = (f32(index) - 0.5 * f32(count - 1u)) * spacing;
      center += distance * vec2f(cos(baseAngle), sin(baseAngle));
    }
    center += jitter * spacing * vec2f(random01(index, 0u, seed) - 0.5,
      random01(index, 1u, seed) - 0.5);
  }
  let isActive = index < count;
  let normalizedIndex = f32(index) / max(f32(count - 1u), 1.0);
  let copyOpacity = clamp(opacity * (1.0 - fade * normalizedIndex), 0.0, 1.0);
  descriptors[index * 2u] = vec4f(center, max(scale, 0.01), rotation);
  descriptors[index * 2u + 1u] = vec4f(select(0.0, copyOpacity, isActive), hue * f32(index), spacing, 0.0);
}`;

const compositeWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var<storage, read> descriptors: array<vec4f>;
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};
@vertex fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let coordinates = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var output: VertexOutput;
  output.position = vec4f(coordinates[vertexIndex], 0.0, 1.0);
  output.uv = coordinates[vertexIndex] * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
  return output;
}

fn rotateHue(rgb: vec3f, angle: f32) -> vec3f {
  let axis = vec3f(0.57735026919);
  return clamp(rgb * cos(angle) + cross(axis, rgb) * sin(angle) +
    axis * dot(axis, rgb) * (1.0 - cos(angle)), vec3f(0.0), vec3f(1.0));
}

@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let count = u32(clamp(globals.params[1].x, 1.0, 32.0));
  if (count == 1u && globals.params[6].x == 1.0 && globals.params[7].x == 0.0 &&
    globals.params[8].x == 1.0 && globals.params[10].x == 0.0) {
    return textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  }
  let reverseOrder = globals.params[13].x > 0.5;
  let cropCells = globals.params[14].x > 0.5 && globals.params[0].x < 0.5;
  var result = vec4f(0.0);
  for (var step = 0u; step < 32u; step += 1u) {
    if (step >= count) { break; }
    let index = select(step, count - step - 1u, reverseOrder);
    let transform = descriptors[index * 2u];
    let appearance = descriptors[index * 2u + 1u];
    if (appearance.x <= 0.0) { continue; }
    let displacement = input.uv - transform.xy;
    if (cropCells && (abs(displacement.x) > appearance.z * 0.5 ||
      abs(displacement.y) > appearance.z * 0.5)) { continue; }
    let pixelDisplacement = displacement * globals.viewport.xy;
    let sine = sin(transform.w);
    let cosine = cos(transform.w);
    let local = vec2f(cosine * pixelDisplacement.x + sine * pixelDisplacement.y,
      -sine * pixelDisplacement.x + cosine * pixelDisplacement.y);
    let sampleUv = vec2f(0.5) + local / (globals.viewport.xy * transform.z);
    if (any(sampleUv < vec2f(0.0)) || any(sampleUv > vec2f(1.0))) { continue; }
    let sampled = textureSampleLevel(sourceTexture, effectSampler, sampleUv, 0.0);
    let alpha = clamp(sampled.a * appearance.x, 0.0, 1.0);
    if (alpha <= 0.0) { continue; }
    let straight = sampled.rgb / max(sampled.a, 0.00001);
    let layer = vec4f(rotateHue(straight, appearance.y) * alpha, alpha);
    result = layer + result * (1.0 - alpha);
  }
  return result;
}`;

export const CONTENT_REPEATER_EFFECT: EffectDefinition = {
  id: "an-native-owned-z-content-repeater",
  name: "Content Repeater",
  version: 1,
  kind: "processor",
  placements: ["layer"],
  properties: {
    mode: {
      type: "enum",
      label: "Arrangement",
      default: "grid",
      options: ["grid", "radial", "linear"],
    },
    count: {
      type: "int",
      label: "Copies",
      default: 9,
      min: 1,
      max: 32,
      step: 1,
    },
    columns: {
      type: "int",
      label: "Columns",
      default: 3,
      min: 1,
      max: 8,
      step: 1,
      visibleWhen: { property: "mode", equals: "grid" },
    },
    spacing: {
      type: "float",
      label: "Spacing",
      default: 0.31,
      min: 0,
      max: 1,
      step: 0.01,
    },
    radius: {
      type: "float",
      label: "Radius",
      default: 0.28,
      min: 0,
      max: 0.7,
      step: 0.01,
      visibleWhen: { property: "mode", equals: "radial" },
    },
    angle: {
      type: "float",
      label: "Direction",
      default: 0,
      min: -180,
      max: 180,
      step: 1,
    },
    scale: {
      type: "float",
      label: "Copy size",
      default: 0.29,
      min: 0.05,
      max: 2,
      step: 0.01,
    },
    rotation: {
      type: "float",
      label: "Rotation",
      default: 0,
      min: -180,
      max: 180,
      step: 1,
    },
    opacity: {
      type: "float",
      label: "Opacity",
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
    },
    fade: {
      type: "float",
      label: "Fade across copies",
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
    },
    hueStep: {
      type: "float",
      label: "Hue per copy",
      default: 0,
      min: -180,
      max: 180,
      step: 1,
    },
    jitter: {
      type: "float",
      label: "Position jitter",
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
    },
    seed: {
      type: "int",
      label: "Seed",
      default: 17,
      min: 0,
      max: 65535,
      step: 1,
    },
    order: {
      type: "enum",
      label: "Layer order",
      default: "forward",
      options: ["forward", "reverse"],
    },
    cropCells: {
      type: "bool",
      label: "Crop to grid cells",
      default: false,
      visibleWhen: { property: "mode", equals: "grid" },
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
      name: "descriptors",
      kind: "buffer",
      size: "fixed",
      byteLength: 1024,
      usage: ["storage"],
    },
    {
      name: "color",
      kind: "texture-2d",
      format: "rgba16float",
      size: "viewport",
      usage: ["render", "sampled"],
    },
  ],
  resourceGraph: { abi: "linear-resource-v1" },
  passes: [
    {
      id: "prepare-copies",
      kind: "compute",
      reads: [],
      output: "descriptors",
      dispatch: { elements: "output-buffer", workgroupSize: [256, 1, 1] },
      wgsl: descriptorsWgsl,
    },
    {
      id: "composite-copies",
      kind: "render",
      reads: ["source", "descriptors"],
      output: "color",
      wgsl: compositeWgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original bounded GPU layout descriptors and premultiplied source compositing for flattened design content.",
  },
};

export const CONTENT_REPEATER_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-owned-z-content-repeater-contact-sheet",
    name: "Contact sheet",
    definitionId: CONTENT_REPEATER_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: { mode: "grid", count: 9, columns: 3, spacing: 0.31, scale: 0.29 },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-z-content-repeater-orbit",
    name: "Orbit",
    definitionId: CONTENT_REPEATER_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      mode: "radial",
      count: 8,
      radius: 0.29,
      scale: 0.25,
      rotation: 25,
      hueStep: 18,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
