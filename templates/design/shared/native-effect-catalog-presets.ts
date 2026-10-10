import { CATALOG_PALETTES } from "./native-effect-catalog-kit";
import { validateEffectDocument } from "./native-effects";
import type {
  EffectDefinition,
  EffectPreset,
  EffectValue,
} from "./native-effects";

type Palette = keyof typeof CATALOG_PALETTES;
type Recipe = readonly [
  name: string,
  params: Record<string, EffectValue>,
  palette?: Palette,
];
type Recipes = readonly [Recipe, ...Recipe[]];

export class NativeCatalogPresetRecipeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeCatalogPresetRecipeError";
  }
}

const preservedPresetIds: Record<string, string> = {
  "grain-gradient": "an-preset-orange-cream-grain",
  halftone: "an-preset-halftone",
  "frosted-refraction": "an-preset-frosted-refraction",
};

const generatorRecipes: Record<string, Recipes> = {
  "grain-gradient": [
    ["Orange Cream Grain Gradient", {}],
    [
      "Citrus Afterglow",
      {
        scale: 1.6,
        movement: 0.7,
        grain: 0.09,
        orange: { space: "srgb", components: [1, 0.43, 0.08], alpha: 1 },
      },
    ],
    [
      "Rose Quartz",
      {
        scale: 0.62,
        movement: 0.12,
        grain: 0.025,
        cream: { space: "srgb", components: [1, 0.74, 0.78], alpha: 1 },
      },
    ],
  ],
  "gradient-field": [
    [
      "Tidal Horizon",
      { mode: "linear", scale: 0.72, detail: 4, rotation: -0.18 },
      "lagoon",
    ],
    [
      "Solar Halo",
      { mode: "radial", scale: 1.35, detail: 7, rotation: 0.3 },
      "ember",
    ],
    [
      "Violet Compass",
      { mode: "conic", scale: 0.95, detail: 9, movement: 0.32 },
      "orchid",
    ],
  ],
  "mesh-anchors": [
    [
      "Dawn Silk",
      { detail: 3, scale: 0.72, softness: 0.16, movement: 0.22 },
      "ember",
    ],
    [
      "Lagoon Veil",
      { detail: 6, scale: 1.15, softness: 0.11, rotation: 0.55 },
      "lagoon",
    ],
    [
      "Amethyst Fog",
      { detail: 4, scale: 1.7, softness: 0.22, movement: 0.08 },
      "orchid",
    ],
  ],
  "voronoi-cells": [
    ["Sea Glass", { detail: 5, scale: 0.8, softness: 0.16 }, "lagoon"],
    ["Copper Mosaic", { detail: 11, scale: 1.25, softness: 0.035 }, "ember"],
    [
      "Ink Tesserae",
      { detail: 18, scale: 0.68, softness: 0.014, rotation: 0.34 },
      "ink",
    ],
  ],
  "truchet-arcs": [
    ["Porcelain Paths", { detail: 7, scale: 0.75, softness: 0.055 }, "ink"],
    [
      "Electric Lattice",
      { detail: 14, scale: 1.2, softness: 0.022, rotation: 0.6 },
      "orchid",
    ],
    [
      "Terracotta Routes",
      { detail: 10, scale: 0.9, softness: 0.11, movement: 0.36 },
      "ember",
    ],
  ],
  "water-caustics": [
    [
      "Shallow Lagoon",
      { detail: 4, scale: 0.78, softness: 0.09, movement: 0.26 },
      "lagoon",
    ],
    [
      "Sunlit Pool",
      { detail: 8, scale: 1.2, softness: 0.18, movement: 0.5 },
      "ember",
    ],
    [
      "Moonlit Water",
      { detail: 6, scale: 0.93, softness: 0.04, movement: 0.1 },
      "orchid",
    ],
  ],
  mandelbrot: [
    [
      "Ocean Boundary",
      { detail: 10, scale: 0.85, softness: 0.03, rotation: 0.12 },
      "lagoon",
    ],
    [
      "Ember Set",
      { detail: 18, scale: 1.32, softness: 0.2, rotation: -0.23 },
      "ember",
    ],
    [
      "Monochrome Depth",
      { detail: 22, scale: 0.63, softness: 0.08, movement: 0.05 },
      "ink",
    ],
  ],
  starfield: [
    [
      "Polar Night",
      { detail: 12, scale: 0.7, softness: 0.18, movement: 0.08 },
      "lagoon",
    ],
    [
      "Meteor Dust",
      { detail: 20, scale: 1.35, softness: 0.12, movement: 0.7 },
      "ember",
    ],
    [
      "Deep Violet",
      { detail: 16, scale: 0.95, softness: 0.26, movement: 0.2 },
      "orchid",
    ],
  ],
  "hex-tiles": [
    ["Honeycomb", { detail: 7, scale: 0.8, softness: 0.06 }, "ember"],
    [
      "Aquatic Grid",
      { detail: 13, scale: 1.2, softness: 0.025, rotation: 0.5 },
      "lagoon",
    ],
    [
      "Stone Cells",
      { detail: 5, scale: 0.62, softness: 0.15, movement: 0.03 },
      "ink",
    ],
  ],
  "wave-interference": [
    [
      "Harbor Ripples",
      { detail: 8, scale: 0.8, softness: 0.12, movement: 0.2 },
      "lagoon",
    ],
    [
      "Resonant Heat",
      { detail: 17, scale: 1.4, softness: 0.04, movement: 0.55 },
      "ember",
    ],
    [
      "Quiet Oscillation",
      { detail: 5, scale: 0.72, softness: 0.22, movement: 0.07 },
      "orchid",
    ],
  ],
  "iridescent-surface": [
    [
      "Opal Sheen",
      { detail: 5, scale: 0.76, softness: 0.16, rotation: 0.35 },
      "orchid",
    ],
    [
      "Oil Slick",
      { detail: 11, scale: 1.3, softness: 0.04, movement: 0.45 },
      "lagoon",
    ],
    [
      "Champagne Foil",
      { detail: 7, scale: 0.92, softness: 0.1, movement: 0.12 },
      "ember",
    ],
  ],
  "metaball-field": [
    [
      "Mercury Drops",
      { detail: 4, scale: 0.7, softness: 0.08, movement: 0.18 },
      "ink",
    ],
    [
      "Coral Bloom",
      { detail: 10, scale: 1.3, softness: 0.14, movement: 0.48 },
      "ember",
    ],
    [
      "Aqua Cells",
      { detail: 7, scale: 0.95, softness: 0.22, movement: 0.32 },
      "lagoon",
    ],
  ],
  "fractal-cloud": [
    [
      "Coastal Mist",
      { detail: 4, scale: 0.75, softness: 0.2, movement: 0.1 },
      "lagoon",
    ],
    [
      "Sunset Plume",
      { detail: 8, scale: 1.35, softness: 0.14, movement: 0.3 },
      "ember",
    ],
    [
      "Storm Layer",
      { detail: 12, scale: 0.95, softness: 0.045, movement: 0.48 },
      "ink",
    ],
  ],
  "brushed-metal": [
    [
      "Satin Steel",
      { detail: 8, scale: 0.74, softness: 0.05, rotation: 0.1 },
      "ink",
    ],
    [
      "Anodized Copper",
      { detail: 14, scale: 1.3, softness: 0.08, rotation: 0.55 },
      "ember",
    ],
    [
      "Iridescent Alloy",
      { detail: 20, scale: 0.95, softness: 0.15, movement: 0.22 },
      "orchid",
    ],
  ],
  "plasma-field": [
    [
      "Electric Blue",
      { detail: 8, scale: 0.8, softness: 0.06, movement: 0.42 },
      "lagoon",
    ],
    [
      "Solar Flare",
      { detail: 14, scale: 1.35, softness: 0.16, movement: 0.68 },
      "ember",
    ],
    [
      "Nebula Pulse",
      { detail: 5, scale: 0.66, softness: 0.24, movement: 0.25 },
      "orchid",
    ],
  ],
  "woven-fabric": [
    [
      "Linen Weave",
      { detail: 12, scale: 0.7, softness: 0.12, rotation: 0.08 },
      "ink",
    ],
    [
      "Copper Twill",
      { detail: 20, scale: 1.2, softness: 0.045, rotation: 0.6 },
      "ember",
    ],
    [
      "Ocean Textile",
      { detail: 16, scale: 0.9, softness: 0.085, movement: 0.08 },
      "lagoon",
    ],
  ],
};

