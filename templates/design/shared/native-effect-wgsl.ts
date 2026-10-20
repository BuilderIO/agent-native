export const NATIVE_RENDER_GLOBALS = `
struct Globals {
  viewport: vec4f,
  clock: vec4f,
  params: array<vec4f, 32>,
};
@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var effectSampler: sampler;
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var maskTexture: texture_2d<f32>;
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};
@vertex fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let coordinates = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var output: VertexOutput;
  output.position = vec4f(coordinates[vertexIndex], 0.0, 1.0);
  output.uv = coordinates[vertexIndex] * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
  return output;
}
`;

export const NATIVE_GLOBAL_BINDINGS = NATIVE_RENDER_GLOBALS.slice(
  0,
  NATIVE_RENDER_GLOBALS.indexOf("struct VertexOutput"),
);

export const NATIVE_GRAPH_GLOBALS = NATIVE_RENDER_GLOBALS.slice(
  0,
  NATIVE_RENDER_GLOBALS.indexOf("@group(0) @binding(2)"),
);

export function nativeRenderExtraTextureBindings(readCount: number): string {
  if (!Number.isSafeInteger(readCount) || readCount < 0 || readCount > 16)
    throw new RangeError("A render pass needs at most sixteen texture reads.");
  return Array.from(
    { length: Math.max(0, readCount - 2) },
    (_, index) =>
      `@group(0) @binding(${index + 4}) var extraTexture${index}: texture_2d<f32>;`,
  ).join("\n");
}
