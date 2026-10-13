import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const color = (components: [number, number, number], alpha = 1) => ({
  space: "srgb" as const,
  components,
  alpha,
});

const layeredSwirlWgsl = `${NATIVE_RENDER_GLOBALS}
fn rotate(point: vec2f, angle: f32) -> vec2f {
  let cosine = cos(angle);
  let sine = sin(angle);
  return vec2f(point.x * cosine - point.y * sine, point.x * sine + point.y * cosine);
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let aspect = globals.viewport.x / globals.viewport.y;
  let center = globals.params[7].xy;
  let original = (input.uv - center) * vec2f(aspect, 1.0);
  let time = globals.clock.x * globals.params[3].x;
  let radius = globals.params[1].x;
  let twist = globals.params[2].x;
  let drift = globals.params[4].x;
  var flow = original;
  var phaseOffset = 0.0;
  for (var index = 0u; index < 8u; index += 1u) {
    if (f32(index) >= globals.params[0].x) { break; }
    let layer = f32(index);
    let orbit = layer * 2.39996323;
    let movingCenter = vec2f(
      cos(orbit + time * (0.16 + layer * 0.023)),
      sin(orbit * 1.27 - time * (0.12 + layer * 0.017))
    ) * (0.17 + drift * 0.18);
    let displacement = flow - movingCenter;
    let localRadius = radius * (0.72 + 0.08 * layer);
    let influence = exp(-dot(displacement, displacement) / (localRadius * localRadius));
    let handedness = select(-1.0, 1.0, index % 2u == 0u);
    flow = movingCenter + rotate(displacement, twist * influence * handedness);
    phaseOffset += influence * handedness * (0.36 + layer * 0.045);
  }
  let frequency = globals.params[5].x * 6.2831853;
  let bandPhase = flow.y * frequency + flow.x * frequency * 0.32
    + phaseOffset * 2.4 - time * (0.42 + drift * 0.28);
  let band = clamp((0.5 + 0.5 * sin(bandPhase) - 0.5) * globals.params[6].x + 0.5, 0.0, 1.0);
  let secondary = 0.5 + 0.5 * sin(bandPhase * 0.49 + flow.x * 3.1 + time * 0.19);
  let first = mix(globals.params[8], globals.params[9], band);
  let straight = mix(first, globals.params[10], secondary * 0.48);
  let alpha = straight.a * globals.params[11].x;
  return vec4f(straight.rgb * alpha, alpha);
}`;

export const LAYERED_SWIRL_EFFECT: EffectDefinition = {
  id: "an-native-owned-ca-layered-swirl",
  name: "Layered Swirl",
  version: 1,
  kind: "generator",
  placements: ["fill"],
  properties: {
    layers: {
      type: "int",
      label: "Flow layers",
      default: 5,
      min: 2,
      max: 8,
      step: 1,
    },
    radius: {
      type: "float",
      label: "Vortex radius",
      default: 0.42,
      min: 0.08,
      max: 0.9,
      step: 0.01,
    },
    twist: {
      type: "float",
      label: "Twist",
      default: 2.1,
      min: -5,
      max: 5,
      step: 0.01,
    },
    speed: {
      type: "float",
      label: "Flow speed",
      default: 0.65,
      min: 0,
      max: 3,
      step: 0.01,
    },
    drift: {
      type: "float",
      label: "Center drift",
      default: 0.45,
      min: 0,
      max: 1.5,
      step: 0.01,
    },
    bandFrequency: {
      type: "float",
      label: "Band frequency",
      default: 3.5,
      min: 0.5,
      max: 12,
      step: 0.1,
    },
    contrast: {
      type: "float",
      label: "Band contrast",
      default: 1.2,
      min: 0.1,
      max: 3,
      step: 0.01,
    },
    center: {
      type: "vec2",
      label: "Flow center",
      default: [0.5, 0.5],
      min: 0,
      max: 1,
    },
    colorA: {
      type: "color",
      label: "Low color",
      default: color([0.055, 0.16, 0.37]),
    },
    colorB: {
      type: "color",
      label: "High color",
      default: color([0.18, 0.76, 0.84]),
    },
    colorC: {
      type: "color",
      label: "Accent color",
      default: color([0.9, 0.41, 0.67]),
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
      id: "draw-layered-swirl",
      kind: "render",
      reads: [],
      output: "color",
      wgsl: layeredSwirlWgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original bounded moving vortex field with alternating rotational layers, advected bands, and premultiplied three-color output.",
  },
};

export const LAYERED_SWIRL_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-ca-tidal-bloom",
    name: "Tidal Bloom",
    definitionId: LAYERED_SWIRL_EFFECT.id,
    definitionVersion: 1,
    placement: "fill",
    params: {
      layers: 5,
      radius: 0.46,
      twist: 2.3,
      speed: 0.7,
      drift: 0.42,
      bandFrequency: 3.4,
      contrast: 1.12,
      center: [0.5, 0.52],
      colorA: color([0.055, 0.16, 0.37]),
      colorB: color([0.18, 0.76, 0.84]),
      colorC: color([0.9, 0.41, 0.67]),
      opacity: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-ca-copper-cyclone",
    name: "Copper Cyclone",
    definitionId: LAYERED_SWIRL_EFFECT.id,
    definitionVersion: 1,
    placement: "fill",
    params: {
      layers: 8,
      radius: 0.24,
      twist: -3.15,
      speed: 1.24,
      drift: 1.08,
      bandFrequency: 6.3,
      contrast: 1.85,
      center: [0.45, 0.55],
      colorA: color([0.12, 0.055, 0.075]),
      colorB: color([0.91, 0.34, 0.11]),
      colorC: color([1, 0.77, 0.34]),
      opacity: 0.97,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];

export const LAYERED_SWIRL_PRESET_LABEL_SOURCE_IDS: Readonly<
  Record<string, string>
> = Object.fromEntries(
  LAYERED_SWIRL_PRESETS.map((preset) => [preset.id, preset.id]),
);
