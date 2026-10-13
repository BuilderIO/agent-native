import { catalogFloat } from "./native-effect-catalog-kit";
import { CATALOG_PROCESSOR_CANDIDATES } from "./native-effect-catalog-processors";
import {
  propertySlots,
  type EffectDefinition,
  type EffectPreset,
} from "./native-effects";

const previous = CATALOG_PROCESSOR_CANDIDATES.find(
  (definition) =>
    definition.id === "an-native-noise-displacement" &&
    definition.version === 1,
);
if (!previous)
  throw new Error("The pinned Noise Displacement definition is missing.");

const horizontalSlot = Object.values(previous.properties).reduce(
  (count, property) => count + propertySlots(property),
  0,
);
const verticalSlot = horizontalSlot + 1;
const previousRender = previous.passes.find((pass) => pass.id === "render");
if (!previousRender)
  throw new Error("The pinned Noise Displacement pass is missing.");

const originalDomain = `  let position = uv * globals.params[2].x + vec2f(globals.clock.x * globals.params[3].x);
  let noise = vec2f(fractalNoise(position), fractalNoise(position + vec2f(37.0, 17.0))) * 2.0 - 1.0;`;
if (
  previousRender.wgsl.indexOf(originalDomain) < 0 ||
  previousRender.wgsl.lastIndexOf(originalDomain) !==
    previousRender.wgsl.indexOf(originalDomain)
) {
  throw new Error("The pinned Noise Displacement domain changed.");
}

const renderWgsl = previousRender.wgsl.replace(
  originalDomain,
  `  let basePosition = uv * globals.params[2].x;
  let baseTime = globals.clock.x * globals.params[3].x;
  let horizontalPosition = basePosition + vec2f(baseTime * globals.params[${horizontalSlot}].x);
  let verticalPosition = basePosition + vec2f(baseTime * globals.params[${verticalSlot}].x) + vec2f(37.0, 17.0);
  let noise = vec2f(fractalNoise(horizontalPosition), fractalNoise(verticalPosition)) * 2.0 - 1.0;`,
);

export const NOISE_DISPLACEMENT_V2_EFFECT: EffectDefinition = {
  ...previous,
  version: 2,
  properties: {
    ...previous.properties,
    horizontalNoiseSpeed: catalogFloat("Horizontal noise speed", 1, -3, 3),
    verticalNoiseSpeed: catalogFloat("Vertical noise speed", 1, -3, 3),
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
    note: "Two seeded source-displacement noise channels move at independent signed rates under the shared Movement rate. Zero channel speed holds that domain; edge sampling and zero-amount source identity remain explicit.",
  },
};

export const NOISE_DISPLACEMENT_V2_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-noise-displacement-v2-countercurrent",
    name: "Countercurrent",
    definitionId: NOISE_DISPLACEMENT_V2_EFFECT.id,
    definitionVersion: 2,
    placement: "layer",
    params: {
      distance: 25,
      scale: 5,
      movement: 0.55,
      horizontalNoiseSpeed: 1.4,
      verticalNoiseSpeed: -0.7,
      amount: 0.9,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-noise-displacement-v2-held-crossflow",
    name: "Held Crossflow",
    definitionId: NOISE_DISPLACEMENT_V2_EFFECT.id,
    definitionVersion: 2,
    placement: "layer",
    params: {
      distance: 12,
      scale: 8,
      movement: 0.45,
      horizontalNoiseSpeed: 0,
      verticalNoiseSpeed: 0.65,
      amount: 0.8,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
