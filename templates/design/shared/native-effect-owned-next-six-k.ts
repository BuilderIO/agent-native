import {
  CATALOG_EDGE,
  catalogColor,
  catalogFloat,
  catalogPalette,
  catalogShader,
  type CatalogShaderSpec,
} from "./native-effect-catalog-kit";
import type {
  EffectDefinition,
  EffectPreset,
  EffectValue,
} from "./native-effects";

type Look = readonly [string, Record<string, EffectValue>];
type Draft = CatalogShaderSpec & {
  mechanism: string;
  looks: readonly [Look, Look];
};
const unit = (label: string, value: number) => catalogFloat(label, value, 0, 1);
const pixels = (label: string, value: number, max: number) =>
  catalogFloat(label, value, 0, max, 0.25);

export const OWNED_NEXT_SIX_K_DRAFTS: readonly Draft[] = [
  {
    id: "owned-k-koch-boundary",
    name: "Koch Boundary",
    kind: "generator",
    mechanism:
      "A finite geometric replacement of each triangular boundary segment with four thirds, evaluated as nearest distance to the resulting line segments. This is a bounded recursive curve rather than a noise contour.",
    properties: {
      depth: catalogFloat("Subdivision", 3, 0, 3, 1),
      stroke: pixels("Stroke width", 1.5, 12),
      scale: catalogFloat("Scale", 0.65, 0.2, 0.95),
      palette: catalogPalette([
        catalogColor(0.025, 0.045, 0.08),
        catalogColor(0.9, 0.96, 1),
      ]),
    },
    helpers: () => `
fn lineDistance(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let v = b - a;
  return length(p - a - v * clamp(dot(p - a, v) / max(dot(v, v), 0.000001), 0.0, 1.0));
}
fn kochSegment(p: vec2f, a: vec2f, b: vec2f, depth: u32) -> f32 {
  var best = 1000.0;
  let segments = 1u << (2u * depth);
  for (var index = 0u; index < 64u; index += 1u) {
    if (index >= segments) { break; }
    var start = a;
    var end = b;
    for (var level = 0u; level < 3u; level += 1u) {
      if (level >= depth) { break; }
      let digit = (index >> (2u * (depth - 1u - level))) & 3u;
      let one = mix(start, end, 1.0 / 3.0);
      let two = mix(start, end, 2.0 / 3.0);
      let side = two - one;
      let tip = one + vec2f(0.5 * side.x + 0.8660254038 * side.y,
                              -0.8660254038 * side.x + 0.5 * side.y);
      if (digit == 0u) { end = one; }
      else if (digit == 1u) { start = one; end = tip; }
      else if (digit == 2u) { start = tip; end = two; }
      else { start = two; }
    }
    best = min(best, lineDistance(p, start, end));
  }
  return best;
}
`,
    fragment: (p) => `
  let aspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let q = (input.uv - vec2f(0.5)) * vec2f(aspect, 1.0) / ${p("scale")}.x;
  let a = vec2f(0.0, -0.38);
  let b = vec2f(0.32909, 0.19);
  let c = vec2f(-0.32909, 0.19);
  let depth = u32(${p("depth")}.x);
  let d = min(kochSegment(q, a, b, depth), min(kochSegment(q, b, c, depth), kochSegment(q, c, a, depth)));
  let feather = max(globals.clock.z / ${p("scale")}.x / globals.viewport.y, 0.00001);
  let stroke = ${p("stroke")}.x * feather;
  let coverage = 1.0 - smoothstep(stroke - feather, stroke + feather, d);
  return mix(paletteAt(0.0), paletteAt(1.0), coverage);`,
    looks: [
      ["Frost Edge", { depth: 3, stroke: 1.5, scale: 0.72 }],
      ["Architectural Trace", { depth: 2, stroke: 3.5, scale: 0.5 }],
    ],
  },
  {
    id: "owned-k-hilbert-trace",
    name: "Hilbert Trace",
    kind: "generator",
    mechanism:
      "A space-filling Hilbert path is indexed by bitwise cell rotation and inverse index lookup. Each pixel tests only its adjacent path segments, unlike a periodic grid or arbitrary line pattern.",
    properties: {
      order: catalogFloat("Curve order", 4, 2, 4, 1),
      stroke: pixels("Stroke width", 1.25, 10),
      margin: unit("Margin", 0.08),
      palette: catalogPalette([
        catalogColor(0.03, 0.07, 0.11),
        catalogColor(0.98, 0.73, 0.29),
      ]),
    },
    helpers: () => `
fn hilbertRotate(n: u32, point: vec2u, rx: u32, ry: u32) -> vec2u {
  var q = point;
  if (ry == 0u) {
    if (rx == 1u) { q = vec2u(n - 1u - q.x, n - 1u - q.y); }
    q = q.yx;
  }
  return q;
}
fn hilbertIndex(point: vec2u, side: u32) -> u32 {
  var p = point;
  var index = 0u;
  var bit = side / 2u;
  for (var level = 0u; level < 4u; level += 1u) {
    if (bit == 0u) { break; }
    let rx = select(0u, 1u, (p.x & bit) != 0u);
    let ry = select(0u, 1u, (p.y & bit) != 0u);
    index += bit * bit * ((3u * rx) ^ ry);
    p = hilbertRotate(bit, p, rx, ry);
    bit /= 2u;
  }
  return index;
}
fn hilbertPoint(index: u32, side: u32) -> vec2u {
  var t = index;
  var point = vec2u(0u);
  var bit = 1u;
  for (var level = 0u; level < 4u; level += 1u) {
    if (bit >= side) { break; }
    let rx = (t / 2u) & 1u;
    let ry = (t ^ rx) & 1u;
    point = hilbertRotate(bit, point, rx, ry);
    point += bit * vec2u(rx, ry);
    t /= 4u;
    bit *= 2u;
  }
  return point;
}
fn hilbertDistance(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let v = b - a;
  return length(p - a - v * clamp(dot(p - a, v) / max(dot(v, v), 0.000001), 0.0, 1.0));
}
`,
    fragment: (p) => `
  let side = 1u << u32(${p("order")}.x);
  let normalized = (input.uv - vec2f(${p("margin")}.x)) / max(1.0 - 2.0 * ${p("margin")}.x, 0.01);
  if (any(normalized < vec2f(0.0)) || any(normalized > vec2f(1.0))) { return paletteAt(0.0); }
  let q = normalized * f32(side) - vec2f(0.5);
  let cell = vec2u(clamp(floor(q + vec2f(0.5)), vec2f(0.0), vec2f(f32(side - 1u))));
  let index = hilbertIndex(cell, side);
  let count = side * side;
  let a = vec2f(hilbertPoint(index, side));
  let before = vec2f(hilbertPoint(select(index, index - 1u, index > 0u), side));
  let after = vec2f(hilbertPoint(min(index + 1u, count - 1u), side));
  let cellCss = globals.viewport.xy * (1.0 - 2.0 * ${p("margin")}.x) / max(globals.clock.z * f32(side), 1.0);
  let d = min(hilbertDistance(q * cellCss, before * cellCss, a * cellCss),
              hilbertDistance(q * cellCss, a * cellCss, after * cellCss));
  let width = ${p("stroke")}.x;
  return mix(paletteAt(0.0), paletteAt(1.0), 1.0 - smoothstep(width - 1.0, width + 1.0, d));`,
    looks: [
      ["Copper Route", { order: 4, stroke: 1.5, margin: 0.1 }],
      ["Wide Maze", { order: 3, stroke: 3, margin: 0.06 }],
    ],
  },
  {
    id: "owned-k-occluder-penumbra",
    name: "Occluder Penumbra",
    kind: "generator",
    mechanism:
      "A finite 2D soft-shadow ray samples the signed distance to an explicit circular occluder between a point light and each surface pixel. This casts a directional penumbra rather than painting a radial light cone.",
    properties: {
      lightX: unit("Light X", 0.18),
      lightY: unit("Light Y", 0.22),
      obstacleX: unit("Occluder X", 0.5),
      obstacleY: unit("Occluder Y", 0.46),
      radius: unit("Occluder radius", 0.13),
      softness: catalogFloat("Penumbra", 0.085, 0.005, 0.3),
      exposure: catalogFloat("Illumination", 1.5, 0, 3),
      palette: catalogPalette([
        catalogColor(0.035, 0.055, 0.1),
        catalogColor(1, 0.75, 0.35),
      ]),
    },
    fragment: (p) => `
  let aspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let pixel = input.uv * vec2f(aspect, 1.0);
  let lamp = vec2f(${p("lightX")}.x * aspect, ${p("lightY")}.x);
  let circle = vec2f(${p("obstacleX")}.x * aspect, ${p("obstacleY")}.x);
  let ray = pixel - lamp;
  let distance = max(length(ray), 0.00001);
  let direction = ray / distance;
  var visibility = 1.0;
  for (var step = 1u; step <= 12u; step += 1u) {
    let travelled = distance * f32(step) / 13.0;
    let signedDistance = length(lamp + direction * travelled - circle) - ${p("radius")}.x;
    visibility = min(visibility, clamp(signedDistance / max(${p("softness")}.x * travelled, 0.0001), 0.0, 1.0));
  }
  let body = length(pixel - circle) - ${p("radius")}.x;
  visibility *= smoothstep(-0.005, 0.005, body);
  let attenuation = ${p("exposure")}.x / (1.0 + 8.0 * distance * distance);
  return mix(paletteAt(0.0), paletteAt(1.0), clamp(visibility * attenuation, 0.0, 1.0));`,
    looks: [
      [
        "Lantern Shadow",
        { lightX: 0.12, lightY: 0.18, radius: 0.16, softness: 0.07 },
      ],
      [
        "Wide Umbra",
        {
          lightX: 0.35,
          lightY: 0.15,
          obstacleX: 0.57,
          radius: 0.19,
          softness: 0.18,
        },
      ],
    ],
  },
  {
    id: "owned-k-triangle-mesh-warp",
    name: "Triangle Mesh Warp",
    kind: "processor",
    mechanism:
      "Eight output-space triangles form a continuous piecewise-affine mesh. A displaced shared center is inverted to the original center by barycentric coordinates, preserving straight edges across triangle seams.",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      centerX: catalogFloat("Center shift X", 0.12, -0.4, 0.4),
      centerY: catalogFloat("Center shift Y", -0.08, -0.4, 0.4),
      amount: unit("Warp amount", 1),
    },
    helpers: () => `
fn wedgeCross(a: vec2f, b: vec2f) -> f32 { return a.x * b.y - a.y * b.x; }
fn meshSource(q: vec2f, center: vec2f, a: vec2f, b: vec2f) -> vec3f {
  let denominator = wedgeCross(a - center, b - center);
  let u = wedgeCross(q - center, b - center) / denominator;
  let v = wedgeCross(a - center, q - center) / denominator;
  let source = vec2f(0.5) * (1.0 - u - v) + a * u + b * v;
  return vec3f(source, min(u, min(v, 1.0 - u - v)));
}
fn rimPoint(index: u32) -> vec2f {
  switch index {
    case 0u: { return vec2f(0.0, 0.0); }
    case 1u: { return vec2f(0.5, 0.0); }
    case 2u: { return vec2f(1.0, 0.0); }
    case 3u: { return vec2f(1.0, 0.5); }
    case 4u: { return vec2f(1.0, 1.0); }
    case 5u: { return vec2f(0.5, 1.0); }
    case 6u: { return vec2f(0.0, 1.0); }
    default: { return vec2f(0.0, 0.5); }
  }
}
`,
    fragment: (p) => `
  let displacement = vec2f(${p("centerX")}.x, ${p("centerY")}.x) * ${p("amount")}.x;
  if (dot(displacement, displacement) <= 0.00000001) { return sampleSource(input.uv); }
  let center = vec2f(0.5) + displacement;
  var mapped = input.uv;
  for (var index = 0u; index < 8u; index += 1u) {
    let candidate = meshSource(input.uv, center, rimPoint(index), rimPoint((index + 1u) % 8u));
    if (candidate.z >= -0.00001) { mapped = candidate.xy; break; }
  }
  return sampleSource(mapped);`,
    looks: [
      ["Pull Right", { centerX: 0.18, centerY: 0, amount: 1 }],
      ["Corner Drift", { centerX: -0.15, centerY: 0.16, amount: 0.85 }],
    ],
  },
  {
    id: "owned-k-alpha-medial-ridge",
    name: "Alpha Medial Ridge",
    kind: "processor",
    mechanism:
      "A finite nearest-transparent search in eight directions estimates alpha distance, then neighboring distance comparisons retain local medial ridges. It extracts interior structure rather than dilating, eroding, or outlining the boundary.",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      radius: catalogFloat("Search radius", 4, 1, 6, 1),
      threshold: unit("Alpha threshold", 0.5),
      width: catalogFloat("Ridge width", 0.6, 0.05, 2),
      amount: unit("Ridge amount", 1),
    },
    helpers: (p) => `
fn alphaDistance(uv: vec2f) -> f32 {
  let center = sampleSource(uv);
  if (center.a <= ${p("threshold")}.x) { return 0.0; }
  var nearest = ${p("radius")}.x + 1.0;
  let texel = globals.clock.z * globals.viewport.zw;
  for (var step = 1u; step <= 6u; step += 1u) {
    if (f32(step) > ${p("radius")}.x) { break; }
    for (var direction = 0u; direction < 8u; direction += 1u) {
      let angle = f32(direction) * 0.7853981634;
      let delta = vec2f(cos(angle), sin(angle)) * texel * f32(step);
      if (sampleSource(uv + delta).a <= ${p("threshold")}.x) {
        nearest = min(nearest, f32(step));
      }
    }
  }
  return nearest;
}
`,
    fragment: (p) => `
  let original = sampleSource(input.uv);
  if (original.a <= 0.00001 || ${p("amount")}.x <= 0.0) { return original; }
  let center = alphaDistance(input.uv);
  let texel = globals.clock.z * globals.viewport.zw;
  let right = alphaDistance(input.uv + vec2f(texel.x, 0.0));
  let left = alphaDistance(input.uv - vec2f(texel.x, 0.0));
  let down = alphaDistance(input.uv + vec2f(0.0, texel.y));
  let up = alphaDistance(input.uv - vec2f(0.0, texel.y));
  let tallestNeighbor = max(max(right, left), max(down, up));
  let shortestNeighbor = min(min(right, left), min(down, up));
  let ridge = step(tallestNeighbor - 0.001, center) *
    smoothstep(0.0, ${p("width")}.x, center - shortestNeighbor);
  return original * mix(1.0, ridge, ${p("amount")}.x);`,
    looks: [
      ["Fine Medial", { radius: 3, threshold: 0.45, width: 0.3, amount: 1 }],
      ["Broad Skeleton", { radius: 6, threshold: 0.6, width: 1.1, amount: 1 }],
    ],
  },
  {
    id: "owned-k-gamut-shoulder",
    name: "Gamut Shoulder",
    kind: "processor",
    mechanism:
      "Linear-light chroma expansion follows the input hue ray from luminance and approaches the RGB cube boundary through an analytic shoulder. Hue direction and alpha remain fixed, unlike channel clipping or selective color preservation.",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      gain: catalogFloat("Chroma gain", 1.8, 1, 4),
      softness: unit("Shoulder softness", 0.75),
      amount: unit("Amount", 1),
    },
    fragment: (p) => `
  let original = sampleSource(input.uv);
  if (original.a <= 0.00001 || ${p("amount")}.x <= 0.0) { return original; }
  let color = straight(original);
  let grey = luminance(color);
  let chroma = color - vec3f(grey);
  var limit = 1000.0;
  for (var channel = 0u; channel < 3u; channel += 1u) {
    let delta = chroma[channel];
    if (delta > 0.000001) { limit = min(limit, (1.0 - grey) / delta); }
    if (delta < -0.000001) { limit = min(limit, grey / -delta); }
  }
  let target = min(${p("gain")}.x, max(limit, 1.0));
  let span = max(limit - 1.0, 0.000001);
  let soft = 1.0 + span * (1.0 - exp(-(${p("gain")}.x - 1.0) / span));
  let expansion = mix(target, min(soft, limit), ${p("softness")}.x);
  let result = vec3f(grey) + chroma * mix(1.0, expansion, ${p("amount")}.x);
  return premultiply(result, original.a);`,
    looks: [
      ["Soft Saturation", { gain: 1.8, softness: 0.9, amount: 0.75 }],
      ["Vivid Boundary", { gain: 3.2, softness: 0.25, amount: 1 }],
    ],
  },
];

function definitionFor(draft: Draft): EffectDefinition {
  const definition = catalogShader(draft);
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

export const OWNED_NEXT_SIX_K_DEFINITIONS: readonly EffectDefinition[] =
  OWNED_NEXT_SIX_K_DRAFTS.map(definitionFor);
export const OWNED_NEXT_SIX_K_PRESETS: readonly EffectPreset[] =
  OWNED_NEXT_SIX_K_DRAFTS.flatMap((draft) =>
    draft.looks.map(([name, params], index) => ({
      id: `an-preset-${draft.id}-${index + 1}`,
      name,
      definitionId: `an-native-${draft.id}`,
      definitionVersion: 1,
      placement: (draft.kind === "generator" ? "fill" : "layer") as
        | "fill"
        | "layer",
      params,
      clip: "bounds" as const,
      provenance: { origin: "design-original" as const },
    })),
  );
