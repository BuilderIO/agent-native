import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type {
  EffectDefinition,
  EffectProperty,
  EffectResourceSpec,
} from "./native-effects";

const SUPPORT = 24;
const TAPS = 6;

export function gaussianWeights(halfKernel: number): number[] {
  if (
    !Number.isSafeInteger(halfKernel) ||
    halfKernel < 1 ||
    halfKernel > SUPPORT
  ) {
    throw new RangeError(
      "Gaussian half kernel must be an integer from 1 to 24.",
    );
  }
  const values = Array.from({ length: 2 * halfKernel + 1 }, (_, index) => {
    const coordinate = (3 * (index - halfKernel)) / halfKernel;
    return Math.exp(-0.5 * coordinate * coordinate);
  });
  const energy = values.reduce((sum, value) => sum + value, 0);
  return values.map((value) => value / energy);
}

function diffusion(axis: readonly [number, number]): string {
  return `${NATIVE_RENDER_GLOBALS}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let support = globals.params[0].x * globals.clock.z;
  let direction = vec2f(${axis[0]}.0, ${axis[1]}.0) * globals.viewport.zw;
  var energy = 0.0;
  var accumulation = vec4f(0.0);
  for (var offset = -${TAPS}; offset <= ${TAPS}; offset += 1) {
    let position = f32(offset) / ${TAPS}.0;
    let weight = exp(-4.5 * position * position);
    let uv = input.uv + direction * support * position;
    var sample = vec4f(0.0);
    if (all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0))) {
      sample = textureSampleLevel(sourceTexture, effectSampler, uv, 0.0);
    }
    accumulation += sample * weight;
    energy += weight;
  }
  return accumulation / energy;
}
`;
}

const radius: EffectProperty = {
  type: "float",
  label: "Radius",
  default: 8,
  min: 0,
  max: SUPPORT,
  step: 0.1,
  unit: "px",
};
const source: EffectResourceSpec = {
  name: "source",
  kind: "texture-2d",
  usage: ["sampled"],
  external: true,
  size: "viewport",
};
const texture = (name: string): EffectResourceSpec => ({
  name,
  kind: "texture-2d",
  format: "rgba16float",
  usage: ["render", "sampled"],
  size: "viewport",
});
const extent = {
  output: { top: SUPPORT, right: SUPPORT, bottom: SUPPORT, left: SUPPORT },
};
const provenance: EffectDefinition["provenance"] = {
  origin: "design-original",
};

export const GAUSSIAN_BLUR_EFFECT: EffectDefinition = {
  id: "an-native-gaussian-blur",
  name: "Gaussian Blur",
  version: 2,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: { radius },
  inputs: { source: { kind: "texture-2d", resource: "source" } },
  outputs: { color: { kind: "texture-2d", resource: "color" } },
  resources: [source, texture("blurH"), texture("color")],
  extent,
  output: "color",
  provenance,
  passes: [
    {
      id: "horizontal",
      kind: "render",
      reads: ["source"],
      output: "blurH",
      wgsl: diffusion([1, 0]),
    },
    {
      id: "vertical",
      kind: "render",
      reads: ["blurH"],
      output: "color",
      wgsl: diffusion([0, 1]),
    },
  ],
};

export const BLOOM_EFFECT: EffectDefinition = {
  id: "an-native-bloom",
  name: "Bloom",
  version: 2,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    radius,
    threshold: {
      type: "float",
      label: "Threshold",
      default: 0.55,
      min: 0,
      max: 1,
      step: 0.01,
    },
    knee: {
      type: "float",
      label: "Softness",
      default: 0.18,
      min: 0,
      max: 0.5,
      step: 0.01,
    },
    intensity: {
      type: "float",
      label: "Intensity",
      default: 0.7,
      min: 0,
      max: 3,
      step: 0.01,
    },
  },
  inputs: { source: { kind: "texture-2d", resource: "source" } },
  outputs: { color: { kind: "texture-2d", resource: "color" } },
  resources: [
    source,
    texture("bright"),
    texture("blurH"),
    texture("blurV"),
    texture("color"),
  ],
  extent,
  output: "color",
  provenance,
  passes: [
    {
      id: "bright",
      kind: "render",
      reads: ["source"],
      output: "bright",
      wgsl: `${NATIVE_RENDER_GLOBALS}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let pixel = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let light = dot(pixel.rgb / max(pixel.a, 0.00001), vec3f(0.2126, 0.7152, 0.0722));
  let width = max(globals.params[2].x, 0.00001);
  let selection = smoothstep(globals.params[1].x - width, globals.params[1].x + width, light);
  return pixel * selection;
}
`,
    },
    {
      id: "horizontal",
      kind: "render",
      reads: ["bright"],
      output: "blurH",
      wgsl: diffusion([1, 0]),
    },
    {
      id: "vertical",
      kind: "render",
      reads: ["blurH"],
      output: "blurV",
      wgsl: diffusion([0, 1]),
    },
    {
      id: "composite",
      kind: "render",
      reads: ["source", "blurV"],
      output: "color",
      wgsl: `${NATIVE_RENDER_GLOBALS}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let base = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let light = textureSampleLevel(maskTexture, effectSampler, input.uv, 0.0);
  let gain = globals.params[3].x;
  let glowAlpha = clamp(light.a * gain, 0.0, 1.0);
  let alpha = base.a + glowAlpha * (1.0 - base.a);
  let glow = light.rgb / max(light.a, 0.00001) * glowAlpha;
  let color = base.rgb + glow * (vec3f(1.0) - base.rgb);
  return vec4f(clamp(color, vec3f(0.0), vec3f(alpha)), alpha);
}
`,
    },
  ],
};
