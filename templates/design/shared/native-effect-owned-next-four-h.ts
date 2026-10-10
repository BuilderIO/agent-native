import {
  CATALOG_EDGE,
  CATALOG_PALETTES,
  catalogFloat,
  catalogPalette,
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
  looks: readonly [Look, Look];
};

const fraction = (label: string, value: number): EffectProperty =>
  catalogFloat(label, value, 0, 1);

export const OWNED_NEXT_FOUR_H_DRAFTS: readonly Draft[] = [
  {
    id: "owned-log-polar-reprojection",
    name: "Log-Polar Reprojection",
    kind: "processor",
    mechanism:
      "An inverse log-polar map samples source radii geometrically across output Y and source angle across output X; it exposes its center, radial interval, rotation, blend and edge contract.",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      centerX: catalogFloat("Center X", 0.5, 0, 1),
      centerY: catalogFloat("Center Y", 0.5, 0, 1),
      innerRadius: catalogFloat("Inner radius", 0.025, 0.005, 0.2, 0.001),
      outerRadius: catalogFloat("Outer radius", 0.68, 0.3, 1.4),
      rotation: catalogFloat("Rotation", 0, -3.14159, 3.14159),
      amount: fraction("Amount", 1),
    },
    fragment: (p) => `
  let amount = ${p("amount")}.x;
  if (amount <= 0.0) { return sampleSource(input.uv); }
  let inner = ${p("innerRadius")}.x;
  let outer = max(${p("outerRadius")}.x, inner + 0.001);
  let angle = input.uv.x * TAU + ${p("rotation")}.x;
  let radius = inner * pow(outer / inner, input.uv.y);
  let mapped = vec2f(${p("centerX")}.x, ${p("centerY")}.x) + radius * vec2f(cos(angle), sin(angle));
  return sampleSource(mix(input.uv, mapped, amount));`,
    looks: [
      ["Circular reveal", { innerRadius: 0.02, outerRadius: 0.58, amount: 1 }],
      [
        "Offset annulus",
        {
          centerX: 0.37,
          centerY: 0.57,
          innerRadius: 0.07,
          outerRadius: 0.93,
          rotation: 0.6,
          amount: 0.82,
        },
      ],
    ],
  },
  {
    id: "owned-julia-orbit-trap",
    name: "Julia Orbit Trap",
    kind: "generator",
    mechanism:
      "Each output point initializes its own complex orbit under a fixed authored quadratic parameter; the minimum distance to an authored circular trap colors both bounded and escaped paths.",
    properties: {
      palette: catalogPalette(CATALOG_PALETTES.orchid),
      zoom: catalogFloat("Zoom", 1.25, 0.5, 4),
      centerX: catalogFloat("Center X", 0, -1.5, 1.5),
      centerY: catalogFloat("Center Y", 0, -1.5, 1.5),
      constantReal: catalogFloat("Orbit real", -0.745, -1, 1),
      constantImaginary: catalogFloat("Orbit imaginary", 0.186, -1, 1),
      trapX: catalogFloat("Trap X", 0, -1.5, 1.5),
      trapY: catalogFloat("Trap Y", 0, -1.5, 1.5),
      trapRadius: catalogFloat("Trap radius", 0.34, 0.03, 1.3),
      iterations: catalogFloat("Iterations", 72, 16, 96, 1),
    },
    fragment: (p) => `
  let aspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  var z = (input.uv - 0.5) * vec2f(aspect, 1.0) * (3.0 / ${p("zoom")}.x) + vec2f(${p("centerX")}.x, ${p("centerY")}.x);
  let c = vec2f(${p("constantReal")}.x, ${p("constantImaginary")}.x);
  let trapCenter = vec2f(${p("trapX")}.x, ${p("trapY")}.x);
  let trapRadius = ${p("trapRadius")}.x;
  let iterationLimit = ${p("iterations")}.x;
  var minimumTrap = 4.0;
  var escape = iterationLimit;
  for (var i = 0u; i < 96u; i += 1u) {
    if (f32(i) >= iterationLimit) { break; }
    minimumTrap = min(minimumTrap, abs(length(z - trapCenter) - trapRadius));
    if (dot(z, z) > 64.0) { escape = f32(i); break; }
    z = vec2f(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
  }
  let trapped = exp(-6.0 * minimumTrap);
  let tone = clamp(trapped * 0.82 + (1.0 - escape / iterationLimit) * 0.18, 0.0, 1.0);
  return paletteAt(tone);`,
    looks: [
      [
        "Fine orbit lace",
        {
          constantReal: -0.745,
          constantImaginary: 0.186,
          trapRadius: 0.22,
          zoom: 1.4,
          iterations: 80,
        },
      ],
      [
        "Wide orbit basins",
        {
          constantReal: -0.12,
          constantImaginary: 0.75,
          trapX: 0.18,
          trapY: -0.12,
          trapRadius: 0.58,
          zoom: 1.05,
          iterations: 60,
        },
      ],
    ],
  },
  {
    id: "owned-torus-raymarch",
    name: "Torus Raymarch",
    kind: "generator",
    mechanism:
      "A bounded signed-distance sphere trace intersects a real torus surface, estimates its normal from the torus distance gradient, and lights the visible front face against a separate backdrop.",
    properties: {
      palette: catalogPalette(CATALOG_PALETTES.lagoon),
      majorRadius: catalogFloat("Ring radius", 0.72, 0.48, 0.88),
      tubeRadius: catalogFloat("Tube radius", 0.22, 0.08, 0.34),
      tilt: catalogFloat("Tilt", 0.72, -1.2, 1.2),
      lightAngle: catalogFloat("Light angle", 0.4, -3.14159, 3.14159),
      zoom: catalogFloat("Zoom", 1, 0.6, 1.5),
    },
    helpers: () => `
fn torusPoint(p: vec3f, tilt: f32) -> vec3f {
  let c = cos(tilt);
  let s = sin(tilt);
  return vec3f(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
}
fn torusSdf(p: vec3f, major: f32, tube: f32, tilt: f32) -> f32 {
  let q = torusPoint(p, tilt);
  return length(vec2f(length(q.xz) - major, q.y)) - tube;
}
`,
    fragment: (p) => `
  let aspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let screen = (input.uv - 0.5) * vec2f(aspect, 1.0) * (2.0 / ${p("zoom")}.x);
  let rayOrigin = vec3f(0.0, 0.0, 3.2);
  let rayDirection = normalize(vec3f(screen, -2.1));
  let major = ${p("majorRadius")}.x;
  let tube = ${p("tubeRadius")}.x;
  let tilt = ${p("tilt")}.x;
  var distanceAlong = 0.0;
  var hit = false;
  for (var i = 0u; i < 72u; i += 1u) {
    let position = rayOrigin + rayDirection * distanceAlong;
    let signedDistance = torusSdf(position, major, tube, tilt);
    if (signedDistance < 0.001) { hit = true; break; }
    distanceAlong += max(signedDistance, 0.004);
    if (distanceAlong > 7.0) { break; }
  }
  if (!hit) { return paletteAt(0.0); }
  let position = rayOrigin + rayDirection * distanceAlong;
  let e = 0.002;
  let normal = normalize(vec3f(
    torusSdf(position + vec3f(e, 0.0, 0.0), major, tube, tilt) - torusSdf(position - vec3f(e, 0.0, 0.0), major, tube, tilt),
    torusSdf(position + vec3f(0.0, e, 0.0), major, tube, tilt) - torusSdf(position - vec3f(0.0, e, 0.0), major, tube, tilt),
    torusSdf(position + vec3f(0.0, 0.0, e), major, tube, tilt) - torusSdf(position - vec3f(0.0, 0.0, e), major, tube, tilt)
  ));
  let direction = normalize(vec3f(cos(${p("lightAngle")}.x), 0.65, sin(${p("lightAngle")}.x) + 0.7));
  let diffuse = max(dot(normal, direction), 0.0);
  let viewDirection = -rayDirection;
  let halfDirection = normalize(direction + viewDirection);
  let specular = pow(max(dot(normal, halfDirection), 0.0), 28.0);
  let light = clamp(0.12 + 0.68 * diffuse + 0.28 * specular, 0.0, 1.0);
  let surface = paletteAt(light);
  return vec4f(surface.rgb * light, surface.a);`,
    looks: [
      [
        "Polished loop",
        { majorRadius: 0.72, tubeRadius: 0.2, tilt: 0.78, lightAngle: 0.25 },
      ],
      [
        "Heavy ring",
        {
          majorRadius: 0.62,
          tubeRadius: 0.32,
          tilt: -0.5,
          lightAngle: 1.4,
          zoom: 1.2,
        },
      ],
    ],
  },
  {
    id: "owned-recursive-partition-mosaic",
    name: "Recursive Partition Mosaic",
    kind: "generator",
    mechanism:
      "A deterministic binary spatial partition recursively cuts the largest physical side of each cell; each final rectangle gets a stable independent palette value and a physical-pixel joint.",
    properties: {
      palette: catalogPalette(CATALOG_PALETTES.ink),
      depth: catalogFloat("Partition depth", 5, 2, 8, 1),
      irregularity: catalogFloat("Irregularity", 0.45, 0, 0.9),
      jointWidth: catalogFloat("Joint width", 2, 0, 8, 0.1),
    },
    fragment: (p) => `
  var lower = vec2f(0.0);
  var upper = vec2f(1.0);
  var address = vec2i(19, 7);
  for (var level = 0u; level < 8u; level += 1u) {
    if (f32(level) >= ${p("depth")}.x) { break; }
    let span = upper - lower;
    let alongX = span.x * globals.viewport.x >= span.y * globals.viewport.y;
    let cut = 0.5 + (random(address + vec2i(i32(level) * 13, 31)) - 0.5) * ${p("irregularity")}.x;
    if (alongX) {
      let split = mix(lower.x, upper.x, cut);
      if (input.uv.x < split) { upper.x = split; address = address * 2 + vec2i(1, 0); }
      else { lower.x = split; address = address * 2 + vec2i(2, 0); }
    } else {
      let split = mix(lower.y, upper.y, cut);
      if (input.uv.y < split) { upper.y = split; address = address * 2 + vec2i(0, 1); }
      else { lower.y = split; address = address * 2 + vec2i(0, 2); }
    }
  }
  let pigment = paletteAt(random(address + vec2i(37, 71)));
  let joint = ${p("jointWidth")}.x;
  if (joint <= 0.0) { return pigment; }
  let edgePixels = min(min((input.uv.x - lower.x) * globals.viewport.x, (upper.x - input.uv.x) * globals.viewport.x),
    min((input.uv.y - lower.y) * globals.viewport.y, (upper.y - input.uv.y) * globals.viewport.y));
  let coverage = 1.0 - smoothstep(joint * 0.5, joint * 0.5 + 1.0, edgePixels);
  return mix(pigment, paletteAt(0.0), coverage);`,
    looks: [
      ["Measured panels", { depth: 4, irregularity: 0.12, jointWidth: 1.5 }],
      ["Cut-paper blocks", { depth: 7, irregularity: 0.75, jointWidth: 4 }],
    ],
  },
];

export const OWNED_NEXT_FOUR_H_DEFINITIONS: EffectDefinition[] =
  OWNED_NEXT_FOUR_H_DRAFTS.map((draft) => {
    const definition = catalogShader(draft);
    return {
      ...definition,
      provenance: {
        origin: "design-original",
        note: `Original Design mechanism: ${draft.mechanism}.`,
      },
    };
  });

export const OWNED_NEXT_FOUR_H_PRESETS: EffectPreset[] =
  OWNED_NEXT_FOUR_H_DRAFTS.flatMap((draft) =>
    draft.looks.map(([name, params], index) => ({
      id: `an-preset-${draft.id}-${index === 0 ? "subtle" : "expressive"}`,
      name,
      definitionId: `an-native-${draft.id}`,
      definitionVersion: 1,
      placement: (draft.kind === "processor" ? "layer" : "fill") as
        | "layer"
        | "fill",
      params,
      clip: "bounds" as const,
      provenance: { origin: "design-original" as const },
    })),
  );
