import {
  CATALOG_PALETTES,
  catalogFloat,
  catalogShader,
} from "./native-effect-catalog-kit";
import { CATALOG_PROCESSOR_CANDIDATES } from "./native-effect-catalog-processors";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const prior = CATALOG_PROCESSOR_CANDIDATES.find(
  (definition) => definition.id === "an-native-ascii-print",
);
if (!prior) throw new Error("ASCII Print v1 is missing");

const base = catalogShader({
  id: "ascii-print",
  name: "ASCII Print",
  version: 2,
  kind: "processor",
  backdrop: true,
  properties: {
    ...prior.properties,
    gamma: catalogFloat("Gamma", 1, 0.25, 4),
    glyphSpacing: {
      type: "float",
      label: "Glyph spacing",
      default: 0,
      min: 0,
      max: 24,
      step: 0.1,
      unit: "px",
    },
    alphaThreshold: catalogFloat("Alpha threshold", 0, 0, 1),
    glyphMode: {
      type: "enum",
      label: "Glyph source",
      default: "builtin",
      options: ["builtin", "atlas"],
    },
    atlasImage: {
      type: "texture",
      label: "Glyph atlas",
      default: null,
      input: "glyphAtlas",
      visibleWhen: { property: "glyphMode", equals: "atlas" },
    },
    atlasColumns: {
      type: "int",
      label: "Atlas columns",
      default: 8,
      min: 1,
      max: 16,
      step: 1,
      visibleWhen: { property: "glyphMode", equals: "atlas" },
    },
    atlasRows: {
      type: "int",
      label: "Atlas rows",
      default: 1,
      min: 1,
      max: 16,
      step: 1,
      visibleWhen: { property: "glyphMode", equals: "atlas" },
    },
    atlasGlyphLimit: {
      type: "int",
      label: "Glyph limit",
      default: 8,
      min: 1,
      max: 256,
      step: 1,
      visibleWhen: { property: "glyphMode", equals: "atlas" },
    },
    atlasCoverage: {
      type: "enum",
      label: "Atlas coverage",
      default: "alpha",
      options: ["alpha", "luminance"],
      visibleWhen: { property: "glyphMode", equals: "atlas" },
    },
  },
  helpers: (p) => `
const GLYPHS: array<u32, 8> = array<u32, 8>(0u, 4096u, 2113668u, 10648714u, 15255086u, 11512810u, 33080895u, 33554431u);
fn atlasInk(index: u32, local: vec2f, columns: u32, rows: u32) -> f32 {
  let atlasSize = vec2f(textureDimensions(glyphAtlasTexture));
  let cellSize = atlasSize / vec2f(f32(columns), f32(rows));
  let inset = min(vec2f(0.49), vec2f(0.5) / max(cellSize, vec2f(1.0)));
  let column = index % columns;
  let row = index / columns;
  let glyphUV = (vec2f(f32(column), f32(row)) + clamp(local, inset, vec2f(1.0) - inset)) /
    vec2f(f32(columns), f32(rows));
  let pixel = textureSampleLevel(glyphAtlasTexture, effectSampler, glyphUV, 0.0);
  if (${p("atlasCoverage")}.x < 0.5) { return pixel.a; }
  return clamp(luminance(straight(pixel)) * pixel.a, 0.0, 1.0);
}
`,
  fragment: (p) => `
  let uv = input.uv;
  let original = sampleSource(uv);
  if (${p("amount")}.x <= 0.0) { return original; }
  let cellCss = max(${p("cellSize")}.x, 1.0);
  let gapCss = ${p("glyphSpacing")}.x;
  let pitchCss = cellCss + gapCss;
  let pitch = pitchCss * globals.clock.z;
  let position = uv * globals.viewport.xy / pitch;
  let center = (floor(position) + 0.5) * pitch * globals.viewport.zw;
  let sampled = sampleSource(center);
  if (sampled.a < ${p("alphaThreshold")}.x) {
    return mix(original, vec4f(0.0), ${p("amount")}.x);
  }
  let darkness = 1.0 - pow(clamp(luminance(straight(sampled)), 0.0, 1.0), ${p("gamma")}.x);
  let local = (fract(position) * pitchCss - vec2f(0.5 * gapCss)) / cellCss;
  var ink = 0.0;
  if (all(local >= vec2f(0.0)) && all(local < vec2f(1.0))) {
    if (${p("glyphMode")}.x < 0.5) {
      let glyph = GLYPHS[min(u32(darkness * 8.0), 7u)];
      let dot = min(vec2u(local * 5.0), vec2u(4u));
      ink = f32((glyph >> (dot.y * 5u + dot.x)) & 1u);
    } else {
      let columns = clamp(u32(${p("atlasColumns")}.x), 1u, 16u);
      let rows = clamp(u32(${p("atlasRows")}.x), 1u, 16u);
      let count = min(u32(${p("atlasGlyphLimit")}.x), columns * rows);
      let glyph = min(u32(darkness * f32(count)), count - 1u);
      ink = atlasInk(glyph, local, columns, rows);
    }
  }
  let printed = paletteAt(1.0 - ink) * sampled.a;
  return mix(original, printed, ${p("amount")}.x);`,
});

