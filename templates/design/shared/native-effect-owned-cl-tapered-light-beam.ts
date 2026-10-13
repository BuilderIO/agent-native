import {
  catalogColor,
  catalogFloat,
  catalogShader,
} from "./native-effect-catalog-kit";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const pixel = (label: string, value: number, max: number) => ({
  type: "float" as const,
  label,
  default: value,
  min: 0,
  max,
  step: 0.5,
  unit: "px" as const,
});

const base = catalogShader({
  id: "owned-cl-tapered-light-beam",
  name: "Tapered Light Beam",
  kind: "generator",
  properties: {
    start: {
      type: "vec2",
      label: "Start",
      default: [0.18, 0.34],
      min: 0,
      max: 1,
      step: 0.01,
    },
    end: {
      type: "vec2",
      label: "End",
      default: [0.84, 0.66],
      min: 0,
      max: 1,
      step: 0.01,
    },
    startWidth: pixel("Start width", 42, 320),
    endWidth: pixel("End width", 104, 480),
    startSoftness: pixel("Start softness", 16, 160),
    endSoftness: pixel("End softness", 42, 240),
    startTaper: catalogFloat("Start taper", 0.12, 0, 0.45),
    endTaper: catalogFloat("End taper", 0.2, 0, 0.45),
    centerColor: {
      type: "color",
      label: "Center color",
      default: catalogColor(1, 0.87, 0.65, 0.86),
    },
    edgeColor: {
      type: "color",
      label: "Edge color",
      default: catalogColor(0.54, 0.67, 1, 0.24),
    },
    intensity: catalogFloat("Intensity", 0.92, 0, 1),
  },
  fragment: (p) => `
  let cssSize = globals.viewport.xy / max(globals.clock.z, 0.001);
  let point = input.uv * cssSize;
  let start = ${p("start")}.xy * cssSize;
  let end = ${p("end")}.xy * cssSize;
  let segment = end - start;
  let segmentLength = length(segment);
  let aa = 0.5 / max(globals.clock.z, 0.001);
  var progress = 0.5;
  var distanceToAxis = length(point - start);
  var endpointCoverage = 1.0;
  if (segmentLength >= 0.5) {
    let tangent = segment / segmentLength;
    let along = dot(point - start, tangent);
    progress = clamp(along / segmentLength, 0.0, 1.0);
    distanceToAxis = length(point - (start + segment * progress));
    let startSoftness = select(aa, ${p("startSoftness")}.x, ${p("startSoftness")}.x > 0.0);
    let endSoftness = select(aa, ${p("endSoftness")}.x, ${p("endSoftness")}.x > 0.0);
    let startExtent = max(segmentLength * ${p("startTaper")}.x, aa);
    let endExtent = max(segmentLength * ${p("endTaper")}.x, aa);
    let opening = smoothstep(-startSoftness, startExtent, along);
    let closing = 1.0 - smoothstep(segmentLength - endExtent,
      segmentLength + endSoftness, along);
    endpointCoverage = opening * closing;
  }
  let radius = mix(${p("startWidth")}.x, ${p("endWidth")}.x, progress) * 0.5;
  let softness = mix(${p("startSoftness")}.x, ${p("endSoftness")}.x, progress);
  let radialFeather = select(aa, softness, softness > 0.0);
  let radialCoverage = 1.0 - smoothstep(radius, radius + radialFeather, distanceToAxis);
  let core = 1.0 - smoothstep(0.0, max(radius, aa), distanceToAxis);
  let pigment = mix(${p("edgeColor")}, ${p("centerColor")}, core);
  let alpha = pigment.a * radialCoverage * endpointCoverage * ${p("intensity")}.x;
  return vec4f(pigment.rgb * alpha, alpha);
`,
});

export const TAPERED_LIGHT_BEAM_EFFECT: EffectDefinition = {
  ...base,
  resources: base.resources?.map((resource) =>
    resource.name === "color"
      ? { ...resource, format: "rgba16float" }
      : resource,
  ),
  provenance: {
    origin: "design-original",
    note: "A single source-free beam follows an editable segment, interpolating its width and softness independently while tapering both endpoints and mixing center and edge pigments.",
  },
};

export const TAPERED_LIGHT_BEAM_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-owned-cl-tapered-light-beam-soft-spotlight",
    name: "Soft Spotlight",
    definitionId: TAPERED_LIGHT_BEAM_EFFECT.id,
    definitionVersion: 1,
    placement: "fill",
    params: {
      start: [0.16, 0.18],
      end: [0.75, 0.8],
      startWidth: 28,
      endWidth: 170,
      startSoftness: 12,
      endSoftness: 90,
      startTaper: 0.07,
      endTaper: 0.31,
      centerColor: catalogColor(1, 0.89, 0.62, 0.8),
      edgeColor: catalogColor(0.68, 0.75, 1, 0.2),
      intensity: 0.88,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-cl-tapered-light-beam-neon-sweep",
    name: "Neon Sweep",
    definitionId: TAPERED_LIGHT_BEAM_EFFECT.id,
    definitionVersion: 1,
    placement: "fill",
    params: {
      start: [0.08, 0.72],
      end: [0.91, 0.28],
      startWidth: 86,
      endWidth: 16,
      startSoftness: 30,
      endSoftness: 5,
      startTaper: 0.23,
      endTaper: 0.06,
      centerColor: catalogColor(0.42, 0.96, 1, 0.96),
      edgeColor: catalogColor(0.4, 0.22, 1, 0.28),
      intensity: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
