import {
  catalogColor,
  catalogFloat,
  catalogShader,
} from "./native-effect-catalog-kit";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const fraction = (label: string, value: number) =>
  catalogFloat(label, value, 0, 1);

const base = catalogShader({
  id: "owned-o-studio-light-rig",
  name: "Studio Light Rig",
  version: 2,
  kind: "generator",
  properties: {
    curve: fraction("Surface curvature", 0.68),
    keyX: catalogFloat("Key X", -0.55, -1, 1),
    keyY: catalogFloat("Key Y", -0.42, -1, 1),
    fillX: catalogFloat("Fill X", 0.72, -1, 1),
    fillY: catalogFloat("Fill Y", 0.2, -1, 1),
    key: fraction("Key strength", 0.85),
    fill: fraction("Fill strength", 0.36),
    rim: fraction("Rim strength", 0.45),
    ambient: fraction("Ambient", 0.15),
    surface: {
      type: "color",
      label: "Surface",
      default: catalogColor(0.44, 0.55, 0.7),
    },
    keyColor: {
      type: "color",
      label: "Key color",
      default: catalogColor(1, 0.86, 0.66),
    },
    fillColor: {
      type: "color",
      label: "Fill color",
      default: catalogColor(0.39, 0.62, 1),
    },
    lightMode: {
      type: "enum",
      label: "Light geometry",
      default: "directional",
      options: ["directional", "area"],
    },
    keyTarget: {
      type: "vec2",
      label: "Key target",
      default: [0.24, 0.25],
      min: 0,
      max: 1,
      step: 0.01,
    },
    fillTarget: {
      type: "vec2",
      label: "Fill target",
      default: [0.78, 0.6],
      min: 0,
      max: 1,
      step: 0.01,
    },
    keySoftness: fraction("Key softness", 0.4),
    fillSoftness: fraction("Fill softness", 0.64),
    backDirection: {
      type: "vec2",
      label: "Backlight direction",
      default: [0.4, -0.75],
      min: -1,
      max: 1,
      step: 0.01,
    },
    backStrength: fraction("Backlight strength", 0),
    backColor: {
      type: "color",
      label: "Backlight color",
      default: catalogColor(0.88, 0.93, 1),
    },
  },
  helpers: () => `
fn pointDiffuse(point: vec3f, normal: vec3f, light: vec3f) -> f32 {
  let ray = light - point;
  let distanceSquared = max(dot(ray, ray), 0.0001);
  let direction = ray * inverseSqrt(distanceSquared);
  return max(dot(normal, direction), 0.0) / (1.0 + distanceSquared * 0.14);
}
fn areaDiffuse(point: vec3f, normal: vec3f, center: vec3f, softness: f32) -> f32 {
  let radius = softness * 0.7;
  let offsets = array<vec2f, 5>(
    vec2f(0.0), vec2f(1.0, 0.0), vec2f(-1.0, 0.0),
    vec2f(0.0, 1.0), vec2f(0.0, -1.0)
  );
  var response = 0.0;
  for (var sampleIndex = 0u; sampleIndex < 5u; sampleIndex += 1u) {
    response += pointDiffuse(point, normal, center + vec3f(offsets[sampleIndex] * radius, 0.0));
  }
  return response * 0.2;
}
`,
  fragment: (p) => `
  let aspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let q = (input.uv - vec2f(0.5)) * 2.0;
  let curvature = ${p("curve")}.x;
  let surfacePoint = vec3f(q.x * aspect, q.y,
    0.5 * curvature * (q.x * q.x * aspect + q.y * q.y));
  let normal = normalize(vec3f(-q * curvature, 1.0));
  let keyDirection = normalize(vec3f(${p("keyX")}.x, ${p("keyY")}.x, 1.0));
  let fillDirection = normalize(vec3f(${p("fillX")}.x, ${p("fillY")}.x, 1.0));
  var keyResponse = max(dot(normal, keyDirection), 0.0);
  var fillResponse = max(dot(normal, fillDirection), 0.0);
  if (u32(${p("lightMode")}.x) == 1u) {
    let keyAnchor = (${p("keyTarget")}.xy - vec2f(0.5)) * vec2f(2.0 * aspect, 2.0);
    let fillAnchor = (${p("fillTarget")}.xy - vec2f(0.5)) * vec2f(2.0 * aspect, 2.0);
    let keyLight = vec3f(keyAnchor + vec2f(${p("keyX")}.x, ${p("keyY")}.x) * 0.35, 1.5);
    let fillLight = vec3f(fillAnchor + vec2f(${p("fillX")}.x, ${p("fillY")}.x) * 0.35, 1.5);
    keyResponse = areaDiffuse(surfacePoint, normal, keyLight, ${p("keySoftness")}.x);
    fillResponse = areaDiffuse(surfacePoint, normal, fillLight, ${p("fillSoftness")}.x);
  }
  let keyEnergy = keyResponse * ${p("key")}.x * ${p("keyColor")}.rgb * ${p("keyColor")}.a;
  let fillEnergy = fillResponse * ${p("fill")}.x * ${p("fillColor")}.rgb * ${p("fillColor")}.a;
  let rimEnergy = pow(1.0 - max(normal.z, 0.0), 2.0) * ${p("rim")}.x
    * ${p("keyColor")}.rgb * ${p("keyColor")}.a;
  let backVector = ${p("backDirection")}.xy;
  let backUnit = backVector / max(length(backVector), 0.0001);
  let rearFacing = max(dot(normal.xy, backUnit), 0.0);
  let backEnergy = rearFacing * rearFacing * ${p("backStrength")}.x
    * ${p("backColor")}.rgb * ${p("backColor")}.a;
  let baseColor = ${p("surface")};
  let lit = baseColor.rgb * (${p("ambient")}.x + keyEnergy + fillEnergy)
    + rimEnergy + backEnergy;
  return vec4f(lit * baseColor.a, baseColor.a);
`,
});

