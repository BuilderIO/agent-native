import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import { editNativeEffectHtml } from "./native-effect-edits";
import {
  OWNED_NEXT_TWELVE_S_DEFINITIONS,
  OWNED_NEXT_TWELVE_S_PRESETS,
} from "./native-effect-owned-next-twelve-s";
import {
  OWNED_NEXT_TWELVE_T_DEFINITIONS,
  OWNED_NEXT_TWELVE_T_PRESETS,
} from "./native-effect-owned-next-twelve-t";
import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import { hashEffectDefinition } from "./native-effect-trust";
import {
  packNativeProperties,
  parseEffectsFromHtml,
  validateEffectDocument,
} from "./native-effects";

const executionHashes = new Map([
  [
    "an-native-owned-s-angular-path-blur@1",
    "d5d58fed19227f1c0323ffcdd88e60bb40821cb9decbb1e297d0d0dcd21aba02",
  ],
  [
    "an-native-owned-s-parabolic-bend@1",
    "85a1c229de0d273829e6589b78ed5b6e6eb61b60c8a941aaab23b73ec1591955",
  ],
  [
    "an-native-owned-s-sphere-surface-refract@1",
    "df3f50c3024121e86b6fb8614a69555ab62577242042ef8672223dedb25143c8",
  ],
  [
    "an-native-owned-s-block-seam-restoration@1",
    "ba117c6bbd6f84a148592f6a1e0acc6af5af64038806ee0d084b4aa741bfd6e1",
  ],
  [
    "an-native-owned-s-chalk-transfer@1",
    "d0391f7881c8caa54310d706e4b6b1d0c302fddd06f6315bd441f6d8e77fcde7",
  ],
  [
    "an-native-owned-s-haar-shrink@1",
    "de5bd1b7fd03c0f29f8857ba48eda170c47342744126a92ce7deb4935a50de55",
  ],
  [
    "an-native-owned-s-triangular-beam-lattice@1",
    "ad10f5b6c5994439bf139af78dd145a6ad05b6b82cb743796915128c9f375553",
  ],
  [
    "an-native-owned-s-chevron-interlock@1",
    "d91a59d52ca4a81ec0dad2bd5078edf6d0bb218eab6b9241c36d377a7dcd0e12",
  ],
  [
    "an-native-owned-s-power-cell-relief@1",
    "12ceb24fe427c0f46363042beffbac4ff828483fac7fffa9b72139d88b234722",
  ],
  [
    "an-native-owned-s-catenary-cables@1",
    "53781a352b6210cb6abfba12e15b11cff4c04c775337dc6759e62fafcaf0cb6d",
  ],
  [
    "an-native-owned-s-limacon-contours@1",
    "2d1846090c9da0d7c44d1c179a17a93066450fecad8c4a9cc6190cecdbd1c6d4",
  ],
  [
    "an-native-owned-s-rain-plume-field@1",
    "3a5a726e103f559b0f304be1a86f7cd96284f3e582263014bd639b1273ddda04",
  ],
  [
    "an-native-owned-t-paired-band-exchange@1",
    "99659f1a15da4e51827f2c64d9f952e1d1c01a19d36f94d5948347b50a78a96d",
  ],
  [
    "an-native-owned-t-concentric-rotor@1",
    "2f04a5f2bf0fd9ea4224e03b27b030064c69043a27ff8cd0d2a1d6f12c4c5128",
  ],
  [
    "an-native-owned-t-node-grid-warp@2",
    "d6a678879cb3c2f0d5dc0b50f3687f16e083d18ff9f7438e78b398bc764aaba9",
  ],
  [
    "an-native-owned-t-luma-tail-integrator@1",
    "4d30ac81b5893b1ea149e8bd4e7fadd34a3573ff0593d0ccfd960d777359af21",
  ],
  [
    "an-native-owned-t-chalkboard-rubbing@1",
    "2857e320932af5d964c79eab0cdcc980e672e1ff269a560ff443a71c11a27b99",
  ],
  [
    "an-native-owned-t-door-reveal@2",
    "901f0a0408b7fd7870d3d2d058d470ae678a50281149f3ec91700aac4af6b861",
  ],
  [
    "an-native-owned-t-stochastic-block-field@2",
    "5a7e98135b0cf3fb90fac7fe09156f7f6106478b2376deace1dd8d86c80eb7c2",
  ],
  [
    "an-native-owned-t-offset-dot-matrix@1",
    "9b629b8b2d81b3ef23a15bdec69f12a9c6154b9644eef5a5cc83648a4c6b7df3",
  ],
  [
    "an-native-owned-t-pinned-strand-array@2",
    "612f6890a142de97b874f5560367ce9334370103836b8062b7e3f1b38e9a388d",
  ],
  [
    "an-native-owned-t-rational-conic-ribbon@1",
    "5db0e2c77629ec1231d184aec4bf0802ad3e11b6aa2328e4a1d110195e2d5431",
  ],
  [
    "an-native-owned-t-crescent-boolean@1",
    "8de77139fe54e13b5b89e3e8839c8bce6e3f44d66ec8a3ff2424803d5b58a7b3",
  ],
  [
    "an-native-owned-t-rose-locus@2",
    "2533f510a1eebd4910d11d97664600b6f074083e299a0fc87ef5753edaff259b",
  ],
]);
const definitions = [
  ...OWNED_NEXT_TWELVE_S_DEFINITIONS,
  ...OWNED_NEXT_TWELVE_T_DEFINITIONS,
];
const presets = [
  ...OWNED_NEXT_TWELVE_S_PRESETS,
  ...OWNED_NEXT_TWELVE_T_PRESETS,
];
const html = '<div data-agent-native-node-id="target"></div>';

