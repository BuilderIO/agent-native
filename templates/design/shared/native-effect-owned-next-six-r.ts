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

type Look = readonly [string, Record<string, EffectValue>];
type Draft = CatalogShaderSpec & {
  mechanism: string;
  cost: string;
  looks: readonly [Look, Look];
};
const px = (
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
const tint = (
  label: string,
  r: number,
  g: number,
  b: number,
): EffectProperty => ({ type: "color", label, default: catalogColor(r, g, b) });
const edge: EffectProperty = {
  type: "enum",
  label: "Outside source",
  default: "clamp",
  options: ["transparent", "clamp"],
  advanced: true,
};

export const OWNED_NEXT_SIX_R_DRAFTS: readonly Draft[] = [
  {
    id: "owned-r-scanline-gap-repair",
    name: "Scanline Gap Repair",
    kind: "processor",
    mechanism:
      "Detects narrow low-coverage horizontal dropout rows using intact samples above and below, then interpolates premultiplied color only where a bounded coverage gap is present. Unlike two-dimensional pinhole repair, a gap must be supported in the vertical direction and is reconstructed across a row.",
    cost: "Five source reads per pixel: center and two vertical pairs, no state or asset.",
    properties: {
      edge: structuredClone(edge),
      radius: px("Gap radius", 2, 1, 6),
      threshold: catalogFloat("Gap threshold", 0.25, 0.05, 0.8),
      strength: catalogFloat("Repair strength", 0.9, 0, 1),
    },
    fragment: (p) => `
  let center = sampleSource(input.uv);
  let stepUv = vec2f(0.0, ${p("radius")}.x * globals.clock.z * globals.viewport.w);
  let upper = sampleSource(input.uv - stepUv);
  let lower = sampleSource(input.uv + stepUv);
  let nearUpper = sampleSource(input.uv - stepUv * 0.5);
  let nearLower = sampleSource(input.uv + stepUv * 0.5);
  let supported = min(min(upper.a, lower.a), min(nearUpper.a, nearLower.a));
  let missing = clamp((supported - center.a - ${p("threshold")}.x) / max(1.0 - ${p("threshold")}.x, 0.0001), 0.0, 1.0);
  let repaired = (upper + lower + nearUpper + nearLower) * 0.25;
  return mix(center, repaired, missing * ${p("strength")}.x);`,
    looks: [
      ["Fine scratches", { radius: 1.5, threshold: 0.18, strength: 0.85 }],
      ["Wide tape loss", { radius: 4, threshold: 0.12, strength: 1 }],
    ],
  },
  {
    id: "owned-r-periodic-stripe-notch",
    name: "Periodic Stripe Notch",
    kind: "processor",
    mechanism:
      "Samples at opposing phases of a known horizontal or vertical periodic contamination, estimates the local alternating carrier, and subtracts that component from the premultiplied signal. It targets periodic interference rather than indiscriminately blurring edges.",
    cost: "Five source reads per pixel with explicit CSS-pixel frequency and direction; no state or asset.",
    properties: {
      edge: structuredClone(edge),
      period: px("Stripe period", 8, 3, 32),
      direction: {
        type: "enum",
        label: "Stripe direction",
        default: "horizontal",
        options: ["horizontal", "vertical"],
      },
      amount: catalogFloat("Suppression", 0.8, 0, 1),
    },
    fragment: (p) => `
  let center = sampleSource(input.uv);
  let across = select(vec2f(1.0, 0.0), vec2f(0.0, 1.0), u32(${p("direction")}.x) == 0u);
  let halfPeriod = across * ${p("period")}.x * 0.5 * globals.clock.z * globals.viewport.zw;
  let fullPeriod = halfPeriod * 2.0;
  let opposite = (sampleSource(input.uv - halfPeriod) + sampleSource(input.uv + halfPeriod)) * 0.5;
  let samePhase = (sampleSource(input.uv - fullPeriod) + sampleSource(input.uv + fullPeriod)) * 0.5;
  let carrier = (center + samePhase) * 0.5 - opposite;
  let corrected = center - carrier * (0.5 * ${p("amount")}.x);
  let coverage = clamp(corrected.a, 0.0, 1.0);
  return vec4f(clamp(corrected.rgb, vec3f(0.0), vec3f(coverage)), coverage);`,
    looks: [
      ["Fine horizontal", { period: 6, direction: "horizontal", amount: 0.75 }],
      ["Broad vertical", { period: 18, direction: "vertical", amount: 1 }],
    ],
  },
  {
    id: "owned-r-octagon-square-tiling",
    version: 2,
    name: "Octagon Square Tiling",
    kind: "generator",
    mechanism:
      "A clipped-square lattice constructs a semiregular four-eight-eight topology from an octagonal center region and four diagonal corner squares. Join width and facet inset alter actual polygon coverage, not merely color.",
    cost: "One analytic polygon classification per output pixel; no source reads.",
    properties: {
      tile: px("Cell size", 74, 24, 150),
      clipping: catalogFloat("Corner cut", 0.28, 0.14, 0.36),
      joint: px("Joint", 2, 0, 8),
      inset: catalogFloat("Facet inset", 0.14, 0, 0.4),
      octagon: tint("Octagon", 0.16, 0.55, 0.62),
      square: tint("Square", 0.84, 0.47, 0.23),
      grout: tint("Grout", 0.035, 0.06, 0.08),
    },
    fragment: (p) => `
  let position = input.uv * globals.viewport.xy / globals.clock.z;
  let local = abs(fract(position / ${p("tile")}.x) - vec2f(0.5));
  let cut = ${p("clipping")}.x;
  let diagonal = local.x + local.y - (1.0 - cut);
  let inner = max(local.x, local.y);
  let width = ${p("joint")}.x / ${p("tile")}.x;
  let isSquare = step(0.0, diagonal);
  let edgeDistance = min(abs(diagonal), 0.5 - inner);
  let facet = clamp((0.5 - inner) / max(${p("inset")}.x + 0.0001, 0.0001), 0.0, 1.0);
  let body = mix(${p("octagon")}, ${p("square")}, isSquare);
  let shaded = body.rgb * mix(0.7, 1.0, facet);
  let line = step(edgeDistance, width);
  let mortar = ${p("grout")};
  return mix(vec4f(shaded * body.a, body.a), vec4f(mortar.rgb * mortar.a, mortar.a), line);`,
    looks: [
      ["Ceramic hall", { tile: 84, clipping: 0.28, joint: 2, inset: 0.16 }],
      [
        "Inlaid brass",
        {
          tile: 52,
          clipping: 0.34,
          joint: 4,
          inset: 0.28,
          octagon: catalogColor(0.13, 0.21, 0.26),
          square: catalogColor(0.92, 0.7, 0.35),
        },
      ],
    ],
  },
  {
    id: "owned-r-schwarz-p-cavern",
    version: 2,
    name: "Schwarz P Cavern",
    kind: "generator",
    mechanism:
      "Raymarches a bounded trigonometric implicit surface whose zero set is cos(x)+cos(y)+cos(z)=iso, then shades the first crossing with an analytic normal and depth attenuation. Its three-axis connected cavities differ from a two-dimensional gyroid slice and solid primitive raymarches.",
    cost: "At most 48 field evaluations plus one analytic normal per pixel, fixed march; no texture source.",
    properties: {
      scale: px("Cavity scale", 70, 35, 150),
      iso: catalogFloat("Surface level", 0.2, -1.2, 1.2),
      depth: catalogFloat("Depth", 2.5, 1, 5),
      light: catalogFloat("Light angle", 0.55, -3.14, 3.14),
      base: tint("Base", 0.1, 0.38, 0.48),
      highlight: tint("Highlight", 0.83, 0.88, 0.68),
    },
    fragment: (p) => `
  let point = (input.uv - vec2f(0.5)) * globals.viewport.xy / (${p("scale")}.x * globals.clock.z);
  var hit = false;
  var hitDepth = 0.0;
  var previous = cos(point.x) + cos(point.y) + cos(-${p("depth")}.x) - ${p("iso")}.x;
  for (var index = 1u; index <= 48u; index += 1u) {
    let currentDepth = -${p("depth")}.x + 2.0 * ${p("depth")}.x * f32(index) / 48.0;
    let field = cos(point.x) + cos(point.y) + cos(currentDepth) - ${p("iso")}.x;
    if (!hit && previous * field <= 0.0) { hit = true; hitDepth = currentDepth; }
    previous = field;
  }
  let baseColor = ${p("base")};
  if (!hit) { return vec4f(baseColor.rgb * baseColor.a * 0.07, baseColor.a); }
  let normal = normalize(vec3f(-sin(point.x), -sin(point.y), -sin(hitDepth)) + vec3f(0.0001));
  let beam = normalize(vec3f(cos(${p("light")}.x), sin(${p("light")}.x), 0.8));
  let illumination = 0.17 + 0.83 * max(dot(normal, beam), 0.0);
  let fade = clamp((hitDepth + ${p("depth")}.x) / (2.0 * ${p("depth")}.x), 0.0, 1.0);
  let highlightColor = ${p("highlight")};
  let alpha = mix(baseColor.a, highlightColor.a, illumination);
  let premultRgb = mix(baseColor.rgb * baseColor.a, highlightColor.rgb * highlightColor.a, illumination) * mix(0.45, 1.0, fade);
  return vec4f(premultRgb, alpha);`,
    looks: [
      ["Open lattice", { scale: 82, iso: 0.25, depth: 2.5, light: 0.45 }],
      [
        "Dense ceramic",
        {
          scale: 48,
          iso: -0.75,
          depth: 4,
          light: -0.8,
          base: catalogColor(0.18, 0.18, 0.25),
        },
      ],
    ],
  },
  {
    id: "owned-r-steiner-circle-chain",
    version: 2,
    name: "Steiner Circle Chain",
    kind: "generator",
    mechanism:
      "Constructs a ring of equal tangent circles inside an outer circle around an inner circle. Circle radius follows the chord tangent constraint, so count changes the geometry and packing rather than tiling a dot texture.",
    cost: "One polar-angle sector lookup and three analytic circle distances per pixel; no source reads.",
    properties: {
      outerRadius: px("Outer radius", 70, 35, 160),
      count: {
        type: "int",
        label: "Circle count",
        default: 10,
        min: 5,
        max: 24,
        step: 1,
      },
      stroke: px("Stroke", 2.5, 0.5, 10),
      gap: catalogFloat("Ring gap", 0.05, 0, 0.25),
      background: tint("Background", 0.03, 0.045, 0.09),
      ring: tint("Ring", 0.92, 0.7, 0.31),
    },
    fragment: (p) => `
  let position = (input.uv - vec2f(0.5)) * globals.viewport.xy / globals.clock.z;
  let count = ${p("count")}.x;
  let sine = sin(3.141592653589793 / count);
  let outer = ${p("outerRadius")}.x;
  let small = outer * sine / (1.0 + sine);
  let centerDistance = outer - small;
  let phase = atan2(position.y, position.x);
  let sector = floor(phase * count / 6.283185307179586 + 0.5);
  let angle = sector * 6.283185307179586 / count;
  let satellite = vec2f(cos(angle), sin(angle)) * centerDistance;
  let inner = max(outer - 2.0 * small, 0.0);
  let smallDistance = abs(length(position - satellite) - small * (1.0 - ${p("gap")}.x));
  let innerDistance = abs(length(position) - inner);
  let outerDistance = abs(length(position) - outer);
  let ink = 1.0 - step(${p("stroke")}.x * 0.5, min(smallDistance, min(innerDistance, outerDistance)));
  let backgroundColor = ${p("background")};
  let ringColor = ${p("ring")};
  return mix(vec4f(backgroundColor.rgb * backgroundColor.a, backgroundColor.a), vec4f(ringColor.rgb * ringColor.a, ringColor.a), ink);`,
    looks: [
      ["Ten links", { count: 10, outerRadius: 68, stroke: 2.5, gap: 0.03 }],
      ["Fine chain", { count: 20, outerRadius: 74, stroke: 1.3, gap: 0.09 }],
    ],
  },
  {
    id: "owned-r-bezier-hatch",
    version: 2,
    name: "Bezier Hatch",
    kind: "generator",
    mechanism:
      "Measures distance to connected piecewise-cubic arch segments with independent rise and shoulder controls, producing continuous engraved curves rather than circles, sinusoids, or a recolored straight hatch.",
    cost: "At most six candidate rows with 24 connected cubic segments each; vertical range culling avoids distant rows.",
    properties: {
      spacing: px("Arch spacing", 54, 22, 110),
      rise: px("Rise", 36, 8, 90),
      shoulder: catalogFloat("Shoulder", 0.38, 0.05, 0.95),
      stroke: px("Stroke", 2.4, 0.5, 9),
      background: tint("Background", 0.06, 0.09, 0.12),
      ink: tint("Ink", 0.83, 0.78, 0.64),
    },
    fragment: (p) => `
  let position = input.uv * globals.viewport.xy / globals.clock.z;
  let spacing = ${p("spacing")}.x;
  let rise = ${p("rise")}.x;
  let row = floor(position.y / spacing);
  let localPoint = vec2f(fract(position.x / spacing) * spacing, position.y);
  let aa = 1.0 / globals.clock.z;
  let support = ${p("stroke")}.x * 0.5 + aa;
  let archHeight = rise * 0.75;
  let maxRowsBack = i32(clamp(ceil((archHeight + support) / spacing), 0.0, 4.0));
  var nearest = 1.0e6;
  for (var offset = -maxRowsBack; offset <= 1; offset += 1) {
    let baseline = (row + f32(offset)) * spacing;
    if (position.y + support >= baseline && position.y - support <= baseline + archHeight) {
      var prior = vec2f(0.0, baseline);
      for (var segment = 1u; segment <= 24u; segment += 1u) {
        let t = f32(segment) / 24.0;
        let u = 1.0 - t;
        let next = vec2f(
          (3.0 * u * u * t * ${p("shoulder")}.x + 3.0 * u * t * t * (1.0 - ${p("shoulder")}.x) + t * t * t) * spacing,
          baseline + 3.0 * u * t * rise
        );
        let axis = next - prior;
        let fraction = clamp(dot(localPoint - prior, axis) / max(dot(axis, axis), 0.000001), 0.0, 1.0);
        nearest = min(nearest, length(localPoint - (prior + axis * fraction)));
        prior = next;
      }
    }
  }
  let inkWeight = 1.0 - smoothstep(${p("stroke")}.x * 0.5, ${p("stroke")}.x * 0.5 + aa, nearest);
  let backgroundColor = ${p("background")};
  let inkColor = ${p("ink")};
  return mix(vec4f(backgroundColor.rgb * backgroundColor.a, backgroundColor.a), vec4f(inkColor.rgb * inkColor.a, inkColor.a), inkWeight);`,
    looks: [
      [
        "Bookplate arches",
        { spacing: 54, rise: 40, shoulder: 0.38, stroke: 2.4 },
      ],
      ["High vault", { spacing: 88, rise: 72, shoulder: 0.16, stroke: 1.1 }],
    ],
  },
];

export const OWNED_NEXT_SIX_R_DEFINITIONS: readonly EffectDefinition[] =
  OWNED_NEXT_SIX_R_DRAFTS.map((draft) => {
    const base = catalogShader(draft);
    return {
      ...base,
      resources: base.resources?.map((resource) =>
        resource.name === "color"
          ? { ...resource, format: "rgba16float" }
          : resource,
      ),
      provenance: {
        origin: "design-original",
        note: draft.mechanism.slice(0, 240),
      },
    };
  });
export const OWNED_NEXT_SIX_R_PRESETS: readonly EffectPreset[] =
  OWNED_NEXT_SIX_R_DRAFTS.flatMap((draft) =>
    draft.looks.map(([name, params], index) => ({
      id: `an-preset-${draft.id}-${index + 1}`,
      name,
      definitionId: `an-native-${draft.id}`,
      definitionVersion: draft.version ?? 1,
      placement:
        draft.kind === "generator" ? ("fill" as const) : ("layer" as const),
      params,
      clip: "bounds" as const,
      provenance: { origin: "design-original" as const },
    })),
  );
