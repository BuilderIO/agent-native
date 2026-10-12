import {
  CATALOG_EDGE,
  catalogFloat as f,
  catalogShader,
  type CatalogShaderSpec,
} from "./native-effect-catalog-kit";
import type {
  EffectDefinition,
  EffectPreset,
  EffectProperty,
} from "./native-effects";

const pointerProperties: Record<string, EffectProperty> = {
  pointerPosition: {
    type: "vec2",
    label: "Pointer Position",
    default: [0.5, 0.5],
    min: 0,
    max: 1,
    step: 0.001,
  },
  pointerActive: { type: "bool", label: "Pointer Active", default: true },
};

const pixelSpace = (p: (name: string) => string) => `
  let uv = input.uv;
  let pointer = ${p("pointerPosition")}.xy;
  let delta = (uv - pointer) * globals.viewport.xy;
  let distance = length(delta);
  let pointerEnabled = ${p("pointerActive")}.x;
`;

const specs: CatalogShaderSpec[] = [
  {
    id: "pointer-ripples",
    name: "Pointer Ripples",
    kind: "processor",
    backdrop: true,
    properties: {
      ...pointerProperties,
      radius: f("Radius", 150, 24, 480, 1),
      wavelength: f("Wavelength", 34, 4, 120, 1),
      strength: f("Strength", 12, 0, 48, 0.25),
      speed: f("Speed", 1.2, 0, 4, 0.01),
      softness: f("Softness", 0.58, 0.05, 1, 0.01),
      edge: structuredClone(CATALOG_EDGE),
    },
    fragment: (p) =>
      pixelSpace(p) +
      `
  let radius = max(${p("radius")}.x * globals.clock.z, 1.0);
  let envelope = exp(-pow(distance / radius, 2.0) * 4.0) * pointerEnabled;
  let wave = sin(distance / max(${p("wavelength")}.x * globals.clock.z, 1.0) * 6.2831853 - globals.clock.x * ${p("speed")}.x * 5.0);
  let displacement = normalize(delta + vec2f(0.0001)) * wave * ${p("strength")}.x * globals.clock.z * envelope;
  let original = sampleSource(uv);
  let warped = sampleSource(uv + displacement * globals.viewport.zw);
  let blend = envelope * (1.0 - ${p("softness")}.x * 0.35);
  return mix(original, warped, blend);
`,
  },
  {
    id: "pointer-magnifier",
    name: "Pointer Magnifier",
    kind: "processor",
    backdrop: true,
    properties: {
      ...pointerProperties,
      radius: f("Radius", 125, 28, 420, 1),
      zoom: f("Zoom", 1.65, 1, 3.5, 0.01),
      refraction: f("Refraction", 3, 0, 16, 0.1),
      softness: f("Softness", 0.18, 0.01, 0.6, 0.01),
      edge: structuredClone(CATALOG_EDGE),
    },
    fragment: (p) =>
      pixelSpace(p) +
      `
  let radius = max(${p("radius")}.x * globals.clock.z, 1.0);
  let mask = (1.0 - smoothstep(radius * (1.0 - ${p("softness")}.x), radius, distance)) * pointerEnabled;
  let zoom = max(${p("zoom")}.x, 1.0);
  let refractiveRim = exp(-pow((distance / radius - 0.82) * 9.0, 2.0)) * ${p("refraction")}.x * globals.clock.z;
  let sampleDelta = delta * (1.0 / zoom - 1.0) + normalize(delta + vec2f(0.0001)) * refractiveRim;
  let original = sampleSource(uv);
  let magnified = sampleSource(uv + sampleDelta * globals.viewport.zw);
  return mix(original, magnified, mask);
`,
  },
  {
    id: "pointer-vortex",
    name: "Pointer Vortex",
    kind: "processor",
    backdrop: true,
    properties: {
      ...pointerProperties,
      radius: f("Radius", 180, 32, 520, 1),
      strength: f("Strength", 2.1, -6, 6, 0.01),
      falloff: f("Falloff", 2.4, 0.5, 8, 0.01),
      softness: f("Softness", 0.42, 0.05, 1, 0.01),
      edge: structuredClone(CATALOG_EDGE),
    },
    fragment: (p) =>
      pixelSpace(p) +
      `
  let radius = max(${p("radius")}.x * globals.clock.z, 1.0);
  let radial = clamp(distance / radius, 0.0, 1.0);
  let weight = pow(1.0 - smoothstep(0.0, 1.0, radial), ${p("falloff")}.x) * pointerEnabled;
  let angle = ${p("strength")}.x * weight * (1.0 - ${p("softness")}.x * radial);
  let c = cos(angle);
  let s = sin(angle);
  let rotated = vec2f(c * delta.x - s * delta.y, s * delta.x + c * delta.y);
  return sampleSource(uv + (rotated - delta) * globals.viewport.zw);
`,
  },
  {
    id: "pointer-spotlight",
    name: "Pointer Spotlight",
    kind: "processor",
    backdrop: true,
    properties: {
      ...pointerProperties,
      radius: f("Radius", 210, 24, 620, 1),
      intensity: f("Intensity", 0.8, 0, 2, 0.01),
      falloff: f("Falloff", 2.2, 0.5, 6, 0.01),
      softness: f("Softness", 0.48, 0.02, 1, 0.01),
      edge: structuredClone(CATALOG_EDGE),
    },
    fragment: (p) =>
      pixelSpace(p) +
      `
  let radius = max(${p("radius")}.x * globals.clock.z, 1.0);
  let normalized = distance / radius;
  let edge = mix(0.72, 1.0, ${p("softness")}.x);
  let light = pow(max(1.0 - smoothstep(0.0, edge, normalized), 0.0), ${p("falloff")}.x) * pointerEnabled;
  let original = sampleSource(uv);
  let rgb = straight(original);
  let lit = rgb + vec3f(1.0, 0.88, 0.68) * light * ${p("intensity")}.x;
  return premultiply(lit, original.a);
`,
  },
  {
    id: "pointer-prism",
    name: "Pointer Prism",
    kind: "processor",
    backdrop: true,
    properties: {
      ...pointerProperties,
      radius: f("Radius", 170, 24, 520, 1),
      dispersion: f("Dispersion", 8, 0, 32, 0.1),
      refraction: f("Refraction", 0.7, 0, 2, 0.01),
      softness: f("Softness", 0.68, 0.05, 1, 0.01),
      edge: structuredClone(CATALOG_EDGE),
    },
    fragment: (p) =>
      pixelSpace(p) +
      `
  let radius = max(${p("radius")}.x * globals.clock.z, 1.0);
  let envelope = (1.0 - smoothstep(radius * ${p("softness")}.x, radius, distance)) * pointerEnabled;
  let radial = normalize(delta + vec2f(0.0001));
  let separation = ${p("dispersion")}.x * globals.clock.z * envelope * ${p("refraction")}.x;
  let redSample = sampleSource(uv + radial * separation * globals.viewport.zw);
  let centerSample = sampleSource(uv);
  let blueSample = sampleSource(uv - radial * separation * globals.viewport.zw);
  let separated = vec3f(straight(redSample).r, straight(centerSample).g, straight(blueSample).b);
  let rgb = mix(straight(centerSample), separated, envelope);
  return premultiply(rgb, centerSample.a);
`,
  },
  {
    id: "pointer-iridescence",
    name: "Pointer Iridescence",
    kind: "generator",
    properties: {
      ...pointerProperties,
      scale: f("Scale", 0.018, 0.002, 0.08, 0.001),
      wavelength: f("Wavelength", 0.55, 0.05, 2, 0.01),
      movement: f("Movement", 0.12, 0, 0.8, 0.01),
      intensity: f("Intensity", 0.75, 0, 1, 0.01),
    },
    fragment: (p) =>
      pixelSpace(p) +
      `
  let angle = atan2(delta.y, delta.x);
  let cssDistance = distance / max(globals.clock.z, 0.0001);
  let phaseRadius = cssDistance * ${p("scale")}.x;
  let filmThickness = ${p("wavelength")}.x * (0.85 + 0.25 * sin(phaseRadius - globals.clock.x * ${p("movement")}.x * 5.0) + 0.12 * cos(angle * 3.0 + phaseRadius * 0.35));
  let viewCosine = clamp(0.62 + 0.28 * cos(angle - 0.7) / (1.0 + cssDistance * 0.001), 0.08, 0.98);
  let opticalPath = filmThickness / viewCosine;
  let spectral = 0.5 + 0.5 * cos(6.2831853 * opticalPath * vec3f(1.0, 1.22, 1.48));
  let fresnel = 0.2 + 0.8 * pow(1.0 - viewCosine, 3.0);
  let cssViewportHeight = max(globals.viewport.y / max(globals.clock.z, 0.0001), 1.0);
  let cursorField = mix(0.68, 1.0, exp(-pow(cssDistance / (cssViewportHeight * 0.65), 2.0)) * pointerEnabled);
  let rgb = mix(vec3f(0.025, 0.035, 0.07), spectral * fresnel * cursorField, ${p("intensity")}.x);
  return vec4f(rgb, 1.0);
`,
  },
];

