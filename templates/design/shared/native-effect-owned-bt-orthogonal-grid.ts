import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const color = (components: [number, number, number], alpha = 1) => ({
  space: "srgb" as const,
  components,
  alpha,
});

const gridWgsl = `${NATIVE_RENDER_GLOBALS}
fn coverage(distance: f32, width: f32, feather: f32) -> f32 {
  return 1.0 - smoothstep(max(width * 0.5 - feather, 0.0), width * 0.5 + feather, distance);
}
fn over(front: vec4f, back: vec4f) -> vec4f {
  return vec4f(front.rgb + back.rgb * (1.0 - front.a), front.a + back.a * (1.0 - front.a));
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let pixelRatio = max(globals.clock.z, 0.01);
  let cssSize = globals.viewport.xy / pixelRatio;
  let center = globals.params[0].xy * cssSize;
  let motion = globals.params[6].x * vec2f(1.0, 0.0) + globals.params[7].x * vec2f(0.0, 1.0);
  let point = input.uv * cssSize - center - motion * globals.clock.x;
  let angle = globals.params[5].x;
  let rotated = vec2f(cos(angle) * point.x + sin(angle) * point.y,
                      -sin(angle) * point.x + cos(angle) * point.y);
  let spacingX = globals.params[1].x;
  let spacingY = globals.params[2].x;
  let distanceX = abs(fract(rotated.x / spacingX + 0.5) - 0.5) * spacingX;
  let distanceY = abs(fract(rotated.y / spacingY + 0.5) - 0.5) * spacingY;
  let feather = 0.5 / pixelRatio;
  let vertical = coverage(distanceX, globals.params[3].x, feather);
  let horizontal = coverage(distanceY, globals.params[4].x, feather);
  let crossing = vertical * horizontal;
  let verticalOnly = vertical * (1.0 - horizontal);
  let horizontalOnly = horizontal * (1.0 - vertical);
  let xColor = globals.params[8];
  let yColor = globals.params[9];
  let centerColor = globals.params[10];
  let line = vec4f(
    xColor.rgb * xColor.a * verticalOnly
      + yColor.rgb * yColor.a * horizontalOnly
      + centerColor.rgb * centerColor.a * crossing,
    xColor.a * verticalOnly + yColor.a * horizontalOnly + centerColor.a * crossing);
  let background = globals.params[11];
  let backdrop = vec4f(background.rgb * background.a, background.a);
  return over(line, backdrop) * globals.params[12].x;
}`;

export const ORTHOGONAL_GRID_EFFECT: EffectDefinition = {
  id: "an-native-owned-bt-orthogonal-grid",
  name: "Orthogonal Grid",
  version: 1,
  kind: "generator",
  placements: ["fill"],
  properties: {
    center: {
      type: "vec2",
      label: "Grid center",
      default: [0.5, 0.5],
      min: 0,
      max: 1,
    },
    spacingX: {
      type: "float",
      label: "Column spacing",
      default: 36,
      min: 4,
      max: 256,
      step: 1,
    },
    spacingY: {
      type: "float",
      label: "Row spacing",
      default: 36,
      min: 4,
      max: 256,
      step: 1,
    },
    weightX: {
      type: "float",
      label: "Column weight",
      default: 1.5,
      min: 0.2,
      max: 16,
      step: 0.1,
    },
    weightY: {
      type: "float",
      label: "Row weight",
      default: 1.5,
      min: 0.2,
      max: 16,
      step: 0.1,
    },
    angle: {
      type: "float",
      label: "Grid angle",
      default: 0,
      min: -3.14,
      max: 3.14,
      step: 0.01,
    },
    motionX: {
      type: "float",
      label: "Horizontal motion",
      default: 0,
      min: -80,
      max: 80,
      step: 0.1,
    },
    motionY: {
      type: "float",
      label: "Vertical motion",
      default: 0,
      min: -80,
      max: 80,
      step: 0.1,
    },
    columnColor: {
      type: "color",
      label: "Column color",
      default: color([0.38, 0.68, 0.92]),
    },
    rowColor: {
      type: "color",
      label: "Row color",
      default: color([0.38, 0.68, 0.92]),
    },
    intersectionColor: {
      type: "color",
      label: "Intersection color",
      default: color([0.77, 0.91, 1]),
    },
    background: {
      type: "color",
      label: "Background",
      default: color([0.025, 0.045, 0.085]),
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
      usage: ["sampled", "render"],
      size: "viewport",
    },
  ],
  resourceGraph: { abi: "linear-resource-v1" },
  passes: [
    {
      id: "draw-orthogonal-grid",
      kind: "render",
      reads: [],
      output: "color",
      wgsl: gridWgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original independent horizontal/vertical CSS-pixel grid lattice with rotated center, axis weights, scrolling and premultiplied intersections.",
  },
};

export const ORTHOGONAL_GRID_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-bt-blueprint-grid",
    name: "Blueprint Grid",
    definitionId: ORTHOGONAL_GRID_EFFECT.id,
    definitionVersion: 1,
    placement: "fill",
    params: {
      center: [0.5, 0.5],
      spacingX: 36,
      spacingY: 36,
      weightX: 1.3,
      weightY: 1.3,
      angle: 0,
      motionX: 0,
      motionY: 0,
      columnColor: color([0.38, 0.68, 0.92]),
      rowColor: color([0.38, 0.68, 0.92]),
      intersectionColor: color([0.77, 0.91, 1]),
      background: color([0.025, 0.045, 0.085]),
      opacity: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-bt-kinetic-lattice",
    name: "Kinetic Lattice",
    definitionId: ORTHOGONAL_GRID_EFFECT.id,
    definitionVersion: 1,
    placement: "fill",
    params: {
      center: [0.42, 0.56],
      spacingX: 22,
      spacingY: 56,
      weightX: 3.8,
      weightY: 1.1,
      angle: 0.52,
      motionX: 13,
      motionY: -8,
      columnColor: color([0.94, 0.28, 0.55]),
      rowColor: color([0.22, 0.85, 0.78]),
      intersectionColor: color([1, 0.89, 0.48]),
      background: color([0.02, 0.025, 0.055], 0),
      opacity: 0.95,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];

export const ORTHOGONAL_GRID_PRESET_LABEL_SOURCE_IDS: Readonly<
  Record<string, string>
> = Object.fromEntries(
  ORTHOGONAL_GRID_PRESETS.map((preset) => [preset.id, preset.id]),
);
