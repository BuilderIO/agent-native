import {
  catalogColor,
  catalogFloat as f,
  catalogShader,
} from "./native-effect-catalog-kit";
import { nativeEffectPaintWgsl } from "./native-effect-paint";
import type { EffectDefinition } from "./native-effects";

const liquidMetal = catalogShader({
  id: "liquid-metal",
  version: 7,
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
fn metalCell(q: vec2f, center: vec2f, radii: vec2f, rotation: f32, deformation: f32) -> vec2f {
  let cell = rotate(q - center, rotation) / radii;
  let radius = length(cell);
  let direction = cell / max(radius, 0.0001);
  let threefold = direction.x * (direction.x * direction.x - 3.0 * direction.y * direction.y);
  let radiusSquared = dot(cell, cell);
  let cubic = cell.x * (cell.x * cell.x - 3.0 * cell.y * cell.y);
  let smoothRadius = radiusSquared + deformation * 0.42 * cubic / (1.0 + radiusSquared);
  return vec2f(
    radius * (1.0 + deformation * threefold) - 1.0,
    exp(-smoothRadius * 1.25)
  );
}
fn metalField(q: vec2f, phase: f32) -> vec2f {
  let curl = vec2f(
    sin(q.y * 1.6 + 0.32 * sin(phase * 0.21)),
    sin(q.x * 1.4 - q.y * 0.55 + 0.38 * cos(phase * 0.17))
  );
  let flow = q + curl * (0.045 + ${p("distortion")}.x * 0.55);
  let contour = 0.065 + ${p("contour")}.x * 0.31;
  let first = metalCell(
    flow,
    vec2f(-0.63 + 0.13 * sin(phase * 0.19), -0.79 + 0.10 * sin(phase * 0.23)),
    vec2f(0.64 + 0.055 * sin(phase * 0.29), 0.69 + 0.065 * cos(phase * 0.17)),
    0.28 + 0.18 * sin(phase * 0.13),
    contour + 0.035 * sin(phase * 0.31)
  );
  let second = metalCell(
    flow,
    vec2f(0.63 + 0.14 * sin(phase * 0.17 + 1.2), 0.78 + 0.12 * sin(phase * 0.21 + 0.4)),
    vec2f(0.91 + 0.09 * sin(phase * 0.23 + 0.7), 0.85 + 0.07 * sin(phase * 0.31)),
    -0.46 + 0.15 * sin(phase * 0.19 + 0.8),
    -contour + 0.04 * sin(phase * 0.27 + 1.0)
  );
  let blend = max(0.14 - abs(first.x - second.x), 0.0) / 0.14;
  return vec2f(min(first.x, second.x) - blend * blend * 0.035, first.y + second.y);
}
fn metalFlow(q: vec2f, phase: f32) -> f32 {
  return metalField(q, phase).x;
}
fn metalHeight(q: vec2f, phase: f32) -> f32 {
  let background = 0.035 * q.x * q.x - 0.027 * q.y * q.y
    + 0.028 * q.x * q.y + 0.018 * q.y;
  return metalField(q, phase).y + background;
}
fn metalBody(q: vec2f, phase: f32) -> f32 {
  let step = 0.006;
  let gradient = vec2f(
    metalHeight(q + vec2f(step, 0.0), phase) - metalHeight(q - vec2f(step, 0.0), phase),
    metalHeight(q + vec2f(0.0, step), phase) - metalHeight(q - vec2f(0.0, step), phase)
  ) / (2.0 * step);
  let normal = normalize(vec3f(-gradient * 1.65, 1.0));
  let ray = reflect(vec3f(0.0, 0.0, -1.0), normal);
  let overhead = dot(ray, normalize(vec3f(0.58, -0.72, 0.38)));
  let broad = exp(-pow((overhead + 0.10) / 0.48, 2.0));
  let side = exp(-pow((dot(ray, vec3f(-0.8, -0.6, 0.0)) - 0.65) / 0.62, 2.0));
  return clamp(0.045 + 0.91 * broad + 0.12 * side, 0.025, 0.985);
}
fn metalTone(position: f32, body: f32, antialias: f32) -> f32 {
  let cycle = fract(position);
  let width = 0.0007 + ${p("softness")}.x * 0.012 + antialias;
  let ribbons = smoothstep(0.405 - width, 0.405 + width, cycle)
    - smoothstep(0.420 - width, 0.420 + width, cycle)
    + smoothstep(0.442 - width, 0.442 + width, cycle)
    - smoothstep(0.522 - width, 0.522 + width, cycle)
    + smoothstep(0.549 - width, 0.549 + width, cycle)
    - smoothstep(0.564 - width, 0.564 + width, cycle);
  let cluster = smoothstep(0.390 - width, 0.390 + width, cycle)
    * (1.0 - smoothstep(0.590 - width, 0.590 + width, cycle));
  return mix(body, 0.012 + 0.976 * clamp(ribbons, 0.0, 1.0), cluster);
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
  let field = metalFlow(q, phase) + select(sourceContour, 0.0, generated);
  let position = clamp(field, -1.05, 0.95) * ${p("repetition")}.x * 0.55 + 0.5;
  let body = metalBody(q, phase);
  let antialias = min(fwidth(position) * 0.5, 0.025);
  let reflection = vec3f(
    metalTone(position + ${p("shiftRed")}.x * 0.045, body, antialias),
    metalTone(position, body, antialias),
    metalTone(position - ${p("shiftBlue")}.x * 0.045, body, antialias)
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

export const LIQUID_METAL_V7_EFFECT: EffectDefinition = {
  ...liquidMetal,
  placements: ["fill", "layer"],
  resources: liquidMetal.resources?.map((resource) =>
    resource.kind === "texture-2d" && resource.name === "color"
      ? { ...resource, format: "rgba16float" }
      : resource,
  ),
};
