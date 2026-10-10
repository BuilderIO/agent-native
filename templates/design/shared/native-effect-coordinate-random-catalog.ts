import {
  createCoordinateRandomSuccessor,
  CoordinateRandomRewriteError,
} from "./native-effect-coordinate-random";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const SUCCESSOR_SPECS = [
  ["an-native-owned-mycelium-trails", 2, "render", "ownedHash"],
  ["an-native-owned-ink-blooms", 2, "render", "ownedHash"],
  ["an-native-owned-tide-pool-contours", 2, "render", "ownedHash"],
  ["an-native-owned-braided-ribbons", 2, "render", "ownedHash"],
  ["an-native-owned-fresnel-shells", 2, "render", "ownedHash"],
  ["an-native-owned-etched-diffraction", 2, "render", "ownedHash"],
  ["an-native-owned-aurora-curtains", 2, "render", "ownedHash"],
  ["an-native-owned-fog-banks", 2, "render", "ownedHash"],
  ["an-native-owned-ember-drift", 2, "render", "ownedHash"],
  ["an-native-owned-volumetric-cones", 2, "render", "ownedHash"],
  ["an-native-owned-contour-terrain", 2, "render", "ownedHash"],
  ["an-native-owned-gyroid-slice", 2, "render", "ownedHash"],
  ["an-native-owned-leaf-venation", 3, "render", "ownedHash"],
  ["an-native-owned-coral-polyps", 3, "render", "ownedHash"],
  ["an-native-owned-knit-loops", 3, "render", "ownedHash"],
  ["an-native-owned-quilted-diamonds", 3, "render", "ownedHash"],
  ["an-native-owned-lace-rosettes", 3, "render", "ownedHash"],
  ["an-native-owned-sashiko-stitches", 3, "render", "ownedHash"],
  ["an-native-owned-prism-facets", 3, "render", "ownedHash"],
  ["an-native-owned-lenticular-ribs", 3, "render", "ownedHash"],
  ["an-native-owned-anamorphic-streaks", 3, "render", "ownedHash"],
  ["an-native-owned-horizon-haze", 3, "render", "ownedHash"],
  ["an-native-owned-wire-dome", 3, "render", "ownedHash"],
  ["an-native-owned-folded-paper", 3, "render", "ownedHash"],
  ["an-native-owned-crystal-lattice", 3, "render", "ownedHash"],
  ["an-native-grain-gradient", 3, "gradient", "hash"],
] as const;

