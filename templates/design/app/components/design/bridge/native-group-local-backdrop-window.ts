import type { NativeEffectExtentPlan } from "./native-effect-extent";
import {
  planNativeSourceAffine,
  type NativeAffine2D,
  type NativeAffineBox,
} from "./native-source-affine-geometry";

export interface NativeGroupLocalBackdropWindowInput {
  incoming: NativeAffineBox;
  output: { width: number; height: number };
  extent: NativeEffectExtentPlan | null;
  localBox: NativeAffineBox;
  localToTarget: NativeAffine2D;
  physicalScale: { x: number; y: number };
  receiverClip: NativeAffineBox;
}

export interface NativeGroupLocalBackdropWindowPlan {
  readonly incoming: Readonly<NativeAffineBox>;
  readonly output: Readonly<{ width: number; height: number }>;
  readonly extent: Readonly<NativeEffectExtentPlan>;
  readonly captureWindow: Readonly<NativeAffineBox>;
  readonly replacementCoverage: Readonly<NativeAffineBox>;
  readonly sourceBox: Readonly<NativeAffineBox>;
  readonly samplingPixels: Readonly<NativeAffineBox>;
  readonly arithmeticEnvelope: Readonly<{ x: number; y: number }>;
  readonly packet: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
}

export type NativeGroupLocalBackdropWindowResult =
  | { ok: true; plan: NativeGroupLocalBackdropWindowPlan }
  | {
      ok: false;
      reason:
        | "invalid-geometry"
        | "extent-invalid"
        | "unsupported-affine"
        | "capture-window-unavailable"
        | "receiver-outside-capture"
        | "sampling-window-unavailable";
    };

const checkedPlans = new WeakSet<NativeGroupLocalBackdropWindowPlan>();
const MAX_EXACT_DIMENSION = 1_048_576;
const EXTENT_FIELDS = [
  "pixelRatio",
  "width",
  "height",
  "sourceWidth",
  "sourceHeight",
  "left",
  "top",
  "right",
  "bottom",
  "expanded",
] as const;

function validBox(box: NativeAffineBox): boolean {
  return (
    [
      box.x,
      box.y,
      box.width,
      box.height,
      box.x + box.width,
      box.y + box.height,
    ].every(Number.isFinite) &&
    box.width > 0 &&
    box.height > 0
  );
}

function contains(outer: NativeAffineBox, inner: NativeAffineBox): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function packedCoordinate(
  position: number,
  origin: number,
  size: number,
  output: number,
): number {
  const scaled = Math.fround(Math.fround(position) * size);
  const normalized = Math.fround(scaled / output);
  return Math.fround(Math.fround(origin + normalized) - 0.5);
}

