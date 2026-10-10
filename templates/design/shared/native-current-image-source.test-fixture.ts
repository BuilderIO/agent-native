import type { EffectDefinition } from "./native-effects";

export const OWNED_CURRENT_IMAGE_SOURCE_TEST_EFFECT: EffectDefinition = {
  id: "an-native-current-image-source-test",
  name: "Current image source test",
  version: 1,
  kind: "processor",
  placements: ["layer"],
  properties: {},
  inputs: { source: { kind: "texture-2d", resource: "source" } },
  outputs: { color: { kind: "texture-2d", resource: "color" } },
  resources: [
    {
      name: "source",
      kind: "texture-2d",
      external: true,
      size: "viewport",
      usage: ["sampled"],
    },
    {
      name: "color",
      kind: "texture-2d",
      format: "rgba16float",
      size: "viewport",
      usage: ["render", "sampled"],
    },
  ],
  output: "color",
  passes: [
    {
      id: "current-source",
      kind: "render",
      reads: ["source"],
      output: "color",
      wgsl: `
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let x = f32((index << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(index & 2u) * 2.0 - 1.0;
  return vec4f(x, y, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
  return textureLoad(sourceTexture, vec2i(position.xy), 0);
}
`,
    },
  ],
  provenance: {
    origin: "design-original",
    note: "Test-only identity processor for current rendered image sources.",
  },
};
