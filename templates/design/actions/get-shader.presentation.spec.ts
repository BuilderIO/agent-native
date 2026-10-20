import { beforeEach, describe, expect, it, vi } from "vitest";

const source = vi.hoisted(() => ({ html: "" }));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: vi.fn().mockResolvedValue(null),
}));
vi.mock("../server/source-workspace.js", () => ({
  resolveSourceWorkspace: vi.fn().mockResolvedValue({
    sourceType: "inline",
    files: [{ id: "scene", filename: "scene.html", fileType: "html" }],
  }),
  loadSelectedSourceWorkspaceFile: vi.fn().mockResolvedValue({ id: "scene" }),
  readLiveSourceFile: vi.fn(async () => ({
    content: source.html,
    versionHash: "revision",
  })),
}));

import { editNativeEffectHtml } from "../shared/native-effect-edits";
import { LIQUID_METAL_V1_EFFECT } from "../shared/native-effect-liquid-metal-v1";
import { LIQUID_METAL_V2_EFFECT } from "../shared/native-effect-liquid-metal-v2";
import { LIQUID_METAL_V3_EFFECT } from "../shared/native-effect-liquid-metal-v3";
import { LIQUID_METAL_V4_EFFECT } from "../shared/native-effect-liquid-metal-v4";
import { LIQUID_METAL_V5_EFFECT } from "../shared/native-effect-liquid-metal-v5";
import { LIQUID_METAL_V6_EFFECT } from "../shared/native-effect-liquid-metal-v6";
import { LIQUID_METAL_V7_EFFECT } from "../shared/native-effect-liquid-metal-v7";
import { NATIVE_EFFECT_DEFINITION_CATALOG } from "../shared/native-effect-presets";
import getShader from "./get-shader";
import prepareExport from "./prepare-native-scene-export";

beforeEach(() => {
  const applied = editNativeEffectHtml(
    '<html><body><div data-agent-native-node-id="metal"></div></body></html>',
    {
      kind: "apply",
      nodeId: "metal",
      placement: "fill",
      definition: LIQUID_METAL_V1_EFFECT,
    },
  );
  expect(applied.errors).toEqual([]);
  source.html = applied.html;
});

