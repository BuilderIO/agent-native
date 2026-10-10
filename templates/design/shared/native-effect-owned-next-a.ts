import { CATALOG_EDGE, catalogColor } from "./native-effect-catalog-kit";
import { EDGE_SAMPLING_WGSL } from "./native-effect-owned-next-edge-sampling";
import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import {
  propertySlots,
  type EffectDefinition,
  type EffectPreset,
  type EffectProperty,
} from "./native-effects";

type Fragment = (p: (name: string) => string) => string;
type NumericProperty = Extract<EffectProperty, { type: "float" | "int" }>;
type Stage = {
  id: string;
  reads: string[];
  output: string;
  fragment: Fragment;
};
type Look = { name: string; params: Record<string, number> };
type Draft = {
  id: string;
  name: string;
  controls: Record<string, EffectProperty>;
  stages: Stage[];
  outputExtent?: number;
  looks: [Look, Look];
  limitation?: string;
};

const scalar = (
  label: string,
  value: number,
  min: number,
  max: number,
  step = 0.01,
): NumericProperty => ({
  type: "float",
  label,
  default: value,
  min,
  max,
  step,
});
const integer = (
  label: string,
  value: number,
  min: number,
  max: number,
): NumericProperty => ({
  type: "int",
  label,
  default: value,
  min,
  max,
  step: 1,
});
const px = (label: string, value: number, max: number): NumericProperty => ({
  ...scalar(label, value, 0, max, 0.1),
  unit: "px",
});
const stage = (
  id: string,
  reads: string[],
  output: string,
  fragment: Fragment,
): Stage => ({ id, reads, output, fragment });

const sampling = `${EDGE_SAMPLING_WGSL}
fn sampleAt(uv: vec2f) -> vec4f { return sampleEdgeTexture(sourceTexture, uv, u32(globals.params[0].x)); }
fn sampleSecond(uv: vec2f) -> vec4f { return sampleEdgeTexture(maskTexture, uv, u32(globals.params[0].x)); }
fn straight(pixel: vec4f) -> vec3f { if (pixel.a <= 0.00001) { return vec3f(0.0); } return pixel.rgb / pixel.a; }
fn luma(pixel: vec4f) -> f32 { return dot(straight(pixel), vec3f(0.2126, 0.7152, 0.0722)); }
`;

const sobel = `
fn sourceGradient(uv: vec2f, stepUv: vec2f) -> vec2f {
  let tl = luma(sampleAt(uv + stepUv * vec2f(-1.0, -1.0)));
  let tc = luma(sampleAt(uv + stepUv * vec2f(0.0, -1.0)));
  let tr = luma(sampleAt(uv + stepUv * vec2f(1.0, -1.0)));
  let ml = luma(sampleAt(uv + stepUv * vec2f(-1.0, 0.0)));
  let mr = luma(sampleAt(uv + stepUv * vec2f(1.0, 0.0)));
  let bl = luma(sampleAt(uv + stepUv * vec2f(-1.0, 1.0)));
  let bc = luma(sampleAt(uv + stepUv * vec2f(0.0, 1.0)));
  let br = luma(sampleAt(uv + stepUv * vec2f(1.0, 1.0)));
  return vec2f(tr + 2.0 * mr + br - tl - 2.0 * ml - bl, bl + 2.0 * bc + br - tl - 2.0 * tc - tr) / 8.0;
}
`;

