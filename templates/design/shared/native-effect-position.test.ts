import { describe, expect, it } from "vitest";

import { catalogShader, CATALOG_EDGE } from "./native-effect-catalog-kit";
import { editNativeEffectHtml } from "./native-effect-edits";
import {
  isNativePositionValue,
  packNativePosition,
  resolveNativePosition,
} from "./native-effect-position";
import { hashEffectDefinition } from "./native-effect-trust";
import {
  packNativeProperties,
  parseEffectsFromHtml,
  validateEffectDocument,
} from "./native-effects";

const positionEffect = catalogShader({
  id: "owned-position-test",
  name: "Position Test",
  kind: "processor",
  properties: {
    amount: {
      type: "float",
      label: "Amount",
      default: 1,
      min: 0,
      max: 2,
      step: 0.01,
    },
    center: {
      type: "position",
      label: "Center",
      default: { x: 0.5, y: 0.5 },
      basis: "viewport",
    },
    edge: structuredClone(CATALOG_EDGE),
  },
  fragment: () => "return sampleSource(input.uv);",
});

const geometry = {
  source: { width: 600, height: 400 },
  viewport: { width: 2400, height: 1200 },
  pixelRatio: 2,
};

describe("native Position2D property", () => {
  it("keeps keyword, percent, and CSS-pixel coordinates distinct through packing and resize", () => {
    expect(packNativePosition("top right")).toEqual([1, 0, 0, 0]);
    expect(packNativePosition("center center")).toEqual([0.5, 0.5, 0, 0]);
    expect(packNativePosition("top center")).toEqual([0.5, 0, 0, 0]);
    expect(packNativePosition("center top")).toEqual([0.5, 0, 0, 0]);
    expect(resolveNativePosition("bottom left", "viewport", geometry)).toEqual([
      0, 1,
    ]);
    const position = {
      x: { value: 120, unit: "px" as const },
      y: { value: 25, unit: "percent" as const },
    };
    expect(packNativePosition(position)).toEqual([120, 25, 1, 2]);
    expect(resolveNativePosition(position, "viewport", geometry)).toEqual([
      0.1, 0.25,
    ]);
    expect(resolveNativePosition(position, "source", geometry)).toEqual([
      0.4, 0.25,
    ]);
    expect(
      resolveNativePosition(position, "viewport", {
        ...geometry,
        viewport: { width: 4800, height: 2400 },
      }),
    ).toEqual([0.05, 0.25]);
    expect(
      resolveNativePosition(
        { x: { value: 0.25, unit: "uv" }, y: "bottom" },
        "source",
        geometry,
      ),
    ).toEqual([0.25, 1]);
    expect(
      Array.from(packNativeProperties(positionEffect).slice(4, 8)),
    ).toEqual([0.5, 0.5, 0, 0]);
    expect(
      Array.from(
        packNativeProperties(positionEffect, { center: position }).slice(4, 8),
      ),
    ).toEqual([120, 25, 1, 2]);
  });

  it("rejects malformed or ambiguous coordinates and invalid geometry", () => {
    for (const value of [
      "left right",
      "top bottom",
      "left left",
      "twenty percent",
      { x: "top", y: "left" },
      { x: { unit: "px", value: Infinity }, y: 0 },
      { x: { unit: "percent", value: 1_000_001 }, y: 0 },
      { x: { unit: "px", value: 20, extra: 1 }, y: 0 },
    ])
      expect(isNativePositionValue(value)).toBe(false);
    expect(() =>
      resolveNativePosition("center", "source", {
        ...geometry,
        source: { width: 0, height: 400 },
      }),
    ).toThrow("geometry is invalid");
    const invalidBasis = {
      ...positionEffect,
      properties: {
        ...positionEffect.properties,
        center: { ...positionEffect.properties.center, basis: "screen" },
      },
    };
    expect(
      validateEffectDocument({
        schemaVersion: 2,
        definitions: [invalidBasis],
        instances: [],
      }).errors.join(" "),
    ).toContain('property "center" needs a position basis');
  });

  it("persists typed center edits through the canonical source operation and rejects invalid values", () => {
    const source =
      '<html><body><div data-agent-native-node-id="tone-node">Source</div></body></html>';
    const applied = editNativeEffectHtml(source, {
      kind: "apply",
      nodeId: "tone-node",
      placement: "layer",
      definition: positionEffect,
    });
    expect(applied.errors).toEqual([]);
    const position = {
      x: { value: 40, unit: "percent" as const },
      y: { value: 72, unit: "px" as const },
    };
    const edited = editNativeEffectHtml(applied.html, {
      kind: "set-params",
      instanceId: applied.instanceIds[0]!,
      params: { center: position },
    });
    expect(edited.errors).toEqual([]);
    expect(
      parseEffectsFromHtml(edited.html).document?.instances[0]?.params.center,
    ).toEqual(position);
    const rejected = editNativeEffectHtml(edited.html, {
      kind: "set-params",
      instanceId: applied.instanceIds[0]!,
      params: {
        center: { x: "left", y: "left" } as unknown as typeof position,
      },
    });
    expect(rejected.errors.join(" ")).toContain(
      'property "center" needs a bounded 2D position',
    );
    expect(rejected.html).toBe(edited.html);
  });

  it("binds the position basis into the approved executable definition hash", async () => {
    const sourceBasis = {
      ...positionEffect,
      properties: {
        ...positionEffect.properties,
        center: {
          ...positionEffect.properties.center,
          basis: "source" as const,
        },
      },
    };
    expect(await hashEffectDefinition(sourceBasis)).not.toBe(
      await hashEffectDefinition(positionEffect),
    );
  });
});
