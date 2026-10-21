import {
  catalogColor,
  catalogFloat,
  catalogPalette,
  catalogShader,
} from "./native-effect-catalog-kit";
import type { EffectDefinition, EffectProperty } from "./native-effects";

const pct = (label: string, value: number, max = 1): EffectProperty =>
  catalogFloat(label, value, 0, max);

const px = (label: string, value: number, max: number): EffectProperty => ({
  ...catalogFloat(label, value, 0, max),
  unit: "px",
});

const fiberPalette = [
  catalogColor(0.19, 0.25, 0.3),
  catalogColor(0.83, 0.79, 0.68),
  catalogColor(0.99, 0.97, 0.9),
];
const thermalPalette = [
  catalogColor(0.08, 0.12, 0.44),
  catalogColor(0.02, 0.65, 0.86),
  catalogColor(0.18, 0.82, 0.48),
  catalogColor(1, 0.78, 0.16),
  catalogColor(0.91, 0.16, 0.09),
];
const gemPalette = [
  catalogColor(0.08, 0.055, 0.2),
  catalogColor(0.34, 0.18, 0.56),
  catalogColor(0.83, 0.38, 0.68),
  catalogColor(0.98, 0.71, 0.43),
  catalogColor(0.98, 0.92, 0.8),
];
const smokePalette = [
  catalogColor(0.035, 0.055, 0.12, 0),
  catalogColor(0.13, 0.2, 0.39, 0.18),
  catalogColor(0.32, 0.47, 0.68, 0.46),
  catalogColor(0.78, 0.86, 0.96, 0.8),
];

const fiberTexture = catalogShader({
  id: "fiber-texture",
  name: "Fiber Texture",
  kind: "generator",
  properties: {
    palette: {
      type: "color-array",
      label: "Palette",
      default: fiberPalette,
      maxCount: 8,
    },
    scale: catalogFloat("Scale", 1, 0.25, 4),
    detail: catalogFloat("Detail", 5, 1, 14, 1),
    grain: pct("Grain", 0.22),
    movement: pct("Movement", 0.02),
  },
  fragment: (p) => `
  let uv = input.uv;
  let phase = globals.clock.x * ${p("movement")}.x;
  let size = ${p("scale")}.x;
  let detail = ${p("detail")}.x;
  let fibers = fractalNoise(vec2f(uv.x * detail * 28.0, uv.y * detail * 2.2 + phase));
  let flecks = valueNoise(uv * globals.viewport.xy * (0.025 + size * 0.012));
  let grain = random(vec2i(floor(uv * globals.viewport.xy)));
  let tone = clamp(0.56 + (fibers - 0.5) * 0.24 + (flecks - 0.5) * 0.16 + (grain - 0.5) * ${p("grain")}.x, 0.0, 1.0);
  return paletteAt(tone);
`,
});

const texturedStock = catalogShader({
  id: "textured-stock",
  name: "Textured Stock",
  kind: "generator",
  properties: {
    fill: {
      type: "color",
      label: "Fill",
      default: catalogColor(0.94, 0.9, 0.81),
    },
    shade: {
      type: "color",
      label: "Shade",
      default: catalogColor(0.25, 0.23, 0.2),
    },
    scale: catalogFloat("Scale", 1.1, 0.4, 3.5),
    detail: catalogFloat("Detail", 7, 2, 16, 1),
    grain: pct("Grain", 0.22),
    fiber: pct("Fiber", 0.28),
    folds: pct("Folds", 0.3),
    angle: catalogFloat("Angle", Math.PI / 5, 0, Math.PI),
  },
  fragment: (p) => `
  let uv = input.uv;
  let aspect = vec2f(globals.viewport.x / max(globals.viewport.y, 1.0), 1.0);
  let q = rotate((uv - vec2f(0.5)) * aspect, ${p("angle")}.x) * ${p("scale")}.x;
  let detail = ${p("detail")}.x;
  let broadGrain = fractalNoise(q * detail * 8.0 + vec2f(1.7, 5.2));
  let fibers = fractalNoise(vec2f(q.x * detail * 68.0, q.y * detail * 6.0));
  let creaseField = fractalNoise(q * detail * 2.1 + vec2f(4.6, 8.3));
  let creasePhase = (uv.x * (3.0 + detail * 0.32) + sin(uv.y * 8.0 + creaseField * 4.0) * 0.12 + (creaseField - 0.5) * 0.11) * 3.1415927;
  let crease = sin(creasePhase);
  let ridge = exp(-abs(crease) * 13.0) - 0.28 * exp(-abs(crease) * 2.6);
  let fleck = random(vec2i(floor(uv * globals.viewport.xy * 0.8))) - 0.5;
  let roughness = (broadGrain - 0.5) * ${p("grain")}.x * 0.65 + (fibers - 0.5) * ${p("fiber")}.x * 0.52 + fleck * ${p("grain")}.x * 0.22;
  let relief = roughness + ridge * ${p("folds")}.x * 0.52;
  let stockTone = clamp(0.86 + relief, 0.42, 1.0);
  let fill = ${p("fill")};
  let shade = ${p("shade")};
  return premultiply(mix(shade.rgb, fill.rgb, stockTone), mix(shade.a, fill.a, stockTone));
`,
});

