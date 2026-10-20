import {
  LINEAR_SRGB_TO_DISPLAY_P3_WGSL,
  type NativeColorMode,
} from "./native-color-mode";
import { nativePixelatedImageSamplingWgsl } from "./native-source-sampling";

export const nativeClipCoverageWgsl = `
fn ellipseCoverage(p: vec2f, center: vec2f, radii: vec2f, pixelScale: f32) -> f32 {
  let q = p - center;
  let r = max(radii, vec2f(0.0001));
  let k0 = length(q / r);
  if (k0 < 0.00001) { return 1.0; }
  let k1 = length(q / (r * r));
  let distance = k0 * (k0 - 1.0) / max(k1, 0.00001);
  return clamp(0.5 - distance / pixelScale, 0.0, 1.0);
}
fn clipCoverage(p: vec2f, clip: Clip) -> f32 {
  let projected = vec3f(p, 1.0);
  let point = vec2f(dot(clip.inverseX.xyz, projected), dot(clip.inverseY.xyz, projected));
  let local = point - clip.rect.xy;
  let size = clip.rect.zw;
  let pixelScale = max(max(length(clip.inverseX.xy), length(clip.inverseY.xy)), 0.00001);
  if (local.x < -pixelScale || local.y < -pixelScale || local.x > size.x + pixelScale || local.y > size.y + pixelScale) {
    return 0.0;
  }
  var coverage = clamp(min(min(local.x, local.y), min(size.x - local.x, size.y - local.y)) / pixelScale + 0.5, 0.0, 1.0);
  let tl = clip.radiiTop.xy;
  let tr = clip.radiiTop.zw;
  let br = clip.radiiBottom.xy;
  let bl = clip.radiiBottom.zw;
  if (tl.x > 0.0 && tl.y > 0.0 && local.x < tl.x && local.y < tl.y) {
    coverage = min(coverage, ellipseCoverage(local, tl, tl, pixelScale));
  }
  if (tr.x > 0.0 && tr.y > 0.0 && local.x > size.x - tr.x && local.y < tr.y) {
    coverage = min(coverage, ellipseCoverage(local, vec2f(size.x - tr.x, tr.y), tr, pixelScale));
  }
  if (br.x > 0.0 && br.y > 0.0 && local.x > size.x - br.x && local.y > size.y - br.y) {
    coverage = min(coverage, ellipseCoverage(local, size - br, br, pixelScale));
  }
  if (bl.x > 0.0 && bl.y > 0.0 && local.x < bl.x && local.y > size.y - bl.y) {
    coverage = min(coverage, ellipseCoverage(local, vec2f(bl.x, size.y - bl.y), bl, pixelScale));
  }
  return coverage;
}
`;