const SUCCESSOR_RECIPE_IDS = [
  [
    "an-preset-owned-mycelium-trails-signature",
    "an-preset-coordinate-v3-owned-mycelium-trails-1",
  ],
  [
    "an-preset-owned-mycelium-trails-alternate",
    "an-preset-coordinate-v3-owned-mycelium-trails-2",
  ],
  [
    "an-preset-owned-ink-blooms-signature",
    "an-preset-coordinate-v3-owned-ink-blooms-3",
  ],
  [
    "an-preset-owned-ink-blooms-alternate",
    "an-preset-coordinate-v3-owned-ink-blooms-4",
  ],
  [
    "an-preset-owned-tide-pool-contours-signature",
    "an-preset-coordinate-v3-owned-tide-pool-contours-5",
  ],
  [
    "an-preset-owned-tide-pool-contours-alternate",
    "an-preset-coordinate-v3-owned-tide-pool-contours-6",
  ],
  [
    "an-preset-owned-braided-ribbons-signature",
    "an-preset-coordinate-v3-owned-braided-ribbons-7",
  ],
  [
    "an-preset-owned-braided-ribbons-alternate",
    "an-preset-coordinate-v3-owned-braided-ribbons-8",
  ],
  [
    "an-preset-owned-fresnel-shells-signature",
    "an-preset-coordinate-v3-owned-fresnel-shells-9",
  ],
  [
    "an-preset-owned-fresnel-shells-alternate",
    "an-preset-coordinate-v3-owned-fresnel-shells-10",
  ],
  [
    "an-preset-owned-etched-diffraction-signature",
    "an-preset-coordinate-v3-owned-etched-diffraction-11",
  ],
  [
    "an-preset-owned-etched-diffraction-alternate",
    "an-preset-coordinate-v3-owned-etched-diffraction-12",
  ],
  [
    "an-preset-owned-aurora-curtains-signature",
    "an-preset-coordinate-v3-owned-aurora-curtains-13",
  ],
  [
    "an-preset-owned-aurora-curtains-alternate",
    "an-preset-coordinate-v3-owned-aurora-curtains-14",
  ],
  [
    "an-preset-owned-fog-banks-signature",
    "an-preset-coordinate-v3-owned-fog-banks-15",
  ],
  [
    "an-preset-owned-fog-banks-alternate",
    "an-preset-coordinate-v3-owned-fog-banks-16",
  ],
  [
    "an-preset-owned-ember-drift-signature",
    "an-preset-coordinate-v3-owned-ember-drift-17",
  ],
  [
    "an-preset-owned-ember-drift-alternate",
    "an-preset-coordinate-v3-owned-ember-drift-18",
  ],
  [
    "an-preset-owned-volumetric-cones-signature",
    "an-preset-coordinate-v3-owned-volumetric-cones-19",
  ],
  [
    "an-preset-owned-volumetric-cones-alternate",
    "an-preset-coordinate-v3-owned-volumetric-cones-20",
  ],
  [
    "an-preset-owned-contour-terrain-signature",
    "an-preset-coordinate-v3-owned-contour-terrain-21",
  ],
  [
    "an-preset-owned-contour-terrain-alternate",
    "an-preset-coordinate-v3-owned-contour-terrain-22",
  ],
  [
    "an-preset-owned-gyroid-slice-signature",
    "an-preset-coordinate-v3-owned-gyroid-slice-23",
  ],
  [
    "an-preset-owned-gyroid-slice-alternate",
    "an-preset-coordinate-v3-owned-gyroid-slice-24",
  ],
  [
    "an-preset-owned-leaf-venation-signature",
    "an-preset-coordinate-v4-owned-leaf-venation-25",
  ],
  [
    "an-preset-owned-leaf-venation-alternate",
    "an-preset-coordinate-v4-owned-leaf-venation-26",
  ],
  [
    "an-preset-owned-coral-polyps-signature",
    "an-preset-coordinate-v4-owned-coral-polyps-27",
  ],
  [
    "an-preset-owned-coral-polyps-alternate",
    "an-preset-coordinate-v4-owned-coral-polyps-28",
  ],
  [
    "an-preset-owned-knit-loops-signature",
    "an-preset-coordinate-v4-owned-knit-loops-29",
  ],
  [
    "an-preset-owned-knit-loops-alternate",
    "an-preset-coordinate-v4-owned-knit-loops-30",
  ],
  [
    "an-preset-owned-quilted-diamonds-signature",
    "an-preset-coordinate-v4-owned-quilted-diamonds-31",
  ],
  [
    "an-preset-owned-quilted-diamonds-alternate",
    "an-preset-coordinate-v4-owned-quilted-diamonds-32",
  ],
  [
    "an-preset-owned-lace-rosettes-signature",
    "an-preset-coordinate-v4-owned-lace-rosettes-33",
  ],
  [
    "an-preset-owned-lace-rosettes-alternate",
    "an-preset-coordinate-v4-owned-lace-rosettes-34",
  ],
  [
    "an-preset-owned-sashiko-stitches-signature",
    "an-preset-coordinate-v4-owned-sashiko-stitches-35",
  ],
  [
    "an-preset-owned-sashiko-stitches-alternate",
    "an-preset-coordinate-v4-owned-sashiko-stitches-36",
  ],
  [
    "an-preset-owned-prism-facets-signature",
    "an-preset-coordinate-v4-owned-prism-facets-37",
  ],
  [
    "an-preset-owned-prism-facets-alternate",
    "an-preset-coordinate-v4-owned-prism-facets-38",
  ],
  [
    "an-preset-owned-lenticular-ribs-signature",
    "an-preset-coordinate-v4-owned-lenticular-ribs-39",
  ],
  [
    "an-preset-owned-lenticular-ribs-alternate",
    "an-preset-coordinate-v4-owned-lenticular-ribs-40",
  ],
  [
    "an-preset-owned-anamorphic-streaks-signature",
    "an-preset-coordinate-v4-owned-anamorphic-streaks-41",
  ],
  [
    "an-preset-owned-anamorphic-streaks-alternate",
    "an-preset-coordinate-v4-owned-anamorphic-streaks-42",
  ],
  [
    "an-preset-owned-horizon-haze-signature",
    "an-preset-coordinate-v4-owned-horizon-haze-43",
  ],
  [
    "an-preset-owned-horizon-haze-alternate",
    "an-preset-coordinate-v4-owned-horizon-haze-44",
  ],
  [
    "an-preset-owned-wire-dome-signature",
    "an-preset-coordinate-v4-owned-wire-dome-45",
  ],
  [
    "an-preset-owned-wire-dome-alternate",
    "an-preset-coordinate-v4-owned-wire-dome-46",
  ],
  [
    "an-preset-owned-folded-paper-signature",
    "an-preset-coordinate-v4-owned-folded-paper-47",
  ],
  [
    "an-preset-owned-folded-paper-alternate",
    "an-preset-coordinate-v4-owned-folded-paper-48",
  ],
  [
    "an-preset-owned-crystal-lattice-signature",
    "an-preset-coordinate-v4-owned-crystal-lattice-49",
  ],
  [
    "an-preset-owned-crystal-lattice-alternate",
    "an-preset-coordinate-v4-owned-crystal-lattice-50",
  ],
  [
    "an-preset-v3-grain-gradient-1",
    "an-preset-coordinate-v4-grain-gradient-51",
  ],
  [
    "an-preset-v3-grain-gradient-2",
    "an-preset-coordinate-v4-grain-gradient-52",
  ],
  [
    "an-preset-v3-grain-gradient-3",
    "an-preset-coordinate-v4-grain-gradient-53",
  ],
] as const;

