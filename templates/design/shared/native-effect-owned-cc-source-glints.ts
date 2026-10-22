import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const wgsl = `${NATIVE_RENDER_GLOBALS}
fn hash2(point: vec2f) -> vec2f {
  return fract(sin(vec2f(dot(point, vec2f(127.1, 311.7)), dot(point, vec2f(269.5, 183.3)))) * 43758.5453);
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let source = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let amount = globals.params[6].x;
  if (amount <= 0.0 || source.a <= 0.0) { return source; }
  let cssPoint = input.uv * globals.viewport.xy / globals.clock.z;
  let spacing = globals.params[0].x;
  let cell = floor(cssPoint / spacing);
  let threshold = globals.params[1].x;
  let intensity = globals.params[2].x;
  let rayLength = min(globals.params[3].x, spacing * 0.7);
  let speed = globals.params[4].x;
  let tint = globals.params[5];
  var light = vec3f(0.0);
  for (var iy = -1; iy <= 1; iy = iy + 1) {
    for (var ix = -1; ix <= 1; ix = ix + 1) {
      let index = cell + vec2f(f32(ix), f32(iy));
      let random = hash2(index + globals.clock.yy);
      var anchorCss = (index + vec2f(0.2) + random * 0.6) * spacing;
      var anchor = vec4f(0.0);
      var brightness = 0.0;
      for (var candidate = 0; candidate < 3; candidate = candidate + 1) {
        let offset = hash2(index + vec2f(f32(candidate) * 17.0 + 3.0, f32(candidate) * 11.0 + 7.0));
        let candidateCss = (index + vec2f(0.1) + offset * 0.8) * spacing;
        let candidateUv = candidateCss * globals.clock.z * globals.viewport.zw;
        if (any(candidateUv < vec2f(0.0)) || any(candidateUv > vec2f(1.0))) { continue; }
        let candidateSource = textureSampleLevel(sourceTexture, effectSampler, candidateUv, 0.0);
        let candidateStraight = candidateSource.rgb / max(candidateSource.a, 0.00001);
        let candidateBrightness = dot(max(candidateStraight, vec3f(0.0)), vec3f(0.2126, 0.7152, 0.0722)) * candidateSource.a;
        if (candidateBrightness > brightness) {
          brightness = candidateBrightness;
          anchorCss = candidateCss;
          anchor = candidateSource;
        }
      }
      let straight = anchor.rgb / max(anchor.a, 0.00001);
      let gate = smoothstep(threshold, threshold + 0.16, brightness) * anchor.a;
      let phase = globals.clock.x * speed * (0.65 + random.y * 0.7) + random.x * 6.2831853;
      let twinkle = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(phase), 2.0);
      let delta = abs(cssPoint - anchorCss);
      let core = exp(-dot(delta, delta) / 2.0);
      let horizontal = exp(-delta.y * 2.4) * max(1.0 - delta.x / rayLength, 0.0);
      let vertical = exp(-delta.x * 2.4) * max(1.0 - delta.y / rayLength, 0.0);
      let shape = max(core, max(horizontal, vertical) * 0.65);
      light = light + mix(straight, straight * tint.rgb, tint.a) * gate * twinkle * shape;
    }
  }
  return vec4f(source.rgb + light * intensity * amount * source.a, source.a);
}`;

export const SOURCE_GLINTS_EFFECT: EffectDefinition = {
  id: "an-native-owned-cc-source-glints",
  name: "Source Glints",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    spacing: {
      type: "float",
      label: "Glint spacing",
      default: 42,
      min: 16,
      max: 120,
      step: 1,
    },
    threshold: {
      type: "float",
      label: "Brightness threshold",
      default: 0.68,
      min: 0,
      max: 2,
      step: 0.01,
    },
    intensity: {
      type: "float",
      label: "Glint intensity",
      default: 1.2,
      min: 0,
      max: 4,
      step: 0.01,
    },
    rayLength: {
      type: "float",
      label: "Ray length",
      default: 10,
      min: 2,
      max: 24,
      step: 0.5,
    },
    twinkleSpeed: {
      type: "float",
      label: "Twinkle speed",
      default: 2,
      min: 0,
      max: 8,
      step: 0.1,
    },
    tint: {
      type: "color",
      label: "Glint tint",
      default: { space: "srgb", components: [1, 0.85, 0.55], alpha: 0.35 },
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
      id: "glint-bright-source",
      kind: "render",
      reads: ["source"],
      output: "color",
      wgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Twinkling cell-distributed glints sample their live source anchors for brightness, alpha, and color, with final coverage constrained to the source silhouette.",
  },
};

export const SOURCE_GLINTS_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-cc-fine-spark",
    name: "Fine Spark",
    definitionId: SOURCE_GLINTS_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      spacing: 27,
      threshold: 0.82,
      intensity: 1.5,
      rayLength: 6,
      twinkleSpeed: 3.6,
      tint: { space: "srgb", components: [1, 0.96, 0.82], alpha: 0.15 },
      amount: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-cc-slow-stars",
    name: "Slow Stars",
    definitionId: SOURCE_GLINTS_EFFECT.id,
    definitionVersion: 1,
    placement: "backdrop",
    params: {
      spacing: 62,
      threshold: 0.5,
      intensity: 1.8,
      rayLength: 17,
      twinkleSpeed: 0.8,
      tint: { space: "srgb", components: [0.58, 0.77, 1], alpha: 0.6 },
      amount: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