describe("native shader inspection display metadata and compatible versions", () => {
  it("exposes exact hashes for file-owned custom definition approval", async () => {
    const custom = { ...LIQUID_METAL_V1_EFFECT, id: "user-defined-metal" };
    const draft = editNativeEffectHtml(source.html, {
      kind: "define-definition",
      definition: custom,
    });
    expect(draft.errors).toEqual([]);
    source.html = draft.html;
    const result = await getShader.run(
      { format: "native-v2", source: { designId: "design", fileId: "scene" } },
      {} as never,
    );
    if (!("definitions" in result)) throw new Error("Expected native catalog");
    const { hashEffectDefinition } =
      await import("../shared/native-effect-trust");
    expect(
      result.document?.definitions.find((item) => item.id === custom.id),
    ).toMatchObject({ executionHash: await hashEffectDefinition(custom) });
    expect(result.approvedDefinitionHashes).toEqual([]);
  });

  it("lists current shaders with canonical properties and converted display metadata", async () => {
    const result = await getShader.run({ format: "native-v2" }, {} as never);
    if (!("definitions" in result)) throw new Error("Expected native catalog");
    expect(
      result.definitions.map(({ id, version }) => `${id}@${version}`),
    ).toEqual(
      NATIVE_EFFECT_DEFINITION_CATALOG.map(
        ({ id, version }) => `${id}@${version}`,
      ),
    );
    const metal = result.definitions.find(
      ({ id }) => id === "an-native-liquid-metal",
    )!;
    expect(metal.version).toBe(12);
    expect(metal.properties.tint).toMatchObject({
      type: "color",
      default: { space: "srgb", components: [1, 1, 1], alpha: 1 },
    });
    expect(metal.properties.fill).toMatchObject({
      type: "paint",
      maxCount: 8,
      default: {
        kind: "solid",
        color: {
          space: "srgb",
          components: [170 / 255, 170 / 255, 172 / 255],
          alpha: 1,
        },
      },
    });
    expect(metal.properties).not.toHaveProperty("palette");
    expect(metal.properties.softness!.default).toBe(0.05);
    expect(metal.propertyPresentation.softness).toEqual({
      displayScale: 100,
      unit: "%",
      step: 1,
      default: 5,
      min: 0,
      max: 100,
    });
    expect(metal.propertyPresentation.angle!.default).toBe(90);
    expect(metal.propertyPresentation.repetition!.default).toBe(150);
    expect(metal.propertyPresentation.shiftRed!.default).toBe(30);
    expect(metal.propertyPresentation.shiftBlue!.default).toBe(30);
    expect(metal.properties).not.toHaveProperty("movement");
    expect(result.parameterValueSpace).toBe("canonical");
    expect(result.instancePresentation.opacity).toEqual({
      displayScale: 100,
      unit: "%",
      step: 1,
      default: 100,
      min: 0,
      max: 100,
    });
    expect(result.instancePresentation.timing.speed.default).toBe(100);
  });

  it.each([
    [LIQUID_METAL_V1_EFFECT, 200],
    [LIQUID_METAL_V2_EFFECT, 100],
    [LIQUID_METAL_V3_EFFECT, 100],
    [LIQUID_METAL_V4_EFFECT, 100],
    [LIQUID_METAL_V5_EFFECT, 100],
    [LIQUID_METAL_V6_EFFECT, 100],
    [LIQUID_METAL_V7_EFFECT, 100],
  ] as const)(
    "resolves saved v$0.version when explicitly requested",
    async (definition, displayScale) => {
      const result = await getShader.run(
        {
          format: "native-v2",
          definitionId: "an-native-liquid-metal",
          definitionVersion: definition.version,
          includeSource: true,
        },
        {} as never,
      );
      if (!("definitions" in result))
        throw new Error("Expected native catalog");
      expect(result.definitions).toHaveLength(1);
      expect(result.definitions[0]!.version).toBe(definition.version);
      expect(result.definitions[0]!.propertyPresentation.scale!.default).toBe(
        displayScale,
      );
      expect(result.selectedDefinition).toEqual(definition);
    },
  );

  it.each([
    [
      LIQUID_METAL_V1_EFFECT,
      "c56508fdaa383465ed5bb834f885a8aee267ce2ef1222d341dd04f3e8b0a5015",
    ],
    [
      LIQUID_METAL_V2_EFFECT,
      "0e1bc812620453c5ab9ba4aad8094d2153b4a4ce3a543e289b23799f916a13cf",
    ],
    [
      LIQUID_METAL_V3_EFFECT,
      "6f1be5bf6b7e48f7416ea575db4545f344ccb103c29a4a4bca41e1201141124e",
    ],
    [
      LIQUID_METAL_V4_EFFECT,
      "53e5642f1559b0c706c47bb4ba1d66761fc1a7903298708902fd3f74efb3c4a0",
    ],
    [
      LIQUID_METAL_V5_EFFECT,
      "9747af5995ad9455bf71c9078429ffe49a85eb26ee77de45648d39b1ea3ada6f",
    ],
    [
      LIQUID_METAL_V6_EFFECT,
      "b5cfb49773e11d583d8d0539de51e4a59678ee5c7cf29b5c34ad8134f060b1cc",
    ],
    [
      LIQUID_METAL_V7_EFFECT,
      "d559bfb07add56e3f526ed4469428f6b43b94c2906416d542d04b4846d87b9c0",
    ],
  ] as const)(
    "prepares saved v$0.version PNG export without extra approval",
    async (definition, executionHash) => {
      const applied = editNativeEffectHtml(
        '<html><body><div data-agent-native-node-id="metal"></div></body></html>',
        {
          kind: "apply",
          nodeId: "metal",
          placement: "fill",
          definition,
        },
      );
      expect(applied.errors).toEqual([]);
      source.html = applied.html;
      const result = await prepareExport.run(
        {
          designId: "design",
          fileId: "scene",
          viewportWidth: 320,
          viewportHeight: 200,
          pixelRatio: 1,
        },
        {} as never,
      );
      expect(result.versionHash).toBe("revision");
      expect(result.html).toBe(source.html);
      expect(result.approvedDefinitionHashes).toEqual([executionHash]);
      expect(result.instanceTargets).toHaveLength(1);
    },
  );
});
