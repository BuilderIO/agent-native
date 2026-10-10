import { OWNED_P_DEFINITIONS } from "@shared/native-effect-owned-p";
import { NativeEffectParameterConstraintError } from "@shared/native-effect-parameter-constraints";
import { NATIVE_EFFECT_LATEST_DEFINITIONS } from "@shared/native-effect-presets";
import { packNativeProperties } from "@shared/native-effects";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
const captured = vi.hoisted(
  () => [] as { label: string; min?: number; max?: number }[],
);
vi.mock("./NativeNumericScrub", () => ({
  NativeNumericScrub: (props: {
    label: string;
    min?: number;
    max?: number;
  }) => {
    captured.push(props);
    return null;
  },
  nativeNumericDraft: () => {
    throw new Error("unused stub");
  },
}));
vi.mock("@/components/ui/slider", () => ({ Slider: () => null }));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { nativeOrderedNumericBounds } from "./native-ordered-numeric-bounds";
import {
  nativeDisplayedNumber,
  nativeStoredNumber,
  NativeEffectControls,
} from "./NativeEffectControls";

const heatmap = OWNED_P_DEFINITIONS.find((d) =>
  d.id.endsWith("density-heatmap"),
)!;
describe("ordered numeric control boundary", () => {
  it("offers inward rounded ordered endpoints that survive display/storage and packing", () => {
    for (const scale of [1, 100, 0.01, 3])
      for (const high of [0.75, 0.58, 0.635315872453797, 0.4510741931463814]) {
        const scaled = {
          ...heatmap,
          properties: {
            ...heatmap.properties,
            low: { ...heatmap.properties.low, displayScale: scale },
          },
        };
        const max = nativeOrderedNumericBounds(scaled, "low", { high }).max!;
        const stored = nativeStoredNumber(
          nativeDisplayedNumber(max, scale),
          scale,
        );
        expect(high - stored).toBeGreaterThanOrEqual(0.001);
        expect(() =>
          packNativeProperties(heatmap, { low: stored, high }),
        ).not.toThrow();
      }
    for (const scale of [1, 100, 0.01, 3])
      for (const low of [0.18, 0.32, 0.635315872453797, 0.4510741931463814]) {
        const scaled = {
          ...heatmap,
          properties: {
            ...heatmap.properties,
            high: { ...heatmap.properties.high, displayScale: scale },
          },
        };
        const min = nativeOrderedNumericBounds(scaled, "high", { low }).min!;
        const stored = nativeStoredNumber(
          nativeDisplayedNumber(min, scale),
          scale,
        );
        expect(stored - low).toBeGreaterThanOrEqual(0.001);
        expect(() =>
          packNativeProperties(heatmap, { low, high: stored }),
        ).not.toThrow();
      }
  });
  it("leaves unrelated numeric bounds intact and preserves unreadable/exhausted failures", () => {
    expect(nativeOrderedNumericBounds(heatmap, "radius", {})).toEqual({
      min: 0,
      max: 64,
    });
    for (const high of [null, NaN, Infinity])
      expect(() =>
        nativeOrderedNumericBounds(heatmap, "low", { high }),
      ).toThrow(NativeEffectParameterConstraintError);
    expect(() =>
      nativeOrderedNumericBounds(heatmap, "low", { high: 0 }),
    ).toThrow(NativeEffectParameterConstraintError);
    expect(() =>
      nativeOrderedNumericBounds(heatmap, "high", { low: 1 }),
    ).toThrow(NativeEffectParameterConstraintError);
  });
  it("uses the bounds in the normal numeric inspector and keeps the preexisting DoG gap valid", () => {
    captured.length = 0;
    const definition = {
      ...heatmap,
      properties: {
        low: heatmap.properties.low!,
        high: heatmap.properties.high!,
      },
    };
    const html = renderToStaticMarkup(
      createElement(NativeEffectControls, {
        definition,
        values: { low: 0.18, high: 0.75 },
        disabled: false,
        onValueChange: () => {
          throw new Error("render must not commit");
        },
      }),
    );
    expect(html).toContain("grid");
    expect(captured).toHaveLength(2);
    const low = captured.find((p) => p.label.includes("Low"))!;
    const high = captured.find((p) => p.label.includes("High"))!;
    expect(low.max).toBeLessThan(0.75);
    expect(high.min).toBeGreaterThan(0.18);
    expect(() =>
      packNativeProperties(heatmap, { low: low.max!, high: 0.75 }),
    ).not.toThrow();
    expect(() =>
      packNativeProperties(heatmap, { low: 0.18, high: high.min! }),
    ).not.toThrow();
    const dog = NATIVE_EFFECT_LATEST_DEFINITIONS.find(
      (d) => d.id === "an-native-owned-next-dog-ink",
    )!;
    const max = nativeOrderedNumericBounds(dog, "fineRadius", {
      broadRadius: 2.75,
    }).max!;
    expect(2.75 - max).toBeGreaterThanOrEqual(0.05);
    expect(() =>
      packNativeProperties(dog, { fineRadius: max, broadRadius: 2.75 }),
    ).not.toThrow();
  });
});
