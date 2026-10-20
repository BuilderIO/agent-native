import {
  CATALOG_PALETTES,
  catalogColor,
  catalogFloat,
  catalogPalette,
  catalogShader,
  type CatalogShaderSpec,
} from "./native-effect-catalog-kit";
import type { EffectDefinition } from "./native-effects";

function graphicsShader(spec: CatalogShaderSpec): EffectDefinition {
  const definition = catalogShader(spec);
  return {
    ...definition,
    resources: definition.resources?.map((resource) =>
      resource.name === "color"
        ? { ...resource, format: "rgba16float" as const }
        : resource,
    ),
  };
}

export const IMAGE_DITHERING_EFFECT = graphicsShader({
  id: "image-dithering",
  name: "Image Dithering",
  kind: "processor",
  backdrop: true,
  edgeSampling: "fixed-clamp",
  properties: {
    palette: catalogPalette(CATALOG_PALETTES.ink),
    cellSize: {
      ...catalogFloat("Pixel size", 2, 1, 32, 1),
      unit: "px",
    },
    contrast: catalogFloat("Contrast", 1, 0, 2),
    amount: catalogFloat("Dithering", 1, 0, 1),
  },
  helpers: () => `
fn orderedThreshold(cell: vec2u) -> f32 {
  let lowRank = ((cell.x ^ cell.y) & 1u) * 2u + (cell.y & 1u);
  let highRank = (((cell.x ^ cell.y) >> 1u) & 1u) * 2u + ((cell.y >> 1u) & 1u);
  return (f32(lowRank * 4u + highRank) + 0.5) / 16.0;
}
fn paletteDistance(a: vec3f, b: vec3f) -> f32 {
  let delta = a - b;
  return dot(delta, delta);
}
`,
  fragment: (p, slot) => `
  let count = min(u32(${p("palette")}.x), 8u);
  if (count == 0u) { return vec4f(0.0); }
  let density = max(globals.clock.z, 0.0001);
  let logicalPixel = input.uv * globals.viewport.xy / density;
  let size = ${p("cellSize")}.x;
  let cell = floor(logicalPixel / size);
  let centerUv = (cell + vec2f(0.5)) * size * density * globals.viewport.zw;
  let sampled = sampleSource(centerUv);
  let sourceAlpha = sampleSource(input.uv).a;
  let adjustedColor = clamp((straight(sampled) - vec3f(0.5)) * ${p("contrast")}.x + vec3f(0.5), vec3f(0.0), vec3f(1.0));
  var nearest = 0u;
  var nearestError = 1e20;
  for (var index = 0u; index < count; index += 1u) {
    let color = globals.params[${slot("palette") + 1}u + index];
    let error = paletteDistance(adjustedColor, color.rgb);
    if (error < nearestError) { nearestError = error; nearest = index; }
  }
  let base = globals.params[${slot("palette") + 1}u + nearest];
  var alternate = nearest;
  var fraction = 0.0;
  var pairError = nearestError;
  for (var index = 0u; index < count; index += 1u) {
    let color = globals.params[${slot("palette") + 1}u + index];
    let axis = color.rgb - base.rgb;
    let weight = clamp(dot(adjustedColor - base.rgb, axis) / max(dot(axis, axis), 0.000001), 0.0, 1.0);
    let error = paletteDistance(adjustedColor, base.rgb + axis * weight);
    if (error < pairError) { pairError = error; alternate = index; fraction = weight; }
  }
  let threshold = mix(0.5, orderedThreshold(vec2u(cell) % vec2u(4u)), ${p("amount")}.x);
  let selected = select(nearest, alternate, fraction > threshold);
  let color = globals.params[${slot("palette") + 1}u + selected];
  let alpha = sourceAlpha * color.a;
  return vec4f(color.rgb * alpha, alpha);
`,
});

export const WAVES_EFFECT = graphicsShader({
  id: "waves",
  name: "Waves",
  kind: "generator",
  properties: {
    palette: {
      type: "color-ramp",
      label: "Palette",
      maxCount: 8,
      default: CATALOG_PALETTES.lagoon.map((color, index) => ({
        position: index / (CATALOG_PALETTES.lagoon.length - 1),
        color: structuredClone(color),
      })),
    },
    scale: catalogFloat("Scale", 1, 0.25, 4),
    amplitude: catalogFloat("Amplitude", 0.22, 0, 0.6),
    frequency: catalogFloat("Frequency", 1.5, 0.25, 5),
    softness: catalogFloat("Softness", 0.12, 0.001, 0.5),
    rotation: catalogFloat("Rotation", 0, -Math.PI, Math.PI),
    movement: catalogFloat("Movement", 1, 0, 2),
  },
  helpers: (p) => `
fn waveRamp(position: f32) -> vec4f {
  let count = min(u32(${p("palette")}.x), 8u);
  if (count == 0u) { return vec4f(0.0); }
  let t = clamp(position, 0.0, 1.0);
  var lowerPosition = -1.0;
  var upperPosition = 2.0;
  var lowerColor = vec4f(0.0);
  var upperColor = vec4f(0.0);
  for (var index = 0u; index < count; index += 1u) {
    let color = globals.params[1u + index * 2u];
    let stop = globals.params[2u + index * 2u].x;
    let premultiplied = vec4f(color.rgb * color.a, color.a);
    if (stop <= t && stop >= lowerPosition) { lowerPosition = stop; lowerColor = premultiplied; }
    if (stop > t && stop < upperPosition) { upperPosition = stop; upperColor = premultiplied; }
  }
  if (lowerPosition < 0.0) { return upperColor; }
  if (upperPosition > 1.0) { return lowerColor; }
  return mix(lowerColor, upperColor, (t - lowerPosition) / (upperPosition - lowerPosition));
}
fn waveBandColor(band: f32) -> vec4f {
  return waveRamp(0.5 - 0.5 * cos(band * PI / 3.0));
}
`,
  fragment: (p) => `
  let aspect = vec2f(globals.viewport.x / max(globals.viewport.y, 1.0), 1.0);
  let point = rotate((input.uv - vec2f(0.5)) * aspect, ${p("rotation")}.x) * ${p("scale")}.x;
  let phase = globals.clock.x * ${p("movement")}.x * 0.65;
  let along = point.x * TAU * ${p("frequency")}.x;
  let bend = sin(along + phase) + 0.35 * sin(along * 0.57 - phase * 0.73 + point.y * 1.7);
  let level = (point.y + 0.5 + ${p("amplitude")}.x * bend) * 6.0;
  let band = floor(level);
  let width = max(${p("softness")}.x, fwidth(level) * 0.5);
  let blend = smoothstep(0.5 - width, 0.5 + width, fract(level));
  return mix(waveBandColor(band), waveBandColor(band + 1.0), blend);
`,
});

