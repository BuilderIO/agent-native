import { describe, expect, it } from "vitest";

import { catalogFloat, catalogShader } from "./native-effect-catalog-kit";
import {
  clearNativeFillFromHtml,
  editNativeEffectHtml,
  type NativeEffectEdit,
} from "./native-effect-edits";
import { LIQUID_GLASS_EFFECT } from "./native-effect-liquid-glass-v1";
import { parseEffectsFromHtml, type EffectDocument } from "./native-effects";
import { applyShaderToHtml, listShaderMounts } from "./shader-fills";

const source = `<!doctype html><html><body><div data-agent-native-node-id="hero" style="background-image:linear-gradient(red,blue);background-color:white">Foreground</div><div data-agent-native-node-id="sibling">Sibling</div></body></html>`;
const definition = catalogShader({
  id: "fill-stack-proof",
  name: "Stack",
  kind: "generator",
  properties: { gain: catalogFloat("Gain", 0.5, 0, 1) },
  fragment: () => "return vec4f(0.0);",
});

function edit(html: string, operation: NativeEffectEdit) {
  const result = editNativeEffectHtml(html, operation);
  expect(result.errors).toEqual([]);
  const parsed = parseEffectsFromHtml(result.html);
  expect(parsed.errors).toEqual([]);
  expect(parsed.document).not.toBeNull();
  return { html: result.html, document: parsed.document! };
}

function apply(html = source, nodeId = "hero") {
  return edit(html, {
    kind: "apply",
    nodeId,
    placement: "fill",
    definition,
  });
}

function ids(document: EffectDocument) {
  return document.instances.map((instance) => instance.id);
}

