import {
  FLOWING_SHAPE_CHROME_EFFECT,
  FLOWING_SHAPE_CHROME_PRESETS,
} from "./native-effect-owned-bd-flowing-shape-chrome";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const baseRender = FLOWING_SHAPE_CHROME_EFFECT.passes.find(
  (pass) => pass.id === "shade-chrome",
);
if (!baseRender)
  throw new Error("The pinned shape chrome render pass is missing.");

function replaceExact(source: string, before: string, after: string): string {
  const first = source.indexOf(before);
  if (first < 0 || source.lastIndexOf(before) !== first)
    throw new Error("The pinned shape chrome shader contract changed.");
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const roughReflectionV1 = `fn roughReflection(direction: vec3f, roughness: f32) -> vec3f {
  let sharp = studio(direction);
  let blur = (studio(normalize(direction + vec3f(roughness, 0.0, 0.0)))
    + studio(normalize(direction - vec3f(roughness, 0.0, 0.0)))
    + studio(normalize(direction + vec3f(0.0, roughness, 0.0)))
    + studio(normalize(direction - vec3f(0.0, roughness, 0.0)))) * 0.25;
  return mix(sharp, blur, roughness);
}`;

const reflectedImageLighting = `fn environmentAt(direction: vec3f) -> vec3f {
  if (globals.params[15].x < 0.5) { return studio(direction); }
  let azimuth = atan2(direction.z, direction.x) + globals.params[11].x;
  let uv = vec2f(fract(azimuth / 6.283185307179586 + 0.5),
    acos(clamp(direction.y, -1.0, 1.0)) / 3.141592653589793);
  let reflected = textureSampleLevel(environmentTexture, effectSampler, uv, 0.0);
  return reflected.rgb * globals.params[12].x;
}
fn roughReflection(direction: vec3f, roughness: f32) -> vec3f {
  let sharp = environmentAt(direction);
  let positiveX = direction + vec3f(roughness, 0.0, 0.0);
  let negativeX = direction - vec3f(roughness, 0.0, 0.0);
  let positiveY = direction + vec3f(0.0, roughness, 0.0);
  let negativeY = direction - vec3f(0.0, roughness, 0.0);
  let blur = (environmentAt(select(direction, positiveX / max(length(positiveX), 0.00001), length(positiveX) > 0.00001))
    + environmentAt(select(direction, negativeX / max(length(negativeX), 0.00001), length(negativeX) > 0.00001))
    + environmentAt(select(direction, positiveY / max(length(positiveY), 0.00001), length(positiveY) > 0.00001))
    + environmentAt(select(direction, negativeY / max(length(negativeY), 0.00001), length(negativeY) > 0.00001))) * 0.25;
  return mix(sharp, blur, roughness);
}`;

const renderWgsl = replaceExact(
  replaceExact(
    baseRender.wgsl,
    "@group(0) @binding(3) var nearestBoundary: texture_2d<f32>;",
    "@group(0) @binding(3) var nearestBoundary: texture_2d<f32>;\n@group(0) @binding(4) var environmentTexture: texture_2d<f32>;",
  ),
  roughReflectionV1,
  reflectedImageLighting,
);

export const FLOWING_SHAPE_CHROME_V2_EFFECT: EffectDefinition = {
  ...FLOWING_SHAPE_CHROME_EFFECT,
  version: 2,
  properties: {
    ...FLOWING_SHAPE_CHROME_EFFECT.properties,
    environmentMode: {
      type: "enum",
      label: "Reflection source",
      default: "studio",
      options: ["studio", "image"],
    },
    environmentImage: {
      type: "texture",
      label: "Environment image",
      default: null,
      input: "environment",
    },
  },
  inputs: {
    ...FLOWING_SHAPE_CHROME_EFFECT.inputs,
    environment: {
      kind: "texture-2d",
      resource: "environment",
      enabledWhen: { property: "environmentMode", equals: "image" },
      fallback: "transparent-data",
    },
  },
  resources: [
    ...FLOWING_SHAPE_CHROME_EFFECT.resources!.filter(
      (resource) => resource.name !== "color",
    ),
    {
      name: "environment",
      kind: "texture-2d",
      external: true,
      usage: ["sampled"],
      size: "viewport",
      sampleEncoding: "srgb-color-premultiplied",
    },
    FLOWING_SHAPE_CHROME_EFFECT.resources!.find(
      (resource) => resource.name === "color",
    )!,
  ],
  passes: FLOWING_SHAPE_CHROME_EFFECT.passes.map((pass) =>
    pass.id === "shade-chrome"
      ? {
          ...pass,
          reads: ["source", "nearest", "environment"],
          wgsl: renderWgsl,
        }
      : pass,
  ),
  provenance: {
    origin: "design-original",
    note: "Source-alpha signed-distance extrusion reflects either a procedural studio or an explicitly bound environment image through animated shape normals.",
  },
};

const studioPreset = FLOWING_SHAPE_CHROME_PRESETS[0];
const mappedPreset = FLOWING_SHAPE_CHROME_PRESETS[1];
if (!studioPreset || !mappedPreset)
  throw new Error("The pinned shape chrome presets are missing.");

export const FLOWING_SHAPE_CHROME_V2_PRESETS: readonly EffectPreset[] = [
  {
    ...structuredClone(studioPreset),
    id: "an-preset-bd-v2-studio-silver",
    name: "Studio Silver",
    definitionVersion: 2,
    params: { ...studioPreset.params, environmentMode: "studio" },
  },
  {
    ...structuredClone(mappedPreset),
    id: "an-preset-bd-v2-reflected-aurora",
    name: "Reflected Aurora",
    definitionVersion: 2,
    params: {
      ...mappedPreset.params,
      environmentMode: "image",
      studioIntensity: 1.6,
      roughness: 0.17,
    },
    bindings: {
      environment: {
        kind: "asset",
        url: "/shaders/gate-image-contrast.svg",
      },
    },
  },
];

export const FLOWING_SHAPE_CHROME_V2_PRESET_LABEL_SOURCE_IDS: Readonly<
  Record<string, string>
> = Object.fromEntries(
  FLOWING_SHAPE_CHROME_V2_PRESETS.map((preset) => [preset.id, preset.id]),
);