export const NEBULA_EFFECT = graphicsShader({
  id: "nebula",
  name: "Nebula",
  kind: "generator",
  properties: {
    palette: catalogPalette([
      catalogColor(0.008, 0.012, 0.045),
      catalogColor(0.09, 0.025, 0.24),
      catalogColor(0.42, 0.07, 0.52),
      catalogColor(0.9, 0.16, 0.5),
      catalogColor(0.96, 0.62, 0.8),
    ]),
    scale: catalogFloat("Scale", 1, 0.4, 2.5),
    cloudDensity: catalogFloat("Cloud density", 0.56, 0.15, 0.9),
    movement: catalogFloat("Movement", 0.22, 0, 1),
  },
  fragment: (p) => `
  let aspect = vec2f(globals.viewport.x / max(globals.viewport.y, 1.0), 1.0);
  let scale = ${p("scale")}.x;
  let time = globals.clock.x * ${p("movement")}.x * 0.12;
  let point = (input.uv - vec2f(0.5)) * aspect * (3.2 * scale);
  let flow = vec2f(time * 0.73, -time);
  let warp = vec2f(
    fractalNoise(point * 0.9 + flow + vec2f(2.3, 7.1)),
    fractalNoise(point * 0.9 - flow + vec2f(11.7, 3.4))
  ) - vec2f(0.5);
  let cloudField = fractalNoise(point + warp * 2.6 + flow);
  let filamentField = fractalNoise(point * 1.75 - warp * 1.8 - flow * 0.7);
  let field = cloudField * 0.72 + filamentField * 0.28;
  let density = ${p("cloudDensity")}.x;
  let cloudMask = smoothstep(0.54 - density * 0.34, 0.83 - density * 0.24, field);
  let cloudColor = paletteAt(clamp(0.18 + field * 0.82 + warp.x * 0.12, 0.0, 1.0));
  let deepSpace = paletteAt(0.0);
  let color = mix(deepSpace, cloudColor, cloudMask * 0.94);
  return color;
`,
});

export const GLOWING_WAVES_EFFECT = graphicsShader({
  id: "glowing-waves",
  name: "Glowing Waves",
  kind: "generator",
  properties: {
    waveColor: {
      type: "color",
      label: "Wave color",
      default: catalogColor(0.18, 0.86, 1),
    },
    background: {
      type: "color",
      label: "Background",
      default: catalogColor(0.008, 0.015, 0.045),
    },
    amplitude: catalogFloat("Amplitude", 0.12, 0.02, 0.35),
    wavesAcrossWidth: catalogFloat("Waves across width", 1.5, 0.5, 5, 0.1),
    glowWidth: catalogFloat("Glow width", 20, 4, 60, 1),
    movement: catalogFloat("Movement", 0.5, 0, 1),
  },
  fragment: (p) => `
  let waveColor = ${p("waveColor")};
  let background = ${p("background")};
  let time = globals.clock.x * ${p("movement")}.x * 1.2;
  let x = input.uv.x;
  let center = 0.5
    + sin(x * TAU * ${p("wavesAcrossWidth")}.x + time) * ${p("amplitude")}.x
    + sin(x * TAU * 0.7 - time * 0.62) * ${p("amplitude")}.x * 0.22;
  let distancePx = abs(input.uv.y - center) * globals.viewport.y;
  let glowWidth = max(${p("glowWidth")}.x, 1.0);
  let halo = exp(-distancePx / glowWidth);
  let core = exp(-pow(distancePx / max(glowWidth * 0.11, 0.8), 2.0));
  let rgb = mix(background.rgb, waveColor.rgb, clamp(halo * 0.52, 0.0, 0.82))
    + waveColor.rgb * halo * 0.38;
  let hotCore = mix(waveColor.rgb, vec3f(1.0), 0.72);
  let lit = mix(rgb, hotCore, clamp(core, 0.0, 1.0));
  let alpha = max(background.a, waveColor.a * clamp(halo * 0.9, 0.0, 1.0));
  return vec4f(clamp(lit, vec3f(0.0), vec3f(1.0)) * alpha, alpha);
`,
});
