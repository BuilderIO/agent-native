import {
  CATALOG_EDGE,
  catalogColor,
  catalogFloat,
  catalogShader,
  type CatalogShaderSpec,
} from "./native-effect-catalog-kit";
import { DESIGN_COORDINATE_RANDOM_WGSL } from "./native-effect-coordinate-random";
import { EDGE_SAMPLING_WGSL } from "./native-effect-owned-next-edge-sampling";
import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import { propertySlots } from "./native-effects";
import type {
  EffectDefinition,
  EffectPreset,
  EffectProperty,
  EffectValue,
  EffectParameterConstraint,
} from "./native-effects";

type Look = readonly [string, Record<string, EffectValue>];
type Draft = CatalogShaderSpec & {
  mechanism: string;
  cost: string;
  looks: readonly [Look, Look];
  extraInput?: {
    port: string;
    resource: string;
    encoding: "srgb-color-premultiplied" | "linear-data";
    property: string;
  };
  assetFill?: true;
  parameterConstraints?: EffectParameterConstraint[];
};
const unit = (label: string, value: number): EffectProperty =>
  catalogFloat(label, value, 0, 1);
const pixels = (label: string, value: number, max: number): EffectProperty => ({
  type: "float",
  label,
  default: value,
  min: 0,
  max,
  step: 0.1,
  unit: "px",
});
const tint = (
  label: string,
  r: number,
  g: number,
  b: number,
): EffectProperty => ({
  type: "color",
  label,
  default: catalogColor(r, g, b),
});
const image = (label: string, input: string): EffectProperty => ({
  type: "texture",
  label,
  default: null,
  input,
});

