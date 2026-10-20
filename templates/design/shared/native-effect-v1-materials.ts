import {
  catalogColor,
  catalogFloat as f,
  catalogShader,
} from "./native-effect-catalog-kit";
import { nativeEffectPaintWgsl } from "./native-effect-paint";
import type { EffectDefinition } from "./native-effects";

const liquidMetal = catalogShader({
  id: "liquid-metal",
  version: 12,
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
@group(0) @binding(4) var receiverInteriorTexture: texture_2d<f32>;
override NATIVE_GENERATED_FILL: bool = false;
fn metalNoise(q: vec2f) -> f32 {
  let cell = floor(q);
  let local = fract(q);
  let blend = local * local * (3.0 - 2.0 * local);
  let a = fract(sin(dot(cell, vec2f(57.17, 113.53))) * 41729.31);
  let b = fract(sin(dot(cell + vec2f(1.0, 0.0), vec2f(57.17, 113.53))) * 41729.31);
  let c = fract(sin(dot(cell + vec2f(0.0, 1.0), vec2f(57.17, 113.53))) * 41729.31);
  let d = fract(sin(dot(cell + vec2f(1.0), vec2f(57.17, 113.53))) * 41729.31);
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y) * 2.0 - 1.0;
}
fn metalPhase(q: vec2f, uv: vec2f, time: f32, sourceContour: f32) -> vec3f {
  let local = (uv - 0.5) * 2.0;
  let interior = max(vec2f(0.0), 1.0 - local * local);
  let depth = interior.x * interior.y;
  let noise = 0.7 * metalNoise(q * 0.85 + vec2f(time * 0.09, -time * 0.06))
    + 0.3 * metalNoise(q * 1.55 + vec2f(-time * 0.04, time * 0.08));
  let twist = 0.6 * q.y + 0.35 * q.x * q.y
    + (0.25 + ${p("distortion")}.x * 0.8) * noise + 0.18 * sin(time * 0.21);
  let folded = rotate(q, twist);
  let offset = q - vec2f(-0.24, 0.18);
  let envelope = exp(-dot(offset * vec2f(0.55, 0.78), offset * vec2f(0.55, 0.78)));
  let crown = pow(depth, 0.35 + ${p("contour")}.x * 0.65);
  let carrier = crown * (
    folded.x * envelope * 2.8
    + 0.18 * depth * (1.0 - depth) * sin(folded.y * 2.7 + time * 0.14)
    + (0.12 + ${p("distortion")}.x * 0.8) * noise
  ) + sourceContour;
  return vec3f(carrier * 0.4 * ${p("repetition")}.x - time * 0.18, depth, noise);
}
fn metalInteriorPhase(q: vec2f, interior: vec4f, time: f32) -> vec3f {
  let depth = pow(clamp(interior.r, 0.0, 1.0), 0.8 + ${p("contour")}.x * 0.4);
  let noise = 0.7 * metalNoise(q * 0.85 + vec2f(time * 0.09, -time * 0.06))
    + 0.3 * metalNoise(q * 1.55 + vec2f(-time * 0.04, time * 0.08));
  let angle = ${p("angle")}.x;
  let direction = dot(interior.gb, vec2f(cos(angle), sin(angle)));
  let flow = depth * (0.06 + ${p("distortion")}.x * 0.35) * noise
    + depth * (1.0 - depth) * (0.05 + ${p("contour")}.x * 0.12)
      * direction * sin(time * 0.23 + q.x * 0.2);
  let position = (depth * 1.6 + flow) * ${p("repetition")}.x / sqrt(${p("scale")}.x) - time * 0.18;
  return vec3f(position, depth, noise);
}
fn metalBand(cycle: f32, start: f32, end: f32, width: f32) -> f32 {
  let center = (start + end) * 0.5;
  let halfWidth = (end - start) * 0.5;
  let distance = abs(fract(cycle - center + 0.5) - 0.5);
  return 1.0 - smoothstep(halfWidth - width, halfWidth + width, distance);
}
fn metalTone(position: f32, antialias: f32) -> f32 {
  let cycle = fract(position);
  let width = 0.001 + ${p("softness")}.x * 0.035 + antialias;
  let gradient = mix(0.075, 0.97, smoothstep(0.19, 0.98, cycle));
  let wrapDistance = fract(position + 0.5) - 0.5;
  let wrapTone = mix(0.97, 0.075, smoothstep(-width, width, wrapDistance));
  let broad = select(gradient, wrapTone, abs(wrapDistance) < width);
  let outer = metalBand(cycle, 0.018, 0.058, width);
  let inner = metalBand(cycle, 0.102, 0.153, width);
  let silver = mix(broad, 0.99, max(outer, inner));
  let seam = metalBand(cycle, 0.069, 0.091, width);
  return mix(silver, 0.015, seam);
}
fn metalInteriorTone(position: f32, antialias: f32) -> f32 {
  let edgeWidth = min(antialias * 0.5, 0.025);
  return (
    metalTone(position - antialias, edgeWidth)
    + 4.0 * metalTone(position - antialias * 0.5, edgeWidth)
    + 6.0 * metalTone(position, edgeWidth)
    + 4.0 * metalTone(position + antialias * 0.5, edgeWidth)
    + metalTone(position + antialias, edgeWidth)
  ) / 16.0;
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
  let sourceContour = ${p("contour")}.x * ((relief - broadRelief) * 1.3 + length(reliefGradient) * 0.7);
  var field = metalPhase(q, input.uv, phase, select(sourceContour, 0.0, generated));
  let interior = textureSampleLevel(receiverInteriorTexture, effectSampler, input.uv, 0.0);
  if (interior.a > 0.5) {
    field = metalInteriorPhase(q, interior, phase);
  }
  let position = field.x;
  let antialias = min(fwidth(position) * 0.5, select(0.025, 0.25, interior.a > 0.5));
  let redOffset = ${p("shiftRed")}.x * 0.055 * (0.5 + field.y * 0.5 + field.z * 0.2);
  let blueOffset = ${p("shiftBlue")}.x * 0.055 * (0.65 + field.y * 0.35 - field.z * 0.2);
  var reflectedBands = vec3f(
    metalTone(position + redOffset, antialias),
    metalTone(position, antialias),
    metalTone(position - blueOffset, antialias)
  );
  if (interior.a > 0.5) {
    reflectedBands = vec3f(
      metalInteriorTone(position + redOffset, antialias),
      metalInteriorTone(position, antialias),
      metalInteriorTone(position - blueOffset, antialias)
    );
  }
  let brightest = max(reflectedBands.r, max(reflectedBands.g, reflectedBands.b));
  let darkest = min(reflectedBands.r, min(reflectedBands.g, reflectedBands.b));
  let body = (1.0 - smoothstep(0.015, 0.09, brightest - darkest))
    * (1.0 - smoothstep(0.65, 0.95, brightest));
  let reflection = reflectedBands * mix(vec3f(1.0), vec3f(0.9, 0.94, 1.08), body);
  let fill = metalFill(input.uv, globals.viewport.xy);
  let base = metalHardLight(metalGamma(straight(fill)), reflection);
  let tint = ${p("tint")};
  let tinted = mix(base, metalColorBurn(base, metalGamma(tint.rgb)), tint.a);
  let coverage = select(source.a, 1.0, generated);
  let alpha = fill.a * coverage;
  return vec4f(metalLinear(tinted) * alpha, alpha);
`,
});

export const LIQUID_METAL_EFFECT: EffectDefinition = {
  ...liquidMetal,
  placements: ["fill", "layer"],
  inputs: {
    ...liquidMetal.inputs,
    mask: { kind: "mask", resource: "mask" },
    interior: { kind: "texture-2d", resource: "receiverInterior" },
  },
  passes: liquidMetal.passes.map((pass) => ({
    ...pass,
    reads: ["source", "mask", "receiverInterior"],
  })),
  resources: [
    ...liquidMetal.resources!.map((resource) =>
      resource.kind === "texture-2d" && resource.name === "color"
        ? { ...resource, format: "rgba16float" as const }
        : resource,
    ),
    {
      name: "mask",
      kind: "texture-2d",
      usage: ["sampled"],
      external: true,
      size: "viewport",
    },
    {
      name: "receiverInterior",
      kind: "texture-2d",
      format: "rgba16float",
      sampleEncoding: "linear-data",
      usage: ["sampled"],
      external: true,
      size: "viewport",
    },
  ],
};

export const FLUTED_GLASS_EFFECT = catalogShader({
  id: "fluted-glass",
  name: "Fluted Glass",
  kind: "processor",
  backdrop: true,
  edgeSampling: "fixed-clamp",
  properties: {
    fluteWidth: { ...f("Flute width", 24, 2, 160, 1), unit: "px" },
    rotation: f("Rotation", 0, -Math.PI, Math.PI),
    refraction: { ...f("Refraction", 9, 0, 60, 0.1), unit: "px" },
    frost: { ...f("Frost", 1.5, 0, 24, 0.1), unit: "px" },
    tint: {
      type: "color",
      label: "Tint",
      default: catalogColor(0.88, 0.94, 1, 0.08),
    },
  },
  fragment: (p) => `
  let density = max(globals.clock.z, 0.0001);
  let size = max(globals.viewport.xy, vec2f(1.0));
  let pixel = (input.uv - 0.5) * size / density;
  let angle = ${p("rotation")}.x;
  let across = vec2f(cos(angle), sin(angle));
  let local = fract(dot(pixel, across) / ${p("fluteWidth")}.x + 0.5) * 2.0 - 1.0;
  let normalX = local * 0.96;
  let normal = vec3f(normalX, 0.0, sqrt(1.0 - normalX * normalX));
  let ray = refract(vec3f(0.0, 0.0, -1.0), normal, 1.0 / 1.5);
  let displacement = across * (ray.x / max(-ray.z, 0.15)) * ${p("refraction")}.x;
  let refractedUv = input.uv + displacement * density / size;
  let blurStep = ${p("frost")}.x * density / size;
  let weights = array<f32, 5>(1.0, 4.0, 6.0, 4.0, 1.0);
  var color = vec4f(0.0);
  for (var y = 0u; y < 5u; y += 1u) {
    for (var x = 0u; x < 5u; x += 1u) {
      let offset = vec2f(f32(x) - 2.0, f32(y) - 2.0) * blurStep;
      color += sampleSource(refractedUv + offset) * (weights[x] * weights[y] / 256.0);
    }
  }
  let tint = ${p("tint")};
  return vec4f(mix(color.rgb, tint.rgb * color.a, tint.a), color.a);
`,
});
