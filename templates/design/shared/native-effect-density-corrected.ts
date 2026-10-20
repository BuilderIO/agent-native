import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition } from "./native-effects";

function floatOutput(
  definition: EffectDefinition,
): EffectDefinition["resources"] {
  return definition.resources?.map((resource) =>
    resource.name === "color"
      ? { ...resource, format: "rgba16float" as const }
      : resource,
  );
}

export function createDensityCorrectedHalftoneEffect(
  halftoneV2: EffectDefinition,
): EffectDefinition {
  return {
    ...halftoneV2,
    version: 3,
    resources: floatOutput(halftoneV2),
    passes: [
      {
        ...halftoneV2.passes[0],
        wgsl:
          NATIVE_RENDER_GLOBALS +
          `
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let pixel = input.uv * globals.viewport.xy;
  let angle = globals.params[1].x;
  let rotated = vec2f(pixel.x * cos(angle) - pixel.y * sin(angle), pixel.x * sin(angle) + pixel.y * cos(angle));
  let density = max(globals.clock.z, 0.0001);
  let cell = max(globals.params[0].x, 1.0) * density;
  let center = (floor(rotated / cell) + vec2f(0.5)) * cell;
  let samplePixel = vec2f(center.x * cos(angle) + center.y * sin(angle), -center.x * sin(angle) + center.y * cos(angle));
  let sampled = textureSample(sourceTexture, effectSampler, clamp(samplePixel * globals.viewport.zw, vec2f(0.0), vec2f(1.0)));
  let straightColor = select(vec3f(0.0), sampled.rgb / max(sampled.a, 0.00001), sampled.a > 0.0);
  let luminance = dot(straightColor, vec3f(0.2126, 0.7152, 0.0722));
  let amount = clamp((1.0 - luminance) * globals.params[2].x, 0.0, 1.0);
  let radius = sqrt(amount) * cell * 0.47;
  let antialias = 0.75 * density;
  let coverage = 1.0 - smoothstep(radius - antialias, radius + antialias, length(rotated - center));
  let color = mix(globals.params[4].rgb, globals.params[3].rgb, coverage);
  let paletteAlpha = mix(globals.params[4].a, globals.params[3].a, coverage);
  let alpha = sampled.a * paletteAlpha;
  return vec4f(color * alpha, alpha);
}
`,
      },
    ],
  };
}

export function createDensityCorrectedFrostEffect(
  frostV2: EffectDefinition,
): EffectDefinition {
  return {
    ...frostV2,
    version: 3,
    resources: floatOutput(frostV2),
    passes: [
      {
        ...frostV2.passes[0],
        wgsl:
          NATIVE_RENDER_GLOBALS +
          `
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let phase = globals.clock.x * globals.params[2].x;
  let ripple = vec2f(sin(uv.y * 31.0 + phase), cos(uv.x * 27.0 - phase * 0.8));
  let density = max(globals.clock.z, 0.0001);
  let shifted = uv + ripple * globals.params[1].x * density * globals.viewport.zw;
  let step = globals.params[0].x * density * globals.viewport.zw * 0.35;
  var color = vec4f(0.0);
  for (var x = -1; x <= 1; x = x + 1) {
    for (var y = -1; y <= 1; y = y + 1) {
      color += textureSample(sourceTexture, effectSampler, clamp(shifted + vec2f(f32(x), f32(y)) * step, vec2f(0.0), vec2f(1.0)));
    }
  }
  color /= 9.0;
  let tinted = mix(color.rgb, globals.params[3].rgb * color.a, globals.params[3].a);
  return vec4f(tinted, color.a);
}
`,
      },
    ],
  };
}
