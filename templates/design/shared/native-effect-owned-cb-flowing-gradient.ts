import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const color = (components: [number, number, number], alpha = 1) => ({
  space: "srgb" as const,
  components,
  alpha,
});

const flowingGradientWgsl = `${NATIVE_RENDER_GLOBALS}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let aspect = globals.viewport.x / globals.viewport.y;
  let point = (input.uv - vec2f(0.5)) * vec2f(aspect, 1.0) * globals.params[0].x;
  let time = globals.clock.x * globals.params[4].x;
  let frequency = globals.params[3].x * 6.2831853;
  let firstWarp = vec2f(
    sin(point.y * frequency + time * 0.72),
    cos(point.x * frequency * 1.13 - time * 0.61)
  );
  let firstDomain = point + firstWarp * globals.params[1].x;
  let secondWarp = vec2f(
    sin(firstDomain.x * frequency * 1.71 + firstDomain.y * frequency * 0.71 - time * 0.56),
    cos(firstDomain.y * frequency * 1.47 - firstDomain.x * frequency * 0.83 + time * 0.91)
  );
  let domain = firstDomain + secondWarp * globals.params[2].x;
  let angle = globals.params[5].x;
  let direction = vec2f(cos(angle), sin(angle));
  let phase = dot(domain, direction) * globals.params[6].x
    + 0.13 * sin(domain.y * frequency * 0.48 + time * 0.37)
    + time * 0.085;
  let band = fract(phase);
  let feather = clamp(max(globals.params[7].x, fwidth(phase) * 0.5), 0.001, 0.2);
  var straight = globals.params[8];
  straight = mix(straight, globals.params[9], smoothstep(0.25 - feather, 0.25 + feather, band));
  straight = mix(straight, globals.params[10], smoothstep(0.5 - feather, 0.5 + feather, band));
  straight = mix(straight, globals.params[11], smoothstep(0.75 - feather, 0.75 + feather, band));
  straight = mix(straight, globals.params[8], smoothstep(1.0 - feather, 1.0, band));
  let alpha = straight.a * globals.params[12].x;
  return vec4f(straight.rgb * alpha, alpha);
}`;

export const FLOWING_GRADIENT_EFFECT: EffectDefinition = {
  id: "an-native-owned-cb-flowing-gradient",
  name: "Flowing Gradient",
  version: 1,
  kind: "generator",
  placements: ["fill"],
  properties: {
    scale: {
      type: "float",
      label: "Field scale",
      default: 1,
      min: 0.3,
      max: 4,
      step: 0.01,
    },
    firstWarp: {
      type: "float",
      label: "First warp",
      default: 0.18,
      min: 0,
      max: 0.65,
      step: 0.01,
    },
    secondWarp: {
      type: "float",
      label: "Second warp",
      default: 0.14,
      min: 0,
      max: 0.65,
      step: 0.01,
    },
    warpFrequency: {
      type: "float",
      label: "Warp frequency",
      default: 1.9,
      min: 0.2,
      max: 7,
      step: 0.01,
    },
    speed: {
      type: "float",
      label: "Flow speed",
      default: 0.8,
      min: 0,
      max: 3,
      step: 0.01,
    },
    angle: {
      type: "float",
      label: "Band angle",
      default: 0.6,
      min: -3.14,
      max: 3.14,
      step: 0.01,
    },
    bandFrequency: {
      type: "float",
      label: "Band frequency",
      default: 2.7,
      min: 0.3,
      max: 12,
      step: 0.01,
    },
    softness: {
      type: "float",
      label: "Band softness",
      default: 0.06,
      min: 0.005,
      max: 0.2,
      step: 0.005,
    },
    colorA: {
      type: "color",
      label: "First color",
      default: color([0.08, 0.1, 0.31]),
    },
    colorB: {
      type: "color",
      label: "Second color",
      default: color([0.19, 0.54, 0.88]),
    },
    colorC: {
      type: "color",
      label: "Third color",
      default: color([0.69, 0.78, 0.92]),
    },
    colorD: {
      type: "color",
      label: "Fourth color",
      default: color([0.94, 0.4, 0.55]),
    },
    opacity: {
      type: "float",
      label: "Opacity",
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
    },
  },
  outputs: { color: { kind: "texture-2d", resource: "color" } },
  resources: [
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
      id: "draw-flowing-gradient",
      kind: "render",
      reads: [],
      output: "color",
      wgsl: flowingGradientWgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original chained sinusoidal domain warps with four editable color bands, directional flow, and premultiplied output.",
  },
};

export const FLOWING_GRADIENT_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-cb-lagoon-folds",
    name: "Lagoon Folds",
    definitionId: FLOWING_GRADIENT_EFFECT.id,
    definitionVersion: 1,
    placement: "fill",
    params: {
      scale: 1,
      firstWarp: 0.18,
      secondWarp: 0.14,
      warpFrequency: 1.9,
      speed: 0.8,
      angle: 0.6,
      bandFrequency: 2.7,
      softness: 0.06,
      colorA: color([0.08, 0.1, 0.31]),
      colorB: color([0.19, 0.54, 0.88]),
      colorC: color([0.69, 0.78, 0.92]),
      colorD: color([0.94, 0.4, 0.55]),
      opacity: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-cb-molten-strata",
    name: "Molten Strata",
    definitionId: FLOWING_GRADIENT_EFFECT.id,
    definitionVersion: 1,
    placement: "fill",
    params: {
      scale: 1.6,
      firstWarp: 0.31,
      secondWarp: 0.28,
      warpFrequency: 3.6,
      speed: 0.42,
      angle: -0.36,
      bandFrequency: 4.4,
      softness: 0.018,
      colorA: color([0.09, 0.025, 0.045]),
      colorB: color([0.42, 0.075, 0.09]),
      colorC: color([0.91, 0.28, 0.07]),
      colorD: color([1, 0.79, 0.29]),
      opacity: 0.98,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];

export const FLOWING_GRADIENT_PRESET_LABEL_SOURCE_IDS: Readonly<
  Record<string, string>
> = Object.fromEntries(
  FLOWING_GRADIENT_PRESETS.map((preset) => [preset.id, preset.id]),
);
