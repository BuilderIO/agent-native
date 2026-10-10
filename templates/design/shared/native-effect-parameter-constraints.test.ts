import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { editNativeEffectHtml } from "./native-effect-edits";
import { selectHistorical105Definitions } from "./native-effect-historical-105.test-fixture";
import { OWNED_PROCESSOR_DEFINITIONS } from "./native-effect-owned-processors";
import { NativeEffectParameterConstraintError } from "./native-effect-parameter-constraints";
import { NATIVE_EFFECT_DEFINITION_CATALOG } from "./native-effect-presets";
import { hashEffectDefinition } from "./native-effect-trust";
import {
  packNativeProperties,
  parseEffectsFromHtml,
  NATIVE_EFFECT_SCRIPT_TYPE,
  validateEffectDocument,
  type EffectDefinition,
  type EffectInstance,
} from "./native-effects";

const html =
  '<html><body><div data-agent-native-node-id="hero">Image</div></body></html>';
const numberProperty = (label: string, value: number) => ({
  type: "float" as const,
  label,
  default: value,
  min: 0,
  max: 10,
});
const pointProperty = (label: string, value: [number, number]) => ({
  type: "vec2" as const,
  label,
  default: value,
  min: 0,
  max: 1,
});
const supportedProcessor = OWNED_PROCESSOR_DEFINITIONS.find(
  (definition) => definition.id === "an-native-owned-shadow-lift",
);
if (!supportedProcessor)
  throw new Error("Supported processor fixture is missing");
const dog: EffectDefinition = {
  ...supportedProcessor,
  id: "owned-constraint-dog-test",
  properties: {
    ...supportedProcessor.properties,
    fine: numberProperty("Fine", 1),
    broad: numberProperty("Broad", 4),
  },
  parameterConstraints: [
    { kind: "ordered-floats", lesser: "fine", greater: "broad", minGap: 0.05 },
  ],
};
const quad: EffectDefinition = {
  ...dog,
  id: "owned-constraint-quad-test",
  properties: {
    topLeft: pointProperty("Top left", [0.1, 0.1]),
    topRight: pointProperty("Top right", [0.9, 0.1]),
    bottomRight: pointProperty("Bottom right", [0.9, 0.9]),
    bottomLeft: pointProperty("Bottom left", [0.1, 0.9]),
  },
  parameterConstraints: [
    {
      kind: "convex-quad",
      corners: ["topLeft", "topRight", "bottomRight", "bottomLeft"],
      minArea: 0.001,
      minCross: 0.00001,
    },
  ],
};
function document(
  definition: EffectDefinition,
  params: Record<string, unknown> = {},
) {
  const instance: EffectInstance = {
    id: "owned-instance",
    nodeId: "hero",
    definitionId: definition.id,
    definitionVersion: definition.version,
    placement: "layer",
    params: params as EffectInstance["params"],
    enabled: true,
    opacity: 1,
    seed: 0,
    clip: "bounds",
    blend: "normal",
    timing: { speed: 1, paused: false, time: 0 },
  };
  return { schemaVersion: 2, definitions: [definition], instances: [instance] };
}
function rejects(
  definition: EffectDefinition,
  params: Record<string, unknown>,
  code: string,
) {
  const result = validateEffectDocument(document(definition, params));
  expect(result.valid).toBe(false);
  expect(result.errors.some((error) => error.includes(code))).toBe(true);
}

