import {
  catalogColor,
  catalogFloat as f,
  catalogShader,
} from "./native-effect-catalog-kit";
import { nativeEffectPaintWgsl } from "./native-effect-paint";
import type { EffectDefinition } from "./native-effects";

const liquidMetal = catalogShader({
  id: "liquid-metal",
  version: 5,
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
fn metalFlow(q: vec2f, phase: f32) -> f32 {
  let wave = q * vec2f(1.1, 1.35) + vec2f(
    0.55 * sin(phase * 0.31),
    0.45 * sin(phase * 0.23 + 0.8)
  );
  let curl = vec2f(
    1.35 * sin(wave.x) * cos(wave.y),
    -1.1 * cos(wave.x) * sin(wave.y)
  ) * (0.85 + 0.25 * sin(phase * 0.29));
  let noiseWarp = vec2f(
    valueNoise(q * 1.35 + curl * 0.3 + vec2f(0.3 * sin(phase * 0.17), 0.0)),
    valueNoise(q * 1.65 + curl * 0.3 + vec2f(7.3, 0.3 * cos(phase * 0.19)))
  ) - 0.5;
  let p = q + curl * (0.22 + ${p("distortion")}.x * 0.8)
    + noiseWarp * ${p("distortion")}.x * 1.5;
  let bend = (0.70 + 0.18 * sin(phase * 0.27))
    * sin(p.y * 2.1 + 0.4 * sin(p.x * 1.2 + 0.6 * sin(phase * 0.31)) + 0.65 * sin(phase * 0.23))
    + 0.35 * sin(p.x * 1.7 - p.y * 0.9 + 0.55 * sin(phase * 0.37));
  let sweep = 0.32 * q.x
    + (0.70 + 0.14 * cos(phase * 0.19)) * sin(p.y * 1.8 + bend + 0.45 * sin(phase * 0.29))
    + 0.38 * sin(p.x * 2.2 - p.y * 0.7 + 0.8 + 0.6 * sin(phase * 0.41));
  let basinCenter = vec2f(0.3 + 0.2 * sin(phase * 0.19), 0.1 + 0.18 * cos(phase * 0.23));
  let basinStretch = 1.0 + 0.18 * sin(phase * 0.31);
  let basin = rotate(p - basinCenter, 0.2 * sin(phase * 0.17))
    * vec2f(basinStretch, 1.0 / basinStretch);
  return sweep + ${p("contour")}.x * (0.6 + 0.12 * sin(phase * 0.29))
    * exp(-dot(basin, basin) * 0.6);
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
  let sourceContour = ${p("contour")}.x * ((relief - broadRelief) * 2.0 + length(reliefGradient) * 0.7);
  let position = (metalFlow(q, phase) + select(sourceContour, 0.0, generated)) * ${p("repetition")}.x;
  let antialias = min(fwidth(position) * 0.6, 0.08);
  let reflection = vec3f(
    metalTone(position + ${p("shiftRed")}.x * 0.045, antialias),
    metalTone(position, antialias),
    metalTone(position - ${p("shiftBlue")}.x * 0.045, antialias)
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

export const LIQUID_METAL_V5_EFFECT: EffectDefinition = {
  ...liquidMetal,
  placements: ["fill", "layer"],
  resources: liquidMetal.resources?.map((resource) =>
    resource.kind === "texture-2d" && resource.name === "color"
      ? { ...resource, format: "rgba16float" }
      : resource,
  ),
};
