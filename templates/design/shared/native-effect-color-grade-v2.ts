import { catalogFloat } from "./native-effect-catalog-kit";
import { CATALOG_PROCESSOR_CANDIDATES } from "./native-effect-catalog-processors";
import {
  propertySlots,
  type EffectDefinition,
  type EffectPreset,
} from "./native-effects";

const previous = CATALOG_PROCESSOR_CANDIDATES.find(
  (definition) =>
    definition.id === "an-native-color-grade" && definition.version === 1,
);
if (!previous) throw new Error("The pinned Color Grade definition is missing.");

const brightnessSlot = Object.values(previous.properties).reduce(
  (count, property) => count + propertySlots(property),
  0,
);
const previousRender = previous.passes.find((pass) => pass.id === "render");
if (!previousRender) throw new Error("The pinned Color Grade pass is missing.");

function replaceExact(source: string, before: string, after: string): string {
  const first = source.indexOf(before);
  if (first < 0 || source.lastIndexOf(before) !== first)
    throw new Error("The pinned Color Grade shader contract changed.");
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const renderWgsl = replaceExact(
  previousRender.wgsl,
  "premultiply(graded, original.a)",
  `vec4f((graded + vec3f(globals.params[${brightnessSlot}].x)) * original.a, original.a)`,
);

export const COLOR_GRADE_V2_EFFECT: EffectDefinition = {
  ...previous,
  version: 2,
  properties: {
    ...previous.properties,
    brightness: catalogFloat("Brightness offset", 0, -2, 2),
  },
  resources: previous.resources?.map((resource) =>
    resource.name === "color"
      ? { ...resource, format: "rgba16float" as const }
      : resource,
  ),
  passes: previous.passes.map((pass) =>
    pass.id === "render" ? { ...pass, wgsl: renderWgsl } : pass,
  ),
  provenance: {
    origin: "design-original",
    note: "Exposure, contrast, saturation and warmth grade the source in linear color before an independent additive brightness offset; source alpha and zero-amount identity are retained in float output.",
  },
};

export const COLOR_GRADE_V2_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-color-grade-v2-lifted-shadows",
    name: "Lifted Shadows",
    definitionId: COLOR_GRADE_V2_EFFECT.id,
    definitionVersion: 2,
    placement: "layer",
    params: {
      exposure: -0.18,
      contrast: 0.74,
      saturation: 0.88,
      warmth: 0.12,
      brightness: 0.16,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-color-grade-v2-ink-depth",
    name: "Ink Depth",
    definitionId: COLOR_GRADE_V2_EFFECT.id,
    definitionVersion: 2,
    placement: "layer",
    params: {
      exposure: 0.42,
      contrast: 1.48,
      saturation: 0.62,
      warmth: -0.16,
      brightness: -0.11,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