function definition(draft: Draft): EffectDefinition {
  const properties = { edge: structuredClone(CATALOG_EDGE), ...draft.controls };
  const slots = new Map<string, number>();
  let index = 0;
  for (const [name, property] of Object.entries(properties)) {
    slots.set(name, index);
    index += propertySlots(property);
  }
  if (index > 32)
    throw new RangeError(`${draft.id} exceeds native property slots`);
  const p = (name: string): string => {
    const slot = slots.get(name);
    if (slot === undefined)
      throw new Error(`${draft.id} has no ${name} property`);
    return `globals.params[${slot}]`;
  };
  const outputs = [...new Set(draft.stages.map((pass) => pass.output))];
  if (outputs[outputs.length - 1] !== "color")
    throw new Error(`${draft.id} must resolve color last`);
  return {
    id: `an-native-owned-next-${draft.id}`,
    name: draft.name,
    version: 1,
    kind: "processor",
    placements: ["layer", "backdrop"],
    properties,
    inputs: { source: { kind: "texture-2d", resource: "source" } },
    outputs: { color: { kind: "texture-2d", resource: "color" } },
    resources: [
      {
        name: "source",
        kind: "texture-2d",
        external: true,
        size: "viewport",
        usage: ["sampled"],
      },
      ...outputs.map((name) => ({
        name,
        kind: "texture-2d" as const,
        size: "viewport" as const,
        format: "rgba16float",
        usage: ["render" as const, "sampled" as const],
      })),
    ],
    output: "color",
    ...(draft.outputExtent === undefined
      ? {}
      : {
          extent: {
            output: {
              top: draft.outputExtent,
              right: draft.outputExtent,
              bottom: draft.outputExtent,
              left: draft.outputExtent,
            },
          },
        }),
    provenance: {
      origin: "design-original",
      note: "Independent Design processor with bounded passes, linear premultiplied working color, and explicit source edges.",
    },
    passes: draft.stages.map((pass) => ({
      id: pass.id,
      kind: "render",
      reads: pass.reads,
      output: pass.output,
      wgsl: `${NATIVE_RENDER_GLOBALS}${sampling}${sobel}\n@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {\n${pass.fragment(p)}\n}\n`,
    })),
  };
}

const bilateral =
  (axis: [number, number]): Fragment =>
  (p) =>
    `
let center = sampleAt(input.uv);
let radius = ${p("radius")}.x * globals.clock.z;
if (radius <= 0.0) { return center; }
let sigma = max(${p("rangeSigma")}.x, 0.001);
let delta = vec2f(${axis[0]}.0, ${axis[1]}.0) * radius * globals.viewport.zw / 4.0;
var accum = vec4f(0.0); var total = 0.0;
for (var i = -4; i <= 4; i += 1) {
  let neighbor = sampleAt(input.uv + delta * f32(i));
  let colorDelta = straight(neighbor) - straight(center);
  let alphaDelta = neighbor.a - center.a;
  let spatial = exp(-0.5 * f32(i * i));
  let range = exp(-0.5 * (dot(colorDelta, colorDelta) + alphaDelta * alphaDelta) / (sigma * sigma));
  let weight = spatial * range;
  accum += neighbor * weight; total += weight;
}
return accum / max(total, 0.00001);`;

const diffusion =
  (passIndex: number): Fragment =>
  (p) =>
    `
let center = sampleAt(input.uv);
if (${passIndex}u >= u32(${p("iterations")}.x) || ${p("timeStep")}.x <= 0.0) { return center; }
let stepUv = globals.clock.z * globals.viewport.zw;
let conductance = max(${p("conductance")}.x, 0.001);
var flow = vec4f(0.0);
for (var i = 0u; i < 4u; i += 1u) {
  let axes = array<vec2f, 4>(vec2f(1.0, 0.0), vec2f(-1.0, 0.0), vec2f(0.0, 1.0), vec2f(0.0, -1.0));
  let axis = axes[i];
  let neighbor = sampleAt(input.uv + axis * stepUv);
  let difference = luma(neighbor) - luma(center);
  let weight = exp(-difference * difference / (conductance * conductance));
  flow += (neighbor - center) * weight;
}
return center + ${p("timeStep")}.x * flow;`;

const blur5 =
  (axis: [number, number], radiusName: string): Fragment =>
  (p) =>
    `
let stepUv = vec2f(${axis[0]}.0, ${axis[1]}.0) * ${p(radiusName)}.x * globals.clock.z * globals.viewport.zw / 2.0;
return (sampleAt(input.uv - 2.0 * stepUv) + 4.0 * sampleAt(input.uv - stepUv) + 6.0 * sampleAt(input.uv) + 4.0 * sampleAt(input.uv + stepUv) + sampleAt(input.uv + 2.0 * stepUv)) / 16.0;`;

const morphology =
  (dilate: boolean, axis: readonly [number, number]): Fragment =>
  (p) =>
    `
let center = sampleAt(input.uv);
let radius = i32(ceil(${p("radius")}.x * globals.clock.z));
if (radius <= 0) { return center; }
var chosen = center;
var selectedAlpha = center.a;
for (var offset = -16; offset <= 16; offset += 1) {
  if (abs(offset) > radius) { continue; }
  let candidate = sampleAt(input.uv + vec2f(${axis[0]}.0, ${axis[1]}.0) * f32(offset) * globals.viewport.zw);
  if (${dilate ? "candidate.a > selectedAlpha" : "candidate.a < selectedAlpha"}) { selectedAlpha = candidate.a; chosen = candidate; }
}
${dilate ? "return chosen;" : "return vec4f(straight(center) * selectedAlpha, selectedAlpha);"}`;