export const compositeWgsl = `
struct Clip {
  rect: vec4f,
  radiiTop: vec4f,
  radiiBottom: vec4f,
  inverseX: vec4f,
  inverseY: vec4f,
};
struct Draw {
  rect: vec4f,
  viewport: vec4f,
  opacity: vec4f,
  uv: vec4f,
  clipCount: vec4f,
  origin: vec4f,
  localBox: vec4f,
  inverseX: vec4f,
  inverseY: vec4f,
  clips: array<Clip, 8>
};
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var source: texture_2d<f32>;
struct VOut { @builtin(position) position: vec4f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1))[i];
  let p = draw.rect.xy - draw.origin.xy + xy * draw.rect.zw;
  var out: VOut;
  out.position = vec4f(2.0 * p.x / draw.viewport.x - 1.0, 1.0 - 2.0 * p.y / draw.viewport.y, 0.0, 1.0);
  return out;
}
${nativeClipCoverageWgsl}
${nativePixelatedImageSamplingWgsl}
fn cssEncode(v: f32) -> f32 {
  let bounded = clamp(v, 0.0, 1.0);
  return select(1.055 * pow(bounded, 1.0 / 2.4) - 0.055, 12.92 * bounded, bounded <= 0.0031308);
}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let point = input.position.xy + draw.origin.xy;
  let projected = vec3f(point, 1.0);
  let local = vec2f(dot(draw.inverseX.xyz, projected), dot(draw.inverseY.xyz, projected));
  let localUv = (local - draw.localBox.xy) / draw.localBox.zw;
  var sample = vec4f(0.0);
  if (all(draw.viewport.zw > vec2f(0.0))) {
    sample = nativeSamplePixelated(source, draw.uv.xy + localUv * draw.uv.zw, draw.viewport.zw, draw.opacity.y > 0.5);
  } else {
    sample = textureSample(source, samp, draw.uv.xy + localUv * draw.uv.zw);
  }
  if (any(localUv < vec2f(0.0)) || any(localUv > vec2f(1.0))) {
    return vec4f(0.0);
  }
  var rgb = select(sample.rgb * sample.a, sample.rgb, draw.opacity.y > 0.5);
  if (draw.opacity.z > 0.5 && draw.opacity.w < 0.5) {
    let straight = select(vec3f(0.0), rgb / max(sample.a, 0.00001), sample.a > 0.00001);
    rgb = vec3f(cssEncode(straight.r), cssEncode(straight.g), cssEncode(straight.b)) * sample.a;
  }
  var coverage = 1.0;
  for (var i = 0u; i < 8u; i = i + 1u) {
    if (f32(i) >= draw.clipCount.x) { break; }
    coverage = min(coverage, clipCoverage(point, draw.clips[i]));
  }
  return vec4f(rgb, sample.a) * (draw.opacity.x * coverage);
}`;
export const backdropReplaceWgsl = (receiverCoverage = false) => `
struct Clip {
  rect: vec4f,
  radiiTop: vec4f,
  radiiBottom: vec4f,
  inverseX: vec4f,
  inverseY: vec4f,
};
struct Draw {
  rect: vec4f,
  viewport: vec4f,
  opacity: vec4f,
  uv: vec4f,
  clipCount: vec4f,
  origin: vec4f,
  localBox: vec4f,
  inverseX: vec4f,
  inverseY: vec4f,
  clips: array<Clip, 8>
};
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var priorScene: texture_2d<f32>;
@group(0) @binding(3) var processedBackdrop: texture_2d<f32>;
${receiverCoverage ? "@group(0) @binding(4) var receiverCoverageTexture: texture_2d<f32>;" : ""}
struct VOut { @builtin(position) position: vec4f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let p = array<vec2f, 3>(vec2f(-1.0,-1.0), vec2f(3.0,-1.0), vec2f(-1.0,3.0))[i];
  var output: VOut;
  output.position = vec4f(p, 0.0, 1.0);
  return output;
}
${nativeClipCoverageWgsl}
${nativePixelatedImageSamplingWgsl}
fn cssEncode(v: f32) -> f32 {
  let bounded = clamp(v, 0.0, 1.0);
  return select(1.055 * pow(bounded, 1.0 / 2.4) - 0.055, 12.92 * bounded, bounded <= 0.0031308);
}
fn cssDecode(v: f32) -> f32 {
  let bounded = clamp(v, 0.0, 1.0);
  return select(pow((bounded + 0.055) / 1.055, 2.4), bounded / 12.92, bounded <= 0.04045);
}
fn decodePremult(value: vec4f) -> vec4f {
  let straight = select(vec3f(0.0), value.rgb / max(value.a, 0.00001), value.a > 0.00001);
  return vec4f(vec3f(cssDecode(straight.r), cssDecode(straight.g), cssDecode(straight.b)) * value.a, value.a);
}
fn encodePremult(value: vec4f) -> vec4f {
  let straight = select(vec3f(0.0), value.rgb / max(value.a, 0.00001), value.a > 0.00001);
  return vec4f(vec3f(cssEncode(straight.r), cssEncode(straight.g), cssEncode(straight.b)) * value.a, value.a);
}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let previous = textureLoad(priorScene, vec2i(input.position.xy), 0);
  let point = input.position.xy + draw.origin.xy;
  if (draw.opacity.w > 0.5 &&
      (point.x < draw.rect.x || point.y < draw.rect.y ||
       point.x >= draw.rect.x + draw.rect.z || point.y >= draw.rect.y + draw.rect.w)) {
    return previous;
  }
  let projected = vec3f(point, 1.0);
  let local = vec2f(dot(draw.inverseX.xyz, projected), dot(draw.inverseY.xyz, projected));
  let localUv = (local - draw.localBox.xy) / draw.localBox.zw;
  if (any(localUv < vec2f(0.0)) || any(localUv > vec2f(1.0))) { return previous; }
  var effect = vec4f(0.0);
  if (all(draw.viewport.zw > vec2f(0.0))) {
    effect = nativeSamplePixelated(processedBackdrop, draw.uv.xy + localUv * draw.uv.zw, draw.viewport.zw, true);
  } else {
    effect = textureSampleLevel(processedBackdrop, samp, draw.uv.xy + localUv * draw.uv.zw, 0.0);
  }
  var coverage = 1.0;
  for (var i = 0u; i < 8u; i = i + 1u) {
    if (f32(i) >= draw.clipCount.x) { break; }
    coverage = min(coverage, clipCoverage(point, draw.clips[i]));
  }
  let weight = coverage * draw.opacity.x ${receiverCoverage ? "* textureSampleLevel(receiverCoverageTexture, samp, localUv, 0.0).a" : ""};
  if (weight <= 0.0) { return previous; }
  if (draw.opacity.z > 0.5 && draw.opacity.w < 0.5) {
    return encodePremult(mix(decodePremult(previous), effect, weight));
  }
  return mix(previous, effect, weight);
}`;