const halftoneCmyk = catalogShader({
  id: "halftone-cmyk",
  name: "Halftone CMYK",
  kind: "processor",
  edgeSampling: "fixed-clamp",
  properties: {
    inks: {
      type: "color-array",
      label: "Ink",
      maxCount: 8,
      default: [
        catalogColor(0, 0.62, 0.77),
        catalogColor(0.88, 0.06, 0.45),
        catalogColor(0.99, 0.77, 0.06),
        catalogColor(0.035, 0.04, 0.05),
      ],
    },
    sheet: {
      type: "color",
      label: "Fill",
      default: catalogColor(0.98, 0.97, 0.92),
    },
    cellSize: px("Cell size", 7, 32),
    angle: catalogFloat("Angle", Math.PI / 12, 0, Math.PI / 2),
    contrast: pct("Contrast", 1, 2),
  },
  helpers: (p, slot) => `
fn cmykDotCoverage(pixel: vec2f, angle: f32, inkAmount: f32, cellSize: f32) -> f32 {
  let rotated = rotate(pixel, angle);
  let center = (floor(rotated / cellSize) + vec2f(0.5)) * cellSize;
  let radius = sqrt(clamp(inkAmount, 0.0, 1.0)) * cellSize * 0.49;
  return 1.0 - smoothstep(radius - 0.8, radius + 0.8, length(rotated - center));
}
fn cmykInk(index: u32) -> vec4f {
  return globals.params[${slot("inks") + 1}u + index];
}
`,
  fragment: (p) => `
  let source = sampleSource(input.uv);
  let rgb = clamp((straight(source) - vec3f(0.5)) * ${p("contrast")}.x + vec3f(0.5), vec3f(0.0), vec3f(1.0));
  let black = 1.0 - max(rgb.r, max(rgb.g, rgb.b));
  let denominator = max(1.0 - black, 0.0001);
  let inkAmounts = vec4f((1.0 - rgb.r - black) / denominator, (1.0 - rgb.g - black) / denominator, (1.0 - rgb.b - black) / denominator, black);
  let pixel = input.uv * globals.viewport.xy;
  let angle = ${p("angle")}.x;
  let cellSize = max(${p("cellSize")}.x * globals.clock.z, 1.0);
  let coverage = vec4f(
    cmykDotCoverage(pixel, angle, inkAmounts.x, cellSize),
    cmykDotCoverage(pixel, angle + 1.0471976, inkAmounts.y, cellSize),
    cmykDotCoverage(pixel, angle + 2.0943951, inkAmounts.z, cellSize),
    cmykDotCoverage(pixel, angle + 0.5235988, inkAmounts.w, cellSize)
  );
  var color = ${p("sheet")}.rgb;
  for (var channel = 0u; channel < 4u; channel += 1u) {
    let ink = cmykInk(channel);
    color = mix(color, ink.rgb, coverage[channel] * ink.a);
  }
  return premultiply(color, source.a);
`,
});