const processorRecipes: Record<string, Recipes> = {
  "se-brightness-contrast": [
    ["Lifted Contrast", { brightness: 0.12, contrast: 0.35 }],
    ["Matte Fade", { brightness: -0.04, contrast: -0.25 }],
  ],
  "se-solarize": [
    ["Solar Print", { threshold: 0.35, strength: 1 }],
    ["Soft Solar", { threshold: 0.6, strength: 0.4 }],
  ],
  "se-vibrance": [
    ["Color Boost", { intensity: 1 }],
    ["Muted Color", { intensity: -1 }],
  ],
  "se-exposure": [
    ["High Key", { exposure: 1.5 }],
    ["Low Key", { exposure: 0.6 }],
  ],
  "se-hue-shift": [
    ["Quarter Turn", { shift: 90 }],
    ["Half Turn", { shift: 180 }],
  ],
  "se-saturation": [
    ["Vivid Color", { intensity: 1.6 }],
    ["Soft Color", { intensity: 0.6 }],
  ],
  "se-invert": [["Inverted Image", {}]],
  "se-grayscale": [["Grayscale Image", {}]],
  halftone: [
    ["Halftone", {}],
    [
      "Copper Newsprint",
      {
        cellSize: 5,
        angle: 0.18,
        contrast: 1.45,
        ink: { space: "srgb", components: [0.36, 0.1, 0.045], alpha: 1 },
      },
    ],
    [
      "Large Monochrome",
      {
        cellSize: 18,
        angle: 0.78,
        contrast: 2.1,
        paper: { space: "srgb", components: [0.95, 0.95, 0.92], alpha: 1 },
      },
    ],
  ],
  "frosted-refraction": [
    ["Frosted Refraction", {}],
    [
      "Chilled Glass",
      {
        blur: 12,
        distortion: 3,
        movement: 0.08,
        tint: { space: "srgb", components: [0.78, 0.9, 1], alpha: 0.24 },
      },
    ],
    [
      "Heat Mirage",
      {
        blur: 1.5,
        distortion: 19,
        movement: 0.9,
        tint: { space: "srgb", components: [1, 0.78, 0.62], alpha: 0.09 },
      },
    ],
  ],
  "gaussian-blur": [
    ["Soft Portrait", { radius: 3 }],
    ["Dream Diffusion", { radius: 11 }],
    ["Atmospheric Haze", { radius: 21 }],
  ],
  bloom: [
    ["Low Glow", { radius: 4, threshold: 0.78, knee: 0.08, intensity: 0.45 }],
    [
      "Neon Night",
      { radius: 11, threshold: 0.45, knee: 0.12, intensity: 1.35 },
    ],
    [
      "Soft Radiance",
      { radius: 20, threshold: 0.32, knee: 0.34, intensity: 0.8 },
    ],
  ],
  "color-grade": [
    [
      "Golden Hour",
      { exposure: 0.38, contrast: 1.16, saturation: 1.12, warmth: 0.48 },
    ],
    [
      "Cool Editorial",
      { exposure: 0.12, contrast: 1.3, saturation: 0.75, warmth: -0.35 },
    ],
    [
      "Soft Matte",
      { exposure: -0.22, contrast: 0.86, saturation: 0.72, warmth: 0.14 },
    ],
  ],
  "palette-map": [
    ["Sea Glass Print", { contrast: 0.82 }, "lagoon"],
    ["Copper Duotone", { contrast: 1.6 }, "ember"],
    ["Violet Poster", { contrast: 2.25 }, "orchid"],
  ],
  posterize: [
    ["Four Ink Blocks", { levels: 4, amount: 1 }],
    ["Editorial Seven", { levels: 7, amount: 0.9 }],
    ["Silk Screen", { levels: 16, amount: 0.78 }],
  ],
  threshold: [
    ["Hard Ink", { threshold: 0.44, softness: 0.004 }, "ink"],
    ["Warm Cutout", { threshold: 0.58, softness: 0.03 }, "ember"],
    ["Tidal Fade", { threshold: 0.32, softness: 0.11 }, "lagoon"],
  ],
  "ordered-dither": [
    ["Fine Newspaper", { cellSize: 2, amount: 0.85 }, "ink"],
    ["Copper Matrix", { cellSize: 5, amount: 1 }, "ember"],
    ["Large Pixel Weave", { cellSize: 11, amount: 0.92 }, "orchid"],
  ],
  "sobel-edges": [
    ["Pencil Contour", { radius: 0.75, strength: 1.2, amount: 0.8 }, "ink"],
    ["Neon Outline", { radius: 1.5, strength: 4.5, amount: 1 }, "orchid"],
    ["Broad Engraving", { radius: 3, strength: 2.8, amount: 0.9 }, "ember"],
  ],
  emboss: [
    ["Paper Relief", { radius: 1, angle: 0.35, strength: 1.4, amount: 0.75 }],
    ["Copper Plate", { radius: 3, angle: 1.2, strength: 3.5, amount: 1 }],
    ["Deep Carving", { radius: 6, angle: -0.65, strength: 5.5, amount: 0.9 }],
  ],
  sharpen: [
    ["Portrait Detail", { radius: 0.7, strength: 0.45, amount: 0.75 }],
    ["Architectural Edge", { radius: 1.4, strength: 1.25, amount: 1 }],
    ["Graphic Bite", { radius: 2.5, strength: 2.25, amount: 0.9 }],
  ],
  pixelate: [
    ["Tiny Mosaic", { cellSize: 6, amount: 0.82 }],
    ["Arcade Block", { cellSize: 18, amount: 1 }],
    ["Large Tiles", { cellSize: 48, amount: 0.9 }],
  ],
  "crt-display": [
    [
      "Soft Monitor",
      { curvature: 0.06, scanlines: 0.16, pitch: 4, amount: 0.75 },
    ],
    [
      "Arcade Screen",
      { curvature: 0.2, scanlines: 0.36, pitch: 2.5, amount: 1 },
    ],
    [
      "Wide Broadcast",
      { curvature: 0.12, scanlines: 0.52, pitch: 6, amount: 0.92 },
    ],
  ],
  "chromatic-aberration": [
    ["Subtle Lens", { distance: 2, angle: 0, amount: 0.7 }],
    ["Prism Shift", { distance: 9, angle: 0.72, amount: 1 }],
    ["Diagonal Split", { distance: 20, angle: -0.85, amount: 0.85 }],
  ],
  "barrel-distortion": [
    ["Soft Optics", { distortion: 0.16, zoom: 1.04, amount: 0.7 }],
    ["Fisheye Frame", { distortion: 0.9, zoom: 1.28, amount: 1 }],
    ["Reverse Lens", { distortion: -0.45, zoom: 0.78, amount: 0.9 }],
  ],
  swirl: [
    ["Gentle Eddy", { angle: 0.8, radius: 0.9, amount: 0.7 }],
    ["Vortex", { angle: 3.2, radius: 0.56, amount: 1 }],
    ["Reverse Current", { angle: -2.2, radius: 1.15, amount: 0.88 }],
  ],
  kaleidoscope: [
    ["Fourfold Glass", { segments: 4, angle: 0.1, zoom: 0.85, amount: 0.85 }],
    ["Crystal Eight", { segments: 8, angle: 0.6, zoom: 1.32, amount: 1 }],
    ["Rosette", { segments: 16, angle: -0.25, zoom: 1.8, amount: 0.9 }],
  ],
  "ripple-distortion": [
    [
      "Water Ring",
      { distance: 5, frequency: 18, movement: 0.25, amount: 0.75 },
    ],
    ["Resonance", { distance: 15, frequency: 42, movement: 0.8, amount: 1 }],
    ["Fine Tremor", { distance: 3, frequency: 84, movement: 1.4, amount: 0.9 }],
  ],
  "noise-displacement": [
    ["Heat Haze", { distance: 8, scale: 4, movement: 0.3, amount: 0.75 }],
    ["Liquify", { distance: 32, scale: 11, movement: 0.7, amount: 1 }],
    ["Fine Static", { distance: 14, scale: 27, movement: 1.3, amount: 0.9 }],
  ],
  vignette: [
    ["Soft Focus", { radius: 0.9, softness: 0.75, amount: 0.65 }],
    ["Cinema Edge", { radius: 0.63, softness: 0.4, amount: 0.9 }],
    ["Dark Aperture", { radius: 0.34, softness: 0.16, amount: 1 }],
  ],
  "film-grain": [
    ["Fine Stock", { strength: 0.08, size: 0.75, movement: 0.3, amount: 0.7 }],
    ["Warm 35mm", { strength: 0.24, size: 1.8, movement: 0.8, amount: 1 }],
    [
      "Coarse Print",
      { strength: 0.48, size: 4.5, movement: 1.4, amount: 0.88 },
    ],
  ],
  crosshatch: [
    [
      "Fine Engraving",
      { cellSize: 4, angle: 0.78, thickness: 0.08, amount: 0.8 },
      "ink",
    ],
    [
      "Copper Etch",
      { cellSize: 9, angle: 0.48, thickness: 0.19, amount: 1 },
      "ember",
    ],
    [
      "Broad Strokes",
      { cellSize: 20, angle: -0.62, thickness: 0.32, amount: 0.9 },
      "orchid",
    ],
  ],
  "ascii-print": [
    ["Terminal Fine", { cellSize: 8, amount: 0.75 }, "ink"],
    ["Copper Type", { cellSize: 16, amount: 1 }, "ember"],
    ["Large Display", { cellSize: 30, amount: 0.9 }, "lagoon"],
  ],
};

