import type { ImgHTMLAttributes } from "react";

import {
  BUILDER_IMAGE_WIDTHS,
  getBuilderImageSrcSet,
  getBuilderImageUrl,
  getBuilderImageWidths,
  isBuilderImageUrl,
} from "./builder-image-urls";

function getFallbackWidth(
  width: ImgHTMLAttributes<HTMLImageElement>["width"],
  widths: readonly number[],
) {
  const maxWidth = widths[widths.length - 1] ?? 800;

  if (typeof width === "number") return Math.min(width, maxWidth);
  if (typeof width === "string") {
    const parsed = Number.parseInt(width, 10);
    if (Number.isFinite(parsed)) return Math.min(parsed, maxWidth);
  }

  return widths[Math.min(3, widths.length - 1)] ?? maxWidth;
}

interface BuilderImageProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "srcSet" | "sizes"
> {
  src: string;
  sizes: string;
  widths?: readonly number[];
}

export function BuilderImage({
  src,
  sizes,
  widths = BUILDER_IMAGE_WIDTHS,
  width,
  ...props
}: BuilderImageProps) {
  const resolvedWidths = getBuilderImageWidths(widths);
  const isBuilderImage = isBuilderImageUrl(src);
  const optimizedSrc =
    isBuilderImage && resolvedWidths.length > 0
      ? getBuilderImageUrl(src, getFallbackWidth(width, resolvedWidths))
      : src;
  const srcSet = isBuilderImage
    ? getBuilderImageSrcSet(src, resolvedWidths)
    : undefined;

  return (
    <img
      loading="lazy"
      decoding="async"
      {...props}
      width={width}
      sizes={isBuilderImage ? sizes : undefined}
      srcSet={srcSet}
      src={optimizedSrc}
    />
  );
}
