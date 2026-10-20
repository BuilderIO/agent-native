import type { NativeAffine2D } from "./native-source-affine-geometry";
import { NativeSvgSourceError } from "./native-svg-source";

export function nativeSvgViewportSize(svg: SVGSVGElement): {
  width: number;
  height: number;
} {
  const style = getComputedStyle(svg);
  const dimension = (value: string, clientSize: number): number => {
    const parsed = /^\d+(?:\.\d+)?px$/.test(value)
      ? Number.parseFloat(value)
      : clientSize;
    if (!Number.isFinite(parsed) || parsed <= 0)
      throw new NativeSvgSourceError(
        "source-svg-size",
        "The SVG viewport has unreadable CSS dimensions.",
      );
    return parsed;
  };
  return {
    width: dimension(style.width, svg.clientWidth),
    height: dimension(style.height, svg.clientHeight),
  };
}

export function nativeSvgViewportToClient(svg: SVGSVGElement): NativeAffine2D {
  const size = nativeSvgViewportSize(svg);
  const screen = svg.getScreenCTM();
  if (!screen)
    throw new NativeSvgSourceError(
      "source-svg-transform-unsupported",
      "The SVG viewport has no screen transform.",
    );
  const rawViewBox = svg.getAttribute("viewBox");
  let sx = 1;
  let sy = 1;
  let x = 0;
  let y = 0;
  if (rawViewBox) {
    const viewBox = rawViewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (
      viewBox.length !== 4 ||
      viewBox.some((value) => !Number.isFinite(value)) ||
      viewBox[2] <= 0 ||
      viewBox[3] <= 0
    )
      throw new NativeSvgSourceError(
        "source-svg-size",
        "The SVG viewBox is invalid.",
      );
    sx = size.width / viewBox[2];
    sy = size.height / viewBox[3];
    const aspect = (svg.getAttribute("preserveAspectRatio") ?? "xMidYMid meet")
      .trim()
      .replace(/^defer\s+/, "")
      .split(/\s+/);
    if (aspect[0] !== "none") {
      sx = sy = aspect[1] === "slice" ? Math.max(sx, sy) : Math.min(sx, sy);
      const align = /^x(Min|Mid|Max)Y(Min|Mid|Max)$/.exec(aspect[0]);
      if (!align)
        throw new NativeSvgSourceError(
          "source-svg-transform-unsupported",
          "The SVG viewport alignment is unreadable.",
        );
      const amount = (value: string) =>
        value === "Min" ? 0 : value === "Mid" ? 0.5 : 1;
      x = (size.width - viewBox[2] * sx) * amount(align[1]);
      y = (size.height - viewBox[3] * sy) * amount(align[2]);
    }
    x -= viewBox[0] * sx;
    y -= viewBox[1] * sy;
  }
  const matrix = {
    a: screen.a / sx,
    b: screen.b / sx,
    c: screen.c / sy,
    d: screen.d / sy,
    e: screen.e - (screen.a * x) / sx - (screen.c * y) / sy,
    f: screen.f - (screen.b * x) / sx - (screen.d * y) / sy,
  };
  if (Object.values(matrix).some((value) => !Number.isFinite(value)))
    throw new NativeSvgSourceError(
      "source-svg-transform-unsupported",
      "The SVG viewport transform is unreadable.",
    );
  return matrix;
}
