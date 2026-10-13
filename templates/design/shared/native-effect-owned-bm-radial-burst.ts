import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const color = (
  label: string,
  components: [number, number, number],
  alpha = 1,
) => ({
  type: "color" as const,
  label,
  default: { space: "srgb" as const, components, alpha },
});
const scalar = (label: string, value: number, min: number, max: number) => ({
  type: "float" as const,
  label,
  default: value,
  min,
  max,
  step: 0.01,
});

const wgsl = `${NATIVE_RENDER_GLOBALS}
fn painted(color: vec4f, coverage: f32) -> vec4f {
  let alpha = color.a * clamp(coverage, 0.0, 1.0);
  return vec4f(color.rgb * alpha, alpha);
}
fn over(foreground: vec4f, background: vec4f) -> vec4f {
  return vec4f(foreground.rgb + background.rgb * (1.0 - foreground.a), foreground.a + background.a * (1.0 - foreground.a));
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let center = globals.params[0].xy;
  let point = (input.uv - center) * globals.viewport.xy;
  let radius = length(point) / max(min(globals.viewport.x, globals.viewport.y), 1.0);
  let inner = globals.params[3].x;
  let outer = max(globals.params[4].x, inner + 0.001);
  let gradient = smoothstep(inner, outer, radius);
  let baseColor = mix(globals.params[8], globals.params[9], gradient);
  let edge = max(globals.clock.z / max(min(globals.viewport.x, globals.viewport.y), 1.0), 0.001);
  let disk = 1.0 - smoothstep(outer - edge, outer + edge, radius);
  let angle = atan2(point.y, point.x) + globals.params[5].x * 0.017453292519943295;
  let rays = pow(max(cos(angle * globals.params[1].x), 0.0), globals.params[2].x);
  let start = smoothstep(inner, inner + max(edge, 0.001), radius);
  let decay = pow(max(1.0 - gradient, 0.0), globals.params[7].x);
  let rayCoverage = rays * start * decay * globals.params[6].x * disk;
  let body = painted(baseColor, disk);
  let light = painted(globals.params[10], rayCoverage);
  return over(light, over(body, painted(globals.params[11], 1.0)));
}`;

export const RADIAL_BURST_EFFECT: EffectDefinition = {
  id: "an-native-owned-bm-radial-burst",
  name: "Radial Burst",
  version: 1,
  kind: "generator",
  placements: ["fill"],
  properties: {
    center: {
      type: "vec2",
      label: "Burst center",
      default: [0.5, 0.5],
      min: 0,
      max: 1,
    },
    rayCount: {
      type: "int",
      label: "Ray count",
      default: 18,
      min: 3,
      max: 128,
      step: 1,
    },
    sharpness: scalar("Ray sharpness", 10, 1, 40),
    innerRadius: scalar("Inner radius", 0.05, 0, 0.8),
    outerRadius: scalar("Outer radius", 0.68, 0.05, 1.5),
    rotation: scalar("Rotation", 0, -180, 180),
    rayStrength: scalar("Ray strength", 0.88, 0, 1),
    rayFalloff: scalar("Ray falloff", 1.4, 0.1, 8),
    coreColor: color("Core color", [1, 0.83, 0.32]),
    rimColor: color("Rim color", [0.65, 0.18, 0.09]),
    rayColor: color("Ray color", [1, 0.97, 0.7], 0.85),
    backgroundColor: color("Background", [0.025, 0.03, 0.09]),
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
    { id: "render-rays", kind: "render", reads: [], output: "color", wgsl },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "An aspect-correct polar ray envelope overlays a center-to-rim gradient. Center, count, sharpness, radius, rotation, strength, falloff, and all four colors control the rendered image.",
  },
};

export const RADIAL_BURST_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-bm-amber-sunburst",
    name: "Amber Sunburst",
    definitionId: RADIAL_BURST_EFFECT.id,
    definitionVersion: 1,
    placement: "fill",
    params: {
      rayCount: 24,
      sharpness: 12,
      innerRadius: 0.04,
      outerRadius: 0.7,
      rayStrength: 0.95,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-bm-blue-corona",
    name: "Blue Corona",
    definitionId: RADIAL_BURST_EFFECT.id,
    definitionVersion: 1,
    placement: "fill",
    params: {
      center: [0.46, 0.53],
      rayCount: 36,
      sharpness: 18,
      innerRadius: 0.08,
      outerRadius: 0.58,
      rotation: 8,
      rayStrength: 0.82,
      rayFalloff: 0.65,
      coreColor: { space: "srgb", components: [0.29, 0.78, 1], alpha: 1 },
      rimColor: { space: "srgb", components: [0.08, 0.12, 0.45], alpha: 1 },
      rayColor: { space: "srgb", components: [0.52, 0.92, 1], alpha: 0.8 },
      backgroundColor: {
        space: "srgb",
        components: [0.015, 0.015, 0.06],
        alpha: 1,
      },
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
