import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const wgsl = `${NATIVE_RENDER_GLOBALS}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let source = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let progress = globals.params[0].x;
  if (progress <= 0.0) { return vec4f(0.0); }
  if (progress >= 1.0) { return source; }
  let cssSize = globals.viewport.xy / globals.clock.z;
  let cssPoint = input.uv * cssSize;
  let spacing = globals.params[1].x;
  let cell = floor(cssPoint / spacing);
  let fraction = fract(cssPoint / spacing);
  let angle = globals.params[2].x;
  let direction = vec2f(cos(angle), sin(angle));
  let center = ((cell + 0.5) * spacing / cssSize - 0.5) * 2.0;
  let stagger = globals.params[3].x;
  let order = clamp((dot(center, direction) * 0.25 + 0.35) * stagger, 0.0, 0.8);
  let localProgress = clamp((progress - order) / (1.0 - order), 0.0, 1.0);
  let diamond = abs(fraction.x - 0.5) + abs(fraction.y - 0.5);
  let feather = max(globals.params[4].x, 0.5 / globals.clock.z) / spacing;
  let radius = mix(-feather, 1.0 + feather, localProgress);
  let coverage = 1.0 - smoothstep(radius - feather, radius + feather, diamond);
  return source * coverage;
}`;

export const DIAMOND_REVEAL_EFFECT: EffectDefinition = {
  id: "an-native-owned-cf-diamond-reveal",
  name: "Diamond Reveal",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    progress: {
      type: "float",
      label: "Reveal progress",
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
    },
    gridSize: {
      type: "float",
      label: "Diamond size",
      default: 28,
      min: 6,
      max: 100,
      step: 1,
    },
    sweepAngle: {
      type: "float",
      label: "Sweep angle",
      default: 0,
      min: -3.14,
      max: 3.14,
      step: 0.01,
    },
    stagger: {
      type: "float",
      label: "Sweep stagger",
      default: 0.6,
      min: 0,
      max: 1,
      step: 0.01,
    },
    softness: {
      type: "float",
      label: "Edge softness",
      default: 1.2,
      min: 0.1,
      max: 8,
      step: 0.1,
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
      usage: ["render", "sampled"],
      size: "viewport",
    },
  ],
  resourceGraph: { abi: "linear-resource-v1" },
  passes: [
    {
      id: "reveal-source-diamonds",
      kind: "render",
      reads: ["source"],
      output: "color",
      wgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Reveals the actual premultiplied source through growing CSS-sized diamond cells with directional sweep and explicit transparent and exact-source endpoints.",
  },
};

export const DIAMOND_REVEAL_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-cf-rising-facets",
    name: "Rising Facets",
    definitionId: DIAMOND_REVEAL_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      progress: 0.45,
      gridSize: 22,
      sweepAngle: -1.57,
      stagger: 0.8,
      softness: 0.6,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-cf-wide-mosaic",
    name: "Wide Mosaic",
    definitionId: DIAMOND_REVEAL_EFFECT.id,
    definitionVersion: 1,
    placement: "backdrop",
    params: {
      progress: 0.66,
      gridSize: 64,
      sweepAngle: 0.7,
      stagger: 0.25,
      softness: 3,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
