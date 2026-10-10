import { EDGE_SAMPLING_WGSL } from "./native-effect-owned-next-edge-sampling";
import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import {
  propertySlots,
  type EffectColor,
  type EffectDefinition,
  type EffectProperty,
  type EffectValue,
} from "./native-effects";

export function catalogColor(
  r: number,
  g: number,
  b: number,
  alpha = 1,
): EffectColor {
  if (
    ![r, g, b, alpha].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    )
  ) {
    throw new Error("Catalog color components must be finite unit values");
  }
  return { space: "srgb", components: [r, g, b], alpha };
}

export const CATALOG_PALETTES = {
  ember: [
    catalogColor(0.1, 0.035, 0.055),
    catalogColor(0.95, 0.24, 0.075),
    catalogColor(1, 0.87, 0.57),
  ],
  lagoon: [
    catalogColor(0.015, 0.1, 0.16),
    catalogColor(0.035, 0.56, 0.59),
    catalogColor(0.74, 0.93, 0.85),
  ],
  orchid: [
    catalogColor(0.12, 0.025, 0.22),
    catalogColor(0.63, 0.19, 0.6),
    catalogColor(0.98, 0.73, 0.69),
  ],
  ink: [
    catalogColor(0.04, 0.045, 0.06),
    catalogColor(0.42, 0.46, 0.49),
    catalogColor(0.97, 0.94, 0.86),
  ],
} satisfies Record<string, EffectColor[]>;

export function catalogFloat(
  label: string,
  value: number,
  min: number,
  max: number,
  step = 0.01,
): EffectProperty {
  return { type: "float", label, default: value, min, max, step };
}

export function catalogPalette(
  defaultValue = CATALOG_PALETTES.lagoon,
): EffectProperty {
  return {
    type: "color-array",
    label: "Palette",
    default: structuredClone(defaultValue),
    maxCount: 8,
  };
}

export function catalogDefaults(
  definition: EffectDefinition,
): Record<string, EffectValue> {
  return Object.fromEntries(
    Object.entries(definition.properties).map(([key, property]) => [
      key,
      structuredClone(property.default),
    ]),
  );
}

const math = `
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;
fn hashBits(p: vec2i) -> u32 {
  var state = bitcast<u32>(p.x) * 747796405u + bitcast<u32>(p.y) * 2891336453u + u32(globals.clock.y);
  state = state * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
fn random(p: vec2i) -> f32 { return f32(hashBits(p) >> 8u) / 16777216.0; }
fn valueNoise(p: vec2f) -> f32 {
  let cell = vec2i(floor(p));
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  return mix(mix(random(cell), random(cell + vec2i(1, 0)), s.x), mix(random(cell + vec2i(0, 1)), random(cell + vec2i(1, 1)), s.x), s.y);
}
fn fractalNoise(p: vec2f) -> f32 {
  var sum = 0.0; var weight = 0.5; var q = p;
  for (var octave = 0u; octave < 5u; octave += 1u) {
    sum += valueNoise(q) * weight;
    q = vec2f(q.x * 1.6 - q.y * 1.2, q.x * 1.2 + q.y * 1.6) + vec2f(7.3, 12.1);
    weight *= 0.5;
  }
  return sum / 0.96875;
}
fn rotate(p: vec2f, angle: f32) -> vec2f { return vec2f(cos(angle) * p.x - sin(angle) * p.y, sin(angle) * p.x + cos(angle) * p.y); }
fn straight(color: vec4f) -> vec3f { return color.rgb / max(color.a, 0.00001); }
fn premultiply(rgb: vec3f, alpha: f32) -> vec4f { return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)) * alpha, alpha); }
fn luminance(rgb: vec3f) -> f32 { return dot(rgb, vec3f(0.2126, 0.7152, 0.0722)); }
`;

export interface CatalogShaderSpec {
  id: string;
  name: string;
  version?: number;
  kind: "generator" | "processor";
  properties: Record<string, EffectProperty>;
  fragment: (property: (name: string) => string) => string;
  helpers?: (property: (name: string) => string) => string;
  backdrop?: boolean;
  edgeSampling?: "repeat-mirror-bilinear-v2";
}

