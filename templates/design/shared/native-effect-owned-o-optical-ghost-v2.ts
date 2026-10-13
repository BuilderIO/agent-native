import {
  catalogColor,
  catalogFloat,
  catalogShader,
} from "./native-effect-catalog-kit";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const fraction = (label: string, value: number) =>
  catalogFloat(label, value, 0, 1);
const pixelDistance = (label: string, value: number, max: number) => ({
  type: "float" as const,
  label,
  default: value,
  min: 1,
  max,
  step: 1,
  unit: "px" as const,
});

const base = catalogShader({
  id: "owned-o-ghost-chain",
  name: "Optical Ghost Chain",
  version: 2,
  kind: "generator",
  properties: {
    lightX: fraction("Emitter X", 0.22),
    lightY: fraction("Emitter Y", 0.2),
    size: pixelDistance("Aperture size", 54, 160),
    spread: fraction("Ghost spread", 0.82),
    ghosts: catalogFloat("Ghost count", 5, 1, 6, 1),
    intensity: fraction("Intensity", 0.75),
    halo: fraction("Halo", 0.35),
    haloRadius: pixelDistance("Halo radius", 130, 500),
    burst: fraction("Starburst", 0.46),
    rayCount: catalogFloat("Starburst rays", 8, 4, 12, 1),
    streak: fraction("Axis streak", 0.28),
    chromaticSeparation: fraction("Chromatic separation", 0.28),
    warm: {
      type: "color",
      label: "Warm flare",
      default: catalogColor(1, 0.42, 0.17),
    },
    cool: {
      type: "color",
      label: "Cool flare",
      default: catalogColor(0.18, 0.48, 1),
    },
  },
  helpers: () => `
fn aperture(distanceToCenter: f32) -> f32 {
  let inside = max(1.0 - distanceToCenter * distanceToCenter, 0.0);
  return inside * inside;
}
`,
  fragment: (property) => `
  let viewport = globals.viewport.xy / max(globals.clock.z, 0.001);
  let point = input.uv * viewport;
  let emitter = vec2f(${property("lightX")}.x, ${property("lightY")}.x) * viewport;
  let axis = viewport * 0.5 - emitter;
  let axisDirection = select(vec2f(1.0, 0.0), axis / max(length(axis), 0.001), length(axis) > 0.001);
  let offset = point - emitter;
  let radial = length(offset);
  let size = max(${property("size")}.x, 1.0);
  let warm = ${property("warm")}.rgb * ${property("warm")}.a;
  let cool = ${property("cool")}.rgb * ${property("cool")}.a;
  let core = exp(-pow(radial / (size * 0.48), 2.0) * 5.0);
  let halo = exp(-radial / max(${property("haloRadius")}.x, 1.0)) * ${property("halo")}.x * 0.24;
  let angle = atan2(offset.y, offset.x);
  let angularRay = pow(abs(cos(angle * ${property("rayCount")}.x * 0.5)), 24.0);
  let burstEnvelope = exp(-radial / (size * 3.6)) * smoothstep(size * 0.1, size * 0.5, radial);
  let burst = angularRay * burstEnvelope * ${property("burst")}.x * 0.58;
  let along = dot(offset, axisDirection);
  let across = abs(offset.x * axisDirection.y - offset.y * axisDirection.x);
  let streakLength = size * (2.0 + ${property("streak")}.x * 5.0);
  let streak = exp(-pow(across / (size * 0.085 + 1.0), 2.0) * 2.0)
    * exp(-abs(along) / streakLength) * ${property("streak")}.x * 0.48;
  var light = warm * (core + halo + burst + streak) * ${property("intensity")}.x;
  for (var i = 0; i < 6; i += 1) {
    if (f32(i) >= ${property("ghosts")}.x) { break; }
    let phase = (f32(i) + 1.0) / 7.0;
    let center = emitter + axis * (1.0 + phase * ${property("spread")}.x * 2.0);
    let radius = size * (0.18 + phase * 0.55);
    let shift = axisDirection * radius * ${property("chromaticSeparation")}.x * 0.22;
    let channels = vec3f(
      aperture(length(point - center - shift) / max(radius, 1.0)),
      aperture(length(point - center) / max(radius, 1.0)),
      aperture(length(point - center + shift) / max(radius, 1.0))
    );
    light += mix(warm, cool, phase) * channels
      * ${property("intensity")}.x * (0.5 - phase * 0.3);
  }
  let rgb = clamp(light, vec3f(0.0), vec3f(1.0));
  let alpha = max(max(rgb.r, rgb.g), rgb.b);
  return vec4f(rgb, alpha);
`,
});

export const OWNED_O_OPTICAL_GHOST_V2: EffectDefinition = {
  ...base,
  resources: base.resources?.map((resource) =>
    resource.name === "color"
      ? { ...resource, format: "rgba16float" }
      : resource,
  ),
  provenance: {
    origin: "design-original",
    note: "One emitter drives bounded axial aperture ghosts, angular starburst rays, an axis streak, independently sized halo and separated spectral ghost samples.",
  },
};

export const OWNED_O_OPTICAL_GHOST_V2_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-owned-o-ghost-chain-v2-aperture-star",
    name: "Aperture Star",
    definitionId: OWNED_O_OPTICAL_GHOST_V2.id,
    definitionVersion: 2,
    placement: "fill",
    params: {
      lightX: 0.17,
      lightY: 0.23,
      size: 38,
      ghosts: 6,
      burst: 0.78,
      rayCount: 10,
      streak: 0.18,
      haloRadius: 110,
      chromaticSeparation: 0.16,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-o-ghost-chain-v2-chromatic-sweep",
    name: "Chromatic Sweep",
    definitionId: OWNED_O_OPTICAL_GHOST_V2.id,
    definitionVersion: 2,
    placement: "fill",
    params: {
      lightX: 0.82,
      lightY: 0.18,
      size: 76,
      spread: 0.62,
      ghosts: 5,
      halo: 0.44,
      haloRadius: 230,
      burst: 0.24,
      rayCount: 6,
      streak: 0.67,
      chromaticSeparation: 0.75,
      cool: catalogColor(0.12, 0.76, 0.96),
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
