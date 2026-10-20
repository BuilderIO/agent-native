import {
  catalogColor,
  catalogFloat as f,
  catalogShader,
} from "./native-effect-catalog-kit";
import type { EffectDefinition } from "./native-effects";

const liquidMetal = catalogShader({
  id: "liquid-metal",
  version: 3,
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
    repetition: f("Repetition", 1.5, 1, 10),
    contour: f("Contour", 0.4, 0, 1),
    distortion: f("Distortion", 0.1, 0, 1),
    softness: f("Softness", 0.05, 0, 1),
    angle: f("Angle", Math.PI / 2, 0, Math.PI * 2),
    shiftRed: f("Red shift", 0.3, -1, 1),
    shiftBlue: f("Blue shift", 0.3, -1, 1),
  },
  helpers: (p) => `
override NATIVE_GENERATED_FILL: bool = false;
fn metalFlow(q: vec2f, phase: f32) -> f32 {
  let noiseWarp = vec2f(
    valueNoise(q * 1.35 + vec2f(0.08 * phase, 0.0)),
    valueNoise(q * 1.65 + vec2f(7.3, -0.06 * phase))
  ) - 0.5;
  let p = q + noiseWarp * ${p("distortion")}.x * 1.5;
  let bend = 0.70 * sin(p.y * 2.1 + 0.4 * sin(p.x * 1.2))
    + 0.35 * sin(p.x * 1.7 - p.y * 0.9);
  let sweep = 0.32 * p.x + 0.70 * sin(p.y * 1.8 + bend)
    + 0.38 * sin(p.x * 2.2 - p.y * 0.7 + 0.8);
  let basin = p - vec2f(0.3, 0.1);
  return sweep + ${p("contour")}.x * 0.6 * exp(-dot(basin, basin) * 0.6);
}
fn metalTone(position: f32, antialias: f32) -> f32 {
  let cycle = fract(position);
  let softness = ${p("softness")}.x;
  let edgeWidth = 0.006 + softness * 0.15 + antialias;
  let steel = 0.12 + 0.70 * pow(clamp(cycle / 0.9, 0.0, 1.0), 0.6);
  let highlightWidth = 0.018 + softness * 0.065 + antialias;
  let highlight = exp(-pow((cycle - 0.87) / highlightWidth, 2.0));
  let fold = smoothstep(0.92 - edgeWidth, 0.92 + edgeWidth, cycle);
  let crisp = mix(min(steel + 0.40 * highlight, 1.0), 0.10, fold);
  let rounded = 0.50 + 0.27 * sin(cycle * TAU - 2.0);
  return mix(crisp, rounded, softness * 0.8);
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
  let phase = globals.clock.x;
  let q = rotate((input.uv - 0.5) * vec2f(aspect, 1.0) * 2.4 / ${p("scale")}.x, -${p("angle")}.x)
    - vec2f(phase * 0.06, phase * 0.025);
  let generated = NATIVE_GENERATED_FILL;
  let size = max(globals.viewport.xy, vec2f(1.0));
  let density = max(globals.clock.z, 0.0001);
  let bevel = 3.0 * density / size;
  let broadBevel = 18.0 * density / size;
  let source = sampleSource(input.uv);
  let relief = sourceRelief(input.uv);
  let reliefGradient = vec2f(
    sourceRelief(input.uv + vec2f(bevel.x, 0.0)) - sourceRelief(input.uv - vec2f(bevel.x, 0.0)),
    sourceRelief(input.uv + vec2f(0.0, bevel.y)) - sourceRelief(input.uv - vec2f(0.0, bevel.y))
  );
  let broadRelief = 0.25 * (
    sourceRelief(input.uv + vec2f(broadBevel.x, 0.0)) + sourceRelief(input.uv - vec2f(broadBevel.x, 0.0))
    + sourceRelief(input.uv + vec2f(0.0, broadBevel.y)) + sourceRelief(input.uv - vec2f(0.0, broadBevel.y))
  );
  let sourceContour = ${p("contour")}.x * ((relief - broadRelief) * 2.0 + length(reliefGradient) * 0.7);
  let position = (metalFlow(q, phase) + select(sourceContour, 0.0, generated)) * ${p("repetition")}.x;
  let antialias = min(fwidth(position) * 0.6, 0.08);
  let green = metalRamp(metalTone(position, antialias));
  let red = metalRamp(metalTone(position + ${p("shiftRed")}.x * 0.045, antialias));
  let blue = metalRamp(metalTone(position - ${p("shiftBlue")}.x * 0.045, antialias));
  // Channel dispersion shares the largest coverage to keep the assembled color premultiplied.
  let alpha = max(red.a, max(green.a, blue.a));
  let coverage = select(source.a, 1.0, generated);
  return vec4f(red.r, green.g, blue.b, alpha) * coverage;
`,
});

export const LIQUID_METAL_V3_EFFECT: EffectDefinition = {
  ...liquidMetal,
  placements: ["fill", "layer"],
};
