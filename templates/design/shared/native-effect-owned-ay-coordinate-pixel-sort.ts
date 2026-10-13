import { NATIVE_GRAPH_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const FIELD_WIDTH = 512;
const FIELD_HEIGHT = 256;
const STAGES = 12;

function sortStageWgsl(stage: number): string {
  return `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var previousMap: texture_2d<f32>;
@group(0) @binding(18) var nextMap: texture_storage_2d<rgba16float, write>;

fn keyAt(mapped: vec4f, size: vec2f) -> vec2f {
  let uv = (mapped.xy + vec2f(0.5)) / size;
  let color = textureSampleLevel(sourceTexture, effectSampler, uv, 0.0);
  let luminance = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
  return vec2f(luminance, color.a);
}
fn hash32(input: u32) -> u32 {
  var value = input ^ (input >> 16u);
  value *= 0x7feb352du;
  value ^= value >> 15u;
  value *= 0x846ca68bu;
  return value ^ (value >> 16u);
}
fn inBrush(cell: vec2i, dimensions: vec2f) -> bool {
  if (globals.params[7].x < 0.5) { return false; }
  let uv = (vec2f(cell) + vec2f(0.5)) / dimensions;
  let cssOffset = (uv - globals.params[6].xy) * globals.viewport.xy / globals.clock.z;
  return dot(cssOffset, cssOffset) <= globals.params[1].x * globals.params[1].x;
}

@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let dimensions = textureDimensions(nextMap);
  if (any(invocation.xy >= dimensions)) { return; }
  let cell = vec2i(invocation.xy);
  if (globals.clock.w <= 0.0) {
    textureStore(nextMap, cell, vec4f(vec2f(cell), 0.0, 1.0));
    return;
  }
  let own = textureLoad(previousMap, cell, 0);
  if (${stage} >= i32(globals.params[3].x)) {
    textureStore(nextMap, cell, own);
    return;
  }
  let vertical = globals.params[4].x > 0.5;
  let coordinate = select(cell.x, cell.y, vertical);
  let extent = select(i32(dimensions.x), i32(dimensions.y), vertical);
  let parity = ${stage % 2};
  if (coordinate < parity) {
    textureStore(nextMap, cell, own);
    return;
  }
  let pairStart = ((coordinate - parity) / 2) * 2 + parity;
  if (pairStart + 1 >= extent) {
    textureStore(nextMap, cell, own);
    return;
  }
  let first = coordinate == pairStart;
  let partner = select(coordinate - 1, coordinate + 1, first);
  let otherCell = select(vec2i(partner, cell.y), vec2i(cell.x, partner), vertical);
  let other = textureLoad(previousMap, otherCell, 0);
  let size = vec2f(dimensions);
  let ownKey = keyAt(own, size);
  let otherKey = keyAt(other, size);
  let firstKey = select(otherKey.x, ownKey.x, first);
  let secondKey = select(ownKey.x, otherKey.x, first);
  let brightFirst = globals.params[5].x < 0.5;
  let outOfOrder = select(firstKey > secondKey, firstKey < secondKey, brightFirst);
  let eligible = ownKey.y > 0.01 && otherKey.y > 0.01
    && ownKey.x >= globals.params[2].x && otherKey.x >= globals.params[2].x;
  let pairCell = select(vec2i(pairStart, cell.y), vec2i(cell.x, pairStart), vertical);
  let salt = (u32(pairCell.x) * 1664525u) ^ (u32(pairCell.y) * 1013904223u)
    ^ (u32(globals.clock.x * 60.0) * 747796405u) ^ ${stage}u;
  let chance = f32(hash32(salt) >> 8u) / 16777216.0;
  let swap = eligible && outOfOrder && chance < globals.params[0].x
    && inBrush(cell, size) && inBrush(otherCell, size);
  let mapped = select(own, other, swap);
  let touched = max(own.z, select(0.0, 1.0, swap));
  textureStore(nextMap, cell, vec4f(mapped.xy, touched, 1.0));
}`;
}

const resolveWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var coordinateMap: texture_2d<f32>;
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
  let amount = globals.params[8].x;
  if (amount <= 0.0) { return source; }
  let dimensions = textureDimensions(coordinateMap);
  let cell = clamp(vec2i(input.uv * vec2f(dimensions)), vec2i(0), vec2i(dimensions) - vec2i(1));
  let mapped = textureLoad(coordinateMap, cell, 0);
  if (mapped.z <= 0.0) { return source; }
  let mappedUv = (mapped.xy + vec2f(0.5)) / vec2f(dimensions);
  let sorted = textureSampleLevel(sourceTexture, effectSampler, mappedUv, 0.0);
  return mix(source, sorted, amount);
}`;

const field = (name: string, persistent = false) => ({
  name,
  kind: "texture-2d" as const,
  format: "rgba16float" as const,
  usage: ["sampled", "storage"] as ("sampled" | "storage")[],
  ...(persistent ? { persistent: true } : {}),
  size: "fixed" as const,
  width: FIELD_WIDTH,
  height: FIELD_HEIGHT,
});

export const COORDINATE_PIXEL_SORT_EFFECT: EffectDefinition = {
  id: "an-native-owned-an-cursor-run-sort",
  name: "Cursor Run Sort",
  version: 2,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    sortStrength: {
      type: "float",
      label: "Sort strength",
      default: 0.86,
      min: 0,
      max: 1,
      step: 0.01,
    },
    brushRadius: {
      type: "float",
      label: "Brush radius",
      default: 100,
      min: 20,
      max: 400,
      step: 1,
      unit: "px",
    },
    threshold: {
      type: "float",
      label: "Luma threshold",
      default: 0.12,
      min: 0,
      max: 1,
      step: 0.01,
    },
    iterations: {
      type: "int",
      label: "Sort iterations",
      default: 8,
      min: 2,
      max: STAGES,
      step: 2,
    },
    axis: {
      type: "enum",
      label: "Sort axis",
      default: "horizontal",
      options: ["horizontal", "vertical"],
    },
    direction: {
      type: "enum",
      label: "Sort direction",
      default: "bright-first",
      options: ["bright-first", "dark-first"],
    },
    cursorPosition: {
      type: "vec2",
      label: "Cursor position",
      default: [0.5, 0.5],
      min: 0,
      max: 1,
    },
    cursorActive: { type: "bool", label: "Cursor active", default: true },
    amount: {
      type: "float",
      label: "Amount",
      default: 0.9,
      min: 0,
      max: 1,
      step: 0.01,
    },
  },
  interaction: {
    positionProperty: "cursorPosition",
    activeProperty: "cursorActive",
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
    ...Array.from({ length: STAGES - 1 }, (_, index) => field(`stage${index}`)),
    field("coordinateMap", true),
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
    stateResources: ["coordinateMap"],
    sourceHistory: "sequential-captures",
  },
  passes: [
    ...Array.from({ length: STAGES }, (_, index) => ({
      id: `sort-${index}`,
      kind: "compute" as const,
      reads: index === 0 ? ["source"] : ["source", `stage${index - 1}`],
      ...(index === 0 ? { previousFrameReads: ["coordinateMap"] } : {}),
      output: index === STAGES - 1 ? "coordinateMap" : `stage${index}`,
      dispatch: {
        elements: "output-texture" as const,
        workgroupSize: [8, 8, 1] as const,
      },
      wgsl: sortStageWgsl(index),
    })),
    {
      id: "resolve",
      kind: "render",
      reads: ["source", "coordinateMap"],
      output: "color",
      wgsl: resolveWgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original retained coordinate-map sort that gathers color from the current source each frame.",
  },
};

export const COORDINATE_PIXEL_SORT_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-ay-cursor-sweep",
    name: "Cursor Sweep",
    definitionId: COORDINATE_PIXEL_SORT_EFFECT.id,
    definitionVersion: 2,
    placement: "layer",
    params: {
      sortStrength: 0.9,
      brushRadius: 110,
      threshold: 0.1,
      iterations: 8,
      axis: "horizontal",
      direction: "bright-first",
      cursorPosition: [0.5, 0.5],
      cursorActive: true,
      amount: 0.9,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-ay-vertical-ink",
    name: "Vertical Ink",
    definitionId: COORDINATE_PIXEL_SORT_EFFECT.id,
    definitionVersion: 2,
    placement: "layer",
    params: {
      sortStrength: 1,
      brushRadius: 175,
      threshold: 0.23,
      iterations: 12,
      axis: "vertical",
      direction: "dark-first",
      cursorPosition: [0.5, 0.5],
      cursorActive: true,
      amount: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];

export const COORDINATE_PIXEL_SORT_PRESET_LABEL_SOURCE_IDS: Readonly<
  Record<string, string>
> = Object.fromEntries(
  COORDINATE_PIXEL_SORT_PRESETS.map((preset) => [preset.id, preset.id]),
);
