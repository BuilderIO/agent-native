import { DESIGN_COORDINATE_RANDOM_WGSL } from "./native-effect-coordinate-random";
import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import {
  propertySlots,
  type EffectDefinition,
  type EffectProperty,
} from "./native-effects";
const unit = (label: string, value: number): EffectProperty => ({
  type: "float",
  label,
  default: value,
  min: 0,
  max: 1,
  step: 0.01,
});
const properties: Record<string, EffectProperty> = {
  incoming: {
    type: "texture",
    label: "Incoming image",
    default: null,
    input: "incoming",
  },
  progress: unit("Progress", 0.5),
  slats: { type: "int", label: "Slats", default: 12, min: 2, max: 24, step: 1 },
  stagger: unit("Stagger", 0.4),
  feather: unit("Feather", 0.04),
  direction: {
    type: "enum",
    label: "Direction",
    default: "left",
    options: ["left", "right"],
  },
  order: {
    type: "enum",
    label: "Exchange order",
    default: "slats",
    options: ["slats", "linear", "diamond", "checker", "ripple", "random-bars"],
  },
  divisions: {
    type: "int",
    label: "Divisions",
    default: 8,
    min: 2,
    max: 32,
    step: 1,
  },
  ripple: {
    type: "float",
    label: "Ripple depth",
    default: 0.1,
    min: 0,
    max: 0.22,
    step: 0.01,
  },
  patternSeed: {
    type: "int",
    label: "Pattern seed",
    default: 17,
    min: 0,
    max: 65535,
    step: 1,
  },
};
const slots = new Map<string, number>();
let count = 0;
for (const [key, property] of Object.entries(properties))
  if (property.type !== "texture") {
    slots.set(key, count);
    count += propertySlots(property);
  }
const p = (key: string): string => {
  const slot = slots.get(key);
  if (slot === undefined) throw new Error(`Unknown shutter uniform ${key}`);
  return `globals.params[${slot}]`;
};
export const SLAT_SHUTTER_CONTROL_EFFECT: EffectDefinition = {
  id: "an-native-owned-p-slat-shutter",
  name: "Slat Shutter",
  version: 5,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties,
  inputs: {
    source: { kind: "texture-2d", resource: "source" },
    incoming: { kind: "texture-2d", resource: "incoming" },
  },
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
      name: "incoming",
      kind: "texture-2d",
      usage: ["sampled"],
      external: true,
      size: "viewport",
      sampleEncoding: "srgb-color-premultiplied",
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
  passes: [
    {
      id: "render",
      kind: "render",
      reads: ["source", "incoming"],
      output: "color",
      wgsl:
        NATIVE_RENDER_GLOBALS +
        DESIGN_COORDINATE_RANDOM_WGSL +
        `
fn exchangeRank(q: vec2f) -> f32 {
 let mode = u32(${p("order")}.x);
 if (mode == 2u) { return abs(q.x - 0.5) + abs(q.y - 0.5); }
 if (mode == 3u) {
  let grid = q * ${p("divisions")}.x;
  let cell = vec2i(floor(grid));
  return (f32((cell.x + cell.y) & 1) + fract(grid.x)) * 0.5;
 }
 if (mode == 4u) {
  let radius = length(q - vec2f(0.5)) * 1.4142135623730951;
  return clamp(radius + ${p("ripple")}.x * sin(6.283185307179586 * ${p("divisions")}.x * radius), 0.0, 1.0);
 }
 if (mode == 5u) {
  let band = floor(q.y * ${p("divisions")}.x);
  let rank = designCoordinateRandom(vec2f(band, ${p("patternSeed")}.x), globals.clock.y);
  return rank * 0.65 + q.x * 0.35;
 }
 return q.x;
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
 let progress = ${p("progress")}.x;
 let original = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
 if (progress <= 0.0) { return original; }
 let incoming = textureSampleLevel(maskTexture, effectSampler, input.uv, 0.0);
 if (progress >= 1.0) { return incoming; }
 let q = vec2f(select(input.uv.x, 1.0 - input.uv.x, u32(${p("direction")}.x) == 1u), input.uv.y);
 var rank = exchangeRank(q);
 var threshold = progress;
 var width = max(${p("feather")}.x, 1.0 / min(globals.viewport.x, globals.viewport.y));
 if (u32(${p("order")}.x) == 0u) {
  let row = floor(q.y * ${p("slats")}.x);
  let delay = fract(row * 0.61803398875) * ${p("stagger")}.x * 0.5;
  threshold = clamp((progress - delay) / (1.0 - ${p("stagger")}.x * 0.5), 0.0, 1.0);
  rank = q.x;
  width = max(${p("feather")}.x, fwidth(q.x));
 }
 let reveal = 1.0 - smoothstep(threshold - width, threshold + width, rank);
 return mix(original, incoming, reveal);
}
`,
    },
  ],
  provenance: {
    origin: "design-original",
    note: "Stationary two-image threshold exchange with six rank modes. Input-UV sampling has no edge parameter. Former v3/v4 execution identities are separately frozen.",
  },
};
