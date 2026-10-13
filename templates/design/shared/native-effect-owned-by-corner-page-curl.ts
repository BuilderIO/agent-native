import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const wgsl = `${NATIVE_RENDER_GLOBALS}
fn toCorner(uv: vec2f, corner: u32) -> vec2f {
  return vec2f(select(uv.x, 1.0 - uv.x, corner == 1u || corner == 3u),
    select(uv.y, 1.0 - uv.y, corner >= 2u));
}
fn fromCorner(uv: vec2f, corner: u32) -> vec2f { return toCorner(uv, corner); }
fn sourceAt(uv: vec2f) -> vec4f {
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return vec4f(0.0); }
  return textureSampleLevel(sourceTexture, effectSampler, uv, 0.0);
}
fn destinationAt(uv: vec2f) -> vec4f {
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return vec4f(0.0); }
  return textureSampleLevel(maskTexture, effectSampler, uv, 0.0);
}
fn over(top: vec4f, bottom: vec4f) -> vec4f {
  return vec4f(top.rgb + bottom.rgb * (1.0 - top.a), top.a + bottom.a * (1.0 - top.a));
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let progress = clamp(globals.params[0].x, 0.0, 1.0);
  if (progress <= 0.0) { return sourceAt(input.uv); }
  if (progress >= 1.0) { return destinationAt(input.uv); }
  let corner = min(u32(globals.params[1].x), 3u);
  let page = toCorner(input.uv, corner);
  let across = 0.5 * (page.x + page.y);
  let radius = max(globals.params[2].x, 0.005);
  let local = (across - progress) / radius;
  let destination = destinationAt(input.uv);
  if (local <= -1.0) { return destination; }
  if (local >= 1.0) { return over(sourceAt(input.uv), destination); }
  let curve = sqrt(max(1.0 - local * local, 0.0));
  let curvature = globals.params[3].x;
  let warp = radius * curve * curvature * 0.55;
  if (local >= 0.0) {
    let frontUv = fromCorner(page + vec2f(warp), corner);
    let front = sourceAt(frontUv);
    let contact = (1.0 - smoothstep(0.0, radius, across - progress)) * globals.params[6].x;
    let sheen = pow(curve, 3.0) * globals.params[5].x;
    let light = clamp(1.0 - 0.24 * contact + 0.22 * sheen, 0.0, 1.5);
    return over(vec4f(front.rgb * light, front.a), destination);
  }
  let reflected = page + vec2f(2.0 * (progress - across) + warp);
  let back = sourceAt(fromCorner(reflected, corner));
  let underside = clamp(1.0 - globals.params[4].x * (0.32 + 0.48 * curve), 0.05, 1.0);
  let backface = vec4f(back.rgb * underside, back.a);
  let revealShadow = clamp(1.0 - globals.params[6].x * 0.38 * curve, 0.0, 1.0);
  return over(backface, vec4f(destination.rgb * revealShadow, destination.a));
}`;

const fraction = (label: string, value: number, min = 0, max = 1) => ({
  type: "float" as const,
  label,
  default: value,
  min,
  max,
  step: 0.01,
});

export const CORNER_PAGE_CURL_EFFECT: EffectDefinition = {
  id: "an-native-owned-by-corner-page-curl",
  name: "Corner Page Curl",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    progress: fraction("Curl progress", 0.32),
    corner: {
      type: "enum",
      label: "Curl corner",
      default: "bottom-right",
      options: ["top-left", "top-right", "bottom-left", "bottom-right"],
    },
    curlRadius: fraction("Curl radius", 0.16, 0.02, 0.35),
    curvature: fraction("Curl curvature", 0.7),
    backShade: fraction("Backface shade", 0.58),
    sheen: fraction("Curl sheen", 0.4),
    contactShadow: fraction("Contact shadow", 0.6),
    destinationImage: {
      type: "texture",
      label: "Destination image",
      default: null,
      input: "destination",
    },
  },
  inputs: {
    source: { kind: "texture-2d", resource: "source" },
    destination: { kind: "texture-2d", resource: "destination" },
  },
  outputs: { color: { kind: "texture-2d", resource: "color" } },
  resources: [
    {
      name: "source",
      kind: "texture-2d",
      external: true,
      usage: ["sampled"],
      size: "viewport",
    },
    {
      name: "destination",
      kind: "texture-2d",
      external: true,
      usage: ["sampled"],
      size: "viewport",
      sampleEncoding: "srgb-color-premultiplied",
    },
    {
      name: "color",
      kind: "texture-2d",
      format: "rgba16float",
      usage: ["render", "sampled"],
      size: "viewport",
    },
  ],
  resourceGraph: { abi: "linear-resource-v1" },
  passes: [
    {
      id: "curl-corner",
      kind: "render",
      reads: ["source", "destination"],
      output: "color",
      wgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Corner-oriented page geometry samples a curved front and reflected backface from the selected source over an independently bound destination, with premultiplied contact shading and exact transition endpoints.",
  },
};

export const CORNER_PAGE_CURL_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-by-corner-page-curl-satin-turn",
    name: "Satin Turn",
    definitionId: CORNER_PAGE_CURL_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      progress: 0.28,
      corner: "bottom-right",
      curlRadius: 0.2,
      curvature: 0.56,
      backShade: 0.35,
      sheen: 0.52,
      contactShadow: 0.42,
    },
    bindings: {
      destination: { kind: "asset", url: "/shaders/gate-image.svg" },
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-by-corner-page-curl-deep-curl",
    name: "Deep Curl",
    definitionId: CORNER_PAGE_CURL_EFFECT.id,
    definitionVersion: 1,
    placement: "backdrop",
    params: {
      progress: 0.65,
      corner: "top-left",
      curlRadius: 0.3,
      curvature: 0.9,
      backShade: 0.78,
      sheen: 0.25,
      contactShadow: 0.85,
    },
    bindings: {
      destination: { kind: "asset", url: "/shaders/gate-image-contrast.svg" },
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
