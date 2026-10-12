import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { CoordinateRandomRewriteError } from "./native-effect-coordinate-random";
import {
  createCoordinateRandomCatalog,
  createCoordinateRandomRecipes,
} from "./native-effect-coordinate-random-catalog";
import { HIGHLIGHT_STREAKS_EFFECT } from "./native-effect-highlight-streaks";
import { OWNED_NEXT_SIX_R_DEFINITIONS } from "./native-effect-owned-next-six-r";
import { OWNED_NEXT_TWELVE_S_DEFINITIONS } from "./native-effect-owned-next-twelve-s";
import { OWNED_NEXT_TWELVE_T_DEFINITIONS } from "./native-effect-owned-next-twelve-t";
import { OWNED_NEXT_TWELVE_U_DEFINITIONS } from "./native-effect-owned-next-twelve-u";
import { OWNED_O_EDGE_GLASS_DEFINITIONS } from "./native-effect-owned-o-edge-glass";
import { OWNED_O_EDGE_LIGHT_LEAK_V2 } from "./native-effect-owned-o-edge-light-leak-v2";
import { OWNED_O_GENERATOR_DEFINITIONS } from "./native-effect-owned-o-generators";
import { OWNED_P_DEFINITIONS } from "./native-effect-owned-p";
import { OWNED_P2_DEFINITIONS } from "./native-effect-owned-p2";
import { OWNED_Q_DEFINITIONS } from "./native-effect-owned-q";
import { STATEFUL_NINE_DEFINITIONS } from "./native-effect-owned-stateful-nine";
import { OWNED_V_FIELD_DEFINITIONS } from "./native-effect-owned-v-fields";
import { LUMA_DCT_EIGHT_EFFECT } from "./native-effect-owned-v-luma-dct";
import { NATIVE_PERIMETER_FOCAL_DEFINITIONS } from "./native-effect-perimeter-focal";
import {
  NATIVE_COORDINATE_RANDOM_DEFINITIONS,
  NATIVE_COORDINATE_RANDOM_PRESETS,
  NATIVE_COORDINATE_RANDOM_PRESET_SOURCE_IDS,
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import {
  hashEffectDefinition,
  nativeSceneExecutableHashes,
  NativeSceneAuthorizationError,
} from "./native-effect-trust";
import {
  parseEffectsFromHtml,
  validateEffectDocument,
  writeEffectsToHtml,
  type EffectDocument,
} from "./native-effects";

// Later additions follow these pinned historical prefixes.
const historical = NATIVE_EFFECT_DEFINITION_CATALOG.slice(0, 232);
const oldRecipes = NATIVE_EFFECT_PRESETS.slice(0, 463);
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

describe("additive coordinate noise version integration", () => {
  it("preserves all232 historical hashes and463 recipe payloads while retaining their exact lineage alongside additional mechanisms", async () => {
    expect(historical).toHaveLength(232);
    expect(oldRecipes).toHaveLength(463);
    const entries = await Promise.all(
      historical.map(
        async (d) => `${d.id}@${d.version}:${await hashEffectDefinition(d)}`,
      ),
    );
    expect(digest(entries.sort().join("\n"))).toBe(
      "b66464b8a02245a76607e019c981bedc17b10adbb7605de2606f40998df4c682",
    );
    expect(digest(JSON.stringify(oldRecipes))).toBe(
      "195ae5af8cc98c0b524e9ada39bf2ffd914dff555640fb95b05c7037c6ff46b7",
    );
    expect(NATIVE_EFFECT_DEFINITION_CATALOG).toHaveLength(337);
    expect(NATIVE_EFFECT_PRESETS).toHaveLength(676);
    expect(NATIVE_COORDINATE_RANDOM_DEFINITIONS).toHaveLength(26);
    expect(NATIVE_COORDINATE_RANDOM_PRESETS).toHaveLength(53);
    expect(NATIVE_EFFECT_LATEST_DEFINITIONS).toHaveLength(291);
    expect(
      new Set(NATIVE_EFFECT_LATEST_DEFINITIONS.map((d) => d.id)).size,
    ).toBe(291);
    expect(new Set(NATIVE_EFFECT_LATEST_DEFINITIONS.map((d) => d.id))).toEqual(
      new Set(
        [
          ...historical,
          ...NATIVE_PERIMETER_FOCAL_DEFINITIONS,
          ...OWNED_O_GENERATOR_DEFINITIONS,
          ...OWNED_O_EDGE_GLASS_DEFINITIONS.filter(
            (definition) =>
              definition.id !== "an-native-owned-o-edge-light-leak",
          ),
          OWNED_O_EDGE_LIGHT_LEAK_V2,
          ...OWNED_P_DEFINITIONS,
          ...OWNED_P2_DEFINITIONS,
          ...OWNED_Q_DEFINITIONS,
          ...OWNED_NEXT_SIX_R_DEFINITIONS,
          ...OWNED_NEXT_TWELVE_S_DEFINITIONS,
          ...OWNED_NEXT_TWELVE_T_DEFINITIONS,
          ...OWNED_NEXT_TWELVE_U_DEFINITIONS,
          LUMA_DCT_EIGHT_EFFECT,
          ...OWNED_V_FIELD_DEFINITIONS,
          ...STATEFUL_NINE_DEFINITIONS,
          HIGHLIGHT_STREAKS_EFFECT,
        ].map((d) => d.id),
      ),
    );
  });
  it("selects the new exact versions and exposes only recipes with explicit unchanged source payload lineage", () => {
    for (const definition of NATIVE_COORDINATE_RANDOM_DEFINITIONS) {
      const previous = historical.find(
        (d) => d.id === definition.id && d.version === definition.version - 1,
      );
      expect(previous).toBeDefined();
      expect(
        NATIVE_EFFECT_LATEST_DEFINITIONS.find((d) => d.id === definition.id),
      ).toBe(definition);
      expect(definition.properties).toEqual(previous!.properties);
      expect(definition.resources).toEqual(previous!.resources);
      const recipes = NATIVE_COORDINATE_RANDOM_PRESETS.filter(
        (p) => p.definitionId === definition.id,
      );
      expect(recipes.length).toBeGreaterThan(0);
      expect(
        recipes.every((p) => p.definitionVersion === definition.version),
      ).toBe(true);
      expect(
        validateEffectDocument({
          schemaVersion: 2,
          definitions: [definition],
          instances: [],
          presets: recipes,
        }).errors,
      ).toEqual([]);
      for (const preset of recipes) {
        const source = oldRecipes.find(
          (p) => p.id === NATIVE_COORDINATE_RANDOM_PRESET_SOURCE_IDS[preset.id],
        );
        expect(source).toBeDefined();
        expect({
          ...preset,
          id: source!.id,
          definitionVersion: source!.definitionVersion,
        }).toEqual(source);
      }
    }
  });
  it("round trips old saved manifests and keeps old approvals distinct from rewritten payloads", async () => {
    for (const definition of NATIVE_COORDINATE_RANDOM_DEFINITIONS) {
      const previous = historical.find(
        (d) => d.id === definition.id && d.version === definition.version - 1,
      )!;
      const document: EffectDocument = {
        schemaVersion: 2,
        definitions: [previous],
        instances: [
          {
            id: "saved-noise",
            nodeId: "target",
            definitionId: previous.id,
            definitionVersion: previous.version,
            placement: "fill",
            params: {},
            enabled: true,
            opacity: 1,
            seed: 17,
            clip: "bounds",
            blend: "normal",
            timing: { speed: 1, paused: true, time: 0 },
          },
        ],
      };
      const parsed = parseEffectsFromHtml(
        writeEffectsToHtml(
          '<div data-agent-native-node-id="target"></div>',
          document,
        ),
      );
      expect(parsed.errors).toEqual([]);
      expect(parsed.document).toEqual(document);
      expect(
        await nativeSceneExecutableHashes(
          document,
          [],
          NATIVE_EFFECT_DEFINITION_CATALOG,
        ),
      ).toEqual([await hashEffectDefinition(previous)]);
      const changed: EffectDocument = {
        ...document,
        definitions: [definition],
        instances: document.instances.map((i) => ({
          ...i,
          definitionVersion: definition.version,
        })),
      };
      await expect(
        nativeSceneExecutableHashes(
          changed,
          [await hashEffectDefinition(previous)],
          historical,
        ),
      ).rejects.toMatchObject({ code: "unapproved" });
      expect(
        await nativeSceneExecutableHashes(
          changed,
          [],
          NATIVE_EFFECT_DEFINITION_CATALOG,
        ),
      ).toEqual([await hashEffectDefinition(definition)]);
    }
  });
  it("fails explicitly when expected definition or recipe lineage is missing", () => {
    expect(() => createCoordinateRandomCatalog([])).toThrow(
      CoordinateRandomRewriteError,
    );
    expect(() =>
      createCoordinateRandomRecipes(
        [],
        NATIVE_COORDINATE_RANDOM_DEFINITIONS,
        {},
      ),
    ).toThrow(CoordinateRandomRewriteError);
  });
});
