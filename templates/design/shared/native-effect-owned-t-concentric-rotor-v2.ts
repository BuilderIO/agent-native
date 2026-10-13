import { catalogFloat, catalogShader } from "./native-effect-catalog-kit";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const base = catalogShader({
  id: "owned-t-concentric-rotor",
  name: "Concentric Rotor",
  version: 2,
  kind: "processor",
  properties: {
    edge: {
      type: "enum",
      label: "Outside source",
      default: "clamp",
      options: ["transparent", "clamp"],
      advanced: true,
    },
    centerX: catalogFloat("Center X", 0.5, 0, 1),
    centerY: catalogFloat("Center Y", 0.5, 0, 1),
    ring: {
      type: "float",
      label: "Ring width",
      default: 34,
      min: 12,
      max: 90,
      step: 0.1,
      unit: "px",
    },
    angle: catalogFloat("Zone angle", 0.38, -1.5, 1.5),
    speed: catalogFloat("Rotation speed", 0.55, 0, 3),
    speedVariance: catalogFloat("Speed variation", 0.35, 0, 1),
    phaseVariance: catalogFloat("Phase variation", 0.18, 0, 1.5),
    seed: {
      type: "int",
      label: "Pattern seed",
      default: 17,
      min: 0,
      max: 1000,
      step: 1,
    },
  },
  fragment: (property) => `
  let extent = globals.viewport.xy / globals.clock.z;
  let center = vec2f(${property("centerX")}.x, ${property("centerY")}.x) * extent;
  let ray = input.uv * extent - center;
  let zone = i32(floor(length(ray) / ${property("ring")}.x));
  let direction = select(-1.0, 1.0, (zone % 2) == 0);
  let seed = i32(${property("seed")}.x);
  let phase = random(vec2i(zone, seed)) * 2.0 - 1.0;
  let velocity = random(vec2i(zone + 127, seed + 317)) * 2.0 - 1.0;
  let angularSpeed = ${property("speed")}.x * (1.0 + velocity * ${property("speedVariance")}.x);
  let rotation = direction * ${property("angle")}.x
    + phase * ${property("phaseVariance")}.x
    + globals.clock.x * direction * angularSpeed;
  let source = center + rotate(ray, -rotation);
  return sampleSource(source / extent);`,
});

export const OWNED_T_CONCENTRIC_ROTOR_V2: EffectDefinition = {
  ...base,
  resources: base.resources?.map((resource) =>
    resource.name === "color"
      ? { ...resource, format: "rgba16float" }
      : resource,
  ),
  provenance: {
    origin: "design-original",
    note: "Alternating source annuli rotate with independent seeded phases and angular velocities; inverse sampling preserves the captured source RGBA.",
  },
};

export const OWNED_T_CONCENTRIC_ROTOR_V2_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-owned-t-concentric-rotor-v2-clockwork",
    name: "Clockwork Rings",
    definitionId: OWNED_T_CONCENTRIC_ROTOR_V2.id,
    definitionVersion: 2,
    placement: "layer",
    params: {
      centerX: 0.5,
      centerY: 0.5,
      ring: 34,
      angle: 0.38,
      speed: 0.55,
      speedVariance: 0.25,
      phaseVariance: 0.12,
      seed: 17,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-t-concentric-rotor-v2-counter-orbit",
    name: "Counter Orbit",
    definitionId: OWNED_T_CONCENTRIC_ROTOR_V2.id,
    definitionVersion: 2,
    placement: "layer",
    params: {
      centerX: 0.38,
      centerY: 0.5,
      ring: 24,
      angle: 0.85,
      speed: 1.1,
      speedVariance: 0.7,
      phaseVariance: 0.38,
      seed: 71,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