export const cssPremultBlendWgsl = `
fn cssEncodeChannel(v: f32) -> f32 {
  let bounded = clamp(v, 0.0, 1.0);
  return select(1.055 * pow(bounded, 1.0 / 2.4) - 0.055, 12.92 * bounded, bounded <= 0.0031308);
}
fn cssDecodeChannel(v: f32) -> f32 {
  let bounded = clamp(v, 0.0, 1.0);
  return select(pow((bounded + 0.055) / 1.055, 2.4), bounded / 12.92, bounded <= 0.04045);
}
fn cssToEncoded(value: vec4f) -> vec4f {
  let alpha = clamp(value.a, 0.0, 1.0);
  let straight = select(vec3f(0.0), value.rgb / max(alpha, 0.00001), alpha > 0.00001);
  return vec4f(vec3f(cssEncodeChannel(straight.r), cssEncodeChannel(straight.g), cssEncodeChannel(straight.b)) * alpha, alpha);
}
fn cssToLinear(value: vec4f) -> vec4f {
  let alpha = clamp(value.a, 0.0, 1.0);
  let straight = select(vec3f(0.0), value.rgb / max(alpha, 0.00001), alpha > 0.00001);
  return vec4f(vec3f(cssDecodeChannel(straight.r), cssDecodeChannel(straight.g), cssDecodeChannel(straight.b)) * alpha, alpha);
}
fn cssSourceOver(front: vec4f, back: vec4f) -> vec4f {
  let encodedFront = cssToEncoded(front);
  let encodedBack = cssToEncoded(back);
  let remaining = 1.0 - encodedFront.a;
  return cssToLinear(encodedFront + encodedBack * remaining);
}
fn cssMix(front: vec4f, back: vec4f, weight: f32) -> vec4f {
  return cssToLinear(mix(cssToEncoded(back), cssToEncoded(front), weight));
}`;

export const cssSceneDecodeWgsl = `
struct Draw { viewport: vec4f };
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var source: texture_2d<f32>;
struct VOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1))[i];
  var out: VOut;
  out.position = vec4f(2.0 * xy.x - 1.0, 1.0 - 2.0 * xy.y, 0.0, 1.0);
  out.uv = xy;
  return out;
}
fn cssDecode(v: f32) -> f32 {
  let bounded = clamp(v, 0.0, 1.0);
  return select(pow((bounded + 0.055) / 1.055, 2.4), bounded / 12.92, bounded <= 0.04045);
}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let uv = input.position.xy / draw.viewport.xy;
  let encoded = textureSample(source, samp, uv);
  let straight = select(vec3f(0.0), encoded.rgb / max(encoded.a, 0.00001), encoded.a > 0.00001);
  return vec4f(vec3f(cssDecode(straight.r), cssDecode(straight.g), cssDecode(straight.b)) * encoded.a, encoded.a);
}`;