export const lensDistortion = catalogShader({
  id: "lens-distortion",
  name: "Lens Distortion",
  kind: "processor",
  backdrop: true,
  edgeSampling: "fixed-clamp",
  properties: {
    distortion: pct("Distortion", 0.28, 1),
    dispersion: px("Distance", 1.5, 12),
    angle: catalogFloat("Angle", 0, 0, Math.PI * 2),
    amount: pct("Amount", 1),
  },
  fragment: (p) => `
  let original = sampleSource(input.uv);
  let aspect = vec2f(globals.viewport.x / max(globals.viewport.y, 1.0), 1.0);
  let centered = (input.uv - vec2f(0.5)) * aspect * 2.0;
  let radiusSquared = dot(centered, centered);
  let curvature = ${p("distortion")}.x;
  let warpedUv = (centered * (1.0 + radiusSquared * curvature) / aspect + 1.0) * 0.5;
  let radial = normalize(centered + vec2f(0.00001));
  let direction = rotate(radial, ${p("angle")}.x);
  let offset = direction * ${p("dispersion")}.x * globals.viewport.zw * radiusSquared;
  let red = sampleSource(warpedUv + offset);
  let green = sampleSource(warpedUv);
  let blue = sampleSource(warpedUv - offset);
  let separated = vec4f(red.r, green.g, blue.b, max(red.a, max(green.a, blue.a)));
  let lens = mix(original, separated, ${p("amount")}.x);
  return vec4f(lens.rgb, lens.a);
`,
});

export const water = catalogShader({
  id: "water",
  name: "Water",
  kind: "processor",
  backdrop: true,
  edgeSampling: "fixed-clamp",
  properties: {
    distortion: px("Refraction", 5, 24),
    scale: catalogFloat("Scale", 1.8, 0.4, 5),
    highlights: pct("Highlight", 0.24),
    movement: pct("Movement", 0.35, 2),
    tint: {
      type: "color",
      label: "Tint",
      default: catalogColor(0.58, 0.82, 0.91, 0.15),
    },
  },
  fragment: (p) => `
  let uv = input.uv;
  let aspect = vec2f(globals.viewport.x / max(globals.viewport.y, 1.0), 1.0);
  let q = (uv - vec2f(0.5)) * aspect * ${p("scale")}.x * 5.0;
  let phase = globals.clock.x * ${p("movement")}.x;
  let a = fractalNoise(q + vec2f(phase * 0.18, -phase * 0.12));
  let b = fractalNoise(q * 1.65 + vec2f(8.7, -3.1) - vec2f(phase * 0.09, phase * 0.15));
  let grad = vec2f(dpdx(a + b * 0.42), dpdy(a + b * 0.42));
  let shift = grad * ${p("distortion")}.x * globals.viewport.zw * 42.0;
  let source = sampleSource(uv);
  let refracted = sampleSource(uv + shift);
  let caustic = pow(clamp(1.0 - abs(a - b), 0.0, 1.0), 10.0) * ${p("highlights")}.x;
  let tint = ${p("tint")};
  var color = mix(refracted.rgb, tint.rgb * refracted.a, tint.a);
  color += vec3f(caustic) * refracted.a;
  return vec4f(mix(source.rgb, color, 0.86), source.a);
`,
});

const heatmap = catalogShader({
  id: "heatmap",
  name: "Heatmap",
  kind: "generator",
  properties: {
    palette: {
      type: "color-array",
      label: "Palette",
      default: thermalPalette,
      maxCount: 8,
    },
    scale: catalogFloat("Scale", 1, 0.25, 4),
    detail: catalogFloat("Detail", 4.5, 1, 14),
    contour: pct("Contour", 0.45),
    movement: pct("Movement", 0.25),
  },
  fragment: (p) => `
  let uv = input.uv;
  let phase = globals.clock.x * ${p("movement")}.x;
  let point = (uv - vec2f(0.5)) * ${p("scale")}.x;
  let flow = vec2f(
    fractalNoise(point * ${p("detail")}.x + vec2f(phase * 0.18, 2.4)),
    fractalNoise(point * ${p("detail")}.x + vec2f(7.2, -phase * 0.2))
  );
  let wave = 0.5 + 0.5 * sin((point.x + flow.x * ${p("contour")}.x) * 7.0 + (point.y + flow.y * ${p("contour")}.x) * 4.0 + phase);
  let temperature = clamp(0.58 * wave + 0.42 * fractalNoise(point * 2.0 + flow * 1.5), 0.0, 1.0);
  return paletteAt(temperature);
`,
});

