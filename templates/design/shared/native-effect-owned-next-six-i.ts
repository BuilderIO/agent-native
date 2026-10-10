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
type Draft = Omit<CatalogShaderSpec, "kind"> & {
  mechanism: string;
  looks: readonly [Look, Look];
};
const pixel = (label: string, value: number, max: number): EffectProperty => ({
  type: "float",
  label,
  default: value,
  min: 0,
  max,
  step: 0.1,
  unit: "px",
});
const fraction = (label: string, value: number) =>
  catalogFloat(label, value, 0, 1);

export const OWNED_NEXT_SIX_I_DRAFTS: readonly Draft[] = [
  {
    id: "owned-i-structure-orientation",
    name: "Structure Orientation",
    mechanism:
      "A local 3×3 structure tensor estimates dominant gradient direction and coherence, coloring directional flow rather than edge magnitude.",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      radius: pixel("Analysis radius", 2, 10),
      coherenceFloor: fraction("Coherence floor", 0.15),
      strength: fraction("Direction color", 0.8),
    },
    helpers: () => `fn tensorTone(uv: vec2f) -> f32 {
  let pixel = sampleSource(uv);
  return luminance(straight(pixel)) * pixel.a;
}
`,
    fragment: (p) => `
  let original = sampleSource(input.uv);
  if (original.a <= 0.00001 || ${p("radius")}.x <= 0.0 || ${p("strength")}.x <= 0.0) { return original; }
  let d = ${p("radius")}.x * globals.clock.z * globals.viewport.zw;
  let a = tensorTone(input.uv + vec2f(-d.x, -d.y));
  let b = tensorTone(input.uv + vec2f(0.0, -d.y));
  let c = tensorTone(input.uv + vec2f(d.x, -d.y));
  let d0 = tensorTone(input.uv + vec2f(-d.x, 0.0));
  let e = tensorTone(input.uv);
  let f = tensorTone(input.uv + vec2f(d.x, 0.0));
  let g = tensorTone(input.uv + vec2f(-d.x, d.y));
  let h = tensorTone(input.uv + vec2f(0.0, d.y));
  let i = tensorTone(input.uv + vec2f(d.x, d.y));
  let gx = vec4f(b-a+e-d0, c-b+f-e, e-d0+h-g, f-e+i-h) * 0.5;
  let gy = vec4f(d0-a+e-b, e-b+f-c, g-d0+h-e, h-e+i-f) * 0.5;
  let xx = dot(gx, gx);
  let xy = dot(gx, gy);
  let yy = dot(gy, gy);
  let energy = xx + yy;
  if (energy <= 0.000001) { return original; }
  let coherence = length(vec2f(xx - yy, 2.0 * xy)) / energy;
  let direction = 0.5 * atan2(2.0 * xy, xx - yy);
  let phase = vec3f(0.0, 2.0943951, 4.1887902);
  let tint = vec3f(0.5) + 0.5 * cos(vec3f(2.0 * direction) + phase);
  let floor = ${p("coherenceFloor")}.x;
  let gain = ${p("strength")}.x * clamp((coherence - floor) / max(1.0 - floor, 0.00001), 0.0, 1.0);
  return premultiply(mix(straight(original), tint, gain), original.a);`,
    looks: [
      ["Fine Direction", { radius: 1.5, coherenceFloor: 0.24, strength: 0.7 }],
      ["Flow Strands", { radius: 4.5, coherenceFloor: 0.08, strength: 1 }],
    ],
  },
  {
    id: "owned-i-local-entropy",
    name: "Local Entropy",
    mechanism:
      "A bounded 4×4 luminance histogram measures eight-bin Shannon entropy, independently distinguishing orderly and varied image regions.",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      radius: pixel("Sample spacing", 3, 12),
      lowColor: {
        type: "color",
        label: "Quiet tint",
        default: catalogColor(0.12, 0.3, 0.57),
      },
      highColor: {
        type: "color",
        label: "Varied tint",
        default: catalogColor(0.98, 0.61, 0.2),
      },
      contrast: catalogFloat("Entropy contrast", 1.4, 0.25, 4),
      amount: fraction("Tint amount", 0.85),
    },
    fragment: (p) => `
  let original = sampleSource(input.uv);
  if (original.a <= 0.00001 || ${p("amount")}.x <= 0.0) { return original; }
  let stepUv = ${p("radius")}.x * globals.clock.z * globals.viewport.zw;
  var bins: array<f32, 8>;
  var count = 0.0;
  for (var row = 0; row < 4; row += 1) {
    for (var col = 0; col < 4; col += 1) {
      let offset = vec2f(f32(col) - 1.5, f32(row) - 1.5) * stepUv;
      let sample = sampleSource(input.uv + offset);
      if (sample.a > 0.00001) {
        let tone = clamp(luminance(straight(sample)), 0.0, 0.999999);
        let index = min(u32(floor(tone * 8.0)), 7u);
        bins[index] += 1.0; count += 1.0;
      }
    }
  }
  if (count <= 0.0) { return original; }
  var entropy = 0.0;
  for (var i = 0u; i < 8u; i += 1u) {
    if (bins[i] > 0.0) { let probability = bins[i] / count; entropy -= probability * log2(probability) / 3.0; }
  }
  let level = clamp((entropy - 0.5) * ${p("contrast")}.x + 0.5, 0.0, 1.0);
  let tint = mix(${p("lowColor")}.rgb, ${p("highColor")}.rgb, level);
  let tintAlpha = mix(${p("lowColor")}.a, ${p("highColor")}.a, level);
  return premultiply(mix(straight(original), tint, ${p("amount")}.x * tintAlpha), original.a);`,
    looks: [
      ["Order Map", { radius: 2, contrast: 1.1, amount: 0.7 }],
      ["Texture Heat", { radius: 6, contrast: 2.2, amount: 1 }],
    ],
  },
  {
    id: "owned-i-height-parallax",
    name: "Luminance Parallax",
    mechanism:
      "Eight bounded reverse ray steps intersect source luminance as a height field, shifting texture by view direction and depth rather than embossing a fixed normal.",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      depth: pixel("Parallax depth", 12, 64),
      azimuth: catalogFloat("View azimuth", 35, -180, 180, 1),
      elevation: catalogFloat("View elevation", 45, 10, 80, 1),
      shade: fraction("Relief shading", 0.35),
      amount: fraction("Parallax amount", 0.9),
    },
    fragment: (p) => `
  let original = sampleSource(input.uv);
  if (${p("depth")}.x <= 0.0 || ${p("amount")}.x <= 0.0) { return original; }
  let angle = ${p("azimuth")}.x * PI / 180.0;
  let elevation = ${p("elevation")}.x * PI / 180.0;
  let view = vec2f(cos(angle), sin(angle)) * ${p("depth")}.x * cos(elevation) * globals.clock.z * globals.viewport.zw;
  var hit = original;
  var hitUv = input.uv;
  for (var step = 0; step < 8; step += 1) {
    let layer = 1.0 - f32(step) / 8.0;
    let candidateUv = input.uv + view * layer;
    let candidate = sampleSource(candidateUv);
    if (candidate.a > 0.00001 && luminance(straight(candidate)) >= layer) { hit = candidate; hitUv = candidateUv; break; }
  }
  let delta = globals.clock.z * globals.viewport.zw;
  let xl = sampleSource(hitUv - vec2f(delta.x, 0.0));
  let xr = sampleSource(hitUv + vec2f(delta.x, 0.0));
  let yu = sampleSource(hitUv - vec2f(0.0, delta.y));
  let yd = sampleSource(hitUv + vec2f(0.0, delta.y));
  let dx = luminance(straight(xr)) * xr.a - luminance(straight(xl)) * xl.a;
  let dy = luminance(straight(yd)) * yd.a - luminance(straight(yu)) * yu.a;
  let directionalShade = clamp(1.0 - ${p("shade")}.x * dot(vec2f(dx, dy), vec2f(cos(angle), sin(angle))), 0.3, 1.5);
  let lifted = premultiply(straight(hit) * directionalShade, hit.a);
  return mix(original, lifted, ${p("amount")}.x);`,
    looks: [
      [
        "Low Relief",
        { depth: 8, azimuth: 25, elevation: 65, shade: 0.2, amount: 0.7 },
      ],
      [
        "Angled Terrain",
        { depth: 35, azimuth: -70, elevation: 28, shade: 0.75, amount: 1 },
      ],
    ],
  },
  {
    id: "owned-i-photo-sphere",
    name: "Photo Sphere",
    mechanism:
      "A circular normal field maps an equirectangular source photograph onto a lit sphere; source image longitude, latitude, and limb are all explicit.",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      radius: pixel("Sphere radius", 160, 500),
      longitude: catalogFloat("Longitude", 0, -180, 180, 1),
      lightAzimuth: catalogFloat("Light azimuth", -35, -180, 180, 1),
      ambient: fraction("Ambient light", 0.28),
      amount: fraction("Sphere amount", 1),
    },
    fragment: (p) => `
  let original = sampleSource(input.uv);
  let radius = ${p("radius")}.x * globals.clock.z;
  if (radius <= 0.0 || ${p("amount")}.x <= 0.0) { return original; }
  let q = (input.uv - vec2f(0.5)) * globals.viewport.xy / radius;
  let distanceSquared = dot(q, q);
  if (distanceSquared >= 1.0) { return original; }
  let normal = normalize(vec3f(q, sqrt(max(1.0 - distanceSquared, 0.0))));
  let longitude = atan2(normal.x, normal.z) / TAU + 0.5 + ${p("longitude")}.x / 360.0;
  let latitude = asin(clamp(normal.y, -1.0, 1.0)) / PI + 0.5;
  let mapped = sampleSource(vec2f(fract(longitude), latitude));
  let lightAngle = ${p("lightAzimuth")}.x * PI / 180.0;
  let light = normalize(vec3f(sin(lightAngle), -0.35, cos(lightAngle)));
  let illumination = ${p("ambient")}.x + (1.0 - ${p("ambient")}.x) * max(dot(normal, light), 0.0);
  let feather = clamp((1.0 - sqrt(distanceSquared)) * radius, 0.0, 1.0);
  return mix(original, vec4f(mapped.rgb * illumination, mapped.a), feather * ${p("amount")}.x);`,
    looks: [
      [
        "Day Hemisphere",
        { radius: 170, longitude: 0, lightAzimuth: -30, ambient: 0.35 },
      ],
      [
        "Dusk Rotation",
        { radius: 230, longitude: 95, lightAzimuth: 80, ambient: 0.12 },
      ],
    ],
  },
  {
    id: "owned-i-triangle-facets",
    name: "Triangle Facets",
    mechanism:
      "A regular two-triangle cell lattice samples source at each triangle centroid, with separately controlled shared seam paint; it is not Voronoi or Delaunay tessellation.",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      tileSize: pixel("Triangle tile", 28, 120),
      rotation: catalogFloat("Lattice rotation", 0, -180, 180, 1),
      seam: pixel("Seam width", 1, 8),
      grout: {
        type: "color",
        label: "Seam color",
        default: catalogColor(0.08, 0.13, 0.18, 0.8),
      },
      amount: fraction("Facet amount", 0.9),
    },
    fragment: (p) => `
  let original = sampleSource(input.uv);
  let tile = max(${p("tileSize")}.x * globals.clock.z, 1.0);
  if (${p("amount")}.x <= 0.0) { return original; }
  let angle = ${p("rotation")}.x * PI / 180.0;
  let centered = input.uv * globals.viewport.xy - globals.viewport.xy * 0.5;
  let lattice = rotate(centered / tile, angle);
  let cell = floor(lattice);
  let local = fract(lattice);
  let upper = local.x + local.y >= 1.0;
  var centroidOffset = vec2f(1.0 / 3.0);
  if (upper) { centroidOffset = vec2f(2.0 / 3.0); }
  let centroid = cell + centroidOffset;
  let sourceUv = (rotate(centroid * tile, -angle) + globals.viewport.xy * 0.5) * globals.viewport.zw;
  let facet = sampleSource(sourceUv);
  let diagonal = abs(1.0 - local.x - local.y) * 0.70710678;
  let boundary = select(min(local.x, local.y), min(1.0 - local.x, 1.0 - local.y), upper);
  let seamDistance = min(boundary, diagonal);
  let seamWidth = ${p("seam")}.x * globals.clock.z / tile;
  let edgeCoverage = 1.0 - smoothstep(0.0, max(seamWidth, 0.00001), seamDistance);
  let tintWeight = ${p("grout")}.a * edgeCoverage;
  let painted = premultiply(mix(straight(facet), ${p("grout")}.rgb, tintWeight), facet.a);
  return mix(original, painted, ${p("amount")}.x);`,
    looks: [
      ["Fine Shards", { tileSize: 16, rotation: 0, seam: 0.5, amount: 0.85 }],
      ["Broad Tesserae", { tileSize: 58, rotation: 26, seam: 2, amount: 1 }],
    ],
  },
  {
    id: "owned-i-four-plate-overprint",
    name: "Four-Plate Overprint",
    mechanism:
      "Four independently angled CMYK coverage screens attenuate linear source reflectance with a bounded subtractive product, unlike a single-ink halftone.",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      cellSize: pixel("Screen cell", 9, 35),
      spread: fraction("Ink spread", 0.62),
      registration: pixel("Plate offset", 1.5, 8),
      blackGeneration: fraction("Black generation", 0.72),
      amount: fraction("Overprint amount", 0.9),
    },
    helpers: () => `
fn plateScreen(position: vec2f, angle: f32, cellSize: f32, threshold: f32) -> f32 {
  let cell = fract(rotate(position, angle) / cellSize) - vec2f(0.5);
  let radius = length(cell) * 1.41421356;
  return 1.0 - smoothstep(threshold - 0.07, threshold + 0.07, radius);
}
`,
    fragment: (p) => `
  let original = sampleSource(input.uv);
  if (original.a <= 0.00001 || ${p("amount")}.x <= 0.0) { return original; }
  let rgb = clamp(straight(original), vec3f(0.0), vec3f(1.0));
  let raw = vec3f(1.0) - rgb;
  let black = min(raw.x, min(raw.y, raw.z)) * ${p("blackGeneration")}.x;
  let process = clamp(raw - vec3f(black), vec3f(0.0), vec3f(1.0));
  let position = input.uv * globals.viewport.xy / max(globals.clock.z, 0.01);
  let cell = max(${p("cellSize")}.x, 0.1);
  let shift = ${p("registration")}.x;
  let spread = ${p("spread")}.x;
  let cyan = process.x * plateScreen(position + vec2f(-shift, 0.0), 0.2617994, cell, sqrt(process.x) * spread);
  let magenta = process.y * plateScreen(position + vec2f(shift, 0.0), 1.3089969, cell, sqrt(process.y) * spread);
  let yellow = process.z * plateScreen(position + vec2f(0.0, shift), 0.0, cell, sqrt(process.z) * spread);
  let key = black * plateScreen(position, 0.7853982, cell, sqrt(black) * spread);
  let reflectance = vec3f((1.0 - cyan) * (1.0 - key), (1.0 - magenta) * (1.0 - key), (1.0 - yellow) * (1.0 - key));
  return premultiply(mix(rgb, reflectance, ${p("amount")}.x), original.a);`,
    looks: [
      [
        "Fine Process",
        { cellSize: 6, spread: 0.55, registration: 0.5, blackGeneration: 0.62 },
      ],
      [
        "Offset Newspaper",
        {
          cellSize: 18,
          spread: 0.8,
          registration: 3,
          blackGeneration: 0.9,
          amount: 1,
        },
      ],
    ],
  },
];

const definitionFor = (draft: Draft): EffectDefinition => {
  const definition = catalogShader({
    ...draft,
    kind: "processor",
    backdrop: true,
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
};
export const OWNED_NEXT_SIX_I_DEFINITIONS: readonly EffectDefinition[] =
  OWNED_NEXT_SIX_I_DRAFTS.map(definitionFor);
export const OWNED_NEXT_SIX_I_PRESETS: readonly EffectPreset[] =
  OWNED_NEXT_SIX_I_DRAFTS.flatMap((draft) =>
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
