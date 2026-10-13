import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const wgsl = `${NATIVE_RENDER_GLOBALS}
fn randomAt(pixel: vec2f, tap: f32, salt: f32) -> f32 {
  let phase = dot(vec4f(pixel, tap, salt), vec4f(12.9898, 78.233, 37.719, 45.164));
  return fract(sin(phase) * 43758.5453);
}
fn sourceAt(uv: vec2f, mode: f32) -> vec4f {
  if (mode < 0.5 && (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)))) {
    return vec4f(0.0);
  }
  var mapped = uv;
  if (mode >= 0.5 && mode < 1.5) {
    mapped = clamp(uv, vec2f(0.0), vec2f(1.0));
  } else if (mode >= 1.5 && mode < 2.5) {
    mapped = fract(uv);
  } else if (mode >= 2.5) {
    mapped = vec2f(1.0) - abs(fract(uv * 0.5) * 2.0 - vec2f(1.0));
  }
  return textureSampleLevel(sourceTexture, effectSampler, mapped, 0.0);
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let source = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let amount = globals.params[4].x;
  let radiusCss = globals.params[0].x;
  if (amount <= 0.0 || radiusCss <= 0.0) { return source; }
  let radiusUv = vec2f(radiusCss * globals.clock.z) * globals.viewport.zw;
  let pixel = floor(input.uv * globals.viewport.xy);
  let seed = globals.params[1].x;
  let taps = i32(globals.params[2].x);
  let edgeMode = globals.params[3].x;
  var sum = vec4f(0.0);
  for (var index = 0; index < 32; index += 1) {
    if (index >= taps) { break; }
    let angle = randomAt(pixel, f32(index), seed + 0.23) * 6.283185307179586;
    let distance = sqrt(randomAt(pixel, f32(index), seed + 71.37));
    let offset = vec2f(cos(angle), sin(angle)) * distance * radiusUv;
    sum += sourceAt(input.uv + offset, edgeMode);
  }
  return mix(source, sum / f32(taps), amount);
}`;

export const SEEDED_SCATTER_BLUR_EFFECT: EffectDefinition = {
  id: "an-native-owned-bx-seeded-scatter-blur",
  name: "Seeded Scatter Blur",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    scatterRadius: {
      type: "float",
      label: "Scatter radius",
      default: 12,
      min: 0,
      max: 120,
      step: 0.5,
      unit: "px",
    },
    scatterSeed: {
      type: "int",
      label: "Scatter seed",
      default: 17,
      min: 0,
      max: 10000,
      step: 1,
    },
    sampleCount: {
      type: "int",
      label: "Sample count",
      default: 24,
      min: 8,
      max: 32,
      step: 1,
    },
    edgeMode: {
      type: "enum",
      label: "Edge mode",
      default: "Clamp",
      options: ["Transparent", "Clamp", "Repeat", "Mirror"],
    },
    amount: {
      type: "float",
      label: "Amount",
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
    },
  },
  inputs: { source: { kind: "texture-2d", resource: "source" } },
  outputs: { color: { kind: "texture-2d", resource: "color" } },
  resources: [
    {
      name: "source",
      kind: "texture-2d",
      external: true,
      usage: ["sampled"],
      size: "viewport",
    },
    {
      name: "color",
      kind: "texture-2d",
      format: "rgba16float",
      usage: ["sampled", "render"],
      size: "viewport",
    },
  ],
  resourceGraph: { abi: "linear-resource-v1" },
  passes: [
    {
      id: "scatter-gather",
      kind: "render",
      reads: ["source"],
      output: "color",
      wgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Each output pixel gathers 8–32 seeded source positions over a two-dimensional CSS-pixel disk. Four edge mappings define transparent source behavior; zero amount or radius returns the source exactly.",
  },
};

export const SEEDED_SCATTER_BLUR_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-bx-soft-scatter",
    name: "Soft Scatter",
    definitionId: SEEDED_SCATTER_BLUR_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      scatterRadius: 8,
      scatterSeed: 17,
      sampleCount: 32,
      edgeMode: "Clamp",
      amount: 0.85,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-bx-prismatic-haze",
    name: "Prismatic Haze",
    definitionId: SEEDED_SCATTER_BLUR_EFFECT.id,
    definitionVersion: 1,
    placement: "backdrop",
    params: {
      scatterRadius: 34,
      scatterSeed: 81,
      sampleCount: 24,
      edgeMode: "Mirror",
      amount: 0.72,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