describe("native parameter constraints", () => {
  it("preserves the exact 105 published execution hashes when metadata is absent", async () => {
    const pins = await Promise.all(
      selectHistorical105Definitions(NATIVE_EFFECT_DEFINITION_CATALOG).map(
        async (definition) =>
          `${definition.id}@${definition.version}:${await hashEffectDefinition(definition)}`,
      ),
    );
    expect(pins).toHaveLength(105);
    expect(
      createHash("sha256").update(pins.sort().join("\n")).digest("hex"),
    ).toBe("ec8f53ab0a9bf64b6f7c976a3530af2573ab0695f70a99e7ba5ac7327638256a");
    const changed = {
      ...dog,
      parameterConstraints: [{ ...dog.parameterConstraints![0], minGap: 0.1 }],
    } as EffectDefinition;
    expect(await hashEffectDefinition(changed)).not.toBe(
      await hashEffectDefinition(dog),
    );
  });

  it("rejects invalid reference metadata and invalid defaults", () => {
    expect(validateEffectDocument(document(dog)).valid).toBe(true);
    expect(validateEffectDocument(document(quad)).valid).toBe(true);
    const missing = {
      ...dog,
      parameterConstraints: [
        {
          kind: "ordered-floats",
          lesser: "missing",
          greater: "broad",
          minGap: 0.05,
        },
      ],
    };
    expect(
      validateEffectDocument(document(missing as EffectDefinition)).errors,
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("parameterConstraints[0] needs"),
      ]),
    );
    const unbounded = {
      ...dog,
      parameterConstraints: [
        {
          kind: "ordered-floats",
          lesser: "fine",
          greater: "broad",
          minGap: Number.NaN,
        },
      ],
    };
    expect(
      validateEffectDocument(document(unbounded as EffectDefinition)).valid,
    ).toBe(false);
    const unknownField = {
      ...dog,
      parameterConstraints: [{ ...dog.parameterConstraints![0], extra: true }],
    };
    expect(
      validateEffectDocument(document(unknownField as EffectDefinition)).valid,
    ).toBe(false);
    const hugeProperty = {
      ...dog,
      properties: {
        ...dog.properties,
        broad: { ...numberProperty("Broad", 4), max: 1e100 },
      },
    };
    expect(validateEffectDocument(document(hugeProperty)).valid).toBe(false);
    const duplicate = {
      ...dog,
      parameterConstraints: [
        dog.parameterConstraints![0],
        dog.parameterConstraints![0],
      ],
    };
    expect(
      validateEffectDocument(document(duplicate)).errors.join(" "),
    ).toContain("duplicates another constraint");
    const defaults = {
      ...dog,
      properties: { ...dog.properties, broad: numberProperty("Broad", 1) },
    };
    expect(validateEffectDocument(document(defaults)).errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("defaults violate ordered-gap"),
      ]),
    );
  });

  it("checks resolved overrides for gaps, crossing, winding, and area", () => {
    rejects(dog, { fine: 4, broad: 4 }, "ordered-gap");
    rejects(dog, { fine: 4, broad: 4.01 }, "ordered-gap");
    rejects(dog, { fine: Number.NaN }, "ordered-gap");
    rejects(
      quad,
      { topRight: [0.9, 0.9], bottomRight: [0.9, 0.1] },
      "quad-nonconvex",
    );
    rejects(quad, { topRight: [0.1, 0.1] }, "quad-degenerate");
    rejects(
      quad,
      {
        topLeft: [0.1, 0.1],
        topRight: [0.2, 0.1],
        bottomRight: [0.2, 0.101],
        bottomLeft: [0.1, 0.101],
      },
      "quad-degenerate",
    );
    expect(
      validateEffectDocument(
        document(quad, {
          topLeft: [0.1, 0.1],
          topRight: [0.1, 0.9],
          bottomRight: [0.9, 0.9],
          bottomLeft: [0.9, 0.1],
        }),
      ).valid,
    ).toBe(true);
  });

  it("rejects resolved constraints before uniform packing for every existing geometry kind", () => {
    expect(() => packNativeProperties(dog, { fine: 4, broad: 4 })).toThrow(
      NativeEffectParameterConstraintError,
    );
    expect(() =>
      packNativeProperties(quad, {
        topRight: [0.9, 0.9],
        bottomRight: [0.9, 0.1],
      }),
    ).toThrow(NativeEffectParameterConstraintError);
    expect(() =>
      packNativeProperties(dog, { fine: 1, broad: 4 }),
    ).not.toThrow();
    expect(() => packNativeProperties(quad)).not.toThrow();
  });

  it("uses the same boundary for canonical apply, set-params, and saved presets", () => {
    const badApply = editNativeEffectHtml(html, {
      kind: "apply",
      nodeId: "hero",
      placement: "layer",
      definition: dog,
      params: { fine: 4, broad: 4 },
    });
    expect(badApply.html).toBe(html);
    expect(badApply.errors.join(" ")).toContain("ordered-gap");
    const applied = editNativeEffectHtml(html, {
      kind: "apply",
      nodeId: "hero",
      placement: "layer",
      definition: dog,
    });
    expect(applied.errors).toEqual([]);
    const instanceId = parseEffectsFromHtml(applied.html).document!.instances[0]
      .id;
    const badEdit = editNativeEffectHtml(applied.html, {
      kind: "set-params",
      instanceId,
      params: { broad: 1 },
    });
    expect(badEdit.html).toBe(applied.html);
    expect(badEdit.errors.join(" ")).toContain("ordered-gap");
    const invalidPreset = {
      id: "owned-preset",
      name: "Invalid",
      definitionId: dog.id,
      definitionVersion: dog.version,
      placement: "layer",
      params: { broad: 1 },
      clip: "bounds",
      provenance: { origin: "user-authored" },
    };
    expect(
      validateEffectDocument({
        ...document(dog),
        presets: [invalidPreset],
      }).errors.join(" "),
    ).toContain("ordered-gap");
    const saved = editNativeEffectHtml(applied.html, {
      kind: "save-preset",
      preset: invalidPreset as never,
    });
    expect(saved.html).toBe(applied.html);
    expect(saved.errors.join(" ")).toContain("ordered-gap");
    const authored = `<html><body><script type="${NATIVE_EFFECT_SCRIPT_TYPE}">${JSON.stringify(document(dog, { fine: 4, broad: 4 }))}</script></body></html>`;
    expect(parseEffectsFromHtml(authored).errors.join(" ")).toContain(
      "ordered-gap",
    );
  });
});
