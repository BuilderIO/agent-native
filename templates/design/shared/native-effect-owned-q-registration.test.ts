import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { planNativeEffectExtent } from "../app/components/design/bridge/native-effect-extent";
import { planEffectGraph } from "./effect-graph";
import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import { editNativeEffectHtml } from "./native-effect-edits";
import {
  HIGHLIGHT_STREAKS_EFFECT,
  HIGHLIGHT_STREAKS_PRESETS,
} from "./native-effect-highlight-streaks";
import { OWNED_Q_DEFINITIONS, OWNED_Q_PRESETS } from "./native-effect-owned-q";
import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import { hashEffectDefinition } from "./native-effect-trust";
import { parseEffectsFromHtml, validateEffectDocument } from "./native-effects";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const html = '<div data-agent-native-node-id="target"></div>';

const expectedHashes: Record<string, string> = {
  "an-native-owned-q-alpha-cast-shadow@2":
    "87a25532b175b11d8c2c7a19be2ed813bc00646b1fe1a660865294356f385aac",
  "an-native-owned-q-block-transform@2":
    "95937a142d75a5536d64a4fca6bdad2e7d3979dfd3436467b2d23694ecc8a48e",
  "an-native-owned-q-gabor-packets@1":
    "d4c64723c05a2e350cdfcc04256d60ace926e3ef6e777a21badb0cab253b05e1",
  "an-native-owned-q-haar-detail-field@1":
    "ca73531e2b23700c17f145b3838c42540d7d3803087d16cda079ebc1e103386c",
  "an-native-owned-q-star-cutout@1":
    "79630559b0b57b246307127abd7748d3562da4a380cff2da65c5d8899de3c226",
  "an-native-owned-q-checker-phase@1":
    "c3ec6bd6fe65f338b160f64def035cefed3570f9958aae1e910865cbb7e35696",
};

