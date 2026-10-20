import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition } from "./native-effects";

export function createWideColorGrainEffect(
  grainV2: EffectDefinition,
): EffectDefinition {
  return {
    ...grainV2,
    name: "Wide Color Grain Gradient",
    version: 3,
    properties: {
      ...grainV2.properties,
      orange: {
        type: "color",
        label: "Orange",
        default: {
          space: "display-p3",
          components: [1, 0.28, 0.1],
          alpha: 1,
        },
      },
    },
    resources: grainV2.resources?.map((resource) =>
      resource.name === "color"
        ? { ...resource, format: "rgba16float" as const }
        : resource,
    ),
    passes: [
      {
        ...grainV2.passes[0],
        wgsl:
          NATIVE_RENDER_GLOBALS +
          `
fn hash(pixel: vec2f) -> f32 {
  return fract(sin(dot(pixel, vec2f(127.1, 311.7))) * 43758.5453);
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let phase = globals.clock.x * globals.params[3].x;
  let p = (uv - vec2f(0.5)) * globals.params[2].x;
  let wave = 0.5 + 0.5 * sin(p.x * 4.0 + p.y * 3.5 + phase + sin(p.y * 5.0 - phase * 0.7));
  let bloom = exp(-dot(p - vec2f(0.2 * sin(phase), 0.1 * cos(phase)), p - vec2f(0.2 * sin(phase), 0.1 * cos(phase))) * 2.6);
  let blend = clamp(wave * 0.52 + bloom * 0.36, 0.0, 1.0);
  var color = mix(globals.params[0].rgb, globals.params[1].rgb, blend);
  let alpha = mix(globals.params[0].a, globals.params[1].a, blend);
  let noise = hash(floor(uv * globals.viewport.xy) + vec2f(globals.clock.x * 23.0, globals.clock.y));
  color += (noise - 0.5) * globals.params[4].x;
  return vec4f(color * alpha, alpha);
}
`,
      },
    ],
  };
}