const OWNED_P_IMAGE_DRAFTS: readonly Draft[] = [
  {
    id: "owned-p-environment-metal",
    name: "Environment Metal",
    mechanism:
      "An analytic curved surface reflects a supplied environment image through its normal and Fresnel grazing response. The image is required, and roughness averages nearby directions before filtering, unlike a brushed-line pattern.",
    cost: "Nine bounded environment reads per pixel, one required image asset, no generated mipmaps",
    kind: "generator",
    assetFill: true,
    extraInput: {
      port: "environment",
      resource: "environment",
      encoding: "srgb-color-premultiplied",
      property: "environment",
    },
    properties: {
      environment: image("Environment image", "environment"),
      tint: tint("Metal tint", 0.83, 0.88, 0.94),
      curvature: catalogFloat("Curvature", 1.1, 0.2, 2.5),
      roughness: unit("Reflection softness", 0.14),
      fresnel: unit("Grazing light", 0.55),
      azimuth: catalogFloat("Reflection angle", 0, -180, 180, 1),
      opacity: unit("Surface opacity", 1),
    },
    helpers: (p) => `
fn reflectedEnvironment(uv: vec2f, spread: f32) -> vec4f {
  var sum = vec4f(0.0);
  for (var j = -1; j <= 1; j += 1) {
    for (var i = -1; i <= 1; i += 1) {
      let sampleUv = clamp(uv + vec2f(f32(i), f32(j)) * spread, vec2f(0.0), vec2f(1.0));
      sum += textureSampleLevel(sourceTexture, effectSampler, sampleUv, 0.0);
    }
  }
  return sum / 9.0;
}
`,
    fragment: (p) => `
  let q = input.uv * 2.0 - vec2f(1.0);
  let radial = min(dot(q, q), 1.0);
  let normal = normalize(vec3f(q * ${p("curvature")}.x, sqrt(max(1.0 - radial, 0.002))));
  let angle = ${p("azimuth")}.x * 0.017453292519943295;
  let reflection = vec2f(
    normal.x * cos(angle) - normal.y * sin(angle),
    normal.x * sin(angle) + normal.y * cos(angle)
  ) * 0.5 + vec2f(0.5);
  let env = reflectedEnvironment(reflection, ${p("roughness")}.x * 0.08);
  let grazing = pow(1.0 - clamp(normal.z, 0.0, 1.0), 5.0) * ${p("fresnel")}.x;
  let surface = ${p("tint")};
  let alpha = env.a * surface.a * ${p("opacity")}.x;
  let pigment = mix(surface.rgb, vec3f(1.0), grazing);
  return vec4f(env.rgb * pigment * surface.a * ${p("opacity")}.x, alpha);`,
    looks: [
      ["Soft chrome", { curvature: 0.8, roughness: 0.2, fresnel: 0.5 }],
      [
        "Sharp titanium",
        { curvature: 1.7, roughness: 0.02, fresnel: 0.9, azimuth: 35 },
      ],
    ],
  },
  {
    id: "owned-p-density-heatmap",
    name: "Image Density Heatmap",
    version: 3,
    edgeSampling: "repeat-mirror-bilinear-v2",
    parameterConstraints: [
      { kind: "ordered-floats", lesser: "low", greater: "high", minGap: 0.001 },
    ],
    mechanism:
      "Nine alpha-weighted source luminance observations form a local density estimate, mapped through explicit low and high thresholds to two thermal colors. It aggregates a real image rather than recoloring each pixel independently.",
    cost: "Ten bounded source reads per pixel including the center, then one premultiplied output",
    kind: "processor",
    backdrop: true,
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      radius: pixels("Density radius", 10, 64),
      low: unit("Low density", 0.18),
      high: unit("High density", 0.75),
      cold: tint("Low color", 0.05, 0.24, 0.84),
      hot: tint("High color", 1, 0.28, 0.04),
      amount: unit("Heatmap amount", 1),
    },
    helpers: () => `
fn densityAt(uv: vec2f) -> vec2f {
  let value = sampleSource(uv);
  return vec2f(luminance(value.rgb), value.a);
}
`,
    fragment: (p) => `
  let original = sampleSource(input.uv);
  if (original.a <= 0.00001 || ${p("amount")}.x <= 0.0) { return original; }
  let stepUv = ${p("radius")}.x * globals.clock.z * globals.viewport.zw;
  var collected = vec2f(0.0);
  for (var row = -1; row <= 1; row += 1) {
    for (var col = -1; col <= 1; col += 1) {
      collected += densityAt(input.uv + vec2f(f32(col), f32(row)) * stepUv);
    }
  }
  let density = clamp(collected.x / max(collected.y, 0.00001), 0.0, 1.0);
  let transfer = smoothstep(${p("low")}.x, max(${p("high")}.x, ${p("low")}.x + 0.001), density);
  let thermal = mix(${p("cold")}, ${p("hot")}, transfer);
  let alpha = original.a * thermal.a;
  let heat = vec4f(thermal.rgb * alpha, alpha);
  return mix(original, heat, ${p("amount")}.x);`,
    looks: [
      ["Blue to ember", { radius: 8, low: 0.15, high: 0.72 }],
      ["Tight thermal", { radius: 3, low: 0.32, high: 0.58, amount: 0.85 }],
    ],
  },
  {
    id: "owned-p-vector-field-displacement",
    version: 2,
    edgeSampling: "repeat-mirror-bilinear-v2",
    name: "Vector Field Displacement",
    mechanism:
      "A required raw two-channel vector image controls the direction and magnitude of every displaced source sample. RG is decoded about 0.5 and blue weights confidence; no procedural noise substitutes for authored vectors.",
    cost: "One raw vector-map read and up to two source reads per pixel",
    kind: "processor",
    backdrop: true,
    extraInput: {
      port: "vectorMap",
      resource: "vectorMap",
      encoding: "linear-data",
      property: "vectorMap",
    },
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      vectorMap: image("Vector map", "vectorMap"),
      reach: pixels("Vector reach", 24, 200),
      direction: catalogFloat("Vector angle", 0, -180, 180, 1),
      amount: unit("Displacement amount", 1),
    },
    fragment: (p) => `
  let original = sampleSource(input.uv);
  if (${p("amount")}.x <= 0.0) { return original; }
  let field = textureSampleLevel(maskTexture, effectSampler, input.uv, 0.0);
  let vector = (field.rg - vec2f(0.5)) * 2.0 * field.b;
  let angle = ${p("direction")}.x * 0.017453292519943295;
  let rotated = vec2f(vector.x * cos(angle) - vector.y * sin(angle), vector.x * sin(angle) + vector.y * cos(angle));
  let uv = input.uv + rotated * ${p("reach")}.x * globals.clock.z * globals.viewport.zw;
  return mix(original, sampleSource(uv), ${p("amount")}.x);`,
    looks: [
      ["Gentle current", { reach: 8, amount: 0.7 }],
      ["Hard field", { reach: 56, direction: 90, amount: 1 }],
    ],
  },
];
function definitionFor(draft: Draft): EffectDefinition {
  const generated = catalogShader(draft);
  if (!draft.extraInput) {
    return {
      ...generated,
      resources: generated.resources?.map((resource) =>
        resource.name === "color"
          ? { ...resource, format: "rgba16float" }
          : resource,
      ),
      provenance: { origin: "design-original", note: draft.mechanism },
      ...(draft.parameterConstraints && {
        parameterConstraints: draft.parameterConstraints,
      }),
    } as EffectDefinition;
  }
  const extra = draft.extraInput;
  const first = draft.assetFill ? extra.resource : "source";
  const second = draft.assetFill ? undefined : extra.resource;
  return {
    ...generated,
    inputs: {
      ...(generated.inputs ?? {}),
      [extra.port]: { kind: "texture-2d", resource: extra.resource },
    },
    resources: [
      ...(generated.resources ?? []).filter(
        (resource) => resource.name !== "color",
      ),
      {
        name: extra.resource,
        kind: "texture-2d",
        usage: ["sampled"],
        external: true,
        size: "viewport",
        sampleEncoding: extra.encoding,
      },
      {
        name: "color",
        kind: "texture-2d",
        format: "rgba16float",
        usage: ["render", "sampled"],
        size: "viewport",
      },
    ],
    passes: generated.passes.map((pass) => ({
      ...pass,
      reads: second ? [first, second] : [first],
    })),
    provenance: { origin: "design-original", note: draft.mechanism },
    ...(draft.parameterConstraints && {
      parameterConstraints: draft.parameterConstraints,
    }),
  } as EffectDefinition;
}

