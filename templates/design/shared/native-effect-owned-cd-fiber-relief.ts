import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const wgsl = `${NATIVE_RENDER_GLOBALS}
fn fiberHeight(point: vec2f, scale: f32) -> f32 {
  let warp = point.x / scale;
  let weft = point.y / scale;
  let warpThread = pow(max(cos(warp * 3.14159265), 0.0), 2.0);
  let weftThread = pow(max(cos(weft * 3.14159265), 0.0), 2.0);
  let parity = fract((floor(warp + 0.5) + floor(weft + 0.5)) * 0.5);
  let cross = select(-1.0, 1.0, parity < 0.5);
  let fiber = sin(point.x * 2.9 + sin(point.y * 0.17)) * 0.06;
  return 0.5 * (warpThread + weftThread) + cross * (warpThread - weftThread) * 0.22 + fiber;
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let original = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let amount = globals.params[6].x;
  if (amount <= 0.0) { return original; }
  let cssPoint = input.uv * globals.viewport.xy / globals.clock.z;
  let angle = globals.params[0].x;
  let axis = vec2f(cos(angle), sin(angle));
  let rotated = vec2f(dot(cssPoint, axis), dot(cssPoint, vec2f(-axis.y, axis.x)));
  let scale = globals.params[1].x;
  let height = fiberHeight(rotated, scale);
  let slope = vec2f(fiberHeight(rotated + vec2f(1.0, 0.0), scale) - fiberHeight(rotated - vec2f(1.0, 0.0), scale), fiberHeight(rotated + vec2f(0.0, 1.0), scale) - fiberHeight(rotated - vec2f(0.0, 1.0), scale)) * 0.5;
  let rotatedSlope = vec2f(dot(slope, vec2f(axis.x, -axis.y)), dot(slope, vec2f(axis.y, axis.x)));
  let displacedUv = input.uv - rotatedSlope * globals.params[3].x * globals.clock.z * globals.viewport.zw;
  let inBounds = all(displacedUv >= vec2f(0.0)) && all(displacedUv <= vec2f(1.0));
  var sampled = vec4f(0.0);
  if (inBounds) { sampled = textureSampleLevel(sourceTexture, effectSampler, displacedUv, 0.0); }
  let relief = globals.params[2].x;
  let normal = normalize(vec3f(-rotatedSlope * relief, 1.0));
  let lightAngle = globals.params[4].x;
  let light = normalize(vec3f(cos(lightAngle), sin(lightAngle), 1.2));
  let diffuse = max(dot(normal, light), 0.0);
  let sheen = pow(max(dot(reflect(-light, normal), vec3f(0.0, 0.0, 1.0)), 0.0), 16.0) * globals.params[5].x;
  let shade = 0.62 + diffuse * 0.53 + height * 0.12 + sheen;
  let processed = vec4f(sampled.rgb * shade, sampled.a);
  return mix(original, processed, amount);
}`;

export const FIBER_RELIEF_EFFECT: EffectDefinition = {
  id: "an-native-owned-cd-fiber-relief",
  name: "Fiber Relief",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    direction: {
      type: "float",
      label: "Fiber direction",
      default: 0.45,
      min: -3.14,
      max: 3.14,
      step: 0.01,
    },
    threadScale: {
      type: "float",
      label: "Thread scale",
      default: 7,
      min: 2,
      max: 24,
      step: 0.5,
    },
    relief: {
      type: "float",
      label: "Thread relief",
      default: 1.5,
      min: 0,
      max: 5,
      step: 0.05,
    },
    displacement: {
      type: "float",
      label: "Fiber displacement",
      default: 2,
      min: 0,
      max: 12,
      step: 0.1,
    },
    lightAngle: {
      type: "float",
      label: "Light angle",
      default: -0.7,
      min: -3.14,
      max: 3.14,
      step: 0.01,
    },
    sheen: {
      type: "float",
      label: "Fiber sheen",
      default: 0.35,
      min: 0,
      max: 2,
      step: 0.01,
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
      id: "shade-displaced-fibers",
      kind: "render",
      reads: ["source"],
      output: "color",
      wgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "An interlaced warp-and-weft height field displaces and shades actual source RGBA in CSS-pixel units; the source is returned exactly at zero amount.",
  },
};

export const FIBER_RELIEF_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-cd-soft-linen",
    name: "Soft Linen",
    definitionId: FIBER_RELIEF_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      direction: 0.2,
      threadScale: 8,
      relief: 1.1,
      displacement: 1.2,
      lightAngle: -0.9,
      sheen: 0.2,
      amount: 0.88,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-cd-satin-weave",
    name: "Satin Weave",
    definitionId: FIBER_RELIEF_EFFECT.id,
    definitionVersion: 1,
    placement: "backdrop",
    params: {
      direction: 1.1,
      threadScale: 4,
      relief: 2.5,
      displacement: 3.5,
      lightAngle: 0.5,
      sheen: 1.4,
      amount: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