const gemSmoke = catalogShader({
  id: "gem-smoke",
  name: "Gem Smoke",
  kind: "generator",
  properties: {
    palette: {
      type: "color-array",
      label: "Palette",
      default: gemPalette,
      maxCount: 8,
    },
    scale: catalogFloat("Scale", 1.25, 0.3, 4),
    detail: catalogFloat("Detail", 5, 1, 14),
    distortion: pct("Distortion", 0.38),
    movement: pct("Movement", 0.3),
  },
  fragment: (p) => `
  let uv = input.uv;
  let aspect = vec2f(globals.viewport.x / max(globals.viewport.y, 1.0), 1.0);
  let q = (uv - vec2f(0.5)) * aspect * ${p("scale")}.x * 3.1;
  let phase = globals.clock.x * ${p("movement")}.x;
  let warp = vec2f(
    fractalNoise(q * 1.7 + vec2f(phase * 0.16, 4.2)),
    fractalNoise(q * 1.7 + vec2f(-3.8, -phase * 0.13))
  ) - vec2f(0.5);
  let field = fractalNoise(q * ${p("detail")}.x + warp * ${p("distortion")}.x * 4.0 + vec2f(phase * 0.08, -phase * 0.11));
  let facets = 0.5 + 0.5 * sin(atan2(q.y + warp.y, q.x + warp.x) * 5.0 + field * 8.0);
  let density = clamp(field * 0.74 + facets * 0.26, 0.0, 1.0);
  let color = paletteAt(density);
  let glint = pow(max(0.0, cos(density * 31.0 + facets * 5.0)), 18.0) * 0.2;
  return vec4f(color.rgb + vec3f(glint), color.a);
`,
});

const dotOrbit = catalogShader({
  id: "dot-orbit",
  name: "Dot Orbit",
  kind: "generator",
  properties: {
    palette: catalogPalette(),
    detail: catalogFloat("Detail", 7, 2, 18, 1),
    size: pct("Size", 0.26, 0.48),
    amplitude: pct("Amplitude", 0.16, 0.4),
    movement: pct("Movement", 0.5),
  },
  fragment: (p) => `
  let detail = max(${p("detail")}.x, 1.0);
  let grid = input.uv * detail;
  let cell = vec2i(floor(grid));
  let local = fract(grid) - vec2f(0.5);
  let seed = random(cell);
  let phase = globals.clock.x * ${p("movement")}.x + seed * 6.2831853;
  let orbit = ${p("amplitude")}.x * (0.5 + 0.5 * sin(phase * 0.57 + seed * 3.0));
  let center = vec2f(cos(phase), sin(phase * 1.31)) * orbit;
  let radius = ${p("size")}.x * 0.46;
  let distance = length(local - center);
  let coverage = 1.0 - smoothstep(radius - fwidth(distance), radius + fwidth(distance), distance);
  let color = paletteAt(seed);
  return mix(paletteAt(0.0), color, coverage);
`,
});

const dotGrid = catalogShader({
  id: "dot-grid",
  name: "Dot Grid",
  kind: "generator",
  properties: {
    palette: catalogPalette(),
    detail: catalogFloat("Detail", 18, 4, 56, 1),
    size: pct("Size", 0.3, 0.48),
    rotation: catalogFloat("Rotation", 0, -Math.PI, Math.PI),
    softness: pct("Softness", 0.08, 0.5),
  },
  fragment: (p) => `
  let point = rotate(input.uv - vec2f(0.5), ${p("rotation")}.x) * ${p("detail")}.x;
  let cell = floor(point);
  let local = fract(point) - vec2f(0.5);
  let distance = length(local);
  let radius = ${p("size")}.x * 0.48;
  let edge = max(${p("softness")}.x * 0.12, fwidth(distance));
  let coverage = 1.0 - smoothstep(radius - edge, radius + edge, distance);
  return mix(paletteAt(0.0), paletteAt(1.0), coverage);
`,
});

const spiral = catalogShader({
  id: "spiral",
  name: "Spiral",
  kind: "generator",
  properties: {
    palette: catalogPalette(),
    frequency: catalogFloat("Frequency", 5, 1, 16, 1),
    scale: catalogFloat("Scale", 1.2, 0.4, 3.5),
    softness: pct("Softness", 0.08, 0.5),
    movement: pct("Movement", 0.2),
    rotation: catalogFloat("Rotation", 0, -Math.PI, Math.PI),
  },
  fragment: (p) => `
  let q = rotate((input.uv - vec2f(0.5)) * ${p("scale")}.x * 2.8, ${p("rotation")}.x);
  let radius = length(q);
  let angle = atan2(q.y, q.x);
  let phase = globals.clock.x * ${p("movement")}.x;
  let turns = ${p("frequency")}.x;
  let spiral = angle / 6.2831853 + radius * turns - phase * 0.06;
  let ribbon = 0.5 + 0.5 * cos(spiral * 6.2831853);
  let softened = mix(ribbon, smoothstep(0.25, 0.75, ribbon), ${p("softness")}.x);
  return paletteAt(fract(spiral * 0.2 + softened * 0.52));
`,
});

