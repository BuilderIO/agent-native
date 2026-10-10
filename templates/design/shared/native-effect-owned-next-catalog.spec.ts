import { describe, expect, it } from "vitest";

import enUS from "../app/i18n/en-US";
import {
  OWNED_NEXT_CONSOLIDATED_DEFINITIONS,
  OWNED_NEXT_CONSOLIDATED_PRESETS,
} from "./native-effect-owned-next-consolidated";
import {
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import { hashEffectDefinition } from "./native-effect-trust";
import { validateEffectDocument } from "./native-effects";

const expectedHashes = new Map([
  [
    "an-native-owned-next-median-speckle",
    "115d7c8a001911823bbced5954bcaa37f4e3d58cb3fe65fa71498683cc352bbf",
  ],
  [
    "an-native-owned-next-anisotropic-diffusion",
    "51799e27c56b15e0273539ee0ab495aa863038abce29f284dbacc5042cecb63f",
  ],
  [
    "an-native-owned-next-aperture-bokeh",
    "b029bab3c973bd14cda7e76b653704b101454048e17df0520200693c9c8692aa",
  ],
  [
    "an-native-owned-next-dark-channel-dehaze",
    "abaea5b7c5208ae7ceb0b05cd1d8d08a7610cf96486c8dee38a303873e9359a1",
  ],
  [
    "an-native-owned-next-bounded-canny-contours",
    "b002009a29e1aafedcc7b07616c068d9632a5484cf31920513c28f447a7db91c",
  ],
  [
    "an-native-owned-next-dog-ink",
    "d699a521ea385d3b3b18def59b86097136b18df58e39a3bcefaf75a308c891bd",
  ],
  [
    "an-native-owned-next-alpha-dilate",
    "d6203b5bb34cbae94a98e15de8e33d7b9fc478cc5dc81618da1e208477f1793d",
  ],
  [
    "an-native-owned-next-alpha-erode",
    "7c7211e00529490dbd67f91d17c449400f8f0d47d7b4ea6b655dd3a7d41c80f9",
  ],
  [
    "an-native-owned-corner-perspective",
    "edd777b0633fbf1b2d80b12407a175539c3db1a108959b0344766e7990695a43",
  ],
  [
    "an-native-owned-chroma-key",
    "c77e24cc1ac77d6a3c2a0c27cf7f462f67091cf8d868af964e2e41087c736f42",
  ],
  [
    "an-native-owned-pointillist-brush",
    "8e08d639fc44b8a4e18718bfb0e6f6e3c8d11f5721e659886019afcee8e5ff54",
  ],
  [
    "an-native-owned-adaptive-threshold",
    "1b65c19b3cde9614222838cadd110bb5989fab83260532ee93bf760059d42e30",
  ],
]);
const propertyKey = (label: string) =>
  label
    .split(/\s+/)
    .map((word, index) =>
      index
        ? word.charAt(0).toUpperCase() + word.slice(1)
        : word.charAt(0).toLowerCase() + word.slice(1),
    )
    .join("");

describe("consolidated Design processors", () => {
  it("registers twelve distinct Effects with two exact looks each", async () => {
    expect(OWNED_NEXT_CONSOLIDATED_DEFINITIONS).toHaveLength(12);
    expect(OWNED_NEXT_CONSOLIDATED_PRESETS).toHaveLength(24);
    const labels = enUS.editPanel.shaders.nativeCatalog;
    for (const definition of OWNED_NEXT_CONSOLIDATED_DEFINITIONS) {
      expect(
        NATIVE_EFFECT_LATEST_DEFINITIONS.filter(
          (item) => item.id === definition.id,
        ),
      ).toEqual([definition]);
      expect(definition.kind).toBe("processor");
      expect(definition.placements).toEqual(["layer", "backdrop"]);
      expect(await hashEffectDefinition(definition)).toBe(
        expectedHashes.get(definition.id),
      );
      expect(
        labels.definitions[
          definition.id.replace(
            /^an-native-/,
            "",
          ) as keyof typeof labels.definitions
        ],
      ).toBe(definition.name);
      for (const property of Object.values(definition.properties)) {
        expect(["float", "int", "color", "vec2", "enum"]).toContain(
          property.type,
        );
        expect(
          labels.properties[
            propertyKey(property.label) as keyof typeof labels.properties
          ],
        ).toBe(property.label);
      }
      const looks = NATIVE_EFFECT_PRESETS.filter(
        (preset) => preset.definitionId === definition.id,
      );
      expect(looks).toHaveLength(2);
      for (const look of looks) {
        expect(look.placement).toBe("layer");
        expect(labels.presets[look.id as keyof typeof labels.presets]).toBe(
          look.name,
        );
      }
    }
  });

  it("rejects inverted blur scales and collapsed perspective in canonical documents", () => {
    const dog = OWNED_NEXT_CONSOLIDATED_DEFINITIONS.find((item) =>
      item.id.endsWith("dog-ink"),
    );
    const perspective = OWNED_NEXT_CONSOLIDATED_DEFINITIONS.find((item) =>
      item.id.endsWith("corner-perspective"),
    );
    expect(dog).toBeDefined();
    expect(perspective).toBeDefined();
    for (const [definition, params] of [
      [dog!, { fineRadius: 4, broadRadius: 2 }],
      [
        perspective!,
        {
          topLeft: [0, 0],
          topRight: [0.5, 0],
          bottomRight: [1, 0],
          bottomLeft: [0, 1],
        },
      ],
    ] as const) {
      const original = OWNED_NEXT_CONSOLIDATED_PRESETS.find(
        (preset) => preset.definitionId === definition.id,
      );
      expect(original).toBeDefined();
      expect(
        validateEffectDocument({
          schemaVersion: 2,
          definitions: [definition],
          instances: [],
          presets: [{ ...original!, params }],
        }).errors.length,
      ).toBeGreaterThan(0);
    }
  });
});
