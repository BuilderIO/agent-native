import {
  CATALOG_EDGE,
  catalogColor,
  catalogFloat,
  catalogShader,
  type CatalogShaderSpec,
} from "./native-effect-catalog-kit";
import type {
  EffectDefinition,
  EffectPreset,
  EffectProperty,
  EffectValue,
} from "./native-effects";

const cssPixels = (
  label: string,
  value: number,
  max: number,
): EffectProperty => ({
  type: "float",
  label,
  default: value,
  min: 0,
  max,
  step: 0.1,
  unit: "px",
});
const color = (
  label: string,
  r: number,
  g: number,
  b: number,
): EffectProperty => ({
  type: "color",
  label,
  default: catalogColor(r, g, b),
});
const asset = (label: string, input: string): EffectProperty => ({
  type: "texture",
  label,
  default: null,
  input,
});
type Draft = CatalogShaderSpec & {
  mechanism: string;
  inputAsset?: {
    port: string;
    resource: string;
    property: string;
    encoding: "linear-data" | "srgb-color-premultiplied";
  };
};

const drafts: readonly Draft[] = [
  {
    id: "owned-v-thermal-mask-contour",
    name: "Thermal Mask Contour",
    kind: "generator",
    mechanism:
      "A required image alpha mask gates an animated two-axis thermal wave field and repeated isotherm contour lines. It paints a thermal material rather than estimating source luminance density.",
    inputAsset: {
      port: "maskImage",
      resource: "maskImage",
      property: "maskImage",
      encoding: "srgb-color-premultiplied",
    },
    properties: {
      maskImage: asset("Image", "maskImage"),
      scale: catalogFloat("Scale", 7, 1, 20),
      speed: catalogFloat("Speed", 0.35, 0, 2),
      contour: catalogFloat("Contour", 0.6, 0, 1),
      lowColor: color("Low color", 0.03, 0.13, 0.55),
      highColor: color("High color", 1, 0.35, 0.04),
    },
    fragment: (p) => `
  let mask = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  if (mask.a <= 0.0) { return vec4f(0.0); }
  let aspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let point = input.uv * vec2f(aspect, 1.0) * ${p("scale")}.x;
  let time = globals.clock.x * ${p("speed")}.x;
  let field = clamp(0.5 + 0.26 * sin(point.x + time) + 0.24 * cos(point.y * 0.83 - time * 0.71), 0.0, 1.0);
  let transfer = smoothstep(0.17, 0.83, field);
  let bands = field * 6.0;
  let contourDistance = min(fract(bands), 1.0 - fract(bands));
  let line = (1.0 - smoothstep(0.0, 0.08, contourDistance)) * ${p("contour")}.x;
  let low = ${p("lowColor")};
  let high = ${p("highColor")};
  let alpha = mask.a * mix(low.a, high.a, transfer);
  let pigment = clamp(mix(low.rgb, high.rgb, transfer) + vec3f(line * 0.12), vec3f(0.0), vec3f(1.0));
  return vec4f(pigment * alpha, alpha);`,
  },
  {
    id: "owned-v-scalar-map-drift",
    name: "Scalar Map Drift",
    kind: "processor",
    mechanism:
      "A required raw data image provides a selectable scalar channel; the signed deviation from 0.5 pushes source samples along one independently authored angle. This is distinct from RG vector-field rotation with blue confidence weighting.",
    inputAsset: {
      port: "heightMap",
      resource: "heightMap",
      property: "heightMap",
      encoding: "linear-data",
    },
    edgeSampling: "repeat-mirror-bilinear-v2",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      heightMap: asset("Image", "heightMap"),
      channelMode: {
        type: "enum",
        label: "Channel",
        default: "luminance",
        options: ["luminance", "red", "green", "blue", "alpha"],
      },
      angle: catalogFloat("Angle", 0, -180, 180, 1),
      reach: cssPixels("Reach", 24, 200),
      amount: catalogFloat("Amount", 1, 0, 1),
    },
    fragment: (p) => `
  let original = sampleSource(input.uv);
  if (${p("amount")}.x <= 0.0) { return original; }
  let field = textureSampleLevel(maskTexture, effectSampler, input.uv, 0.0);
  let mode = u32(${p("channelMode")}.x);
  var value = dot(field.rgb, vec3f(0.2126, 0.7152, 0.0722));
  if (mode == 1u) { value = field.r; }
  if (mode == 2u) { value = field.g; }
  if (mode == 3u) { value = field.b; }
  if (mode == 4u) { value = field.a; }
  let radians = ${p("angle")}.x * 0.017453292519943295;
  let direction = vec2f(cos(radians), sin(radians));
  let offset = direction * (value - 0.5) * 2.0 * ${p("reach")}.x * globals.clock.z * globals.viewport.zw;
  return mix(original, sampleSource(input.uv + offset), ${p("amount")}.x);`,
  },
  {
    id: "owned-v-one-sided-blur",
    name: "One-Sided Progressive Blur",
    kind: "processor",
    mechanism:
      "A direction-oriented half-plane ramps an isotropic nine-tap blur radius from a chosen center. Unlike tilt focus, one side remains exactly sharp while the far side grows blurrier.",
    edgeSampling: "repeat-mirror-bilinear-v2",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      centerX: catalogFloat("Center X", 0.5, 0, 1),
      centerY: catalogFloat("Center Y", 0.5, 0, 1),
      angle: catalogFloat("Angle", 0, -180, 180, 1),
      falloff: cssPixels("Falloff", 160, 1000),
      radius: cssPixels("Radius", 8, 32),
    },
    fragment: (p) => `
  let original = sampleSource(input.uv);
  let center = vec2f(${p("centerX")}.x, ${p("centerY")}.x);
  let radians = ${p("angle")}.x * 0.017453292519943295;
  let direction = vec2f(cos(radians), sin(radians));
  let cssPoint = (input.uv - center) * globals.viewport.xy / globals.clock.z;
  let distance = max(dot(cssPoint, direction), 0.0);
  let radius = ${p("radius")}.x * clamp(distance / max(${p("falloff")}.x, 0.001), 0.0, 1.0);
  if (radius <= 0.0) { return original; }
  let stepUv = radius * globals.clock.z * globals.viewport.zw;
  var total = vec4f(0.0);
  for (var y = -1; y <= 1; y += 1) {
    for (var x = -1; x <= 1; x += 1) {
      let weight = select(1.0, 2.0, x == 0) * select(1.0, 2.0, y == 0);
      total += sampleSource(input.uv + vec2f(f32(x), f32(y)) * stepUv) * weight;
    }
  }
  return total * 0.0625;`,
  },
  {
    id: "owned-v-checker-alpha-wipe",
    name: "Checker Alpha Wipe",
    kind: "processor",
    mechanism:
      "Two checker parity classes fade source premultiplied color and coverage to transparency in ordered half-intervals. It is a one-source alpha wipe, not a two-image checker transition or color checker generator.",
    edgeSampling: "fixed-clamp",
    properties: {
      cellSize: cssPixels("Cell size", 48, 256),
      progress: catalogFloat("Progress", 0.5, 0, 1),
      softness: catalogFloat("Softness", 0.15, 0, 1),
      invert: { type: "bool", label: "Invert", default: false },
    },
    fragment: (p) => `
  let source = sampleSource(input.uv);
  let progress = ${p("progress")}.x;
  if (progress <= 0.0) { return source; }
  if (progress >= 1.0) { return vec4f(0.0); }
  let point = input.uv * globals.viewport.xy / globals.clock.z;
  let tile = vec2i(floor(point / max(${p("cellSize")}.x, 1.0)));
  let parity = (u32(tile.x + tile.y) & 1u) ^ u32(${p("invert")}.x);
  let threshold = 0.25 + 0.5 * f32(parity);
  let halfWidth = min(0.24, ${p("softness")}.x * 0.24);
  let coverage = 1.0 - smoothstep(threshold - max(halfWidth, 0.00001), threshold + max(halfWidth, 0.00001), progress);
  return source * coverage;`,
  },
  {
    id: "owned-v-soft-cell-noise",
    name: "Morphing Soft-Cell Noise",
    kind: "generator",
    mechanism:
      "Corner-seeded value noise is bilinearly interpolated with a cubic easing curve, and successive noise states morph in time. This makes soft evolving cells rather than the native stochastic block field's constant cell values.",
    properties: {
      scale: catalogFloat("Scale", 8, 1, 32),
      speed: catalogFloat("Speed", 0.35, 0, 2),
      contrast: catalogFloat("Contrast", 1.2, 0.1, 3),
      seed: {
        type: "int",
        label: "Seed",
        default: 17,
        min: 0,
        max: 65535,
        step: 1,
      },
      colorA: color("Color A", 0.07, 0.13, 0.3),
      colorB: color("Color B", 0.92, 0.68, 0.42),
    },
    helpers: () => `
fn softHash(cell: vec2i, seed: u32) -> f32 {
  var value = (bitcast<u32>(cell.x) * 0x9e3779b9u) ^ (bitcast<u32>(cell.y) * 0x85ebca6bu) ^ seed;
  value = (value ^ (value >> 16u)) * 0x7feb352du;
  value = (value ^ (value >> 15u)) * 0x846ca68bu;
  return f32((value ^ (value >> 16u)) >> 8u) / 16777216.0;
}
fn softValue(point: vec2f, seed: u32) -> f32 {
  let cell = vec2i(floor(point));
  let local = fract(point);
  let eased = local * local * (3.0 - 2.0 * local);
  let low = mix(softHash(cell, seed), softHash(cell + vec2i(1, 0), seed), eased.x);
  let high = mix(softHash(cell + vec2i(0, 1), seed), softHash(cell + vec2i(1, 1), seed), eased.x);
  return mix(low, high, eased.y);
}
`,
    fragment: (p) => `
  let aspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let point = input.uv * vec2f(aspect, 1.0) * ${p("scale")}.x;
  let time = max(globals.clock.x * ${p("speed")}.x, 0.0);
  let epoch = u32(floor(time));
  let phase = fract(time);
  let eased = phase * phase * (3.0 - 2.0 * phase);
  let seed = u32(${p("seed")}.x);
  let value = mix(softValue(point, seed + epoch), softValue(point, seed + epoch + 1u), eased);
  let blend = clamp((value - 0.5) * ${p("contrast")}.x + 0.5, 0.0, 1.0);
  let first = ${p("colorA")};
  let second = ${p("colorB")};
  return mix(vec4f(first.rgb * first.a, first.a), vec4f(second.rgb * second.a, second.a), blend);`,
  },
];