export const groupLocalBackdropSourceWgsl = `
struct Draw { extent: vec4f, sourceBox: vec4f };
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var source: texture_2d<f32>;
struct VOut { @builtin(position) position: vec4f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1))[i];
  var out: VOut;
  out.position = vec4f(2.0 * xy.x - 1.0, 1.0 - 2.0 * xy.y, 0.0, 1.0);
  return out;
}
fn cssDecode(v: f32) -> f32 {
  let bounded = clamp(v, 0.0, 1.0);
  return select(pow((bounded + 0.055) / 1.055, 2.4), bounded / 12.92, bounded <= 0.04045);
}
fn linearPremult(encoded: vec4f) -> vec4f {
  let alpha = clamp(encoded.a, 0.0, 1.0);
  let straight = select(vec3f(0.0), encoded.rgb / max(alpha, 0.00001), alpha > 0.00001);
  return vec4f(vec3f(cssDecode(straight.r), cssDecode(straight.g), cssDecode(straight.b)) * alpha, alpha);
}
fn samplePixel(pixel: vec2i) -> vec4f {
  return textureLoad(source, pixel, 0);
}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  if (draw.extent.w > 0.5) {
    let pixel = vec2i(input.position.xy) + vec2i(draw.sourceBox.xy);
    let encoded = samplePixel(pixel);
    return select(encoded, linearPremult(encoded), draw.extent.z > 0.5);
  }
  let scaled = input.position.xy * draw.sourceBox.zw;
  let normalized = scaled / draw.extent.xy;
  let coordinate = draw.sourceBox.xy + normalized - vec2f(0.5);
  let base = vec2i(floor(coordinate));
  let fraction = fract(coordinate);
  var p00 = samplePixel(base);
  var p10 = samplePixel(base + vec2i(1, 0));
  var p01 = samplePixel(base + vec2i(0, 1));
  var p11 = samplePixel(base + vec2i(1, 1));
  if (draw.extent.z > 0.5) {
    p00 = linearPremult(p00);
    p10 = linearPremult(p10);
    p01 = linearPremult(p01);
    p11 = linearPremult(p11);
  }
  return mix(mix(p00, p10, fraction.x), mix(p01, p11, fraction.x), fraction.y);
}`;

export const fillCompositeWgsl = `
struct Draw { viewport: vec4f };
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var foreground: texture_2d<f32>;
@group(0) @binding(3) var background: texture_2d<f32>;
struct VOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1))[i];
  var out: VOut;
  out.position = vec4f(2.0 * xy.x - 1.0, 1.0 - 2.0 * xy.y, 0.0, 1.0);
  out.uv = xy;
  return out;
}
${cssPremultBlendWgsl}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let uv = input.position.xy / draw.viewport.xy;
  let front = textureSample(foreground, samp, uv);
  let back = textureSample(background, samp, uv);
  let remaining = 1.0 - clamp(front.a, 0.0, 1.0);
  if (draw.viewport.z > 0.5) { return cssSourceOver(front, back); }
  return vec4f(front.rgb + back.rgb * remaining, front.a + back.a * remaining);
}`;

export const fillPresentationWgsl = `
struct Draw { viewport: vec4f, origin: vec4f };
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var children: texture_2d<f32>;
@group(0) @binding(3) var fill: texture_2d<f32>;
struct VOut { @builtin(position) position: vec4f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1))[i];
  var out: VOut;
  out.position = vec4f(2.0 * xy.x - 1.0, 1.0 - 2.0 * xy.y, 0.0, 1.0);
  return out;
}
${cssPremultBlendWgsl}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let pixel = vec2i(input.position.xy);
  let fillPixel = pixel - vec2i(draw.origin.xy);
  var back = vec4f(0.0);
  if (all(fillPixel >= vec2i(0)) && all(fillPixel < vec2i(textureDimensions(fill)))) {
    back = textureLoad(fill, fillPixel, 0);
  }
  let front = textureSampleLevel(children, samp, (vec2f(pixel) + vec2f(0.5)) / draw.viewport.xy, 0.0);
  let top = select(front, back, draw.origin.z > 0.5);
  let below = select(back, front, draw.origin.z > 0.5);
  let remaining = 1.0 - clamp(top.a, 0.0, 1.0);
  if (draw.viewport.z > 0.5) { return cssSourceOver(top, below); }
  return vec4f(top.rgb + below.rgb * remaining, top.a + below.a * remaining);
}`;

