import { describe, expect, it } from "vitest";

import { editNativeEffectHtml } from "./native-effect-edits";
import { LIQUID_GLASS_EFFECT as LIQUID_GLASS_V1_EFFECT } from "./native-effect-liquid-glass-v1";
import { LIQUID_GLASS_EFFECT } from "./native-effect-liquid-glass-v2";
import { LIQUID_GLASS_EFFECT as LIQUID_GLASS_V3_EFFECT } from "./native-effect-liquid-glass-v3";
import {
  NATIVE_EFFECT_BUILTIN_VERSIONS,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import { nativeSceneExecutableHashes } from "./native-effect-trust";
import {
  applyNativeEffectToHtml,
  parseEffectsFromHtml,
} from "./native-effects";

describe("Liquid Glass v2", () => {
  it("preserves saved v1 and v2 executables while the picker uses v3", () => {
    expect(
      NATIVE_EFFECT_LATEST_DEFINITIONS.filter(
        ({ id }) => id === LIQUID_GLASS_EFFECT.id,
      ),
    ).toEqual([LIQUID_GLASS_V3_EFFECT]);
    expect(
      NATIVE_EFFECT_BUILTIN_VERSIONS.filter(
        ({ id }) => id === LIQUID_GLASS_EFFECT.id,
      ),
    ).toEqual([
      LIQUID_GLASS_V1_EFFECT,
      LIQUID_GLASS_EFFECT,
      LIQUID_GLASS_V3_EFFECT,
    ]);
    expect(
      NATIVE_EFFECT_PRESETS.filter(
        ({ definitionId }) => definitionId === LIQUID_GLASS_EFFECT.id,
      ),
    ).toEqual([]);
    expect(LIQUID_GLASS_EFFECT.version).toBe(2);
    expect(LIQUID_GLASS_V3_EFFECT.version).toBe(3);
  });

  it("bends the full receiver and retains a visible material over transparent source pixels", () => {
    const wgsl = LIQUID_GLASS_EFFECT.passes[0]!.wgsl;
    expect(wgsl).toContain(
      "thickness * 3.0 / max(edgeWidth + distance * 0.7, 1.0)",
    );
    expect(wgsl).not.toContain("clamp(distance / edgeWidth, 0.0, 1.0)");
    expect(wgsl).toContain(
      "color.rgb * (1.0 - tintOpacity) + tint.rgb * tintOpacity",
    );
    expect(wgsl).toContain("baseAlpha + shine * 0.55");
  });

  it("fades refraction into the receiver instead of carrying a hard slope through its center", () => {
    const wgsl = LIQUID_GLASS_V3_EFFECT.passes[0]!.wgsl;
    expect(wgsl).toContain("let edgeProfile = exp(-distance / edgeWidth)");
    expect(wgsl).toContain("thickness * 2.0 / edgeWidth * edgeProfile");
    expect(wgsl).toContain("let depth = thickness * edgeProfile");
  });

  it("applies to an empty rounded HTML frame and keeps property edits within the builtin", async () => {
    const blankFrame =
      '<html><body><div data-agent-native-node-id="frame" style="width:320px;height:200px;border-radius:32px"></div></body></html>';
    const applied = applyNativeEffectToHtml(blankFrame, {
      nodeId: "frame",
      definition: LIQUID_GLASS_EFFECT,
      placement: "backdrop",
    });
    expect(applied.errors).toEqual([]);
    const document = parseEffectsFromHtml(applied.html).document!;
    const instance = document.instances[0]!;
    expect(instance.definitionVersion).toBe(2);
    expect(instance.placement).toBe("backdrop");
    expect(
      await nativeSceneExecutableHashes(
        document,
        [],
        NATIVE_EFFECT_BUILTIN_VERSIONS,
      ),
    ).toHaveLength(1);

    const edited = editNativeEffectHtml(applied.html, {
      kind: "set-params",
      instanceId: instance.id,
      params: { thickness: 18, edgeWidth: 48 },
    });
    expect(edited.errors).toEqual([]);
    expect(
      parseEffectsFromHtml(edited.html).document?.instances[0]?.params,
    ).toMatchObject({ thickness: 18, edgeWidth: 48 });
  });

  it.each([
    '<html><body><div data-agent-native-node-id="frame" style="width:320px;height:200px;border-radius:32px"></div></body></html>',
    '<html><body><svg data-agent-native-node-id="logo" viewBox="0 0 100 100"><path d="M10 10H90V90H10Z M30 30V70H70V30Z" fill-rule="evenodd" /></svg></body></html>',
  ])(
    "applies v3 backdrop refraction to blank HTML and SVG receivers",
    async (source) => {
      const nodeId = source.includes('data-agent-native-node-id="logo"')
        ? "logo"
        : "frame";
      const applied = applyNativeEffectToHtml(source, {
        nodeId,
        definition: LIQUID_GLASS_V3_EFFECT,
        placement: "backdrop",
      });
      expect(applied.errors).toEqual([]);
      const document = parseEffectsFromHtml(applied.html).document!;
      expect(document.instances[0]).toMatchObject({
        definitionId: LIQUID_GLASS_V3_EFFECT.id,
        definitionVersion: 3,
        placement: "backdrop",
        nodeId,
      });
      expect(
        await nativeSceneExecutableHashes(
          document,
          [],
          NATIVE_EFFECT_BUILTIN_VERSIONS,
        ),
      ).toHaveLength(1);
      const edited = editNativeEffectHtml(applied.html, {
        kind: "set-params",
        instanceId: document.instances[0]!.id,
        params: { thickness: 32 },
      });
      expect(edited.errors).toEqual([]);
      expect(
        parseEffectsFromHtml(edited.html).document?.instances[0]?.params,
      ).toMatchObject({ thickness: 32 });
    },
  );
});
