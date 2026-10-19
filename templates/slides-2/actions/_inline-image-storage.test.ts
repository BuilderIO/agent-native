import { describe, expect, it } from "vitest";

import { MAX_INLINE_IMAGE_BASE64_CHARS } from "../shared/upload-types.js";
import {
  assertDesignSystemAssetUrlsPersistable,
  assertSlideInlineImagesPersistable,
} from "./_inline-image-storage.js";
import { assertNoDeckRenderArtifacts } from "./_render-artifacts.js";

const INLINE_IMAGE = "data:image/png;base64,aGVsbG8=";

describe("slide inline image storage boundary", () => {
  it("rejects image data URLs with a typed error", () => {
    expect(() =>
      assertSlideInlineImagesPersistable(
        {},
        { content: `<img src="${INLINE_IMAGE}">` },
        "slide-1",
      ),
    ).toThrow(
      expect.objectContaining({
        errorCode: "inline_image_data_url_not_persistable",
        details: expect.objectContaining({ resource: "slide" }),
      }),
    );
  });

  it("rejects oversized inline payloads before decoding them", () => {
    const oversized = `data:image/png;base64,${"A".repeat(MAX_INLINE_IMAGE_BASE64_CHARS)}`;

    expect(() =>
      assertSlideInlineImagesPersistable(
        {},
        { content: `<img src="${oversized}">` },
        "slide-1",
      ),
    ).toThrow(
      expect.objectContaining({
        errorCode: "inline_image_data_url_too_large",
        statusCode: 413,
      }),
    );
  });

  it("rejects malformed data URLs instead of treating them as stored images", () => {
    expect(() =>
      assertSlideInlineImagesPersistable(
        {},
        { content: '<img src="data:image/png;base64,%%%">' },
        "slide-1",
      ),
    ).toThrow(
      expect.objectContaining({
        errorCode: "invalid_inline_image_data_url",
      }),
    );
  });

  it("allows asset handles and external URLs and preserves an unchanged legacy URL", () => {
    const previous = {
      content: `<img src="${INLINE_IMAGE}">`,
      imageUrl: "https://example.com/slide.png",
    };
    expect(() =>
      assertSlideInlineImagesPersistable(previous, previous, "slide-1"),
    ).not.toThrow();
    expect(() =>
      assertSlideInlineImagesPersistable(
        {},
        {
          content:
            '<img src="asset://uploaded-image"><img src="https://example.com/image.png">',
          imageUrl: "asset://uploaded-image",
        },
        "slide-2",
      ),
    ).not.toThrow();
  });

  it("checks full-deck source fields and Excalidraw file payloads", () => {
    expect(() =>
      assertNoDeckRenderArtifacts(null, {
        slides: [
          {
            id: "slide-1",
            content: "<div />",
            sourceTsx: `const image = "${INLINE_IMAGE}";`,
          },
        ],
      }),
    ).toThrow(
      expect.objectContaining({
        errorCode: "inline_image_data_url_not_persistable",
      }),
    );

    expect(() =>
      assertSlideInlineImagesPersistable(
        {},
        {
          excalidrawData: JSON.stringify({
            files: { image: { dataURL: INLINE_IMAGE } },
          }),
        },
        "slide-2",
      ),
    ).toThrow(
      expect.objectContaining({
        errorCode: "inline_image_data_url_not_persistable",
        details: expect.objectContaining({
          field: "slide slide-2 excalidrawData.files.image.dataURL",
        }),
      }),
    );
  });

  it("does not treat ordinary TSX data properties and labels as image URLs", () => {
    expect(() =>
      assertSlideInlineImagesPersistable(
        {},
        {
          sourceTsx:
            'const row = { data: items }; const label = "data: is a field label";',
        },
        "slide-3",
      ),
    ).not.toThrow();
  });

  it("rejects malformed Excalidraw JSON instead of skipping the storage check", () => {
    expect(() =>
      assertSlideInlineImagesPersistable(
        {},
        { excalidrawData: "not json" },
        "slide-1",
      ),
    ).toThrow(
      expect.objectContaining({ errorCode: "invalid_excalidraw_data" }),
    );
  });
});

describe("design system binary URL storage boundary", () => {
  it("rejects inline image bodies inside design system data and asset metadata", () => {
    expect(() =>
      assertDesignSystemAssetUrlsPersistable(
        { logos: [{ name: "Brand", url: INLINE_IMAGE }] },
        "data",
      ),
    ).toThrow(
      expect.objectContaining({
        errorCode: "inline_image_data_url_not_persistable",
        details: expect.objectContaining({ resource: "design-system" }),
      }),
    );

    expect(() =>
      assertDesignSystemAssetUrlsPersistable(
        [{ id: "brand-logo", url: "data:image/png;base64,%%%" }],
        "assets",
      ),
    ).toThrow(
      expect.objectContaining({
        errorCode: "invalid_inline_image_data_url",
      }),
    );
  });

  it("checks URL fields without treating structured design metadata as binary", () => {
    expect(() =>
      assertDesignSystemAssetUrlsPersistable(
        {
          notes: "A detailed brand note",
          colors: { primary: "data: is a field label" },
          logos: [{ url: "asset://brand-logo" }],
          imageStyle: { referenceUrls: ["https://example.com/reference.png"] },
        },
        "data",
      ),
    ).not.toThrow();
  });
});
