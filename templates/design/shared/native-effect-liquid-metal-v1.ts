import {
  catalogColor,
  catalogFloat as f,
  catalogShader,
} from "./native-effect-catalog-kit";
import type { EffectDefinition } from "./native-effects";

const liquidMetal = catalogShader({
  id: "liquid-metal",
  name: "Liquid Metal",
  kind: "processor",
  edgeSampling: "fixed-clamp",
  properties: {
    palette: {
      type: "color-ramp",
      label: "Palette",
      maxCount: 8,
      default: [
        { position: 0, color: catalogColor(0.045, 0.055, 0.075) },
        { position: 0.22, color: catalogColor(0.19, 0.22, 0.26) },
        { position: 0.48, color: catalogColor(0.5, 0.55, 0.6) },
        { position: 0.72, color: catalogColor(0.85, 0.89, 0.93) },
        { position: 1, color: catalogColor(0.99, 1, 1) },
      ],
    },
    scale: f("Scale", 2, 0.25, 8),
    distortion: f("Distortion", 1.1, 0, 3),
    roughness: f("Roughness", 0.12, 0, 1),
    lightAngle: f("Light angle", 0.65, -Math.PI, Math.PI),
    movement: f("Movement", 0.35, 0, 2),
  },
  helpers: (p) => `
override NATIVE_GENERATED_FILL: bool = false;
fn metalHeight(q: vec2f, phase: f32) -> f32 {
  return 0.46 * sin(1.6 * q.x + 0.8 * sin(1.4 * q.y) + phase)
    + 0.34 * cos(1.9 * q.y - 0.7 * sin(1.25 * q.x) - 0.81 * phase)
    + 0.20 * sin(1.2 * (q.x + q.y) + 0.63 * phase);
}
fn metalRamp(position: f32) -> vec4f {
  let count = min(u32(${p("palette")}.x), 8u);
  if (count == 0u) { return vec4f(0.0); }
  var lower = globals.params[1u];
  var upper = lower;
  var lowerPosition = globals.params[2u].x;
  var upperPosition = lowerPosition;
  let value = clamp(position, 0.0, 1.0);
  for (var i = 0u; i < count; i += 1u) {
    let color = globals.params[1u + i * 2u];
    let stopPosition = globals.params[2u + i * 2u].x;
    if (stopPosition <= value && (lowerPosition > value || stopPosition >= lowerPosition)) {
      lower = color;
      lowerPosition = stopPosition;
    }
    if (stopPosition > value && (upperPosition <= value || stopPosition < upperPosition)) {
      upper = color;
      upperPosition = stopPosition;
    }
  }
  if (lowerPosition > value) { return vec4f(upper.rgb * upper.a, upper.a); }
  if (upperPosition <= value) { return vec4f(lower.rgb * lower.a, lower.a); }
  let weight = (value - lowerPosition) / (upperPosition - lowerPosition);
  return mix(vec4f(lower.rgb * lower.a, lower.a), vec4f(upper.rgb * upper.a, upper.a), weight);
}
fn sourceRelief(uv: vec2f) -> f32 {
  let color = sampleSource(uv);
  return color.a * (0.65 + 0.35 * luminance(straight(color)));
}
fn studioBand(coordinate: f32, center: f32, width: f32) -> f32 {
  let distance = (coordinate - center) / width;
  return exp(-0.5 * distance * distance);
}
`,
  fragment: (p) => `
  let aspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let q = (input.uv - 0.5) * vec2f(aspect, 1.0) * ${p("scale")}.x * 3.0;
  let phase = globals.clock.x * ${p("movement")}.x;
  let epsilon = 0.005;
  let gradient = vec2f(
    metalHeight(q + vec2f(epsilon, 0.0), phase) - metalHeight(q - vec2f(epsilon, 0.0), phase),
    metalHeight(q + vec2f(0.0, epsilon), phase) - metalHeight(q - vec2f(0.0, epsilon), phase)
  ) / (2.0 * epsilon);
  let generated = NATIVE_GENERATED_FILL;
  let size = max(globals.viewport.xy, vec2f(1.0));
  let bevel = 3.0 * max(globals.clock.z, 0.0001) / size;
  let reliefGradient = vec2f(
    sourceRelief(input.uv + vec2f(bevel.x, 0.0)) - sourceRelief(input.uv - vec2f(bevel.x, 0.0)),
    sourceRelief(input.uv + vec2f(0.0, bevel.y)) - sourceRelief(input.uv - vec2f(0.0, bevel.y))
  );
  let slope = select(gradient * 0.5 + reliefGradient * 3.0, gradient, generated);
  let normal = normalize(vec3f(-slope * ${p("distortion")}.x, 1.0));
  let reflected = reflect(vec3f(0.0, 0.0, -1.0), normal);
  let environment = rotate(reflected.xy, ${p("lightAngle")}.x);
  let roughness = ${p("roughness")}.x;
  let width = 0.045 + roughness * 0.32;
  let key = studioBand(environment.y, 0.36, width);
  let rim = studioBand(environment.y, -0.58, width * 1.6);
  let shadow = studioBand(environment.y, -0.10, 0.11 + roughness * 0.2);
  let base = 0.22 + 0.20 * smoothstep(-0.7, 0.9, reflected.z);
  let reflection = base + 0.76 * key + 0.42 * rim - 0.24 * shadow;
  let metal = metalRamp(mix(reflection, 0.52, roughness * 0.55));
  let coverage = select(sampleSource(input.uv).a, 1.0, generated);
  return metal * coverage;
`,
});

export const LIQUID_METAL_V1_EFFECT: EffectDefinition = {
  ...liquidMetal,
  placements: ["fill", "layer"],
};
