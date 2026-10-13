import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const color = (components: [number, number, number], alpha = 1) => ({
  space: "srgb" as const,
  components,
  alpha,
});

const wgsl = `${NATIVE_RENDER_GLOBALS}
fn streakHash(point: vec2f) -> f32 {
  return fract(sin(dot(point, vec2f(127.1, 311.7)) + globals.clock.y * 19.19 + globals.params[12].x) * 43758.5453);
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let cssSize = globals.viewport.xy / globals.clock.z;
  let point = input.uv * cssSize;
  let angle = globals.params[0].x;
  let direction = vec2f(cos(angle), sin(angle));
  let normal = vec2f(-direction.y, direction.x);
  let along = dot(point, direction);
  let across = dot(point, normal);
  let spacing = min(cssSize.x, cssSize.y) / globals.params[1].x;
  let period = spacing * 3.0;
  let lengthBase = spacing * globals.params[4].x;
  let row = floor(across / spacing);
  let aa = max(0.5 / globals.clock.z, 0.1);
  let background = globals.params[10];
  let opacity = globals.params[11].x;
  var result = vec4f(background.rgb * background.a * opacity, background.a * opacity);
  for (var iy = -1; iy <= 1; iy += 1) {
    let line = row + f32(iy);
    let lineHash = streakHash(vec2f(line, 0.0));
    let variance = mix(1.0, 0.45 + 1.1 * lineHash, globals.params[3].x);
    let shifted = along - globals.clock.x * globals.params[2].x * variance;
    let column = floor(shifted / period);
    for (var ix = -1; ix <= 1; ix += 1) {
      let segment = column + f32(ix);
      let key = vec2f(line, segment);
      let span = lengthBase * (0.65 + 0.35 * streakHash(key + 37.0));
      let start = segment * period + streakHash(key + 19.0) * max(period - span, 0.0);
      let finish = start + span;
      let center = (line + 0.5 + (streakHash(key + 53.0) - 0.5) * 0.36) * spacing;
      let lateral = abs(across - center);
      let nearest = clamp(shifted, start, finish);
      let roundDistance = length(vec2f(lateral, shifted - nearest)) - globals.params[5].x * 0.5;
      let squareDistance = max(lateral - globals.params[5].x * 0.5, max(start - shifted, shifted - finish));
      let signedDistance = mix(squareDistance, roundDistance, globals.params[6].x);
      let coverage = 1.0 - smoothstep(-aa, aa, signedDistance);
      let fraction = clamp((shifted - start) / max(span, 0.001), 0.0, 1.0);
      let fade = pow(fraction, exp2((0.5 - globals.params[7].x) * 3.0));
      let pigment = mix(globals.params[9], globals.params[8], fade);
      let alpha = pigment.a * opacity * coverage;
      result = vec4f(pigment.rgb * alpha + result.rgb * (1.0 - alpha), alpha + result.a * (1.0 - alpha));
    }
  }
  return result;
}`;

export const FALLING_STREAKS_EFFECT: EffectDefinition = {
  id: "an-native-owned-ck-falling-streaks",
  name: "Falling Streaks",
  version: 1,
  kind: "generator",
  placements: ["fill"],
  properties: {
    angle: {
      type: "float",
      label: "Travel angle",
      default: 1.57,
      min: -3.14,
      max: 3.14,
      step: 0.01,
    },
    density: {
      type: "int",
      label: "Line density",
      default: 20,
      min: 2,
      max: 60,
      step: 1,
    },
    speed: {
      type: "float",
      label: "Travel speed",
      default: 60,
      min: 0,
      max: 240,
      step: 1,
    },
    speedVariance: {
      type: "float",
      label: "Speed variance",
      default: 0.3,
      min: 0,
      max: 1,
      step: 0.01,
    },
    trailLength: {
      type: "float",
      label: "Trail length",
      default: 1.2,
      min: 0.1,
      max: 2.5,
      step: 0.05,
    },
    width: {
      type: "float",
      label: "Streak width",
      default: 3,
      min: 0.5,
      max: 16,
      step: 0.5,
    },
    rounding: {
      type: "float",
      label: "Lead rounding",
      default: 0.7,
      min: 0,
      max: 1,
      step: 0.01,
    },
    balance: {
      type: "float",
      label: "Color balance",
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
    },
    leadColor: {
      type: "color",
      label: "Lead color",
      default: color([0.83, 0.91, 1]),
    },
    trailColor: {
      type: "color",
      label: "Trail color",
      default: color([0.35, 0.62, 0.96], 0),
    },
    background: {
      type: "color",
      label: "Background color",
      default: color([0.03, 0.06, 0.11], 0),
    },
    opacity: {
      type: "float",
      label: "Opacity",
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
    },
    seed: {
      type: "float",
      label: "Streak seed",
      default: 29,
      min: 0,
      max: 1000,
      step: 1,
    },
  },
  outputs: { color: { kind: "texture-2d", resource: "color" } },
  resources: [
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
      id: "draw-falling-streaks",
      kind: "render",
      reads: [],
      output: "color",
      wgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Seeded finite streaks travel along an editable direction with per-line speed variation, rounded lead geometry, and premultiplied lead-to-tail color fade.",
  },
};

export const FALLING_STREAKS_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-ck-glass-rain",
    name: "Glass Rain",
    definitionId: FALLING_STREAKS_EFFECT.id,
    definitionVersion: 1,
    placement: "fill",
    params: {
      angle: 1.57,
      density: 28,
      speed: 95,
      speedVariance: 0.42,
      trailLength: 1.5,
      width: 2,
      rounding: 1,
      balance: 0.65,
      leadColor: color([0.88, 0.97, 1]),
      trailColor: color([0.22, 0.52, 0.92], 0),
      background: color([0.025, 0.05, 0.09], 0.65),
      opacity: 0.9,
      seed: 29,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-ck-copper-crosswind",
    name: "Copper Crosswind",
    definitionId: FALLING_STREAKS_EFFECT.id,
    definitionVersion: 1,
    placement: "fill",
    params: {
      angle: -0.32,
      density: 10,
      speed: 48,
      speedVariance: 0.8,
      trailLength: 2.1,
      width: 7,
      rounding: 0.15,
      balance: 0.25,
      leadColor: color([1, 0.75, 0.35]),
      trailColor: color([0.73, 0.18, 0.12], 0.2),
      background: color([0.1, 0.035, 0.025], 0.8),
      opacity: 1,
      seed: 407,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
