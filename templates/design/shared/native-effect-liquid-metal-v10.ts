import {
  catalogColor,
  catalogFloat as f,
  catalogShader,
} from "./native-effect-catalog-kit";
import { nativeEffectPaintWgsl } from "./native-effect-paint";
import type { EffectDefinition } from "./native-effects";

const liquidMetal = catalogShader({
  id: "liquid-metal",
  version: 10,
  name: "Liquid Metal",
  kind: "processor",
  edgeSampling: "fixed-clamp",
  properties: {
    tint: {
      type: "color",
      label: "Tint",
      default: catalogColor(1, 1, 1),
    },
    fill: {
      type: "paint",
      label: "Fill",
      maxCount: 8,
      default: {
        kind: "solid",
        color: catalogColor(170 / 255, 170 / 255, 172 / 255),
      },
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
  helpers: (p, slot) => `
${nativeEffectPaintWgsl(slot("fill"), "metalFill")}
override NATIVE_GENERATED_FILL: bool = false;
fn metalHeight(q: vec2f, phase: f32) -> f32 {
  let warp = 0.24 + ${p("distortion")}.x * 1.05;
  var flow = q;
  flow.x += warp * (0.72 * sin(q.y * 1.17 + 0.035 * sin(phase * 0.045))
    + 0.28 * sin(q.y * 0.53 + 0.025 * sin(phase * 0.037) + 1.3));
  flow.y += warp * (0.68 * sin(flow.x * 1.09 + 0.03 * sin(phase * 0.041) + 0.6)
    + 0.32 * cos(flow.x * 0.47 + 0.02 * sin(phase * 0.033)));
  let first = flow.x * 1.31 + flow.y * 0.73
    + 0.36 * sin(flow.y * 0.81 + 0.03 * sin(phase * 0.047));
  let second = -flow.x * 0.83 + flow.y * 1.43
    + 0.31 * sin(flow.x * 0.91 + 0.035 * sin(phase * 0.043) + 1.1);
  let third = flow.x * 1.67 - flow.y * 0.58
    + 0.29 * cos(first * 0.68 + 0.025 * sin(phase * 0.039));
  let height = (0.74 + 0.015 * sin(phase * 0.039)) * sin(first + 0.04 * sin(phase * 0.05) + 0.4)
    + (0.56 + 0.012 * sin(phase * 0.031)) * cos(second + 0.035 * sin(phase * 0.041) + 1.2)
    + 0.22 * sin(third + 0.025 * sin(phase * 0.037) + 2.0);
  return height + ${p("contour")}.x * 0.16 * sin(height * 2.1);
}
fn metalNormal(q: vec2f, phase: f32, sourceNormal: vec2f) -> vec3f {
  let step = 0.006;
  let gradient = vec2f(
    metalHeight(q + vec2f(step, 0.0), phase) - metalHeight(q - vec2f(step, 0.0), phase),
    metalHeight(q + vec2f(0.0, step), phase) - metalHeight(q - vec2f(0.0, step), phase)
  ) / (2.0 * step);
  return normalize(vec3f(-gradient * 0.72 - sourceNormal, 1.0));
}
fn metalBand(cycle: f32, start: f32, end: f32, width: f32) -> f32 {
  return smoothstep(start - width, start + width, cycle)
    - smoothstep(end - width, end + width, cycle);
}
fn metalEnvironment(position: f32, antialias: f32) -> f32 {
  let cycle = fract(position);
  let broad = 0.055 + 0.56 * pow(0.5 + 0.5 * cos(TAU * (cycle - 0.18)), 1.15);
  let shoulder = 0.014 + ${p("softness")}.x * 0.065 + antialias;
  let softbox = metalBand(cycle, 0.11, 0.32, shoulder);
  let silver = mix(broad, 0.975, softbox);
  let seamWidth = 0.0012 + ${p("softness")}.x * 0.008 + antialias;
  let seam = metalBand(cycle, 0.343, 0.356, seamWidth);
  return mix(silver, 0.025, seam);
}
fn metalGamma(color: vec3f) -> vec3f {
  let magnitude = abs(color);
  let encoded = sign(color) * select(1.055 * pow(magnitude, vec3f(1.0 / 2.4)) - 0.055, magnitude * 12.92, magnitude <= vec3f(0.0031308));
  return select(encoded, color, magnitude == vec3f(1.0));
}
fn metalLinear(color: vec3f) -> vec3f {
  let magnitude = abs(color);
  let decoded = sign(color) * select(pow((magnitude + 0.055) / 1.055, vec3f(2.4)), magnitude / 12.92, magnitude <= vec3f(0.04045));
  return select(decoded, color, magnitude == vec3f(1.0));
}
fn metalHardLight(base: vec3f, reflection: vec3f) -> vec3f {
  return select(2.0 * base * reflection, 1.0 - 2.0 * (1.0 - base) * (1.0 - reflection), reflection >= vec3f(0.5));
}
fn metalColorBurn(base: vec3f, tint: vec3f) -> vec3f {
  let burn = 1.0 - min(vec3f(1.0), (1.0 - base) / max(tint, vec3f(0.00001)));
  let dark = select(burn, vec3f(0.0), tint <= vec3f(0.0));
  let highlights = select(dark, vec3f(1.0), base >= vec3f(1.0));
  return select(highlights, base, tint >= vec3f(1.0));
}
fn sourceRelief(uv: vec2f) -> f32 {
  let color = sampleSource(uv);
  return color.a * (0.65 + 0.35 * luminance(straight(color)));
}
`,
  fragment: (p) => `
  let aspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let phase = globals.clock.x;
  let q = rotate((input.uv - 0.5) * vec2f(aspect, 1.0) * 2.4 / ${p("scale")}.x, -${p("angle")}.x);
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
  let contourStrength = ${p("contour")}.x * (1.6 + abs(relief - broadRelief) * 3.0);
  let sourceNormal = select(reliefGradient * contourStrength, vec2f(0.0), generated);
  let normal = metalNormal(q, phase, sourceNormal);
  let reflected = reflect(vec3f(0.0, 0.0, -1.0), normal);
  let environmentAxis = normalize(vec3f(0.64, -0.55, 0.54));
  let position = (0.52 + dot(reflected, environmentAxis) * 0.54) * ${p("repetition")}.x + phase * 0.08;
  let antialias = min(fwidth(position) * 0.5, 0.025);
  let reflection = vec3f(
    metalEnvironment(position + ${p("shiftRed")}.x * 0.006, antialias),
    metalEnvironment(position, antialias),
    metalEnvironment(position - ${p("shiftBlue")}.x * 0.006, antialias)
  );
  let fill = metalFill(input.uv, globals.viewport.xy);
  let base = metalHardLight(metalGamma(straight(fill)), reflection);
  let tint = ${p("tint")};
  let tinted = mix(base, metalColorBurn(base, metalGamma(tint.rgb)), tint.a);
  let coverage = select(source.a, 1.0, generated);
  let alpha = fill.a * coverage;
  return vec4f(metalLinear(tinted) * alpha, alpha);
`,
});

export const LIQUID_METAL_V10_EFFECT: EffectDefinition = {
  ...liquidMetal,
  placements: ["fill", "layer"],
  resources: liquidMetal.resources?.map((resource) =>
    resource.kind === "texture-2d" && resource.name === "color"
      ? { ...resource, format: "rgba16float" }
      : resource,
  ),
};
