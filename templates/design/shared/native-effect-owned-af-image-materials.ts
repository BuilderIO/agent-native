import { NATIVE_GRAPH_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const commonWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var imageTexture: texture_2d<f32>;
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};
@vertex fn vs(@builtin(vertex_index) index: u32) -> VertexOutput {
  let xy = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var output: VertexOutput;
  output.position = vec4f(xy[index], 0.0, 1.0);
  output.uv = xy[index] * vec2f(0.5, -0.5) + vec2f(0.5);
  return output;
}
fn hash(p: vec2f) -> f32 {
  let q = fract(p * vec2f(0.1031, 0.11369));
  return fract((q.x + q.y) * (q.x + q.y + 19.19));
}
fn noise(p: vec2f) -> f32 {
  let cell = floor(p);
  let f = fract(p);
  let blend = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(cell), hash(cell + vec2f(1.0, 0.0)), blend.x),
    mix(hash(cell + vec2f(0.0, 1.0)), hash(cell + vec2f(1.0)), blend.x), blend.y);
}
fn fbm(p: vec2f) -> f32 {
  var value = 0.0;
  var weight = 0.5;
  var point = p;
  for (var i = 0; i < 4; i += 1) {
    value += noise(point) * weight;
    point = point * 2.03 + vec2f(13.7, 9.1);
    weight *= 0.5;
  }
  return value;
}
fn imageAt(uv: vec2f) -> vec4f {
  return textureSampleLevel(imageTexture, effectSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
}
fn imageLuma(uv: vec2f) -> f32 {
  let sample = imageAt(uv);
  return dot(sample.rgb, vec3f(0.2126, 0.7152, 0.0722));
}
fn straight(sample: vec4f) -> vec3f {
  return sample.rgb / max(sample.a, 0.00001);
}
`;

const mode = {
  type: "enum" as const,
  label: "Source mode",
  default: "procedural",
  options: ["procedural", "image"],
};
const image = {
  type: "texture",
  label: "Source image",
  default: null,
  input: "image",
  visibleWhen: { property: "mode", equals: "image" },
} as const;
const scalar = (label: string, initial: number, min = 0, max = 1) => ({
  type: "float" as const,
  label,
  default: initial,
  min,
  max,
  step: 0.01,
});
const color = (label: string, components: [number, number, number]) => ({
  type: "color" as const,
  label,
  default: { space: "srgb" as const, components, alpha: 1 },
});

type Material = {
  id: string;
  name: string;
  placements: EffectDefinition["placements"];
  properties: EffectDefinition["properties"];
  fragment: string;
  note: string;
};

const materials: Material[] = [
  {
    id: "an-native-owned-af-gem-smoke-volume",
    name: "Gem Smoke Volume",
    placements: ["fill", "layer"],
    properties: {
      mode,
      image,
      density: scalar("Volume density", 0.72, 0, 2),
      curl: scalar("Smoke curl", 0.55, 0, 2),
      facets: scalar("Facet sharpness", 0.58),
      depth: scalar("Depth", 0.64),
      tint: color("Volume tint", [0.45, 0.68, 0.97]),
    },
    fragment: `
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let curl = globals.params[2].x;
  let moving = uv * (3.0 + curl * 3.0) + vec2f(globals.clock.x * 0.07, -globals.clock.x * 0.09);
  let smoke = fbm(moving + vec2f(fbm(moving + 8.0) * curl));
  var pigment = smoke;
  var coverage = 1.0;
  if (globals.params[0].x > 0.5) {
    let source = imageAt(uv);
    let warped = imageAt(uv + vec2f(smoke - 0.5, fbm(moving + 17.0) - 0.5) * curl * 0.035);
    pigment = dot(straight(warped), vec3f(0.2126, 0.7152, 0.0722)) * warped.a;
    coverage = source.a;
  }
  let facet = pow(max(0.0, sin((uv.x + uv.y * 0.63 + smoke * 0.2) * 24.0)), 2.0 + globals.params[3].x * 10.0);
  let opticalDepth = globals.params[1].x * (pigment * 1.5 + facet * globals.params[4].x * 0.42);
  let alpha = (1.0 - exp(-opticalDepth)) * coverage;
  let glint = facet * globals.params[4].x * 0.65;
  let rgb = mix(globals.params[5].rgb * (0.42 + pigment * 0.72), vec3f(1.0), glint);
  return vec4f(rgb * alpha, alpha);
}`,
    note: "Ray attenuation across a noisy volume and angled facet glints. Image mode uses selected pixels to drive local optical density; procedural mode synthesizes the density field.",
  },
  {
    id: "an-native-owned-af-heat-tint",
    name: "Heat Tint",
    placements: ["fill", "layer", "backdrop"],
    properties: {
      mode,
      image,
      temperature: scalar("Temperature", 0.62),
      contrast: scalar("Thermal contrast", 0.68, 0, 2),
      turbulence: scalar("Turbulence", 0.46),
      speed: scalar("Drift speed", 0.4, 0, 3),
      coolTint: color("Cool tint", [0.11, 0.17, 0.54]),
      hotTint: color("Hot tint", [1, 0.42, 0.05]),
    },
    fragment: `
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let flow = fbm(uv * 5.0 + vec2f(0.0, globals.clock.x * globals.params[5].x * 0.3));
  var thermal = 0.5 + (flow - 0.5) * globals.params[4].x + (0.5 - uv.y) * 0.3;
  var alpha = 1.0;
  if (globals.params[0].x > 0.5) {
    let source = imageAt(uv);
    thermal = dot(straight(source), vec3f(0.2126, 0.7152, 0.0722));
    thermal += (flow - 0.5) * globals.params[4].x * 0.25;
    alpha = source.a;
  }
  let normalized = clamp((thermal - 0.5) * globals.params[3].x + globals.params[2].x, 0.0, 1.0);
  let ember = smoothstep(0.72, 1.0, normalized);
  var rgb = mix(globals.params[6].rgb, globals.params[7].rgb, smoothstep(0.12, 0.85, normalized));
  rgb = mix(rgb, vec3f(1.0, 0.88, 0.58), ember * 0.72);
  return vec4f(rgb * alpha, alpha);
}`,
    note: "A thermal transfer function maps intensity to cool, hot, and ember colors. Image mode uses selected pixel luminance as the heat field, including genuine black and transparent pixels.",
  },
  {
    id: "an-native-owned-af-polished-metal",
    name: "Polished Metal",
    placements: ["fill", "layer"],
    properties: {
      mode,
      image,
      roughness: scalar("Roughness", 0.3),
      brush: scalar("Brushed grain", 0.52),
      relief: scalar("Surface relief", 0.57),
      lightAngle: scalar("Light angle", 0.28),
      metalTint: color("Metal tint", [0.76, 0.83, 0.89]),
    },
    fragment: `
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let pixel = 1.0 / max(globals.viewport.xy, vec2f(1.0));
  var h = fbm(vec2f(uv.x * 19.0, uv.y * (110.0 + globals.params[3].x * 230.0)));
  var dx = fbm(vec2f((uv.x + pixel.x) * 19.0, uv.y * 160.0)) - fbm(vec2f((uv.x - pixel.x) * 19.0, uv.y * 160.0));
  var dy = fbm(vec2f(uv.x * 19.0, (uv.y + pixel.y) * 160.0)) - fbm(vec2f(uv.x * 19.0, (uv.y - pixel.y) * 160.0));
  var albedo = globals.params[6].rgb;
  var alpha = 1.0;
  if (globals.params[0].x > 0.5) {
    let source = imageAt(uv);
    h = imageLuma(uv);
    dx = imageLuma(uv + vec2f(pixel.x, 0.0)) - imageLuma(uv - vec2f(pixel.x, 0.0));
    dy = imageLuma(uv + vec2f(0.0, pixel.y)) - imageLuma(uv - vec2f(0.0, pixel.y));
    albedo *= mix(vec3f(0.45), straight(source), 0.72);
    alpha = source.a;
  }
  let normal = normalize(vec3f(-dx * globals.params[4].x * 13.0, -dy * globals.params[4].x * 13.0, 1.0));
  let angle = globals.params[5].x * 6.2831853;
  let light = normalize(vec3f(cos(angle), sin(angle), 0.9));
  let diffuse = 0.18 + 0.52 * max(dot(normal, light), 0.0);
  let reflected = reflect(-light, normal);
  let highlight = pow(max(reflected.z, 0.0), mix(96.0, 5.0, globals.params[2].x));
  let anisotropy = 0.72 + 0.28 * sin(uv.y * 620.0 + h * 12.0) * globals.params[3].x;
  let rgb = albedo * diffuse * anisotropy + vec3f(highlight * (0.3 + h * 0.4));
  return vec4f(rgb * alpha, alpha);
}`,
    note: "A directional reflection model turns selected image luminance gradients into micro normals and selected color into metal albedo; procedural mode grows brushed relief.",
  },
  {
    id: "an-native-owned-af-water-refraction",
    name: "Water Refraction",
    placements: ["fill", "layer", "backdrop"],
    properties: {
      mode,
      image,
      waveScale: scalar("Wave scale", 0.48),
      refraction: scalar("Refraction", 0.56),
      flow: scalar("Flow", 0.44, 0, 2),
      caustics: scalar("Caustics", 0.46),
      waterTint: color("Water tint", [0.22, 0.68, 0.79]),
    },
    fragment: `
