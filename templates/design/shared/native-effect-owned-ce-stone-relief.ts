import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const color = (components: [number, number, number]) => ({
  space: "srgb" as const,
  components,
  alpha: 1,
});

const wgsl = `${NATIVE_RENDER_GLOBALS}
fn hash2(point: vec2f) -> vec2f {
  return fract(sin(vec2f(dot(point, vec2f(127.1, 311.7)), dot(point, vec2f(269.5, 183.3)))) * 43758.5453);
}
fn geology(point: vec2f, scale: f32) -> vec3f {
  let tile = floor(point / scale);
  var first = 100000.0;
  var second = 100000.0;
  var mineral = 0.0;
  for (var iy = -1; iy <= 1; iy = iy + 1) {
    for (var ix = -1; ix <= 1; ix = ix + 1) {
      let cell = tile + vec2f(f32(ix), f32(iy));
      let random = hash2(cell);
      let center = (cell + 0.22 + random * 0.56) * scale;
      let distance = length(point - center) / scale;
      if (distance < first) {
        second = first;
        first = distance;
        mineral = random.x;
      } else if (distance < second) {
        second = distance;
      }
    }
  }
  let seam = second - first;
  let facet = first * 0.75 + mineral * 0.18;
  let grains = sin(point.x * 0.91 + sin(point.y * 0.31)) * sin(point.y * 0.84) * 0.06;
  return vec3f(facet + grains, seam, mineral);
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let original = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let amount = globals.params[7].x;
  if (amount <= 0.0) { return original; }
  let cssPoint = input.uv * globals.viewport.xy / globals.clock.z;
  let cellSize = globals.params[0].x;
  let field = geology(cssPoint, cellSize);
  let dx = geology(cssPoint + vec2f(1.0, 0.0), cellSize).x - geology(cssPoint - vec2f(1.0, 0.0), cellSize).x;
  let dy = geology(cssPoint + vec2f(0.0, 1.0), cellSize).x - geology(cssPoint - vec2f(0.0, 1.0), cellSize).x;
  let slope = vec2f(dx, dy) * 0.5;
  let uv = input.uv - slope * globals.params[2].x * globals.clock.z * globals.viewport.zw;
  var source = vec4f(0.0);
  if (all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0))) {
    source = textureSampleLevel(sourceTexture, effectSampler, uv, 0.0);
  }
  let relief = globals.params[1].x;
  let normal = normalize(vec3f(-slope * relief, 1.0));
  let lightAngle = globals.params[5].x;
  let light = normalize(vec3f(cos(lightAngle), sin(lightAngle), 1.1));
  let diffuse = max(dot(normal, light), 0.0);
  let crackWidth = globals.params[3].x;
  let fissure = 1.0 - smoothstep(crackWidth, crackWidth + 0.08, field.y);
  let grain = globals.params[4].x * (field.z - 0.5);
  let stoneTint = globals.params[6];
  let mineralMix = clamp(stoneTint.a * (0.45 + field.z * 0.55), 0.0, 1.0);
  let straight = source.rgb / max(source.a, 0.00001);
  let mineralColor = mix(straight, straight * stoneTint.rgb, mineralMix);
  let shade = max((0.48 + diffuse * 0.7 + grain) * (1.0 - fissure * 0.72), 0.0);
  let processed = vec4f(mineralColor * shade * source.a, source.a);
  return mix(original, processed, amount);
}`;

export const STONE_RELIEF_EFFECT: EffectDefinition = {
  id: "an-native-owned-ce-stone-relief",
  name: "Stone Relief",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    cellSize: {
      type: "float",
      label: "Stone cell size",
      default: 32,
      min: 8,
      max: 100,
      step: 1,
    },
    relief: {
      type: "float",
      label: "Stone relief",
      default: 3,
      min: 0,
      max: 10,
      step: 0.1,
    },
    displacement: {
      type: "float",
      label: "Stone displacement",
      default: 4,
      min: 0,
      max: 16,
      step: 0.1,
    },
    fissureWidth: {
      type: "float",
      label: "Fissure width",
      default: 0.08,
      min: 0,
      max: 0.3,
      step: 0.005,
    },
    grain: {
      type: "float",
      label: "Mineral grain",
      default: 0.2,
      min: 0,
      max: 1,
      step: 0.01,
    },
    lightAngle: {
      type: "float",
      label: "Light angle",
      default: -0.8,
      min: -3.14,
      max: 3.14,
      step: 0.01,
    },
    mineralTint: {
      type: "color",
      label: "Mineral tint",
      default: { space: "srgb", components: [0.8, 0.72, 0.64], alpha: 0.4 },
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
      usage: ["render", "sampled"],
      size: "viewport",
    },
  ],
  resourceGraph: { abi: "linear-resource-v1" },
  passes: [
    {
      id: "shade-source-geology",
      kind: "render",
      reads: ["source"],
      output: "color",
      wgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "A bounded cellular geology field displaces live source RGBA and shades its facets, fissures, and mineral grains; zero amount returns the exact source.",
  },
};

export const STONE_RELIEF_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-ce-sandstone-cut",
    name: "Sandstone Cut",
    definitionId: STONE_RELIEF_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      cellSize: 38,
      relief: 2.6,
      displacement: 2.5,
      fissureWidth: 0.07,
      grain: 0.36,
      lightAngle: -0.8,
      mineralTint: color([0.89, 0.71, 0.53]),
      amount: 0.9,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-ce-slate-facets",
    name: "Slate Facets",
    definitionId: STONE_RELIEF_EFFECT.id,
    definitionVersion: 1,
    placement: "backdrop",
    params: {
      cellSize: 21,
      relief: 6,
      displacement: 6.5,
      fissureWidth: 0.12,
      grain: 0.11,
      lightAngle: 1.2,
      mineralTint: color([0.42, 0.56, 0.67]),
      amount: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
