import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const wgsl = `${NATIVE_RENDER_GLOBALS}
fn sampleSource(uv: vec2f) -> vec4f {
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return vec4f(0.0); }
  return textureSampleLevel(sourceTexture, effectSampler, uv, 0.0);
}
fn alphaAt(uv: vec2f) -> f32 { return sampleSource(uv).a; }
fn silhouetteNormal(uv: vec2f) -> vec3f {
  let pixel = globals.viewport.zw;
  let edge = vec2f(
    alphaAt(uv + vec2f(pixel.x, 0.0)) - alphaAt(uv - vec2f(pixel.x, 0.0)),
    alphaAt(uv + vec2f(0.0, pixel.y)) - alphaAt(uv - vec2f(0.0, pixel.y))
  );
  return normalize(vec3f(-edge * globals.params[2].x * 2.0, 1.0));
}
fn nearbySilhouette(uv: vec2f) -> f32 {
  let radius = globals.params[6].x * globals.viewport.zw;
  let pixel = globals.viewport.zw;
  let directions = array<vec2f, 8>(
    vec2f(1.0, 0.0), vec2f(-1.0, 0.0), vec2f(0.0, 1.0), vec2f(0.0, -1.0),
    vec2f(0.7071, 0.7071), vec2f(-0.7071, 0.7071),
    vec2f(0.7071, -0.7071), vec2f(-0.7071, -0.7071)
  );
  var nearest = max(max(alphaAt(uv + vec2f(pixel.x, 0.0)), alphaAt(uv - vec2f(pixel.x, 0.0))),
    max(alphaAt(uv + vec2f(0.0, pixel.y)), alphaAt(uv - vec2f(0.0, pixel.y))));
  for (var ring = 1; ring <= 2; ring += 1) {
    let reach = f32(ring) * 0.5;
    for (var direction = 0; direction < 8; direction += 1) {
      nearest = max(nearest, alphaAt(uv + directions[direction] * radius * reach) * (1.0 - reach * 0.35));
    }
  }
  return nearest;
}
fn visibility(uv: vec2f, lightUv: vec2f, receiverHeight: f32) -> f32 {
  var occlusion = 0.0;
  for (var step = 2; step <= 16; step += 1) {
    let progress = f32(step) / 17.0;
    let alpha = alphaAt(mix(uv, lightUv, progress));
    let obstacleHeight = alpha * globals.params[1].x;
    let rayHeight = mix(receiverHeight + 0.02, globals.params[3].x, progress);
    occlusion = max(occlusion, smoothstep(rayHeight - 0.03, rayHeight + 0.03, obstacleHeight) * alpha);
  }
  return 1.0 - occlusion * globals.params[4].x;
}
fn lightAt(uv: vec2f, normal: vec3f, receiverHeight: f32, lightUv: vec2f, power: f32, color: vec3f) -> vec3f {
  if (power <= 0.0) { return vec3f(0.0); }
  let pixelOffset = (lightUv - uv) * globals.viewport.xy / max(min(globals.viewport.x, globals.viewport.y), 1.0);
  let relativeHeight = max(globals.params[3].x - receiverHeight, 0.05);
  let direction = normalize(vec3f(pixelOffset, relativeHeight));
  let attenuation = power / (1.0 + dot(pixelOffset, pixelOffset) * 9.0);
  return color * attenuation * max(dot(normal, direction), 0.0) * visibility(uv, lightUv, receiverHeight);
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let source = sampleSource(input.uv);
  let amount = globals.params[0].x;
  if (amount <= 0.0) { return source; }
  let height = source.a * globals.params[1].x;
  let normal = silhouetteNormal(input.uv);
  let key = lightAt(input.uv, normal, height, vec2f(globals.params[7].x, globals.params[8].x), globals.params[9].x, globals.params[10].rgb);
  let fill = lightAt(input.uv, normal, height, vec2f(globals.params[11].x, globals.params[12].x), globals.params[13].x, globals.params[14].rgb);
  let rim = lightAt(input.uv, normal, height, vec2f(globals.params[15].x, globals.params[16].x), globals.params[17].x, globals.params[18].rgb);
  let illumination = key + fill + rim;
  let shapeRgb = source.rgb * (globals.params[19].x + illumination);
  let nearby = nearbySilhouette(input.uv);
  let spillAlpha = clamp(nearby * globals.params[5].x * dot(illumination, vec3f(0.2126, 0.7152, 0.0722)), 0.0, 0.8);
  let litAlpha = source.a + spillAlpha * (1.0 - source.a);
  let spillRgb = illumination * spillAlpha * (1.0 - source.a);
  let lit = vec4f(shapeRgb + spillRgb, litAlpha);
  return mix(source, lit, amount);
}`;

