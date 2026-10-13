import { catalogColor } from "./native-effect-catalog-kit";
import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const wgsl = `${NATIVE_RENDER_GLOBALS}
fn densityObservation(uv: vec2f) -> vec2f {
  let color = textureSampleLevel(sourceTexture, effectSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
  let straight = select(vec3f(0.0), color.rgb / max(color.a, 0.00001), color.a > 0.00001);
  let luminance = dot(straight, vec3f(0.2126, 0.7152, 0.0722));
  return vec2f(luminance * color.a, color.a);
}

@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let original = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let amount = globals.params[12].x;
  if (amount <= 0.0) { return original; }

  let radiusUv = globals.params[0].x * globals.clock.z * globals.viewport.zw;
  var observations = vec2f(0.0);
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      observations += densityObservation(input.uv + vec2f(f32(x), f32(y)) * radiusUv);
    }
  }
  let density = clamp(observations.x / max(observations.y, 0.00001), 0.0, 1.0);
  let first = smoothstep(globals.params[1].x, globals.params[2].x, density);
  let second = smoothstep(globals.params[2].x, globals.params[3].x, density);
  let third = smoothstep(globals.params[3].x, 1.0, density);
  var palette = mix(globals.params[4], globals.params[5], first);
  palette = mix(palette, globals.params[6], second);
  palette = mix(palette, globals.params[7], third);

  let bands = globals.params[9].x;
  let position = density * bands;
  let contourDistance = min(fract(position), 1.0 - fract(position));
  let antialias = max(fwidth(position), 0.001);
  let line = 1.0 - smoothstep(globals.params[10].x, globals.params[10].x + antialias, contourDistance);
  let contourWeight = line * globals.params[11].x * globals.params[8].a;
  palette = vec4f(mix(palette.rgb, globals.params[8].rgb, contourWeight), palette.a);

  if (original.a <= 0.00001) { return original; }
  let tint = amount * palette.a;
  let straightOriginal = original.rgb / max(original.a, 0.00001);
  let rgb = mix(straightOriginal, palette.rgb, tint) * original.a;
  return vec4f(rgb, original.a);
}`;

export const DENSITY_HEATMAP_V4_EFFECT: EffectDefinition = {
  id: "an-native-owned-p-density-heatmap",
  name: "Image Density Heatmap",
  version: 4,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    radius: {
      type: "float",
      label: "Density radius",
      default: 10,
      min: 0,
      max: 64,
      step: 0.1,
      unit: "px",
    },
    low: {
      type: "float",
      label: "Low density",
      default: 0.12,
      min: 0,
      max: 1,
      step: 0.01,
    },
    middle: {
      type: "float",
      label: "Middle density",
      default: 0.44,
      min: 0,
      max: 1,
      step: 0.01,
    },
    high: {
      type: "float",
      label: "High density",
      default: 0.78,
      min: 0,
      max: 0.99,
      step: 0.01,
    },
    shadow: {
      type: "color",
      label: "Shadow color",
      default: catalogColor(0.04, 0.08, 0.28),
    },
    cool: {
      type: "color",
      label: "Cool color",
      default: catalogColor(0.1, 0.42, 0.8),
    },
    warm: {
      type: "color",
      label: "Warm color",
      default: catalogColor(0.97, 0.67, 0.18),
    },
    hot: {
      type: "color",
      label: "Hot color",
      default: catalogColor(1, 0.18, 0.06),
    },
    contourColor: {
      type: "color",
      label: "Contour color",
      default: catalogColor(0.02, 0.025, 0.09),
    },
    bands: {
      type: "int",
      label: "Contour bands",
      default: 9,
      min: 2,
      max: 32,
      step: 1,
    },
    contourWidth: {
      type: "float",
      label: "Contour width",
      default: 0.065,
      min: 0.005,
      max: 0.25,
      step: 0.005,
    },
    contourStrength: {
      type: "float",
      label: "Contour strength",
      default: 0.55,
      min: 0,
      max: 1,
      step: 0.01,
    },
    amount: {
      type: "float",
      label: "Heatmap amount",
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
    },
  },
  parameterConstraints: [
    { kind: "ordered-floats", lesser: "low", greater: "middle", minGap: 0.001 },
    {
      kind: "ordered-floats",
      lesser: "middle",
      greater: "high",
      minGap: 0.001,
    },
  ],
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
      id: "density-transfer",
      kind: "render",
      reads: ["source"],
      output: "color",
      wgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Alpha-weighted nine-point source density drives a four-stop color transfer and derivative-antialiased density contours while retaining the source alpha.",
  },
};

export const DENSITY_HEATMAP_V4_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-density-v4-infrared-relief",
    name: "Infrared Relief",
    definitionId: DENSITY_HEATMAP_V4_EFFECT.id,
    definitionVersion: 4,
    placement: "layer",
    params: {
      radius: 9,
      low: 0.12,
      middle: 0.44,
      high: 0.78,
      bands: 8,
      contourStrength: 0.32,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-density-v4-topographic-density",
    name: "Topographic Density",
    definitionId: DENSITY_HEATMAP_V4_EFFECT.id,
    definitionVersion: 4,
    placement: "layer",
    params: {
      radius: 4,
      low: 0.08,
      middle: 0.36,
      high: 0.69,
      shadow: catalogColor(0.03, 0.12, 0.15),
      cool: catalogColor(0.08, 0.52, 0.48),
      warm: catalogColor(0.83, 0.88, 0.46),
      hot: catalogColor(0.98, 0.63, 0.18),
      contourColor: catalogColor(0.01, 0.1, 0.11),
      bands: 18,
      contourWidth: 0.035,
      contourStrength: 0.86,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
