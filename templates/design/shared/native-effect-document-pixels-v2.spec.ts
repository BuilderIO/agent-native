import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import {
  DOCUMENT_PIXEL_V2_EFFECTS,
  HISTORICAL_DOCUMENT_PIXEL_EFFECTS,
} from "./native-effect-document-pixels-v2";
import {
  NATIVE_EFFECT_BUILTIN_VERSIONS,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
} from "./native-effect-presets";
import { nativeEffectRequiresHistoricalDensity } from "./native-effect-raster-density-policy";
import { nativeEffectExecutionPayload } from "./native-effect-trust";
import { packNativeProperties, validateEffectDocument } from "./native-effects";

const archivedHashes = [
  "7b86c2c3c3f569f727cb606566c48681e01e4a367d900565f35b7b9dabc6cc16",
  "c0a86113ebcab60dc3713187a0409b6eabea2ad5c3312bb98bd348c4d8452e80",
  "cfb03253eea508c8617634fd0668a3828cc0663379a716116930f62d4a32edbc",
];
describe("document pixel shader versions", () => {
  it("preserves immutable historical execution hashes and one latest card per ID", () => {
    HISTORICAL_DOCUMENT_PIXEL_EFFECTS.forEach((legacy, index) => {
      expect(
        createHash("sha256")
          .update(JSON.stringify(nativeEffectExecutionPayload(legacy)))
          .digest("hex"),
      ).toBe(archivedHashes[index]);
      expect(
        NATIVE_EFFECT_BUILTIN_VERSIONS.filter(
          (d) => d.id === legacy.id && d.version === 1,
        ),
      ).toEqual([legacy]);
      expect(
        NATIVE_EFFECT_LATEST_DEFINITIONS.filter((d) => d.id === legacy.id),
      ).toEqual([DOCUMENT_PIXEL_V2_EFFECTS[index]]);
    });
  });
  it("grants historical density only to exact canonical archived execution payloads", () => {
    for (const legacy of HISTORICAL_DOCUMENT_PIXEL_EFFECTS) {
      expect(nativeEffectRequiresHistoricalDensity(legacy)).toBe(true);
      expect(
        nativeEffectRequiresHistoricalDensity({
          ...legacy,
          passes: legacy.passes.map((p) => ({
            ...p,
            wgsl: p.wgsl + "\n// changed",
          })),
        }),
      ).toBe(false);
    }
    for (const latest of DOCUMENT_PIXEL_V2_EFFECTS)
      expect(nativeEffectRequiresHistoricalDensity(latest)).toBe(false);
  });
  it.each(DOCUMENT_PIXEL_V2_EFFECTS)(
    "retains valid property ABI and bounded graph for $id",
    (definition) => {
      const legacy = HISTORICAL_DOCUMENT_PIXEL_EFFECTS.find(
        (d) => d.id === definition.id,
      )!;
      expect(definition.properties).toEqual(legacy.properties);
      expect(packNativeProperties(definition, {})).toEqual(
        packNativeProperties(legacy, {}),
      );
      expect(
        validateEffectDocument({
          schemaVersion: 2,
          definitions: [definition],
          instances: [],
        }).errors,
      ).toEqual([]);
      expect(nativeEffectAnimationCapability(definition)).toBe(
        definition.id === "an-native-lens-distortion" ? "static" : "animated",
      );
    },
  );
});
