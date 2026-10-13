import {
  catalogColor,
  catalogFloat,
  catalogShader,
} from "./native-effect-catalog-kit";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const pixels = (label: string, value: number, min: number, max: number) => ({
  type: "float" as const,
  label,
  default: value,
  min,
  max,
  step: 0.1,
  unit: "px" as const,
});

const base = catalogShader({
  id: "owned-s-triangular-beam-lattice",
  name: "Triangular Beam Lattice",
  version: 2,
  kind: "generator",
  properties: {
    pitch: pixels("Pitch", 48, 16, 120),
    stroke: pixels("Beam", 2, 0.5, 12),
    joint: pixels("Joint radius", 3, 0, 15),
    beam: {
      type: "color",
      label: "Beam",
      default: catalogColor(0.8, 0.72, 0.54),
    },
    ground: {
      type: "color",
      label: "Ground",
      default: catalogColor(0.07, 0.12, 0.16),
    },
    variation: catalogFloat("Face variation", 0, 0, 1),
    faceColor: {
      type: "color",
      label: "Variation color",
      default: catalogColor(0.2, 0.35, 0.44),
    },
    rowMotion: pixels("Row motion", 0, 0, 48),
    rowSpeed: catalogFloat("Row speed", 0.6, 0, 3),
    speedVariance: catalogFloat("Row speed variance", 0.35, 0, 1),
  },
  helpers: (p) => `
fn triJointDistance(delta: vec2f) -> f32 {
  return length(vec2f(delta.x, (delta.y - 0.5 * delta.x) / 0.8660254));
}
fn rowShift(row: i32) -> f32 {
  let phase = random(vec2i(row, 1931)) * TAU;
  let pace = 1.0 + (random(vec2i(row, 7919)) * 2.0 - 1.0)
    * ${p("speedVariance")}.x;
  return sin(globals.clock.x * ${p("rowSpeed")}.x * pace + phase)
    * ${p("rowMotion")}.x;
}
`,
  fragment: (p) => `
  let pitch = ${p("pitch")}.x;
  let sourcePoint = input.uv * globals.viewport.xy / max(globals.clock.z, 0.001);
  let rowCoordinate = sourcePoint.y * 0.8660254 / pitch;
  let lowerRow = i32(floor(rowCoordinate));
  let rowFraction = fract(rowCoordinate);
  let smoothRow = rowFraction * rowFraction * (3.0 - 2.0 * rowFraction);
  let rowOffset = mix(rowShift(lowerRow), rowShift(lowerRow + 1), smoothRow);
  let point = vec2f(sourcePoint.x - rowOffset, sourcePoint.y);
  let a = point.x / pitch;
  let b = (0.5 * point.x + 0.8660254 * point.y) / pitch;
  let c = b - a;
  let distanceLine = min(abs(fract(a + 0.5) - 0.5),
    min(abs(fract(b + 0.5) - 0.5), abs(fract(c + 0.5) - 0.5))) * pitch;
  let localA = fract(a);
  let localB = fract(b);
  let v00 = triJointDistance(vec2f(localA, localB));
  let v10 = triJointDistance(vec2f(localA - 1.0, localB));
  let v01 = triJointDistance(vec2f(localA, localB - 1.0));
  let v11 = triJointDistance(vec2f(localA - 1.0, localB - 1.0));
  let vertex = min(min(v00, v10), min(v01, v11)) * pitch;
  let aa = 1.0 / max(globals.clock.z, 0.001);
  let coverage = 1.0 - smoothstep(${p("stroke")}.x * 0.5,
    ${p("stroke")}.x * 0.5 + aa, min(distanceLine, vertex - ${p("joint")}.x));
  let triangleHalf = select(0, 1, localB >= localA);
  let faceId = vec2i(i32(floor(a)) * 2 + triangleHalf,
    i32(floor(b)) + 1009);
  let variationWeight = random(faceId) * ${p("variation")}.x;
  let foreground = ${p("beam")};
  let ground = ${p("ground")};
  let faceColor = ${p("faceColor")};
  let groundPremul = vec4f(ground.rgb * ground.a, ground.a);
  let facePremul = vec4f(faceColor.rgb * faceColor.a, faceColor.a);
  let background = mix(groundPremul, facePremul, variationWeight);
  return mix(background,
    vec4f(foreground.rgb * foreground.a, foreground.a), coverage);
`,
});

export const TRIANGULAR_BEAM_LATTICE_V2_EFFECT: EffectDefinition = {
  ...base,
  resources: base.resources?.map((resource) =>
    resource.name === "color"
      ? { ...resource, format: "rgba16float" }
      : resource,
  ),
  provenance: {
    origin: "design-original",
    note: "Three equilateral line families retain their joint geometry; seeded triangle faces vary independently while smoothly interpolated row shifts make a continuous animated warp, not rigid triangle translation.",
  },
};

export const TRIANGULAR_BEAM_LATTICE_V2_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-owned-s-triangular-beam-lattice-v2-mineral-mesh",
    name: "Mineral Mesh",
    definitionId: TRIANGULAR_BEAM_LATTICE_V2_EFFECT.id,
    definitionVersion: 2,
    placement: "fill",
    params: {
      pitch: 40,
      stroke: 2.2,
      joint: 3,
      beam: catalogColor(0.78, 0.66, 0.46),
      ground: catalogColor(0.06, 0.1, 0.13),
      faceColor: catalogColor(0.25, 0.41, 0.46),
      variation: 0.72,
      rowMotion: 6,
      rowSpeed: 0.42,
      speedVariance: 0.36,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-s-triangular-beam-lattice-v2-drifting-neon",
    name: "Drifting Neon",
    definitionId: TRIANGULAR_BEAM_LATTICE_V2_EFFECT.id,
    definitionVersion: 2,
    placement: "fill",
    params: {
      pitch: 76,
      stroke: 4.5,
      joint: 7,
      beam: catalogColor(0.42, 0.87, 1),
      ground: catalogColor(0.04, 0.04, 0.12),
      faceColor: catalogColor(0.31, 0.09, 0.46),
      variation: 0.85,
      rowMotion: 22,
      rowSpeed: 1.2,
      speedVariance: 0.82,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
