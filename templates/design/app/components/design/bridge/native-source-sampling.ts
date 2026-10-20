import type {
  NativeAffine2D,
  NativeAffineBox,
} from "./native-source-affine-geometry";

export type NativeImageRendering = { value: string };
export type NativeImageSamplingPlan =
  | {
      ok: true;
      filter: "linear" | "nearest";
      pixelated?: { x: number; y: number };
    }
  | {
      ok: false;
      reason: "value" | "geometry" | "pixelated-scale" | "downsample";
    };

export function planNativeImageUpload(input: {
  imageRendering?: NativeImageRendering;
  sourceSize: { width: number; height: number };
  uploadedSize: { width: number; height: number };
}): NativeImageSamplingPlan {
  if (input.imageRendering === undefined) return { ok: true, filter: "linear" };
  const value = input.imageRendering?.value;
  if (["auto", "smooth", "high-quality", "optimizeQuality"].includes(value))
    return { ok: true, filter: "linear" };
  if (!["pixelated", "crisp-edges", "optimizeSpeed"].includes(value))
    return { ok: false, reason: "value" };
  const { sourceSize, uploadedSize } = input;
  if (
    ![
      sourceSize.width,
      sourceSize.height,
      uploadedSize.width,
      uploadedSize.height,
    ].every((size) => Number.isSafeInteger(size) && size > 0)
  )
    return { ok: false, reason: "geometry" };
  if (
    uploadedSize.width !== sourceSize.width ||
    uploadedSize.height !== sourceSize.height
  )
    return { ok: false, reason: "downsample" };
  return { ok: true, filter: "nearest" };
}

export function planNativeImageSampling(input: {
  imageRendering?: NativeImageRendering;
  sourceSize: { width: number; height: number };
  uploadedSize: { width: number; height: number };
  localBox: NativeAffineBox;
  localToTarget: NativeAffine2D;
  physicalScale: { x: number; y: number };
  uv?: { x: number; y: number; width: number; height: number };
}): NativeImageSamplingPlan {
  const upload = planNativeImageUpload(input);
  if (!upload.ok || upload.filter === "linear") return upload;
  const { sourceSize, localBox, localToTarget, physicalScale } = input;
  const uv = input.uv ?? { x: 0, y: 0, width: 1, height: 1 };
  if (
    ![
      localBox.x,
      localBox.y,
      localBox.width,
      localBox.height,
      localToTarget.a,
      localToTarget.b,
      localToTarget.c,
      localToTarget.d,
      localToTarget.e,
      localToTarget.f,
      physicalScale.x,
      physicalScale.y,
      uv.x,
      uv.y,
      uv.width,
      uv.height,
    ].every(Number.isFinite) ||
    localBox.width <= 0 ||
    localBox.height <= 0 ||
    physicalScale.x <= 0 ||
    physicalScale.y <= 0 ||
    uv.x < 0 ||
    uv.y < 0 ||
    uv.width <= 0 ||
    uv.height <= 0 ||
    uv.x + uv.width > 1 ||
    uv.y + uv.height > 1 ||
    localToTarget.a === 0 ||
    localToTarget.d === 0 ||
    localToTarget.b !== 0 ||
    localToTarget.c !== 0
  )
    return { ok: false, reason: "geometry" };
  if (input.imageRendering!.value !== "pixelated")
    return { ok: true, filter: "nearest" };

  const physicalWidth =
    (localBox.width / uv.width) * Math.abs(localToTarget.a) * physicalScale.x;
  const physicalHeight =
    (localBox.height / uv.height) * Math.abs(localToTarget.d) * physicalScale.y;
  const x = Math.max(1, Math.floor(physicalWidth / sourceSize.width + 0.5));
  const y = Math.max(1, Math.floor(physicalHeight / sourceSize.height + 0.5));
  // Half-texel centers must remain representable in the virtual f32 grid.
  if (
    ![x, y].every(Number.isSafeInteger) ||
    x * sourceSize.width > 8_388_608 ||
    y * sourceSize.height > 8_388_608
  )
    return { ok: false, reason: "pixelated-scale" };
  return { ok: true, filter: "nearest", pixelated: { x, y } };
}

export const nativePixelatedImageSamplingWgsl = `
fn nativeImagePremult(value: vec4f, premultiplied: bool) -> vec4f {
  if (premultiplied) { return value; }
  return vec4f(value.rgb * value.a, value.a);
}
fn nativeSamplePixelated(image: texture_2d<f32>, uv: vec2f, multiple: vec2f, premultiplied: bool) -> vec4f {
  let extent = vec2f(textureDimensions(image));
  let intermediate = extent * multiple;
  let position = clamp(uv, vec2f(0.0), vec2f(1.0)) * intermediate - vec2f(0.5);
  let low = floor(position);
  let fraction = position - low;
  let first = vec2i(floor(clamp(low, vec2f(0.0), intermediate - vec2f(1.0)) / multiple));
  let second = vec2i(floor(clamp(low + vec2f(1.0), vec2f(0.0), intermediate - vec2f(1.0)) / multiple));
  let topLeft = nativeImagePremult(textureLoad(image, first, 0), premultiplied);
  let topRight = nativeImagePremult(textureLoad(image, vec2i(second.x, first.y), 0), premultiplied);
  let bottomLeft = nativeImagePremult(textureLoad(image, vec2i(first.x, second.y), 0), premultiplied);
  let bottomRight = nativeImagePremult(textureLoad(image, second, 0), premultiplied);
  let value = mix(mix(topLeft, topRight, fraction.x), mix(bottomLeft, bottomRight, fraction.x), fraction.y);
  if (premultiplied) { return value; }
  if (value.a > 0.0) { return vec4f(value.rgb / value.a, value.a); }
  return vec4f(0.0);
}`;
