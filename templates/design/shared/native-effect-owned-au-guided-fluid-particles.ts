import { FLUID_ADVECTED_PARTICLES_EFFECT } from "./native-effect-owned-aq-fluid-particles";
import { NATIVE_GRAPH_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";
import { isStatefulResourceGraph } from "./native-stateful-resource-graph";

const fluidGraph = FLUID_ADVECTED_PARTICLES_EFFECT.resourceGraph;
if (!isStatefulResourceGraph(fluidGraph))
  throw new Error("Guided fluid needs the bounded fluid state graph");

const guidedVelocityWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var guideTexture: texture_2d<f32>;
@group(0) @binding(4) var priorVelocity: texture_2d<f32>;
@group(0) @binding(18) var nextVelocity: texture_storage_2d<rgba16float, write>;
fn sourceAt(uv: vec2f) -> vec4f {
  return textureSampleLevel(sourceTexture, effectSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
}
fn contained(uv: vec2f) -> bool {
  return all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0)) && sourceAt(uv).a > 0.025;
}
fn velocityAt(uv: vec2f) -> vec2f {
  return textureSampleLevel(priorVelocity, effectSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0).xy;
}
fn guideAt(uv: vec2f) -> vec4f {
  return textureSampleLevel(guideTexture, effectSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
}
fn luma(color: vec4f) -> f32 {
  return dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
}
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let size = vec2i(textureDimensions(nextVelocity));
  if (any(invocation.xy >= vec2u(size))) { return; }
  let point = vec2i(invocation.xy);
  let uv = (vec2f(point) + vec2f(0.5)) / vec2f(size);
  if (!contained(uv)) { textureStore(nextVelocity, point, vec4f(0.0)); return; }
  let dt = globals.clock.w;
  let old = velocityAt(uv);
  var backtrace = uv - old * dt;
  if (!contained(backtrace)) { backtrace = uv; }
  var flow = velocityAt(backtrace);
  let pixel = vec2f(1.0) / vec2f(size);
  let left = select(flow, velocityAt(uv - vec2f(pixel.x, 0.0)), contained(uv - vec2f(pixel.x, 0.0)));
  let right = select(flow, velocityAt(uv + vec2f(pixel.x, 0.0)), contained(uv + vec2f(pixel.x, 0.0)));
  let top = select(flow, velocityAt(uv - vec2f(0.0, pixel.y)), contained(uv - vec2f(0.0, pixel.y)));
  let bottom = select(flow, velocityAt(uv + vec2f(0.0, pixel.y)), contained(uv + vec2f(0.0, pixel.y)));
  let viscosity = globals.params[0].x;
  flow = mix(flow, (left + right + top + bottom) * 0.25, clamp(viscosity * dt * 9.0, 0.0, 1.0));
  flow *= exp(-viscosity * dt * 0.65);
  let turbulence = globals.params[1].x;
  let angle = sin(uv.x * 37.0 + globals.clock.x * 1.7 + globals.clock.y) * cos(uv.y * 31.0 - globals.clock.x * 1.3);
  flow += vec2f(-cos(angle * 3.0 + uv.y * 19.0), sin(angle * 3.0 + uv.x * 17.0)) * turbulence * dt * 0.055;
  if (globals.params[10].x > 0.5) {
    let pointer = globals.params[9].xy;
    let offset = (uv - pointer) * globals.viewport.xy;
    let radius = max(1.0, globals.params[3].x * globals.clock.z);
    let brush = exp(-dot(offset, offset) / (radius * radius));
    let tangent = vec2f(-offset.y, offset.x) / max(length(offset), 1.0);
    flow += tangent * globals.params[2].x * brush * dt * 0.28;
  }
  if (globals.params[14].x > 0.5) {
    let guide = guideAt(uv);
    let gradient = vec2f(
      luma(guideAt(uv + vec2f(pixel.x, 0.0))) - luma(guideAt(uv - vec2f(pixel.x, 0.0))),
      luma(guideAt(uv + vec2f(0.0, pixel.y))) - luma(guideAt(uv - vec2f(0.0, pixel.y)))
    );
    let heading = vec2f(-gradient.y, gradient.x) / max(length(gradient), 0.02);
    let chroma = guide.rg / max(guide.a, 0.00001) * 2.0 - vec2f(1.0);
    let guideFlow = select(heading, chroma, globals.params[16].x > 0.5);
    flow += guideFlow * guide.a * globals.params[15].x * dt * 0.18;
  }
  textureStore(nextVelocity, point, vec4f(clamp(flow, vec2f(-0.6), vec2f(0.6)), 0.0, 0.0));
}`;

export const GUIDED_FLUID_PARTICLES_EFFECT: EffectDefinition = {
  ...FLUID_ADVECTED_PARTICLES_EFFECT,
  id: "an-native-owned-au-guided-fluid-particles",
  name: "Guided Fluid Particles",
  properties: {
    ...FLUID_ADVECTED_PARTICLES_EFFECT.properties,
    guideEnabled: { type: "bool", label: "Use guide", default: false },
    guideStrength: {
      type: "float",
      label: "Guide strength",
      default: 1.2,
      min: 0,
      max: 3,
      step: 0.01,
    },
    guideMode: {
      type: "enum",
      label: "Guide mode",
      default: "contours",
      options: ["contours", "color direction"],
    },
    guideImage: {
      type: "texture",
      label: "Guide image",
      default: null,
      input: "guide",
    },
  },
  inputs: {
    source: { kind: "texture-2d", resource: "source" },
    guide: {
      kind: "texture-2d",
      resource: "guide",
      enabledWhen: { property: "guideEnabled", equals: true },
      fallback: "transparent-data",
    },
  },
  resources: [
    ...FLUID_ADVECTED_PARTICLES_EFFECT.resources!,
    {
      name: "guide",
      kind: "texture-2d",
      external: true,
      usage: ["sampled"],
      size: "viewport",
    },
  ],
  resourceGraph: {
    ...fluidGraph,
    abi: "stateful-resource-v2",
  },
  passes: FLUID_ADVECTED_PARTICLES_EFFECT.passes.map((pass) =>
    pass.id === "advect-velocity"
      ? { ...pass, wgsl: guidedVelocityWgsl, reads: ["source", "guide"] }
      : pass,
  ),
  provenance: {
    origin: "design-original",
    note: "Original pressure-projected particles sample source color and alpha while an independently bound guide image turns their retained velocity field.",
  },
};

export const GUIDED_FLUID_PARTICLES_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-au-guided-fluid-contours",
    name: "Contour Current",
    definitionId: GUIDED_FLUID_PARTICLES_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      viscosity: 0.38,
      turbulence: 0.12,
      stirring: 0.35,
      brushRadius: 90,
      flowFollowing: 1.2,
      particleSize: 2.5,
      particleLife: 9,
      trailDecay: 1.8,
      opacity: 0.72,
      pointerPosition: [0.5, 0.5],
      pointerActive: false,
      amount: 0.85,
      particleCount: 2048,
      patternSeed: 41,
      guideEnabled: true,
      guideStrength: 1.7,
      guideMode: "contours",
    },
    bindings: {
      guide: { kind: "asset", url: "/shaders/gate-image-contrast.svg" },
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-au-guided-fluid-eddy",
    name: "Guided Eddy",
    definitionId: GUIDED_FLUID_PARTICLES_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      viscosity: 0.14,
      turbulence: 0.52,
      stirring: 0.9,
      brushRadius: 75,
      flowFollowing: 1.5,
      particleSize: 3.2,
      particleLife: 5,
      trailDecay: 2.4,
      opacity: 0.82,
      pointerPosition: [0.5, 0.5],
      pointerActive: false,
      amount: 0.9,
      particleCount: 3072,
      patternSeed: 83,
      guideEnabled: true,
      guideStrength: 0.85,
      guideMode: "color direction",
    },
    bindings: { guide: { kind: "asset", url: "/shaders/gate-image.svg" } },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