const neuroNoise = catalogShader({
  id: "neuro-noise",
  name: "Neuro Noise",
  kind: "generator",
  properties: {
    palette: catalogPalette(),
    scale: catalogFloat("Scale", 1, 0.25, 4),
    detail: catalogFloat("Detail", 6, 1, 16),
    distortion: pct("Distortion", 0.32),
    movement: pct("Movement", 0.22),
  },
  fragment: (p) => `
  let uv = input.uv;
  let q = (uv - vec2f(0.5)) * ${p("scale")}.x * 5.0;
  let phase = globals.clock.x * ${p("movement")}.x;
  let warp = vec2f(
    fractalNoise(q * 1.3 + vec2f(phase * 0.11, 2.7)),
    fractalNoise(q * 1.3 + vec2f(6.4, -phase * 0.14))
  ) - vec2f(0.5);
  let network = fractalNoise(q * ${p("detail")}.x + warp * ${p("distortion")}.x * 5.0 + vec2f(phase * 0.08));
  let branch = abs(sin((q.x + warp.x) * 7.0 + sin((q.y + warp.y) * 4.0 + phase) * 2.1 + network * 4.0));
  let line = 1.0 - smoothstep(0.05, 0.29, branch);
  let density = clamp(network * 0.55 + line * 0.45, 0.0, 1.0);
  return paletteAt(density);
`,
});

const perlinNoise = catalogShader({
  id: "perlin-noise",
  name: "Perlin Noise",
  kind: "generator",
  properties: {
    palette: catalogPalette(),
    scale: catalogFloat("Scale", 1, 0.25, 4),
    detail: catalogFloat("Detail", 4, 1, 7, 1),
    contrast: pct("Contrast", 1, 2),
    movement: pct("Movement", 0.18),
  },
  helpers: () => `
fn perlinGradientNoise(point: vec2f) -> f32 {
  let cell = vec2i(floor(point));
  let local = fract(point);
  let fade = local * local * local * (local * (local * 6.0 - 15.0) + 10.0);
  var corners = array<vec2i, 4>(cell, cell + vec2i(1, 0), cell + vec2i(0, 1), cell + vec2i(1, 1));
  var offsets = array<vec2f, 4>(local, local - vec2f(1.0, 0.0), local - vec2f(0.0, 1.0), local - vec2f(1.0));
  var dots: array<f32, 4>;
  for (var index = 0u; index < 4u; index += 1u) {
    let angle = random(corners[index]) * TAU;
    dots[index] = dot(vec2f(cos(angle), sin(angle)), offsets[index]);
  }
  let lower = mix(dots[0], dots[1], fade.x);
  let upper = mix(dots[2], dots[3], fade.x);
  return clamp(0.5 + mix(lower, upper, fade.y) * 0.72, 0.0, 1.0);
}
fn octavePerlin(point: vec2f, requested: f32) -> f32 {
  var sum = 0.0; var weight = 0.5; var total = 0.0; var q = point;
  for (var octave = 0u; octave < 7u; octave += 1u) {
    if (f32(octave) < requested) { sum += perlinGradientNoise(q) * weight; total += weight; }
    q = vec2f(q.x * 1.63 - q.y * 1.21, q.x * 1.21 + q.y * 1.63) + vec2f(11.7, 3.4);
    weight *= 0.5;
  }
  return sum / max(total, 0.0001);
}
`,
  fragment: (p) => `
  let phase = globals.clock.x * ${p("movement")}.x;
  let q = (input.uv - vec2f(0.5)) * ${p("scale")}.x * 6.0 + vec2f(phase * 0.12, -phase * 0.08);
  let noise = octavePerlin(q, ${p("detail")}.x);
  let contrast = (noise - 0.5) * ${p("contrast")}.x + 0.5;
  return paletteAt(clamp(contrast, 0.0, 1.0));
`,
});