export const fillCoveredUnderlayWgsl = `
struct Draw { viewport: vec4f, cssBlend: vec4f };
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var effect: texture_2d<f32>;
@group(0) @binding(3) var previous: texture_2d<f32>;
@group(0) @binding(4) var outerCoverage: texture_2d<f32>;
@group(0) @binding(5) var innerCoverage: texture_2d<f32>;
struct VOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1))[i];
  var out: VOut;
  out.position = vec4f(2.0 * xy.x - 1.0, 1.0 - 2.0 * xy.y, 0.0, 1.0);
  out.uv = xy;
  return out;
}
${cssPremultBlendWgsl}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let outer = clamp(textureSample(outerCoverage, samp, input.uv).a, 0.0, 1.0);
  let sampledInner = textureSample(innerCoverage, samp, input.uv).a;
  let prior = textureSample(previous, samp, input.uv);
  let sampledEffect = textureSample(effect, samp, input.uv);
  if (outer <= 0.000001) { return vec4f(0.0); }
  let inner = min(outer, clamp(sampledInner, 0.0, 1.0));
  let back = select(prior, vec4f(prior.rgb * prior.a, prior.a) / outer, draw.viewport.z > 0.5);
  let front = select(sampledEffect * (inner / outer), sampledEffect / outer, draw.viewport.w > 0.5);
  let remaining = 1.0 - clamp(front.a, 0.0, 1.0);
  if (draw.cssBlend.x > 0.5) { return cssSourceOver(front, back); }
  return vec4f(front.rgb + back.rgb * remaining, front.a + back.a * remaining);
}`;

export const fillCoveredBoxWgsl = `
struct Draw { viewport: vec4f, cssBlend: vec4f };
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var underlay: texture_2d<f32>;
@group(0) @binding(3) var border: texture_2d<f32>;
@group(0) @binding(4) var outerCoverage: texture_2d<f32>;
struct VOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1))[i];
  var out: VOut;
  out.position = vec4f(2.0 * xy.x - 1.0, 1.0 - 2.0 * xy.y, 0.0, 1.0);
  out.uv = xy;
  return out;
}
${cssPremultBlendWgsl}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let uv = input.position.xy / draw.viewport.xy;
  let outer = clamp(textureSample(outerCoverage, samp, uv).a, 0.0, 1.0);
  let prior = textureSample(underlay, samp, uv);
  let sampledBorder = textureSample(border, samp, uv);
  if (outer <= 0.000001) { return vec4f(0.0); }
  let borderPixel = vec4f(sampledBorder.rgb * sampledBorder.a, sampledBorder.a) / outer;
  let remaining = 1.0 - clamp(borderPixel.a, 0.0, 1.0);
  if (draw.cssBlend.x > 0.5) { return cssSourceOver(borderPixel, prior) * outer; }
  return vec4f(borderPixel.rgb + prior.rgb * remaining, borderPixel.a + prior.a * remaining) * outer;
}`;

export const fillTextMixWgsl = `
struct Draw { viewport: vec4f };
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var effectAtUnitOpacity: texture_2d<f32>;
@group(0) @binding(3) var previousGlyph: texture_2d<f32>;
struct VOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1))[i];
  var out: VOut;
  out.position = vec4f(2.0 * xy.x - 1.0, 1.0 - 2.0 * xy.y, 0.0, 1.0);
  out.uv = xy;
  return out;
}
${cssPremultBlendWgsl}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let front = textureSample(effectAtUnitOpacity, samp, input.uv);
  let previous = textureSample(previousGlyph, samp, input.uv);
  let weight = clamp(draw.viewport.z, 0.0, 1.0);
  if (draw.viewport.w > 0.5) { return cssMix(front, previous, weight); }
  return mix(previous, front, weight);
}`;

export const srgbEncodeWgsl = `
fn encode(v: f32) -> f32 {
  return select(1.055 * pow(max(v, 0.0), 1.0 / 2.4) - 0.055, 12.92 * v, v <= 0.0031308);
}`;

export const presentWgsl = (mode: NativeColorMode): string => `
struct Draw { viewport: vec4f, opacity: vec4f };
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var source: texture_2d<f32>;
@group(0) @binding(3) var mask: texture_2d<f32>;
struct VOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1))[i];
  var out: VOut;
  out.position = vec4f(2.0 * xy.x - 1.0, 1.0 - 2.0 * xy.y, 0.0, 1.0);
  out.uv = xy;
  return out;
}
${srgbEncodeWgsl}
${mode === "display-p3" ? LINEAR_SRGB_TO_DISPLAY_P3_WGSL : ""}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let c = textureSample(source, samp, input.uv);
  let m = textureSample(mask, samp, input.uv).a;
  let a = clamp(c.a * m * draw.opacity.x, 0.0, 1.0);
  let straight = select(vec3f(0.0), c.rgb / max(c.a, 0.00001), c.a > 0.00001);
  let displayColor = ${mode === "display-p3" ? "linearSrgbToDisplayP3(straight)" : "straight"};
  return vec4f(vec3f(encode(displayColor.r), encode(displayColor.g), encode(displayColor.b)) * a, a);
}`;

