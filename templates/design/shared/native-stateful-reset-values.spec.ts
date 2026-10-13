import { describe, expect, it } from "vitest";

import { CONTENT_BOUNDS_TRACKER_EFFECT } from "./native-effect-owned-ar-content-bounds-tracker";
import { FEATURE_TRAILS_EFFECT } from "./native-effect-owned-as-feature-trails";
import { CONTENT_BOUNDS_TRACKER_V2_EFFECT } from "./native-effect-owned-at-content-bounds-tracker-v2";
import type { EffectDefinition } from "./native-effects";
import {
  nativeStatefulResetValuesChanged,
  NativeStatefulResetValueError,
  snapshotNativeStatefulResetValues,
} from "./native-stateful-reset-values";

describe("stateful reset value snapshots", () => {
  it("accepts enum defaults in registered exact tracker definitions", () => {
    for (const definition of [
      CONTENT_BOUNDS_TRACKER_EFFECT,
      CONTENT_BOUNDS_TRACKER_V2_EFFECT,
      FEATURE_TRAILS_EFFECT,
    ]) {
      const graph = definition.resourceGraph;
      if (!graph || graph.abi === "linear-resource-v1")
        throw new Error("Registered tracker lacks a stateful graph");
      const names = graph.resetProperties ?? [];
      const initial = snapshotNativeStatefulResetValues(definition, {}, names);
      expect(initial).toHaveLength(names.length);
      expect(nativeStatefulResetValuesChanged(initial, initial)).toBe(false);
      const next = snapshotNativeStatefulResetValues(
        definition,
        { detect: "dark" },
        names,
      );
      expect(nativeStatefulResetValuesChanged(initial, next)).toBe(true);
    }
  });

  it("snapshots each declared property type without retaining mutable values", () => {
    const definition: EffectDefinition = {
      ...CONTENT_BOUNDS_TRACKER_EFFECT,
      properties: {
        ...CONTENT_BOUNDS_TRACKER_EFFECT.properties,
        active: { type: "bool", label: "Active", default: false },
        tint: {
          type: "color",
          label: "Tint",
          default: { space: "srgb", components: [1, 0.5, 0], alpha: 1 },
        },
        offset: { type: "vec2", label: "Offset", default: [0, 0] },
        center: {
          type: "position",
          label: "Center",
          default: "center",
          basis: "viewport",
        },
        palette: {
          type: "color-array",
          label: "Palette",
          default: [],
          maxCount: 4,
        },
        image: {
          type: "texture",
          label: "Image",
          default: null,
          input: "source",
        },
      },
    };
    const names = [
      "detect",
      "active",
      "tint",
      "offset",
      "center",
      "palette",
      "image",
    ];
    const tint = {
      space: "srgb" as const,
      components: [1, 0.5, 0] as [number, number, number],
      alpha: 1,
    };
    const offset: [number, number] = [0, 0];
    const params = { tint, offset };
    const initial = snapshotNativeStatefulResetValues(
      definition,
      params,
      names,
    );
    tint.components[1] = 0.25;
    offset[0] = 4;
    const changed = snapshotNativeStatefulResetValues(
      definition,
      params,
      names,
    );
    expect(nativeStatefulResetValuesChanged(initial, changed)).toBe(true);
    expect(
      nativeStatefulResetValuesChanged(
        changed,
        snapshotNativeStatefulResetValues(definition, params, names),
      ),
    ).toBe(false);
    expect(
      nativeStatefulResetValuesChanged(
        changed,
        snapshotNativeStatefulResetValues(
          definition,
          {
            ...params,
            active: true,
            image: { kind: "asset", url: "/uploads/test.png" },
          },
          names,
        ),
      ),
    ).toBe(true);
  });

  it("rejects malformed reset values rather than creating a usable snapshot", () => {
    const definition = CONTENT_BOUNDS_TRACKER_EFFECT;
    for (const [name, value] of [
      ["detect", "missing"],
      ["detect", 3],
      ["threshold", Number.NaN],
      ["cells", 2.5],
    ] as const) {
      expect(() =>
        snapshotNativeStatefulResetValues(definition, { [name]: value }, [
          name,
        ]),
      ).toThrow(NativeStatefulResetValueError);
    }
  });
});
