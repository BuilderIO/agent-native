import { describe, expect, it } from "vitest";

import {
  MAX_COMMENT_IMAGES,
  isCommentImageType,
  normalizeCommentImage,
  readStoredCommentImages,
  serializeStoredCommentImages,
} from "./comment-images";

const ID = "11111111-1111-4111-8111-111111111111";
const url = (id = ID) => `/api/private-media/${id}`;

describe("comment images", () => {
  it("keeps a private image in the kit's shape", () => {
    expect(
      normalizeCommentImage({
        url: url(),
        name: "  shot.png ",
        contentType: "IMAGE/PNG",
        provider: "builder",
      }),
    ).toEqual({ url: url(), name: "shot.png", contentType: "image/png" });
    expect(normalizeCommentImage({ url: url(), name: " " })).toEqual({
      url: url(),
      name: "image",
    });
  });

  it("refuses anything but a private image path in a screenshot format", () => {
    for (const value of [
      null,
      "x",
      { url: `https://tracker.test${url()}` },
      { url: `${url()}?x=1` },
      { url: "/api/private-media/not-an-id" },
      { url: url(), contentType: "image/svg+xml" },
    ]) {
      expect(normalizeCommentImage(value)).toBeNull();
    }
    expect(isCommentImageType("image/webp; charset=binary")).toBe(true);
    expect(isCommentImageType("image/svg+xml")).toBe(false);
  });

  it("stores nothing for no images and reads back what it stored", () => {
    expect(serializeStoredCommentImages([])).toBeNull();
    const stored = serializeStoredCommentImages([
      { url: url(), name: "a.png", contentType: "image/png" },
    ]);
    expect(readStoredCommentImages(stored)).toEqual([
      { url: url(), name: "a.png", contentType: "image/png" },
    ]);
  });

  it("reads a damaged row as having no images, and never more than five", () => {
    expect(readStoredCommentImages(null)).toEqual([]);
    expect(readStoredCommentImages("{")).toEqual([]);
    expect(readStoredCommentImages('{"url":"x"}')).toEqual([]);
    const many = Array.from({ length: 7 }, (_, index) => ({
      url: url(`11111111-1111-4111-8111-11111111111${index}`),
      name: `${index}.png`,
    }));
    expect(readStoredCommentImages(JSON.stringify(many))).toHaveLength(
      MAX_COMMENT_IMAGES,
    );
  });
});