function definitionFor(draft: Draft): EffectDefinition {
  const base = catalogShader(draft);
  const extra = draft.inputAsset;
  return {
    ...base,
    ...(extra
      ? {
          inputs: {
            ...(base.inputs ?? {}),
            [extra.port]: { kind: "texture-2d", resource: extra.resource },
          },
        }
      : {}),
    resources: [
      ...(base.resources ?? []).filter((resource) => resource.name !== "color"),
      ...(extra
        ? [
            {
              name: extra.resource,
              kind: "texture-2d" as const,
              external: true,
              usage: ["sampled" as const],
              size: "viewport" as const,
              sampleEncoding: extra.encoding,
            },
          ]
        : []),
      {
        name: "color",
        kind: "texture-2d",
        format: "rgba16float",
        usage: ["render", "sampled"],
        size: "viewport",
      },
    ],
    passes: base.passes.map((pass) => ({
      ...pass,
      reads: extra
        ? draft.kind === "generator"
          ? [extra.resource]
          : ["source", extra.resource]
        : pass.reads,
    })),
    provenance: { origin: "design-original", note: draft.mechanism },
  } as EffectDefinition;
}

export const OWNED_V_FIELD_DEFINITIONS: readonly EffectDefinition[] =
  drafts.map(definitionFor);