export const OWNED_O_STUDIO_LIGHT_RIG_V2: EffectDefinition = {
  ...base,
  resources: base.resources?.map((resource) =>
    resource.name === "color"
      ? { ...resource, format: "rgba16float" }
      : resource,
  ),
  provenance: {
    origin: "design-original",
    note: "One curved surface lit by independent directional or five-sample area key and fill sources, with an aimable backlight.",
  },
};

export const OWNED_O_STUDIO_LIGHT_RIG_V2_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-owned-o-studio-light-rig-v2-portrait-softboxes",
    name: "Portrait Softboxes",
    definitionId: OWNED_O_STUDIO_LIGHT_RIG_V2.id,
    definitionVersion: 2,
    placement: "fill",
    params: {
      lightMode: "area",
      curve: 0.45,
      keyTarget: [0.29, 0.22],
      fillTarget: [0.8, 0.52],
      keySoftness: 0.72,
      fillSoftness: 0.88,
      key: 0.92,
      fill: 0.51,
      rim: 0.16,
      backDirection: [0.68, -0.55],
      backStrength: 0.24,
      surface: catalogColor(0.42, 0.5, 0.63),
      backColor: catalogColor(0.96, 0.83, 0.64),
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-o-studio-light-rig-v2-night-stage",
    name: "Night Stage",
    definitionId: OWNED_O_STUDIO_LIGHT_RIG_V2.id,
    definitionVersion: 2,
    placement: "fill",
    params: {
      lightMode: "area",
      curve: 0.88,
      keyTarget: [0.12, 0.16],
      fillTarget: [0.84, 0.78],
      keySoftness: 0.12,
      fillSoftness: 0.44,
      keyX: -0.85,
      keyY: -0.7,
      fillX: 0.75,
      fillY: 0.36,
      key: 1,
      fill: 0.19,
      rim: 0.12,
      ambient: 0.035,
      backDirection: [-0.88, 0.24],
      backStrength: 0.78,
      surface: catalogColor(0.13, 0.19, 0.29),
      keyColor: catalogColor(1, 0.65, 0.35),
      fillColor: catalogColor(0.25, 0.47, 1),
      backColor: catalogColor(0.51, 0.78, 1),
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