const simplexNoise = catalogShader({
  id: "simplex-noise",
  name: "Simplex Noise",
  kind: "generator",
  properties: {
    palette: catalogPalette(),
    scale: catalogFloat("Scale", 1, 0.25, 4),
    detail: catalogFloat("Detail", 3.5, 1, 7, 1),
    movement: pct("Movement", 0.18),
    contrast: pct("Contrast", 1, 2),
  },
  helpers: () => `
fn simplexCorner(point: vec2f, lattice: vec2i) -> f32 {
  let attenuation = max(0.5 - dot(point, point), 0.0);
  let angle = random(lattice) * TAU;
  let gradient = vec2f(cos(angle), sin(angle));
  return attenuation * attenuation * attenuation * attenuation * dot(gradient, point);
}
fn simplexNoise2(point: vec2f) -> f32 {
  let skew = (point.x + point.y) * 0.3660254;
  let cell = vec2i(floor(point + vec2f(skew)));
  let unskew = f32(cell.x + cell.y) * 0.21132487;
  let first = point - vec2f(f32(cell.x) - unskew, f32(cell.y) - unskew);
  let step = select(vec2i(0, 1), vec2i(1, 0), first.x > first.y);
  let second = first - vec2f(step) + vec2f(0.21132487);
  let third = first - vec2f(1.0) + vec2f(0.42264974);
  let value = simplexCorner(first, cell) + simplexCorner(second, cell + step) + simplexCorner(third, cell + vec2i(1, 1));
  return clamp(0.5 + value * 36.0, 0.0, 1.0);
}
fn octaveSimplex(point: vec2f, requested: f32) -> f32 {
  var sum = 0.0; var weight = 0.5; var total = 0.0; var q = point;
  for (var octave = 0u; octave < 7u; octave += 1u) {
    if (f32(octave) < requested) { sum += simplexNoise2(q) * weight; total += weight; }
    q = vec2f(q.x * 1.58 - q.y * 1.26, q.x * 1.26 + q.y * 1.58) + vec2f(7.1, 13.6);
    weight *= 0.5;
  }
  return sum / max(total, 0.0001);
}
`,
  fragment: (p) => `
  let phase = globals.clock.x * ${p("movement")}.x;
  let q = (input.uv - vec2f(0.5)) * ${p("scale")}.x * 6.0 + vec2f(-phase * 0.1, phase * 0.13);
  let noise = octaveSimplex(q, ${p("detail")}.x);
  let contrast = (noise - 0.5) * ${p("contrast")}.x + 0.5;
  return paletteAt(clamp(contrast, 0.0, 1.0));
`,
});

const pulsingBorder = catalogShader({
  id: "pulsing-border",
  name: "Pulsing Border",
  kind: "processor",
  backdrop: true,
  edgeSampling: "fixed-clamp",
  properties: {
    tint: {
      type: "color",
      label: "Tint",
      default: catalogColor(0.31, 0.88, 1),
    },
    thickness: px("Thickness", 3, 24),
    softness: pct("Softness", 0.25),
    intensity: pct("Intensity", 0.72),
    movement: pct("Movement", 0.42),
  },
  fragment: (p) => `
  let uv = input.uv;
  let original = sampleSource(uv);
  let step = ${p("thickness")}.x * globals.clock.z * globals.viewport.zw;
  var neighbor = 0.0;
  var inner = 1.0;
  for (var index = 0u; index < 8u; index += 1u) {
    let angle = f32(index) * 0.78539816;
    let offset = vec2f(cos(angle), sin(angle)) * step;
    let alpha = sampleSource(uv + offset).a;
    neighbor = max(neighbor, alpha);
    inner = min(inner, alpha);
  }
  let edge = max(neighbor - original.a, original.a - inner);
  let softened = smoothstep(0.02, 0.25 + ${p("softness")}.x * 0.5, edge);
  let phase = 0.72 + 0.28 * sin(globals.clock.x * ${p("movement")}.x * 2.0);
  let overlay = softened * ${p("intensity")}.x * phase;
  let tint = ${p("tint")};
  let alpha = max(original.a, overlay * tint.a);
  let color = mix(straight(original), tint.rgb, overlay);
  return premultiply(color, alpha);
`,
});