fn waterHeight(uv: vec2f) -> f32 {
  let scale = 5.0 + globals.params[2].x * 26.0;
  let time = globals.clock.x * globals.params[4].x;
  return sin(uv.x * scale + time * 0.9) * 0.35 + sin((uv.x + uv.y) * scale * 0.72 - time * 1.3) * 0.28 + fbm(uv * scale * 0.35 + vec2f(time * 0.12)) * 0.37;
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let pixel = 1.0 / max(globals.viewport.xy, vec2f(1.0));
  let slope = vec2f(
    waterHeight(uv + vec2f(pixel.x, 0.0)) - waterHeight(uv - vec2f(pixel.x, 0.0)),
    waterHeight(uv + vec2f(0.0, pixel.y)) - waterHeight(uv - vec2f(0.0, pixel.y))
  );
  var base = globals.params[6].rgb * (0.55 + waterHeight(uv) * 0.3);
  var alpha = 1.0;
  if (globals.params[0].x > 0.5) {
    let offset = slope * globals.params[3].x * 0.09;
    let refracted = imageAt(uv + offset);
    let gradient = vec2f(
      imageLuma(uv + vec2f(pixel.x, 0.0)) - imageLuma(uv - vec2f(pixel.x, 0.0)),
      imageLuma(uv + vec2f(0.0, pixel.y)) - imageLuma(uv - vec2f(0.0, pixel.y))
    );
    base = mix(straight(refracted), globals.params[6].rgb, 0.18) * (0.85 + length(gradient) * globals.params[3].x);
    alpha = refracted.a;
  }
  let caustic = pow(max(0.0, 1.0 - abs(waterHeight(uv) * 2.0)), 5.0) * globals.params[5].x;
  let rgb = base + vec3f(0.48, 0.78, 0.91) * caustic;
  return vec4f(rgb * alpha, alpha);
}`,
    note: "A moving wave height field refracts selected image pixels and responds to their gradients; procedural mode makes tinted water and caustic bands.",
  },
];

export const AF_IMAGE_MATERIAL_DEFINITIONS: readonly EffectDefinition[] =
  materials.map((material) => ({
    id: material.id,
    name: material.name,
    version: 1,
    kind: "generator",
    placements: material.placements,
    properties: material.properties,
    inputs: {
      image: {
        kind: "texture-2d",
        resource: "image",
        fallback: "transparent-data",
        enabledWhen: { property: "mode", equals: "image" },
      },
    },
    outputs: { color: { kind: "texture-2d", resource: "color" } },
    resources: [
      {
        name: "image",
        kind: "texture-2d",
        external: true,
        usage: ["sampled"],
        size: "viewport",
        sampleEncoding: "srgb-color-premultiplied",
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
        id: "render",
        kind: "render",
        reads: ["image"],
        output: "color",
        wgsl: commonWgsl + material.fragment,
      },
    ],
    output: "color",
    provenance: { origin: "design-original", note: material.note },
  })) as EffectDefinition[];

const looks: readonly (readonly [string, string, Record<string, number>])[] = [
  [
    "gem-smoke-volume",
    "Blue Quartz",
    { density: 0.72, curl: 0.55, facets: 0.58, depth: 0.64 },
  ],
  [
    "gem-smoke-volume",
    "Deep Vapor",
    { density: 1.35, curl: 1.2, facets: 0.18, depth: 0.9 },
  ],
  [
    "heat-tint",
    "Solar Flare",
    { temperature: 0.78, contrast: 1.2, turbulence: 0.65, speed: 0.8 },
  ],
  [
    "heat-tint",
    "Blue Furnace",
    { temperature: 0.31, contrast: 1.55, turbulence: 0.3, speed: 0.2 },
  ],
  [
    "polished-metal",
    "Chrome",
    { roughness: 0.12, brush: 0.14, relief: 0.74, lightAngle: 0.28 },
  ],
  [
    "polished-metal",
    "Brushed Steel",
    { roughness: 0.57, brush: 0.89, relief: 0.34, lightAngle: 0.72 },
  ],
  [
    "water-refraction",
    "Sunlit Pool",
    { waveScale: 0.62, refraction: 0.65, flow: 0.5, caustics: 0.78 },
  ],
  [
    "water-refraction",
    "Quiet Current",
    { waveScale: 0.2, refraction: 0.27, flow: 0.22, caustics: 0.18 },
  ],
];

export const AF_IMAGE_MATERIAL_PRESETS: readonly EffectPreset[] = looks.map(
  ([slug, name, params], index) => ({
    id: `an-preset-owned-af-${slug}-${index % 2 === 0 ? "a" : "b"}`,
    name,
    definitionId: `an-native-owned-af-${slug}`,
    definitionVersion: 1,
    placement: "fill",
    params: { mode: "procedural", ...params },
    clip: "bounds",
    provenance: { origin: "design-original" },
  }),
);

export const AF_IMAGE_MATERIAL_PRESET_LABEL_SOURCE_IDS: Readonly<
  Record<string, string>
> = Object.fromEntries(
  AF_IMAGE_MATERIAL_PRESETS.map((preset) => [preset.id, preset.id]),
);
