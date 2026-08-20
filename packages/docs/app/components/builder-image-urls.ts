export const BUILDER_IMAGE_WIDTHS = [240, 320, 400, 600, 800];

const BUILDER_IMAGE_HOSTS = new Set(["cdn.builder.io", "api.builder.io"]);

export function isBuilderImageUrl(src: string) {
  try {
    const url = new URL(src);
    return (
      BUILDER_IMAGE_HOSTS.has(url.hostname) &&
      url.pathname.startsWith("/api/v1/image/")
    );
  } catch {
    return false;
  }
}

export function getBuilderImageWidths(
  widths: readonly number[] = BUILDER_IMAGE_WIDTHS,
) {
  return [
    ...new Set(
      widths
        .map((width) => Math.round(width))
        .filter((width) => Number.isFinite(width) && width > 0),
    ),
  ].sort((a, b) => a - b);
}

export function getBuilderImageUrl(src: string, width: number) {
  const url = new URL(src);
  url.searchParams.delete("width");
  url.searchParams.delete("format");
  url.searchParams.set("format", "webp");
  url.searchParams.set("width", String(width));
  return url.toString();
}

export function getBuilderImageSrcSet(
  src: string,
  widths: readonly number[] = BUILDER_IMAGE_WIDTHS,
) {
  if (!isBuilderImageUrl(src)) return undefined;

  return getBuilderImageWidths(widths)
    .map((width) => `${getBuilderImageUrl(src, width)} ${width}w`)
    .join(", ");
}