export const POINTER_EFFECT_DEFINITIONS: readonly EffectDefinition[] =
  specs.map((spec) => ({
    ...catalogShader(spec),
    interaction: {
      positionProperty: "pointerPosition",
      activeProperty: "pointerActive",
    },
  }));

function preset(
  definition: EffectDefinition,
  id: string,
  name: string,
  params: Record<string, number | boolean | [number, number]>,
): EffectPreset {
  return {
    id,
    name,
    definitionId: definition.id,
    definitionVersion: definition.version,
    placement:
      definition.kind === "generator"
        ? "fill"
        : definition.placements.includes("backdrop")
          ? "backdrop"
          : "layer",
    params: { pointerPosition: [0.5, 0.5], pointerActive: true, ...params },
    clip: "bounds",
    provenance: { origin: "design-original" },
  };
}

const definitionsBySlug = new Map(
  POINTER_EFFECT_DEFINITIONS.map((definition) => [
    definition.id.replace("an-native-pointer-", ""),
    definition,
  ]),
);

export const POINTER_EFFECT_PRESETS: readonly EffectPreset[] = [
  preset(
    definitionsBySlug.get("ripples")!,
    "an-preset-pointer-ripples-1",
    "Ripple Pool",
    { radius: 182, wavelength: 42, strength: 14, softness: 0.64 },
  ),
  preset(
    definitionsBySlug.get("ripples")!,
    "an-preset-pointer-ripples-2",
    "Interference Rings",
    { radius: 118, wavelength: 19, strength: 24, speed: 1.9, softness: 0.28 },
  ),
  preset(
    definitionsBySlug.get("magnifier")!,
    "an-preset-pointer-magnifier-1",
    "Glass Dome",
    { radius: 138, zoom: 1.8, refraction: 5, softness: 0.24 },
  ),
  preset(
    definitionsBySlug.get("magnifier")!,
    "an-preset-pointer-magnifier-2",
    "Wide Lens",
    { radius: 245, zoom: 1.28, refraction: 1.5, softness: 0.42 },
  ),
  preset(
    definitionsBySlug.get("vortex")!,
    "an-preset-pointer-vortex-1",
    "Tidal Twist",
    { radius: 205, strength: 1.5, falloff: 1.6, softness: 0.58 },
  ),
  preset(
    definitionsBySlug.get("vortex")!,
    "an-preset-pointer-vortex-2",
    "Tight Vortex",
    { radius: 110, strength: 4.2, falloff: 4.8, softness: 0.2 },
  ),
  preset(
    definitionsBySlug.get("spotlight")!,
    "an-preset-pointer-spotlight-1",
    "Soft Lantern",
    { radius: 290, intensity: 0.62, falloff: 1.3, softness: 0.82 },
  ),
  preset(
    definitionsBySlug.get("spotlight")!,
    "an-preset-pointer-spotlight-2",
    "Hard Spotlight",
    { radius: 150, intensity: 1.35, falloff: 3.8, softness: 0.2 },
  ),
  preset(
    definitionsBySlug.get("prism")!,
    "an-preset-pointer-prism-1",
    "Chromatic Edge",
    { radius: 190, dispersion: 13, refraction: 0.9, softness: 0.7 },
  ),
  preset(
    definitionsBySlug.get("prism")!,
    "an-preset-pointer-prism-2",
    "Split Spectrum",
    { radius: 116, dispersion: 26, refraction: 1.4, softness: 0.36 },
  ),
  preset(
    definitionsBySlug.get("iridescence")!,
    "an-preset-pointer-iridescence-1",
    "Oil Slick",
    { scale: 0.026, wavelength: 0.72, movement: 0.18, intensity: 0.84 },
  ),
  preset(
    definitionsBySlug.get("iridescence")!,
    "an-preset-pointer-iridescence-2",
    "Peacock Film",
    { scale: 0.045, wavelength: 1.12, movement: 0.05, intensity: 0.68 },
  ),
];
