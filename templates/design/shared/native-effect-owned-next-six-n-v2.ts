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
type Draft = Omit<CatalogShaderSpec, "kind"> & {
  mechanism: string;
  looks: readonly [Look, Look];
  cost: string;
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
const color = (
  label: string,
  red: number,
  green: number,
  blue: number,
  alpha = 1,
): EffectProperty => ({
  type: "color",
  label,
  default: catalogColor(red, green, blue, alpha),
});
const common = `
fn painted(color: vec4f, coverage: f32) -> vec4f {
  let alpha = color.a * clamp(coverage, 0.0, 1.0);
  return vec4f(color.rgb * alpha, alpha);
}
fn sourceOver(top: vec4f, bottom: vec4f) -> vec4f {
  return vec4f(top.rgb + bottom.rgb * (1.0 - top.a), top.a + bottom.a * (1.0 - top.a));
}
fn coverageAt(distance: f32, halfWidth: f32, aa: f32) -> f32 {
  return 1.0 - smoothstep(halfWidth - aa, halfWidth + aa, abs(distance));
}
`;
const drafts: readonly Draft[] = [
  {
    id: "owned-n-arc-path",
    name: "Arc Path",
    cost: "One analytic arc distance, no texture reads or loops",
    mechanism:
      "A single editable circular path uses center, radius, angular sweep, stroke thickness and analytic edge coverage; it is not a repeated halo or a radial gradient.",
    properties: {
      centerX: amount("Center X", 0.5),
      centerY: amount("Center Y", 0.5),
      radius: pixels("Radius", 130, 12, 500),
      thickness: pixels("Stroke", 14, 1, 80),
      start: catalogFloat("Start angle", 0, 0, 6.2831853),
      sweep: catalogFloat("Sweep", 4.7, 0.08, 6.2831853),
      ink: color("Ink", 0.85, 0.43, 0.18),
      background: color("Background", 0.04, 0.08, 0.16),
    },
    fragment: (p) => `
  let point = (input.uv - vec2f(${p("centerX")}.x, ${p("centerY")}.x)) * globals.viewport.xy / globals.clock.z;
  let radius = length(point);
  let angle = fract((atan2(point.y, point.x) - ${p("start")}.x) / TAU + 2.0) * TAU;
  let sweep = ${p("sweep")}.x;
  let angularWidth = max(1.0 / max(${p("radius")}.x, 1.0), 0.003);
  let arc = select(1.0 - smoothstep(sweep - angularWidth, sweep + angularWidth, angle), 1.0, sweep >= TAU - 0.0001);
  let stroke = coverageAt(radius - ${p("radius")}.x, ${p("thickness")}.x * 0.5, 0.7);
  return sourceOver(painted(${p("ink")}, arc * stroke), painted(${p("background")}, 1.0));`,
    looks: [
      ["Open copper", { radius: 116, thickness: 10, start: 0.5, sweep: 4.3 }],
      [
        "Wide orbit",
        {
          centerX: 0.42,
          centerY: 0.55,
          radius: 174,
          thickness: 28,
          start: 2.1,
          sweep: 5.8,
          ink: catalogColor(0.35, 0.83, 0.9),
        },
      ],
    ],
  },
  {
    id: "owned-n-rational-circle-canopy",
    name: "Rational Circle Canopy",
    cost: "At most 27 analytic circle candidates and one distance resolve per pixel",
    mechanism:
      "Circle centers lie at bounded rational fractions of the width while radii fall by denominator squared; this number-theoretic canopy has different geometry from a cell tessellation or recursive triangle.",
    properties: {
      denominators: {
        type: "int",
        label: "Denominators",
        default: 5,
        min: 1,
        max: 6,
        step: 1,
      },
      baseRadius: pixels("Base radius", 160, 20, 280),
      baseline: amount("Baseline", 0.88),
      stroke: pixels("Circle stroke", 2, 0.5, 9),
      near: color("Large circles", 0.92, 0.52, 0.22),
      far: color("Small circles", 0.3, 0.7, 0.85),
      background: color("Background", 0.035, 0.065, 0.12),
    },
    fragment: (p) => `
  let width = globals.viewport.x / globals.clock.z;
  let height = globals.viewport.y / globals.clock.z;
  let point = input.uv * vec2f(width, height);
  var nearest = 1e9;
  var level = 1.0;
  for (var q = 1; q <= 6; q += 1) {
    if (f32(q) > ${p("denominators")}.x) { break; }
    for (var numerator = 0; numerator <= q; numerator += 1) {
      let denominator = f32(q);
      let radius = ${p("baseRadius")}.x / (denominator * denominator);
      let center = vec2f(width * f32(numerator) / denominator, height * ${p("baseline")}.x - radius);
      let distance = abs(length(point - center) - radius);
      if (distance < nearest) { nearest = distance; level = denominator; }
    }
  }
  let line = coverageAt(nearest, ${p("stroke")}.x * 0.5, 0.7);
  let tint = mix(${p("near")}, ${p("far")}, (level - 1.0) / max(${p("denominators")}.x - 1.0, 1.0));
  return sourceOver(painted(tint, line), painted(${p("background")}, 1.0));`,
    looks: [
      ["Copper fractions", { denominators: 4, baseRadius: 175, stroke: 2.4 }],
      [
        "Azure canopy",
        {
          denominators: 6,
          baseRadius: 115,
          baseline: 0.75,
          stroke: 1.2,
          near: catalogColor(0.19, 0.46, 0.92),
          far: catalogColor(0.72, 0.91, 0.85),
        },
      ],
    ],
  },
  {
    id: "owned-n-double-grating-moire",
    name: "Double-Grating Moiré",
    cost: "Two analytic cosine grating evaluations; no texture reads or loops",
    mechanism:
      "Two independently oriented and detuned transmissive gratings multiply to create controllable low-frequency beat envelopes; time shifts one grating's phase.",
    properties: {
      pitchA: pixels("First pitch", 13, 3, 45),
      pitchB: pixels("Second pitch", 13.5, 3, 45),
      angleA: catalogFloat("First angle", 0.35, 0, 6.2831853),
      detune: catalogFloat("Angular detune", 0.12, -0.8, 0.8),
      contrast: catalogFloat("Grating contrast", 1.6, 0.2, 4),
      drift: catalogFloat("Phase drift", 0.4, -3, 3),
      light: color("Open transmission", 0.8, 0.9, 0.85),
      dark: color("Closed transmission", 0.045, 0.09, 0.16),
    },
    fragment: (p) => `
  let point = (input.uv - vec2f(0.5)) * globals.viewport.xy / globals.clock.z;
  let angleA = ${p("angleA")}.x;
  let angleB = angleA + ${p("detune")}.x;
  let axisA = vec2f(cos(angleA), sin(angleA));
  let axisB = vec2f(cos(angleB), sin(angleB));
  let first = 0.5 + 0.5 * cos(TAU * dot(point, axisA) / ${p("pitchA")}.x);
  let second = 0.5 + 0.5 * cos(TAU * (dot(point, axisB) / ${p("pitchB")}.x + globals.clock.x * ${p("drift")}.x));
  let transmission = pow(first * second, ${p("contrast")}.x);
  return painted(mix(${p("dark")}, ${p("light")}, transmission), 1.0);`,
    looks: [
      [
        "Fine beat",
        { pitchA: 10, pitchB: 10.4, detune: 0.07, contrast: 1.4, drift: 0.15 },
      ],
      [
        "Crossed weave",
        {
          pitchA: 23,
          pitchB: 28,
          angleA: 1.1,
          detune: -0.42,
          contrast: 2.7,
          drift: -0.9,
        },
      ],
    ],
  },
  {
    id: "owned-n-schlieren-knife-edge",
    name: "Schlieren Knife Edge",
    cost: "Two value-noise probes (eight lattice hashes), no source textures",
    mechanism:
      "A finite difference of an authored refractive-index field is measured along a rotatable knife-edge axis and mapped to light/dark color; this visualizes gradient sign instead of rendering noise intensity.",
    properties: {
      fieldScale: catalogFloat("Index scale", 7, 1, 30),
      probe: catalogFloat("Probe spacing", 0.05, 0.01, 0.2),
      analyzerAngle: catalogFloat("Analyzer angle", 0.7, 0, 6.2831853),
      contrast: catalogFloat("Deflection contrast", 2.5, 0.1, 8),
      drift: catalogFloat("Field drift", 0.24, -2, 2),
      bright: color("Bright deflection", 0.91, 0.84, 0.68),
      dark: color("Dark deflection", 0.04, 0.07, 0.16),
    },
    fragment: (p) => `
  let ratio = globals.viewport.xy / min(globals.viewport.x, globals.viewport.y);
  let field = input.uv * ratio * ${p("fieldScale")}.x + vec2f(globals.clock.x * ${p("drift")}.x, 0.0);
  let axis = vec2f(cos(${p("analyzerAngle")}.x), sin(${p("analyzerAngle")}.x));
  let delta = axis * ${p("probe")}.x;
  let deflection = (valueNoise(field + delta) - valueNoise(field - delta)) / (2.0 * ${p("probe")}.x);
  let transmission = clamp(0.5 + deflection * ${p("contrast")}.x, 0.0, 1.0);
  return painted(mix(${p("dark")}, ${p("bright")}, transmission), 1.0);`,
    looks: [
      [
        "Quiet glass",
        { fieldScale: 5, probe: 0.08, contrast: 1.5, drift: 0.12 },
      ],
      [
        "Knife flare",
        {
          fieldScale: 15,
          probe: 0.03,
          analyzerAngle: 2.2,
          contrast: 5.5,
          drift: -0.5,
        },
      ],
    ],
  },
  {
    id: "owned-n-doppler-wavefronts",
    name: "Doppler Wavefronts",
    cost: "Twelve fixed analytic emission fronts; no texture reads",
    mechanism:
      "A translating emitter leaves discrete past wavefronts whose centers reflect emission time and whose radii reflect propagation, producing asymmetric compression unlike concentric rings.",
    properties: {
      centerX: amount("Emitter X", 0.5),
      centerY: amount("Emitter Y", 0.5),
      travel: pixels("Emitter travel", 105, 0, 220),
      angularSpeed: catalogFloat("Emitter speed", 1.7, 0, 8),
      spacing: pixels("Wave spacing", 23, 6, 70),
      propagation: pixels("Propagation speed", 100, 15, 350),
      width: pixels("Front width", 2.5, 0.5, 10),
      wave: color("Wavefront", 0.74, 0.9, 1),
      background: color("Background", 0.035, 0.08, 0.16),
    },
    fragment: (p) => `
  let extent = globals.viewport.xy / globals.clock.z;
  let point = input.uv * extent;
  let origin = vec2f(${p("centerX")}.x, ${p("centerY")}.x) * extent;
  let spacing = ${p("spacing")}.x;
  let delay = spacing / ${p("propagation")}.x;
  var energy = 0.0;
  for (var index = 0; index < 12; index += 1) {
    let age = f32(index) * delay;
    let emittedX = origin.x + ${p("travel")}.x * sin((globals.clock.x - age) * ${p("angularSpeed")}.x);
    let distance = length(point - vec2f(emittedX, origin.y));
    let ring = coverageAt(distance - f32(index) * spacing, ${p("width")}.x * 0.5, 0.8);
    energy = max(energy, ring * exp(-f32(index) * 0.1));
  }
  return sourceOver(painted(${p("wave")}, energy), painted(${p("background")}, 1.0));`,
    looks: [
      [
        "Slow wake",
        {
          travel: 60,
          angularSpeed: 0.8,
          spacing: 29,
          propagation: 150,
          width: 2,
        },
      ],
      [
        "Compressed fronts",
        {
          centerX: 0.4,
          travel: 180,
          angularSpeed: 3.5,
          spacing: 15,
          propagation: 75,
          width: 4,
        },
      ],
    ],
  },
  {
    id: "owned-n-kepler-area-sweep",
    name: "Kepler Area Sweep",
    cost: "Five bounded Newton iterations and two analytic coverage evaluations",
    mechanism:
      "A focused ellipse and moving body solve Kepler's equation with bounded Newton steps, so body motion follows equal-area timing rather than a constant-angle orbit.",
    properties: {
      semimajor: pixels("Orbit size", 145, 30, 300),
      eccentricity: catalogFloat("Eccentricity", 0.45, 0, 0.85),
      rotation: catalogFloat("Orbit rotation", 0.2, 0, 6.2831853),
      phase: catalogFloat("Initial phase", 0, 0, 6.2831853),
      speed: catalogFloat("Mean motion", 0.9, 0, 6),
      orbitWidth: pixels("Orbit stroke", 2, 0.5, 9),
      bodyRadius: pixels("Body radius", 7, 2, 28),
      orbit: color("Orbit", 0.43, 0.67, 0.92),
      body: color("Orbiting body", 1, 0.76, 0.32),
      background: color("Background", 0.035, 0.065, 0.12),
    },
    fragment: (p) => `
  let extent = globals.viewport.xy / globals.clock.z;
  let point = rotate((input.uv - vec2f(0.5)) * extent, -${p("rotation")}.x);
  let major = ${p("semimajor")}.x;
  let eccentricity = ${p("eccentricity")}.x;
  let minor = major * sqrt(1.0 - eccentricity * eccentricity);
  let eccentricPoint = vec2f(point.x / major + eccentricity, point.y / minor);
  let implicit = dot(eccentricPoint, eccentricPoint) - 1.0;
  let normalGradient = 2.0 * length(vec2f((point.x + major * eccentricity) / (major * major), point.y / (minor * minor)));
  let orbitDistance = abs(implicit) / max(normalGradient, 0.00001);
  let orbitalCoverage = coverageAt(orbitDistance, ${p("orbitWidth")}.x * 0.5, 0.7);
  let mean = ${p("phase")}.x + globals.clock.x * ${p("speed")}.x;
  var anomaly = mean;
  for (var iteration = 0; iteration < 5; iteration += 1) {
    anomaly -= (anomaly - eccentricity * sin(anomaly) - mean) / (1.0 - eccentricity * cos(anomaly));
  }
  let orbiting = vec2f(major * (cos(anomaly) - eccentricity), minor * sin(anomaly));
  let bodyCoverage = 1.0 - smoothstep(${p("bodyRadius")}.x - 0.7, ${p("bodyRadius")}.x + 0.7, length(point - orbiting));
  let base = sourceOver(painted(${p("orbit")}, orbitalCoverage), painted(${p("background")}, 1.0));
  return sourceOver(painted(${p("body")}, bodyCoverage), base);`,
    looks: [
      [
        "Wide ellipse",
        {
          semimajor: 135,
          eccentricity: 0.25,
          speed: 0.6,
          orbitWidth: 2,
          bodyRadius: 6,
        },
      ],
      [
        "Fast periapsis",
        {
          semimajor: 185,
          eccentricity: 0.78,
          rotation: 0.65,
          phase: 1.1,
          speed: 1.8,
          orbitWidth: 3,
          bodyRadius: 10,
        },
      ],
    ],
  },
];

function definitionFor(draft: Draft): EffectDefinition {
  const definition = catalogShader({
    ...draft,
    kind: "generator",
    helpers: (property) => common + (draft.helpers?.(property) ?? ""),
  });
  return {
    ...definition,
    version:
      draft.id === "owned-n-rational-circle-canopy" ||
      draft.id === "owned-n-kepler-area-sweep"
        ? 2
        : definition.version,
    resources: definition.resources?.map((resource) =>
      resource.name === "color"
        ? { ...resource, format: "rgba16float" }
        : resource,
    ),
    provenance: { origin: "design-original", note: draft.mechanism },
  };
}
export const OWNED_NEXT_SIX_N_DRAFTS = drafts;
export const OWNED_NEXT_SIX_N_DEFINITIONS: readonly EffectDefinition[] =
  drafts.map(definitionFor);
export const OWNED_NEXT_SIX_N_PRESETS: readonly EffectPreset[] = drafts.flatMap(
  (draft) =>
    draft.looks.map(([name, params], index) => ({
      id: `an-preset-${draft.id}-${index + 1}`,
      name,
      definitionId: `an-native-${draft.id}`,
      definitionVersion:
        draft.id === "owned-n-rational-circle-canopy" ||
        draft.id === "owned-n-kepler-area-sweep"
          ? 2
          : 1,
      placement: "fill" as const,
      params,
      clip: "bounds" as const,
      provenance: { origin: "design-original" as const },
    })),
);