const float = (
  label: string,
  value: number,
  min: number,
  max: number,
  unit?: string,
): EffectProperty => ({
  type: "float",
  label,
  default: value,
  min,
  max,
  step: 0.01,
  ...(unit ? { unit } : {}),
});

function processor(
  id: string,
  name: string,
  version: number,
  properties: Record<string, EffectProperty>,
  code: (property: (name: string) => string) => string,
  note: string,
): EffectDefinition {
  const slots = new Map<string, number>();
  let count = 0;
  for (const [key, property] of Object.entries(properties)) {
    slots.set(key, count);
    count += propertySlots(property);
  }
  if (count > 32) throw new Error(`Uniform budget exceeded by ${id}`);
  const property = (key: string): string => {
    const slot = slots.get(key);
    if (slot === undefined) throw new Error(`Unknown uniform ${key}`);
    return `globals.params[${slot}]`;
  };
  return {
    id,
    name,
    version,
    kind: "processor",
    placements: ["layer", "backdrop"],
    properties,
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
        reads: ["source"],
        output: "color",
        wgsl: NATIVE_RENDER_GLOBALS + code(property),
      },
    ],
    provenance: { origin: "design-original", note },
  };
}

export const TAPE_TRACKING_EFFECT = processor(
  "an-native-owned-p-tape-tracking",
  "Tape Tracking",
  3,
  {
    edge: {
      type: "enum",
      label: "Edges",
      default: "clamp",
      options: ["transparent", "clamp", "repeat", "mirror"],
      advanced: true,
    },
    rate: float("Signal rate", 8, 0, 30, "Hz"),
    drift: float("Drift", 10, 0, 80, "px"),
    dropout: float("Dropout", 0.08, 0, 1),
    chromaDelay: float("Chroma delay", 2, 0, 12, "px"),
    amount: float("Amount", 0.8, 0, 1),
  },
  (p) => `${DESIGN_COORDINATE_RANDOM_WGSL}${EDGE_SAMPLING_WGSL}
fn trackingTick() -> f32 {
  let phase = fract(globals.clock.x / 256.0) * 256.0;
  return floor(phase * ${p("rate")}.x);
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let extent = vec2i(textureDimensions(sourceTexture, 0));
  let pixel = clamp(vec2i(floor(input.uv * vec2f(extent))), vec2i(0), extent - vec2i(1));
  let original = textureLoad(sourceTexture, pixel, 0);
  if (original.a <= 0.00001 || ${p("amount")}.x <= 0.0) { return original; }
  let row = floor((f32(pixel.y) + 0.5) / globals.clock.z);
  let band = floor(row / 5.0);
  let tick = trackingTick();
  let impulse = designCoordinateRandom(vec2f(band, tick), globals.clock.y);
  let shifted = select(0.0, (impulse - 0.5) * 2.0 * ${p("drift")}.x, impulse > 0.74);
  let offset = vec2f(shifted * globals.clock.z / f32(extent.x), 0.0);
  let edge = u32(${p("edge")}.x);
  let sampled = sampleEdgeTexture(sourceTexture, input.uv + offset, edge);
  let delay = vec2f(${p("chromaDelay")}.x * globals.clock.z / f32(extent.x), 0.0);
  let delayed = sampleEdgeTexture(sourceTexture, input.uv + offset + delay, edge);
  let rgb = vec3f(sampled.r, delayed.g, sampled.b);
  let dropoutSample = designCoordinateRandom(vec2f(band, tick + 8192.0), globals.clock.y);
  let level = select(1.0, 0.12, dropoutSample < ${p("dropout")}.x);
  let altered = vec4f(clamp(rgb, vec3f(0.0), vec3f(sampled.a)) * level, sampled.a);
  return mix(original, altered, ${p("amount")}.x);
}
`,
  "Five-CSS-pixel tracking bands and CSS channel delay. Seeded 256-second periodic f32 local-time clock; rate zero holds tick zero. Dropout darkens premultiplied color without reducing sampled alpha.",
);
export const OWNED_P_DEFINITIONS: readonly EffectDefinition[] = [
  ...OWNED_P_IMAGE_DRAFTS.map(definitionFor),
  TAPE_TRACKING_EFFECT,
];
export const OWNED_P_PRESETS: readonly EffectPreset[] = [
  ...OWNED_P_IMAGE_DRAFTS.flatMap((draft) =>
    draft.looks.map(([name, params], index) => ({
      id: `an-preset-${draft.id}-${index + 1}`,
      name,
      definitionId: `an-native-${draft.id}`,
      definitionVersion: draft.version ?? 1,
      placement: (draft.assetFill ? "fill" : "layer") as "fill" | "layer",
      params,
      clip: "bounds" as const,
      provenance: { origin: "design-original" as const },
    })),
  ),
  {
    id: "an-preset-owned-p-tape-tracking-1",
    name: "Mild tracking",
    definitionId: "an-native-owned-p-tape-tracking",
    definitionVersion: 3,
    placement: "layer",
    params: {
      rate: 5,
      drift: 5,
      dropout: 0.025,
      chromaDelay: 1,
    },
    clip: "bounds",
    provenance: {
      origin: "design-original",
    },
  },
  {
    id: "an-preset-owned-p-tape-tracking-2",
    name: "Broken signal",
    definitionId: "an-native-owned-p-tape-tracking",
    definitionVersion: 3,
    placement: "layer",
    params: {
      rate: 17,
      drift: 32,
      dropout: 0.21,
      chromaDelay: 5,
      amount: 1,
    },
    clip: "bounds",
    provenance: {
      origin: "design-original",
    },
  },
];