describe("native Fill stacking edits", () => {
  it("appends a same-node Fill without changing saved paints, siblings, or preview policy", () => {
    const first = apply();
    const sibling = apply(first.html, "sibling");
    const preview = edit(sibling.html, {
      kind: "set-preview",
      preview: { quality: "quality", frameRateTarget: 120 },
    });
    const second = apply(preview.html);
    expect(second.document.instances).toHaveLength(3);
    expect(second.document.instances.slice(0, 2)).toEqual(
      preview.document.instances,
    );
    expect(second.document.instances[2]).toMatchObject({
      nodeId: "hero",
      placement: "fill",
    });
    expect(new Set(ids(second.document)).size).toBe(3);
    expect(second.document.preview).toEqual(preview.document.preview);
    expect(second.html).toContain(
      source.slice(source.indexOf("<body>"), source.indexOf("</body>")),
    );
    expect(second.document.definitions).toEqual(first.document.definitions);
  });

  it("persists stacked fills on an outer SVG without replacing vector paint or geometry", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" data-agent-native-node-id="vector" viewBox="0 0 60 20" style="width:120px;height:40px;color:navy"><defs><linearGradient id="paint"><stop stop-color="red"/><stop offset="1" stop-color="blue" stop-opacity="0.4"/></linearGradient></defs><path data-agent-native-node-id="path" fill="currentColor" d="M0 0h20v20H0z"/><path fill="url(#paint)" fill-rule="evenodd" d="M30 0h30v20H30z M35 5v10h20V5z"/></svg>`;
    const source = `<html><body>${svg}<div data-agent-native-node-id="sibling">Sibling</div></body></html>`;
    const first = apply(source, "vector");
    const second = apply(first.html, "vector");
    expect(
      second.document.instances.map((instance) => instance.nodeId),
    ).toEqual(["vector", "vector"]);
    expect(second.html).toContain(svg);
    const changed = edit(second.html, {
      kind: "set-instance",
      instanceId: second.document.instances[1].id,
      opacity: 0.3,
      enabled: false,
    });
    expect(changed.document.instances[1]).toMatchObject({
      opacity: 0.3,
      enabled: false,
    });
    const removed = edit(changed.html, {
      kind: "remove",
      instanceId: changed.document.instances[0].id,
    });
    expect(removed.document.instances).toEqual([changed.document.instances[1]]);
    expect(removed.html).toContain(svg);
  });

  it("persists Liquid Glass on an outer SVG and edits its stable instance without changing artwork", () => {
    const svg = `<svg data-agent-native-node-id="vector" viewBox="0 0 60 20" style="border-radius:8px"><defs><linearGradient id="paint"><stop stop-color="red"/><stop offset="1" stop-color="blue" stop-opacity="0.4"/></linearGradient></defs><path fill="url(#paint)" fill-rule="evenodd" d="M0 0h60v20H0z M5 5v10h50V5z"/></svg>`;
    const source = `<html><body>${svg}<div data-agent-native-node-id="sibling">Sibling</div></body></html>`;
    const applied = edit(source, {
      kind: "apply",
      nodeId: "vector",
      placement: "backdrop",
      definition: LIQUID_GLASS_EFFECT,
    });
    const instance = applied.document.instances[0];
    expect(instance).toMatchObject({
      definitionId: LIQUID_GLASS_EFFECT.id,
      definitionVersion: 1,
      placement: "backdrop",
      clip: "bounds",
      params: {},
    });
    expect(instance).not.toHaveProperty("bindings");
    const changed = edit(applied.html, {
      kind: "set-instance",
      instanceId: instance.id,
      params: { thickness: 18 },
      opacity: 0.75,
    });
    expect(changed.document.instances[0]).toMatchObject({
      id: instance.id,
      params: { thickness: 18 },
      opacity: 0.75,
    });
    expect(changed.html).toContain(svg);
    const hidden = edit(changed.html, {
      kind: "set-instance",
      instanceId: instance.id,
      enabled: false,
    });
    const visible = edit(hidden.html, {
      kind: "set-instance",
      instanceId: instance.id,
      enabled: true,
    });
    expect(visible.document.instances[0]).toEqual(
      changed.document.instances[0],
    );
    const wrongPlacement = editNativeEffectHtml(visible.html, {
      kind: "set-instance",
      instanceId: instance.id,
      placement: "layer",
    });
    expect(wrongPlacement.errors.length).toBeGreaterThan(0);
    expect(wrongPlacement.html).toBe(visible.html);
    const removed = edit(visible.html, {
      kind: "remove",
      instanceId: instance.id,
    });
    expect(removed.document.instances).toEqual([]);
    expect(removed.html).toContain(svg);
  });

  it.each(["input", "read"] as const)(
    "requires a declared receiver geometry %s for SVG Backdrop",
    (missing) => {
      const source = `<html><body><svg data-agent-native-node-id="vector"><circle r="10"/></svg></body></html>`;
      const definition = structuredClone(LIQUID_GLASS_EFFECT);
      if (missing === "input") delete definition.inputs!.geometry;
      else
        definition.passes[0].reads = definition.passes[0].reads.filter(
          (name) => name !== "receiverGeometry",
        );
      const result = editNativeEffectHtml(source, {
        kind: "apply",
        nodeId: "vector",
        placement: "backdrop",
        definition,
      });
      expect(result.errors).toEqual([
        "native-effect-target-svg-backdrop-unsupported",
      ]);
      expect(result.html).toBe(source);
    },
  );

  it("accepts receiver geometry inputs on textures and rejects them on masks", () => {
    const applied = edit(source, {
      kind: "apply",
      nodeId: "hero",
      placement: "backdrop",
      definition: LIQUID_GLASS_EFFECT,
      bindings: { geometry: { kind: "builtin", source: "receiver-geometry" } },
    });
    expect(applied.document.instances[0].bindings).toEqual({
      geometry: { kind: "builtin", source: "receiver-geometry" },
    });
    const incompatible = editNativeEffectHtml(applied.html, {
      kind: "set-instance",
      instanceId: applied.document.instances[0].id,
      bindings: { mask: { kind: "builtin", source: "receiver-geometry" } },
    });
    expect(incompatible.errors).toEqual([
      "instance[0].bindings.mask builtin source is incompatible",
    ]);
    expect(incompatible.html).toBe(applied.html);
    const interiorDefinition = structuredClone(LIQUID_GLASS_EFFECT);
    interiorDefinition.inputs!.geometry!.resource = "receiverInterior";
    interiorDefinition.passes[0]!.reads = [
      "source",
      "mask",
      "receiverInterior",
    ];
    interiorDefinition.resources = interiorDefinition.resources?.map(
      (resource) =>
        resource.name === "receiverGeometry"
          ? { ...resource, name: "receiverInterior" }
          : resource,
    );
    const interior = edit(source, {
      kind: "apply",
      nodeId: "hero",
      placement: "backdrop",
      definition: interiorDefinition,
      bindings: { geometry: { kind: "builtin", source: "receiver-interior" } },
    });
    expect(interior.document.instances[0].bindings).toEqual({
      geometry: { kind: "builtin", source: "receiver-interior" },
    });
  });

  it.each([
    {
      placement: "backdrop" as const,
      clip: "bounds" as const,
      error: "native-effect-target-svg-backdrop-unsupported",
    },
    {
      placement: "fill" as const,
      clip: "text" as const,
      error: "native-effect-target-svg-text-clip-unsupported",
    },
  ])(
    "rejects unsupported SVG $placement / $clip before saving",
    ({ placement, clip, error }) => {
      const source = `<html><body><svg data-agent-native-node-id="vector"><circle r="10"/></svg></body></html>`;
      const result = editNativeEffectHtml(source, {
        kind: "apply",
        nodeId: "vector",
        placement,
        clip,
        definition,
      });
      expect(result.errors).toEqual([error]);
      expect(result.html).toBe(source);
    },
  );

  it("preserves inherited root SVG paint when applying a native fill", () => {
    const svg = `<svg data-agent-native-node-id="vector" viewBox="0 0 20 20" fill="red"><circle cx="10" cy="10" r="8"/></svg>`;
    const source = `<html><body>${svg}</body></html>`;
    const result = apply(source, "vector");
    expect(result.html).toContain(svg);
    expect(result.document.instances[0]).toMatchObject({
      nodeId: "vector",
      placement: "fill",
      clip: "bounds",
    });
    const changed = editNativeEffectHtml(result.html, {
      kind: "set-instance",
      instanceId: result.document.instances[0].id,
      clip: "text",
    });
    expect(changed.errors).toEqual([
      "native-effect-target-svg-text-clip-unsupported",
    ]);
    expect(changed.html).toBe(result.html);
  });

  it.each([
    `<svg><path data-agent-native-node-id="child" d="M0 0h10v10H0z"/></svg>`,
    `<svg><g data-agent-native-node-id="child"><path d="M0 0h10v10H0z"/></g></svg>`,
    `<svg><svg data-agent-native-node-id="child" viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg></svg>`,
  ])("rejects an SVG child target before creating a manifest: %s", (svg) => {
    const source = `<html><body>${svg}</body></html>`;
    for (const placement of ["fill", "backdrop"] as const) {
      const result = editNativeEffectHtml(source, {
        kind: "apply",
        nodeId: "child",
        placement,
        definition: placement === "fill" ? definition : LIQUID_GLASS_EFFECT,
      });
      expect(result.errors).toEqual([
        "native-effect-target-svg-child-unsupported",
      ]);
      expect(result.html).toBe(source);
      expect(parseEffectsFromHtml(result.html).document).toBeNull();
    }
  });

  it("addresses controls, visibility, order, duplication, and removal by a stable instance ID", () => {
    const first = apply();
    const second = apply(first.html);
    expect(second.document.instances).toHaveLength(2);
    const [lower, upper] = second.document.instances;
    const edited = edit(second.html, {
      kind: "set-instance",
      instanceId: lower.id,
      params: { gain: 0.25 },
      enabled: false,
      opacity: 0.4,
    });
    expect(edited.document.instances[0]).toMatchObject({
      id: lower.id,
      params: { gain: 0.25 },
      enabled: false,
      opacity: 0.4,
    });
    expect(edited.document.instances[1]).toEqual(upper);
    const reordered = edit(edited.html, {
      kind: "reorder",
      instanceId: upper.id,
      beforeInstanceId: lower.id,
    });
    expect(ids(reordered.document)).toEqual([upper.id, lower.id]);
    expect(reordered.document.instances).toEqual([
      upper,
      edited.document.instances[0],
    ]);
    const duplicated = edit(reordered.html, {
      kind: "duplicate",
      instanceId: upper.id,
    });
    expect(duplicated.document.instances).toHaveLength(3);
    expect(duplicated.document.instances[1]).toEqual({
      ...upper,
      id: duplicated.document.instances[1].id,
    });
    expect(new Set(ids(duplicated.document)).size).toBe(3);
    const removed = edit(duplicated.html, {
      kind: "remove",
      instanceId: upper.id,
    });
    expect(removed.document.instances).toEqual(
      duplicated.document.instances.slice(1),
    );
    const restored = edit(removed.html, {
      kind: "set-instance",
      instanceId: lower.id,
      enabled: true,
    });
    expect(restored.document.instances[1]).toMatchObject({
      id: lower.id,
      enabled: true,
      params: { gain: 0.25 },
      opacity: 0.4,
    });
  });

  it("clears legacy GLSL Fill on apply while preserving native Fill and legacy sibling mounts", () => {
    const first = apply();
    const legacy = {
      id: "legacy-fill",
      name: "Legacy",
      mode: "fill" as const,
      glsl: "precision highp float;void main(){gl_FragColor=vec4(1.0);}",
      uniforms: {},
    };
    const heroLegacy = applyShaderToHtml(first.html, {
      nodeId: "hero",
      def: legacy,
    });
    expect(heroLegacy.errors).toEqual([]);
    const siblingLegacy = applyShaderToHtml(heroLegacy.html, {
      nodeId: "sibling",
      def: legacy,
    });
    expect(siblingLegacy.errors).toEqual([]);
    const second = apply(siblingLegacy.html);
    expect(second.document.instances).toHaveLength(2);
    expect(second.document.instances[0]).toEqual(first.document.instances[0]);
    expect(listShaderMounts(second.html).map((mount) => mount.nodeId)).toEqual([
      "sibling",
    ]);
  });

  it("keeps explicit all-Fill clearing scoped to its authored node", () => {
    const first = apply();
    const second = apply(first.html);
    const sibling = apply(second.html, "sibling");
    expect(sibling.document.instances).toHaveLength(3);
    const cleared = clearNativeFillFromHtml(sibling.html, "hero");
    expect(cleared.errors).toEqual([]);
    const parsed = parseEffectsFromHtml(cleared.html);
    expect(parsed.errors).toEqual([]);
    expect(parsed.document?.instances).toEqual([sibling.document.instances[2]]);
  });
});