export function catalogShader(spec: CatalogShaderSpec): EffectDefinition {
  const slots = new Map<string, number>();
  let next = 0;
  for (const [name, property] of Object.entries(spec.properties)) {
    const width = propertySlots(property);
    if (width > 0) slots.set(name, next);
    next += width;
  }
  if (next > 32) throw new Error(`Uniform budget exceeded by ${spec.id}`);
  const property = (name: string): string => {
    if (spec.properties[name]?.type === "texture")
      throw new Error(
        `Texture property ${name} has no uniform slot in ${spec.id}`,
      );
    const slot = slots.get(name);
    if (slot === undefined)
      throw new Error(`Unknown property ${name} in ${spec.id}`);
    return `globals.params[${slot}]`;
  };
  let palette = "";
  if (slots.has("palette")) {
    const start = slots.get("palette")!;
    palette = `
fn paletteAt(position: f32) -> vec4f {
  let count = min(u32(${property("palette")}.x), 8u);
  if (count == 0u) { return vec4f(0.0); }
  let scaled = clamp(position, 0.0, 1.0) * f32(count - 1u);
  let lo = min(u32(floor(scaled)), count - 1u);
  let hi = min(lo + 1u, count - 1u);
  let a = globals.params[${start + 1}u + lo];
  let b = globals.params[${start + 1}u + hi];
  return mix(vec4f(a.rgb * a.a, a.a), vec4f(b.rgb * b.a, b.a), fract(scaled));
}
`;
  }
  if (spec.edgeSampling && spec.kind !== "processor")
    throw new Error("Edge sampling is only available for processors");
  let sampling = "";
  if (spec.kind === "processor") {
    if (!slots.has("edge"))
      throw new Error(`Processor ${spec.id} must declare edge behavior`);
    sampling =
      spec.edgeSampling === "repeat-mirror-bilinear-v2"
        ? `${EDGE_SAMPLING_WGSL}
fn sampleSource(uv: vec2f) -> vec4f {
  let edge = u32(${property("edge")}.x);
  if (edge == 2u || edge == 3u) { return sampleEdgeTexture(sourceTexture, uv, edge); }
  if (edge == 0u && (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)))) { return vec4f(0.0); }
  return textureSampleLevel(sourceTexture, effectSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
}
`
        : `
fn sampleSource(uv: vec2f) -> vec4f {
  let edge = u32(${property("edge")}.x);
  if (edge == 0u && (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)))) { return vec4f(0.0); }
  var q = clamp(uv, vec2f(0.0), vec2f(1.0));
  if (edge == 2u) { q = fract(uv); }
  if (edge == 3u) { q = 1.0 - abs(1.0 - (uv - floor(uv / 2.0) * 2.0)); }
  return textureSampleLevel(sourceTexture, effectSampler, q, 0.0);
}
`;
  }
  return {
    id: `an-native-${spec.id}`,
    name: spec.name,
    version: spec.version ?? 1,
    kind: spec.kind,
    placements:
      spec.kind === "generator"
        ? ["fill"]
        : spec.backdrop
          ? ["layer", "backdrop"]
          : ["layer"],
    properties: spec.properties,
    inputs:
      spec.kind === "processor"
        ? { source: { kind: "texture-2d", resource: "source" } }
        : undefined,
    outputs: { color: { kind: "texture-2d", resource: "color" } },
    resources: [
      ...(spec.kind === "processor"
        ? [
            {
              name: "source",
              kind: "texture-2d" as const,
              usage: ["sampled" as const],
              external: true,
              size: "viewport" as const,
            },
          ]
        : []),
      {
        name: "color",
        kind: "texture-2d",
        format: "rgba8unorm",
        usage: ["render", "sampled"],
        size: "viewport",
      },
    ],
    output: "color",
    passes: [
      {
        id: "render",
        kind: "render",
        reads: spec.kind === "processor" ? ["source"] : [],
        output: "color",
        wgsl:
          NATIVE_RENDER_GLOBALS +
          math +
          palette +
          sampling +
          (spec.helpers?.(property) ?? "") +
          `\n@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {\n${spec.fragment(property)}\n}\n`,
      },
    ],
    provenance: {
      origin: "design-original",
      note: "Original Design algorithm; seeded integer noise, linear premultiplied working color, bounded loops and explicit edge sampling.",
    },
  };
}

export const CATALOG_EDGE: EffectProperty = {
  type: "enum",
  label: "Edges",
  default: "clamp",
  options: ["transparent", "clamp", "repeat", "mirror"],
  advanced: true,
};