const looks: Record<string, readonly [string, Record<string, EffectValue>][]> =
  {
    "owned-v-thermal-mask-contour": [
      ["Warm isotherms", { scale: 6, contour: 0.45 }],
      ["Tight thermal bands", { scale: 13, contour: 0.95, speed: 0.7 }],
    ],
    "owned-v-scalar-map-drift": [
      [
        "Height-map current",
        { channelMode: "luminance", angle: 0, reach: 12, amount: 0.7 },
      ],
      [
        "Alpha-map vertical pull",
        { channelMode: "alpha", angle: 90, reach: 48, amount: 1 },
      ],
    ],
    "owned-v-one-sided-blur": [
      ["Rightward falloff", { angle: 0, falloff: 180, radius: 8 }],
      ["Diagonal depth blur", { angle: 45, falloff: 260, radius: 18 }],
    ],
    "owned-v-checker-alpha-wipe": [
      ["Broad checker fade", { cellSize: 72, progress: 0.3, softness: 0.3 }],
      [
        "Fine inverted fade",
        { cellSize: 24, progress: 0.7, softness: 0.08, invert: true },
      ],
    ],
    "owned-v-soft-cell-noise": [
      ["Clouded indigo", { scale: 6, speed: 0.18, contrast: 0.8 }],
      ["Rapid amber cells", { scale: 19, speed: 0.9, contrast: 2.2, seed: 83 }],
    ],
  };

export const OWNED_V_FIELD_PRESETS: readonly EffectPreset[] =
  OWNED_V_FIELD_DEFINITIONS.flatMap((definition) => {
    const slug = definition.id.slice("an-native-".length);
    const candidates = looks[slug];
    if (!candidates || candidates.length !== 2)
      throw new Error(`Missing owned V looks for ${slug}`);
    return candidates.map(([name, params], index) => ({
      id: `an-preset-${slug}-${index + 1}`,
      name,
      definitionId: definition.id,
      definitionVersion: definition.version,
      placement:
        definition.kind === "generator"
          ? ("fill" as const)
          : ("layer" as const),
      params,
      clip: "bounds" as const,
      provenance: { origin: "design-original" as const },
    }));
  });
