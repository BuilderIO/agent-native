import { describe, expect, it } from "vitest";

import { planEffectPasses } from "./effect-graph";
import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import { catalogColor, catalogDefaults } from "./native-effect-catalog-kit";
import { FOLDED_MESH_EFFECT } from "./native-effect-folded-mesh";
import { FOLDED_MESH_V1_EFFECT } from "./native-effect-folded-mesh-v1";
import { FOLDED_MESH_V2_EFFECT } from "./native-effect-folded-mesh-v2";
import {
  NATIVE_EFFECT_BUILTIN_VERSIONS,
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import {
  hashEffectDefinition,
  nativeSceneExecutableHashes,
} from "./native-effect-trust";
import {
  applyNativeEffectToHtml,
  packNativeProperties,
  planNativePropertyLayout,
  planNativeRecordLayout,
  parseEffectsFromHtml,
  validateEffectDocument,
} from "./native-effects";

const html =
  '<html><body><svg data-agent-native-node-id="shape" viewBox="0 0 80 40"><path fill-rule="evenodd" d="M0 0h80v40H0z M20 10v20h40V10z"/></svg></body></html>';

describe("Folded Mesh", () => {
  it("uses one bounded, animated depth-tested mesh pass and a shared paint", () => {
    expect(FOLDED_MESH_EFFECT.placements).toEqual(["fill"]);
    expect(FOLDED_MESH_EFFECT.kind).toBe("generator");
    expect(FOLDED_MESH_EFFECT.passes).toHaveLength(1);
    expect(FOLDED_MESH_EFFECT.passes[0]).toMatchObject({
      kind: "render",
      reads: [],
      mesh: { columns: 128, rows: 96 },
    });
    expect(FOLDED_MESH_EFFECT.properties.fill).toMatchObject({
      type: "paint",
      maxCount: 8,
      default: { kind: "linear" },
    });
    expect(FOLDED_MESH_EFFECT.properties).not.toHaveProperty("speed");
    const lightProperty = FOLDED_MESH_EFFECT.properties.lights;
    const bandProperty = FOLDED_MESH_EFFECT.properties.noiseBands;
    if (
      lightProperty?.type !== "record-array" ||
      bandProperty?.type !== "record-array"
    )
      throw new Error("Folded Mesh record controls are missing");
    expect(lightProperty).toMatchObject({ maxCount: 4, default: [] });
    expect(bandProperty).toMatchObject({ maxCount: 4, default: [] });
    expect(lightProperty.fields.exponent).toMatchObject({
      default: 8,
      unit: "%",
      displayScale: 100 / 32,
      step: 0.32,
    });
    expect(bandProperty.fields.feather).toMatchObject({
      default: 0.1,
      unit: "%",
      displayScale: 100,
    });
    expect(bandProperty.fields.parabolaPower).toMatchObject({
      default: 3,
      unit: "%",
      displayScale: 100 / 8,
      step: 0.04,
    });
    expect(bandProperty.fields.frequency).toMatchObject({
      default: 600,
      unit: "×",
      displayScale: 1,
    });
    expect(nativeEffectAnimationCapability(FOLDED_MESH_EFFECT)).toBe(
      "animated",
    );
    expect(
      NATIVE_EFFECT_DEFINITION_CATALOG.filter(
        ({ id }) => id === FOLDED_MESH_EFFECT.id,
      ),
    ).toHaveLength(1);
    expect(
      NATIVE_EFFECT_PRESETS.filter(
        ({ definitionId }) => definitionId === FOLDED_MESH_EFFECT.id,
      ),
    ).toHaveLength(0);

    const document = {
      schemaVersion: 2 as const,
      definitions: [FOLDED_MESH_EFFECT],
      instances: [],
    };
    expect(validateEffectDocument(document).errors).toEqual([]);
    expect(
      planEffectPasses(
        FOLDED_MESH_EFFECT.passes,
        FOLDED_MESH_EFFECT.resources,
        FOLDED_MESH_EFFECT.output,
      ).errors,
    ).toEqual([]);
  });

  it("keeps exact saved v1 and v2 executables while offering only v3 in the catalog", async () => {
    const v1Hash =
      "cfca212eab746f90b3d4aa9308bf27c9949ad254b21971d1c7584d17af3598c6";
    const v2Hash =
      "d6704273af8a2f3193592c578190b8d8779ec650cbd71885037aa1edf72c5e94";
    expect(await hashEffectDefinition(FOLDED_MESH_V1_EFFECT)).toBe(v1Hash);
    expect(await hashEffectDefinition(FOLDED_MESH_V2_EFFECT)).toBe(v2Hash);
    expect(FOLDED_MESH_EFFECT.version).toBe(3);
    expect(
      NATIVE_EFFECT_BUILTIN_VERSIONS.filter(
        ({ id }) => id === FOLDED_MESH_EFFECT.id,
      ).map(({ version }) => version),
    ).toEqual([1, 2, 3]);
    const applied = applyNativeEffectToHtml(html, {
      nodeId: "shape",
      placement: "fill",
      definition: FOLDED_MESH_V1_EFFECT,
      params: {
        fill: { kind: "solid", color: catalogColor(1, 0.5, 0.4) },
        scale: 1,
        twist: 0.65,
        depth: 0.62,
        softness: 0.3,
      },
    });
    expect(applied.errors).toEqual([]);
    const document = parseEffectsFromHtml(applied.html).document;
    expect(document).toBeDefined();
    expect(
      await nativeSceneExecutableHashes(
        document!,
        [],
        NATIVE_EFFECT_BUILTIN_VERSIONS,
      ),
    ).toEqual([v1Hash]);
  });

  it("persists exact SVG Fill parameters and instance timing through the native action document", async () => {
    const fill = {
      kind: "linear" as const,
      angle: 75,
      interpolation: "in oklab" as const,
      stops: [
        { position: 0, color: catalogColor(0.18, 0.12, 0.72, 0.8) },
        { position: 1, color: catalogColor(1, 0.55, 0.25) },
      ],
    };
    const params = {
      ...catalogDefaults(FOLDED_MESH_EFFECT),
      fill,
      scaleX: 1.2,
      twistY: -Math.PI / 3,
      displacementAmount: 0.75,
      lineThickness: 0.5,
      lights: [
        {
          positionX: 0.2,
          positionY: -0.3,
          positionZ: 1.2,
          directionX: 0,
          directionY: 0,
          directionZ: -1,
          color: catalogColor(0.9, 0.4, 0.7),
          intensity: 1.4,
          amount: 0.65,
          exponent: 12,
        },
      ],
      noiseBands: [
        {
          startX: 0.2,
          endX: 0.8,
          startY: 0.1,
          endY: 0.9,
          feather: 0.08,
          strength: 0.4,
          frequency: 480,
          colorAttenuation: 0.7,
          parabolaPower: 2.5,
        },
      ],
    };
    const result = applyNativeEffectToHtml(html, {
      nodeId: "shape",
      placement: "fill",
      definition: FOLDED_MESH_EFFECT,
      params,
      timing: { speed: 0.7, paused: false, time: 1.25 },
    });
    expect(result.errors).toEqual([]);
    const document = parseEffectsFromHtml(result.html).document;
    expect(document).toBeDefined();
    expect(document?.instances[0]).toMatchObject({
      definitionId: FOLDED_MESH_EFFECT.id,
      definitionVersion: 3,
      placement: "fill",
      nodeId: "shape",
      params,
      timing: { speed: 0.7, paused: false, time: 1.25 },
    });
    expect(validateEffectDocument(document!).errors).toEqual([]);
    const packed = packNativeProperties(FOLDED_MESH_EFFECT, params);
    expect(packed).toHaveLength(256);
    const layout = planNativePropertyLayout(FOLDED_MESH_EFFECT);
    expect(layout.floatCount).toBeLessThanOrEqual(256);
    expect(packed[layout.offsets.scaleX!]).toBeCloseTo(1.2);
    expect(packed[layout.offsets.twistY!]).toBeCloseTo(-Math.PI / 3);
    expect(packed[layout.offsets.displacementAmount!]).toBeCloseTo(0.75);
    expect(packed[layout.offsets.lineThickness!]).toBeCloseTo(0.5);
    const lightProperty = FOLDED_MESH_EFFECT.properties.lights;
    const bandProperty = FOLDED_MESH_EFFECT.properties.noiseBands;
    if (
      lightProperty?.type !== "record-array" ||
      bandProperty?.type !== "record-array"
    )
      throw new Error("Folded Mesh record controls are missing");
    const light = planNativeRecordLayout(lightProperty.fields);
    const band = planNativeRecordLayout(bandProperty.fields);
    expect(packed[layout.offsets.lights!]).toBe(1);
    expect(packed[layout.offsets.noiseBands!]).toBe(1);
    expect(
      packed[layout.offsets.lights! + 4 + light.offsets.intensity!],
    ).toBeCloseTo(1.4);
    expect(
      packed[layout.offsets.noiseBands! + 4 + band.offsets.frequency!],
    ).toBe(480);
    const full = packNativeProperties(FOLDED_MESH_EFFECT, {
      ...params,
      lights: Array(4).fill(params.lights[0]),
      noiseBands: Array(4).fill(params.noiseBands[0]),
    });
    expect(full[layout.offsets.lights!]).toBe(4);
    expect(full[layout.offsets.noiseBands!]).toBe(4);
    expect(
      full[
        layout.offsets.lights! + 4 + 3 * light.stride + light.offsets.intensity!
      ],
    ).toBeCloseTo(1.4);
    expect(
      full[
        layout.offsets.noiseBands! +
          4 +
          3 * band.stride +
          band.offsets.frequency!
      ],
    ).toBe(480);
    expect(() =>
      packNativeProperties(FOLDED_MESH_EFFECT, {
        ...params,
        noiseBands: [{ ...params.noiseBands[0]!, startX: 0.8, endX: 0.2 }],
      }),
    ).toThrow(/noiseBands.*ordered-gap/);
    expect(await hashEffectDefinition(document!.definitions[0]!)).toBe(
      await hashEffectDefinition(FOLDED_MESH_EFFECT),
    );
  });
});