export const exportCssPixelsWgsl = `
struct Draw { viewport: vec4f, opacity: vec4f };
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var source: texture_2d<f32>;
struct VOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1))[i];
  var out: VOut;
  out.position = vec4f(2.0 * xy.x - 1.0, 1.0 - 2.0 * xy.y, 0.0, 1.0);
  out.uv = xy;
  return out;
}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let encoded = textureSample(source, samp, input.uv);
  let straight = select(vec3f(0.0), encoded.rgb / max(encoded.a, 0.00001), encoded.a > 0.00001);
  return vec4f(clamp(straight, vec3f(0.0), vec3f(1.0)), clamp(encoded.a * draw.opacity.x, 0.0, 1.0));
}`;

export const exportPixelsWgsl = `
struct Draw { viewport: vec4f, opacity: vec4f };
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var source: texture_2d<f32>;
struct VOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1))[i];
  var out: VOut;
  out.position = vec4f(2.0 * xy.x - 1.0, 1.0 - 2.0 * xy.y, 0.0, 1.0);
  out.uv = xy;
  return out;
}
${srgbEncodeWgsl}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let premult = textureSample(source, samp, input.uv);
  let straight = select(vec3f(0.0), premult.rgb / max(premult.a, 0.00001), premult.a > 0.00001);
  return vec4f(encode(straight.r), encode(straight.g), encode(straight.b), clamp(premult.a * draw.opacity.x, 0.0, 1.0));
}`;

export const finishWgsl = `
struct Draw { viewport: vec4f, opacity: vec4f, clipRect: vec4f, radiiTop: vec4f, radiiBottom: vec4f, transformX: vec4f, transformY: vec4f };
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var source: texture_2d<f32>;
@group(0) @binding(3) var mask: texture_2d<f32>;
struct VOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1))[i];
  var out: VOut;
  out.position = vec4f(2.0 * xy.x - 1.0, 1.0 - 2.0 * xy.y, 0.0, 1.0);
  out.uv = xy;
  return out;
}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let p = input.uv * draw.viewport.xy - draw.clipRect.xy;
  let size = draw.clipRect.zw;
  var inside = 1.0;
  let tl = draw.radiiTop.xy;
  let tr = draw.radiiTop.zw;
  let br = draw.radiiBottom.xy;
  let bl = draw.radiiBottom.zw;
  if (tl.x > 0.0 && tl.y > 0.0 && p.x < tl.x && p.y < tl.y) {
    let q = (p - tl) / tl;
    if (dot(q, q) > 1.0) { inside = 0.0; }
  }
  if (tr.x > 0.0 && tr.y > 0.0 && p.x > size.x - tr.x && p.y < tr.y) {
    let q = (p - vec2f(size.x - tr.x, tr.y)) / tr;
    if (dot(q, q) > 1.0) { inside = 0.0; }
  }
  if (br.x > 0.0 && br.y > 0.0 && p.x > size.x - br.x && p.y > size.y - br.y) {
    let q = (p - (size - br)) / br;
    if (dot(q, q) > 1.0) { inside = 0.0; }
  }
  if (bl.x > 0.0 && bl.y > 0.0 && p.x < bl.x && p.y > size.y - bl.y) {
    let q = (p - vec2f(bl.x, size.y - bl.y)) / bl;
    if (dot(q, q) > 1.0) { inside = 0.0; }
  }
  let sourceUv = vec2f(
    dot(draw.transformX.xyz, vec3f(input.uv, 1.0)),
    dot(draw.transformY.xyz, vec3f(input.uv, 1.0))
  );
  let withinSource = all(sourceUv >= vec2f(0.0)) && all(sourceUv <= vec2f(1.0));
  let sampled = textureSample(source, samp, clamp(sourceUv, vec2f(0.0), vec2f(1.0)));
  let c = select(vec4f(0.0), sampled, withinSource);
  let maskAlpha = textureSample(mask, samp, input.uv).a;
  let opacity = clamp(draw.opacity.x * inside, 0.0, 1.0);
  if (draw.opacity.y > 0.5) {
    let alpha = min(clamp(c.a, 0.0, 1.0), maskAlpha) * opacity;
    let rgb = select(vec3f(0.0), c.rgb * (alpha / max(c.a, 0.00001)), c.a > 0.00001);
    return vec4f(rgb, alpha);
  }
  return c * (opacity * maskAlpha);
}`;

