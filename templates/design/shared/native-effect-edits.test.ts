import { describe, expect, it } from "vitest";

import { NATIVE_EFFECT_DEFINITIONS_V1 } from "./native-effect-definitions-v1";
import {
  clearNativeFillFromHtml,
  editNativeEffectHtml,
} from "./native-effect-edits";
import {
  OWNED_INTRINSIC_IMAGE_TEST_EFFECT,
  OWNED_RENDERED_SURFACE_TEST_EFFECT,
} from "./native-effect-owned-source-test-fixtures";
import {
  FROSTED_REFRACTION_EFFECT,
  GRAIN_GRADIENT_EFFECT,
  HALFTONE_EFFECT,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import {
  parseEffectsFromHtml,
  writeEffectsToHtml,
  type NativeSourceSizing,
} from "./native-effects";
import { defaultNativeIntrinsicSourceSizing } from "./native-source-sizing";

const source =
  '<html><body><div data-agent-native-node-id="hero">Editable</div></body></html>';
const twoTargets =
  '<html><body><div data-agent-native-node-id="hero">Editable</div><div data-agent-native-node-id="second">Second</div></body></html>';

function applied() {
  const result = editNativeEffectHtml(source, {
    kind: "apply",
    nodeId: "hero",
    placement: "fill",
    definitionId: GRAIN_GRADIENT_EFFECT.id,
    definitionVersion: GRAIN_GRADIENT_EFFECT.version,
  });
  expect(result.errors).toEqual([]);
  return result;
}

describe("native effect source edits", () => {
  it("refuses new instances of saved retired image ABIs while retaining their bytes", () => {
    const first = defaultNativeIntrinsicSourceSizing(600, 200);
    const second = defaultNativeIntrinsicSourceSizing(200, 500);
    if (!first.ok || !second.ok) throw new Error("fixture sizing failed");
    const rejected = editNativeEffectHtml(twoTargets, {
      kind: "apply-many",
      nodeIds: ["hero", "second"],
      placement: "layer",
      definition: OWNED_INTRINSIC_IMAGE_TEST_EFFECT,
      sourceSizingByNodeId: { hero: first.value, second: second.value },
    });
    expect(rejected.errors).toContain("legacy-image-abi-retired");
    expect(rejected.html).toBe(twoTargets);

    const saved = writeEffectsToHtml(source, {
      schemaVersion: 2,
      definitions: [OWNED_INTRINSIC_IMAGE_TEST_EFFECT],
      instances: [],
      presets: [
        {
          id: "retired-image-preset",
          name: "Saved image preset",
          definitionId: OWNED_INTRINSIC_IMAGE_TEST_EFFECT.id,
          definitionVersion: OWNED_INTRINSIC_IMAGE_TEST_EFFECT.version,
          placement: "layer",
          params: {},
          clip: "bounds",
          provenance: { origin: "user-authored" },
          sourceSizing: first.value,
        },
      ],
    });
    expect(
      parseEffectsFromHtml(saved).document?.presets?.[0].sourceSizing,
    ).toEqual(first.value);
    const presetResult = editNativeEffectHtml(saved, {
      kind: "apply-preset",
      nodeId: "hero",
      presetId: "retired-image-preset",
      sourceSizing: second.value,
    });
    expect(presetResult.errors).toContain("legacy-image-abi-retired");
    expect(presetResult.html).toBe(saved);
  });

  it("lets a saved retired instance clear its metadata without accepting a new retired setting", () => {
    const sourceSizing: NativeSourceSizing = {
      inputSpace: "rendered-surface",
      aspectRatio: 2,
      fit: "cover",
      worldSize: [0, 0],
      origin: [0.5, 0.5],
      offset: [0, 0],
      scale: 1,
      rotationDegrees: 0,
      sampling: { min: "linear", mag: "linear", mipmap: "none" },
    };
    const saved = writeEffectsToHtml(source, {
      schemaVersion: 2,
      definitions: [OWNED_RENDERED_SURFACE_TEST_EFFECT],
      instances: [
        {
          id: "saved-retired-image",
          nodeId: "hero",
          definitionId: OWNED_RENDERED_SURFACE_TEST_EFFECT.id,
          definitionVersion: OWNED_RENDERED_SURFACE_TEST_EFFECT.version,
          placement: "layer",
          params: {},
          enabled: true,
          opacity: 1,
          seed: 1,
          clip: "bounds",
          blend: "normal",
          timing: { speed: 1, paused: false, time: 0 },
          sourceSizing,
        },
      ],
    });
    expect(
      parseEffectsFromHtml(saved).document?.instances[0].sourceSizing,
    ).toEqual(sourceSizing);
    const refused = editNativeEffectHtml(saved, {
      kind: "set-instance",
      instanceId: "saved-retired-image",
      sourceSizing: { ...sourceSizing, scale: 2 },
    });
    expect(refused.errors).toContain("legacy-image-abi-retired");
    expect(refused.html).toBe(saved);
    const cleared = editNativeEffectHtml(saved, {
      kind: "set-instance",
      instanceId: "saved-retired-image",
      sourceSizing: null,
    });
    expect(cleared.errors).toEqual([]);
    expect(
      parseEffectsFromHtml(cleared.html).document?.instances[0].sourceSizing,
    ).toBeUndefined();
  });

  it("persists document preview policy in one source edit while leaving old documents at implicit Auto/60", () => {
    const initial = applied();
    expect(
      parseEffectsFromHtml(initial.html).document?.preview,
    ).toBeUndefined();
    const defaultEdit = editNativeEffectHtml(initial.html, {
      kind: "set-preview",
      preview: { quality: "auto", frameRateTarget: 60 },
    });
    expect(defaultEdit.html).toBe(initial.html);
    const changed = editNativeEffectHtml(initial.html, {
      kind: "set-preview",
      preview: { quality: "performance", frameRateTarget: 120 },
    });
    expect(changed.errors).toEqual([]);
    expect(parseEffectsFromHtml(changed.html).document?.preview).toEqual({
      quality: "performance",
      frameRateTarget: 120,
    });
    expect(parseEffectsFromHtml(changed.html).document?.instances).toEqual(
      parseEffectsFromHtml(initial.html).document?.instances,
    );
    expect(
      editNativeEffectHtml(changed.html, {
        kind: "set-preview",
        preview: { quality: "performance", frameRateTarget: 120 },
      }).html,
    ).toBe(changed.html);
    const colorChanged = editNativeEffectHtml(changed.html, {
      kind: "set-preview",
      preview: {
        quality: "performance",
        frameRateTarget: 120,
        colorMode: "display-p3",
        dynamicRange: "hdr",
      },
    });
    expect(colorChanged.errors).toEqual([]);
    expect(parseEffectsFromHtml(colorChanged.html).document?.preview).toEqual({
      quality: "performance",
      frameRateTarget: 120,
      colorMode: "display-p3",
      dynamicRange: "hdr",
    });
    expect(colorChanged.html).not.toBe(changed.html);
    expect(
      editNativeEffectHtml(colorChanged.html, {
        kind: "set-preview",
        preview: {
          quality: "performance",
          frameRateTarget: 120,
          colorMode: "display-p3",
          dynamicRange: "hdr",
        },
      }).html,
    ).toBe(colorChanged.html);
    const reset = editNativeEffectHtml(changed.html, {
      kind: "set-preview",
      preview: null,
    });
    expect(reset.errors).toEqual([]);
    expect(parseEffectsFromHtml(reset.html).document?.preview).toBeUndefined();
    expect(
      editNativeEffectHtml(initial.html, {
        kind: "set-preview",
        preview: { quality: "quality", frameRateTarget: 144 as 60 },
      }).errors,
    ).not.toEqual([]);
  });
  it("persists a bounded seed and a paused local playhead without resetting effect parameters", () => {
    const initial = applied();
    const id = initial.instanceIds[0];
    const withParam = editNativeEffectHtml(initial.html, {
      kind: "set-params",
      instanceId: id,
      params: { scale: 2.1 },
    });
    const seeded = editNativeEffectHtml(withParam.html, {
      kind: "set-instance",
      instanceId: id,
      seed: 77,
    });
    const paused = editNativeEffectHtml(seeded.html, {
      kind: "playback",
      instanceId: id,
      paused: true,
      time: 3.75,
    });
    expect(paused.errors).toEqual([]);
    const instance = parseEffectsFromHtml(paused.html).document?.instances[0];
    expect(instance).toMatchObject({
      seed: 77,
      params: { scale: 2.1 },
      timing: { paused: true, time: 3.75 },
    });
    const reset = editNativeEffectHtml(paused.html, {
      kind: "playback",
      instanceId: id,
      time: 0,
      seekRevision: 1,
    });
    expect(reset.errors).toEqual([]);
    expect(
      parseEffectsFromHtml(reset.html).document?.instances[0].timing,
    ).toMatchObject({
      paused: true,
      time: 0,
      seekRevision: 1,
    });
    const invalid = editNativeEffectHtml(paused.html, {
      kind: "set-instance",
      instanceId: id,
      seed: -1,
    });
    expect(invalid.errors).not.toEqual([]);
    expect(invalid.html).toBe(paused.html);
  });
  it("applies to multiple authored nodes atomically and updates common params together", () => {
    const applied = editNativeEffectHtml(twoTargets, {
      kind: "apply-many",
      nodeIds: ["hero", "second"],
      placement: "fill",
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: GRAIN_GRADIENT_EFFECT.version,
    });
    expect(applied.errors).toEqual([]);
    const instances =
      parseEffectsFromHtml(applied.html).document?.instances ?? [];
    expect(instances.map((instance) => instance.nodeId)).toEqual([
      "hero",
      "second",
    ]);
    const updated = editNativeEffectHtml(applied.html, {
      kind: "set-params-many",
      instanceIds: instances.map((instance) => instance.id),
      params: { scale: 2.1 },
    });
    expect(updated.errors).toEqual([]);
    expect(
      parseEffectsFromHtml(updated.html).document?.instances.map(
        (instance) => instance.params.scale,
      ),
    ).toEqual([2.1, 2.1]);
    const failed = editNativeEffectHtml(twoTargets, {
      kind: "apply-many",
      nodeIds: ["hero", "missing"],
      placement: "fill",
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: GRAIN_GRADIENT_EFFECT.version,
    });
    expect(failed.errors.length).toBeGreaterThan(0);
    expect(failed.html).toBe(twoTargets);
  });
  it("applies a built-in and preserves its authored text and pinned version", () => {
    const result = applied();
    const document = parseEffectsFromHtml(result.html).document!;
    expect(result.html).toContain("Editable");
    expect(result.html).toContain("data-agent-native-native-shader-runtime");
    expect(document.instances).toHaveLength(1);
    expect(document.instances[0].definitionVersion).toBe(
      GRAIN_GRADIENT_EFFECT.version,
    );
    expect(result.instanceIds).toEqual([document.instances[0].id]);
  });

  it("rejects malformed custom definitions without throwing or changing source", () => {
    const result = editNativeEffectHtml(source, {
      kind: "save-preset",
      preset: {} as (typeof NATIVE_EFFECT_PRESETS)[number],
    });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.html).toBe(source);
  });

  it("applies a named preset and saves a distinct custom preset without cloning an instance", () => {
    const builtin = editNativeEffectHtml(source, {
      kind: "apply-preset",
      nodeId: "hero",
      presetId: NATIVE_EFFECT_PRESETS[0].id,
    });
    expect(builtin.errors).toEqual([]);
    const saved = editNativeEffectHtml(builtin.html, {
      kind: "save-preset",
      preset: {
        id: "my-grain",
        name: "My grain",
        definitionId: GRAIN_GRADIENT_EFFECT.id,
        definitionVersion: GRAIN_GRADIENT_EFFECT.version,
        placement: "fill",
        params: { grain: 0.125 },
        clip: "bounds",
        provenance: { origin: "user-authored" },
      },
    });
    expect(saved.errors).toEqual([]);
    const document = parseEffectsFromHtml(saved.html).document!;
    expect(document.instances).toHaveLength(1);
    expect(document.presets).toHaveLength(1);
    const second = editNativeEffectHtml(saved.html, {
      kind: "apply-preset",
      nodeId: "hero",
      presetId: "my-grain",
    });
    expect(second.errors).toEqual([]);
    expect(
      parseEffectsFromHtml(second.html).document?.instances[0].params.grain,
    ).toBe(0.125);
    expect(parseEffectsFromHtml(second.html).document?.instances).toHaveLength(
      1,
    );
  });

  it("retains and applies the exact legacy v1 definition alongside v2", () => {
    const legacy = NATIVE_EFFECT_DEFINITIONS_V1[0];
    const result = editNativeEffectHtml(source, {
      kind: "apply",
      nodeId: "hero",
      placement: "fill",
      definitionId: legacy.id,
      definitionVersion: 1,
    });
    expect(result.errors).toEqual([]);
    expect(parseEffectsFromHtml(result.html).document?.definitions[0]).toEqual(
      legacy,
    );
  });

  it("clears only fill paint while retaining same-node processors", () => {
    const fill = applied();
    const layer = editNativeEffectHtml(fill.html, {
      kind: "apply",
      nodeId: "hero",
      placement: "layer",
      definitionId: HALFTONE_EFFECT.id,
      definitionVersion: HALFTONE_EFFECT.version,
    });
    expect(layer.errors).toEqual([]);
    const cleared = clearNativeFillFromHtml(layer.html, "hero");
    expect(cleared.errors).toEqual([]);
    expect(
      parseEffectsFromHtml(cleared.html).document?.instances.map(
        (instance) => instance.placement,
      ),
    ).toEqual(["layer"]);
  });

  it("removes only the native bootstrap when clearing the final native fill", () => {
    const fill = applied();
    const withCustomScript = fill.html.replace(
      "</body>",
      "<script data-custom-runtime>window.customReady = true</script></body>",
    );
    const cleared = clearNativeFillFromHtml(withCustomScript, "hero");
    expect(cleared.errors).toEqual([]);
    expect(cleared.html).not.toContain(
      "data-agent-native-native-shader-runtime",
    );
    expect(cleared.html).toContain("data-custom-runtime");
    expect(parseEffectsFromHtml(cleared.html).document?.instances).toEqual([]);
  });

  it("changes a supported instance placement and rejects unsupported placement without a write", () => {
    const applied = editNativeEffectHtml(source, {
      kind: "apply",
      nodeId: "hero",
      placement: "backdrop",
      definitionId: FROSTED_REFRACTION_EFFECT.id,
      definitionVersion: FROSTED_REFRACTION_EFFECT.version,
    });
    expect(applied.errors).toEqual([]);
    const instanceId = applied.instanceIds[0];
    const moved = editNativeEffectHtml(applied.html, {
      kind: "set-instance",
      instanceId,
      placement: "layer",
    });
    expect(moved.errors).toEqual([]);
    expect(
      parseEffectsFromHtml(moved.html).document?.instances[0].placement,
    ).toBe("layer");
    const unsupported = editNativeEffectHtml(moved.html, {
      kind: "set-instance",
      instanceId,
      placement: "fill",
    });
    expect(unsupported.errors[0]).toContain("placement is not supported");
    expect(unsupported.html).toBe(moved.html);
  });

  it("sets and clears future input bindings and transforms through the canonical edit", () => {
    const base = editNativeEffectHtml(source, {
      kind: "apply",
      nodeId: "hero",
      placement: "layer",
      definitionId: HALFTONE_EFFECT.id,
      definitionVersion: HALFTONE_EFFECT.version,
    });
    const instanceId = base.instanceIds[0];
    const updated = editNativeEffectHtml(base.html, {
      kind: "set-instance",
      instanceId,
      bindings: { source: { kind: "asset", url: "/shaders/image.svg" } },
      transform: { translate: [20, 0] },
    });
    expect(updated.errors).toEqual([]);
    expect(
      parseEffectsFromHtml(updated.html).document?.instances[0],
    ).toMatchObject({
      bindings: { source: { kind: "asset", url: "/shaders/image.svg" } },
      transform: { translate: [20, 0] },
    });
    const cleared = editNativeEffectHtml(updated.html, {
      kind: "set-instance",
      instanceId,
      bindings: null,
      transform: null,
    });
    expect(cleared.errors).toEqual([]);
    expect(
      parseEffectsFromHtml(cleared.html).document?.instances[0].bindings,
    ).toBeUndefined();
    expect(
      parseEffectsFromHtml(cleared.html).document?.instances[0].transform,
    ).toBeUndefined();
  });

  it("rejects same id/version source conflicts while retaining existing pins", () => {
    const original = applied();
    const conflict = editNativeEffectHtml(original.html, {
      kind: "apply",
      nodeId: "hero",
      placement: "fill",
      definition: { ...GRAIN_GRADIENT_EFFECT, name: "Different body" },
    });
    expect(conflict.errors[0]).toContain("already names different source");
    expect(conflict.html).toBe(original.html);
    expect(
      parseEffectsFromHtml(conflict.html).document?.instances,
    ).toHaveLength(1);
  });

  it("duplicates, reorders, edits, resets and removes a stack through one manifest", () => {
    let result = applied();
    const first = result.instanceIds[0];
    result = editNativeEffectHtml(result.html, {
      kind: "duplicate",
      instanceId: first,
    });
    expect(result.errors).toEqual([]);
    const second = result.instanceIds[1];
    expect(second).not.toBe(first);
    result = editNativeEffectHtml(result.html, {
      kind: "set-params",
      instanceId: second,
      params: { grain: 0.2 },
    });
    expect(result.errors).toEqual([]);
    result = editNativeEffectHtml(result.html, {
      kind: "playback",
      instanceId: second,
      paused: true,
      time: 4,
    });
    expect(result.errors).toEqual([]);
    result = editNativeEffectHtml(result.html, {
      kind: "reorder",
      instanceId: second,
      beforeInstanceId: first,
    });
    expect(result.instanceIds).toEqual([second, first]);
    result = editNativeEffectHtml(result.html, {
      kind: "reset-instance",
      instanceId: second,
    });
    expect(
      parseEffectsFromHtml(result.html).document?.instances[0],
    ).toMatchObject({
      params: {},
      timing: { speed: 1, paused: false, time: 0 },
    });
    result = editNativeEffectHtml(result.html, {
      kind: "remove",
      instanceId: first,
    });
    expect(result.instanceIds).toEqual([second]);
  });

  it("revises selected instance pins while retaining older definition revisions", () => {
    const first = applied();
    const copy = editNativeEffectHtml(first.html, {
      kind: "duplicate",
      instanceId: first.instanceIds[0],
    });
    const nextDefinition = {
      ...GRAIN_GRADIENT_EFFECT,
      version: GRAIN_GRADIENT_EFFECT.version + 1,
      name: "Revised grain gradient",
    };
    const revised = editNativeEffectHtml(copy.html, {
      kind: "revise-definition",
      definition: nextDefinition,
      fromVersion: GRAIN_GRADIENT_EFFECT.version,
      instanceIds: [copy.instanceIds[1]],
    });
    expect(revised.errors).toEqual([]);
    const document = parseEffectsFromHtml(revised.html).document!;
    expect(
      document.definitions.map((definition) => definition.version),
    ).toEqual([GRAIN_GRADIENT_EFFECT.version, nextDefinition.version]);
    expect(
      document.instances.map((instance) => instance.definitionVersion),
    ).toEqual([GRAIN_GRADIENT_EFFECT.version, nextDefinition.version]);
  });

  it("atomically revises only selected instance parameters and preserves their unchanged overrides", () => {
    const first = applied();
    const copy = editNativeEffectHtml(first.html, {
      kind: "duplicate",
      instanceId: first.instanceIds[0],
    });
    const withOverrides = editNativeEffectHtml(copy.html, {
      kind: "set-params",
      instanceId: copy.instanceIds[1],
      params: { scale: 2, grain: 0.08 },
    });
    const definition = {
      ...GRAIN_GRADIENT_EFFECT,
      version: GRAIN_GRADIENT_EFFECT.version + 1,
    };
    const revised = editNativeEffectHtml(withOverrides.html, {
      kind: "revise-definition",
      definition,
      fromVersion: GRAIN_GRADIENT_EFFECT.version,
      instanceIds: [copy.instanceIds[1]],
      params: { grain: 0.2 },
    });
    expect(revised.errors).toEqual([]);
    const instances = parseEffectsFromHtml(revised.html).document!.instances;
    expect(instances[0]).toMatchObject({
      definitionVersion: GRAIN_GRADIENT_EFFECT.version,
      params: {},
    });
    expect(instances[1]).toMatchObject({
      definitionVersion: definition.version,
      params: { scale: 2, grain: 0.2 },
    });

    const malformed = editNativeEffectHtml(withOverrides.html, {
      kind: "revise-definition",
      definition,
      fromVersion: GRAIN_GRADIENT_EFFECT.version,
      instanceIds: [copy.instanceIds[1]],
      params: { grain: Number.NaN },
    });
    expect(malformed.errors.length).toBeGreaterThan(0);
    expect(malformed.html).toBe(withOverrides.html);
  });

  it("requires an explicit version when applying a multi-version custom definition", () => {
    const base = applied();
    const document = parseEffectsFromHtml(base.html).document!;
    const withVersions = writeEffectsToHtml(base.html, {
      ...document,
      definitions: [
        ...document.definitions,
        { ...GRAIN_GRADIENT_EFFECT, version: 3 },
      ],
    });
    const ambiguous = editNativeEffectHtml(withVersions, {
      kind: "apply",
      nodeId: "hero",
      placement: "fill",
      definitionId: GRAIN_GRADIENT_EFFECT.id,
    });
    expect(ambiguous.errors[0]).toContain("needs definitionVersion");
    const pinned = editNativeEffectHtml(withVersions, {
      kind: "apply",
      nodeId: "hero",
      placement: "fill",
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: 3,
    });
    expect(pinned.errors).toEqual([]);
    const pinnedInstances = parseEffectsFromHtml(pinned.html).document
      ?.instances;
    expect(pinnedInstances?.[0]?.definitionVersion).toBe(3);
  });
});
