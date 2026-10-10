import {
  CATALOG_EDGE,
  catalogFloat as f,
  catalogPalette,
  catalogShader,
  type CatalogShaderSpec,
} from "./native-effect-catalog-kit";
import type { EffectProperty } from "./native-effects";

function properties(
  extra: Record<string, EffectProperty> = {},
): Record<string, EffectProperty> {
  return {
    amount: f("Amount", 1, 0, 1),
    ...extra,
    edge: structuredClone(CATALOG_EDGE),
  };
}

const source = `
  let uv = input.uv;
  let original = sampleSource(uv);
  if (globals.params[0].x == 0.0) { return original; }
  let rgb = straight(original);
`;
const blend = (p: (name: string) => string, result: string) =>
  `\n  return mix(original, ${result}, ${p("amount")}.x);\n`;

const specs: CatalogShaderSpec[] = [
  {
    id: "color-grade",
    name: "Color Grade",
    kind: "processor",
    backdrop: true,
    properties: properties({
      exposure: f("Exposure", 0.25, -3, 3),
      contrast: f("Contrast", 1.1, 0, 3),
      saturation: f("Saturation", 1.1, 0, 3),
      warmth: f("Warmth", 0.08, -1, 1),
    }),
    fragment: (p) =>
      source +
      `
  let exposed = rgb * exp2(${p("exposure")}.x);
  let contrasted = (exposed - 0.18) * ${p("contrast")}.x + 0.18;
  let saturated = mix(vec3f(luminance(contrasted)), contrasted, ${p("saturation")}.x);
  let graded = saturated * vec3f(1.0 + ${p("warmth")}.x * 0.2, 1.0, 1.0 - ${p("warmth")}.x * 0.2);
` +
      blend(p, "premultiply(graded, original.a)"),
  },
  {
    id: "palette-map",
    name: "Palette Map",
    kind: "processor",
    backdrop: true,
    properties: properties({
      palette: catalogPalette(),
      contrast: f("Contrast", 1, 0.1, 3),
    }),
    fragment: (p) =>
      source +
      `
  let value = clamp((luminance(rgb) - 0.5) * ${p("contrast")}.x + 0.5, 0.0, 1.0);
  let mapped = paletteAt(value) * original.a;
` +
      blend(p, "mapped"),
  },
  {
    id: "posterize",
    name: "Posterize",
    kind: "processor",
    backdrop: true,
    properties: properties({
      levels: {
        type: "int",
        label: "Levels",
        default: 5,
        min: 2,
        max: 32,
        step: 1,
      },
    }),
    fragment: (p) =>
      source +
      `
  let levels = ${p("levels")}.x - 1.0;
  let quantized = floor(clamp(rgb, vec3f(0.0), vec3f(1.0)) * levels + 0.5) / levels;
` +
      blend(p, "premultiply(quantized, original.a)"),
  },
  {
    id: "threshold",
    name: "Threshold",
    kind: "processor",
    backdrop: true,
    properties: properties({
      palette: catalogPalette(),
      threshold: f("Threshold", 0.4, 0, 1),
      softness: f("Softness", 0.015, 0.001, 0.3),
    }),
    fragment: (p) =>
      source +
      `
  let value = smoothstep(${p("threshold")}.x - ${p("softness")}.x, ${p("threshold")}.x + ${p("softness")}.x, luminance(rgb));
` +
      blend(p, "paletteAt(value) * original.a"),
  },
  {
    id: "ordered-dither",
    name: "Ordered Dither",
    kind: "processor",
    backdrop: true,
    properties: properties({
      palette: catalogPalette(),
      cellSize: f("Cell size", 3, 1, 16, 0.1),
    }),
    helpers: () => `
const BAYER: array<f32, 16> = array<f32, 16>(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
`,
    fragment: (p) =>
      source +
      `
  let cell = vec2u(floor(uv * globals.viewport.xy / max(${p("cellSize")}.x * globals.clock.z, 1.0))) % vec2u(4u);
  let threshold = (BAYER[cell.y * 4u + cell.x] + 0.5) / 16.0;
  let value = select(0.0, 1.0, luminance(rgb) >= threshold);
` +
      blend(p, "paletteAt(value) * original.a"),
  },
  {
    id: "sobel-edges",
    name: "Sobel Edges",
    kind: "processor",
    backdrop: true,
    properties: properties({
      palette: catalogPalette(),
      radius: f("Radius", 1, 0.25, 4),
      strength: f("Strength", 2, 0, 8),
    }),
    fragment: (p) =>
      source +
      `
  let step = globals.viewport.zw * ${p("radius")}.x * globals.clock.z;
  let a = luminance(straight(sampleSource(uv + step * vec2f(-1.0, -1.0))));
  let b = luminance(straight(sampleSource(uv + step * vec2f(0.0, -1.0))));
  let c = luminance(straight(sampleSource(uv + step * vec2f(1.0, -1.0))));
  let d = luminance(straight(sampleSource(uv + step * vec2f(-1.0, 0.0))));
  let e = luminance(straight(sampleSource(uv + step * vec2f(1.0, 0.0))));
  let f = luminance(straight(sampleSource(uv + step * vec2f(-1.0, 1.0))));
  let g = luminance(straight(sampleSource(uv + step * vec2f(0.0, 1.0))));
  let h = luminance(straight(sampleSource(uv + step * vec2f(1.0, 1.0))));
  let gradient = vec2f(-a - 2.0 * d - f + c + 2.0 * e + h, -a - 2.0 * b - c + f + 2.0 * g + h);
` +
      blend(
        p,
        `paletteAt(clamp(length(gradient) * ${p("strength")}.x, 0.0, 1.0)) * original.a`,
      ),
  },
  {
    id: "emboss",
    name: "Emboss",
    kind: "processor",
    backdrop: true,
    properties: properties({
      radius: f("Radius", 2, 0.25, 8),
      angle: f("Angle", 0.7, -3.14159, 3.14159),
      strength: f("Strength", 2, 0, 8),
    }),
    fragment: (p) =>
      source +
      `
  let direction = vec2f(cos(${p("angle")}.x), sin(${p("angle")}.x)) * ${p("radius")}.x * globals.clock.z * globals.viewport.zw;
  let light = luminance(straight(sampleSource(uv + direction))) - luminance(straight(sampleSource(uv - direction)));
  let embossed = vec3f(0.5 + light * ${p("strength")}.x);
` +
      blend(p, "premultiply(embossed, original.a)"),
  },
  {
    id: "sharpen",
    name: "Sharpen",
    kind: "processor",
    backdrop: true,
    properties: properties({
      radius: f("Radius", 1, 0.25, 4),
      strength: f("Strength", 0.8, 0, 3),
    }),
    fragment: (p) =>
      source +
      `
  let step = globals.viewport.zw * ${p("radius")}.x * globals.clock.z;
  let blurred = (sampleSource(uv + vec2f(step.x, 0.0)) + sampleSource(uv - vec2f(step.x, 0.0)) + sampleSource(uv + vec2f(0.0, step.y)) + sampleSource(uv - vec2f(0.0, step.y))) * 0.25;
  let sharpened = rgb + (rgb - straight(blurred)) * ${p("strength")}.x;
` +
      blend(p, "premultiply(sharpened, original.a)"),
  },
  {
    id: "pixelate",
    name: "Pixelate",
    kind: "processor",
    backdrop: true,
    properties: properties({ cellSize: f("Cell size", 12, 1, 80, 0.1) }),
    fragment: (p) =>
      source +
      `
  let cell = ${p("cellSize")}.x * globals.clock.z;
  let center = (floor(uv * globals.viewport.xy / cell) + 0.5) * cell * globals.viewport.zw;
  let pixelated = sampleSource(center);
` +
      blend(p, "pixelated"),
  },
  {
    id: "crt-display",
    name: "CRT Display",
    kind: "processor",
    backdrop: true,
    properties: properties({
      curvature: f("Curvature", 0.12, 0, 0.5),
      scanlines: f("Scanlines", 0.22, 0, 0.8),
      pitch: f("Pitch", 3, 1, 12, 0.1),
    }),
    fragment: (p) =>
      source +
      `
  let centered = uv * 2.0 - 1.0;
  let warped = (centered * (1.0 + dot(centered, centered) * ${p("curvature")}.x) + 1.0) * 0.5;
  let sampled = sampleSource(warped);
  let pixel = uv * globals.viewport.xy / globals.clock.z;
  let scan = 1.0 - ${p("scanlines")}.x * (0.5 + 0.5 * cos(pixel.y * TAU / ${p("pitch")}.x));
  let channel = u32(floor(pixel.x)) % 3u;
  var phosphor = vec3f(0.82); phosphor[channel] = 1.0;
` +
      blend(p, "vec4f(sampled.rgb * phosphor * scan, sampled.a)"),
  },
  {
    id: "chromatic-aberration",
    name: "Chromatic Aberration",
    kind: "processor",
    backdrop: true,
    properties: properties({
      distance: f("Distance", 4, 0, 30),
      angle: f("Angle", 0, -3.14159, 3.14159),
    }),
    fragment: (p) =>
      source +
      `
  let offset = vec2f(cos(${p("angle")}.x), sin(${p("angle")}.x)) * ${p("distance")}.x * globals.clock.z * globals.viewport.zw;
  let red = sampleSource(uv + offset); let blue = sampleSource(uv - offset);
  let alpha = max(original.a, max(red.a, blue.a));
  let separated = vec3f(red.r, original.g, blue.b);
` +
      blend(p, "vec4f(min(separated, vec3f(alpha)), alpha)"),
  },
  {
    id: "barrel-distortion",
    name: "Barrel Distortion",
    kind: "processor",
    backdrop: true,
    properties: properties({
      distortion: f("Distortion", 0.4, -0.8, 1.5),
      zoom: f("Zoom", 1, 0.5, 2),
    }),
    fragment: (p) =>
      source +
      `
  let centered = (uv - 0.5) / ${p("zoom")}.x;
  let displaced = centered * (1.0 + dot(centered, centered) * ${p("distortion")}.x * 4.0) + 0.5;
` +
      blend(p, "sampleSource(displaced)"),
  },
  {
    id: "swirl",
    name: "Swirl",
    kind: "processor",
    backdrop: true,
    properties: properties({
      angle: f("Angle", 1.6, -6.28318, 6.28318),
      radius: f("Radius", 0.6, 0.05, 1.5),
    }),
    fragment: (p) =>
      source +
      `
  let aspect = vec2f(globals.viewport.x / max(globals.viewport.y, 1.0), 1.0);
  let centered = (uv - 0.5) * aspect;
  let falloff = max(1.0 - length(centered) / ${p("radius")}.x, 0.0);
  let displaced = rotate(centered, ${p("angle")}.x * falloff * falloff) / aspect + 0.5;
` +
      blend(p, "sampleSource(displaced)"),
  },
  {
    id: "kaleidoscope",
    name: "Kaleidoscope",
    kind: "processor",
    backdrop: true,
    properties: properties({
      segments: {
        type: "int",
        label: "Segments",
        default: 6,
        min: 2,
        max: 24,
        step: 1,
      },
      angle: f("Angle", 0.2, -3.14159, 3.14159),
      zoom: f("Zoom", 1, 0.25, 3),
    }),
    fragment: (p) =>
      source +
      `
  let centered = (uv - 0.5) / ${p("zoom")}.x;
  let wedge = TAU / ${p("segments")}.x;
  let angle = atan2(centered.y, centered.x) + ${p("angle")}.x;
  let folded = abs((angle - floor(angle / wedge) * wedge) - wedge * 0.5);
  let radius = length(centered);
` +
      blend(p, "sampleSource(vec2f(cos(folded), sin(folded)) * radius + 0.5)"),
  },
  {
    id: "ripple-distortion",
    name: "Ripple Distortion",
    kind: "processor",
    backdrop: true,
    properties: properties({
      distance: f("Distance", 8, 0, 40),
      frequency: f("Frequency", 30, 1, 100),
      movement: f("Movement", 0.5, 0, 3),
    }),
    fragment: (p) =>
      source +
      `
  let centered = uv - 0.5; let radius = length(centered);
  let direction = centered / max(radius, 0.00001);
  let wave = sin(radius * ${p("frequency")}.x - globals.clock.x * ${p("movement")}.x * TAU);
  let offset = direction * wave * ${p("distance")}.x * globals.clock.z * globals.viewport.zw;
` +
      blend(p, "sampleSource(uv + offset)"),
  },
  {
    id: "noise-displacement",
    name: "Noise Displacement",
    kind: "processor",
    backdrop: true,
    properties: properties({
      distance: f("Distance", 16, 0, 60),
      scale: f("Scale", 6, 0.5, 32),
      movement: f("Movement", 0.3, 0, 3),
    }),
    fragment: (p) =>
      source +
      `
  let position = uv * ${p("scale")}.x + vec2f(globals.clock.x * ${p("movement")}.x);
  let noise = vec2f(fractalNoise(position), fractalNoise(position + vec2f(37.0, 17.0))) * 2.0 - 1.0;
  let offset = noise * ${p("distance")}.x * globals.clock.z * globals.viewport.zw;
` +
      blend(p, "sampleSource(uv + offset)"),
  },
  {
    id: "vignette",
    name: "Vignette",
    kind: "processor",
    backdrop: true,
    properties: properties({
      radius: f("Radius", 0.7, 0.1, 1.5),
      softness: f("Softness", 0.45, 0.01, 1),
    }),
    fragment: (p) =>
      source +
      `
  let distance = length((uv - 0.5) * 1.4142136);
  let darkness = smoothstep(${p("radius")}.x - ${p("softness")}.x, ${p("radius")}.x, distance);
` +
      blend(p, "vec4f(original.rgb * (1.0 - darkness * 0.85), original.a)"),
  },
  {
    id: "film-grain",
    name: "Film Grain",
    kind: "processor",
    backdrop: true,
    properties: properties({
      strength: f("Strength", 0.15, 0, 0.6),
      size: f("Size", 1, 0.5, 8),
      movement: f("Movement", 1, 0, 3),
    }),
    fragment: (p) =>
      source +
      `
  let cell = vec2i(floor(uv * globals.viewport.xy / (${p("size")}.x * globals.clock.z)));
  let frame = i32(floor(globals.clock.x * ${p("movement")}.x * 24.0));
  let grain = random(cell + vec2i(frame * 101, frame * 313)) - 0.5;
  let response = sqrt(max(luminance(rgb), 0.0)) * ${p("strength")}.x;
` +
      blend(p, "premultiply(rgb + grain * response, original.a)"),
  },
  {
    id: "crosshatch",
    name: "Crosshatch",
    kind: "processor",
    backdrop: true,
    properties: properties({
      palette: catalogPalette(),
      cellSize: f("Cell size", 6, 2, 30),
      angle: f("Angle", 0.785398, -3.14159, 3.14159),
      thickness: f("Thickness", 0.15, 0.02, 0.45),
    }),
    fragment: (p) =>
      source +
      `
  let point = rotate(uv * globals.viewport.xy / globals.clock.z, ${p("angle")}.x) / ${p("cellSize")}.x;
  let light = luminance(rgb);
  let lineA = 1.0 - smoothstep(${p("thickness")}.x, ${p("thickness")}.x + 0.08, abs(fract(point.x) - 0.5));
  let lineB = 1.0 - smoothstep(${p("thickness")}.x, ${p("thickness")}.x + 0.08, abs(fract(point.y) - 0.5));
  let ink = max(lineA * (1.0 - smoothstep(0.6, 0.85, light)), lineB * (1.0 - smoothstep(0.2, 0.55, light)));
` +
      blend(p, "paletteAt(1.0 - ink) * original.a"),
  },
  {
    id: "ascii-print",
    name: "ASCII Print",
    kind: "processor",
    backdrop: true,
    properties: properties({
      palette: catalogPalette(),
      cellSize: f("Cell size", 12, 6, 40),
    }),
    helpers: () => `
const GLYPHS: array<u32, 8> = array<u32, 8>(0u, 4096u, 2113668u, 10648714u, 15255086u, 11512810u, 33080895u, 33554431u);
`,
    fragment: (p) =>
      source +
      `
  let cell = ${p("cellSize")}.x * globals.clock.z;
  let position = uv * globals.viewport.xy / cell;
  let center = (floor(position) + 0.5) * cell * globals.viewport.zw;
  let sampled = sampleSource(center);
  let darkness = 1.0 - clamp(luminance(straight(sampled)), 0.0, 1.0);
  let glyph = GLYPHS[min(u32(darkness * 8.0), 7u)];
  let local = min(vec2u(fract(position) * 5.0), vec2u(4u));
  let bit = (glyph >> (local.y * 5u + local.x)) & 1u;
` +
      blend(p, "paletteAt(1.0 - f32(bit)) * sampled.a"),
  },
];

// Promotion into the public catalog requires the real GPU and visual gate.
export const CATALOG_PROCESSOR_CANDIDATES = specs.map(catalogShader);