export const linearPremultInputWgsl = `
@group(0) @binding(0) var encodedStraight: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let triangle = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(triangle[index], 0.0, 1.0);
}
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let straight = textureLoad(encodedStraight, vec2i(position.xy), 0);
  return vec4f(straight.rgb * straight.a, straight.a);
}
`;

export const nativeWorkerExportRegionWgsl = `
struct Draw { viewport: vec4f, opacity: vec4f };
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var source: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let xy = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1))[i];
  return vec4f(2.0 * xy.x - 1.0, 1.0 - 2.0 * xy.y, 0.0, 1.0);
}
${srgbEncodeWgsl}
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let pixel = position.xy + draw.viewport.zw;
  if (any(pixel < vec2f(0.0)) || any(pixel >= draw.viewport.xy)) {
    return vec4f(0.0);
  }
  let premult = textureSampleLevel(source, samp, pixel / draw.viewport.xy, 0.0);
  let straight = select(vec3f(0.0), premult.rgb / max(premult.a, 0.00001), premult.a > 0.00001);
  return vec4f(encode(straight.r), encode(straight.g), encode(straight.b), clamp(premult.a * draw.opacity.x, 0.0, 1.0));
}`;

export const encodedMipWgsl = `
@group(0) @binding(0) var previousLevel: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let triangle = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(triangle[index], 0.0, 1.0);
}
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let sourceSize = vec2u(textureDimensions(previousLevel));
  let destinationSize = max(sourceSize / 2u, vec2u(1u));
  let pixel = vec2u(position.xy);
  let low = pixel * sourceSize / destinationSize;
  let high = (pixel + vec2u(1u)) * sourceSize / destinationSize;
  var sum = vec4f(0.0);
  var count = 0u;
  for (var y = low.y; y < high.y; y += 1u) {
    for (var x = low.x; x < high.x; x += 1u) {
      sum += textureLoad(previousLevel, vec2i(i32(x), i32(y)), 0);
      count += 1u;
    }
  }
  return sum / f32(max(count, 1u));
}
`;

export const inputMaskWgsl = `
struct Draw { viewport: vec4f, targetRect: vec4f, radiiTop: vec4f, radiiBottom: vec4f };
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var textCoverage: texture_2d<f32>;
struct VOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1))[i];
  var out: VOut;
  out.position = vec4f(2.0 * xy.x - 1.0, 1.0 - 2.0 * xy.y, 0.0, 1.0);
  out.uv = xy;
  return out;
}
fn ellipseCoverage(p: vec2f, center: vec2f, radii: vec2f) -> f32 {
  let q = p - center;
  let r = max(radii, vec2f(0.0001));
  let k0 = length(q / r);
  if (k0 < 0.00001) { return 1.0; }
  let k1 = length(q / (r * r));
  return clamp(0.5 - k0 * (k0 - 1.0) / max(k1, 0.00001), 0.0, 1.0);
}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let p = input.uv * draw.viewport.xy - draw.targetRect.xy;
  let size = draw.targetRect.zw;
  var coverage = clamp(min(min(p.x, p.y), min(size.x - p.x, size.y - p.y)) + 0.5, 0.0, 1.0);
  let tl = draw.radiiTop.xy;
  let tr = draw.radiiTop.zw;
  let br = draw.radiiBottom.xy;
  let bl = draw.radiiBottom.zw;
  if (tl.x > 0.0 && tl.y > 0.0 && p.x < tl.x && p.y < tl.y) {
    coverage = min(coverage, ellipseCoverage(p, tl, tl));
  }
  if (tr.x > 0.0 && tr.y > 0.0 && p.x > size.x - tr.x && p.y < tr.y) {
    coverage = min(coverage, ellipseCoverage(p, vec2f(size.x - tr.x, tr.y), tr));
  }
  if (br.x > 0.0 && br.y > 0.0 && p.x > size.x - br.x && p.y > size.y - br.y) {
    coverage = min(coverage, ellipseCoverage(p, size - br, br));
  }
  if (bl.x > 0.0 && bl.y > 0.0 && p.x < bl.x && p.y > size.y - bl.y) {
    coverage = min(coverage, ellipseCoverage(p, vec2f(bl.x, size.y - bl.y), bl));
  }
  let alpha = coverage * textureSample(textCoverage, samp, input.uv).a;
  return vec4f(alpha, alpha, alpha, alpha);
}`;