export function planNativeGroupLocalBackdropWindow(
  input: NativeGroupLocalBackdropWindowInput,
): NativeGroupLocalBackdropWindowResult {
  const {
    incoming,
    output,
    extent,
    localBox,
    localToTarget: matrix,
    physicalScale: scale,
    receiverClip,
  } = input;
  if (
    !validBox(incoming) ||
    !validBox(localBox) ||
    !validBox(receiverClip) ||
    ![
      incoming.x,
      incoming.y,
      incoming.width,
      incoming.height,
      output.width,
      output.height,
    ].every(Number.isSafeInteger) ||
    [incoming.width, incoming.height, output.width, output.height].some(
      (value) => value <= 0 || value > MAX_EXACT_DIMENSION,
    ) ||
    ![
      matrix.a,
      matrix.b,
      matrix.c,
      matrix.d,
      matrix.e,
      matrix.f,
      scale.x,
      scale.y,
    ].every(Number.isFinite) ||
    scale.x <= 0 ||
    scale.y <= 0
  )
    return { ok: false, reason: "invalid-geometry" };
  if (
    !extent ||
    !Number.isFinite(extent.pixelRatio) ||
    extent.pixelRatio <= 0 ||
    extent.pixelRatio > 4
  )
    return { ok: false, reason: "extent-invalid" };
  const dimensions = [
    extent.width,
    extent.height,
    extent.sourceWidth,
    extent.sourceHeight,
  ];
  const insets = [extent.left, extent.top, extent.right, extent.bottom];
  if (
    !dimensions.every((value) => Number.isSafeInteger(value) && value > 0) ||
    !insets.every((value) => Number.isSafeInteger(value) && value >= 0) ||
    extent.width !== extent.sourceWidth + extent.left + extent.right ||
    extent.height !== extent.sourceHeight + extent.top + extent.bottom ||
    extent.width !== output.width ||
    extent.height !== output.height ||
    extent.expanded !== insets.some((value) => value > 0)
  )
    return { ok: false, reason: "extent-invalid" };
  if (matrix.b !== 0 || matrix.c !== 0 || matrix.a <= 0 || matrix.d <= 0)
    return { ok: false, reason: "unsupported-affine" };
  const authoredCaptureWindow = {
    x: (matrix.a * localBox.x + matrix.e) * scale.x,
    y: (matrix.d * localBox.y + matrix.f) * scale.y,
    width: matrix.a * localBox.width * scale.x,
    height: matrix.d * localBox.height * scale.y,
  };
  const replacementCoverage = {
    x: receiverClip.x * scale.x,
    y: receiverClip.y * scale.y,
    width: receiverClip.width * scale.x,
    height: receiverClip.height * scale.y,
  };
  if (!validBox(authoredCaptureWindow) || !validBox(replacementCoverage))
    return { ok: false, reason: "invalid-geometry" };
  if (!contains(incoming, authoredCaptureWindow))
    return { ok: false, reason: "capture-window-unavailable" };
  if (!contains(authoredCaptureWindow, replacementCoverage))
    return { ok: false, reason: "receiver-outside-capture" };
  const affine = planNativeSourceAffine({
    localBox,
    localToTarget: matrix,
    physicalScale: scale,
  });
  if (!affine.ok) return { ok: false, reason: "unsupported-affine" };
  const captureWindow = affine.physicalBounds;
  if (!contains(incoming, captureWindow))
    return { ok: false, reason: "capture-window-unavailable" };
  const sourceBox = {
    x: Math.fround(captureWindow.x - incoming.x),
    y: Math.fround(captureWindow.y - incoming.y),
    width: Math.fround(captureWindow.width),
    height: Math.fround(captureWindow.height),
  };
  if (!validBox(sourceBox)) return { ok: false, reason: "invalid-geometry" };
  const exactCopy =
    Number.isInteger(sourceBox.x) &&
    Number.isInteger(sourceBox.y) &&
    sourceBox.width === output.width &&
    sourceBox.height === output.height;
  // The fractional path needs support for rounded arithmetic, not only CSS rectangle edges.
  const arithmeticEnvelope = exactCopy
    ? { x: 0, y: 0 }
    : {
        x: 2 ** -19 * Math.max(1, sourceBox.x + sourceBox.width),
        y: 2 ** -19 * Math.max(1, sourceBox.y + sourceBox.height),
      };
  const left = exactCopy
    ? sourceBox.x
    : Math.floor(
        packedCoordinate(0.5, sourceBox.x, sourceBox.width, output.width) -
          arithmeticEnvelope.x,
      );
  const top = exactCopy
    ? sourceBox.y
    : Math.floor(
        packedCoordinate(0.5, sourceBox.y, sourceBox.height, output.height) -
          arithmeticEnvelope.y,
      );
  const right = exactCopy
    ? sourceBox.x + output.width - 1
    : Math.ceil(
        packedCoordinate(
          output.width - 0.5,
          sourceBox.x,
          sourceBox.width,
          output.width,
        ) + arithmeticEnvelope.x,
      );
  const bottom = exactCopy
    ? sourceBox.y + output.height - 1
    : Math.ceil(
        packedCoordinate(
          output.height - 0.5,
          sourceBox.y,
          sourceBox.height,
          output.height,
        ) + arithmeticEnvelope.y,
      );
  const samplingPixels = {
    x: left,
    y: top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
  if (
    ![left, top, right, bottom].every(Number.isSafeInteger) ||
    !contains(
      { x: 0, y: 0, width: incoming.width, height: incoming.height },
      samplingPixels,
    )
  )
    return { ok: false, reason: "sampling-window-unavailable" };
  const packet = Object.freeze([
    output.width,
    output.height,
    0,
    exactCopy ? 1 : 0,
    sourceBox.x,
    sourceBox.y,
    sourceBox.width,
    sourceBox.height,
  ] as const);
  const plan = Object.freeze({
    incoming: Object.freeze({ ...incoming }),
    output: Object.freeze({ ...output }),
    extent: Object.freeze({ ...extent }),
    captureWindow: Object.freeze(captureWindow),
    replacementCoverage: Object.freeze(replacementCoverage),
    sourceBox: Object.freeze(sourceBox),
    samplingPixels: Object.freeze(samplingPixels),
    arithmeticEnvelope: Object.freeze(arithmeticEnvelope),
    packet,
  });
  checkedPlans.add(plan);
  return { ok: true, plan };
}

export function isCurrentNativeGroupLocalBackdropWindow(
  plan: NativeGroupLocalBackdropWindowPlan | undefined,
  input: {
    incoming: { width: number; height: number };
    output: { width: number; height: number };
    extent: NativeEffectExtentPlan | null;
  },
): plan is NativeGroupLocalBackdropWindowPlan {
  return (
    !!plan &&
    checkedPlans.has(plan) &&
    plan.incoming.width === input.incoming.width &&
    plan.incoming.height === input.incoming.height &&
    plan.output.width === input.output.width &&
    plan.output.height === input.output.height &&
    !!input.extent &&
    EXTENT_FIELDS.every((field) => plan.extent[field] === input.extent![field])
  );
}
