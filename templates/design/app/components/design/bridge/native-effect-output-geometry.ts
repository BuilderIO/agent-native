import type { NativeEffectExtentPlan } from "./native-effect-extent";

export type NativeOutputTransformStyle = {
  transform: string;
  transformOrigin: string;
  translate: string;
  rotate: string;
  scale: string;
  perspective: string;
  transformStyle: string;
};

export type NativeOutputGeometry = {
  left: number;
  top: number;
  width: number;
  height: number;
  transformOrigin: string;
};

export function nativeOutputSourceScale(
  extent: NativeEffectExtentPlan,
  rect: { width: number; height: number },
): { x: number; y: number } | null {
  if (
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  )
    return null;
  return {
    x: extent.sourceWidth / rect.width,
    y: extent.sourceHeight / rect.height,
  };
}

function originCoordinate(
  token: string,
  size: number,
  axis: "x" | "y",
): number | null {
  const fraction =
    token === "center"
      ? 0.5
      : axis === "x"
        ? token === "left"
          ? 0
          : token === "right"
            ? 1
            : undefined
        : token === "top"
          ? 0
          : token === "bottom"
            ? 1
            : undefined;
  if (fraction !== undefined) return fraction * size;
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%$/.test(token))
    return (Number(token.slice(0, -1)) * size) / 100;
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)px$/.test(token))
    return Number(token.slice(0, -2));
  return null;
}

export function supportsNativeOutput2D(
  style: NativeOutputTransformStyle,
): boolean {
  if (style.perspective && style.perspective !== "none") return false;
  if (style.transformStyle === "preserve-3d") return false;
  if (style.transform && style.transform !== "none") {
    const matrix = /^matrix\(([^)]+)\)$/.exec(style.transform);
    if (
      !matrix ||
      matrix[1].split(",").length !== 6 ||
      matrix[1]
        .split(",")
        .some((value) => !Number.isFinite(Number(value.trim())))
    )
      return false;
  }
  if (
    style.rotate &&
    style.rotate !== "none" &&
    !/^[+\-]?(?:\d+(?:\.\d*)?|\.\d+)(?:deg|rad|turn)$/.test(style.rotate)
  )
    return false;
  if (
    style.scale &&
    style.scale !== "none" &&
    style.scale.trim().split(/\s+/).length > 2
  )
    return false;
  if (style.translate && style.translate !== "none") {
    const parts = style.translate.trim().split(/\s+/);
    if (parts.length > 2) return false;
    if (
      !parts.every((part) =>
        /^[+\-]?(?:\d+(?:\.\d*)?|\.\d+)(?:px|%)$/.test(part),
      )
    )
      return false;
  }
  return true;
}

export function planNativeOutputGeometry(input: {
  offsetLeft: number;
  offsetTop: number;
  width: number;
  height: number;
  extent: NativeEffectExtentPlan;
  transformOrigin: string;
}): NativeOutputGeometry | null {
  const { offsetLeft, offsetTop, width, height, extent } = input;
  if (
    ![offsetLeft, offsetTop, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  )
    return null;
  const [xToken, yToken, zToken] = input.transformOrigin.trim().split(/\s+/);
  if (!xToken || !yToken || (zToken && zToken !== "0px")) return null;
  const x = originCoordinate(xToken, width, "x");
  const y = originCoordinate(yToken, height, "y");
  if (x === null || y === null) return null;
  const haloLeft = extent.left / extent.pixelRatio;
  const haloTop = extent.top / extent.pixelRatio;
  return {
    left: offsetLeft - haloLeft,
    top: offsetTop - haloTop,
    width: width + (extent.left + extent.right) / extent.pixelRatio,
    height: height + (extent.top + extent.bottom) / extent.pixelRatio,
    transformOrigin: `${x + haloLeft}px ${y + haloTop}px`,
  };
}
