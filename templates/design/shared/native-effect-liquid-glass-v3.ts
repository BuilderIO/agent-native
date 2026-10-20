import {
  catalogColor,
  catalogFloat as f,
  catalogShader,
} from "./native-effect-catalog-kit";
import type { EffectDefinition } from "./native-effects";

const liquidGlass = catalogShader({
  id: "liquid-glass",
  version: 3,
  name: "Liquid Glass",
  kind: "processor",
  backdrop: true,
  edgeSampling: "fixed-clamp",
  properties: {
    thickness: { ...f("Thickness", 28, 0, 64, 0.1), unit: "px" },
    edgeWidth: { ...f("Edge width", 36, 1, 120, 0.1), unit: "px" },
    frost: { ...f("Frost", 0.5, 0, 24, 0.1), unit: "px" },
    highlight: f("Highlight", 0.5, 0, 1),
    lightAngle: f("Light angle", Math.PI * 1.25, 0, Math.PI * 2),
    tint: {
      type: "color",
      label: "Tint",
      default: catalogColor(1, 1, 1, 0.03),
    },
  },
  helpers: () => `
 // Runtime geometry follows the authored CSS radii or SVG alpha, never backdrop luminance.
 // RGBA = inward distance in logical px, outward normal XY, receiver coverage.
 @group(0) @binding(4) var shapeGeometryTexture: texture_2d<f32>;
 `,
  fragment: (p) => `
   let density = max(globals.clock.z, 0.0001);
   let size = max(globals.viewport.xy, vec2f(1.0));
   let geometry = textureSampleLevel(shapeGeometryTexture, effectSampler, input.uv, 0.0);
   let distance = max(geometry.r, 0.0);
   let edgeWidth = max(${p("edgeWidth")}.x, 1.0);
   let thickness = ${p("thickness")}.x;
   let outward = geometry.gb / max(length(geometry.gb), 0.0001);
   let edgeProfile = exp(-distance / edgeWidth);
   let slope = min(3.0, thickness * 2.0 / edgeWidth * edgeProfile);
   let normal = normalize(vec3f(outward * slope, 1.0));
   let ray = refract(vec3f(0.0, 0.0, -1.0), normal, 1.0 / 1.5);
   let depth = thickness * edgeProfile;
   let displacement = ray.xy / max(-ray.z, 0.15) * depth;
   let refractedUv = input.uv + displacement * density / size;
   let blurStep = ${p("frost")}.x * density / size;
   let weights = array<f32, 5>(1.0, 4.0, 6.0, 4.0, 1.0);
   var color = vec4f(0.0);
   for (var y = 0u; y < 5u; y += 1u) {
     for (var x = 0u; x < 5u; x += 1u) {
       let offset = vec2f(f32(x) - 2.0, f32(y) - 2.0) * blurStep;
       color += sampleSource(refractedUv + offset) * (weights[x] * weights[y] / 256.0);
     }
   }
   let tint = ${p("tint")};
   let tintOpacity = clamp(tint.a, 0.0, 1.0);
   let transmitted = color.rgb * (1.0 - tintOpacity) + tint.rgb * tintOpacity;
   let baseAlpha = color.a * (1.0 - tintOpacity) + tintOpacity;
   let lightAngle = ${p("lightAngle")}.x;
   let light = vec2f(cos(lightAngle), sin(lightAngle));
   let directional = dot(outward, light);
   let rim = edgeProfile;
   let fresnel = 0.04 + 0.96 * pow(1.0 - normal.z, 5.0);
   let shine = ${p("highlight")}.x * rim * (0.08 + fresnel * 0.7) * (0.65 + max(directional, 0.0) * 0.35);
   let shade = ${p("highlight")}.x * rim * 0.08 * pow(max(-directional, 0.0), 2.0);
   let outputAlpha = clamp(baseAlpha + shine * 0.55, 0.0, 1.0);
   let lit = transmitted * (1.0 - shade) + vec3f(shine);
   return vec4f(clamp(lit, vec3f(0.0), vec3f(outputAlpha)), outputAlpha);
 `,
});

export const LIQUID_GLASS_EFFECT: EffectDefinition = {
  ...liquidGlass,
  placements: ["backdrop"],
  inputs: {
    ...liquidGlass.inputs,
    mask: { kind: "mask", resource: "mask" },
    geometry: { kind: "texture-2d", resource: "receiverGeometry" },
  },
  passes: liquidGlass.passes.map((pass) => ({
    ...pass,
    reads: ["source", "mask", "receiverGeometry"],
  })),
  resources: [
    ...liquidGlass.resources!.map((resource) =>
      resource.kind === "texture-2d" && resource.name === "color"
        ? { ...resource, format: "rgba16float" as const }
        : resource,
    ),
    {
      name: "mask",
      kind: "texture-2d",
      usage: ["sampled"],
      external: true,
      size: "viewport",
    },
    {
      name: "receiverGeometry",
      kind: "texture-2d",
      format: "rgba16float",
      sampleEncoding: "linear-data",
      usage: ["sampled"],
      external: true,
      size: "viewport",
    },
  ],
};