describe("S/T native effect registration", () => {
  it("adds the exact source definitions and recipes", () => {
    expect(NATIVE_EFFECT_LATEST_DEFINITIONS).toHaveLength(291);
    expect(
      new Set(NATIVE_EFFECT_LATEST_DEFINITIONS.map((d) => d.id)).size,
    ).toBe(291);
    expect(NATIVE_EFFECT_DEFINITION_CATALOG).toHaveLength(337);
    expect(NATIVE_EFFECT_PRESETS).toHaveLength(676);
    expect(new Set(NATIVE_EFFECT_PRESETS.map((p) => p.id)).size).toBe(676);
    expect(definitions).toHaveLength(24);
    expect(presets).toHaveLength(48);
  });

  it.each(presets)(
    "$id persists its exact recipe through shared native edits",
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

  it.each(
    definitions.map((definition) => [definition.id, definition] as const),
  )(
    "%s keeps its reviewed execution and validates for normal authoring",
    async (_id, definition) => {
      const key = `${definition.id}@${definition.version}`;
      expect(await hashEffectDefinition(definition), key).toBe(
        executionHashes.get(key),
      );
      expect(NATIVE_EFFECT_LATEST_DEFINITIONS).toContainEqual(definition);
      expect(NATIVE_EFFECT_DEFINITION_CATALOG).toContainEqual(definition);
      expect(nativeEffectAnimationCapability(definition), key).toBe("static");
      expect(planEffectGraph(definition).errors, key).toEqual([]);
      expect(packNativeProperties(definition).every(Number.isFinite), key).toBe(
        true,
      );
      const ownPresets = presets.filter(
        (preset) => preset.definitionId === definition.id,
      );
      expect(ownPresets).toHaveLength(2);
      expect(
        ownPresets.every(
          (preset) =>
            preset.definitionVersion === definition.version &&
            preset.placement ===
              (definition.kind === "generator" ? "fill" : "layer"),
        ),
      ).toBe(true);
      expect(
        validateEffectDocument({
          schemaVersion: 2,
          definitions: [definition],
          instances: [],
          presets: ownPresets,
        }).errors,
        key,
      ).toEqual([]);
    },
  );
});