const render = base.passes[0];
if (!render) throw new Error("ASCII Print v2 render pass is missing");
const atlasDeclaration =
  "@group(0) @binding(3) var maskTexture: texture_2d<f32>;";
if (render.wgsl.split(atlasDeclaration).length !== 2)
  throw new Error("ASCII Print v2 atlas binding contract changed");

export const ASCII_PRINT_V2_EFFECT: EffectDefinition = {
  ...base,
  inputs: {
    ...base.inputs,
    glyphAtlas: {
      kind: "texture-2d",
      resource: "glyphAtlas",
      enabledWhen: { property: "glyphMode", equals: "atlas" },
      fallback: "transparent-data",
    },
  },
  resources: [
    ...base.resources!.filter((resource) => resource.name !== "color"),
    {
      name: "glyphAtlas",
      kind: "texture-2d",
      external: true,
      usage: ["sampled"],
      size: "viewport",
      sampleEncoding: "srgb-color-premultiplied",
    },
    {
      ...base.resources!.find((resource) => resource.name === "color")!,
      format: "rgba16float",
    },
  ],
  passes: [
    {
      ...render,
      reads: ["source", "glyphAtlas"],
      wgsl: render.wgsl.replace(
        atlasDeclaration,
        "@group(0) @binding(3) var glyphAtlasTexture: texture_2d<f32>;",
      ),
    },
  ],
  provenance: {
    origin: "design-original",
    note: "Built-in bitmap glyphs are the default. Atlas mode uses a caller-supplied image grid and light-to-dark glyph order; Glyph limit caps cells within that grid. Characters and fonts are not edited here.",
  },
};

export const ASCII_PRINT_V2_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-ascii-print-v2-newsprint-grid",
    name: "Newsprint Grid",
    definitionId: ASCII_PRINT_V2_EFFECT.id,
    definitionVersion: 2,
    placement: "layer",
    clip: "bounds",
    params: {
      palette: structuredClone(CATALOG_PALETTES.ink),
      cellSize: 10,
      glyphSpacing: 1,
      gamma: 1.25,
      alphaThreshold: 0.03,
      amount: 1,
    },
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-ascii-print-v2-copper-display",
    name: "Copper Display",
    definitionId: ASCII_PRINT_V2_EFFECT.id,
    definitionVersion: 2,
    placement: "layer",
    clip: "bounds",
    params: {
      palette: structuredClone(CATALOG_PALETTES.ember),
      cellSize: 24,
      glyphSpacing: 3,
      gamma: 0.8,
      alphaThreshold: 0.12,
      amount: 0.95,
    },
    provenance: { origin: "design-original" },
  },
];
