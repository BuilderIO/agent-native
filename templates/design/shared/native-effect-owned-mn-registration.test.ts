import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import {
  OWNED_NEXT_SIX_M_DEFINITIONS,
  OWNED_NEXT_SIX_M_PRESETS,
} from "./native-effect-owned-next-six-m-v2";
import {
  OWNED_NEXT_SIX_N_DEFINITIONS,
  OWNED_NEXT_SIX_N_PRESETS,
} from "./native-effect-owned-next-six-n-v2";
import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import { hashEffectDefinition } from "./native-effect-trust";
import { packNativeProperties, validateEffectDocument } from "./native-effects";

const MN_HASHES = new Map([
  [
    "an-native-owned-m-cell-dissolve",
    "e8b26ec6a503787c61a0af6b8436f6b7f84e3376dd883717b202c60c169794a0",
  ],
  [
    "an-native-owned-m-iris-aperture",
    "84cd534e4fc2d6b9632803653c9725bdc3d19831b7ce28406e715905510ce663",
  ],
  [
    "an-native-owned-m-page-fold",
    "6977c765e6fa877dccc415ce390890adeb47f1f9e73acf1d239e8fe47fae8c39",
  ],
  [
    "an-native-owned-m-brush-liquify",
    "719fee8dfb5923616edef7d8fdda37de5ef25edc302a94eb9b0c5398a2de538e",
  ],
  [
    "an-native-owned-m-watercolor-pooling",
    "d6ea2ce0e3c4077e3f796c7069c02a691d9a77eed7eac8f999b81b9da4bc97c2",
  ],
  [
    "an-native-owned-m-interference-edge-fringe",
    "ee1814edbf0e4f0c55ecfc9c35a94419ae245f78038f158583e220fb0889d9c6",
  ],
  [
    "an-native-owned-n-arc-path",
    "44f35e81abb4f02df91a6d867b72293bd916d0a29287ac51992226e6c743fefb",
  ],
  [
    "an-native-owned-n-rational-circle-canopy",
    "4a15385059ae9f1740b6475491af81b0e4de12ccab63b7b21a470de0bd15b84b",
  ],
  [
    "an-native-owned-n-double-grating-moire",
    "e0ba040c623785b73a70edff597d823eee744cd88cbee7d62920a4b40dd964ec",
  ],
  [
    "an-native-owned-n-schlieren-knife-edge",
    "c2d5acab286263c5d473947ea4659e992d9344433d1611d15f4cf882608109a6",
  ],
  [
    "an-native-owned-n-doppler-wavefronts",
    "8aa4095358180e37e589fbb88d204794c6f672144b9a77d72df8df3c8e7dde5f",
  ],
  [
    "an-native-owned-n-kepler-area-sweep",
    "8b4eb88e3237827a9e07fd83107a24c3d1e9bf1b0bc5efa2382c96df93d9bd5e",
  ],
]);

describe("Design-owned M/N registration", () => {
  it("adds six source processors and six generators with exact versions and recipes", async () => {
    expect(NATIVE_EFFECT_LATEST_DEFINITIONS).toHaveLength(223);
    expect(NATIVE_EFFECT_DEFINITION_CATALOG).toHaveLength(268);
    expect(NATIVE_EFFECT_PRESETS).toHaveLength(538);
    expect(
      NATIVE_EFFECT_LATEST_DEFINITIONS.filter((d) =>
        d.placements.includes("fill"),
      ),
    ).toHaveLength(119);
    expect(
      NATIVE_EFFECT_LATEST_DEFINITIONS.filter((d) =>
        d.placements.includes("layer"),
      ),
    ).toHaveLength(104);
    expect(OWNED_NEXT_SIX_M_DEFINITIONS).toHaveLength(6);
    expect(OWNED_NEXT_SIX_N_DEFINITIONS).toHaveLength(6);
    expect(OWNED_NEXT_SIX_M_PRESETS).toHaveLength(12);
    expect(OWNED_NEXT_SIX_N_PRESETS).toHaveLength(12);
    for (const [definitions, recipes, kind, placement] of [
      [
        OWNED_NEXT_SIX_M_DEFINITIONS,
        OWNED_NEXT_SIX_M_PRESETS,
        "processor",
        "layer",
      ],
      [
        OWNED_NEXT_SIX_N_DEFINITIONS,
        OWNED_NEXT_SIX_N_PRESETS,
        "generator",
        "fill",
      ],
    ] as const)
      for (const definition of definitions) {
        expect(definition.kind).toBe(kind);
        expect(await hashEffectDefinition(definition)).toBe(
          MN_HASHES.get(definition.id),
        );
        expect(
          NATIVE_EFFECT_LATEST_DEFINITIONS.filter(
            (d) => d.id === definition.id,
          ),
        ).toEqual([definition]);
        expect(planEffectGraph(definition).errors, definition.id).toEqual([]);
        expect(packNativeProperties(definition).every(Number.isFinite)).toBe(
          true,
        );
        const ownRecipes = recipes.filter(
          (recipe) => recipe.definitionId === definition.id,
        );
        expect(ownRecipes).toHaveLength(2);
        expect(
          ownRecipes.every(
            (recipe) =>
              recipe.definitionVersion === definition.version &&
              recipe.placement === placement,
          ),
        ).toBe(true);
        expect(
          validateEffectDocument({
            schemaVersion: 2,
            definitions: [definition],
            instances: [],
            presets: ownRecipes,
          }).errors,
        ).toEqual([]);
      }
    for (const definition of OWNED_NEXT_SIX_M_DEFINITIONS)
      expect(nativeEffectAnimationCapability(definition)).toBe("static");
    for (const definition of OWNED_NEXT_SIX_N_DEFINITIONS)
      expect(nativeEffectAnimationCapability(definition)).toBe(
        [
          "an-native-owned-n-arc-path",
          "an-native-owned-n-rational-circle-canopy",
        ].includes(definition.id)
          ? "static"
          : "animated",
      );
  });
});
