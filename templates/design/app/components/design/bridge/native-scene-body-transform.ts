import { NativeSourceError } from "./native-source-provider";

const AXIS_TOLERANCE = 0.000001;

export function supportsNativeSceneBodyTransform(
  style: CSSStyleDeclaration,
): boolean {
  if (
    style.transform !== "none" &&
    style.zIndex !== "auto" &&
    style.zIndex !== "0" &&
    style.zIndex !== ""
  )
    return false;
  if (
    style.opacity !== "1" ||
    style.translate !== "none" ||
    style.rotate !== "none" ||
    style.scale !== "none" ||
    (style.perspective && style.perspective !== "none") ||
    style.transformStyle === "preserve-3d"
  )
    return false;
  let matrix: DOMMatrixReadOnly;
  try {
    matrix = new DOMMatrixReadOnly(
      style.transform === "none" ? undefined : style.transform,
    );
  } catch {
    throw new NativeSourceError(
      "scene-presentation-transform-unsupported",
      "The body transform cannot be read.",
    );
  }
  return (
    matrix.is2D &&
    [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(
      Number.isFinite,
    ) &&
    matrix.a > 0 &&
    matrix.d > 0 &&
    Math.abs(matrix.b) <= AXIS_TOLERANCE &&
    Math.abs(matrix.c) <= AXIS_TOLERANCE
  );
}

export function attachNativeScenePresentationCanvas(
  canvas: HTMLCanvasElement,
  body: HTMLElement,
  style: CSSStyleDeclaration,
): void {
  if (style.transform === "none") {
    if (canvas.parentElement !== body || body.firstChild !== canvas)
      body.prepend(canvas);
    return;
  }
  if (
    canvas.parentElement !== document.documentElement ||
    canvas.previousElementSibling !== body
  )
    document.documentElement.insertBefore(canvas, body.nextSibling);
}