const simulationRecipes: Record<string, Recipes> = {
  "particle-flow": [
    [
      "Tidal Drift",
      {
        quality: "low",
        density: 0.48,
        fieldScale: 1.8,
        turbulence: 1.1,
        speed: 0.25,
        pointerForce: 1.2,
        pointerRadius: 140,
        trailDecay: 1.2,
        particleSize: 1.8,
      },
    ],
    [
      "Festival Sparks",
      {
        quality: "medium",
        density: 0.82,
        fieldScale: 5.4,
        turbulence: 7.5,
        speed: 1.3,
        pointerForce: 3.4,
        pointerRadius: 90,
        trailDecay: 3.2,
        particleSize: 2.4,
      },
    ],
    [
      "Quiet Constellation",
      {
        quality: "high",
        density: 0.3,
        fieldScale: 0.7,
        turbulence: 0.35,
        speed: 0.08,
        pointerForce: 0.4,
        pointerRadius: 220,
        trailDecay: 0.55,
        particleSize: 1.1,
      },
    ],
  ],
};

export function createCatalogEffectPresets(
  definitions: readonly EffectDefinition[],
): EffectPreset[] {
  const result: EffectPreset[] = [];
  for (const definition of definitions) {
    const slug = definition.id.replace(/^an-native-/, "");
    const recipes = (
      definition.kind === "generator"
        ? generatorRecipes
        : definition.kind === "processor"
          ? processorRecipes
          : simulationRecipes
    )[slug];
    if (!recipes)
      throw new NativeCatalogPresetRecipeError(
        `No curated recipes for ${definition.id}`,
      );
    const definitionPresets: EffectPreset[] = [];
    for (const [index, [name, values, palette]] of recipes.entries()) {
      const params = { ...values };
      if (palette) {
        if (definition.properties.palette?.type !== "color-array")
          throw new NativeCatalogPresetRecipeError(
            `Palette recipe has no color-array input: ${definition.id}`,
          );
        params.palette = structuredClone(CATALOG_PALETTES[palette]);
      }
      definitionPresets.push({
        id:
          index === 0
            ? (preservedPresetIds[slug] ?? `an-preset-catalog-${slug}-1`)
            : `an-preset-catalog-${slug}-${index + 1}`,
        name,
        definitionId: definition.id,
        definitionVersion: definition.version,
        placement:
          definition.kind === "processor"
            ? definition.id === "an-native-frosted-refraction"
              ? "backdrop"
              : "layer"
            : "fill",
        params,
        clip: "bounds",
        provenance: { origin: "design-original" },
      });
    }
    const validation = validateEffectDocument({
      schemaVersion: 2,
      definitions: [definition],
      instances: [],
      presets: definitionPresets,
    });
    if (!validation.valid)
      throw new NativeCatalogPresetRecipeError(
        `${definition.id}: ${validation.errors.join("; ")}`,
      );
    result.push(...definitionPresets);
  }
  return result;
}
