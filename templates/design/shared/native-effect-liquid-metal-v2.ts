import {
  catalogColor,
  catalogFloat as f,
  catalogShader,
} from "./native-effect-catalog-kit";
import type { EffectDefinition } from "./native-effects";

const liquidMetal = catalogShader({
  id: "liquid-metal",
  version: 2,
  name: "Liquid Metal",
  kind: "processor",
  edgeSampling: "fixed-clamp",
  properties: {
    palette: {
      type: "color-ramp",
      label: "Palette",
      maxCount: 8,
      default: [
        { position: 0, color: catalogColor(0.012, 0.014, 0.018) },
        { position: 0.22, color: catalogColor(0.15, 0.16, 0.18) },
        { position: 0.5, color: catalogColor(0.51, 0.53, 0.56) },
        { position: 0.78, color: catalogColor(0.88, 0.89, 0.91) },
        { position: 1, color: catalogColor(1, 1, 1) },
      ],
    },
    scale: f("Scale", 1, 0.25, 8),
    distortion: f("Distortion", 0.8, 0, 3),
    roughness: f("Roughness", 0.04, 0, 1),
    lightAngle: f("Light angle", Math.PI / 4, -Math.PI, Math.PI),
    movement: f("Movement", 0.35, 0, 2),
  },
  helpers: (p) => `
override NATIVE_GENERATED_FILL: bool = false;
fn metalGradient(q: vec2f, phase: f32) -> vec2f {
  let bendX = 0.95 * q.x - 0.17 * phase;
  let bendY = 0.85 * q.y + 0.13 * phase;
  let swellX = 1.35 * q.x + 0.42 * sin(bendY) + 0.38 * phase;
  let swellY = 1.18 * q.y - 0.36 * sin(bendX) - 0.29 * phase;
  let diagonal = 0.78 * q.x - 0.92 * q.y + 0.21 * phase;
  // Derivatives of three long-wave swells keep the reflected surface smooth at every scale.
  return vec2f(
    0.72 * cos(swellX) * 1.35 + 0.54 * sin(swellY) * 0.36 * 0.95 * cos(bendX) + 0.18 * cos(diagonal) * 0.78,
    0.72 * cos(swellX) * 0.42 * 0.85 * cos(bendY) - 0.54 * sin(swellY) * 1.18 - 0.18 * cos(diagonal) * 0.92
  );
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
`,
  fragment: (p) => `
  let aspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let q = (input.uv - 0.5) * vec2f(aspect, 1.0) * ${p("scale")}.x * 5.2;
  let phase = globals.clock.x * ${p("movement")}.x;
  let gradient = metalGradient(q, phase);
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
  let softness = 0.025 + roughness * 0.24;
  let key = smoothstep(0.22 - softness, 0.22 + softness, environment.y)
    * (1.0 - smoothstep(0.68 - softness, 0.68 + softness, environment.y));
  let reflector = smoothstep(-0.94 - softness, -0.72 + softness, environment.y)
    * (1.0 - smoothstep(-0.52 - softness, -0.40 + softness, environment.y));
  let facing = clamp(reflected.z * 0.5 + 0.5, 0.0, 1.0);
  let room = 0.07 + 0.42 * facing * facing;
  let reflection = room + 0.84 * key + 0.62 * reflector;
  let metal = metalRamp(mix(reflection, 0.50, roughness * 0.50));
  let coverage = select(sampleSource(input.uv).a, 1.0, generated);
  return metal * coverage;
`,
});

export const LIQUID_METAL_V2_EFFECT: EffectDefinition = {
  ...liquidMetal,
  placements: ["fill", "layer"],
};