describe("additive Q catalog registration", () => {
  it("preserves the complete P2 snapshot and appends six exact rows", async () => {
    const priorDefinitions = [
      ...NATIVE_EFFECT_DEFINITION_CATALOG.slice(0, 273),
      HIGHLIGHT_STREAKS_EFFECT,
    ];
    const priorPresets = [
      ...NATIVE_EFFECT_PRESETS.slice(0, 548),
      ...HIGHLIGHT_STREAKS_PRESETS,
    ];
    expect(priorDefinitions).toHaveLength(274);
    expect(priorPresets).toHaveLength(550);
    const definitionRows = await Promise.all(
      priorDefinitions.map(
        async (definition) =>
          `${definition.id}@${definition.version}:${await hashEffectDefinition(definition)}`,
      ),
    );
    expect(sha(definitionRows.sort().join("\n"))).toBe(
      "cc3514f0e3daac0f9f7918adce006b9daf71fcdf9a029c7e9eaa0716f251e0ba",
    );
    expect(sha(JSON.stringify(priorPresets))).toBe(
      "01322e5312a67fabb0af64549ee2ec93b6a44e12c97e94374d3412e4b5fb186e",
    );
    expect(NATIVE_EFFECT_LATEST_DEFINITIONS).toHaveLength(291);
    expect(NATIVE_EFFECT_DEFINITION_CATALOG).toHaveLength(337);
    expect(NATIVE_EFFECT_PRESETS).toHaveLength(676);
    expect(
      Object.fromEntries(
        (["fill", "layer", "backdrop"] as const).map((placement) => [
          placement,
          NATIVE_EFFECT_LATEST_DEFINITIONS.filter((definition) =>
            definition.placements.includes(placement),
          ).length,
        ]),
      ),
    ).toEqual({ fill: 147, layer: 144, backdrop: 108 });
    expect(
      Object.fromEntries(
        (["fill", "layer", "backdrop"] as const).map((placement) => [
          placement,
          NATIVE_EFFECT_DEFINITION_CATALOG.filter((definition) =>
            definition.placements.includes(placement),
          ).length,
        ]),
      ),
    ).toEqual({ fill: 188, layer: 149, backdrop: 110 });
    expect(
      new Set(
        NATIVE_EFFECT_LATEST_DEFINITIONS.map((definition) => definition.id),
      ).size,
    ).toBe(291);
    expect(new Set(NATIVE_EFFECT_PRESETS.map((preset) => preset.id)).size).toBe(
      676,
    );
  });

  it("registers the six exact static candidates with applicable graphs and placements", async () => {
    expect(
      OWNED_Q_DEFINITIONS.map(
        (definition) => `${definition.id}@${definition.version}`,
      ),
    ).toEqual(Object.keys(expectedHashes));
    for (const definition of OWNED_Q_DEFINITIONS) {
      expect(await hashEffectDefinition(definition)).toBe(
        expectedHashes[`${definition.id}@${definition.version}`],
      );
      expect(
        NATIVE_EFFECT_LATEST_DEFINITIONS.find(
          (entry) => entry.id === definition.id,
        ),
      ).toBe(definition);
      expect(
        NATIVE_EFFECT_DEFINITION_CATALOG.filter(
          (entry) => entry.id === definition.id,
        ),
      ).toEqual([definition]);
      expect(planEffectGraph(definition).errors, definition.id).toEqual([]);
      expect(nativeEffectAnimationCapability(definition)).toBe("static");
      expect(
        nativeEffectAnimationCapability({
          ...definition,
          version: definition.version + 1,
        }),
      ).toBe("unknown");
      expect(
        nativeEffectAnimationCapability({ ...definition, name: "Edited name" }),
      ).toBe("static");
      expect(
        nativeEffectAnimationCapability({
          ...definition,
          properties: {
            ...definition.properties,
            probe: {
              type: "float",
              label: "Probe",
              default: 0,
              min: 0,
              max: 1,
              step: 0.01,
            },
          },
        }),
      ).toBe("unknown");
      expect(definition.provenance.upstream).toBeUndefined();
      expect(
        validateEffectDocument({
          schemaVersion: 2,
          definitions: [definition],
          instances: [],
          presets: OWNED_Q_PRESETS.filter(
            (preset) => preset.definitionId === definition.id,
          ),
        }).errors,
      ).toEqual([]);
    }
    const block = OWNED_Q_DEFINITIONS.find((definition) =>
      definition.id.endsWith("block-transform"),
    )!;
    expect(block.properties).not.toHaveProperty("edge");
    expect(OWNED_Q_PRESETS).toHaveLength(12);
  });

  it("keeps Alpha Shadow extent within the layer bounds contract", () => {
    const shadow = OWNED_Q_DEFINITIONS.find((definition) =>
      definition.id.endsWith("alpha-cast-shadow"),
    )!;
    for (const [pixelRatio, width, height] of [
      [1, 404, 324],
      [2, 808, 648],
    ] as const) {
      expect(
        planNativeEffectExtent({
          extent: shadow.extent,
          placement: "layer",
          clip: "bounds",
          cssWidth: 320,
          cssHeight: 240,
          pixelRatio,
          maxDimension: 4096,
          maxPixels: 8_388_608,
        }),
      ).toMatchObject({ ok: true, plan: { width, height, expanded: true } });
    }
    for (const placement of ["fill", "backdrop"] as const)
      expect(
        planNativeEffectExtent({
          extent: shadow.extent,
          placement,
          clip: "bounds",
          cssWidth: 320,
          cssHeight: 240,
          pixelRatio: 1,
          maxDimension: 4096,
          maxPixels: 8_388_608,
        }),
      ).toMatchObject({ ok: false, code: "effect-output-extent-unsupported" });
  });

  it.each(OWNED_Q_PRESETS)(
    "applies $id through shared edits with exact version and recipe parameters",
    (preset) => {
      const result = editNativeEffectHtml(html, {
        kind: "apply-preset",
        nodeId: "target",
        presetId: preset.id,
      });
      expect(result.errors).toEqual([]);
      const parsed = parseEffectsFromHtml(result.html);
      expect(parsed.errors).toEqual([]);
      expect(parsed.document?.instances[0]).toMatchObject({
        definitionId: preset.definitionId,
        definitionVersion: preset.definitionVersion,
        placement: preset.placement,
        params: preset.params,
      });
    },
  );
});
