import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const wgsl = `${NATIVE_RENDER_GLOBALS}
fn sourceAt(uv: vec2f) -> vec4f {
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return vec4f(0.0); }
  return textureSampleLevel(sourceTexture, effectSampler, uv, 0.0);
}
fn rotate(point: vec2f, angle: f32) -> vec2f {
  let c = cos(angle);
  let s = sin(angle);
  return vec2f(c * point.x - s * point.y, s * point.x + c * point.y);
}
fn displayChannel(linear: f32) -> f32 {
  let value = clamp(linear, 0.0, 1.0);
  if (value <= 0.0031308) { return value * 12.92; }
  return 1.055 * pow(value, 0.4166666666666667) - 0.055;
}
fn mapAt(uv: vec2f) -> vec2f {
  let scale = max(globals.params[3].x, 0.1);
  let angle = globals.params[4].x * 0.017453292519943295;
  let offset = globals.params[5].xy;
  let mapUv = rotate((uv - vec2f(0.5)) / scale, angle) + vec2f(0.5) + offset;
  if (any(mapUv < vec2f(0.0)) || any(mapUv > vec2f(1.0))) { return vec2f(0.0); }
  let map = textureSampleLevel(maskTexture, effectSampler, mapUv, 0.0);
  if (map.a <= 0.00001) { return vec2f(0.0); }
  let straight = map.rgb / map.a;
  let display = vec3f(
    displayChannel(straight.r),
    displayChannel(straight.g),
    displayChannel(straight.b)
  );
  if (globals.params[6].x > 0.5) {
    let luma = dot(display, vec3f(0.2126, 0.7152, 0.0722));
    return vec2f((luma - 0.5) * 2.0 * map.a);
  }
  return (display.rg - vec2f(0.5)) * 2.0 * map.a;
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let source = sourceAt(input.uv);
  let amount = globals.params[0].x;
  if (amount <= 0.0) { return source; }
  let mapVector = mapAt(input.uv);
  let shiftCss = mapVector * vec2f(globals.params[1].x, globals.params[2].x);
  let shiftUv = shiftCss * globals.clock.z * globals.viewport.zw;
  let displaced = sourceAt(input.uv - shiftUv);
  return mix(source, displaced, amount);
}`;

const float = (
  label: string,
  value: number,
  min: number,
  max: number,
  step = 0.01,
) => ({
  type: "float" as const,
  label,
  default: value,
  min,
  max,
  step,
});

export const LAYER_MAP_DISPLACEMENT_EFFECT: EffectDefinition = {
  id: "an-native-owned-ba-layer-map-displacement",
  name: "Layer Map Displacement",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    amount: float("Amount", 1, 0, 1),
    horizontalDisplacement: float(
      "Horizontal displacement",
      32,
      -160,
      160,
      0.5,
    ),
    verticalDisplacement: float("Vertical displacement", 24, -160, 160, 0.5),
    mapScale: float("Map scale", 1, 0.25, 4),
    mapRotation: float("Map rotation", 0, -180, 180, 0.5),
    mapOffset: {
      type: "vec2",
      label: "Map offset",
      default: [0, 0],
      min: -1,
      max: 1,
    },
    mapMode: {
      type: "enum",
      label: "Map channels",
      default: "Red / green",
      options: ["Red / green", "Luminance"],
    },
    mapImage: {
      type: "texture",
      label: "Displacement map",
      default: null,
      input: "map",
    },
  },
  inputs: {
    source: { kind: "texture-2d", resource: "source" },
    map: { kind: "texture-2d", resource: "map" },
  },
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
      name: "map",
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
      usage: ["sampled", "render"],
      size: "viewport",
    },
  ],
  resourceGraph: { abi: "linear-resource-v1" },
  passes: [
    {
      id: "displace-from-map",
      kind: "render",
      reads: ["source", "map"],
      output: "color",
      wgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "An independently bound color map moves actual premultiplied source pixels. Display-encoded middle gray is neutral; red and green or luminance drive X and Y. Transparent map regions and out-of-map bounds are neutral.",
  },
};

export const LAYER_MAP_DISPLACEMENT_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-ba-layer-map-ridge-shift",
    name: "Ridge Shift",
    definitionId: LAYER_MAP_DISPLACEMENT_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      amount: 0.9,
      horizontalDisplacement: 34,
      verticalDisplacement: -18,
      mapScale: 1,
      mapRotation: 0,
      mapOffset: [0, 0],
      mapMode: "Red / green",
    },
    bindings: {
      map: { kind: "asset", url: "/shaders/gate-image-contrast.svg" },
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-ba-layer-map-contour-pull",
    name: "Contour Pull",
    definitionId: LAYER_MAP_DISPLACEMENT_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      amount: 0.72,
      horizontalDisplacement: -24,
      verticalDisplacement: 42,
      mapScale: 1.45,
      mapRotation: 26,
      mapOffset: [0.08, -0.06],
      mapMode: "Luminance",
    },
    bindings: { map: { kind: "asset", url: "/shaders/gate-image.svg" } },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
