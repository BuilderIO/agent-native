import {
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

type Look = readonly [string, Record<string, EffectValue>];
type Draft = Omit<CatalogShaderSpec, "kind"> & {
  mechanism: string;
  looks: readonly [Look, Look];
  maxSamples: number;
};
const amount = (label: string, value: number, max = 1): EffectProperty =>
  catalogFloat(label, value, 0, max);
const pixels = (
  label: string,
  value: number,
  min: number,
  max: number,
): EffectProperty => ({
  type: "float",
  label,
  default: value,
  min,
  max,
  step: 0.1,
  unit: "px",
});
const coordinate = (label: string, value: number): EffectProperty =>
  catalogFloat(label, value, 0, 1);
const edge: EffectProperty = {
  type: "enum",
  label: "Edges",
  default: "clamp",
  options: ["transparent", "clamp"],
  advanced: true,
};

const drafts: readonly Draft[] = [
  {
    id: "owned-m-cell-dissolve",
    name: "Cell Dissolve",
    maxSamples: 1,
    mechanism:
      "A seeded hash orders whole image cells in a stochastic alpha dissolve; progress endpoints preserve the complete premultiplied source or produce exact transparency.",
    properties: {
      progress: amount("Dissolve", 0.45),
      cellSize: pixels("Cell size", 20, 2, 96),
      feather: amount("Cell feather", 0.025, 0.2),
    },
    fragment: (p) => `
  let source = sampleSource(input.uv);
  let progress = ${p("progress")}.x;
  if (source.a <= 0.00001 || progress <= 0.0) { return source; }
  if (progress >= 1.0) { return vec4f(0.0); }
  let size = ${p("cellSize")}.x * globals.clock.z;
  let cell = vec2i(floor(input.uv * globals.viewport.xy / size));
  let threshold = random(cell);
  let feather = ${p("feather")}.x;
  let t = clamp((progress - threshold) / max(feather, 0.00001) + 0.5, 0.0, 1.0);
  let coverage = 1.0 - t * t * (3.0 - 2.0 * t);
  return source * coverage;`,
    looks: [
      ["Fine scatter", { progress: 0.32, cellSize: 8, feather: 0.01 }],
      ["Broad fade", { progress: 0.7, cellSize: 46, feather: 0.08 }],
    ],
  },
  {
    id: "owned-m-iris-aperture",
    name: "Iris Aperture",
    maxSamples: 1,
    mechanism:
      "An aspect-aware elliptical aperture contracts from the farthest frame corner to a chosen center; the mask changes alpha without altering surviving source chroma.",
    properties: {
      progress: amount("Close", 0.45),
      centerX: coordinate("Center X", 0.5),
      centerY: coordinate("Center Y", 0.5),
      ellipse: catalogFloat("Ellipse ratio", 1, 0.25, 4),
      feather: pixels("Edge feather", 3, 0, 48),
    },
    fragment: (p) => `
  let source = sampleSource(input.uv);
  let progress = ${p("progress")}.x;
  if (source.a <= 0.00001 || progress <= 0.0) { return source; }
  if (progress >= 1.0) { return vec4f(0.0); }
  let center = vec2f(${p("centerX")}.x, ${p("centerY")}.x);
  let physical = globals.viewport.xy / min(globals.viewport.x, globals.viewport.y);
  let metric = vec2f(physical.x / ${p("ellipse")}.x, physical.y);
  let extent = max(center, vec2f(1.0) - center) * metric;
  let maximum = length(extent);
  let radius = maximum * (1.0 - progress);
  let distance = length((input.uv - center) * metric);
  let feather = ${p("feather")}.x * globals.clock.z / min(globals.viewport.x, globals.viewport.y);
  let t = clamp((distance - radius) / max(feather, 0.00001) + 0.5, 0.0, 1.0);
  let coverage = 1.0 - t * t * (3.0 - 2.0 * t);
  return source * coverage;`,
    looks: [
      ["Centered aperture", { progress: 0.36, feather: 2, ellipse: 1 }],
      [
        "Offset oval",
        {
          progress: 0.72,
          centerX: 0.34,
          centerY: 0.58,
          ellipse: 1.8,
          feather: 12,
        },
      ],
    ],
  },
  {
    id: "owned-m-page-fold",
    name: "Page Fold",
    maxSamples: 1,
    mechanism:
      "A moving vertical sheet boundary leaves the source front intact, mirrors a narrow backface strip, shades the fold, and progressively removes the sheet into transparency.",
    properties: {
      progress: amount("Turn", 0.42),
      curlWidth: pixels("Curl width", 54, 4, 140),
      backShade: amount("Back shade", 0.48),
    },
    fragment: (p) => `
  let progress = ${p("progress")}.x;
  if (progress <= 0.0) { return sampleSource(input.uv); }
  if (progress >= 1.0) { return vec4f(0.0); }
  let fold = 1.0 - progress;
  let width = ${p("curlWidth")}.x * globals.clock.z * globals.viewport.z;
  if (input.uv.x <= fold) {
    let source = sampleSource(input.uv);
    let shade = 1.0 - ${p("backShade")}.x * 0.25 * smoothstep(fold - width, fold, input.uv.x);
    return vec4f(source.rgb * shade, source.a);
  }
  let backDistance = input.uv.x - fold;
  if (backDistance >= width) { return vec4f(0.0); }
  let bent = sampleSource(vec2f(fold - backDistance, input.uv.y));
  let roll = sin(3.14159265 * backDistance / width);
  let shade = (1.0 - ${p("backShade")}.x) * (1.0 - 0.35 * roll);
  return vec4f(bent.rgb * shade * (1.0 - progress), bent.a * (1.0 - progress));`,
    looks: [
      ["Soft turn", { progress: 0.3, curlWidth: 34, backShade: 0.3 }],
      ["Deep fold", { progress: 0.72, curlWidth: 90, backShade: 0.78 }],
    ],
  },
  {
    id: "owned-m-brush-liquify",
    name: "Brush Liquify",
    maxSamples: 2,
    mechanism:
      "A localized radial brush transports source pixels along an authored two-axis displacement field with a quartic falloff; zero displacement is exact identity.",
    properties: {
      centerX: coordinate("Brush X", 0.5),
      centerY: coordinate("Brush Y", 0.5),
      radius: pixels("Brush radius", 80, 1, 250),
      pushX: pixels("Horizontal push", 22, -100, 100),
      pushY: pixels("Vertical push", -12, -100, 100),
    },
    fragment: (p) => `
  let source = sampleSource(input.uv);
  let push = vec2f(${p("pushX")}.x, ${p("pushY")}.x);
  if (all(push == vec2f(0.0))) { return source; }
  let center = vec2f(${p("centerX")}.x, ${p("centerY")}.x);
  let deltaPx = (input.uv - center) * globals.viewport.xy / globals.clock.z;
  let t = clamp(length(deltaPx) / ${p("radius")}.x, 0.0, 1.0);
  let weight = (1.0 - t * t) * (1.0 - t * t);
  let displaced = input.uv - push * weight * globals.clock.z * globals.viewport.zw;
  return sampleSource(displaced);`,
    looks: [
      ["Small nudge", { radius: 55, pushX: 14, pushY: -8 }],
      [
        "Broad diagonal push",
        { centerX: 0.32, centerY: 0.62, radius: 155, pushX: -54, pushY: 38 },
      ],
    ],
  },
  {
    id: "owned-m-watercolor-pooling",
    name: "Watercolor Pooling",
    maxSamples: 10,
    mechanism:
      "A compact alpha-weighted pigment wash blends nearby color while source-versus-neighbor luminance contrast deposits darker pigment; grain modulates only the retained source silhouette.",
    properties: {
      radius: pixels("Wash radius", 3, 0, 14),
      diffusion: amount("Diffusion", 0.42),
      pooling: amount("Pigment pooling", 0.55),
      grain: amount("Granulation", 0.06, 0.3),
    },
    fragment: (p) => `
  let center = sampleSource(input.uv);
  if (center.a <= 0.00001) { return center; }
  let diffusion = ${p("diffusion")}.x;
  let pooling = ${p("pooling")}.x;
  let grain = ${p("grain")}.x;
  if (diffusion <= 0.0 && pooling <= 0.0 && grain <= 0.0) { return center; }
  let stepUv = ${p("radius")}.x * globals.clock.z * globals.viewport.zw;
  var premultSum = vec3f(0.0);
  var alphaSum = 0.0;
  var toneSum = 0.0;
  var count = 0.0;
  for (var y = -1; y <= 1; y += 1) {
    for (var x = -1; x <= 1; x += 1) {
      let pixel = sampleSource(input.uv + vec2f(f32(x), f32(y)) * stepUv);
      premultSum += pixel.rgb;
      alphaSum += pixel.a;
      if (pixel.a > 0.00001) { toneSum += luminance(pixel.rgb / pixel.a); count += 1.0; }
    }
  }
  let original = center.rgb / center.a;
  let wash = premultSum / max(alphaSum, 0.00001);
  let meanTone = toneSum / max(count, 1.0);
  let edgePigment = abs(luminance(original) - meanTone) * pooling;
  let fleck = (random(vec2i(floor(input.uv * globals.viewport.xy))) - 0.5) * grain;
  let colored = max(mix(original, wash, diffusion) - vec3f(edgePigment + fleck), vec3f(0.0));
  return vec4f(colored * center.a, center.a);`,
    looks: [
      ["Light wash", { radius: 2, diffusion: 0.3, pooling: 0.35, grain: 0.04 }],
      [
        "Granulated edge",
        { radius: 7, diffusion: 0.72, pooling: 0.95, grain: 0.16 },
      ],
    ],
  },
  {
    id: "owned-m-interference-edge-fringe",
    name: "Interference Edge Fringe",
    maxSamples: 5,
    mechanism:
      "Local source luminance gradients drive a three-frequency oscillating fringe response confined to edge coverage, rather than placing a full-screen decorative spectrum.",
    properties: {
      thickness: amount("Optical phase", 0.37),
      bands: catalogFloat("Fringe bands", 4, 1, 14),
      sensitivity: catalogFloat("Edge sensitivity", 0.08, 0.005, 0.4),
      amount: amount("Fringe amount", 0.55),
    },
    fragment: (p) => `
  let center = sampleSource(input.uv);
  if (center.a <= 0.00001 || ${p("amount")}.x <= 0.0) { return center; }
  let delta = globals.clock.z * globals.viewport.zw;
  let left = sampleSource(input.uv - vec2f(delta.x, 0.0));
  let right = sampleSource(input.uv + vec2f(delta.x, 0.0));
  let up = sampleSource(input.uv - vec2f(0.0, delta.y));
  let down = sampleSource(input.uv + vec2f(0.0, delta.y));
  let gx = luminance(straight(right)) - luminance(straight(left));
  let gy = luminance(straight(down)) - luminance(straight(up));
  let slope = length(vec2f(gx, gy));
  let edgeWeight = smoothstep(${p("sensitivity")}.x, ${p("sensitivity")}.x * 2.0, slope);
  let phase = (${p("thickness")}.x + slope * ${p("bands")}.x) * 6.2831853;
  let fringe = vec3f(cos(phase), cos(phase * 1.31), cos(phase * 1.66)) * 0.5 + vec3f(0.5);
  let original = center.rgb / center.a;
  let result = mix(original, fringe, edgeWeight * ${p("amount")}.x);
  return vec4f(result * center.a, center.a);`,
    looks: [
      [
        "Subtle interference",
        { thickness: 0.2, bands: 3, sensitivity: 0.12, amount: 0.35 },
      ],
      [
        "Sharp spectrum",
        { thickness: 0.73, bands: 10, sensitivity: 0.035, amount: 0.88 },
      ],
    ],
  },
];

function definitionFor(draft: Draft): EffectDefinition {
  const definition = catalogShader({
    ...draft,
    kind: "processor",
    backdrop: true,
    properties: { edge: structuredClone(edge), ...draft.properties },
  });
  return {
    ...definition,
    resources: definition.resources?.map((resource) =>
      resource.name === "color"
        ? { ...resource, format: "rgba16float" }
        : resource,
    ),
    provenance: { origin: "design-original", note: draft.mechanism },
  };
}
export const OWNED_NEXT_SIX_M_DRAFTS = drafts;
export const OWNED_NEXT_SIX_M_DEFINITIONS: readonly EffectDefinition[] =
  drafts.map(definitionFor);
export const OWNED_NEXT_SIX_M_PRESETS: readonly EffectPreset[] = drafts.flatMap(
  (draft) =>
    draft.looks.map(([name, params], index) => ({
      id: `an-preset-${draft.id}-${index + 1}`,
      name,
      definitionId: `an-native-${draft.id}`,
      definitionVersion: 1,
      placement: "layer" as const,
      params,
      clip: "bounds" as const,
      provenance: { origin: "design-original" as const },
    })),
);
