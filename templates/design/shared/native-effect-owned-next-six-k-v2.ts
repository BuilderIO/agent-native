import {
  OWNED_NEXT_SIX_K_DEFINITIONS,
  OWNED_NEXT_SIX_K_PRESETS,
} from "./native-effect-owned-next-six-k";
import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const alphaId = "an-native-owned-k-alpha-medial-ridge";
const original = OWNED_NEXT_SIX_K_DEFINITIONS.find(
  (definition) => definition.id === alphaId,
);
if (!original)
  throw new Error("The frozen K medial-ridge predecessor is missing.");

const sampling = `
fn alphaSample(uv: vec2f) -> vec4f {
  let edge = u32(globals.params[0].x);
  if (edge == 0u && (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)))) { return vec4f(0.0); }
  var q = clamp(uv, vec2f(0.0), vec2f(1.0));
  if (edge == 2u) { q = fract(uv); }
  if (edge == 3u) { q = 1.0 - abs(1.0 - (uv - floor(uv / 2.0) * 2.0)); }
  return textureSampleLevel(sourceTexture, effectSampler, q, 0.0);
}
`;

const distancePass = `${NATIVE_RENDER_GLOBALS}${sampling}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let alpha = alphaSample(input.uv).a;
  if (alpha <= globals.params[2].x) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let radius = globals.params[1].x;
  var nearest = radius + 1.0;
  let texel = globals.clock.z * globals.viewport.zw;
  for (var step = 1u; step <= 6u; step += 1u) {
    if (f32(step) > radius) { break; }
    for (var direction = 0u; direction < 8u; direction += 1u) {
      let angle = f32(direction) * 0.7853981634;
      let delta = vec2f(cos(angle), sin(angle)) * texel * f32(step);
      if (alphaSample(input.uv + delta).a <= globals.params[2].x) {
        nearest = min(nearest, f32(step));
      }
    }
  }
  return vec4f(nearest, 0.0, 0.0, 1.0);
}
`;
const ridgePass = `${NATIVE_RENDER_GLOBALS}${sampling}
fn distanceAt(pixel: vec2i) -> f32 {
  let size = vec2i(textureDimensions(maskTexture));
  let edge = u32(globals.params[0].x);
  if (edge == 0u && (any(pixel < vec2i(0)) || any(pixel >= size))) { return 0.0; }
  var coordinate = clamp(pixel, vec2i(0), size - vec2i(1));
  if (edge == 2u) { coordinate = ((pixel % size) + size) % size; }
  if (edge == 3u) {
    let period = size * 2;
    let wrapped = ((pixel % period) + period) % period;
    coordinate = select(wrapped, period - vec2i(1) - wrapped, wrapped >= size);
  }
  return textureLoad(maskTexture, coordinate, 0).x;
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let original = alphaSample(input.uv);
  let amount = globals.params[4].x;
  if (original.a <= 0.00001 || amount <= 0.0) { return original; }
  let coordinate = vec2i(input.position.xy);
  let center = distanceAt(coordinate);
  let right = distanceAt(coordinate + vec2i(1, 0));
  let left = distanceAt(coordinate - vec2i(1, 0));
  let down = distanceAt(coordinate + vec2i(0, 1));
  let up = distanceAt(coordinate - vec2i(0, 1));
  let tallestNeighbor = max(max(right, left), max(down, up));
  let shortestNeighbor = min(min(right, left), min(down, up));
  let ridge = step(tallestNeighbor - 0.001, center) *
    smoothstep(0.0, globals.params[3].x, center - shortestNeighbor);
  return original * mix(1.0, ridge, amount);
}
`;

const optimized: EffectDefinition = {
  ...original,
  version: 2,
  resources: [
    {
      name: "source",
      kind: "texture-2d",
      usage: ["sampled"],
      external: true,
      size: "viewport",
    },
    {
      name: "distance",
      kind: "texture-2d",
      format: "rgba16float",
      usage: ["render", "sampled"],
      size: "viewport",
    },
    {
      name: "color",
      kind: "texture-2d",
      format: "rgba16float",
      usage: ["render", "sampled"],
      size: "viewport",
    },
  ],
  passes: [
    {
      id: "distance",
      kind: "render",
      reads: ["source"],
      output: "distance",
      wgsl: distancePass,
    },
    {
      id: "ridge",
      kind: "render",
      reads: ["source", "distance"],
      output: "color",
      wgsl: ridgePass,
    },
  ],
  provenance: {
    origin: "design-original",
    note: "Original two-pass alpha medial ridge; 48 bounded directional alpha samples followed by exact-neighbor distance lookup and ridge extraction.",
  },
};

export const OWNED_NEXT_SIX_K_V2_DEFINITIONS: readonly EffectDefinition[] =
  OWNED_NEXT_SIX_K_DEFINITIONS.map((definition) =>
    definition.id === alphaId ? optimized : definition,
  );
export const OWNED_NEXT_SIX_K_V2_PRESETS: readonly EffectPreset[] =
  OWNED_NEXT_SIX_K_PRESETS.map((preset) =>
    preset.definitionId === alphaId
      ? { ...preset, definitionVersion: 2 }
      : preset,
  );
