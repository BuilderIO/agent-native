import { describe, expect, it } from "vitest";

import applyShader from "./apply-shader";
import applyShaderFill from "./apply-shader-fill";
import previewShaderFill from "./preview-shader-fill";

const descriptor = {
  preset: "MeshGradient",
  params: { distortion: 0.8 },
  colors: ["#e0eaff", "#241d9a"],
};

describe("historical shader descriptor compatibility", () => {
  it("keeps a valid descriptor readable but never returns a new JSX or canvas mount", async () => {
    const result = await applyShader.run({ descriptor } as never);
    expect(result).toMatchObject({
      ok: false,
      code: "legacy-shader-retired",
      nativeAction: "edit-native-shader",
      descriptor,
    });
    expect(result).not.toHaveProperty("jsxSnippet");
    expect(result).not.toHaveProperty("bridgeMount");
    expect(result).not.toHaveProperty("importLine");
  });

  it("preserves invalid historical descriptor errors without advertising retired presets", async () => {
    const invalidDescriptor = {
      ...descriptor,
      params: { obsoleteControl: 3 },
    };
    const result = await applyShader.run({
      descriptor: invalidDescriptor,
    } as never);
    expect(result).toMatchObject({
      ok: false,
      code: "invalid-legacy-descriptor",
      descriptor: invalidDescriptor,
      nativeAction: "edit-native-shader",
      errors: [expect.stringContaining("Unknown param key")],
    });
    expect(result).not.toHaveProperty("availablePresets");
    expect(result).not.toHaveProperty("jsxSnippet");
    expect(result).not.toHaveProperty("bridgeMount");
  });

  it("rejects old fill preview and persistence without writing source or inventing a CSS shader", async () => {
    const source = {
      kind: "design-file",
      designId: "historical-design",
      fileId: "historical-file",
      currentContent: '<div data-agent-native-node-id="target"></div>',
    };
    const target = { nodeId: "target" };
    const preview = await previewShaderFill.run({
      descriptor,
      target,
    } as never);
    const apply = await applyShaderFill.run({
      descriptor,
      target,
      source,
    } as never);
    expect(preview).toMatchObject({ ok: false, code: "legacy-shader-retired" });
    expect(apply).toMatchObject({
      ok: false,
      persisted: false,
      code: "legacy-shader-retired",
    });
    expect(preview).not.toHaveProperty("previewCss");
    expect(apply).not.toHaveProperty("patchedContent");
    expect(apply).not.toHaveProperty("background");
  });
});
