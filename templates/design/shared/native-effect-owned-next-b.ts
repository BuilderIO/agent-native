import {
  CATALOG_EDGE,
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

const amount = (label: string, value: number, max = 1): EffectProperty =>
  catalogFloat(label, value, 0, max);
const pixels = (label: string, value: number, max = 80): EffectProperty => ({
  type: "float",
  label,
  default: value,
  min: 0,
  max,
  step: 0.1,
  unit: "px",
});
const corner = (label: string, x: number, y: number): EffectProperty => ({
  type: "vec2",
  label,
  default: [x, y],
  min: 0,
  max: 1,
  step: 0.001,
});
type Look = readonly [
  string,
  Record<string, EffectValue>,
  string,
  Record<string, EffectValue>,
];
type OwnedSpec = Omit<CatalogShaderSpec, "kind"> & { looks: Look };

const specs: OwnedSpec[] = [
  {
    id: "owned-corner-perspective",
    name: "Corner Perspective",
    properties: {
      topLeft: corner("Top left", 0.08, 0.04),
      topRight: corner("Top right", 0.92, 0.08),
      bottomRight: corner("Bottom right", 0.96, 0.94),
      bottomLeft: corner("Bottom left", 0.04, 0.9),
    },
    fragment: (p) => `
  let p0 = ${p("topLeft")}.xy; let p1 = ${p("topRight")}.xy;
  let p2 = ${p("bottomRight")}.xy; let p3 = ${p("bottomLeft")}.xy;
  let d1 = p1 - p2; let d2 = p3 - p2;
  let d3 = p0 - p1 + p2 - p3;
  let perspectiveDet = d1.x * d2.y - d2.x * d1.y;
  if (abs(perspectiveDet) < 0.00001) { return vec4f(0.0); }
  let g = (d3.x * d2.y - d2.x * d3.y) / perspectiveDet;
  let h = (d1.x * d3.y - d3.x * d1.y) / perspectiveDet;
  let a = p1.x - p0.x + g * p1.x; let b = p3.x - p0.x + h * p3.x;
  let d = p1.y - p0.y + g * p1.y; let e = p3.y - p0.y + h * p3.y;
  let ax = a - input.uv.x * g; let bx = b - input.uv.x * h;
  let dy = d - input.uv.y * g; let ey = e - input.uv.y * h;
  let rhs = input.uv - p0;
  let inverseDet = ax * ey - bx * dy;
  if (abs(inverseDet) < 0.00001) { return vec4f(0.0); }
  let sourceUv = vec2f((rhs.x * ey - bx * rhs.y) / inverseDet,
    (ax * rhs.y - rhs.x * dy) / inverseDet);
  if (any(sourceUv < vec2f(0.0)) || any(sourceUv > vec2f(1.0))) { return vec4f(0.0); }
  return sampleSource(sourceUv);`,
    looks: [
      "Gallery tilt",
      {
        topLeft: [0.1, 0.06],
        topRight: [0.86, 0.02],
        bottomRight: [0.96, 0.94],
        bottomLeft: [0.03, 0.88],
      },
      "Receding plane",
      {
        topLeft: [0.2, 0.1],
        topRight: [0.8, 0.1],
        bottomRight: [0.98, 0.98],
        bottomLeft: [0.02, 0.98],
      },
    ],
  },
  {
    id: "owned-chroma-key",
    name: "Chroma Key",
    properties: {
      keyHue: amount("Linear RGB hue", 0.34),
      tolerance: amount("Tolerance", 0.12, 0.5),
      softness: amount("Softness", 0.07, 0.5),
      spill: amount("Spill", 0.4),
    },
    fragment: (p) => `
  let c = sampleSource(input.uv); if (c.a <= 0.0) { return c; }
  let rgb = c.rgb / c.a;
  let maxChannel = max(rgb.r, max(rgb.g, rgb.b));
  let minChannel = min(rgb.r, min(rgb.g, rgb.b));
  let chroma = maxChannel - minChannel;
  let hue = select(select((rgb.g - rgb.b) / max(chroma, 0.00001), 2.0 + (rgb.b - rgb.r) / max(chroma, 0.00001), maxChannel == rgb.g), 4.0 + (rgb.r - rgb.g) / max(chroma, 0.00001), maxChannel == rgb.b) / 6.0;
  let hueDistance = abs(fract(hue - ${p("keyHue")}.x + 0.5) - 0.5);
  var hueWeight = select(0.0, 1.0, hueDistance <= ${p("tolerance")}.x);
  if (${p("softness")}.x > 0.0) { hueWeight = 1.0 - smoothstep(${p("tolerance")}.x, ${p("tolerance")}.x + ${p("softness")}.x, hueDistance); }
  let keyed = hueWeight * smoothstep(0.05, 0.25, chroma);
  let alpha = c.a * (1.0 - keyed);
  let neutral = vec3f(dot(rgb, vec3f(0.2126, 0.7152, 0.0722)));
  let despilled = mix(rgb, neutral, keyed * ${p("spill")}.x);
  return vec4f(despilled * alpha, alpha);`,
    looks: [
      "Green screen",
      { keyHue: 0.34, tolerance: 0.1 },
      "Blue screen",
      { keyHue: 0.62, tolerance: 0.09 },
    ],
  },
  {
    id: "owned-pointillist-brush",
    name: "Pointillist Brush",
    properties: {
      spacing: pixels("Spacing", 11, 64),
      brush: amount("Brush size", 0.7),
      jitter: amount("Jitter", 0.45),
    },
    fragment: (p) => `
  if (${p("spacing")}.x <= 0.0 || ${p("brush")}.x <= 0.0) { return sampleSource(input.uv); }
  let cellSize = ${p("spacing")}.x * globals.clock.z;
  let physical = input.uv * globals.viewport.xy;
  let cell = vec2i(floor(physical / cellSize));
  let randomOffset = vec2f(random(cell), random(cell + vec2i(17, 41))) - 0.5;
  let center = (vec2f(cell) + 0.5 + randomOffset * ${p("jitter")}.x) * cellSize;
  let radius = cellSize * ${p("brush")}.x * 0.5;
  let coverage = 1.0 - smoothstep(radius - 1.0, radius + 1.0, distance(physical, center));
  let pigment = sampleSource(center * globals.viewport.zw);
  return vec4f(pigment.rgb * coverage, pigment.a * coverage);`,
    looks: [
      "Fine dots",
      { spacing: 7, brush: 0.7 },
      "Loose marks",
      { spacing: 20, brush: 0.55, jitter: 0.8 },
    ],
  },
  {
    id: "owned-adaptive-threshold",
    name: "Adaptive Threshold",
    properties: {
      radius: pixels("Neighborhood", 6, 32),
      bias: catalogFloat("Bias", 0, -0.5, 0.5),
      softness: amount("Softness", 0.05, 0.5),
    },
    fragment: (p) => `
  let c = sampleSource(input.uv); if (c.a <= 0.0 || ${p("radius")}.x <= 0.0) { return c; }
  let offset = ${p("radius")}.x * globals.clock.z * globals.viewport.zw;
  var mean = 0.0; var weight = 0.0;
  for (var y = -2; y <= 2; y += 1) { for (var x = -2; x <= 2; x += 1) {
    let sample = sampleSource(input.uv + vec2f(f32(x), f32(y)) * offset * 0.5);
    mean += dot(sample.rgb, vec3f(0.2126, 0.7152, 0.0722)); weight += sample.a;
  }}
  let localMean = mean / max(weight, 0.00001);
  let selfLuma = dot(c.rgb / c.a, vec3f(0.2126, 0.7152, 0.0722));
  var threshold = select(0.0, 1.0, selfLuma >= localMean + ${p("bias")}.x);
  if (${p("softness")}.x > 0.0) { threshold = smoothstep(localMean + ${p("bias")}.x - ${p("softness")}.x,
    localMean + ${p("bias")}.x + ${p("softness")}.x, selfLuma); }
  return vec4f(vec3f(threshold) * c.a, c.a);`,
    looks: [
      "Soft print",
      { radius: 4, softness: 0.12 },
      "Graphic cut",
      { radius: 11, bias: -0.08, softness: 0.015 },
    ],
  },
];

function finish(definition: EffectDefinition): EffectDefinition {
  return {
    ...definition,
    resources: definition.resources?.map((resource) =>
      resource.name === "color"
        ? { ...resource, format: "rgba16float" }
        : resource,
    ),
    provenance: {
      origin: "design-original",
      note: "Original Design processor with bounded source sampling and linear-premultiplied output.",
    },
  };
}

export const OWNED_NEXT_PROCESSOR_DEFINITIONS: readonly EffectDefinition[] =
  specs.map((spec) => {
    const definition = finish(
      catalogShader({
        id: spec.id,
        name: spec.name,
        kind: "processor",
        backdrop: true,
        properties: { edge: structuredClone(CATALOG_EDGE), ...spec.properties },
        fragment: spec.fragment,
      }),
    );
    return definition;
  });

export const OWNED_NEXT_PROCESSOR_PRESETS: readonly EffectPreset[] = [
  ...specs.flatMap((spec) => {
    const [first, firstParams, second, secondParams] = spec.looks;
    return [
      {
        id: `an-preset-${spec.id}-soft`,
        name: first,
        definitionId: `an-native-${spec.id}`,
        definitionVersion: 1,
        placement: "layer" as const,
        params: firstParams,
        clip: "bounds" as const,
        provenance: { origin: "design-original" as const },
      },
      {
        id: `an-preset-${spec.id}-bold`,
        name: second,
        definitionId: `an-native-${spec.id}`,
        definitionVersion: 1,
        placement: "layer" as const,
        params: secondParams,
        clip: "bounds" as const,
        provenance: { origin: "design-original" as const },
      },
    ];
  }),
];

export function validateOwnedCornerQuad(
  corners: readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ],
):
  | { ok: true }
  | { ok: false; code: "corner-quad-degenerate" | "corner-quad-nonconvex" } {
  if (
    corners.some((point) =>
      point.some(
        (component) =>
          !Number.isFinite(component) || component < 0 || component > 1,
      ),
    )
  )
    return { ok: false, code: "corner-quad-degenerate" };
  const crosses = corners.map((point, index) => {
    const next = corners[(index + 1) % 4];
    const after = corners[(index + 2) % 4];
    return (
      (next[0] - point[0]) * (after[1] - next[1]) -
      (next[1] - point[1]) * (after[0] - next[0])
    );
  });
  if (crosses.some((cross) => Math.abs(cross) < 0.00001))
    return { ok: false, code: "corner-quad-degenerate" };
  if (crosses.some((cross) => Math.sign(cross) !== Math.sign(crosses[0])))
    return { ok: false, code: "corner-quad-nonconvex" };
  return { ok: true };
}