const colorPanels = catalogShader({
  id: "color-panels",
  name: "Color Panels",
  kind: "generator",
  properties: {
    palette: catalogPalette(),
    detail: catalogFloat("Detail", 5, 2, 12, 1),
    softness: pct("Softness", 0.035, 0.25),
    movement: pct("Movement", 0.12),
    rotation: catalogFloat("Rotation", 0, -Math.PI, Math.PI),
  },
  fragment: (p) => `
  let q = rotate(input.uv - vec2f(0.5), ${p("rotation")}.x) + vec2f(0.5);
  let grid = q * vec2f(${p("detail")}.x, max(2.0, ${p("detail")}.x * 0.72));
  let cell = vec2i(floor(grid));
  let local = fract(grid);
  let seed = random(cell);
  let color = paletteAt(seed);
  let seam = min(min(local.x, 1.0 - local.x), min(local.y, 1.0 - local.y));
  let border = 1.0 - smoothstep(${p("softness")}.x, ${p("softness")}.x + fwidth(seam), seam);
  let phase = globals.clock.x * ${p("movement")}.x;
  let shade = 0.92 + 0.08 * sin(phase + seed * 6.2831853 + local.x * 1.4);
  return mix(color * shade, paletteAt(0.0), border * 0.42);
`,
});

const smokeRing = catalogShader({
  id: "smoke-ring",
  name: "Smoke Ring",
  kind: "generator",
  properties: {
    palette: {
      type: "color-array",
      label: "Palette",
      default: smokePalette,
      maxCount: 8,
    },
    scale: catalogFloat("Scale", 1, 0.3, 3),
    detail: catalogFloat("Detail", 5, 1, 14),
    softness: pct("Softness", 0.26),
    movement: pct("Movement", 0.28),
  },
  fragment: (p) => `
  let uv = input.uv;
  let aspect = vec2f(globals.viewport.x / max(globals.viewport.y, 1.0), 1.0);
  let q = (uv - vec2f(0.5)) * aspect * ${p("scale")}.x * 2.6;
  let phase = globals.clock.x * ${p("movement")}.x;
  let drift = vec2f(phase * 0.08, -phase * 0.11);
  let warp = fractalNoise(q * 2.0 + drift) - 0.5;
  let field = fractalNoise(q * ${p("detail")}.x + vec2f(4.3, 9.1) + drift * 1.8);
  let radius = length(q) + (field - 0.5) * 0.16;
  let ring = exp(-pow((radius - 0.42 - warp * 0.05) / max(${p("softness")}.x * 0.46, 0.025), 2.0));
  let wisps = clamp(ring * (0.52 + field * 0.78), 0.0, 1.0);
  return paletteAt(wisps);
`,
});

const godRays = catalogShader({
  id: "god-rays",
  name: "God Rays",
  kind: "generator",
  properties: {
    palette: catalogPalette([
      catalogColor(0.035, 0.055, 0.16, 0),
      catalogColor(0.1, 0.24, 0.48, 0.34),
      catalogColor(0.53, 0.75, 0.96, 0.92),
    ]),
    scale: catalogFloat("Scale", 1, 0.3, 3),
    detail: catalogFloat("Detail", 18, 4, 48, 1),
    angle: catalogFloat("Angle", Math.PI / 2, 0, Math.PI * 2),
    intensity: pct("Intensity", 0.72),
    movement: pct("Movement", 0.12),
  },
  fragment: (p) => `
  let uv = input.uv;
  let center = vec2f(0.5, 0.14);
  let delta = uv - center;
  let angle = atan2(delta.y, delta.x) + ${p("angle")}.x;
  let phase = globals.clock.x * ${p("movement")}.x;
  let rays = pow(0.5 + 0.5 * cos(angle * ${p("detail")}.x + phase), 9.0);
  let distance = length(delta);
  let atmosphere = exp(-distance * 2.2) * ${p("intensity")}.x;
  let cloud = fractalNoise(uv * 5.0 + vec2f(phase * 0.04, -phase * 0.03));
  let energy = clamp(atmosphere * rays * (0.75 + cloud * 0.5), 0.0, 1.0);
  return paletteAt(energy);
`,
});

export const NATIVE_EFFECT_GALLERY_ADDITIONS: readonly EffectDefinition[] = [
  fiberTexture,
  texturedStock,
  halftoneCmyk,
  lensDistortion,
  water,
  heatmap,
  gemSmoke,
  dotOrbit,
  dotGrid,
  spiral,
  neuroNoise,
  perlinNoise,
  simplexNoise,
  pulsingBorder,
  colorPanels,
  smokeRing,
  godRays,
];