const float = (label: string, value: number, min: number, max: number) => ({
  type: "float" as const,
  label,
  default: value,
  min,
  max,
  step: 0.01,
});
const color = (label: string, components: [number, number, number]) => ({
  type: "color" as const,
  label,
  default: { space: "srgb" as const, components, alpha: 1 },
});

export const SOURCE_IRRADIANCE_EFFECT: EffectDefinition = {
  id: "an-native-owned-ao-source-irradiance",
  name: "Source Irradiance",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    amount: float("Amount", 0.8, 0, 1),
    shapeHeight: float("Shape height", 0.38, 0.05, 1),
    edgeBevel: float("Edge bevel", 0.8, 0, 2),
    lightElevation: float("Light elevation", 0.75, 0.15, 1.5),
    shadowStrength: float("Shadow strength", 0.65, 0, 1),
    spill: float("Light spill", 0.65, 0, 1.5),
    spillRadius: float("Spill radius", 22, 2, 64),
    keyX: float("Key light X", 0.2, -0.5, 1.5),
    keyY: float("Key light Y", 0.14, -0.5, 1.5),
    keyPower: float("Key light power", 1.35, 0, 3),
    keyColor: color("Key light color", [1, 0.78, 0.59]),
    fillX: float("Fill light X", 0.83, -0.5, 1.5),
    fillY: float("Fill light Y", 0.32, -0.5, 1.5),
    fillPower: float("Fill light power", 0.8, 0, 3),
    fillColor: color("Fill light color", [0.41, 0.72, 1]),
    rimX: float("Rim light X", 0.58, -0.5, 1.5),
    rimY: float("Rim light Y", 0.88, -0.5, 1.5),
    rimPower: float("Rim light power", 0.95, 0, 3),
    rimColor: color("Rim light color", [1, 0.53, 0.73]),
    ambient: float("Ambient light", 0.48, 0, 1.5),
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
  passes: [
    { id: "render", kind: "render", reads: ["source"], output: "color", wgsl },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original three-point silhouette lighting. Source-alpha gradients make normals; bounded alpha-height traces cast shadows; nearby shape samples receive colored spill. Amount zero returns the source exactly.",
  },
};

export const SOURCE_IRRADIANCE_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-owned-ao-warm-gallery",
    name: "Warm Gallery",
    definitionId: SOURCE_IRRADIANCE_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    clip: "bounds",
    params: {
      amount: 0.78,
      shapeHeight: 0.42,
      edgeBevel: 0.72,
      lightElevation: 0.86,
      shadowStrength: 0.58,
      spill: 0.48,
      spillRadius: 18,
      keyX: 0.17,
      keyY: 0.13,
      keyPower: 1.65,
      fillX: 0.85,
      fillY: 0.36,
      fillPower: 0.52,
      rimX: 0.65,
      rimY: 0.9,
      rimPower: 0.65,
      ambient: 0.58,
    },
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-ao-electric-rim",
    name: "Electric Rim",
    definitionId: SOURCE_IRRADIANCE_EFFECT.id,
    definitionVersion: 1,
    placement: "backdrop",
    clip: "bounds",
    params: {
      amount: 0.95,
      shapeHeight: 0.64,
      edgeBevel: 1.42,
      lightElevation: 0.52,
      shadowStrength: 0.9,
      spill: 1.2,
      spillRadius: 38,
      keyX: -0.06,
      keyY: 0.22,
      keyPower: 1.5,
      fillX: 0.56,
      fillY: -0.12,
      fillPower: 0.12,
      rimX: 1.08,
      rimY: 0.8,
      rimPower: 1.95,
      ambient: 0.28,
      keyColor: { space: "srgb", components: [0.1, 0.91, 1], alpha: 1 },
      rimColor: { space: "srgb", components: [1, 0.2, 0.79], alpha: 1 },
    },
    provenance: { origin: "design-original" },
  },
];

export const SOURCE_IRRADIANCE_PRESET_LABEL_SOURCE_IDS: Readonly<
  Record<string, string>
> = Object.fromEntries(
  SOURCE_IRRADIANCE_PRESETS.map((preset) => [preset.id, preset.id]),
);
