import {
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
  closest: string;
  cost: string;
  looks: readonly [Look, Look];
};
const distance = (
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
const pigment = (
  label: string,
  r: number,
  g: number,
  b: number,
): EffectProperty => ({
  type: "color",
  label,
  default: catalogColor(r, g, b),
});
const edge = (): EffectProperty => ({
  type: "enum",
  label: "Outside source",
  default: "clamp",
  options: ["transparent", "clamp"],
  advanced: true,
});

export const OWNED_NEXT_TWELVE_S_DRAFTS: readonly Draft[] = [
  {
    id: "owned-s-angular-path-blur",
    name: "Angular Path Blur",
    kind: "processor",
    mechanism:
      "Integrates nine source positions along a circular arc around an authored pivot. Radius-dependent arc motion preserves the center and differs from a uniform directional smear or radial zoom echo.",
    closest: "Directional Smear; Radial Echo; Gaussian Blur",
    cost: "Ten source reads per pixel: nine arc taps and one original.",
    properties: {
      edge: edge(),
      centerX: catalogFloat("Pivot X", 0.5, 0, 1),
      centerY: catalogFloat("Pivot Y", 0.5, 0, 1),
      sweep: catalogFloat("Arc angle", 0.12, 0, 0.8),
      mixAmount: catalogFloat("Blend", 0.9, 0, 1),
    },
    fragment: (p) => `
  let extent = globals.viewport.xy / globals.clock.z;
  let center = vec2f(${p("centerX")}.x, ${p("centerY")}.x) * extent;
  let ray = input.uv * extent - center;
  var integrated = vec4f(0.0);
  for (var tap = 0u; tap < 9u; tap += 1u) {
    let angle = (f32(tap) / 8.0 - 0.5) * ${p("sweep")}.x;
    integrated += sampleSource((center + rotate(ray, angle)) / extent);
  }
  return mix(sampleSource(input.uv), integrated / 9.0, ${p("mixAmount")}.x);`,
    looks: [
      ["Short orbit", { sweep: 0.09, mixAmount: 0.75 }],
      [
        "Swept arc",
        { centerX: 0.36, centerY: 0.62, sweep: 0.42, mixAmount: 1 },
      ],
    ],
  },
  {
    id: "owned-s-parabolic-bend",
    name: "Parabolic Bend",
    kind: "processor",
    mechanism:
      "Inverse-samples a source after a signed quadratic horizontal displacement whose curvature grows with squared distance from an anchor row; straight vertical edges become parabolas without global perspective remapping.",
    closest: "Corner Perspective; Triangle Mesh Warp; Brush Liquify",
    cost: "One source read per pixel.",
    properties: {
      edge: edge(),
      curvature: catalogFloat("Curvature", 0.18, -0.8, 0.8),
      anchor: catalogFloat("Anchor row", 0.5, 0, 1),
      taper: catalogFloat("Lower taper", 0.3, 0, 1),
    },
    fragment: (p) => `
  let dy = input.uv.y - ${p("anchor")}.x;
  let bend = ${p("curvature")}.x * dy * abs(dy) * (1.0 + ${p("taper")}.x * dy);
  return sampleSource(vec2f(input.uv.x - bend, input.uv.y));`,
    looks: [
      ["Page bow", { curvature: 0.22, anchor: 0.5, taper: 0.1 }],
      ["Reverse arch", { curvature: -0.55, anchor: 0.36, taper: 0.7 }],
    ],
  },
  {
    id: "owned-s-sphere-surface-refract",
    name: "Sphere Surface Refract",
    kind: "processor",
    mechanism:
      "Uses a hemispherical normal and Snell-like tangent displacement inside a circular aperture; the boundary fades to an unchanged source, unlike a global polynomial barrel or point pinch warp.",
    closest: "Barrel Distortion; Lens Pinch; Fluted Refraction",
    cost: "Two source reads per pixel, one square root inside the aperture.",
    properties: {
      edge: edge(),
      radius: catalogFloat("Aperture radius", 0.36, 0.08, 0.48),
      refraction: catalogFloat("Refraction", 0.18, -0.45, 0.45),
      centerX: catalogFloat("Center X", 0.5, 0, 1),
      centerY: catalogFloat("Center Y", 0.5, 0, 1),
      feather: catalogFloat("Feather", 0.025, 0.002, 0.12),
    },
    fragment: (p) => `
  let original = sampleSource(input.uv);
  let extent = globals.viewport.xy / globals.clock.z;
  let offset = (input.uv - vec2f(${p("centerX")}.x, ${p("centerY")}.x)) * extent;
  let radius = ${p("radius")}.x * min(extent.x, extent.y);
  let r2 = dot(offset, offset) / (radius * radius);
  if (r2 >= 1.0) { return original; }
  let normalZ = sqrt(max(1.0 - r2, 0.0001));
  let shift = offset * ${p("refraction")}.x * (1.0 / normalZ - 1.0);
  let weight = 1.0 - smoothstep(1.0 - ${p("feather")}.x, 1.0, sqrt(r2));
  return mix(original, sampleSource(input.uv - shift / extent), weight);`,
    looks: [
      ["Glass dome", { radius: 0.38, refraction: 0.18, feather: 0.03 }],
      [
        "Concave lens",
        { radius: 0.27, refraction: -0.3, centerX: 0.62, feather: 0.06 },
      ],
    ],
  },
  {
    id: "owned-s-block-seam-restoration",
    name: "Block Seam Restoration",
    kind: "processor",
    mechanism:
      "Detects discontinuity between adjacent sides of a known compression-block grid and replaces only near-grid pixels with a bounded cross-boundary premultiplied estimate; interiors remain unchanged.",
    closest: "Block Transform; Bilateral Surface; Scanline Gap Repair",
    cost: "Five source reads per pixel near seams; one otherwise.",
    properties: {
      edge: edge(),
      block: distance("Block width", 8, 4, 32),
      reach: distance("Seam reach", 1.5, 0.5, 3),
      threshold: catalogFloat("Jump threshold", 0.08, 0, 0.5),
      strength: catalogFloat("Repair", 0.7, 0, 1),
    },
    fragment: (p) => `
  let center = sampleSource(input.uv);
  let pixel = input.uv * globals.viewport.xy / globals.clock.z;
  let period = ${p("block")}.x;
  let phase = fract(pixel / period) * period;
  let near = min(phase, vec2f(period) - phase);
  let stepUv = globals.viewport.zw * globals.clock.z * ${p("reach")}.x;
  var result = center;
  if (near.x < ${p("reach")}.x) {
    let left = sampleSource(input.uv - vec2f(stepUv.x, 0.0));
    let right = sampleSource(input.uv + vec2f(stepUv.x, 0.0));
    let jump = length(left.rgb - right.rgb) + abs(left.a - right.a);
    let weight = ${p("strength")}.x * smoothstep(${p("threshold")}.x, ${p("threshold")}.x + 0.1, jump);
    result = mix(result, (left + right) * 0.5, weight * 0.5);
  }
  if (near.y < ${p("reach")}.x) {
    let above = sampleSource(input.uv - vec2f(0.0, stepUv.y));
    let below = sampleSource(input.uv + vec2f(0.0, stepUv.y));
    let jump = length(above.rgb - below.rgb) + abs(above.a - below.a);
    let weight = ${p("strength")}.x * smoothstep(${p("threshold")}.x, ${p("threshold")}.x + 0.1, jump);
    result = mix(result, (above + below) * 0.5, weight * 0.5);
  }
  return result;`,
    looks: [
      ["Fine blocks", { block: 8, reach: 1, threshold: 0.05, strength: 0.95 }],
      [
        "Coarse blocks",
        { block: 16, reach: 2.5, threshold: 0.12, strength: 0.9 },
      ],
    ],
  },
  {
    id: "owned-s-chalk-transfer",
    name: "Chalk Transfer",
    kind: "processor",
    edgeSampling: "fixed-clamp",
    mechanism:
      "Deposits directional chalk pigment only where a source already has alpha, using luminance and coordinate-hashed short stroke coverage; it changes surface deposition, not simply additive film grain.",
    closest: "Film Grain; Pointillist Brush; Crosshatch",
    cost: "One source read and one deterministic integer cell hash per pixel.",
    properties: {
      spacing: distance("Grain spacing", 3, 1, 10),
      pressure: catalogFloat("Pressure", 0.5, 0, 1),
      slant: catalogFloat("Stroke slant", 0.24, -0.8, 0.8),
      chalk: pigment("Pigment", 0.92, 0.89, 0.75),
    },
    helpers: () => `
fn sStraightExact(color: vec4f) -> vec3f {
  if (color.a <= 0.0) { return vec3f(0.0); }
  return color.rgb / color.a;
}`,
    fragment: (p) => `
  let source = sampleSource(input.uv);
  let point = input.uv * globals.viewport.xy / globals.clock.z;
  let shear = vec2f(point.x + point.y * ${p("slant")}.x, point.y);
  let cell = vec2i(floor(shear / ${p("spacing")}.x));
  let local = fract(shear / ${p("spacing")}.x);
  let chance = random(cell);
  let stroke = 1.0 - smoothstep(0.1, 0.28, abs(local.y - 0.5 + (chance - 0.5) * 0.35));
  let deposit = stroke * ${p("pressure")}.x * clamp(1.0 - luminance(sStraightExact(source)), 0.0, 1.0) * source.a;
  let chalkColor = ${p("chalk")};
  return vec4f(mix(source.rgb, chalkColor.rgb * source.a, deposit * chalkColor.a), source.a);`,
    looks: [
      ["Soft graphite", { spacing: 2.5, pressure: 0.35, slant: 0.15 }],
      [
        "Heavy pastel",
        {
          spacing: 5,
          pressure: 0.85,
          slant: -0.38,
          chalk: catalogColor(0.95, 0.55, 0.35),
        },
      ],
    ],
  },
  {
    id: "owned-s-haar-shrink",
    name: "Haar Detail Shrink",
    kind: "processor",
    mechanism:
      "Applies a true 2×2 physical-texel Haar transform, soft-thresholds its horizontal, vertical and diagonal detail coefficients, and reconstructs with the untouched lowpass coefficient. Source alpha remains premultiplied.",
    closest: "Haar Band Remix; Gaussian Blur; Guided Local Regression",
    cost: "Four source reads per pixel with fixed 2×2 support.",
    properties: {
      edge: edge(),
      threshold: catalogFloat("Detail threshold", 0.06, 0, 0.3),
      strength: catalogFloat("Shrink", 0.8, 0, 1),
    },
    fragment: (p) => `
  let pixel = vec2i(floor(input.uv * globals.viewport.xy));
  let origin = vec2i(floor(vec2f(pixel) * 0.5)) * 2;
  let a = sampleSource((vec2f(origin) + vec2f(0.5, 0.5)) * globals.viewport.zw);
  let b = sampleSource((vec2f(origin) + vec2f(1.5, 0.5)) * globals.viewport.zw);
  let c = sampleSource((vec2f(origin) + vec2f(0.5, 1.5)) * globals.viewport.zw);
  let d = sampleSource((vec2f(origin) + vec2f(1.5, 1.5)) * globals.viewport.zw);
  let low = (a + b + c + d) * 0.25;
  let horizontal = (a - b + c - d) * 0.25;
  let vertical = (a + b - c - d) * 0.25;
  let diagonal = (a - b - c + d) * 0.25;
  let sh = sign(horizontal) * max(abs(horizontal) - vec4f(${p("threshold")}.x), vec4f(0.0));
  let sv = sign(vertical) * max(abs(vertical) - vec4f(${p("threshold")}.x), vec4f(0.0));
  let sd = sign(diagonal) * max(abs(diagonal) - vec4f(${p("threshold")}.x), vec4f(0.0));
  let local = pixel - origin;
  var original = a;
  var rebuilt = low + sh + sv + sd;
  if (local.x == 1 && local.y == 0) { original = b; rebuilt = low - sh + sv - sd; }
  if (local.x == 0 && local.y == 1) { original = c; rebuilt = low + sh - sv - sd; }
  if (local.x == 1 && local.y == 1) { original = d; rebuilt = low - sh - sv + sd; }
  let output = mix(original, rebuilt, ${p("strength")}.x);
  let alpha = clamp(output.a, 0.0, 1.0);
  return vec4f(clamp(output.rgb, vec3f(0.0), vec3f(alpha)), alpha);`,
    looks: [
      ["Fine coefficients", { threshold: 0.035, strength: 0.55 }],
      ["Strong cleanup", { threshold: 0.15, strength: 1 }],
    ],
  },
  {
    id: "owned-s-triangular-beam-lattice",
    name: "Triangular Beam Lattice",
    kind: "generator",
    mechanism:
      "Intersects three 60-degree line families into equilateral triangular faces with explicit vertex joints and independent beam width; not a rectangular or perspective grid recolor.",
    closest: "Perspective Floor Grid; Triangular Lacunae; Hex Tiles",
    cost: "Three analytic line-family distances and one joint test per pixel.",
    properties: {
      pitch: distance("Pitch", 48, 16, 120),
      stroke: distance("Beam", 2, 0.5, 12),
      joint: distance("Joint radius", 3, 0, 15),
      beam: pigment("Beam", 0.8, 0.72, 0.54),
      ground: pigment("Ground", 0.07, 0.12, 0.16),
    },
    helpers: () => `
fn triJointDistance(delta: vec2f) -> f32 {
  return length(vec2f(delta.x, (delta.y - 0.5 * delta.x) / 0.8660254));
}`,
    fragment: (p) => `
  let point = input.uv * globals.viewport.xy / globals.clock.z;
  let pitch = ${p("pitch")}.x;
  let a = point.x / pitch;
  let b = (0.5 * point.x + 0.8660254 * point.y) / pitch;
  let c = b - a;
  let distanceLine = min(abs(fract(a + 0.5) - 0.5), min(abs(fract(b + 0.5) - 0.5), abs(fract(c + 0.5) - 0.5))) * pitch;
  let localA = fract(a); let localB = fract(b);
  let v00 = triJointDistance(vec2f(localA, localB));
  let v10 = triJointDistance(vec2f(localA - 1.0, localB));
  let v01 = triJointDistance(vec2f(localA, localB - 1.0));
  let v11 = triJointDistance(vec2f(localA - 1.0, localB - 1.0));
  let vertex = min(min(v00, v10), min(v01, v11)) * pitch;
  let coverage = 1.0 - smoothstep(${p("stroke")}.x * 0.5, ${p("stroke")}.x * 0.5 + 1.0 / globals.clock.z, min(distanceLine, vertex - ${p("joint")}.x));
  let foreground = ${p("beam")}; let background = ${p("ground")};
  return mix(vec4f(background.rgb * background.a, background.a), vec4f(foreground.rgb * foreground.a, foreground.a), coverage);`,
    looks: [
      ["Fine truss", { pitch: 42, stroke: 1.5, joint: 2 }],
      ["Heavy joints", { pitch: 78, stroke: 5, joint: 9 }],
    ],
  },
  {
    id: "owned-s-chevron-interlock",
    name: "Chevron Interlock",
    kind: "generator",
    mechanism:
      "Creates alternating connected V-shaped bands with staggered rows and an explicit crossing seam; the V-junction topology differs from parallel stripes, masonry bonds, and woven warp/weft.",
    closest: "Masonry Bond; Woven Fabric; Ikat Warp",
    cost: "One periodic V-distance and a row-parity branch per pixel.",
    properties: {
      width: distance("Chevron width", 58, 18, 150),
      height: distance("Chevron rise", 36, 12, 100),
      band: distance("Band", 8, 2, 28),
      seam: distance("Seam", 1.5, 0, 6),
      thread: pigment("Thread", 0.73, 0.32, 0.18),
      ground: pigment("Ground", 0.08, 0.11, 0.15),
    },
    fragment: (p) => `
  let point = input.uv * globals.viewport.xy / globals.clock.z;
  let row = floor(point.y / ${p("height")}.x);
  let x = fract(point.x / ${p("width")}.x + 0.5 * (row - 2.0 * floor(row * 0.5)));
  let y = fract(point.y / ${p("height")}.x);
  let ridge = abs(x - 0.5) * 2.0;
  let signedDistance = abs((y - ridge) * ${p("height")}.x);
  let body = 1.0 - smoothstep(${p("band")}.x * 0.5, ${p("band")}.x * 0.5 + 1.0 / globals.clock.z, signedDistance);
  let gap = smoothstep(${p("seam")}.x, ${p("seam")}.x + 1.0 / globals.clock.z, abs(x - 0.5) * ${p("width")}.x);
  let coverage = body * gap;
  let foreground = ${p("thread")}; let background = ${p("ground")};
  return mix(vec4f(background.rgb * background.a, background.a), vec4f(foreground.rgb * foreground.a, foreground.a), coverage);`,
    looks: [
      ["Narrow chevrons", { width: 44, height: 24, band: 5, seam: 1 }],
      ["Broad joinery", { width: 88, height: 54, band: 14, seam: 3 }],
    ],
  },
  {
    id: "owned-s-power-cell-relief",
    name: "Power Cell Relief",
    kind: "generator",
    mechanism:
      "Partitions a jittered lattice by additive weighted squared distance and shades the nearest-vs-second-nearest power margin. Site weight changes cell ownership, not only a Voronoi edge color.",
    closest: "Voronoi Cells; Crystal Lattice; Octagon Square Tiling",
    cost: "Fixed 25-site weighted distance comparisons per pixel.",
    properties: {
      cell: distance("Cell scale", 58, 20, 140),
      jitter: catalogFloat("Site offset", 0.32, 0, 0.45),
      weight: catalogFloat("Power contrast", 0.28, 0, 0.7),
      edgeWidth: distance("Boundary", 2, 0.5, 9),
      face: pigment("Face", 0.29, 0.54, 0.59),
      boundary: pigment("Boundary", 0.06, 0.12, 0.17),
    },
    fragment: (p) => `
  let point = input.uv * globals.viewport.xy / (${p("cell")}.x * globals.clock.z);
  let cell = vec2i(floor(point));
  var first = 1.0e6; var second = 1.0e6;
  var siteTone = 0.0;
  for (var yy = -2; yy <= 2; yy += 1) {
    for (var xx = -2; xx <= 2; xx += 1) {
      let siteId = cell + vec2i(xx, yy);
      let offset = vec2f(random(siteId), random(siteId + vec2i(71, 19)));
      let site = vec2f(siteId) + 0.5 + (offset - 0.5) * ${p("jitter")}.x * 2.0;
      let radiusWeight = (random(siteId + vec2i(13, 97)) - 0.5) * ${p("weight")}.x;
      let power = dot(point - site, point - site) - radiusWeight;
      if (power < first) { second = first; first = power; siteTone = offset.x; }
      else if (power < second) { second = power; }
    }
  }
  let margin = max(second - first, 0.0) * ${p("cell")}.x;
  let faceColor = ${p("face")}; let edgeColor = ${p("boundary")};
  let shade = 0.7 + 0.3 * siteTone;
  let core = vec4f(faceColor.rgb * faceColor.a * shade, faceColor.a);
  let rim = vec4f(edgeColor.rgb * edgeColor.a, edgeColor.a);
  return mix(rim, core, smoothstep(0.0, ${p("edgeWidth")}.x, margin));`,
    looks: [
      ["Even mineral", { cell: 52, jitter: 0.1, weight: 0.12, edgeWidth: 1.5 }],
      [
        "Weighted plates",
        { cell: 92, jitter: 0.42, weight: 0.6, edgeWidth: 5 },
      ],
    ],
  },
  {
    id: "owned-s-catenary-cables",
    name: "Catenary Cables",
    kind: "generator",
    mechanism:
      "Draws suspended curves from the catenary cosh profile between equal-height anchors, with an independent gravity sag parameter; this is not a Bezier arch or linear hatch with renamed spacing.",
    closest: "Bezier Hatch; Braided Ribbons; Wire Dome",
    cost: "One bounded exponential catenary profile and periodic cable distance per pixel.",
    properties: {
      span: distance("Anchor span", 90, 28, 180),
      sag: distance("Sag", 18, 3, 60),
      vertical: distance("Row spacing", 72, 24, 150),
      cable: distance("Cable thickness", 2, 0.5, 9),
      wire: pigment("Cable", 0.81, 0.75, 0.6),
      ground: pigment("Ground", 0.04, 0.08, 0.12),
    },
    fragment: (p) => `
  let point = input.uv * globals.viewport.xy / globals.clock.z;
  let span = ${p("span")}.x;
  let localX = fract(point.x / span) * span;
  let u = (localX / span - 0.5) * 2.0;
  let upper = 0.5 * (exp(u * 1.2) + exp(-u * 1.2));
  let denominator = 0.5 * (exp(1.2) + exp(-1.2)) - 1.0;
  let profile = (upper - 1.0) / denominator;
  let rowY = fract(point.y / ${p("vertical")}.x) * ${p("vertical")}.x;
  let cableY = ${p("sag")}.x * (1.0 - profile);
  let delta = abs(fract((rowY - cableY) / ${p("vertical")}.x + 0.5) - 0.5) * ${p("vertical")}.x;
  let coverage = 1.0 - smoothstep(${p("cable")}.x * 0.5, ${p("cable")}.x * 0.5 + 1.0 / globals.clock.z, delta);
  let foreground = ${p("wire")}; let background = ${p("ground")};
  return mix(vec4f(background.rgb * background.a, background.a), vec4f(foreground.rgb * foreground.a, foreground.a), coverage);`,
    looks: [
      ["Slack suspension", { span: 88, sag: 28, vertical: 76, cable: 2 }],
      ["Taut lattice", { span: 52, sag: 6, vertical: 40, cable: 1.2 }],
    ],
  },
  {
    id: "owned-s-limacon-contours",
    name: "Limaçon Contours",
    kind: "generator",
    mechanism:
      "Traces the polar curve r=a+b cos(theta) by a fixed 64-segment nearest-edge search. An inner loop appears only when b>a; it is distinct from Superformula silhouettes and Cassini implicit products.",
    closest: "Superformula Bloom; Cassini Field Atlas; Hypotrochoid Ink",
    cost: "64 line-segment distance evaluations per pixel; performance gate required.",
    properties: {
      baseRadius: distance("Base radius", 64, 20, 140),
      loop: catalogFloat("Loop ratio", 0.72, 0, 1.6),
      stroke: distance("Stroke", 2.5, 0.5, 9),
      ink: pigment("Contour", 0.92, 0.58, 0.22),
      ground: pigment("Ground", 0.05, 0.08, 0.11),
    },
    fragment: (p) => `
  let point = (input.uv - vec2f(0.5)) * globals.viewport.xy / globals.clock.z;
  let base = ${p("baseRadius")}.x;
  var previous = vec2f((1.0 + ${p("loop")}.x) * base, 0.0);
  var nearest = 1.0e6;
  for (var segment = 1u; segment <= 64u; segment += 1u) {
    let angle = TAU * f32(segment) / 64.0;
    let radius = base * (1.0 + ${p("loop")}.x * cos(angle));
    let next = vec2f(cos(angle), sin(angle)) * radius;
    let side = next - previous;
    let fraction = clamp(dot(point - previous, side) / max(dot(side, side), 0.00001), 0.0, 1.0);
    nearest = min(nearest, length(point - (previous + side * fraction)));
    previous = next;
  }
  let coverage = 1.0 - smoothstep(${p("stroke")}.x * 0.5, ${p("stroke")}.x * 0.5 + 1.0 / globals.clock.z, nearest);
  let foreground = ${p("ink")}; let background = ${p("ground")};
  return mix(vec4f(background.rgb * background.a, background.a), vec4f(foreground.rgb * foreground.a, foreground.a), coverage);`,
    looks: [
      ["Dimpled oval", { baseRadius: 62, loop: 0.45, stroke: 3 }],
      ["Inner loop", { baseRadius: 72, loop: 1.3, stroke: 2 }],
    ],
  },
  {
    id: "owned-s-rain-plume-field",
    name: "Rain Plume Field",
    kind: "generator",
    mechanism:
      "Renders finite slanted rain filaments from sparse seeded cells, each with a distinct length and lateral drift; a finite segment distance and depth attenuation distinguish it from infinite stripes, dust particles, and snow noise.",
    closest: "Snow Squall; Dust Storm; Sashiko Stitches",
    cost: "At most fifteen neighboring segment-distance checks per pixel.",
    properties: {
      cell: distance("Drop spacing", 26, 24, 70),
      length: distance("Length", 38, 8, 72),
      slant: catalogFloat("Wind", 0.28, -0.5, 0.5),
      width: distance("Filament", 1.2, 0.4, 5),
      density: catalogFloat("Density", 0.72, 0.1, 1),
      rain: pigment("Rain", 0.63, 0.79, 0.92),
      ground: pigment("Atmosphere", 0.04, 0.09, 0.15),
    },
    fragment: (p) => `
  let point = input.uv * globals.viewport.xy / globals.clock.z;
  let cellSize = ${p("cell")}.x;
  let rowHeight = cellSize + ${p("length")}.x;
  let cell = vec2i(floor(vec2f(point.x / cellSize, point.y / rowHeight)));
  var nearest = 1.0e6;
  var depth = 0.0;
  for (var yy = -1; yy <= 1; yy += 1) {
    for (var xx = -2; xx <= 2; xx += 1) {
      let id = cell + vec2i(xx, yy);
      let chance = random(id);
      if (chance < ${p("density")}.x) {
        let anchor = vec2f((f32(id.x) + random(id + vec2i(19, 37))) * cellSize, (f32(id.y) + random(id + vec2i(53, 11))) * rowHeight);
        let span = ${p("length")}.x * (0.35 + 0.65 * random(id + vec2i(79, 29)));
        let axis = vec2f(${p("slant")}.x * span, span);
        let fraction = clamp(dot(point - anchor, axis) / max(dot(axis, axis), 0.00001), 0.0, 1.0);
        let d = length(point - (anchor + axis * fraction));
        if (d < nearest) { nearest = d; depth = 0.4 + 0.6 * chance; }
      }
    }
  }
  let coverage = (1.0 - smoothstep(${p("width")}.x * 0.5, ${p("width")}.x * 0.5 + 1.0 / globals.clock.z, nearest)) * depth;
  let foreground = ${p("rain")}; let background = ${p("ground")};
  return mix(vec4f(background.rgb * background.a, background.a), vec4f(foreground.rgb * foreground.a, foreground.a), coverage);`,
    looks: [
      [
        "Fine shower",
        { cell: 24, length: 32, slant: 0.13, width: 0.8, density: 0.8 },
      ],
      [
        "Wind streaks",
        { cell: 38, length: 68, slant: 0.5, width: 2, density: 0.55 },
      ],
    ],
  },
];

export const OWNED_NEXT_TWELVE_S_DEFINITIONS: readonly EffectDefinition[] =
  OWNED_NEXT_TWELVE_S_DRAFTS.map((draft) => {
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

export const OWNED_NEXT_TWELVE_S_PRESETS: readonly EffectPreset[] =
  OWNED_NEXT_TWELVE_S_DRAFTS.flatMap((draft) =>
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
