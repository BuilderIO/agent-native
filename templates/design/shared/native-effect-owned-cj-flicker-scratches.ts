import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const color = (components: [number, number, number], alpha = 1) => ({
  space: "srgb" as const,
  components,
  alpha,
});

const wgsl = `${NATIVE_RENDER_GLOBALS}
fn scratchHash(point: vec2f) -> f32 {
  return fract(sin(dot(point, vec2f(127.1, 311.7)) + globals.clock.y * 19.19) * 43758.5453);
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let cssPoint = input.uv * globals.viewport.xy / globals.clock.z;
  let angle = globals.params[3].x;
  let tangent = vec2f(cos(angle), sin(angle));
  let normal = vec2f(-tangent.y, tangent.x);
  let along = dot(cssPoint, tangent);
  let across = dot(cssPoint, normal);
  let spacing = globals.params[0].x;
  let lengthBase = globals.params[1].x;
  let period = lengthBase * 1.8;
  let row = floor(across / spacing);
  let column = floor(along / period);
  let aa = max(0.5 / globals.clock.z, 0.1);
  var scratch = 0.0;
  for (var iy = -1; iy <= 1; iy += 1) {
    for (var ix = -1; ix <= 1; ix += 1) {
      let cell = vec2f(column + f32(ix), row + f32(iy));
      let chance = scratchHash(cell + vec2f(globals.params[7].x, 0.0));
      if (chance > globals.params[4].x) { continue; }
      let centerAcross = (cell.y + 0.17 + scratchHash(cell + 17.0) * 0.66) * spacing;
      let span = lengthBase * (0.35 + scratchHash(cell + 31.0) * 0.65);
      let startAlong = cell.x * period + scratchHash(cell + 43.0) * (period - span);
      let nearestAlong = clamp(along, startAlong, startAlong + span);
      let distance = length(vec2f(along - nearestAlong, across - centerAcross));
      let coverage = 1.0 - smoothstep(max(globals.params[2].x * 0.5 - aa, 0.0), globals.params[2].x * 0.5 + aa, distance);
      let cadence = globals.params[6].x * (0.55 + scratchHash(cell + 59.0));
      let tick = floor(globals.clock.x * cadence);
      let on = scratchHash(cell + vec2f(tick * 3.0 + 71.0, tick * 7.0));
      let flicker = mix(1.0, 0.12 + on * 0.88, globals.params[5].x);
      scratch = max(scratch, coverage * flicker);
    }
  }
  let background = globals.params[8];
  let filament = globals.params[9];
  let opacity = globals.params[10].x;
  let base = vec4f(background.rgb * background.a * opacity, background.a * opacity);
  let thread = vec4f(filament.rgb * filament.a * opacity, filament.a * opacity);
  return mix(base, thread, scratch);
}`;

export const FLICKER_SCRATCHES_EFFECT: EffectDefinition = {
  id: "an-native-owned-cj-flicker-scratches",
  name: "Flicker Scratches",
  version: 1,
  kind: "generator",
  placements: ["fill"],
  properties: {
    spacing: {
      type: "float",
      label: "Scratch spacing",
      default: 14,
      min: 4,
      max: 60,
      step: 1,
    },
    length: {
      type: "float",
      label: "Scratch length",
      default: 80,
      min: 12,
      max: 240,
      step: 1,
    },
    width: {
      type: "float",
      label: "Scratch width",
      default: 1.2,
      min: 0.3,
      max: 8,
      step: 0.1,
    },
    angle: {
      type: "float",
      label: "Scratch direction",
      default: 1.45,
      min: -3.14,
      max: 3.14,
      step: 0.01,
    },
    density: {
      type: "float",
      label: "Scratch density",
      default: 0.42,
      min: 0,
      max: 1,
      step: 0.01,
    },
    flicker: {
      type: "float",
      label: "Flicker",
      default: 0.65,
      min: 0,
      max: 1,
      step: 0.01,
    },
    speed: {
      type: "float",
      label: "Flicker speed",
      default: 4,
      min: 0,
      max: 20,
      step: 0.1,
    },
    seed: {
      type: "float",
      label: "Scratch seed",
      default: 17,
      min: 0,
      max: 1000,
      step: 1,
    },
    background: {
      type: "color",
      label: "Background color",
      default: color([0.035, 0.045, 0.06]),
    },
    scratchColor: {
      type: "color",
      label: "Scratch color",
      default: color([0.89, 0.9, 0.83]),
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
      usage: ["render", "sampled"],
      size: "viewport",
    },
  ],
  resourceGraph: { abi: "linear-resource-v1" },
  passes: [
    {
      id: "draw-flickering-hairlines",
      kind: "render",
      reads: [],
      output: "color",
      wgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Seeded finite hairlines flicker in place without drifting. CSS-pixel segment geometry, bounded nine-cell search, and premultiplied two-color output distinguish them from tracking bands.",
  },
};

export const FLICKER_SCRATCHES_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-cj-fine-film",
    name: "Fine Film",
    definitionId: FLICKER_SCRATCHES_EFFECT.id,
    definitionVersion: 1,
    placement: "fill",
    params: {
      spacing: 9,
      length: 110,
      width: 0.65,
      angle: 1.5,
      density: 0.3,
      flicker: 0.9,
      speed: 7,
      seed: 17,
      background: color([0.035, 0.045, 0.06]),
      scratchColor: color([0.83, 0.85, 0.79]),
      opacity: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-cj-angled-scars",
    name: "Angled Scars",
    definitionId: FLICKER_SCRATCHES_EFFECT.id,
    definitionVersion: 1,
    placement: "fill",
    params: {
      spacing: 27,
      length: 55,
      width: 2.8,
      angle: 0.65,
      density: 0.78,
      flicker: 0.25,
      speed: 2,
      seed: 311,
      background: color([0.12, 0.09, 0.08]),
      scratchColor: color([1, 0.67, 0.38]),
      opacity: 0.92,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