const drafts: Draft[] = [
  {
    id: "median-speckle",
    name: "Median Speckle Removal",
    outputExtent: 3,
    controls: { radius: px("Radius", 1, 3), mix: scalar("Mix", 1, 0, 1) },
    stages: [
      stage(
        "median",
        ["source"],
        "color",
        (p) => `
if (${p("radius")}.x <= 0.0 || ${p("mix")}.x <= 0.0) { return sampleAt(input.uv); }
var samples: array<vec4f, 9>;
let delta = ${p("radius")}.x * globals.clock.z * globals.viewport.zw;
var index = 0u;
for (var y = -1; y <= 1; y += 1) { for (var x = -1; x <= 1; x += 1) { samples[index] = sampleAt(input.uv + vec2f(f32(x), f32(y)) * delta); index += 1u; } }
for (var i = 1u; i < 9u; i += 1u) { var j = i; loop { if (j == 0u || luma(samples[j - 1u]) <= luma(samples[j])) { break; } let previous = samples[j - 1u]; samples[j - 1u] = samples[j]; samples[j] = previous; j -= 1u; } }
return mix(sampleAt(input.uv), samples[4], ${p("mix")}.x);`,
      ),
    ],
    looks: [
      { name: "Pixel cleanup", params: { radius: 1, mix: 0.7 } },
      { name: "Strong median", params: { radius: 2, mix: 1 } },
    ],
  },
  {
    id: "anisotropic-diffusion",
    name: "Anisotropic Diffusion",
    outputExtent: 4,
    controls: {
      conductance: scalar("Conductance", 0.2, 0.01, 2),
      timeStep: scalar("Step size", 0.2, 0, 0.24),
      iterations: integer("Iterations", 3, 1, 4),
    },
    stages: [0, 1, 2, 3].map((i) =>
      stage(
        `diffuse-${i + 1}`,
        [i ? `diffuse${i}` : "source"],
        i === 3 ? "color" : `diffuse${i + 1}`,
        diffusion(i),
      ),
    ),
    looks: [
      { name: "Light diffusion", params: { iterations: 2, conductance: 0.1 } },
      { name: "Soft diffusion", params: { iterations: 4, conductance: 0.45 } },
    ],
  },
  {
    id: "aperture-bokeh",
    name: "Aperture Bokeh",
    outputExtent: 24,
    controls: {
      radius: px("Radius", 8, 24),
      blades: integer("Blades", 6, 4, 8),
      highlightBias: scalar("Highlight bias", 1, 0, 4),
    },
    stages: [
      stage(
        "aperture",
        ["source"],
        "color",
        (p) => `
let center = sampleAt(input.uv);
let sides = max(${p("blades")}.x, 4.0);
let radius = ${p("radius")}.x * globals.clock.z * globals.viewport.zw;
if (${p("radius")}.x <= 0.0) { return center; }
var accum = center; var total = 1.0;
for (var i = 0u; i < 16u; i += 1u) {
  let angle = 6.28318530718 * f32(i % 8u) / 8.0;
  let radial = select(0.5, 1.0, i >= 8u);
  let corner = cos(3.14159265359 / sides) / max(cos(fract(angle * sides / 6.28318530718 + 0.5) * 6.28318530718 / sides - 3.14159265359 / sides), 0.25);
  let neighbor = sampleAt(input.uv + vec2f(cos(angle), sin(angle)) * radius * radial * corner);
  let weight = 1.0 + ${p("highlightBias")}.x * max(luma(neighbor), 0.0);
  accum += neighbor * weight; total += weight;
}
return accum / total;`,
      ),
    ],
    looks: [
      { name: "Round highlights", params: { blades: 8, radius: 6 } },
      {
        name: "Cut aperture",
        params: { blades: 5, radius: 18, highlightBias: 2 },
      },
    ],
  },
  {
    id: "dark-channel-dehaze",
    name: "Dark-Channel Dehaze",
    controls: {
      amount: scalar("Amount", 0.6, 0, 1),
      atmosphere: {
        type: "color",
        label: "Atmosphere",
        default: catalogColor(0.85, 0.88, 0.92),
      },
      minimumTransmission: scalar("Minimum transmission", 0.2, 0.05, 0.8),
    },
    stages: [
      stage(
        "dark-channel",
        ["source"],
        "dark",
        () => `
var darkest = 100000.0;
for (var y = -2; y <= 2; y += 1) { for (var x = -2; x <= 2; x += 1) {
  let pixel = sampleAt(input.uv + vec2f(f32(x), f32(y)) * globals.clock.z * globals.viewport.zw);
  if (pixel.a > 0.00001) { let rgb = straight(pixel); darkest = min(darkest, min(rgb.x, min(rgb.y, rgb.z))); }
} }
if (darkest == 100000.0) { darkest = 0.0; }
let alpha = sampleAt(input.uv).a;
return vec4f(vec3f(darkest * alpha), alpha);`,
      ),
      stage(
        "recover",
        ["source", "dark"],
        "color",
        (p) => `
let source = sampleAt(input.uv);
if (source.a <= 0.00001) { return vec4f(0.0); }
if (${p("amount")}.x <= 0.0) { return source; }
let maskedDark = sampleSecond(input.uv);
let dark = maskedDark.x / max(maskedDark.a, 0.00001);
let atmosphere = ${p("atmosphere")}.rgb;
let atmosphereFloor = max(min(atmosphere.x, min(atmosphere.y, atmosphere.z)), 0.01);
let transmission = max(${p("minimumTransmission")}.x, 1.0 - ${p("amount")}.x * dark / atmosphereFloor);
let restored = (straight(source) - atmosphere) / transmission + atmosphere;
return vec4f(restored * source.a, source.a);`,
      ),
    ],
    looks: [
      { name: "Light clarity", params: { amount: 0.35 } },
      {
        name: "Dense haze recovery",
        params: { amount: 0.85, minimumTransmission: 0.12 },
      },
    ],
  },
  {
    id: "bounded-canny-contours",
    name: "Bounded Canny Contours",
    outputExtent: 3,
    controls: {
      radius: px("Smooth radius", 1, 3),
      highThreshold: scalar("High threshold", 0.2, 0.01, 2),
      lowRatio: scalar("Low ratio", 0.45, 0.05, 0.95),
      linkHops: integer("Link hops", 6, 1, 8),
      ink: scalar("Ink", 0.9, 0, 1),
    },
    stages: [
      stage("smooth-h", ["source"], "smoothH", blur5([1, 0], "radius")),
      stage("smooth-v", ["smoothH"], "smoothV", blur5([0, 1], "radius")),
      stage(
        "nonmaximum",
        ["smoothV"],
        "classified",
        (p) => `
let stepUv = globals.clock.z * globals.viewport.zw;
let gradient = sourceGradient(input.uv, stepUv);
let magnitude = length(gradient);
var direction = vec2f(0.0); if (magnitude > 0.00001) { direction = gradient / magnitude; }
let before = length(sourceGradient(input.uv - direction * stepUv, stepUv));
let after = length(sourceGradient(input.uv + direction * stepUv, stepUv));
let retained = magnitude >= before && magnitude >= after;
let strong = retained && magnitude >= ${p("highThreshold")}.x;
let weak = retained && magnitude >= ${p("highThreshold")}.x * ${p("lowRatio")}.x;
return vec4f(select(0.0, 1.0, strong), select(0.0, 1.0, weak), 0.0, 1.0);`,
      ),
      ...Array.from({ length: 8 }, (_, i) =>
        stage(
          `link-${i + 1}`,
          [i ? `link${i}` : "classified"],
          `link${i + 1}`,
          (p) => `
let current = sampleAt(input.uv);
if (${i}u >= u32(${p("linkHops")}.x) || current.g < 0.5 || current.r > 0.5) { return current; }
var connected = 0.0;
for (var y = -1; y <= 1; y += 1) { for (var x = -1; x <= 1; x += 1) {
  connected = max(connected, sampleAt(input.uv + vec2f(f32(x), f32(y)) * globals.viewport.zw).r);
} }
return vec4f(connected, current.g, 0.0, 1.0);`,
        ),
      ),
      stage(
        "ink",
        ["source", "link8"],
        "color",
        (p) => `
let source = sampleAt(input.uv);
let edge = sampleSecond(input.uv).r * ${p("ink")}.x;
return vec4f(source.rgb * (1.0 - edge), source.a);`,
      ),
    ],
    limitation:
      "Hysteresis links at most eight neighboring pixels; the name and link-hops control disclose this bound.",
    looks: [
      {
        name: "Fine connected lines",
        params: { radius: 0.8, highThreshold: 0.25, linkHops: 4 },
      },
      {
        name: "Broad connected lines",
        params: { radius: 2, highThreshold: 0.13, linkHops: 8 },
      },
    ],
  },
  {
    id: "dog-ink",
    name: "Difference-of-Gaussians Ink",
    outputExtent: 12,
    controls: {
      fineRadius: px("Fine radius", 1, 4),
      broadRadius: px("Broad radius", 4, 12),
      threshold: scalar("Threshold", 0.08, 0, 1),
      softness: scalar("Softness", 0.04, 0.001, 0.3),
      amount: scalar("Amount", 0.8, 0, 1),
    },
    stages: [
      stage("fine-h", ["source"], "fineH", blur5([1, 0], "fineRadius")),
      stage("fine-v", ["fineH"], "fineV", blur5([0, 1], "fineRadius")),
      stage("broad-h", ["source"], "broadH", blur5([1, 0], "broadRadius")),
      stage("broad-v", ["broadH"], "broadV", blur5([0, 1], "broadRadius")),
      stage(
        "difference",
        ["fineV", "broadV"],
        "difference",
        (p) => `
let response = abs(luma(sampleAt(input.uv)) - luma(sampleSecond(input.uv)));
let weight = smoothstep(${p("threshold")}.x, ${p("threshold")}.x + ${p("softness")}.x, response);
return vec4f(vec3f(weight), 1.0);`,
      ),
      stage(
        "ink",
        ["source", "difference"],
        "color",
        (p) => `
let source = sampleAt(input.uv);
let ink = sampleSecond(input.uv).r * ${p("amount")}.x;
return vec4f(source.rgb * (1.0 - ink), source.a);`,
      ),
    ],
    looks: [
      {
        name: "Fine drawn lines",
        params: { fineRadius: 0.8, broadRadius: 3, amount: 0.55 },
      },
      {
        name: "Graphic ink",
        params: { fineRadius: 1.5, broadRadius: 7, amount: 1 },
      },
    ],
  },
  {
    id: "alpha-dilate",
    name: "Alpha Dilate",
    outputExtent: 4,
    controls: { radius: { ...integer("Radius", 2, 0, 4), unit: "px" } },
    stages: [
      stage("dilate-h", ["source"], "morphH", morphology(true, [1, 0])),
      stage("dilate-v", ["morphH"], "color", morphology(true, [0, 1])),
    ],
    looks: [
      { name: "Close gaps", params: { radius: 1 } },
      { name: "Grow silhouette", params: { radius: 4 } },
    ],
  },
  {
    id: "alpha-erode",
    name: "Alpha Erode",
    controls: { radius: { ...integer("Radius", 2, 0, 4), unit: "px" } },
    stages: [
      stage("erode-h", ["source"], "morphH", morphology(false, [1, 0])),
      stage("erode-v", ["morphH"], "color", morphology(false, [0, 1])),
    ],
    looks: [
      { name: "Trim fringe", params: { radius: 1 } },
      { name: "Thin silhouette", params: { radius: 4 } },
    ],
  },
];

export const OWNED_NEXT_PROCESSOR_DEFINITIONS: readonly EffectDefinition[] =
  drafts.map(definition);
export const OWNED_NEXT_PROCESSOR_PRESETS: readonly EffectPreset[] =
  drafts.flatMap((draft) =>
    draft.looks.map((look, index) => ({
      id: `an-preset-owned-next-${draft.id}-${index + 1}`,
      name: look.name,
      definitionId: `an-native-owned-next-${draft.id}`,
      definitionVersion: 1,
      placement: "layer",
      params: look.params,
      clip: "bounds",
      provenance: { origin: "design-original" },
    })),
  );
export const OWNED_NEXT_PROCESSOR_LIMITATIONS = Object.fromEntries(
  drafts
    .filter((draft) => draft.limitation)
    .map((draft) => [draft.id, draft.limitation!]),
);