export function createCoordinateRandomCatalog(
  baseDefinitions: readonly EffectDefinition[],
) {
  const successors = SUCCESSOR_SPECS.map(([id, version, passId, helper]) => {
    const matches = baseDefinitions.filter(
      (definition) => definition.id === id && definition.version === version,
    );
    const [definition] = matches;
    if (matches.length !== 1 || !definition)
      throw new CoordinateRandomRewriteError("definition-shape");
    return createCoordinateRandomSuccessor(definition, passId, helper);
  });
  const replacements = new Map(
    successors.map((definition) => [definition.id, definition]),
  );
  const latest = baseDefinitions.map(
    (definition) => replacements.get(definition.id) ?? definition,
  );
  return { successors, latest };
}

export function createCoordinateRandomRecipes(
  baseRecipes: readonly EffectPreset[],
  successors: readonly EffectDefinition[],
  existingLabelSources: Readonly<Record<string, string>>,
) {
  const presetSources: Record<string, string> = {};
  const labelSources: Record<string, string> = {};
  const recipes = SUCCESSOR_RECIPE_IDS.map(([sourceId, id]) => {
    const matches = baseRecipes.filter((recipe) => recipe.id === sourceId);
    const [source] = matches;
    if (matches.length !== 1 || !source)
      throw new CoordinateRandomRewriteError("definition-shape");
    const definitions = successors.filter(
      (definition) =>
        definition.id === source.definitionId &&
        definition.version === source.definitionVersion + 1,
    );
    const [definition] = definitions;
    if (definitions.length !== 1 || !definition)
      throw new CoordinateRandomRewriteError("definition-shape");
    presetSources[id] = sourceId;
    labelSources[id] = existingLabelSources[sourceId] ?? sourceId;
    return {
      ...structuredClone(source),
      id,
      definitionVersion: definition.version,
    };
  });
  return { recipes, presetSources, labelSources };
}
