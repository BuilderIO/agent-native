import { describe, expect, it } from "vitest";

import {
  BUILDER_IMAGE_WIDTHS,
  getBuilderImageSrcSet,
  getBuilderImageUrl,
  getBuilderImageWidths,
  isBuilderImageUrl,
} from "./builder-image-urls";

const cdnImage =
  "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F619e278a05eb4fddaffdaa0668037a8b";

describe("Builder image URLs", () => {
  it("detects Builder image endpoints", () => {
    expect(isBuilderImageUrl(cdnImage)).toBe(true);
    expect(isBuilderImageUrl("https://cdn.builder.io/foo")).toBe(false);
    expect(isBuilderImageUrl("/local-image.png")).toBe(false);
  });

  it("adds WebP and width params", () => {
    expect(getBuilderImageUrl(cdnImage, 400)).toBe(
      `${cdnImage}?format=webp&width=400`,
    );
  });

  it("replaces existing format and width params", () => {
    expect(getBuilderImageUrl(`${cdnImage}?format=jpg&width=2400`, 800)).toBe(
      `${cdnImage}?format=webp&width=800`,
    );
  });

  it("preserves unrelated query params", () => {
    expect(getBuilderImageUrl(`${cdnImage}?quality=80`, 1200)).toBe(
      `${cdnImage}?quality=80&format=webp&width=1200`,
    );
  });

  it("normalizes responsive width candidates", () => {
    expect(getBuilderImageWidths([800, 200.4, 0, -1, 200, 100])).toEqual([
      100, 200, 800,
    ]);
  });

  it("builds responsive WebP srcset candidates", () => {
    expect(getBuilderImageSrcSet(cdnImage, [100, 200, 400])).toBe(
      [100, 200, 400]
        .map((width) => `${cdnImage}?format=webp&width=${width} ${width}w`)
        .join(", "),
    );
  });

  it("uses the capped default candidate ladder", () => {
    expect(getBuilderImageSrcSet(cdnImage)).toContain(
      `${cdnImage}?format=webp&width=${BUILDER_IMAGE_WIDTHS.at(-1)} ${BUILDER_IMAGE_WIDTHS.at(-1)}w`,
    );
    expect(getBuilderImageSrcSet(cdnImage)).not.toContain("width=2400");
  });

  it("does not create srcset for non-Builder URLs", () => {
    expect(getBuilderImageSrcSet("https://example.com/image.png")).toBe(
      undefined,
    );
  });
});
