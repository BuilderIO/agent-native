import { describe, expect, it } from "vitest";

import { GRAIN_GRADIENT_EFFECT } from "./native-effect-presets";
import { hashEffectDefinition } from "./native-effect-trust";
import { createWideColorGrainEffect } from "./native-effect-wide-color";
import { packNativeProperties, validateEffectDocument } from "./native-effects";

describe("versioned wide-color grain", () => {
  it("keeps the pinned v2 definition separate and validates a float P3 v3 path", async () => {
    const wide = createWideColorGrainEffect(GRAIN_GRADIENT_EFFECT);
    expect(wide.version).toBe(3);
    expect(GRAIN_GRADIENT_EFFECT.version).toBe(2);
    expect(
      wide.resources?.find((resource) => resource.name === "color")?.format,
    ).toBe("rgba16float");
    expect(
      GRAIN_GRADIENT_EFFECT.resources?.find(
        (resource) => resource.name === "color",
      )?.format,
    ).toBe("rgba8unorm");
    const packed = packNativeProperties(wide, {});
    expect(packed[0]).toBeGreaterThan(1);
    expect(
      validateEffectDocument({
        schemaVersion: 2,
        definitions: [wide],
        instances: [
          {
            id: "wide-grain",
            nodeId: "wide-target",
            definitionId: wide.id,
            definitionVersion: wide.version,
            placement: "fill",
            params: {},
            enabled: true,
            opacity: 1,
            seed: 7,
            clip: "bounds",
            blend: "normal",
            timing: { speed: 1, paused: true, time: 0 },
          },
        ],
      }).valid,
    ).toBe(true);
    expect(await hashEffectDefinition(wide)).not.toBe(
      await hashEffectDefinition(GRAIN_GRADIENT_EFFECT),
    );
  });
});
