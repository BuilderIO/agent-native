import { describe, expect, it } from "vitest";

import { planEffectPasses } from "./effect-graph";
import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import { catalogColor } from "./native-effect-catalog-kit";
import { getNativeEffectPropertyPresentation } from "./native-effect-property-presentation";
import {
  GLOWING_WAVES_EFFECT,
  IMAGE_DITHERING_EFFECT,
  NEBULA_EFFECT,
  WAVES_EFFECT,
} from "./native-effect-v1-graphics";
import {
  applyNativeEffectToHtml,
  packNativeProperties,
  parseEffectsFromHtml,
  propertySlots,
  validateEffectDocument,
} from "./native-effects";

const html =
  '<html><body><div data-agent-native-node-id="target"></div></body></html>';

describe("original V1 graphic shaders", () => {
  it.each([
    IMAGE_DITHERING_EFFECT,
    WAVES_EFFECT,
    NEBULA_EFFECT,
    GLOWING_WAVES_EFFECT,
  ])("$name has valid defaults and a bounded render graph", (definition) => {
    const validation = validateEffectDocument({
      schemaVersion: 2,
      definitions: [definition],
      instances: [],
    });
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
    const plan = planEffectPasses(
      definition.passes,
      definition.resources,
      definition.output,
    );
    expect(plan.errors).toEqual([]);
    expect(plan.passes).toHaveLength(1);
    expect(plan.passes[0]!.reads).toEqual(
      definition.kind === "processor" ? ["source"] : [],
    );
    expect(plan.resources.find(({ name }) => name === "color")).toMatchObject({
      format: "rgba16float",
      external: false,
    });
    expect(
      Object.values(definition.properties).reduce(
        (sum, property) => sum + propertySlots(property),
        0,
      ),
    ).toBeLessThanOrEqual(32);
  });

  it("keeps Nebula star-free and exposes useful controls for both native fills", () => {
    for (const definition of [NEBULA_EFFECT, GLOWING_WAVES_EFFECT]) {
      expect(definition.kind).toBe("generator");
      expect(definition.placements).toEqual(["fill"]);
      expect(nativeEffectAnimationCapability(definition)).toBe("animated");
    }

    expect(NEBULA_EFFECT.properties).not.toHaveProperty("stars");
    expect(NEBULA_EFFECT.passes[0]!.wgsl).not.toMatch(/star/i);
    expect(
      getNativeEffectPropertyPresentation(NEBULA_EFFECT, "cloudDensity"),
    ).toMatchObject({ displayScale: 100, unit: "%" });
    expect(
      getNativeEffectPropertyPresentation(GLOWING_WAVES_EFFECT, "glowWidth"),
    ).toMatchObject({ unit: "px" });
    expect(
      getNativeEffectPropertyPresentation(
        GLOWING_WAVES_EFFECT,
        "wavesAcrossWidth",
      ),
    ).toMatchObject({ unit: "", step: 0.1 });
  });

  it.each(["layer", "backdrop"] as const)(
    "persists the source-processing %s placement and exact selected palette",
    (placement) => {
      const palette = [catalogColor(1, 0, 0, 0.4), catalogColor(0, 0, 1)];
      const result = applyNativeEffectToHtml(html, {
        nodeId: "target",
        definition: IMAGE_DITHERING_EFFECT,
        placement,
        params: { palette, cellSize: 3, contrast: 1.25, amount: 0.7 },
      });
      expect(result.errors).toEqual([]);
      const instance = parseEffectsFromHtml(result.html).document!
        .instances[0]!;
      expect(instance).toMatchObject({
        definitionId: "an-native-image-dithering",
        definitionVersion: 1,
        placement,
        params: { palette, cellSize: 3, contrast: 1.25, amount: 0.7 },
      });
      const packed = packNativeProperties(
        IMAGE_DITHERING_EFFECT,
        instance.params,
      );
      expect(Array.from(packed.slice(0, 12))).toEqual([
        2,
        0,
        0,
        0,
        1,
        0,
        0,
        expect.closeTo(0.4, 6),
        0,
        0,
        1,
        1,
      ]);
      expect(packed[36]).toBe(3);
      expect(packed[40]).toBe(1.25);
      expect(packed[44]).toBeCloseTo(0.7);
      expect(IMAGE_DITHERING_EFFECT.properties).not.toHaveProperty("edge");
    },
  );

  it("packs every wave ramp color, opacity, and unsorted position without overlapping controls", () => {
    const palette = Array.from({ length: 8 }, (_, index) => ({
      position: 1 - index / 7,
      color: catalogColor(index % 2, (index + 1) % 2, 1, index / 7),
    }));
    const result = applyNativeEffectToHtml(html, {
      nodeId: "target",
      definition: WAVES_EFFECT,
      placement: "fill",
      params: {
        palette,
        scale: 2,
        amplitude: 0.3,
        frequency: 4,
        softness: 0.2,
        rotation: -1,
        movement: 0,
      },
      timing: { speed: 0.5, paused: false, time: 2 },
    });
    expect(result.errors).toEqual([]);
    const instance = parseEffectsFromHtml(result.html).document!.instances[0]!;
    expect(instance.params.palette).toEqual(palette);
    expect(instance.timing).toEqual({ speed: 0.5, paused: false, time: 2 });
    const packed = packNativeProperties(WAVES_EFFECT, instance.params);
    expect(packed[0]).toBe(8);
    palette.forEach(({ position, color }, index) => {
      const offset = (1 + index * 2) * 4;
      expect(Array.from(packed.slice(offset, offset + 3))).toEqual(
        color.components,
      );
      expect(packed[offset + 3]).toBeCloseTo(color.alpha);
      expect(packed[offset + 4]).toBeCloseTo(position);
    });
    expect(
      Array.from(packed.slice(68, 92).filter((_, index) => index % 4 === 0)),
    ).toEqual([2, expect.closeTo(0.3, 6), 4, expect.closeTo(0.2, 6), -1, 0]);
    expect(WAVES_EFFECT.properties).not.toHaveProperty("speed");
  });

  it.each([IMAGE_DITHERING_EFFECT, WAVES_EFFECT])(
    "$name rejects a ninth palette entry and out-of-range geometry",
    (definition) => {
      const property = definition.properties.palette!;
      if (property.type !== "color-array" && property.type !== "color-ramp")
        throw new Error("graphics-palette-missing");
      expect(() =>
        packNativeProperties(definition, {
          palette: Array(9).fill(property.default[0]),
        }),
      ).toThrow();
    },
  );

  it.each([
    [IMAGE_DITHERING_EFFECT, { cellSize: 0 }],
    [WAVES_EFFECT, { scale: 0 }],
    [NEBULA_EFFECT, { scale: 0 }],
    [GLOWING_WAVES_EFFECT, { amplitude: 0 }],
  ] as const)("$0 rejects out-of-range geometry", (definition, params) => {
    expect(() => packNativeProperties(definition, params)).toThrow();
  });
});
